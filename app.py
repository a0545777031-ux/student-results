# -*- coding: utf-8 -*-
"""
تحليل نتائج الطلاب — Student Results Analysis
Bilingual (AR default / EN) Flask app with admin dashboard, user registration
with admin approval, bulk PDF/Excel upload, parsing, analysis and exports.
"""
import os, json, sqlite3, datetime, re, secrets, smtplib
from email.mime.text import MIMEText
from functools import wraps
from flask import (Flask, request, session, redirect, jsonify, g,
                   send_file, render_template, abort, url_for)
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

import parser_core
import data_io

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE, "data")
UPLOAD_DIR = os.path.join(BASE, "uploads")
GEN_DIR = os.path.join(DATA_DIR, "generated")
DB_PATH = os.path.join(DATA_DIR, "app.db")
for d in (DATA_DIR, UPLOAD_DIR, GEN_DIR):
    os.makedirs(d, exist_ok=True)

ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "Admin999")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "123")
ALLOWED = {".pdf", ".xlsx", ".xls", ".csv"}

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", secrets.token_hex(32))
app.config["MAX_CONTENT_LENGTH"] = 60 * 1024 * 1024  # 60MB per request
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0  # never cache static files (always serve fresh)

# Cache-busting: a version string that changes on every process start (deploy/restart),
# appended to static asset URLs so browsers always pick up the newest CSS/JS.
import time as _time
ASSET_V = str(int(_time.time()))
@app.context_processor
def _inject_asset_v():
    return {"ASSET_V": ASSET_V}

@app.after_request
def _no_cache_static(resp):
    if request.path.startswith("/static/"):
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp

# ---------------- DB ----------------
# Persistent storage: if DATABASE_URL is set (e.g. a free cloud PostgreSQL),
# use PostgreSQL so users/data survive every restart and redeploy. Otherwise
# fall back to a local SQLite file (used for local development only).
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
PG = DATABASE_URL.startswith("postgres")
if PG:
    import psycopg
    from psycopg.rows import dict_row

class _Conn:
    """Small wrapper giving the same .execute(sql, params) / .fetchone() / .fetchall()
    interface for both SQLite and PostgreSQL. SQL uses '?' placeholders everywhere;
    they are translated to '%s' for PostgreSQL automatically."""
    def __init__(self):
        if PG:
            self.raw = psycopg.connect(DATABASE_URL, row_factory=dict_row, autocommit=True)
        else:
            self.raw = sqlite3.connect(DB_PATH)
            self.raw.row_factory = sqlite3.Row
            self.raw.execute("PRAGMA foreign_keys=ON")
    def execute(self, sql, params=()):
        if PG:
            return self.raw.execute(sql.replace("?", "%s"), params)
        return self.raw.execute(sql, params)
    def commit(self):
        try:
            self.raw.commit()
        except Exception:
            pass
    def close(self):
        self.raw.close()

def db():
    if "db" not in g:
        g.db = _Conn()
    return g.db

@app.teardown_appcontext
def close_db(exc):
    d = g.pop("db", None)
    if d is not None:
        d.close()

