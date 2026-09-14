#!/usr/bin/env node
/**
 * Window-mode verification driver.
 *
 *     node drive.mjs <cdp-port> <out-dir> [hash-route]
 *
 * Attaches to the app's renderer over raw CDP, records what the page can see
 * (visibility, device pixel ratio, CSS viewport, rAF rate, document focus), and
 * captures two PNG frames: the app shell, and the chat transcript of a seeded
 * session. Writes <out-dir>/metrics.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PORT = process.argv[2];
const OUT = process.argv[3];
const ROUTE = process.argv[4] ?? "#/chat/a1a1a1a1a1a1";
if (!PORT || !OUT) {
	console.error("usage: drive.mjs <cdp-port> <out-dir> [hash-route]");
	process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let page = null;
for (let i = 0; i < 60; i += 1) {
	try {
		const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
		page = list.find((t) => t.type === "page" && t.url.includes("#/"));
		if (page) break;
	} catch {}
	await wait(1000);
}
if (!page) throw new Error("no app window on the CDP port");

let nextId = 1;
const pending = new Map();
const ws = new WebSocket(page.webSocketDebuggerUrl);
ws.onmessage = (event) => {
	const msg = JSON.parse(event.data);
	if (msg.id && pending.has(msg.id)) {
		const { resolve, reject } = pending.get(msg.id);
		pending.delete(msg.id);
		msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
	}
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) =>
	new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		ws.send(JSON.stringify({ id, method, params }));
	});

const evaluate = async (expression) => {
	const res = await send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (res.exceptionDetails)
		throw new Error(`eval failed: ${JSON.stringify(res.exceptionDetails)}`);
	return res.result.value;
};

const shot = async (name) => {
	const res = await send("Page.captureScreenshot", {
		format: "png",
		fromSurface: true,
		// `captureBeyondViewport: false` clips the frame to the layout viewport
		// rather than expanding it to the full scrollable document: a frame
		// should be what the window shows, not the whole page.
		captureBeyondViewport: false,
	});
	writeFileSync(join(OUT, name), Buffer.from(res.data, "base64"));
	return res.data.length;
};

await send("Page.enable");
await send("Runtime.enable");

const shellBytes = await shot("frame-shell.png");

// One second of animation frames, counted in the page: a throttled or paused
// document would count a small fraction of this.
const rafPerSecond = await evaluate(`new Promise((resolve) => {
  let frames = 0;
  const started = performance.now();
  const tick = () => { frames += 1; if (performance.now() - started < 1000) requestAnimationFrame(tick); else resolve(frames); };
  requestAnimationFrame(tick);
})`);

await evaluate(`location.hash = ${JSON.stringify(ROUTE)}`);
// Let the transcript mount and settle before the second frame.
await wait(2500);

const metrics = await evaluate(`(() => {
  const rows = document.querySelectorAll('[data-chat-row]').length;
  const text = document.body.innerText.replace(/\\s+/g, ' ').trim();
  return {
    hash: location.hash,
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    activeElement: document.activeElement ? document.activeElement.tagName : null,
    devicePixelRatio: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    chatRows: rows,
    textHead: text.slice(0, 240),
    textLength: text.length,
    cssPixels: document.documentElement.scrollWidth + 'x' + document.documentElement.scrollHeight,
  };
})()`);

await wait(300);
const chatBytes = await shot("frame-chat.png");

const result = {
  port: PORT,
  route: ROUTE,
  rafPerSecond,
  shellFrameBytes: shellBytes,
  chatFrameBytes: chatBytes,
  ...metrics,
};
writeFileSync(join(OUT, "metrics.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(`DRIVE ${JSON.stringify(result)}`);
process.exit(0);
