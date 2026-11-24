import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
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
export { MarkdownRenderer } from './src/renderer/src/features/chat/components/markdown-renderer';
export { DesktopStreamRelay } from './src/main/desktop-stream';
export { requestDesktop } from './src/main/desktop-transport';
export { desktopRequest, subscribeDesktopStream } from './src/renderer/src/shared/api/local-operator/desktop-api';
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
	DesktopStreamRelay,
	EMPTY_TRANSCRIPT,
	InlineUiHost,
	MarkdownRenderer,
	paintsSomething,
	readInlineUi,
	recordStreamCapabilityFlags,
	requestDesktop,
	subscribeDesktopStream,
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

test("an explicitly empty pre-widget reconnect seed repairs prose and the next live widget", () => {
	const start = apply(EMPTY_TRANSCRIPT, "message_start", "");
	const prefix = apply(start, "message_update", "", { delta: "Before " }, 2);
	const basis = `${before}A sentence missed on reconnect.\n\n`;
	const nextWidget = { ...widget, offset: basis.length };
	const seedEvent = {
		type: "message_update",
		message: message(),
		delta: basis,
		inline_ui: sidecar(basis, []),
	};
	const frame = { epoch: "inline-ui-test", seq: 3 };
	const repaired = applyEvent(prefix, seedEvent, 100, { seed: true, frame });
	assert.equal(repaired.records[0].text, basis);
	assert.equal(repaired.records[0].truncated, undefined);
	assert.equal(
		repaired.records[0].inlineUi,
		undefined,
		"a marker is not a figure",
	);
	const joined = applyEvent(EMPTY_TRANSCRIPT, seedEvent, 100, {
		seed: true,
		frame,
	});
	assert.equal(
		joined.records[0].truncated,
		undefined,
		"no false missing-prefix caption",
	);
	const next = apply(
		repaired,
		"message_update",
		"",
		{
			delta: after,
			inline_ui: sidecar(basis + after, [nextWidget]),
		},
		4,
	);
	assert.equal(next.records[0].text, basis + after);
	assert.deepEqual(next.records[0].inlineUi.widgets, [
		{ offset: basis.length, value: bar },
	]);
	for (const denied of [
		applyEvent(prefix, { ...seedEvent, inline_ui: undefined }, 100, {
			seed: true,
			frame,
		}),
		applyEvent(
			prefix,
			{
				...seedEvent,
				inline_ui: sidecar(basis, [{ offset: -1, payload: bar }]),
			},
			100,
			{ seed: true, frame },
		),
		applyEvent(prefix, seedEvent, 100, {
			seed: true,
			frame: { ...frame, seq: 1 },
		}),
	]) {
		assert.equal(denied.records[0].text, "Before ");
		assert.equal(denied.records[0].inlineUi, undefined);
	}
	const ordinary = applyEvent(prefix, seedEvent, 100, { frame });
	assert.equal(
		ordinary.records[0].text,
		`Before ${basis}`,
		"a normal delta is never inferred cumulative",
	);
	assert.equal(ordinary.records[0].inlineUi, undefined);
});

test("history_delta forwards valid overlays on merge and reset; wrong-basis data stays prose", () => {
	for (const reset of [false, true]) {
		const event = { type: "history_delta", messages: [message(text)], reset };
		const withOverlay = applyEvent(
			EMPTY_TRANSCRIPT,
			{ ...event, inline_ui: sidecar(text) },
			100,
		);
		assert.equal(withOverlay.records[0]?.text, text);
		assert.deepEqual(withOverlay.records[0]?.inlineUi?.widgets, [
			{ offset: before.length, value: bar },
		]);
		const wrong = applyEvent(
			EMPTY_TRANSCRIPT,
			{ ...event, inline_ui: sidecar(`${text}other`) },
			100,
		);
		assert.equal(wrong.records[0]?.text, text);
		assert.equal(wrong.records[0]?.inlineUi, undefined);
	}
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
	for (const streaming of [true, false]) {
		const markup = renderToStaticMarkup(
			React.createElement(MarkdownRenderer, {
				content,
				inserts,
				streaming,
				linkify: false,
			}),
		);
		assert.ok(markup.indexOf("Before") < markup.indexOf("Regional sales"));
		assert.ok(markup.indexOf("Regional sales") < markup.indexOf("After."));
		assert.ok(markup.includes('data-lo-inline-ui="bar"'));
		assert.ok(markup.includes('href="https://example.test/report"'));
	}
});

