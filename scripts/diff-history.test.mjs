/**
 * The full-diff pager (`diff-history.tsx`, `diff-history-model.ts`): the
 * shipped component mounted in jsdom, its desktop requests answered by a fake
 * `window.api.desktop` that implements the core's frozen page contract —
 * including the BYTE budget, so pages end early and only the route's cursor
 * PAIR (`next_start`, `next_offset`) is honest. Proves, for a 1,000-row archive
 * with unique first / middle / final rows: every accepted character reachable
 * by Next with no gap or repeat (long rows are CONTINUED, never clipped), Last
 * lands on the true end, colours come from the preview's classifier,
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
/** Below this much room the fake ends the page instead of splitting a row. */
const SPLIT_MIN = 200;
ARTIFACT[700] = `+HUGE-${"y".repeat(20_000)}`;

/**
 * The artifact the fake route serves. Swapped by a test that needs a
 * different shape (a huge, non-ASCII final row) and restored after it.
 */
let art = ARTIFACT;

function hunkFor(start) {
	for (let i = start; i >= 0; i -= 1)
		if (art[i].startsWith("@@")) return i === start ? null : art[i];
	return null;
}

/**
 * The core's v1 pair-cursor page, faithfully: sizes and offsets count Unicode
 * CODE POINTS (`Array.from`), as the core does, so a test with astral
 * characters proves the renderer never slices text by the offset itself.
 * Every fragment keeps its row's leading marker; a row that does not fit is
 * continued at (`row`, `next_offset`), and nothing is ever clipped.
 */
function pageOf(start, limit, offset = 0) {
	const rows = [];
	let bytes = 0;
	let i = start;
	let off = offset;
	let next = null;
	while (i < art.length && rows.length < limit) {
		const points = Array.from(art[i]);
		const marker = points[0] ?? "";
		const rest = points.slice(1 + off);
		const room = PAGE_BYTES - bytes;
		if (1 + rest.length <= room) {
			rows.push(marker + rest.join(""));
			bytes += 1 + rest.length;
			i += 1;
			off = 0;
			continue;
		}
		if (rows.length === 0 || room >= SPLIT_MIN) {
			const take = room - 1;
			rows.push(marker + rest.slice(0, take).join(""));
			next = { start: i, offset: off + take };
		} else {
			next = { start: i, offset: 0 };
		}
		break;
	}
	if (!next && i < art.length) next = { start: i, offset: 0 };
	return {
		state: "archived",
		start,
		offset,
		total_rows: art.length,
		rows,
		hunk_header: hunkFor(start),
		next_start: next ? next.start : null,
		next_offset: next ? next.offset : null,
		clipped_rows: [],
	};
}

/**
 * Rebuild rows from the painted pages the way the contract defines: an
 * offset-0 fragment starts its row; a continued fragment appends everything
 * after its (ASCII) marker. Returns index -> text.
 */
function rebuild(pages) {
	const out = new Map();
	for (const page of pages)
		for (const row of page) {
			if (row.continued)
				out.set(row.index, out.get(row.index) + row.text.slice(1));
			else {
				assert.ok(!out.has(row.index), `row ${row.index} started twice`);
				out.set(row.index, row.text);
			}
		}
	return out;
}

/** The painted rows of the current page: index, own text, continuation flags. */
const painted = (v) =>
	v.rows().map((row) => ({
		index: Number(row.getAttribute("data-diff-line")),
		text: row.firstChild.textContent,
		continued: Boolean(row.querySelector("[data-diff-continued]")),
		continues: Boolean(row.querySelector("[data-diff-continues]")),
	}));

let requests = [];
let respond = (request) => ({
	status: 200,
	body: { result: pageOf(request.start, request.limit, request.offset ?? 0) },
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

/** `aria-disabled`, not `disabled`: a disabled button drops focus to <body>. */
const inert = (button) => button.getAttribute("aria-disabled") === "true";

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
	// Half a cursor is no cursor.
	assert.equal(m.parseDiffPage({ ...ok, next_offset: null }), null);
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
		offset: 0,
		rows: ["--- x", "+++ y"],
		hunkHeader: null,
		nextStart: null,
		nextOffset: null,
		clippedRows: [],
	});
	assert.equal(deep.lines.length, 2);
	assert.equal(deep.lines[0].kind, "removed");
});

