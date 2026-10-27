/**
 * Round-1 remediation evidence, run 3: a REAL light-theme frame (design D2).
 *
 * Run 1's "light" capture was still dark: the `setTheme` verb takes the palette
 * name as a bare string argument, and the object payload I passed made it throw
 * inside a `catch` that hid it. This run drives the same app action, then
 * ASSERTS the document's own `data-theme` before the shutter, so a dark frame
 * cannot be filed under a light name again.
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
const palette = () => ev(`(() => ({ dataTheme: document.documentElement.getAttribute("data-theme"), dark: document.documentElement.classList.contains("dark"), panel: getComputedStyle(document.querySelector('[data-tour-tag="files-scroller"]')||document.body).backgroundColor }))()`);
try {
 handle = await launchApp({ armed: true, tag: "rem-1452-r1c" });
 await waitForDevtools(handle);
 cdp = await CdpClient.attach(handle.port, "out/renderer/index.html");
 await waitForPage(cdp); await waitForBridge(cdp);
 await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: 'try { localStorage.setItem("onboarding-storage", JSON.stringify({ state: { isModalComplete: true, isTourComplete: true, currentStep: "create_agent" }, version: 0 })); } catch (e) {}' });
 await cdp.send("Page.reload", { ignoreCache: false }); await sleep(1400); await waitForPage(cdp); await waitForBridge(cdp);
 await verb(cdp, "navigate", "/chat");
 await openSession(seed.s4.id); await openFiles();
 await waitFor(`document.querySelector('[data-tour-tag="files-scroller"]')?.textContent.includes('pasted-kind.png')`);
 const applied = await verb(cdp, "setTheme", "localOperatorLight");
 rec("setTheme-verb", applied);
 rec("palette-light", await palette());
 const light = await ev(`document.documentElement.getAttribute("data-theme") === "localOperatorLight"`);
 if (!light) throw new Error(`refusing to file a light frame: data-theme is ${JSON.stringify(await palette())}`);
 await openFiles();
 await shot("r1c-after-populated-light");
 rec("palette-at-shutter", await palette());
} catch (error) {
 observations.error = String(error?.stack ?? error); console.log(`[error] ${observations.error}`);
 try { await shot("r1c-rig-error"); } catch {}
} finally {
 writeFileSync(join(QA_FRAMES, "observations-run3.json"), JSON.stringify(observations, null, 2));
 try { cdp?.close(); main?.close(); } catch {}
 await reapLiveBoots({ code: 0, why: "remediation evidence run 3 done" });
}
