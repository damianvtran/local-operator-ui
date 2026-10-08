#!/usr/bin/env node
/**
 * The #895 pair: what sits at the conversation column's edges, before and after
 * the column's two resize handles (and the persisted `chatMeasureWidth`) are
 * removed.
 *
 *     node scripts/chat-measure-handles-removed-evidence.mjs \
 *         --label before|after --origin http://localhost:<storybook-port>
 *
 * ONE RIG, RUN ONCE PER TREE. The label only decides which expectations the run
 * asserts and which folder it writes; the measuring and the shooting are the same
 * code on both trees, and it imports nothing the change deletes, which is what
 * makes the two folders a like-for-like comparison. `before` is run from a
 * Storybook served by the unmodified `origin/main` source; `after` from this
 * branch's.
 *
 * WHAT THE FRAMES ARE (3 states x 2 palettes per tree), each a real pointer
 * parked by `Input.dispatchMouseEvent` and held past `HOVER_INTENT_MS` (200 ms,
 * `resizable-divider.tsx`) before the shutter:
 *
 *   - `left-strip`        1180x900, no panel. The pointer sits on the centre of
 *                         the strip the left handle used to occupy: the 10px just
 *                         outboard of the content column's left edge.
 *   - `right-strip-panel` 1512x900, the run panel open at its default width. The
 *                         pointer sits on the right strip, which is the one that
 *                         sat beside the panel's divider.
 *   - `divider-control`   the same 1512 scene with the pointer on the panel's
 *                         divider itself: the control, which must light the
 *                         divider's own line on BOTH trees.
 *
 * WHAT THE RUN READS, IN THE PAGE, AND ASSERTS AS RELATIONS (a wrong reading
 * fails the run; it never prints a table instead):
 *
 *   - at EVERY pixel of both strips, `document.elementsFromPoint` contains a
 *     `[data-lo-chat-measure-handle]` and the top element's computed `cursor` is
 *     `col-resize` on `before`; on `after` it contains none and the cursor is not
 *     `col-resize`;
 *   - at the centre of the sidebar divider (both sizes) and the panel divider the
 *     top element is a separator whose cursor IS `col-resize` on both trees (the
 *     control: the dividers kept their own);
 *   - the content column's computed `max-width` is `810px` and, at the
 *     unconstrained 1180 size, it is 810px wide, on both trees.
 *
 * THE MIGRATION READING (the real path, not the unit cell): before the page's
 * scripts run, `Page.addScriptToEvaluateOnNewDocument` seeds
 * `localStorage['ui-preferences-storage']` with a version-1 blob carrying
 * `chatMeasureWidth: 1100`. After hydration, `before` must read an 1100px column
 * (the override applied) and `after` an 810px one, a stored blob at version 2 with
 * no `chatMeasureWidth`, and an empty `--lo-chat-measure-override` on the root.
 *
 * Raw CDP against ONE private headless Chrome (mock-keychain switch, a scratch
 * `--user-data-dir`, its own process group, reaped by exact pid), the launch
 * discipline of `chat-measure-evidence.mjs`. Every frame passes
 * `assertFramePaints` before it is written. The readings are written beside the
 * frames as `readings.json`, which the folder's README tabulates.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFramePaints } from "./check-evidence.mjs";
import { withMockKeychain } from "./chrome-keychain.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_ROOT = join(ROOT, "docs", "evidence", "chat-measure-handles-removed");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const argValue = (name) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? undefined : process.argv[at + 1];
};
const LABEL = argValue("--label");
const ORIGIN = argValue("--origin");
if (!["before", "after"].includes(LABEL) || !ORIGIN) {
	console.error(
		"usage: chat-measure-handles-removed-evidence.mjs --label before|after --origin <storybook-origin>",
	);
	process.exit(2);
}
const OUT = join(OUT_ROOT, LABEL);
const BEFORE = LABEL === "before";

const THEMES = ["localOperatorLight", "localOperatorDark"];
const STORY_ALONE = "shell-app-shell--chat-measure-edges";
const STORY_PANEL = "shell-app-shell--chat-measure-edges-run-panel";
const SIZE_ALONE = { width: 1180, height: 900 };
const SIZE_PANEL = { width: 1512, height: 900 };

/** `HOVER_INTENT_MS` is 200; the margin keeps the shutter off the timer's edge. */
const HOLD_MS = 320;
const SHIPPED_MEASURE = "810px";
const SEED_WIDTH = 1100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DEVTOOLS_URL = /DevTools listening on (ws:\/\/[^\s]+)/;

