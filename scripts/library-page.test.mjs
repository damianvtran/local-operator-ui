import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { JSDOM } from "jsdom";

/*
 * The Library page against the SHIPPED components, with the desktop bridge
 * stubbed at `window.api.desktop.request` - the boundary the app actually
 * crosses, so the query layer, the route, the cards, the preview and the
 * composer all run for real.
 *
 * WHAT IS PINNED:
 * - the four catalogue states (loading skeleton, empty, error with Retry,
 *   populated);
 * - selection entering `/library/assets/:id` and the preview rendering there
 *   (the standalone branch in this harness, because a JSDOM page reports no
 *   workspace width - the dock branch is a rendered-frame concern);
 * - a linked chat's row, and continuing that chat through `sessions.message`
 *   with the linked session id rather than creating a second session.
 */

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
	url: "http://localhost/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		// jsdom accessors that cannot be redefined; the DOM globals above suffice.
	}
}
for (const name of ["Event", "CustomEvent", "MouseEvent", "KeyboardEvent"]) {
	globalThis[name] = dom.window[name];
}
dom.window.Element.prototype.scrollIntoView = () => {};
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.IntersectionObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
dom.window.matchMedia = () => ({
	matches: false,
	media: "",
	onchange: null,
	addEventListener() {},
	removeEventListener() {},
	addListener() {},
	removeListener() {},
	dispatchEvent: () => false,
});
URL.createObjectURL = () => "blob:library-test";
URL.revokeObjectURL = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { after } = await import("node:test");
const { build } = await import("esbuild");
const { act } = await import("react");

/*
 * THE HARNESS IS BUNDLED THE WAY `projects-card-click.test.mjs` bundles its
 * card: the entry runs the SHIPPED page with the app's real providers, and
 * esbuild resolves the renderer's TSX and its `@shared`/`@features` aliases.
 * React and react-dom stay external so the test and the bundle share one
 * instance (two copies of React make `act` report every update as unwrapped).
 */
