import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * The Schedules page's Monitors section (#1898), driven on the SHIPPED page in
 * jsdom against a real `QueryClient` and a stubbed desktop bridge.
 *
 * What the model tests cannot answer, and this file does:
 *
 * - a machine with monitors and NO wakes renders the section and not the
 *   "No scheduled tasks yet" state (the empty-state predicate, wired);
 * - monitor handles are per session, so two conversations both holding `m1`
 *   is the ordinary case - a press on the SECOND conversation's `m1` must send
 *   the DELETE for that conversation, not the first (the page-wide row key);
 * - a cancel re-reads the listing either way (the pane's converge rule);
 * - a refusal lands in the run pane's own dialog with the backend's sentence,
 *   and the row records it, exactly as in the pane.
 *
 * Faked, and only that: the desktop bridge (`window.api.desktop.request`) and
 * the legacy REST read. The page, the hooks, the query layer, the pane's row,
 * its cancel interaction and its dialog are the shipped ones.
 */

const pageBundle = await build({
	stdin: {
		contents:
			'export { SchedulesPage } from "./src/renderer/src/features/schedules/components/schedules-page";',
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
	/* React is CJS-only; a real `require` keeps the CJS half of the graph on ONE copy. */
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
const pageBundlePath = new URL(
	`./_schedules-monitors-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(pageBundlePath, pageBundle.outputFiles[0].text);

const { JSDOM } = await import("jsdom");
const dom = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = dom;
const NoopObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
};
const shims = {
	window,
	document: window.document,
	navigator: window.navigator,
	localStorage: window.localStorage,
	getComputedStyle: window.getComputedStyle.bind(window),
	requestAnimationFrame: (callback) => setTimeout(callback, 0),
	cancelAnimationFrame: (id) => clearTimeout(id),
	IS_REACT_ACT_ENVIRONMENT: true,
	CSS: { escape: (value) => value },
	ResizeObserver: NoopObserver,
	IntersectionObserver: NoopObserver,
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
for (const key of [
	"Element",
	"Node",
	"NodeFilter",
	"HTMLElement",
	"HTMLButtonElement",
	"HTMLDivElement",
	"HTMLInputElement",
	"SVGElement",
	"MouseEvent",
	"KeyboardEvent",
	"FocusEvent",
	"PointerEvent",
	"Event",
	"CustomEvent",
	"MutationObserver",
	"DOMParser",
])
	if (key in window) shims[key] = window[key];
const originals = new Map();
for (const [key, value] of Object.entries(shims)) {
	originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
}
window.matchMedia ??= shims.matchMedia;
window.CSS ??= { escape: (value) => value };
// Radix chooses its layout-effect/portal path at module initialization. Import
// the renderer AFTER the browser globals exist, otherwise dialogs never mount
// and a confirmation test silently exercises a server-render-only component.
const PAGE = await import(pageBundlePath.href);
await unlink(pageBundlePath);
after(() => {
	for (const [key, descriptor] of originals)
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	window.close();
});

const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = await import("react");
const { MemoryRouter } = await import("react-router-dom");
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);

const NOW = new Date(2026, 2, 15, 14, 0, 0, 0).getTime();

/** The owner-present refusal, verbatim (`monitors/arm.py`). */
const OWNER_REFUSAL =
	"This conversation is open in a running session, which owns its monitors. Nothing was written. Retry in a moment, or change them from that session.";

const listed = (id, name, extra = {}) => ({
	id,
	name,
	description: "",
	tool: "bash",
	every_ms: 60_000,
	next_due_at: NOW + 60_000,
	last_check_at: NOW - 30_000,
	checks: 2,
	consecutive_failures: 0,
	disabled: false,
	disabled_reason: "",
	state: "armed",
	health: null,
	...extra,
});
const entry = (sessionId, name, monitors) => ({
	session_id: sessionId,
	name,
	cwd: "~/work",
	origin: "",
	updated_at: NOW,
	dormant: false,
	ghost: false,
	next_due_at: null,
	monitors,
});
/* Two conversations, BOTH holding `m1`: the collision under test. */
const TWO_M1 = [
	entry("aaaaaaaaaaaa", "Release watch", [listed("m1", "ci-checks")]),
	entry("bbbbbbbbbbbb", "Deploy dashboard", [
		listed("m1", "prod-health", { next_due_at: NOW + 120_000 }),
	]),
];

const ok = (result) => ({
	status: 200,
	body: { status: 200, message: "ok", result },
});

/** Mount the shipped page over one bridge state; every request is recorded. */
async function mount({ monitors = [], wakes = [], cancel = () => ok({}) }) {
	const requests = [];
	window.api = {
		desktop: {
			request: async (request) => {
				requests.push(request);
				switch (request.op) {
					case "wakes.list":
						return ok({
							entries: wakes,
							generated_at: NOW,
							total: wakes.length,
							truncated: false,
							supervisor: { supported: true, running: true, detail: "running" },
							read_error: false,
						});
					case "monitors.list":
						return ok({
							entries: monitors,
							generated_at: NOW,
							total: monitors.length,
							truncated: false,
							read_error: false,
						});
					case "monitors.cancel":
						return cancel(request);
					default:
						return {
							status: 404,
							body: { detail: `test bridge: ${request.op}` },
						};
				}
			},
		},
	};
	/* The legacy annex reads REST directly: answer it empty. */
	globalThis.fetch = async () =>
		new Response(
			JSON.stringify({
				status: 200,
				message: "ok",
				result: { schedules: [], total: 0, page: 1, per_page: 50 },
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		);
	const container = window.document.createElement("div");
	window.document.body.append(container);
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
			mutations: { retry: false, gcTime: Number.POSITIVE_INFINITY },
		},
	});
	const root = createRoot(container);
	await act(async () => {
		root.render(
			h(
				MemoryRouter,
				{ initialEntries: ["/schedules"] },
				h(
					QueryClientProvider,
					{ client },
					h(PAGE.SchedulesPage, { nowMs: NOW }),
				),
			),
		);
	});
	const settle = async (done = () => true, budgetMs = 4_000) => {
		const started = Date.now();
		do {
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 15));
			});
			if (done()) return true;
		} while (Date.now() - started < budgetMs);
		return false;
	};
	const press = async (element) => {
		element.focus();
		await act(async () => {
			element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		});
	};
	const dialog = () => window.document.body.querySelector('[role="dialog"]');
	const unmount = async () => {
		await act(async () => root.unmount());
		/*
		 * Radix's FocusScope restores focus on a `setTimeout(0)` after an open
		 * dialog unmounts, building a `CustomEvent` from the global. Letting that
		 * timer run HERE keeps it inside the test, before `after()` hands the
		 * globals back to Node's own (whose events jsdom refuses).
		 */
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});
		client.clear();
		container.remove();
	};
	return { container, requests, settle, press, dialog, unmount };
}

const listReads = (requests) =>
	requests.filter((request) => request.op === "monitors.list").length;

test("a monitors-only machine shows the section, not the empty state", async () => {
	const page = await mount({ monitors: TWO_M1 });
	try {
		assert.ok(
			await page.settle(() =>
				page.container.querySelector("[data-schedules-monitors-section]"),
			),
			"the Monitors section renders",
		);
		const text = page.container.textContent;
		assert.equal(text.includes("No scheduled tasks yet"), false);
		assert.ok(text.includes("Monitors"));
		assert.ok(text.includes("Release watch"));
		assert.ok(text.includes("Deploy dashboard"));
		assert.ok(text.includes("every 1m"), "the pane's cadence clause");
		assert.ok(text.includes("last check"), "the pane's last-check clause");
		/* Both `m1`s are separately addressable. */
		assert.ok(
			page.container.querySelector('[data-monitor-cancel="aaaaaaaaaaaa/m1"]'),
		);
		assert.ok(
			page.container.querySelector('[data-monitor-cancel="bbbbbbbbbbbb/m1"]'),
		);
	} finally {
		await page.unmount();
	}
});

test("no monitors anywhere: no section, and the empty state still shows", async () => {
	const page = await mount({ monitors: [] });
	try {
		assert.ok(
			await page.settle(() =>
				page.container.textContent.includes("No scheduled tasks yet"),
			),
		);
		assert.equal(
			page.container.querySelector("[data-schedules-monitors-section]"),
			null,
		);
	} finally {
		await page.unmount();
	}
});

test("cancelling the second conversation's m1 deletes THAT watch and re-reads the listing", async () => {
	const page = await mount({
		monitors: TWO_M1,
		cancel: (request) =>
			ok({
				session_id: request.sessionId,
				monitor_id: request.monitorId,
				name: "prod-health",
				next_due_at: null,
				remaining: 0,
				already_armed: false,
				reactivated: false,
				receipt: "cancelled",
				index_written: true,
			}),
	});
	try {
		const control = '[data-monitor-cancel="bbbbbbbbbbbb/m1"]';
		assert.ok(await page.settle(() => page.container.querySelector(control)));
		await page.press(page.container.querySelector(control));
		assert.ok(
			await page.settle(() => page.dialog()),
			"the pane's dialog opens",
		);
		assert.ok(page.dialog().textContent.includes("prod-health"));
		const readsBefore = listReads(page.requests);
		await page.press(page.dialog().querySelector("[data-confirm-action]"));
		assert.ok(
			await page.settle(
				() =>
					page.requests.some((request) => request.op === "monitors.cancel") &&
					listReads(page.requests) > readsBefore,
			),
			"the cancel is sent and the listing re-read",
		);
		const cancels = page.requests.filter(
			(request) => request.op === "monitors.cancel",
		);
		assert.deepEqual(cancels, [
			{ op: "monitors.cancel", sessionId: "bbbbbbbbbbbb", monitorId: "m1" },
		]);
		/* The receipt marks THAT row, not its namesake in the other conversation. */
		assert.ok(
			await page.settle(
				() =>
					page.container
						.querySelector(control)
						?.getAttribute("data-monitor-cancel-state") === "cancelled",
			),
		);
		assert.equal(
			page.container
				.querySelector('[data-monitor-cancel="aaaaaaaaaaaa/m1"]')
				.getAttribute("data-monitor-cancel-state"),
			null,
		);
	} finally {
		await page.unmount();
	}
});

test("a refused cancel keeps the dialog open with the backend's sentence", async () => {
	const page = await mount({
		monitors: TWO_M1,
		cancel: () => ({
			status: 503,
			body: {
				detail: { code: "monitor_owner_present", message: OWNER_REFUSAL },
			},
		}),
	});
	try {
		const control = '[data-monitor-cancel="aaaaaaaaaaaa/m1"]';
		assert.ok(await page.settle(() => page.container.querySelector(control)));
		await page.press(page.container.querySelector(control));
		assert.ok(await page.settle(() => page.dialog()));
		await page.press(page.dialog().querySelector("[data-confirm-action]"));
		assert.ok(
			await page.settle(() =>
				(page.dialog()?.textContent ?? "").includes("Nothing was written."),
			),
			"the refusal renders inside the dialog that asked",
		);
		assert.equal(
			page.requests.filter((request) => request.op === "monitors.cancel")
				.length,
			1,
			"one request per press",
		);
	} finally {
		await page.unmount();
	}
});
