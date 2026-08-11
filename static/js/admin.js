// Admin dashboard: manage users (approve/suspend/reject/password/reports/delete) + site content CMS.
let USERS=[], CONTENT={}, PW_TARGET=null;
const CONTENT_FIELDS=[
  ["site_title","عنوان الموقع / Site title"],
  ["hero_title","العنوان الرئيسي / Hero title"],
  ["hero_subtitle","الوصف الرئيسي / Hero subtitle"],
  ["about","نبذة عن المنصة / About"],
  ["announcement","إعلان (اختياري) / Announcement"],
  ["footer","تذييل الصفحة / Footer"],
];

document.addEventListener("DOMContentLoaded", init);
async function init(){
  const u=await getMe();
  if(!u || u.role!=="admin"){ location.href="/login"; return; }
  el("adminName").textContent=u.name;
  el("langToggle").onclick=toggleLang;
  el("logoutSide").onclick=async e=>{e.preventDefault();await api("/api/logout",{method:"POST"});location.href="/";};
  document.querySelectorAll(".navi").forEach(b=>b.onclick=()=>switchSec(b.dataset.sec));
  el("pwCancel").onclick=()=>el("pwModal").classList.remove("show");
  el("pwSave").onclick=savePw;
  el("repClose").onclick=()=>el("repModal").classList.remove("show");
  el("saveContent").onclick=saveContent;
  el("newUserBtn").onclick=openNewUser;
  el("nuCancel").onclick=()=>el("newUserModal").classList.remove("show");
  el("nuSave").onclick=createUser;
  el("trCancel").onclick=()=>el("trModal").classList.remove("show");
  el("trSave").onclick=doTransfer;
  document.addEventListener("langchange",()=>{renderUsers();});
  await loadUsers(); await loadContent();
  applyI18n();
}
function switchSec(sec){
  document.querySelectorAll(".navi").forEach(b=>b.classList.toggle("active",b.dataset.sec===sec));
  ["users","content"].forEach(s=>el("sec-"+s).classList.toggle("hidden",s!==sec));
}

