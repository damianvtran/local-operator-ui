#!/usr/bin/env node
/**
 * The ask-badge set's capture rig: frames + the page's own readout, offline.
 *
 *     node docs/evidence/ask-badge-quiet/harness/capture.mjs [origin] [outdir]
 *       origin  a Storybook serving this checkout   (default http://localhost:6017)
 *       outdir  where frames + readouts land        (default ./frames/<run label>)
 *
 * A private headless Chrome (mock keychain, profile under /tmp named for this
 * process, SIGKILLed on exit — `scripts/chrome-keychain.mjs`), driven over raw
 * CDP: the same approach as `scripts/header-cluster-geometry.mjs`, whose driver
 * this is cribbed from because that file is measure-only and this set needs the
 * frame AND the numbers. PNGs on purpose: `check-evidence.mjs`'s frame walker
 * counts `.webp` only, so a hand-driven set cannot be mistaken for sweep output
 * (the `read-ack-skew` set's precedent).
 *
 * RUN THE PAIR:
 *   git -C <worktree> stash-free before-tree storybook  (or a clean checkout)
 *   node .../capture.mjs http://localhost:6017 docs/evidence/ask-badge-quiet/frames/before
 *   ...apply the fix, storybook picks it up...
 *   node .../capture.mjs http://localhost:6017 docs/evidence/ask-badge-quiet/frames/after
 *
 * Stories: `chat-header-cluster--asks-waiting` (asksCount=3, session scope) and
 * `chat-header-cluster--asks-fleet` (asksCount=11), each at localOperatorDark and
 * localOperatorLight, viewport 560x84 — the header cluster's own band, the same
 * size `scripts/capture-evidence.mjs` uses for this story's siblings.
 *
 * What the readout records, and why those fields: the badge's box (top before
 * and after the fix is the defect), the ring's painted spread (`ringPx`), the
 * computed font size / line height / height (the register change), and the
 * header's and trigger's boxes (the row height must not move).
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const { withMockKeychain } = await import(
	join(ROOT, "scripts", "chrome-keychain.mjs")
);

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT = /DevTools listening on (ws:\/\/[^\s]+)/;

const [ORIGIN = "http://localhost:6017", OUTDIR] = process.argv.slice(2);
if (!OUTDIR) {
	console.error(
		"usage: capture.mjs [origin] <outdir>   (outdir is where frames land; name it before/ or after/)",
	);
	process.exit(2);
}

const STORIES = [
	["chat-header-cluster--asks-waiting", "localOperatorDark"],
	["chat-header-cluster--asks-waiting", "localOperatorLight"],
	["chat-header-cluster--asks-fleet", "localOperatorDark"],
	["chat-header-cluster--asks-fleet", "localOperatorLight"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		ws.addEventListener("message", (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
			}
		});
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
const teardown = () => {
	if (chrome) {
		chrome.kill("SIGKILL");
		chrome = null;
	}
	if (dataDir) {
		rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
		dataDir = null;
	}
};

/* The page's own readout: the ask badge's box and the clip-relevant styles. */
const PROBE = `(() => {
	const round = (n) => Math.round(n * 10) / 10;
	const box = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { left: round(r.left), top: round(r.top), right: round(r.right),
			bottom: round(r.bottom), width: round(r.width), height: round(r.height) };
	};
	const header = document.querySelector('[data-tour-tag="chat-header"]');
	const trigger = document.querySelector('[data-tour-tag="ask-pane-trigger"]');
	const badge = document.querySelector('[data-tour-tag="ask-pane-badge"]');
	const bs = badge ? getComputedStyle(badge) : null;
	const ring = (() => {
		if (!badge) return 0;
		const s = getComputedStyle(badge).boxShadow;
		if (!s || s === "none") return 0;
		const l = [...s.matchAll(/(-?[\\d.]+)px/g)].map((m) => Math.abs(Number(m[1])));
		return l.length ? Math.max(...l) : 0;
	})();
	const hb = box(header), tb = box(trigger), bb = box(badge);
	return {
		viewport: { w: window.innerWidth, h: window.innerHeight },
		headerBox: hb, triggerBox: tb, badgeBox: bb,
		badgeText: badge ? badge.textContent : null,
		badgeClass: badge ? badge.className : null,
		badgeFontSize: bs ? bs.fontSize : null,
		badgeLineHeight: bs ? bs.lineHeight : null,
		badgeCssHeight: bs ? bs.height : null,
		badgeOverflow: bs ? bs.overflow : null,
		ringPx: ring,
		badgeTopVsHeader: bb && hb ? round(bb.top - hb.top) : null,
		badgeTopVsViewport: bb ? round(bb.top) : null,
		badgeOverhangAboveTrigger: tb && bb ? round(tb.top - bb.top) : null,
		triggerTopVsHeader: tb && hb ? round(tb.top - hb.top) : null,
	};
})()`;

