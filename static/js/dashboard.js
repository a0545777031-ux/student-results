// User dashboard: upload, parsing results, analysis & charts, downloads.
const GREEN="#0e5a4d", GOLD="#b6892b", PALETTE=["#0e5a4d","#b6892b","#2f8f79","#c9a24b",
  "#1b6f9c","#8a5a2b","#4a9d6e","#d08c3a","#5b7fb0","#7a6f3a","#2d7d6a","#a8863c"];
let DATA=null, SELECTED=new Set(), CHARTS={}, FILES=[];
const COMP_LABEL = k => t("field_"+k);

document.addEventListener("DOMContentLoaded", init);
async function init(){
  const u = await getMe();
  if(!u){ location.href="/login"; return; }
  el("uName").textContent = u.name; el("uEmail").textContent = u.email;
  el("langToggle").onclick = toggleLang;
  el("logoutSide").onclick = async e=>{e.preventDefault(); await api("/api/logout",{method:"POST"}); location.href="/";};
  document.querySelectorAll(".navi").forEach(b=> b.onclick=()=>switchSec(b.dataset.sec));
  setupUpload();
  el("sourceSel").onchange = loadData;
  el("termSel").onchange = render;
  el("subjSel").onchange = render;
  el("studentSel").onchange = drawStudent;
  el("dlExcel").onclick = ()=>download("excel");
  el("dlPdf").onclick = ()=>download("pdf");
  document.addEventListener("langchange", ()=>{ if(DATA) render(); buildFieldChips(); });
  let rt; window.addEventListener("resize", ()=>{ clearTimeout(rt); rt=setTimeout(()=>{ if(DATA && !el("sec-analysis").classList.contains("hidden")) render(); }, 250); });
  await refreshFiles();
  applyI18n();
}
function switchSec(sec){
  document.querySelectorAll(".navi").forEach(b=>b.classList.toggle("active",b.dataset.sec===sec));
  ["upload","analysis","files"].forEach(s=> el("sec-"+s).classList.toggle("hidden", s!==sec));
  if(sec==="analysis") loadData();
  if(sec==="files") refreshFiles();
}
function setupUpload(){
  const drop=el("drop"), input=el("fileInput");
  el("pickBtn").onclick=()=>input.click();
  drop.onclick=e=>{ if(e.target===drop||e.target.tagName==="P"||e.target.classList.contains("ic")) input.click(); };
  ["dragover","dragenter"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add("drag");}));
  ["dragleave","drop"].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove("drag");}));
  drop.addEventListener("drop",e=>{ addFiles(e.dataTransfer.files); });
  input.onchange=()=>addFiles(input.files);
  el("uploadBtn").onclick=doUpload;
}
let PENDING=[];
function addFiles(list){ for(const f of list) PENDING.push(f); renderPending(); }
function renderPending(){
  const wrap=el("fileList"); wrap.innerHTML="";
  PENDING.forEach((f,i)=>{
    const d=document.createElement("div"); d.className="fileitem";
    d.innerHTML=`<span>📄 ${f.name} <small style="color:#999">(${(f.size/1024).toFixed(0)} KB)</small></span>
      <button class="btn sm danger" data-i="${i}">✕</button>`;
    d.querySelector("button").onclick=()=>{PENDING.splice(i,1);renderPending();};
    wrap.appendChild(d);
  });
  el("uploadBtn").disabled = PENDING.length===0;
}
async function doUpload(){
  if(!PENDING.length) return;
  const btn=el("uploadBtn"); btn.disabled=true;
  btn.innerHTML=`<span class="spin"></span> ${t("uploading")}`;
  const fd=new FormData(); PENDING.forEach(f=>fd.append("files",f));
  const r=await api("/api/upload",{method:"POST",body:fd});
  btn.innerHTML=`<span data-i18n="upload_btn">${t("upload_btn")}</span>`;
  if(r.ok){
    const wrap=el("fileList");
    r.data.results.forEach(res=>{
      const d=document.createElement("div"); d.className="fileitem";
      d.innerHTML= res.ok
        ? `<span>✅ ${res.name}</span><span class="badge ok">${res.n_students} ${t("students")}</span>`
        : `<span>⚠️ ${res.name}</span><span class="badge err">${res.error||"خطأ"}</span>`;
      wrap.appendChild(d);
    });
    PENDING=[]; el("uploadBtn").disabled=true;
    showMsg("upMsg", LANG==="ar"?"تمت المعالجة. انتقل إلى التحليل والرسوم.":"Done. Go to Analysis.","ok");
    await refreshFiles();
  } else { showMsg("upMsg", LANG==="ar"?"فشل الرفع":"Upload failed","err"); }
  el("uploadBtn").disabled = PENDING.length===0;
}
async function refreshFiles(){
  const r=await api("/api/my/uploads"); FILES=r.data||[];
  const sel=el("sourceSel"); sel.innerHTML=`<option value="">${t("all_files")}</option>`+
    FILES.map(f=>`<option value="${f.id}">${f.orig_name} (${f.n_students})</option>`).join("");
  const tb=el("filesTable");
  tb.innerHTML=`<tr><th>#</th><th>${t("files")}</th><th>${t("students")}</th><th>${t("created")}</th><th>${t("actions")}</th></tr>`+
    (FILES.length?FILES.map((f,i)=>`<tr>
      <td>${i+1}</td><td>📄 ${f.orig_name}</td><td>${f.n_students}</td>
      <td>${(f.created_at||"").slice(0,10)}</td>
      <td><button class="btn sm danger" onclick="delFile(${f.id})">${t("delete")}</button>
      <a class="btn sm ghost" href="/api/download/original?upload_id=${f.id}">${t("dl_original")}</a></td>
    </tr>`).join(""):`<tr><td colspan="5" style="text-align:center;color:#999">${t("no_data")}</td></tr>`);
}
async function delFile(id){
  if(!confirm(t("confirm_delete"))) return;
  await api("/api/my/uploads/"+id,{method:"DELETE"});
  await refreshFiles(); if(DATA) loadData();
}
async function loadData(){
  const src=el("sourceSel").value;
  const r=await api("/api/my/data"+(src?("?upload_id="+src):""));
  DATA=r.data;
  const has = DATA && DATA.students && DATA.students.length;
  el("noData").classList.toggle("hidden", !!has);
  el("analysisBody").classList.toggle("hidden", !has);
  if(!has) return;
  const ss=el("subjSel"); ss.innerHTML=`<option value="">${t("all_subjects")}</option>`+
    DATA.subjects.map(s=>`<option value="${s}">${s}</option>`).join("");
  SELECTED = new Set((DATA.components||[]).filter(c=>c.component==="total").map(c=>c.key));
  if(!SELECTED.size && DATA.components && DATA.components.length) SELECTED.add(DATA.components[0].key);
  const stu=el("studentSel");
  stu.innerHTML=DATA.students.map((s,i)=>`<option value="${i}">${s.name}</option>`).join("");
  buildFieldChips();
  render();
}
function buildFieldChips(){
  if(!DATA) return;
  const wrap=el("fieldChips"); wrap.innerHTML="";
  (DATA.components||[]).forEach(c=>{
    const on=SELECTED.has(c.key);
    const div=document.createElement("label");
    div.className="chip"+(on?" on":"");
    const termTxt = c.term==="t1"? t("term1"):t("term2");
    div.innerHTML=`<input type="checkbox" ${on?"checked":""}> ${COMP_LABEL(c.component)} · ${termTxt}`;
    div.querySelector("input").onchange=e=>{
      if(e.target.checked) SELECTED.add(c.key); else SELECTED.delete(c.key);
      div.classList.toggle("on",e.target.checked); render();
    };
    wrap.appendChild(div);
  });
}
function getVal(st, subj, compKey, term){
  const c = st.grades[subj]; if(!c) return null;
  const v = c[compKey] && c[compKey][term];
  return (typeof v==="number")? v : null;
}
function selectedComps(term){ return [...SELECTED].map(k=>k.split(":")).filter(([c,tm])=>tm===term).map(([c])=>c); }
function primaryComp(term){ const cs=selectedComps(term); if(cs.includes("total")) return "total"; return cs[0]||"total"; }
function render(){
  if(!DATA) return;
  const term=el("termSel").value;
  drawKPI(term); drawSubjectAvg(term); drawDistribution(term);
  drawTop(term); drawStudent(); drawCompare(term); drawTable(term);
}
function destroy(id){ if(CHARTS[id]){CHARTS[id].destroy(); delete CHARTS[id];} }
function mk(id,cfg){ destroy(id); const c=el(id); if(!c) return; CHARTS[id]=new Chart(c,cfg); }
function drawKPI(term){
  const pc=primaryComp(term);
  let vals=[];
  DATA.students.forEach(s=>DATA.subjects.forEach(su=>{const v=getVal(s,su,pc,term); if(v!=null)vals.push(v);}));
  const avg = vals.length? (vals.reduce((a,b)=>a+b,0)/vals.length):0;
  el("kpi").innerHTML=`
   <div class="kpi-card kpi-a"><div class="kpi-ic">👥</div><div><div class="num">${DATA.students.length}</div><div class="lbl">${t("students")}</div></div></div>
   <div class="kpi-card kpi-b"><div class="kpi-ic">📚</div><div><div class="num">${DATA.subjects.length}</div><div class="lbl">${t("subjects")}</div></div></div>
   <div class="kpi-card
