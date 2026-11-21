/**
 * Narrow tests for the drawer scene's revised-row wait; no Electron, core or
 * provider launch. Regression for run 44677507218 (PR #2001), where the final
 * "Mark read" pressed a row still drawn at revision 1 and core correctly skipped it
 * as `stale_revision`. See `untilRevisionRendered` in the scene for the full why.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	REVISED_TITLE,
	click,
	untilRevisionRendered,
	untilToastsGone,
} from "./notifications-drawer-scene.mjs";

/* A CDP stand-in that answers the probe from a scripted sequence of rendered
 * titles, evaluating the scene's own probe against a minimal DOM. */
function fakeCdp(titles) {
	const probes = [];
	let tick = 0;
	return {
		probes,
		async evaluate(expression) {
			probes.push(expression);
			const title = titles[Math.min(tick++, titles.length - 1)];
			const row = { textContent: title };
			const document = {
				querySelector: (selector) =>
					selector === '[data-drawer-update="n_row"]' ? row : null,
			};
			const CSS = { escape: (value) => value };
			return new Function("document", "CSS", `return ${expression}`)(
				document,
				CSS,
			);
		},
	};
}

/* `until`'s contract with a bounded number of polls instead of wall time. */
const boundedWait = (polls) => async (check, label) => {
	let last;
	for (let index = 0; index < polls; index += 1) {
		last = await check();
		if (last) return last;
	}
	throw new Error(`${label}: timed out (${JSON.stringify(last)})`);
};

test("waits until the revised revision is drawn, not just any row", async () => {
	const cdp = fakeCdp([
		"Drawer update 11: detailed verification",
		"Drawer update 11: detailed verification",
		REVISED_TITLE,
	]);
	assert.equal(await untilRevisionRendered(cdp, "n_row", boundedWait(5)), true);
	assert.equal(cdp.probes.length, 3);
});

test("a row that stays at its old revision is a timeout, never a press", async () => {
	const cdp = fakeCdp(["Drawer update 11: detailed verification"]);
	await assert.rejects(
		untilRevisionRendered(cdp, "n_row", boundedWait(4)),
		/revised revision rendered: timed out \(false\)/,
	);
});

test("the final Mark read waits for the revised row, after Undo and before the press", () => {
	const source = readFileSync(
		new URL("./notifications-drawer-scene.mjs", import.meta.url),
		"utf8",
	);
	const undo = source.indexOf('surface: "Undo refusal and retry"');
	const wait = source.indexOf("await untilRevisionRendered(cdp, stale.id)");
	const press = source.indexOf(
		'await click(cdp, "[data-drawer-mark-all-read]")',
		wait,
	);
	const empty = source.indexOf('"last unread empty state",', press);
	assert.ok(undo > 0 && wait > undo, "wait must follow the Undo retry");
	assert.ok(press > wait && empty > press, "wait must precede the final press");
	assert.ok(
		source.includes("title=${JSON.stringify(REVISED_TITLE)}"),
		"revise() must write the title the wait looks for",
	);
});

/*
 * The concurrent-dismiss press (runs 44570955816, 44603062498): an undo toast covered
 * the row's ✕, and on the red run the list moved between the measurement and the
 * press, so the press landed on the empty drawer, sent no PATCH, and the lane died
 * 30 s later as `optimistic dismiss: timed out`. The fake below is a tiny stacked
 * DOM that evaluates the scene's OWN probe strings and routes CDP mouse input to
 * whatever element is on top at the pressed point, the way Chromium does.
 */
