// User dashboard: upload, parsing results, analysis & charts, downloads.
const GREEN="#0e5a4d", GOLD="#b6892b", PALETTE=["#0e5a4d","#b6892b","#2f8f79","#c9a24b",
  "#1b6f9c","#8a5a2b","#4a9d6e","#d08c3a","#5b7fb0","#7a6f3a","#2d7d6a","#a8863c"];
let DATA=null, SELECTED=new Set(), CHARTS={}, FILES=[], SRC=new Set();
const COMP_LABEL = k => t("field_"+k);

document.addEventListener("DOMContentLoaded", init);
async function init(){
  const u = await getMe();
  if(!u){ location.href="/login"; return; }
  window.UNAME = u.name;
  el("uName").textContent = u.name; el("uEmail").textContent = u.email;
  el("langToggle").onclick = toggleLang;
  el("logoutSide").onclick = async e=>{e.preventDefault(); await api("/api/logout",{method:"POST"}); location.href="/";};
  document.querySelectorAll(".navi").forEach(b=> b.onclick=()=>switchSec(b.dataset.sec));
  setupUpload();
  el("sourceBtn").onclick = e=>{ e.stopPropagation(); el("sourcePanel").classList.toggle("hidden"); };
  document.addEventListener("click", e=>{ const ms=el("sourceMS"); if(ms && !ms.contains(e.target)) el("sourcePanel").classList.add("hidden"); });
  el("termSel").onchange = render;
  el("subjSel").onchange = render;
  el("studentSel").onchange = drawStudent;
  el("dlExcel").onclick = ()=>download("excel");
  el("repPdf").onclick = ()=>exportReport("pdf");
  el("repWord").onclick = ()=>exportReport("docx");
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

/* ---------- upload ---------- */
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
function addFiles(list){
  for(const f of list) PENDING.push(f);
  renderPending();
}
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
  } else {
    showMsg("upMsg", LANG==="ar"?"فشل الرفع":"Upload failed","err");
  }
  el("uploadBtn").disabled = PENDING.length===0;
}

/* ---------- files ---------- */
async function refreshFiles(){
  const r=await api("/api/my/uploads"); FILES=r.data||[];
  buildSource();
  // files table
  const tb=el("filesTable");
  tb.innerHTML=`<tr><th>#</th><th>${t("files")}</th><th>${t("students")}</th><th>${t("created")}</th><th>${t("actions")}</th></tr>`+
    (FILES.length?FILES.map((f,i)=>`<tr>
      <td>${i+1}</td><td>📄 ${f.orig_name}</td><td>${f.n_students}</td>
      <td>${(f.created_at||"").slice(0,10)}</td>
      <td><button class="btn sm danger" onclick="delFile(${f.id})">${t("delete")}</button>
      <a class="btn sm ghost" href="/api/download/original?upload_id=${f.id}">${t("dl_original")}</a></td>
    </tr>`).join(""):`<tr><td colspan="5" style="text-align:center;color:#999">${t("no_data")}</td></tr>`);
}
/* ---------- data-source multi-select ---------- */
function srcLabel(){
  const n=SRC.size;
  if(n===0) return t("all_files");
  if(n===1){ const f=FILES.find(x=>x.id===[...SRC][0]); return f? f.orig_name : "1"; }
  return `${n} ${t("files")}`;
}
function buildSource(){
  const panel=el("sourcePanel"); if(!panel) return;
  const ids=new Set(FILES.map(f=>f.id));
  SRC=new Set([...SRC].filter(i=>ids.has(i)));  // drop deleted files
  const allOn = SRC.size===0;
  let html=`<label class="ms-opt ms-all"><input type="checkbox" data-all="1" ${allOn?"checked":""}> <b>${t("all_files")}</b></label>`;
  html+=FILES.map(f=>`<label class="ms-opt"><input type="checkbox" value="${f.id}" ${SRC.has(f.id)?"checked":""}> <span>${f.orig_name}</span> <small>(${f.n_students})</small></label>`).join("");
  panel.innerHTML=html;
  panel.querySelectorAll("input").forEach(inp=>{
    inp.onchange=()=>{
      if(inp.dataset.all){ SRC.clear(); }
      else { const id=+inp.value; if(inp.checked) SRC.add(id); else SRC.delete(id); }
      buildSource();
      loadData();
    };
  });
  const lbl=el("sourceLbl"); if(lbl) lbl.textContent=srcLabel();
}
async function delFile(id){
  if(!confirm(t("confirm_delete"))) return;
  await api("/api/my/uploads/"+id,{method:"DELETE"});
  await refreshFiles(); if(DATA) loadData();
}

