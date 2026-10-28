import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * THE REEL'S "N NEW" PILL, MOUNTED (QA round 6, Q13 and Q14).
 *
 * WHY THIS FILE EXISTS. The model's `newerCount` was right and its tests were green
 * while the page drew "100 new" after one scroll page with zero arrivals, and "3,142
 * new" at the oldest row: a SECOND source in the page (`newIds`) counted every id that
 * appeared while scrolled, older pages included. Only a mount of the shipped
 * `NotificationsPage` over the shipped list hook can see that, so this file renders the
 * page in jsdom against a real `QueryClient` and the shipped stateful fixture
 * (`createNotificationFixture`, the one the stories use), scrolls it, delivers late
 * arrivals and presses the pill.
 *
 * WHAT IS STUBBED: the transport (`window.api.desktop.request`, answered by the fixture)
 * and the geometry. jsdom has no layout, so `scrollTop` is a plain property on the grid
 * and `scrollTo` writes it and fires `scroll`; `scrollHeight` and `clientHeight` read 0,
 * which the page's own "near the bottom" test reads as "load the next page" - the same
 * thing a real scroll to the bottom does. Nothing here is pixel or geometry evidence.
 *
 * A late arrival is delivered the way a feed frame delivers it: the fixture adds the row,
 * then the facts root is invalidated - exactly the key `invalidateSoon` invalidates.
 */

const pageBundle = await build({
	stdin: {
		contents: [
			'export { NotificationsPage } from "./src/renderer/src/features/notifications/components/notifications-page";',
			'export { createNotificationFixture } from "./src/renderer/src/features/notifications/notifications-fixture";',
			'export { notificationKeys } from "./src/renderer/src/features/notifications/notifications-api";',
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
	`./_notifications-page-pill-${process.pid}.mjs`,
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
const TOTAL = 450;
const row = (index) => ({
	id: `n_row${String(index).padStart(4, "0")}`,
	source: "notify",
	priority: "normal",
	title: `update ${index}`,
	excerpt: "",
	created_at: NOW - (TOTAL - index) * 60_000,
	updated_at: NOW - (TOTAL - index) * 60_000,
	seq: index,
	revision: 1,
	read: false,
	read_via: null,
	dismissed: false,
	repeat_count: 1,
	session: { id: "aaaaaaaaaaa1", title: "one conversation" },
});

/** Mount the shipped page over a fresh fixture; the console's errors are collected. */
async function mount(options = {}) {
	const items =
		options.items ?? Array.from({ length: TOTAL }, (_, at) => row(TOTAL - at));
	const fixture = PAGE.createNotificationFixture(items, options.waiting ?? []);
	localStorage.setItem("notifications-read-state", options.state ?? "unread");
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
								features: {
									notifications: 1,
									...(options.bulk ? { notification_bulk_selection: 1 } : {}),
									...(options.askRead ? { notification_bulk_ask_read: 1 } : {}),
								},
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
	const errors = [];
	const originalError = console.error;
	console.error = (...args) => {
		const line = args.map(String).join(" ");
		errors.push(line);
		/*
		 * A RENDER LOOP FAILS THE TEST INSTEAD OF HANGING IT (Q14). A passive-effect loop
		 * only WARNS and keeps going, and under `act` it never yields, so a per-test
		 * timeout cannot fire either (measured at 87013fe261: the file sat until the
		 * outer bound). Throwing from the warning unwinds the effect flush out of `act`.
		 */
		if (line.includes("Maximum update depth exceeded"))
			throw new Error(
				`render loop in NotificationsPage: ${line.slice(0, 200)}`,
			);
	};
	const container = window.document.createElement("div");
	window.document.body.append(container);
	const client = new QueryClient({
		// This fixture owns explicit disposal; browser-mode mutation GC timers are
		// otherwise still live for five minutes after the test has unmounted.
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
					),
				),
			),
		);
	});
	const rows = () =>
		[...container.querySelectorAll("[data-notification-row]")].map((node) =>
			node.getAttribute("data-notification-row"),
		);
	const pill = () =>
		container.querySelector("[data-notifications-back-to-top]")?.textContent ??
		null;
	const grid = () => container.querySelector("[data-notifications-list]");
	/** Let pending reads settle until `done` holds (or the budget runs out). */
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
	/* jsdom has no scroll geometry: give the grid a writable offset and a real event. */
	const scrollGridTo = async (top) => {
		const box = grid();
		box.scrollTop = top;
		await act(async () => {
			box.dispatchEvent(new window.Event("scroll"));
		});
	};
	const instrument = () => {
		const box = grid();
		let offset = 0;
		Object.defineProperty(box, "scrollTop", {
			configurable: true,
			get: () => offset,
			set: (value) => {
				offset = value;
			},
		});
		box.scrollTo = ({ top }) => {
			offset = top;
			box.dispatchEvent(new window.Event("scroll"));
		};
	};
	const unmount = async () => {
		await act(async () => root.unmount());
		client.clear();
		container.remove();
		console.error = originalError;
	};
	return {
		container,
		client,
		fixture,
		rows,
		pill,
		grid,
		settle,
		scrollGridTo,
		instrument,
		unmount,
		errors,
	};
}

