/*
  canoPi workspace: UI preview (React, single file)

  Layout is the approved one. This pass only changes colour, type and surface treatment
  (Midnight Sky / Cloud Light tokens from canopi-workspace.html, glass panels) and adds:
  Home dashboard, "Open project", "New session", and tree guide lines for session -> agents.

  Everything here is SIMULATED. Nothing is run by OMP, ConPTY or WebView2.

  Moving this into packages/desktop:
  - GSAP: this file loads it from cdnjs so it also runs in a sandbox. In the repo replace useGsap() with
      import { gsap } from 'gsap';   (and drop loadGsap)
  - Fonts: Crimson Text, Plus Jakarta Sans, IBM Plex Mono. @import below works online; in Tauri bundle them
      with @fontsource/* so the app works offline.
  - Open project: openFolder() uses <input webkitdirectory> in a browser. In Tauri call
      open({ directory: true }) from @tauri-apps/plugin-dialog instead.
  - Icons: lucide-react.
*/
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, createContext, useContext } from 'react';
import {
  Folder, FolderOpen, SquarePen, Search, Kanban, Globe, Terminal, Settings, Sun, Moon, Menu, X, Plus,
  ChevronRight, ChevronDown, ChevronUp, Columns2, Maximize2, Minimize2, ArrowLeft, ArrowRight, ArrowUp,
  RotateCw, CirclePlay, Clock, Eye, CircleCheck, CircleX, Square, Circle, Unplug, FileText, Pencil, ListChecks, Users, FolderPlus
} from 'lucide-react';