// ---- the mounted pager --------------------------------------------------------

test("child scope: Next walks every row exactly once; colours; bounded DOM; no digest sent", async () => {
	requests = [];
	const v = await mount();
	const view = v.button("View full diff · 998 lines");
	assert.ok(view, "the truncated footer becomes the way to the archive");
	await v.click(view);
	const walk = [];
	let pages = 0;
	for (;;) {
		const rows = v.rows();
		assert.ok(
			rows.length > 0 && rows.length <= 200,
			`page ${pages} has ${rows.length} rows`,
		);
		walk.push(painted(v));
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
		if (inert(next)) break;
		await v.click(next);
	}
	// Rows 0-1 are the nameless header pair; every other row is started once,
	// in order, and its continued fragments rebuild it with nothing lost.
	const rebuilt = rebuild(walk);
	assert.deepEqual(
		[...rebuilt.keys()],
		Array.from({ length: TOTAL - 2 }, (_, i) => i + 2),
	);
	for (const [index, text] of rebuilt)
		assert.equal(text, ARTIFACT[index].replace(/\s+$/u, ""), `row ${index}`);
	assert.ok(
		walk.some((page) => page.some((row) => row.continued)),
		"the byte budget must split at least one row across pages",
	);
	assert.ok(pages > 5, `byte budget must end pages early (${pages} pages)`);
	const text = v.host.textContent;
	assert.ok(text.includes("+UNIQUE-FINAL-ROW"));
	// Visible numbering: artifact row i is the reader's row i - 1 (the hidden
	// header pair takes artifact rows 0-1).
	const firstShown = Number(v.rows()[0].getAttribute("data-diff-line")) - 1;
	assert.ok(text.includes(`Rows ${firstShown}–${TOTAL - 2} of ${TOTAL - 2}`));
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
	await v.click(v.button("View full diff · 998 lines"));
	assert.ok(v.host.textContent.includes("-UNIQUE-FIRST-ROW"));
	assert.equal(requests[0].op, "sessions.diff");
	await v.click(v.button("Last"));
	const last = v.rows();
	assert.equal(Number(last.at(-1).getAttribute("data-diff-line")), TOTAL - 1);
	assert.ok(v.host.textContent.includes("+UNIQUE-FINAL-ROW"));
	assert.ok(v.range().endsWith(`of ${(TOTAL - 2).toLocaleString("en")}`));
	assert.equal(v.button("Next").getAttribute("aria-disabled"), "true");
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
	// The 20,000-char row is CONTINUED, never clipped: it ends one page
	// marked "continues", the next page resumes it marked "continued", and the
	// fragments rebuild the accepted row exactly (round 2: clipping dropped
	// the tail).
	await v.click(v.button("First"));
	while (!v.host.querySelector('[data-diff-line="700"]'))
		await v.click(v.button("Next"));
	assert.ok(
		v.host.querySelector('[data-diff-line="700"] [data-diff-continues]'),
	);
	assert.match(v.host.textContent, /\(continues on next page\)/);
	assert.equal(v.host.querySelector("[data-diff-clipped]"), null);
	const parts = [painted(v)];
	while (painted(v).at(-1).continues) {
		await v.click(v.button("Next"));
		parts.push(painted(v));
		assert.ok(painted(v)[0].continued);
		assert.match(v.host.textContent, /\(continued from previous page\)/);
	}
	assert.equal(rebuild(parts).get(700), ARTIFACT[700]);
	// Back restores the preview.
	await v.click(v.button("Back to preview"));
	assert.equal(v.host.querySelector("[data-diff-history]"), null);
	assert.ok(v.button("View full diff · 998 lines"));
	v.unmount();
});

