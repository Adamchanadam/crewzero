// startup-os 一個殼（決定二十五）：所有分頁共用嘅版面同頁頭（唯一定義）。
// 頁頭：公司標誌、公司名、一句介紹、三個業務指標（數字滾動）；導航：你要做｜公司運作｜參考，九個分頁全部常駐、冇「更多」選單；
// 工具列右邊：連線徽章、立即讀回、特效開關、暫停動效；背景層（氣氛層，冷色、慢）同字級變數都喺呢度。
// 樣式：顏色、底色、頁頭、導航、卡、按鈕、標記、問題卡、進度、底部列、對話框；頁面只寫自己獨有嘅樣式。
// 名稱全部由 names.js 嚟；呢個檔要喺 names.js 之後載入。
(function (g) {
  var N = g.SOS_NAMES, D = N.dash, U = N.ui;
  var CSS = `
:root{
  --bg:#060608; --panel:rgba(14,15,19,.93); --line:rgba(255,255,255,.095);
  --text:#f2f4f8; --muted:#9ca3b3; --amber:#e88d4f; --mint:#99d7bc; --red:#f2a29e;
  --wait:#efb37f; --unknown:#838d9e; --blue:#c2d6fa; --cool:#6f86b8;
  --ui:Inter,"Segoe UI","Microsoft JhengHei",sans-serif;
  --mono:"JetBrains Mono","Cascadia Code",Consolas,monospace;
  --c-checkup:#7fd6e0; --c-wargame:#7fa7e8; --c-wargame2:#f2a29e; --c-scenario:#c9a8f0; --c-opportunities:#f0d27a; --c-routes:#b9e38a; --c-pipeline:#f0a6c8;
  --fs-h1:30px; --fs-page:25px; --fs-num:32px; --fs-title:18px; --fs-body:15px; --fs-sub:13.5px; --fs-label:12px; --fs-min:11px;
  --amb:16s; --flow:2.6s; --r-card:14px;
  --glass:linear-gradient(180deg,rgba(255,255,255,.038),rgba(255,255,255,.012) 40%,rgba(10,11,15,0));
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;color-scheme:dark}
body{margin:0;min-height:100vh;color:var(--text);font:var(--fs-body)/1.6 var(--ui);background:#060608;overflow-x:hidden}
button{font-family:inherit;font-size:inherit}
a{color:inherit}
h1{font-size:var(--fs-h1);font-weight:650;margin:2px 0;letter-spacing:-.01em;line-height:1.25}
.eyebrow{display:block;font-size:var(--fs-sub);letter-spacing:.14em;text-transform:uppercase;color:var(--amber);font-weight:650;line-height:1.4}
/* 背景層：極光、透視地面、網格、光掃、景深、顆粒（氣氛層：冷色、慢、無方向） */
.bg{position:fixed;inset:0;z-index:-2;pointer-events:none;overflow:hidden;background:radial-gradient(1200px 700px at 50% -14%,rgba(232,141,79,.075),transparent 62%),radial-gradient(900px 640px at 50% 38%,#0c0e14 0%,#060608 72%)}
.bg .aurora{position:absolute;width:60vw;height:60vw;border-radius:50%;filter:blur(90px);opacity:.35;mix-blend-mode:screen}
.bg .a1{left:-14vw;top:-22vw;background:radial-gradient(circle,rgba(111,134,184,.35),transparent 60%);animation:drift 38s ease-in-out infinite alternate}
.bg .a2{right:-18vw;top:18vh;background:radial-gradient(circle,rgba(232,141,79,.14),transparent 60%);animation:drift 46s ease-in-out infinite alternate-reverse}
@keyframes drift{to{transform:translate3d(6vw,4vh,0) scale(1.08)}}
.bg .plane{position:absolute;left:-20%;right:-20%;bottom:-6%;height:46%;background-image:linear-gradient(rgba(140,160,200,.09) 1px,transparent 1px),linear-gradient(90deg,rgba(140,160,200,.09) 1px,transparent 1px);background-size:64px 64px;transform:perspective(700px) rotateX(64deg);transform-origin:50% 100%;mask-image:linear-gradient(180deg,transparent,#000 40%,#000 75%,transparent);-webkit-mask-image:linear-gradient(180deg,transparent,#000 40%,#000 75%,transparent)}
.bg .grid{position:absolute;inset:-2px;background-image:linear-gradient(rgba(140,160,200,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(140,160,200,.045) 1px,transparent 1px);background-size:56px 56px;mask-image:radial-gradient(ellipse 70% 55% at 50% 28%,#000 25%,transparent 80%);-webkit-mask-image:radial-gradient(ellipse 70% 55% at 50% 28%,#000 25%,transparent 80%)}
.bg .sweep{position:absolute;top:-20%;left:-30%;width:40%;height:140%;background:linear-gradient(100deg,transparent 0%,rgba(111,134,184,.06) 45%,rgba(111,134,184,.11) 50%,rgba(111,134,184,.06) 55%,transparent 100%);transform:skewX(-12deg);animation:sweep var(--amb) linear infinite;will-change:transform}
@keyframes sweep{from{transform:translateX(-40vw) skewX(-12deg)}to{transform:translateX(180vw) skewX(-12deg)}}
.bg .depth{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 100%,rgba(0,0,0,.6),transparent 60%)}
.bg .grain{position:absolute;inset:0;opacity:.05;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='120' height='120' filter='url(%23n)' opacity='.6'/></svg>")}
/* 殼：頁頭、三個指標、上次離開之後、三組導航、工具列 */
.shell{max-width:1776px;margin:0 auto;padding:12px 36px 28px}
.dtop{display:flex;gap:24px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.ident{display:flex;gap:14px;align-items:center;min-width:0}
.ident .one{font-size:var(--fs-sub);opacity:.86;margin:0}
.mark{width:52px;height:52px;flex:none;border:1px solid rgba(232,141,79,.5);border-radius:14px;display:grid;place-items:center;font:600 var(--fs-title) var(--mono);color:var(--amber);background:linear-gradient(160deg,rgba(232,141,79,.16),rgba(232,141,79,.02));box-shadow:0 0 50px rgba(232,141,79,.08),inset 0 1px 0 rgba(255,255,255,.08)}
.metrics{display:flex;gap:22px;margin-left:auto}
.metric{position:relative;display:block;min-width:130px;text-decoration:none;padding:2px 0;color:inherit}
.metric label{display:block;color:var(--muted);font-size:var(--fs-label);white-space:nowrap;cursor:inherit}
.metric strong{display:block;font:500 var(--fs-num)/1.15 var(--mono);letter-spacing:-1px;font-variant-numeric:tabular-nums}
.metric small{display:block;color:var(--muted);font-size:var(--fs-label);white-space:nowrap;max-width:230px;overflow:hidden;text-overflow:ellipsis}
.metric:after{content:"";display:block;height:2px;margin-top:3px;background:linear-gradient(90deg,var(--amber),rgba(232,141,79,.06))}
.metric:nth-child(2):after{background:linear-gradient(90deg,var(--mint),rgba(153,215,188,.06))}
.metric:hover strong{color:#ffc18e}
.metric.bump:after{animation:ov-bar-run .5s ease-out;background-size:200% 100%}
.metric .plus{position:absolute;left:84px;top:18px;font:700 var(--fs-body) var(--mono);color:var(--mint);text-shadow:0 0 10px rgba(153,215,188,.6);opacity:0;pointer-events:none}
.metric.plus-on .plus{animation:ov-plus 1.2s ease-out}
.odobox{display:inline-flex;align-items:baseline}
.odo{display:inline-block;height:1.15em;overflow:hidden;line-height:1.15em;vertical-align:top}
.odo .strip{display:block;transition:transform .7s cubic-bezier(.16,.84,.24,1)}
.odo .strip i{display:block;height:1.15em;font-style:normal}
.since{margin:6px 0 0;font-size:var(--fs-sub);color:var(--muted)}
.since b{color:var(--text);font-weight:500}
.banner{margin-top:8px;font-size:var(--fs-label);color:#ffc18e;border:1px dashed rgba(232,141,79,.5);border-radius:7px;padding:4px 12px;background:rgba(232,141,79,.05);display:inline-block}
.toolbar{display:flex;align-items:center;gap:10px;margin:8px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.tabs{display:flex;gap:4px;align-items:center;flex-wrap:nowrap;overflow-x:auto;max-width:100%;min-width:0;flex:1 1 auto;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tgrp{display:flex;gap:4px;align-items:center;position:relative;padding-top:12px}
.tgrp:before{content:attr(data-name);position:absolute;top:-2px;left:14px;font-size:var(--fs-min);letter-spacing:.12em;color:var(--muted);opacity:.8;white-space:nowrap}
.tabs a{position:relative;display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 14px;border:1px solid transparent;border-radius:9px;font-size:var(--fs-sub);color:var(--muted);text-decoration:none;white-space:nowrap;transition:background .2s,color .2s}
.tabs a:hover{background:rgba(255,255,255,.04);color:var(--text)}
.tabs a.on{border-color:rgba(232,141,79,.4);background:linear-gradient(180deg,rgba(232,141,79,.14),rgba(232,141,79,.05));color:#ffc18e;box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
.tabs a.on:after{content:"";position:absolute;left:14px;right:14px;bottom:-9px;height:2px;border-radius:2px;background:var(--amber);box-shadow:0 0 10px var(--amber)}
.tgrp.ref a{font-size:var(--fs-label);height:30px;padding:0 10px;color:#8d96a7}
.tgrp.ref a.on{color:#ffc18e}
.divider{flex:none;width:1px;height:22px;background:var(--line);margin:12px 8px 0}
.cnt{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--amber);color:#1b1006;font:700 var(--fs-min)/18px var(--mono)}
.tool-right{margin-left:auto;display:flex;gap:10px;align-items:center}
.live{display:inline-flex;gap:7px;align-items:center;font-size:var(--fs-label);color:var(--mint);white-space:nowrap}
.live i{position:relative;width:7px;height:7px;border-radius:50%;background:var(--mint);box-shadow:0 0 8px var(--mint)}
.live i:before{content:"";position:absolute;inset:-4px;border-radius:50%;border:1px solid var(--mint);opacity:0;animation:ov-heartbeat 2.4s ease-out infinite}
.live.live-pulse i:after{content:"";position:absolute;inset:-9px;border-radius:50%;border:1px solid var(--mint);animation:ov-live-read .5s ease-out}
.live.offline{color:var(--red)}.live.offline i{background:var(--red);box-shadow:0 0 8px var(--red)}.live.offline i:before{display:none}
.live .mono{font-family:var(--mono);color:var(--muted)}
.tele{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:10px;padding-top:8px;border-top:1px solid var(--line);font-size:var(--fs-min);color:var(--muted);font-family:var(--mono)}
.tele .hb{display:inline-flex;align-items:center;gap:6px}.tele .hb svg{width:14px;height:14px}
.tele .hb circle.base{fill:none;stroke:rgba(153,215,188,.25);stroke-width:2}
.tele .hb circle.arc{fill:none;stroke:var(--mint);stroke-width:2;stroke-dasharray:31.4;stroke-dashoffset:31.4;transform:rotate(-90deg);transform-origin:50% 50%;animation:hbarc 5s linear infinite}
@keyframes hbarc{to{stroke-dashoffset:0}}
.tele .cd,.tele b{color:var(--text);font-weight:500}
.spark{height:18px;width:96px;vertical-align:middle}.spark polyline{fill:none;stroke:var(--cool);stroke-width:1.2}.spark .today{stroke:var(--amber);filter:drop-shadow(0 0 3px rgba(232,141,79,.5))}
.skip{position:absolute;left:-9999px;top:8px;z-index:90;padding:8px 14px;border-radius:9px;background:#15171d;border:1px solid var(--mint);color:var(--mint);font-size:var(--fs-sub);text-decoration:none}.skip:focus{left:16px}
.desk-foot{max-width:1776px;margin:6px auto 0;padding:10px 36px 22px;display:flex;gap:20px;flex-wrap:wrap;color:#8b93a1;font:var(--fs-min) var(--mono)}.desk-foot b{font-weight:400;color:#abb4c2}
/* 紀錄分頁三個篩選：決定（即決定紀錄）／全部事件／全部工作 */
.logf-bar{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0 10px}
.logf-bar a{display:inline-flex;align-items:center;height:30px;padding:0 12px;border:1px solid var(--line);border-radius:9px;font-size:var(--fs-sub);color:var(--muted);text-decoration:none;transition:border-color .2s}
.logf-bar a:hover{border-color:rgba(255,255,255,.3);color:var(--text)}
.logf-bar a.on{border-color:var(--mint);color:var(--mint);background:rgba(153,215,188,.07)}
@keyframes ov-bar-run{from{background-position:100% 0;filter:brightness(2)}to{background-position:0 0}}
@keyframes ov-plus{0%{opacity:0;transform:translateY(8px)}20%{opacity:1}100%{opacity:0;transform:translateY(-12px)}}
@keyframes ov-live-read{0%{transform:scale(.5);opacity:.9}100%{transform:scale(1.5);opacity:0}}
@keyframes ov-heartbeat{0%{transform:scale(.6);opacity:.7}30%{transform:scale(1.7);opacity:0}100%{opacity:0}}
/* 按鈕、標記 */
.btn{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 13px;border-radius:9px;border:1px solid var(--line);color:var(--text);font-size:var(--fs-sub);cursor:pointer;white-space:nowrap;transition:border-color .2s,transform .18s,box-shadow .2s;background:rgba(255,255,255,.02)}
.btn:hover{border-color:rgba(255,255,255,.35);transform:translateY(-1px)}
.btn:active{transform:scale(.97)}
.btn.primary{border-color:rgba(232,141,79,.8);color:#ffd3ae;background:linear-gradient(180deg,rgba(232,141,79,.22),rgba(232,141,79,.08));box-shadow:0 0 0 1px rgba(232,141,79,.15) inset,0 6px 18px rgba(232,141,79,.12)}
.btn.primary:hover{box-shadow:0 0 0 1px rgba(232,141,79,.3) inset,0 8px 24px rgba(232,141,79,.22)}
.btn.small{height:28px;font-size:var(--fs-label);padding:0 10px}
.btn.big{height:42px;padding:0 20px;font-size:var(--fs-body);font-weight:600}
.btn.link{border:0;padding:0;height:auto;color:var(--amber);text-decoration:underline;text-underline-offset:3px;background:none;box-shadow:none}
.btn[disabled]{opacity:.5;cursor:default;transform:none}
.btn[aria-pressed="true"]{border-color:rgba(153,215,188,.5)}
.btn:focus-visible,.opt:focus-visible,.chip:focus-visible,.tabs a:focus-visible,.metric:focus-visible{outline:2px solid var(--mint);outline-offset:2px}
.tag{display:inline-flex;align-items:center;gap:4px;font-size:var(--fs-label);line-height:1;padding:3px 7px;border-radius:6px;border:1px solid var(--line);color:var(--muted);white-space:nowrap}
.tag.qdone{background:var(--mint);border-color:var(--mint);color:#0b1a13;font-weight:700}
.tag.mine,.tag.mint{border-color:rgba(153,215,188,.65);color:var(--mint)}
.tag.eff,.tag.red{border-color:rgba(242,162,158,.6);color:var(--red)}
.tag.ai,.tag.amber{border-color:var(--amber);color:var(--amber)}
.tag.qn,.tag.fill{background:var(--amber);border-color:var(--amber);color:#1b1006;font-weight:700}
.badge-ai{display:inline-flex;align-items:center;font-size:var(--fs-min);line-height:1;padding:3px 6px;margin-left:6px;border:1px solid var(--amber);color:var(--amber);border-radius:5px;white-space:nowrap;vertical-align:1px}
/* 卡（玻璃層、頂緣高光；外框平時靜止，決定二十六）；進場只喺開頁或轉分頁時播一次 */
.layer,.panel{position:relative;background:var(--panel);background-image:var(--glass);border:1px solid rgba(255,255,255,.08);border-radius:var(--r-card);box-shadow:0 1px 0 rgba(255,255,255,.04) inset,0 18px 40px -24px rgba(0,0,0,.8);animation:cardin .5s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i,0)*35ms)}
.layer{padding:16px 20px;margin-top:12px}
.layer:after,.panel:after{content:"";position:absolute;left:14px;right:14px;top:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.18),transparent);pointer-events:none}
body.settled .layer,body.settled .panel,body.settled .hero{animation:none}
@keyframes cardin{from{transform:translateY(10px) scale(.992)}to{transform:none}}
.layer-title{display:block;font-size:var(--fs-title);font-weight:600;margin:3px 0 0;line-height:1.35}
.hero{position:relative;margin-top:12px;border:1px solid rgba(232,141,79,.45);border-radius:var(--r-card);padding:18px 22px;background:linear-gradient(135deg,rgba(232,141,79,.11),rgba(14,15,19,.93) 60%);box-shadow:0 1px 0 rgba(255,255,255,.05) inset,0 24px 60px -30px rgba(232,141,79,.35);animation:cardin .5s cubic-bezier(.2,.8,.2,1) both}
.hero-t{font-size:var(--fs-page);font-weight:650;margin:4px 0;line-height:1.35}
.hero-p{font-size:var(--fs-sub);color:var(--muted);margin:0 0 14px}
.hero-act{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.dq{background:var(--panel);background-image:var(--glass);border:1px solid var(--line);border-left:3px solid var(--amber);border-radius:12px;padding:14px 16px;margin-top:10px}
.dq.done{border-left-color:var(--mint)}
.dq:focus{outline:none}
.dq-head{display:flex;gap:10px;align-items:center}
.dq-n{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font:600 var(--fs-min) var(--mono);background:rgba(255,255,255,.07);color:var(--muted);flex:none}
.dq-q{font-size:var(--fs-title);font-weight:600;flex:1;line-height:1.45}
.opt{all:unset;box-sizing:border-box;display:flex;gap:9px;align-items:flex-start;width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:7px;margin-top:6px;cursor:pointer;font-size:var(--fs-body);line-height:1.5}
.opt:hover{border-color:var(--text)}
.opt.cur{border-color:rgba(153,215,188,.6);background:rgba(153,215,188,.06)}
.opt .dot{width:9px;height:9px;border-radius:50%;border:1px solid var(--muted);margin-top:6px;flex:none}
.opt.cur .dot{background:var(--mint);border-color:var(--mint)}
.chip{all:unset;box-sizing:border-box;cursor:pointer;padding:6px 12px;border:1px dashed rgba(255,255,255,.28);border-radius:999px;font-size:var(--fs-sub);color:var(--text)}
.chip:hover{border-color:var(--text)}
.chip.on{border:1px solid var(--mint);color:var(--mint);background:rgba(153,215,188,.1);font-weight:600}
.track{margin-top:14px;border:1px solid rgba(153,215,188,.35);border-left:3px solid var(--mint);border-radius:12px;background:var(--panel);padding:12px 16px;font-size:var(--fs-sub)}
.track.bad{border-color:rgba(242,162,158,.45);border-left-color:var(--red)}
.track.off{border-color:rgba(239,179,127,.45);border-left-color:var(--wait)}
.track h3{margin:2px 0 4px;font-size:var(--fs-title)}
.tr-steps{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}
.tr-steps li{display:flex;gap:10px;align-items:flex-start}
.tr-ic{width:22px;height:22px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:var(--fs-min);border:1px solid var(--line);color:var(--muted);margin-top:1px}
.tr-ic.done{background:rgba(153,215,188,.14);border-color:var(--mint);color:var(--mint)}
.tr-ic.running{border-color:var(--amber);color:var(--amber);animation:blink 1.6s infinite}
.tr-ic.failed{border-color:var(--red);color:var(--red)}
.tr-sub{display:block;font-size:var(--fs-label);color:var(--muted)}
.cbar{position:fixed;left:0;right:0;bottom:0;z-index:20;background:rgba(9,10,14,.95);border-top:1px solid var(--line);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.cbar-in{max-width:1776px;margin:0 auto;padding:10px 36px;display:flex;align-items:center;gap:12px;justify-content:space-between}
.prog{flex:1;min-width:0}
.prog-top{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:var(--fs-sub)}
.prog-bar{height:6px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:7px}
.prog-bar i{display:block;height:100%;background:var(--amber);border-radius:999px;transition:width .3s}
.prog-bar.full i{background:var(--mint)}
.backdrop{position:fixed;inset:0;z-index:40;background:rgba(3,4,8,.74);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px}
.modal{width:min(620px,100%);max-height:calc(100vh - 40px);display:flex;flex-direction:column;background:#0e0f13;border:1px solid var(--line);border-radius:17px;box-shadow:0 24px 100px rgba(0,0,0,.63)}
.m-head{padding:16px 20px 6px}
.m-head h3{margin:3px 0 2px;font-size:var(--fs-title)}
.m-body{overflow:auto;padding:8px 20px 12px}
.m-foot{display:flex;gap:8px;justify-content:flex-end;padding:12px 20px;border-top:1px solid var(--line);flex-wrap:wrap}
.m-sum{margin:0;padding-left:18px;font-size:var(--fs-sub);line-height:1.6}
.m-sum li{margin:6px 0}
pre.file{font:var(--fs-label)/1.5 var(--mono);white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto;background:rgba(0,0,0,.32);border:1px solid var(--line);border-radius:7px;padding:10px;margin:6px 0 0}
.toast{position:fixed;left:50%;transform:translateX(-50%);bottom:88px;z-index:60;max-width:min(560px,calc(100% - 32px));background:#15171d;border:1px solid var(--line);border-radius:12px;padding:10px 14px;font-size:var(--fs-sub);box-shadow:0 10px 40px rgba(0,0,0,.56)}
.flash{outline:2px solid var(--amber);outline-offset:4px;border-radius:12px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.basis{font-size:var(--fs-label);color:var(--muted);margin-top:6px}
.one{color:var(--text);opacity:.86;margin:0;font-size:var(--fs-sub)}
@keyframes blink{50%{opacity:.35}}
/* 暫停動效、減少動態：一律停 */
body.paused *,body.paused *:before,body.paused *:after{animation-play-state:paused!important}
body.paused .bg *{animation:none!important}
@media (max-width:1200px){.ident .one{display:none}}
@media (max-width:600px){
  .shell{padding:12px 16px}
  h1{font-size:var(--fs-page)}
  .mark{width:44px;height:44px}
  .dtop{gap:10px}
  .metrics{flex-direction:column;gap:6px;margin-left:0;width:100%}
  .metric{min-width:0}
  .tool-right{margin-left:0;flex-wrap:wrap}
  .layer{padding:14px 14px}
  .btn{height:44px}
  .btn.small{height:36px}
  .btn.big{height:48px}
  .hero{padding:16px 14px}
  .hero-act .btn.primary{display:none}
  .opt{min-height:44px;align-items:center}
  .opt .dot{margin-top:0}
  .chip{padding:10px 14px}
  .dq{padding:14px 12px}
  .prog-top{flex-wrap:nowrap}
  .cbar-in{padding:10px 16px;flex-direction:column;align-items:stretch;gap:6px}
  .backdrop{padding:0;align-items:stretch}
  .modal{width:100%;max-height:none;height:100%;border-radius:0;border:0}
  .toast{bottom:120px}
}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;
  // 共用樣式放喺最前，頁面自己嘅樣式（包括手機版調整）喺後面可以覆蓋
  var style = document.createElement('style');
  style.setAttribute('data-desk', '');
  style.textContent = CSS;
  document.head.insertBefore(style, document.head.firstChild);
  var REDUCED = g.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, attrs) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k === 'cls' ? 'class' : k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      [].concat(c).forEach(function (x) { if (x != null && x !== false) e.append(x.nodeType ? x : document.createTextNode(String(x))); });
    }
    return e;
  }
  function clip(x, n) { x = String(x || ''); return x.length > n ? x.slice(0, n - 1) + '…' : x; }
  var WD = ['日', '一', '二', '三', '四', '五', '六'];

  /* ---------- 九個分頁三組（規劃書 4.1）；網址照舊，舊深連繼續用得 ---------- */
  var GROUPS = [['navDo', ['pending', 'inputs', 'company']], ['navRun', ['overview', 'brain', 'path']], ['navRef', ['team', 'log', 'system'], 'ref']];
  var HREF = { pending: '/', inputs: '/dashboard/inputs', company: '/proofread.html', overview: '/dashboard', brain: '/dashboard/brain', path: '/dashboard/path', team: '/dashboard/team', log: '/dashboard/log', system: '/dashboard/system' };
  function tabName(t) { return t === 'pending' || t === 'company' ? U[t] : D[t]; }
  // Founder Desk 畫面（ask.html／proofread.html）屬邊個分頁：答題、交要求、交資料、設定、決定紀錄、練習、辯論
  var PAGE = { pending: ['pending'], request: ['inputs'], company: ['company'], intake: ['company', U.intake], log: ['log', D.logDecisions], setup: ['system', U.setup], practice: ['brain', U.practice], debate: ['brain', U.debate] };

  /* ---------- 狀態：暫停動效、特效開關（同一部電腦記住） ---------- */
  var ST = { paused: !!REDUCED, fx: true, conn: 'live', readAt: Date.now(), data: null, provider: false, pending: null, cbs: { pause: [], fx: [], refresh: [] } };
  try { if (localStorage.getItem('sos-dash-paused') === '1') ST.paused = true; if (localStorage.getItem('sos-fx') === '0') ST.fx = false; } catch (e) { }
  function bodyFlags() { if (document.body) document.body.classList.toggle('paused', !!ST.paused); }

  /* ---------- 數字滾動（每位一條 0–9 直條，由右至左每位延遲 60ms；首次由 0 滾入；同一分頁階段記住上次值，轉分頁唔會重新滾） ---------- */
  var ODO = {};
  try { ODO = JSON.parse(sessionStorage.getItem('sos-odo') || '{}') || {}; } catch (e) { ODO = {}; }
  function odo(key, value) {
    var s = String(value), prev = ODO[key], first = prev === undefined, chars = Array.from(s), pchars = Array.from(prev == null ? '' : prev);
    var box = el('span', { cls: 'odobox', role: 'img', 'aria-label': s, 'data-odo': key });
    chars.forEach(function (ch, j) {
      if (!/\d/.test(ch)) { box.append(el('span', { cls: 'odoc' }, ch)); return; }
      var o = el('span', { cls: 'odo', 'aria-hidden': 'true' }), strip = el('span', { cls: 'strip' });
      for (var d = 0; d < 10; d++) strip.append(el('i', null, String(d)));
      var still = ST.paused || REDUCED, to = Number(ch), from = still ? to : first ? 0 : (/\d/.test(pchars[j] || '') ? Number(pchars[j]) : 0);
      strip.style.transition = 'none'; strip.style.transform = 'translateY(-' + from * 1.15 + 'em)'; o.append(strip); box.append(o);
      if (from !== to) requestAnimationFrame(function () { requestAnimationFrame(function () { strip.style.transition = ''; strip.style.transitionDelay = (chars.length - 1 - j) * 60 + 'ms'; strip.style.transform = 'translateY(-' + to * 1.15 + 'em)'; }); });
    });
    ODO[key] = s;
    try { sessionStorage.setItem('sos-odo', JSON.stringify(ODO)); } catch (e) { }
    return box;
  }
  // 就地更新一個指標：值冇變就唔郁；變咗先滾動，再播底線（同本季目標增加時「+1」上浮）
  function setOdo(key, value) {
    var box = document.querySelector('[data-odo="' + key + '"]'); if (!box) return;
    var s = String(value), prev = ODO[key];
    if (prev === s) return;
    var up = /^\d+/.test(s) && /^\d+/.test(prev || '') && parseInt(s, 10) > parseInt(prev, 10);
    box.replaceWith(odo(key, s));
    var m = document.querySelector('[data-odo="' + key + '"]'); m = m && m.closest('.metric');
    if (m && !ST.paused && !REDUCED) { m.classList.remove('bump'); void m.offsetWidth; m.classList.add('bump'); setTimeout(function () { m.classList.remove('bump'); }, 600); if (key === 'done' && up) { m.classList.remove('plus-on'); void m.offsetWidth; m.classList.add('plus-on'); setTimeout(function () { m.classList.remove('plus-on'); }, 1300); } }
  }

  /* ---------- 頁頭：標誌、公司名、一句話、三個業務指標 ---------- */
  function qText(q) { return q && q.total ? q.done + '／' + q.total : '—'; }
  function inSmall(mt) { return D.unprocessed + (mt.nextInterview ? ' · ' + D.mNextInterview + ' 週' + WD[new Date(mt.nextInterview.slice(0, 10) + 'T00:00:00').getDay()] : '') + (mt.repliesWaiting ? ' · ' + D.repliesWaiting.replace('{k}', mt.repliesWaiting) : ''); }
  function metricsNav(mt) {
    mt = mt || {}; var q = mt.quarter || {};
    return el('nav', { cls: 'metrics', 'aria-label': D.metricsL },
      el('a', { cls: 'metric', href: HREF.path, 'data-metric': 'quarter' }, el('label', null, D.mQuarter), el('strong', null, odo('done', qText(q))), el('small', { 'data-m': 'quarterText' }, q.text ? clip(q.text, 26) : D.noQuarter), el('span', { cls: 'plus', 'aria-hidden': 'true' }, '+1')),
      el('a', { cls: 'metric', href: HREF.pending, 'data-metric': 'pending' }, el('label', null, D.mPending), el('strong', null, odo('pending', String(mt.pending || 0))), el('small', { 'data-m': 'pendingText' }, mt.pending ? U.pending : D.noPendingShort)),
      el('a', { cls: 'metric', href: HREF.inputs, 'data-metric': 'inputs' }, el('label', null, D.mInputs), el('strong', null, odo('inbox', String(mt.inbox || 0))), el('small', { 'data-m': 'inputsText' }, inSmall(mt))));
  }
  function tabLink(t, cur, counts) {
    var n = counts[t] || 0, on = t === cur;
    return el('a', { href: HREF[t], cls: on ? 'on' : null, 'aria-current': on ? 'page' : null, 'data-tab': t }, tabName(t),
      n ? el('span', { cls: 'cnt' + (t === 'pending' ? ' desk-count' : ''), 'data-cnt': t, title: t === 'brain' ? D.bs_waiting : null }, String(n)) : null);
  }
  function nav(cur, counts) {
    var parts = [];
    GROUPS.forEach(function (gp, i) {
      if (i) parts.push(el('span', { cls: 'divider', 'aria-hidden': 'true' }));
      parts.push(el('div', { cls: 'tgrp' + (gp[2] ? ' ' + gp[2] : ''), role: 'group', 'data-name': D[gp[0]], 'aria-label': D[gp[0]], 'data-grp': gp[0] }, gp[1].map(function (t) { return tabLink(t, cur, counts || {}); })));
    });
    return el('nav', { cls: 'tabs desk-nav', 'aria-label': D.shell }, parts);
  }
  function liveBadge() {
    var bad = ST.conn !== 'live';
    return el('span', { cls: 'live' + (bad ? ' offline' : ''), id: 'conn', role: 'status' }, el('i'), ST.conn === 'live' ? D.live : ST.conn === 'rejected' ? D.rejected : D.offline);
  }
  function toolbar(cur, counts) {
    return el('div', { cls: 'toolbar' }, nav(cur, counts),
      el('div', { cls: 'tool-right' }, liveBadge(),
        el('button', { type: 'button', cls: 'btn small', id: 'refresh-now', title: D.refreshNow, onclick: refreshNow }, D.refreshNow),
        el('button', { type: 'button', cls: 'btn small', id: 'fx', 'aria-pressed': ST.fx ? 'true' : 'false', onclick: toggleFx }, ST.fx ? D.fxOn : D.fxOff),
        el('button', { type: 'button', cls: 'btn small', id: 'pause', 'aria-pressed': ST.paused ? 'true' : 'false', onclick: togglePause }, ST.paused ? D.resume : D.pause)));
  }
  function toast(t) { var e = document.getElementById('toast'); if (!e) return; e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { e.hidden = true; }, 4000); }
  function togglePause() {
    if (REDUCED) { toast(D.reducedNote); return; }
    ST.paused = !ST.paused;
    try { localStorage.setItem('sos-dash-paused', ST.paused ? '1' : '0'); } catch (e) { }
    bodyFlags(); syncButtons();
    ST.cbs.pause.forEach(function (f) { f(ST.paused); });
  }
  function toggleFx() {
    ST.fx = !ST.fx;
    try { localStorage.setItem('sos-fx', ST.fx ? '1' : '0'); } catch (e) { }
    syncButtons();
    ST.cbs.fx.forEach(function (f) { f(ST.fx); });
  }
  function syncButtons() {
    var p = document.getElementById('pause'); if (p) { p.textContent = ST.paused ? D.resume : D.pause; p.setAttribute('aria-pressed', ST.paused ? 'true' : 'false'); }
    var f = document.getElementById('fx'); if (f) { f.textContent = ST.fx ? D.fxOn : D.fxOff; f.setAttribute('aria-pressed', ST.fx ? 'true' : 'false'); }
  }
  function refreshNow() {
    if (ST.cbs.refresh.length) ST.cbs.refresh.forEach(function (f) { f(); });
    else poll(true);
  }

  // o: { tab | page, sub, company, metrics, pending, brainWaiting, sim, sample, since(節點) }
  function shell(o) {
    o = o || {};
    var pg = o.tab ? [o.tab, o.sub] : (PAGE[o.page] || ['pending']), cur = pg[0], sub = o.sub || pg[1];
    var d = ST.data || {}, c = o.company || d.company || {}, mt = o.metrics || d.metrics;
    if (o.pending != null) ST.pending = o.pending;
    var counts = { pending: o.pending != null ? o.pending : (mt ? mt.pending : 0), brain: o.brainWaiting != null ? o.brainWaiting : brainWaiting(d) };
    var simText = o.sim && o.sim.clock ? U.simBadge + ' · ' + U.simClock + ' ' + o.sim.clock : U.simBadge;
    var box = el('div', { cls: 'desk-head', id: 'desk-head' },
      el('a', { cls: 'skip', href: '#app' }, D.skipToContent),
      el('header', { cls: 'dtop' },
        el('div', { cls: 'ident' },
          el('div', { cls: 'mark', 'aria-hidden': 'true' }, c.initials || String(c.name || 'OS').slice(0, 2)),
          el('div', null,
            el('span', { cls: 'eyebrow' }, D.shell + ' · ' + tabName(cur) + (sub ? ' · ' + sub : '')),
            el('h1', null, c.name || D.shell),
            c.oneLiner ? el('p', { cls: 'one' }, c.oneLiner) : null,
            o.basis ? el('div', { cls: 'basis' }, o.basis) : null)),
        metricsNav(mt)),
      o.sample ? el('div', { cls: 'banner', id: 'sample' }, D.sample) : null,
      // 模擬實例：每頁都標明唔係生意證據（設計稿第 8 節）
      o.sim ? el('div', { cls: 'banner desk-sim', id: 'sim-badge', role: 'note' }, simText) : null,
      toolbar(cur, counts),
      o.since || null);
    // 直接開檔（file://，例如校對頁測試）唔讀伺服器
    if (!mt && /^https?:$/.test(location.protocol)) poll();
    mountFoot();
    settleSoon();
    return box;
  }
  // 紀錄分頁三個篩選（規劃書 4.1）；決定篩選就係決定紀錄
  function logFilters(cur) {
    var F = [['decisions', D.logDecisions, '/#/log'], ['events', D.logAll, '/dashboard/log'], ['work', D.logWork, '/dashboard/log?f=work']];
    return el('nav', { cls: 'logf-bar', 'aria-label': D.log, id: 'log-filters' }, F.map(function (f) { var on = f[0] === cur; return el('a', { cls: on ? 'on' : null, href: f[2], 'aria-current': on ? 'page' : null, 'data-logf': f[0] }, f[1]); }));
  }
  function brainWaiting(d) { return ((d.brain || {}).items || []).filter(function (x) { return x.status === 'waiting'; }).length; }
  /* ---------- 即時微動畫一行：讀回心跳、下次 AI 開工倒數、今日 AI 啟動、用時、費用（真數據；每秒用本機時鐘重算倒數） ---------- */
  function hbRing() { var NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 14 14'); s.setAttribute('aria-hidden', 'true'); ['base', 'arc'].forEach(function (k) { var c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', '7'); c.setAttribute('cy', '7'); c.setAttribute('r', '5'); c.setAttribute('class', k); s.append(c); }); return s; }
  function cd(iso) { var t = Date.parse(iso || ''); if (!t) return '—'; var s = Math.max(0, Math.round((t - Date.now()) / 1000)); return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
  function teleParts(t) { t = t || {}; return [D.startsTodayL.replace('{a}', t.starts || 0).replace('{b}', t.cap || '—'), D.minutesTodayL.replace('{n}', t.minutes || 0), t.usd != null ? D.costTodayL.replace('{x}', Number(t.usd).toFixed(2)) : null].filter(Boolean).join(' · '); }
  function aiTele() {
    var t = (ST.data || {}).tele;
    return el('div', { cls: 'tele', 'data-tele': 'ai' }, el('span', { cls: 'hb' }, hbRing(), el('span', { 'data-hb': '1' }, D.readAgo.replace('{n}', '0'))), el('span', null, D.nextRunL + ' ', el('b', { cls: 'cd', 'data-cd': t ? t.nextRunAt : '' }, t ? cd(t.nextRunAt) : '—')), el('span', { 'data-tele-parts': '1' }, t ? teleParts(t) : ''));
  }
  // 舊介面（ask.html／proofread.html）：header({ page, company, pending, sim, basis, nav })
  function header(o) { return shell({ page: o.page, company: o.company, pending: o.pending, sim: o.sim, basis: o.basis }); }
  function title(page, extra) { var pg = PAGE[page] || [page]; document.title = (extra ? extra + ' · ' : '') + (tabName(pg[0]) || pg[0]) + ' · ' + D.shell; }

  /* ---------- 就地更新（每次讀回）：指標、分頁徽章、連線徽章；唔重畫頁面 ---------- */
  function update(d) {
    if (!d) return;
    ST.data = d; ST.conn = 'live'; ST.readAt = Date.now();
    var mt = d.metrics || {}, q = mt.quarter || {};
    setOdo('done', qText(q)); setOdo('pending', String(mt.pending || 0)); setOdo('inbox', String(mt.inbox || 0));
    var qs = document.querySelector('[data-m="quarterText"]'); if (qs) qs.textContent = q.text ? clip(q.text, 26) : D.noQuarter;
    var ps = document.querySelector('[data-m="pendingText"]'); if (ps) ps.textContent = mt.pending ? U.pending : D.noPendingShort;
    var is = document.querySelector('[data-m="inputsText"]'); if (is) is.textContent = inSmall(mt);
    setCount('brain', brainWaiting(d));
    if (d.sample && !document.getElementById('sample')) { var top = document.querySelector('.dtop'); if (top) top.after(el('div', { cls: 'banner', id: 'sample' }, D.sample)); }
    if (ST.pending == null) setCount('pending', mt.pending || 0);
    [].forEach.call(document.querySelectorAll('[data-tele]'), function (e) { var c = e.querySelector('[data-cd]'), p = e.querySelector('[data-tele-parts]'), t = d.tele || {}; if (c) c.setAttribute('data-cd', t.nextRunAt || ''); if (p) { var s = teleParts(t); if (p.textContent !== s) p.textContent = s; } });
    footData(d);
    setConn('live'); livePulse();
  }
  function setCount(t, n) {
    var a = document.querySelector('.tabs a[data-tab="' + t + '"]'); if (!a) return;
    var c = a.querySelector('.cnt');
    if (!n) { if (c) c.remove(); return; }
    if (c) { if (c.textContent !== String(n)) c.textContent = String(n); }
    else a.append(el('span', { cls: 'cnt' + (t === 'pending' ? ' desk-count' : ''), 'data-cnt': t }, String(n)));
  }
  function setConn(s) {
    ST.conn = s;
    var b = document.getElementById('conn'); if (!b) return;
    var want = s === 'live' ? D.live : s === 'rejected' ? D.rejected : D.offline;
    b.classList.toggle('offline', s !== 'live');
    if (b.lastChild && b.lastChild.nodeType === 3) { if (b.lastChild.textContent !== want) b.lastChild.textContent = want; } else b.append(want);
  }
  function livePulse() { var b = document.getElementById('conn'); if (!b || ST.paused || REDUCED) return; b.classList.remove('live-pulse'); void b.offsetWidth; b.classList.add('live-pulse'); setTimeout(function () { b.classList.remove('live-pulse'); }, 520); }
  // 每秒：「讀回 n 秒前」（本機時鐘，唔打網路）
  setInterval(function () {
    var s = Math.max(0, Math.round((Date.now() - ST.readAt) / 1000));
    [].forEach.call(document.querySelectorAll('[data-hb]'), function (e) { var t = D.readAgo.replace('{n}', s); if (e.textContent !== t) e.textContent = t; });
    [].forEach.call(document.querySelectorAll('[data-cd]'), function (e) { var t = cd(e.getAttribute('data-cd')); if (e.textContent !== t) e.textContent = t; });
  }, 1000);

  /* ---------- 冇自己讀回嘅頁（Founder Desk 畫面）：每 5 秒讀一次頁頭資料，只更新頁頭 ---------- */
  var pollTimer = null, polling = false;
  function poll(now) {
    if (ST.provider || polling) return;
    clearTimeout(pollTimer);
    var run = function () {
      if (ST.provider) return;
      if (document.hidden) { pollTimer = setTimeout(run, 5000); return; }
      polling = true;
      fetch('/api/shell', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then(function (j) { polling = false; if (j && j.ok) update(j); pollTimer = setTimeout(run, 5000); })
        .catch(function () { polling = false; setConn('offline'); pollTimer = setTimeout(run, 5000); });
    };
    if (now || !ST.data) run(); else pollTimer = setTimeout(run, 5000);
  }
  // 頁面自己每 5 秒讀 /api/dashboard（監察台）：由頁面餵資料，殼唔再自己讀
  function provide() { ST.provider = true; clearTimeout(pollTimer); }

  /* ---------- 進場只播一次：第一次畫好之後加 body.settled（之後同頁讀回就地更新，唔會成頁彈一下） ---------- */
  var settleTimer = null;
  function settleSoon() { if (settleTimer || !document.body) return; settleTimer = setTimeout(function () { document.body.classList.add('settled'); }, 900); }

  /* ---------- 頁腳一行：版本 · 狀態更新 · 最後讀回（每秒用本機時鐘更新） ---------- */
  function hm(iso) { var m = /T(\d{2}:\d{2})/.exec(String(iso || '')); return m ? m[1] : '—'; }
  function mountFoot() {
    if (document.getElementById('desk-foot') || !document.body) return;
    document.body.append(el('footer', { cls: 'desk-foot', id: 'desk-foot' }, el('span', null, D.footVersion + ' ', el('b', { 'data-foot': 'version' }, '—')), el('span', null, D.footRev + ' ', el('b', { 'data-foot': 'rev' }, '—')), el('span', null, el('b', { 'data-hb': '1' }, D.readAgo.replace('{n}', '0')))));
    if (ST.data) footData(ST.data);
  }
  function footData(d) {
    var v = document.querySelector('[data-foot="version"]'), r = document.querySelector('[data-foot="rev"]'), f = d.freshness || (d.deck && d.deck.freshness) || {};
    if (v && d.version) v.textContent = String(d.version).replace(/^.*-/, '');
    if (r) r.textContent = hm(f.ledgerAt);
  }
  /* ---------- 背景層（氣氛層）：每頁一份 ---------- */
  function mountBg() {
    if (!document.body || document.querySelector('body > .bg')) return;
    var bg = el('div', { cls: 'bg', 'aria-hidden': 'true' }, ['aurora a1', 'aurora a2', 'plane', 'grid', 'sweep', 'depth', 'grain'].map(function (k) { return el('div', { cls: k }); }));
    document.body.insertBefore(bg, document.body.firstChild);
    bodyFlags();
  }
  if (document.body) mountBg(); else document.addEventListener('DOMContentLoaded', mountBg);

  g.SOS_DESK = {
    shell: shell, header: header, title: title, nav: function (page, pending) { return toolbar((PAGE[page] || [page])[0], { pending: pending || 0 }); },
    logFilters: logFilters, aiTele: aiTele, update: update, setConn: setConn, livePulse: livePulse, provide: provide, odo: odo, setOdo: setOdo, toast: toast,
    paused: function () { return !!ST.paused; }, fx: function () { return !!ST.fx; }, reduced: !!REDUCED,
    onPause: function (f) { ST.cbs.pause.push(f); }, onFx: function (f) { ST.cbs.fx.push(f); }, onRefresh: function (f) { ST.cbs.refresh.push(f); },
    readNow: function () { ST.readAt = Date.now(); }, tabs: GROUPS, href: HREF, tabName: tabName
  };
})(globalThis);