const CSS = `@import url('https://fonts.googleapis.com/css2?family=Crimson+Text:ital,wght@0,400;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
.cp{--font-sans:'Plus Jakarta Sans',system-ui,'Segoe UI',sans-serif;
  --font-serif:'Crimson Text','Iowan Old Style',Georgia,serif;
  --font-mono:'IBM Plex Mono',Consolas,'Cascadia Mono',monospace;
  --bg-app:#101F25; --bg-panel:#192D35; --bg-soft:#213740; --bg-hover:#2A4650; --bg-selected:#294550;
  --border:#314C55; --border-strong:#45636C;
  --text:#ECF5F6; --text-2:#B4CBD0; --text-3:#89A6AE;
  --accent:#8CCDD5; --accent-2:#6AB4C1; --accent-soft:#21464E; --accent-ink:#0C1B20;
  --ok:#9FCBB5; --bad:#E6A0A7; --warn:#E5CB94;
  --term-bg:#102027; --term-fg:#E0EFF2; --term-dim:#87A8B0; --term-prompt:#89CED5; --term-err:#E7A5AD;
  --glass:rgba(25,45,53,.58); --glass-2:rgba(33,55,64,.55); --glass-3:rgba(42,70,80,.45);
  --glass-line:rgba(236,245,246,.09); --glass-hi:rgba(236,245,246,.07);
  --blur:blur(18px) saturate(140%);
  --scrim:rgba(6,13,16,.62); --shadow:0 18px 50px rgba(0,0,0,.45);
  --hero:rgba(140,205,213,.30); --line:rgba(180,203,208,.28);
  --mesh:radial-gradient(900px 520px at 10% -8%,rgba(140,205,213,.22),transparent 62%),radial-gradient(760px 520px at 98% 0%,rgba(106,180,193,.17),transparent 60%),radial-gradient(900px 600px at 55% 118%,rgba(42,70,80,.6),transparent 62%);
  --r:8px; --r2:12px; --r3:18px;
  color-scheme:dark;
  position:relative;height:100vh;height:100dvh;overflow:hidden;isolation:isolate;
  background:var(--mesh),var(--bg-app);color:var(--text);
  font:400 14px/1.5 var(--font-sans);-webkit-font-smoothing:antialiased;letter-spacing:0;}
.cp[data-theme="light"]{--bg-app:#EDF6F8; --bg-panel:#FCFEFE; --bg-soft:#F0F8F9; --bg-hover:#E8F3F5; --bg-selected:#DCEFF2;
  --border:#DAE8EB; --border-strong:#BDD5DB;
  --text:#19333D; --text-2:#506F78; --text-3:#678790;
  --accent:#277986; --accent-2:#479DAA; --accent-soft:#E0F1F3; --accent-ink:#FFFFFF;
  --ok:#367967; --bad:#B25668; --warn:#8A6A1E;
  --term-bg:#162A31; --term-fg:#E2F0F2; --term-dim:#9AB7BF; --term-prompt:#93D2DC; --term-err:#E6A0A7;
  --glass:rgba(252,254,254,.66); --glass-2:rgba(240,248,249,.7); --glass-3:rgba(220,239,242,.6);
  --glass-line:rgba(25,51,61,.10); --glass-hi:rgba(255,255,255,.7);
  --scrim:rgba(25,51,61,.34); --shadow:0 18px 50px rgba(25,51,61,.18);
  --hero:rgba(71,157,170,.26); --line:rgba(80,111,120,.34);
  --mesh:radial-gradient(900px 520px at 8% -10%,rgba(71,157,170,.24),transparent 62%),radial-gradient(760px 520px at 100% 0%,rgba(140,205,213,.32),transparent 60%),radial-gradient(900px 600px at 55% 118%,rgba(188,222,228,.7),transparent 62%);
  color-scheme:light;}
.cp *,
.cp *::before,
.cp *::after{box-sizing:border-box}
.cp button,
.cp input,
.cp select,
.cp textarea{font:inherit;color:inherit}
.cp button{cursor:pointer;background:none;border:0;padding:0}
.cp button:disabled,
.cp select:disabled,
.cp textarea:disabled,
.cp input:disabled{cursor:not-allowed;opacity:.5}
.cp :focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:6px}
.cp [hidden]{display:none!important}
.cp h1,
.cp h2,
.cp h3,
.cp h4,
.cp p{margin:0}
.cp code,
.cp kbd{font-family:var(--font-mono)}
.cp code{font-size:.88em;background:var(--glass-3);padding:1px 6px;border-radius:6px}
.cp kbd{font-size:10.5px;border:1px solid var(--glass-line);border-radius:5px;padding:1px 5px;color:var(--text-3);background:var(--glass-2)}
.cp ::selection{background:var(--accent-soft)}
.cp ::-webkit-scrollbar{width:9px;height:9px}
.cp ::-webkit-scrollbar-thumb{background:var(--border-strong);border-radius:6px;border:2px solid transparent;background-clip:content-box}
.cp *{scrollbar-width:thin;scrollbar-color:var(--border-strong) transparent}
.cp .grow{flex:1}
.cp .ic{flex:none}
.cp .glass{background:var(--glass);-webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur)}
.cp .skip{position:absolute;left:8px;top:-60px;background:var(--accent);color:var(--accent-ink);padding:8px 12px;z-index:100;border-radius:var(--r)}
.cp .skip:focus{top:8px}
.cp .app{height:100%;display:grid;grid-template-columns:268px minmax(0,1fr);grid-template-rows:44px auto minmax(0,1fr)}
.cp .topbar{grid-column:1/-1;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid var(--glass-line);min-width:0;z-index:5}
.cp .brand{display:flex;align-items:center;gap:8px;font:800 16px/1 var(--font-sans);letter-spacing:-.03em;margin-right:6px;color:var(--text);border-radius:8px;padding:3px 4px}
.cp .brand:hover{background:var(--glass-3)}
.cp .mark{width:26px;height:26px;flex:none}
.cp .crumb{display:flex;align-items:center;gap:6px;color:var(--text-3);min-width:0;font-size:13px}
.cp .crumb select{background:transparent;border:1px solid transparent;border-radius:8px;padding:4px 6px;max-width:190px;text-overflow:ellipsis;color:var(--text);font-weight:600;font-size:13px}
.cp .crumb select:hover{border-color:var(--glass-line);background:var(--glass-3)}
.cp .crumb option{background:var(--bg-panel);color:var(--text)}
.cp .pill{display:inline-flex;align-items:center;gap:6px;font:600 11.5px/1 var(--font-sans);padding:5px 9px;border:1px solid var(--glass-line);border-radius:999px;color:var(--text-3);white-space:nowrap;background:var(--glass-2)}
.cp .pill::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--accent-2)}
.cp .pill.off{color:var(--warn);border-color:var(--warn)}
.cp .pill.off::before{background:var(--warn)}
.cp .tbtn,
.cp .btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;background:var(--glass-2);border:1px solid var(--glass-line);border-radius:var(--r);padding:6px 11px;font:600 12.5px/1.2 var(--font-sans);color:var(--text);white-space:nowrap;transition:background .15s,border-color .15s,transform .15s}
.cp .tbtn:hover:not(:disabled),
.cp .btn:hover:not(:disabled){border-color:var(--accent-2);background:var(--glass-3)}
.cp .tbtn[aria-pressed="true"]{background:var(--accent-soft);border-color:var(--accent-2);color:var(--accent)}
.cp .btn.sm{padding:4px 10px;font-size:12px}
.cp .btn.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.cp .btn.primary:hover:not(:disabled){filter:brightness(1.08);background:var(--accent)}
.cp .btn.danger{color:var(--bad);border-color:var(--bad);background:transparent}
.cp .btn.ghost{background:transparent}
.cp .ibtn{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:var(--r);color:var(--text-3);border:1px solid transparent;transition:background .15s,color .15s}
.cp .ibtn:hover:not(:disabled){background:var(--glass-3);color:var(--text)}
.cp .ibtn.sm{width:24px;height:24px;border-radius:6px}
.cp .ibtn[aria-pressed="true"]{background:var(--accent-soft);color:var(--accent)}
.cp .count{min-width:19px;padding:1px 6px;border-radius:999px;background:var(--accent);color:var(--accent-ink);font:800 11px/1.5 var(--font-sans);text-align:center}
.cp .only-narrow{display:none}
.cp .banner{grid-column:1/-1;display:flex;align-items:center;gap:10px;padding:8px 14px;background:var(--glass-3);border-bottom:1px solid var(--warn);color:var(--text);font-size:13px}
.cp .rail{grid-row:3;grid-column:1;border-right:1px solid var(--glass-line);display:flex;flex-direction:column;min-height:0}
.cp .rail-h{display:flex;align-items:center;justify-content:space-between;padding:12px 12px 4px 16px}
.cp .rail-h h2{font:700 11.5px/1 var(--font-sans);color:var(--text-3);letter-spacing:.02em}
.cp .rail-acts{display:flex;flex-direction:column;gap:2px;padding:4px 8px 8px;border-bottom:1px solid var(--glass-line)}
.cp .rail-acts button{display:flex;align-items:center;gap:10px;padding:7px 9px;border-radius:var(--r);color:var(--text-2);font-weight:600;font-size:13px;text-align:left}
.cp .rail-acts button:hover{background:var(--glass-3);color:var(--text)}
.cp .tree{flex:1;overflow:auto;padding:8px 8px 10px}
.cp .tree ul{list-style:none;margin:0;padding:0}
.cp .proj-h{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;font-weight:700;font-size:13px;text-align:left;border-radius:var(--r);color:var(--text)}
.cp .proj-h:hover{background:var(--glass-3)}
.cp .proj-h .n{margin-left:auto;font-size:11px;color:var(--text-3);font-weight:600}
.cp .proj-h .chev{color:var(--text-3);transition:transform .15s}
.cp .proj-h[aria-expanded="true"] .chev{transform:rotate(90deg)}
.cp .empty-note{margin:2px 0 6px 30px;font-size:12.5px;color:var(--text-3)}
.cp .sess-b{display:flex;align-items:center;gap:8px;width:100%;position:relative;padding:7px 8px 7px 12px;text-align:left;border-radius:var(--r);color:var(--text-2);font-weight:600;font-size:13px;margin-top:1px}
.cp .sess-b:hover{background:var(--glass-3)}
.cp .sess-b[aria-current="true"]{background:var(--bg-selected);color:var(--text);box-shadow:inset 0 0 0 1px var(--glass-line)}
.cp .sess-b[aria-current="true"]::before{content:"";position:absolute;left:0;top:7px;bottom:7px;width:2px;border-radius:2px;background:var(--accent)}
.cp .badge{margin-left:auto;font:700 10.5px/1 var(--font-sans);padding:3px 7px;border-radius:999px;background:var(--glass-3);color:var(--text-3)}
.cp .agents{margin:1px 0 6px 20px!important;padding:0 0 0 16px!important;position:relative}
.cp .ag-li{position:relative}
.cp .ag-li::before{content:"";position:absolute;left:-16px;top:0;width:13px;height:17px;border-left:1.5px solid var(--line);border-bottom:1.5px solid var(--line);border-bottom-left-radius:9px}
.cp .ag-li::after{content:"";position:absolute;left:-16px;top:17px;bottom:0;border-left:1.5px solid var(--line)}
.cp .ag-li:last-child::after{display:none}
.cp .ag-li.child{margin-left:14px}
.cp .ag-li[data-live="1"]::before{border-color:var(--accent-2)}
.cp .ag-row{display:flex;align-items:center;gap:2px;border-radius:var(--r);min-height:34px}
.cp .ag-row:hover{background:var(--glass-3)}
.cp .ag{flex:1;min-width:0;display:flex;align-items:center;gap:8px;padding:6px 6px;text-align:left;border-radius:var(--r);font-size:13px;color:var(--text-2)}
.cp .ag[aria-current="true"]{color:var(--accent);font-weight:700}
.cp .ag .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cp .ag .unread{width:7px;height:7px;border-radius:50%;background:var(--accent);flex:none}
.cp .ag-ico{color:var(--text-3)}
.cp .ag-ico.on{color:var(--accent)}
.cp .flag{font:700 10px/1 var(--font-sans);color:var(--warn);border:1px solid var(--warn);border-radius:999px;padding:2px 6px;white-space:nowrap}
.cp .rail-f{padding:10px 14px 12px;border-top:1px solid var(--glass-line);display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.cp .rail-f small{color:var(--text-3);font-size:11.5px;line-height:1.35}
.cp .st{display:inline-flex;align-items:center;gap:5px;font:700 12px/1 var(--font-sans);white-space:nowrap}
.cp .st-running{color:var(--accent)}
.cp .st-waiting,
.cp .st-disconnected{color:var(--warn)}
.cp .st-reviewing{color:var(--accent-2)}
.cp .st-completed{color:var(--ok)}
.cp .st-failed{color:var(--bad)}
.cp .st-stopped,
.cp .st-idle{color:var(--text-3)}
.cp .work{grid-row:3;grid-column:2;display:flex;flex-direction:column;min-width:0;min-height:0}
.cp .top-split{flex:1;min-height:150px;display:grid;grid-template-columns:minmax(0,1fr) auto;min-width:0}
.cp .conv,
.cp .board{display:flex;flex-direction:column;min-width:0;min-height:0}
.cp .sess-head{display:flex;align-items:center;gap:12px;padding:12px 22px;border-bottom:1px solid var(--glass-line)}
.cp .sess-head h1{font:600 24px/1.15 var(--font-serif);letter-spacing:-.005em}
.cp .sess-head p{color:var(--text-3);font-size:12.5px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:3px}
.cp .transcript{flex:1;overflow:auto;padding:18px 22px 10px;display:flex;flex-direction:column;gap:12px;min-height:0}
.cp .transcript:focus-visible{outline-offset:-2px}
.cp .msg{max-width:74ch;min-width:0}
.cp .msg .body{white-space:pre-wrap;word-break:break-word}
.cp .msg.user{align-self:flex-start;background:var(--glass-2);border:1px solid var(--glass-line);padding:9px 15px;border-radius:16px 16px 16px 5px;box-shadow:inset 0 1px 0 var(--glass-hi)}
.cp .msg.user .body{font:400 19px/1.45 var(--font-serif)}
.cp .msg.asst .body{font:400 14px/1.7 var(--font-sans);color:var(--text)}
.cp .msg.notice{align-self:center;color:var(--text-3);font-size:12.5px;border:1px dashed var(--glass-line);border-radius:999px;padding:3px 12px}
.cp details.think{color:var(--text-3);font-size:13px;padding-left:2px}
.cp details.think summary{cursor:pointer;font-weight:600;list-style:none}
.cp details.think summary::-webkit-details-marker{display:none}
.cp details.think p{margin-top:4px;padding-left:12px;border-left:2px solid var(--glass-line)}
.cp .tool{max-width:74ch;font-size:13px;color:var(--text-2)}
.cp .tool>summary,
.cp .tool>.t-row{display:flex;align-items:center;gap:9px;padding:3px 2px;list-style:none;cursor:default}
.cp .tool>summary{cursor:pointer;border-radius:8px}
.cp .tool>summary::-webkit-details-marker{display:none}
.cp .tool .t-ic{color:var(--text-3);display:inline-grid;place-items:center}
.cp .tool .t-v{font-weight:600;color:var(--text)}
.cp .tool .t-a{color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:36ch}
.cp .tool .t-m{margin-left:auto;font-size:12px;color:var(--text-3);display:inline-flex;gap:5px;align-items:center}
.cp .tool.ok .t-m{color:var(--ok)}
.cp .tool.error .t-m,
.cp .tool.denied .t-m{color:var(--bad)}
.cp .tool.running .t-m{color:var(--accent)}
.cp .tool .t-d{margin:4px 0 6px 28px;padding:8px 10px;border-radius:10px;background:var(--glass-3);font-size:12.5px;color:var(--text-2)}
.cp .tool .t-d pre{margin:6px 0 0;font:400 12px/1.55 var(--font-mono);white-space:pre-wrap;color:var(--text-3)}
.cp .spin{width:12px;height:12px;border:2px solid var(--accent);border-right-color:transparent;border-radius:50%;animation:cpspin .8s linear infinite}
@keyframes cpspin{to{transform:rotate(360deg)}}
.cp .lnk{background:transparent;border:0;color:var(--accent);padding:0;font-weight:600;font-size:12px;text-decoration:underline;text-underline-offset:3px}
.cp .card{border:1px solid var(--glass-line);background:var(--glass-2);border-radius:var(--r2);padding:11px 14px;max-width:74ch;display:flex;flex-direction:column;gap:6px;box-shadow:inset 0 1px 0 var(--glass-hi)}
.cp .card .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.cp .card h4{font:700 13.5px/1.2 var(--font-sans)}
.cp .card p{color:var(--text-3);font-size:13px}
.cp .card.pending{border-color:var(--warn)}
.cp .strip{display:flex;align-items:center;gap:10px;margin:0 22px 8px;padding:6px 14px;border:1px solid var(--glass-line);border-radius:999px;background:var(--glass-2);font-size:12.5px;color:var(--text-3);align-self:flex-start}
.cp .strip b{color:var(--text)}
.cp .strip button{color:var(--accent);font-weight:700;font-size:12.5px;text-decoration:underline;text-underline-offset:3px}
.cp .composer{position:relative;padding:10px 22px 14px;border-top:1px solid var(--glass-line);display:flex;flex-direction:column;gap:7px}
.cp .c-top{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.cp .seg{display:inline-flex;border:1px solid var(--glass-line);border-radius:999px;padding:2px;background:var(--glass-2)}
.cp .seg button{padding:3px 11px;font:600 12px/1.4 var(--font-sans);color:var(--text-3);border-radius:999px}
.cp .seg button[aria-checked="true"]{background:var(--accent-soft);color:var(--accent)}
.cp .seg button:disabled{opacity:.5}
.cp .route{font-size:12px;color:var(--text-3)}
.cp .route b{color:var(--text-2)}
.cp .c-box{display:flex;gap:8px;align-items:flex-end;padding:8px 8px 8px 14px;border-radius:var(--r3);background:var(--glass-2);border:1px solid var(--glass-line);box-shadow:inset 0 1px 0 var(--glass-hi)}
.cp .c-box:focus-within{border-color:var(--accent-2)}
.cp .c-box textarea,
.cp .steer textarea{flex:1;resize:none;background:transparent;border:0;outline:0;padding:5px 0;min-height:30px;max-height:140px;line-height:1.45;font:400 17.5px/1.45 var(--font-serif)}
.cp .c-box textarea.mono{font:400 13px/1.5 var(--font-mono)}
.cp .c-box textarea::placeholder,
.cp .hbox textarea::placeholder,
.cp .steer textarea::placeholder{color:var(--text-3)}
.cp .send{width:34px;height:34px;border-radius:50%;background:var(--accent);color:var(--accent-ink);display:grid;place-items:center;flex:none;transition:transform .15s,filter .15s}
.cp .send:hover:not(:disabled){filter:brightness(1.1);transform:translateY(-1px)}
.cp .c-meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--text-3);padding-left:4px}
.cp .c-meta select,
.cp .hrow select{background:transparent;border:0;border-radius:6px;padding:2px 2px;font-size:12px;color:var(--text-2);font-weight:600}
.cp .c-meta option,
.cp .hrow option{background:var(--bg-panel);color:var(--text)}
.cp .chip{background:transparent;border:1px solid var(--glass-line);border-radius:999px;padding:3px 10px;font:600 12px/1.3 var(--font-sans);color:var(--text-2)}
.cp .chip:hover{border-color:var(--accent-2);color:var(--text)}
.cp .meter{display:inline-flex;align-items:center;gap:6px}
.cp .meter i{display:block;width:54px;height:4px;background:var(--glass-3);border-radius:3px;overflow:hidden}
.cp .meter i b{display:block;height:100%;background:var(--accent-2)}
.cp .slash{position:absolute;left:22px;right:22px;bottom:calc(100% - 6px);background:var(--bg-panel);border:1px solid var(--border);border-radius:var(--r2);box-shadow:var(--shadow);padding:5px;max-height:260px;overflow:auto;z-index:20}
.cp .slash .it{display:flex;gap:12px;align-items:baseline;padding:7px 11px;border-radius:8px;cursor:pointer}
.cp .slash .it b{font:700 13px var(--font-sans);min-width:120px}
.cp .slash .it span{color:var(--text-3);font-size:12.5px}
.cp .slash .it[aria-selected="true"]{background:var(--accent-soft)}
.cp .slash .it[aria-disabled="true"]{opacity:.55;cursor:not-allowed}
.cp .slash h5{margin:4px 11px 6px;font:600 11px/1.3 var(--font-sans);color:var(--text-3)}
.cp .home{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:0;padding:28px 24px 56px;overflow:auto}
.cp .home::before{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(760px 420px at 50% -8%,var(--hero),transparent 70%),linear-gradient(180deg,var(--glass-3),transparent 48%)}
.cp .home-in{position:relative;width:min(700px,100%)}
.cp .greet{display:flex;align-items:center;justify-content:center;gap:14px;font:400 clamp(30px,4.6vw,48px)/1.12 var(--font-serif);letter-spacing:-.012em;margin:0 0 26px;text-align:center}
.cp .greet-mark{width:46px;height:46px;flex:none;border-radius:50%;display:grid;place-items:center}
.cp .greet-mark:hover{background:var(--glass-3)}
.cp .hbox{border-radius:20px;padding:14px 16px 10px;background:var(--glass);-webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur);border:1px solid var(--glass-line);box-shadow:var(--shadow),inset 0 1px 0 var(--glass-hi)}
.cp .hbox:focus-within{border-color:var(--accent-2)}
.cp .hbox textarea{display:block;width:100%;background:transparent;border:0;outline:0;resize:none;font:400 20px/1.5 var(--font-serif);min-height:66px;max-height:200px}
.cp .hrow{display:flex;align-items:center;gap:8px;margin-top:6px}
.cp .starters{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:16px}
.cp .starters button{padding:8px 14px;border-radius:999px;border:1px solid var(--glass-line);background:var(--glass-2);color:var(--text-2);font-weight:600;font-size:12.5px;-webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur)}
.cp .starters button:hover{border-color:var(--accent-2);color:var(--text)}
.cp .insp{width:392px;border-left:1px solid var(--glass-line);display:flex;flex-direction:column;min-height:0}
.cp .insp-h{display:flex;align-items:flex-start;gap:8px;padding:12px 12px 6px 16px}
.cp .insp-h .t{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.cp .insp-h .oname{font:600 22px/1.15 var(--font-serif)}
.cp .insp-task{margin:0 16px;padding:7px 10px;background:var(--glass-2);border:1px solid var(--glass-line);border-radius:10px;font-size:12.5px;color:var(--text-3)}
.cp .insp-task b{color:var(--text-2)}
.cp .insp-acts{display:flex;gap:6px;padding:9px 16px;flex-wrap:wrap}
.cp .tabs{display:flex;border-bottom:1px solid var(--glass-line);padding:0 12px}
.cp .tabs button{border-bottom:2px solid transparent;padding:8px 10px;font:700 12.5px/1 var(--font-sans);color:var(--text-3)}
.cp .tabs button[aria-selected="true"]{color:var(--accent);border-bottom-color:var(--accent)}
.cp .insp-body{flex:1;min-height:0;display:flex;flex-direction:column}
.cp .insp .transcript{padding:12px 16px}
.cp .insp .msg{max-width:100%}
.cp .steer{display:flex;flex-direction:column;gap:6px;padding:9px 14px 12px;border-top:1px solid var(--glass-line)}
.cp .steer .r{display:flex;gap:8px;align-items:flex-end;padding:6px 6px 6px 12px;border-radius:14px;background:var(--glass-2);border:1px solid var(--glass-line)}
.cp .steer .r:focus-within{border-color:var(--accent-2)}
.cp .steer textarea{font-size:16px}
.cp .bpanel{flex:1;overflow:auto;display:flex;flex-direction:column;min-height:0;padding-bottom:12px}
.cp .btool{display:flex;gap:4px;align-items:center;padding:10px 14px 6px}
.cp .btool input{flex:1;min-width:0;background:var(--glass-2);border:1px solid var(--glass-line);border-radius:999px;padding:6px 12px;font-size:12.5px}
.cp .bmeta{display:flex;gap:8px;align-items:center;padding:4px 16px;font-size:12px;color:var(--text-3);flex-wrap:wrap}
.cp .vp{margin:4px 16px;border:1px solid var(--glass-line);background:#fff;color:#14202f;border-radius:12px;min-height:210px;position:relative;overflow:hidden}
.cp .vp .load{position:absolute;left:0;top:0;height:2px;background:var(--accent);width:0;z-index:2}
.cp .vp .empty{display:grid;place-items:center;align-content:center;min-height:210px;padding:16px;text-align:center;background:var(--glass-3);color:var(--text-2);gap:8px}
.cp .page{padding:18px;font:400 14px/1.5 system-ui,sans-serif}
.cp .page h3{font:700 18px/1.2 system-ui,sans-serif;margin-bottom:8px}
.cp .page label{display:block;margin:8px 0 2px;font-size:12px;color:#44556e}
.cp .page input{width:100%;border:1px solid #b7c4d6;border-radius:6px;padding:6px 8px;background:#fff;color:#14202f}
.cp .page button{margin-top:12px;background:#277986;color:#fff;border-radius:8px;padding:7px 14px;font-weight:600}
.cp .page .ok{color:#136e40;font-weight:600}
.cp .bsec{margin:8px 16px 0;border:1px solid var(--glass-line);border-radius:12px;background:var(--glass-2)}
.cp .bsec summary{padding:8px 12px;font-weight:700;font-size:12.5px;cursor:pointer;color:var(--text-2)}
.cp .bsec .in{padding:2px 12px 12px;font-size:12.5px;display:flex;flex-direction:column;gap:7px}
.cp .bsec table{border-collapse:collapse;width:100%}
.cp .bsec td{padding:4px 0;border-top:1px solid var(--glass-line);vertical-align:top}
.cp .bsec td:last-child{text-align:right;color:var(--text-2)}
.cp .blog{font:400 12px/1.55 var(--font-mono);color:var(--text-3);display:flex;flex-direction:column;gap:2px}
.cp .blog .bad{color:var(--bad)}
.cp .blog .good{color:var(--ok)}
.cp .cap{display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-top:1px solid var(--glass-line)}
.cp .cap em{font-style:normal;color:var(--text-3);font-size:12px}
.cp .cap select{background:var(--glass-3);border:1px solid var(--glass-line);border-radius:6px;padding:1px 4px;font-size:12px}
.cp .btns{display:flex;gap:6px;flex-wrap:wrap}
.cp .board-h{display:flex;align-items:flex-end;gap:12px;padding:14px 22px 10px;border-bottom:1px solid var(--glass-line);flex-wrap:wrap}
.cp .board-h h1{font:600 26px/1.1 var(--font-serif)}
.cp .board-h p{color:var(--text-3);font-size:12.5px;margin-top:3px;max-width:60ch}
.cp .board-h .ctrls{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.cp .board-h select{background:var(--glass-2);border:1px solid var(--glass-line);border-radius:var(--r);padding:5px 8px;font-size:12.5px}
.cp .board-h option{background:var(--bg-panel);color:var(--text)}
.cp .board-h label.g{display:flex;gap:7px;align-items:center;font-size:12.5px;color:var(--text-3)}
.cp .phases{display:flex;gap:6px;padding:9px 22px;flex-wrap:wrap;border-bottom:1px solid var(--glass-line)}
.cp .phases button{background:var(--glass-2);border:1px solid var(--glass-line);border-radius:999px;padding:4px 11px;font:600 12px/1.2 var(--font-sans);color:var(--text-3)}
.cp .phases button[aria-pressed="true"]{border-color:var(--accent-2);color:var(--accent);background:var(--accent-soft)}
.cp .offline{margin:10px 22px 0;padding:8px 12px;border:1px solid var(--warn);border-radius:10px;background:var(--glass-2);font-size:13px}
.cp .cols{flex:1;min-height:0;display:grid;grid-template-columns:repeat(5,minmax(240px,1fr));gap:12px;padding:14px 22px;overflow:auto;align-items:start}
.cp .col{background:var(--glass);-webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur);border:1px solid var(--glass-line);border-radius:var(--r2);display:flex;flex-direction:column;min-width:0;max-height:100%}
.cp .col>header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;font:700 13px/1 var(--font-sans)}
.cp .col>header span:last-child{font-weight:600;color:var(--text-3)}
.cp .col[data-s="blocked"]>header{color:var(--warn)}
.cp .col[data-s="in_progress"]>header{color:var(--accent)}
.cp .col[data-s="completed"]>header{color:var(--ok)}
.cp .col[data-s="abandoned"]>header{color:var(--text-3)}
.cp .col-list{display:flex;flex-direction:column;gap:8px;padding:0 8px 10px;overflow:auto;min-height:48px}
.cp .col-list .none{color:var(--text-3);font-size:12.5px;padding:4px 6px}
.cp .gh{font:700 11px/1 var(--font-sans);color:var(--text-3);margin:4px 4px 0}
.cp .tcard{background:var(--glass-2);border:1px solid var(--glass-line);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-width:0;box-shadow:inset 0 1px 0 var(--glass-hi)}
.cp .tcard:hover{border-color:var(--accent-2)}
.cp .tcard[aria-current="true"]{border-color:var(--accent-2);box-shadow:0 0 0 1px var(--accent-2)}
.cp .tcard .crumbs{font:600 11.5px/1 var(--font-sans);color:var(--text-3)}
.cp .tcard h4{font:600 13.5px/1.4 var(--font-sans);cursor:pointer}
.cp .tcard .blk{font-size:12.5px;color:var(--warn)}
.cp .tcard .own{font-size:12px;color:var(--text-3)}
.cp .own i{font-style:normal;border:1px dashed var(--glass-line);border-radius:999px;padding:1px 7px;margin-left:6px}
.cp .tacts{display:flex;gap:12px;flex-wrap:wrap;padding-top:2px}
.cp .tacts button{font-size:12px;font-weight:700;color:var(--text-3);text-decoration:underline;text-underline-offset:3px}
.cp .tacts button:hover:not(:disabled){color:var(--accent)}
.cp .tcard .dt{font-size:12px;color:var(--text-3)}
.cp .tcard.stale{opacity:.7}
.cp .col-tabs{display:none}
.cp .dock{position:relative;min-height:36px;display:flex;flex-direction:column;border-top:1px solid var(--glass-line);flex:none;transition:height .22s ease}
.cp .dock.dragging{transition:none}
.cp .resizer{position:absolute;left:0;right:0;top:-4px;height:8px;cursor:row-resize;z-index:5;touch-action:none}
.cp .resizer:hover,
.cp .resizer:focus-visible{background:var(--accent-soft)}
.cp .dock-bar{display:flex;align-items:center;gap:6px;padding:4px 10px;border-bottom:1px solid var(--glass-line);min-height:36px;overflow:hidden}
.cp .dtabs{display:flex;gap:3px;overflow:auto;min-width:0}
.cp .dtab{display:flex;align-items:center;gap:6px;border:1px solid transparent;border-radius:999px;padding:3px 6px 3px 11px;font:600 12.5px/1.2 var(--font-sans);color:var(--text-3);white-space:nowrap;cursor:pointer}
.cp .dtab[aria-selected="true"]{background:var(--glass-3);color:var(--text);border-color:var(--glass-line)}
.cp .dtab .x{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;color:var(--text-3)}
.cp .dtab .x:hover{color:var(--text);background:var(--glass-3)}
.cp .dock-body{flex:1;min-height:0;display:grid;grid-template-columns:1fr}
.cp .dock-body.split{grid-template-columns:1fr 1fr}
.cp .tpane{display:flex;flex-direction:column;min-width:0;min-height:0;border-right:1px solid var(--glass-line)}
.cp .tpane:last-child{border-right:0}
.cp .tp-h{display:flex;align-items:center;gap:8px;padding:5px 12px;font-size:12px;color:var(--text-3);border-bottom:1px solid var(--glass-line);flex-wrap:wrap}
.cp .tp-h select{background:var(--glass-3);border:1px solid var(--glass-line);border-radius:6px;font-size:12px;padding:1px 4px}
.cp .tp-out{flex:1;overflow:auto;padding:8px 12px;font:400 12.5px/1.6 var(--font-sans);color:var(--text);min-height:0}
.cp .tp-out.mono{font:400 12.5px/1.55 var(--font-mono);white-space:pre-wrap;word-break:break-word;background:var(--term-bg);color:var(--term-fg)}
.cp .tp-out .t{color:var(--text-3);margin-right:8px}
.cp .tp-out .ok{color:var(--ok)}
.cp .tp-out .bad{color:var(--bad)}
.cp .tp-out .dim{color:var(--text-3)}
.cp .tp-out.mono .dim{color:var(--term-dim)}
.cp .tp-out.mono .bad{color:var(--term-err)}
.cp .tp-out.mono .ok{color:var(--term-prompt)}
.cp .tp-in{display:flex;gap:6px;align-items:center;padding:6px 12px;border-top:1px solid var(--glass-line);font:400 12.5px var(--font-mono);background:var(--term-bg);color:var(--term-prompt)}
.cp .tp-in span{white-space:nowrap}
.cp .tp-in input{flex:1;min-width:0;background:transparent;border:0;outline:0;font:inherit;color:var(--term-fg)}
.cp .layer{position:absolute;inset:0;z-index:60}
.cp .scrim{position:absolute;inset:0;background:var(--scrim);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}
.cp .drawer{position:absolute;top:0;right:0;bottom:0;width:min(780px,100%);background:var(--glass);-webkit-backdrop-filter:blur(26px) saturate(150%);backdrop-filter:blur(26px) saturate(150%);border-left:1px solid var(--glass-line);display:flex;flex-direction:column;box-shadow:var(--shadow)}
.cp .drawer>header{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--glass-line)}
.cp .drawer h2{font:600 24px/1.1 var(--font-serif)}
.cp .drawer-grid{flex:1;min-height:0;display:grid;grid-template-columns:184px minmax(0,1fr)}
.cp .dnav{border-right:1px solid var(--glass-line);padding:10px;display:flex;flex-direction:column;gap:2px;overflow:auto}
.cp .dnav button{text-align:left;padding:8px 11px;color:var(--text-3);font-weight:600;border-radius:var(--r);font-size:13px}
.cp .dnav button[aria-current="true"]{color:var(--text);background:var(--bg-selected)}
.cp .dnav button:hover{background:var(--glass-3)}
.cp .dbody{overflow:auto;padding:18px 22px 28px}
.cp .dbody h3{font:600 22px/1.15 var(--font-serif);margin-bottom:4px}
.cp .dbody .lede{color:var(--text-3);margin-bottom:14px;max-width:62ch;font-size:13.5px}
.cp .dbody h4{font:700 12px/1 var(--font-sans);color:var(--text-3);margin:18px 0 6px}
.cp .row2{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid var(--glass-line)}
.cp .row2 small{display:block;color:var(--text-3);font-size:12.5px;font-weight:400}
.cp .row2 select{background:var(--glass-3);border:1px solid var(--glass-line);border-radius:var(--r);padding:5px 8px;max-width:55%;font-size:13px}
.cp .row2 option{background:var(--bg-panel);color:var(--text)}
.cp .sw{width:36px;height:21px;border-radius:999px;border:1px solid var(--glass-line);background:var(--glass-3);position:relative;flex:none;padding:0}
.cp .sw::after{content:"";position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:var(--text-3);transition:transform .15s,background .15s}
.cp .sw[aria-checked="true"]{background:var(--accent-soft);border-color:var(--accent-2)}
.cp .sw[aria-checked="true"]::after{transform:translateX(15px);background:var(--accent)}
.cp .na{font:600 12px/1.3 var(--font-sans);color:var(--warn)}
.cp .graph{width:100%;height:auto;border:1px solid var(--glass-line);border-radius:12px;background:var(--glass-2)}
.cp .graph text{font:600 11.5px var(--font-sans);fill:var(--text)}
.cp .graph .e{stroke:var(--line);stroke-width:1.5;fill:none}
.cp .graph .e.own{stroke:var(--accent-2)}
.cp .graph .n rect{fill:var(--glass-3);stroke:var(--glass-line);stroke-width:1.2}
.cp .graph .n:hover rect,
.cp .graph .n:focus-visible rect{stroke:var(--accent-2)}
.cp .graph .n{cursor:pointer}
.cp .graph .col-h{fill:var(--text-3);font-size:11px}
.cp .modal{position:absolute;left:50%;top:18%;transform:translateX(-50%);width:min(480px,calc(100% - 24px));background:var(--glass);-webkit-backdrop-filter:blur(26px) saturate(150%);backdrop-filter:blur(26px) saturate(150%);border:1px solid var(--glass-line);border-radius:18px;padding:18px;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:10px}
.cp .modal.wide{width:min(640px,calc(100% - 24px));max-height:80vh;overflow:auto;top:7%}
.cp .modal h2{font:600 24px/1.1 var(--font-serif)}
.cp .modal p{color:var(--text-3)}
.cp .m-acts{display:flex;justify-content:flex-end;gap:8px}
.cp .pv-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px}
.cp .pv-grid label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--text-3)}
.cp .pv-grid select{background:var(--glass-3);border:1px solid var(--glass-line);border-radius:var(--r);padding:5px 8px}
.cp .pv-grid option{background:var(--bg-panel);color:var(--text)}
.cp .pv-sec{border-top:1px solid var(--glass-line);padding-top:10px;display:flex;flex-direction:column;gap:8px}
.cp .pv-sec h3{font:700 12px/1 var(--font-sans);color:var(--text-3)}
.cp .palette{position:absolute;left:50%;top:12%;transform:translateX(-50%);width:min(620px,calc(100% - 24px));background:var(--glass);-webkit-backdrop-filter:blur(26px) saturate(150%);backdrop-filter:blur(26px) saturate(150%);border:1px solid var(--glass-line);border-radius:18px;box-shadow:var(--shadow);overflow:hidden}
.cp .palette input{width:100%;background:transparent;border:0;border-bottom:1px solid var(--glass-line);padding:15px 18px;font-size:15px;outline:0;border-radius:0}
.cp .palette ul{list-style:none;margin:0;padding:8px;max-height:340px;overflow:auto}
.cp .palette li{display:flex;gap:10px;align-items:baseline;padding:8px 12px;border-radius:10px;cursor:pointer}
.cp .palette li small{color:var(--text-3);margin-left:auto}
.cp .palette li[aria-selected="true"]{background:var(--accent-soft)}
.cp .palette li.h{cursor:default;font:700 11px/1 var(--font-sans);color:var(--text-3);padding:9px 12px 3px}
.cp .toasts{position:absolute;right:16px;bottom:16px;display:flex;flex-direction:column;gap:6px;z-index:90;pointer-events:none}
.cp .toast{background:var(--bg-panel);border:1px solid var(--glass-line);border-left:3px solid var(--accent);border-radius:12px;padding:9px 14px;max-width:340px;font-size:13px;box-shadow:var(--shadow)}
.cp .scrim-rail{display:none}
@media (max-width:1240px){
.cp .insp{position:fixed;top:44px;right:0;bottom:0;width:min(440px,100%);z-index:35;box-shadow:var(--shadow);background:var(--glass)}
.cp .top-split{grid-template-columns:minmax(0,1fr)}
}
@media (max-width:960px){
.cp .app{grid-template-columns:minmax(0,1fr)}
.cp .work{grid-column:1}
.cp .rail{position:fixed;top:44px;bottom:0;left:0;width:min(300px,86vw);z-index:45;transform:translateX(-102%);box-shadow:var(--shadow);background:var(--bg-panel)}
.cp .rail.open{transform:none}
.cp .scrim-rail.on{display:block;position:fixed;inset:44px 0 0 0;background:var(--scrim);z-index:44}
.cp .only-narrow{display:inline-grid}
.cp .crumb .lbl,
.cp .tbtn .lbl,
.cp .brand span{display:none}
.cp .crumb{flex:1;min-width:0}
.cp .crumb select{max-width:100%;width:100%;min-width:0}
.cp .topbar>.grow{display:none}
.cp .pill{display:none}
.cp .cols{display:block;padding:10px 14px}
.cp .col{display:none;max-height:none}
.cp .col.show{display:flex}
.cp .col-tabs{display:flex;gap:4px;padding:8px 14px 0;overflow:auto;flex:none}
.cp .col-tabs button{background:var(--glass-2);border:1px solid var(--glass-line);border-radius:999px;padding:5px 11px;font:600 12px/1 var(--font-sans);white-space:nowrap;color:var(--text-3)}
.cp .col-tabs button[aria-selected="true"]{border-color:var(--accent-2);color:var(--accent)}
.cp .drawer-grid{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}
.cp .dnav{flex-direction:row;border-right:0;border-bottom:1px solid var(--glass-line);overflow-x:auto}
.cp .dnav button{white-space:nowrap}
.cp .dock-body.split{grid-template-columns:1fr}
.cp .sess-head,
.cp .transcript,
.cp .board-h,
.cp .phases{padding-left:14px;padding-right:14px}
.cp .composer{padding-left:14px;padding-right:14px}
.cp .strip{margin-left:14px}
}
@media (max-width:600px){
.cp .topbar{gap:4px;padding:0 8px}
.cp .topbar .tbtn{padding:6px 8px}
.cp .topbar .theme-btn{display:none}
.cp .tbtn kbd{display:none}
.cp .pv-grid{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){
.cp *{animation:none!important;transition:none!important}
}`;

