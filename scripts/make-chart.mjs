#!/usr/bin/env node
/**
 * Renders one small bar-chart png for the media-in-conversation scene's
 * "the agent plotted it" screenshot, using the capture rig's own private
 * headless Chrome.
 *
 *     node scripts/make-chart.mjs <out.png>
 *
 * The chart is plain inline SVG on a white ground, which is what a plot
 * produced by a script looks like: it is an ARTIFACT here, not app chrome, so
 * it deliberately does not wear the app's palette.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMockKeychain } from "./chrome-keychain.mjs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT_LINE = /DevTools listening on (ws:\/\/[^\s]+)/;
const out = process.argv[2];
if (!out) {
	console.error("usage: node scripts/make-chart.mjs <out.png>");
	process.exit(1);
}

/* Scale: 6,000 USD over 130 px of plot height, baseline y=150. */
const plot = (v) => 150 - (v * 130) / 6000;
const bar = (x, w, v) => {
	const h = (v * 130) / 6000;
	return `<rect x="${x}" y="${150 - h}" width="${w}" height="${h}" fill="#2f9e44"/>`;
};
const tick = (v) =>
	`<line x1="40" y1="${plot(v)}" x2="424" y2="${plot(v)}" stroke="#ececec"/>` +
	`<text x="34" y="${plot(v) + 3}" font-size="9" fill="#8a8a8a" text-anchor="end">${v.toLocaleString("en-US")}</text>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
	body { margin: 0; background: #ffffff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
	.wrap { padding: 12px 14px; }
	.title { font-size: 12.5px; font-weight: 600; color: #1b1b1b; margin-bottom: 4px; }
	.unit { font-size: 9.5px; color: #8a8a8a; margin-bottom: 2px; }
</style></head><body><div class="wrap">
	<div class="title">Outstanding at the end of March</div>
	<div class="unit">USD</div>
	<svg width="432" height="186" viewBox="0 0 432 186" xmlns="http://www.w3.org/2000/svg">
		${tick(2000)}${tick(4000)}${tick(6000)}
		<line x1="40" y1="150" x2="424" y2="150" stroke="#d0d0d0"/>
		<line x1="40" y1="150" x2="40" y2="16" stroke="#d0d0d0"/>
		<text x="34" y="153" font-size="9" fill="#8a8a8a" text-anchor="end">0</text>
		${bar(95, 90, 4820)}
		${bar(265, 90, 1150)}
		<text x="140" y="168" font-size="10.5" fill="#333" text-anchor="middle">Contoso · 4,820</text>
		<text x="310" y="168" font-size="10.5" fill="#333" text-anchor="middle">Fabrikam · 1,150</text>
	</svg>
</div></body></html>`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dataDir = mkdtempSync(join(tmpdir(), "lo-chart-"));
const htmlPath = join(dataDir, "chart.html");
writeFileSync(htmlPath, html);

const chrome = spawn(
	CHROME,
	withMockKeychain([
		"--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		"--hide-scrollbars",
		`--user-data-dir=${dataDir}`,
		"--remote-debugging-port=0",
		"--password-store=basic",
		"--no-first-run",
		"--no-default-browser-check",
		"about:blank",
	]),
	{ detached: true, stdio: ["ignore", "ignore", "pipe"] },
);

try {
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const t = setTimeout(() => reject(new Error("no debug port")), 30_000);
		chrome.stderr.on("data", (d) => {
			buf += d.toString();
			const m = buf.match(DEBUG_PORT_LINE);
			if (m) {
				clearTimeout(t);
				resolve(m[1]);
			}
		});
	});
	const { host } = new URL(wsUrl);
	const list = await fetch(`http://${host}/json`).then((r) => r.json());
	const target = list.find((t) => t.type === "page");
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", reject, { once: true });
	});
	let id = 0;
	const pending = new Map();
	ws.addEventListener("message", (ev) => {
		const msg = JSON.parse(ev.data);
		const entry = pending.get(msg.id);
		if (!entry) return;
		pending.delete(msg.id);
		if (msg.error) entry.reject(new Error(msg.error.message));
		else entry.resolve(msg.result);
	});
	const send = (method, params = {}) =>
		new Promise((resolve, reject) => {
			const mid = ++id;
			pending.set(mid, { resolve, reject });
			ws.send(JSON.stringify({ id: mid, method, params }));
		});

	await send("Page.enable");
	await send("Emulation.setDeviceMetricsOverride", {
		width: 460,
		height: 240,
		deviceScaleFactor: 2,
		mobile: false,
	});
	await send("Page.navigate", { url: `file://${htmlPath}` });
	await sleep(900);
	const { data } = await send("Page.captureScreenshot", { format: "png" });
	writeFileSync(out, Buffer.from(data, "base64"));
	console.log(
		`chart written: ${out} (${Buffer.byteLength(data, "base64")} bytes)`,
	);
} finally {
	try {
		process.kill(-chrome.pid, "SIGTERM");
	} catch {}
	await sleep(800);
	try {
		process.kill(-chrome.pid, "SIGKILL");
	} catch {}
	rmSync(dataDir, { recursive: true, force: true });
}