/* ---------- analysis ---------- */
async function loadData(){
  const r=await api("/api/my/data"+(SRC.size?("?ids="+[...SRC].join(",")):""));
  DATA=r.data;
  const has = DATA && DATA.students && DATA.students.length;
  el("noData").classList.toggle("hidden", !!has);
  el("analysisBody").classList.toggle("hidden", !has);
  if(!has) return;
  // subject selector
  const ss=el("subjSel"); ss.innerHTML=`<option value="">${t("all_subjects")}</option>`+
    DATA.subjects.map(s=>`<option value="${s}">${s}</option>`).join("");
  // default selected fields = totals present
  SELECTED = new Set((DATA.components||[]).filter(c=>c.component==="total").map(c=>c.key));
  if(!SELECTED.size && DATA.components && DATA.components.length) SELECTED.add(DATA.components[0].key);
  // student selector
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
function selectedComps(term){ // components chosen for this term
  return [...SELECTED].map(k=>k.split(":")).filter(([c,tm])=>tm===term).map(([c])=>c);
}
function primaryComp(term){
  const cs=selectedComps(term); if(cs.includes("total")) return "total"; return cs[0]||"total";
}
function render(){
  if(!DATA) return;
  const term=el("termSel").value;
  drawKPI(term);
  drawRatings(term);
  drawSubjectAvg(term);
  drawDistribution(term);
  drawTop(term);
  drawStudent();
  drawCompare(term);
  drawTable(term);
}
/* ---------- ratings / classification ---------- */
function levelOf(score){ if(score>=90)return"excellent"; if(score>=80)return"vgood"; if(score>=70)return"good"; if(score>=60)return"pass"; return"weak"; }
function classify(term){
  const out={excellent:[],vgood:[],good:[],pass:[],weak:[]};
  DATA.students.forEach(s=>{ out[levelOf(studentScore(s,term))].push(s.name); });
  return out;
}
const RATE=[["excellent","#1e7d4f","#1e7d4f14"],["vgood","#2f8f79","#2f8f7914"],
  ["good","#b6892b","#b6892b1c"],["pass","#d08c3a","#d08c3a1c"],["weak","#b02a37","#b02a3714"]];
function drawRatings(term){
  const cls=classify(term); const wrap=el("ratings"); wrap.innerHTML="";
  RATE.forEach(([key,c,cl])=>{
    const names=cls[key];
    const tile=document.createElement("div"); tile.className="rating-tile";
    tile.style.setProperty("--rc",c); tile.style.setProperty("--rcl",cl);
    tile.innerHTML=`<div class="rc-num">${names.length}</div><div class="rc-lbl">${t(key)}</div>`;
    tile.onclick=()=>showNames(key,c,names,tile);
    wrap.appendChild(tile);
  });
  el("ratingNames").className="rating-names";
}
function showNames(key,c,names,tile){
  document.querySelectorAll(".rating-tile").forEach(x=>x.classList.remove("on"));
  tile.classList.add("on");
  const box=el("ratingNames"); box.style.setProperty("--rc",c);
  const tags = names.length? names.map(n=>`<span class="tag">${n}</span>`).join("") : `<span style="color:#999">${t("no_one")}</span>`;
  box.innerHTML=`<b>${t(key)} (${names.length} ${t("students_word")}):</b><br>${tags}`;
  box.classList.add("show");
}
/* ---------- graphical report export ---------- */
async function exportReport(fmt){
  if(!DATA) return;
  const term=el("termSel").value;
  const btn=el(fmt==="pdf"?"repPdf":"repWord"); const old=btn.innerHTML;
  btn.disabled=true; btn.innerHTML=`<span class="spin"></span> ${t("generating")}`;
  try{
    const charts=[["chSubjAvg","chart_subject_avg"],["chDist","chart_dist"],
      ["chCompare","chart_perSubject"],["chTop","chart_top"],["chStudent","chart_student"]];
    const images=charts.map(([id,lbl])=>{ const cv=el(id);
      return cv? {title:t(lbl), data:cv.toDataURL("image/png")} : null; }).filter(Boolean);
    const payload={format:fmt, meta:DATA.meta||{}, classification:classify(term), images};
    const r=await fetch("/api/report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    if(!r.ok) throw new Error("server");
    const blob=await r.blob(); const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url;
    a.download=`تقرير ${window.UNAME||"النتائج"}.${fmt==="pdf"?"pdf":"docx"}`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }catch(e){ alert(LANG==="ar"?"تعذّر إنشاء التقرير":"Failed to generate report"); }
  btn.disabled=false; btn.innerHTML=old;
}
function destroy(id){ if(CHARTS[id]){CHARTS[id].destroy(); delete CHARTS[id];} }
function mk(id,cfg){ destroy(id); const c=el(id); if(!c) return; CHARTS[id]=new Chart(c,cfg); }

function drawKPI(term){
  const pc=primaryComp(term);
  let vals=[];
  DATA.students.forEach(s=>DATA.subjects.forEach(su=>{const v=getVal(s,su,pc,term); if(v!=null)vals.push(v);}));
  const avg = vals.length? (vals.reduce((a,b)=>a+b,0)/vals.length):0;
  const kc=(cls,ic,num,lbl)=>`<div class="kpi-card ${cls}"><div class="kpi-ic">${ic}</div><div><div class="num">${num}</div><div class="lbl">${lbl}</div></div></div>`;
  el("kpi").innerHTML = kc("kpi-a","👥",DATA.students.length,t("students"))+kc("kpi-b","📚",DATA.subjects.length,t("subjects"))+kc("kpi-c","🗂️",SRC.size||FILES.length||1,t("files"))+kc("kpi-d","📊",avg.toFixed(1),t("avg"));
}
function drawSubjectAvg(term){
  const comps=selectedComps(term); if(!comps.length) comps.push("total");
  const labels=DATA.subjects;
  const datasets=comps.map((cp,i)=>({
    label:COMP_LABEL(cp),
    data:labels.map(su=>{
      const vs=DATA.students.map(s=>getVal(s,su,cp,term)).filter(v=>v!=null);
      return vs.length? +(vs.reduce((a,b)=>a+b,0)/vs.length).toFixed(2):0;
    }),
    backgroundColor:PALETTE[i%PALETTE.length], borderRadius:6
  }));
  mk("chSubjAvg",{type:"bar",data:{labels,datasets},
    options:{responsive:true,plugins:{legend:{position:"bottom"}},
      scales:{x:{ticks:{font:{size:10}}}}}});
}
function studentScore(s,term){ // normalized 0..100 across subjects for primary comp
  const pc=primaryComp(term); let ps=[];
  DATA.subjects.forEach(su=>{
    const v=getVal(s,su,pc,term); if(v==null) return;
    let mx=0; DATA.students.forEach(o=>{const ov=getVal(o,su,pc,term); if(ov!=null&&ov>mx)mx=ov;});
    if(mx>0) ps.push(v/mx*100);
  });
  return ps.length? ps.reduce((a,b)=>a+b,0)/ps.length : 0;
}
function drawDistribution(term){
  const cls=classify(term);
  const buckets=[cls.excellent.length,cls.vgood.length,cls.good.length,cls.pass.length,cls.weak.length];
  mk("chDist",{type:"doughnut",data:{
    labels:[t("excellent"),t("vgood"),t("good"),t("pass"),t("weak")],
    datasets:[{data:buckets,backgroundColor:["#1e7d4f","#2f8f79","#b6892b","#d08c3a","#b02a37"]}]},
    options:{responsive:true,plugins:{legend:{position:"bottom"}}}});
}
function drawTop(term){
  const pc=primaryComp(term);
  const subj=el("subjSel").value;
  const arr=DATA.students.map(s=>{
    let tot=0,cnt=0;
    const subs= subj? [subj]:DATA.subjects;
    subs.forEach(su=>{const v=getVal(s,su,pc,term); if(v!=null){tot+=v;cnt++;}});
    return {name:s.name, val: cnt? tot:0};
  }).sort((a,b)=>b.val-a.val).slice(0,10);
  mk("chTop",{type:"bar",data:{labels:arr.map(a=>a.name),
    datasets:[{label:COMP_LABEL(pc)+(subj?(" · "+subj):""),data:arr.map(a=>a.val),
      backgroundColor:GREEN,borderRadius:6}]},
    options:{indexAxis:"y",responsive:true,plugins:{legend:{display:false}}}});
}
function drawStudent(){
  if(!DATA) return;
  const term=el("termSel").value, pc=primaryComp(term);
  const i=+el("studentSel").value||0; const s=DATA.students[i]; if(!s) return;
  const labels=DATA.subjects;
  mk("chStudent",{type:"radar",data:{labels,
    datasets:[{label:s.name,data:labels.map(su=>getVal(s,su,pc,term)||0),
      backgroundColor:"#0e5a4d33",borderColor:GREEN,pointBackgroundColor:GOLD}]},
    options:{responsive:true,plugins:{legend:{position:"bottom"}},
      scales:{r:{ticks:{font:{size:9}},pointLabels:{font:{size:10}}}}}});
}
function drawCompare(term){
  const pc=primaryComp(term);
  const subj=el("subjSel").value || DATA.subjects[0];
  const arr=DATA.students.map(s=>({name:s.name,val:getVal(s,subj,pc,term)||0}));
  mk("chCompare",{type:"bar",data:{labels:arr.map(a=>a.name),
    datasets:[{label:subj+" · "+COMP_LABEL(pc),data:arr.map(a=>a.val),backgroundColor:GOLD,borderRadius:5}]},
    options:{responsive:true,plugins:{legend:{position:"bottom"}},
      scales:{x:{ticks:{font:{size:9}}}}}});
}
function drawTable(term){
  const pc=primaryComp(term);
  const tb=el("dataTable");
  let head=`<tr><th>#</th><th>${t("name")}</th>`+DATA.subjects.map(s=>`<th>${s}</th>`).join("")+`</tr>`;
  let body=DATA.students.map((s,i)=>`<tr><td>${i+1}</td><td>${s.name}</td>`+
    DATA.subjects.map(su=>{const v=getVal(s,su,pc,term); return `<td>${v==null?"—":(+v).toFixed(0)}</td>`;}).join("")+
    `</tr>`).join("");
  tb.innerHTML=head+body;
}
function download(kind){
  const term=el("termSel").value, comp=primaryComp(term);
  let url=`/api/download/${kind}?term=${term}&component=${comp}`+(SRC.size?("&ids="+[...SRC].join(",")):"");
  window.location = url;
}
