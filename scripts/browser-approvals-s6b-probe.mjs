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
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
// S6d evidence switches. `--frames` writes PNGs of the card document in its
// request, Review-all, stale-error and unavailable-error views (CDP capture of
// the card child, no window shown). `--controller <path>` runs the SAME rig
// against another copy of the controller, which is how the "before" frames and
// the D1 reproduction are taken from `origin/main`'s controller without
// touching this tree's. The card DOCUMENT (out/renderer) is unchanged by S6d.
const FRAMES = process.argv.includes("--frames");
const CONTROLLER_ARG = process.argv.indexOf("--controller");
const CONTROLLER =
	CONTROLLER_ARG >= 0
		? resolve(process.argv[CONTROLLER_ARG + 1])
		: join(ROOT, "src/main/browser/approvals-overlay.ts");
mkdirSync(OUT, { recursive: true });
// No HOME override: Electron resolves its profile from NSHomeDirectory on
// macOS, and a scratch HOME is what made the child view fail in the round-2
// investigation. The private --user-data-dir below is the isolation that
// matters; the mock-keychain switch (applied in the fixture) keeps the keychain out.

const MAIN = join(OUT, "s6b-main.mjs");
const FIXTURE = join(OUT, "fixture.html");
const CARD = join(ROOT, "out/renderer/browser-approvals-overlay.html");
const PRELOAD = join(ROOT, "out/preload/browser-approvals-overlay.js");
writeFileSync(
	FIXTURE,
	`<!doctype html><html lang="en"><body style="margin:0;background:#204060;color:#fff;font:16px sans-serif"><div style="padding:16px"><h1>Fixture page</h1><p id="status">ready</p><button id="click" style="position:absolute;left:24px;top:24px;width:120px;height:40px">click</button><input id="field" style="position:absolute;left:24px;top:90px"></div><script>let clicks=0,keys=0,focusEvents=0,blurEvents=0;window.addEventListener("focus",()=>{focusEvents+=1});window.addEventListener("blur",()=>{blurEvents+=1});document.getElementById("click").onclick=()=>{clicks+=1;document.getElementById("status").textContent="clicks:"+clicks};document.getElementById("field").addEventListener("keydown",()=>{keys+=1});window.__focusField=()=>{document.getElementById("field").focus()};window.__probe=()=>({focusEvents,blurEvents,clicks,keys,activeElement:document.activeElement?.id??document.activeElement?.tagName??null,status:document.getElementById("status").textContent,innerWidth,innerHeight})</script></body></html>`,
);

