#!/usr/bin/env node
/**
 * Design-review rig for local-operator-ui #879 (turn lifecycle honesty).
 *
 *   node rig.mjs <build-worktree> <label> <out-dir> [scenarios,comma] [--extras]
 *
 * ONE headless Electron (window-mode headless, never shown) + ONE real daemon
 * (isolated HOME/config, mock provider) + ONE small TCP-level proxy between them.
 * The proxy is the only harness aid: it can (a) end the session's SSE stream with
 * the daemon's own `gap` frame and hold the reconnect, (b) freeze SSE forwarding,
 * (c) delay or swallow POST /interrupt. Everything else is the real app and the
 * real daemon. Frames come from CDP Page.captureScreenshot on the hidden window.
 * Everything is reaped by process-group at the end.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const [BUILD, LABEL, OUT, SCEN = "all"] = process.argv.slice(2);
const EXTRAS = process.argv.includes("--extras");
const DAEMON_PORT = 1171;
const PROXY_PORT = 1181;
const TOKEN = randomUUID();
const R = join(OUT, "run");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
rmSync(R, { recursive: true, force: true });
for (const d of ["home", "cfg", "dhome", "dcfg", "cwd", "user-data", "logs"]) mkdirSync(join(R, d), { recursive: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(R, "dcfg", "config.yml"), "values:\n  hosting: test\n  model_name: mock-model\n  tool_approval_mode: auto\n");

const report = { label: LABEL, build: BUILD, steps: [], proxyLog: [] };
const t0 = Date.now();
const rec = (step, value) => {
  report.steps.push({ at: Date.now() - t0, step, ...value });
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${step}: ${JSON.stringify(value).slice(0, 400)}`);
};

const cleanEnv = {};
for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("CMUX_") && !k.startsWith("LOP_")) cleanEnv[k] = v;

/* ---------------- daemon ---------------- */
const daemon = spawn(
  process.env.HOME + "/.local/bin/local-operator",
  ["serve", "--host", "127.0.0.1", "--port", String(DAEMON_PORT), "--hosting", "test", "--model", "mock-model", "--yolo"],
  {
    env: {
      PATH: process.env.PATH,
      HOME: join(R, "dhome"),
      LOCAL_OPERATOR_CONFIG_DIR: join(R, "dcfg"),
      LOCAL_OPERATOR_DESKTOP_TOKEN: TOKEN,
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const daemonLog = [];
daemon.stdout.on("data", (d) => daemonLog.push(`${d}`));
daemon.stderr.on("data", (d) => daemonLog.push(`${d}`));

const dapi = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${DAEMON_PORT}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

/* ---------------- proxy ---------------- */
const px = { holdEvents: false, held: [], freeze: false, frozenBuf: [], interrupt: "pass", sse: new Set() };
const forward = (req, res, isSse) => {
  if (req.method === "POST" && /\/messages$/.test(req.url)) { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => report.proxyLog.push({ at: Date.now() - t0, messagesBody: b.slice(0, 200) })); }
  const up = http.request(
    { host: "127.0.0.1", port: DAEMON_PORT, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${DAEMON_PORT}` } },
    (ur) => {
      res.writeHead(ur.statusCode ?? 502, ur.headers);
      if (!isSse) return ur.pipe(res);
      const entry = { res, up };
      px.sse.add(entry);
      ur.on("data", (c) => (px.freeze ? px.frozenBuf.push([entry, c]) : res.write(c)));
      ur.on("end", () => { px.sse.delete(entry); res.end(); });
      res.on("close", () => { px.sse.delete(entry); up.destroy(); });
    },
  );
  up.on("error", () => res.destroy());
  req.pipe(up);
};
const proxy = http.createServer((req, res) => {
  if (true) report.proxyLog.push([Date.now() - t0, req.method, req.url.slice(0, 90), px.holdEvents ? "HELD" : "pass", px.sse.size]);
  const isEvents = req.method === "GET" && /\/events(\?|$)/.test(req.url);
  const isInterrupt = req.method === "POST" && /\/interrupt$/.test(req.url);
  if (isEvents || isInterrupt) report.proxyLog.push({ at: Date.now() - t0, m: req.method, p: req.url.split("?")[0], held: px.holdEvents && isEvents, interrupt: isInterrupt ? px.interrupt : undefined });
  if (isEvents && px.holdEvents) { px.held.push(() => forward(req, res, true)); return; }
  if (isInterrupt && px.interrupt === "swallow") return; // never answered, never forwarded
  if (isInterrupt && px.interrupt === "holdresp") { const up = http.request({ host: "127.0.0.1", port: DAEMON_PORT, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${DAEMON_PORT}` } }, (ur) => { const chunks = []; ur.on("data", (c) => chunks.push(c)); ur.on("end", () => setTimeout(() => { res.writeHead(ur.statusCode ?? 502, ur.headers); res.end(Buffer.concat(chunks)); }, 900)); }); up.on("error", () => res.destroy()); req.pipe(up); return; }
  if (isInterrupt && typeof px.interrupt === "number") return void setTimeout(() => forward(req, res, false), px.interrupt);
  forward(req, res, isEvents);
});
await new Promise((r) => proxy.listen(PROXY_PORT, "127.0.0.1", r));
const injectGap = (sid) => {
  for (const e of [...px.sse]) {
    try { e.res.write(`data: ${JSON.stringify({ type: "gap", session_id: sid })}\n\n`); e.res.end(); e.up.destroy(); } catch {}
    px.sse.delete(e);
  }
};
const releaseHold = () => { px.holdEvents = false; for (const g of px.held.splice(0)) g(); };
const unfreeze = () => { px.freeze = false; for (const [e, c] of px.frozenBuf.splice(0)) { try { e.res.write(c); } catch {} } };

