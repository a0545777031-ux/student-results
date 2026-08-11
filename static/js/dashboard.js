// User dashboard: upload, parsing results, analysis & charts, downloads.
const GREEN="#0e5a4d", GOLD="#b6892b", PALETTE=["#0e5a4d","#b6892b","#2f8f79","#c9a24b",
  "#1b6f9c","#8a5a2b","#4a9d6e","#d08c3a","#5b7fb0","#7a6f3a","#2d7d6a","#a8863c"];
let DATA=null, SELECTED=new Set(), CHARTS={}, FILES=[], SRC=new Set();
const DEFAULT_BANDS=[{key:"excellent",from:90,to:100},{key:"vgood",from:80,to:89},
  {key:"good",from:70,to:79},{key:"pass",from:60,to:69},{key:"weak",from:0,to:59}];
const BAND_ORDER=["excellent","vgood","good","pass","weak"];
let BANDS=normalizeBands(DEFAULT_BANDS), BANDS_CONFIRMED=false, BANDS_LOADED=false;
let ACTIVE_FIELD=null;
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
  { const cb=el("classBtn"); if(cb) cb.onclick = e=>{ e.stopPropagation(); const cp=el("classPanel"); if(cp) cp.classList.toggle("hidden"); }; }
  document.addEventListener("click", e=>{ const ms=el("classMS"); const cp=el("classPanel"); if(ms && cp && !ms.contains(e.target)) cp.classList.add("hidden"); });
  el("termSel").onchange = onTermChange;
  el("subjSel").onchange = render;
  el("studentSel").onchange = drawStudent;
  el("dlExcel").onclick = ()=>download("excel");
  el("repPdf").onclick = ()=>exportReport("pdf");
  el("repWord").onclick = ()=>exportReport("docx");
  el("bandsConfirm").onclick = saveBands;
  el("editBands").onclick = async ()=>{ if(!DATA) return; await ensureBands(); showBandsGate(); };
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
/* ---------- grade/class selector (cascade step 1: each uploaded file = a class;
   multi-select so several شعب can be merged into one analysis) ---------- */