def init_db():
    con = _Conn()
    if PG:
        con.execute("""CREATE TABLE IF NOT EXISTS users(
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE,
            username TEXT UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL)""")
        con.execute("""CREATE TABLE IF NOT EXISTS content(
            key TEXT PRIMARY KEY,
            value_ar TEXT,
            value_en TEXT)""")
        con.execute("""CREATE TABLE IF NOT EXISTS uploads(
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            orig_name TEXT,
            stored_name TEXT,
            filetype TEXT,
            n_students INTEGER DEFAULT 0,
            parsed_json TEXT,
            created_at TEXT NOT NULL)""")
    else:
        con.raw.executescript("""
        CREATE TABLE IF NOT EXISTS users(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE,
            username TEXT UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS content(
            key TEXT PRIMARY KEY,
            value_ar TEXT,
            value_en TEXT
        );
        CREATE TABLE IF NOT EXISTS uploads(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            orig_name TEXT,
            stored_name TEXT,
            filetype TEXT,
            n_students INTEGER DEFAULT 0,
            parsed_json TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        """)
    now = datetime.datetime.utcnow().isoformat()
    cur = con.execute("SELECT id FROM users WHERE username=?", (ADMIN_USERNAME,))
    if not cur.fetchone():
        con.execute("INSERT INTO users(name,email,username,password_hash,role,status,created_at) VALUES(?,?,?,?,?,?,?)",
                    ("المدير", "admin@local", ADMIN_USERNAME,
                     generate_password_hash(ADMIN_PASSWORD), "admin", "active", now))
    defaults = {
        "site_title": ("تحليل نتائج الطلاب", "Student Results Analysis"),
        "hero_title": ("منصة تحليل نتائج الطلاب", "Student Results Analysis Platform"),
        "hero_subtitle": ("رفع وتحليل نتائج الطلاب بذكاء ودقة، مع رسوم بيانية ومقارنات احترافية",
                          "Upload and analyze student results with smart, accurate charts and comparisons"),
        "about": ("منصة سحابية رسمية لتحويل ملفات نتائج الطلاب إلى بيانات وتحليلات ورسوم بيانية دقيقة، تعمل من أي جهاز.",
                  "A secure cloud platform that turns student result files into accurate data, analytics and charts, from any device."),
        "announcement": ("", ""),
        "footer": ("جميع الحقوق محفوظة © منصة تحليل نتائج الطلاب",
                   "All rights reserved © Student Results Analysis"),
    }
    for k, (ar, en) in defaults.items():
        if not con.execute("SELECT 1 FROM content WHERE key=?", (k,)).fetchone():
            con.execute("INSERT INTO content(key,value_ar,value_en) VALUES(?,?,?)", (k, ar, en))
    con.commit()
    con.close()

# ---------------- auth helpers ----------------
def current_user():
    uid = session.get("uid")
    if not uid:
        return None
    row = db().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return row

def login_required(f):
    @wraps(f)
    def w(*a, **k):
        u = current_user()
        if not u:
            return jsonify({"error": "auth_required"}), 401
        if u["status"] != "active":
            return jsonify({"error": "not_active", "status": u["status"]}), 403
        g.user = u
        return f(*a, **k)
    return w

def admin_required(f):
    @wraps(f)
    def w(*a, **k):
        u = current_user()
        if not u or u["role"] != "admin":
            return jsonify({"error": "forbidden"}), 403
        g.user = u
        return f(*a, **k)
    return w

# ---------------- page routes ----------------
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/login")
def login_page():
    return render_template("login.html")

@app.route("/register")
def register_page():
    return render_template("register.html")

@app.route("/dashboard")
def dashboard_page():
    u = current_user()
    if not u or u["role"] == "admin":
        return redirect(url_for("login_page"))
    return render_template("dashboard.html")

@app.route("/admin")
def admin_page():
    u = current_user()
    if not u or u["role"] != "admin":
        return redirect(url_for("login_page"))
    return render_template("admin.html")

# ---------------- content API ----------------
@app.route("/api/content")
def api_content():
    rows = db().execute("SELECT key,value_ar,value_en FROM content").fetchall()
    return jsonify({r["key"]: {"ar": r["value_ar"], "en": r["value_en"]} for r in rows})

@app.route("/api/admin/content", methods=["POST"])
@admin_required
def api_admin_content():
    data = request.get_json(force=True)
    con = db()
    for key, v in data.items():
        con.execute("INSERT INTO content(key,value_ar,value_en) VALUES(?,?,?) "
                    "ON CONFLICT(key) DO UPDATE SET value_ar=excluded.value_ar, value_en=excluded.value_en",
                    (key, v.get("ar", ""), v.get("en", "")))
    con.commit()
    return jsonify({"ok": True})

# ---------------- auth API ----------------
@app.route("/api/me")
def api_me():
    u = current_user()
    if not u:
        return jsonify({"user": None})
    return jsonify({"user": {"id": u["id"], "name": u["name"], "email": u["email"],
                             "role": u["role"], "status": u["status"]}})

