// Shared helpers: API calls, auth state, header wiring.
async function api(path, opts={}){
  const o = Object.assign({headers:{}}, opts);
  if(o.body && !(o.body instanceof FormData)){
    o.headers["Content-Type"]="application/json";
    o.body = JSON.stringify(o.body);
  }
  const r = await fetch(path, o);
  let data=null; try{ data = await r.json(); }catch(e){}
  return {ok:r.ok, status:r.status, data};
}
async function getMe(){ const r = await api("/api/me"); return r.data && r.data.user; }
function el(id){ return document.getElementById(id); }
function showMsg(id, text, kind){
  const m = el(id); if(!m) return;
  m.textContent = text; m.className = "msg show " + (kind||"info");
}
function hideMsg(id){ const m=el(id); if(m) m.className="msg"; }

// content: pull site content and fill data-content elements
async function loadSiteContent(){
  const r = await api("/api/content");
  window.SITE_CONTENT = r.data || {};
  applyContent();
  document.addEventListener("langchange", applyContent);
}
function applyContent(){
  const c = window.SITE_CONTENT || {};
  document.querySelectorAll("[data-content]").forEach(elm=>{
    const key = elm.getAttribute("data-content");
    if(c[key]){ elm.textContent = (LANG==="ar"? c[key].ar : c[key].en) || c[key].ar || ""; }
  });
  // announcement
  const ann = document.getElementById("announceBox");
  if(ann && c.announcement){
    const txt = (LANG==="ar"? c.announcement.ar : c.announcement.en) || "";
    if(txt.trim()){ ann.style.display="flex"; ann.querySelector("span").textContent=txt; }
    else ann.style.display="none";
  }
}
async function wireHeader(){
  const tg = el("langToggle"); if(tg) tg.onclick = toggleLang;
  const u = await getMe();
  const navAuth = el("navAuth");
  if(navAuth){
    if(u){
      const panel = u.role==="admin" ? "/admin" : "/dashboard";
      const plabel = u.role==="admin" ? "nav_admin" : "nav_dashboard";
      navAuth.innerHTML = `<a href="${panel}" data-i18n="${plabel}"></a>
        <a href="#" id="logoutBtn" data-i18n="nav_logout"></a>`;
      el("logoutBtn").onclick = async(e)=>{e.preventDefault(); await api("/api/logout",{method:"POST"}); location.href="/";};
    } else {
      navAuth.innerHTML = `<a href="/login" data-i18n="nav_login"></a>
        <a href="/register" data-i18n="nav_register"></a>`;
    }
  }
  applyI18n();
}
async function fillBrandSchool(){
  const sub = el("brandSub"); if(!sub) return;
  try{ const u = await getMe(); sub.textContent = (u && u.role!=="admin") ? (u.name||"") : ""; }
  catch(e){ sub.textContent=""; }
}
document.addEventListener("DOMContentLoaded", ()=>{ applyI18n(); fillBrandSchool(); });
