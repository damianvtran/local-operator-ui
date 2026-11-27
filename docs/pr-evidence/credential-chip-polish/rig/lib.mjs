// Evidence rig for the credential-chip PR (run via scripts/with-storybook.mjs, which sets STORYBOOK_ORIGIN). Same approach as
// scripts/credential-chip-geometry.mjs: private headless Chrome over raw CDP,
// mock keychain, scratch profile, killed on exit.
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import zlib from "node:zlib";
const REPO = new URL("../../../../", import.meta.url).pathname.replace(
	/\/$/,
	"",
);
const { withMockKeychain } = await import(
	`${REPO}/scripts/chrome-keychain.mjs`
);
export const ORIGIN = process.env.STORYBOOK_ORIGIN;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		this.handlers = new Map();
		ws.addEventListener("message", (ev) => {
			const m = JSON.parse(ev.data);
			if (m.id !== undefined && this.pending.has(m.id)) {
				const { resolve, reject } = this.pending.get(m.id);
				this.pending.delete(m.id);
				m.error ? reject(new Error(m.error.message)) : resolve(m.result);
			} else if (m.method && this.handlers.has(m.method))
				this.handlers.get(m.method)(m.params);
		});
	}
	on(method, fn) {
		this.handlers.set(method, fn);
	}
	send(method, params = {}) {
		const id = ++this.next;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) =>
			this.pending.set(id, { resolve, reject }),
		);
	}
}
let chrome = null;
let dataDir = null;
export const teardown = () => {
	if (chrome) {
		chrome.kill("SIGKILL");
		chrome = null;
	}
	if (dataDir) {
		rmSync(dataDir, {
			recursive: true,
			force: true,
			maxRetries: 10,
			retryDelay: 100,
		});
		dataDir = null;
	}
};
process.on("exit", teardown);
export const launch = async () => {
	dataDir = join(tmpdir(), `lo-chip-rig-${process.pid}`);
	mkdirSync(dataDir, { recursive: true });
	chrome = spawn(
		CHROME,
		withMockKeychain([
			"--headless=new",
			"--no-sandbox",
			"--hide-scrollbars",
			`--user-data-dir=${dataDir}`,
			"--remote-debugging-port=0",
			"about:blank",
		]),
	);
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		chrome.stderr.on("data", (d) => {
			buf += d;
			const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
			if (m) resolve(m[1]);
		});
		chrome.on("exit", (c) => reject(new Error(`chrome exit ${c}`)));
	});
	const { host } = new URL(wsUrl);
	const list = await fetch(`http://${host}/json`).then((r) => r.json());
	const target = list.find((t) => t.type === "page");
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((res, rej) => {
		ws.addEventListener("open", res, { once: true });
		ws.addEventListener("error", rej, { once: true });
	});
	const cdp = new Cdp(ws);
	await cdp.send("Page.enable");
	return cdp;
};
export const evaluate = async (cdp, expression, awaitPromise = true) => {
	const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
		returnByValue: true,
		awaitPromise,
		expression,
	});
	if (exceptionDetails)
		throw new Error(exceptionDetails.exception?.description ?? "eval failed");
	return result.value;
};
export const openStory = async (
	cdp,
	id,
	{
		theme = "localOperatorDark",
		width = 1024,
		height = 300,
		ready = "[data-credential-chips],[data-credential-run],[data-credential-chip]",
	} = {},
) => {
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width,
		height,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await cdp.send("Page.navigate", { url: "about:blank" });
	await sleep(120);
	await cdp.send("Page.navigate", {
		url: `${ORIGIN}/iframe.html?id=${id}&viewMode=story&args=theme:${theme}`,
	});
	for (let i = 0; i < 600; i++) {
		const ok = await evaluate(
			cdp,
			`(() => { try { const loading = [...document.querySelectorAll(".sb-preparing-story,.sb-preparing-docs,.sb-nopreview,.sb-loader")].some(e=>e.getBoundingClientRect().height>0); if (loading) return false; if (document.documentElement.dataset.capturePending) return false; if (document.fonts.status!=="loaded") return false; return !!document.querySelector(${JSON.stringify(ready)}); } catch { return false; } })()`,
		);
		if (ok) break;
		await sleep(250);
		if (i === 599) throw new Error(`story ${id} never ready`);
	}
	await evaluate(
		cdp,
		"new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
	);
	await sleep(150);
};
export const shot = async (cdp, path, clip, scale = 2) => {
	const { data } = await cdp.send("Page.captureScreenshot", {
		format: "png",
		...(clip ? { clip: { ...clip, scale } } : {}),
	});
	writeFileSync(path, Buffer.from(data, "base64"));
};
// Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced) for the frame analysis.
export const decodePng = (buf) => {
	let p = 8;
	let w;
	let h;
	let ct;
	const idat = [];
	while (p < buf.length) {
		const len = buf.readUInt32BE(p);
		const type = buf.toString("ascii", p + 4, p + 8);
		const data = buf.subarray(p + 8, p + 8 + len);
		if (type === "IHDR") {
			w = data.readUInt32BE(0);
			h = data.readUInt32BE(4);
			ct = data[9];
		} else if (type === "IDAT") idat.push(data);
		p += 12 + len;
	}
	const bpp = ct === 6 ? 4 : 3;
	const raw = zlib.inflateSync(Buffer.concat(idat));
	const stride = w * bpp;
	const out = Buffer.alloc(h * stride);
	for (let y = 0; y < h; y++) {
		const f = raw[y * (stride + 1)];
		const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		for (let x = 0; x < stride; x++) {
			const a = x >= bpp ? out[y * stride + x - bpp] : 0;
			const b = y ? out[(y - 1) * stride + x] : 0;
			const c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
			let v = row[x];
			if (f === 1) v += a;
			else if (f === 2) v += b;
			else if (f === 3) v += (a + b) >> 1;
			else if (f === 4) {
				const pp = a + b - c;
				const pa = Math.abs(pp - a);
				const pb = Math.abs(pp - b);
				const pc = Math.abs(pp - c);
				v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			out[y * stride + x] = v & 255;
		}
	}
	return { w, h, bpp, px: out };
};
