import assert from "node:assert/strict";
import { readFile, unlink, writeFile } from "node:fs/promises";
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
			'export { beginOptimisticWrite, applyConfirmedWrite, notificationKeys, useNotificationReadState, useNotificationsCount } from "./src/renderer/src/features/notifications/notifications-api";',
			'export { badgeCountOf } from "./src/renderer/src/features/notifications/notifications-model";',
			/*
			 * Sonner paints through a portal on its own schedule, so the receipt is read
			 * where it is REQUESTED: the bundled `toast` object the app's
			 * `showInfoToast` holds (the `mark-all-read-control.test.mjs` approach).
			 */
			'export { toast as sonnerToast } from "sonner";',
			'export { resetToastDedup } from "./src/renderer/src/shared/utils/toast-manager";',
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
/**
 * Another surface (the bulk lane's shape) writing through the shared read-state API
 * with rows it rendered itself: the drawer must follow on the click, with no
 * second read-state path between them.
 */
const ReadStateProbe = () => {
	const readState = DRAWER.useNotificationReadState();
	return h(
		"button",
		{
			type: "button",
			"data-probe-mark-read": "",
			onClick: () =>
				void readState
					.markRead([
						{ id: "n_row5", revision: 1 },
						{ id: "n_row4", revision: 1 },
					])
					.catch(() => {}),
		},
		"probe",
	);
};

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
		h(ReadStateProbe),
	);
};

/**
 * Mount over a fixture of five unread and two read rows. `gate` holds every write
 * the fixture answers until released, so a test can look at the screen BETWEEN
 * the click and the server's answer - the window the optimistic update owns.
 */
