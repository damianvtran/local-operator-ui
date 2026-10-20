#!/usr/bin/env node
/**
 * C6 geometry proof: the SHARED selection strip in a SCROLLED transcript.
 *
 *     node scripts/shared-strip-scrolled-proof.mjs --origin http://localhost:6044 --out <dir>
 *
 * Why this is a separate probe rather than a story. The shared strip owns every
 * selection a quote/link strip does not: a tool row, a fold header, a receipt.
 * No story holds that state - the selection stories all select quotable prose,
 * which raises the quote strip - and the `browser` tool exposes no drag or
 * Selection API. This probe constructs the state the way a reader does: open
 * the fold, scroll the row to the top of the pane, highlight its text, then
 * read where the strip lands.
 *
 * THE CLAIM. The shared strip's flip is asked against the SCROLL VIEWPORT. A
 * line within 40px of the pane's top has no room above it, so the strip must
 * sit BELOW the selection; asking against the scrolled content column instead
 * (the pre-fix code) always answers "room above" and paints the strip off the
 * top of the pane. The reading reports both boxes so the difference is a
 * number, not an impression.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMockKeychain } from "./chrome-keychain.mjs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ARGS = process.argv.slice(2);
const flag = (name, fallback = null) => {
	const inline = ARGS.find((a) => a.startsWith(`--${name}=`));
	if (inline) return inline.slice(name.length + 3);
	const index = ARGS.findIndex((a) => a === `--${name}`);
	if (index !== -1 && index + 1 < ARGS.length) return ARGS[index + 1];
	return fallback;
};
const ORIGIN = flag("origin", "http://localhost:6044");
const OUT = flag("out");
if (!OUT) {
	console.error("--out <dir> is required");
	process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEVTOOLS_URL = /DevTools listening on (ws:\/\/[^\s]+)/;

class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		ws.addEventListener("message", (ev) => {
			const raw = typeof ev.data === "string" ? ev.data : ev.data?.toString?.();
			if (!raw) return;
			const msg = JSON.parse(raw);
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
		rmSync(dataDir, { recursive: true, force: true, maxRetries: 10 });
		dataDir = null;
	}
};

const evaluate = async (cdp, expression) => {
	const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
		expression,
		returnByValue: true,
		awaitPromise: true,
	});
	if (exceptionDetails) {
		throw new Error(
			`the page threw: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`,
		);
	}
	return result.value;
};

async function launch() {
	dataDir = mkdtempSync(join(tmpdir(), "lo-shared-strip-"));
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
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const timer = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		chrome.stderr.on("data", (d) => {
			buf += d.toString();
			const match = buf.match(DEVTOOLS_URL);
			if (match) {
				clearTimeout(timer);
				resolve(match[1]);
			}
		});
		chrome.on("exit", (code) =>
			reject(new Error(`Chrome exited early (${code})`)),
		);
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
	await cdp.send("Runtime.enable");
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: 1440,
		height: 900,
		deviceScaleFactor: 1,
		mobile: false,
	});
	return cdp;
}

const waitForSelector = async (cdp, selector, timeoutMs = 60_000) => {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (
			await evaluate(
				cdp,
				`Boolean(document.querySelector(${JSON.stringify(selector)}))`,
			)
		)
			return;
		if (Date.now() > deadline) {
			throw new Error(`the page never grew ${selector} within ${timeoutMs}ms`);
		}
		await sleep(200);
	}
};

const main = async () => {
	const cdp = await launch();
	const story = "chat-canonical-transcript-copy--context-menu-on-tool-row";
	await cdp.send("Page.navigate", {
		url: `${ORIGIN}/iframe.html?id=${story}&viewMode=story&rig=shared`,
	});
	await waitForSelector(cdp, '[data-record-kind="tool"]');

	// Close the story's context menu: the strip's geometry is the subject.
	await cdp.send("Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27,
	});
	await cdp.send("Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "Escape",
		code: "Escape",
		windowsVirtualKeyCode: 27,
	});
	await sleep(300);

	/*
	 * Put the tool row's first line within 40px of the pane's top. The
	 * transcript scroller is `flex-col-reverse`, so `scrollIntoView` is the
	 * honest instrument rather than arithmetic on `scrollTop`; then one
	 * frame-relative adjustment pins the row's first line to 12px.
	 */
	const geometry = await evaluate(
		cdp,
		`(() => {
			const scroller = document.querySelector("[data-lo-canonical-transcript]");
			const row = document.querySelector('[data-record-kind="tool"]');
			if (!scroller || !row) return { missing: true };
			row.scrollIntoView({ block: "start" });
			return { ok: true };
		})()`,
	);
	if (!geometry?.ok)
		throw new Error(`no tool row: ${JSON.stringify(geometry)}`);
	await sleep(300);
	await evaluate(
		cdp,
		`(() => {
			const scroller = document.querySelector("[data-lo-canonical-transcript]");
			const row = document.querySelector('[data-record-kind="tool"]');
			const delta = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
			scroller.scrollTop += delta;
			return true;
		})()`,
	);
	await sleep(400);

	const reading = await evaluate(
		cdp,
		`(() => {
			const scroller = document.querySelector("[data-lo-canonical-transcript]");
			const row = document.querySelector('[data-record-kind="tool"]');
			const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
			let text = null;
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				if (node.data.trim().length > 0) { text = node; break; }
			}
			if (!text) return { missing: "text" };
			const range = document.createRange();
			range.selectNodeContents(text);
			const selection = window.getSelection();
			selection.removeAllRanges();
			selection.addRange(range);
			document.dispatchEvent(new Event("selectionchange"));
			document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
			return { selected: range.toString().slice(0, 60) };
		})()`,
	);
	if (reading?.missing)
		throw new Error(`no selectable text: ${JSON.stringify(reading)}`);
	/*
	 * SELECT AND READ IN ONE PAGE-SIDE LOOP. The story's play opens a Radix
	 * context menu, and its close restores focus asynchronously - a selection
	 * made too early is collapsed under the probe. So the loop re-selects,
	 * waits two frames, and only answers when the strip it is looking for is in
	 * the DOM. The context menu is dismissed first with Escape.
	 */
	for (const type of ["keyDown", "keyUp"]) {
		await cdp.send("Input.dispatchKeyEvent", {
			type,
			key: "Escape",
			code: "Escape",
			windowsVirtualKeyCode: 27,
			nativeVirtualKeyCode: 27,
		});
	}
	await sleep(600);

	const settle = await evaluate(
		cdp,
		`(async () => {
			const scroller = document.querySelector("[data-lo-canonical-transcript]");
			const content = document.querySelector("[data-lo-transcript-content]");
			const row = document.querySelector('[data-record-kind="tool"]');
			if (!scroller || !content || !row) return { missing: "row" };
			const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
			let text = null;
			for (let node = walker.nextNode(); node; node = walker.nextNode()) {
				if (node.data.trim().length > 0) { text = node; break; }
			}
			if (!text) return { missing: "text" };
			const frame = () =>
				new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
			for (let attempt = 0; attempt < 30; attempt++) {
				const range = document.createRange();
				range.selectNodeContents(text);
				const selection = window.getSelection();
				selection.removeAllRanges();
				selection.addRange(range);
				document.dispatchEvent(new Event("selectionchange"));
				document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
				await frame();
				await frame();
				if (document.querySelector("[data-lo-selection-toolbar]")) {
					return { selected: selection.toString().slice(0, 80), attempt };
				}
				await new Promise((resolve) => setTimeout(resolve, 80));
			}
			return { selected: window.getSelection()?.toString() ?? "", failed: true };
		})()`,
	);
	if (settle?.missing)
		throw new Error(`no selectable tool row: ${JSON.stringify(settle)}`);

	const boxes = await evaluate(
		cdp,
		`(() => {
			const round = (n) => Math.round(n * 10) / 10;
			const ofRect = (r) =>
				r
					? { top: round(r.top), bottom: round(r.bottom), left: round(r.left), right: round(r.right), height: round(r.height) }
					: null;
			const box = (el) => (el ? ofRect(el.getBoundingClientRect()) : null);
			const scroller = document.querySelector("[data-lo-canonical-transcript]");
			const content = document.querySelector("[data-lo-transcript-content]");
			const sel = window.getSelection();
			const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
			const strip = document.querySelector("[data-lo-selection-toolbar]");
			const quote = document.querySelector("[data-lo-quote-toolkit]");
			return {
				selectionText: sel ? sel.toString().slice(0, 80) : null,
				anchorInside: Boolean(sel?.anchorNode && content?.contains(sel.anchorNode)),
				peerStrips: document.querySelectorAll(
					"[data-lo-quote-toolkit], [data-lo-link-toolbar]",
				).length,
				scrollTop: round(scroller.scrollTop),
				scroller: box(scroller),
				content: box(content),
				selection: range ? ofRect(range.getBoundingClientRect()) : null,
				shared: box(strip),
				quote: box(quote),
				sharedPresent: strip !== null,
				quotePresent: quote !== null,
			};
		})()`,
	);

	const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
	writeFileSync(
		join(OUT, "shared-strip-scrolled-top.png"),
		Buffer.from(data, "base64"),
	);
	writeFileSync(
		join(OUT, "shared-strip-scrolled-top.json"),
		JSON.stringify(boxes, null, "\t"),
	);

	const failures = [];
	if (!boxes.sharedPresent)
		failures.push("the shared strip did not mount for a tool-row selection");
	if (boxes.quotePresent)
		failures.push("a quote strip mounted for a non-quotable row");
	if (boxes.shared && boxes.selection) {
		const above = boxes.shared.bottom <= boxes.selection.top;
		if (boxes.selection.top - boxes.scroller.top < 40 && above) {
			failures.push(
				"the strip sits ABOVE a selection at the pane's top - it is off-screen",
			);
		}
		if (boxes.shared.top < boxes.scroller.top) {
			failures.push("the strip's top is above the visible pane");
		}
	}
	teardown();
	if (failures.length > 0) {
		console.error(JSON.stringify(boxes, null, 1));
		console.error(`FAIL (${failures.length})`);
		for (const failure of failures) console.error(`  - ${failure}`);
		process.exit(1);
	}
	console.log("OK — the shared strip flips below a top-edge selection");
	console.log(JSON.stringify(boxes, null, 1));
};

main().catch((error) => {
	teardown();
	console.error(error);
	process.exit(1);
});
