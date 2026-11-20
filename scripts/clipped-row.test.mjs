/**
 * The clipped-row marker and its full-output viewer (`clipped-row.tsx`,
 * `clipped-row-model.ts`), against the core's frozen contract (local-operator
 * PR #4337, `docs/DESKTOP_API.md` "Clipped rows"):
 *
 * - the marker line, the `ref: null` and child-transcript "cannot expand"
 *   states (no button), and the `omitted` placeholder;
 * - ranged reassembly where a range boundary splits a multi-byte character,
 *   decoded only after the join;
 * - a `bytes_total` change mid-read restarts from offset 0;
 * - 404 -> re-mint (`around_id`, `before=0`, `after=0`) -> retry EXACTLY once,
 *   both the success and the final-failure ending;
 * - Cancel aborts the read; a transport failure is retryable;
 * - the two new request ops' endpoints and their schema bounds.
 *
 * The fake server below clamps `limit` to a few bytes (the real one clamps to
 * 1 MiB): the procedure must advance by the answer's `length`, not its ask.
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
	Node: dom.window.Node,
	navigator: dom.window.navigator,
	// Radix's dialog (focus scope, presence) reads this off the global.
	getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
	// ...and DOM constructors (`NodeFilter`, `MutationObserver`, event types):
	// every capitalised window name node lacks (plus the event types node does
	// have), so the list cannot fall behind.
	...Object.fromEntries(
		Object.getOwnPropertyNames(dom.window)
			.filter(
				(name) =>
					/^[A-Z]/.test(name) &&
					// Node has its own `Event`/`CustomEvent`; jsdom refuses to dispatch them.
					(!(name in globalThis) || /Event$/.test(name)),
			)
			.map((name) => [name, dom.window[name]]),
	),
	IS_REACT_ACT_ENVIRONMENT: true,
	requestAnimationFrame: (cb) => setTimeout(cb, 0),
	cancelAnimationFrame: (id) => clearTimeout(id),
})) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
dom.window.matchMedia = () => ({
	matches: false,
	addEventListener() {},
	removeEventListener() {},
});
dom.window.HTMLElement.prototype.scrollIntoView = () => {};

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/canonical/clipped-row";',
			'export * from "./src/renderer/src/features/chat/canonical/clipped-row-model";',
			'export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";',
			'export { applyEvent, applyHistoryPage, EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";',
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
		"@features": "./src/renderer/src/features",
	},
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"lucide-react",
	],
	tsconfig: "tsconfig.app.json",
	logLevel: "silent",
	// Radix's scroll lock ships CJS that `require`s react: give the ESM bundle a
	// real `require` so it shares the one external react instead of failing.
	banner: {
		js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
	},
});
const bundlePath = new URL(
	`./_clipped-row-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const m = await import(bundlePath.href);
await unlink(bundlePath);
const { createElement: h, act, createRoot, setLocale } = m;
setLocale("en");
after(() => {
	dom.window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

// ---- a fake rows route ------------------------------------------------------

const SESSION = "a1b2c3d4e5f6";
const ROW_ID = "row_0001";
/** A full row whose text puts multi-byte characters across range boundaries. */
const fullRowOf = (text) =>
	JSON.stringify({
		id: ROW_ID,
		ts: 1,
		type: "message",
		payload: { role: "tool", content: [{ type: "text", text }] },
		ts_source: "entry",
	});
const TEXT = "héllo — 日本語 🙂 ".repeat(40);
const FULL = new TextEncoder().encode(fullRowOf(TEXT));
/** The fake's clamp: 7 bytes, so boundaries land inside é, —, 日 and 🙂. */
const CLAMP = 7;

function rangeOf(bytes, offset, limit) {
	const applied = Math.min(limit, CLAMP);
	const slice = bytes.subarray(offset, offset + applied);
	return {
		bytes_total: bytes.length,
		offset,
		limit: applied,
		length: slice.length,
		eof: offset + slice.length >= bytes.length,
		data: Buffer.from(slice).toString("base64"),
	};
}

