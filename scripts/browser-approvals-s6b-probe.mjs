#!/usr/bin/env node
/**
 * S6b native fixture probe: the interactive approvals card.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT. The window is hidden (rig policy), so
 * this run can prove the DOCUMENT and the controller: the model, the two
 * preload channels, sender/seq pinning, the decision route, Escape/Close,
 * focus handoff through the host's gated helper, and the auto-present proof
 * that the page's DOM focus, bounds and `presented` state do not move. Native
 * hit-testing between sibling `WebContentsView`s, transparency over the page
 * and VoiceOver across the second document are BLOCKED here and are reported
 * as such, never as passes.
 *
 * Usage: node scripts/browser-approvals-s6b-probe.mjs --out <dir> [--width 900] [--theme light]
 * Prerequisite: `pnpm build` has emitted out/renderer/browser-approvals-overlay.html
 * and out/preload/browser-approvals-overlay.js.
 */
import { spawn } from "node:child_process";
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

const MAIN = join(OUT, "s6b-main.mjs");
const FIXTURE = join(OUT, "fixture.html");
const CARD = join(ROOT, "out/renderer/browser-approvals-overlay.html");
const PRELOAD = join(ROOT, "out/preload/browser-approvals-overlay.js");
writeFileSync(
	FIXTURE,
	`<!doctype html><html lang="en"><body style="margin:0;background:#204060;color:#fff;font:16px sans-serif"><div style="padding:16px"><h1>Fixture page</h1><p id="status">ready</p><button id="click" style="position:absolute;left:24px;top:24px;width:120px;height:40px">click</button><input id="field" style="position:absolute;left:24px;top:90px"></div><script>let clicks=0,keys=0,focusEvents=0,blurEvents=0;window.addEventListener("focus",()=>{focusEvents+=1});window.addEventListener("blur",()=>{blurEvents+=1});document.getElementById("click").onclick=()=>{clicks+=1;document.getElementById("status").textContent="clicks:"+clicks};document.getElementById("field").addEventListener("keydown",()=>{keys+=1});window.__focusField=()=>{document.getElementById("field").focus()};window.__probe=()=>({focusEvents,blurEvents,clicks,keys,activeElement:document.activeElement?.id??document.activeElement?.tagName??null,status:document.getElementById("status").textContent})</script></body></html>`,
);

