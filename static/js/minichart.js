/* minichart.js — self-contained, dependency-free charting with a Chart.js-like API.
   Supports: bar (grouped + horizontal via indexAxis:'y'), line, doughnut, radar.
   Enough of new Chart(canvas,{type,data,options}) for this app; no CDN needed. */
(function(){
  const DPR = window.devicePixelRatio || 1;
  function setup(cv){
    const p = cv.parentElement;
    const w = (p?p.clientWidth:cv.clientWidth) || 360;
    const h = cv.getAttribute("height") ? +cv.getAttribute("height") : 260;
    cv.width = w*DPR; cv.height = h*DPR; cv.style.width="100%"; cv.style.height=h+"px";
    const ctx = cv.getContext("2d"); ctx.setTransform(DPR,0,0,DPR,0,0);
    return {ctx,w,h};
  }
  const isRTL = ()=> (document.documentElement.dir==="rtl");
  function fmt(n){ return (Math.round(n*100)/100).toString(); }
  function color(ds,i,fallback){ const c=ds.backgroundColor; if(Array.isArray(c)) return c[i%c.length]; return c||fallback; }

  function drawLegend(ctx,items,w,y){
    ctx.font="12px Tajawal,Arial"; ctx.textBaseline="middle";
    let total=0; items.forEach(it=>{ total += ctx.measureText(it.label).width + 26; });
    let x=(w-total)/2; if(x<6)x=6;
    items.forEach(it=>{
      ctx.fillStyle=it.color; ctx.fillRect(x,y-6,13,13);
      ctx.fillStyle="#333"; ctx.textAlign="left"; ctx.fillText(it.label,x+18,y);
      x += ctx.measureText(it.label).width + 26;
    });
  }
  function niceMax(v){ if(v<=0)return 10; const p=Math.pow(10,Math.floor(Math.log10(v)));
    const n=v/p; const m=n<=1?1:n<=2?2:n<=5?5:10; return m*p; }

  function Chart(cv, cfg){
    this.cv=cv; this.cfg=cfg; this._draw();
    Chart._all = Chart._all||[]; Chart._all.push(this);
  }
  Chart.prototype.destroy=function(){ const {ctx,w,h}=this._m||{}; if(ctx)ctx.clearRect(0,0,this.cv.width,this.cv.height); };
  Chart.prototype._draw=function(){
    const {type,data,options}=this.cfg; const m=setup(this.cv); this._m=m;
    const {ctx,w,h}=m; ctx.clearRect(0,0,w,h);
    const legend = !(options&&options.plugins&&options.plugins.legend&&options.plugins.legend.display===false);
    if(type==="doughnut"||type==="pie") return this._pie(ctx,w,h,data,legend);
    if(type==="radar") return this._radar(ctx,w,h,data,legend);
    const horiz = options&&options.indexAxis==="y";
    return this._bars(ctx,w,h,data,legend,type,horiz);
  };
  Chart.prototype._bars=function(ctx,w,h,data,legend,type,horiz){
    const labels=data.labels||[]; const dss=data.datasets||[];
    const legItems=dss.map((d,i)=>({label:d.label||"",color:color(d,0,"#0e5a4d")}));
    const legH = legend&&dss.length? 22:6;
    const padT=12, padB=(horiz?18:64)+legH, padL=isRTL()?14:44, padR=isRTL()?44:14;
    const cw=w-padL-padR, ch=h-padT-padB;
    let maxV=0; dss.forEach(d=>d.data.forEach(v=>{ if(v>maxV)maxV=v; })); maxV=niceMax(maxV)||10;
    // axis grid
    ctx.strokeStyle="#eef1f0"; ctx.fillStyle="#8a938f"; ctx.font="10px Tajawal,Arial";
    const steps=4;
    if(!horiz){
      for(let s=0;s<=steps;s++){ const val=maxV*s/steps; const y=padT+ch-(ch*s/steps);
        ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(padL+cw,y);ctx.stroke();
        ctx.textAlign=isRTL()?"left":"right"; ctx.textBaseline="middle";
        ctx.fillText(fmt(val), isRTL()?padL+cw+6:padL-6, y); }
    }
    const n=labels.length||1; const groupW=(horiz?ch:cw)/n; const nb=dss.length||1;
    const barW=Math.min((horiz?ch:cw)/n/nb*0.8, 46);
    labels.forEach((lab,li)=>{
      dss.forEach((d,di)=>{
        const v=d.data[li]||0; const col=color(d,li,"#0e5a4d");
        if(horiz){
          const y=padT+li*groupW+groupW/2 - (nb*barW)/2 + di*barW;
          const len=cw*(v/maxV); const x0=isRTL()? (padL+cw-len):padL;
          ctx.fillStyle=col; ctx.fillRect(x0,y,len,barW*0.86);
          ctx.fillStyle="#333";ctx.font="10px Tajawal,Arial";
          ctx.textAlign=isRTL()?"right":"left";ctx.textBaseline="middle";
          const lx=isRTL()?padL+cw-len-4:padL+len+4;
          ctx.fillText(fmt(v),lx,y+barW*0.43);
          ctx.fillStyle="#555";ctx.textAlign=isRTL()?"right":"left";
          ctx.fillText(lab.length>16?lab.slice(0,15)+"…":lab, isRTL()?padL+cw:padL, y+barW*0.43); // overlay label
        } else {
          const x=padL+li*groupW+groupW/2 - (nb*barW)/2 + di*barW;
          const bh=ch*(v/maxV); const y=padT+ch-bh;
          ctx.fillStyle=col; roundRect(ctx,x,y,barW*0.86,bh,4); ctx.fill();
        }
      });
      if(!horiz){ ctx.save(); ctx.fillStyle="#5c6b66"; ctx.font="9px Tajawal,Arial";
        const cx=padL+li*groupW+groupW/2; ctx.translate(cx,padT+ch+6); ctx.rotate(-Math.PI/4);
        ctx.textAlign="right"; ctx.textBaseline="middle";
        ctx.fillText(lab.length>14?lab.slice(0,13)+"…":lab,0,0); ctx.restore(); }
    });
    if(legend&&dss.length&&dss.some(d=>d.label)) drawLegend(ctx,legItems,w,h-legH/2-2);
  };
  Chart.prototype._pie=function(ctx,w,h,data,legend){
    const vals=(data.datasets[0]||{}).data||[]; const labels=data.labels||[];
    const cols=(data.datasets[0]||{}).backgroundColor||["#0e5a4d","#b6892b","#2f8f79","#d08c3a","#b02a37"];
    const total=vals.reduce((a,b)=>a+b,0)||1;
    const legH=legend?46:8; const cy=(h-legH)/2+6, cx=w/2, R=Math.min(cx,cy)-10, r=R*0.58;
    let a=-Math.PI/2;
    vals.forEach((v,i)=>{ const ang=v/total*Math.PI*2; ctx.beginPath();ctx.moveTo(cx,cy);
      ctx.arc(cx,cy,R,a,a+ang);ctx.closePath();ctx.fillStyle=cols[i%cols.length];ctx.fill();
      ctx.fillStyle="#fff";ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.stroke(); a+=ang; });
    ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle="#fff";ctx.fill();
    ctx.fillStyle="#0e5a4d";ctx.font="bold 20px Tajawal,Arial";ctx.textAlign="center";ctx.textBaseline="middle";
    ctx.fillText(total,cx,cy);
    if(legend){ const items=labels.map((l,i)=>({label:l+" ("+vals[i]+")",color:cols[i%cols.length]}));
      // wrap legend into up to 2 rows
      drawLegend(ctx,items.slice(0,Math.ceil(items.length/2)),w,h-30);
      drawLegend(ctx,items.slice(Math.ceil(items.length/2)),w,h-12); }
  };
  Chart.prototype._radar=function(ctx,w,h,data,legend){
    const labels=data.labels||[]; const ds=data.datasets[0]||{data:[]};
    const legH=legend?20:6; const cx=w/2, cy=(h-legH)/2+4, R=Math.min(cx,cy)-30;
    const N=labels.length||1; let maxV=0; (ds.data||[]).forEach(v=>{if(v>maxV)maxV=v;}); maxV=niceMax(maxV)||10;
    ctx.strokeStyle="#e2e8e5";
    for(let ring=1;ring<=4;ring++){ ctx.beginPath();
      for(let i=0;i<=N;i++){ const ang=-Math.PI/2+i/N*Math.PI*2; const rr=R*ring/4;
        const x=cx+rr*Math.cos(ang),y=cy+rr*Math.sin(ang); i?ctx.lineTo(x,y):ctx.moveTo(x,y);} ctx.stroke(); }
    for(let i=0;i<N;i++){ const ang=-Math.PI/2+i/N*Math.PI*2;
      ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+R*Math.cos(ang),cy+R*Math.sin(ang));ctx.stroke();
      ctx.fillStyle="#5c6b66";ctx.font="9px Tajawal,Arial";ctx.textAlign="center";ctx.textBaseline="middle";
      const lx=cx+(R+14)*Math.cos(ang),ly=cy+(R+10)*Math.sin(ang);
      const lab=labels[i]||""; ctx.fillText(lab.length>8?lab.slice(0,7)+"…":lab,lx,ly); }
    ctx.beginPath();
    (ds.data||[]).forEach((v,i)=>{ const ang=-Math.PI/2+i/N*Math.PI*2; const rr=R*(v/maxV);
      const x=cx+rr*Math.cos(ang),y=cy+rr*Math.sin(ang); i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
    ctx.closePath(); ctx.fillStyle="rgba(14,90,77,.22)"; ctx.fill();
    ctx.strokeStyle="#0e5a4d";ctx.lineWidth=2;ctx.stroke();
    (ds.data||[]).forEach((v,i)=>{ const ang=-Math.PI/2+i/N*Math.PI*2; const rr=R*(v/maxV);
      ctx.beginPath();ctx.arc(cx+rr*Math.cos(ang),cy+rr*Math.sin(ang),3,0,Math.PI*2);
      ctx.fillStyle="#b6892b";ctx.fill(); });
    if(legend&&ds.label) drawLegend(ctx,[{label:ds.label,color:"#0e5a4d"}],w,h-8);
  };
  function roundRect(ctx,x,y,wd,ht,r){ if(ht<0){y+=ht;ht=-ht;} r=Math.min(r,wd/2,ht);
    ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+wd,y,x+wd,y+ht,r);
    ctx.arcTo(x+wd,y+ht,x,y+ht,r);ctx.arcTo(x,y+ht,x,y,r);ctx.arcTo(x,y,x+wd,y,r);ctx.closePath(); }
  window.Chart = Chart; // expose Chart.js-compatible global
})();