/* ================================================================ helpers */
const RM = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const USER_NAME = 'Can';
const clock = () => new Date().toTimeString().slice(0, 8);
const hash = s => { let h = 0; for (const c of String(s).trim().toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h.toString(16).padStart(6, '0').slice(0, 6); };
const wait = ms => new Promise(r => setTimeout(r, RM ? Math.min(ms, 20) : ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let MID = 0;
const mid = () => ++MID;

/* GSAP loader (sandbox friendly). Replace with `import { gsap } from 'gsap'` in the repo. */
let gsapLoading = null;
function loadGsap() {
  if (typeof window === 'undefined') return Promise.resolve(null);
  if (window.gsap) return Promise.resolve(window.gsap);
  if (!gsapLoading) gsapLoading = new Promise(res => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js'; s.async = true;
    s.onload = () => res(window.gsap || null); s.onerror = () => res(null);
    document.head.appendChild(s);
  });
  return gsapLoading;
}
function useGsap() {
  const [g, setG] = useState(() => (typeof window !== 'undefined' && window.gsap) || null);
  useEffect(() => { let on = true; loadGsap().then(x => { if (on && x) setG(x); }); return () => { on = false; }; }, []);
  return g;
}

const STATE_META = {
  idle: ['Idle', Circle], running: ['Running', CirclePlay], waiting: ['Waiting', Clock], reviewing: ['Reviewing', Eye],
  completed: ['Done', CircleCheck], failed: ['Failed', CircleX], stopped: ['Stopped', Square], disconnected: ['Offline', Unplug]
};
const COLS = [['pending', 'To do'], ['in_progress', 'In progress'], ['blocked', 'Blocked'], ['completed', 'Done'], ['abandoned', 'Cancelled']];
const COLNAME = Object.fromEntries(COLS);
const THINK = ['Auto', 'Low', 'Medium', 'High'];
const ROLES = ['default', 'smol', 'slow', 'plan', 'commit', 'vision', 'task', 'advisor', 'tiny'];
const MODELOPTS = ['9Router route A', '9Router route B', 'Provider default'];
const COMMANDS = [
  { n: '/model', d: 'Open the model and role settings', ok: true, act: 'models' },
  { n: '/review', d: 'Review uncommitted changes', ok: true, act: 'review' },
  { n: '/annotate', d: 'Pin notes to a diff or a reply', ok: true },
  { n: '/advisor', d: 'Show the second reviewing model', ok: true, act: 'models' },
  { n: '/fresh', d: 'Reset the provider stream, keep the transcript', ok: true },
  { n: '/debug', d: 'Open debugging and profiling tools', ok: true },
  { n: '/vibe', d: 'Direct fast and good workers', ok: false, why: 'Not supported by the pinned runtime in this preview' },
  { n: '/login', d: 'Sign in to a provider', ok: true, act: 'models' },
  { n: '/reload-plugins', d: 'Load the extension you just asked for', ok: true }
];
const STARTERS = ['Fix the session timeout bug', 'Review my uncommitted changes', 'Split the docs update to a worker'];

/* ---- home greetings (easter egg: they rotate, click the mark to cycle) ---- */
const dayPart = h => (h < 11 ? 'pagi' : h < 15 ? 'siang' : h < 18 ? 'sore' : 'malam');
function greetings(name, hour) {
  const g = [
    `Selamat ${dayPart(hour)}, ${name}`,
    `Mau otak-atik apa hari ini, ${name}?`,
    `Lagi nyusun apa nih, ${name}?`,
    'Ada bug yang lagi nantangin lu?',
    'Ngoding apa kita hari ini?',
    'Kopi udah, kode kapan?',
    `Siap bongkar-pasang kode, ${name}?`,
    'Hari ini refactor atau bikin yang baru?',
    'Ada subagent nganggur nih. Kasih kerjaan dong.',
    'Satu prompt, beberapa agent, nol drama.',
    'Tenang, semua agent udah standby.',
    `${name}, ada ide gila apa hari ini?`,
    'Yuk rapihin yang semalam masih berantakan.',
    'Git status-nya aman? Cek bareng yuk.',
    'Yuk bikin sesuatu yang jalan di percobaan pertama.'
  ];
  if (hour < 4) g.push(`Jam segini masih melek, ${name}? Salut.`, 'Kode jam segini biasanya jujur banget.');
  else if (hour < 7) g.push('Pagi buta nih. Sarapan dulu, baru deploy.');
  return g;
}
const SECRETS = { 6: 'Udah, jangan dipencet terus. Ketik aja kerjaannya.', 12: 'Oke oke, lu menang. Easter egg-nya cuma ini.' };

/* ================================================================ seed data */
const U = text => ({ id: mid(), role: 'user', text });
const A_ = text => ({ id: mid(), role: 'asst', text });
const TH = text => ({ id: mid(), role: 'think', text });
const T = (tool, arg, status = 'ok', out = '', meta = '') => ({ id: mid(), role: 'tool', tool, arg, status, out, meta });
const W = aid => ({ id: mid(), role: 'worker', aid });
const AP = (tool, arg, status = 'pending') => ({ id: mid(), role: 'approval', tool, arg, status });
const N = text => ({ id: mid(), role: 'notice', text });
const mkAgent = (id, name, state, activity, extra = {}) => ({ id, name, state, activity, unread: false, parent: id === 'main' ? null : 'main', flag: null, script: [], ...extra });
const mkSurface = (sid, owner, url, state = 'ready') => ({
  owner: sid + '/' + owner, state, url, history: url ? [url] : [], hi: url ? 0 : -1, store: { cookie: null }, err: null,
  perms: { clipboard: 'ask', camera: 'blocked', microphone: 'blocked', geolocation: 'blocked', downloads: 'ask', popups: 'blocked' },
  audit: [], activity: [], readonly: false, lastUsed: Date.now()
});
const tr = (tool, arg, status, note) => ({ t: clock(), tool, arg, status, note: note || '' });
const makeSession = (id, name, project) => ({
  id, name, project, unread: 0, revision: 1, todoAt: Date.now(), seen: true,
  agents: { main: mkAgent('main', 'Main agent', 'idle', 'Waiting for your next message') }, order: ['main'],
  threads: { main: [] }, traces: { main: [] }, todo: [], links: {}, browsers: {}, shells: []
});

function seed() {
  const s1 = {
    id: 's1', name: 'Authentication flow', project: 'p1', unread: 0, revision: 1, todoAt: Date.now(), seen: false,
    agents: {
      main: mkAgent('main', 'Main agent', 'running', 'Editing src/session.ts'),
      a1: mkAgent('a1', 'AuthTests', 'running', 'Writing tests/refresh.test.ts', { script: [
        { k: 'tool', m: T('bash', 'bun test tests/refresh.test.ts', 'ok', '6 pass, 0 fail', '6 passed') },
        { k: 'say', text: 'Rotation, reuse detection and expiry cases pass. I have not touched src/. Waiting for the verification slice.' },
        { k: 'state', state: 'waiting', activity: 'Waiting for the verification slice' }
      ] }),
      a2: mkAgent('a2', 'TokenReview', 'reviewing', 'Reading the diff of src/session.ts')
    },
    order: ['main', 'a1', 'a2'],
    threads: {
      main: [
        U('Add refresh-token rotation to the auth flow and cover it with tests. Keep the public session API unchanged.'),
        TH('Plan: read the session module, check diagnostics, patch the refresh path, delegate test writing so I can keep editing.'),
        T('read', 'src/session.ts', 'ok', 'Summary: 4 functions. refreshToken starts at line 88.', '142 lines'),
        T('lsp', 'diagnostics src/session.ts', 'ok', 'src/session.ts:91  Object is possibly undefined (expiresAt)', '1 issue'),
        A_('The refresh path reads expiresAt before the token is set. I will rotate the token on every refresh and treat a missing expiry as expired. Test writing goes to a worker so I can keep editing.'),
        T('edit', 'src/session.ts', 'ok', '+18 -4', 'applied'),
        W('a1'), W('a2'),
        AP('bash', 'rm -rf .cache/auth-fixtures')
      ],
      a1: [
        U('Task from Main agent: write refresh path tests in tests/refresh.test.ts. Do not edit src/.'),
        T('read', 'tests/session.test.ts', 'ok', 'Two fixtures can be reused.', '88 lines'),
        A_('Two existing fixtures cover login. I will add cases for rotation, reuse detection and expiry.'),
        T('write', 'tests/refresh.test.ts', 'running')
      ],
      a2: [
        U('Task from Main agent: review the diff of src/session.ts for token reuse holes.'),
        T('read', 'git diff src/session.ts', 'ok', '', '22 lines'),
        A_('One concern so far: the old refresh token stays valid for a moment after rotation. Checking whether that window is intended.')
      ]
    },
    traces: {
      main: [tr('read', 'src/session.ts', 'ok', '142 lines'), tr('lsp', 'diagnostics src/session.ts', 'ok', '1 issue'), tr('edit', 'src/session.ts', 'ok', '+18 -4')],
      a1: [tr('read', 'tests/session.test.ts', 'ok', '88 lines'), tr('write', 'tests/refresh.test.ts', 'running', '')],
      a2: [tr('read', 'git diff src/session.ts', 'ok', '22 lines')]
    },
    todo: [
      { name: 'I. Plan', tasks: [{ content: 'Map session and token flow', status: 'completed' }, { content: 'Draft auth test matrix', status: 'completed' }] },
      { name: 'II. Implement', tasks: [{ content: 'Add refresh-token rotation', status: 'in_progress' }, { content: 'Harden session expiry guard', status: 'pending' }, { content: 'Replace legacy cookie fallback', status: 'abandoned' }] },
      { name: 'III. Test', tasks: [{ content: 'Write refresh path tests', status: 'in_progress' }, { content: 'Cover token reuse detection', status: 'pending' }] },
      { name: 'IV. Verify', tasks: [{ content: 'Verify slice runtime and visual regression coverage', status: 'blocked', blocker: 'Needs a staging build to run against' }] }
    ],
    links: { 'Write refresh path tests': 'a1', 'Cover token reuse detection': 'a2' },
    browsers: { a1: mkSurface('s1', 'a1', 'http://localhost:3000/login') },
    shells: [{ id: 'sh1', name: 'Shell 1', cwd: 'C:\\work\\api-gateway', lines: [{ c: 'dim', t: 'Windows PowerShell (preview simulation). The desktop build runs a real ConPTY shell here.' }], proc: null, exited: null, hist: [], trunc: 0 }]
  };
  const s2 = {
    id: 's2', name: 'Rate limiter', project: 'p1', unread: 0, revision: 1, todoAt: Date.now(), seen: false,
    agents: { main: mkAgent('main', 'Main agent', 'idle', 'Waiting for your next message'), a1: mkAgent('a1', 'BenchLoad', 'failed', 'Load test exited with code 1') },
    order: ['main', 'a1'],
    threads: {
      main: [U('Add a token-bucket limiter to the gateway middleware.'), A_('Middleware is in place. I delegated the load test to a worker.'), W('a1')],
      a1: [U('Task from Main agent: run the burst load test against the limiter.'), T('bash', 'bun run bench:burst', 'error', 'Error: connection refused on port 3000', 'exit 1'), A_('The test server was not running, so the benchmark could not connect. I stopped.')]
    },
    traces: { main: [tr('edit', 'src/middleware/limiter.ts', 'ok', '+64')], a1: [tr('bash', 'bun run bench:burst', 'error', 'exit 1')] },
    todo: [
      { name: 'I. Design', tasks: [{ content: 'Choose token-bucket parameters', status: 'completed' }] },
      { name: 'II. Build', tasks: [{ content: 'Implement limiter middleware', status: 'in_progress' }, { content: 'Add metrics export', status: 'pending' }] },
      { name: 'III. Verify', tasks: [{ content: 'Load test at burst traffic', status: 'blocked' }] }
    ],
    links: { 'Load test at burst traffic': 'a1' }, browsers: {}, shells: []
  };
  return { projects: [{ id: 'p1', name: 'api-gateway', path: '~/work/api-gateway' }], sessions: { s1, s2 } };
}

/* ================================================================ small pure helpers */
const counts = ss => { const c = { pending: 0, in_progress: 0, blocked: 0, completed: 0, abandoned: 0 }; ss.todo.forEach(p => p.tasks.forEach(t => c[t.status]++)); return c; };
const taskKey = (sid, pi, ti, t) => `${sid}:${pi}:${ti}:${hash(t.content)}`;
const withTask = (todo, phase, task) => { const c = JSON.parse(JSON.stringify(todo)); const p = c.find(x => x.name === phase) || c[c.length - 1] || (c.push({ name: 'I. Plan', tasks: [] }), c[0]); p.tasks.push(task); return c; };
const titleFrom = t => { const w = t.replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' '); const s = w.charAt(0).toUpperCase() + w.slice(1); return s.length > 36 ? s.slice(0, 35) + '\u2026' : s; };
const prettyArg = arg => { const a = String(arg); if (/^[\w./\\-]+\.[a-z0-9]+$/i.test(a)) return a.split(/[\\/]/).pop(); return a.replace(/^diagnostics\s+/, ''); };
const TOOL_META = {
  read: [FileText, 'Reading', 'Read'], write: [Pencil, 'Writing', 'Wrote'], edit: [Pencil, 'Editing', 'Edited'], lsp: [FileText, 'Checking', 'Checked'],
  bash: [Terminal, 'Running', 'Ran'], grep: [Search, 'Searching', 'Searched'], glob: [Search, 'Finding', 'Found'], task: [Users, 'Delegating', 'Delegated'],
  todo: [ListChecks, 'Updating tasks', 'Updated tasks'], browser: [Globe, 'Browsing', 'Browsed']
};
function pageFor(b, url) {
  let u; try { u = new URL(url); } catch (e) { return { err: 'This is not a valid address.' }; }
  if (!['localhost', 'docs.local'].includes(u.hostname)) return { err: `Preview only serves sample pages on localhost and docs.local. Origin: ${u.origin}` };
  if (u.pathname === '/login') return { page: 'login' };
  if (u.pathname === '/dashboard') return b.store.cookie ? { page: 'dashboard' } : { redirect: u.origin + '/login' };
  if (u.pathname === '/docs') return { page: 'docs' };
  return { err: `No page at ${u.origin}${u.pathname}` };
}

/* ================================================================ context + tiny components */
const Ctx = createContext(null);
const useApp = () => useContext(Ctx);

function Logo({ className = 'mark' }) {
  return (
    <svg className={className} viewBox="0 0 28 28" aria-hidden="true">
      <path d="M2.5 12.5C2.5 6.6 7.6 2.5 14 2.5s11.5 4.1 11.5 10c-1.9-1.5-3.7-1.5-5.6 0-1.9-1.5-3.9-1.5-5.9 0-2-1.5-4-1.5-5.9 0-1.9-1.5-3.7-1.5-5.6 0z" fill="var(--accent)" />
      <path d="M8.5 17.5h11M11 17.5v7M17 17.5v5.2c0 1.2.9 2 2.2 2" fill="none" stroke="var(--text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function StateTag({ s }) { const [label, Ico] = STATE_META[s]; return <span className={'st st-' + s}><Ico size={13} />{label}</span>; }
function Switch({ on, onChange, label, disabled }) { return <button type="button" role="switch" aria-checked={!!on} aria-label={label} disabled={disabled} className="sw" onClick={() => onChange(!on)} />; }

const LAYERS = [];
function Layer({ onClose, children, initial }) {
  const ref = useRef(null); const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const root = ref.current, opener = document.activeElement, token = {}; LAYERS.push(token);
    const f = () => [...root.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];
    const first = initial ? root.querySelector(initial) : f()[0]; if (first) first.focus();
    const onKey = e => {
      if (LAYERS[LAYERS.length - 1] !== token) return;
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key === 'Tab') {
        const els = f(); if (!els.length) return; const a = document.activeElement;
        if (e.shiftKey && (a === els[0] || !root.contains(a))) { e.preventDefault(); els[els.length - 1].focus(); }
        else if (!e.shiftKey && (a === els[els.length - 1] || !root.contains(a))) { e.preventDefault(); els[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); LAYERS.splice(LAYERS.indexOf(token), 1); if (opener && opener.focus && document.contains(opener)) opener.focus(); };
  }, []);
  return <div className="layer" ref={ref}>{children}</div>;
}
function useEnter(ref, from, deps = []) {
  const A = useApp();
  useLayoutEffect(() => { if (A.gsap && ref.current && !RM) A.gsap.from(ref.current, { duration: .24, ease: 'power2.out', clearProps: 'all', ...from }); }, deps); // eslint-disable-line
}
function useStick(ref, dep) {
  const stick = useRef(true);
  useEffect(() => { const el = ref.current; if (!el) return undefined; const on = () => { stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }; el.addEventListener('scroll', on, { passive: true }); return () => el.removeEventListener('scroll', on); }, [ref]);
  useLayoutEffect(() => { const el = ref.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [dep]); // eslint-disable-line
}

/* ================================================================ main */
export default function CanoPi() {
  const gsap = useGsap();
  const [db, setDb] = useState(seed);
  const dbRef = useRef(db);
  const mutate = useCallback(fn => { const n = JSON.parse(JSON.stringify(dbRef.current)); fn(n); dbRef.current = n; setDb(n); }, []);

  const [theme, setTheme] = useState('dark');
  const [sid, setSid] = useState(null);                 // null = Home
  const [view, setViewS] = useState('conv');
  const [insp, setInsp] = useState(null);
  const [inspTab, setInspTab] = useState('transcript');
  const [conn, setConn] = useState('connected');
  const [dock, setDock] = useState({ open: true, expanded: false, h: 216, split: false, sel: ['trace:main', 'trace:main'] });
  const [dragging, setDragging] = useState(false);
  const [workH, setWorkH] = useState(720);
  const [mode, setMode] = useState('agent');
  const [shellId, setShellId] = useState(null);
  const [phase, setPhase] = useState('all');
  const [group, setGroup] = useState(true);
  const [selTask, setSelTask] = useState(null);
  const [colTab, setColTab] = useState('in_progress');
  const [drafts, setDrafts] = useState({});
  const [settings, setSettings] = useState({ roles: { default: MODELOPTS[0], smol: MODELOPTS[1], slow: MODELOPTS[0], plan: MODELOPTS[0], commit: MODELOPTS[1], vision: MODELOPTS[2], task: MODELOPTS[1], advisor: MODELOPTS[0], tiny: MODELOPTS[1] },
    tools: { read: true, write: true, edit: true, grep: true, glob: true, bash: true, lsp: true, task: true, todo: true, web_search: true, ast_edit: false, eval: false },
    mcp: { 'docs-search': true, linear: false }, rules: { 'box-leak': true, 'no-any': true }, skills: { 'review-checklist': true, 'migration-notes': false },
    mem: 'Local', projmem: true, fallback: true, think: 'Auto', approval: 'Ask for destructive tools' });
  const [railOpen, setRailOpen] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const [homeProject, setHomeProject] = useState('p1');
  const [drawer, setDrawer] = useState(null);
  const [palette, setPalette] = useState(false);
  const [confirmS, setConfirmS] = useState(null);
  const [pv, setPv] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [stale, setStale] = useState(0);

  const appRef = useRef(null), workRef = useRef(null), fileRef = useRef(null), scrollRef = useRef({}), busyRef = useRef({}), logic = useRef({});
  const uiRef = useRef({}); uiRef.current = { sid, view, insp, inspTab, conn, selTask, mode };

  const ss = sid && db.sessions[sid] ? db.sessions[sid] : null;
  const eff = a => (conn === 'disconnected' ? 'disconnected' : a.state);
  const shells = ss ? ss.shells : [];
  const curShellId = shells.find(s => s.id === shellId) ? shellId : (shells[0] && shells[0].id) || null;
  const dockTabs = ss ? [...ss.order.map(id => ({ id: 'trace:' + id, label: (id === 'main' ? 'Main' : ss.agents[id].name) + ' activity', kind: 'trace', owner: id })), ...ss.shells.map(s => ({ id: 'shell:' + s.id, label: s.name, kind: 'shell', sh: s }))] : [];
  const dockMax = Math.max(80, workH - 320);
  const dockHeight = !dock.open ? 36 : dock.expanded ? Math.floor(dockMax * .9) : Math.min(dock.h, dockMax);
  const layerOpen = !!(drawer || palette || confirmS || pv);

  useEffect(() => { if (appRef.current) appRef.current.inert = layerOpen; }, [layerOpen]);
  useEffect(() => {
    const el = workRef.current; if (!el) return undefined;
    const upd = () => setWorkH(el.clientHeight || 720); upd();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(upd); ro.observe(el); return () => ro.disconnect();
  }, [sid]);

  /* ---------- toast / confirm / drafts ---------- */
  const toast = useCallback(msg => { const id = mid(); setToasts(t => [...t.slice(-2), { id, msg }]); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), RM ? 1200 : 3400); }, []);
  const confirm = useCallback(o => new Promise(res => setConfirmS({ ...o, res })), []);
  const setDraft = useCallback((k, v) => setDrafts(d => ({ ...d, [k]: v })), []);
  const setSet = patch => setSettings(s => ({ ...s, ...patch }));

  /* ---------- data helpers (use refs only, so async flows never see stale state) ---------- */
  const pushMsg = useCallback((sidx, tid, m) => {
    const msg = { ...m, id: m.id || mid() };
    mutate(d => {
      const s = d.sessions[sidx]; if (!s || !s.threads[tid]) return;
      s.threads[tid].push(msg);
      const u = uiRef.current;
      if (tid !== 'main' && !(u.sid === sidx && u.insp === tid && u.inspTab === 'transcript')) s.agents[tid].unread = true;
      if (u.sid !== sidx) s.unread++;
    });
    return msg;
  }, [mutate]);
  const patchMsg = useCallback((sidx, tid, id, patch) => mutate(d => { const s = d.sessions[sidx]; const m = s && s.threads[tid] && s.threads[tid].find(x => x.id === id); if (m) Object.assign(m, patch); }), [mutate]);
  const addTrace = useCallback((sidx, owner, en) => mutate(d => { const s = d.sessions[sidx]; if (!s) return; (s.traces[owner] = s.traces[owner] || []).push(en); }), [mutate]);
  const setAgent = useCallback((sidx, aid, patch) => mutate(d => { const s = d.sessions[sidx]; if (s && s.agents[aid]) Object.assign(s.agents[aid], patch); }), [mutate]);
  const withSurf = useCallback((sidx, aid, fn) => mutate(d => { const s = d.sessions[sidx]; const b = s && s.browsers[aid]; if (b) fn(b); }), [mutate]);
  const stream = useCallback((sidx, tid, text) => new Promise(res => {
    const msg = pushMsg(sidx, tid, { role: 'asst', text: '' });
    const step = Math.max(1, Math.ceil(text.length / 55)); let i = 0;
    const t = setInterval(() => { i = Math.min(text.length, i + step); patchMsg(sidx, tid, msg.id, { text: text.slice(0, i) }); if (i >= text.length) { clearInterval(t); res(msg); } }, RM ? 5 : 45);
  }), [pushMsg, patchMsg]);
  const gate = useCallback((sidx, aid, fn) => {
    const s = dbRef.current.sessions[sidx];
    if (!s || (aid && !s.agents[aid])) { setStale(n => n + 1); toast('Ignored a late event for an unknown session or worker'); return false; }
    fn(s); return true;
  }, [toast]);

  /* ---------- OMP TODO (read-only projection; the "main agent" replaces the whole snapshot) ---------- */
  const setTodos = (sidx, phases, reason) => {
    const before = uiRef.current.selTask;
    mutate(d => { const s = d.sessions[sidx]; if (!s) return; s.todo = JSON.parse(JSON.stringify(phases)); s.todoAt = Date.now(); s.revision++; });
    if (before && sidx === uiRef.current.sid) {
      const keys = []; phases.forEach((p, pi) => p.tasks.forEach((t, ti) => keys.push(taskKey(sidx, pi, ti, t))));
      if (keys.filter(k => k === before).length !== 1) { setSelTask(null); toast('Selection cleared because the task changed in OMP'); }
    }
    if (reason) toast(reason);
  };

  /* ---------- navigation ---------- */
  const closeRail = () => setRailOpen(false);
  const goHome = () => { uiRef.current.sid = null; setSid(null); setViewS('conv'); setInsp(null); closeRail(); };
  const openSession = id => {
    const s = dbRef.current.sessions[id]; if (!s) return;
    uiRef.current.sid = id;
    setSid(id); setViewS('conv'); setMode('agent'); setSelTask(null); setPhase('all'); closeRail();
    const workers = s.order.filter(x => x !== 'main');
    const wide = typeof window !== 'undefined' && window.innerWidth > 1240;
    mutate(d => { const x = d.sessions[id]; x.unread = 0; if (wide && workers.length && !x.seen) { x.seen = true; x.agents[workers[0]].unread = false; } });
    if (wide && workers.length && !s.seen) { setInsp(workers[0]); setInspTab('transcript'); } else setInsp(null);
    setDock(d => ({ ...d, sel: ['trace:main', s.shells[0] ? 'shell:' + s.shells[0].id : 'trace:main'] }));
    setShellId(s.shells[0] ? s.shells[0].id : null);
  };
  const setView = v => { setViewS(v); closeRail(); };
  const openInspector = (aid, tab = 'transcript', sidx) => {
    const sx = sidx || uiRef.current.sid; if (!sx || !dbRef.current.sessions[sx].agents[aid]) return;
    setInsp(aid); setInspTab(aid === 'main' ? 'browser' : tab); closeRail();
    mutate(d => { d.sessions[sx].agents[aid].unread = false; });
  };
  const closeInspector = () => setInsp(null);
  const focusTrace = owner => { setDock(d => ({ ...d, open: true, sel: ['trace:' + owner, d.sel[1]] })); closeRail(); };
  const toggleTheme = () => { setTheme(t => (t === 'dark' ? 'light' : 'dark')); };

  /* open a folder as a project */
  const openFolder = () => { if (fileRef.current) fileRef.current.click(); };
  const onFolderPicked = e => {
    const files = e.target.files; if (!files || !files.length) return;
    const rel = files[0].webkitRelativePath || ''; const name = rel.split('/')[0] || files[0].name || 'project';
    e.target.value = '';
    const exists = dbRef.current.projects.find(p => p.name === name);
    const id = exists ? exists.id : 'p' + (Date.now() % 100000);
    if (!exists) mutate(d => { d.projects.push({ id, name, path: '~/' + name }); });
    setCollapsed(c => ({ ...c, [id]: false })); setHomeProject(id); goHome(); toast(exists ? name + ' is already open' : 'Opened ' + name);
  };
  const startSession = (text, projectId) => {
    const t = text.trim(); if (!t) return;
    const id = 's' + (Date.now() % 100000);
    mutate(d => { const s = makeSession(id, titleFrom(t), projectId); s.threads.main.push(U(t)); d.sessions[id] = s; });
    uiRef.current.sid = id;
    setDrafts(x => ({ ...x, home: '' })); setSid(id); setViewS('conv'); setInsp(null); setMode('agent'); setSelTask(null); setShellId(null);
    setDock(d => ({ ...d, sel: ['trace:main', 'trace:main'] })); setCollapsed(c => ({ ...c, [projectId]: false }));
    mainReply(id, t);
  };

  /* ---------- browser surfaces ---------- */
  const surfaceNav = async (sidx, aid, url, push = true, depth = 0) => {
    const b0 = dbRef.current.sessions[sidx] && dbRef.current.sessions[sidx].browsers[aid]; if (!b0 || b0.readonly || b0.state === 'crashed') return;
    withSurf(sidx, aid, b => { b.state = 'navigating'; }); await wait(450);
    const b = dbRef.current.sessions[sidx] && dbRef.current.sessions[sidx].browsers[aid]; if (!b) return;
    const r = pageFor(b, url);
    if (r.redirect && depth < 2) { withSurf(sidx, aid, x => { x.state = 'ready'; }); return surfaceNav(sidx, aid, r.redirect, push, depth + 1); }
    withSurf(sidx, aid, x => { x.url = url; x.err = r.err || null; x.state = 'ready'; x.lastUsed = Date.now(); if (push) { x.history = x.history.slice(0, x.hi + 1); x.history.push(url); x.hi = x.history.length - 1; } });
  };
  const surfaceOpen = async (sidx, aid, url) => {
    mutate(d => { const s = d.sessions[sidx]; if (s && !s.browsers[aid]) s.browsers[aid] = mkSurface(sidx, aid, null, 'not-created'); });
    withSurf(sidx, aid, b => { b.state = 'starting'; }); await wait(650); withSurf(sidx, aid, b => { b.state = 'ready'; });
    if (url) await surfaceNav(sidx, aid, url, true);
  };
  const signIn = async (sidx, aid) => { withSurf(sidx, aid, b => { if (!b.readonly) b.store.cookie = 'session=' + hash(sidx + aid + 'cookie'); }); await surfaceNav(sidx, aid, 'http://localhost:3000/dashboard'); };
  let AUD = useRef(0);
  const logB = (sidx, aid, text, cls) => withSurf(sidx, aid, b => { b.activity.push({ i: ++AUD.current, t: clock() + '  ' + text, cls }); });
  const replayRun = async (sidx, aid) => {
    const o = sidx + '/' + aid; withSurf(sidx, aid, b => { b.activity = []; });
    const step = async (txt, fn, cls) => { await wait(520); if (fn) await fn(); logB(sidx, aid, `${txt}  [owner ${o}]`, cls || 'good'); addTrace(sidx, aid, tr('browser', txt, 'ok', '')); };
    await step('navigate to /login', () => surfaceNav(sidx, aid, 'http://localhost:3000/login'));
    await step('read the page: 2 inputs, 1 button');
    await step('type the email');
    await step('type the password');
    await step('click "Sign in"', () => signIn(sidx, aid));
    await step('screenshot (not available in preview)', null, '');
    const nm = dbRef.current.sessions[sidx] && dbRef.current.sessions[sidx].agents[aid];
    toast((nm ? nm.name : 'Agent') + ' signed in. Other agents are still signed out.');
  };

  /* ---------- shells (preview simulation of a PTY) ---------- */
  const shellSet = (sidx, shid, fn) => mutate(d => { const s = d.sessions[sidx]; const sh = s && s.shells.find(x => x.id === shid); if (sh) fn(sh); });
  const shellLine = (sidx, shid, text, c) => shellSet(sidx, shid, sh => { sh.lines.push({ c: c || '', t: text }); if (sh.lines.length > 400) { sh.lines.shift(); sh.trunc++; } });
  const getShell = (sidx, shid) => { const s = dbRef.current.sessions[sidx]; return s && s.shells.find(x => x.id === shid); };
  const shellExec = async (sidx, shid, raw) => {
    const sh0 = getShell(sidx, shid); if (!sh0) return; const cmd = raw.trim();
    shellLine(sidx, shid, `PS ${sh0.cwd}> ${raw}`, 'dim'); if (!cmd) return;
    shellSet(sidx, shid, sh => { sh.hist.push(cmd); });
    if (sh0.exited != null) { shellLine(sidx, shid, 'This shell has exited. Open a new shell.', 'bad'); return; }
    if (sh0.proc) { shellLine(sidx, shid, `(${sh0.proc} is still running. Press Ctrl+C to stop it.)`, 'dim'); return; }
    const [c, ...a] = cmd.split(/\s+/), lc = c.toLowerCase(), ps = ln => shellLine(sidx, shid, ln);
    if (lc === 'help') ps('Preview shell commands: help, dir, cd, git, bun test, npm run dev, cls, exit');
    else if (lc === 'dir' || lc === 'ls') ['src', 'tests', 'package.json', 'README.md'].forEach(ps);
    else if (lc === 'cd') shellSet(sidx, shid, sh => { const d = a[0] || ''; if (d === '..') sh.cwd = sh.cwd.replace(/\\[^\\]+$/, '') || 'C:\\'; else if (d) sh.cwd += '\\' + d.replace(/[\\/]+$/, ''); });
    else if (lc === 'cls' || lc === 'clear') shellSet(sidx, shid, sh => { sh.lines = []; sh.trunc = 0; });
    else if (lc === 'git') ['On branch main', '  modified:   src/session.ts', '  untracked:  tests/refresh.test.ts'].forEach(ps);
    else if (lc === 'bun' && a[0] === 'test') {
      shellSet(sidx, shid, sh => { sh.proc = 'bun test'; });
      for (const l of ['tests/refresh.test.ts:', '  rotates the token on refresh', '  rejects a reused refresh token', '  treats a missing expiry as expired']) { await wait(300); const s = getShell(sidx, shid); if (!s || !s.proc) return; ps(l); }
      await wait(300); const s = getShell(sidx, shid); if (!s || !s.proc) return; shellLine(sidx, shid, '3 pass, 0 fail', 'ok'); shellSet(sidx, shid, sh => { sh.proc = null; });
    } else if (lc === 'npm' && a[0] === 'run' && a[1] === 'dev') { shellSet(sidx, shid, sh => { sh.proc = 'npm run dev'; }); ps('ready on http://localhost:3000'); }
    else if (lc === 'exit') { shellSet(sidx, shid, sh => { sh.exited = 0; }); shellLine(sidx, shid, 'Process exited with code 0', 'dim'); }
    else shellLine(sidx, shid, `${c} : The term '${c}' is not recognized as the name of a cmdlet, function, script file, or operable program.`, 'bad');
  };
  const shellInterrupt = (sidx, shid) => { const sh = getShell(sidx, shid); if (sh && sh.proc) { shellLine(sidx, shid, '^C', 'dim'); shellSet(sidx, shid, x => { x.proc = null; }); } };
  const newShell = () => {
    const sx = uiRef.current.sid; if (!sx) return; const s = dbRef.current.sessions[sx], id = 'sh' + (Date.now() % 100000);
    mutate(d => { const x = d.sessions[sx]; x.shells.push({ id, name: 'Shell ' + (x.shells.length + 1), cwd: 'C:\\work\\' + (d.projects.find(p => p.id === x.project) || { name: 'project' }).name, lines: [{ c: 'dim', t: 'Windows PowerShell (preview simulation)' }], proc: null, exited: null, hist: [], trunc: 0 }); });
    setShellId(id); setDock(d => ({ ...d, open: true, sel: ['shell:' + id, d.sel[1]] })); void s;
  };
  const closeShell = async id => {
    const sx = uiRef.current.sid; const sh = getShell(sx, id); if (!sh) return;
    if (sh.proc) { const ok = await confirm({ title: 'Close ' + sh.name + '?', body: `"${sh.proc}" is still running in this shell. Closing the shell stops it.`, ok: 'Close shell', danger: true }); if (!ok) return; }
    mutate(d => { const x = d.sessions[sx]; x.shells = x.shells.filter(y => y.id !== id); });
    if (uiRef.current.mode === 'shell' && shellId === id) setMode('agent');
  };

  /* ---------- simulated main agent (preview replies are not model output) ---------- */
  const mainReply = async (sidx, text) => {
    if (busyRef.current[sidx]) { pushMsg(sidx, 'main', N('The main agent is still replying. Your message is kept in the transcript only.')); return; }
    busyRef.current[sidx] = true; setAgent(sidx, 'main', { state: 'running', activity: 'Thinking' });
    const t = text.toLowerCase();
    try {
      if (t.startsWith('/')) {
        const cmd = COMMANDS.find(c => text.split(/\s+/)[0] === c.n);
        if (!cmd) pushMsg(sidx, 'main', N('No command called ' + text.split(/\s+/)[0] + '. Type / to see the list.'));
        else if (!cmd.ok) pushMsg(sidx, 'main', N(cmd.n + ' is unavailable: ' + cmd.why));
        else if (cmd.act === 'review') {
          setAgent(sidx, 'main', { activity: 'Reviewing uncommitted changes' }); await wait(500);
          const m = pushMsg(sidx, 'main', T('task', 'review of uncommitted work', 'running')); await wait(1100); patchMsg(sidx, 'main', m.id, { status: 'ok', meta: '2 reviewers' });
          await stream(sidx, 'main', 'Nothing blocks the release. One P1: src/session.ts:91 treats an expiry of 0 as unset. One P2: the refresh retry has no backoff. Confidence on both is above 0.7.');
        } else { if (cmd.act) setDrawer(cmd.act); pushMsg(sidx, 'main', N(cmd.n + ': ' + cmd.d)); }
      } else if (/orchestrate|delegate|worker|spawn|parallel|split/.test(t)) {
        setAgent(sidx, 'main', { activity: 'Delegating' }); await wait(500);
        await stream(sidx, 'main', 'The docs update is independent of the code, so a worker can take it while I continue. Only I can start workers, so I am spawning it now.');
        const id = 'a' + Object.keys(dbRef.current.sessions[sidx].agents).length;
        gate(sidx, null, () => mutate(d => {
          const s = d.sessions[sidx];
          s.agents[id] = mkAgent(id, 'DocsSweep', 'running', 'Listing README claims that no longer match', { script: [
            { k: 'tool', m: T('grep', 'npm run', 'ok', '3 matches', '3 hits') },
            { k: 'say', text: 'Three README claims are stale: the install command, the env var list and the refresh section.' },
            { k: 'state', state: 'completed', activity: 'Finished. 3 stale claims reported' }
          ] });
          s.order.push(id); s.threads[id] = [U('Task from Main agent: list README claims that no longer match the code.')]; s.traces[id] = [];
        }));
        pushMsg(sidx, 'main', T('task', 'start DocsSweep', 'ok', '', 'started')); pushMsg(sidx, 'main', W(id));
        setTodos(sidx, withTask(dbRef.current.sessions[sidx].todo, 'II. Implement', { content: 'Update docs for token rotation', status: 'pending' }), 'Main agent updated the tasks');
        await stream(sidx, 'main', 'DocsSweep is running. I added "Update docs for token rotation" to the tasks so it stays visible.');
      } else if (/browser|login|page|open/.test(t)) {
        setAgent(sidx, 'main', { activity: 'Opening its browser' }); await wait(400);
        const m = pushMsg(sidx, 'main', T('browser', 'localhost:3000/dashboard', 'running'));
        await surfaceOpen(sidx, 'main', 'http://localhost:3000/dashboard'); patchMsg(sidx, 'main', m.id, { status: 'ok', meta: 'ready' });
        await stream(sidx, 'main', 'My browser opened /dashboard and was sent to /login, because this profile has no session cookie. AuthTests has its own browser and cookies, so signing in there does not sign me in.');
      } else if (/todo|task|block|done|progress/.test(t)) {
        setAgent(sidx, 'main', { activity: 'Updating the tasks' }); await wait(400);
        const todo = JSON.parse(JSON.stringify(dbRef.current.sessions[sidx].todo));
        todo.forEach(p => p.tasks.forEach(k => { if (k.content === 'Add refresh-token rotation') k.status = 'completed'; if (k.content === 'Harden session expiry guard') k.status = 'in_progress'; }));
        pushMsg(sidx, 'main', T('todo', 'set_todos', 'ok', 'Replaced the whole TODO snapshot', 'updated'));
        setTodos(sidx, todo, todo.length ? 'Main agent updated the tasks' : '');
        await stream(sidx, 'main', 'Rotation is done and I started on the expiry guard. The board follows the tasks I just set. No worker was stopped.');
      } else {
        setAgent(sidx, 'main', { activity: 'Reading the code' }); await wait(500);
        const a = pushMsg(sidx, 'main', T('read', 'src/session.ts', 'running')); addTrace(sidx, 'main', tr('read', 'src/session.ts', 'ok', '142 lines')); await wait(800); patchMsg(sidx, 'main', a.id, { status: 'ok', meta: '142 lines' });
        await stream(sidx, 'main', 'I read the session module. This is a preview reply, so a model did not write it. In the desktop build this answer comes from your configured OMP model.');
      }
    } finally { busyRef.current[sidx] = false; setAgent(sidx, 'main', { state: 'idle', activity: 'Waiting for your next message' }); }
  };
  const stopMain = async () => {
    const ok = await confirm({ title: 'Stop the current turn?', body: 'The main agent stops generating. Your tasks and workers are not changed.', ok: 'Stop turn', danger: true }); if (!ok) return;
    setAgent(sid, 'main', { state: 'idle', activity: 'Stopped by you' }); pushMsg(sid, 'main', N('Turn stopped by you')); toast('Main agent stopped');
  };
  const steer = async (sidx, aid, text) => {
    const a = dbRef.current.sessions[sidx].agents[aid]; pushMsg(sidx, aid, U(text));
    if (a.state === 'stopped' || a.state === 'failed') { pushMsg(sidx, aid, N('This worker is ' + a.state + '. Restart it to continue.')); return; }
    if (a.state === 'waiting') setAgent(sidx, aid, { state: 'running', activity: 'Following your steering' });
    await wait(700); await stream(sidx, aid, 'Understood. This is a preview reply sent only to ' + a.name + '. Main agent and the other workers did not see your message.');
  };
  const resolveApproval = (mid_, status) => {
    const s = dbRef.current.sessions[uiRef.current.sid]; const m = s.threads.main.find(x => x.id === mid_); if (!m) return;
    patchMsg(s.id, 'main', mid_, { status });
    if (status === 'approved') { const t = pushMsg(s.id, 'main', T('bash', m.arg, 'running')); addTrace(s.id, 'main', tr('bash', m.arg, 'ok', 'exit 0')); wait(900).then(() => patchMsg(s.id, 'main', t.id, { status: 'ok', meta: 'done' })); }
    else pushMsg(s.id, 'main', T('bash', m.arg, 'denied'));
  };
  const stopWorker = async aid => {
    const s = dbRef.current.sessions[sid], a = s.agents[aid];
    const ok = await confirm({ title: 'Stop ' + a.name + '?', body: 'Only this worker stops. Its tasks stay in the OMP TODO, and its chat and browser are kept (read-only).', ok: 'Stop worker', danger: true }); if (!ok) return;
    setAgent(sid, aid, { state: 'stopped', activity: 'Stopped by you' }); withSurf(sid, aid, b => { b.readonly = true; }); pushMsg(sid, aid, N('Stopped by you')); toast(a.name + ' stopped');
  };
  const restartWorker = aid => { setAgent(sid, aid, { state: 'running', activity: 'Restarted' }); withSurf(sid, aid, b => { b.readonly = false; }); pushMsg(sid, aid, N('Restarted by you')); toast('Restarted'); };

  const tick = () => {
    if (uiRef.current.conn === 'disconnected') return;
    Object.values(dbRef.current.sessions).forEach(s => s.order.forEach(id => {
      const a = s.agents[id]; if (id === 'main' || a.state !== 'running' || !a.script || !a.script.length) return;
      const step = a.script[0]; mutate(d => { d.sessions[s.id].agents[id].script.shift(); });
      if (step.k === 'tool') { const m = pushMsg(s.id, id, { ...step.m, id: undefined }); addTrace(s.id, id, tr(m.tool, m.arg, m.status, m.meta)); }
      if (step.k === 'say') stream(s.id, id, step.text);
      if (step.k === 'state') setAgent(s.id, id, { state: step.state, activity: step.activity });
    }));
  };
  logic.current.tick = tick;
  useEffect(() => { let t2; const t1 = setTimeout(function loop() { logic.current.tick(); t2 = setTimeout(loop, RM ? 200 : 7000); }, RM ? 200 : 9000); return () => { clearTimeout(t1); clearTimeout(t2); }; }, []);

  /* ---------- runtime connection ---------- */
  const disconnect = () => { if (uiRef.current.conn === 'disconnected') return; setConn('disconnected'); toast('Runtime disconnected. Transcript preserved.'); };
  const reconnect = async () => { if (uiRef.current.conn === 'connected') return; await wait(900); setConn('connected'); mutate(d => { Object.values(d.sessions).forEach(s => { s.todoAt = Date.now(); }); }); toast('Reconnected. The board was rebuilt from OMP state.'); };

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = e => {
      const inShell = e.target && e.target.classList && e.target.classList.contains('shell-in');
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && !inShell) { e.preventDefault(); setPalette(true); }
      if (e.altKey && e.key.toLowerCase() === 't' && uiRef.current.sid) { e.preventDefault(); setViewS(v => (v === 'board' ? 'conv' : 'board')); }
      if (e.altKey && e.key.toLowerCase() === 'b' && uiRef.current.sid) { e.preventDefault(); openInspector(uiRef.current.insp || 'main', 'browser'); }
      if (e.altKey && e.key.toLowerCase() === 'd') { e.preventDefault(); setDock(d => ({ ...d, open: !d.open })); }
      if (e.key === 'Escape' && !LAYERS.length) { setRailOpen(false); if (typeof window !== 'undefined' && window.innerWidth <= 1240) setInsp(null); }
    };
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line

  const A = {
    gsap, db, sid, ss, view, insp, inspTab, conn, dock, dragging, mode, shellId: curShellId, phase, group, selTask, colTab, drafts, settings, theme, railOpen, collapsed, homeProject, stale,
    drawer, palette, confirmS, pv, dockTabs, dockHeight, dockMax, workRef, scrollRef, eff,
    setDraft, setSet, setSettings, setPhase, setGroup, setSelTask, setColTab, setMode, setShellId, setDock, setDragging, setRailOpen, setCollapsed, setHomeProject, setDrawer, setPalette, setPv, setConn, setConfirmS,
    toast, confirm, mutate, pushMsg, patchMsg, addTrace, setAgent, stream, gate, setTodos, goHome, openSession, setView, openInspector, closeInspector, focusTrace, toggleTheme, newSession: goHome, openFolder, startSession,
    surfaceNav, surfaceOpen, signIn, replayRun, withSurf, shellExec, shellInterrupt, newShell, closeShell, mainReply, stopMain, steer, resolveApproval, stopWorker, restartWorker, disconnect, reconnect, setStale, AUD
  };

  return (
    <Ctx.Provider value={A}>
      <div className="cp" data-theme={theme}>
        <style>{CSS}</style>
        <input ref={fileRef} type="file" webkitdirectory="" multiple hidden onChange={onFolderPicked} aria-hidden="true" tabIndex={-1} />
        <div className="app" ref={appRef}>
          <Topbar />
          {conn === 'disconnected' && <div className="banner" role="status"><Unplug size={16} /><span><b>Runtime disconnected.</b> Your transcript is preserved. Nothing is generated while offline.</span><span className="grow" /><button className="btn sm primary" onClick={reconnect}>Reconnect</button></div>}
          <Rail />
          <div className={'scrim-rail' + (railOpen ? ' on' : '')} onClick={closeRail} />
          <main className="work" ref={workRef} id="main">
            <div className="top-split">
              {!ss ? <Home /> : view === 'conv' ? <Conversation key={ss.id} /> : <Board key={ss.id} />}
              {ss && insp && ss.agents[insp] && <Inspector key={ss.id + insp} />}
            </div>
            {ss && view === 'conv' && <TaskStrip />}
            {ss && view === 'conv' && <Composer />}
            {ss && <Dock />}
          </main>
        </div>
        {drawer && <DrawerLayer />}
        {palette && <PaletteLayer />}
        {confirmS && <ConfirmLayer />}
        {pv && <PreviewLayer />}
        <div className="toasts" role="status" aria-live="polite">{toasts.map(t => <Toast key={t.id} msg={t.msg} />)}</div>
      </div>
    </Ctx.Provider>
  );
}
function Toast({ msg }) {
  const A = useApp(); const ref = useRef(null);
  useLayoutEffect(() => { if (A.gsap && !RM) A.gsap.from(ref.current, { x: 24, opacity: 0, duration: .25, ease: 'power2.out' }); }, []); // eslint-disable-line
  return <div className="toast" ref={ref}>{msg}</div>;
}

