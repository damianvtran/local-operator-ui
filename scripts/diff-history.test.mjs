/**
 * The full-diff pager (`diff-history.tsx`, `diff-history-model.ts`): the
 * shipped component mounted in jsdom, its desktop requests answered by a fake
 * `window.api.desktop` that implements the core's frozen page contract —
 * including the BYTE budget, so pages end early and only `next_start` is an
 * honest cursor. Proves, for a 1,000-row archive with unique first / middle /
 * final rows: every row reachable by Next with no gaps, Last lands on the final
 * row despite byte-clipped pages, colours come from the preview's classifier,
 * the DOM never holds more than one page, the request names the call and never
 * the digest, and each non-archived / 404 / failure state is its own notice.
 */
import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", {
	url: "http://localhost/",
});
const originals = new Map();
for (const [key, value] of Object.entries({
	window: dom.window,
	document: dom.window.document,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
	requestAnimationFrame: (cb) => setTimeout(cb, 0),
})) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
// jsdom has no layout: the pager's scroll anchoring is exercised by the
// preview's own suite (diff-block-dom.test.mjs) and the rendered frames.
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
const bundle = await build({
	stdin: {
		contents: [
			'export { DiffBlock } from "./src/renderer/src/features/chat/components/trace/diff-block";',
			'export * from "./src/renderer/src/features/chat/components/trace/diff-history-model";',
			'export { setLocale } from "./src/renderer/src/shared/i18n";',
			'export { createElement, act } from "react";',
			'export { createRoot } from "react-dom/client";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@renderer": "./src/renderer/src",
	},
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
	tsconfig: "tsconfig.app.json",
});
const bundlePath = new URL(
	`./_diff-history-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const m = await import(bundlePath.href);
await unlink(bundlePath);
const { DiffBlock, setLocale, createElement: h, act, createRoot } = m;
setLocale("en");
after(() => {
	dom.window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

// ---- the artifact and a contract-faithful fake route ----------------------

const TOTAL = 1000;
/** Nameless header pair, hunks every 50 rows, alternating -/+/context rows. */
const ARTIFACT = Array.from({ length: TOTAL }, (_, i) => {
	if (i === 0) return "--- ";
	if (i === 1) return "+++ ";
	if (i === 2) return "@@ -1,600 +1,600 @@ FIRST-HUNK";
	if (i === 2 + 499) return "+UNIQUE-MIDDLE-ROW";
	if (i === TOTAL - 1) return "+UNIQUE-FINAL-ROW";
	if (i === 3) return "-UNIQUE-FIRST-ROW";
	if (i % 50 === 2) return `@@ -${i},50 +${i},50 @@ hunk-${i}`;
	// Every 7th row is long, so the byte budget (not the row cap) ends pages.
	const pad = i % 7 === 0 ? "x".repeat(900) : "";
	return `${["-", "+", " "][i % 3]}row-${i}${pad}`;
});
const PAGE_BYTES = 12_000;
const CLIP_AT = 4_000;
ARTIFACT[700] = `+HUGE-${"y".repeat(20_000)}`;

function hunkFor(start) {
	for (let i = start; i >= 0; i -= 1)
		if (ARTIFACT[i].startsWith("@@")) return i === start ? null : ARTIFACT[i];
	return null;
}

function pageOf(start, limit) {
	const rows = [];
	const clipped = [];
	let bytes = 0;
	let i = start;
	while (i < TOTAL && rows.length < limit) {
		let row = ARTIFACT[i];
		if (row.length > CLIP_AT) {
			row = row.slice(0, CLIP_AT);
			clipped.push(i);
		}
		if (rows.length > 0 && bytes + row.length > PAGE_BYTES) break;
		rows.push(row);
		bytes += row.length;
		i += 1;
	}
	return {
		state: "archived",
		start,
		total_rows: TOTAL,
		rows,
		hunk_header: hunkFor(start),
		next_start: i < TOTAL ? i : null,
		clipped_rows: clipped,
	};
}

let requests = [];
let respond = (request) => ({
	status: 200,
	body: { result: pageOf(request.start, request.limit) },
});
dom.window.api = {
	desktop: {
		request: async (request) => {
			requests.push(request);
			return respond(request);
		},
	},
};

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function mount(props = {}) {
	const scroller = document.createElement("div");
	scroller.setAttribute("data-lo-canonical-transcript", "");
	const host = document.createElement("div");
	scroller.append(host);
	document.body.append(scroller);
	const root = createRoot(host);
	await act(() =>
		root.render(
			h(DiffBlock, {
				diff: ARTIFACT.slice(0, 202),
				truncatedRows: TOTAL - 202,
				history: {
					scope: { sessionId: "a1b2c3d4e5f6", childId: "0f0f0f0f0f0f" },
					callId: "toolu_01ABC",
					descriptor: { state: "archived", rows: TOTAL },
				},
				...props,
			}),
		),
	);
	return {
		host,
		rows: () => [
			...host.querySelectorAll("[data-diff-history] [data-diff-line]"),
		],
		range: () => host.querySelector("[data-diff-history-range]")?.textContent,
		button: (name) =>
			[...host.querySelectorAll("button")].find(
				(b) => b.textContent.trim() === name,
			),
		click: async (el) => {
			await act(() => el.click());
			await flush();
			await flush();
		},
		unmount: () => {
			act(() => root.unmount());
			scroller.remove();
		},
	};
}

// ---- model ------------------------------------------------------------------

test("descriptor parse: archived, explicit states, legacy absent, and strictness", () => {
	assert.deepEqual(
		m.parseDiffFull({
			v: 1,
			state: "archived",
			rows: 9,
			digest: "a".repeat(32),
		}),
		{ state: "archived", rows: 9 },
	);
	for (const state of ["oversized", "withheld", "unavailable"])
		assert.deepEqual(m.parseDiffFull({ v: 1, state }), { state });
	assert.equal(m.parseDiffFull(undefined), null);
	// Unknown version/state/garbage rows fail CLOSED to `unavailable`, never to a
	// pageable `archived` whose every request would 404.
	assert.deepEqual(m.parseDiffFull({ v: 2, state: "archived", rows: 9 }), {
		state: "unavailable",
	});
	assert.deepEqual(m.parseDiffFull({ v: 1, state: "archived", rows: -1 }), {
		state: "unavailable",
	});
	assert.deepEqual(m.parseDiffFull({ v: 1, state: "bogus" }), {
		state: "unavailable",
	});
	// The digest is never retained: nothing in the renderer may send it.
	assert.ok(
		!(
			"digest" in
			m.parseDiffFull({ v: 1, state: "archived", rows: 1, digest: "d" })
		),
	);
	// Absent-vs-stated across frames (replay keeps the stored descriptor).
	const kept = { state: "archived", rows: 5 };
	assert.equal(m.preferDiffFull(undefined, kept), kept);
	assert.equal(m.preferDiffFull({}, kept), null);
	assert.deepEqual(
		m.preferDiffFull({ diff_full: { v: 1, state: "withheld" } }, kept),
		{ state: "withheld" },
	);
});

test("page parse refuses a cursor that would loop, oversize pages and bad clips", () => {
	const ok = pageOf(0, 200);
	assert.ok(m.parseDiffPage(ok));
	assert.equal(m.parseDiffPage({ ...ok, next_start: 0 }), null);
	assert.equal(m.parseDiffPage({ ...ok, next_start: TOTAL + 1 }), null);
	assert.equal(m.parseDiffPage({ ...ok, rows: Array(201).fill(" x") }), null);
	assert.equal(m.parseDiffPage({ ...ok, state: "nope" }), null);
	const clipped = m.parseDiffPage({ ...ok, clipped_rows: [3, 99999, -1] });
	assert.deepEqual(clipped.clippedRows, [3]);
	const empty = m.parseDiffPage({
		state: "evicted",
		start: 0,
		total_rows: 0,
		rows: [],
		hunk_header: null,
		next_start: null,
		clipped_rows: [],
	});
	assert.equal(empty.state, "evicted");
});

test("page lines: nameless header dropped at start 0 only; hunk context mid-hunk", () => {
	const first = m.diffPageLines(m.parseDiffPage(pageOf(0, 200)));
	assert.equal(first.lines[0].index, 2);
	assert.equal(first.lines[0].kind, "hunk");
	assert.equal(first.hunkHeader, null);
	const mid = m.diffPageLines(m.parseDiffPage(pageOf(60, 200)));
	assert.equal(mid.lines[0].index, 60);
	assert.equal(mid.hunkHeader, ARTIFACT[52]);
	// A `--- ` row deeper in the diff is a removed line, never stripped.
	const deep = m.diffPageLines({
		state: "archived",
		start: 10,
		totalRows: 12,
		rows: ["--- x", "+++ y"],
		hunkHeader: null,
		nextStart: null,
		clippedRows: [],
	});
	assert.equal(deep.lines.length, 2);
	assert.equal(deep.lines[0].kind, "removed");
});

// ---- the mounted pager --------------------------------------------------------

test("child scope: Next walks every row exactly once; colours; bounded DOM; no digest sent", async () => {
	requests = [];
	const v = await mount();
	const view = v.button("View full diff · 1,000 lines");
	assert.ok(view, "the truncated footer becomes the way to the archive");
	await v.click(view);
	const seen = [];
	let pages = 0;
	for (;;) {
		const rows = v.rows();
		assert.ok(
			rows.length > 0 && rows.length <= 200,
			`page ${pages} has ${rows.length} rows`,
		);
		for (const row of rows)
			seen.push(Number(row.getAttribute("data-diff-line")));
		for (const row of rows) {
			const text = row.firstChild.textContent;
			const want = text.startsWith("+")
				? "text-success"
				: text.startsWith("-")
					? "text-danger"
					: text.startsWith("@@")
						? "text-ink-muted"
						: "text-ink-dim";
			assert.ok(
				row.className.includes(want),
				`${text.slice(0, 20)} -> ${row.className}`,
			);
		}
		pages += 1;
		const next = v.button("Next");
		if (next.disabled) break;
		await v.click(next);
	}
	// Rows 0-1 are the nameless header pair; everything else, once, in order.
	assert.deepEqual(
		seen,
		Array.from({ length: TOTAL - 2 }, (_, i) => i + 2),
	);
	assert.ok(pages > 5, `byte budget must end pages early (${pages} pages)`);
	const text = v.host.textContent;
	assert.ok(text.includes("+UNIQUE-FINAL-ROW"));
	assert.ok(
		text.includes(
			`Rows ${TOTAL - (TOTAL - seen.at(-1) - 1) - (v.rows().length - 1)}`,
		),
	);
	for (const request of requests) {
		assert.equal(request.op, "subagents.diff");
		assert.equal(request.childId, "0f0f0f0f0f0f");
		assert.equal(request.callId, "toolu_01ABC");
		assert.ok(!("digest" in request) && !("ref" in request));
		assert.ok(request.limit <= 200);
	}
	v.unmount();
});

test("first / middle / final rows; Last reaches the final row; Prev returns; clipped row disclosed", async () => {
	requests = [];
	const v = await mount({
		history: {
			scope: { sessionId: "a1b2c3d4e5f6", childId: null },
			callId: "call_9",
			descriptor: { state: "archived", rows: TOTAL },
		},
	});
	await v.click(v.button("View full diff · 1,000 lines"));
	assert.ok(v.host.textContent.includes("-UNIQUE-FIRST-ROW"));
	assert.equal(requests[0].op, "sessions.diff");
	await v.click(v.button("Last"));
	const last = v.rows();
	assert.equal(Number(last.at(-1).getAttribute("data-diff-line")), TOTAL - 1);
	assert.ok(v.host.textContent.includes("+UNIQUE-FINAL-ROW"));
	assert.ok(v.range().endsWith(`of ${TOTAL.toLocaleString("en")}`));
	assert.equal(v.button("Next").disabled, true);
	// Walk back with Prev until the middle row shows; every page stays bounded.
	let guard = 0;
	while (!v.host.textContent.includes("+UNIQUE-MIDDLE-ROW") && guard < 40) {
		await v.click(v.button("Previous"));
		assert.ok(v.rows().length <= 200);
		guard += 1;
	}
	assert.ok(
		v.host.textContent.includes("+UNIQUE-MIDDLE-ROW"),
		"middle row reachable by Prev",
	);
	// The 20,000-char row is clipped explicitly, at its absolute index.
	await v.click(v.button("First"));
	while (!v.host.querySelector('[data-diff-line="700"]'))
		await v.click(v.button("Next"));
	assert.ok(v.host.querySelector('[data-diff-line="700"] [data-diff-clipped]'));
	assert.match(v.host.textContent, /1 long line on this page is shortened/);
	// Back restores the preview.
	await v.click(v.button("Back to preview"));
	assert.equal(v.host.querySelector("[data-diff-history]"), null);
	assert.ok(v.button("View full diff · 1,000 lines"));
	v.unmount();
});

test("404, failure + retry, non-archived page and descriptor states are explicit notices", async () => {
	respond = () => ({
		status: 404,
		body: { detail: { code: "diff_not_found" } },
	});
	let v = await mount();
	await v.click(v.button("View full diff · 1,000 lines"));
	assert.match(v.host.textContent, /Full diff not found for this change/);
	assert.equal(v.rows().length, 0);
	v.unmount();

	let fail = true;
	respond = (request) =>
		fail
			? { status: 503, body: { detail: "down" } }
			: { status: 200, body: { result: pageOf(request.start, request.limit) } };
	v = await mount();
	await v.click(v.button("View full diff · 1,000 lines"));
	assert.match(v.host.textContent, /Couldn't load the full diff/);
	fail = false;
	await v.click(v.button("Retry"));
	assert.ok(v.rows().length > 0);
	v.unmount();

	respond = () => ({
		status: 200,
		body: {
			result: {
				state: "evicted",
				start: 0,
				total_rows: 0,
				rows: [],
				hunk_header: null,
				next_start: null,
				clipped_rows: [],
			},
		},
	});
	v = await mount();
	await v.click(v.button("View full diff · 1,000 lines"));
	assert.match(v.host.textContent, /Full diff no longer stored/);
	v.unmount();

	respond = () => ({
		status: 200,
		body: {
			result: {
				state: "archived",
				start: 0,
				total_rows: 0,
				rows: [],
				hunk_header: null,
				next_start: null,
				clipped_rows: [],
			},
		},
	});
	v = await mount();
	await v.click(v.button("View full diff · 1,000 lines"));
	assert.match(v.host.textContent, /This change has no diff lines/);
	v.unmount();

	requests = [];
	for (const [state, copy] of [
		["oversized", /too large to store/],
		["withheld", /couldn't be redacted safely/],
		["unavailable", /wasn't saved/],
	]) {
		v = await mount({
			history: {
				scope: { sessionId: "a1b2c3d4e5f6", childId: null },
				callId: "c",
				descriptor: { state },
			},
		});
		assert.match(v.host.textContent, copy);
		assert.match(
			v.host.textContent,
			/Diff truncated — 798 more lines not recorded/,
		);
		assert.equal(v.button("View full diff · 1,000 lines"), undefined);
		v.unmount();
	}
	// Legacy row (no descriptor) keeps #1824's honest footer and offers nothing.
	v = await mount({
		history: {
			scope: { sessionId: "a1b2c3d4e5f6", childId: null },
			callId: "c",
			descriptor: null,
		},
	});
	assert.match(v.host.textContent, /798 more lines not recorded/);
	assert.equal(v.host.querySelector("[data-diff-view-full]"), null);
	v.unmount();
	assert.equal(requests.length, 0, "no request without an archived descriptor");
});