async function mount(options = {}) {
	const items =
		options.items ??
		[1, 2, 3, 4, 5, 6, 7].map((index) => ({
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

/*
 * D4 geometry, in the measure the reservation owns. JSDOM has no CSS layout, so
 * use the native scene's measured tabular digit and the count primitive's actual
 * chrome (px-1 on both sides, one-pixel borders, min-w-4). The hosted scene
 * remains the pixel evidence; this mounted test makes a missing or content-only
 * reservation fail before it can move the neighbouring Read segment again.
 */
const TABULAR_DIGIT_PX = 7.71875;
const DIGIT_RESERVATION = /^calc\((\d+)ch \+ 10px\)$/;
const badgeBorderBox = (badge) => {
	const naturalWidth = Math.max(
		16,
		badge.textContent.length * TABULAR_DIGIT_PX + 10,
	);
	const reservation = badge.style.minWidth.match(DIGIT_RESERVATION);
	assert.ok(
		reservation,
		"the count reserves its digits plus the badge's 8px padding and 2px borders",
	);
	const reservedWidth = Number(reservation[1]) * TABULAR_DIGIT_PX + 10;
	return Math.max(naturalWidth, reservedWidth);
};

test(
	"D4: the digit reservation holds the Read segment's x across 10 to 9",
	BOUNDED,
	async () => {
		const page = await mount({
			items: Array.from({ length: 10 }, (_, index) => row(index + 1)),
		});
		const release = page.hold();
		try {
			assert.ok(await page.settle(() => page.tabCount() === "10"));
			const before = page.q('[data-drawer-read-view="unread"] > span');
			assert.ok(before);
			const beforeWidth = badgeBorderBox(before);
			/* Native frame localOperatorDark-populated: Read's x at Unread 10. */
			const readXBefore = 643.515625;

			await page.click(
				'[data-drawer-update="n_row1"] [data-row-action="read"]',
			);
			assert.ok(await page.settle(() => page.tabCount() === "9"));
			const after = page.q('[data-drawer-read-view="unread"] > span');
			assert.ok(after);
			const readXAfter = readXBefore + badgeBorderBox(after) - beforeWidth;

			assert.equal(after.textContent, "9");
			assert.equal(
				readXAfter,
				readXBefore,
				"the badge's reserved border box, and therefore Read's x, does not shrink",
			);
		} finally {
			await release();
			await page.unmount();
			page.client.clear();
		}
	},
);

const errorToasts = [];
const originalErrorToast = DRAWER.sonnerToast.error;
DRAWER.sonnerToast.error = (message, options) => {
	errorToasts.push({ message, options });
	return errorToasts.length;
};
after(() => {
	DRAWER.sonnerToast.error = originalErrorToast;
});
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

test(
	"a write through useNotificationReadState from another surface moves the drawer on the click",
	BOUNDED,
	async () => {
		const page = await mount();
		try {
			await page.settle(
				() => page.rowIds().length === 5 && page.tabCount() === "5",
			);
			const release = page.hold();
			await page.click("[data-probe-mark-read]");
			await flush();
			assert.deepEqual(
				page.rowIds(),
				["n_row7", "n_row6", "n_row3"],
				"both rows left Unread",
			);
			assert.equal(page.badge(), "3");
			assert.equal(page.tabCount(), "3");
			await release();
			assert.ok(
				await page.settle(
					() => page.badge() === "3" && page.rowIds().length === 3,
				),
			);
		} finally {
			await page.unmount();
		}
	},
);

// Round 2: receipts, overlapping intents, count fences and filtered pagination.
function seedLedger() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	const a = row(7);
	const b = { ...row(6), session: { id: "bbbbbbbbbbb2", title: "other" } };
	const facts = {
		items: [a, b],
		waiting: [],
		unread_count: 2,
		waiting_count: 2,
		waiting_unread_count: 2,
		high_water: 7,
		next_cursor: null,
	};
	client.setQueryData(DRAWER.notificationKeys.facts("all"), facts);
	client.setQueryData(DRAWER.notificationKeys.sessionFacts(SESSION), {
		...facts,
		items: [a],
	});
	client.setQueryData(DRAWER.notificationKeys.count, {
		...facts,
		items: undefined,
	});
	client.setQueryData(
		[...DRAWER.notificationKeys.sessionUnread(SESSION), 7],
		1,
	);
	return {
		client,
		a,
		b,
		get: () => client.getQueryData(DRAWER.notificationKeys.facts("all")),
	};
}
const fullReceipt = (changed, high_water, unread_count, skipped = []) => ({
	changed,
	skipped,
	high_water,
	unread_count,
	waiting_count: 2,
	waiting_unread_count: 2,
});

test(
	"R1: partial and all-skipped success receipts preserve refused rows, including Undo",
	BOUNDED,
	async () => {
		const page = await mount();
		let release;
		try {
			await page.settle(() => page.tabCount() === "5");
			release = page.holdFacts();
			page.fixture.revise("n_row7");
			const index = infoToasts.length;
			await page.click("[data-drawer-mark-all-read]");
			assert.ok(
				await page.settle(
					() => infoToasts.length > index && page.rowIds().join() === "n_row7",
				),
			);
			assert.equal(page.tabCount(), "1");
			assert.equal(page.badge(), "1");
			await release();
			release = null;
			await page.settle(() => false, 50);
			// Accepted inverses retain the frozen tokens. A revised/re-read row is refused.
			page.fixture.revise("n_row6");
			page.fixture.patch("read", { items: [{ id: "n_row6", revision: 2 }] });
			await act(async () =>
				page.client.invalidateQueries({
					queryKey: DRAWER.notificationKeys.all,
				}),
			);
			await page.settle(() => false, 50);
			release = page.holdFacts();
			await act(async () => infoToasts[index].options.action.onClick());
			assert.ok(await page.settle(() => page.rowIds().length === 4));
			assert.ok(!page.rowIds().includes("n_row6"));
		} finally {
			if (release) await release();
			await page.unmount();
			page.client.clear();
		}
		const { client, a, get } = seedLedger();
		try {
			const tx = await DRAWER.beginOptimisticWrite(client, "read", [
				{ id: a.id, revision: 1 },
			]);
			tx.settle(
				fullReceipt([], 7, 2, [{ id: a.id, reason: "stale_revision" }]),
			);
			assert.equal(get().items[0].read, false);
			assert.equal(get().unread_count, 2);
		} finally {
			client.clear();
		}
	},
);

test("R2: failed dismiss cannot resurrect a later confirmed read or its unread contribution", async () => {
	const { client, a, get } = seedLedger();
	try {
		const dismiss = await DRAWER.beginOptimisticWrite(client, "dismiss", [
			a.id,
		]);
		const read = await DRAWER.beginOptimisticWrite(client, "read", [a.id]);
		read.settle(fullReceipt([a.id], 8, 1));
		dismiss();
		assert.equal(get().items[0].read, true);
		assert.equal(get().items[0].dismissed, false);
		assert.equal(get().unread_count, 1);
		assert.equal(
			client.getQueryData(DRAWER.notificationKeys.sessionFacts(SESSION))
				.unread_count,
			1,
			"session facts carry the GLOBAL count",
		);
		// A newer authoritative result during an older pending read survives its refusal.
		const tx = await DRAWER.beginOptimisticWrite(client, "unread", [a.id]);
		client.setQueryData(DRAWER.notificationKeys.facts("all"), {
			...get(),
			high_water: 12,
			unread_count: 1,
			items: get().items.map((r) =>
				r.id === a.id ? { ...r, read: true, seq: 12 } : r,
			),
		});
		tx();
		assert.equal(get().items[0].read, true);
		assert.equal(get().unread_count, 1);
	} finally {
		client.clear();
	}
});

test("R3: newest seq wins in either facts/window orientation without a duplicate decrement", async () => {
	for (const newerInFacts of [true, false]) {
		const { client, a, get } = seedLedger();
		try {
			const newer = { ...a, read: true, seq: 20 };
			client.setQueryData(DRAWER.notificationKeys.facts("all"), {
				...get(),
				high_water: 20,
				unread_count: 1,
				items: [newerInFacts ? newer : a, row(6)],
			});
			client.setQueryData(DRAWER.notificationKeys.list("all"), {
				pages: [{ ...get(), items: [newerInFacts ? a : newer] }],
				pageParams: [null],
			});
			const tx = await DRAWER.beginOptimisticWrite(client, "read", [a.id]);
			assert.equal(get().unread_count, 1);
			tx();
			assert.equal(get().unread_count, 1);
		} finally {
			client.clear();
		}
	}
});

test("R4: pre-click session fetch is cancelled; later old-baseline responses are projected, not trusted blindly", async () => {
	const { client, a } = seedLedger();
	let resolve;
	const key = [...DRAWER.notificationKeys.sessionUnread(SESSION), 7];
	try {
		const pending = client
			.fetchQuery({
				queryKey: key,
				queryFn: () =>
					new Promise((r) => {
						resolve = r;
					}),
			})
			.catch((error) => error);
		const tx = await DRAWER.beginOptimisticWrite(client, "read", [a.id]);
		resolve(1);
		await pending;
		assert.equal(client.getQueryData(key), 0);
		client.setQueryData(key, 1); // a refetch starting during the pending write
		assert.equal(client.getQueryData(key), 0);
		tx();
		assert.equal(client.getQueryData(key), 1);
	} finally {
		client.clear();
	}
});

test(
	"R5: session A's placeholder never appears in loading/disabled session B or null",
	BOUNDED,
	async () => {
		const page = await mount();
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		function Counter({ session, enabled }) {
			return h(
				"span",
				null,
				String(DRAWER.useSessionUnreadUpdates(session, enabled)),
			);
		}
		const render = async (session, enabled = true) =>
			act(async () =>
				root.render(
					h(
						QueryClientProvider,
						{ client: page.client },
						h(Counter, { session, enabled }),
					),
				),
			);
		try {
			await page.settle(() => page.tabCount() === "5");
			await render(SESSION);
			assert.equal(host.textContent, "5");
			const original = window.api.desktop.request;
			window.api.desktop.request = async (request) =>
				request.sessionId === "bbbbbbbbbbb2"
					? new Promise(() => {})
					: original(request);
			await render("bbbbbbbbbbb2");
			assert.equal(host.textContent, "0");
			await render(null);
			assert.equal(host.textContent, "0");
			await render(SESSION, false);
			assert.equal(host.textContent, "0");
		} finally {
			await act(async () => root.unmount());
			host.remove();
			await page.unmount();
			page.client.clear();
		}
	},
);

test(
	"U1: both filtered views retain an explicit bounded route to off-page matches",
	BOUNDED,
	async () => {
		for (const view of ["unread", "read"]) {
			const items = Array.from({ length: 101 }, (_, i) => ({
				...row(i + 1),
				read: view === "unread" ? i > 0 : i === 0,
			}));
			const page = await mount({ items });
			try {
				await page.settle(() => Boolean(page.q("[data-drawer-load-more]")));
				if (view === "read") await page.click('[data-drawer-read-view="read"]');
				assert.equal(page.rowIds().length, 0);
				assert.equal(
					page.q("[data-drawer-empty]"),
					null,
					"not caught up with a cursor",
				);
				assert.ok(
					page.q("[data-drawer-load-more]"),
					"reachable even without scroll overflow",
				);
				await page.click("[data-drawer-load-more]");
				assert.ok(await page.settle(() => page.rowIds().includes("n_row1")));
				const pages = page.client.getQueryData(
					DRAWER.notificationKeys.session(SESSION),
				).pages;
				assert.equal(
					pages.length,
					2,
					"one gesture requests one page, not a drain",
				);
			} finally {
				await page.unmount();
				page.client.clear();
			}
		}
	},
);

test(
	"U4: native focus fixup lag cannot strand a removed row's keyboard position",
	BOUNDED,
	async () => {
		const page = await mount();
		const activeElement = Object.getOwnPropertyDescriptor(
			window.Document.prototype,
			"activeElement",
		);
		let detached = null;
		try {
			await page.settle(() => page.rowIds().length === 5);
			const first = page.q(
				'[data-drawer-update="n_row7"] [data-row-action="read"]',
			);
			await act(async () => first.focus());
			detached = first;
			/* Model the hosted Chromium state: the removed row's action remains
			 * activeElement after its DOM node is disconnected. The existing keyboard
			 * test only models JSDOM's immediate BODY reset, which passed at the
			 * failing native head. */
			Object.defineProperty(document, "activeElement", {
				configurable: true,
				get: () => detached ?? activeElement.get.call(document),
			});
			await page.click(
				'[data-drawer-update="n_row7"] [data-row-action="read"]',
			);
			await flush();
			assert.equal(
				first.isConnected,
				false,
				"negative control: row was removed",
			);
			detached = null;
			assert.equal(
				document.activeElement.closest("[data-drawer-update]")?.dataset
					.drawerUpdate,
				"n_row6",
			);
			/* R1-2: the ROW is not the guarantee - the CONTROL is. Mutating the handoff
			 * selector to `dismiss` left this test green while the operator's Enter
			 * changed meaning. */
			assert.equal(
				document.activeElement.dataset.rowAction,
				"read",
				"the handoff lands on the read control, not another action",
			);
		} finally {
			detached = null;
			Reflect.deleteProperty(document, "activeElement");
			await page.unmount();
			page.client.clear();
		}
	},
);

test(
	"U4: pointer removal hands focus to next, previous, then the empty heading",
	BOUNDED,
	async () => {
		for (const direction of ["rtl", "ltr"]) {
			document.documentElement.dir = direction;
			const page = await mount({ items: [row(1), row(2), row(3)] });
			try {
				await page.settle(() => page.rowIds().length === 3);
				const first = page.q(
					'[data-drawer-update="n_row3"] [data-row-action="read"]',
				);
				await act(async () => first.focus());
				await page.click(
					'[data-drawer-update="n_row3"] [data-row-action="read"]',
				);
				await flush();
				assert.equal(
					document.activeElement.closest("[data-drawer-update]")?.dataset
						.drawerUpdate,
					"n_row2",
					`${direction}: next row owns focus after pointer removal`,
				);
				assert.equal(
					document.activeElement.dataset.rowAction,
					"read",
					`${direction}: and on the read control that was used`,
				);
				const last = page.q(
					'[data-drawer-update="n_row1"] [data-row-action="read"]',
				);
				await act(async () => last.focus());
				await page.click(
					'[data-drawer-update="n_row1"] [data-row-action="read"]',
				);
				await flush();
				assert.equal(
					document.activeElement.closest("[data-drawer-update]")?.dataset
						.drawerUpdate,
					"n_row2",
					`${direction}: previous row owns focus when no next row remains`,
				);
				assert.equal(
					document.activeElement.dataset.rowAction,
					"read",
					`${direction}: and on the read control that was used`,
				);
				await page.click("[data-drawer-mark-all-read]");
				await flush();
				assert.equal(document.activeElement.dataset.drawerEmpty, "unread");
			} finally {
				await page.unmount();
				page.client.clear();
			}
		}
	},
);

test(
	"U2/U4: roving radio arrows; disappearing focused row hands off to next row then empty heading",
	BOUNDED,
	async () => {
		const page = await mount();
		try {
			await page.settle(() => page.rowIds().length === 5);
			const unread = page.q('[data-drawer-read-view="unread"]');
			unread.focus();
			await act(async () =>
				unread.dispatchEvent(
					new window.KeyboardEvent("keydown", {
						key: "ArrowRight",
						bubbles: true,
					}),
				),
			);
			assert.equal(document.activeElement.dataset.drawerReadView, "read");
			assert.equal(unread.tabIndex, -1);
			await page.click('[data-drawer-read-view="unread"]');
			const first = page.q('[data-drawer-update="n_row7"] button');
			first.focus();
			await act(async () =>
				first.dispatchEvent(
					new window.KeyboardEvent("keydown", { key: "r", bubbles: true }),
				),
			);
			await flush();
			assert.equal(
				document.activeElement.closest("[data-drawer-update]")?.dataset
					.drawerUpdate,
				"n_row6",
			);
			assert.equal(
				document.activeElement.dataset.rowAction,
				"read",
				"the handoff lands on the read control, not another action",
			);
			await page.click("[data-drawer-mark-all-read]");
			await flush();
			assert.equal(document.activeElement.dataset.drawerEmpty, "unread");
		} finally {
			await page.unmount();
			page.client.clear();
		}
	},
);

test(
	/*
	 * THE HOSTED SCENE'S SECOND REFUSAL. `showErrorToast` dedupes one sentence per
	 * five seconds, so a refused Undo that lands after another notification
	 * failure published nothing: no answer to the press, and no retry control.
	 * The scene's "Undo error with retry" step is exactly that pair, and it timed
	 * out at the failing native head. This test is the red-first spelling of it:
	 * it fails while the Undo's own failure goes through the deduping path.
	 */
	"U3: a refused Undo answers even when the same refusal was just shown",
	BOUNDED,
	async () => {
		DRAWER.resetToastDedup();
		const page = await mount();
		const firstError = errorToasts.length;
		const firstInfo = infoToasts.length;
		try {
			await page.settle(() => page.rowIds().length === 5);
			// The earlier refusal, in the drawer's own copy: a refused mark-all.
			page.refuseNextWrite();
			await page.click("[data-drawer-mark-all-read]");
			assert.ok(
				await page.settle(() => errorToasts.length > firstError),
				"precondition: the first refusal was shown",
			);
			// The same action then succeeds, so there is an Undo to refuse.
			await page.click("[data-drawer-mark-all-read]");
			assert.ok(
				await page.settle(() => infoToasts.length > firstInfo),
				"precondition: the Undo card exists",
			);
			const beforeUndo = errorToasts.length;
			page.refuseNextWrite();
			await act(async () => infoToasts.at(-1).options.action.onClick());
			assert.ok(
				await page.settle(() => errorToasts.length > beforeUndo),
				"a refused Undo must answer inside the dedupe window",
			);
			assert.equal(
				typeof errorToasts.at(-1).options.action.onClick,
				"function",
				"and its answer must carry the retry",
			);
			/* D1/U1: the answer must SUPERSEDE the refusal already on screen. Sonner
			 * replaces by id, so an answer without one stacked an identical sentence
			 * beside the first - which is what the hosted frame showed. */
			assert.equal(
				errorToasts.at(-1).options.id,
				"drawer-refusal",
				"the Undo's answer names the card it replaces",
			);
			assert.equal(
				errorToasts.at(beforeUndo - 1).options.id,
				errorToasts.at(-1).options.id,
				"and it is the same card as the refusal before it, not a twin",
			);
		} finally {
			await page.unmount();
			page.client.clear();
		}
	},
);

test(
	"U3: refused Undo keeps successful original state and offers explicit retry with original tokens",
	BOUNDED,
	async () => {
		const page = await mount();
		try {
			await page.settle(() => page.rowIds().length === 5);
			const index = infoToasts.length;
			await page.click("[data-drawer-mark-all-read]");
			await page.settle(() => infoToasts.length > index);
			const before = errorToasts.length;
			DRAWER.resetToastDedup();
			page.refuseNextWrite();
			await act(async () => infoToasts[index].options.action.onClick());
			assert.ok(await page.settle(() => errorToasts.length > before));
			assert.equal(page.rowIds().length, 0);
			assert.equal(
				typeof errorToasts.at(-1).options.action.onClick,
				"function",
			);
			await act(async () => errorToasts.at(-1).options.action.onClick());
			assert.ok(await page.settle(() => page.rowIds().length === 5));
		} finally {
			await page.unmount();
			page.client.clear();
		}
	},
);

/*
 * ONE REFUSAL CARD, IN THE REFUSED VERB'S WORDS (design round 1, D1/D2; UX round 2,
 * U1/U3; agent review round 1, R1-3).
 *
 * `replaceErrorToast` supersedes the card it is handed the `id` OF, so the drawer's
 * refused Undo published a second identical sentence beside the refused dismiss it
 * repeated (D1), and the drawer's other two press-driven refusals took the deduping
 * path, where a second press inside five seconds said nothing at all (R1-3). All of
 * them spoke the mark-read sentence, so a refused dismiss named an action the person
 * never took (D2/U3). RED when any id is dropped, when the ids disagree, or when a
 * verb stops naming itself.
 */
test(
	"D1/U1/R1-3: every refused press answers in one drawer card, in its own verb's words",
	BOUNDED,
	async () => {
		DRAWER.resetToastDedup();
		const page = await mount();
		const first = errorToasts.length;
		const lastId = () => errorToasts.at(-1)?.options?.id;
		try {
			await page.settle(() => page.rowIds().length === 5);
			page.refuseNextWrite();
			await page.click("[data-drawer-mark-all-read]");
			assert.ok(
				await page.settle(() => errorToasts.length === first + 1),
				"the first refused press answers",
			);
			assert.equal(
				lastId(),
				"drawer-refusal",
				"the answer names the one card the drawer supersedes",
			);
			assert.equal(
				errorToasts.at(-1).message,
				"Couldn't mark read \u2014 nothing changed. Try again.",
				"a refused mark-all keeps the mark sentence",
			);
			/* Inside `showErrorToast`'s five-second window: this press used to answer
			 * nothing at all. */
			page.refuseNextWrite();
			await page.click("[data-drawer-mark-all-read]");
			assert.ok(
				await page.settle(() => errorToasts.length === first + 2),
				"a second press inside the dedupe window still answers (R1-3)",
			);
			assert.equal(
				lastId(),
				"drawer-refusal",
				"and supersedes that one card instead of stacking a twin (D1)",
			);
			page.refuseNextWrite();
			await page.click(
				'[data-drawer-update="n_row7"] [data-row-action="dismiss"]',
			);
			assert.ok(
				await page.settle(() => errorToasts.length === first + 3),
				"a refused dismiss answers",
			);
			assert.equal(
				errorToasts.at(-1).message,
				"Couldn't dismiss — nothing changed. Try again.",
				"and names the dismiss, not the mark-read (D2/U3)",
			);
			assert.equal(
				lastId(),
				"drawer-refusal",
				"in the same one card, so two refusals are one sentence at a time",
			);
		} finally {
			await page.unmount();
			page.client.clear();
		}
	},
);

/*
 * A REFUSAL THAT PUTS THE ROW BACK HANDS THE KEYBOARD POSITION BACK WITH IT (UX
 * round 2, U2). Removing the last unread row hands focus to the empty heading - new
 * in this diff - and a rollback unmounts that heading, so the operator's next Tab
 * restarted at the top of the document. The exact inverse of the U4 handoff.
 */
test(
	"U2: a rollback-restored row takes back the focus its removal handed away",
	BOUNDED,
	async () => {
		const page = await mount({
			items: [{ ...row(3), read: false, read_via: null }],
		});
		try {
			await page.settle(() => page.rowIds().length === 1);
			assert.equal(
				page.q('[data-drawer-empty="unread"]'),
				null,
				"precondition: the row is drawn, not the empty heading",
			);
			await act(async () =>
				page
					.q('[data-drawer-update="n_row3"] [data-row-action="read"]')
					.focus(),
			);
			/* Held, then refused: the optimistic removal is on screen first, which is
			 * the state the empty heading inherits - the refusal lands afterwards. */
			const release = page.hold();
			page.refuseNextWrite();
			await page.click(
				'[data-drawer-update="n_row3"] [data-row-action="read"]',
			);
			await flush();
			assert.equal(
				document.activeElement.dataset.drawerEmpty,
				"unread",
				"the optimistic removal hands focus to the empty heading",
			);
			await release();
			assert.ok(
				await page.settle(() => page.rowIds().includes("n_row3")),
				`the refused write rolls the row back: ${page.rowIds()}`,
			);
			assert.equal(
				document.activeElement.closest("[data-drawer-update]")?.dataset
					.drawerUpdate,
				"n_row3",
				"the returned row takes the focus back",
			);
			assert.equal(
				document.activeElement.dataset.rowAction,
				"read",
				"on the control whose press removed it",
			);
		} finally {
			await page.unmount();
			page.client.clear();
		}
	},
);

/* U5: after a dismiss, the next Enter must dismiss again (UX round 2, U5). */
test(
	"U5: a dismiss hands off to the next row's dismiss control, not its mark-read",
	BOUNDED,
	async () => {
		const page = await mount();
		try {
			await page.settle(() => page.rowIds().length === 5);
			await act(async () =>
				page
					.q('[data-drawer-update="n_row7"] [data-row-action="dismiss"]')
					.focus(),
			);
			await page.click(
				'[data-drawer-update="n_row7"] [data-row-action="dismiss"]',
			);
			await flush();
			assert.equal(
				document.activeElement.closest("[data-drawer-update]")?.dataset
					.drawerUpdate,
				"n_row6",
				"the next row owns the position",
			);
			assert.equal(
				document.activeElement.dataset.rowAction,
				"dismiss",
				"and the control the press used, so a second Enter dismisses again",
			);
		} finally {
			await page.unmount();
			page.client.clear();
		}
	},
);

/* D6: the Read view's empty sentence may not deny the badge beside it. */
test(
	"D6: the Read view with nothing read says nothing matches, not that nothing was flagged",
	BOUNDED,
	async () => {
		const page = await mount({
			items: [
				{ ...row(3), read: false, read_via: null },
				{ ...row(4), read: false, read_via: null },
			],
		});
		try {
			await page.settle(() => page.rowIds().length === 2);
			await page.click('[data-drawer-read-view="read"]');
			const empty = page.q('[data-drawer-empty="read"]');
			assert.ok(empty, "the Read view draws its own empty state");
			assert.equal(
				empty.textContent,
				"Nothing matches these filters",
				"and does not tell the person nothing was flagged while the Unread badge counts two",
			);
			assert.equal(
				page.tabCount(),
				"2",
				"the Unread tab still counts the two rows the sentence must not deny",
			);
		} finally {
			await page.unmount();
			page.client.clear();
		}
	},
);

/* U4: a successful Undo confirms itself where its rows are not on screen. */
test(
	"U4: a successful Undo says so, from the view where the restored rows are not drawn",
	BOUNDED,
	async () => {
		const page = await mount();
		try {
			await page.settle(() => page.rowIds().length === 5);
			const info = infoToasts.length;
			await page.click("[data-drawer-mark-all-read]");
			assert.ok(
				await page.settle(() => infoToasts.length > info),
				"the mark-all receipt exists",
			);
			await page.click('[data-drawer-read-view="read"]');
			const undone = infoToasts.length;
			await act(async () => infoToasts.at(info).options.action.onClick());
			assert.ok(
				await page.settle(() => infoToasts.length > undone),
				"the Undo confirms itself instead of only moving rows elsewhere",
			);
			assert.equal(
				infoToasts.at(-1).message,
				"Restored",
				"with the copy the Notifications page already uses",
			);
		} finally {
			await page.unmount();
			page.client.clear();
		}
	},
);

const compact = (over = {}) => ({
	selection_version: 2,
	high_water: 9,
	unread_count: 5,
	waiting_count: 2,
	waiting_unread_count: 1,
	counts_high_water: 9,
	session_counts: { [SESSION]: { unread_count: 3 } },
	...over,
});
test("compact total scopes count loaded rows once, fence replay/session aggregates, and keep asks distinct", async () => {
	const { client, a, get } = seedLedger();
	try {
		client.setQueryData(DRAWER.notificationKeys.count, {
			unread_count: 10,
			waiting_count: 2,
			waiting_unread_count: 2,
			high_water: 7,
		});
		const key = [...DRAWER.notificationKeys.sessionUnread(SESSION), 7];
		client.setQueryData(key, 6);
		const earlier = await DRAWER.beginOptimisticWrite(client, "read", [a.id], {
			throughSeq: 7,
			unreadDelta: -5,
			sessionUnreadDeltas: { [SESSION]: -3 },
			waitingUnreadDelta: -1,
		});
		const count = () => client.getQueryData(DRAWER.notificationKeys.count);
		assert.equal(count().unread_count, 5);
		assert.equal(count().waiting_unread_count, 1);
		assert.equal(count().waiting_count, 2);
		assert.equal(client.getQueryData(key), 3);
		const later = await DRAWER.beginOptimisticWrite(client, "read", [], {
			throughSeq: 7,
			unreadDelta: -1,
			sessionUnreadDeltas: { [SESSION]: -1 },
		});
		later.settleCompact(
			compact({
				high_water: 11,
				unread_count: 8,
				counts_high_water: 10,
				session_counts: { [SESSION]: { unread_count: 5 } },
			}),
		);
		earlier();
		assert.equal(
			count().unread_count,
			8,
			"rollback derives from newer authority, not a stale inverse",
		);
		assert.equal(client.getQueryData(key), 5);
		const replay = await DRAWER.beginOptimisticWrite(client, "read", [], {
			throughSeq: 7,
			unreadDelta: -5,
			sessionUnreadDeltas: { [SESSION]: -3 },
		});
		replay.settleCompact(
			compact({
				high_water: 12,
				unread_count: 8,
				counts_high_water: 9,
				session_counts: { [SESSION]: { unread_count: 3 } },
			}),
		);
		assert.equal(count().unread_count, 8);
		assert.equal(
			client.getQueryData(key),
			5,
			"old replay count fence cannot replace newer session count",
		);
		assert.equal(
			get().unread_count,
			8,
			"session facts and global facts use global authority",
		);
	} finally {
		client.clear();
	}
});

test("compact reconciliation preserves newer rows, settles deep cached skipped revisions, and bounds removals by read fence", async () => {
	const { client, a, b, get } = seedLedger();
	try {
		client.setQueryData(DRAWER.notificationKeys.list("all"), {
			pages: [
				{ ...get(), items: [a] },
				{ ...get(), items: [b] },
			],
			pageParams: [null, "older"],
		});
		const tx = await DRAWER.beginOptimisticWrite(client, "read", [a.id, b.id]);
		client.setQueryData(DRAWER.notificationKeys.facts("all"), {
			...get(),
			high_water: 30,
			unread_count: 1,
			items: [{ ...a, seq: 30, revision: 3, read: false }, b],
		});
		tx.settleCompact(
			compact({
				high_water: 20,
				unread_count: 1,
				counts_high_water: 20,
				reconciliation: {
					high_water: 20,
					items: [
						{ ...a, seq: 15, revision: 2, read: true },
						{ ...b, seq: 18, revision: 2, read: false },
					],
					absent_ids: [a.id],
				},
			}),
		);
		assert.equal(get().items[0].seq, 30);
		assert.equal(get().items[0].read, false);
		const deep = client.getQueryData(DRAWER.notificationKeys.list("all"))
			.pages[1].items[0];
		assert.equal(deep.revision, 2);
		assert.equal(
			deep.read,
			false,
			"skipped deep-window row uses same-response authority",
		);
	} finally {
		client.clear();
	}
});

test("compact v1 uses global authority without inventing a session-count fence", async () => {
	const { client, a } = seedLedger();
	try {
		const key = [...DRAWER.notificationKeys.sessionUnread(SESSION), 7];
		const tx = await DRAWER.beginOptimisticWrite(client, "read", [a.id], {
			throughSeq: 7,
			unreadDelta: -1,
			sessionUnreadDeltas: { [SESSION]: -1 },
		});
		tx.settleCompact({
			high_water: 9,
			unread_count: 1,
			waiting_count: 2,
			waiting_unread_count: 2,
			session_counts: { [SESSION]: { unread_delta: -1 } },
		});
		assert.equal(
			client.getQueryData(DRAWER.notificationKeys.count).unread_count,
			1,
		);
		assert.equal(
			client.getQueryData(key),
			1,
			"no fabricated v2 session aggregate; refreshed active counts settle this on v1",
		);
	} finally {
		client.clear();
	}
});

test("compact reconciliation routes ask rows and absent asks into waiting without changing actionable counts", async () => {
	const { client, get } = seedLedger();
	try {
		const ask = {
			...row(3),
			id: "ask:aaaaaaaaaaa1:test",
			source: "ask",
			seq: 7,
		};
		client.setQueryData(DRAWER.notificationKeys.facts("all"), {
			...get(),
			waiting: [ask],
		});
		client.setQueryData(DRAWER.notificationKeys.list("all"), {
			pages: [{ ...get(), waiting: [ask] }],
			pageParams: [null],
		});
		const tx = await DRAWER.beginOptimisticWrite(client, "read", [ask.id], {
			throughSeq: 7,
			unreadDelta: 0,
			waitingUnreadDelta: -1,
			sessionUnreadDeltas: {},
		});
		assert.equal(
			get().waiting[0].read,
			false,
			"asks remain authoritative-only rows",
		);
		assert.equal(
			client.getQueryData(DRAWER.notificationKeys.count).waiting_count,
			2,
		);
		tx.settleCompact(
			compact({
				high_water: 10,
				unread_count: 2,
				reconciliation: {
					high_water: 10,
					items: [{ ...ask, seq: 10, read: true }],
					absent_ids: [],
				},
			}),
		);
		assert.equal(get().waiting[0].read, true);
		assert.equal(
			client.getQueryData(DRAWER.notificationKeys.list("all")).pages[0]
				.waiting[0].read,
			true,
		);
		const settled = await DRAWER.beginOptimisticWrite(client, "read", [ask.id]);
		settled.settleCompact(
			compact({
				high_water: 12,
				unread_count: 2,
				reconciliation: { high_water: 12, items: [], absent_ids: [ask.id] },
			}),
		);
		assert.equal(get().waiting.length, 0);
	} finally {
		client.clear();
	}
});

/*
 * Tombstone: an absent_ids removal is fenced at reconciliation.high_water. A
 * facts fetch that STARTED before the write (older snapshot, row seq <= fence)
 * can land after it; without the fence it would resurrect the removed row. A
 * genuinely newer row (seq > fence, e.g. undismissed elsewhere) must come back.
 */
test("compact reconciliation tombstones absent rows against older fetches but admits newer seqs", async () => {
	const { client, a, b, get } = seedLedger();
	try {
		const tx = await DRAWER.beginOptimisticWrite(client, "dismiss", [a.id]);
		tx.settleCompact(
			compact({
				high_water: 20,
				unread_count: 1,
				counts_high_water: 20,
				reconciliation: { high_water: 20, items: [], absent_ids: [a.id] },
			}),
		);
		assert.deepEqual(
			get().items.map((item) => item.id),
			[b.id],
		);
		// Stale pre-write snapshot lands late: the tombstone keeps `a` gone.
		client.setQueryData(DRAWER.notificationKeys.facts("all"), {
			...get(),
			high_water: 7,
			items: [a, b],
		});
		assert.deepEqual(
			get().items.map((item) => item.id),
			[b.id],
			"older snapshot cannot resurrect a reconciled-absent row",
		);
		// A newer fact for the same id is real state, not a resurrection.
		client.setQueryData(DRAWER.notificationKeys.facts("all"), {
			...get(),
			high_water: 25,
			items: [{ ...a, seq: 25, revision: 2 }, b],
		});
		assert.deepEqual(
			get().items.map((item) => item.id),
			[a.id, b.id],
		);
	} finally {
		client.clear();
	}
});

test("QA: replay an actual core HTTP partial receipt, preserving the global facts count", async () => {
	const captured = JSON.parse(
		await readFile(
			new URL("./fixtures/notifications-real-partial.json", import.meta.url),
			"utf8",
		),
	);
	const { facts, receipt } = captured;
	const client = new QueryClient({
		defaultOptions: { queries: { gcTime: 0, retry: false } },
	});
	try {
		client.setQueryData(DRAWER.notificationKeys.facts("all"), facts);
		client.setQueryData(DRAWER.notificationKeys.count, {
			...facts,
			items: undefined,
		});
		const ids = [...receipt.changed, ...receipt.skipped.map((item) => item.id)];
		const tx = await DRAWER.beginOptimisticWrite(
			client,
			"read",
			facts.items.filter((item) => ids.includes(item.id)),
		);
		tx.settle(receipt);
		const final = client.getQueryData(DRAWER.notificationKeys.facts("all"));
		assert.equal(
			final.items.find((item) => item.id === receipt.skipped[0].id).read,
			false,
		);
		assert.equal(
			final.items.find((item) => item.id === receipt.changed[0]).read,
			true,
		);
		assert.equal(final.unread_count, receipt.unread_count);
		assert.equal(final.unread_count, 2);
	} finally {
		client.clear();
	}
});