@app.route("/api/register", methods=["POST"])
def api_register():
    d = request.get_json(force=True)
    name = (d.get("name") or "").strip()
    email = (d.get("email") or "").strip().lower()
    pw = d.get("password") or ""
    if not name or not email or not pw:
        return jsonify({"error": "missing_fields"}), 400
    if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        return jsonify({"error": "invalid_email"}), 400
    if len(pw) < 4:
        return jsonify({"error": "weak_password"}), 400
    con = db()
    if con.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
        return jsonify({"error": "email_exists"}), 409
    now = datetime.datetime.utcnow().isoformat()
    con.execute("INSERT INTO users(name,email,username,password_hash,role,status,created_at) "
                "VALUES(?,?,?,?,?,?,?)",
                (name, email, None, generate_password_hash(pw), "user", "pending", now))
    con.commit()
    _notify_admin_new_user(name, email)
    return jsonify({"ok": True, "message": "pending_approval"})

@app.route("/api/login", methods=["POST"])
def api_login():
    d = request.get_json(force=True)
    ident = (d.get("identifier") or "").strip()
    pw = d.get("password") or ""
    row = db().execute("SELECT * FROM users WHERE email=? OR username=?",
                       (ident.lower(), ident)).fetchone()
    if not row or not check_password_hash(row["password_hash"], pw):
        return jsonify({"error": "bad_credentials"}), 401
    if row["status"] == "pending":
        return jsonify({"error": "pending"}), 403
    if row["status"] == "suspended":
        return jsonify({"error": "suspended"}), 403
    if row["status"] == "rejected":
        return jsonify({"error": "rejected"}), 403
    session["uid"] = row["id"]
    return jsonify({"ok": True, "role": row["role"]})

@app.route("/api/logout", methods=["POST"])
def api_logout():
    session.clear()
    return jsonify({"ok": True})

# ---------------- admin: users ----------------
@app.route("/api/admin/users")
@admin_required
def api_admin_users():
    rows = db().execute(
        "SELECT u.id,u.name,u.email,u.username,u.role,u.status,u.created_at,"
        "(SELECT COUNT(*) FROM uploads up WHERE up.user_id=u.id) as n_uploads "
        "FROM users u WHERE u.role!='admin' ORDER BY u.created_at DESC").fetchall()
    return jsonify([dict(r) for r in rows])

def _set_status(uid, status):
    con = db()
    con.execute("UPDATE users SET status=? WHERE id=? AND role!='admin'", (status, uid))
    con.commit()

@app.route("/api/admin/users/<int:uid>/<action>", methods=["POST"])
@admin_required
def api_admin_user_action(uid, action):
    mapping = {"approve": "active", "activate": "active",
               "suspend": "suspended", "reject": "rejected"}
    if action in mapping:
        row = db().execute("SELECT email,name,status FROM users WHERE id=?", (uid,)).fetchone()
        _set_status(uid, mapping[action])
        if action == "approve" and row:
            _notify_user_approved(row["email"], row["name"])
        return jsonify({"ok": True})
    if action == "password":
        newpw = request.get_json(force=True).get("password", "")
        if len(newpw) < 4:
            return jsonify({"error": "weak_password"}), 400
        con = db()
        con.execute("UPDATE users SET password_hash=? WHERE id=? AND role!='admin'",
                    (generate_password_hash(newpw), uid))
        con.commit()
        return jsonify({"ok": True})
    return jsonify({"error": "unknown_action"}), 400

@app.route("/api/admin/users/<int:uid>", methods=["DELETE"])
@admin_required
def api_admin_delete_user(uid):
    con = db()
    con.execute("DELETE FROM users WHERE id=? AND role!='admin'", (uid,))
    con.commit()
    return jsonify({"ok": True})

@app.route("/api/admin/users/<int:uid>/uploads")
@admin_required
def api_admin_user_uploads(uid):
    rows = db().execute("SELECT id,orig_name,filetype,n_students,created_at FROM uploads "
                        "WHERE user_id=? ORDER BY created_at DESC", (uid,)).fetchall()
    return jsonify([dict(r) for r in rows])

# ---------------- uploads / parsing ----------------
def _parse_any(path, ext):
    if ext == ".pdf":
        return parser_core.parse_pdf(path)
    return data_io.parse_excel(path)