const notFound = () => Object.assign(new Error("not found"), { status: 404 });

const marker = (overrides = {}) => ({
	bytes_total: FULL.length,
	shown_bytes: 300,
	ref: "r1.abc.def",
	reason: "open_frame_cap",
	...overrides,
});

/** A scripted server: `refs` maps a ref to the bytes it serves, or 404. */
function server({ refs, remint }) {
	const log = [];
	return {
		log,
		request: {
			range: async ({ ref, offset, limit }) => {
				log.push(["range", ref, offset, limit]);
				const entry = refs[ref];
				if (typeof entry === "function") return entry(offset, limit);
				if (!entry) throw notFound();
				return rangeOf(entry, offset, limit);
			},
			remint: async (rowId) => {
				log.push(["remint", rowId]);
				return remint(rowId);
			},
		},
	};
}

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const settle = async (n = 400) => {
	for (let i = 0; i < n; i += 1) await flush();
};

async function mount(Component, props) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(() => root.render(h(Component, props)));
	return {
		host,
		open: () => host.querySelector("[data-clipped-open]"),
		state: () =>
			host
				.querySelector("[data-clipped-row]")
				?.getAttribute("data-clipped-state"),
		viewer: (kind) => document.querySelector(`[data-clipped-viewer="${kind}"]`),
		click: async (el) => {
			await act(() => el.click());
			await flush();
		},
		// Async: Radix's focus scope restores focus on a timer after unmount, and
		// that event must fire while jsdom's globals are still installed.
		unmount: async () => {
			act(() => root.unmount());
			host.remove();
			await settle(5);
		},
	};
}

// ---- model ------------------------------------------------------------------

test("parseClippedMarker: valid, ref null, omitted, and malformed", () => {
	assert.deepEqual(m.parseClippedMarker(marker()), marker());
	assert.equal(m.parseClippedMarker(marker({ ref: null })).ref, null);
	assert.equal(
		m.parseClippedMarker(marker({ omitted: true, reason: "history_cap" }))
			.omitted,
		true,
	);
	for (const bad of [
		undefined,
		null,
		true,
		{},
		marker({ reason: "budget" }),
		marker({ bytes_total: -1 }),
		marker({ shown_bytes: 1.5 }),
	])
		assert.equal(m.parseClippedMarker(bad), null);
});

test("the fixture really splits multi-byte characters across ranges", () => {
	// Guard on the guard: if no boundary split a character, the reassembly
	// test below would pass for a decoder that decodes range by range.
	let splits = 0;
	for (let offset = 0; offset < FULL.length; offset += CLAMP) {
		try {
			new TextDecoder("utf-8", { fatal: true }).decode(
				FULL.subarray(offset, offset + CLAMP),
			);
		} catch {
			splits += 1;
		}
	}
	assert.ok(splits > 10, `expected split characters, got ${splits}`);
});

test("reassembly: ranges joined then decoded once; progress reaches the total", async () => {
	const { request, log } = server({
		refs: { "r1.abc.def": FULL },
		remint: () => assert.fail("no remint"),
	});
	const progress = [];
	const outcome = await m.fetchClippedRow({
		rowId: ROW_ID,
		marker: marker(),
		request,
		signal: new AbortController().signal,
		onProgress: (p) => progress.push(p),
	});
	assert.equal(outcome.kind, "complete");
	assert.equal(outcome.text, fullRowOf(TEXT));
	assert.equal(outcome.bytes, FULL.length);
	assert.equal(log.length, Math.ceil(FULL.length / CLAMP));
	// Advances by the answer's length; always ASKS for the 1 MiB clamp.
	assert.deepEqual(
		log.slice(0, 3).map(([, , offset, limit]) => [offset, limit]),
		[
			[0, 1_048_576],
			[CLAMP, 1_048_576],
			[2 * CLAMP, 1_048_576],
		],
	);
	assert.deepEqual(progress.at(-1), {
		received: FULL.length,
		total: FULL.length,
	});
});

