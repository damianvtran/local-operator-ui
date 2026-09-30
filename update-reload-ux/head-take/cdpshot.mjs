// Head take of one story: private headless Chrome over raw CDP, reaped by process group.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [story, theme, out] = process.argv.slice(2);
const ud = mkdtempSync(join(tmpdir(), "chr696-"));
const ch = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new","--use-mock-keychain",`--user-data-dir=${ud}`,"--remote-debugging-port=9333","--window-size=1280,800","--hide-scrollbars","about:blank"],{detached:true,stdio:"ignore"});
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
try {
  let tgt; for (let i=0;i<40;i++){ try{ tgt=(await (await fetch("http://127.0.0.1:9333/json")).json()).find(t=>t.type==="page"); if(tgt)break;}catch{} await sleep(250);}
  const ws=new WebSocket(tgt.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
  let id=0; const pend=new Map(); ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
  const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
  await send("Emulation.setDeviceMetricsOverride",{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await send("Page.navigate",{url:`http://localhost:6118/iframe.html?id=${story}&viewMode=story&args=theme:${theme}`});
  await sleep(4000);
  const r=await send("Page.captureScreenshot",{format:"png"});
  writeFileSync(out,Buffer.from(r.result.data,"base64"));
  ws.close();
} finally { try{process.kill(-ch.pid,"SIGKILL")}catch{} await sleep(500); rmSync(ud,{recursive:true,force:true}); }