@app.route("/api/upload", methods=["POST"])
@login_required
def api_upload():
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "no_files"}), 400
    results = []
    con = db()
    now = datetime.datetime.utcnow().isoformat()
    for f in files:
        orig = f.filename or "file"
        ext = os.path.splitext(orig)[1].lower()
        if ext not in ALLOWED:
            results.append({"name": orig, "ok": False, "error": "type_not_allowed"})
            continue
        stored = f"{g.user['id']}_{secrets.token_hex(6)}{ext}"
        path = os.path.join(UPLOAD_DIR, stored)
        f.save(path)
        try:
            parsed = _parse_any(path, ext)
            n = len(parsed.get("students", []))
            cur = con.execute("INSERT INTO uploads(user_id,orig_name,stored_name,filetype,n_students,parsed_json,created_at) "
                              "VALUES(?,?,?,?,?,?,?) RETURNING id",
                              (g.user["id"], orig, stored, ext, n, json.dumps(parsed, ensure_ascii=False), now))
            new_id = cur.fetchone()["id"]
            con.commit()
            results.append({"name": orig, "ok": True, "n_students": n, "id": new_id})
        except Exception as e:
            results.append({"name": orig, "ok": False, "error": str(e)[:200]})
    return jsonify({"results": results})

@app.route("/api/my/uploads")
@login_required
def api_my_uploads():
    rows = db().execute("SELECT id,orig_name,filetype,n_students,created_at FROM uploads "
                        "WHERE user_id=? ORDER BY created_at DESC", (g.user["id"],)).fetchall()
    return jsonify([dict(r) for r in rows])

def _load_upload(uid, upload_id, allow_admin=False):
    q = "SELECT * FROM uploads WHERE id=?"
    row = db().execute(q, (upload_id,)).fetchone()
    if not row:
        return None
    if row["user_id"] != uid and not allow_admin:
        return None
    return row

def _ids_param(raw):
    return [int(x) for x in (raw or "").split(",") if x.strip().lstrip("-").isdigit()]

@app.route("/api/my/data")
@login_required
def api_my_data():
    ids = request.args.get("ids")
    if ids:  # merge a chosen subset of files (multi-select)
        parsed = []
        for iid in _ids_param(ids):
            row = _load_upload(g.user["id"], iid)
            if row:
                parsed.append(json.loads(row["parsed_json"]))
        if not parsed:
            return jsonify({"error": "not_found"}), 404
        return jsonify(_merge(parsed))
    upload_id = request.args.get("upload_id")
    if upload_id:
        row = _load_upload(g.user["id"], int(upload_id))
        if not row:
            return jsonify({"error": "not_found"}), 404
        return jsonify(json.loads(row["parsed_json"]))
    # aggregate all uploads
    rows = db().execute("SELECT parsed_json FROM uploads WHERE user_id=?", (g.user["id"],)).fetchall()
    return jsonify(_merge([json.loads(r["parsed_json"]) for r in rows]))

def _merge(datasets):
    if not datasets:
        return {"meta": {}, "subjects": [], "students": [], "components": []}
    if len(datasets) == 1:
        return datasets[0]
    subjects, students, comps = [], [], []
    seen_s = set()
    for d in datasets:
        for s in d.get("subjects", []):
            if s not in seen_s:
                seen_s.add(s); subjects.append(s)
        students.extend(d.get("students", []))
        for c in d.get("components", []):
            if c not in comps:
                comps.append(c)
    for i, st in enumerate(students, 1):
        st["seq"] = i
    return {"meta": datasets[0].get("meta", {}), "subjects": subjects,
            "students": students, "components": comps}

@app.route("/api/my/uploads/<int:upload_id>", methods=["DELETE"])
@login_required
def api_delete_upload(upload_id):
    row = _load_upload(g.user["id"], upload_id)
    if not row:
        return jsonify({"error": "not_found"}), 404
    try:
        os.remove(os.path.join(UPLOAD_DIR, row["stored_name"]))
    except OSError:
        pass
    con = db()
    con.execute("DELETE FROM uploads WHERE id=?", (upload_id,))
    con.commit()
    return jsonify({"ok": True})

# ---------------- downloads ----------------
def _safe_name(name):
    name = re.sub(r"[\\/:*?\"<>|]+", "_", name).strip() or "results"
    return name