test("a changed bytes_total restarts from offset 0 with the new total", async () => {
	const grown = new TextEncoder().encode(fullRowOf(`${TEXT}more`));
	let calls = 0;
	const { request, log } = server({
		refs: {
			"r1.abc.def": (offset, limit) => {
				calls += 1;
				// Two ranges of the old row, then the row is rewritten.
				return rangeOf(calls <= 2 ? FULL : grown, offset, limit);
			},
		},
		remint: () => assert.fail("no remint"),
	});
	const outcome = await m.fetchClippedRow({
		rowId: ROW_ID,
		marker: marker(),
		request,
		signal: new AbortController().signal,
		onProgress: () => {},
	});
	assert.equal(outcome.kind, "complete");
	assert.equal(outcome.text, fullRowOf(`${TEXT}more`));
	assert.deepEqual(
		log.slice(1, 4).map(([, , offset]) => offset),
		[CLAMP, CLAMP * 2, 0],
		"the third answer's new total sends the read back to offset 0",
	);
});

test("ref null never calls the route", async () => {
	const { request, log } = server({ refs: {}, remint: () => ({}) });
	const outcome = await m.fetchClippedRow({
		rowId: ROW_ID,
		marker: marker({ ref: null }),
		request,
		signal: new AbortController().signal,
		onProgress: () => {},
	});
	assert.equal(outcome.kind, "final");
	assert.deepEqual(log, []);
});

test("404 -> re-mint -> retry succeeds with the fresh ref", async () => {
	const { request, log } = server({
		refs: { "r1.fresh.ref": FULL },
		remint: (rowId) => ({
			entries: [
				{
					id: rowId,
					ts: 1,
					type: "message",
					payload: {},
					truncated: marker({ ref: "r1.fresh.ref", reason: "history_cap" }),
				},
			],
			has_more: false,
			cursor_missing: false,
		}),
	});
	const outcome = await m.fetchClippedRow({
		rowId: ROW_ID,
		marker: marker(),
		request,
		signal: new AbortController().signal,
		onProgress: () => {},
	});
	assert.equal(outcome.kind, "complete");
	assert.equal(outcome.text, fullRowOf(TEXT));
	assert.deepEqual(log[0], ["range", "r1.abc.def", 0, 1_048_576]);
	assert.deepEqual(log[1], ["remint", ROW_ID]);
	assert.equal(log.filter(([op]) => op === "remint").length, 1);
	assert.ok(log.slice(2).every(([, ref]) => ref === "r1.fresh.ref"));
});

test("404 -> re-mint -> 404 again is final, after exactly one retry", async () => {
	const { request, log } = server({
		refs: {},
		remint: (rowId) => ({
			entries: [
				{
					id: rowId,
					ts: 1,
					type: "message",
					payload: {},
					truncated: marker({ ref: "r1.fresh.ref" }),
				},
			],
			has_more: false,
			cursor_missing: false,
		}),
	});
	const outcome = await m.fetchClippedRow({
		rowId: ROW_ID,
		marker: marker(),
		request,
		signal: new AbortController().signal,
		onProgress: () => {},
	});
	assert.equal(outcome.kind, "final");
	assert.deepEqual(log, [
		["range", "r1.abc.def", 0, 1_048_576],
		["remint", ROW_ID],
		["range", "r1.fresh.ref", 0, 1_048_576],
	]);
});

test("a re-mint that returns the row unclipped is final", async () => {
	const { request, log } = server({
		refs: {},
		remint: (rowId) => ({
			entries: [{ id: rowId, ts: 1, type: "message", payload: {} }],
			has_more: false,
			cursor_missing: false,
		}),
	});
	const outcome = await m.fetchClippedRow({
		rowId: ROW_ID,
		marker: marker(),
		request,
		signal: new AbortController().signal,
		onProgress: () => {},
	});
	assert.equal(outcome.kind, "final");
	assert.equal(log.length, 2);
});