const failures = [];
const check = (ok, message) => {
	if (!ok) failures.push(message);
};

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
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
		});
	}

	async evaluate(expression) {
		const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
			returnByValue: true,
			awaitPromise: true,
			expression,
		});
		if (exceptionDetails) {
			throw new Error(`page threw: ${exceptionDetails.text}`);
		}
		return result.value;
	}

	mouse(x, y) {
		return this.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: Math.round(x),
			y: Math.round(y),
			button: "none",
			buttons: 0,
			pointerType: "mouse",
		});
	}
}

let chrome = null;
let dataDir = null;

/** Reaps the browser's whole process group by the pid this run created. */
const teardown = () => {
	if (chrome?.pid) {
		try {
			process.kill(-chrome.pid, "SIGKILL");
		} catch {
			/* already gone */
		}
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

const launch = async () => {
	dataDir = mkdtempSync(join(tmpdir(), "lo-chat-measure-handles-removed-"));
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
		{ detached: true },
	);
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const timer = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		chrome.stderr.on("data", (d) => {
			buf += d.toString();
			const m = buf.match(DEVTOOLS_URL);
			if (m) {
				clearTimeout(timer);
				resolve(m[1]);
			}
		});
		chrome.on("exit", (code) => reject(new Error(`Chrome exited (${code})`)));
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
	return cdp;
};

/**
 * The page-side reading. Everything is measured from the live DOM so the same
 * expression is valid on a tree that has the handles and one that does not.
 *
 * The strips are derived from the content column's own rect (the column's edge
 * and the 10px just outboard of it, where the handle's grab band sat) rather than
 * from a handle element, because on the `after` tree there is no handle to ask.
 * Each probe is a WHOLE-pixel x (the pixel whose left edge it names): Chrome
 * rounds a fractional `elementsFromPoint` x to the next pixel, so a half-pixel
 * probe on the strip's last pixel lands in whatever starts at the next one - the
 * panel divider's own hit band begins exactly where the right strip ends, which
 * is the reading this corrected.
 * `y` is the middle of the column's visible height: the handle spanned the
 * column's full height, so any y inside it hits the band.
 */
const READ = `(() => {
	const round = (n) => Math.round(n * 10) / 10;
	const scroller = document.querySelector("[data-lo-canonical-transcript]");
	const container = scroller ? scroller.parentElement : null;
	const col = document.querySelector("[data-lo-transcript-content]");
	if (!scroller || !container || !col) return null;
	const c = col.getBoundingClientRect();
	const k = container.getBoundingClientRect();
	const visibleH = Math.min(c.height, scroller.getBoundingClientRect().height);
	const y = round(c.top + visibleH / 2);
	const probe = (x) => {
		const stack = document.elementsFromPoint(x, y);
		const top = stack[0];
		return {
			x: round(x),
			handle: stack.some((el) => el.hasAttribute("data-lo-chat-measure-handle")),
			topCursor: top ? getComputedStyle(top).cursor : null,
			topRole: top ? top.getAttribute("role") : null,
		};
	};
	const sweep = (from, to) => {
		const out = [];
		for (let x = from; x <= to; x += 1) out.push(probe(x));
		return out;
	};
	const leftFrom = Math.ceil(c.left - 10);
	const rightFrom = Math.floor(c.right);
	const left = sweep(leftFrom, leftFrom + 9);
	const right = sweep(rightFrom, rightFrom + 9);
	const centre = (el) => {
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { left: round(r.left), right: round(r.right), x: round(r.left + r.width / 2), y: round(r.top + r.height / 2) };
	};
	const sidebar = document.querySelector('[role="separator"][aria-label^="Resize the sidebar"]');
	const panel = document.querySelector('[role="separator"][aria-label^="Resize run details"]');
	const dividerReading = (el) => {
		const r = centre(el);
		if (!r) return null;
		const stack = document.elementsFromPoint(r.x, r.y);
		return { ...r, topRole: stack[0]?.getAttribute("role") ?? null, topCursor: stack[0] ? getComputedStyle(stack[0]).cursor : null };
	};
	return {
		container: { left: round(k.left), right: round(k.right), width: round(k.width) },
		column: { left: round(c.left), right: round(c.right), width: round(c.width), maxWidth: getComputedStyle(col).maxWidth, position: getComputedStyle(col).position },
		y,
		leftStrip: { from: leftFrom, to: leftFrom + 9, distanceFromContainerLeft: round(c.left - k.left), pixels: left },
		rightStrip: { from: rightFrom, to: rightFrom + 9, distanceFromContainerRight: round(k.right - c.right), pixels: right },
		handlesInDom: document.querySelectorAll("[data-lo-chat-measure-handle]").length,
		sidebarDivider: dividerReading(sidebar),
		panelDivider: dividerReading(panel),
		override: document.documentElement.style.getPropertyValue("--lo-chat-measure-override"),
	};
})()`;

const openStory = async (cdp, story, size, theme) => {
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		...size,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await cdp.send("Page.navigate", { url: "about:blank" });
	await sleep(120);
	await cdp.send("Page.navigate", {
		url: `${ORIGIN}/iframe.html?id=${story}&viewMode=story&args=theme:${theme}`,
	});
	for (let i = 0; i < 160; i++) {
		const ready = await cdp
			.evaluate(`(() => {
				const busy = [...document.querySelectorAll(
					".sb-preparing-story, .sb-preparing-docs, .sb-nopreview, .sb-loader, .sb-show-errordisplay",
				)].some((el) => el.getBoundingClientRect().height > 0);
				if (busy) return false;
				if (document.fonts.status !== "loaded") return false;
				/* the story's own shutter latch, if it holds one */
				if (document.documentElement.dataset.capturePending) return false;
				if (document.documentElement.dataset.captureFailed) return false;
				return !!document.querySelector("[data-lo-transcript-content] .lo-markdown");
			})()`)
			.catch(() => false);
		if (ready === true) break;
		if (i === 159) throw new Error(`${story} @ ${theme}: never became ready`);
		await sleep(250);
	}
	/* Layout settled: the column's rect is unchanged across two paint frames. */
	let last = null;
	for (let i = 0; i < 40; i++) {
		const now = await cdp.evaluate(
			`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(JSON.stringify(document.querySelector("[data-lo-transcript-content]").getBoundingClientRect())))))`,
		);
		if (now === last) return;
		last = now;
		await sleep(100);
	}
	throw new Error(`${story} @ ${theme}: the column never settled`);
};

const shoot = async (cdp, state, theme) => {
	const { data } = await cdp.send("Page.captureScreenshot", {
		format: "webp",
		quality: 88,
	});
	const dir = join(OUT, state);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${theme}.webp`);
	writeFileSync(file, Buffer.from(data, "base64"));
	await assertFramePaints(file, theme);
};

/** Parks the pointer from a neutral spot, then holds past the hover intent. */
const park = async (cdp, x, y) => {
	await cdp.mouse(40, 40);
	await sleep(60);
	await cdp.mouse(x, y);
	await sleep(HOLD_MS);
};

/** The relation each strip pixel must satisfy on this tree. */
const assertStrip = (name, strip) => {
	for (const p of strip.pixels) {
		const where = `${name} x=${p.x}`;
		if (BEFORE) {
			check(p.handle, `${where}: before tree has no handle under the pointer`);
			check(
				p.topCursor === "col-resize",
				`${where}: before tree cursor is ${p.topCursor}, expected col-resize`,
			);
		} else {
			check(!p.handle, `${where}: a measure handle is still under the pointer`);
			check(
				p.topCursor !== "col-resize",
				`${where}: cursor is still col-resize (${p.topRole ?? "no role"})`,
			);
		}
	}
};

const assertDivider = (name, divider) => {
	check(divider !== null, `${name}: divider not found`);
	if (!divider) return;
	check(
		divider.topRole === "separator" && divider.topCursor === "col-resize",
		`${name}: top element is ${divider.topRole}/${divider.topCursor}, expected separator/col-resize`,
	);
};

const summariseStrip = (strip) => ({
	pixels: strip.pixels.length,
	handlePixels: strip.pixels.filter((p) => p.handle).length,
	cursors: [...new Set(strip.pixels.map((p) => p.topCursor))],
	topRoles: [...new Set(strip.pixels.map((p) => p.topRole))],
});

const main = async () => {
	const cdp = await launch();
	const readings = { label: LABEL, origin: ORIGIN, themes: {} };
	mkdirSync(OUT, { recursive: true });

	for (const theme of THEMES) {
		const r = {};

		/* (a) 1180, no panel, pointer on the left strip. */
		await openStory(cdp, STORY_ALONE, SIZE_ALONE, theme);
		const alone = await cdp.evaluate(READ);
		check(alone, `${theme}: no reading at ${SIZE_ALONE.width}`);
		assertStrip(`${theme} 1180 left`, alone.leftStrip);
		assertStrip(`${theme} 1180 right`, alone.rightStrip);
		assertDivider(`${theme} 1180 sidebar divider`, alone.sidebarDivider);
		check(
			alone.column.maxWidth === SHIPPED_MEASURE,
			`${theme} 1180: max-width ${alone.column.maxWidth}, expected ${SHIPPED_MEASURE}`,
		);
		check(
			alone.column.width === 810,
			`${theme} 1180: the unconstrained column is ${alone.column.width}px wide, expected 810`,
		);
		check(
			alone.handlesInDom === (BEFORE ? 2 : 0),
			`${theme} 1180: ${alone.handlesInDom} handles in the DOM`,
		);
		await park(
			cdp,
			(alone.leftStrip.from + alone.leftStrip.to + 1) / 2,
			alone.y,
		);
		await shoot(cdp, "left-strip", theme);

		/* (b) + (c) 1512, panel open. */
		await openStory(cdp, STORY_PANEL, SIZE_PANEL, theme);
		const panel = await cdp.evaluate(READ);
		check(panel, `${theme}: no reading at ${SIZE_PANEL.width}`);
		assertStrip(`${theme} 1512 left`, panel.leftStrip);
		assertStrip(`${theme} 1512 right`, panel.rightStrip);
		assertDivider(`${theme} 1512 sidebar divider`, panel.sidebarDivider);
		assertDivider(`${theme} 1512 panel divider`, panel.panelDivider);
		check(
			panel.column.maxWidth === SHIPPED_MEASURE,
			`${theme} 1512: max-width ${panel.column.maxWidth}, expected ${SHIPPED_MEASURE}`,
		);
		await park(
			cdp,
			(panel.rightStrip.from + panel.rightStrip.to + 1) / 2,
			panel.y,
		);
		await shoot(cdp, "right-strip-panel", theme);
		if (panel.panelDivider) {
			await park(cdp, panel.panelDivider.x, panel.panelDivider.y);
			await shoot(cdp, "divider-control", theme);
		}

		r.alone = {
			size: SIZE_ALONE,
			container: alone.container,
			column: alone.column,
			handlesInDom: alone.handlesInDom,
			leftStrip: {
				...summariseStrip(alone.leftStrip),
				distanceFromContainerLeft: alone.leftStrip.distanceFromContainerLeft,
			},
			rightStrip: {
				...summariseStrip(alone.rightStrip),
				distanceFromContainerRight: alone.rightStrip.distanceFromContainerRight,
			},
			sidebarDivider: alone.sidebarDivider,
		};
		r.panel = {
			size: SIZE_PANEL,
			container: panel.container,
			column: panel.column,
			handlesInDom: panel.handlesInDom,
			leftStrip: {
				...summariseStrip(panel.leftStrip),
				distanceFromContainerLeft: panel.leftStrip.distanceFromContainerLeft,
			},
			rightStrip: {
				...summariseStrip(panel.rightStrip),
				distanceFromContainerRight: panel.rightStrip.distanceFromContainerRight,
			},
			sidebarDivider: panel.sidebarDivider,
			panelDivider: panel.panelDivider,
		};
		readings.themes[theme] = r;
	}

	/*
	 * THE MIGRATION, ON THE REAL PATH. A version-1 blob carrying a customised
	 * measure is planted before any page script runs, then the story is loaded and
	 * the store is left to rehydrate it. A fresh `about:blank` has an opaque origin
	 * whose `localStorage` throws, so the seed only acts on the Storybook origin.
	 */
	const seed = JSON.stringify({
		state: {
			chatMeasureWidth: SEED_WIDTH,
			themeName: "localOperatorLight",
			rightSlotWidth: 0,
		},
		version: 1,
	});
	const { identifier } = await cdp.send(
		"Page.addScriptToEvaluateOnNewDocument",
		{
			source: `try { if (location.origin === ${JSON.stringify(ORIGIN)}) localStorage.setItem("ui-preferences-storage", ${JSON.stringify(seed)}); } catch {}`,
		},
	);
	await openStory(cdp, STORY_ALONE, SIZE_ALONE, "localOperatorLight");
	const migrated = await cdp.evaluate(`(() => {
		const col = document.querySelector("[data-lo-transcript-content]");
		const blob = JSON.parse(localStorage.getItem("ui-preferences-storage") ?? "null");
		return {
			maxWidth: getComputedStyle(col).maxWidth,
			width: Math.round(col.getBoundingClientRect().width),
			override: document.documentElement.style.getPropertyValue("--lo-chat-measure-override"),
			blobVersion: blob ? blob.version : null,
			blobHasKey: blob ? Object.hasOwn(blob.state, "chatMeasureWidth") : null,
			blobKeyValue: blob ? (blob.state.chatMeasureWidth ?? null) : null,
		};
	})()`);
	await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
	await cdp.evaluate(`localStorage.removeItem("ui-preferences-storage")`);
	if (BEFORE) {
		check(
			migrated.maxWidth === `${SEED_WIDTH}px`,
			`migration: before tree max-width is ${migrated.maxWidth}, expected the seeded ${SEED_WIDTH}px override to apply`,
		);
		check(
			migrated.override === `${SEED_WIDTH}px`,
			`migration: before tree override var is "${migrated.override}"`,
		);
		check(
			migrated.blobHasKey === true,
			"migration: before tree dropped the key (it must not)",
		);
	} else {
		check(
			migrated.maxWidth === SHIPPED_MEASURE,
			`migration: max-width is ${migrated.maxWidth}, expected ${SHIPPED_MEASURE}`,
		);
		check(
			migrated.width === 810,
			`migration: column is ${migrated.width}px, expected 810`,
		);
		check(
			migrated.override === "",
			`migration: override var is "${migrated.override}", expected empty`,
		);
		check(
			migrated.blobVersion === 2,
			`migration: stored blob version is ${migrated.blobVersion}, expected 2`,
		);
		check(
			migrated.blobHasKey === false,
			"migration: the stored blob still carries chatMeasureWidth",
		);
	}
	readings.migration = { seeded: JSON.parse(seed), ...migrated };

	writeFileSync(
		join(OUT, "readings.json"),
		`${JSON.stringify(readings, null, "\t")}\n`,
	);
	console.log(JSON.stringify(readings, null, 2));

	if (failures.length) {
		console.error(`\n${failures.length} reading(s) FAILED:`);
		for (const f of failures.slice(0, 40)) console.error(`  - ${f}`);
		throw new Error("readings failed");
	}
	console.log(`\nall readings hold on the ${LABEL} tree`);
};

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		teardown();
		process.exit(1);
	});
}

main()
	.then(() => teardown())
	.catch((error) => {
		teardown();
		console.error(error);
		process.exit(1);
	});
