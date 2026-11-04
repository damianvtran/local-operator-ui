import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * THE DRAWER'S "SHOW IN CONVERSATION" BUTTON, driven against the SHIPPED
 * transcript.
 *
 * OPERATOR REPORT (2026-11-03): "this show in session button does not work."
 * The chevron-up on an Updates row in the notifications drawer did nothing.
 * Root cause: its handler looked for the flag line with `document.querySelector`
 * and scrolled it. A `notify` call inside a COLLAPSED turn is not mounted (the
 * turn's work is behind a bar), so the lookup found nothing and the press was a
 * silent no-op. The fix routes the press to the transcript's own jump
 * (`jumpTo`: page in, open the bar, land, flash).
 *
 * This mounts the real `DrawerUpdates` beside the real `CanonicalTranscript`,
 * as `chat-content.tsx` does, over a turn that arrives collapsed, and asserts
 * the observable: after one press the notify row is mounted, and the bar that
 * hid it is open. jsdom has no layout, so scroll position is not asserted.
 */
const bootstrapDOM = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = bootstrapDOM;
const originals = new Map();
const rafQueue = [];
const scrollCalls = [];
const shims = {
	window,
	document: window.document,
	HTMLElement: window.HTMLElement,
	Node: window.Node,
	Element: window.Element,
	SVGElement: window.SVGElement,
	MouseEvent: window.MouseEvent,
	KeyboardEvent: window.KeyboardEvent,
	FocusEvent: window.FocusEvent,
	Event: window.Event,
	CustomEvent: window.CustomEvent,
	CSS: { escape: (value) => value },
	HTMLButtonElement: window.HTMLButtonElement,
	HTMLDivElement: window.HTMLDivElement,
	PointerEvent: window.PointerEvent,
	DOMParser: window.DOMParser,
	localStorage: window.localStorage,
	navigator: window.navigator,
	getComputedStyle: window.getComputedStyle.bind(window),
	requestAnimationFrame: (callback) => {
		rafQueue.push(callback);
		return rafQueue.length;
	},
	cancelAnimationFrame: () => {},
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	/*
	 * jsdom implements neither. The bar's press path mounts the transcript's own
	 * rows, and one of those (the cross-session receipt row) observes mutations -
	 * the same shim every other harness in `scripts/` carries.
	 */
	MutationObserver: window.MutationObserver,
	/*
	 * The focus manager the bar's press path reaches for walks tabbables with
	 * `NodeFilter`; jsdom implements it on the window.
	 */
	NodeFilter: window.NodeFilter,
	HTMLInputElement: window.HTMLInputElement,
	IntersectionObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
		takeRecords() {
			return [];
		}
	},
	matchMedia: (query) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener() {},
		removeEventListener() {},
		addListener() {},
		removeListener() {},
		dispatchEvent: () => false,
	}),
};
for (const [key, value] of Object.entries(shims)) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
window.matchMedia ??= shims.matchMedia;
/*
 * THE QUEUE ON THE JSDOM WINDOW AS WELL AS ON `globalThis`. The two are not the
 * same object here, and which one a caller reaches for depends on how it was
 * written: the transcript reads the global, while `failed-row-jump.ts` calls
 * `window.requestAnimationFrame` explicitly — and jsdom's own rAF (real, via
 * `pretendToBeVisual`) never fires inside a synchronous test. Without this the
 * failure jump's chain is queued to a frame loop that does not run.
 */
window.requestAnimationFrame = shims.requestAnimationFrame;
window.cancelAnimationFrame = shims.cancelAnimationFrame;
// jsdom implements neither; the failure jump uses `scrollIntoView` and the
// disclosure section uses `ResizeObserver` (`shims` above).
window.Element.prototype.scrollIntoView = function scrollIntoView(options) {
	scrollCalls.push({ element: this, options });
};
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
after(() => {
	bootstrapDOM.window.close();
	for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	}
});