/* ================================================================ topbar */
function Topbar() {
  const A = useApp(); const { ss, db, view, conn } = A; const off = conn === 'disconnected';
  const c = ss ? counts(ss) : null; const proj = ss ? db.projects.find(p => p.id === ss.project) : db.projects.find(p => p.id === A.homeProject);
  return (
    <header className="topbar glass" role="banner">
      <button className="ibtn only-narrow" aria-label="Open workspaces" aria-expanded={A.railOpen} onClick={() => A.setRailOpen(v => !v)}><Menu size={16} /></button>
      <button className="brand" onClick={A.goHome} aria-label="canoPi, go to Home"><Logo /><span>canoPi</span></button>
      <div className="crumb">
        <span className="lbl">{proj ? proj.name : 'No project'}</span><span className="lbl" aria-hidden="true">/</span>
        <select aria-label="Session" value={ss ? ss.id : 'home'} onChange={e => (e.target.value === 'home' ? A.goHome() : A.openSession(e.target.value))}>
          <option value="home">Home</option>
          {db.projects.map(p => { const list = Object.values(db.sessions).filter(s => s.project === p.id); return list.length ? <optgroup key={p.id} label={p.name}>{list.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup> : null; })}
        </select>
      </div>
      <span className={'pill' + (off ? ' off' : '')} title="This is a UI preview with simulated data. Nothing here is run by OMP.">{off ? 'Disconnected' : 'Preview'}</span>
      <span className="grow" />
      <button className="tbtn" onClick={() => A.setPalette(true)} aria-label="Search (Ctrl+K)"><Search size={14} /><span className="lbl">Search</span><kbd>Ctrl K</kbd></button>
      <button className="tbtn" disabled={!ss} aria-pressed={view === 'board' && !!ss} title={ss ? `${c.in_progress} in progress, ${c.blocked} blocked` : 'Open a session first'} aria-label={ss ? `Tasks, ${c.in_progress} in progress, ${c.blocked} blocked` : 'Tasks'} onClick={() => A.setView(view === 'board' ? 'conv' : 'board')}>
        <Kanban size={14} /><span className="lbl">Tasks</span>{ss && c.in_progress + c.blocked > 0 && <span className="count">{c.in_progress + c.blocked}</span>}
      </button>
      <button className="tbtn" disabled={!ss} title={ss ? '' : 'Open a session first'} aria-label="Browser" onClick={() => A.openInspector(A.insp || 'main', 'browser')}><Globe size={14} /><span className="lbl">Browser</span></button>
      <button className="ibtn theme-btn" onClick={A.toggleTheme} aria-label={A.theme === 'dark' ? 'Switch to Cloud Light' : 'Switch to Midnight Sky'} title={A.theme === 'dark' ? 'Midnight Sky. Switch to Cloud Light' : 'Cloud Light. Switch to Midnight Sky'}>{A.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
      <button className="ibtn" onClick={() => A.setDrawer('models')} aria-label="Settings"><Settings size={16} /></button>
    </header>
  );
}

/* ================================================================ rail */
function Rail() {
  const A = useApp(); const { db, sid } = A;
  return (
    <aside className={'rail glass' + (A.railOpen ? ' open' : '')} id="rail" aria-label="Workspaces">
      <div className="rail-h"><h2>Workspaces</h2><button className="ibtn sm only-narrow" onClick={() => A.setRailOpen(false)} aria-label="Close workspaces"><X size={14} /></button></div>
      <div className="rail-acts">
        <button onClick={A.newSession}><SquarePen size={15} /><span>New session</span></button>
        <button onClick={A.openFolder}><FolderOpen size={15} /><span>Open project</span></button>
      </div>
      <nav className="tree" aria-label="Projects, sessions and agents">
        {db.projects.map(p => <ProjectNode key={p.id} p={p} />)}
      </nav>
      <div className="rail-f"><button className="btn sm ghost" onClick={() => A.setPv(true)}>Preview controls</button><small>Simulated data. Not connected to OMP.</small></div>
    </aside>
  );
}
function ProjectNode({ p }) {
  const A = useApp(); const sessions = Object.values(A.db.sessions).filter(s => s.project === p.id); const open = !A.collapsed[p.id];
  return (
    <div>
      <button className="proj-h" aria-expanded={open} onClick={() => A.setCollapsed(c => ({ ...c, [p.id]: open }))}>
        <ChevronRight size={13} className="chev" />{open ? <FolderOpen size={15} /> : <Folder size={15} />}<span>{p.name}</span><span className="n">{sessions.length || ''}</span>
      </button>
      {open && (sessions.length ? <ul>{sessions.map(s => <SessionNode key={s.id} s={s} />)}</ul> : <p className="empty-note">No sessions yet. Start one from Home.</p>)}
    </div>
  );
}
function SessionNode({ s }) {
  const A = useApp(); const active = s.id === A.sid; const running = Object.values(s.agents).filter(a => a.state === 'running').length;
  return (
    <li>
      <button className="sess-b" aria-current={active} onClick={() => A.openSession(s.id)}>
        <span>{s.name}</span>{!active && (s.unread ? <span className="badge">{s.unread} new</span> : running ? <span className="badge">{running} running</span> : null)}
      </button>
      {active && (
        <ul className="agents" aria-label="Agents in this session">
          {s.order.map(id => <AgentRow key={id} a={s.agents[id]} s={s} />)}
        </ul>
      )}
    </li>
  );
}
function AgentRow({ a, s }) {
  const A = useApp(); const ref = useRef(null); const st = A.eff(a); const [, Ico] = STATE_META[st]; const child = a.parent && a.parent !== 'main'; const surf = s.browsers[a.id];
  const current = A.insp === a.id || (a.id === 'main' && !A.insp);
  useLayoutEffect(() => { if (A.gsap && !RM) A.gsap.from(ref.current, { x: -12, opacity: 0, duration: .3, ease: 'power2.out' }); }, []); // eslint-disable-line
  return (
    <li ref={ref} className={'ag-li' + (child ? ' child' : '')} data-live={st === 'running' ? 1 : 0}>
      <div className="ag-row">
        <button className="ag" aria-current={current} aria-label={`${a.name}, ${STATE_META[st][0]}${a.unread ? ', new messages' : ''}`}
          onClick={() => (a.id === 'main' ? (A.closeInspector(), A.setView('conv')) : A.openInspector(a.id, 'transcript'))}>
          <span className={'st st-' + st}><Ico size={14} /></span><span className="nm">{a.name}</span>
          {a.flag && <span className="flag">Unsupported depth</span>}{a.unread && <span className="unread" aria-hidden="true" />}
        </button>
        <button className={'ibtn sm ag-ico' + (surf ? ' on' : '')} aria-label={'Browser of ' + a.name} title={surf ? 'Open this agent\u2019s browser' : 'No browser yet. It is created on first use.'} onClick={() => A.openInspector(a.id, 'browser')}><Globe size={14} /></button>
        <button className="ibtn sm ag-ico" aria-label={'Activity of ' + a.name} title="Open activity" onClick={() => A.focusTrace(a.id)}><Terminal size={14} /></button>
      </div>
    </li>
  );
}

/* ================================================================ home (no session yet) */
function Home() {
  const A = useApp(); const g = A.gsap; const hour = new Date().getHours();
  const list = useRef(greetings(USER_NAME, hour)); const [idx, setIdx] = useState(() => (Math.random() < .3 ? 0 : Math.floor(Math.random() * list.current.length)));
  const [clicks, setClicks] = useState(0); const [text, setText] = useState(() => list.current[idx]);
  const wrap = useRef(null), phraseRef = useRef(null), markRef = useRef(null), ta = useRef(null);
  const draft = A.drafts.home || '';
  useLayoutEffect(() => { if (g && !RM && wrap.current) g.from(wrap.current.children, { y: 16, opacity: 0, duration: .5, stagger: .09, ease: 'power3.out', clearProps: 'all' }); }, [!!g]); // eslint-disable-line
  const cycle = () => {
    const n = clicks + 1; setClicks(n);
    const next = SECRETS[n] || list.current[(idx + 1) % list.current.length]; if (!SECRETS[n]) setIdx(i => (i + 1) % list.current.length);
    if (g && !RM) {
      g.to(markRef.current, { rotation: '+=360', duration: .7, ease: 'back.out(1.6)' });
      g.to(phraseRef.current, { y: -10, opacity: 0, duration: .16, onComplete: () => { setText(next); g.fromTo(phraseRef.current, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: .28, ease: 'power2.out' }); } });
    } else setText(next);
  };
  const send = () => A.startSession(draft, A.homeProject);
  const proj = A.db.projects.find(p => p.id === A.homeProject) || A.db.projects[0];
  return (
    <section className="home" aria-label="Home">
      <div className="home-in" ref={wrap}>
        <h1 className="greet"><button className="greet-mark" ref={markRef} onClick={cycle} aria-label="Change greeting"><Logo className="mark" /></button><span ref={phraseRef} aria-live="polite">{text}</span></h1>
        <form className="hbox" onSubmit={e => { e.preventDefault(); send(); }}>
          <textarea ref={ta} aria-label="What do you want to work on?" placeholder="Describe what you want to build or fix" value={draft} rows={2}
            onChange={e => A.setDraft('home', e.target.value)} onKeyDown={e => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <div className="hrow">
            <button type="button" className="ibtn" onClick={A.openFolder} aria-label="Open a project folder" title="Open a project folder"><FolderPlus size={17} /></button>
            <select aria-label="Project for the new session" value={proj ? proj.id : ''} onChange={e => A.setHomeProject(e.target.value)}>{A.db.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <span className="grow" />
            <button type="button" className="chip" onClick={() => A.setDrawer('models')}>{A.settings.roles.default}, {A.settings.think}</button>
            <button type="submit" className="send" aria-label="Start session" disabled={!draft.trim() || !proj}><ArrowUp size={17} /></button>
          </div>
        </form>
        <div className="starters">{STARTERS.map(s => <button key={s} onClick={() => { A.setDraft('home', s); if (ta.current) ta.current.focus(); }}>{s}</button>)}</div>
      </div>
    </section>
  );
}

/* ================================================================ conversation */
function Conversation() {
  const A = useApp(); const ss = A.ss; const m = ss.agents.main; const ref = useRef(null);
  useLayoutEffect(() => { if (A.gsap && !RM) A.gsap.from(ref.current, { opacity: 0, y: 8, duration: .28, ease: 'power2.out', clearProps: 'all' }); }, []); // eslint-disable-line
  const running = A.conn === 'connected' && m.state === 'running';
  return (
    <section className="conv" aria-label="Main conversation" ref={ref}>
      <header className="sess-head">
        <div><h1>{ss.name}</h1><p><span>Main agent</span><StateTag s={A.eff(m)} /><span>{m.activity}</span></p></div>
        <span className="grow" />{running && <button className="btn sm" onClick={A.stopMain}>Stop turn</button>}
      </header>
      <Transcript tkey={ss.id + ':main'} msgs={ss.threads.main} ctx="main" label="Main agent transcript" id="transcript" />
    </section>
  );
}
function Transcript({ tkey, msgs, ctx, label, id }) {
  const A = useApp(); const ref = useRef(null); const seen = useRef(new Set(msgs.map(m => m.id)));
  useStick(ref, msgs);
  useLayoutEffect(() => { const el = ref.current; const sv = A.scrollRef.current[tkey]; el.scrollTop = sv != null ? sv : el.scrollHeight; return () => { A.scrollRef.current[tkey] = el.scrollTop; }; }, [tkey]); // eslint-disable-line
  useLayoutEffect(() => {
    msgs.forEach((m, i) => { if (!seen.current.has(m.id)) { seen.current.add(m.id); const ch = ref.current && ref.current.children[i]; if (ch && A.gsap && !RM) A.gsap.from(ch, { opacity: 0, y: 8, duration: .25, ease: 'power2.out', clearProps: 'all' }); } });
  }, [msgs]); // eslint-disable-line
  return <div className="transcript" ref={ref} role="log" aria-label={label} tabIndex={0} id={id}>{msgs.map(m => <Msg key={m.id} m={m} ctx={ctx} />)}</div>;
}
function Msg({ m, ctx }) {
  switch (m.role) {
    case 'user': return <article className="msg user"><div className="body">{m.text}</div></article>;
    case 'asst': return <article className="msg asst"><div className="body">{m.text}</div></article>;
    case 'think': return <details className="think"><summary>Thinking</summary><p>{m.text}</p></details>;
    case 'notice': return <div className="msg notice">{m.text}</div>;
    case 'tool': return <ToolRow m={m} ctx={ctx} />;
    case 'worker': return <WorkerCard aid={m.aid} />;
    case 'approval': return <ApprovalCard m={m} />;
    default: return null;
  }
}
function ToolRow({ m, ctx }) {
  const A = useApp(); const meta = TOOL_META[m.tool] || [FileText, m.tool, m.tool]; const Ico = meta[0];
  const verb = m.status === 'running' ? meta[1] : m.status === 'denied' ? 'Denied' : m.status === 'error' ? 'Failed' : meta[2];
  return (
    <details className={'tool ' + m.status}>
      <summary><span className="t-ic"><Ico size={14} /></span><span className="t-v">{verb}</span><span className="t-a" title={m.arg}>{prettyArg(m.arg)}</span>
        <span className="t-m">{m.status === 'running' ? <span className="spin" aria-label="Working" /> : m.meta ? m.meta : m.status === 'ok' ? <CircleCheck size={13} /> : null}</span></summary>
      <div className="t-d"><code>{m.tool} {m.arg}</code>{m.out && <pre>{m.out}</pre>}{ctx && <p><button className="lnk" onClick={() => A.focusTrace(ctx)}>Open activity</button></p>}</div>
    </details>
  );
}
function WorkerCard({ aid }) {
  const A = useApp(); const a = A.ss.agents[aid]; if (!a) return <div className="msg notice">Worker not found in this session</div>; const surf = A.ss.browsers[aid];
  return (
    <div className="card">
      <div className="row"><h4>{a.name}</h4><StateTag s={A.eff(a)} /></div>
      <p>{a.activity || 'No activity reported'}</p>
      <div className="row"><button className="btn sm" onClick={() => A.openInspector(aid, 'transcript')}>Open</button><button className="btn sm ghost" onClick={() => A.focusTrace(aid)}>Activity</button>{surf && <button className="btn sm ghost" onClick={() => A.openInspector(aid, 'browser')}>Browser</button>}</div>
    </div>
  );
}
function ApprovalCard({ m }) {
  const A = useApp(); const s = m.status;
  return (
    <div className={'card' + (s === 'pending' ? ' pending' : '')}>
      <div className="row"><h4>Main agent wants to delete files</h4><span className={'st ' + (s === 'pending' ? 'st-waiting' : s === 'approved' ? 'st-completed' : 'st-failed')}>{s === 'pending' ? 'Needs your OK' : s === 'approved' ? 'Allowed' : 'Denied'}</span></div>
      <code>{m.arg}</code>
      <p>{s === 'pending' ? 'It waits until you decide.' : s === 'approved' ? 'You allowed it and it ran.' : 'You denied it. It did not run.'}</p>
      {s === 'pending' && <div className="row"><button className="btn sm primary" onClick={() => A.resolveApproval(m.id, 'approved')}>Allow once</button><button className="btn sm danger" onClick={() => A.resolveApproval(m.id, 'denied')}>Deny</button></div>}
    </div>
  );
}

/* ================================================================ strip + composer */
function TaskStrip() {
  const A = useApp(); const c = counts(A.ss); const total = Object.values(c).reduce((a, b) => a + b, 0); if (!total) return null;
  const parts = [];
  if (c.in_progress) parts.push(<span key="p"><b>{c.in_progress}</b> in progress</span>);
  if (c.blocked) parts.push(<span key="b"><b>{c.blocked}</b> blocked</span>);
  if (!parts.length) parts.push(c.pending ? <span key="t"><b>{c.pending}</b> to do</span> : <span key="d">All done</span>);
  return <div className="strip"><span>{parts.reduce((a, x, i) => (i ? [...a, <span key={'s' + i} aria-hidden="true"> &middot; </span>, x] : [x]), [])}</span><button type="button" onClick={() => A.setView('board')}>View tasks</button></div>;
}
function Composer() {
  const A = useApp(); const ss = A.ss; const off = A.conn === 'disconnected'; const shell = A.mode === 'shell'; const sh = ss.shells.find(s => s.id === A.shellId);
  const key = ss.id + ':' + (shell ? 'shell:' + A.shellId : 'main'); const value = A.drafts[key] || ''; const ta = useRef(null);
  const [slash, setSlash] = useState({ list: [], idx: 0 });
  useLayoutEffect(() => { const t = ta.current; if (!t) return; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 140) + 'px'; }, [value, shell]);
  const submit = () => {
    const text = value.trim(); if (!text) return;
    if (shell) { if (!sh) return; A.setDraft(key, ''); A.shellExec(ss.id, sh.id, text); return; }
    if (off) { A.toast('Disconnected. Reconnect first.'); return; }
    A.setDraft(key, ''); setSlash({ list: [], idx: 0 }); A.pushMsg(ss.id, 'main', U(text)); A.mainReply(ss.id, text);
  };
  const pick = (i, now) => { const c = slash.list[i]; if (!c) return; if (!c.ok) { A.toast(c.n + ' is unavailable: ' + c.why); return; } A.setDraft(key, c.n + ' '); setSlash({ list: [], idx: 0 }); if (ta.current) ta.current.focus(); if (now) setTimeout(() => { A.setDraft(key, ''); A.pushMsg(ss.id, 'main', U(c.n)); A.mainReply(ss.id, c.n); }, 0); };
  const onChange = e => { const v = e.target.value; A.setDraft(key, v); if (!shell && v.startsWith('/') && !v.includes(' ')) setSlash({ list: COMMANDS.filter(c => c.n.startsWith(v.toLowerCase())), idx: 0 }); else setSlash({ list: [], idx: 0 }); };
  const onKey = e => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const n = slash.list.length;
    if (n) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlash(s => ({ ...s, idx: (s.idx + 1) % n })); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlash(s => ({ ...s, idx: (s.idx - 1 + n) % n })); return; }
      if (e.key === 'Tab') { e.preventDefault(); pick(slash.idx, false); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); pick(slash.idx, true); return; }
      if (e.key === 'Escape') { e.stopPropagation(); setSlash({ list: [], idx: 0 }); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };
  return (
    <form className="composer glass" onSubmit={e => { e.preventDefault(); submit(); }} autoComplete="off">
      <div className="c-top">
        <div className="seg" role="radiogroup" aria-label="Composer target">
          <button type="button" role="radio" aria-checked={!shell} onClick={() => A.setMode('agent')}>Main agent</button>
          <button type="button" role="radio" aria-checked={shell} disabled={!ss.shells.length} title={ss.shells.length ? '' : 'Open a shell first'} onClick={() => { A.setMode('shell'); setTimeout(() => ta.current && ta.current.focus(), 0); }}>Shell</button>
        </div>
        {shell && <select aria-label="Shell to send to" value={A.shellId || ''} onChange={e => A.setShellId(e.target.value)}>{ss.shells.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
        <span className="route">{shell ? (sh ? <>To <b>{sh.name}</b>. A real terminal in the desktop build, not an OMP tool.</> : 'No shell open') : <>To <b>Main agent</b> only</>}</span>
      </div>
      <div className="c-box">
        <textarea ref={ta} rows={1} className={shell ? 'mono' : ''} value={value} onChange={onChange} onKeyDown={onKey} disabled={!shell && off}
          aria-label={shell ? 'Shell command' : 'Message main agent'} aria-activedescendant={slash.list.length ? 'sl' + slash.idx : undefined}
          placeholder={shell ? 'Command for the selected shell' : off ? 'Reconnect to message the main agent' : 'Message the main agent. Type / for commands'} />
        <button type="submit" className="send" aria-label={shell ? 'Run command' : 'Send message'} disabled={(!shell && off) || (shell && !sh) || !value.trim()}><ArrowUp size={17} /></button>
      </div>
      <div className="c-meta">
        <button type="button" className="chip" onClick={() => A.setDrawer('models')}>{A.settings.roles.default}</button>
        <label>Thinking <select aria-label="Thinking level" value={A.settings.think} onChange={e => A.setSet({ think: e.target.value })}>{THINK.map(o => <option key={o}>{o}</option>)}</select></label>
        <span className="meter" title="Preview value. A live build shows this only if the runtime reports it.">Context 38% <i><b style={{ width: '38%' }} /></i></span>
      </div>
      {slash.list.length > 0 && (
        <div className="slash" role="listbox" aria-label="Commands">
          <h5>Preview list. A live build shows what the runtime reports.</h5>
          {slash.list.map((c, i) => <div key={c.n} id={'sl' + i} className="it" role="option" aria-selected={i === slash.idx} aria-disabled={!c.ok} onMouseDown={e => { e.preventDefault(); pick(i, false); }}><b>{c.n}</b><span>{c.ok ? c.d : 'Unavailable: ' + c.why}</span></div>)}
        </div>
      )}
    </form>
  );
}

/* ================================================================ inspector */
function Inspector() {
  const A = useApp(); const ss = A.ss; const aid = A.insp; const a = ss.agents[aid]; const isMain = aid === 'main'; const ref = useRef(null);
  useLayoutEffect(() => { if (A.gsap && !RM) A.gsap.from(ref.current, { x: 36, opacity: 0, duration: .26, ease: 'power2.out', clearProps: 'all' }); }, []); // eslint-disable-line
  const off = A.conn === 'disconnected'; const st = A.eff(a);
  const link = Object.entries(ss.links).filter(([, v]) => v === aid).map(([k]) => k);
  const canStop = !off && ['running', 'waiting', 'reviewing'].includes(a.state), canRestart = !off && ['stopped', 'failed'].includes(a.state);
  const tab = isMain ? 'browser' : A.inspTab;
  return (
    <aside className="insp glass" aria-label="Worker inspector" ref={ref}>
      <div className="insp-h">
        <div className="t"><span className="oname">{isMain ? 'Main agent' : a.name}</span><span><StateTag s={st} /></span></div>
        <button className="ibtn" onClick={A.closeInspector} aria-label="Close inspector. This does not stop the agent." title="Close. The agent keeps running."><X size={16} /></button>
      </div>
      {!isMain && <div className="insp-task"><b>Task</b> {link.length ? link.join(', ') : 'none linked'} {link.length ? <span title="canoPi keeps this link. The OMP TODO has no owner field.">(local link)</span> : null}</div>}
      {!isMain && (
        <div className="insp-acts">
          <button className="btn sm" onClick={() => A.focusTrace(aid)}><Terminal size={13} />Activity</button>
          {canStop && <button className="btn sm danger" onClick={() => A.stopWorker(aid)}>Stop worker</button>}
          {canRestart && <button className="btn sm" onClick={() => A.restartWorker(aid)}>Restart worker</button>}
        </div>
      )}
      {!isMain && <div className="tabs" role="tablist" aria-label="Inspector views">
        <button role="tab" aria-selected={tab === 'transcript'} onClick={() => A.openInspector(aid, 'transcript')}>Chat</button>
        <button role="tab" aria-selected={tab === 'browser'} onClick={() => A.openInspector(aid, 'browser')}>Browser</button>
      </div>}
      <div className="insp-body">{tab === 'transcript' && !isMain ? <InspChat aid={aid} /> : <BrowserPanel aid={aid} />}</div>
    </aside>
  );
}
function InspChat({ aid }) {
  const A = useApp(); const ss = A.ss; const a = ss.agents[aid]; const off = A.conn === 'disconnected'; const key = ss.id + ':' + aid + ':steer'; const value = A.drafts[key] || '';
  const submit = () => { const t = value.trim(); if (!t || off) return; A.setDraft(key, ''); A.steer(ss.id, aid, t); };
  return (
    <>
      <Transcript tkey={ss.id + ':' + aid} msgs={ss.threads[aid]} ctx={aid} label={a.name + ' chat'} id="inspTranscript" />
      <form className="steer" onSubmit={e => { e.preventDefault(); submit(); }}>
        <span className="route">Steering <b>{a.name}</b> only. The main conversation is not affected.</span>
        <div className="r">
          <textarea rows={1} aria-label={'Steer ' + a.name} value={value} disabled={off} placeholder={off ? 'Reconnect to steer' : 'Tell ' + a.name + ' what to do next'}
            onChange={e => A.setDraft(key, e.target.value)} onKeyDown={e => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
          <button className="send" aria-label="Send steering" disabled={off || !value.trim()}><ArrowUp size={17} /></button>
        </div>
      </form>
    </>
  );
}

/* ---------------- browser ---------------- */
function PageView({ b, aid }) {
  const A = useApp(); const r = pageFor(b, b.url);
  if (r.page === 'login') return <div className="page"><h3>Sign in to the gateway</h3><p>{b.store.cookie ? <span className="ok">Already signed in.</span> : 'No session in this browser profile.'}</p><label>Email</label><input defaultValue="dev@local" aria-label="Email" /><label>Password</label><input type="password" defaultValue="correct-horse" aria-label="Password" /><button type="button" onClick={() => A.signIn(A.ss.id, aid)}>Sign in</button></div>;
  if (r.page === 'dashboard') return <div className="page"><h3>Dashboard</h3><p className="ok">Signed in as dev@local</p><p>The session cookie <code>{b.store.cookie}</code> exists in this agent&rsquo;s profile only.</p></div>;
  if (r.page === 'docs') return <div className="page"><h3>Token rotation</h3><p>Every refresh issues a new token and invalidates the previous one after a short grace window.</p></div>;
  return <div className="empty"><b>Blank</b></div>;
}
function BrowserPanel({ aid }) {
  const A = useApp(); const ss = A.ss; const a = ss.agents[aid]; const b = ss.browsers[aid]; const off = A.conn === 'disconnected'; const load = useRef(null);
  const [url, setUrl] = useState(b && b.url ? b.url : '');
  useEffect(() => { setUrl(b && b.url ? b.url : ''); }, [b && b.url, aid]); // eslint-disable-line
  useEffect(() => { const g = A.gsap; if (!g || !load.current || RM || !b) return; if (b.state === 'navigating') g.fromTo(load.current, { width: '0%', opacity: 1 }, { width: '100%', duration: .45, ease: 'power1.inOut' }); else g.to(load.current, { opacity: 0, duration: .25 }); }, [b && b.state]); // eslint-disable-line
  if (!b || b.state === 'not-created') {
    return <div className="bpanel"><div className="vp" style={{ marginTop: 14 }}><div className="empty"><b>{a.name} has no browser yet</b><p>A private browser is created the first time this agent needs one. Other agents are not affected.</p><button className="btn primary" disabled={off} onClick={() => A.surfaceOpen(ss.id, aid, 'http://localhost:3000/login')}>Open browser</button></div></div><CapsBlock /></div>;
  }
  const ro = b.readonly, crashed = b.state === 'crashed', susp = b.state === 'suspended';
  const label = { starting: 'Starting', ready: 'Ready', navigating: 'Loading', crashed: 'Crashed', suspended: 'Suspended', closed: 'Closed' }[b.state];
  const nav = u => { let v = u.trim(); if (v && !/^[a-z]+:\/\//i.test(v)) v = 'http://' + v; if (v) A.surfaceNav(ss.id, aid, v); };
  let view;
  if (crashed) view = <div className="empty"><b>This browser crashed</b><p>Only {a.name}&rsquo;s browser is affected. The other agents keep theirs.</p><button className="btn primary" onClick={async () => { A.withSurf(ss.id, aid, x => { x.state = 'starting'; }); await wait(600); A.withSurf(ss.id, aid, x => { x.state = 'ready'; }); A.toast('Relaunched for ' + a.name + ' only'); }}>Relaunch</button></div>;
  else if (susp) view = <div className="empty"><b>Paused to save memory</b><p>Its state is kept.</p><button className="btn primary" onClick={() => A.withSurf(ss.id, aid, x => { x.state = 'ready'; })}>Resume</button></div>;
  else if (b.state === 'starting') view = <div className="empty"><b>Starting browser</b></div>;
  else if (b.err) view = <div className="empty"><b>Could not open the page</b><p>{b.err}</p></div>;
  else view = <PageView b={b} aid={aid} />;
  const log = [...b.activity, ...b.audit].sort((x, y) => x.i - y.i);
  const active = Object.values(A.db.sessions).reduce((n, s) => n + Object.values(s.browsers).filter(x => ['ready', 'navigating', 'starting'].includes(x.state)).length, 0);
  return (
    <div className="bpanel">
      <div className="btool">
        <button className="ibtn sm" aria-label="Back" disabled={!(b.hi > 0) || ro} onClick={() => { A.withSurf(ss.id, aid, x => { x.hi--; }); A.surfaceNav(ss.id, aid, b.history[b.hi - 1], false); }}><ArrowLeft size={14} /></button>
        <button className="ibtn sm" aria-label="Forward" disabled={!(b.hi < b.history.length - 1) || ro} onClick={() => { A.withSurf(ss.id, aid, x => { x.hi++; }); A.surfaceNav(ss.id, aid, b.history[b.hi + 1], false); }}><ArrowRight size={14} /></button>
        <button className="ibtn sm" aria-label="Reload" disabled={ro} onClick={() => A.surfaceNav(ss.id, aid, b.url, false)}><RotateCw size={14} /></button>
        <input aria-label="Address" id="bUrl" value={url} disabled={ro} spellCheck={false} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') nav(url); }} />
      </div>
      <div className="bmeta"><span className={'st ' + (crashed ? 'st-failed' : b.state === 'ready' ? 'st-completed' : 'st-waiting')}>{label}</span><span>Private to {a.name}</span>{ro && <span className="na">Read-only, the agent is stopped</span>}</div>
      <div className="vp" role="region" aria-label="Preview page (simulated)"><div className="load" ref={load} />{view}</div>
      <div className="bmeta"><span>Preview page. The desktop build shows a real WebView2 surface here.</span></div>
      <div className="btns" style={{ padding: '4px 16px' }}>
        <button className="btn sm" disabled={ro || b.state !== 'ready' || off} onClick={() => A.replayRun(ss.id, aid)}>Replay a sample agent run</button>
      </div>
      <details className="bsec"><summary>Browser details</summary>
        <div className="in">
          <table><tbody>
            <tr><td>Own profile</td><td><code>{b.owner.replace('/', '-')}</code></td></tr>
            <tr><td>Cookies</td><td>{b.store.cookie ? '1 (localhost)' : 'none'}</td></tr>
            <tr><td>Shared with other agents</td><td>Nothing</td></tr>
          </tbody></table>
          <div className="btns">
            <button className="btn sm danger" disabled={ro} onClick={async () => { const ok = await A.confirm({ title: 'Clear browser data for ' + a.name + '?', body: 'Cookies, storage and cache of this agent\u2019s browser are removed. Other agents are not affected.', ok: 'Clear data', danger: true }); if (!ok) return; A.withSurf(ss.id, aid, x => { x.store.cookie = null; x.audit.push({ i: ++A.AUD.current, t: clock() + '  data cleared for ' + x.owner }); }); A.surfaceNav(ss.id, aid, b.url, false); A.toast('Cleared ' + a.name + '\u2019s browser data'); }}>Clear this agent&rsquo;s data</button>
            <button className="btn sm" disabled={b.state !== 'ready'} onClick={() => A.withSurf(ss.id, aid, x => { x.state = 'suspended'; })}>Pause</button>
            <button className="btn sm" disabled title="Needs the child WebView spike from phase 4. Window mode ships first.">Detach to window</button>
          </div>
          <small className="mut" style={{ color: 'var(--text-3)' }}>{active} active browser(s). Idle ones pause automatically. Browsers are created on first use.</small>
          <h4 style={{ margin: '8px 0 0', font: '700 12px var(--font-sans)', color: 'var(--text-3)' }}>Permissions</h4>
          {Object.entries(b.perms).map(([k, v]) => <div className="cap" key={k}><span>{k}</span><select aria-label={k + ' permission'} value={v} disabled={ro} onChange={e => A.withSurf(ss.id, aid, x => { x.perms[k] = e.target.value; x.audit.push({ i: ++A.AUD.current, t: clock() + `  ${k} set to ${e.target.value}` }); })}>{['blocked', 'ask', 'allowed'].map(o => <option key={o}>{o}</option>)}</select></div>)}
          <h4 style={{ margin: '8px 0 0', font: '700 12px var(--font-sans)', color: 'var(--text-3)' }}>Agent activity</h4>
          <div className="blog" aria-label="Browser activity">{log.length ? log.map((l, i) => <div key={i} className={l.cls || ''}>{l.t}</div>) : <div>No agent actions yet.</div>}</div>
        </div>
      </details>
      <CapsBlock />
    </div>
  );
}
function CapsBlock() {
  const rows = [['Open a browser', 'Ready'], ['Go to a page and show its origin', 'Ready'], ['Read the page, click, type, scroll', 'Ready'], ['Screenshot of the real WebView', 'Needs the desktop build'], ['Several tabs per agent', 'Later (one tab for now)'], ['Downloads and uploads', 'Later (needs approval flow)'], ['Run page script', 'Off in v1'], ['Full OMP tab.run parity', 'Under research']];
  return <details className="bsec"><summary>What this browser can do</summary><div className="in">{rows.map(r => <div className="cap" key={r[0]}><span>{r[0]}</span><em>{r[1]}</em></div>)}</div></details>;
}

/* ================================================================ board */
function Board() {
  const A = useApp(); const ss = A.ss; const off = A.conn === 'disconnected'; const c = counts(ss); const ref = useRef(null); const prev = useRef(null); const sub = ss.todo.reduce((n, p) => n + p.tasks.length, 0);
  const lists = Object.fromEntries(COLS.map(([k]) => [k, []]));
  ss.todo.forEach((p, pi) => { if (A.phase !== 'all' && String(A.phase) !== String(pi)) return; p.tasks.forEach((t, ti) => lists[t.status].push({ t, pi, ti, p, key: taskKey(ss.id, pi, ti, t) })); });
  /* FLIP: when a card changes column, slide it from where it was */
  useLayoutEffect(() => {
    const next = new Map(); const root = ref.current; if (!root) return;
    root.querySelectorAll('[data-key]').forEach(n => { const r = n.getBoundingClientRect(); next.set(n.dataset.key, { x: r.left, y: r.top, s: n.dataset.s }); });
    if (A.gsap && !RM && prev.current) root.querySelectorAll('[data-key]').forEach(n => {
      const p = prev.current.get(n.dataset.key), cur = next.get(n.dataset.key);
      if (!p) A.gsap.from(n, { opacity: 0, duration: .3 });
      else if (p.s !== cur.s) A.gsap.fromTo(n, { x: p.x - cur.x, y: p.y - cur.y }, { x: 0, y: 0, duration: .45, ease: 'power2.inOut', clearProps: 'transform' });
    });
    prev.current = next;
  });
  const onCard = (t, pi, ti, act) => {
    const owner = ss.links[t.content];
    if (act === 'chat') { A.setView('conv'); if (owner && ss.agents[owner]) A.openInspector(owner, 'transcript'); else { A.closeInspector(); A.toast('No worker is linked. Showing the main session.'); } }
    if (act === 'cli') { if (owner && ss.agents[owner]) A.focusTrace(owner); else { A.focusTrace('main'); A.toast('Opened the main activity. It is not specific to this task.'); } }
    if (act === 'ask') { A.setMode('agent'); A.setView('conv'); A.setDraft(ss.id + ':main', `Please update the OMP tasks for "${t.content}": `); setTimeout(() => { const el = document.querySelector('.composer textarea'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 0); }
  };
  return (
    <section className="board" aria-label="Task board" ref={ref}>
      <header className="board-h">
        <div><h1>Tasks</h1><p>Read-only view of the OMP tasks for {ss.name}. {off ? 'Offline.' : 'Updated ' + new Date(ss.todoAt).toTimeString().slice(0, 8) + '.'} Changes go through the main agent.</p></div>
        <div className="ctrls">
          <label className="sr" htmlFor="phSel" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>Phase</label>
          <select id="phSel" value={String(A.phase)} onChange={e => A.setPhase(e.target.value)}><option value="all">All phases</option>{ss.todo.map((p, i) => <option key={i} value={String(i)}>{p.name}</option>)}</select>
          <label className="g">Group by phase <Switch on={A.group} onChange={A.setGroup} label="Group cards by phase" /></label>
          <button className="btn" onClick={() => A.setView('conv')}>Back to conversation</button>
        </div>
      </header>
      <div className="phases" role="group" aria-label="Filter by phase">
        <button aria-pressed={A.phase === 'all'} onClick={() => A.setPhase('all')}>All phases</button>
        {ss.todo.map((p, i) => <button key={i} aria-pressed={String(A.phase) === String(i)} onClick={() => A.setPhase(String(i))}>{p.name} &middot; {p.tasks.filter(t => t.status === 'completed').length}/{p.tasks.length}</button>)}
      </div>
      {off && <div className="offline" role="status"><b>Offline.</b> This is the saved copy from {new Date(ss.todoAt).toTimeString().slice(0, 8)}. It may not be the latest. Actions are off.</div>}
      {!sub && <div className="offline" style={{ borderColor: 'var(--glass-line)' }}>No tasks yet. When the main agent plans the work, its tasks show up here.</div>}
      <div className="col-tabs" role="tablist" aria-label="Task status">{COLS.map(([k, l]) => <button key={k} role="tab" aria-selected={A.colTab === k} onClick={() => A.setColTab(k)}>{l} {c[k]}</button>)}</div>
      <div className="cols">
        {COLS.map(([k, label]) => (
          <section key={k} className={'col' + (A.colTab === k ? ' show' : '')} data-s={k} aria-label={label}>
            <header><span>{label}</span><span>{c[k]}</span></header>
            <div className="col-list">
              {!lists[k].length && <div className="none">Nothing here</div>}
              {lists[k].map((it, i) => {
                const { t, pi, ti, p, key } = it; const owner = ss.links[t.content]; const oa = owner && ss.agents[owner]; const sel = A.selTask === key;
                return (
                  <React.Fragment key={key}>
                    {A.group && (i === 0 || lists[k][i - 1].pi !== pi) && <div className="gh">{p.name}</div>}
                    <article className={'tcard' + (off ? ' stale' : '')} tabIndex={0} data-key={key} data-s={k} aria-current={sel} aria-label={`${t.content}. ${COLNAME[t.status]}. ${p.name}.`}
                      onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); A.setSelTask(sel ? null : key); } }}>
                      {!A.group && <div className="crumbs">{p.name}</div>}
                      <h4 onClick={() => A.setSelTask(sel ? null : key)}>{t.content}</h4>
                      {t.status === 'blocked' && t.blocker && <p className="blk">Blocker: {t.blocker}</p>}
                      {oa && <div className="own">Worker {oa.name}<i title="canoPi keeps this link. The OMP tasks have no owner field.">local link</i></div>}
                      <div className="tacts">
                        <button disabled={off} onClick={() => onCard(t, pi, ti, 'chat')}>{oa ? 'Chat' : 'Open main session'}</button>
                        <button onClick={() => onCard(t, pi, ti, 'cli')}>Activity</button>
                        <button disabled={off} onClick={() => onCard(t, pi, ti, 'ask')}>Ask main agent</button>
                      </div>
                      {sel && <div className="dt">UI hint <code>{key}</code> is not an OMP id. {t.status === 'abandoned' ? 'Cancelled means OMP marked it abandoned.' : ''}</div>}
                    </article>
                  </React.Fragment>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

/* ================================================================ dock */
function Dock() {
  const A = useApp(); const d = A.dock; const tabs = A.dockTabs; const ss = A.ss;
  const sel0 = tabs.find(t => t.id === d.sel[0]) ? d.sel[0] : 'trace:main';
  const sel1 = tabs.find(t => t.id === d.sel[1]) ? d.sel[1] : tabs[tabs.length - 1].id;
  const setSel = (slot, id) => A.setDock(x => { const s = [...x.sel]; s[slot] = id; return { ...x, sel: s }; });
  const onDown = e => { e.currentTarget.setPointerCapture(e.pointerId); A.setDragging(true); A.setDock(x => ({ ...x, open: true, expanded: false })); };
  const onMove = e => { if (!A.dragging || !A.workRef.current) return; const b = A.workRef.current.getBoundingClientRect(); A.setDock(x => ({ ...x, h: Math.round(clamp(b.bottom - e.clientY, 80, A.dockMax)) })); };
  const onKey = e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); A.setDock(x => ({ ...x, open: true, expanded: false, h: clamp(x.h + (e.key === 'ArrowUp' ? 24 : -24), 80, A.dockMax) })); } };
  return (
    <section className={'dock glass' + (A.dragging ? ' dragging' : '')} style={{ height: A.dockHeight }} aria-label="Terminal dock">
      <div className="resizer" role="separator" aria-orientation="horizontal" aria-label="Resize terminal dock" tabIndex={0} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => A.setDragging(false)} onKeyDown={onKey} />
      <div className="dock-bar">
        <div className="dtabs" role="tablist" aria-label="Terminals and activity">
          {tabs.map(t => (
            <div key={t.id} className="dtab" role="tab" tabIndex={0} aria-selected={t.id === sel0} onClick={() => setSel(0, t.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(0, t.id); } }}>
              {t.kind === 'shell' ? <Terminal size={13} /> : <Clock size={13} />}<span>{t.label}</span>
              {t.kind === 'shell' && <button className="x" aria-label={'Close ' + t.label} onClick={e => { e.stopPropagation(); A.closeShell(t.sh.id); }}><X size={11} /></button>}
            </div>
          ))}
        </div>
        <button className="btn sm" onClick={A.newShell}><Plus size={12} />Shell</button>
        <span className="grow" />
        <button className="ibtn sm" aria-label="Split dock" aria-pressed={d.split} onClick={() => A.setDock(x => ({ ...x, split: !x.split }))}><Columns2 size={14} /></button>
        <button className="ibtn sm" aria-label={d.expanded ? 'Shrink dock' : 'Expand dock'} aria-pressed={d.expanded} onClick={() => A.setDock(x => ({ ...x, open: true, expanded: !x.expanded }))}>{d.expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
        <button className="ibtn sm" aria-label={d.open ? 'Collapse dock' : 'Open dock'} onClick={() => A.setDock(x => ({ ...x, open: !x.open }))}>{d.open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}</button>
      </div>
      {d.open && (
        <div className={'dock-body' + (d.split ? ' split' : '')}>
          <DockPane tab={tabs.find(t => t.id === sel0)} tabs={tabs} slot={0} split={d.split} onSel={setSel} />
          {d.split && <DockPane tab={tabs.find(t => t.id === sel1)} tabs={tabs} slot={1} split onSel={setSel} />}
        </div>
      )}
      <span className="sr" style={{ display: 'none' }}>{ss && ss.id}</span>
    </section>
  );
}
function DockPane({ tab, tabs, slot, split, onSel }) {
  const A = useApp(); const ss = A.ss;
  const picker = split ? <select aria-label={`Pane ${slot + 1} shows`} value={tab.id} onChange={e => onSel(slot, e.target.value)}>{tabs.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select> : null;
  if (tab.kind === 'trace') return <TracePane tab={tab} picker={picker} list={ss.traces[tab.owner] || []} />;
  return <ShellPane sh={ss.shells.find(s => s.id === tab.sh.id) || tab.sh} picker={picker} sid={ss.id} />;
}
function TracePane({ tab, picker, list }) {
  const ref = useRef(null); useStick(ref, list);
  return (
    <div className="tpane">
      <div className="tp-h">{picker}<span>What this agent did. It is a log, not a terminal.</span></div>
      <div className="tp-out" ref={ref} role="log" aria-label={tab.label} tabIndex={0}>
        {!list.length && <div className="dim">Nothing yet.</div>}
        {list.map((en, i) => { const meta = TOOL_META[en.tool] || [FileText, en.tool, en.tool]; return <div key={i}><span className="t">{en.t}</span><b>{en.status === 'running' ? meta[1] : meta[2]}</b> {prettyArg(en.arg)} <span className={en.status === 'ok' ? 'ok' : en.status === 'error' ? 'bad' : 'dim'}>{en.note || en.status}</span></div>; })}
      </div>
    </div>
  );
}
function ShellPane({ sh, picker, sid }) {
  const A = useApp(); const out = useRef(null); const [size, setSize] = useState(''); useStick(out, sh.lines);
  useEffect(() => { const el = out.current; if (!el || typeof ResizeObserver === 'undefined') return undefined; const upd = () => setSize(`${Math.max(20, Math.floor(el.clientWidth / 7.8))}x${Math.max(2, Math.floor(el.clientHeight / 19))}`); upd(); const ro = new ResizeObserver(upd); ro.observe(el); return () => ro.disconnect(); }, []);
  const key = 'shell-in:' + sid + ':' + sh.id; const value = A.drafts[key] || ''; const hi = useRef(null);
  const info = sh.exited != null ? `Exited with code ${sh.exited}` : sh.proc ? `Running ${sh.proc}. Ctrl+C stops it` : 'Ready';
  return (
    <div className="tpane">
      <div className="tp-h">{picker}<span>{sh.name} (PowerShell, preview simulation)</span><span style={{ marginLeft: 'auto' }}>{info}</span><span>{size}</span>{sh.exited != null && <button className="btn sm" onClick={A.newShell}>New shell</button>}</div>
      <div className="tp-out mono" ref={out} role="log" aria-label={sh.name + ' output'} tabIndex={0}>
        {sh.trunc > 0 && <div className="dim">{sh.trunc} earlier lines were dropped to keep output bounded.</div>}
        {sh.lines.map((l, i) => <div key={i} className={l.c}>{l.t}</div>)}
      </div>
      <div className="tp-in"><span>PS {sh.cwd}&gt;</span>
        <input className="shell-in" aria-label={'Type into ' + sh.name} spellCheck={false} disabled={sh.exited != null} value={value} onChange={e => A.setDraft(key, e.target.value)}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter') { e.preventDefault(); hi.current = null; A.setDraft(key, ''); A.shellExec(sid, sh.id, value); }
            if (e.key === 'c' && e.ctrlKey) { e.preventDefault(); A.shellInterrupt(sid, sh.id); }
            if (e.key === 'ArrowUp' && sh.hist.length) { e.preventDefault(); hi.current = hi.current == null ? sh.hist.length - 1 : Math.max(0, hi.current - 1); A.setDraft(key, sh.hist[hi.current]); }
          }} />
      </div>
    </div>
  );
}

/* ================================================================ layers */
const SECTIONS = [['agents', 'Agents'], ['connections', 'Connections'], ['models', 'Models'], ['tools', 'Tools and MCP'], ['commands', 'Commands'], ['rules', 'Rules and memory'], ['context', 'Context and approvals'], ['runtime', 'Runtime and profile'], ['display', 'Display']];

function ConfirmLayer() {
  const A = useApp(); const c = A.confirmS; const ref = useRef(null); useEnter(ref, { y: -8, opacity: 0 });
  const done = v => { A.setConfirmS(null); c.res(v); };
  return (
    <Layer onClose={() => done(false)} initial="#cfNo">
      <div className="scrim" onClick={() => done(false)} />
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="cfT" aria-describedby="cfB" ref={ref}>
        <h2 id="cfT">{c.title}</h2><p id="cfB">{c.body}</p>
        <div className="m-acts"><button className="btn" id="cfNo" onClick={() => done(false)}>Cancel</button><button className={'btn ' + (c.danger ? 'danger' : 'primary')} onClick={() => done(true)}>{c.ok || 'Confirm'}</button></div>
      </div>
    </Layer>
  );
}

function PaletteLayer() {
  const A = useApp(); const [q, setQ] = useState(''); const [idx, setIdx] = useState(0); const ref = useRef(null); useEnter(ref, { y: -8, opacity: 0 });
  const close = () => A.setPalette(false); const ss = A.ss;
  const all = [{ g: 'Go to', l: 'Home', h: 'New session', run: A.goHome }, { g: 'Go to', l: 'Open project folder', h: '', run: A.openFolder }];
  A.db.projects.forEach(p => Object.values(A.db.sessions).filter(s => s.project === p.id).forEach(s => all.push({ g: 'Sessions', l: s.name, h: p.name, run: () => A.openSession(s.id) })));
  if (ss) {
    ss.order.forEach(id => { const a = ss.agents[id]; all.push({ g: 'Agents', l: a.name, h: STATE_META[A.eff(a)][0], run: () => (id === 'main' ? (A.closeInspector(), A.setView('conv')) : A.openInspector(id, 'transcript')) }); all.push({ g: 'Agents', l: a.name + ', browser', h: 'Browser', run: () => A.openInspector(id, 'browser') }); });
    all.push({ g: 'Views', l: 'Tasks board', h: 'Alt+T', run: () => A.setView('board') }, { g: 'Views', l: 'Conversation', h: '', run: () => A.setView('conv') }, { g: 'Views', l: 'Toggle terminal dock', h: 'Alt+D', run: () => A.setDock(d => ({ ...d, open: !d.open })) });
    COMMANDS.forEach(c => all.push({ g: 'Commands', l: c.n, h: c.ok ? c.d : 'Unavailable', run: () => { if (!c.ok) { A.toast(c.n + ' is unavailable: ' + c.why); return; } A.setMode('agent'); A.setView('conv'); A.setDraft(ss.id + ':main', c.n + ' '); } }));
  }
  SECTIONS.forEach(([k, l]) => all.push({ g: 'Settings', l, h: '', run: () => A.setDrawer(k) }));
  all.push({ g: 'Settings', l: 'Switch theme', h: A.theme === 'dark' ? 'Cloud Light' : 'Midnight Sky', run: A.toggleTheme });
  const s = q.trim().toLowerCase(); const items = all.filter(i => !s || (i.l + ' ' + i.g + ' ' + i.h).toLowerCase().includes(s)).slice(0, 40);
  const run = i => { const it = items[i]; if (!it) return; close(); setTimeout(it.run, 0); };
  let g = null;
  return (
    <Layer onClose={close} initial="input">
      <div className="scrim" onClick={close} />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search" ref={ref}>
        <input role="combobox" aria-expanded="true" aria-controls="palList" aria-autocomplete="list" aria-activedescendant={items.length ? 'pal' + idx : undefined} placeholder="Search sessions, agents, views and commands" autoComplete="off" value={q}
          onChange={e => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(items.length - 1, i + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); } if (e.key === 'Enter') { e.preventDefault(); run(idx); } }} />
        <ul id="palList" role="listbox">
          {!items.length && <li className="h" role="presentation">Nothing matches</li>}
          {items.map((it, i) => { const head = it.g !== g ? (g = it.g, <li key={'h' + i} className="h" role="presentation">{it.g}</li>) : null; return [head, <li key={i} id={'pal' + i} role="option" aria-selected={i === idx} onClick={() => run(i)}><span>{it.l}</span><small>{it.h}</small></li>]; })}
        </ul>
      </div>
    </Layer>
  );
}

function ConnGraph() {
  const A = useApp(); const ss = A.ss; const ids = ss.order; const rowH = 62; const H = Math.max(190, ids.length * rowH + 60); const ay = i => 62 + i * rowH;
  const go = (kind, id) => { A.setDrawer(null); setTimeout(() => (kind === 'trace' ? A.focusTrace(id) : id === 'main' && kind === 'agent' ? (A.closeInspector(), A.setView('conv')) : A.openInspector(id, kind === 'browser' ? 'browser' : 'transcript')), 0); };
  const Node = ({ x, y, w, label, kind, id }) => <g className="n" tabIndex={0} role="button" aria-label={label} onClick={() => go(kind, id)} onKeyDown={e => { if (e.key === 'Enter') go(kind, id); }}><rect x={x} y={y - 15} width={w} height="30" rx="9" /><text x={x + 11} y={y + 4}>{label.length > 20 ? label.slice(0, 19) + '\u2026' : label}</text></g>;
  return (
    <svg className="graph" viewBox={`0 0 560 ${H}`} role="group" aria-label="Agent connections">
      <text className="col-h" x="20" y="24">Session</text><text className="col-h" x="190" y="24">Agents</text><text className="col-h" x="400" y="24">Owned by that agent</text>
      {ids.map((id, i) => { const y = ay(i), surf = ss.browsers[id]; return (
        <g key={id}>
          {id !== 'main' && <path className="e" d={`M110 ${ay(0)} C150 ${ay(0)} 150 ${y} 190 ${y}`} />}
          <path className="e own" d={`M340 ${y} L400 ${y - 15}`} />{surf && <path className="e own" d={`M340 ${y} L400 ${y + 17}`} />}
        </g>); })}
      {ids.map((id, i) => { const y = ay(i), a = ss.agents[id]; return (
        <g key={'n' + id}>
          <Node x={190} y={y} w={150} label={a.name} kind="agent" id={id} />
          <Node x={400} y={y - 15} w={130} label="Activity" kind="trace" id={id} />
          {ss.browsers[id] && <Node x={400} y={y + 17} w={130} label="Browser" kind="browser" id={id} />}
        </g>); })}
      <g><rect x="20" y={ay(0) - 15} width="90" height="30" rx="9" fill="var(--accent-soft)" stroke="var(--accent-2)" /><text x="31" y={ay(0) + 4}>{ss.name.length > 11 ? ss.name.slice(0, 10) + '\u2026' : ss.name}</text></g>
    </svg>
  );
}

function Row2({ children, sub, right }) { return <div className="row2"><div>{children}{sub && <small>{sub}</small>}</div>{right}</div>; }
function PvSel({ label, v, set, opts }) { return <label>{label}<select value={v} onChange={e => set(e.target.value)}>{opts.map(([val, l]) => <option key={val} value={val}>{l}</option>)}</select></label>; }
function Need() { return <p className="lede">Open a session first. This section is about what the agents in a session are doing.</p>; }
function DrawerBody({ sec }) {
  const A = useApp(); const S = A.settings; const ss = A.ss;
  const close = () => A.setDrawer(null);
  const insert = text => { close(); setTimeout(() => { if (ss) { A.setMode('agent'); A.setView('conv'); A.setDraft(ss.id + ':main', text); } else A.setDraft('home', text); }, 0); };
  const sel = (val, opts, on, label) => <select aria-label={label} value={val} onChange={e => on(e.target.value)}>{opts.map(o => <option key={o}>{o}</option>)}</select>;
  switch (sec) {
    case 'agents': return !ss ? <Need /> : (<><h3>Agents</h3><p className="lede">One session, one main agent, and the workers it started. Only the main agent starts workers.</p>
      {ss.order.map(id => { const a = ss.agents[id], b = ss.browsers[id]; return <Row2 key={id} sub={`${a.activity}. Browser: ${b ? b.state : 'not created'}.`} right={<button className="btn sm" onClick={() => { close(); setTimeout(() => (id === 'main' ? (A.closeInspector(), A.setView('conv')) : A.openInspector(id, 'transcript')), 0); }}>Open</button>}><b>{a.name}</b> <StateTag s={A.eff(a)} />{a.flag && <> <span className="flag">Unsupported depth</span></>}</Row2>; })}</>);
    case 'connections': return !ss ? <Need /> : (<><h3>Connections</h3><p className="lede">Only links canoPi really knows about: the main agent, its workers, and the activity log and browser each one owns.</p><ConnGraph /><p className="lede" style={{ marginTop: 8 }}>Your own shells belong to no agent. An activity log is not a terminal.</p></>);
    case 'models': return (<><h3>Models and roles</h3><p className="lede">A live build lists the models and providers your OMP runtime reports, including 9Router. These rows are placeholders.</p>
      <h4>Roles</h4>{ROLES.map(r => <Row2 key={r} right={sel(S.roles[r], MODELOPTS, v => A.setSet({ roles: { ...S.roles, [r]: v } }), 'Model for ' + r)}>{r}</Row2>)}
      <h4>Thinking</h4><Row2 right={sel(S.think, THINK, v => A.setSet({ think: v }), 'Thinking level')}>Default level</Row2>
      <h4>Providers</h4><Row2 sub="Credentials stay in OMP and never reach this window." right={<span className="st st-completed"><CircleCheck size={13} />Connected</span>}><b>9Router</b></Row2>
      <Row2 sub="OAuth is handled by OMP." right={<span className="st st-idle"><Circle size={13} />Not signed in</span>}><b>Anthropic sign-in</b></Row2>
      <Row2 sub="The next model in the chain takes the turn." right={<Switch on={S.fallback} onChange={v => A.setSet({ fallback: v })} label="Fall back when rate limited" />}>Fall back when rate limited</Row2></>);
    case 'tools': return (<><h3>Tools and MCP</h3><p className="lede">Switch off what the agent should not touch.</p>
      {Object.keys(S.tools).map(k => <Row2 key={k} sub={k === 'bash' ? 'Output appears in the chat, not in your shells' : k === 'task' ? 'Main agent only' : ''} right={<Switch on={S.tools[k]} onChange={v => A.setSet({ tools: { ...S.tools, [k]: v } })} label={k} />}><code>{k}</code></Row2>)}
      <Row2 sub="One private browser per agent. Page script and downloads are off in v1." right={<span className="na">Limited</span>}><code>browser</code></Row2>
      <Row2 sub="Desktop control is outside canoPi v1." right={<span className="na">Unavailable</span>}><code>computer</code></Row2>
      <h4>MCP servers</h4>{Object.keys(S.mcp).map(k => <Row2 key={k} sub="Found in your OMP profile (preview rows)" right={<Switch on={S.mcp[k]} onChange={v => A.setSet({ mcp: { ...S.mcp, [k]: v } })} label={k} />}>{k}</Row2>)}</>);
    case 'commands': return (<><h3>Commands</h3><p className="lede">Taken from the runtime catalog. Unsupported ones say why.</p>
      {COMMANDS.map(c => <Row2 key={c.n} sub={c.ok ? c.d : c.why} right={c.ok ? <button className="btn sm" onClick={() => insert(c.n + ' ')}>Use</button> : <span className="na">Unavailable</span>}><code>{c.n}</code></Row2>)}
      <h4>Prompt controls</h4>{[['ultrathink', 1], ['orchestrate', 1], ['workflowz', 1], ['advisor', 1], ['vibe', 0]].map(([n, ok]) => <Row2 key={n} sub={ok ? '' : 'Not supported by the pinned runtime in this preview'} right={ok ? <button className="btn sm" onClick={() => insert(n + ' ')}>Use</button> : <span className="na">Unavailable</span>}><code>{n}</code></Row2>)}</>);
    case 'rules': return (<><h3>Rules, skills and memory</h3><p className="lede">Stored by OMP. canoPi shows where they live and does not keep copies.</p>
      <h4>Stream rules</h4>{Object.keys(S.rules).map(k => <Row2 key={k} right={<Switch on={S.rules[k]} onChange={v => A.setSet({ rules: { ...S.rules, [k]: v } })} label={k} />}><code>{k}</code></Row2>)}
      <h4>Skills</h4>{Object.keys(S.skills).map(k => <Row2 key={k} right={<Switch on={S.skills[k]} onChange={v => A.setSet({ skills: { ...S.skills, [k]: v } })} label={k} />}>{k}</Row2>)}
      <h4>Memory</h4><Row2 right={sel(S.mem, ['Local', 'Hindsight', 'Mnemopi'], v => A.setSet({ mem: v }), 'Memory backend')}>Backend</Row2>
      <Row2 sub="The location is reported by the runtime. Not available in preview." right={<Switch on={S.projmem} onChange={v => A.setSet({ projmem: v })} label="Keep memory per project" />}>Keep memory per project</Row2></>);
    case 'context': { if (!ss) return <Need />; const pend = ss.threads.main.filter(m => m.role === 'approval' && m.status === 'pending');
      return (<><h3>Context and approvals</h3><p className="lede">Numbers appear only when the runtime reports them.</p>
        <Row2 sub="Preview value" right={<b>38%</b>}>Context used</Row2><Row2 sub="Hidden. This runtime does not report them." right={<span className="na">Unavailable</span>}>Tokens and cost</Row2>
        <h4>Approvals</h4><Row2 right={sel(S.approval, ['Ask for destructive tools', 'Ask for every tool', 'Allow reads automatically'], v => A.setSet({ approval: v }), 'Approval policy')}>Policy</Row2>
        <h4>Waiting for you</h4>{pend.length ? pend.map(m => <Row2 key={m.id} right={<button className="btn sm" onClick={() => { close(); setTimeout(() => { A.setView('conv'); const n = document.querySelector('.card.pending'); if (n && n.scrollIntoView) n.scrollIntoView({ block: 'center' }); }, 0); }}>Review</button>}><code>{m.tool}</code> {m.arg}</Row2>) : <p className="lede">Nothing is waiting.</p>}</>); }
    case 'runtime': return (<><h3>Runtime and profile</h3><p className="lede">canoPi never changes your OMP install, credentials or 9Router settings on its own.</p>
      <Row2 sub="Read-only. Detected on launch in the desktop build." right={<span className="na">Not run in preview</span>}>Installed OMP CLI</Row2>
      <Row2 sub="An isolated canoPi profile is used for the first test." right={<b>Isolated</b>}>Profile in use</Row2>
      <Row2 sub="Opt-in and reversible. Turns on only after the compatibility check passes." right={<Switch on={false} disabled onChange={() => {}} label="Use existing OMP profile" />}>Use my existing OMP profile</Row2>
      <h4>Compatibility check</h4>{['Detect the CLI path and version (read-only)', 'Match the runtime build and protocol', 'Find the 9Router config without reading secrets', 'Offer an isolated profile for a smoke test', 'Run one real model call and one read-only tool', 'Offer the existing profile, reversibly', 'Save a compatibility report'].map((t, i) => <div className="cap" key={t}><span>{i + 1}. {t}</span><em>Not run</em></div>)}
      <h4>Event safety</h4><Row2 sub="Events for sessions or workers that no longer exist." right={<b>{A.stale}</b>}>Late events ignored</Row2></>);
    default: return (<><h3>Display</h3><Row2 sub="Midnight Sky is the default." right={<div className="seg" role="radiogroup" aria-label="Theme"><button role="radio" aria-checked={A.theme === 'dark'} onClick={() => A.theme !== 'dark' && A.toggleTheme()}>Midnight Sky</button><button role="radio" aria-checked={A.theme === 'light'} onClick={() => A.theme !== 'light' && A.toggleTheme()}>Cloud Light</button></div>}>Theme</Row2>
      <h4>Shortcuts</h4>{[['Ctrl K', 'Search'], ['Alt T', 'Tasks board'], ['Alt B', 'Browser of the open agent'], ['Alt D', 'Collapse or open the dock'], ['Esc', 'Close the top panel']].map(([k, d]) => <Row2 key={k} right={<kbd>{k}</kbd>}>{d}</Row2>)}
      <p className="lede" style={{ marginTop: 12 }}>Ctrl K is left to the shell while you type in a terminal. Use the Search button there.</p></>);
  }
}
function DrawerLayer() {
  const A = useApp(); const sec = A.drawer; const ref = useRef(null); useEnter(ref, { x: 40, opacity: 0 }); const close = () => A.setDrawer(null);
  return (
    <Layer onClose={close}>
      <div className="scrim" onClick={close} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drTitle" ref={ref}>
        <header><h2 id="drTitle">Settings</h2><button className="ibtn" onClick={close} aria-label="Close settings"><X size={16} /></button></header>
        <div className="drawer-grid">
          <nav className="dnav" aria-label="Settings sections">{SECTIONS.map(([k, l]) => <button key={k} aria-current={k === sec} onClick={() => A.setDrawer(k)}>{l}</button>)}</nav>
          <div className="dbody" tabIndex={-1}><DrawerBody sec={sec} /></div>
        </div>
      </aside>
    </Layer>
  );
}

function PreviewLayer() {
  const A = useApp(); const ss = A.ss; const close = () => A.setPv(false); const ref = useRef(null); useEnter(ref, { y: -8, opacity: 0 });
  const tasks = []; if (ss) ss.todo.forEach((p, pi) => p.tasks.forEach((t, ti) => tasks.push([pi + ':' + ti, t.content])));
  const workers = ss ? ss.order.filter(i => i !== 'main') : []; const owners = ss ? ss.order : [];
  const [task, setTask] = useState(tasks[0] ? tasks[0][0] : ''); const [stat, setStat] = useState('blocked'); const [w, setW] = useState(workers[0] || ''); const [o, setO] = useState(owners[0] || '');
  const later = fn => { close(); setTimeout(fn, 0); };
  const edit = remove => {
    if (A.conn === 'disconnected') { A.toast('Needs the runtime. Reconnect first.'); return; }
    const [pi, ti] = task.split(':').map(Number); const todo = JSON.parse(JSON.stringify(ss.todo)); const t = todo[pi].tasks[ti]; const name = t.content;
    if (remove) { todo[pi].tasks.splice(ti, 1); later(() => A.setTodos(ss.id, todo, 'OMP removed "' + name + '" from the tasks')); }
    else { t.status = stat; if (stat === 'blocked' && !t.blocker && name.includes('Verify')) t.blocker = 'Needs a staging build to run against'; if (stat !== 'blocked') delete t.blocker; later(() => A.setTodos(ss.id, todo, 'OMP set the tasks. "' + name + '" is now ' + COLNAME[stat])); }
  };
  const sid = ss ? ss.id : 'none';
  const wfail = () => A.gate(sid, w, () => { A.setAgent(sid, w, { state: 'failed', activity: 'Exited with an error' }); A.pushMsg(sid, w, N('Worker failed. Its chat and browser are kept.')); A.addTrace(sid, w, tr('bash', 'run', 'error', 'code 1')); A.toast(ss.agents[w].name + ' failed. Its tasks did not change.'); });
  const wdone = () => A.gate(sid, w, () => { A.setAgent(sid, w, { state: 'completed', activity: 'Finished' }); A.toast(ss.agents[w].name + ' completed. Its tasks did not change.'); });
  const nested = () => A.gate(sid, w, () => { const id = 'n' + ss.order.length; A.mutate(d => { const s = d.sessions[sid]; s.agents[id] = mkAgent(id, 'Nested helper', 'running', 'Started by ' + s.agents[w].name, { parent: w, flag: 'depth' }); s.order.push(id); s.threads[id] = [N('Started by ' + s.agents[w].name + ' through an OMP tool. canoPi did not start it.')]; s.traces[id] = []; }); A.toast('Unexpected nested agent. Shown with its true origin.'); });
  const crash = () => A.gate(sid, o, () => { const b = ss.browsers[o]; if (!b || b.state === 'not-created') { A.toast('That agent has no browser to crash'); return; } A.withSurf(sid, o, x => { x.state = 'crashed'; }); A.toast('Only ' + ss.agents[o].name + '\u2019s browser crashed'); });
  const cross = () => A.gate(sid, w, () => { const caller = ss.browsers[w] ? w : o; A.withSurf(sid, caller, x => { x.audit.push({ i: ++A.AUD.current, t: clock() + `  DENIED click on a handle owned by ${sid}/${o} (caller ${sid}/${w})`, cls: 'bad' }); }); A.toast(ss.agents[w].name + ' tried to use ' + ss.agents[o].name + '\u2019s browser handle. Denied by the owner check.'); });
  return (
    <Layer onClose={close}>
      <div className="scrim" onClick={close} />
      <div className="modal wide" role="dialog" aria-modal="true" aria-labelledby="pvT" ref={ref}>
        <h2 id="pvT">Preview controls</h2>
        <p>These buttons fake events that OMP would normally send, so you can see how canoPi reacts. Nothing here is real.</p>
        {ss && <div className="pv-sec"><h3>OMP tasks</h3><div className="pv-grid"><PvSel label="Task" v={task} set={setTask} opts={tasks} /><PvSel label="New status" v={stat} set={setStat} opts={COLS} /></div><div className="btns"><button className="btn sm primary" onClick={() => edit(false)}>Replace tasks with this change</button><button className="btn sm" onClick={() => edit(true)}>Remove the task</button></div></div>}
        <div className="pv-sec"><h3>Runtime</h3><div className="btns"><button className="btn sm" onClick={() => later(A.disconnect)}>Disconnect the runtime</button><button className="btn sm" onClick={() => later(A.reconnect)}>Reconnect</button><button className="btn sm" onClick={() => { A.gate(ss ? ss.id : 'none', 'zz9', () => {}); }}>Send a late event for an unknown worker</button></div></div>
        {ss && workers.length > 0 && <div className="pv-sec"><h3>Workers and browsers</h3><div className="pv-grid"><PvSel label="Worker" v={w} set={setW} opts={workers.map(i => [i, ss.agents[i].name])} /><PvSel label="Browser owner" v={o} set={setO} opts={owners.map(i => [i, ss.agents[i].name])} /></div>
          <div className="btns"><button className="btn sm" onClick={wfail}>Worker fails</button><button className="btn sm" onClick={wdone}>Worker completes</button><button className="btn sm" onClick={nested}>Worker starts a nested agent</button><button className="btn sm" onClick={crash}>Crash that browser</button><button className="btn sm" onClick={cross}>Try a cross-agent browser call</button></div></div>}
        {!ss && <p>Open a session to see the task and worker controls.</p>}
        <div className="m-acts"><button className="btn" onClick={close}>Close</button></div>
      </div>
    </Layer>
  );
}