@app.route("/api/download/<kind>")
@login_required
def api_download(kind):
    ids = request.args.get("ids")
    upload_id = request.args.get("upload_id")
    is_admin_view = False
    row = None
    if ids:  # merge a chosen subset of files (multi-select)
        parsed = []
        for iid in _ids_param(ids):
            r = _load_upload(g.user["id"], iid)
            if r:
                parsed.append(json.loads(r["parsed_json"]))
        if not parsed:
            return jsonify({"error": "not_found"}), 404
        data = _merge(parsed)
    elif upload_id:
        row = _load_upload(g.user["id"], int(upload_id))
        if not row and g.user["role"] == "admin":
            row = _load_upload(None, int(upload_id), allow_admin=True); is_admin_view = True
        if not row:
            return jsonify({"error": "not_found"}), 404
        data = json.loads(row["parsed_json"])
    else:
        rows = db().execute("SELECT parsed_json FROM uploads WHERE user_id=?", (g.user["id"],)).fetchall()
        data = _merge([json.loads(r["parsed_json"]) for r in rows])
    display = g.user["name"]
    base = _safe_name(display)
    if kind == "excel":
        out = os.path.join(GEN_DIR, f"{base}_{secrets.token_hex(3)}.xlsx")
        data_io.to_excel(data, out)
        return send_file(out, as_attachment=True, download_name=f"{base}.xlsx")
    if kind == "pdf":
        term = request.args.get("term", "t1")
        comp = request.args.get("component", "total")
        out = os.path.join(GEN_DIR, f"{base}_{secrets.token_hex(3)}.pdf")
        data_io.to_pdf(data, out, display_name=display, term=term, component=comp)
        return send_file(out, as_attachment=True, download_name=f"{base}.pdf")
    if kind == "original" and row:
        p = os.path.join(UPLOAD_DIR, row["stored_name"])
        if os.path.exists(p):
            return send_file(p, as_attachment=True,
                             download_name=f"{base}{row['filetype']}")
    return jsonify({"error": "bad_kind"}), 400

# ---------------- graphical report (PDF / Word) ----------------
@app.route("/api/report", methods=["POST"])
@login_required
def api_report():
    import report as _report
    payload = request.get_json(force=True, silent=True) or {}
    fmt = payload.get("format", "pdf")
    payload["title"] = g.user["name"]
    base = _safe_name(g.user["name"])
    try:
        if fmt == "docx":
            out = os.path.join(GEN_DIR, f"{base}_{secrets.token_hex(3)}.docx")
            _report.build_docx(payload, out)
            return send_file(out, as_attachment=True, download_name=f"تقرير {base}.docx")
        out = os.path.join(GEN_DIR, f"{base}_{secrets.token_hex(3)}.pdf")
        _report.build_pdf(payload, out)
        return send_file(out, as_attachment=True, download_name=f"تقرير {base}.pdf")
    except Exception as e:
        return jsonify({"error": str(e)[:300]}), 500

# ---------------- email (optional) ----------------
def _smtp_conf():
    return {"host": os.environ.get("SMTP_HOST"), "port": int(os.environ.get("SMTP_PORT", "587")),
            "user": os.environ.get("SMTP_USER"), "pw": os.environ.get("SMTP_PASS"),
            "from": os.environ.get("SMTP_FROM", os.environ.get("SMTP_USER", "")),
            "admin": os.environ.get("ADMIN_EMAIL", "")}

def _send_mail(to, subject, body):
    c = _smtp_conf()
    if not (c["host"] and c["user"] and c["pw"] and to):
        return False
    try:
        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = subject; msg["From"] = c["from"]; msg["To"] = to
        with smtplib.SMTP(c["host"], c["port"], timeout=10) as s:
            s.starttls(); s.login(c["user"], c["pw"])
            s.sendmail(c["from"], [to], msg.as_string())
        return True
    except Exception:
        return False

def _notify_admin_new_user(name, email):
    c = _smtp_conf()
    if c["admin"]:
        _send_mail(c["admin"], "طلب تسجيل جديد",
                   f"طلب تسجيل جديد بحاجة لاعتماد:\nالاسم: {name}\nالبريد: {email}")

def _notify_user_approved(email, name):
    _send_mail(email, "تم اعتماد حسابك",
               f"مرحباً {name}،\nتم اعتماد حسابك في منصة تحليل نتائج الطلاب. يمكنك تسجيل الدخول الآن.")

init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