function fakePage() {
	const nodes = [];
	const node = (tag, data, rect, parent = null) => {
		const el = {
			tagName: tag,
			className: "",
			dataset: data,
			rect: { ...rect },
			parent,
			textContent: data.text ?? "",
			contains(other) {
				for (let at = other; at; at = at.parent) if (at === el) return true;
				return false;
			},
			scrollIntoView() {},
			getBoundingClientRect() {
				const { x, y, width, height } = el.rect;
				return {
					x,
					y,
					width,
					height,
					left: x,
					top: y,
					right: x + width,
					bottom: y + height,
				};
			},
		};
		nodes.push(el);
		return el;
	};
	const drawer = node(
		"DIV",
		{ askDrawer: "session" },
		{ x: 0, y: 0, width: 400, height: 600 },
	);
	const row = node(
		"DIV",
		{ drawerUpdate: "n_c" },
		{ x: 0, y: 500, width: 400, height: 40 },
		drawer,
	);
	const dismiss = node(
		"BUTTON",
		{ rowAction: "dismiss" },
		{ x: 360, y: 508, width: 24, height: 24 },
		row,
	);
	const selectors = new Map([
		['[data-drawer-update="n_c"] [data-row-action="dismiss"]', dismiss],
	]);
	const listeners = new Set();
	const page = {
		nodes,
		dismiss,
		row,
		toast: null,
		pressed: [],
		evaluations: 0,
		/* Hooks a test sets to move the world at a precise CDP step. */
		onEvaluate: null,
		onMove: null,
	};
	const inside = (el, x, y) => {
		const r = el.getBoundingClientRect();
		return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
	};
	const document = {
		querySelector(selector) {
			if (selector === "[data-sonner-toast]") return page.toast;
			return selectors.get(selector) ?? null;
		},
		querySelectorAll(selector) {
			return selector === "[data-sonner-toast]" && page.toast
				? [page.toast]
				: [];
		},
		elementFromPoint(x, y) {
			const live = nodes.filter((el) => el !== page.removedToast);
			for (let i = live.length - 1; i >= 0; i -= 1)
				if (inside(live[i], x, y)) return live[i];
			return null;
		},
	};
	const window = {
		innerWidth: 400,
		innerHeight: 600,
		addEventListener: (type, fn) => type === "pointerdown" && listeners.add(fn),
		removeEventListener: (type, fn) =>
			type === "pointerdown" && listeners.delete(fn),
	};
	page.showToast = () => {
		page.removedToast = null;
		page.toast = node(
			"LI",
			{ sonnerToast: "", text: "Marked 1 read · Undo" },
			{ x: 200, y: 480, width: 200, height: 80 },
		);
	};
	page.hideToast = () => {
		page.removedToast = page.toast;
		page.toast = null;
	};
	page.cdp = {
		async evaluate(expression) {
			page.evaluations += 1;
			page.onEvaluate?.(page.evaluations);
			const CSS = { escape: (value) => value };
			return new Function("document", "window", "CSS", `return ${expression}`)(
				document,
				window,
				CSS,
			);
		},
		async send(method, params) {
			assert.equal(method, "Input.dispatchMouseEvent");
			if (params.type === "mouseMoved") page.onMove?.(params);
			if (params.type !== "mousePressed") return;
			const target = document.elementFromPoint(params.x, params.y);
			page.pressed.push(target);
			for (const fn of [...listeners]) fn({ target });
		},
	};
	return page;
}

const TOAST_TIMEOUT =
	/toast: timed out \(false\) - toasts still drawn: \["Marked 1 read · Undo"\]/;
const PRESS_MISSED =
	/^press missed \[data-drawer-update="n_c"\] \[data-row-action="dismiss"\]: /;
const DISMISS = '[data-drawer-update="n_c"] [data-row-action="dismiss"]';

test("the dismiss waits until the undo toast is gone, on the DOM fact", async () => {
	const page = fakePage();
	page.showToast();
	page.onEvaluate = (n) => n === 3 && page.hideToast();
	assert.equal(await untilToastsGone(page.cdp, "toast", boundedWait(5)), true);
	assert.equal(page.evaluations, 3);
	await click(page.cdp, DISMISS, { hoverMs: 0 });
	assert.deepEqual(page.pressed, [page.dismiss]);
});

test("a toast that never leaves fails naming its text, never pressing under it", async () => {
	const page = fakePage();
	page.showToast();
	await assert.rejects(
		untilToastsGone(page.cdp, "toast", boundedWait(3)),
		TOAST_TIMEOUT,
	);
	assert.deepEqual(page.pressed, []);
});

test("a layout shift between the fresh measurement and the press fails as a missed press", async () => {
	const page = fakePage();
	/* Move the row up by its own height after the armed measurement, before the
	 * press - the red run's shape. The stale point now lies on the empty drawer. */
	page.onMove = () => {
		if (page.evaluations >= 2) {
			page.row.rect.y -= 40;
			page.dismiss.rect.y -= 40;
		}
	};
	await assert.rejects(
		click(page.cdp, DISMISS, { hoverMs: 0 }),
		(error) =>
			PRESS_MISSED.test(error.message) &&
			error.message.includes(
				'reached {"tag":"DIV","cls":"","data":{"askDrawer":"session"}}',
			),
	);
	assert.equal(
		page.pressed.length,
		1,
		"a missed press is reported, never re-pressed",
	);
});

test("the concurrent dismiss waits for the toast before its press", () => {
	const source = readFileSync(
		new URL("./notifications-drawer-scene.mjs", import.meta.url),
		"utf8",
	);
	const wait = source.indexOf(
		'await untilToastsGone(cdp, "undo toast cleared before dismiss")',
	);
	const press = source.indexOf('[data-row-action="dismiss"]`,', wait);
	const optimistic = source.indexOf('"optimistic dismiss",', press);
	assert.ok(
		wait > 0 && press > wait && optimistic > press,
		"toast wait must precede the dismiss press",
	);
});