test("list items on either side of a widget paint separately without losing whole-document references", () => {
	for (const [marker, nextMarker, tag] of [
		["-", "-", "ul"],
		["3.", "8.", "ol"],
	]) {
		const head = `${marker} Before [the report][ref]\n`;
		const content = `${head}\n${nextMarker} After item\n\n[ref]: https://example.test/report`;
		const inserts = [
			{
				offset: head.length,
				node: React.createElement(InlineUiHost, { value: bar }),
			},
		];
		for (const streaming of [true, false]) {
			const markup = renderToStaticMarkup(
				React.createElement(MarkdownRenderer, {
					content,
					inserts,
					streaming,
					linkify: false,
				}),
			);
			assert.ok(
				markup.indexOf(`</${tag}>`) < markup.indexOf("Regional sales"),
				markup,
			);
			assert.ok(
				markup.indexOf("Regional sales") < markup.indexOf("After item"),
				markup,
			);
			assert.equal(
				markup.match(new RegExp(`<${tag}( |>)+`, "g")).length,
				2,
				markup,
			);
			if (tag === "ol") {
				// Attribute-order-agnostic: every list also carries its own
				// `dir="auto"` (i18n census N2, `rehype-block-direction.ts`).
				assert.match(markup, /<ol\b[^>]*\bstart="3"[^>]*>/);
				assert.match(markup, /<ol\b[^>]*\bstart="8"[^>]*>/);
			}
			assert.ok(markup.includes('href="https://example.test/report"'));
		}
	}
});