/* ------- users ------- */
async function loadUsers(){
  const r=await api("/api/admin/users"); USERS=r.data||[]; renderUsers();
}
function renderUsers(){
  const tb=el("usersTable");
  el("cntPending").textContent=USERS.filter(u=>u.status==="pending").length;
  el("cntActive").textContent=USERS.filter(u=>u.status==="active").length;
  tb.innerHTML=`<tr><th>#</th><th>${t("name")}</th><th>${t("email")}</th>
    <th>${t("status")}</th><th>${t("uploads_count")}</th><th>${t("created")}</th><th>${t("actions")}</th></tr>`+
    (USERS.length? USERS.map((u,i)=>`<tr id="urow-${u.id}">
      <td>${i+1}</td><td>${u.name}</td><td>${u.email||""}</td>
      <td><span class="badge ${u.status}">${t(u.status)}</span></td>
      <td>${u.n_uploads}</td><td>${(u.created_at||"").slice(0,10)}</td>
      <td>${actions(u)}</td></tr>`).join("")
      : `<tr><td colspan="7" style="text-align:center;color:#999">—</td></tr>`);
}
function actions(u){
  let b=[];
  if(u.status==="pending"){ b.push(btn("approve",u.id,"gold")); b.push(btn("reject",u.id,"danger")); }
  if(u.status==="active"){ b.push(btn("suspend",u.id,"danger")); }
  if(u.status==="suspended"||u.status==="rejected"){ b.push(btn("activate",u.id,"gold")); }
  b.push(`<button class="btn sm ghost" onclick="reports(${u.id})">${t("view_reports")}</button>`);
  b.push(`<button class="btn sm ghost" onclick="toggleLogins(${u.id})">🕘 ${t("recent_logins")}</button>`);
  b.push(`<button class="btn sm ghost" onclick="askPw(${u.id})">${t("change_pw")}</button>`);
  b.push(`<button class="btn sm" onclick="askTransfer(${u.id})">🔀 ${t("transfer")}</button>`);
  b.push(`<button class="btn sm danger" onclick="delUser(${u.id})">${t("delete_user")}</button>`);
  return `<div style="display:flex;gap:6px;flex-wrap:wrap">${b.join("")}</div>`;
}
/* ------- recent logins (last 30 days) shown under a user ------- */
function fmtDT(ts){
  // stored timestamps are naive UTC; append Z so they convert to local date/time
  const iso=/[zZ]|[+\-]\d\d:?\d\d$/.test(ts)? ts : ts+"Z";
  const d=new Date(iso); if(isNaN(d)) return ts;
  const p=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}  ${p(d.getHours())}:${p(d.getMinutes())}`;
}
async function toggleLogins(id){
  const open=el("lrow-"+id);
  if(open){ open.remove(); return; }
  const r=await api(`/api/admin/users/${id}/logins`);
  const list=r.data||[];
  const row=el("urow-"+id); if(!row) return;
  const tr=document.createElement("tr"); tr.id="lrow-"+id; tr.className="logins-row";
  tr.innerHTML=`<td colspan="7"><div class="logins-box">
    <b>${t("recent_logins")} — ${t("last_30_days")} (${list.length}):</b>`+
    (list.length? `<ol class="logins-list">${list.map(ts=>`<li>${fmtDT(ts)}</li>`).join("")}</ol>`
      : `<div style="color:#999;margin-top:6px">${t("no_logins")}</div>`)+
    `</div></td>`;
  row.after(tr);
}
/* ------- manual user creation ------- */
function openNewUser(){
  el("nuName").value=""; el("nuEmail").value=""; el("nuPw").value="";
  showMsg("nuMsg","",""); el("newUserModal").classList.add("show");
}
async function createUser(){
  const name=el("nuName").value.trim(), email=el("nuEmail").value.trim(), pw=el("nuPw").value;
  if(!name||!email||pw.length<4){ showMsg("nuMsg", t("bad_cred"), "err"); return; }
  const r=await api("/api/admin/users/create",{method:"POST",body:{name,email,password:pw}});
  if(r.ok){ el("newUserModal").classList.remove("show"); showMsg("uMsg",t("create_ok"),"ok"); await loadUsers(); }
  else showMsg("nuMsg", r.data&&r.data.error==="email_exists"? t("email_exists_msg") : t("bad_cred"), "err");
}
/* ------- transfer a user's files & results to another user ------- */
let TR_SRC=null;
function askTransfer(id){
  TR_SRC=id;
  const src=USERS.find(u=>u.id===id);
  el("trFrom").textContent=(src? `${src.name} — ${src.n_uploads} ${t("files")}` : "");
  const others=USERS.filter(u=>u.id!==id);
  el("trTarget").innerHTML=others.map(u=>`<option value="${u.id}">${u.name}${u.email?(" ("+u.email+")"):""}</option>`).join("");
  showMsg("trMsg","",""); el("trModal").classList.add("show");
}
async function doTransfer(){
  const target=el("trTarget").value;
  if(!target){ showMsg("trMsg", t("no_data"), "err"); return; }
  const r=await api(`/api/admin/users/${TR_SRC}/transfer`,{method:"POST",body:{target:+target}});
  if(r.ok){ el("trModal").classList.remove("show"); showMsg("uMsg",t("moved_ok"),"ok"); await loadUsers(); }
  else showMsg("trMsg", t("bad_cred"), "err");
}
function btn(action,id,cls){ return `<button class="btn sm ${cls}" onclick="act('${action}',${id})">${t(action)}</button>`; }
async function act(action,id){
  await api(`/api/admin/users/${id}/${action}`,{method:"POST"});
  showMsg("uMsg", t("saved"),"ok"); await loadUsers();
}
async function delUser(id){
  if(!confirm(t("confirm_delete"))) return;
  await api("/api/admin/users/"+id,{method:"DELETE"}); await loadUsers();
}
function askPw(id){ PW_TARGET=id; el("pwInput").value=""; el("pwModal").classList.add("show"); }
async function savePw(){
  const pw=el("pwInput").value;
  if(pw.length<4){ el("pwInput").focus(); return; }
  await api(`/api/admin/users/${PW_TARGET}/password`,{method:"POST",body:{password:pw}});
  el("pwModal").classList.remove("show"); showMsg("uMsg",t("saved"),"ok");
}
async function reports(id){
  const r=await api(`/api/admin/users/${id}/uploads`);
  const rows=r.data||[]; const tb=el("repTable");
  tb.innerHTML=`<tr><th>#</th><th>${t("files")}</th><th>${t("students")}</th><th>${t("created")}</th><th></th></tr>`+
    (rows.length? rows.map((f,i)=>`<tr><td>${i+1}</td><td>📄 ${f.orig_name}</td>
      <td>${f.n_students}</td><td>${(f.created_at||"").slice(0,10)}</td>
      <td><a class="btn sm ghost" href="/api/download/excel?upload_id=${f.id}">Excel</a>
          <a class="btn sm ghost" href="/api/download/original?upload_id=${f.id}">${t("dl_original")}</a></td></tr>`).join("")
      : `<tr><td colspan="5" style="text-align:center;color:#999">${t("no_data")}</td></tr>`);
  el("repModal").classList.add("show");
}

/* ------- content CMS ------- */
async function loadContent(){
  const r=await api("/api/content"); CONTENT=r.data||{};
  const wrap=el("contentForm"); wrap.innerHTML="";
  CONTENT_FIELDS.forEach(([key,label])=>{
    const c=CONTENT[key]||{ar:"",en:""};
    const multi = ["about","hero_subtitle","announcement"].includes(key);
    const field=document.createElement("div"); field.className="card"; field.style.marginBottom="14px";
    field.innerHTML=`<label style="margin-top:0">${label}</label>
      <div class="row">
        <div><small style="color:#999">العربية</small>
          ${multi?`<textarea rows="2" id="c_${key}_ar"></textarea>`:`<input id="c_${key}_ar">`}</div>
        <div><small style="color:#999">English</small>
          ${multi?`<textarea rows="2" id="c_${key}_en"></textarea>`:`<input id="c_${key}_en">`}</div>
      </div>`;
    wrap.appendChild(field);
    el(`c_${key}_ar`).value=c.ar||""; el(`c_${key}_en`).value=c.en||"";
  });
}
async function saveContent(){
  const payload={};
  CONTENT_FIELDS.forEach(([key])=>{ payload[key]={ar:el(`c_${key}_ar`).value, en:el(`c_${key}_en`).value}; });
  const r=await api("/api/admin/content",{method:"POST",body:payload});
  if(r.ok) showMsg("cMsg",t("saved"),"ok");
}
