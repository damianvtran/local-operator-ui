#!/usr/bin/env node
/**
 * Capture the failed-send states from the REAL running Electron renderer.
 *
 *     node scripts/send-error-evidence.mjs <cdp-port> <out-dir> <step>
 *
 * Drives the app that is already running under `electron-vite dev` over raw
 * CDP, the same way `scripts/capture-evidence.mjs` drives Chromium: Node's
 * built-in WebSocket speaks the DevTools protocol directly, so there is no
 * browser-automation dependency in the repo and nothing is installed to take a
 * picture.
 *
 * Why a separate script rather than a Storybook story. The state under test is
 * produced by a send that actually fails against a backend, and the thing being
 * proven is that the user's text is still in the real composer afterwards -
 * which is a fact about the app's own draft store and its `useMessageInput`
 * hook, not about a component rendered with a prop set. A story would render
 * the alert without proving the retention that makes its copy true.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PORT = process.argv[2] ?? "9387";
const OUT = process.argv[3] ?? "docs/evidence/send-error";
const STEP = process.argv[4] ?? "probe";

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page" && t.url.includes("#/"));
if (!page) throw new Error("no renderer page on CDP");

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

/** Evaluate in the page and return the awaited value, throwing page errors. */
async function evaluate(expression) {
	const res = await send("Runtime.evaluate", {
		expression,
		awaitPromise: true,
		returnByValue: true,
	});
	if (res.exceptionDetails)
		throw new Error(JSON.stringify(res.exceptionDetails.exception?.description));
	return res.result.value;
}

async function shot(name) {
	mkdirSync(OUT, { recursive: true });
	const { data } = await send("Page.captureScreenshot", { format: "png" });
	const path = join(OUT, `${name}.png`);
	writeFileSync(path, Buffer.from(data, "base64"));
	return path;
}

/*
 * The measurement that motivates the change: how far the alert sits from the
 * composer whose text it names. Reported on the sibling PR as 525px at y=0.
 */
const MEASURE = `(() => {
  const composerForm = document.querySelector('[data-tour-tag="chat-input-textarea"]')?.closest('form');
  // Scoped to the composer's own form: the app has other live alerts (the
  // backend-offline strip at the top of the window), and an unscoped query
  // would measure one of those instead of the one under test.
  const alert = composerForm?.querySelector('[role="alert"]') ?? null;
  const composer = document.querySelector('[data-tour-tag="chat-input-textarea"]');
  const ta = document.querySelector('[data-tour-tag="chat-input-textarea"] textarea');
  const echo = alert && Array.from(alert.querySelectorAll('p')).find(p =>
    ta && p.textContent.trim() && ta.value.trim() && p.textContent.includes(ta.value.trim()));
  const a = alert?.getBoundingClientRect();
  const c = composer?.getBoundingClientRect();
  return {
    alertPresent: Boolean(alert),
    alertText: alert?.textContent?.replace(/\\s+/g, ' ').trim().slice(0, 260) ?? null,
    alertTop: a ? Math.round(a.top) : null,
    composerTop: c ? Math.round(c.top) : null,
    gapPx: a && c ? Math.round(c.top - a.bottom) : null,
    alertLeft: a ? Math.round(a.left) : null,
    composerLeft: c ? Math.round(c.left) : null,
    edgeDeltaPx: a && c ? Math.round(Math.abs(a.left - c.left)) : null,
    textareaValue: ta?.value ?? null,
    textareaEditable: ta ? !ta.disabled && !ta.readOnly : null,
    echoedCopyPresent: Boolean(echo),
    actionLabels: alert ? Array.from(alert.querySelectorAll('button')).map(b => b.textContent.trim()) : [],
  };
})()`;

const measured = await evaluate(MEASURE);
const file = await shot(STEP);
console.log(JSON.stringify({ step: STEP, file, ...measured }, null, 2));
ws.close();
