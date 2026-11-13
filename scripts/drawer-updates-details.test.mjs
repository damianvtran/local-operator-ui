import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * THE DRAWER'S UPDATES TAB: VIEW DETAILS, BACK, AND "OPEN IN NOTIFICATIONS".
 *
 * WHY THIS FILE EXISTS. The operator (2026-11-13): "currently there's no way to
 * view details" from a notification in the conversation drawer, and asked for a
 * way to open the item in the Notifications page with that item selected.
 *
 * This mounts the shipped `DrawerUpdates` and `NotificationsPage` over a real
 * `QueryClient`, a real router and the shipped stateful fixture, and asserts what
 * the operator gets: a row's title is a real button that opens the shared
 * `NotificationDetail` in the drawer (marked read exactly as the page marks an
 * opened detail), focus moves into it and back to the row, Escape goes back
 * without closing the drawer, and "Open in Notifications" lands on the page with
 * that item's detail open - including an id carrying `:` and `/`. The transport
 * is the fixture; nothing here is pixel evidence.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export { DrawerUpdates } from "./src/renderer/src/features/notifications/components/drawer-updates";',
			'export { NotificationsPage } from "./src/renderer/src/features/notifications/components/notifications-page";',
			'export { notificationPath } from "./src/renderer/src/features/notifications/components/notification-detail";',
			'export { createNotificationFixture } from "./src/renderer/src/features/notifications/notifications-fixture";',
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
	`./_drawer-updates-details-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const DRAWER = await import(bundlePath.href);
await unlink(bundlePath);

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
	ResizeObserver: NoopObserver,
	IntersectionObserver: NoopObserver,
	CSS: { escape: (value) => value },
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
after(() => {
	for (const [key, descriptor] of originals)
		if (descriptor) Object.defineProperty(globalThis, key, descriptor);
		else delete globalThis[key];
	window.close();
});

const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = await import("react");
const { MemoryRouter, Route, Routes, useLocation } = await import(
	"react-router-dom"
);
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);

const NOW = new Date(2026, 9, 25, 15, 0, 0).getTime();
const UPDATE_ONE = /update 1/;
const SESSION = "aaaaaaaaaaa1";
/* An id with the characters a route segment must not carry raw: an ask-shaped
   `:` pair, a `/` and a `%`. The page has to come back with exactly this id. */
const COLON_ID = "n:aaaaaaaaaaa1:x/y%z";
const row = (index, over = {}) => ({
	id: `n_row${index}`,
	source: "notify",
	priority: "normal",
	title: `update ${index}`,
	excerpt: `excerpt ${index}`,
	created_at: NOW - (10 - index) * 60_000,
	updated_at: NOW - (10 - index) * 60_000,
	seq: index,
	revision: 1,
	read: false,
	read_via: null,
	dismissed: false,
	repeat_count: 1,
	session: { id: SESSION, title: "one conversation" },
	...over,
});

/** Where the router is, drawn so a test can read it. */
const LocationProbe = () => {
	const location = useLocation();
	return h("output", { "data-probe-path": "" }, location.pathname);
};

/**
 * Five unread rows, two read, and one read row with a colon id. The drawer is the
 * conversation route; the page is the real `NotificationsPage` on its real route
 * shape, so "Open in Notifications" is followed all the way to the page's detail.
 */
async function mount(options = {}) {
	const items = options.items ?? [
		...[1, 2, 3, 4, 5, 6, 7].map((index) =>
			row(index, {
				read: index <= 2,
				read_via: index <= 2 ? "explicit" : null,
			}),
		),
		row(0, {
			id: COLON_ID,
			title: "read update with a colon id",
			read: true,
			read_via: "explicit",
			seq: 0,
			created_at: NOW - 60 * 60_000,
			updated_at: NOW - 60 * 60_000,
		}),
	];
	const fixture = DRAWER.createNotificationFixture(items, []);
	const writes = [];
	const detailReads = [];
	let detailMode = options.detailMode ?? "answer";
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
				if (request.op === "notifications.get") {
					detailReads.push(request.id);
					if (detailMode === "fail")
						return { status: 503, body: { detail: "test bridge: down" } };
					/* The LIVE row from the fixture's store, as the core route reads it. */
					const live = items.find((item) => item.id === request.id);
					if (!live) return { status: 404, body: { detail: "no such item" } };
					return {
						status: 200,
						body: {
							result: {
								item: { ...live, body_md: `Full body of ${live.title}.` },
								history: [],
								session: live.session,
								anchor: null,
								projects: [],
								asks: [],
							},
						},
					};
				}
				if (
					request.op === "notifications.read" ||
					request.op === "notifications.dismiss"
				)
					writes.push(request);
				return (
					fixture.request(request) ?? {
						status: 404,
						body: { detail: `test bridge: ${request.op}` },
					}
				);
			},
		},
	};
	const container = window.document.createElement("div");
	window.document.body.append(container);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const root = createRoot(container);
	/* The drawer's host: its Escape closes the drawer, as `ask-drawer.tsx` does. */
	let drawerEscapes = 0;
	await act(async () => {
		root.render(
			h(
				MemoryRouter,
				{ initialEntries: [`/chat/${SESSION}`] },
				h(
					QueryClientProvider,
					{ client },
					h(LocationProbe),
					h(
						Routes,
						null,
						h(Route, {
							path: "/chat/:sessionId",
							element: h(
								"div",
								{
									"data-probe-drawer": "",
									onKeyDown: (event) => {
										if (event.key === "Escape") drawerEscapes += 1;
									},
								},
								h(DRAWER.DrawerUpdates, {
									sessionId: SESSION,
									nowMs: NOW,
									initialView: options.initialView ?? "unread",
								}),
							),
						}),
						h(Route, {
							path: "/notifications/:notificationId",
							element: h(DRAWER.NotificationsPage, { nowMs: NOW }),
						}),
						h(Route, {
							path: "/notifications",
							element: h(DRAWER.NotificationsPage, { nowMs: NOW }),
						}),
					),
				),
			),
		);
	});
	const q = (selector) => container.querySelector(selector);
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
	const click = async (selector) => {
		const node = q(selector);
		assert.ok(node, `${selector} is drawn`);
		await act(async () => {
			node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		});
	};
	const key = async (node, value) => {
		await act(async () => {
			node.dispatchEvent(
				new window.KeyboardEvent("keydown", {
					key: value,
					bubbles: true,
					cancelable: true,
				}),
			);
		});
	};
	const details = (id) =>
		q(`[data-drawer-update="${id}"] [data-row-action="details"]`);
	const unmount = async () => {
		await act(async () => root.unmount());
		container.remove();
		client.clear();
	};
	return {
		q,
		settle,
		click,
		key,
		details,
		writes,
		detailReads,
		path: () => q("[data-probe-path]")?.textContent,
		drawerEscapes: () => drawerEscapes,
		setDetailMode: (mode) => {
			detailMode = mode;
		},
		unmount,
	};
}

const BOUNDED = { timeout: 30_000 };

test(
	"a row's title is a real button named for its action, never nested in another control",
	BOUNDED,
	async () => {
		const page = await mount();
		try {
			assert.ok(await page.settle(() => page.details("n_row7")));
			const button = page.details("n_row7");
			assert.equal(button.tagName, "BUTTON");
			assert.equal(button.type, "button");
			assert.equal(button.getAttribute("aria-label"), "View details: update 7");
			/* The time is the button's description, so it is still announced. */
			const described = window.document.getElementById(
				button.getAttribute("aria-describedby"),
			);
			assert.ok(described && button.contains(described));
			/* No interactive element inside it, and it is inside none. */
			assert.equal(button.querySelector("button, a, [tabindex]"), null);
			assert.equal(button.parentElement.closest("button"), null);
			/* The row's other controls are still drawn beside it. */
			for (const action of ["read", "dismiss"])
				assert.ok(
					page.q(`[data-drawer-update="n_row7"] [data-row-action="${action}"]`),
				);
			assert.ok(
				page.q(
					'[data-drawer-update="n_row7"] [aria-label="Show in conversation"]',
				),
			);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"opening shows the full detail in the drawer, focuses its heading and marks it read once, like the page",
	BOUNDED,
	async () => {
		const page = await mount();
		try {
			assert.ok(await page.settle(() => page.details("n_row5")));
			await page.click(
				'[data-drawer-update="n_row5"] [data-row-action="details"]',
			);
			assert.ok(
				await page.settle(() =>
					page
						.q('[data-notification-detail="n_row5"]')
						?.textContent.includes("Full body of update 5."),
				),
				"the detail read's body is drawn",
			);
			assert.equal(
				window.document.activeElement?.hasAttribute(
					"data-notification-detail-title",
				),
				true,
				"focus moved into the detail's heading",
			);
			/* The list is swapped out; the view switch and footer stay put. */
			assert.equal(page.q("[data-drawer-updates]"), null);
			assert.ok(page.q('[data-drawer-read-view="unread"]'));
			assert.ok(page.q("[data-notification-detail-back]"));
			assert.equal(
				page.q("[data-notification-detail-back]").textContent,
				"Back to updates",
			);
			/* No conversation-wide dismiss without the page's confirmation. */
			assert.equal(page.q("[data-detail-dismiss-all]"), null);
			assert.ok(await page.settle(() => page.writes.length > 0));
			await page.settle(() => false, 120);
			const reads = page.writes.filter(
				(write) => write.op === "notifications.read",
			);
			assert.equal(reads.length, 1, "one explicit read per opening");
			assert.deepEqual(
				reads[0].target.items.map((token) => token.id),
				["n_row5"],
			);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"Back returns to the same view and hands focus to the row the press came from",
	BOUNDED,
	async () => {
		/* Read view: the row is still there after Back, so focus returns to IT. */
		const page = await mount({ initialView: "read" });
		try {
			assert.ok(await page.settle(() => page.details("n_row2")));
			/* jsdom keeps an assigned scrollTop, which is all this needs: the list
			   remounts on Back and must be put back where it was left. */
			page.q("[data-drawer-updates]").scrollTop = 40;
			await page.click(
				'[data-drawer-update="n_row2"] [data-row-action="details"]',
			);
			assert.ok(
				await page.settle(() => page.q("[data-notification-detail-back]")),
			);
			await page.click("[data-notification-detail-back]");
			assert.equal(
				page.q("[data-drawer-updates]").scrollTop,
				40,
				"the list's scroll position is restored",
			);
			assert.ok(
				page.q('[data-drawer-view-list="read"]'),
				"still the Read view",
			);
			assert.equal(window.document.activeElement, page.details("n_row2"));
			/* Already read: opening it wrote nothing. */
			assert.equal(page.writes.length, 0);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"Back from an Unread row that opening marked read focuses the row now at its position",
	BOUNDED,
	async () => {
		const page = await mount();
		try {
			assert.ok(await page.settle(() => page.details("n_row6")));
			/* Unread order is newest first: 7, 6, 5, 4, 3. */
			await page.click(
				'[data-drawer-update="n_row6"] [data-row-action="details"]',
			);
			assert.ok(await page.settle(() => page.writes.length > 0));
			await page.click("[data-notification-detail-back]");
			assert.ok(
				await page.settle(() => !page.q('[data-drawer-update="n_row6"]')),
				"opening marked it read, so it left Unread",
			);
			assert.ok(page.q('[data-drawer-view-list="unread"]'));
			assert.equal(window.document.activeElement, page.details("n_row5"));
		} finally {
			await page.unmount();
		}
	},
);

test(
	"Escape in the detail goes back to the list and does not also close the drawer",
	BOUNDED,
	async () => {
		const page = await mount({ initialView: "read" });
		try {
			assert.ok(await page.settle(() => page.details("n_row1")));
			await page.click(
				'[data-drawer-update="n_row1"] [data-row-action="details"]',
			);
			assert.ok(await page.settle(() => page.q("[data-notification-detail]")));
			await page.key(window.document.activeElement, "Escape");
			assert.equal(page.q("[data-notification-detail]"), null);
			assert.equal(page.drawerEscapes(), 0, "the drawer did not see it");
			assert.equal(window.document.activeElement, page.details("n_row1"));
			/* In the list, Escape is the drawer's again. */
			await page.key(window.document.activeElement, "Escape");
			assert.equal(page.drawerEscapes(), 1);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"the arrow keys land on a row's details button, so Enter on a focused row opens it",
	BOUNDED,
	async () => {
		const page = await mount();
		try {
			assert.ok(await page.settle(() => page.details("n_row7")));
			const first = page.details("n_row7");
			/* Focus opens the row's tooltip: a state update, so inside act. */
			await act(async () => first.focus());
			await page.key(first, "ArrowDown");
			assert.equal(window.document.activeElement, page.details("n_row6"));
			/* Enter on a native button is its click; jsdom does not synthesise it. */
			await page.key(window.document.activeElement, "Enter");
			await act(async () => window.document.activeElement.click());
			assert.ok(
				await page.settle(() => page.q('[data-notification-detail="n_row6"]')),
			);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"a refused detail read keeps the row's own content and says the detail failed",
	BOUNDED,
	async () => {
		const page = await mount({ initialView: "read", detailMode: "fail" });
		try {
			assert.ok(await page.settle(() => page.details("n_row1")));
			await page.click(
				'[data-drawer-update="n_row1"] [data-row-action="details"]',
			);
			assert.ok(
				await page.settle(() =>
					page.q('[data-notification-detail="n_row1"] [role="alert"]'),
				),
			);
			assert.match(
				page.q('[data-notification-detail="n_row1"]').textContent,
				UPDATE_ONE,
			);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"Open in Notifications lands on the page with that item's detail, for a read item off the page's default filter and an id with ':' and '/'",
	BOUNDED,
	async () => {
		assert.equal(
			DRAWER.notificationPath(COLON_ID),
			"/notifications/n%3Aaaaaaaaaaaa1%3Ax%2Fy%25z",
		);
		const page = await mount({ initialView: "read" });
		try {
			assert.ok(await page.settle(() => page.details(COLON_ID)));
			await page.click(
				`[data-drawer-update="${COLON_ID}"] [data-row-action="details"]`,
			);
			assert.ok(
				await page.settle(() =>
					page.q("[data-notification-open-in-notifications]"),
				),
			);
			await page.click("[data-notification-open-in-notifications]");
			assert.equal(page.path(), DRAWER.notificationPath(COLON_ID));
			/* The page opens THIS item's detail although its default Unread
			   filter does not list it: the id round-tripped through the route. */
			assert.ok(
				await page.settle(() =>
					page
						.q(`[data-notification-detail="${COLON_ID}"]`)
						?.textContent.includes("Full body of read update with a colon id."),
				),
				"the page's detail is open on the item",
			);
			/* Every detail read named the raw id: nothing was read with the
			   encoded form, which would be the router handing back `%3A`. */
			assert.deepEqual([...new Set(page.detailReads)], [COLON_ID]);
		} finally {
			await page.unmount();
		}
	},
);
