import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * THE DRAWER'S UPDATES TAB, MOUNTED: ONE CLICK MARKS ONE ROW READ.
 *
 * WHY THIS FILE EXISTS. The operator clicked "Mark as read" on a drawer row and
 * nothing moved; a second click was needed, and nothing said which rows were read.
 * Root cause (reproduced here against origin/main): the drawer drew rows from
 * `mergeWindowForReel`, which at the top of the list lets page one's FACTS win
 * over the scroll window. A write edited only the window (`applyConfirmedWrite`)
 * and then INVALIDATED the facts, so until that refetch landed the stale facts
 * row (still `read: false`) was what the drawer drew - the confirmed flip was
 * hidden under it. Nothing was applied before the server answered either, so the
 * click had no immediate effect at all.
 *
 * This mounts the shipped `DrawerUpdates` and `DrawerTabs` (with the shipped
 * `useSessionUnreadUpdates`) and a probe of the sidebar's badge figure
 * (`badgeCountOf(useNotificationsCount())`, what `sidebar-navigation.tsx` draws)
 * over a real `QueryClient` and the shipped stateful fixture, and asserts what
 * the operator sees after ONE click: the row leaves Unread, the tab count drops
 * and the badge drops. The transport is the fixture; nothing here is pixel
 * evidence.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export { DrawerUpdates, DrawerTabs, useSessionUnreadUpdates } from "./src/renderer/src/features/notifications/components/drawer-updates";',
			'export { NotificationsPage } from "./src/renderer/src/features/notifications/components/notifications-page";',
			'export { createNotificationFixture } from "./src/renderer/src/features/notifications/notifications-fixture";',
			'export { notificationKeys, useNotificationsCount } from "./src/renderer/src/features/notifications/notifications-api";',
			'export { badgeCountOf } from "./src/renderer/src/features/notifications/notifications-model";',
			/*
			 * Sonner paints through a portal on its own schedule, so the receipt is read
			 * where it is REQUESTED: the bundled `toast` object the app's
			 * `showInfoToast` holds (the `mark-all-read-control.test.mjs` approach).
			 */
			'export { toast as sonnerToast } from "sonner";',
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
	`./_drawer-updates-read-${process.pid}.mjs`,
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
const { MemoryRouter } = await import("react-router-dom");
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);

const NOW = new Date(2026, 9, 25, 15, 0, 0).getTime();
const SESSION = "aaaaaaaaaaa1";
const row = (index) => ({
	id: `n_row${index}`,
	source: "notify",
	priority: "normal",
	title: `update ${index}`,
	excerpt: "",
	created_at: NOW - (10 - index) * 60_000,
	updated_at: NOW - (10 - index) * 60_000,
	seq: index,
	revision: 1,
	read: false,
	read_via: null,
	dismissed: false,
	repeat_count: 1,
	session: { id: SESSION, title: "one conversation" },
});

/** The tab strip, the list and the sidebar badge figure, as one screen shows them. */
/** The Notifications page instead of the drawer: same transport, same cache. */
let screenKind = "drawer";
const PageScreen = () => h(DRAWER.NotificationsPage, { nowMs: NOW });
const Screen = () => {
	if (screenKind === "page") return h(PageScreen);
	const unread = DRAWER.useSessionUnreadUpdates(SESSION, true);
	const count = DRAWER.useNotificationsCount(true);
	return h(
		"div",
		null,
		h(
			"span",
			{ "data-probe-badge": "" },
			String(DRAWER.badgeCountOf(count.data)),
		),
		h(DRAWER.DrawerTabs, {
			tab: "updates",
			onTab: () => {},
			asks: 0,
			unreadUpdates: unread,
			sessionless: false,
		}),
		h(DRAWER.DrawerUpdates, { sessionId: SESSION, nowMs: NOW }),
	);
};

/**
 * Mount over a fixture of five unread and two read rows. `gate` holds every write
 * the fixture answers until released, so a test can look at the screen BETWEEN
 * the click and the server's answer - the window the optimistic update owns.
 */
