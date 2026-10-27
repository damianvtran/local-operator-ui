/**
 * Round-1 remediation evidence for #1452, against the real isolated #3042 daemon.
 * Run from the UI worktree; ONE launch -> capture -> reap process. OS hand-off is
 * replaced in MAIN and clipboard writes are recorded only in the scratch page.
 */
import { readFileSync, writeFileSync, mkdirSync, symlinkSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
const { QA_BACKEND, QA_RECORDS, QA_FRAMES, QA_SEED } = process.env;
process.env.LOCAL_OPERATOR_DESKTOP_TOKEN = readFileSync(process.env.QA_TOKEN_FILE, "utf8").trim();
for (const k of Object.keys(process.env)) if (k.startsWith("CMUX_") || k.startsWith("LOP_")) delete process.env[k];
process.argv.push("--backend", QA_BACKEND, "--out", QA_FRAMES);
mkdirSync(QA_FRAMES, { recursive: true });
const seed = JSON.parse(readFileSync(QA_SEED, "utf8"));
const { rendererDriverApi } = await import(join(process.cwd(), "scripts/renderer-driver.mjs"));
const { CdpClient, launchApp, prepareDriverContext, waitForDevtools, waitForPage, waitForBridge, verb, capture, reapLiveBoots } = rendererDriverApi;
const ctx = prepareDriverContext({ apiUrl: QA_BACKEND });
const runServe = join(ctx.config, "run", "serve");
mkdirSync(runServe, { recursive: true });
for (const e of readdirSync(QA_RECORDS)) if (e.endsWith(".json") && !existsSync(join(runServe, e))) symlinkSync(join(QA_RECORDS, e), join(runServe, e));
const observations = { tree: process.cwd(), checks: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cdp, main, handle;
const ev = (expr) => cdp.evaluate(expr);
const waitFor = async (expr, ms = 15000) => { const start = Date.now(); for (;;) { const value = await ev(expr).catch(() => null); if (value) return value; if (Date.now() - start > ms) throw new Error(`wait timed out: ${expr}`); await sleep(150); } };
const shot = async (label) => { const file = await capture(cdp, label, { assertPalette: false }); console.log(`[frame] ${label}: ${JSON.stringify(file)}`); };
const rec = (key, value) => { observations.checks.push({ key, value }); console.log(`[obs] ${key}: ${JSON.stringify(value)}`); };
const qaMain = (expr) => main.evaluate(`(() => ${expr})()`);
async function stubMain() {
 return main.evaluate(`(() => {
  const r = process.mainModule?.require ?? globalThis.require;
  const { ipcMain } = r("electron");
  globalThis.__qa = { opened: [], revealed: [], mode: "pass", held: [] };
  for (const ch of ["open-file", "show-item-in-folder"]) {
   ipcMain.removeHandler(ch);
   ipcMain.handle(ch, async (_e, p) => { (ch === "open-file" ? __qa.opened : __qa.revealed).push(p); return { ok: true, resolved: p }; });
  }
  const original = ipcMain._invokeHandlers?.get("desktop-request");
  if (!original) return { stubbed: true, wrap: false };
  ipcMain.removeHandler("desktop-request");
  ipcMain.handle("desktop-request", async (event, input) => {
   if (input && input.op && String(input.op).startsWith("sessions.userAttachments")) __qa.uaCalls = (__qa.uaCalls || 0) + 1;
   if (input && input.op === "sessions.userAttachments") {
    if (__qa.mode === "error") return { status: 503, body: { detail: "synthetic inventory failure" } };
    if (__qa.mode === "hold") await new Promise((res) => __qa.held.push(res));
   }
   return original(event, input);
  });
  return { stubbed: true, wrap: true };
 })()`);
}
async function openSession(id) {
 await waitFor(`Boolean(document.querySelector('[data-session-row="${id}"]'))`, 30000);
 await verb(cdp, "press", { selector: `[data-session-row="${id}"] [data-chat-row]` });
 await waitFor(`document.querySelectorAll("[data-record-id]").length > 0`, 30000);
 await sleep(600);
}
async function openFiles() {
 if (!(await ev(`Boolean(document.querySelector('[data-tour-tag="canvas-files-view-button"]'))`))) await verb(cdp, "press", { selector: '[data-panel-rail-item="canvas"]' });
 await waitFor(`Boolean(document.querySelector('[data-tour-tag="canvas-files-view-button"]'))`);
 if ((await ev(`document.querySelector('[data-tour-tag="canvas-files-view-button"]').getAttribute("aria-pressed")`)) !== "true") await verb(cdp, "press", { selector: '[data-tour-tag="canvas-files-view-button"]' });
 await sleep(650);
}
const textState = () => ev(`(() => ({
 headers: [...document.querySelectorAll('[data-tour-tag="files-scroller"] h3')].map(e => e.textContent.replace(/\\s+/g,' ').trim()),
 body: document.querySelector('[data-tour-tag="files-scroller"]')?.textContent.replace(/\\s+/g,' ').trim().slice(0,1200),
 tiles: [...document.querySelectorAll('[data-tour-tag="file-row"][data-file-id^="attachment:"]')].filter(e => e.querySelector('img') || e.dataset.fileId.includes('kind')).map(e => {
   const button=e.querySelector(':scope > button');
   const spans=button ? [...button.querySelectorAll(':scope > span')].map(s => ({ text:s.textContent, rect:s.getBoundingClientRect().toJSON(), scrollWidth:s.scrollWidth, clientWidth:s.clientWidth })) : [];
   return { id:e.dataset.fileId, rect:e.getBoundingClientRect().toJSON(), spans };
 })
}))()`);
const key = async (key, code, vk, text) => { await cdp.send("Input.dispatchKeyEvent", { type:"keyDown", key, code, windowsVirtualKeyCode:vk, ...(text?{text,unmodifiedText:text}:{}) }); await cdp.send("Input.dispatchKeyEvent", { type:"keyUp", key, code, windowsVirtualKeyCode:vk }); await sleep(350); };
const hover = async (selector) => { const box=await ev(`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+Math.min(r.height/2,12)}})()`); if(!box)throw new Error(`no hover target ${selector}`); await cdp.send("Input.dispatchMouseEvent", {type:"mouseMoved",x:box.x,y:box.y}); await sleep(250); };
try {
 handle = await launchApp({ armed: true, tag: "rem-1452-r1" });
 await waitForDevtools(handle);
 cdp = await CdpClient.attach(handle.port, "out/renderer/index.html");
 await waitForPage(cdp); await waitForBridge(cdp);
 await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: 'try { localStorage.setItem("onboarding-storage", JSON.stringify({ state: { isModalComplete: true, isTourComplete: true, currentStep: "create_agent" }, version: 0 })); } catch (e) {}' });
 await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: 'window.__qaClip=[];try{navigator.clipboard.writeText=async(t)=>{window.__qaClip.push(String(t))}}catch(e){}' });
 await cdp.send("Page.reload", { ignoreCache:false }); await sleep(1400); await waitForPage(cdp); await waitForBridge(cdp);
 await cdp.send("Emulation.setFocusEmulationEnabled", { enabled:true }).catch(()=>{});
 main = await CdpClient.attachNode(handle.inspectPort);
 rec("mainStub", await stubMain());
 await verb(cdp,"navigate","/chat");
 // Populated kind-carrying image, de-duplicated footer, two-line tile metadata.
 await openSession(seed.s4.id); await openFiles();
 await waitFor(`document.querySelector('[data-tour-tag="files-scroller"]')?.textContent.includes('pasted-kind.png')`);
 rec("populated", await textState()); await shot("r1-after-populated-dark");
 // Enter on a picture now reaches the same lightbox as its Expand control.
 const tileId=await ev(`document.querySelector('[data-tour-tag="file-row"][data-file-id^="attachment:"]')?.dataset.fileId`);
 await ev(`(() => {const e=[...document.querySelectorAll('[data-tour-tag="file-row"][data-file-id^="attachment:"]')].find(e=>e.querySelector('img'));if(!e)return false;e.querySelector(':scope > button').focus();return true})()`);
 await key("Enter","Enter",13,"\r"); await sleep(600);
 rec("enter-gallery", { dialog:await ev(`Boolean(document.querySelector('[role="dialog"]'))`), documents:await ev(`document.querySelector('[data-tour-tag="canvas-documents-view-button"]')?.getAttribute('aria-pressed')`) });
 await key("Escape","Escape",27);
 // Explicit light theme through the app's own theme selection; no Storybook substitution.
 await verb(cdp,"setTheme",{themeName:"localOperatorLight"}).catch(async()=>verb(cdp,"set-theme",{themeName:"localOperatorLight"})).catch(()=>null);
 rec("theme-before-light",await ev(`({theme:document.documentElement.dataset.theme,dark:document.documentElement.classList.contains('dark'),store:window.localStorage.getItem('ui-preferences')})`));
 await openFiles(); await shot("r1-after-populated-light");
 await verb(cdp,"setTheme",{themeName:"localOperatorDark"}).catch(()=>null);
 // Retained and both-gone copy; copy-path resolution uses the materialised name.
 await openSession(seed.s2.id); await openFiles(); await sleep(500);
 rec("retained", await textState()); await shot("r1-after-missing-retained");
 await openSession(seed.s3.id); await openFiles(); await sleep(400);
 rec("both-gone", await textState()); await shot("r1-after-missing-gone");
 // Older backend fallback wording stays distinct from a capable backend failure.
 await qaMain(`(__qa.mode='hold',true)`); await openSession(seed.s6.id); await openFiles(); await sleep(500);
 rec("loading",await textState()); await shot("r1-loading");
 await qaMain(`(__qa.held.splice(0).forEach(r=>r()),__qa.mode='error',true)`); await openSession(seed.s2.id); await openFiles();
 await waitFor(`document.querySelector('[data-tour-tag="files-scroller"]')?.textContent.includes("Couldn't load attachments")`);
 rec("error",await textState()); await shot("r1-error");
 await qaMain(`(__qa.mode='pass',true)`);
 const retry=await ev(`(() => {const e=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Retry')&&b.textContent.includes('attachments'));if(!e)return false;e.click();return true})()`);
 rec("retry",{pressed:retry,calls:await qaMain(`__qa.uaCalls`)});
} catch(error) {
 observations.error=String(error?.stack??error); console.log(`[error] ${observations.error}`);
 try { await shot("r1-rig-error"); } catch {}
} finally {
 writeFileSync(join(QA_FRAMES,"observations.json"),JSON.stringify(observations,null,2));
 try { cdp?.close(); main?.close(); } catch {}
 await reapLiveBoots({code:0,why:"remediation evidence done"});
}