/* ---------------- app ---------------- */
const freePort = async () => {
  const { createServer } = await import("node:net");
  for (;;) {
    const port = 9500 + Math.floor(Math.random() * 400);
    const ok = await new Promise((res) => { const s = createServer(); s.on("error", () => res(false)); s.listen(port, "127.0.0.1", () => s.close(() => res(true))); });
    if (ok) return port;
  }
};
const CDP_PORT = await freePort();
let app;
let cdp;
const reap = () => {
  for (const [name, p] of [["app", app], ["daemon", daemon]]) {
    try { if (p?.pid) process.kill(-p.pid, "SIGKILL"); } catch {}
  }
  try { proxy.close(); } catch {}
};
process.on("exit", reap);
process.on("SIGINT", () => { reap(); process.exit(130); });

class Cdp {
  constructor(ws) { this.ws = ws; this.n = 0; this.p = new Map();
    ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id !== undefined && this.p.has(m.id)) { const { resolve, reject } = this.p.get(m.id); this.p.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } }); }
  send(method, params = {}) { const id = ++this.n; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.p.set(id, { resolve, reject })); }
  async ev(expr) { const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails)); return r.result.value; }
  async shot(name, clip) { const { data } = await this.send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }); writeFileSync(join(OUT, name), Buffer.from(data, "base64")); }
}

