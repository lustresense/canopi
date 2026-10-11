/*
 * canoPi Desktop — approved user JSX preserved in docs/ORIGINAL_CANOPI_WORKSPACE.jsx.
 * Layout and glass CSS remain from that source; preview seed/simulations are removed.
 * Native OMP RPC UI is bridged via Tauri/Rust. Browser/ConPTY are disabled until real adapters exist.
 */
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, createContext, useContext } from 'react';
import { gsap } from 'gsap';
import { pickProject, runtimeInfo, startRuntime, sendRpc, answerUi, watchFrames, textFromMessage, normalizeTodos, normalizeWorkers } from '../runtime/omp.js';
import { projectAssistantFrame } from '../runtime/live-projection.mjs';
import { parseWorkspace, serializeWorkspace, WORKSPACE_KEY, WORKSPACE_KEY_V1, UI_DEFAULTS } from '../runtime/workspace.mjs';
import { subagentFrameId, subagentFrameEvent, workerStateFromStatus, toolCallIdOf } from '../runtime/frame-model.mjs';
import { createTerminal, writeTerminal, resizeTerminal, closeTerminal, watchTerminal, listTerminals, openAgentBrowser, closeAgentBrowser, navigateAgentBrowser, reloadAgentBrowser, agentBrowserState, screenshotAgentBrowser, previewOmpModels, importOmpModels, getProviderStatus, saveProviderKey, dataRootStatus, recoverDataRoot } from '../runtime/native.js';
import {
  Folder, FolderOpen, SquarePen, Search, Kanban, Globe, Terminal, Settings, Sun, Moon, Menu, X, Plus,
  ChevronRight, ChevronDown, ChevronUp, Columns2, Maximize2, Minimize2, ArrowLeft, ArrowRight, ArrowUp,
  RotateCw, CirclePlay, Clock, Eye, CircleCheck, CircleX, Square, Circle, Unplug, FileText, Pencil, ListChecks, Users, FolderPlus
} from 'lucide-react';