const ENTRY = `
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { LibraryPage } from "./src/renderer/src/features/library/components/library-page";

function Jump() {
	const navigate = useNavigate();
	return createElement(
		"div",
		null,
		createElement("button", { "data-go-a": "" , onClick: () => navigate("/library/assets/la_0000000000000014") }, "A"),
		createElement("button", { "data-go-b": "" , onClick: () => navigate("/library/assets/la_0000000000000012") }, "B"),
	);
}

export function mountLibrary(container, nowMs) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const root = createRoot(container);
	root.render(
		createElement(
			QueryClientProvider,
			{ client },
			createElement(
				MemoryRouter,
				{ initialEntries: ["/library"] },
				createElement(Jump),
				createElement(
					Routes,
					null,
					createElement(Route, {
						path: "/library",
						element: createElement(LibraryPage, { nowMs }),
					}),
					createElement(Route, {
						path: "/library/assets/:assetId",
						element: createElement(LibraryPage, { nowMs }),
					}),
					createElement(Route, {
						path: "/chat/:agentId",
						element: createElement("div", null, "chat route"),
					}),
				),
			),
		),
	);
	return { client, root };
}
`;
const bundle = await build({
	stdin: {
		contents: ENTRY,
		resolveDir: process.cwd(),
		sourcefile: "library-page.mjs",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	define: { "import.meta.env": "{}" },
	jsx: "automatic",
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
		"@features/chat/components/chat-sidebar": `${process.cwd()}/scripts/library-test-stubs/chat-sidebar.ts`,
	},
	loader: { ".css": "empty" },
	write: false,
});
const bundlePath = new URL(
	`./_library-page-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { mountLibrary } = await import(bundlePath.href);
await unlink(bundlePath);

const NOW = new Date(2026, 9, 18, 12, 0, 0).getTime();

const tag = (id, name) => ({ id, name, category: "topic" });
const asset = (id, patch = {}) => ({
	id,
	ref: {
		type: "path",
		path: `/tmp/${id}.md`,
		display_path: `~/${id}.md`,
		digest: null,
		content_type: "text/markdown",
	},
	name: "",
	derived_name: `${id}.md`,
	description: "",
	kind: "markdown",
	category: "document",
	origin: "written",
	origin_group: "created",
	origins: ["written"],
	tags: [],
	primary_tag: null,
	size_bytes: 2048,
	width: null,
	height: null,
	duration_s: null,
	created_at: 1_700_000_000,
	modified_at: 1_700_000_100,
	last_seen_at: 1_700_000_200,
	exists: true,
	highlighted: false,
	highlight_why: null,
	occurrences: [
		{
			session_id: "abcdef123456",
			session_title: "March invoices",
			origin: "written",
			tool: "write_file",
			at: 1_700_000_000,
			intent: null,
			first_seq: 1,
			last_seq: 2,
			child_id: null,
			label: null,
		},
	],
	session_count: 1,
	chat: null,
	preview: { state: "ready", mime_type: "text/markdown", pages: null },
	organized: { at: 1_700_000_300, by: "librarian", confidence: 0.9 },
	locked: false,
	favorite: false,
	archived: false,
	...patch,
});

const ROWS = [
	asset("la_0000000000000011", {
		name: "Invoice notes",
		derived_name: "invoice-notes.md",
		tags: [tag("t1", "finance")],
	}),
	asset("la_0000000000000012", {
		name: "Launch brief",
		derived_name: "launch-brief.md",
		last_seen_at: 1_700_000_100,
	}),
];

const ANSWER = {
	rows: [],
	failList: null,
	hang: false,
	detail: null,
	ops: [],
	releaseHang: null,
};

const desktopRequest = async (request) => {
	ANSWER.ops.push(request);
	if (request.op === "capabilities") {
		return {
			status: 200,
			body: {
				result: {
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: { library: 1 },
				},
			},
		};
	}
	if (request.op === "library.list") {
		if (ANSWER.hang)
			return new Promise((resolve) => {
				ANSWER.releaseHang = () =>
					resolve({
						status: 200,
						body: {
							result: {
								state: "ready",
								revision: 1,
								total: 0,
								counts: { category: {}, origin_group: {}, kind: {} },
								tags: [],
								rows: [],
								next_cursor: null,
								cursor_reset: false,
								scan: { sessions_total: 0, sessions_scanned: 0 },
								librarian: null,
							},
						},
					});
			});
		if (ANSWER.failList)
			return { status: 500, body: { detail: ANSWER.failList } };
		return {
			status: 200,
			body: {
				result: {
					state: "ready",
					revision: 1,
					total: ANSWER.rows.length,
					counts: {
						category: { document: ANSWER.rows.length },
						origin_group: { created: ANSWER.rows.length },
						kind: { markdown: ANSWER.rows.length },
					},
					tags: [tag("t1", "finance")],
					rows: ANSWER.rows,
					next_cursor: null,
					cursor_reset: false,
					scan: { sessions_total: 1, sessions_scanned: 1 },
					librarian: {
						enabled: true,
						session_id: "librarian1234",
						paused: false,
						last_run_at: 1_700_000_000,
						last_summary: null,
					},
				},
			},
		};
	}
	if (request.op === "library.get") {
		const row =
			ANSWER.detail ?? ANSWER.rows.find((item) => item.id === request.id);
		if (!row) return { status: 404, body: { detail: "not found" } };
		return { status: 200, body: { result: row } };
	}
	if (request.op === "library.librarian") {
		return {
			status: 200,
			body: {
				result: {
					enabled: true,
					session_id: "librarian1234",
					paused: false,
					last_run_at: 1_700_000_000,
					last_summary: null,
					unorganized: 2,
				},
			},
		};
	}
	if (request.op === "library.tags") {
		return { status: 200, body: { result: [tag("t1", "finance")] } };
	}
	if (request.op === "sessions.create") {
		return {
			status: 200,
			body: {
				result: {
					session_id: "abcdef123456",
					binding: {},
				},
			},
		};
	}
	if (request.op === "sessions.message") {
		if (ANSWER.failMessage) {
			return { status: 500, body: { detail: "The send was refused." } };
		}
		return { status: 200, body: { result: { accepted: true } } };
	}
	if (request.op === "library.chat.link") {
		if (ANSWER.linkFails > 0) {
			ANSWER.linkFails -= 1;
			/* 400, not 500: the app retries a 5xx once, and this test needs the
			 * refusal to remain a refusal on the first Send. */
			return { status: 400, body: { detail: "The link was refused." } };
		}
		return {
			status: 200,
			body: {
				result: {
					asset_id: request.id,
					chat: {
						session_id: request.sessionId,
						title: "Asset chat",
						updated_at: 1_700_000_000,
					},
					cleared: false,
				},
			},
		};
	}
	/*
	 * Navigation and session creation have follow-up reads this page test does
	 * not exercise. Answering their namespace with an empty result keeps the
	 * harness's event loop settled instead of leaving an unresolved request
	 * from a store that outlives the unmounted route.
	 */
	if (request.op.startsWith("sessions."))
		return { status: 200, body: { result: {} } };
	throw new TypeError(`unexpected desktop op in this test: ${request.op}`);
};

const api = dom.window.api ?? {};
api.desktop = {
	request: desktopRequest,
	media: async () => ({
		status: 200,
		kind: "bytes",
		mimeType: "text/markdown",
		data: new TextEncoder().encode("# Notes\n\nA document."),
	}),
};
api.openFile = async () => {};
api.showItemInFolder = async () => {};
dom.window.api = api;

const flush = async (rounds = 8) => {
	for (let index = 0; index < rounds; index += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 100));
		});
	}
};

const MOUNTED = [];

const mount = async () => {
	const container = document.createElement("div");
	document.body.append(container);
	const { root, client } = mountLibrary(container, NOW);
	MOUNTED.push({ root, client });
	await flush();
	return { container, root, client };
};

after(async () => {
	for (const { root, client } of MOUNTED) {
		await act(async () => root.unmount());
		client.clear();
	}
	dom.window.close();
});

const text = (node) => node.textContent ?? "";

test("loading draws the skeleton without a premature empty state", async () => {
	ANSWER.hang = true;
	ANSWER.rows = [];
	const { container, root } = await mount();
	assert.ok(container.querySelector("[data-library-skeleton]"));
	assert.equal(text(container).includes("Your Library is empty"), false);
	ANSWER.hang = false;
	ANSWER.releaseHang?.();
	await flush(2);
	await act(async () => root.unmount());
});

test("empty catalog draws the empty state and its guidance", async () => {
	ANSWER.rows = [];
	const { container, root } = await mount();
	assert.ok(text(container).includes("Your Library is empty"));
	assert.ok(text(container).includes("Files you create or highlight"));
	await act(async () => root.unmount());
});

test("a failed listing draws the error and its Retry control", async () => {
	ANSWER.rows = [];
	ANSWER.failList = "The backend did not answer.";
	const { container, root } = await mount();
	await flush(12);
	assert.ok(text(container).includes("The backend did not answer."));
	assert.ok(text(container).includes("Retry"));
	await act(async () => root.unmount());
	ANSWER.failList = null;
});

test("a card selects its asset route and the preview renders there", async () => {
	ANSWER.rows = ROWS;
	const { container, root } = await mount();
	assert.ok(text(container).includes("Invoice notes"));
	const card = container.querySelector(
		'[data-library-card-id="la_0000000000000011"] button',
	);
	assert.ok(card, "the first card's primary button exists");
	await act(async () => card.click());
	await flush();
	assert.ok(
		container.querySelector('[data-library-preview="la_0000000000000011"]'),
		"the selected route renders the preview for that asset",
	);
	const composer = container.querySelector("[data-library-composer] textarea");
	assert.equal(composer?.getAttribute("placeholder"), "Ask about this asset");
	await act(async () => root.unmount());
});

test("a linked chat is shown and continued with its own session", async () => {
	ANSWER.rows = [
		asset("la_0000000000000013", {
			name: "Chatty asset",
			chat: {
				session_id: "abcdef123456",
				title: "Asset chat",
				updated_at: 1_700_000_000,
			},
		}),
	];
	ANSWER.ops = [];
	const { container, root } = await mount();
	const card = container.querySelector(
		'[data-library-card-id="la_0000000000000013"] button',
	);
	await act(async () => card.click());
	await flush();
	assert.ok(text(container).includes("Chat about this asset: Asset chat"));

	const textarea = container.querySelector("[data-library-composer] textarea");
	assert.ok(textarea);
	await act(async () => {
		const setter = Object.getOwnPropertyDescriptor(
			dom.window.HTMLTextAreaElement.prototype,
			"value",
		).set;
		setter.call(textarea, "Summarise this asset");
		textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
	await flush();
	const send = container.querySelector(
		'[data-library-composer] button[aria-label="Send"]',
	);
	assert.ok(send);
	await act(async () => send.click());
	await flush();
	const message = ANSWER.ops.find((op) => op.op === "sessions.message");
	assert.equal(message?.sessionId, "abcdef123456");
	assert.equal(
		ANSWER.ops.some((op) => op.op === "library.chat.link"),
		false,
		"continuing a linked chat does not link it again",
	);
	await act(async () => root.unmount());
});

test("an accepted send survives a link failure and the next send reuses its session", async () => {
	ANSWER.rows = [
		asset("la_0000000000000014", { name: "Unlinked asset" }),
		asset("la_0000000000000012", { name: "Second asset" }),
	];
	ANSWER.ops = [];
	ANSWER.linkFails = 1;
	const { container, root } = await mount();
	const card = container.querySelector(
		'[data-library-card-id="la_0000000000000014"] button',
	);
	await act(async () => card.click());
	await flush();
	const textarea = () =>
		container.querySelector("[data-library-composer] textarea");
	const type = async (text) => {
		await act(async () => {
			const setter = Object.getOwnPropertyDescriptor(
				dom.window.HTMLTextAreaElement.prototype,
				"value",
			).set;
			setter.call(textarea(), text);
			textarea().dispatchEvent(
				new dom.window.Event("input", { bubbles: true }),
			);
		});
		await flush(2);
	};
	const send = () =>
		container.querySelector(
			'[data-library-composer] button[aria-label="Send"]',
		);
	await type("First message");
	await act(async () => send().click());
	await flush(10);
	assert.equal(
		ANSWER.ops.filter((op) => op.op === "sessions.message").length,
		1,
	);
	assert.equal(textarea().value, "", "the accepted draft is cleared");
	assert.ok(
		container.querySelector("[data-library-link-failed]"),
		"the link failure is shown as partial success",
	);

	/* Same composer instance, different asset: B must not inherit A's row. */
	await act(async () => container.querySelector("[data-go-b]").click());
	await flush(8);
	assert.equal(
		container.querySelector("[data-library-link-failed]"),
		null,
		"B does not inherit A's pending link",
	);
	await act(async () => container.querySelector("[data-go-a]").click());
	await flush(8);
	assert.ok(container.querySelector("[data-library-link-failed]"));
	await type("Second message");
	await act(async () => send().click());
	await flush(10);
	const messages = ANSWER.ops.filter((op) => op.op === "sessions.message");
	assert.equal(messages.length, 2);
	assert.equal(messages[0].sessionId, "abcdef123456");
	assert.equal(messages[1].sessionId, "abcdef123456");
	assert.equal(
		ANSWER.ops.filter((op) => op.op === "sessions.create").length,
		1,
		"the second send reuses the created session",
	);
	await act(async () =>
		container.querySelector("[data-library-link-failed] button")?.click(),
	);
	await flush(6);
	assert.equal(container.querySelector("[data-library-link-failed]"), null);
	await act(async () => root.unmount());
	ANSWER.linkFails = 0;
});

test("a send refusal keeps the draft and writes no link", async () => {
	ANSWER.rows = [
		asset("la_0000000000000015", {
			name: "Send refusal",
			chat: {
				session_id: "abcdef123456",
				title: "Existing chat",
				updated_at: 1_700_000_000,
			},
		}),
	];
	ANSWER.ops = [];
	ANSWER.failMessage = true;
	const { container, root } = await mount();
	const card = container.querySelector(
		'[data-library-card-id="la_0000000000000015"] button',
	);
	await act(async () => card.click());
	await flush();
	const textarea = container.querySelector("[data-library-composer] textarea");
	await act(async () => {
		const setter = Object.getOwnPropertyDescriptor(
			dom.window.HTMLTextAreaElement.prototype,
			"value",
		).set;
		setter.call(textarea, "Will not send");
		textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
	});
	await flush(2);
	await act(async () =>
		container
			.querySelector('[data-library-composer] button[aria-label="Send"]')
			.click(),
	);
	await flush(8);
	assert.equal(textarea.value, "Will not send");
	assert.equal(
		ANSWER.ops.some((op) => op.op === "library.chat.link"),
		false,
	);
	await act(async () => root.unmount());
	ANSWER.failMessage = false;
});

after(() => {
	// jsdom keeps window timers alive; close it so a stray debounce or query
	// timer cannot hold the node:test process open after every case unmounts.
	dom.window.close();
});