const bundle = await build({
	stdin: {
		contents: [
			'export { applyHistoryPage, EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";',
			'export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";',
			'export { DrawerUpdates } from "./src/renderer/src/features/notifications/components/drawer-updates";',
			'export { createNotificationFixture } from "./src/renderer/src/features/notifications/notifications-fixture";',
			'export { __resetTurnCollapseOpen } from "./src/renderer/src/shared/store/turn-collapse-open";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	banner: {
		js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
	},
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: [
		"react",
		"react-dom",
		"react-dom/client",
		"react/jsx-runtime",
		"react-router-dom",
		"@tanstack/react-query",
	],
	tsconfig: "tsconfig.web.json",
});
const bundlePath = new URL(
	`./_notification-show-in-session-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	applyHistoryPage,
	EMPTY_TRANSCRIPT,
	CanonicalTranscript,
	DrawerUpdates,
	createNotificationFixture,
	__resetTurnCollapseOpen,
} = await import(bundlePath.href);
await unlink(bundlePath);

const SESSION = "aaaaaaaaaaa1";
const NOW = new Date(2026, 10, 3, 12, 42, 0).getTime();
const NOTIFY_CALL = "call-notify";
let sequence = 0;
const entry = (payload) => {
	sequence += 1;
	return {
		id: `entry-${sequence}`,
		ts: new Date(NOW + sequence * 1000).toISOString(),
		type: "message",
		payload,
	};
};
const toolCall = (callId, name, args) =>
	entry({
		kind: "message",
		role: "assistant",
		tool_calls: [{ id: callId, name, arguments: args }],
		stop_reason: "toolUse",
	});
const toolResult = (callId, name) =>
	entry({
		kind: "message",
		role: "tool",
		tool_call_id: callId,
		tool_name: name,
		content: [{ text: "ok" }],
		is_error: false,
	});

/** One completed turn: the notify call sits between two shell calls, so it is hidden behind the bar. */
const turn = () => {
	sequence = 0;
	return [
		entry({
			kind: "message",
			role: "user",
			content: [{ text: "Check billing." }],
		}),
		toolCall("call-1", "bash", { command: "pnpm test", i: "Testing" }),
		toolResult("call-1", "bash"),
		toolCall(NOTIFY_CALL, "notify", { title: "QA is blocked", i: "Flagging" }),
		toolResult(NOTIFY_CALL, "notify"),
		toolCall("call-2", "bash", { command: "pnpm lint", i: "Linting" }),
		toolResult("call-2", "bash"),
		entry({
			kind: "message",
			role: "assistant",
			content: [{ text: "QA is blocked for billing." }],
			stop_reason: "stop",
		}),
	];
};

const item = {
	id: "n_blocked",
	source: "notify",
	priority: "normal",
	title: "QA is still blocked for billing",
	excerpt: "",
	created_at: NOW,
	updated_at: NOW,
	seq: 1,
	revision: 1,
	read: false,
	read_via: null,
	dismissed: false,
	repeat_count: 1,
	anchor_id: NOTIFY_CALL,
	session: { id: SESSION, title: "billing" },
};

const flushFrames = async () => {
	for (let depth = 0; depth < 12 && rafQueue.length > 0; depth += 1) {
		const queued = rafQueue.splice(0);
		await act(async () => {
			for (const callback of queued) callback(0);
		});
	}
};
const settle = async (done, budgetMs = 4_000) => {
	const started = Date.now();
	do {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 15));
		});
		await flushFrames();
		if (done()) return true;
	} while (Date.now() - started < budgetMs);
	return false;
};

const mount = async (t, { itemOverride = item } = {}) => {
	__resetTurnCollapseOpen();
	const fixture = createNotificationFixture([itemOverride], []);
	window.api = {
		desktop: {
			request: async (request) => {
				if (request.op === "capabilities")
					return {
						status: 200,
						body: {
							result: {
								desktop_contract: 1,
								desktop_available: true,
								desktop_auth: "bearer",
								features: { notifications: 1 },
							},
						},
					};
				return (
					fixture.request(request) ?? {
						status: 404,
						body: { detail: `test bridge: ${request.op}` },
					}
				);
			},
		},
	};
	const container = document.createElement("div");
	document.body.appendChild(container);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: turn(),
		has_more: false,
		cursor_missing: false,
	});
	const root = createRoot(container);
	t.after(async () => {
		await act(async () => root.unmount());
		container.remove();
	});
	await act(async () => {
		root.render(
			h(
				MemoryRouter,
				null,
				h(
					QueryClientProvider,
					{ client },
					h(DrawerUpdates, { sessionId: SESSION, nowMs: NOW }),
					h(
						"div",
						{ "data-test-transcript": "" },
						h(CanonicalTranscript, {
							frontend: { session_id: SESSION },
							attachmentScope: undefined,
							transcript: {
								...state,
								records: state.records,
								viewEpoch: undefined,
							},
							openFrame: undefined,
							gate: null,
							waiting: false,
							workingLine: undefined,
							loadingOlder: false,
							onLoadOlder: async () => true,
							containerRef: { current: container },
							isSmallView: false,
							status: "live",
							failure: null,
							awaitingHydration: false,
							onReconnect: () => {},
						}),
					),
				),
			),
		);
	});
	await flushFrames();
	return { container, fixture };
};

const showButton = (container) =>
	container.querySelector('button[aria-label="Show in conversation"]');
const notifyRow = (container) =>
	container.querySelector(
		'[data-record-id="tool:call-notify"]:not([data-turn-summary])',
	);
const bar = (container) => container.querySelector("[data-turn-summary]");

test("the chevron on an update row reveals the notify call inside a collapsed turn", async (t) => {
	const { container } = await mount(t);
	assert.ok(
		await settle(() => showButton(container)),
		"the row's button is drawn",
	);
	assert.ok(bar(container), "the turn arrived collapsed behind a bar");
	assert.equal(
		notifyRow(container),
		null,
		"so the notify call is not mounted yet",
	);
	await act(async () => {
		showButton(container).dispatchEvent(
			new window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
	assert.ok(
		await settle(() => notifyRow(container) !== null),
		"one press opens the bar and mounts the notify row",
	);
	assert.equal(
		bar(container)?.querySelector("button")?.getAttribute("aria-expanded"),
		"true",
		"the bar that hid it is open",
	);
});

test("a second press after the bar is closed again reveals it again", async (t) => {
	const { container } = await mount(t);
	assert.ok(await settle(() => showButton(container)));
	const press = async () => {
		await act(async () => {
			showButton(container).dispatchEvent(
				new window.MouseEvent("click", { bubbles: true, cancelable: true }),
			);
		});
		return settle(() => notifyRow(container) !== null);
	};
	assert.ok(await press(), "first press reveals");
	await act(async () => {
		bar(container)
			.querySelector("button")
			.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true, cancelable: true }),
			);
	});
	assert.ok(
		await settle(() => notifyRow(container) === null),
		"the reader closes the bar",
	);
	assert.ok(
		await press(),
		"the same row's button works again (new request each press)",
	);
});

test("an update with no transcript anchor does nothing, and says nothing wrong", async (t) => {
	const { anchor_id: _anchor, ...withoutAnchor } = item;
	const { container } = await mount(t, { itemOverride: withoutAnchor });
	assert.ok(await settle(() => showButton(container)));
	await act(async () => {
		showButton(container).dispatchEvent(
			new window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
	await settle(() => false, 300);
	assert.ok(bar(container), "the turn stays collapsed");
	assert.equal(notifyRow(container), null);
});