test("a transport failure (not a 404) is retryable, not final", async () => {
	const { request, log } = server({
		refs: {
			"r1.abc.def": () => {
				throw Object.assign(new Error("down"), { status: null });
			},
		},
		remint: () => assert.fail("a non-404 never re-mints"),
	});
	const outcome = await m.fetchClippedRow({
		rowId: ROW_ID,
		marker: marker(),
		request,
		signal: new AbortController().signal,
		onProgress: () => {},
	});
	assert.equal(outcome.kind, "failed");
	assert.equal(log.length, 1);
});

test("display text: the message's text, else the payload as JSON", () => {
	const text = (payload) =>
		(payload.content ?? []).map((block) => block.text ?? "").join("");
	assert.equal(m.clippedRowDisplayText(fullRowOf("abc"), text), "abc");
	assert.equal(
		m.clippedRowDisplayText(
			JSON.stringify({ id: "x", payload: { custom_type: "c" } }),
			text,
		),
		JSON.stringify({ custom_type: "c" }, null, 2),
	);
	assert.equal(m.clippedRowDisplayText("not json", text), "not json");
});

// ---- component --------------------------------------------------------------

test("marker: 'showing X of Y' with an Open action", async () => {
	const { request } = server({ refs: {}, remint: () => ({}) });
	const view = await mount(m.ClippedRowMarker, {
		rowId: ROW_ID,
		marker: marker({ bytes_total: 12_583_147, shown_bytes: 1_200_000 }),
		sessionId: SESSION,
		request,
	});
	assert.equal(view.state(), "expandable");
	assert.match(
		view.host.textContent,
		/Output truncated — showing 1\.2\sMB of 13\sMB/,
	);
	assert.equal(view.open()?.textContent, "Open full output");
	await view.unmount();
});

test("ref null: 'cannot expand on this device' and no button", async () => {
	const view = await mount(m.ClippedRowMarker, {
		rowId: ROW_ID,
		marker: marker({ ref: null }),
		sessionId: SESSION,
	});
	assert.equal(view.state(), "cannot-expand");
	assert.equal(
		view.host.textContent,
		"Output truncated — cannot expand on this device",
	);
	assert.equal(view.open(), null);
	assert.equal(view.host.querySelectorAll("button").length, 0);
	await view.unmount();
});

test("no fetchable session (a child transcript) also reads as cannot expand", async () => {
	const view = await mount(m.ClippedRowMarker, {
		rowId: ROW_ID,
		marker: marker(),
		sessionId: null,
	});
	assert.equal(view.state(), "cannot-expand");
	assert.equal(view.host.querySelectorAll("button").length, 0);
	await view.unmount();
});

test("omitted: a placeholder with its size, never an empty block", async () => {
	const { request } = server({ refs: {}, remint: () => ({}) });
	const view = await mount(m.ClippedRowPlaceholder, {
		rowId: ROW_ID,
		marker: marker({
			bytes_total: 10_524_128,
			omitted: true,
			reason: "history_cap",
		}),
		sessionId: SESSION,
		request,
	});
	const placeholder = view.host.querySelector("[data-clipped-placeholder]");
	assert.ok(placeholder);
	assert.match(
		placeholder.textContent,
		/This entry is too large to show here \(11\sMB\)\./,
	);
	assert.ok(view.open(), "an omitted row with a ref can still be opened");
	await view.unmount();
});

test("viewer: opens, shows progress, reassembles split characters", async () => {
	// Hold the read after three ranges so the progress state can be read.
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const request = {
		range: async ({ offset, limit }) => {
			if (offset >= CLAMP * 3) await gate;
			return rangeOf(FULL, offset, limit);
		},
		remint: async () => assert.fail("no remint"),
	};
	const view = await mount(m.ClippedRowMarker, {
		rowId: ROW_ID,
		marker: marker(),
		sessionId: SESSION,
		request,
	});
	await view.click(view.open());
	await settle(10);
	const loading = view.viewer("loading");
	assert.ok(loading, "the progress state paints first");
	const bar = document.querySelector('[role="progressbar"]');
	assert.equal(bar?.getAttribute("aria-label"), "Full output loading progress");
	assert.equal(bar?.getAttribute("aria-valuenow"), String(CLAMP * 3));
	assert.match(loading.textContent, /^Loading full output — 21 B of 1\.\d KB$/);
	assert.ok(document.querySelector("[data-clipped-cancel]"));
	release();
	await settle();
	const pre = view.viewer("complete");
	assert.ok(pre, "the full output paints");
	assert.equal(pre.textContent, TEXT);
	assert.ok(!pre.textContent.includes("\uFFFD"), "no replacement characters");
	assert.ok(document.querySelector("[data-clipped-close]"));
	await view.unmount();
});