const CSS = `/* Fonts bundled locally via @fontsource; no CDN dependency. */
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
.cp .msg.user{align-self:flex-start;background:rgba(238,247,249,.88);border:1px solid rgba(140,205,213,.42);padding:9px 15px;border-radius:16px 16px 16px 5px;box-shadow:0 8px 24px rgba(4,10,13,.26),inset 0 1px 0 rgba(255,255,255,.85);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
.cp .msg.user .body{font:400 19px/1.45 var(--font-serif);color:#10242B}
.cp[data-theme="light"] .msg.user{background:rgba(255,255,255,.94);border:1px solid rgba(71,157,170,.28);box-shadow:0 6px 18px rgba(25,51,61,.08),inset 0 1px 0 #ffffff}
.cp[data-theme="light"] .msg.user .body{color:#142830}
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

/* Local GSAP: bundled into the application, not loaded from CDN. */
function useGsap(){ return gsap; }

const STATE_META = {
  idle: ['Idle', Circle], running: ['Running', CirclePlay], waiting: ['Waiting', Clock], reviewing: ['Reviewing', Eye],
  completed: ['Done', CircleCheck], failed: ['Failed', CircleX], stopped: ['Stopped', Square], disconnected: ['Offline', Unplug]
};
const COLS = [['pending', 'To do'], ['in_progress', 'In progress'], ['blocked', 'Blocked'], ['completed', 'Done'], ['abandoned', 'Cancelled']];
const COLNAME = Object.fromEntries(COLS);

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
const N = text => ({ id: mid(), role: 'notice', text });
const mkAgent = (id, name, state, activity, extra = {}) => ({ id, name, state, activity, unread: false, parent: id === 'main' ? null : 'main', flag: null, script: [], ...extra });
const tr = (tool, arg, status, note) => ({ t: clock(), tool, arg, status, note: note || '' });
const makeSession = (id, name, project) => ({
  id, name, project, unread: 0, revision: 1, todoAt: Date.now(), seen: true,
  agents: { main: mkAgent('main', 'Main agent', 'idle', 'Waiting for your next message') }, order: ['main'],
  threads: { main: [] }, traces: { main: [] }, todo: [], links: {}, browsers: {}, shells: [],
  /* Per-session runtime catalogs; never persisted, rehydrated from the engine. */
  models: [], commands: [], thinkingLevels: null, thinkingLevel: null, context: null, liveModel: null
});

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
function loadWorkspace() {
  const empty = { projects: [], sessions: {}, ui: { ...UI_DEFAULTS, collapsed: {}, dock: { ...UI_DEFAULTS.dock } } };
  try {
    if (typeof localStorage === 'undefined') return empty;
    const stored = localStorage.getItem(WORKSPACE_KEY) || localStorage.getItem(WORKSPACE_KEY_V1);
    const parsed = parseWorkspace(stored);
    const sessions = {};
    for (const meta of parsed.sessions) sessions[meta.id] = makeSession(meta.id, meta.name, meta.project);
    return { projects: parsed.projects, sessions, ui: parsed.ui };
  } catch { return empty; }
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
  const [db, setDb] = useState(loadWorkspace);
  const dbRef = useRef(db);
  const mutate = useCallback(fn => { const n = JSON.parse(JSON.stringify(dbRef.current)); fn(n); dbRef.current = n; setDb(n); }, []);

  /* Light path-copy update for hot streaming paths (assistant deltas, PTY
     output): avoids deep-cloning the whole workspace on every token. */
  const updateSessionLight = useCallback((sidx, fn) => {
    const cur = dbRef.current; const s = cur.sessions[sidx]; if (!s) return;
    const next = fn(s); if (next === s) return;
    const n = { ...cur, sessions: { ...cur.sessions, [sidx]: next } };
    dbRef.current = n; setDb(n);
  }, []);

  const [theme, setTheme] = useState(() => (db.ui.theme === 'light' ? 'light' : 'dark'));
  const [sid, setSid] = useState(null);                 // null = Home
  const [view, setViewS] = useState('conv');
  const [insp, setInsp] = useState(null);
  const [inspTab, setInspTab] = useState('transcript');
  const [homeConn, setHomeConn] = useState('idle');
  const [connectionStatus, setConnectionStatus] = useState({});
  const [engine, setEngine] = useState({available:false,error:'Checking bundled engine…'});
  const conn = sid ? (connectionStatus[sid] || 'disconnected') : homeConn;
  const setConn = (status, forSession = sid) => {
    if (forSession) setConnectionStatus(x=>({...x,[forSession]:status}));
    else setHomeConn(status);
  };
  const [runtimeDialog, setRuntimeDialog] = useState(null);
  const [dock, setDock] = useState({ ...UI_DEFAULTS.dock, ...db.ui.dock, sel: ['trace:main', 'trace:main'] });
  const [dragging, setDragging] = useState(false);
  const [workH, setWorkH] = useState(720);
  const [mode, setMode] = useState('agent');
  const [shellId, setShellId] = useState(null);
  const [phase, setPhase] = useState('all');
  const [group, setGroup] = useState(true);
  const [selTask, setSelTask] = useState(null);
  const [colTab, setColTab] = useState('in_progress');
  const [drafts, setDrafts] = useState({});
  const [railOpen, setRailOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { const c = { ...db.ui.collapsed }; const last = db.sessions[db.ui.lastSessionId]; if (last) c[last.project] = false; return c; });
  const [homeProject, setHomeProject] = useState(() => db.ui.homeProjectId || db.projects[0]?.id || '');
  const [drawer, setDrawer] = useState(null);
  const [palette, setPalette] = useState(false);
  const [confirmS, setConfirmS] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [stale, setStale] = useState(0);
  const [providerConfig, setProviderConfig] = useState({ configured: false, providers: [], modelsFilePresent: false });
  const [dataRootIssue, setDataRootIssue] = useState(null);
  const persistTimer = useRef(null);
  useEffect(() => {
    if (typeof localStorage === 'undefined') return undefined;
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(WORKSPACE_KEY, serializeWorkspace(dbRef.current, {
          lastSessionId: uiRef.current.sid, homeProjectId: homeProject, theme, view, collapsed,
          dock: { open: dock.open, expanded: dock.expanded, h: dock.h, split: dock.split }
        }));
        localStorage.removeItem(WORKSPACE_KEY_V1); // migrated to the v2 schema
      } catch { /* Storage unavailable/full: the app keeps running without persistence. */ }
    }, 300);
    return () => clearTimeout(persistTimer.current);
  }, [db, theme, view, collapsed, dock, homeProject]);
  const refreshProviderStatus = useCallback(async () => {
    try {
      const res = await getProviderStatus();
      if (res) setProviderConfig(res);
    } catch { /* desktop bridge only */ }
  }, []);
  const checkDataRoot = useCallback(async () => {
    try {
      const res = await dataRootStatus();
      if (res && !res.ok) setDataRootIssue(res);
      else setDataRootIssue(null);
    } catch { /* desktop bridge only */ }
  }, []);
  const handleRecoverDataRoot = async () => {
    try {
      const res = await recoverDataRoot();
      if (res && res.ok) {
        toast('canoPi data root recovered.');
        setDataRootIssue(null);
        const info = await runtimeInfo();
        setEngine(info);
        setConn(info.available ? 'idle' : 'disconnected');
      } else {
        toast('Root recovery refused: ' + (res?.error || 'unrecognized files present. No files deleted.'));
      }
    } catch (e) {
      toast('Root recovery failed: ' + String(e.message || e));
    }
  };
  const saveApiKey = async ({ provider, apiKey, baseUrl, api, modelId }) => {
    if (!apiKey || !apiKey.trim()) {
      toast('Please enter a valid API key.');
      return false;
    }
    try {
      await saveProviderKey(provider, apiKey.trim(), baseUrl ? baseUrl.trim() : undefined, api ? api.trim() : undefined, modelId ? modelId.trim() : undefined);
      toast(`API key for ${provider} saved to canoPi profile.`);
      await refreshProviderStatus();
      return true;
    } catch (e) {
      toast('Failed to save API key: ' + String(e.message || e));
      return false;
    }
  };
  useEffect(() => {
    runtimeInfo().then(x => { setEngine(x); setConn(x.available ? 'idle' : 'disconnected'); }).catch(e => { setEngine({available:false,error:String(e)}); setConn('disconnected'); });
    refreshProviderStatus();
    checkDataRoot();
  }, [refreshProviderStatus, checkDataRoot]);

  const appRef = useRef(null), workRef = useRef(null), scrollRef = useRef({}), busyRef = useRef({}), logic = useRef({}), pendingSync = useRef(new Map());
  const uiRef = useRef({}); uiRef.current = { sid, view, insp, inspTab, conn, selTask, mode };

  const ss = sid && db.sessions[sid] ? db.sessions[sid] : null;
  const availableModels = ss ? ss.models : [];
  const runtimeCommands = ss ? ss.commands : [];
  const liveModel = ss ? ss.liveModel : null;
  const thinkingLevels = ss ? ss.thinkingLevels : null;
  const thinkingLevel = ss ? ss.thinkingLevel : null;
  const eff = a => (conn === 'disconnected' ? 'disconnected' : a.state);
  const shells = ss ? ss.shells : [];
  const curShellId = shells.find(s => s.id === shellId) ? shellId : (shells[0] && shells[0].id) || null;
  const dockTabs = ss ? [...ss.order.map(id => ({ id: 'trace:' + id, label: (id === 'main' ? 'Main' : ss.agents[id].name) + ' activity', kind: 'trace', owner: id })), ...ss.shells.map(s => ({ id: 'shell:' + s.id, label: s.name, kind: 'shell', sh: s }))] : [];
  const dockMax = Math.max(80, workH - 320);
  const dockHeight = !dock.open ? 36 : dock.expanded ? Math.floor(dockMax * .9) : Math.min(dock.h, dockMax);
  const layerOpen = !!(drawer || palette || confirmS || runtimeDialog);

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
  const importProviderDefinitions = async () => {
    if(uiRef.current.sid){toast('Return Home before importing provider definitions.');return;}
    try {
      const found=await previewOmpModels();
      if(!found.available){toast('No compatible OMP models.yml or models.yaml was found.');return;}
      const filename=found.files.includes('models.yml')?'models.yml':found.files[0];
      const ok=await confirm({title:'Import OMP model definitions?',body:`Copy ${filename} to canoPi without changing OMP? This file can contain provider API keys. Auth database, sessions, extensions, and unrelated OMP files are never copied. Existing canoPi models will not be overwritten.`,ok:'Copy model config'});
      if(!ok)return;
      await importOmpModels(filename);
      toast('Provider definitions imported. Start a new session to use them.');
    }catch(e){toast('Import failed: '+String(e.message||e));}
  };

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
  const openSession = async id => {
    const s = dbRef.current.sessions[id]; if (!s) return;
    uiRef.current.sid = id;
    setSid(id); setViewS('conv'); setMode('agent'); setSelTask(null); setPhase('all'); closeRail();
    const workers = s.order.filter(x => x !== 'main');
    const wide = typeof window !== 'undefined' && window.innerWidth > 1240;
    mutate(d => { const x = d.sessions[id]; x.unread = 0; if (wide && workers.length && !x.seen) { x.seen = true; x.agents[workers[0]].unread = false; } });
    if (wide && workers.length && !s.seen) { setInsp(workers[0]); setInspTab('transcript'); } else setInsp(null);
    setDock(d => ({ ...d, sel: ['trace:main', s.shells[0] ? 'shell:' + s.shells[0].id : 'trace:main'] }));
    setShellId(s.shells[0] ? s.shells[0].id : null);
    const project=dbRef.current.projects.find(p=>p.id===s.project);
    if(!project || !engine.available) { toast(engine.error||'Bundled OMP unavailable'); return; }
    try { const opened=await startRuntime(id,project.path); setConn('connected',id); if(opened.state) applyRuntimeState(id,opened.state); else await refreshState(id); await bootSession(id); await refreshHistory(id); }
    catch(e) { setConn('disconnected',id); const msg=String(e.message||e); if(msg.includes('unowned root')) checkDataRoot(); toast('Session failed: '+msg); }
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

  /* Native project selection; path comes from the OS dialog, not webkitdirectory. */
  const openFolder = async () => {
    try {
      const path = await pickProject(); if (!path || typeof path !== 'string') return;
      const name = path.split(/[\\/]/).filter(Boolean).at(-1) || 'project';
      const existing = dbRef.current.projects.find(p => p.path === path);
      const id = existing?.id || 'p' + Date.now();
      if (!existing) mutate(d => { d.projects.push({ id, name, path }); });
      setHomeProject(id); setCollapsed(c => ({...c, [id]: false})); goHome();
      toast('Opened ' + name);
    } catch (e) { toast(String(e.message || e)); }
  };
  const startSession = async (text, projectId) => {
    const t = text.trim();
    if (t.split(/\s+/)[0] === '/share') { toast('/share is intentionally excluded from canoPi'); return; } const project = dbRef.current.projects.find(p => p.id === projectId);
    if (!t || !project) { toast('Open a project folder first.'); return; }
    if (!engine.available) { toast(engine.error || 'Bundled OMP unavailable'); return; }
    const id = 's' + Date.now();
    mutate(d => { d.sessions[id] = makeSession(id, titleFrom(t), projectId); });
    uiRef.current.sid = id; setSid(id); setViewS('conv'); setInsp(null); setMode('agent'); setShellId(null);
    setDrafts(x => ({...x, home:''})); setDock(d => ({...d, sel:['trace:main','trace:main']}));
    try {
      const opened = await startRuntime(id, project.path);
      setConn('connected',id);
      if (opened.state) applyRuntimeState(id, opened.state);
      await bootSession(id);
      pushMsg(id, 'main', U(t));
      await mainReply(id, t);
    } catch (e) { setConn('disconnected',id); const msg=String(e.message||e); if(msg.includes('unowned root')) checkDataRoot(); setAgent(id,'main',{state:'failed',activity:'Runtime failed to start'}); pushMsg(id,'main',N('Engine error: '+msg)); toast('Cannot start cnp: '+msg); }
  };

  /* Native adapters. Browser surfaces are real per-agent WebView2 windows; tool-driven
     computer/browser automation is intentionally not misrepresented as implemented. */
  const terminalDecoders = useRef(new Map());
  const terminalOutput = useRef(new Map());
  const terminalSeq = useRef(new Map());
  useEffect(()=>{
    let stop=()=>{}; let mounted=true;
    watchTerminal(
      p=>{
        const key=p.sessionKey+'/'+p.terminalId;
        if (p.replay) { /* replacement payload: full bounded scrollback */
          terminalOutput.current.set(key,''); terminalDecoders.current.delete(key); terminalSeq.current.delete(key);
        } else if (Number.isSafeInteger(p.seq)) {
          const last=terminalSeq.current.get(key);
          if (last!=null && p.seq<=last) return; /* duplicate or reordered chunk */
          terminalSeq.current.set(key,p.seq);
        }
        let decoder=terminalDecoders.current.get(key);
        if(!decoder){decoder=new TextDecoder('utf-8');terminalDecoders.current.set(key,decoder);}
        const bytes=Uint8Array.from(atob(p.dataBase64),c=>c.charCodeAt(0));
        const output=decoder.decode(bytes,{stream:!p.replay});
        if(!output && !p.replay)return;
        terminalOutput.current.set(key,(terminalOutput.current.get(key)||'').concat(output).slice(-262144));
        const text=terminalOutput.current.get(key);
        updateSessionLight(p.sessionKey,s=>{const idx=s.shells.findIndex(x=>x.id===p.terminalId);if(idx<0)return s;
          const shells=s.shells.slice();shells[idx]={...shells[idx],lines:[{c:'',t:text}]};return {...s,shells};});
      },
      p=>{
        const key=p.sessionKey+'/'+p.terminalId;
        terminalDecoders.current.delete(key);terminalOutput.current.delete(key);terminalSeq.current.delete(key);
        const exit=Number.isInteger(p.exitCode)?p.exitCode:'ended';
        updateSessionLight(p.sessionKey,s=>{const idx=s.shells.findIndex(x=>x.id===p.terminalId);if(idx<0)return s;
          const shells=s.shells.slice();shells[idx]={...shells[idx],exited:exit};return {...s,shells};});
      }
    ).then(f=>{if(mounted)stop=f;else f();}).catch(e=>toast('Native PTY listener: '+String(e)));
    return ()=>{mounted=false;stop();};
  },[updateSessionLight,toast]);
  const shellExec = async (sidx,shid,raw) => {
    try { await writeTerminal(sidx,shid,raw+'\r'); }
    catch(e){toast('Terminal write: '+String(e));}
  };
  const shellInterrupt = (sidx,shid) => writeTerminal(sidx,shid,'\x03').catch(e=>toast(String(e)));
  const newShell = async () => {
    const sidx=uiRef.current.sid;const s=dbRef.current.sessions[sidx];if(!s)return;
    const project=dbRef.current.projects.find(p=>p.id===s.project);if(!project)return;
    const id='term'+Date.now();
    try {
      await createTerminal(sidx,id,project.path);
      mutate(d=>d.sessions[sidx].shells.push({id,name:'Shell '+(d.sessions[sidx].shells.length+1),cwd:project.path,lines:[],proc:'native',exited:null,hist:[],trunc:0}));
      setShellId(id);setDock(x=>({...x,open:true,sel:['shell:'+id,x.sel[1]]}));
    }catch(e){toast('Terminal failed: '+String(e));}
  };
  const closeShell = async id => {
    const sx=uiRef.current.sid;
    try{await closeTerminal(sx,id); mutate(d=>{const s=d.sessions[sx];if(s)s.shells=s.shells.filter(sh=>sh.id!==id);});}
    catch(e){toast('Close terminal: '+String(e));}
  };


  /* Actual OMP RPC flow. Acknowledgement is not completion; frames carry the reply. */
  const applyRuntimeState = (sidx, state) => {
    if (!state) return;
    setTodos(sidx, normalizeTodos(state));
    const model = state.model?.provider && state.model?.id ? { provider: state.model.provider, modelId: state.model.id } : null;
    mutate(x => { const s = x.sessions[sidx]; if (!s) return;
      if (model) s.liveModel = model;
      if (state.thinkingLevel !== undefined) s.thinkingLevel = state.thinkingLevel;
      s.context = state.contextUsage || null; });
    setAgent(sidx,'main',{state:state.isStreaming?'running':'idle',activity:state.isStreaming?'Generating':'Ready'});
  };
  const refreshState = async sidx => {
    const key='sync:'+sidx;
    if(busyRef.current[key]) { busyRef.current[key+':dirty']=true; return; }
    busyRef.current[key]=true;
    try { const state = await sendRpc(sidx,{type:'get_state'}); applyRuntimeState(sidx,state); }
    catch(e) { if(uiRef.current.sid===sidx) toast('State sync failed: '+String(e.message||e)); }
    finally {
      busyRef.current[key]=false;
      if (busyRef.current[key+':dirty']) {
        busyRef.current[key+':dirty']=false;
        queueStateSync(sidx,80);
      }
    }
  };
  const queueStateSync = (sidx, ms=140) => {
    if (pendingSync.current.has(sidx)) return;
    const timer = setTimeout(()=>{pendingSync.current.delete(sidx); void refreshState(sidx);},ms);
    pendingSync.current.set(sidx,timer);
  };
  const queueWorkersSync = (sidx, ms=400) => {
    const key='workers:'+sidx;
    if (busyRef.current[key]) { busyRef.current[key+':dirty']=true; return; }
    busyRef.current[key]=true;
    setTimeout(()=>{ busyRef.current[key]=false;
      if (busyRef.current[key+':dirty']) { busyRef.current[key+':dirty']=false; queueWorkersSync(sidx,ms); return; }
      void refreshWorkers(sidx);
    }, ms);
  };
  const refreshHistory = async sidx => {
    if(dbRef.current.sessions[sidx]?.threads.main.length) return;
    try {
      let cursor, history=[];
      for(let page=0;page<10;page++) {
        const d=await sendRpc(sidx,{type:'get_messages_page',limit:100,...(cursor?{cursor}:{})});
        const messages=Array.isArray(d?.messages)?d.messages:[];
        history.push(...messages); cursor=d?.nextCursor;
        if(!cursor) break;
      }
      const mapped=history.filter(m=>m?.role==='user'||m?.role==='assistant').map((m,i)=>({
        id:'history-'+i,role:m.role==='user'?'user':'asst',text:textFromMessage(m)
      })).filter(m=>m.text);
      mutate(db=>{ if(db.sessions[sidx] && !db.sessions[sidx].threads.main.length) db.sessions[sidx].threads.main=mapped; });
    } catch { /* History paging can be unavailable on older runtimes. */ }
  };
  const refreshCommands = async sidx => {
    try { const d=await sendRpc(sidx,{type:'get_available_commands'});
      const commands=(d?.commands||[]).filter(c=>c.name && c.name.replace(/^\//,'')!=='share').map(c=>({n:c.name.startsWith('/')?c.name:'/'+c.name,d:c.description||c.source||'',ok:true}));
      mutate(x => { const s = x.sessions[sidx]; if (s) s.commands = commands; });
    } catch { mutate(x => { const s = x.sessions[sidx]; if (s) s.commands = []; }); }
  };
  const refreshModels = async sidx => {
    try {
      const d = await sendRpc(sidx,{type:'get_available_models'});
      const models = Array.isArray(d) ? d : (d?.models || []);
      mutate(x => { const s = x.sessions[sidx]; if (s) s.models = models; });
    } catch(e) { toast('Model discovery failed: '+String(e.message||e)); }
  };
  const refreshThinkingLevels = async sidx => {
    try {
      const d = await sendRpc(sidx,{type:'get_available_thinking_levels'});
      const levels = Array.isArray(d?.levels) ? d.levels : null;
      if (levels) mutate(x => { const s = x.sessions[sidx]; if (s) s.thinkingLevels = levels; });
    } catch { /* Older engines may not expose the catalog; the select keeps the active level only. */ }
  };
  /* Reattach dock tabs for PTYs that outlived a previous UI session; pty_open
     against a live terminal replays its bounded scrollback into the tab. */
  const restoreShells = async sidx => {
    try {
      const d = await listTerminals(sidx);
      const terminals = Array.isArray(d?.terminals) ? d.terminals.filter(t => t && t.terminalId && t.alive) : [];
      if (!terminals.length) return;
      const project = dbRef.current.projects.find(p => p.id === dbRef.current.sessions[sidx]?.project);
      for (const t of terminals) {
        const s = dbRef.current.sessions[sidx]; if (!s) return;
        if (s.shells.some(sh => sh.id === t.terminalId)) continue;
        const name = 'Shell ' + (s.shells.length + 1);
        mutate(x => { const sess = x.sessions[sidx]; if (!sess || sess.shells.some(sh => sh.id === t.terminalId)) return; sess.shells.push({ id: t.terminalId, name, cwd: project ? project.path : '', lines: [{ c: '', t: '' }], proc: 'native', exited: null, hist: [], trunc: 0 }); });
        if (project) createTerminal(sidx, t.terminalId, project.path).catch(() => {});
      }
    } catch { /* pty_list unavailable on this build: dock restore skipped */ }
  };
  /* Post-handshake opt-ins, identical for every session: subagent frames and
     OMP ask/confirm dialogs (the real approval path) must reach this UI. */
  const bootSession = async sidx => {
    await sendRpc(sidx,{type:'set_subagent_subscription',level:'events'}).catch(()=>{});
    await sendRpc(sidx,{type:'set_ask_dialog',enabled:true}).catch(()=>{});
    await refreshModels(sidx);
    await refreshCommands(sidx);
    await refreshThinkingLevels(sidx);
    void refreshWorkers(sidx);
    void restoreShells(sidx);
  };
  const refreshWorkerMessages = async (sidx, aid) => {
    try {
      const data=await sendRpc(sidx,{type:'get_subagent_messages',subagentId:aid});
      if (!Array.isArray(data?.messages)) return;
      const msgs=data.messages.filter(m=>m?.role==='assistant'||m?.role==='user')
        .map((m,i)=>({id:'worker-native-'+aid+'-'+i,role:m.role==='assistant'?'asst':'user',text:textFromMessage(m)}))
        .filter(m=>m.text);
      mutate(d=>{const s=d.sessions[sidx];if(s?.threads[aid]) s.threads[aid]=msgs;});
    } catch { /* Subagent transcript not available until the registry loads. */ }
  };
  const refreshWorkers = async sidx => {
    try {
      const data = await sendRpc(sidx,{type:'get_subagents'});
      const workers = normalizeWorkers(data);
      mutate(d => { const ss=d.sessions[sidx]; if (!ss) return;
        for (const w of workers) {
          if (!ss.agents[w.id]) { ss.agents[w.id]=mkAgent(w.id,w.name,w.state,w.activity,{parent:w.parent}); ss.threads[w.id]=[]; ss.traces[w.id]=[]; ss.order.push(w.id); }
          else Object.assign(ss.agents[w.id], {state:w.state,activity:w.activity,parent:w.parent});
        }
      });
      if (uiRef.current.sid===sidx) for (const w of workers) { void refreshWorkerMessages(sidx,w.id); }
    } catch { /* older OMP versions may not expose this command */ }
  };
  const mainReply = async (sidx, text) => {
    if(text.trim().split(/\s+/)[0]==='/share') { toast('/share is excluded from canoPi'); return; }
    setAgent(sidx,'main',{state:'running',activity:'Waiting for OMP'});
    try { await sendRpc(sidx,{type:'prompt',message:text,streamingBehavior:'followUp'}); }
    catch(e) { setAgent(sidx,'main',{state:'failed',activity:'Request rejected'}); pushMsg(sidx,'main',N('OMP: '+String(e.message||e))); }
  };
  const stopMain = async () => { if (!sid) return; try { await sendRpc(sid,{type:'abort'}); await refreshState(sid); } catch(e) { toast(String(e.message||e)); } };
  const steer = async (sidx,aid,text) => {
    if (aid==='main') return mainReply(sidx,text);
    try { await sendRpc(sidx,{type:'steer_subagent',subagentId:aid,message:text}); pushMsg(sidx,aid,U(text)); }
    catch(e) { toast('Worker steering failed: '+String(e.message||e)); }
  };
  const stopWorker = async aid => { try { await sendRpc(sid,{type:'cancel_subagent',subagentId:aid}); void queueWorkersSync(sid, 0); } catch(e) { toast(String(e.message||e)); } };
  const disconnect = () => { setConn('disconnected',sid); };
  const reconnect = async () => {
    checkDataRoot();
    refreshProviderStatus();
    if (!sid) { const info=await runtimeInfo(); setEngine(info); setConn(info.available?'idle':'disconnected',null); return; }
    const project=dbRef.current.projects.find(p=>p.id===dbRef.current.sessions[sid]?.project);
    if (!project) return;
    try { const result=await startRuntime(sid,project.path); setConn('connected',sid); if(result.state) applyRuntimeState(sid,result.state); else await refreshState(sid); await bootSession(sid); await refreshHistory(sid); }
    catch(e) { setConn('disconnected',sid); const msg=String(e.message||e); if(msg.includes('unowned root')) checkDataRoot(); toast(msg); }
  };
  /* Session-scoped worker registry entry, created on the first frame that
     mentions the id so early subagent events land in the right transcript. */
  const ensureWorker = (sidx, aid, hint) => {
    if (!aid || dbRef.current.sessions[sidx]?.agents[aid]) return;
    mutate(d => {
      const s = d.sessions[sidx]; if (!s || s.agents[aid]) return;
      s.agents[aid] = mkAgent(aid, String(hint || aid), 'running', String(hint || 'Working'));
      s.threads[aid] = []; s.traces[aid] = []; s.order.push(aid);
    });
  };
  /* One-way extension events carry no registered reply id in the Rust bridge,
     so they are applied locally; only response-bearing methods open a dialog. */
  const applyOneWayExtension = (sidx, frame) => {
    switch (frame.method) {
      case 'notify': toast(String(frame.message || 'OMP notification')); return true;
      case 'setTitle': document.title = String(frame.title || 'canoPi'); return true;
      case 'set_editor_text': setDraft(sidx + ':main', String(frame.text || '')); return true;
      case 'setStatus': mutate(d => { const s = d.sessions[sidx]; if (!s) return; const st = { ...(s.extStatus || {}) }; if (frame.statusText) st[String(frame.statusKey)] = String(frame.statusText); else delete st[String(frame.statusKey)]; s.extStatus = st; }); return true;
      case 'setWidget': mutate(d => { const s = d.sessions[sidx]; if (!s) return; const w = { ...(s.extWidgets || {}) }; if (Array.isArray(frame.widgetLines)) w[String(frame.widgetKey)] = { lines: frame.widgetLines.map(String), placement: frame.widgetPlacement || 'belowEditor' }; else delete w[String(frame.widgetKey)]; s.extWidgets = w; }); return true;
      case 'open_url': {
        const url = String(frame.launchUrl || frame.url || '');
        if (url && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(() => toast('Sign-in link copied. Finish sign-in in your browser.')).catch(() => toast('Sign-in link: ' + url));
        } else toast('Sign-in link: ' + url);
        return true;
      }
      default: return false;
    }
  };
  logic.current.onFrame = ({sessionKey,frame}) => {
    const sidx=sessionKey, ss=dbRef.current.sessions[sidx]; if(!ss || !frame) return;
    const ty=frame.type;
    if (ty==='available_commands_update') {
      const commands=(frame.commands||[]).filter(c=>c.name && c.name!=='share' && c.name!=='/share').map(c=>({n:c.name.startsWith('/')?c.name:'/'+c.name,d:c.description||c.source||'',ok:true}));
      mutate(d => { const s=d.sessions[sidx]; if (s) s.commands = commands; }); return;
    }
    if (ty==='prompt_result' && frame.status==='error') {
      pushMsg(sidx,'main',N('OMP turn failed: '+String(frame.error?.message||'Provider error')));
    }
    if (ty==='runtime_exit' || ty==='transport_error') {
      const detail=(ty==='transport_error'?'RPC transport failed':'Engine exited')+(Number.isInteger(frame.code)?' (exit code '+frame.code+')':'');
      setConn('disconnected',sidx); setAgent(sidx,'main',{state:'disconnected',activity:detail});
      if (ty==='runtime_exit' && frame.unexpected) pushMsg(sidx,'main',N('The engine stopped unexpectedly'+(Number.isInteger(frame.code)?' with exit code '+frame.code:'')+'. Reconnect to restart this session.'));
      return;
    }
    if (ty==='rpc_late_response') {
      /* The Rust wait already timed out locally; this admission arrived late.
         Reconcile instead of resending, so the prompt is never admitted twice. */
      const resp=frame.response||{};
      if (resp.success) { setAgent(sidx,'main',{state:'running',activity:'Working'}); pushMsg(sidx,'main',N('OMP admitted the request after a slow start; canoPi did not resend it.')); queueStateSync(sidx); }
      else queueStateSync(sidx);
      return;
    }
    if (ty==='stderr_redacted') {
      if (frame.panicked) { pushMsg(sidx,'main',N('The cnp engine reported a panic ('+String(frame.byteCount||0)+' stderr bytes redacted).')); setAgent(sidx,'main',{state:'failed',activity:'Engine panic'}); }
      return;
    }
    if (ty==='extension_ui_request') {
      if (frame.method==='cancel') { setRuntimeDialog(x=>x?.frame?.id===frame.targetId?null:x); return; }
      if (applyOneWayExtension(sidx, frame)) return;
      setRuntimeDialog({sessionKey:sidx,frame}); return;
    }
    if (ty==='agent_start') setAgent(sidx,'main',{state:'running',activity:'Working'});
    if (ty==='agent_end' || ty==='session_settled') { setAgent(sidx,'main',{state:'idle',activity:'Ready'}); queueStateSync(sidx); queueWorkersSync(sidx); }
    if (ty==='model_changed' || ty==='thinking_level_changed') queueStateSync(sidx);
    if (ty==='tool_execution_start') {
      const id='tool-'+(toolCallIdOf(frame)||String(mid()));
      const tool=String(frame.toolName||frame.name||'tool');
      const arg=typeof frame.args==='string'?frame.args:JSON.stringify(frame.args||{});
      if(!ss.threads.main.some(m=>m.id===id)) pushMsg(sidx,'main',{id,role:'tool',tool,arg,status:'running'});
      addTrace(sidx,'main',tr(tool,arg,'running',''));
      if(tool==='todo'||tool==='task') queueStateSync(sidx);
    }
    if (ty==='tool_execution_end') {
      const id='tool-'+toolCallIdOf(frame);
      patchMsg(sidx,'main',id,{status:frame.isError?'error':'ok',meta:frame.isError?'Failed':'Done'});
      queueStateSync(sidx); queueWorkersSync(sidx);
    }
    if (ty==='message_start' || ty==='message_update' || ty==='message_end') {
      updateSessionLight(sidx, session => {
        const list = projectAssistantFrame(session.threads.main, frame);
        if (list === session.threads.main) return session;
        return { ...session, threads: { ...session.threads, main: list } };
      });
    }
    if (ty==='subagent_lifecycle') {
      const p=frame.payload||{}; const aid=subagentFrameId(frame); if(!aid) return;
      ensureWorker(sidx,aid,p.description||p.agent);
      const st=workerStateFromStatus(p.status)||'running';
      setAgent(sidx,aid,{state:st,activity:String(p.description||p.agent||'Worker')});
      queueWorkersSync(sidx); return;
    }
    if (ty==='subagent_progress') {
      const p=frame.payload||{}; const aid=subagentFrameId(frame); if(!aid) return;
      ensureWorker(sidx,aid,p.task||p.description||p.agent);
      const st=workerStateFromStatus(p.progress?.status);
      if (st) setAgent(sidx,aid,{state:st,activity:String(p.progress?.currentTool?`Running ${p.progress.currentTool}`:p.task||'Working')});
      queueWorkersSync(sidx); return;
    }
    if (ty==='subagent_event') {
      const aid=subagentFrameId(frame); const ev=subagentFrameEvent(frame);
      if(!aid || !ev) return;
      ensureWorker(sidx,aid);
      if (ev.type==='message_end' && ev.message?.role==='assistant') {
        const body=textFromMessage(ev.message);
        if (body) pushMsg(sidx,aid,{role:'asst',text:body});
      }
      if (ev.type==='tool_execution_start') {
        const tool=String(ev.toolName||ev.name||'tool');
        const arg=typeof ev.args==='string'?ev.args:JSON.stringify(ev.args||{});
        addTrace(sidx,aid,tr(tool,arg,'running',''));
      }
      if (ev.type==='tool_execution_end' || ev.type==='agent_end') queueWorkersSync(sidx);
    }
  };
  useEffect(() => {
    let dispose=()=>{}; let alive=true;
    watchFrames(frame => logic.current.onFrame?.(frame), () => setStale(n => n + 1)).then(fn=>{ if(alive) dispose=fn; else fn(); });
    return ()=>{alive=false;dispose();};
  },[]);
  useEffect(() => {
    if(!sid || !engine.available) return;
    const timer=setInterval(()=>{ if(uiRef.current.conn==='connected') queueStateSync(sid,180); },20000);
    return ()=>{clearInterval(timer); const t=pendingSync.current.get(sid); if(t){clearTimeout(t);pendingSync.current.delete(sid);} };
  },[sid,engine.available]);
  const changeModel = async value => {
    if(!sid) { toast('Open a session to choose a model.'); return; }
    const model=availableModels.find(m=>(m.provider+'/'+(m.id||m.modelId))===value);
    if(!model) return;
    try { await sendRpc(sid,{type:'set_model',provider:model.provider,modelId:model.id||model.modelId}); await refreshState(sid); }
    catch(e) { toast('Model change failed: '+String(e.message||e)); }
  };
  const setThinking = async value => {
    if (!sid) { toast('Open a session to change the thinking level.'); return; }
    try { await sendRpc(sid,{type:'set_thinking_level',level:value}); await refreshState(sid); }
    catch(e) { toast('Thinking level change failed: '+String(e.message||e)); }
  };
  const answerDialog = async response => {
    if(!runtimeDialog) return;
    try { await answerUi(runtimeDialog.sessionKey,{type:'extension_ui_response',id:runtimeDialog.frame.id,...response}); }
    catch(e) { toast('Dialog response failed: '+String(e.message||e)); }
    setRuntimeDialog(null);
  };

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
    gsap, db, sid, ss, view, insp, inspTab, conn, engine, availableModels, runtimeCommands, liveModel, thinkingLevels, thinkingLevel, runtimeDialog, changeModel, setThinking, answerDialog, importProviderDefinitions, dock, dragging, mode, shellId: curShellId, phase, group, selTask, colTab, drafts, theme, railOpen, collapsed, homeProject, stale,
    drawer, palette, confirmS, dockTabs, dockHeight, dockMax, workRef, scrollRef, eff,
    providerConfig, refreshProviderStatus, saveApiKey, dataRootIssue, handleRecoverDataRoot,
    setDraft, setPhase, setGroup, setSelTask, setColTab, setMode, setShellId, setDock, setDragging, setRailOpen, setCollapsed, setHomeProject, setDrawer, setPalette, setConn, setConfirmS,
    toast, confirm, mutate, updateSessionLight, pushMsg, patchMsg, addTrace, setAgent, setTodos, goHome, openSession, setView, openInspector, closeInspector, focusTrace, toggleTheme, newSession: goHome, openFolder, startSession,
    shellExec, shellInterrupt, newShell, closeShell, mainReply, stopMain, steer, stopWorker, disconnect, reconnect, setStale
  };

  return (
    <Ctx.Provider value={A}>
      <div className="cp" data-theme={theme}>
        <style>{CSS}</style>
        <div className="app" ref={appRef}>
          <Topbar />
          {dataRootIssue && (
            <div className="banner" role="status" style={{ borderLeftColor: '#d66' }}>
              <Unplug size={16} />
              <span><b>Data root ownership recovery needed:</b> {dataRootIssue.roots?.find(r => r.error)?.error || 'Existing data root lacks canoPi owner marker.'}</span>
              <span className="grow" />
              <button className="btn sm primary" onClick={handleRecoverDataRoot}>Recover data root</button>
            </div>
          )}
          {conn === 'disconnected' && !dataRootIssue && <div className="banner" role="status"><Unplug size={16} /><span><b>canoPi engine unavailable.</b> {engine.error || "The engine is disconnected."}</span><span className="grow" /><button className="btn sm primary" onClick={reconnect}>Reconnect</button></div>}
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
        {runtimeDialog && <NativeDialog key={runtimeDialog.frame.id} />}
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
      <span className={'pill' + (off ? ' off' : '')} title={A.engine.available ? "Bundled cnp engine binary found (handshake not yet checked)" : (A.engine.error || "Runtime unavailable")}>{off ? 'Unavailable' : conn === 'idle' ? 'Engine installed' : 'cnp connected'}</span>
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
      <div className="rail-f"><small>canoPi engine · local session</small></div>
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
            <button type="button" className="chip" onClick={() => A.setDrawer('models')}>{A.liveModel ? A.liveModel.provider+'/'+A.liveModel.modelId : (A.providerConfig?.configured ? (A.providerConfig.providers?.[0]?.id + ' (ready)') : 'Model setup')}</button>
            <button type="submit" className="send" aria-label="Start session" disabled={!draft.trim() || !proj}><ArrowUp size={17} /></button>
          </div>
        </form>
        <div className="starters">{STARTERS.map(s => <button key={s} onClick={() => { A.setDraft('home', s); if (ta.current) ta.current.focus(); }}>{s}</button>)}</div>
        {!A.db.projects.length && (
          <div className="offline" role="status"><b>No project open yet.</b> Open a project folder to create a canoPi session inside it. The folder stays on this PC; canoPi only stores its name and path as UI metadata.
            <div className="btns" style={{ marginTop: 8 }}><button type="button" className="btn primary" onClick={A.openFolder}>Open project folder</button></div>
          </div>
        )}
        {A.db.projects.length > 0 && !A.providerConfig?.configured && (
          <div className="offline" role="status"><b>API key setup required.</b> Configure an API key (Anthropic, OpenAI, OpenRouter, or custom) in your isolated canoPi profile before running a session.
            <div className="btns" style={{ marginTop: 8 }}><button type="button" className="btn primary" onClick={() => A.setDrawer('models')}>Configure API Key</button></div>
          </div>
        )}
        {A.db.projects.length > 0 && !A.engine.available && (
          <div className="offline" role="status"><b>Bundled cnp engine unavailable.</b> {A.engine.error || 'The bundled engine was not found.'} New sessions cannot start until the engine ships with canoPi.</div>
        )}
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
        <div><h1>{ss.name}</h1><p><span>Main agent</span><StateTag s={A.eff(m)} /><span>{m.activity}</span>{ss.extStatus && Object.values(ss.extStatus).length ? <span>{Object.values(ss.extStatus).join(' · ')}</span> : null}</p></div>
        <span className="grow" />{running && <button className="btn sm" onClick={A.stopMain}>Stop turn</button>}
      </header>
      {ss.extWidgets && Object.entries(ss.extWidgets).map(([k, w]) => (
        <details key={k} className="bsec" style={{ margin: '8px 22px 0' }} open><summary>{k}</summary><div className="in">{w.lines.map((l, i) => <div key={i}>{l}</div>)}</div></details>
      ))}
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
  const onChange = e => { const v = e.target.value; A.setDraft(key, v); if (!shell && v.startsWith('/') && !v.includes(' ')) setSlash({ list: A.runtimeCommands.filter(c => c.n.startsWith(v.toLowerCase())), idx: 0 }); else setSlash({ list: [], idx: 0 }); };
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
        <span className="route">{shell ? (sh ? <>To <b>{sh.name}</b>. Native ConPTY shell.</> : 'No shell open') : <>To <b>Main agent</b> only</>}</span>
      </div>
      <div className="c-box">
        <textarea ref={ta} rows={1} className={shell ? 'mono' : ''} value={value} onChange={onChange} onKeyDown={onKey} disabled={!shell && off}
          aria-label={shell ? 'Shell command' : 'Message main agent'} aria-activedescendant={slash.list.length ? 'sl' + slash.idx : undefined}
          placeholder={shell ? 'Command for the selected shell' : off ? 'Reconnect to message the main agent' : 'Message the main agent. Type / for commands'} />
        <button type="submit" className="send" aria-label={shell ? 'Run command' : 'Send message'} disabled={(!shell && off) || (shell && !sh) || !value.trim()}><ArrowUp size={17} /></button>
      </div>
      <div className="c-meta">
        <button type="button" className="chip" onClick={() => A.setDrawer('models')}>{A.liveModel ? A.liveModel.provider+'/'+A.liveModel.modelId : (A.providerConfig?.configured ? (A.providerConfig.providers?.[0]?.id + ' (ready)') : 'Model setup')}</button>
        <label>Thinking <select aria-label="Thinking level" disabled={!(A.thinkingLevels && A.thinkingLevels.length)} value={A.thinkingLevel ?? ''} onChange={e => A.setThinking(e.target.value)}>
          {(A.thinkingLevels && A.thinkingLevels.length ? A.thinkingLevels : [A.thinkingLevel]).filter(Boolean).map(o => <option key={o} value={o}>{String(o).charAt(0).toUpperCase()+String(o).slice(1)}</option>)}
        </select></label>
        <span className="meter" title={ss.context && ss.context.tokens != null ? `${ss.context.tokens} of ${ss.context.contextWindow} context tokens` : 'Context usage is not reported by this runtime yet'}>Context {ss.context && ss.context.tokens != null ? `${ss.context.tokens}${ss.context.contextWindow ? '/' + ss.context.contextWindow : ''}` : '—'}</span>
      </div>
      {slash.list.length > 0 && (
        <div className="slash" role="listbox" aria-label="Commands">
          <h5>Commands reported by canoPi engine</h5>
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
  const canStop = !off && ['running', 'waiting', 'reviewing'].includes(a.state); // OMP cancel is terminal; there is no restart RPC
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
function BrowserPanel({aid}) {
  const A=useApp();const a=A.ss.agents[aid];const surf=A.ss.browsers[aid];
  const [url,setUrl]=useState(surf?.url || 'https://example.com');
  const [shot,setShot]=useState(null);
  const record=u=>A.mutate(d=>{const s=d.sessions[A.ss.id];if(!s)return;s.browsers={...s.browsers,[aid]:{owner:A.ss.id+'/'+aid,state:'open',url:u,lastUsed:Date.now()}};});
  const refreshState=async()=>{try{const st=await agentBrowserState(A.ss.id,aid);if(st&&st.url)record(st.url);}catch{/* surface state is cosmetic */}};
  const open=async()=>{
    try { if(!surf) await openAgentBrowser(A.ss.id,aid,url); else await navigateAgentBrowser(A.ss.id,aid,url);
      record(url); A.toast(surf?'Native browser navigated':'Native browser opened for '+a.name); void refreshState();}
    catch(e){A.toast('Native browser: '+String(e));}
  };
  const reload=async()=>{try{await reloadAgentBrowser(A.ss.id,aid);void refreshState();}catch(e){A.toast(String(e));}};
  const capture=async()=>{try{const s=await screenshotAgentBrowser(A.ss.id,aid);if(s&&s.dataBase64)setShot('data:image/png;base64,'+s.dataBase64);}catch(e){A.toast('Screenshot: '+String(e));}};
  const close=async()=>{try{await closeAgentBrowser(A.ss.id,aid);setShot(null);
    A.mutate(d=>{const s=d.sessions[A.ss.id];if(!s)return;const b={...s.browsers};delete b[aid];s.browsers=b;});}
    catch(e){A.toast(String(e));}};
  return <div className="bpanel">
    <div className="btool"><Globe size={15}/><input aria-label="Browser address" value={url} onChange={e=>setUrl(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void open();}} /></div>
    <div className="vp" style={{marginTop:14}}><div className="empty"><Globe size={24}/><b>{a.name} · private browser</b>
      <p>Opens a real native browser window with an isolated profile for this agent on Windows. This is not simulated page content.</p>
      <div className="btns">
        <button className="btn primary" onClick={open}>{surf?'Navigate':'Open native browser'}</button>
        {surf&&<button className="btn" onClick={reload}>Reload</button>}
        {surf&&<button className="btn" onClick={capture}>Screenshot</button>}
        {surf&&<button className="btn" onClick={close}>Close window</button>}
      </div>
      {surf && <p>Window open at {surf.url}</p>}
    </div></div>
    {shot && <img src={shot} alt="Screenshot captured from the native browser window" style={{margin:'4px 16px',width:'calc(100% - 32px)',border:'1px solid var(--glass-line)',borderRadius:12}} />}
    <p className="bmeta">Address bar, reload and screenshots are host controls. Agent-driven page interaction and page reads still require OMP's browser tool adapter.</p>
  </div>;
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
  useEffect(() => { const el = out.current; if (!el || typeof ResizeObserver === 'undefined') return undefined; const upd = () => {const cols=Math.max(20,Math.floor(el.clientWidth/7.8)),rows=Math.max(2,Math.floor(el.clientHeight/19));setSize(`${cols}x${rows}`);void resizeTerminal(sid,sh.id,rows,cols).catch(()=>{});}; upd(); const ro = new ResizeObserver(upd); ro.observe(el); return () => ro.disconnect(); }, []);
  const key = 'shell-in:' + sid + ':' + sh.id; const value = A.drafts[key] || ''; const hi = useRef(null);
  const info = sh.exited != null ? (Number.isInteger(sh.exited) ? `Exited with code ${sh.exited}` : 'PTY session ended. The engine did not report an exit code.') : sh.proc ? `Running ${sh.proc}. Ctrl+C stops it` : 'Ready';
  return (
    <div className="tpane">
      <div className="tp-h">{picker}<span>{sh.name} (native PTY)</span><span style={{ marginLeft: 'auto' }}>{info}</span><span>{size}</span>{sh.exited != null && <button className="btn sm" onClick={A.newShell}>New shell</button>}</div>
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
    A.runtimeCommands.forEach(c => all.push({ g: 'Commands', l: c.n, h: c.ok ? c.d : 'Unavailable', run: () => { if (!c.ok) { A.toast(c.n + ' is unavailable: ' + c.why); return; } A.setMode('agent'); A.setView('conv'); A.setDraft(ss.id + ':main', c.n + ' '); } }));
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
function Need() { return <p className="lede">Open a session first. This section is about what the agents in a session are doing.</p>; }
function ProviderSetupSection() {
  const A = useApp();
  const [provider, setProvider] = useState('anthropic');
  const [keyInput, setKeyInput] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelId, setModelId] = useState('');
  const [saving, setSaving] = useState(false);
  const configured = A.providerConfig?.providers || [];
  const hasCustom = provider === 'custom' || provider === '9router';
  const onSave = async e => {
    e.preventDefault();
    if (!keyInput.trim()) { A.toast('Enter an API key.'); return; }
    setSaving(true);
    const ok = await A.saveApiKey({
      provider,
      apiKey: keyInput,
      baseUrl: hasCustom ? baseUrl : undefined,
      modelId: hasCustom ? modelId : undefined
    });
    setSaving(false);
    if (ok) setKeyInput('');
  };
  return (
    <div style={{ marginBottom: 14 }}>
      <h4>Provider setup (API key first)</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6, padding: '10px 12px', background: 'var(--glass-2)', border: '1px solid var(--glass-line)', borderRadius: 'var(--r)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>Provider</label>
          <select aria-label="Select AI provider" value={provider} onChange={e => setProvider(e.target.value)} style={{ background: 'var(--glass-3)', border: '1px solid var(--glass-line)', borderRadius: 'var(--r)', padding: '4px 8px', fontSize: 13 }}>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI (GPT)</option>
            <option value="openrouter">OpenRouter</option>
            <option value="custom">Custom (OpenAI-compatible)</option>
            <option value="9router">9Router (optional local proxy)</option>
          </select>
        </div>
        {hasCustom && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: 'var(--text-3)' }}>Base URL</label>
            <input
              type="text"
              aria-label="Base URL"
              placeholder={provider === '9router' ? 'http://127.0.0.1:9090/v1' : 'https://api.example.com/v1'}
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              style={{ background: 'var(--glass-3)', border: '1px solid var(--glass-line)', borderRadius: 'var(--r)', padding: '5px 8px', fontSize: 13 }}
            />
          </div>
        )}
        {hasCustom && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: 'var(--text-3)' }}>Model ID (optional)</label>
            <input
              type="text"
              aria-label="Model ID"
              placeholder="e.g. llama-3.3-70b"
              value={modelId}
              onChange={e => setModelId(e.target.value)}
              style={{ background: 'var(--glass-3)', border: '1px solid var(--glass-line)', borderRadius: 'var(--r)', padding: '5px 8px', fontSize: 13 }}
            />
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: 'var(--text-3)' }}>API Key</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              autoComplete="off"
              aria-label="API Key"
              placeholder={provider === 'anthropic' ? 'sk-ant-...' : provider === 'openai' ? 'sk-...' : 'API key'}
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              style={{ flex: 1, background: 'var(--glass-3)', border: '1px solid var(--glass-line)', borderRadius: 'var(--r)', padding: '5px 8px', fontSize: 13 }}
            />
            <button className="btn sm primary" disabled={saving || !keyInput.trim()} onClick={onSave}>Save Key</button>
          </div>
        </div>
      </div>
      {configured.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <small style={{ color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Configured in canoPi profile:</small>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {configured.map(p => (
              <span key={p.id} className="chip" style={{ fontSize: 11, borderColor: 'var(--accent)' }}>
                {p.id}: {p.hasKey ? 'Key saved' : 'No key'}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
function DrawerBody({ sec }) {
  const A = useApp(); const ss = A.ss;
  const close = () => A.setDrawer(null);
  const insert = text => { close(); setTimeout(() => { if (ss) { A.setMode('agent'); A.setView('conv'); A.setDraft(ss.id + ':main', text); } else A.setDraft('home', text); }, 0); };
  const sel = (val, opts, on, label) => <select aria-label={label} value={val} onChange={e => on(e.target.value)}>{opts.map(o => <option key={o}>{o}</option>)}</select>;
  switch (sec) {
    case 'agents': return !ss ? <Need /> : (<><h3>Agents</h3><p className="lede">One session, one main agent, and the workers it started. Only the main agent starts workers.</p>
      {ss.order.map(id => { const a = ss.agents[id], b = ss.browsers[id]; return <Row2 key={id} sub={`${a.activity}. Browser: ${b ? b.state : 'not created'}.`} right={<button className="btn sm" onClick={() => { close(); setTimeout(() => (id === 'main' ? (A.closeInspector(), A.setView('conv')) : A.openInspector(id, 'transcript')), 0); }}>Open</button>}><b>{a.name}</b> <StateTag s={A.eff(a)} />{a.flag && <> <span className="flag">Unsupported depth</span></>}</Row2>; })}</>);
    case 'connections': return !ss ? <Need /> : (<><h3>Connections</h3><p className="lede">Only links canoPi really knows about: the main agent, its workers, and the activity log and browser each one owns.</p><ConnGraph /><p className="lede" style={{ marginTop: 8 }}>Your own shells belong to no agent. An activity log is not a terminal.</p></>);
    case 'models': return (<><h3>Models and roles</h3><p className="lede">Models reported by the canoPi engine. API keys are stored in your isolated canoPi profile.</p>
      <ProviderSetupSection />
      <h4>Active session model</h4><Row2 sub={ss ? 'Changes apply to this session only' : 'Open a session first'} right={<select aria-label="canoPi model" disabled={!ss || !A.availableModels.length} value={A.liveModel ? A.liveModel.provider+'/'+A.liveModel.modelId : ''} onChange={e=>A.changeModel(e.target.value)}>
        <option value="">{A.availableModels.length ? 'Choose model' : (ss ? 'No models reported by this session' : 'Open a session to load models')}</option>
        {A.availableModels.map((m,i)=><option key={i} value={m.provider+'/'+(m.id||m.modelId)}>{m.provider}/{m.id||m.modelId}</option>)}
      </select>}>Model</Row2>
      <h4>Thinking</h4><Row2 sub="Reported by get_state; change it from the composer" right={<b>{ss?.thinkingLevel ?? '—'}</b>}>Active level</Row2>
      <h4>Provider setup</h4><Row2 sub="Optional, models.yml only; copies provider definitions without changing OMP. Existing canoPi config is never overwritten." right={<button className="btn sm" disabled={!!ss} onClick={A.importProviderDefinitions}>Import OMP models</button>}>Import provider definitions</Row2>
    </>);


    case 'tools': return (<><h3>Tools and MCP</h3><p className="lede">Tools and MCP configuration are owned by OMP. GUI controls are disabled until the runtime configuration API is connected.</p><Row2 right={<span className="na">Read-only</span>}>OMP tools</Row2><Row2 right={<span className="na">Read-only</span>}>MCP servers</Row2></>);


    case 'commands': return (<><h3>Commands</h3><p className="lede">Taken from the runtime catalog. Unsupported ones say why.</p>
      {A.runtimeCommands.map(c => <Row2 key={c.n} sub={c.ok ? c.d : c.why} right={c.ok ? <button className="btn sm" onClick={() => insert(c.n + ' ')}>Use</button> : <span className="na">Unavailable</span>}><code>{c.n}</code></Row2>)}
      {!A.runtimeCommands.length && <p className="lede">Open a session to load OMP commands.</p>}</>);
    case 'rules': return (<><h3>Rules, skills and memory</h3><p className="lede">Owned by the bundled OMP profile. Editing is not exposed in this build.</p></>);


    case 'context': { if (!ss) return <Need />; const ctx = ss.context;
      return (<><h3>Context and approvals</h3><p className="lede">Numbers appear only when the runtime reports them.</p>
        <Row2 sub={ctx && ctx.tokens != null ? `${ctx.tokens} tokens of the ${ctx.contextWindow} context window` : 'This runtime has not reported context usage'} right={ctx && ctx.tokens != null ? <b>{ctx.tokens}{ctx.contextWindow ? ' / ' + ctx.contextWindow : ''}</b> : <span className="na">Unavailable</span>}>Context used</Row2><Row2 sub="Hidden. This runtime does not report them." right={<span className="na">Unavailable</span>}>Tokens and cost</Row2>
        <h4>Approvals</h4><Row2 sub="OMP asks through its own dialogs; a pending request opens the native dialog and blocks the engine until you answer." right={<b>{A.runtimeDialog ? 'Waiting for you' : 'Nothing waiting'}</b>}>Approval requests</Row2>
        <Row2 sub="Approvals are owned by OMP policy; canoPi forwards your decisions verbatim." right={<span className="na">Engine-owned</span>}>Policy</Row2></>); }
    case 'runtime': return (<><h3>Runtime and profile</h3><p className="lede">canoPi never changes your OMP install, credentials or 9Router settings on its own.</p>
      <Row2 sub="Bundled with canoPi, not a global installation" right={<span className="na">{A.engine.available ? "Available" : "Missing"}</span>}>Bundled cnp engine</Row2>
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

/* OMP extension_ui_request -> extension_ui_response, not a simulated approval. */
function NativeDialog() {
  const A=useApp(); const f=A.runtimeDialog?.frame;
  const [value,setValue]=useState('');
  const [answers,setAnswers]=useState({});
  if(!f) return null;
  const cancel=()=>A.answerDialog({cancelled:true});
  const submit=()=>{
    if(f.method==='confirm') return A.answerDialog({confirmed:true});
    if(f.method==='ask') return A.answerDialog({answers:(f.questions||[]).map(q=>{
      const v=answers[q.id]||(q.multi?[]:'');
      const selectedOptions=Array.isArray(v)?v:(q.options?.some(o=>o.label===v)?[v]:[]);
      const custom=answers[q.id+':custom']||(!selectedOptions.length && typeof v==='string'?v:'');
      return {id:q.id,selectedOptions,...(custom?{customInput:custom}:{})};
    })});
    return A.answerDialog({value});
  };
  return <Layer onClose={cancel}><div className="scrim" onClick={cancel}/><div className="modal wide" role="dialog" aria-modal="true" aria-label={f.title||'OMP request'}>
    <h2>{f.title||'OMP needs input'}</h2><p>{f.message||f.description||''}</p>
    {f.method==='open_url' && <div style={{display:'grid',gap:8}}><code style={{wordBreak:'break-all'}}>{f.launchUrl||f.url}</code><button className="btn" onClick={()=>navigator.clipboard.writeText(f.launchUrl||f.url).then(()=>A.toast('Link copied'))}>Copy sign-in URL</button></div>}
    {f.method==='ask' ? (f.questions||[]).map(q=><div key={q.id} style={{display:'grid',gap:6}}><b>{q.question}</b>
      {q.multi ? (q.options||[]).map(o=><label key={o.label}><input type="checkbox" checked={(answers[q.id]||[]).includes(o.label)} onChange={e=>setAnswers(a=>{const old=a[q.id]||[];return {...a,[q.id]:e.target.checked?[...old,o.label]:old.filter(x=>x!==o.label)}})}/>{o.label}</label>)
      : <select value={answers[q.id]||''} onChange={e=>setAnswers(a=>({...a,[q.id]:e.target.value}))}><option value="">Select an answer</option>{(q.options||[]).map(o=><option key={o.label} value={o.label}>{o.label}</option>)}</select>}
      <input placeholder="Or enter a custom answer" value={answers[q.id+':custom']||''} onChange={e=>setAnswers(a=>({...a,[q.id+':custom']:e.target.value}))}/>
    </div>) : f.method==='select' ? <select value={value} onChange={e=>setValue(e.target.value)}><option value="">Choose…</option>{(f.options||[]).map(o=><option key={o}>{o}</option>)}</select> : f.method==='input'||f.method==='editor' ? <textarea value={value} placeholder={f.placeholder||''} onChange={e=>setValue(e.target.value)}/> : null}
    <div className="m-acts"><button className="btn" onClick={cancel}>Cancel</button><button className="btn primary" onClick={submit}>{f.method==='confirm'?'Confirm':'Send'}</button></div>
  </div></Layer>;
}
