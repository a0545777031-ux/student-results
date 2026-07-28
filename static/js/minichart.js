/* minichart.js v2 — self-contained charting, no CDN. */
(function(){
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const FONT = "Tajawal, 'Segoe UI', Arial, sans-serif";
  const isRTL = ()=> (document.documentElement.dir === "rtl");
  function setup(cv){
    const p = cv.parentElement;
    const w = (p ? p.clientWidth : cv.clientWidth) || 360;
    const h = cv.getAttribute("height") ? +cv.getAttribute("height") : 280;
    cv.width = w*DPR; cv.height = h*DPR; cv.style.width="100%"; cv.style.height=h+"px";
    const ctx = cv.getContext("2d"); ctx.setTransform(DPR,0,0,DPR,0,0);
    return {ctx,w,h};
  }
  function hex2rgb(h){ h=h.replace('#',''); if(h.length===3) h=h.split('').map(c=>c+c).join('');
    return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)]; }
  function lighten(hex,amt){ const [r,g,b]=hex2rgb(hex);
    const m=(c)=>Math.round(c+(255-c)*amt); return `rgb(${m(r)},${m(g)},${m(b)})`; }
  function rgba(hex,a){ const [r,g,b]=hex2rgb(hex); return `rgba(${r},${g},${b},${a})`; }
  function vgrad(ctx,x,y,h,hex){ const g=ctx.createLinearGradient(0,y,0,y+h);
    g.addColorStop(0, lighten(hex,.28)); g.addColorStop(1, hex); return g; }
  function hgrad(ctx,x,w,hex){ const g=ctx.createLinearGradient(x,0,x+w,0);
    g.addColorStop(0, hex); g.addColorStop(1, lighten(hex,.30)); return g; }
  const PALETTE = ["#0e7a63","#c8992e","#2f9e8a","#3b78c9","#d8743e","#7c5cd6",
                   "#159b8a","#b0842a","#5686c4","#4aa06e","#9a6cc9","#cf8a3a"];
  const fmt = n => (Math.round(n*100)/100).toString();
  function color(ds,i,fb){ const c=ds.backgroundColor; if(Array.isArray(c)) return c[i%c.length]; return c||fb; }
  function niceMax(v){ if(v<=0)return 10; const p=Math.pow(10,Math.floor(Math.log10(v)));
    const n=v/p; const m=n<=1?1:n<=1.5?1.5:n<=2?2:n<=3?3:n<=5?5:10; return m*p; }
  function ease(t){ return 1-Math.pow(1-t,3); }
  function roundRect(ctx,x,y,w,h,r){ if(h<0){y+=h;h=-h;} r=Math.max(0,Math.min(r,w/2,h));
    ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);
    ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath(); }
  function legendChips(ctx,items,w,y){
    ctx.font="600 12px "+FONT; ctx.textBaseline="middle";
    let total=0; const wm=items.map(it=>{ const tw=ctx.measureText(it.label).width+30; total+=tw; return tw; });
    let x=Math.max(8,(w-total)/2);
    items.forEach((it,i)=>{
      ctx.fillStyle=it.color; roundRect(ctx,x,y-6,12,12,3); ctx.fill();
      ctx.fillStyle="#40514c"; ctx.textAlign="left"; ctx.fillText(it.label,x+17,y+1);
      x+=wm[i];
    });
  }
  function Chart(cv, cfg){ this.cv=cv; this.cfg=cfg; this._raf=null; this._animate(); }
  Chart.prototype.destroy=function(){ if(this._raf) cancelAnimationFrame(this._raf);
    const c=this.cv.getContext("2d"); c && c.clearRect(0,0,this.cv.width,this.cv.height); };
  Chart.prototype._animate=function(){
    const m=setup(this.cv); this._m=m; const dur=520; let start=null;
    const step=(ts)=>{ if(start===null) start=ts; const p=Math.min(1,(ts-start)/dur);
      this._render(m, ease(p)); if(p<1) this._raf=requestAnimationFrame(step); };
    this._raf=requestAnimationFrame(step);
  };
  Chart.prototype._render=function(m,prog){
    const {type,data,options}=this.cfg; const {ctx,w,h}=m; ctx.clearRect(0,0,w,h);
    const legend = !(options&&options.plugins&&options.plugins.legend&&options.plugins.legend.display===false);
    if(type==="doughnut"||type==="pie") return this._pie(ctx,w,h,data,legend,prog);
    if(type==="radar") return this._radar(ctx,w,h,data,legend,prog);
    const horiz = options&&options.indexAxis==="y";
    return this._bars(ctx,w,h,data,legend,horiz,prog);
  };
  Chart.prototype._bars=function(ctx,w,h,data,legend,horiz,prog){
    const labels=data.labels||[]; const dss=data.datasets||[];
    const legItems=dss.filter(d=>d.label).map((d,i)=>({label:d.label,color:color(d,0,PALETTE[i])}));
    const legH = legend&&legItems.length? 26:8;
    const padT=16, padB=(horiz?14:60)+legH, padL=isRTL()?16:46, padR=isRTL()?46:16;
    const cw=w-padL-padR, ch=h-padT-padB;
    let maxV=0; dss.forEach(d=>d.data.forEach(v=>{ if(v>maxV)maxV=v; })); maxV=niceMax(maxV)||10;
    ctx.strokeStyle="#eef2f0"; ctx.lineWidth=1; ctx.fillStyle="#9aa5a0"; ctx.font="10px "+FONT;
    const steps=4;
    if(!horiz){
      for(let s=0;s<=steps;s++){ const val=maxV*s/steps; const y=padT+ch-(ch*s/steps);
        ctx.setLineDash(s?[4,4]:[]); ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(padL+cw,y);ctx.stroke();
        ctx.textAlign=isRTL()?"left":"right"; ctx.textBaseline="middle";
        ctx.fillText(fmt(val), isRTL()?padL+cw+6:padL-8, y); }
      ctx.setLineDash([]);
    }
    const n=labels.length||1; const span=(horiz?ch:cw)/n; const nb=dss.length||1;
    const barW=Math.min(span/nb*0.72, horiz?30:52);
    ctx.textBaseline="alphabetic";
    labels.forEach((lab,li)=>{
      dss.forEach((d,di)=>{
        const v=(d.data[li]||0); const col=color(d,li,PALETTE[di%PALETTE.length]);
        if(horiz){
          const yc=padT+li*span+span/2 - (nb*barW)/2 + di*barW;
          const full=cw*(v/maxV); const len=full*prog;
          const x0=isRTL()? (padL+cw-len):padL;
          ctx.save(); ctx.shadowColor=rgba(col,.28); ctx.shadowBlur=8; ctx.shadowOffsetY=2;
          ctx.fillStyle=hgrad(ctx, isRTL()?padL+cw-full:padL, full||1, col);
          roundRect(ctx,x0,yc,len,barW*0.82,7); ctx.fill(); ctx.restore();
          if(prog>0.9){ ctx.fillStyle="#40514c"; ctx.font="600 11px "+FONT;
            ctx.textAlign=isRTL()?"right":"left"; ctx.textBaseline="middle";
            const lx=isRTL()?padL+cw-full-6:padL+full+6; ctx.fillText(fmt(v),lx,yc+barW*0.41);
            ctx.fillStyle="#fff"; ctx.textAlign=isRTL()?"right":"left";
            const nx=isRTL()?padL+cw-8:padL+8;
            ctx.fillText(lab.length>18?lab.slice(0,17)+"…":lab, nx, yc+barW*0.41); }
        } else {
          const x=padL+li*span+span/2 - (nb*barW)/2 + di*barW;
          const full=ch*(v/maxV); const bh=full*prog; const y=padT+ch-bh;
          ctx.save(); ctx.shadowColor=rgba(col,.30); ctx.shadowBlur=10; ctx.shadowOffsetY=3;
          ctx.fillStyle=vgrad(ctx,x,padT+ch-full,full||1,col);
          roundRect(ctx,x,y,barW*0.82,bh,7); ctx.fill(); ctx.restore();
          if(prog>0.9 && nb<=2){ ctx.fillStyle="#5c6b66"; ctx.font="600 10px "+FONT;
            ctx.textAlign="center"; ctx.fillText(fmt(v), x+barW*0.41, y-5); }
        }
      });
      if(!horiz){ ctx.save(); ctx.fillStyle="#6b7772"; ctx.font="9px "+FONT;
        const cx=padL+li*span+span/2; ctx.translate(cx,padT+ch+8); ctx.rotate(-Math.PI/4.2);
        ctx.textAlign="right"; ctx.textBaseline="middle";
        ctx.fillText(lab.length>15?lab.slice(0,14)+"…":lab,0,0); ctx.restore(); }
    });
    if(legend&&legItems.length) legendChips(ctx,legItems,w,h-legH/2-2);
  };
  Chart.prototype._pie=function(ctx,w,h,data,legend,prog){
    const vals=(data.datasets[0]||{}).data||[]; const labels=data.labels||[];
    const cols=(data.datasets[0]||{}).backgroundColor||PALETTE;
    const total=vals.reduce((a,b)=>a+b,0)||1;
    const shown=labels.map((l,i)=>({label:`${l} (${vals[i]})`,color:cols[i%cols.length],v:vals[i]})).filter(it=>it.v>0);
    const rows = shown.length>3?2:1; const legH = legend? (rows*20+10):8;
    const cx=w/2, cy=(h-legH)/2+6, R=Math.min(cx,cy)-8, r=R*0.60; const gap=0.025;
    let a=-Math.PI/2;
    vals.forEach((v,i)=>{
      if(v<=0) return;
      const ang=(v/total)*Math.PI*2*prog; const col=cols[i%cols.length];
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,R, a+gap, a+ang-gap); ctx.closePath();
      ctx.fillStyle=col; ctx.fill(); a+=ang;
    });
    ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fillStyle="#fff"; ctx.fill();
    ctx.lineWidth=1; ctx.strokeStyle="#eef2f0"; ctx.stroke();
    ctx.fillStyle="#0e5a4d"; ctx.font="800 26px "+FONT; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(Math.round(total*prog), cx, cy);
    if(legend){
      if(rows===2){ legendChips(ctx,shown.slice(0,Math.ceil(shown.length/2)),w,h-30);
        legendChips(ctx,shown.slice(Math.ceil(shown.length/2)),w,h-12); }
      else legendChips(ctx,shown,w,h-12);
    }
  };
  Chart.prototype._radar=function(ctx,w,h,data,legend,prog){
    const labels=data.labels||[]; const ds=data.datasets[0]||{data:[]};
    const legH=legend&&ds.label?22:6; const cx=w/2, cy=(h-legH)/2+6, R=Math.min(cx,cy)-34;
    const N=labels.length||1; let maxV=0; (ds.data||[]).forEach(v=>{if(v>maxV)maxV=v;}); maxV=niceMax(maxV)||10;
    const base="#0e7a63";
    for(let ring=1;ring<=4;ring++){ ctx.strokeStyle= ring===4?"#dce6e2":"#eef2f0"; ctx.beginPath();
      for(let i=0;i<=N;i++){ const ang=-Math.PI/2+i/N*Math.PI*2; const rr=R*ring/4;
        const x=cx+rr*Math.cos(ang),y=cy+rr*Math.sin(ang); i?ctx.lineTo(x,y):ctx.moveTo(x,y);} ctx.closePath(); ctx.stroke(); }
    for(let i=0;i<N;i++){ const ang=-Math.PI/2+i/N*Math.PI*2;
      ctx.strokeStyle="#eef2f0"; ctx.beginPath();ctx.moveTo(cx,cy);
      ctx.lineTo(cx+R*Math.cos(ang),cy+R*Math.sin(ang));ctx.stroke();
      ctx.fillStyle="#6b7772";ctx.font="600 9px "+FONT;ctx.textAlign="center";ctx.textBaseline="middle";
      const lx=cx+(R+15)*Math.cos(ang),ly=cy+(R+11)*Math.sin(ang);
      const lab=labels[i]||""; ctx.fillText(lab.length>9?lab.slice(0,8)+"…":lab,lx,ly); }
    const pts=(ds.data||[]).map((v,i)=>{ const ang=-Math.PI/2+i/N*Math.PI*2; const rr=R*(v/maxV)*prog;
      return [cx+rr*Math.cos(ang), cy+rr*Math.sin(ang)]; });
    if(pts.length){ ctx.beginPath(); pts.forEach((p,i)=> i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.closePath();
      const g=ctx.createRadialGradient(cx,cy,10,cx,cy,R);
      g.addColorStop(0,rgba(base,.10)); g.addColorStop(1,rgba(base,.34)); ctx.fillStyle=g; ctx.fill();
      ctx.strokeStyle=base; ctx.lineWidth=2.2; ctx.stroke();
      pts.forEach(p=>{ ctx.beginPath();ctx.arc(p[0],p[1],3.2,0,Math.PI*2);
        ctx.fillStyle="#c8992e";ctx.strokeStyle="#fff";ctx.lineWidth=1.5;ctx.fill();ctx.stroke(); }); }
    if(legend&&ds.label) legendChips(ctx,[{label:ds.label,color:base}],w,h-8);
  };
  window.Chart = Chart;
})();