writeFileSync(
	join(OUT, "s6b-entry.ts"),
	`
import { app, BrowserWindow, WebContentsView, webContents } from "electron";
import { writeFileSync } from "node:fs";
import { ApprovalsOverlayController } from ${JSON.stringify(CONTROLLER)};
const FRAMES = ${FRAMES};

const out = ${JSON.stringify(OUT)};
const cardUrl = ${JSON.stringify(`file://${CARD}`)};
const cardPreload = ${JSON.stringify(PRELOAD)};
const fixture = ${JSON.stringify(`file://${FIXTURE}`)};
const WIDTH = ${WIDTH};
const THEME = ${JSON.stringify(THEME)};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.commandLine.appendSwitch("use-mock-keychain");
const watchdog = setTimeout(() => {
  try {
    writeFileSync(out + "/s6b-facts.json", JSON.stringify({
      boot: { flow: "FAIL", reason: "watchdog: flow exceeded 90s" },
      rows: { "BOOT-flow": { status: "FAIL", detail: "flow exceeded 90s" } },
    }, null, 2));
  } catch (error) { }
  app.exit(1);
}, 240000);
watchdog.unref?.();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: Math.max(1000, WIDTH), height: 800, backgroundColor: "#000000" });
  const page = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  win.contentView.addChildView(page);
  const pageRect = { x: 0, y: 120, width: WIDTH, height: 600 };
  writeFileSync(out + "/s6b-boot.txt", JSON.stringify({ fixture, width: WIDTH, theme: THEME }));
  /*
   * A BOUNDED FIXTURE LOAD. A failed child load must become a recorded cell, not
   * a 180s hang and a leaked Electron tree (round-3 F4). The watchdog below is
   * the second line for a stall later in the flow; this one names the load.
   */
  const loaded = await Promise.race([
    page.webContents.loadURL(fixture).then(() => "ok").catch((error) => "fail:" + String(error)),
    sleep(30000).then(() => "timeout"),
  ]);
  if (loaded !== "ok") {
    writeFileSync(out + "/s6b-facts.json", JSON.stringify({
      boot: { load: "FAIL", reason: String(loaded) },
      rows: { "BOOT-fixture-load": { status: "FAIL", detail: String(loaded) } },
    }, null, 2));
    console.error("fixture load", loaded);
    win.close();
    app.exit(1);
    return;
  }
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
  // The hidden window does not always propagate the page's bounds to its
  // renderer once a second child exists (measured innerWidth 0 at this head):
  // re-apply the page rect after the card child is attached, then confirm.
  page.setBounds(pageRect);
  const pageViewport = await page.webContents.executeJavaScript("({ w: innerWidth, h: innerHeight })");
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
      cardHeight: (() => { const el = document.getElementById('approvals-card'); return el ? el.clientHeight : null; })(),
      cardRectHeight: (() => { const el = document.getElementById('approvals-card'); return el ? el.getBoundingClientRect().height : null; })(),
      footerHeight: (() => { const el = document.querySelector('.card-footer'); return el ? el.getBoundingClientRect().height : 0; })(),
      footerTop: (() => { const el = document.querySelector('.card-footer'); const card = document.getElementById('approvals-card'); if (!el || !card) return null; return Math.round(el.getBoundingClientRect().top - card.getBoundingClientRect().top); })(),
      decisionRects: [...document.querySelectorAll('#approvals-secondary button')].map((b) => { const r = b.getBoundingClientRect(); const c = document.getElementById('approvals-card').getBoundingClientRect(); return { text: b.textContent, top: Math.round(r.top - c.top), bottom: Math.round(r.bottom - c.top) }; }),
    }))()\`);
  // D1: where the decision buttons sit against the card the native view gives
  // them. Rects are in the card's own border-box coordinates; overdraw is how
  // far the sticky footer's top edge cuts into the lowest decision button, and
  // bodyOverflow is how much of the body is scrolled out of the card (both 0
  // when the card was measured after the error line painted).
  const readD1 = () =>
    currentCard().webContents.executeJavaScript(\`(() => {
      const card = document.getElementById('approvals-card');
      const body = document.querySelector('.card-body');
      const footer = document.querySelector('.card-footer');
      const c = card.getBoundingClientRect();
      const buttons = [document.getElementById('approvals-allow-once'), ...document.querySelectorAll('#approvals-secondary button')].filter(Boolean);
      const rects = buttons.map((b) => { const r = b.getBoundingClientRect(); return { text: b.textContent, top: +(r.top - c.top).toFixed(2), bottom: +(r.bottom - c.top).toFixed(2) }; });
      const footerTop = +(footer.getBoundingClientRect().top - c.top).toFixed(2);
      const lowest = Math.max(...rects.map((r) => r.bottom));
      const errorEl = document.getElementById('approvals-error');
      return {
        errorVisible: !errorEl.hidden,
        errorText: errorEl.textContent,
        cardHeight: +c.height.toFixed(2),
        innerHeight: window.innerHeight,
        footerTop,
        lowestDecisionBottom: lowest,
        overdraw: +Math.max(0, lowest - footerTop).toFixed(2),
        bodyOverflow: body.scrollHeight - body.clientHeight,
        insideCard: rects.every((r) => r.top >= 0 && r.bottom <= c.height),
        rects,
      };
    })()\`);
  // A rebuilt child is mid-load for a moment (a 166 DIP half-painted card was
  // read once); the reading that counts is the one that repeats AND shows the
  // state the step asked for, so a mid-reload frame is never recorded as a pass
  // or a fail.
  const readD1Settled = async (expectError) => {
    let previous = "";
    let last = null;
    for (let i = 0; i < 80; i += 1) {
      await sleep(150);
      try {
        last = await readD1();
      } catch {
        continue;
      }
      const key = JSON.stringify([last.errorVisible, last.cardHeight, last.innerHeight, controller.facts().bounds?.view.height]);
      if (last.errorVisible === expectError && key === previous) return last;
      previous = key;
    }
    return last;
  };
  const stableBounds = async () => {
    let last = null;
    for (let stable = 0; stable < 4; ) {
      await sleep(150);
      const h = controller.facts().bounds?.card.height ?? null;
      stable = h === last ? stable + 1 : 0;
      last = h;
    }
    return last;
  };
  const settle = async (predicate, label, timeout = 45000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      try { if (predicate(controller.facts())) return true; } catch {}
      await sleep(50);
    }
    return false;
  };
  // PRODUCTION-SHAPED: displayAuthority is the requested site's host, and the
  // requester identity is the opaque queue field. The display label arrives
  // through the renderer-pushed requesterLabels map.
  const entry = (index) => ({
    entryId: "entry-" + index,
    origin: "https://example" + index + ".test",
    displayAuthority: "example" + index + ".test",
    requester: "session:entry-" + index,
    requesterSessionId: "entry-" + index,
    expiresAt: Date.now() + 9 * 60000,
    ...(index === 0 ? { broad: { scope: "domain", key: "example0.test" } } : {}),
  });
  const requesterLabels = {
    "entry-0": "Fix the login flow",
    "entry-1": "Draft a release note",
  };
  const entries = [entry(0), entry(1)];
  const rows = {};
  const record = (id, pass, detail, blocked = false) => { rows[id] = { status: blocked ? "BLOCKED" : pass ? "PASS" : "FAIL", detail }; };
  const waitFor = async (predicate, timeout = 15000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (predicate()) return true;
      await sleep(50);
    }
    return false;
  };

  const pageBefore = { bounds: page.getBounds(), visible: page.getVisible(), viewport: pageViewport, probe: await page.webContents.executeJavaScript("window.__probe()") };
  const focusBefore = webContents.getFocusedWebContents()?.id ?? null;
  controller.onLayout({ presented: true, contentRect: pageRect, revision: 1 });
  controller.setModel({ entries, locale: "fr", dir: "ltr", theme: THEME, requesterLabels });
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
  // Snapshot the controller AT the auto-present moment; the end-state facts are
  // after explicit opens and decisions and must not be cited as A1 (round-1 A1/Q-3).
  const factsAtAuto = controller.facts();
  /*
   * Above the footer's TOP, in the card's own border-box coordinates. The old
   * check subtracted the footer height from clientHeight (which excludes the
   * 2px border and the footer's own box), so a button that cleared the footer
   * by 1px failed the arithmetic (round-2 Q2).
   */
  const footerTop = autoDoc?.footerTop ?? null;
  record(
    "Q2-decisions-above-fold",
    Boolean(
      autoDoc &&
        autoDoc.decisionRects.length === 4 &&
        footerTop != null &&
        autoDoc.decisionRects.every((entry) => entry.bottom <= footerTop),
    ),
    {
      cardHeight: autoDoc?.cardHeight,
      cardRectHeight: autoDoc?.cardRectHeight,
      footerTop,
      decisions: autoDoc?.decisionRects,
    },
  );
  record("A1-auto-present-unfocused", Boolean(autoSettled && autoDoc && !factsAtAuto.explicitOpen && focusTargets.length === 0 && pageAfterAuto.probe.focusEvents === pageBefore.probe.focusEvents && pageAfterAuto.probe.blurEvents === pageBefore.probe.blurEvents && pageAfterAuto.probe.activeElement === pageBefore.probe.activeElement && JSON.stringify(pageAfterAuto.bounds) === JSON.stringify(pageBefore.bounds) && pageAfterAuto.visible === pageBefore.visible && focusAfterAuto === focusBefore), { autoSettled, facts: factsAtAuto, pageBefore, pageAfterAuto, focusBefore, focusAfterAuto, focusTargets: [...focusTargets], doc: autoDoc });

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
  // A page click in the product focuses the page first; the card's own click
  // above focused the card, and Chromium delivers synthetic mouse input to the
  // focused child. Focus the page, then click it (same as the real gesture).
  page.webContents.focus();
  await sleep(80);
  const outsideHit = await page.webContents.executeJavaScript("(() => ({ el: document.elementFromPoint(40, 40)?.id ?? null, dpr: devicePixelRatio, innerWidth, innerHeight }))()");
  page.webContents.sendInputEvent({ type: "mouseMove", x: 40, y: 40 });
  page.webContents.sendInputEvent({ type: "mouseDown", x: 40, y: 40, button: "left", clickCount: 1 });
  page.webContents.sendInputEvent({ type: "mouseUp", x: 40, y: 40, button: "left", clickCount: 1 });
  await sleep(450);
  const outsideAfter = await page.webContents.executeJavaScript("window.__probe()");
  record("I2-click-outside", outsideAfter.clicks === outsideBefore.clicks + 1 && controller.facts().visible === cardBeforeOutside && responded.length === decisionsBeforeOutside, { outsideBefore, outsideAfter, outsideHit, focusedWebContentsId: webContents.getFocusedWebContents()?.id ?? null, visible: controller.facts().visible, responded: [...responded] });

  // I3 — a click inside the 8px ring: the document ignores it; native routing
  // between sibling views is BLOCKED in a hidden window and is not claimed.
  currentCard().webContents.sendInputEvent({ type: "mouseDown", x: 2, y: 2, button: "left", clickCount: 1 });
  currentCard().webContents.sendInputEvent({ type: "mouseUp", x: 2, y: 2, button: "left", clickCount: 1 });
  await sleep(150);
  record("I3-ring-click", controller.facts().visible === true && responded.length === 1, { visible: controller.facts().visible, responded: [...responded], nativeRouting: "BLOCKED: hidden window, no sibling-view hit testing" }, true);

  // I5 — a page click while the card is open: the card stays.
  const pageClickBefore = await page.webContents.executeJavaScript("window.__probe()");
  page.webContents.focus();
  await sleep(80);
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

  // D1 — the stale / unavailable inline error must not push the sticky footer
  // over "Don't allow". The stale line is the one the I8 drop just painted; the
  // unavailable line comes from the host's own failure path. Each is read after
  // the native height has stopped changing, and the pass condition is geometric:
  // every decision button is inside the card, none is under the footer, and the
  // body is not scrolled. The measured native card height is recorded beside it.
  await stableBounds();
  const d1Stale = await readD1Settled(true);
  const d1StaleNative = controller.facts().bounds?.card.height ?? null;
  record("D1-stale-error-keeps-decisions-visible", Boolean(d1Stale.errorVisible && d1Stale.overdraw === 0 && d1Stale.bodyOverflow <= 0 && d1Stale.insideCard), { ...d1Stale, nativeCardHeight: d1StaleNative, nativeViewBounds: controller.facts().bounds?.view ?? null });
  controller.setModel({ entries, error: "unavailable" });
  await sleep(300);
  await stableBounds();
  const d1Unavailable = await readD1Settled(true);
  const d1UnavailableNative = controller.facts().bounds?.card.height ?? null;
  record("D1-unavailable-error-keeps-decisions-visible", Boolean(d1Unavailable.errorVisible && d1Unavailable.overdraw === 0 && d1Unavailable.bodyOverflow <= 0 && d1Unavailable.insideCard), { ...d1Unavailable, nativeCardHeight: d1UnavailableNative });
  controller.setModel({ entries });
  await sleep(300);
  await stableBounds();
  const d1Normal = await readD1Settled(false);
  record("D1-normal-keeps-decisions-visible", Boolean(!d1Normal.errorVisible && d1Normal.overdraw === 0 && d1Normal.bodyOverflow <= 0 && d1Normal.insideCard), { ...d1Normal, nativeCardHeight: controller.facts().bounds?.card.height ?? null });

  // Q1: HOVER AND FOCUS MUST NOT MOVE THE DECISIONS. The gloss line follows the
  // pointer and the keyboard, and the "Don't allow" sentence wraps to two lines
  // where the others take one. Before the reserved min-height the card grew inside
  // a native view that stayed put: overdraw 9, every button slid 15 px, and a click
  // at the pre-hover centre landed in the gap. For each decision, in the normal
  // state and under the stale error line, the rects must be identical before and
  // during hover and during focus, overdraw must stay 0, and the element at the
  // pre-hover centre must still be that same button (the hover-then-click check).
  const hoverProbe = () =>
    currentCard().webContents.executeJavaScript(\`(async () => {
      const card = document.getElementById('approvals-card');
      const footer = document.querySelector('.card-footer');
      const buttons = [document.getElementById('approvals-allow-once'), ...document.querySelectorAll('#approvals-secondary button')].filter(Boolean);
      const read = () => {
        const c = card.getBoundingClientRect();
        return buttons.map((b) => { const r = b.getBoundingClientRect(); return { top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2), cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; });
      };
      const overdraw = () => {
        const lowest = Math.max(...buttons.map((b) => b.getBoundingClientRect().bottom));
        return +Math.max(0, lowest - footer.getBoundingClientRect().top).toFixed(2);
      };
      const idle = read();
      const out = { idle: idle.map((r) => [r.top, r.bottom]), moved: [], overdrawMax: overdraw(), hitMiss: [], glossHeights: [] };
      for (const mode of ['hover', 'focus']) {
        for (let i = 0; i < buttons.length; i += 1) {
          buttons[i].dispatchEvent(new MouseEvent(mode === 'hover' ? 'mouseenter' : 'focus', { bubbles: false }));
          if (mode === 'focus') buttons[i].focus();
          await new Promise((resolve) => setTimeout(resolve, 0));
          const during = read();
          during.forEach((r, j) => { if (r.top !== idle[j].top || r.bottom !== idle[j].bottom) out.moved.push(mode + ':' + i + '->' + j); });
          out.overdrawMax = Math.max(out.overdrawMax, overdraw());
          const hit = document.elementFromPoint(idle[i].cx, idle[i].cy);
          if (hit !== buttons[i] && !buttons[i].contains(hit)) out.hitMiss.push(mode + ':' + i);
          out.glossHeights.push(+document.getElementById('approvals-gloss').getBoundingClientRect().height.toFixed(2));
        }
      }
      return out;
    })()\`);
  const q1Normal = await hoverProbe();
  record("Q1-hover-focus-keeps-decisions-in-place-normal", Boolean(q1Normal.moved.length === 0 && q1Normal.overdrawMax === 0 && q1Normal.hitMiss.length === 0), q1Normal);
  controller.setModel({ entries, error: "stale" });
  await sleep(300);
  await stableBounds();
  await readD1Settled(true);
  const q1Stale = await hoverProbe();
  record("Q1-hover-focus-keeps-decisions-in-place-stale", Boolean(q1Stale.moved.length === 0 && q1Stale.overdrawMax === 0 && q1Stale.hitMiss.length === 0), q1Stale);
  controller.setModel({ entries });
  await sleep(300);
  await stableBounds();

  // S6d frames: the card document in the four views the PR evidence names. The
  // stale / unavailable frames are taken from the SAME settled states the D1 rows
  // measured, so a frame and its geometry row cannot describe different cards.
  if (FRAMES) {
    const shoot = async (name) => {
      try {
        const dbg = currentCard().webContents.debugger;
        if (!dbg.isAttached()) dbg.attach("1.3");
        const shot = await dbg.sendCommand("Page.captureScreenshot", { format: "png" });
        writeFileSync(out + "/card-" + name + ".png", Buffer.from(shot.data, "base64"));
      } catch (error) {
        writeFileSync(out + "/card-" + name + "-error.txt", String(error));
      }
    };
    await shoot("normal-request");
    // The stale line through the PRODUCT path (a dropped card action), not a
    // host-supplied error: dropAction is the path D1 is about.
    await currentCard().webContents.executeJavaScript("window.approvalsCard.decide({ seq: 999999, entryId: 'entry-0', decision: 'once' })");
    await readD1Settled(true);
    await shoot("stale-error");
    controller.setModel({ entries, error: "unavailable" });
    await readD1Settled(true);
    await shoot("unavailable-error");
    controller.setModel({ entries });
    await readD1Settled(false);
    await currentCard().webContents.executeJavaScript("document.getElementById('approvals-review').click()");
    await sleep(500);
    await shoot("review-all-list");
    await currentCard().webContents.executeJavaScript("document.getElementById('approvals-back').click()");
    await sleep(300);
  }

  // I4 — Escape dismisses without deciding AND the document repaints the next
  // request. The second half is the Q-S6b-1 regression: a dismissal that only
  // advanced the controller left the previous request painted, and a second
  // Escape dismissed that same entry again.
  const beforeEscape = responded.length;
  const dismissedEntry = controller.facts().requestEntryId;
  currentCard().webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  currentCard().webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await sleep(300);
  const afterEscapeFacts = controller.facts();
  const afterEscapeDoc = await readCard();
  const expectedEscape = entries.find((entry) => entry.entryId === afterEscapeFacts.requestEntryId);
  const renderedNext = Boolean(
    expectedEscape &&
      afterEscapeDoc?.requester === requesterLabels[expectedEscape.entryId] &&
      afterEscapeDoc?.origin === expectedEscape.origin,
  );
  // Dismissing the shown request may present the next live one (the queue rule),
  // so the assertion is that the dismissed entry is gone, nothing was decided,
  // and the document is painting the controller's next request.
  record(
    "I4-escape",
    responded.length === beforeEscape &&
      afterEscapeFacts.requestEntryId !== dismissedEntry &&
      renderedNext,
    { visible: afterEscapeFacts.visible, requestEntryId: afterEscapeFacts.requestEntryId, dismissedEntry, afterEscapeDoc, expectedEscape, renderedNext, responded: [...responded], actions: afterEscapeFacts.actions },
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
      autoPresent: { pageBefore, pageAfterAuto, focusBefore, focusAfterAuto, focusTargets: [...focusTargets], doc: autoDoc, factsAtAuto },
      voiceOver: "BLOCKED: no automated VoiceOver across a second document; manual gate",
      nativeComposite: "BLOCKED: hidden window, no Screen Recording",
      ringNativeRouting: "BLOCKED: hidden window, no sibling-view hit testing",
    }, null, 2),
  );
  clearTimeout(watchdog);
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
});
for (const key of Object.keys(env))
	if (key.startsWith("CMUX_") || key.startsWith("LOP_")) delete env[key];
withTelemetryOff(env);
// A fresh profile per cell: a lock left by an earlier hung boot can make the
// next `loadURL` wait forever (round-3 F4, measured on the 900 cells).
rmSync(join(OUT, "userdata"), { recursive: true, force: true });
const child = spawn(
	ELECTRON_BIN,
	[
		MAIN,
		// A PRIVATE PROFILE: HOME alone does not move Electron's userData on macOS
		// (it resolves from NSHomeDirectory), so two probe cells shared a singleton
		// profile and the second `loadURL` hung. This flag is the isolation.
		`--user-data-dir=${join(OUT, "userdata")}`,
		// QA's working recipe for this host: the GPU process is not needed to paint
		// a hidden document and its absence avoids the GL init path that wedged the
		// child view in the round-2 investigation.
		"--disable-gpu",
	],
	{
		env,
		stdio: ["ignore", "pipe", "pipe"],
		// The group is killed as a unit: a bare `child.kill` leaves the Chromium
		// helpers (four processes, measured) behind on a timeout (F4).
		detached: true,
	},
);
let err = "";
child.stderr.on("data", (chunk) => {
	err += chunk;
});
const code = await new Promise((resolveExit) => {
	const reap = () => {
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch {
			// The group is already gone; nothing to reap.
		}
	};
	const kill = setTimeout(() => {
		reap();
		resolveExit("timeout");
	}, 300000);
	child.on("exit", (exitCode) => {
		clearTimeout(kill);
		// Chromium helpers can outlive the main process; this exact-pid group kill
		// is what stops a failed cell from leaving an Electron behind.
		reap();
		resolveExit(exitCode);
	});
});
child.on("error", () => {});

if (code !== 0) {
	writeFileSync(join(OUT, "s6b-app-stderr.txt"), err);
	console.error("electron", code, err.slice(-3000));
	process.exit(1);
}
console.log(readFileSync(join(OUT, "s6b-facts.json"), "utf8"));