test("viewer: 404 -> re-mint -> 404 makes the marker final, with no button", async () => {
	const { request, log } = server({
		refs: {},
		remint: (rowId) => ({
			entries: [
				{
					id: rowId,
					ts: 1,
					type: "message",
					payload: {},
					truncated: marker({ ref: "r1.fresh.ref" }),
				},
			],
			has_more: false,
			cursor_missing: false,
		}),
	});
	const view = await mount(m.ClippedRowMarker, {
		rowId: ROW_ID,
		marker: marker(),
		sessionId: SESSION,
		request,
	});
	await view.click(view.open());
	await settle(20);
	assert.equal(view.state(), "final");
	assert.equal(view.open(), null, "no dead button after the final failure");
	assert.match(view.host.textContent, /no longer available/);
	assert.equal(document.querySelector("[data-clipped-viewer]"), null);
	assert.equal(log.length, 3);
	await view.unmount();
});

test("viewer: Cancel aborts the read; no range is requested after it", async () => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const log = [];
	const request = {
		range: async ({ offset, limit }) => {
			log.push(offset);
			if (offset >= CLAMP * 3) await gate;
			return rangeOf(FULL, offset, limit);
		},
		remint: async () => assert.fail("no remint"),
	};
	const view = await mount(m.ClippedRowMarker, {
		rowId: ROW_ID,
		marker: marker(),
		sessionId: SESSION,
		request,
	});
	await view.click(view.open());
	await settle(10);
	const cancel = document.querySelector("[data-clipped-cancel]");
	assert.ok(cancel);
	await view.click(cancel);
	const before = log.length;
	release();
	await settle(10);
	assert.equal(log.length, before, "the aborted read stops at once");
	assert.equal(document.querySelector("[data-clipped-viewer]"), null);
	assert.equal(view.state(), "expandable", "cancel is not a final failure");
	await view.unmount();
});

test("viewer: a transport failure offers Try again, which re-reads", async () => {
	let fail = true;
	const log = [];
	const request = {
		range: async ({ offset, limit }) => {
			log.push(offset);
			if (fail) throw Object.assign(new Error("down"), { status: null });
			return rangeOf(FULL, offset, limit);
		},
		remint: async () => assert.fail("no remint"),
	};
	const view = await mount(m.ClippedRowMarker, {
		rowId: ROW_ID,
		marker: marker(),
		sessionId: SESSION,
		request,
	});
	await view.click(view.open());
	await settle(10);
	assert.ok(view.viewer("failed"));
	fail = false;
	await view.click(document.querySelector("[data-clipped-retry]"));
	await settle();
	assert.equal(view.viewer("complete")?.textContent, TEXT);
	await view.unmount();
});

// ---- the reducer stamp ------------------------------------------------------

