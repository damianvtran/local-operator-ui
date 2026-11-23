import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = import.meta.dirname.replace(/\/scripts$/, "");
const { outputFiles } = await build({
	stdin: {
		contents: `
export { applyEvent, applyHistoryPage, EMPTY_TRANSCRIPT } from './src/renderer/src/features/chat/canonical/transcript-reducer';
export { copyMarkdownForRecord } from './src/renderer/src/features/chat/canonical/transcript-copy';
export { paintsSomething } from './src/renderer/src/features/chat/canonical/transcript-rows';
export { readInlineUi } from './src/renderer/src/features/chat/canonical/inline-ui-parts';
export { InlineUiHost } from './src/renderer/src/features/chat/canonical/inline-ui-host';
export { MarkdownRenderer, StreamingMarkdown } from './src/renderer/src/features/chat/components/markdown-renderer';
export { desktopRequest } from './src/renderer/src/shared/api/local-operator/desktop-api';
export { recordStreamCapabilityFlags } from './src/renderer/src/shared/api/local-operator/desktop-stream-capabilities';`,
		resolveDir: root,
	},
	bundle: true,
	platform: "node",
	format: "cjs",
	write: false,
	jsx: "automatic",
	mainFields: ["module", "main"],
	loader: { ".css": "empty", ".svg": "text" },
	alias: {
		"@shared": `${root}/src/renderer/src/shared`,
		"@assets": `${root}/src/renderer/src/assets`,
		"@features": `${root}/src/renderer/src/features`,
	},
	external: ["react", "react-dom", "@tanstack/react-query"],
	define: { "import.meta.env": "{}" },
});
// Load in memory so a targeting run does not write into the checkout or the
// shared dependency tree. External React is the same instance as the renderer.
const loaded = { exports: {} };
new Function("require", "module", "exports", outputFiles[0].text)(
	createRequire(import.meta.url),
	loaded,
	loaded.exports,
);
const {
	applyEvent,
	applyHistoryPage,
	copyMarkdownForRecord,
	desktopRequest,
	EMPTY_TRANSCRIPT,
	InlineUiHost,
	MarkdownRenderer,
	paintsSomething,
	readInlineUi,
	recordStreamCapabilityFlags,
	StreamingMarkdown,
} = loaded.exports;

const id = "assistant-row";
const before = "Before \u{10437}.\n\n";
const after = "Then **continue**.";
const text = `${before}\n${after}`;
const bar = { type: "bar", title: "Regional sales", data: [["North", 7]] };
const widget = { offset: before.length, payload: bar };
const sidecar = (basis, widgets = [widget]) => ({
	version: 1,
	messages: { [id]: { version: 1, text: basis, widgets } },
});
const message = (body = "", rowId = id) => ({
	id: rowId,
	role: "assistant",
	content: [{ type: "text", text: body }],
});
const apply = (state, type, body, fields = {}, seq = 1) =>
	applyEvent(state, { type, message: message(body), ...fields }, 100, {
		frame: { epoch: "inline-ui-test", seq },
	});
const history = (body, overlay) => ({
	entries: [{ id, type: "message", ts: 1, payload: message(body) }],
	cursor_missing: false,
	has_more: false,
	...(overlay === undefined ? {} : { inline_ui: overlay }),
});

test("live deltas, authoritative final text, and a durable replay give the same rich row", () => {
	const start = apply(EMPTY_TRANSCRIPT, "message_start", "");
	const partial = apply(start, "message_update", "", { delta: before }, 2);
	assert.equal(partial.records[0].text, before);
	assert.equal(partial.records[0].inlineUi, undefined);
	const close = apply(
		partial,
		"message_update",
		"",
		{ delta: "\n", inline_ui: sidecar(`${before}\n`) },
		3,
	);
	const full = apply(
		close,
		"message_update",
		"",
		{ delta: after, inline_ui: sidecar(text) },
		4,
	);
	assert.strictEqual(
		full.records[0].inlineUi.widgets,
		close.records[0].inlineUi.widgets,
	);
	const done = apply(
		full,
		"message_end",
		text,
		{ inline_ui: sidecar(text) },
		5,
	);
	const page = applyHistoryPage(done, history(text, sidecar(text)));
	assert.equal(page.records.length, 1);
	assert.equal(page.records[0].text, text);
	assert.strictEqual(page.records[0].inlineUi, done.records[0].inlineUi);
	assert.deepEqual(page.records[0].inlineUi.widgets, [
		{ offset: before.length, value: bar },
	]);
	assert.equal(
		copyMarkdownForRecord(page.records[0]),
		copyMarkdownForRecord(
			applyHistoryPage(EMPTY_TRANSCRIPT, history(text)).records[0],
		),
	);
});

test("a widget-only update can paint, old cursors cannot attach, and end tombstones clear it", () => {
	const start = apply(EMPTY_TRANSCRIPT, "message_start", "");
	const shape = sidecar("", [{ offset: 0, payload: bar }]);
	const widgetOnly = apply(
		start,
		"message_update",
		"",
		{ delta: "", inline_ui: shape },
		2,
	);
	assert.equal(widgetOnly.records[0].text, "");
	assert.equal(paintsSomething(widgetOnly.records[0]), true);
	assert.strictEqual(
		apply(widgetOnly, "message_update", "", { delta: "stale" }, 1),
		widgetOnly,
	);
	const end = apply(
		widgetOnly,
		"agent_end",
		"",
		{ inline_ui: { version: 1, messages: { [id]: null } } },
		3,
	);
	assert.equal(end.records[0].inlineUi, undefined);
	assert.equal(paintsSomething(end.records[0]), false);
});