test("decimal strings stay exact and unsafe numeric inputs never reach a plot or exact grid", () => {
	const distinct = ["9007199254740993", "9007199254740992"];
	for (const type of ["table", "spreadsheet"]) {
		const valid = {
			type,
			title: "Exact totals",
			columns: ["count"],
			rows: distinct.map((n) => [n]),
		};
		const read = (payload) =>
			readInlineUi(sidecar(text, [{ ...widget, payload }]).messages[id], text);
		const view = read(valid)?.widgets[0]?.value;
		assert.deepEqual(view?.rows, valid.rows);
		const markup = renderToStaticMarkup(
			React.createElement(InlineUiHost, { value: view }),
		);
		for (const n of distinct) assert.ok(markup.includes(n));
		assert.equal(read({ ...valid, rows: [[Number(distinct[0])]] }), undefined);
	}
	const unsafe = JSON.parse("9007199254740993");
	for (const payload of [
		{ ...bar, data: [["North", unsafe]] },
		{
			type: "scatter",
			title: "Plot",
			xLabel: "X",
			yLabel: "Y",
			data: [[1, unsafe]],
		},
		{
			type: "heatmap",
			title: "Plot",
			columns: ["X"],
			rowLabels: ["Y"],
			rows: [[unsafe]],
		},
		{
			type: "series",
			title: "Plot",
			mode: "grouped",
			labels: ["X"],
			series: [{ label: "Y", values: [unsafe] }],
		},
	]) {
		assert.equal(
			readInlineUi(sidecar(text, [{ ...widget, payload }]).messages[id], text),
			undefined,
		);
	}
	assert.ok(
		readInlineUi(
			sidecar(text, [
				{
					...widget,
					payload: { ...bar, data: [["North", Number.MAX_SAFE_INTEGER]] },
				},
			]).messages[id],
			text,
		),
	);
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

const CANONICAL_CAPS = {
	desktop_contract: 1,
	desktop_available: true,
	desktop_auth: "bearer",
};

test("sanitized validation retries once only after a fresh authoritative legacy feature answer", async () => {
	const request = {
		op: "sessions.message",
		sessionId: "123456abcdef",
		requestId: "stable",
		text: "Unchanged",
	};
	const sanitized = {
		status: 422,
		body: { detail: "The request has invalid fields." },
	};
	const capable = { ...request, inlineUi: true };
	const caps = { op: "capabilities" };
	const reply = (fields) => ({ status: 200, body: { result: fields } });
	const legacy = reply({ ...CANONICAL_CAPS, features: { open_frame: 1 } });
	const original = globalThis.window;
	try {
		for (const result of [
			reply({ ...CANONICAL_CAPS, features: { inline_ui: 1 } }),
			reply({ ...CANONICAL_CAPS, features: { inline_ui: "0" } }),
			reply({ ...CANONICAL_CAPS, desktop_available: false, features: {} }),
			reply({ ...CANONICAL_CAPS, features: [] }),
			{ status: 503, body: {} },
			new Error("Transport refused the probe"),
			legacy,
		]) {
			const requests = [];
			globalThis.window = {
				api: {
					desktop: {
						request: async (packet) => {
							requests.push(packet);
							if (packet.op === "capabilities") {
								if (result instanceof Error) throw result;
								return result;
							}
							// Even a second 422 is not recursively retried.
							return sanitized;
						},
					},
				},
			};
			recordStreamCapabilityFlags({ inlineUi: true });
			assert.deepEqual(await desktopRequest(request), sanitized);
			assert.deepEqual(
				requests,
				result === legacy ? [capable, caps, request] : [capable, caps],
			);
		}
	} finally {
		globalThis.window = original;
		recordStreamCapabilityFlags(null);
	}
});

test(
	"renderer → main → loopback preserves legacy audit queries and opts only transcript reads into inline UI",
	{ timeout: 5000 },
	async () => {
		const requests = [];
		const server = createServer(async (req, res) => {
			const url = new URL(req.url, "http://127.0.0.1");
			const chunks = [];
			for await (const chunk of req) chunks.push(chunk);
			const json = chunks.length
				? JSON.parse(Buffer.concat(chunks))
				: undefined;
			requests.push({
				path: url.pathname,
				query: Object.fromEntries(url.searchParams),
				method: req.method,
				json,
			});
			if (url.pathname.endsWith("/events")) {
				res.writeHead(200, { "content-type": "text/event-stream" });
				res.end('data: {"type":"heartbeat"}\n\n');
			} else {
				res.writeHead(200, { "content-type": "application/json" });
				res.end('{"result":{}}');
			}
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const backend = `http://127.0.0.1:${server.address().port}`;
		const relay = new DesktopStreamRelay(backend, "fixture-only");
		const original = globalThis.window;
		globalThis.window = {
			api: {
				desktop: {
					request: (packet) => requestDesktop(packet, backend, "fixture-only"),
					stream: {
						subscribe(args, emit) {
							const { streamId } = relay.subscribe(args, emit);
							return { dispose: () => relay.unsubscribe(streamId) };
						},
					},
				},
			},
		};
		try {
			const sessionId = "123456abcdef";
			const basePath = `/v1/desktop/sessions/${sessionId}`;
			const requestId = "a0a0a0a0-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
			const intent = {
				request_id: requestId,
				text: "Exact send",
				images: [],
				mode: "prompt",
			};
			for (const inlineUi of [false, true]) {
				recordStreamCapabilityFlags(inlineUi ? { inlineUi } : null);
				for (const op of ["sessions.get", "sessions.history"]) {
					assert.equal(
						(await desktopRequest({ op, sessionId, inlineUi: true })).status,
						200,
					);
				}
				assert.equal(
					(await desktopRequest({ op: "sessions.get", sessionId })).status,
					200,
				);
				assert.equal(
					(
						await desktopRequest({
							op: "sessions.message",
							sessionId,
							requestId,
							text: intent.text,
						})
					).status,
					200,
				);
				let dispose;
				await new Promise((resolve, reject) => {
					dispose = subscribeDesktopStream({ sessionId }, (frame) => {
						if (frame.kind === "data") resolve(frame.data);
						if (frame.kind === "error") reject(new Error(frame.detail));
					});
				});
				dispose();
				const query = inlineUi ? { inline_ui: "1" } : {};
				assert.deepEqual(requests.splice(0), [
					{ path: basePath, query, method: "GET", json: undefined },
					{
						path: `${basePath}/history`,
						query: { ...query, limit: "100" },
						method: "GET",
						json: undefined,
					},
					{ path: basePath, query: {}, method: "GET", json: undefined },
					{
						path: `${basePath}/messages`,
						query: {},
						method: "POST",
						json: inlineUi ? { ...intent, inline_ui: true } : intent,
					},
					{
						path: `${basePath}/events`,
						query: { ...query, frontend_replace: "1", supplements: "1" },
						method: "GET",
						json: undefined,
					},
				]);
			}
		} finally {
			globalThis.window = original;
			recordStreamCapabilityFlags(null);
			relay.dispose();
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
		}
	},
);
