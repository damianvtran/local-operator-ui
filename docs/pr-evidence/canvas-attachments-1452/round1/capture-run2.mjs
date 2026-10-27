/**
 * Round-1 remediation evidence, run 2: the count line and the failed-read state.
 * Same isolation as run 1: ONE launch -> capture -> reap, isolated daemon, OS
 * hand-off replaced in MAIN, clipboard recorded only in the scratch page.
 *
 * The error leg opens a session this run has NOT opened: the hook keeps the last
 * listing for a session, so re-opening a warm one never issues the read the
 * failure is injected into (learned from run 1, which waited for a banner that
 * could not appear).
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
const counts = () => ev(`(() => { const t=(s)=>{const e=document.querySelector(s);return e?e.textContent.replace(/\\s+/g,' ').trim():null}; return { segment:t('[data-tour-tag="canvas-files-view-button"]'), railAria:document.querySelector('[data-panel-rail-item="canvas"]')?.getAttribute('aria-label')??null, head:t('[data-tour-tag="files-scanner-head"]'), headers:[...document.querySelectorAll('[data-tour-tag="files-scroller"] h3')].map(h=>h.textContent.replace(/\\s+/g,' ').trim()), body:document.querySelector('[data-tour-tag="files-scroller"]')?.textContent.replace(/\\s+/g,' ').trim().slice(0,600) } })()`);
async function stubMain() {
 return main.evaluate(`(() => {
  const r = process.mainModule?.require ?? globalThis.require;
  const { ipcMain } = r("electron");
  globalThis.__qa = { mode: "pass", held: [] };
  const original = ipcMain._invokeHandlers?.get("desktop-request");
  if (!original) return { stubbed: true, wrap: false };
  ipcMain.removeHandler("desktop-request");
  ipcMain.handle("desktop-request", async (event, input) => {
   if (input && input.op === "sessions.userAttachments") {
    __qa.uaCalls = (__qa.uaCalls || 0) + 1;
    if (__qa.mode === "error") return { status: 503, body: { detail: "rig: inventory unavailable" } };
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
 await sleep(700);
}
async function openFiles() {
 if (!(await ev(`Boolean(document.querySelector('[data-tour-tag="canvas-files-view-button"]'))`))) await verb(cdp, "press", { selector: '[data-panel-rail-item="canvas"]' });
 await waitFor(`Boolean(document.querySelector('[data-tour-tag="canvas-files-view-button"]'))`);
 if ((await ev(`document.querySelector('[data-tour-tag="canvas-files-view-button"]').getAttribute("aria-pressed")`)) !== "true") await verb(cdp, "press", { selector: '[data-tour-tag="canvas-files-view-button"]' });
 await sleep(700);
}
try {
 handle = await launchApp({ armed: true, tag: "rem-1452-r1b" });
 await waitForDevtools(handle);
 cdp = await CdpClient.attach(handle.port, "out/renderer/index.html");
 await waitForPage(cdp); await waitForBridge(cdp);
 await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: 'try { localStorage.setItem("onboarding-storage", JSON.stringify({ state: { isModalComplete: true, isTourComplete: true, currentStep: "create_agent" }, version: 0 })); } catch (e) {}' });
 await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: 'window.__qaClip=[];try{navigator.clipboard.writeText=async(t)=>{window.__qaClip.push(String(t))}}catch(e){}' });
 await cdp.send("Page.reload", { ignoreCache: false }); await sleep(1400); await waitForPage(cdp); await waitForBridge(cdp);
 main = await CdpClient.attachNode(handle.inspectPort);
 rec("mainStub", await stubMain());
 await verb(cdp, "navigate", "/chat");
 // The count line, the segment and the rail must agree on the de-duplicated total.
 await openSession(seed.s4.id); await openFiles();
 await waitFor(`document.querySelector('[data-tour-tag="files-scroller"]')?.textContent.includes('pasted-kind.png')`);
 rec("counts-populated", await counts());
 await shot("r1b-counts-populated");
 // A capable backend that fails the read: its own wording and a retry, not the
 // older-backend "May be incomplete" fallback alone.
 await qaMain(`(__qa.mode='error',true)`);
 await openSession(seed.s1.id); await openFiles();
 await waitFor(`document.querySelector('[data-tour-tag="files-scroller"]')?.textContent.includes("Couldn't load attachments") || document.body.textContent.includes("Couldn't load attachments")`);
 rec("error-state", await counts());
 await shot("r1b-error");
 await qaMain(`(__qa.mode='pass',true)`);
 const pressed = await ev(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Retry'); if(!b) return false; b.setAttribute('data-rig','retry'); return true })()`);
 if (pressed) await verb(cdp, "press", { selector: '[data-rig="retry"]' });
 await sleep(1600);
 rec("error-retry", { pressed, after: await counts(), calls: await qaMain(`__qa.uaCalls`) });
 await shot("r1b-error-retried");
} catch (error) {
 observations.error = String(error?.stack ?? error); console.log(`[error] ${observations.error}`);
 try { await shot("r1b-rig-error"); } catch {}
} finally {
 writeFileSync(join(QA_FRAMES, "observations-run2.json"), JSON.stringify(observations, null, 2));
 try { cdp?.close(); main?.close(); } catch {}
 await reapLiveBoots({ code: 0, why: "remediation evidence run 2 done" });
}