test("a verified reconnect seed can advance a known prefix, not a divergent one", () => {
	const start = apply(EMPTY_TRANSCRIPT, "message_start", "");
	const prefix = apply(start, "message_update", "", { delta: before }, 2);
	const seed = (state) =>
		applyEvent(
			state,
			{
				type: "message_update",
				message: message(),
				delta: text,
				inline_ui: sidecar(text),
			},
			100,
			{ seed: true, frame: { epoch: "inline-ui-test", seq: 3 } },
		);
	assert.equal(seed(prefix).records[0].text, text);
	assert.equal(seed(prefix).records[0].truncated, undefined);
	assert.equal(seed(prefix).records[0].inlineUi.widgets.length, 1);
	const divergent = apply(
		start,
		"message_update",
		"",
		{ delta: "Our own text" },
		2,
	);
	assert.equal(seed(divergent).records[0].text, "Our own text");
	assert.equal(seed(divergent).records[0].inlineUi, undefined);
});

test("missing, malformed, and wrong-row overlays never reinterpret literal fences", () => {
	const sample = '```lop-ui\n{"type":"bar","data":[["North",7]]}\n```';
	for (const overlay of [
		undefined,
		sidecar(text),
		{ ...sidecar(sample), version: 2 },
		{ version: 1, messages: { other: sidecar(sample).messages[id] } },
	]) {
		const row = applyHistoryPage(EMPTY_TRANSCRIPT, history(sample, overlay))
			.records[0];
		assert.equal(row.text, sample);
		assert.equal(row.inlineUi, undefined);
		assert.equal(copyMarkdownForRecord(row), sample);
		const markup = renderToStaticMarkup(
			React.createElement(MarkdownRenderer, {
				content: row.text,
				linkify: false,
			}),
		);
		assert.ok(markup.includes("language-lop"));
		assert.ok(!markup.includes("data-lo-inline-ui"));
	}
	for (const bad of [
		{ ...widget, offset: before.indexOf("\u{10437}") + 1 },
		{
			...widget,
			payload: { ...bar, data: [["North", Number.POSITIVE_INFINITY]] },
		},
		{ ...widget, payload: { type: "html", title: "Ignore me" } },
	]) {
		assert.equal(
			readInlineUi(sidecar(text, [bad]).messages[id], text),
			undefined,
		);
	}
});

test("stream and settled Markdown place data in order without breaking a later reference link", () => {
	const head = "Before [the report][ref].\n\n";
	const tail = "After.\n\n[ref]: https://example.test/report";
	const content = head + tail;
	const inserts = [
		{
			offset: head.length,
			node: React.createElement(InlineUiHost, { value: bar }),
		},
	];
	for (const Component of [StreamingMarkdown, MarkdownRenderer]) {
		const markup = renderToStaticMarkup(
			React.createElement(Component, { content, inserts, linkify: false }),
		);
		assert.ok(markup.indexOf("Before") < markup.indexOf("Regional sales"));
		assert.ok(markup.indexOf("Regional sales") < markup.indexOf("After."));
		assert.ok(markup.includes('data-lo-inline-ui="bar"'));
		if (Component === MarkdownRenderer)
			assert.ok(markup.includes('href="https://example.test/report"'));
	}
});

test("the renderer sends strict inline_ui only after a capability answer", async () => {
	const requests = [];
	const original = globalThis.window;
	globalThis.window = {
		api: {
			desktop: {
				request: async (request) => {
					requests.push(request);
					return { status: 200, body: {} };
				},
			},
		},
	};
	try {
		const request = {
			op: "sessions.message",
			sessionId: "123456abcdef",
			requestId: "send",
			text: "Render the data",
		};
		recordStreamCapabilityFlags(null);
		await desktopRequest({ ...request, inlineUi: true });
		recordStreamCapabilityFlags({ inlineUi: true });
		await desktopRequest(request);
		recordStreamCapabilityFlags({ inlineUi: false });
		await desktopRequest(request);
		assert.deepEqual(requests, [
			request,
			{ ...request, inlineUi: true },
			request,
		]);
	} finally {
		globalThis.window = original;
		recordStreamCapabilityFlags(null);
	}
});

test("only an exact old-runtime rejection retries a capable send without the field", async () => {
	const requests = [];
	const refusal = (field) => ({
		status: 422,
		body: { detail: [{ type: "extra_forbidden", loc: ["body", field] }] },
	});
	const replies = [
		refusal("inline_ui"),
		{ status: 200, body: {} },
		refusal("another_field"),
	];
	const original = globalThis.window;
	globalThis.window = {
		api: {
			desktop: {
				request: async (request) => {
					requests.push(request);
					return replies.shift();
				},
			},
		},
	};
	try {
		const base = {
			op: "sessions.message",
			sessionId: "123456abcdef",
			requestId: "fixed",
			text: "Unchanged",
		};
		const capable = { ...base, inlineUi: true };
		recordStreamCapabilityFlags({ inlineUi: true });
		assert.equal((await desktopRequest(base)).status, 200);
		assert.equal((await desktopRequest(base)).status, 422);
		assert.deepEqual(requests, [capable, base, capable]);
	} finally {
		globalThis.window = original;
		recordStreamCapabilityFlags(null);
	}
});