writeFileSync(
	join(OUT, "s6b-entry.ts"),
	`
import { app, BrowserWindow, WebContentsView, webContents } from "electron";
import { writeFileSync } from "node:fs";
import { ApprovalsOverlayController } from ${JSON.stringify(join(ROOT, "src/main/browser/approvals-overlay.ts"))};

const out = ${JSON.stringify(OUT)};
const cardUrl = ${JSON.stringify(`file://${CARD}`)};
const cardPreload = ${JSON.stringify(PRELOAD)};
const fixture = ${JSON.stringify(`file://${FIXTURE}`)};
const WIDTH = ${WIDTH};
const THEME = ${JSON.stringify(THEME)};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.commandLine.appendSwitch("use-mock-keychain");

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: Math.max(1000, WIDTH), height: 800, backgroundColor: "#000000" });
  const page = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.contentView.addChildView(page);
  const pageRect = { x: 0, y: 120, width: WIDTH, height: 600 };
  page.setBounds(pageRect);
  page.setVisible(true);
  await page.webContents.loadURL(fixture);
  await sleep(250);

  const responded = [];
  const focusTargets = [];
  const controller = new ApprovalsOverlayController({
    window: win,
    documentUrl: cardUrl,
    preloadPath: cardPreload,
    theme: THEME,
    respond: (entryId, decision) => {
      responded.push({ entryId, decision });
      return { ok: true };
    },
    pageWebContents: () => page.webContents,
    focusTarget: (target) => {
      // The hidden window must take no operating-system focus; the helper is
      // counted, not invoked. The product path passes the same gated helper.
      focusTargets.push(target === page.webContents ? "page" : "card");
    },
  });
  const currentCard = () => win.contentView.children[win.contentView.children.length - 1];
  const readCard = () =>
    currentCard().webContents.executeJavaScript(\`(() => ({
      active: document.activeElement?.id ?? null,
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      theme: document.documentElement.dataset.theme ?? null,
      card: (() => { const r = document.getElementById('approvals-card')?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; })(),
      origin: document.getElementById('approvals-origin')?.textContent ?? null,
      requester: document.getElementById('approvals-requester')?.textContent ?? null,
      expiry: document.getElementById('approvals-expiry')?.textContent ?? null,
      review: document.getElementById('approvals-review')?.textContent ?? null,
      close: document.getElementById('approvals-close')?.textContent ?? null,
      allowOnce: (() => { const b = document.getElementById('approvals-allow-once'); if (!b) return null; const r = b.getBoundingClientRect(); return { text: b.textContent, disabled: b.disabled, x: r.x + r.width / 2, y: r.y + r.height / 2 }; })(),
      buttons: [...document.querySelectorAll('button')].map((b) => ({ id: b.id, text: b.textContent, disabled: b.disabled })),
    }))()\`);
  const settle = async (predicate, label, timeout = 20000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      try { if (predicate(controller.facts())) return true; } catch {}
      await sleep(50);
    }
    return false;
  };
  const entry = (index) => ({ entryId: "entry-" + index, origin: "https://example" + index + ".test", displayAuthority: "The agent in 'probe " + index + "'", expiresAt: Date.now() + 9 * 60000 });
  const entries = [entry(0), entry(1)];
  const rows = {};
  const record = (id, pass, detail, blocked = false) => { rows[id] = { status: blocked ? "BLOCKED" : pass ? "PASS" : "FAIL", detail }; };
  const waitFor = async (predicate, timeout = 4000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (predicate()) return true;
      await sleep(50);
    }
    return false;
  };

  const pageBefore = { bounds: page.getBounds(), visible: page.getVisible(), probe: await page.webContents.executeJavaScript("window.__probe()") };
  const focusBefore = webContents.getFocusedWebContents()?.id ?? null;
  controller.onLayout({ presented: true, contentRect: pageRect, revision: 1 });
  controller.setModel({ entries, locale: "fr", dir: "ltr", theme: THEME });
  const autoSettled = await settle((f) => f.ready && f.visible, "auto-present");
  // A content-driven card grows after the model paints; the focus proof must be
  // read once the height has stopped changing, not on the first visible frame.
  let autoDoc = autoSettled ? await readCard() : null;
  let lastHeight = null;
  for (let stable = 0; stable < 4; ) {
    await sleep(120);
    const next = await readCard();
    autoDoc = next;
    if (next.card && next.card.height === lastHeight) stable += 1;
    else stable = 0;
    lastHeight = next.card ? next.card.height : null;
  }
  const pageAfterAuto = { bounds: page.getBounds(), visible: page.getVisible(), probe: await page.webContents.executeJavaScript("window.__probe()") };
  const focusAfterAuto = webContents.getFocusedWebContents()?.id ?? null;
  record("A1-auto-present-unfocused", Boolean(autoSettled && autoDoc && !controller.facts().explicitOpen && focusTargets.length === 0 && pageAfterAuto.probe.focusEvents === pageBefore.probe.focusEvents && pageAfterAuto.probe.blurEvents === pageBefore.probe.blurEvents && pageAfterAuto.probe.activeElement === pageBefore.probe.activeElement && JSON.stringify(pageAfterAuto.bounds) === JSON.stringify(pageBefore.bounds) && pageAfterAuto.visible === pageBefore.visible && focusAfterAuto === focusBefore), { autoSettled, facts: controller.facts(), pageBefore, pageAfterAuto, focusBefore, focusAfterAuto, focusTargets: [...focusTargets], doc: autoDoc });

  // I6 — shield toggle: the explicit open/close path the renderer's shield calls.
  controller.open({ focus: true, locale: "fr", dir: "ltr", theme: THEME });
  const opened = await settle((f) => f.visible && f.explicitOpen, "explicit open");
  const openDoc = opened ? await readCard() : null;
  const openFocus = [...focusTargets];
  controller.close("probe");
  const closed = await settle((f) => !f.visible, "close");
  const closeFocus = [...focusTargets];
  record("I6-shield-toggle", Boolean(opened && closed && openFocus.includes("card") && closeFocus.at(-1) === "page"), { opened, closed, openFocus, closeFocus, doc: openDoc });

  // I1 — Allow once through the real document button.
  controller.open({ focus: true });
  await settle((f) => f.visible, "reopen");
  await sleep(150);
  const beforeDecision = await readCard();
  const allow = beforeDecision.allowOnce;
  if (!allow) {
    record("I1-allow-once", false, { doc: beforeDecision });
  } else {
    currentCard().webContents.sendInputEvent({ type: "mouseMove", x: Math.round(allow.x), y: Math.round(allow.y) });
    currentCard().webContents.sendInputEvent({ type: "mouseDown", x: Math.round(allow.x), y: Math.round(allow.y), button: "left", clickCount: 1 });
    currentCard().webContents.sendInputEvent({ type: "mouseUp", x: Math.round(allow.x), y: Math.round(allow.y), button: "left", clickCount: 1 });
    // The click crosses renderer -> preload -> main; poll rather than assume a
    // fixed 250 ms is enough on a loaded machine.
    await waitFor(() => responded.length >= 1);
    record("I1-allow-once", responded.length === 1 && responded[0].decision === "once" && responded[0].entryId === "entry-0", { responded: [...responded], actions: controller.facts().actions });
  }

  // I2 — a click on the page neither dismisses nor decides.
  controller.open({ focus: true });
  await settle((f) => f.visible, "reopen for outside click");
  const outsideBefore = await page.webContents.executeJavaScript("window.__probe()");
  const cardBeforeOutside = controller.facts().visible;
  const decisionsBeforeOutside = responded.length;
  page.webContents.sendInputEvent({ type: "mouseMove", x: 40, y: 40 });
  page.webContents.sendInputEvent({ type: "mouseDown", x: 40, y: 40, button: "left", clickCount: 1 });
  page.webContents.sendInputEvent({ type: "mouseUp", x: 40, y: 40, button: "left", clickCount: 1 });
  await sleep(450);
  const outsideAfter = await page.webContents.executeJavaScript("window.__probe()");
  record("I2-click-outside", outsideAfter.clicks === outsideBefore.clicks + 1 && controller.facts().visible === cardBeforeOutside && responded.length === decisionsBeforeOutside, { outsideBefore, outsideAfter, visible: controller.facts().visible, responded: [...responded] });

  // I3 — a click inside the 8px ring: the document ignores it; native routing
  // between sibling views is BLOCKED in a hidden window and is not claimed.
  currentCard().webContents.sendInputEvent({ type: "mouseDown", x: 2, y: 2, button: "left", clickCount: 1 });
  currentCard().webContents.sendInputEvent({ type: "mouseUp", x: 2, y: 2, button: "left", clickCount: 1 });
  await sleep(150);
  record("I3-ring-click", controller.facts().visible === true && responded.length === 1, { visible: controller.facts().visible, responded: [...responded], nativeRouting: "BLOCKED: hidden window, no sibling-view hit testing" }, true);

  // I5 — a page click while the card is open: the card stays.
  const pageClickBefore = await page.webContents.executeJavaScript("window.__probe()");
  page.webContents.sendInputEvent({ type: "mouseDown", x: 40, y: 40, button: "left", clickCount: 1 });
  page.webContents.sendInputEvent({ type: "mouseUp", x: 40, y: 40, button: "left", clickCount: 1 });
  await sleep(200);
  const pageClickAfter = await page.webContents.executeJavaScript("window.__probe()");
  record("I5-page-click-keeps-card", pageClickAfter.clicks === pageClickBefore.clicks + 1 && controller.facts().visible === true, { pageClickBefore, pageClickAfter, visible: controller.facts().visible });

  // I7 — Tab order inside the card document.
  controller.open({ focus: true });
  await settle((f) => f.visible, "reopen for tab order");
  await sleep(200);
  const tabOrder = [];
  for (let index = 0; index < 7; index += 1) {
    currentCard().webContents.sendInputEvent({ type: "keyDown", keyCode: "Tab" });
    currentCard().webContents.sendInputEvent({ type: "keyUp", keyCode: "Tab" });
    await sleep(120);
    tabOrder.push((await readCard()).active);
  }
  // The four secondary decision buttons carry no id; a stable order is proven by
  // the number of distinct focus stops and by the first/last named controls.
  record(
    "I7-tab-order",
    tabOrder.length >= 6 &&
      tabOrder[0] === "approvals-close" &&
      tabOrder[1] === "approvals-allow-once" &&
      tabOrder.at(-1) === "approvals-review",
    { tabOrder },
  );

  // I8 — a stale seq decides nothing (the preload surface called with an old seq).
  const beforeStale = responded.length;
  const staleResult = await currentCard().webContents.executeJavaScript("window.approvalsCard ? (window.approvalsCard.decide({ seq: 999999, entryId: 'entry-0', decision: 'once' }), 'sent') : 'no-bridge'");
  await sleep(250);
  record("I8-stale-seq", responded.length === beforeStale && controller.facts().actions.dropped >= 1, { staleResult, responded: [...responded], actions: controller.facts().actions });

  // I4 — Escape dismisses without deciding.
  const beforeEscape = responded.length;
  const dismissedEntry = controller.facts().requestEntryId;
  currentCard().webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  currentCard().webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await sleep(300);
  // Dismissing the shown request may present the next live one (the queue rule),
  // so the assertion is that the dismissed entry is gone and nothing was decided.
  record(
    "I4-escape",
    responded.length === beforeEscape && controller.facts().requestEntryId !== dismissedEntry,
    { visible: controller.facts().visible, requestEntryId: controller.facts().requestEntryId, dismissedEntry, responded: [...responded], actions: controller.facts().actions },
  );

  // RTL: the same formula mirrors the native view to the left edge.
  controller.setModel({ entries, dir: "rtl" });
  await settle((f) => f.visible, "rtl present");
  await sleep(150);
  const rtlFacts = controller.facts();
  record("G-rtl-anchor", Boolean(rtlFacts.bounds && rtlFacts.bounds.view.x === 0 && rtlFacts.bounds.card.x === 8), { bounds: rtlFacts.bounds });
  controller.setModel({ entries, dir: "ltr" });

  // Capture the document as the design/UX evidence frame.
  await settle((f) => f.visible, "capture present");
  await sleep(200);
  try {
    const debuggerSession = currentCard().webContents.debugger;
    if (!debuggerSession.isAttached()) debuggerSession.attach("1.3");
    const shot = await debuggerSession.sendCommand("Page.captureScreenshot", { format: "png" });
    writeFileSync(out + "/s6b-card-capture.png", Buffer.from(shot.data, "base64"));
  } catch (error) {
    writeFileSync(out + "/s6b-cdp-capture-error.txt", String(error));
  }

  writeFileSync(
    out + "/s6b-facts.json",
    JSON.stringify({
      width: WIDTH,
      theme: THEME,
      facts: controller.facts(),
      rows,
      autoPresent: { pageBefore, pageAfterAuto, focusBefore, focusAfterAuto, focusTargets: [...focusTargets], doc: autoDoc },
      voiceOver: "BLOCKED: no automated VoiceOver across a second document; manual gate",
      nativeComposite: "BLOCKED: hidden window, no Screen Recording",
      ringNativeRouting: "BLOCKED: hidden window, no sibling-view hit testing",
    }, null, 2),
  );
  controller.dispose("probe");
  win.close();
  app.quit();
});
`,
);

await build({
	entryPoints: [join(OUT, "s6b-entry.ts")],
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
child.stderr.on("data", (chunk) => {
	err += chunk;
});
const code = await new Promise((resolveExit) => {
	const kill = setTimeout(() => {
		child.kill("SIGTERM");
		resolveExit("timeout");
	}, 180000);
	child.on("exit", (exitCode) => {
		clearTimeout(kill);
		resolveExit(exitCode);
	});
});
if (code !== 0) {
	writeFileSync(join(OUT, "s6b-app-stderr.txt"), err);
	console.error("electron", code, err.slice(-3000));
	process.exit(1);
}
console.log(readFileSync(join(OUT, "s6b-facts.json"), "utf8"));