/*
 * A per-test bound: the unfixed page can spin React's update loop under jsdom, and a
 * hang there must read as a failure of THAT test, not as a stalled suite.
 */
const BOUNDED = { timeout: 30_000 };
const ANY_DIGIT = /\d/;

/** Scroll to the bottom `pages` times, waiting for each page to land. */
async function scrollDeep(page, pages) {
	for (let at = 0; at < pages; at += 1) {
		const before = page.rows().length;
		await page.scrollGridTo(5_000 + at * 5_000);
		assert.ok(
			await page.settle(() => page.rows().length > before),
			`scroll ${at + 1} loaded another page (rows stayed at ${before})`,
		);
	}
}

test(
	"Q13a: scrolling down three pages with zero arrivals shows no pill",
	BOUNDED,
	async () => {
		const page = await mount();
		try {
			assert.ok(
				await page.settle(() => page.rows().length === 100),
				"page one drew",
			);
			page.instrument();
			await scrollDeep(page, 3);
			await page.settle();
			assert.equal(page.rows().length, 400, "four pages are drawn");
			assert.equal(
				page.pill(),
				null,
				"rows loaded by scrolling down are not new: no pill",
			);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"Q13b/c: two late arrivals while deep read '2 new'; back to top clears it and draws them first",
	BOUNDED,
	async () => {
		const page = await mount();
		try {
			await page.settle(() => page.rows().length === 100);
			page.instrument();
			await scrollDeep(page, 3);
			const deepest = page.rows().at(-1);

			const first = page.fixture.arrive(row(TOTAL + 1));
			const second = page.fixture.arrive(row(TOTAL + 2));
			/* What a feed frame does (`invalidateSoon`): refresh the facts, never the window. */
			await act(async () => {
				await page.client.invalidateQueries({
					queryKey: PAGE.notificationKeys.factsRoot,
				});
			});
			assert.ok(
				await page.settle(() => page.pill() !== null),
				"the pill appeared",
			);
			assert.equal(page.pill(), "2 new", "exactly the two arrivals");
			assert.equal(
				page.rows().at(-1),
				deepest,
				"the window did not move under the operator",
			);
			assert.ok(
				!page.rows().includes(first.id),
				"the arrivals are not drawn above a deep viewport",
			);

			/* In the page header, never inside the scroll port (design round 6, D1). */
			const button = window.document.querySelector(
				"[data-notifications-back-to-top]",
			);
			assert.ok(
				!page.grid().contains(button),
				"the chip takes no room in the list",
			);
			await act(async () => {
				button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			});
			assert.ok(
				await page.settle(
					() => page.pill() === null && page.rows()[0] === second.id,
				),
				`back to top: pill ${JSON.stringify(page.pill())}, first row ${page.rows()[0]}`,
			);
			assert.deepEqual(
				page.rows().slice(0, 2),
				[second.id, first.id],
				"newest first",
			);
			assert.equal(page.grid().scrollTop, 0, "and the reel is at the very top");
		} finally {
			await page.unmount();
		}
	},
);

test(
	"Q14: a deep scroll logs no 'Maximum update depth exceeded'",
	BOUNDED,
	async () => {
		const page = await mount();
		try {
			await page.settle(() => page.rows().length === 100);
			page.instrument();
			await scrollDeep(page, 3);
			await page.settle(() => false, 300);
			const loops = page.errors.filter((line) =>
				line.includes("Maximum update depth exceeded"),
			);
			assert.equal(
				loops.length,
				0,
				`no render loop (saw ${loops.length}: ${loops[0]?.slice(0, 160)})`,
			);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"D5 / Q15: a late row seen at the top stays in the list after scrolling, and the pill stays at 0",
	BOUNDED,
	async () => {
		const page = await mount();
		try {
			await page.settle(() => page.rows().length === 100);
			page.instrument();
			const late = page.fixture.arrive(row(TOTAL + 1));
			await act(async () => {
				await page.client.invalidateQueries({
					queryKey: PAGE.notificationKeys.factsRoot,
				});
			});
			assert.ok(
				await page.settle(() => page.rows()[0] === late.id),
				"at the top the late row is drawn at the head",
			);
			assert.equal(page.pill(), null, "and there is no pill");
			await scrollDeep(page, 2);
			await page.settle(() => false, 200);
			assert.equal(
				page.pill(),
				null,
				"the row the operator saw is not counted as new",
			);
			assert.equal(
				page.rows()[0],
				late.id,
				"and it is still the list's first row",
			);
		} finally {
			await page.unmount();
		}
	},
);

/*
 * D3: THE DETAIL'S DISMISS-ALL IS MOUNTED WHILE THE COUNT IS PENDING (design round 5).
 * jsdom has no layout, so the "same box" here is the same element, same classes and the
 * same label shape across the transition; the pixel measurement is in the PR's design
 * remediation (Storybook, harness browser).
 */
test(
	"D3: Dismiss all stays mounted and unavailable while counting, then shows the number",
	BOUNDED,
	async () => {
		const container = window.document.createElement("div");
		window.document.body.append(container);
		const root = createRoot(container);
		const client = new QueryClient({
			// This fixture owns explicit disposal; browser-mode mutation GC timers are
			// otherwise still live for five minutes after the test has unmounted.
			defaultOptions: {
				queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
				mutations: { retry: false, gcTime: Number.POSITIVE_INFINITY },
			},
		});
		const calls = [];
		const item = row(7);
		const render = (count) =>
			act(async () => {
				root.render(
					h(
						MemoryRouter,
						null,
						h(
							QueryClientProvider,
							{ client },
							h(PAGE.NotificationDetail, {
								item,
								detail: undefined,
								loading: false,
								error: false,
								nowMs: NOW,
								narrow: false,
								writesPaused: false,
								sessionDismissCount: count,
								onClose() {},
								onOpenConversation() {},
								onToggleRead() {},
								onDismiss() {},
								onDismissSession: (...args) => calls.push(args),
								onCopyLink() {},
								onOpenProject() {},
								onAsksSettled() {},
							}),
						),
					),
				);
			});
		const button = () => container.querySelector("[data-detail-dismiss-all]");
		try {
			await render(null);
			const pending = button();
			assert.ok(pending, "the button is mounted while counting");
			assert.equal(pending.getAttribute("data-detail-dismiss-all"), "counting");
			assert.equal(pending.getAttribute("aria-disabled"), "true");
			assert.ok(
				!ANY_DIGIT.test(pending.textContent),
				`no number while counting, never 0 (read ${JSON.stringify(pending.textContent)})`,
			);
			const pendingClass = pending.className;
			await act(async () => {
				pending.dispatchEvent(
					new window.MouseEvent("click", { bubbles: true }),
				);
			});
			assert.equal(calls.length, 0, "a pending count cannot be pressed");

			await render(42);
			const ready = button();
			assert.equal(ready, pending, "the same element: it was never unmounted");
			assert.equal(ready.className, pendingClass, "with the same box classes");
			assert.equal(ready.getAttribute("data-detail-dismiss-all"), "ready");
			assert.equal(ready.getAttribute("aria-disabled"), null);
			assert.equal(ready.textContent, "Dismiss all 42");
			await act(async () => {
				ready.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			});
			assert.equal(calls.length, 1, "a known count dismisses");

			await render(0);
			assert.equal(button(), null, "a known zero has nothing to dismiss");
		} finally {
			await act(async () => root.unmount());
			container.remove();
		}
	},
);

const selectedRows = (page) => [
	...page.container.querySelectorAll(
		'[data-notification-row][aria-selected="true"]',
	),
];
const click = async (node, options = {}) => {
	assert.ok(node, "the control exists");
	await act(async () =>
		node.dispatchEvent(
			new window.MouseEvent("click", { bubbles: true, ...options }),
		),
	);
};

test(
	"bulk selection: header starts unchecked, row Shift-click selects a range",
	BOUNDED,
	async () => {
		const page = await mount({ bulk: true, state: "all" });
		try {
			assert.ok(await page.settle(() => page.rows().length === 100));
			const header = page.container.querySelector(
				"[data-notifications-select-all]",
			);
			assert.equal(header.getAttribute("data-state"), "unchecked");
			const rows = [
				...page.container.querySelectorAll("[data-notification-row]"),
			];
			await click(rows[1].querySelector('[role="checkbox"]'));
			assert.equal(header.getAttribute("data-state"), "indeterminate");
			await click(rows[4].querySelector('[role="checkbox"]'), {
				shiftKey: true,
			});
			assert.equal(selectedRows(page).length, 4);
			assert.equal(
				page.container.querySelector("[data-notifications-toolbar]").dataset
					.notificationsToolbar,
				"selection",
			);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"bulk select-all is one snapshot for 650 items, unchecking preserves off-page rows, Undo restores",
	BOUNDED,
	async () => {
		const rows = Array.from({ length: 650 }, (_, i) => row(650 - i));
		const page = await mount({ bulk: true, state: "all", items: rows });
		try {
			assert.ok(await page.settle(() => page.rows().length === 100));
			await click(
				page.container.querySelector("[data-notifications-select-all]"),
			);
			assert.ok(
				await page.settle(() =>
					page.container.textContent.includes("650 selected"),
				),
			);
			assert.equal(selectedRows(page).length, 100);
			await click(
				page.container.querySelector(
					'[data-notification-row] [role="checkbox"]',
				),
			);
			assert.ok(page.container.textContent.includes("649 selected"));
			assert.equal(
				page.container
					.querySelector("[data-notifications-select-all]")
					.getAttribute("data-state"),
				"indeterminate",
			);
			await click(
				page.container.querySelector("[data-notifications-bulk-dismiss]"),
			);
			assert.ok(
				await page.settle(() =>
					document.querySelector("[data-notifications-confirm-view]"),
				),
				JSON.stringify({
					errors: page.errors,
					toolbar: page.container.querySelector("[data-notifications-toolbar]")
						?.textContent,
					dialogs: document.querySelectorAll('[role="dialog"]').length,
					writes: page.fixture.requests.filter(
						(request) => request.op === "notifications.dismiss",
					),
				}),
			);
			await click(document.querySelector("[data-notifications-confirm-view]"));
			assert.ok(
				await page.settle(
					() => rows.filter((row) => row.dismissed).length === 649,
				),
			);
			const writes = page.fixture.requests.filter(
				(request) => request.op === "notifications.dismiss",
			);
			assert.equal(
				writes.length,
				1,
				"one filtered PATCH, never a per-row loop",
			);
			assert.equal(writes[0].target.excludedIds.length, 1);
			assert.ok(await page.settle(() => page.rows().length === 1));
			await act(async () =>
				page.grid().dispatchEvent(
					new window.KeyboardEvent("keydown", {
						key: "z",
						ctrlKey: true,
						bubbles: true,
					}),
				),
			);
			assert.ok(await page.settle(() => rows.every((row) => !row.dismissed)));
			assert.equal(
				page.fixture.requests.filter((request) => request.verb === "undo")
					.length,
				1,
			);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"Cmd+A selects the filtered result, including unloaded matches; old core never silently selects a page",
	BOUNDED,
	async () => {
		const items = Array.from({ length: 650 }, (_, i) => row(650 - i));
		for (let i = 550; i < 650; i++)
			items[i].session = { id: "bbbbbbbbbbb2", title: "Other" };
		const page = await mount({
			bulk: true,
			items,
			path: "/notifications?from=aaaaaaaaaaa1",
		});
		try {
			assert.ok(await page.settle(() => page.rows().length > 0));
			await act(async () =>
				page.grid().dispatchEvent(
					new window.KeyboardEvent("keydown", {
						key: "a",
						metaKey: true,
						bubbles: true,
					}),
				),
			);
			assert.ok(
				await page.settle(() =>
					page.container.textContent.includes("550 selected"),
				),
			);
			const preview = page.fixture.requests.find((request) => request.preview);
			assert.equal(preview.sessionId, "aaaaaaaaaaa1");
		} finally {
			await page.unmount();
		}
		const older = await mount({ bulk: false });
		try {
			assert.ok(await older.settle(() => older.rows().length === 100));
			assert.equal(
				older.container.querySelector("[data-notifications-select-all]")
					.disabled,
				true,
			);
			await act(async () =>
				older.grid().dispatchEvent(
					new window.KeyboardEvent("keydown", {
						key: "a",
						ctrlKey: true,
						bubbles: true,
					}),
				),
			);
			assert.equal(
				older.fixture.requests.filter((request) => request.preview).length,
				0,
			);
			assert.equal(selectedRows(older).length, 0);
		} finally {
			await older.unmount();
		}
	},
);

test(
	"mixed asks require confirmation and review is not settlement; ask-only frozen read is visibly unavailable",
	BOUNDED,
	async () => {
		const waiting = [1, 2].map((index) => ({
			...row(index),
			id: `ask:aaaaaaaaaaa1:question-${index}`,
			source: "ask",
			priority: "high",
			ask: { status: "open" },
		}));
		const page = await mount({
			bulk: true,
			state: "all",
			items: [row(10), row(11), row(12)],
			waiting,
		});
		try {
			assert.ok(await page.settle(() => page.rows().length === 5));
			await click(
				page.container.querySelector("[data-notifications-select-all]"),
			);
			assert.ok(
				await page.settle(() =>
					page.container.textContent.includes("5 selected"),
				),
			);
			assert.equal(
				page.container.querySelector("[data-notifications-asks-stay]").dataset
					.notificationsAsksStay,
				"2",
			);
			assert.match(
				page.container.querySelector('[data-notifications-bulk-read="read"]')
					.textContent,
				/3 updates/,
			);
			await click(
				page.container.querySelector("[data-notifications-bulk-dismiss]"),
			);
			assert.ok(
				await page.settle(() =>
					document.querySelector("[data-notifications-confirm-view]"),
				),
			);
			assert.equal(
				page.fixture.requests.filter(
					(request) => request.op === "notifications.dismiss",
				).length,
				0,
			);
			const review = [
				...document.querySelectorAll('[role="dialog"] button'),
			].find((button) => button.textContent.includes("Review unanswered asks"));
			await click(review);
			assert.ok(await page.settle(() => page.rows().length === 2));
			assert.equal(page.fixture.counts().waiting_count, 2);
			assert.equal(
				page.fixture.requests.filter(
					(request) => request.op === "sessions.answer",
				).length,
				0,
			);
			await click(
				page.container.querySelector("[data-notifications-select-all]"),
			);
			assert.ok(
				await page.settle(() =>
					page.container.textContent.includes("2 selected"),
				),
			);
			assert.equal(
				page.container.querySelector('[data-notifications-bulk-read="read"]')
					.disabled,
				true,
			);
			assert.equal(
				page.container.querySelector('[data-notifications-bulk-read="unread"]')
					.disabled,
				true,
			);
			await click(
				[...page.container.querySelectorAll("button")].find((button) =>
					button.textContent.includes("Clear selection"),
				),
			);
			await click(
				page.container.querySelector(
					'[data-notification-row] [role="checkbox"]',
				),
			);
			assert.equal(
				page.container.querySelector('[data-notifications-bulk-read="read"]')
					.disabled,
				false,
			);
			await click(
				page.container.querySelector('[data-notifications-bulk-read="read"]'),
			);
			assert.ok(await page.settle(() => waiting.some((ask) => ask.read)));
			assert.equal(
				page.fixture.counts().waiting_count,
				2,
				"read never settles an ask",
			);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"small visible dismiss needs no confirmation and partial selection uses sequence-guarded receipt",
	BOUNDED,
	async () => {
		const items = [row(1), row(2), row(3)];
		const page = await mount({ bulk: true, state: "all", items });
		try {
			assert.ok(await page.settle(() => page.rows().length === 3));
			await click(
				page.container.querySelector(
					'[data-notification-row] [role="checkbox"]',
				),
			);
			await click(
				page.container.querySelector("[data-notifications-bulk-dismiss]"),
			);
			assert.ok(
				await page.settle(
					() => items.filter((item) => item.dismissed).length === 1,
				),
			);
			assert.equal(
				document.querySelector("[data-notifications-confirm-view]"),
				null,
			);
			const write = page.fixture.requests.find(
				(request) => request.op === "notifications.dismiss",
			);
			assert.equal(write.target.receipt, true);
			assert.equal(write.target.throughSeq, 3);
			assert.equal(write.target.items.length, 1);
			await act(async () =>
				page.grid().dispatchEvent(
					new window.KeyboardEvent("keydown", {
						key: "z",
						ctrlKey: true,
						bubbles: true,
					}),
				),
			);
			assert.ok(
				await page.settle(() => items.every((item) => !item.dismissed)),
			);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"an ask arriving after the frozen gesture is never auto-checked",
	BOUNDED,
	async () => {
		const waiting = [
			{
				...row(1),
				id: "ask:aaaaaaaaaaa1:original",
				source: "ask",
				priority: "high",
				seq: 0,
				ask: { status: "open" },
			},
		];
		const page = await mount({
			bulk: true,
			askRead: true,
			state: "all",
			items: [row(2)],
			waiting,
		});
		try {
			assert.ok(await page.settle(() => page.rows().length === 2));
			await click(
				page.container.querySelector("[data-notifications-select-all]"),
			);
			assert.ok(
				await page.settle(() =>
					page.container.textContent.includes("2 selected"),
				),
			);
			const preview = page.fixture.requests.find((request) => request.preview);
			assert.equal(preview.includeAskReads, true);
			const arriving = {
				...waiting[0],
				id: "ask:aaaaaaaaaaa1:later",
				title: "A later ask",
			};
			await act(async () => {
				page.fixture.arriveAsk(arriving);
				await page.client.invalidateQueries({
					queryKey: PAGE.notificationKeys.factsRoot,
				});
			});
			assert.ok(await page.settle(() => page.rows().length === 3));
			const later = [
				...page.container.querySelectorAll("[data-notification-row]"),
			].find((row) => row.dataset.notificationRow === arriving.id);
			assert.equal(later.getAttribute("aria-selected"), "false");
			assert.ok(
				page.container.querySelector(
					"[data-notifications-new-outside-selection]",
				),
				"visible late asks get an explicit scope notice",
			);
			assert.equal(
				later.querySelector('[role="checkbox"]').getAttribute("data-state"),
				"unchecked",
			);
			assert.ok(
				page.container.textContent.includes("2 selected"),
				"bar count remains server snapshot count",
			);
		} finally {
			await page.unmount();
		}
	},
);
