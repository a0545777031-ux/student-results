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
    (USERS.length? USERS.map((u,i)=>`<tr>
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
  b.push(`<button class="btn sm ghost" onclick="askPw(${u.id})">${t("change_pw")}</button>`);
  b.push(`<button class="btn sm danger" onclick="delUser(${u.id})">${t("delete_user")}</button>`);
  return `<div style="display:flex;gap:6px;flex-wrap:wrap">${b.join("")}</div>`;
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