const WIDTH = 1380, HEIGHT = 900;
try {
  // daemon up
  for (let i = 0; i < 60; i++) { try { const r = await dapi("GET", "/v1/capabilities"); if (r.status === 200) break; } catch {} await sleep(500); }
  const caps = await dapi("GET", "/v1/capabilities");
  rec("daemon", { status: caps.status, interrupt: caps.body?.result?.features?.session_interrupt });

  const env = {
    ...cleanEnv,
    HOME: join(R, "home"),
    LOCAL_OPERATOR_CONFIG_DIR: join(R, "cfg"),
    LOCAL_OPERATOR_LOG_DIR: join(R, "logs"),
    LOCAL_OPERATOR_UI_WINDOW_MODE: "headless",
    LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
    LOCAL_OPERATOR_UI_TELEMETRY: "off",
    VITE_DISABLE_BACKEND_MANAGER: "true",
    VITE_LOCAL_OPERATOR_API_URL: `http://127.0.0.1:${PROXY_PORT}`,
    LOCAL_OPERATOR_DESKTOP_TOKEN: TOKEN,
  };
  app = spawn("./node_modules/.bin/electron", [".", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${join(R, "user-data")}`, `--window-size=${WIDTH}x${HEIGHT}`, "--window-mode=headless"], { env, cwd: BUILD, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const appLog = [];
  app.stdout.on("data", (d) => appLog.push(`${d}`));
  app.stderr.on("data", (d) => appLog.push(`${d}`));

  let page = null;
  for (let i = 0; i < 120 && !page; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); const pages = list.filter((e) => e.type === "page" && e.url !== "about:blank"); page = pages.find((e) => e.url.endsWith("renderer/index.html")) ?? pages[0] ?? null; } catch {}
    if (!page) await sleep(500);
  }
  if (!page) throw new Error("no renderer: " + appLog.join("").slice(-1500));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });
  cdp = new Cdp(ws);
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  for (let i = 0; i < 60; i++) { if (await cdp.ev(`typeof window.api?.desktop?.request === "function"`).catch(() => false)) break; await sleep(500); }
  const modeLine = appLog.join("").split("\n").filter((l) => /window.?mode/i.test(l)).slice(0, 2);
  rec("windowMode", { lines: modeLine });

  const seedStore = async (extra = {}) => {
    await cdp.ev(`(() => { localStorage.setItem("onboarding-storage", JSON.stringify({state:{isModalComplete:true,isTourComplete:true,currentStep:0},version:0})); ${extra.theme ? `const k="ui-preferences-storage"; const cur=JSON.parse(localStorage.getItem(k)||'{"state":{},"version":1}'); cur.state.themeName=${JSON.stringify(extra.theme)}; localStorage.setItem(k, JSON.stringify(cur));` : ""} return true; })()`);
    await cdp.send("Page.reload", { ignoreCache: false });
    await sleep(4000);
    for (let i = 0; i < 80; i++) { const ok = await cdp.ev(`typeof window.api?.desktop?.request === "function" && !document.querySelector('[role="dialog"]')`).catch(() => false); if (ok) break; await sleep(500); }
  };
  await seedStore();
  const capsUi = await cdp.ev(`(async()=>{const r=await window.api.desktop.request({op:"capabilities"});return JSON.stringify(r.body?.result?.features?.session_interrupt ?? r.status)})()`);
  rec("uiCapabilities", { session_interrupt: capsUi });

  /* ---------- helpers ---------- */
  const STOP = '[aria-label="Stop"]';
  const read = () => cdp.ev(`(() => {
    const q = (s) => document.querySelector(s);
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return {x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height)}; };
    const ta = q('textarea[aria-label="Message"]');
    const wl = q('[data-lo-working-line]');
    const band = q('[data-stopped-turn]');
    const outs = [...document.querySelectorAll('output')].map((o) => o.innerText.trim()).filter(Boolean);
    const alerts = [...document.querySelectorAll('[role="alert"]')].map((o) => o.innerText.trim()).filter(Boolean);
    const main = document.body.innerText;
    return JSON.stringify({
      styles: (() => { const cs = (el) => { if (!el) return null; const c = getComputedStyle(el); let bg = null, n = el; while (n) { const b = getComputedStyle(n).backgroundColor; if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) { bg = b; break; } n = n.parentElement; } return { color: c.color, bg, size: c.fontSize, family: c.fontFamily.split(",")[0] }; }; const out = [...document.querySelectorAll('output')].find((o) => /Nothing was running|Stopped this turn/.test(o.innerText)) || null; const al = [...document.querySelectorAll('[role="alert"]')].find((o) => /Stop could not/.test(o.innerText)) || null; return { line: cs(wl && (wl.querySelector('.truncate') || wl)), band: cs(band), output: cs(out), alert: cs(al) }; })(),
      workingLine: wl ? wl.innerText.replace(/\\s+/g, " ").trim() : null,
      workingLineRect: rect(wl),
      band: band ? band.innerText.replace(/\\s+/g, " ").trim() : null,
      bandRect: rect(band),
      placeholder: ta ? ta.placeholder : null,
      stopControl: !!q(${JSON.stringify(STOP)}),
      outputs: outs, alerts,
      reconnecting: /reconnecting/i.test(main),
      failureText: (main.match(/(could not|can.t) (reach|connect)[^\\n]*/i) || [null])[0],
    });
  })()`).then(JSON.parse);
  const snap = async (name, note) => {
    const s = await read();
    rec(name, { note, ...s });
    await cdp.shot(`${name}.png`);
    return s;
  };
  const aimAndPress = async (selector) => {
    const box = await cdp.ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()`);
    if (!box) throw new Error(selector + " not on screen");
    for (const type of ["mousePressed", "mouseReleased"]) await cdp.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
  };
  const pressEscape = async () => { for (const type of ["keyDown", "keyUp"]) await cdp.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }); };
  const newSession = async (sleepS) => {
    const r = await dapi("POST", "/v1/desktop/sessions", { request_id: randomUUID(), cwd: join(R, "cwd") });
    const sid = r.body?.result?.session_id;
    if (!sid) throw new Error("no session " + JSON.stringify(r));
    await cdp.ev(`location.hash = "#/chat/${sid}"; true`);
    await sleep(1800);
    const m = await dapi("POST", `/v1/desktop/sessions/${sid}/messages`, { request_id: randomUUID(), text: `design review turn [bash:${sleepS}]`, mode: "prompt" });
    rec("turn.admit", { sid, status: m.status });
    return sid;
  };
  const waitFor = async (pred, ms, what) => { const until = Date.now() + ms; while (Date.now() < until) { if (await pred()) return true; await sleep(250); } rec("waitFor.timeout", { what }); return false; };
  const streaming = async (sid) => (await dapi("GET", `/v1/desktop/sessions/${sid}`)).body?.result?.payload?.frontend?.snapshot?.streaming === true;
  const endTurn = async (sid) => { px.interrupt = "pass"; px.holdEvents = false; releaseHold(); unfreeze(); await dapi("POST", `/v1/desktop/sessions/${sid}/interrupt`, { request_id: randomUUID() }); await sleep(2500); };
  const uiRunning = (sid) => waitFor(async () => (await read()).stopControl, 30000, "ui shows Stop control");

  const want = (n) => SCEN === "all" || SCEN.split(",").includes(n);

  /* S0/S1: baseline then receipt gap (the flapping link) */
  if (want("gap")) {
    const sid = await newSession(45);
    await uiRunning(sid);
    await sleep(2500);
    await snap(`${LABEL}-gap-0-running`, "turn running, link healthy");
    px.holdEvents = true; injectGap(sid);
    await sleep(900); await snap(`${LABEL}-gap-1-+0.9s`, "gap frame sent, reconnect held");
    await sleep(2500); await snap(`${LABEL}-gap-2-+3.4s`, "still in the gap");
    await sleep(3500); await snap(`${LABEL}-gap-3-+6.9s`, "still in the gap");
    releaseHold(); await sleep(2000); await snap(`${LABEL}-gap-4-restored`, "reconnect answered");
    await endTurn(sid);
  }

  /* S1b: long gap -> does the failure/terminal statement replace the line, and what shows together */
  if (want("longgap")) {
    const sid = await newSession(60);
    await uiRunning(sid);
    await sleep(1500);
    px.holdEvents = true; injectGap(sid);
    for (const [t, label] of [[5, "+5s"], [15, "+15s"], [30, "+30s"], [45, "+45s"]]) {
      const target = t * 1000; const start = Date.now();
      await sleep(Math.max(0, target - (Date.now() - start)));
    }
    // sample in sequence instead: absolute offsets from the gap
    // (kept simple: sequential waits)
    await endTurn(sid);
  }

  /* S1c: Escape / Stop pressed DURING a gap */
  if (want("gapesc")) {
    const sid = await newSession(45);
    await uiRunning(sid);
    await sleep(2000);
    px.holdEvents = true; injectGap(sid);
    await sleep(1500);
    await snap(`${LABEL}-gapesc-0-gap`, "in a gap, before Escape");
    const n0 = report.proxyLog.filter((l) => l.interrupt !== undefined).length;
    await pressEscape();
    await sleep(1200); await snap(`${LABEL}-gapesc-1-escape+1.2s`, "Escape pressed during the gap");
    await pressEscape(); await pressEscape();
    await sleep(1500); await snap(`${LABEL}-gapesc-2-escape x3 +1.5s`, "Escape x3 during the gap");
    rec("gapesc.interruptRequests", { before: n0, after: report.proxyLog.filter((l) => l.interrupt !== undefined).length });
    releaseHold(); await sleep(2000); await snap(`${LABEL}-gapesc-3-restored`, "stream restored");
    await endTurn(sid);
  }

  /* S1e: type + Enter during a gap: which mode does the send take (the hint says 'Steer ... Enter sends now') */
  if (want("gapenter")) {
    const sid = await newSession(45);
    await uiRunning(sid);
    await sleep(2000);
    px.holdEvents = true; injectGap(sid);
    await sleep(1500);
    await cdp.ev(`document.querySelector('textarea[aria-label="Message"]').focus(); true`);
    await cdp.send("Input.insertText", { text: "gap-time message" });
    await sleep(300); await snap(`${LABEL}-gapenter-0-typed`, "typed in the gap");
    for (const type of ["keyDown", "keyUp"]) await cdp.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: type === "keyDown" ? "\r" : undefined });
    await sleep(1500); await snap(`${LABEL}-gapenter-1-after-enter`, "Enter pressed in the gap");
    rec("gapenter.messages", { bodies: report.proxyLog.filter((l) => l.messagesBody).map((l) => l.messagesBody) });
    releaseHold(); await sleep(1500);
    await endTurn(sid);
  }

  /* S2c: the receipt lands INSIDE a gap: the HTTP answer is fast, the SSE that would say streaming:false is held */
  if (want("recvgap")) {
    const sid = await newSession(45);
    await uiRunning(sid);
    await sleep(2000);
    px.interrupt = 1500;
    await aimAndPress(STOP);
    await sleep(300);
    px.holdEvents = true; injectGap(sid);
    await sleep(900);  await snap(`${LABEL}-recvgap-1-pending-in-gap`, "press pending, gap open, receipt not yet in");
    await sleep(1500); await snap(`${LABEL}-recvgap-2-receipt-in-gap+2.7s`, "receipt delivered (interrupted); stream still in the gap");
    await sleep(2500); await snap(`${LABEL}-recvgap-3-gap+5.2s`, "stream still in the gap");
    releaseHold(); await sleep(1800); await snap(`${LABEL}-recvgap-4-restored`, "stream restored");
    await endTurn(sid);
  }

  /* S2d: receipt in, SSE frozen (slow stream) */
  if (want("recvfreeze")) {
    const sid = await newSession(45);
    await uiRunning(sid);
    await sleep(2000);
    px.freeze = true;
    await aimAndPress(STOP);
    await sleep(700);  await snap(`${LABEL}-recvfreeze-1-+0.7s`, "receipt in, stream frozen");
    await sleep(2500); await snap(`${LABEL}-recvfreeze-2-+3.2s`, "still frozen");
    unfreeze(); await sleep(1500); await snap(`${LABEL}-recvfreeze-3-unfrozen`, "stream caught up");
    await endTurn(sid);
  }

  /* S1f: Enter while the link is healthy: the mode the send takes (compare with S1e) */
  if (want("enterlive")) {
    const sid = await newSession(45);
    await uiRunning(sid);
    await sleep(2000);
    await cdp.ev(`document.querySelector('textarea[aria-label="Message"]').focus(); true`);
    await cdp.send("Input.insertText", { text: "live message" });
    for (const type of ["keyDown", "keyUp"]) await cdp.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: type === "keyDown" ? "\r" : undefined });
    await sleep(1200);
    rec("enterlive.messages", { bodies: report.proxyLog.filter((l) => l.messagesBody).map((l) => l.messagesBody) });
    await endTurn(sid);
  }

  /* S3b: the bound fires at 15s, but the stop DOES land (request delayed 17s, so the answer is lost to the app yet delivered) */
  if (want("lostlate")) {
    const sid = await newSession(60);
    await uiRunning(sid);
    await sleep(1500);
    px.interrupt = 17000;
    const p0 = Date.now();
    await aimAndPress(STOP);
    await snap(`${LABEL}-lostlate-0a-before-press-ref`, "ref");
    for (const t of [3, 9, 14, 15.2]) { await sleep(Math.max(0, t * 1000 - (Date.now() - p0))); const r = await read(); rec(`${LABEL}-lostlate-clock+${t}`, { line: r.workingLine, rowClock: await cdp.ev(`(document.querySelector('[data-lo-working-line]')?.closest('div')?.parentElement?.previousElementSibling?.innerText || '').replace(/\\s+/g,' ').slice(0,80)`) }); }
    await sleep(Math.max(0, 15800 - (Date.now() - p0))); await snap(`${LABEL}-lostlate-1-bound-fired+15.8s`, "bound fired; stop not yet delivered");
    await sleep(Math.max(0, 19500 - (Date.now() - p0))); await snap(`${LABEL}-lostlate-2-stop-landed+19.5s`, "stop landed on the server at ~17s; the app never got the receipt");
    await sleep(6000); await snap(`${LABEL}-lostlate-3-+25.5s`, "settled");
    await endTurn(sid);
  }

  /* S3c: dense sampling of the line's text across the bound, to see whether the clock resumes from the right age */
  if (want("boundclock")) {
    const sid = await newSession(60);
    await uiRunning(sid);
    await sleep(1500);
    px.interrupt = "swallow";
    const p0 = Date.now();
    await aimAndPress(STOP);
    await sleep(14200);
    const samples = [];
    while (Date.now() - p0 < 18000) { samples.push([Date.now() - p0, (await cdp.ev(`(document.querySelector('[data-lo-working-line]')?.innerText || '').replace(/\\s+/g,' ')`))]); await sleep(120); }
    let last = null; const compact = samples.filter(([t, x]) => { const k = x; const keep = k.replace(/^\S+ /, "") !== last; last = k.replace(/^\S+ /, ""); return keep; });
    rec("boundclock.samples", { compact });
    await endTurn(sid);
  }

  /* S1g: a SHORT gap (the routine ~1.5s one): does the caption flash and does the line move? */
  if (want("shortgap")) {
    const sid = await newSession(45);
    await uiRunning(sid);
    await sleep(2500);
    const rectOf = () => cdp.ev(`(() => { const l = document.querySelector('[data-lo-working-line]'); const t = document.querySelector('textarea[aria-label="Message"]'); const c = [...document.querySelectorAll('p')].find((p) => p.innerText.trim() === 'Reconnecting'); const r = (e) => e ? Math.round(e.getBoundingClientRect().top) : null; return JSON.stringify({ line: r(l), composer: r(t), caption: !!c }); })()`).then(JSON.parse);
    const base = await rectOf(); const samples = [[0, base]];
    px.holdEvents = true; injectGap(sid); const g0 = Date.now();
    setTimeout(() => releaseHold(), 1500);
    while (Date.now() - g0 < 2600) { samples.push([Date.now() - g0, await rectOf()]); await sleep(100); }
    const compact = []; let prev = ""; for (const [t, r] of samples) { const k = JSON.stringify(r); if (k !== prev) compact.push([t, r]); prev = k; }
    rec("shortgap.rects", { compact });
    await endTurn(sid);
  }

  /* S1h: composer position when the idle notice appears (layout shift check) */
  if (want("noticeshift")) {
    const sid = await newSession(6);
    await uiRunning(sid); px.freeze = true;
    await waitFor(async () => !(await streaming(sid)), 25000, "server turn ended");
    const top = () => cdp.ev(`Math.round(document.querySelector('textarea[aria-label="Message"]').getBoundingClientRect().top)`);
    const before = await top(); await pressEscape(); await sleep(900); const after = await top();
    rec("noticeshift", { composerTopBefore: before, composerTopAfter: after });
    unfreeze(); await endTurn(sid);
  }

  /* S1d: a long gap: what replaces the line, and what co-exists */
  if (want("longgap2")) {
    const sid = await newSession(60);
    await uiRunning(sid);
    await sleep(1500);
    px.holdEvents = true; injectGap(sid);
    const g0 = Date.now();
    for (const t of [10, 25, 50, 70]) { await sleep(Math.max(0, t * 1000 - (Date.now() - g0))); await snap(`${LABEL}-longgap-+${t}s`, `gap held ${t}s`); }
    releaseHold(); await sleep(2500); await snap(`${LABEL}-longgap-restored`, "restored");
    await endTurn(sid);
  }

  /* S2: Stop pressed, receipt arrives late (the pending window) */
  if (want("pending")) {
    const sid = await newSession(45);
    await uiRunning(sid);
    await sleep(2000);
    await snap(`${LABEL}-stop-0-before-press`, "turn running");
    px.interrupt = 4500;
    await aimAndPress(STOP);
    await sleep(500); await snap(`${LABEL}-stop-1-+0.5s`, "pressed; receipt held 4.5s");
    await sleep(1800); await snap(`${LABEL}-stop-2-+2.3s`, "still waiting for receipt");
    await sleep(3500); await snap(`${LABEL}-stop-3-+5.8s`, "receipt delivered (interrupted)");
    await sleep(1500); await snap(`${LABEL}-stop-4-+7.3s`, "settled");
    await endTurn(sid);
  }

  /* S2b: Stop pressed, the link flaps while the press is in flight */
  if (want("pendinggap")) {
    const sid = await newSession(45);
    await uiRunning(sid);
    await sleep(2000);
    px.interrupt = 7000;
    await aimAndPress(STOP);
    await sleep(1000);
    px.holdEvents = true; injectGap(sid);
    await sleep(1200); await snap(`${LABEL}-stopgap-1-gap+1.2s`, "press in flight AND link in a gap");
    await sleep(2500); await snap(`${LABEL}-stopgap-2-gap+3.7s`, "still in gap");
    releaseHold();
    await sleep(1500); await snap(`${LABEL}-stopgap-3-restored`, "stream back, receipt still pending");
    await sleep(4500); await snap(`${LABEL}-stopgap-4-receipt`, "receipt delivered");
    await endTurn(sid);
  }

  const sq = () => cdp.ev(`(() => { const b = document.querySelector('[aria-label="Stop"]'); if (!b) return null; const c = getComputedStyle(b); return JSON.stringify({bg: c.backgroundColor, border: c.borderTopColor, color: c.color, stopping: b.getAttribute("data-stopping"), busy: b.getAttribute("aria-busy"), hovered: b.matches(":hover"), disabled: b.disabled, opacity: c.opacity, name: b.getAttribute("aria-label")}); })()`).then((v) => (v ? JSON.parse(v) : null));
  const mouseAway = () => cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 700, y: 300 });
  const mouseOn = async () => { const b = await cdp.ev(`(() => { const r = document.querySelector('[aria-label="Stop"]').getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()`); await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: b.x, y: b.y }); };

  /* r3 sqhold: the pressed hold on the square, keyboard path (pointer away) and pointer path (pointer on it) */
  if (want("sqhold")) {
    const sid = await newSession(45);
    await uiRunning(sid);
    await mouseAway(); await sleep(400);
    rec("sq.rest.unhovered", await sq()); await snap(`${LABEL}-sqhold-0-rest-unhovered`, "square at rest, pointer away");
    await mouseOn(); await sleep(300);
    rec("sq.rest.hovered", await sq()); await snap(`${LABEL}-sqhold-1-rest-hovered`, "square at rest, hovered");
    await mouseAway(); await sleep(200);
    px.interrupt = 6000;
    await pressEscape(); await sleep(1200);
    rec("sq.pending.unhovered", await sq()); await snap(`${LABEL}-sqhold-2-pending-unhovered`, "Escape pressed, pointer away, receipt held");
    await mouseOn(); await sleep(300);
    rec("sq.pending.hovered", await sq()); await snap(`${LABEL}-sqhold-3-pending-hovered`, "same, pointer on it");
    await sleep(6000);
    rec("sq.after", await sq()); await snap(`${LABEL}-sqhold-4-after-receipt`, "receipt in");
    await endTurn(sid);
  }

  /* r3 strand: the receipt lands AFTER the feed already showed the end (interrupt forwarded at once, answer held 900ms) */
  if (want("strand")) {
    const sid = await newSession(45);
    await uiRunning(sid);
    await sleep(1500);
    px.interrupt = "holdresp";
    await aimAndPress(STOP);
    await sleep(700); await snap(`${LABEL}-strand-1-+0.7s`, "feed has shown the end; receipt still held");
    await sleep(600); await snap(`${LABEL}-strand-2-+1.3s`, "receipt landed");
    await sleep(4000); await snap(`${LABEL}-strand-3-+5.3s`, "settled");
    await sleep(6000); await snap(`${LABEL}-strand-4-+11.3s`, "later");
    await endTurn(sid);
  }

  /* r3 u10: the answer is swallowed, the turn then ends server-side: the composer must stop saying 'Stopping the turn' when the feed shows the end */
  if (want("u10")) {
    const sid = await newSession(45);
    await uiRunning(sid);
    await sleep(1500);
    px.interrupt = "swallow";
    await aimAndPress(STOP);
    await sleep(2000); await snap(`${LABEL}-u10-0-pressed+2s`, "pressed, answer swallowed");
    await dapi("POST", `/v1/desktop/sessions/${sid}/interrupt`, { request_id: randomUUID() });
    await sleep(500); await snap(`${LABEL}-u10-1-end+0.5s`, "turn ended server-side, feed shows it");
    await sleep(2500); await snap(`${LABEL}-u10-2-end+3s`, "later");
    await sleep(6000); await snap(`${LABEL}-u10-3-end+9s`, "later still");
    px.interrupt = "pass"; await endTurn(sid);
  }

  /* r3 idleclock: disputed idle must withhold the clock; Escape x2 afterwards */
  if (want("idleclock")) {
    const sid = await newSession(6);
    await uiRunning(sid);
    px.freeze = true;
    await waitFor(async () => !(await streaming(sid)), 25000, "server turn ended");
    await sleep(500); await snap(`${LABEL}-idleclock-0-before`, "server idle, pane stale");
    await pressEscape();
    await sleep(900); await snap(`${LABEL}-idleclock-1-+0.9s`, "Escape; idle receipt; sentence up");
    await sleep(3000); await snap(`${LABEL}-idleclock-2-+3.9s`, "still");
    await sleep(6000); await snap(`${LABEL}-idleclock-3-+9.9s`, "still");
    unfreeze(); await sleep(1500); await snap(`${LABEL}-idleclock-4-unfrozen`, "stream resumed");
    await endTurn(sid);
  }

  /* dblesc (r2): Escape twice on a lagging stream: the 2nd press answers idle because the 1st worked */
  if (want("dblesc")) {
    const sid = await newSession(45);
    await uiRunning(sid);
    await sleep(2000);
    px.freeze = true;
    await pressEscape();
    await sleep(800); await snap(`${LABEL}-dblesc-1-first+0.8s`, "first Escape, receipt in, stream frozen");
    await pressEscape();
    await sleep(900); await snap(`${LABEL}-dblesc-2-second+0.9s`, "second Escape (double-tap)");
    await sleep(2500); await snap(`${LABEL}-dblesc-3-+3.4s`, "still frozen");
    unfreeze(); await sleep(1500); await snap(`${LABEL}-dblesc-4-unfrozen`, "stream caught up");
    await endTurn(sid);
  }

  /* rungflap (r2): press unanswered (swallowed), link flaps, restores: the rung must hold, not fall to the tool name */
  if (want("rungflap")) {
    const sid = await newSession(60);
    await uiRunning(sid);
    await sleep(2000);
    px.interrupt = "swallow";
    await aimAndPress(STOP);
    await sleep(1000); await snap(`${LABEL}-rungflap-0-pressed+1s`, "pressed, answer never comes");
    px.holdEvents = true; injectGap(sid);
    await sleep(1500); await snap(`${LABEL}-rungflap-1-gap+1.5s`, "gap open");
    await sleep(3000); await snap(`${LABEL}-rungflap-2-gap+4.5s`, "gap still open");
    releaseHold(); await sleep(1000); await snap(`${LABEL}-rungflap-3-restored+1s`, "stream restored, press unanswered");
    await sleep(3000); await snap(`${LABEL}-rungflap-4-restored+4s`, "still unanswered");
    await endTurn(sid);
  }

  /* S3: Stop pressed, the answer never comes (swallowed) -> the latched band / the 15s bound */
  if (want("lost")) {
    const sid = await newSession(60);
    await uiRunning(sid);
    await sleep(2000);
    px.interrupt = "swallow";
    const pressedAt = Date.now();
    await aimAndPress(STOP);
    for (const secs of [0.6, 3, 8, 14, 16.5, 22]) {
      await sleep(Math.max(0, secs * 1000 - (Date.now() - pressedAt)));
      await snap(`${LABEL}-lost-+${secs}s`, `interrupt swallowed, ${secs}s after press`);
    }
    await endTurn(sid);
  }

  /* S4: Escape pressed when the server's turn already ended but the pane has not heard (idle receipt) */
  if (want("idle")) {
    const sid = await newSession(6);
    await uiRunning(sid);
    px.freeze = true; // the pane keeps believing the turn is running
    await waitFor(async () => !(await streaming(sid)), 25000, "server turn ended");
    await sleep(500);
    await snap(`${LABEL}-idle-0-before`, "server idle, pane still shows running (SSE frozen)");
    await pressEscape();
    await sleep(900); await snap(`${LABEL}-idle-1-+0.9s`, "Escape pressed; receipt = idle");
    await sleep(3000); await snap(`${LABEL}-idle-2-+3.9s`, "3s later");
    await sleep(6000); await snap(`${LABEL}-idle-3-+9.9s`, "9s later");
    unfreeze(); await sleep(1500); await snap(`${LABEL}-idle-4-unfrozen`, "stream resumed");
    await endTurn(sid);
  }

  /* extras (head only): light theme + narrow width for the new strings */
  if (EXTRAS && want("extras")) {
    await seedStore({ theme: "localOperatorLight" });
    const sid = await newSession(45);
    await uiRunning(sid);
    await sleep(2000);
    px.interrupt = 5000;
    await aimAndPress(STOP);
    await sleep(1200); await snap(`${LABEL}-light-stopping`, "light theme, stopping rung");
    await sleep(5000);
    await endTurn(sid);
    // idle in light
    const sid2 = await newSession(6);
    await uiRunning(sid2); px.freeze = true;
    await waitFor(async () => !(await streaming(sid2)), 25000, "server turn ended");
    await sleep(500);
    await pressEscape(); await sleep(900); await snap(`${LABEL}-light-idle`, "light theme, idle notice");
    unfreeze(); await endTurn(sid2);
    // narrow + lost in light then dark
    await seedStore({ theme: "localOperatorDark" });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 760, height: 640, deviceScaleFactor: 1, mobile: false });
    await sleep(800);
    const sid3 = await newSession(6);
    await uiRunning(sid3); px.freeze = true;
    await waitFor(async () => !(await streaming(sid3)), 25000, "server turn ended");
    await sleep(500);
    await pressEscape(); await sleep(900); await snap(`${LABEL}-narrow-idle`, "760px wide, idle notice");
    unfreeze(); await endTurn(sid3);
    const sid4 = await newSession(60);
    await uiRunning(sid4); await sleep(1500);
    px.interrupt = "swallow";
    const p2 = Date.now();
    await aimAndPress(STOP);
    await sleep(2500); await snap(`${LABEL}-narrow-stopping`, "760px wide, stopping rung");
    await sleep(Math.max(0, 17500 - (Date.now() - p2))); await snap(`${LABEL}-narrow-lost`, "760px wide, bound fired");
    await endTurn(sid4);
  }

  report.appLogTail = appLog.join("").slice(-1500);
} catch (e) {
  rec("ERROR", { message: String(e?.stack ?? e).slice(0, 1200) });
} finally {
  report.daemonLogTail = daemonLog.join("").slice(-800);
  writeFileSync(join(OUT, `${LABEL}-report.json`), JSON.stringify(report, null, 2));
  try { cdp?.ws.close(); } catch {}
  reap();
  await sleep(500);
  process.exit(0);
}