test("404, failure + retry, non-archived page and descriptor states are explicit notices", async () => {
	respond = () => ({
		status: 404,
		body: { detail: { code: "diff_not_found" } },
	});
	let v = await mount();
	await v.click(v.button("View full diff · 998 lines"));
	assert.match(v.host.textContent, /Full diff not found for this change/);
	assert.equal(v.rows().length, 0);
	v.unmount();

	let fail = true;
	respond = (request) =>
		fail
			? { status: 503, body: { detail: "down" } }
			: {
					status: 200,
					body: {
						result: pageOf(request.start, request.limit, request.offset ?? 0),
					},
				};
	v = await mount();
	await v.click(v.button("View full diff · 998 lines"));
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
	await v.click(v.button("View full diff · 998 lines"));
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
	await v.click(v.button("View full diff · 998 lines"));
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
		assert.equal(v.button("View full diff · 998 lines"), undefined);
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

// ---- round-1 remediation regressions (UI #1829) ---------------------------
// Each test below was written RED against ed039e2 and names the finding it
// pins, so a later refactor that reintroduces the defect fails by name.

const inPager = (v) =>
	Boolean(
		v.host
			.querySelector("[data-diff-history]")
			?.contains(document.activeElement),
	);

test("U1/R4 focus: enter, page while loading, Retry and Back never drop focus to <body>", async () => {
	let fail = false;
	respond = (request) =>
		fail
			? { status: 503, body: { detail: "down" } }
			: {
					status: 200,
					body: {
						result: pageOf(request.start, request.limit, request.offset ?? 0),
					},
				};
	const v = await mount();
	const view = v.button("View full diff · 998 lines");
	view.focus();
	await v.click(view);
	assert.ok(inPager(v), "entering full moves focus into the pager");
	// At the first page First/Previous are inert but still focusable, so a
	// keyboard reader parked on them is not thrown out of the pager.
	assert.ok(inert(v.button("First")) && inert(v.button("Previous")));
	assert.equal(v.button("First").disabled, false);
	const next = v.button("Next");
	next.focus();
	await v.click(next);
	assert.equal(document.activeElement, v.button("Next"), "Next keeps focus");
	// Error then Retry: the Retry button disappears while loading.
	fail = true;
	v.button("Next").focus();
	await v.click(v.button("Next"));
	const retry = v.button("Retry");
	retry.focus();
	fail = false;
	await v.click(retry);
	assert.ok(inPager(v), "Retry hands focus to the pager, not <body>");
	const back = v.button("Back to preview");
	back.focus();
	await v.click(back);
	await new Promise((r) => setTimeout(r, 30));
	assert.equal(
		document.activeElement,
		v.host.querySelector("[data-diff-view-full]"),
		"Back restores focus to the control that opened full mode",
	);
	v.unmount();
	respond = (request) => ({
		status: 200,
		body: { result: pageOf(request.start, request.limit, request.offset ?? 0) },
	});
});

test("D1/D2 pager: sticky opaque bar, no opacity-dimmed controls", async () => {
	const v = await mount();
	await v.click(v.button("View full diff · 998 lines"));
	const nav = v.host.querySelector("[data-diff-history] nav");
	assert.match(nav.className, /\bsticky\b/);
	assert.match(nav.className, /\bbg-sunken\b/);
	for (const button of nav.querySelectorAll("button"))
		assert.doesNotMatch(button.className, /opacity/);
	v.unmount();
});

test("R2/Q1 Retry replays the failed action (Last stays Last)", async () => {
	let fail = false;
	respond = (request) =>
		fail
			? { status: 503, body: { detail: "down" } }
			: {
					status: 200,
					body: {
						result: pageOf(request.start, request.limit, request.offset ?? 0),
					},
				};
	const v = await mount();
	await v.click(v.button("View full diff · 998 lines"));
	fail = true;
	await v.click(v.button("Last"));
	assert.ok(v.button("Retry"));
	fail = false;
	await v.click(v.button("Retry"));
	assert.ok(
		v.host.textContent.includes("+UNIQUE-FINAL-ROW"),
		"Retry of Last lands on the final row",
	);
	v.unmount();
	respond = (request) => ({
		status: 200,
		body: { result: pageOf(request.start, request.limit, request.offset ?? 0) },
	});
});

test("U2/Q3 Previous after Last ends exactly before Last's first row", async () => {
	const v = await mount();
	await v.click(v.button("View full diff · 998 lines"));
	await v.click(v.button("Last"));
	const lastFirst = Number(v.rows()[0].getAttribute("data-diff-line"));
	const lastResumes = painted(v)[0].continued;
	await v.click(v.button("Previous"));
	const prevRows = painted(v);
	// Last's walk is the trail, so Previous is exactly the page before it in
	// the chain: it ends at the row before Last's first row, or — when Last's
	// page resumed a split row — with the first part of that same row.
	if (lastResumes) {
		assert.equal(prevRows.at(-1).index, lastFirst);
		assert.ok(prevRows.at(-1).continues, "the split row's head, marked");
	} else {
		assert.equal(prevRows.at(-1).index, lastFirst - 1, "no overlap, no gap");
	}
	// Next from the trimmed page returns to Last's page.
	await v.click(v.button("Next"));
	assert.equal(Number(v.rows()[0].getAttribute("data-diff-line")), lastFirst);
	v.unmount();
});

test("R1/Q2 parser: exact requested pair, contiguous cursor, final page ends at total", () => {
	const at = (start, offset = 0) => ({ start, offset });
	const ok = pageOf(0, 200);
	assert.ok(m.parseDiffPage(ok, at(0)));
	assert.equal(m.parseDiffPage(ok, at(5)), null, "start must be echoed");
	assert.equal(m.parseDiffPage(ok, at(0, 3)), null, "offset must be echoed");
	assert.equal(
		m.parseDiffPage({ ...ok, next_start: ok.next_start + 1 }, at(0)),
		null,
		"cursor jump",
	);
	assert.equal(
		m.parseDiffPage({ ...ok, next_start: null, next_offset: null }, at(0)),
		null,
		"premature final",
	);
	const tail = pageOf(TOTAL - 1, 200);
	assert.ok(m.parseDiffPage(tail, at(TOTAL - 1)));
	// Pair rules for a split row.
	const page = (rows, next_start, next_offset, offset = 0, start = 5) => ({
		state: "archived",
		start,
		offset,
		total_rows: 10,
		rows,
		hunk_header: null,
		next_start,
		next_offset,
		clipped_rows: [],
	});
	// Partial last row resumes INSIDE that row.
	assert.ok(m.parseDiffPage(page(["+a", "+bb"], 6, 4), at(5)));
	assert.equal(m.parseDiffPage(page(["+a", "+bb"], 7, 4), at(5)), null);
	// Completed last row resumes at the next row, offset 0.
	assert.ok(m.parseDiffPage(page(["+a", "+bb"], 7, 0), at(5)));
	// A single fragment of one row must move its offset strictly forward.
	assert.ok(m.parseDiffPage(page(["+x"], 5, 9, 4), at(5, 4)));
	assert.equal(m.parseDiffPage(page(["+x"], 5, 4, 4), at(5, 4)), null);
	assert.equal(m.parseDiffPage(page(["+x"], 5, 3, 4), at(5, 4)), null);
	// A continuation page with no text is not progress.
	assert.equal(m.parseDiffPage(page([], 5, 9, 4), at(5, 4)), null);
	// Half a cursor, or an end that is not the end.
	assert.equal(m.parseDiffPage(page(["+a"], 6, null), at(5)), null);
	assert.equal(m.parseDiffPage(page(["+a"], null, 0), at(5)), null);
	assert.equal(m.parseDiffPage(page(["+a"], null, null), at(5)), null);
	assert.ok(
		m.parseDiffPage(page(["+a", "+b", "+c", "+d", "+e"], null, null), at(5)),
	);
	// Non-integer or unsafe offsets.
	assert.equal(m.parseDiffPage(page(["+a"], 5, 1.5), at(5)), null);
	assert.equal(
		m.parseDiffPage(page(["+a"], 5, Number.MAX_SAFE_INTEGER + 2), at(5)),
		null,
	);
});

test("R3/U4/Q3 counts: the hidden nameless header pair is not counted", async () => {
	const v = await mount();
	await v.click(v.button("View full diff · 998 lines"));
	assert.match(v.range(), /^Rows 1–\d+ of 998$/);
	const shown = v.rows().length;
	assert.equal(v.range(), `Rows 1–${shown} of 998`);
	v.unmount();
});

test("U3 announce: notices and errors land in a persistent status region", async () => {
	respond = () => ({
		status: 404,
		body: { detail: { code: "diff_not_found" } },
	});
	const v = await mount();
	await v.click(v.button("View full diff · 998 lines"));
	const status = v.host.querySelector("[data-diff-history] output");
	assert.ok(status, "status region exists");
	assert.match(status.textContent, /Full diff not found/);
	v.unmount();
	respond = (request) => ({
		status: 200,
		body: { result: pageOf(request.start, request.limit, request.offset ?? 0) },
	});
});

test("pair cursor: a huge non-ASCII FINAL row — Last shows its real end, Prev and Next rebuild it exactly", async () => {
	/*
	 * Astral emoji, CJK, RTL, JSON escapes and a backslash run: offsets are the
	 * core's CODE POINTS, so any renderer that sliced JS text by the offset
	 * (UTF-16 units) would repeat or drop characters here.
	 */
	const unit = '😀漢字עברית "q\\"\\n" \\\\ tab\t end ';
	const finalRow = `+${unit.repeat(2_500)}FINAL-TAIL`;
	const rows = ["--- ", "+++ ", "@@ -1,3 +1,3 @@", "-old", "+new", finalRow];
	art = rows;
	try {
		requests = [];
		const v = await mount({
			diff: rows.slice(0, 5),
			truncatedRows: 1,
			history: {
				scope: { sessionId: "a1b2c3d4e5f6", childId: null },
				callId: "call_u",
				descriptor: { state: "archived", rows: rows.length },
			},
		});
		await v.click(v.button("View full diff · 4 lines"));
		await v.click(v.button("Last"));
		// The final page is the row's LAST fragment, not its first part.
		const last = painted(v);
		assert.equal(last.at(-1).index, rows.length - 1);
		assert.ok(last[0].continued, "Last lands on a continuation");
		assert.ok(!last.at(-1).continues, "…that ends the row");
		assert.ok(v.host.textContent.includes("FINAL-TAIL"));
		assert.equal(v.button("Next").getAttribute("aria-disabled"), "true");
		// Walk back to the row's first part, then rebuild front to back.
		const back = [last];
		while (painted(v)[0].continued) {
			await v.click(v.button("Previous"));
			back.unshift(painted(v));
		}
		assert.equal(back.length > 2, true, `${back.length} pages`);
		assert.equal(rebuild(back).get(rows.length - 1), finalRow);
		// Every request echoed a server-issued offset; none was invented.
		for (const request of requests) {
			assert.equal(Number.isSafeInteger(request.offset), true);
			assert.ok(request.offset >= 0);
		}
		// Forward from First by Next alone reaches the same bytes.
		await v.click(v.button("First"));
		const forward = [painted(v)];
		while (v.button("Next").getAttribute("aria-disabled") !== "true") {
			await v.click(v.button("Next"));
			forward.push(painted(v));
		}
		assert.equal(rebuild(forward).get(rows.length - 1), finalRow);
		// Logical rows: the split row is ONE row on every page.
		assert.match(v.range(), /of 4$/);
		v.unmount();
	} finally {
		art = ARTIFACT;
	}
});

test("pair cursor: Retry of a failed continuation replays the same pair", async () => {
	let failAt = null;
	respond = (request) =>
		failAt && request.start === failAt.start && request.offset === failAt.offset
			? { status: 503, body: { detail: "down" } }
			: {
					status: 200,
					body: {
						result: pageOf(request.start, request.limit, request.offset ?? 0),
					},
				};
	try {
		const v = await mount();
		await v.click(v.button("View full diff · 998 lines"));
		// Walk to a page whose last row is split across pages.
		while (!painted(v).at(-1).continues) await v.click(v.button("Next"));
		const split = painted(v).at(-1).index;
		requests = [];
		await v.click(v.button("Next"));
		const sent = requests.at(-1);
		assert.equal(sent.start, split);
		assert.ok(sent.offset > 0, "the continuation carries the server offset");
		assert.ok(painted(v)[0].continued);
		// Back, fail that exact pair, then Retry must ask for it again.
		await v.click(v.button("Previous"));
		failAt = { start: sent.start, offset: sent.offset };
		await v.click(v.button("Next"));
		assert.ok(v.button("Retry"));
		failAt = null;
		requests = [];
		await v.click(v.button("Retry"));
		assert.equal(requests[0].start, sent.start);
		assert.equal(requests[0].offset, sent.offset);
		assert.ok(painted(v)[0].continued);
		assert.equal(painted(v)[0].index, split);
		v.unmount();
	} finally {
		respond = (request) => ({
			status: 200,
			body: {
				result: pageOf(request.start, request.limit, request.offset ?? 0),
			},
		});
	}
});