test("reducer: a clipped entry's marker rides its record, keyed by the ENTRY id", () => {
	const entry = (truncated) => ({
		id: "e_clipped",
		ts: 1,
		type: "message",
		payload: {
			role: "assistant",
			content: [{ type: "text", text: "preview" }],
		},
		...(truncated ? { truncated } : {}),
	});
	const page = (...entries) => ({
		entries,
		has_more: false,
		cursor_missing: false,
	});
	const find = (state) => state.records.find((r) => r.id === "e_clipped");
	let state = m.applyHistoryPage(m.EMPTY_TRANSCRIPT, page(entry(marker())));
	const first = find(state);
	assert.ok(first, "the clipped row still paints its preview");
	assert.deepEqual(first.clipped, { ...marker(), entryId: "e_clipped" });
	// A re-read of the same page keeps the marker's reference (no repaint).
	state = m.applyHistoryPage(state, page(entry(marker())));
	assert.equal(find(state).clipped, first.clipped);
	// A re-read where the row now fits drops the stale marker.
	state = m.applyHistoryPage(state, page(entry(null)));
	assert.equal(find(state).clipped, undefined);
	// Malformed markers are "not clipped", never a half-parsed stamp.
	state = m.applyHistoryPage(
		m.EMPTY_TRANSCRIPT,
		page(entry({ bytes_total: "x", reason: "history_cap" })),
	);
	assert.equal(find(state).clipped, undefined);
});

const historyPage = (...entries) => ({
	entries,
	has_more: false,
	cursor_missing: false,
});

test("reducer: a withheld supplement row reaches the transcript as its placeholder (M1)", async () => {
	// The core's withheld row: the payload is emptied whole, so the supplement
	// has no `details` and its own builder has nothing to key on.
	const withheld = marker({
		bytes_total: 10_524_128,
		omitted: true,
		reason: "history_cap",
	});
	const state = m.applyHistoryPage(
		m.EMPTY_TRANSCRIPT,
		historyPage({
			id: "e_sup",
			ts: 1,
			type: "custom",
			payload: { custom_type: "supplement_v1" },
			truncated: withheld,
		}),
	);
	assert.equal(state.records.length, 1, "the withheld row is not dropped");
	const [record] = state.records;
	assert.equal(record.id, "e_sup");
	assert.deepEqual(record.clipped, { ...withheld, entryId: "e_sup" });
	// The SAME branch `TranscriptRow` runs, on the record the reducer built,
	// with no body at all: the placeholder must still win.
	const { request } = server({ refs: {}, remint: () => ({}) });
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(() =>
		root.render(m.clippedRowBody(null, record.clipped, SESSION, request)),
	);
	const placeholder = host.querySelector("[data-clipped-placeholder]");
	assert.ok(placeholder, "the placeholder renders");
	assert.equal(placeholder.getAttribute("data-clipped-placeholder"), "e_sup");
	assert.match(placeholder.textContent, /too large to show here \(11\sMB\)/);
	act(() => root.unmount());
	host.remove();
	await settle(5);
	// An unclipped null body stays null (a hidden row is not resurrected).
	assert.equal(m.clippedRowBody(null, undefined, SESSION), null);
});

test("reducer: a withheld bookkeeping row (the state checkpoint) stays invisible", () => {
	const state = m.applyHistoryPage(
		m.EMPTY_TRANSCRIPT,
		historyPage({
			id: "e_ckpt",
			ts: 1,
			type: "custom",
			payload: { custom_type: "frontend_state_checkpoint_v1" },
			truncated: marker({ omitted: true, reason: "history_cap" }),
		}),
	);
	assert.deepEqual(state.records, []);
});

// A live `tool_execution_end` NEVER clears the page's clipped marker (QA round
// 2, Q2-1). A row big enough to clip (over the core's 1.5 MiB row budget) never
// reaches the client whole live: the reconnect seed trims it
// (`frontend_state._bound_live_events_in_place`) and a frame over the 1 MiB
// wire line is cut or emptied (`runtime/server.py::fit_frame_for_wire`). Each
// case is a shape the core really sends for such a row, applied over the page's
// clipped record the way `use-canonical-session` does (page first, then seed).
const clippedToolPage = () =>
	m.applyHistoryPage(
		m.EMPTY_TRANSCRIPT,
		historyPage({
			id: "e_tool",
			ts: 1,
			type: "message",
			payload: {
				role: "tool",
				tool_call_id: "call_1",
				tool_name: "bash",
				content: [{ type: "text", text: "PREVIEW" }],
			},
			truncated: marker({ bytes_total: 13_260_171 }),
		}),
	);
