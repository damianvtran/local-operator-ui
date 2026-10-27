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
const PAGE = await import(pageBundlePath.href);
await unlink(pageBundlePath);

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
async function mount() {
	const items = Array.from({ length: TOTAL }, (_, at) => row(TOTAL - at));
	const fixture = PAGE.createNotificationFixture(items, []);
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
		defaultOptions: { queries: { retry: false } },
	});
	const root = createRoot(container);
	await act(async () => {
		root.render(
			h(
				MemoryRouter,
				{ initialEntries: ["/notifications"] },
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
		container.remove();
		console.error = originalError;
	};
	return {
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

			const button = page
				.grid()
				.querySelector("[data-notifications-back-to-top]");
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
