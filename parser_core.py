# -*- coding: utf-8 -*-
"""
قارئ نتائج الطلاب من ملفات PDF (نموذج دفتر رصد الدرجات) و Excel
Student results parser for the Saudi "grade record" PDF layout and Excel files.
"""
import re, io, json, unicodedata
import pdfplumber
from pypdf import PdfReader
from fontTools.ttLib import TTFont

AR_RANGE = r'؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿'

# ---------- CID / glyph recovery ----------
def build_gid_map(path):
    """Extract embedded CID fonts (pure-python via pypdf) and build a
    glyph-id -> unicode map from each font's cmap table."""
    reader = PdfReader(path)
    gid2uni = {}
    done = set()
    for page in reader.pages:
        res = page.get("/Resources")
        if res is None:
            continue
        res = res.get_object()
        fonts = res.get("/Font")
        if fonts is None:
            continue
        fonts = fonts.get_object()
        for name in list(fonts.keys()):
            f = fonts[name].get_object()
            desc = f.get("/DescendantFonts")
            if not desc:
                continue
            base = str(f.get("/BaseFont"))
            if base in done:
                continue
            df = desc.get_object()[0].get_object()
            fdsc = df.get("/FontDescriptor")
            if not fdsc:
                continue
            fdsc = fdsc.get_object()
            ff = None
            for key in ("/FontFile2", "/FontFile3", "/FontFile"):
                if key in fdsc:
                    ff = fdsc[key].get_object(); break
            if ff is None:
                continue
            done.add(base)
            try:
                data = ff.get_data()
                tt = TTFont(io.BytesIO(data))
                cmap = tt.getBestCmap()
                order = tt.getGlyphOrder()
                name2gid = {n: i for i, n in enumerate(order)}
                for uni, gname in cmap.items():
                    gid = name2gid.get(gname)
                    if gid is not None:
                        gid2uni[str(gid)] = chr(uni)
            except Exception:
                continue
    return gid2uni

# ---------- direction / normalization ----------
def _reverse_logical(text):
    lines = text.split("\n")
    out_lines = []
    for line in lines:
        runs = re.findall(r'[%s]+|[^%s]+' % (AR_RANGE, AR_RANGE), line)
        runs = list(reversed(runs))
        rebuilt = []
        for r in runs:
            if re.search(r'[%s]' % AR_RANGE, r):
                rebuilt.append(r[::-1])
            else:
                rebuilt.append(r)
        out_lines.append("".join(rebuilt))
    return "\n".join(out_lines)

def decode_cell(t, gid2uni):
    if not t:
        return ""
    t = re.sub(r'\(cid:(\d+)\)', lambda m: gid2uni.get(m.group(1), ""), t)
    t = _reverse_logical(t)
    t = unicodedata.normalize('NFKC', t)
    return re.sub(r'[ \t]+', ' ', t).strip()

def clean_name(raw):
    s = raw.replace("\n", " ")
    s = re.sub(r'.*?(?:الاسم|الأسم)\s*[:：]?\s*', '', s)
    s = re.sub(r'رقم\s*الهوية.*', '', s)
    s = re.sub(r'\d+', '', s)
    s = re.sub(r'[:：]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

# ---------- subject header detection ----------
KNOWN_SUBJECT_HINTS = ["النتيجة","المواظبة","السلوك","المهارات","اللغة","النشاط",
    "القرآن","العلوم","الرياضيات","الدراسات","التفكير","التربية","القران"]

COMPONENT_MAP = [
    ("اختبارات قصيرة", "short_tests"),
    ("ادوات تقييم", "assessment"),
    ("أدوات تقييم", "assessment"),
    ("نهاية فصل", "final_exam"),
    ("نهاية الفصل", "final_exam"),
    ("مجموع", "total"),
]

def classify_component(label):
    for ar, key in COMPONENT_MAP:
        if ar in label:
            term = "t2" if ("ف2" in label or "2ف" in label) else "t1"
            return key, term, ar
    return None, None, None

# ---------- main PDF parse ----------
def parse_pdf(path):
    gid2uni = build_gid_map(path)
    pl = pdfplumber.open(path)

    meta = {"school": "", "grade_class": "", "year": "", "title": ""}
    try:
        t0 = decode_cell(pl.pages[0].extract_text() or "", gid2uni)
        for ln in t0.split("\n"):
            if "متوسطة" in ln or "مدرسة" in ln or "ثانوية" in ln or "ابتدائية" in ln:
                meta["school"] = meta["school"] or ln
            if "الصف" in ln:
                meta["grade_class"] = meta["grade_class"] or ln
            if "العام" in ln or "الدراسي" in ln:
                m = re.search(r'(1[34]\d{2}|20\d{2})\s*[-–−­­]\s*(1[34]\d{2}|20\d{2})', ln)
                if m:
                    a, b = int(m.group(1)), int(m.group(2))
                    meta["year"] = f"{min(a,b)}-{max(a,b)}"
    except Exception:
        pass

    subjects = []
    students = []
    cur = None

    for pg in pl.pages:
        for tb in pg.extract_tables():
            if not tb:
                continue
            dec = [[decode_cell(c, gid2uni) for c in row] for row in tb]
            for row in dec:
                joined = " ".join(row)
                if sum(h in joined for h in KNOWN_SUBJECT_HINTS) >= 4:
                    hdr = row
                    cand = []
                    for ci, c in enumerate(hdr):
                        cc = re.sub(r'\s+', ' ', c.replace("\n", " ")).strip()
                        if cc and re.search(r'[%s]' % AR_RANGE, cc):
                            cand.append((ci, cc))
                    if cand and not subjects:
                        subjects = cand
                    break
            for row in dec:
                last = row[-1] if row else ""
                if "الاسم" in last or "الهوية" in last or "رقم الهو" in last:
                    mid = re.search(r'(\d{6,})', last)
                    sid = mid.group(1) if mid else ""
                    name = clean_name(last)
                    cur = {"name": name or f"طالب {len(students)+1}", "id": sid,
                           "seq": len(students)+1, "grades": {}}
                    students.append(cur)
                label = row[-2] if len(row) >= 2 else ""
                key, term, ar = classify_component(label)
                if key and cur and subjects:
                    for (ci, sname) in subjects:
                        if ci < len(row):
                            val = row[ci].replace("\n", " ").strip()
                            m = re.search(r'-?\d+(?:\.\d+)?', val)
                            if m:
                                v = float(m.group(0))
                                if -1 <= v <= 500:
                                    cur["grades"].setdefault(sname, {}).setdefault(key, {})[term] = v
    subj_names = [s[1] for s in subjects]
    meta["grade_class"] = re.sub(r'[)(]', '', meta["grade_class"]).strip()
    return {"meta": meta, "subjects": subj_names, "students": students,
            "components": _present_components(students)}

def _present_components(students):
    present = {}
    for st in students:
        for subj, comps in st["grades"].items():
            for ck, terms in comps.items():
                for term in terms:
                    present[f"{ck}:{term}"] = True
    order = ["short_tests","assessment","final_exam","total"]
    labels = {"short_tests":"اختبارات قصيرة","assessment":"أدوات تقييم",
              "final_exam":"نهاية الفصل","total":"المجموع"}
    out=[]
    for term in ("t1","t2"):
        for ck in order:
            k=f"{ck}:{term}"
            if present.get(k):
                out.append({"key":k,"component":ck,"term":term,
                    "label":f"{labels[ck]} - {'الفصل الأول' if term=='t1' else 'الفصل الثاني'}"})
    return out