const toolEnd = (extra) => ({
	type: "tool_execution_end",
	tool_call_id: "call_1",
	tool_name: "bash",
	...extra,
});
for (const [label, event, options] of [
	[
		"a seed-trimmed end (short text with an ellipsis)",
		toolEnd({
			result: { content: [{ type: "text", text: `${"x".repeat(206)}…` }] },
		}),
		{ seed: true },
	],
	["an end with content: []", toolEnd({ result: { content: [] } }), {}],
	["an end with no result", toolEnd({}), {}],
	[
		"a live end that looks complete",
		toolEnd({ result: { content: [{ type: "text", text: "FULL OUT" }] } }),
		{},
	],
]) {
	test(`reducer: ${label} keeps the page's clipped marker (Q2-1)`, () => {
		let state = clippedToolPage();
		const before = state.records.find((r) => r.id === "tool:call_1");
		assert.ok(before?.clipped, "the page's tool row carries the marker");
		state = m.applyEvent(state, event, Date.now(), options);
		const settled = state.records.find((r) => r.id === "tool:call_1");
		assert.equal(settled.phase, "done", "the end event did settle the row");
		assert.deepEqual(
			settled.clipped,
			{ ...marker({ bytes_total: 13_260_171 }), entryId: "e_tool" },
			"a clipped row is never painted as complete",
		);
	});
}

// ---- the bytes_total ceiling and the re-mint transport path ------------------

test("a bytes_total over the client ceiling is final before any request (m2)", async () => {
	const { request, log } = server({
		refs: { "r1.abc.def": FULL },
		remint: () => assert.fail("never re-mints"),
	});
	const outcome = await m.fetchClippedRow({
		rowId: ROW_ID,
		marker: marker({ bytes_total: 2 * 1024 ** 3 }),
		request,
		signal: new AbortController().signal,
		onProgress: () => assert.fail("nothing is allocated or reported"),
	});
	assert.equal(outcome.kind, "final");
	assert.deepEqual(log, [], "no range is requested");
	assert.ok(m.MAX_CLIPPED_ROW_BYTES >= 256 * 1024 * 1024);
});

test("a restart onto a total over the ceiling is final, not a retry loop (m2)", async () => {
	const { request, log } = server({
		refs: {
			"r1.abc.def": (offset, limit) => ({
				...rangeOf(FULL, offset, limit),
				bytes_total: m.MAX_CLIPPED_ROW_BYTES + 1,
			}),
		},
		remint: () => assert.fail("never re-mints"),
	});
	const outcome = await m.fetchClippedRow({
		rowId: ROW_ID,
		marker: marker(),
		request,
		signal: new AbortController().signal,
		onProgress: () => {},
	});
	assert.equal(outcome.kind, "final");
	assert.equal(log.length, 1);
});

test("viewer: an over-ceiling row reads as final with no button (m2)", async () => {
	const { request, log } = server({ refs: {}, remint: () => ({}) });
	const view = await mount(m.ClippedRowMarker, {
		rowId: ROW_ID,
		marker: marker({ bytes_total: 2 * 1024 ** 3 }),
		sessionId: SESSION,
		request,
	});
	await view.click(view.open());
	await settle(20);
	assert.equal(view.state(), "final");
	assert.equal(view.open(), null);
	assert.deepEqual(log, []);
	await view.unmount();
});

const transportDown = () => Object.assign(new Error("down"), { status: null });

