#!/usr/bin/env node
/**
 * S6a native fixture probe. Evidence is attached to PR #1351, not committed.
 * Usage: node scripts/browser-approvals-s6a-probe.mjs --out <dir> [--width 264] [--theme light]
 */
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withNotificationsOff } from "./notifications-off.mjs";
import { withTelemetryOff } from "./telemetry-off.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireFromRepo = createRequire(join(ROOT, "package.json"));
const { build } = requireFromRepo("esbuild");
const ELECTRON_BIN = requireFromRepo("electron");
const OUT = process.argv[process.argv.indexOf("--out") + 1];
const WIDTH = Number(process.argv[process.argv.indexOf("--width") + 1] || 900);
const THEME =
	process.argv[process.argv.indexOf("--theme") + 1] === "light"
		? "light"
		: "dark";
if (!OUT || OUT.startsWith("--")) throw new Error("--out required");
mkdirSync(OUT, { recursive: true });
const MAIN = join(OUT, "s6a-main.mjs");
const FIXTURE = join(OUT, "fixture.html");
const CARD = join(ROOT, "out/renderer/browser-approvals-overlay.html");
writeFileSync(
	FIXTURE,
	`<!doctype html><html><body style="margin:0;background:#204060;color:#fff;font:16px sans-serif"><div style="padding:16px"><h1>Fixture page</h1><p id="status">ready</p><button id="click" style="position:absolute;left:24px;top:24px">click</button></div><script>let clicks=0,keys=0,focusEvents=0,blurEvents=0;window.addEventListener("focus",()=>{focusEvents+=1});window.addEventListener("blur",()=>{blurEvents+=1});document.getElementById("click").onclick=()=>{clicks+=1;document.getElementById("status").textContent="clicks:"+clicks};document.addEventListener("keydown",()=>{keys+=1;document.getElementById("status").textContent="keys:"+keys});window.__probe=()=>({focusEvents,blurEvents,activeElement:document.activeElement?.tagName??null,status:document.getElementById("status").textContent})</script></body></html>`,
);
const entry = join(OUT, "s6a-entry.ts");
writeFileSync(
	entry,
	`
import { app, BrowserWindow, WebContentsView, desktopCapturer, webContents } from "electron";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { ApprovalsOverlayController } from ${JSON.stringify(join(ROOT, "src/main/browser/approvals-overlay.ts"))};
const out = ${JSON.stringify(OUT)};
const cardUrl = ${JSON.stringify(`file://${CARD}`)};
const fixture = ${JSON.stringify(`file://${FIXTURE}`)};
app.commandLine.appendSwitch("use-mock-keychain");
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: Math.max(900, ${WIDTH}), height: 720, backgroundColor: "#000000" });
  const controller = new ApprovalsOverlayController({ window: win, documentUrl: cardUrl, theme: ${JSON.stringify(THEME)} });
  const page = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.contentView.addChildView(page);
  const pageRect = { x: 0, y: 120, width: ${WIDTH}, height: 600 };
  page.setBounds(pageRect); page.setVisible(true);
  await page.webContents.loadURL(fixture);
  await new Promise((r) => setTimeout(r, 250));
  const beforeProbe = await page.webContents.executeJavaScript("window.__probe()");
  const before = { pageBounds: page.getBounds(), pageVisible: page.getVisible(), focused: webContents.getFocusedWebContents()?.id ?? null, pageProbe: beforeProbe };
  page.webContents.sendInputEvent({ type: "keyDown", keyCode: "a" });
  page.webContents.sendInputEvent({ type: "char", keyCode: "a" });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode: "a" });
  await new Promise((r) => setTimeout(r, 100));
  const typed = await page.webContents.executeJavaScript("document.getElementById('status').textContent");
  const currentCard = () => win.contentView.children[win.contentView.children.length - 1];
  // The document viewport is the CARD VIEW's width (the card plus its 16 DIP
  // ring), not the page content width the probe argument names.
  const cardViewWidth = (contentWidth) => Math.min(352, contentWidth - 16) + 16;
  /*
   * Poll rather than sleep: a show and a content-rect resize both rebuild the
   * child (Electron 44.3.0 leaves a replacement viewport at its load width), so
   * a fixed wait records whichever load happened to finish. Settle on the
   * controller's own ready/visible facts AND the document's viewport width.
   */
  const settle = async (expectedWidth, timeout = 20000) => {
    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeout) {
      const view = currentCard();
      const snapshot = controller.facts();
      if (view && snapshot.ready && snapshot.visible) {
        try {
          // A rebuild can close this view mid-evaluate; the pending promise then
          // never settles, so bound every read rather than hang the whole probe.
          const document = await Promise.race([
            view.webContents.executeJavaScript("(() => ({ href: location.href, innerWidth, innerHeight, natural: (() => { const el = document.getElementById('approvals-card'); if (!el) return null; const previous = el.style.maxHeight; el.style.maxHeight = 'none'; const height = el.getBoundingClientRect().height; el.style.maxHeight = previous; return height; })(), card: (() => { const r = document.getElementById('approvals-card')?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; })() }))()"),
            new Promise((_, reject) => setTimeout(() => reject(new Error("read-timeout")), 1000)),
          ]);
          last = { view: view.getBounds(), document, facts: snapshot };
          // Width alone is not settled: a show can have its final width while the
          // height measurement is still driving the second rebuild. Require the
          // controller's card height to equal the document's measured (unclamped)
          // height before calling it settled.
          const natural = Number(document.natural);
          const heightSettled = !Number.isFinite(natural) || snapshot.bounds?.card?.height === Math.ceil(natural);
          if (String(document.innerWidth) === String(expectedWidth) && heightSettled) {
            return { view: view.getBounds(), document, facts: snapshot, timeout: false };
          }
        } catch (error) {
          // A rebuild between the facts read and the evaluate is normal.
        }
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    return { view: last ? last.view : null, document: last ? last.document : null, facts: controller.facts(), timeout: true };
  };
  controller.onLayout({ presented: true, contentRect: pageRect, revision: 1 });
  controller.setModel({ entries: [{ entryId: "s6a-0", origin: "https://example.test", displayAuthority: "Agent", expiresAt: Date.now() + 600000 }, { entryId: "s6a-1", origin: "https://example.test", displayAuthority: "Agent", expiresAt: Date.now() + 600000 }] });
  const shown = await settle(cardViewWidth(${WIDTH}));
  const facts = shown.facts;
  page.webContents.sendInputEvent({ type: "keyDown", keyCode: "b" });
  page.webContents.sendInputEvent({ type: "char", keyCode: "b" });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode: "b" });
  await new Promise((r) => setTimeout(r, 100));
  const typedAfter = await page.webContents.executeJavaScript("document.getElementById('status').textContent");
  const afterProbe = await page.webContents.executeJavaScript("window.__probe()");
  const cardHref = await currentCard().webContents.executeJavaScript("location.href");
  const afterShow = { pageBounds: page.getBounds(), pageVisible: page.getVisible(), focused: webContents.getFocusedWebContents()?.id ?? null, typed, typedAfter, pageWebContentsId: page.webContents.id, pageProbe: afterProbe, cardHref, settledWidth: shown.document ? shown.document.innerWidth : null, settledNatural: shown.document ? shown.document.natural : null, settleTimeout: shown.timeout, pageFocused: page.webContents.isFocused(), cardFocused: currentCard().webContents.isFocused(), windowFocused: win.isFocused() };
  const resizedWidth = ${WIDTH} === 264 ? 900 : 264;
  const resizedRect = { ...pageRect, x: 0, width: resizedWidth };
  page.setBounds(resizedRect);
  controller.onLayout({ presented: true, contentRect: resizedRect, revision: 2 });
  const resized = await settle(cardViewWidth(resizedWidth));
  page.setBounds(pageRect);
  controller.onLayout({ presented: true, contentRect: pageRect, revision: 3 });
  const restored = await settle(cardViewWidth(${WIDTH}));
  controller.setModel({ entries: [] });
  await new Promise((r) => setTimeout(r, 100));
  const afterHide = { pageBounds: page.getBounds(), pageVisible: page.getVisible(), focused: webContents.getFocusedWebContents()?.id ?? null, pageFocused: page.webContents.isFocused(), cardVisible: controller.facts().visible };
  controller.setModel({ entries: [{ entryId: "s6a-0", origin: "https://example.test", displayAuthority: "Agent", expiresAt: Date.now() + 600000 }, { entryId: "s6a-1", origin: "https://example.test", displayAuthority: "Agent", expiresAt: Date.now() + 600000 }] });
  await new Promise((r) => setTimeout(r, 800));
  let frame = null;
  const sourceId = win.getMediaSourceId();
  try {
    const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: 900, height: 720 } });
    const source = sources.find((entry) => entry.id === sourceId) ?? null;
    if (source) { frame = source.thumbnail.toPNG(); writeFileSync(out + "/s6a-native-frame.png", frame); }
  } catch (error) { writeFileSync(out + "/s6a-capture-error.txt", String(error)); }
  if (!frame) {
    try {
      const id = sourceId.split(":")[1];
      execFileSync("screencapture", ["-x", "-o", "-l", id, out + "/s6a-native-frame.png"]);
      frame = readFileSync(out + "/s6a-native-frame.png");
    } catch (error) { writeFileSync(out + "/s6a-screencapture-error.txt", String(error)); }
  }
  try {
    const cardView = win.contentView.children[win.contentView.children.length - 1];
    /*
     * capturePage() needs a display surface; a hidden WebContentsView has none
     * ("Current display surface not available for capture" measured on 44.3.0).
     * Page.captureScreenshot over the child's own debugger renders the document
     * without a window, which is the frame this slice can honestly evidence.
     */
    let captured = false;
    try {
      const debuggerSession = cardView.webContents.debugger;
      if (!debuggerSession.isAttached()) debuggerSession.attach("1.3");
      const shot = await debuggerSession.sendCommand("Page.captureScreenshot", { format: "png" });
      writeFileSync(out + "/s6a-card-capture.png", Buffer.from(shot.data, "base64"));
      captured = true;
    } catch (error) { writeFileSync(out + "/s6a-cdp-capture-error.txt", String(error)); }
    if (!captured) {
      const png = await cardView.webContents.capturePage();
      writeFileSync(out + "/s6a-card-capture.png", png.toPNG());
    }
    writeFileSync(out + "/s6a-page-capture.png", (await page.webContents.capturePage()).toPNG());
  } catch (error) { writeFileSync(out + "/s6a-capturePage-error.txt", String(error)); }
  writeFileSync(out + "/s6a-facts.json", JSON.stringify({ before, afterShow, resized, restored, afterHide, facts, sourceId, frameBytes: frame ? frame.length : 0 }, null, 2));
  controller.dispose("probe"); win.close(); app.quit();
});
`,
);
await build({
	entryPoints: [entry],
	bundle: true,
	platform: "node",
	format: "esm",
	outfile: MAIN,
	external: ["electron"],
});
const env = withNotificationsOff({
	...process.env,
	HOME: join(OUT, "home"),
	LOCAL_OPERATOR_UI_BROWSER_APPROVALS_OVERLAY_S6A: "1",
});
for (const key of Object.keys(env))
	if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
withTelemetryOff(env);
const child = spawn(ELECTRON_BIN, [MAIN], {
	env,
	stdio: ["ignore", "pipe", "pipe"],
});
let err = "";
child.stderr.on("data", (c) => {
	err += c;
});
const code = await new Promise((resolveExit) => {
	const kill = setTimeout(() => {
		child.kill("SIGTERM");
		resolveExit("timeout");
	}, 120000);
	child.on("exit", (exitCode) => {
		clearTimeout(kill);
		resolveExit(exitCode);
	});
});
if (code !== 0) {
	writeFileSync(join(OUT, "s6a-app-stderr.txt"), err);
	console.error("electron", code, err.slice(-2000));
	process.exit(1);
}
console.log(readFileSync(join(OUT, "s6a-facts.json"), "utf8"));