async function mount() {
	const items = [1, 2, 3, 4, 5, 6, 7].map((index) => ({
		...row(index),
		read: index <= 2,
		read_via: index <= 2 ? "explicit" : null,
	}));
	const fixture = DRAWER.createNotificationFixture(items, []);
	let held = null;
	let factsHeld = null;
	let refuseNext = false;
	const writes = [];
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
				/* Page-one facts reads (no cursor), held by `holdFacts` until released. */
				if (
					factsHeld &&
					request.op === "notifications.list" &&
					!request.cursor &&
					(request.sessionId === SESSION || !request.sessionId)
				)
					await factsHeld.promise;
				if (
					request.op === "notifications.read" ||
					request.op === "notifications.dismiss"
				) {
					writes.push(request);
					if (held) await held.promise;
					/* A refusal on its merits (4xx) is not retried, so it is what a rollback sees. */
					if (refuseNext) {
						refuseNext = false;
						return { status: 409, body: { detail: "test bridge: refused" } };
					}
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
	const container = window.document.createElement("div");
	window.document.body.append(container);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const root = createRoot(container);
	await act(async () => {
		root.render(
			h(MemoryRouter, null, h(QueryClientProvider, { client }, h(Screen))),
		);
	});
	const q = (selector) => container.querySelector(selector);
	const rowIds = () =>
		[...container.querySelectorAll("[data-drawer-update]")].map((node) =>
			node.getAttribute("data-drawer-update"),
		);
	const unreadRowIds = () =>
		[...container.querySelectorAll("[data-drawer-update][data-unread]")].map(
			(node) => node.getAttribute("data-drawer-update"),
		);
	const badge = () => q("[data-probe-badge]")?.textContent;
	const tabCount = () =>
		q('[data-drawer-tab="updates"]')?.textContent.replace(/\D+/g, "") || "0";
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
	const hold = () => {
		let release;
		const promise = new Promise((resolve) => {
			release = resolve;
		});
		held = { promise, release };
		return async () => {
			held = null;
			await act(async () => release());
		};
	};
	const holdFacts = () => {
		let release;
		const promise = new Promise((resolve) => {
			release = resolve;
		});
		factsHeld = { promise, release };
		return async () => {
			factsHeld = null;
			await act(async () => release());
		};
	};
	/* Whether a row is drawn as unread - its accent dot - in any view (markup on main and here). */
	const drawnUnread = (id) => {
		const dot = q(`[data-drawer-update="${id}"] > span[aria-hidden]`);
		return dot ? !dot.className.split(" ").includes("invisible") : null;
	};
	const unmount = async () => {
		await act(async () => root.unmount());
		container.remove();
	};
	return {
		refuseNextWrite: () => {
			refuseNext = true;
		},
		client,
		fixture,
		writes,
		q,
		rowIds,
		unreadRowIds,
		holdFacts,
		drawnUnread,
		badge,
		tabCount,
		settle,
		click,
		hold,
		unmount,
	};
}

const BOUNDED = { timeout: 30_000 };

const infoToasts = [];
const originalInfo = DRAWER.sonnerToast.info;
DRAWER.sonnerToast.info = (message, options) => {
	infoToasts.push({ message, options });
	return infoToasts.length;
};
after(() => {
	DRAWER.sonnerToast.info = originalInfo;
});

/** Look at the screen with the write still in flight: no settle, no server answer. */
const flush = () =>
	act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

test(
	"one click on a row's mark-read flips the row, the tab count and the badge, before the server answers",
	BOUNDED,
	async () => {
		const page = await mount();
		try {
			assert.ok(
				await page.settle(
					() =>
						page.rowIds().length === 5 &&
						page.badge() === "5" &&
						page.tabCount() === "5",
				),
				`drawn: rows ${page.rowIds()} badge ${page.badge()} tab ${page.tabCount()}`,
			);
			assert.deepEqual(
				page.unreadRowIds(),
				page.rowIds(),
				"Unread is the default view and holds only unread rows",
			);
			const release = page.hold();
			await page.click(
				'[data-drawer-update="n_row7"] [data-row-action="read"]',
			);
			await flush();
			assert.ok(
				!page.rowIds().includes("n_row7"),
				`the row left Unread on the click: ${page.rowIds()}`,
			);
			assert.equal(page.tabCount(), "4", "the tab count moved on the click");
			assert.equal(page.badge(), "4", "the sidebar badge moved on the click");
			await release();
			assert.ok(
				await page.settle(
					() =>
						!page.rowIds().includes("n_row7") &&
						page.tabCount() === "4" &&
						page.badge() === "4",
					1_500,
				),
				`after the receipt: rows ${page.rowIds()} tab ${page.tabCount()} badge ${page.badge()}`,
			);
			await page.settle(() => false, 900);
			assert.ok(
				!page.rowIds().includes("n_row7"),
				"no refetch brought the row back",
			);
			assert.equal(page.writes.length, 1, "exactly one write was sent");
			await page.click('[data-drawer-read-view="read"]');
			assert.ok(page.rowIds().includes("n_row7"), "Read holds the history");
			assert.equal(page.unreadRowIds().length, 0, "no unread row in Read");
		} finally {
			await page.unmount();
		}
	},
);

/*
 * THE NAMED ROOT CAUSE, isolated (and markup-agnostic, so it fails on origin/main
 * for the defect rather than for the new subtabs): the server HAS confirmed the
 * read, and page one's facts refetch has not landed yet. On origin/main the drawer
 * drew the stale facts row - `mergeWindowForReel` prefers facts on an equal
 * revision, and a read moves `seq`, not `revision` - so the row stayed unread until
 * that refetch, which is the gap a second click fell into.
 */
test(
	"a confirmed read is drawn before the facts refetch lands",
	BOUNDED,
	async () => {
		const page = await mount();
		try {
			await page.settle(
				() => page.drawnUnread("n_row7") === true && page.badge() === "5",
			);
			const releaseFacts = page.holdFacts();
			await page.click(
				'[data-drawer-update="n_row7"] [data-row-action="read"]',
			);
			const flipped = await page.settle(
				() => page.writes.length === 1 && page.drawnUnread("n_row7") !== true,
				1_000,
			);
			const state = page.drawnUnread("n_row7");
			await releaseFacts();
			assert.ok(
				flipped,
				`write confirmed, facts refetch pending: row still drawn unread (${state})`,
			);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"a refused write rolls the row, the count and the badge back",
	BOUNDED,
	async () => {
		const page = await mount();
		try {
			await page.settle(
				() => page.rowIds().length === 5 && page.tabCount() === "5",
			);
			page.refuseNextWrite();
			await page.click(
				'[data-drawer-update="n_row6"] [data-row-action="read"]',
			);
			assert.ok(
				await page.settle(
					() =>
						page.rowIds().includes("n_row6") &&
						page.badge() === "5" &&
						page.tabCount() === "5",
				),
				`rolled back: rows ${page.rowIds()} badge ${page.badge()} tab ${page.tabCount()}`,
			);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"mark all read empties Unread on the click, and Undo restores every row",
	BOUNDED,
	async () => {
		const page = await mount();
		try {
			await page.settle(
				() => page.rowIds().length === 5 && page.badge() === "5",
			);
			const release = page.hold();
			await page.click("[data-drawer-mark-all-read]");
			await flush();
			assert.equal(
				page.rowIds().length,
				0,
				"every unread row left on the click",
			);
			assert.equal(page.badge(), "0", "the badge moved on the click");
			infoToasts.length = 0;
			await release();
			assert.ok(
				await page.settle(() => infoToasts.length > 0),
				"the receipt was shown",
			);
			const receipt = infoToasts.at(-1);
			assert.equal(receipt.message, "Marked 5 read");
			assert.equal(
				receipt.options?.action?.label,
				"Undo",
				"the receipt offers Undo",
			);
			await act(async () => {
				receipt.options.action.onClick();
			});
			await flush();
			assert.equal(page.rowIds().length, 5, "Undo restored the rows at once");
			assert.ok(
				await page.settle(
					() => page.badge() === "5" && page.tabCount() === "5",
				),
				`after Undo: badge ${page.badge()} tab ${page.tabCount()}`,
			);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"mark unread from Read moves the row back on the click",
	BOUNDED,
	async () => {
		const page = await mount();
		try {
			await page.settle(
				() => page.rowIds().length === 5 && page.badge() === "5",
			);
			await page.click('[data-drawer-read-view="read"]');
			assert.deepEqual(page.rowIds().sort(), ["n_row1", "n_row2"]);
			const release = page.hold();
			await page.click(
				'[data-drawer-update="n_row2"] [data-row-action="read"]',
			);
			await flush();
			assert.deepEqual(
				page.rowIds(),
				["n_row1"],
				"the row left Read on the click",
			);
			assert.equal(page.badge(), "6", "the badge moved on the click");
			await release();
			assert.ok(
				await page.settle(() => page.tabCount() === "6"),
				`tab ${page.tabCount()}`,
			);
		} finally {
			await page.unmount();
		}
	},
);

/*
 * (e) THE PAGE SHARED THE CAUSE. Its rows come from the same merged facts+window
 * answer, and its `stickyRead` map only appends rows that are NOT loaded, so a
 * loaded row marked read kept its stale facts copy until the refetch. The fix is
 * the shared one (`applyConfirmedWrite` edits the facts), so the page needs no
 * second read-state path; this pins it on the page's own row.
 */
test(
	"the Notifications page draws a confirmed read before the facts refetch lands",
	BOUNDED,
	async () => {
		screenKind = "page";
		const page = await mount();
		const pageUnread = (id) => {
			const dot = page.q(
				`[data-notification-row="${id}"] [role="gridcell"] > span[aria-hidden]`,
			);
			return dot ? !dot.className.split(" ").includes("invisible") : null;
		};
		try {
			assert.ok(
				await page.settle(() => pageUnread("n_row7") === true),
				"the page drew row 7 unread",
			);
			const releaseFacts = page.holdFacts();
			await page.click(
				'[data-notification-row="n_row7"] [data-row-action="read"]',
			);
			const flipped = await page.settle(
				() => page.writes.length === 1 && pageUnread("n_row7") === false,
				1_000,
			);
			const state = pageUnread("n_row7");
			await releaseFacts();
			assert.ok(
				flipped,
				`page: write confirmed, facts pending, row unread=${state}`,
			);
		} finally {
			screenKind = "drawer";
			await page.unmount();
		}
	},
);