// Class label from the uploaded file name (drop the extension), e.g. "الثالث متوسط أ".
function classLabel(f){ return (f.orig_name||"").replace(/\.(pdf|xlsx|xls|csv)$/i,""); }
// Button caption: none selected = all classes; 1 = its name; many = names joined with " + ".
function classSelLabel(){
  const chosen=FILES.filter(f=>SRC.has(f.id));
  if(!chosen.length) return t("all_classes");
  if(chosen.length<=3) return chosen.map(classLabel).join(" + ");
  return `${chosen.length} ${t("grade_label")}`;
}
function srcLabel(){ return classSelLabel(); }   // kept for any legacy callers
function buildSource(){
  const ids=new Set(FILES.map(f=>f.id));
  SRC=new Set([...SRC].filter(i=>ids.has(i)));  // drop deleted files
  const panel=el("classPanel");
  if(panel){
    const allOn = SRC.size===0;
    // "جميع الصفوف" merges every uploaded class; below it, check any subset to merge those.
    let html=`<label class="ms-opt ms-all"><input type="checkbox" data-all="1" ${allOn?"checked":""}> <b>${t("all_classes")}</b></label>`;
    html+=FILES.map(f=>`<label class="ms-opt"><input type="checkbox" value="${f.id}" ${SRC.has(f.id)?"checked":""}> <span>${classLabel(f)}</span> <small>(${f.n_students})</small></label>`).join("");
    panel.innerHTML=html;
    panel.querySelectorAll("input").forEach(inp=>{
      inp.onchange=()=>{
        if(inp.dataset.all){ SRC.clear(); }              // "all" clears the subset = every class
        else { const id=+inp.value; if(inp.checked) SRC.add(id); else SRC.delete(id); }
        buildSource(); loadData();
      };
    });
  }
  const lbl=el("classLbl"); if(lbl) lbl.textContent=classSelLabel();
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
  if(!has){ el("analysisBody").classList.add("hidden"); el("bandsGate").classList.add("hidden"); return; }
  await ensureBands();
  if(!BANDS_CONFIRMED){ showBandsGate(); return; }   // define rating ranges before analysis
  el("bandsGate").classList.add("hidden");
  el("analysisBody").classList.remove("hidden");
  // student selector
  const stu=el("studentSel");
  stu.innerHTML=DATA.students.map((s,i)=>`<option value="${i}">${s.name}</option>`).join("");
  // Cascading selection: pick a term first, then only that term's fields/subjects.
  // If the current term has no components, fall back to a term that does.
  ensureTermHasData();
  const term=el("termSel").value;
  selectTermDefaults(term);
  fillSubjects(term);
  buildFieldChips();
  render();
}
// True list of terms that actually carry any component in the data.
function termsWithData(){
  const s=new Set((DATA&&DATA.components||[]).map(c=>c.term));
  return ["t1","t2"].filter(x=>s.has(x));
}
// Make sure termSel points at a term that has data (avoids an empty field list).
function ensureTermHasData(){
  const avail=termsWithData(); if(!avail.length) return;
  const ts=el("termSel");
  if(!avail.includes(ts.value)) ts.value=avail[0];
}
// Default field for a term = its 'المجموع', else its first available component.
function selectTermDefaults(term){
  const comps=(DATA.components||[]).filter(c=>c.term===term);
  const total=comps.find(c=>c.component==="total") || comps[0];
  SELECTED=new Set();
  ACTIVE_FIELD=null;
  if(total){ SELECTED.add(total.key); ACTIVE_FIELD=total.key; }
}
// Subjects that actually have any grade recorded in the selected term.
function fillSubjects(term){
  const ss=el("subjSel"); if(!ss) return;
  const prev=ss.value;
  const subs=DATA.subjects.filter(su=>
    DATA.students.some(s=>{ const g=s.grades[su]; if(!g) return false;
      return Object.keys(g).some(ck=> g[ck] && g[ck][term]!=null); }));
  ss.innerHTML=`<option value="">${t("all_subjects")}</option>`+
    subs.map(s=>`<option value="${s}">${s}</option>`).join("");
  ss.value = (prev && subs.includes(prev)) ? prev : "";
}
// When the term changes, re-base fields + subjects to the newly chosen term only.
function onTermChange(){
  if(!DATA) return;
  const term=el("termSel").value;
  selectTermDefaults(term);
  fillSubjects(term);
  buildFieldChips();
  render();
}
function buildFieldChips(){
  if(!DATA) return;
  const term=el("termSel").value;
  const wrap=el("fieldChips"); wrap.innerHTML="";
  // Only the selected term's fields are shown (cascading from the term choice above).
  (DATA.components||[]).filter(c=>c.term===term).forEach(c=>{
    const on=SELECTED.has(c.key);
    const div=document.createElement("label");
    div.className="chip"+(on?" on":"");
    div.innerHTML=`<input type="checkbox" ${on?"checked":""}> ${COMP_LABEL(c.component)}`;
    div.querySelector("input").onchange=e=>{
      if(e.target.checked){ SELECTED.add(c.key); ACTIVE_FIELD=c.key; }
      else { SELECTED.delete(c.key); if(ACTIVE_FIELD===c.key) ACTIVE_FIELD=null; }
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
// The single "driver" field for ratings/matrix/top charts = the field the user
// last turned on (so checking a field immediately re-bases the whole analysis).
function primaryComp(term){
  if(ACTIVE_FIELD && SELECTED.has(ACTIVE_FIELD)){
    const p=ACTIVE_FIELD.split(":");
    if(p[1]===term) return p[0];
  }
  const cs=selectedComps(term);
  return cs[0] || "total";
}
// Human label of the field the analysis is currently based on, e.g. "المجموع · الفصل الثاني".
function activeFieldLabel(term){
  const pc=primaryComp(term);
  if(pc==="final") return COMP_LABEL("final");
  const termTxt = term==="t1"? t("term1") : t("term2");
  return COMP_LABEL(pc)+" · "+termTxt;
}
function updateFieldTags(term){
  const tag="("+activeFieldLabel(term)+")";
  const a=el("ratingsField"), b=el("matrixField");
  if(a) a.textContent=tag;
  if(b) b.textContent=tag;
}
function render(){
  if(!DATA) return;
  const term=el("termSel").value;
  updateFieldTags(term);
  drawKPI(term);
  drawRatings(term);
  drawMatrix(term);
  drawSubjectAvg(term);
  drawDistribution(term);
  drawTop(term);
  drawStudent();
  drawCompare(term);
  drawTable(term);
}
/* ---------- rating bands (user-defined grade ranges) ---------- */
function normalizeBands(arr){
  const a=(arr&&arr.length?arr:DEFAULT_BANDS).map(b=>({key:b.key,from:+b.from||0,to:+b.to||0}));
  a.sort((x,y)=>y.from-x.from);   // highest 'from' first for classification
  return a;
}
async function ensureBands(force){
  if(BANDS_LOADED && !force) return;
  const r=await api("/api/my/settings");
  if(r.ok && r.data){ BANDS=normalizeBands(r.data.bands); BANDS_CONFIRMED=!!r.data.confirmed; }
  BANDS_LOADED=true;
}
function RATE_COLOR(k){ const f=RATE.find(x=>x[0]===k); return f?f[1]:"#0e7a63"; }
function showBandsGate(){
  el("noData").classList.add("hidden");
  el("analysisBody").classList.add("hidden");
  el("bandsGate").classList.remove("hidden");
  buildBandsForm();
}
function buildBandsForm(){
  const wrap=el("bandsForm"); if(!wrap) return;
  const map={}; (BANDS||[]).forEach(b=>map[b.key]=b);
  wrap.innerHTML=`<div class="band-row band-head"><span>${t("band_rating")}</span><span>${t("band_from")}</span><span>${t("band_to")}</span></div>`+
    BAND_ORDER.map(k=>{ const b=map[k]||{from:0,to:0};
      return `<div class="band-row"><span class="band-name" style="--rc:${RATE_COLOR(k)}">${t(k)}</span>
        <input type="number" min="0" max="100" step="0.5" class="band-from" data-k="${k}" value="${b.from}">
        <input type="number" min="0" max="100" step="0.5" class="band-to" data-k="${k}" value="${b.to}"></div>`;
    }).join("");
}
async function saveBands(){
  const bands=BAND_ORDER.map(k=>{
    const f=document.querySelector(`.band-from[data-k="${k}"]`);
    const tt=document.querySelector(`.band-to[data-k="${k}"]`);
    return {key:k, from:+(f&&f.value)||0, to:+(tt&&tt.value)||0};
  });
  const btn=el("bandsConfirm"); btn.disabled=true;
  const r=await api("/api/my/settings",{method:"POST",body:{bands}});
  btn.disabled=false;
  if(r.ok){ BANDS=normalizeBands(bands); BANDS_CONFIRMED=true; BANDS_LOADED=true;
    showMsg("bandsMsg", t("saved"), "ok");
    setTimeout(()=>{ el("bandsGate").classList.add("hidden"); loadData(); }, 400);
  } else { showMsg("bandsMsg", LANG==="ar"?"تعذّر الحفظ":"Save failed", "err"); }
}
/* ---------- ratings / classification ---------- */
function levelOf(score){
  for(let i=0;i<BANDS.length;i++){ if(score>=BANDS[i].from) return BANDS[i].key; }
  return BANDS.length? BANDS[BANDS.length-1].key : "weak";
}
// Columns that are summaries/non-academic, not part of a subject average.
const RESULT_SUBJECT="النتيجة";
const NON_AVG_SUBJECTS=[RESULT_SUBJECT,"المواظبة","السلوك"];
// A student's overall score for classification. The report has an official
// "النتيجة" (result) column — use it directly when present so the popup matches
// the downloaded report exactly. Otherwise average the graded subjects.
function studentAvg(s,term){
  const pc=primaryComp(term);
  const res=getVal(s,RESULT_SUBJECT,pc,term);
  if(res!=null) return res;
  let sum=0,n=0;
  DATA.subjects.forEach(su=>{
    if(NON_AVG_SUBJECTS.indexOf(su)!==-1) return;
    const v=getVal(s,su,pc,term); if(v!=null){sum+=v;n++;}
  });
  return n? sum/n : 0;
}
function classify(term){
  const out={excellent:[],vgood:[],good:[],pass:[],weak:[]};
  DATA.students.forEach(s=>{ const k=levelOf(studentAvg(s,term)); if(out[k]) out[k].push(s.name); });
  return out;
}
const RATE=[["excellent","#1e7d4f","#1e7d4f14"],["vgood","#2f8f79","#2f8f7914"],
  ["good","#b6892b","#b6892b1c"],["pass","#d08c3a","#d08c3a1c"],["weak","#b02a37","#b02a3714"]];
// Students in a rating level (for the term's primary field), each with their average score.
function ratingMembers(term,key){
  return DATA.students.map(s=>({name:s.name, score:studentAvg(s,term)}))
    .filter(o=>levelOf(o.score)===key)
    .sort((a,b)=>b.score-a.score);
}
function drawRatings(term){
  const wrap=el("ratings"); wrap.innerHTML="";
  RATE.forEach(([key,c,cl])=>{
    const members=ratingMembers(term,key);
    const tile=document.createElement("div"); tile.className="rating-tile";
    tile.style.setProperty("--rc",c); tile.style.setProperty("--rcl",cl);
    tile.innerHTML=`<div class="rc-num">${members.length}</div><div class="rc-lbl">${t(key)}</div>`;
    tile.onclick=()=>showNames(key,c,members,tile);
    wrap.appendChild(tile);
  });
  el("ratingNames").className="rating-names";
}
/* ---------- rating matrix: subjects x rating levels ---------- */
let MATRIX={};
function subjectLevel(s,subj,term){
  const pc=primaryComp(term); const v=getVal(s,subj,pc,term);
  return v==null? null : levelOf(v);
}
function drawMatrix(term){
  const tb=el("ratingMatrix"); if(!tb) return;
  const box=el("matrixNames"); if(box){ box.classList.remove("show"); box.innerHTML=""; }
  MATRIX={};
  const pc=primaryComp(term);
  const head=`<tr><th>${t("subject")}</th>`+
    BAND_ORDER.map(k=>`<th style="color:${RATE_COLOR(k)}">${t(k)}</th>`).join("")+`</tr>`;
  const body=DATA.subjects.map(subj=>{
    const cells=BAND_ORDER.map(k=>{
      const members=DATA.students.filter(s=>subjectLevel(s,subj,term)===k)
        .map(s=>({name:s.name, score:getVal(s,subj,pc,term)}))
        .sort((a,b)=>(b.score??0)-(a.score??0));
      const id=subj+"|"+k; MATRIX[id]=members;
      const cls="mcell"+(members.length?"":" zero");
      return `<td class="${cls}" data-id="${id}" style="--rc:${RATE_COLOR(k)}">${members.length}</td>`;
    }).join("");
    return `<tr><td class="msubj">${subj}</td>${cells}</tr>`;
  }).join("");
  tb.innerHTML=head+body;
  tb.querySelectorAll(".mcell").forEach(td=>{
    td.onclick=()=>{ const id=td.dataset.id; const p=id.split("|");
      showMatrixNames(p[0], p[1], MATRIX[id], td); };
  });
}
// Trim a score to at most one decimal without a trailing ".0" (96.5 -> "96.5", 100 -> "100").
function fmtScore(v){ return v==null? "" : String(+(+v).toFixed(1)); }
// Render a vertical, copy-friendly list of student names + their grade, with a copy button.
// `items` may be plain name strings or {name, score} objects.
function renderNames(box, title, items, color){
  if(!box) return;
  if(color) box.style.setProperty("--rc",color);
  const rows=(items||[]).map(x=> typeof x==="string" ? {name:x, score:null} : x);
  const has = rows.length;
  const anyScore = rows.some(r=>r.score!=null);
  box.innerHTML =
    `<div class="names-head"><b>${title}:</b>`+
    (has? `<button type="button" class="btn sm ghost names-copy">📋 ${t("copy_names")}</button>` : "")+
    `</div>`+
    (has? `<ol class="names-list${anyScore?" with-score":""}">`+
        rows.map(r=>`<li><span class="nm">${r.name}</span>`+
          (r.score!=null?`<span class="sc">${fmtScore(r.score)}</span>`:"")+`</li>`).join("")+`</ol>`
        : `<div class="names-none">${t("no_one")}</div>`);
  box.classList.add("show");
  if(has){
    // Tab-separated so pasting into Excel/Sheets lands name and grade in two columns.
    const text=rows.map(r=> r.score!=null ? `${r.name}\t${fmtScore(r.score)}` : r.name).join("\n");
    const btn=box.querySelector(".names-copy");
    btn.onclick=()=>{
      const done=()=>{ btn.textContent="✔ "+t("copied"); setTimeout(()=>{ btn.textContent="📋 "+t("copy_names"); },1500); };
      if(navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(done).catch(()=>fallbackCopy(text,done));
      } else fallbackCopy(text,done);
    };
  }
}
function fallbackCopy(text,done){
  const ta=document.createElement("textarea"); ta.value=text;
  ta.style.position="fixed"; ta.style.opacity="0"; document.body.appendChild(ta);
  ta.select(); try{ document.execCommand("copy"); done&&done(); }catch(e){}
  document.body.removeChild(ta);
}
function showMatrixNames(subj,key,names,td){
  document.querySelectorAll("#ratingMatrix .mcell").forEach(x=>x.classList.remove("on"));
  td.classList.add("on");
  renderNames(el("matrixNames"), `${subj} — ${t(key)} (${(names||[]).length} ${t("students_word")})`, names, RATE_COLOR(key));
}
function showNames(key,c,names,tile){
  document.querySelectorAll(".rating-tile").forEach(x=>x.classList.remove("on"));
  tile.classList.add("on");
  renderNames(el("ratingNames"), `${t(key)} (${names.length} ${t("students_word")})`, names, c);
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
  // vertical bars: subject name at the base, grade on top, sorted highest-first
  const arr=DATA.subjects.map(su=>({subj:su, val:getVal(s,su,pc,term)}))
            .filter(o=>o.val!=null).sort((a,b)=>b.val-a.val);
  mk("chStudent",{type:"bar",data:{labels:arr.map(a=>a.subj),
    datasets:[{label:s.name,data:arr.map(a=>a.val),
      backgroundColor:arr.map((a,k)=>PALETTE[k%PALETTE.length]),borderRadius:6}]},
    options:{responsive:true,plugins:{legend:{position:"bottom"}},
      scales:{x:{ticks:{font:{size:9}}}}}});
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