test("404 -> re-mint transport failure is retryable, with one re-mint per attempt (m3)", async () => {
	let remintFails = true;
	const { request, log } = server({
		refs: { "r1.fresh.ref": FULL },
		remint: (rowId) => {
			if (remintFails) throw transportDown();
			return {
				entries: [
					{
						id: rowId,
						ts: 1,
						type: "message",
						payload: {},
						truncated: marker({ ref: "r1.fresh.ref" }),
					},
				],
				has_more: false,
				cursor_missing: false,
			};
		},
	});
	const run = () =>
		m.fetchClippedRow({
			rowId: ROW_ID,
			marker: marker(),
			request,
			signal: new AbortController().signal,
			onProgress: () => {},
		});
	assert.equal((await run()).kind, "failed");
	assert.deepEqual(log, [
		["range", "r1.abc.def", 0, 1_048_576],
		["remint", ROW_ID],
	]);
	// Try again: a NEW attempt, which re-mints once more and completes.
	remintFails = false;
	log.length = 0;
	const second = await run();
	assert.equal(second.kind, "complete");
	assert.equal(log.filter(([op]) => op === "remint").length, 1);
});

test("404 -> re-mint -> retried read transport failure is retryable (m3)", async () => {
	const { request, log } = server({
		refs: {
			"r1.fresh.ref": () => {
				throw transportDown();
			},
		},
		remint: (rowId) => ({
			entries: [
				{
					id: rowId,
					ts: 1,
					type: "message",
					payload: {},
					truncated: marker({ ref: "r1.fresh.ref" }),
				},
			],
			has_more: false,
			cursor_missing: false,
		}),
	});
	const outcome = await m.fetchClippedRow({
		rowId: ROW_ID,
		marker: marker(),
		request,
		signal: new AbortController().signal,
		onProgress: () => {},
	});
	assert.equal(outcome.kind, "failed");
	assert.equal(log.filter(([op]) => op === "remint").length, 1);
});

test("viewer: a re-mint transport failure keeps Try again offered (m3)", async () => {
	const { request } = server({
		refs: {},
		remint: () => {
			throw transportDown();
		},
	});
	const view = await mount(m.ClippedRowMarker, {
		rowId: ROW_ID,
		marker: marker(),
		sessionId: SESSION,
		request,
	});
	await view.click(view.open());
	await settle(20);
	assert.ok(view.viewer("failed"), "the viewer offers Try again");
	assert.ok(document.querySelector("[data-clipped-retry]"));
	assert.notEqual(view.state(), "final");
	await view.unmount();
});

// ---- the request ops --------------------------------------------------------

test("endpoints: the rows route and the zero-width re-mint read", () => {
	assert.deepEqual(
		m.desktopEndpoint({
			op: "sessions.historyRow",
			sessionId: SESSION,
			ref: "r1.AAAA-_.BBBB",
			offset: 2_097_152,
			limit: 1_048_576,
		}),
		{
			path: `/v1/desktop/sessions/${SESSION}/history/rows/r1.AAAA-_.BBBB?offset=2097152&limit=1048576`,
			method: "GET",
		},
	);
	assert.deepEqual(
		m.desktopEndpoint({
			op: "sessions.historyRowRef",
			sessionId: SESSION,
			rowId: ROW_ID,
		}),
		{
			path: `/v1/desktop/sessions/${SESSION}/history?around_id=${ROW_ID}&before=0&after=0`,
			method: "GET",
		},
	);
});

test("schema: a ref is one path segment and the limit is the 1 MiB clamp", () => {
	const ok = (request) => m.desktopRequestSchema.safeParse(request).success;
	const base = {
		op: "sessions.historyRow",
		sessionId: SESSION,
		ref: "r1.a.b",
		offset: 0,
		limit: 1_048_576,
	};
	assert.ok(ok(base));
	for (const bad of [
		{ ...base, ref: "../x" },
		{ ...base, ref: "a/b" },
		{ ...base, ref: "" },
		{ ...base, offset: -1 },
		{ ...base, offset: 0.5 },
		{ ...base, limit: 1_048_577 },
		{ ...base, limit: 0 },
		{ ...base, extra: 1 },
	])
		assert.ok(!ok(bad), JSON.stringify(bad));
	assert.ok(
		ok({ op: "sessions.historyRowRef", sessionId: SESSION, rowId: ROW_ID }),
	);
	assert.ok(
		!ok({ op: "sessions.historyRowRef", sessionId: SESSION, rowId: "../x" }),
	);
});
