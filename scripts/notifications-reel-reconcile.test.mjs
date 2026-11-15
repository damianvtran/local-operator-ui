import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * PR #1900 ROUND 1 REMEDIATION, MOUNTED: the shipped `NotificationsPage` over the
 * shipped hooks, a real `QueryClient` and the shipped stateful fixture (same
 * harness as notifications-page-pill.test.mjs, which says why jsdom is enough
 * here: nothing below is pixel or geometry evidence).
 *
 *  - Q1: a row dismissed by ANOTHER client leaves the open reel on the next facts
 *    answer (the feed frame's invalidation), and the Unread chip drops with it;
 *    a remount over the cached window reconciles too.
 *  - D1: re-entering the reel with cached data while the server is down shows
 *    the stale banner and pauses writes (the facts read is what fails now).
 *  - R1-3: opening a row marks it read from the CLICKED row, before (and
 *    without) its detail read landing; hover/focus prefetch is debounced; the
 *    open detail's neighbours are warmed once it lands.
 *  - R1-2 / D2: a row revision newer than the cached detail refetches ONCE (no
 *    loop when that refetch fails), and the pane shows its skeleton, not the
 *    older body, while the refetch runs.
 *
 * The transport is `window.api.desktop.request`: the fixture answers lists and
 * writes; `notifications.get` is answered by each test's own `detail` handler.
 */
const pageBundle = await build({
	stdin: {
		contents: [
			'export { NotificationsPage } from "./src/renderer/src/features/notifications/components/notifications-page";',
			'export { createNotificationFixture } from "./src/renderer/src/features/notifications/notifications-fixture";',
			'export { notificationKeys, useNotificationBulkState } from "./src/renderer/src/features/notifications/notifications-api";',
			'export { NotificationDetail } from "./src/renderer/src/features/notifications/components/notification-detail";',
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
	/* External so the provider and the bundled hooks share one React and one client context. */
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
/* On disk for the length of the import only: a data: URL cannot resolve bare specifiers. */
const pageBundlePath = new URL(
	`./_notifications-reel-reconcile-${process.pid}.mjs`,
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
const { MemoryRouter, Route, Routes } = await import("react-router-dom");
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);

const NOW = new Date(2026, 9, 25, 15, 0, 0).getTime();
const row = (index) => ({
	id: `n_row${String(index).padStart(4, "0")}`,
	source: "notify",
	priority: "normal",
	title: `update ${index}`,
	excerpt: "",
	created_at: NOW - (100 - index) * 60_000,
	updated_at: NOW - (100 - index) * 60_000,
	seq: index,
	revision: 1,
	read: false,
	read_via: null,
	dismissed: false,
	repeat_count: 1,
	session: { id: "aaaaaaaaaaa1", title: "one conversation" },
});
const detailOf = (item, body) => ({
	item: { ...item, body_md: body },
	history: [],
	session: { id: item.session.id, title: item.session.title },
});

/**
 * Mount the page. `client` lets a test REMOUNT over the same cache (the
 * cache-first path under test); `detail(request)` answers `notifications.get`
 * (a promise, or throw for a transport failure); `down()` fails every list.
 */
async function mount(options = {}) {
	const items =
		options.items ?? Array.from({ length: 20 }, (_, at) => row(20 - at));
	const fixture = options.fixture ?? PAGE.createNotificationFixture(items, []);
	localStorage.setItem("notifications-read-state", options.state ?? "all");
	const requests = options.requests ?? [];
	const transport = options.transport ?? { down: false };
	window.api = {
		desktop: {
			request: async (request) => {
				requests.push(request);
				if (request.op === "capabilities")
					return {
						status: 200,
						body: {
							result: {
								desktop_contract: 1,
								desktop_available: true,
								desktop_auth: "bearer",
								features: {
									notifications: 1,
									...(options.bulk ? { notification_bulk_selection: 1 } : {}),
								},
							},
						},
					};
				/* The desktop transport's own "no backend" failure (status null). */
				if (transport.down && request.op.startsWith("notifications."))
					throw new TypeError("fetch failed");
				if (request.op === "notifications.get") {
					if (!options.detail)
						return { status: 404, body: { detail: "no detail handler" } };
					return {
						status: 200,
						body: { result: await options.detail(request) },
					};
				}
				return (
					fixture.request(request) ?? {
						status: 404,
						body: { detail: `test bridge: ${request.op}` },
					}
				);
			},
		},
	};
	const originalError = console.error;
	console.error = (...args) => {
		const line = args.map(String).join(" ");
		if (line.includes("Maximum update depth exceeded"))
			throw new Error(
				`render loop in NotificationsPage: ${line.slice(0, 200)}`,
			);
	};
	const container = window.document.createElement("div");
	window.document.body.append(container);
	const client =
		options.client ??
		new QueryClient({
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
				{ initialEntries: [options.path ?? "/notifications"] },
				h(
					QueryClientProvider,
					{ client },
					h(
						Routes,
						null,
						h(Route, {
							path: "/notifications",
							element: h(PAGE.NotificationsPage, { nowMs: NOW }),
						}),
						h(Route, {
							path: "/notifications/:notificationId",
							element: h(PAGE.NotificationsPage, { nowMs: NOW }),
						}),
					),
				),
			),
		);
	});
	const rows = () =>
		[...container.querySelectorAll("[data-notification-row]")].map((node) =>
			node.getAttribute("data-notification-row"),
		);
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
	const wait = (ms) =>
		act(async () => {
			await new Promise((resolve) => setTimeout(resolve, ms));
		});
	const unreadChip = () =>
		[...container.querySelectorAll("button")]
			.find((node) => node.textContent?.startsWith("Unread"))
			?.textContent?.replace("Unread", "") ?? null;
	const gets = (id) =>
		requests.filter(
			(request) =>
				request.op === "notifications.get" && (!id || request.id === id),
		).length;
	const unmount = async () => {
		await act(async () => root.unmount());
		container.remove();
		console.error = originalError;
	};
	return {
		container,
		client,
		fixture,
		requests,
		transport,
		rows,
		settle,
		wait,
		unreadChip,
		gets,
		unmount,
	};
}

/** What a feed frame does after a write anywhere: invalidate the facts root. */
const frame = (client) =>
	act(async () => {
		await client.invalidateQueries({
			queryKey: PAGE.notificationKeys.factsRoot,
		});
	});
/** Another client's PATCH, straight to "core" (the fixture), not via the page. */
const elsewhere = (fixture, verb, id) =>
	fixture.request({
		op: verb === "read" ? "notifications.read" : "notifications.dismiss",
		verb,
		target: { items: [{ id, revision: 1 }] },
	});

test("Q1: a row dismissed elsewhere leaves the open reel and the Unread count", async () => {
	const page = await mount();
	try {
		assert.ok(
			await page.settle(() => page.rows().length === 20),
			"list painted",
		);
		assert.equal(page.unreadChip(), "20");
		const res = elsewhere(page.fixture, "dismiss", "n_row0018");
		assert.deepEqual(res.body.result.changed, ["n_row0018"]);
		await frame(page.client);
		assert.ok(
			await page.settle(() => !page.rows().includes("n_row0018")),
			`dismissed row still drawn: ${page.rows().slice(0, 4)}`,
		);
		assert.equal(page.rows().length, 19);
		assert.equal(page.unreadChip(), "19", "Unread chip matches core");
	} finally {
		await page.unmount();
	}
});

test("Q1: remounting over the cached window reconciles a dismissal made while away", async () => {
	const first = await mount();
	const { client, fixture } = first;
	assert.ok(await first.settle(() => first.rows().length === 20));
	await first.unmount();
	elsewhere(fixture, "dismiss", "n_row0015");
	/* Past the facts' 5 s staleTime, as a later visit is. */
	const key = PAGE.notificationKeys.facts("all");
	client.setQueryData(key, client.getQueryData(key), {
		updatedAt: Date.now() - 60_000,
	});
	const again = await mount({ client, fixture });
	try {
		assert.ok(
			await again.settle(() => again.rows().length === 19),
			`still drawn after remount: ${again.rows().length}`,
		);
		assert.ok(!again.rows().includes("n_row0015"));
	} finally {
		await again.unmount();
		client.clear();
	}
});

test("Q1: a read elsewhere reconciles without removing anything from the All view", async () => {
	const page = await mount();
	try {
		assert.ok(await page.settle(() => page.rows().length === 20));
		// A frame from an UNRELATED change elsewhere: the reconciler runs, nothing moves.
		elsewhere(page.fixture, "read", "n_row0003");
		await frame(page.client);
		await page.wait(50);
		assert.equal(page.rows().length, 20, "a read elsewhere removes nothing");
	} finally {
		await page.unmount();
	}
});

test("D1: re-entering with cached rows while the server is down shows the stale banner and pauses writes", async () => {
	const first = await mount({ bulk: true });
	const { client, fixture, transport } = first;
	assert.ok(await first.settle(() => first.rows().length === 20));
	const dismissAll = () =>
		first.container.querySelector("[data-notifications-dismiss-all]");
	assert.equal(dismissAll()?.disabled, false, "writes enabled while healthy");
	await first.unmount();
	transport.down = true;
	const key = PAGE.notificationKeys.facts("all");
	client.setQueryData(key, client.getQueryData(key), {
		updatedAt: Date.now() - 60_000,
	});
	const again = await mount({ client, fixture, transport, bulk: true });
	try {
		assert.ok(
			await again.settle(
				() =>
					again.container.querySelector(
						"[data-notifications-refresh-error]",
					) !== null,
			),
			"stale banner shown on re-entry while down",
		);
		assert.equal(again.rows().length, 20, "cached rows stay painted");
		assert.equal(
			again.container.querySelector("[data-notifications-dismiss-all]")
				?.disabled,
			true,
			"Dismiss all paused",
		);
	} finally {
		await again.unmount();
		client.clear();
	}
});

test("R1-3: opening a row marks it read from the clicked row, before its detail lands", async () => {
	const page = await mount({
		path: "/notifications/n_row0012",
		/* The detail read never answers: the read must not wait for it. */
		detail: () => new Promise(() => {}),
	});
	try {
		assert.ok(
			await page.settle(() =>
				page.requests.some((request) => request.op === "notifications.read"),
			),
			"no read PATCH while the detail is pending",
		);
		const read = page.requests.find(
			(request) => request.op === "notifications.read",
		);
		assert.equal(read.verb, "read");
		assert.deepEqual(read.target.items, [{ id: "n_row0012", revision: 1 }]);
	} finally {
		await page.unmount();
	}
});

test("R1-3: hover/focus prefetch is debounced, and the open detail's neighbours are warmed", async () => {
	const page = await mount({
		detail: async (request) =>
			detailOf(row(Number(request.id.slice(5))), `body ${request.id}`),
	});
	try {
		assert.ok(await page.settle(() => page.rows().length === 20));
		const node = (id) =>
			page.container.querySelector(`[data-notification-row="${id}"]`);
		/* A sweep across three rows inside the 75 ms settle → one read, the last. */
		await act(async () => {
			for (const id of ["n_row0020", "n_row0019", "n_row0018"])
				node(id).dispatchEvent(
					new window.FocusEvent("focusin", { bubbles: true }),
				);
		});
		await page.wait(150);
		assert.equal(page.gets(), 1, "one prefetch for the sweep");
		assert.equal(page.gets("n_row0018"), 1);
		await page.unmount();

		/* Open n_row0010: once it lands, 0011 and 0009 (its neighbours) are read. */
		const opened = await mount({
			fixture: page.fixture,
			path: "/notifications/n_row0010",
			detail: async (request) =>
				detailOf(row(Number(request.id.slice(5))), `body ${request.id}`),
		});
		try {
			assert.ok(
				await opened.settle(
					() =>
						opened.gets("n_row0011") === 1 && opened.gets("n_row0009") === 1,
				),
				`neighbours not prefetched: ${opened.requests
					.filter((r) => r.op === "notifications.get")
					.map((r) => r.id)}`,
			);
		} finally {
			await opened.unmount();
		}
	} finally {
		if (page.container.isConnected) await page.unmount();
	}
});

test("R1-2 / D2: a newer row revision refetches the detail once, skeleton meanwhile, no loop on failure", async () => {
	let mode = "ok";
	const page = await mount({
		path: "/notifications/n_row0012",
		detail: async () => {
			if (mode === "fail") throw new TypeError("fetch failed");
			if (mode === "hold") return new Promise(() => {});
			return detailOf(row(12), "the first body");
		},
	});
	try {
		assert.ok(
			await page.settle(() =>
				page.container.textContent.includes("the first body"),
			),
			"first body painted",
		);
		const before = page.gets("n_row0012");
		/* A keyed update: same id, revision 2 (the fixture re-stamps it). */
		mode = "hold";
		page.fixture.revise("n_row0012");
		await frame(page.client);
		assert.ok(
			await page.settle(() => page.gets("n_row0012") === before + 1),
			"the newer revision refetched the detail",
		);
		assert.ok(
			await page.settle(
				() => !page.container.textContent.includes("the first body"),
			),
			"the older body is withheld while the refetch runs",
		);
		assert.ok(
			page.container.querySelector('[role="status"][aria-label]'),
			"the pane shows its loading skeleton",
		);
		await page.unmount();

		/* Same state, but the refetch FAILS: exactly one attempt, no loop. */
		mode = "ok";
		const failing = await mount({
			path: "/notifications/n_row0012",
			detail: async () => {
				if (mode === "fail") throw new TypeError("fetch failed");
				return detailOf(row(12), "cached body");
			},
		});
		try {
			assert.ok(
				await failing.settle(() =>
					failing.container.textContent.includes("cached body"),
				),
			);
			const start = failing.gets("n_row0012");
			mode = "fail";
			failing.fixture.revise("n_row0012");
			await frame(failing.client);
			await failing.settle(() => failing.gets("n_row0012") > start);
			await failing.wait(400);
			assert.equal(
				failing.gets("n_row0012"),
				start + 1,
				"one refetch for the revision, not a loop",
			);
		} finally {
			await failing.unmount();
		}
	} finally {
		if (page.container.isConnected) await page.unmount();
	}
});