const main = async () => {
	mkdirSync(OUTDIR, { recursive: true });
	dataDir = join(tmpdir(), `lo-ask-badge-${process.pid}`);
	mkdirSync(dataDir, { recursive: true });

	chrome = spawn(
		CHROME,
		withMockKeychain([
			"--headless=new",
			"--no-sandbox",
			"--disable-gpu",
			"--hide-scrollbars",
			`--user-data-dir=${dataDir}`,
			"--remote-debugging-port=0",
			"about:blank",
		]),
	);

	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const t = setTimeout(() => reject(new Error("Chrome did not report a debug port")), 30_000);
		chrome.stderr.on("data", (d) => {
			buf += d.toString();
			const m = buf.match(DEBUG_PORT);
			if (m) { clearTimeout(t); resolve(m[1]); }
		});
		chrome.on("exit", (code) => reject(new Error(`Chrome exited early (${code})`)));
	});

	const { host } = new URL(wsUrl);
	const list = await fetch(`http://${host}/json`).then((r) => r.json());
	const target = list.find((t) => t.type === "page");
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", reject, { once: true });
	});
	const cdp = new Cdp(ws);
	await cdp.send("Page.enable");

	for (const [story, theme] of STORIES) {
		await cdp.send("Emulation.setDeviceMetricsOverride", {
			width: 560, height: 84, deviceScaleFactor: 1, mobile: false,
		});
		await cdp.send("Page.navigate", { url: "about:blank" });
		await sleep(120);
		await cdp.send("Page.navigate", {
			url: `${ORIGIN}/iframe.html?id=${story}&viewMode=story&args=theme:${theme}`,
		});
		let ready = false;
		for (let i = 0; i < 120 && !ready; i++) {
			const { result } = await cdp.send("Runtime.evaluate", {
				returnByValue: true,
				expression: `(() => {
					const loading = [...document.querySelectorAll(
						".sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-loader",
					)].some((el) => el.getBoundingClientRect().height > 0);
					if (loading) return false;
					if (document.fonts.status !== "loaded") return false;
					if (!document.querySelector('[data-tour-tag="chat-header"]')) return false;
					return document.querySelector('[data-tour-tag="ask-pane-badge"]') !== null;
				})()`,
			});
			ready = result.value === true;
			if (!ready) await sleep(250);
		}
		if (!ready) throw new Error(`${story} @ ${theme}: never became measurable`);
		/* One settled frame after layout, so the rects are post-reflow. */
		await cdp.send("Runtime.evaluate", {
			awaitPromise: true,
			expression: "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))",
		});

		const { result } = await cdp.send("Runtime.evaluate", {
			returnByValue: true, expression: PROBE,
		});
		const shot = await cdp.send("Page.captureScreenshot", {
			format: "png",
			clip: { x: 0, y: 0, width: 560, height: 84, scale: 1 },
		});
		const leaf = `${story.split("--")[1]}-${theme}`;
		writeFileSync(join(OUTDIR, `${leaf}.png`), Buffer.from(shot.data, "base64"));
		writeFileSync(
			join(OUTDIR, `${leaf}.readout.json`),
			JSON.stringify(result.value, null, 2),
		);
		console.log(`${leaf}: wrote frame + readout`);
	}
};

try {
	await main();
} finally {
	teardown();
}
