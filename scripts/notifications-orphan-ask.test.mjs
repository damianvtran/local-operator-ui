import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build, stop } from "esbuild";

/*
 * A DELETED CONVERSATION'S ASK, MOUNTED - the orphan row the operator could not clear.
 *
 * WHY THIS FILE EXISTS. The Notifications page listed an ask whose owning conversation
 * was gone, titled it "Untitled conversation", and every door on it failed: Send answer,
 * Decline and Dismiss each came back "Requested session, profile, team or subscription
 * not found", and Dismiss all on the From card ended the press with nothing on screen.
 * Core now marks such rows `conversation_deleted`, settles `decline`/`dismiss` for them
 * locally and refuses a plain answer with `409 conversation_deleted`. This file mounts
 * the shipped `NotificationsPage` in jsdom over a bridge that behaves that way and pins
 * what the reader sees and can do:
 *  - the label "Conversation deleted" (never "Untitled conversation") in the row, the
 *    detail header and the From card, and the subagent label when the title is a label;
 *  - Open conversation and Send answer withheld with their reason, Decline and Dismiss
 *    live, each posting to the answers route and settling the row;
 *  - a refusal drawn in place (role=alert), never swallowed - including core's
 *    `conversation_deleted` sentence and a transport failure;
 *  - Dismiss all over a conversation with nothing dismissable says so.
 *
 * WHAT IS STUBBED: the transport (`window.api.desktop.request`) only. The detail read
 * carries NO `asks` for the deleted conversation, as core cannot read a transcript that
 * is gone - the case where the old pane had no card to press at all.
 */

const pageBundle = await build({
	stdin: {
		contents: [
			'export { NotificationsPage } from "./src/renderer/src/features/notifications/components/notifications-page";',
			/* Same bundle, so the page's `toast.info` and this Toaster share one sonner store. */
			'export { Toaster } from "sonner";',
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
	/*
	 * Minified, and written as UTF-8, for the SHARD's memory rather than this file's
	 * convenience: `Desktop Tests shard` has killed this suite's process group at
	 * 9.9 GB against a 7.8 GB budget (run 40890898929, job 123595100451) with no
	 * assertion failing, and a shard runs several files that each build their own
	 * esbuild bundle at once.
	 *
	 * Measured over the seven entries the two halves of this suite used to share,
	 * one process per configuration, process tree peak of the build:
	 *
	 *   as it was                      bundle 10.8 MB   build peak 587 MB  9.7 s
	 *   charset: "utf8"                bundle  7.6 MB   build peak 526 MB  9.4 s
	 *   minify: true                   bundle  8.7 MB   build peak 555 MB 13.0 s
	 *   both (this config)             bundle  5.5 MB   build peak 496 MB 13.0 s
	 *
	 * The catalogue is why `charset` earns its place: the bundle carries all eight
	 * locales, 625,671 of the non-minified bundle's characters are `\uXXXX` escapes
	 * of CJK, Devanagari, Arabic and Cyrillic copy, and `charset: "utf8"` leaves 59.
	 * Node reads the file back as UTF-8 either way.
	 *
	 * What was tried and is NOT here, with the measurement that rejected it:
	 * `packages: "external"` would drop the 454 node_modules inputs and take this
	 * build to 269 MB - but the graph reaches packages node cannot resolve from the
	 * repo at all (measured: `prop-types` -> ERR_MODULE_NOT_FOUND; MUI 6 has no
	 * `exports` map and imports its own files BY DIRECTORY, which node's ESM resolver
	 * refuses), so the bundle stops importing. Dropping entries the assertions never
	 * read (`createNotificationFixture`, `notificationKeys`, `NotificationDetail`)
	 * moves the bundle 2.7 KB: all three are reachable from `NotificationsPage`
	 * anyway, so naming them as entries costs nothing.
	 *
	 * WHY TWO FILES. The desktop suite is already split four ways (3bc1ce25f), which
	 * bounds a RUN and not a PROCESS: measured 2026-10-30 on head a4922b13, fifteen
	 * cases shared ~620 MB of process tree and the file that held all twenty reached
	 * 5.9 GB before the guard killed it. Each file now carries one half of that graph,
	 * so no single process holds both, and this half names the page as its only entry.
	 */

	minify: true,
	charset: "utf8",
	tsconfig: "tsconfig.web.json",
});
/* On disk for the length of the import only: a data: URL cannot resolve bare specifiers. */
const pageBundlePath = new URL(
	`./_notifications-orphan-ask-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(pageBundlePath, pageBundle.outputFiles[0].text);
/*
 * Release the esbuild service BEFORE the module graph is imported, which is the
 * same reason the bundle is minified above: the child esbuild spawns stays
 * resident until `stop()`, so its footprint overlaps the import of a 5.5 MB
 * graph plus jsdom instead of following it. Measured three rounds on this
 * exact sequence (build -> write -> stop -> import React Query, jsdom, bundle),
 * process-group peak: 589 -> 476, 635 -> 510, 636 -> 322 MB. The output is
 * complete once `build()` resolves, and this file never builds again.
 */
await stop();
/*
 * React Query is loaded BEFORE the DOM globals, as it was when the bundle was: it
 * decides `isServer` from `window` at module load, and loaded after it would arm
 * five-minute gc timers and the asks poll, holding this file's event loop open.
 */
await import("@tanstack/react-query");
const { JSDOM } = await import("jsdom");
const dom = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
const { window } = dom;
let wideViewport = false;
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
	/* The page restores row focus with `CSS.escape`, a global jsdom does not define. */
	CSS: { escape: (value) => value },
	ResizeObserver: NoopObserver,
	IntersectionObserver: NoopObserver,
	/* `wideViewport` lets one case draw the list and the detail side by side. */
	matchMedia: (query) => ({
		matches: wideViewport && query.includes("min-width"),
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

/*
 * AFTER the DOM globals, not before: react-dom decides at module load whether the
 * `input` event exists (`canUseDOM`), and loaded first it never wires `onChange` for
 * an <input> - typing into the masked secret field would change nothing.
 */
const PAGE = await import(pageBundlePath.href);
await unlink(pageBundlePath);
const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = await import("react");
const { MemoryRouter, Route, Routes } = await import("react-router-dom");
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);

const NOW = Date.now();
const MINUTE = 60_000;
const GONE = "d745b7ccfd34";
const LIVE = "bbaed96023f9";
const ASK_ID = "a-00ac";
const ORPHAN_ID = `ask:${GONE}:${ASK_ID}`;
const QUESTION =
	"May the release implementer post the two round-1 remediation comments on PR #4475?";

/** The orphan as core lists it: flagged, with no title left to show. */
const orphan = (flagged = true) => ({
	id: ORPHAN_ID,
	source: "ask",
	priority: "high",
	title: QUESTION,
	excerpt: QUESTION,
	created_at: NOW - 20 * MINUTE,
	updated_at: NOW - 20 * MINUTE,
	seq: 3,
	revision: 1,
	read: false,
	read_via: null,
	dismissed: false,
	repeat_count: 1,
	session: { id: GONE, title: "" },
	conversation_deleted: flagged,
	ask: {
		status: "open",
		question_count: 1,
		deadline_at: NOW + 13 * 60 * MINUTE,
	},
});
/** A live subagent's update: core titles it with the subagent's origin label. */
const SUBAGENT_NOTE = {
	id: "n_subagentnoteo",
	source: "notify",
	priority: "normal",
	title: "Release window collected",
	excerpt: "",
	created_at: NOW - MINUTE,
	updated_at: NOW - MINUTE,
	seq: 2,
	revision: 1,
	read: false,
	read_via: null,
	dismissed: false,
	repeat_count: 1,
	session: { id: LIVE, title: "Core relay patch release window" },
};

/**
 * Mount the page on one item over a bridge that answers like the fixed core.
 * `answer(n)` decides the n-th `sessions.answer` reply.
 */
async function mount({
	openId = ORPHAN_ID,
	answer = () => ({ status: 200 }),
	/* false: the list still has the pre-delete row (an out-of-band delete, Q-U2). */
	listFlagged = true,
	/* An older core: the open ask's detail answers 404 once its owner is gone (Q-U1). */
	detail404 = false,
} = {}) {
	let open = true;
	const posts = [];
	const reads = { list: 0 };
	window.api = {
		desktop: {
			request: async (request) => {
				switch (request.op) {
					case "capabilities":
						return {
							status: 200,
							body: {
								result: {
									desktop_contract: 1,
									desktop_available: true,
									desktop_auth: "bearer",
									features: { notifications: 1, ask_dismiss: 1 },
								},
							},
						};
					case "notifications.list":
					case "notifications.count": {
						if (request.op === "notifications.list") reads.list += 1;
						/* An older core drops a gone owner's row once the list is re-read. */
						const listed = open && !(detail404 && reads.list > 1);
						const waiting = listed ? [orphan(listFlagged)] : [];
						/* A conversation-scoped walk (Dismiss all) finds no updates to dismiss. */
						const items = request.sessionId ? [] : [SUBAGENT_NOTE];
						return {
							status: 200,
							body: {
								result: {
									items,
									observed: items.map((row) => ({
										id: row.id,
										revision: row.revision,
									})),
									waiting,
									unread_count: 1,
									waiting_count: waiting.length,
									waiting_unread_count: waiting.length,
									high_water: 3,
									/* Stale by design: the From card offers Dismiss all, the walk finds 0. */
									session_counts: {
										[GONE]: { undismissed: 1, unread: 1 },
										[LIVE]: { undismissed: 1, unread: 1 },
									},
								},
							},
						};
					}
					case "notifications.get": {
						if (request.id === SUBAGENT_NOTE.id)
							return {
								status: 200,
								body: {
									result: {
										item: SUBAGENT_NOTE,
										history: [],
										session: SUBAGENT_NOTE.session,
										anchor: null,
										projects: [],
										asks: [],
									},
								},
							};
						if (!open || detail404 || request.id !== ORPHAN_ID)
							return { status: 404, body: { detail: "no such notification" } };
						/* No `asks`: core cannot read the deleted conversation's transcript. */
						return {
							status: 200,
							body: {
								result: {
									item: orphan(),
									history: [],
									session: { id: GONE, title: "" },
									anchor: null,
									projects: [],
									asks: [],
								},
							},
						};
					}
					case "notifications.read":
						return {
							status: 200,
							body: { result: { changed: [], skipped: [] } },
						};
					case "asks.list":
						return { status: 200, body: { result: { asks: [] } } };
					case "sessions.answer": {
						posts.push(request);
						const reply = answer(posts.length, request);
						if (reply.status !== 200)
							return { status: reply.status, body: { detail: reply.detail } };
						open = false;
						return {
							status: 200,
							body: { result: { status: "accepted", ask_id: request.askId } },
						};
					}
					default:
						return {
							status: 404,
							body: { detail: `test bridge: ${request.op}` },
						};
				}
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
			h(
				MemoryRouter,
				{
					initialEntries: [
						openId
							? `/notifications/${encodeURIComponent(openId)}`
							: "/notifications",
					],
				},
				h(
					QueryClientProvider,
					{ client },
					h(PAGE.Toaster, null),
					h(
						Routes,
						null,
						h(Route, {
							path: "/notifications/:notificationId",
							element: h(PAGE.NotificationsPage, { nowMs: NOW }),
						}),
						h(Route, {
							path: "/notifications",
							element: h(PAGE.NotificationsPage, { nowMs: NOW }),
						}),
					),
				),
			),
		);
	});
	const pane = () => container.querySelector("[data-notification-detail]");
	const row = (id) =>
		container.querySelector(`[data-notification-row="${id}"]`);
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
	const press = async (node) => {
		await act(async () => {
			node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		});
	};
	const unmount = async () => {
		await act(async () => root.unmount());
		client.clear();
		container.remove();
	};
	const key = async (node, value) => {
		await act(async () => {
			node.focus();
			node.dispatchEvent(
				new window.KeyboardEvent("keydown", { key: value, bubbles: true }),
			);
		});
	};
	return { container, pane, row, settle, press, key, posts, reads, unmount };
}

const BOUNDED = { timeout: 30_000 };
const DELETED = "Conversation deleted";
const UNTITLED = /Untitled conversation/;
const IN_THIS_CONVERSATION = /in this conversation/;
const DISMISS_INSTRUCTION = /Decline or dismiss it/;
const orphanBlock = (page) => page.pane()?.querySelector("[data-orphan-ask]");
const ready = (page) => page.settle(() => orphanBlock(page) != null);

test(
	"a deleted conversation's ask says so and withholds only the doors that need it",
	BOUNDED,
	async () => {
		const page = await mount();
		try {
			assert.ok(await ready(page), "the pane drew the orphan's local doors");
			const pane = page.pane();
			assert.doesNotMatch(pane.textContent, UNTITLED);
			assert.ok(
				pane.textContent.includes(DELETED),
				"header names the deletion",
			);
			assert.ok(pane.querySelector("[data-notification-conversation-deleted]"));
			/* D4: no "in this conversation" over a conversation that is gone. */
			assert.ok(pane.textContent.includes("Waiting on you"));
			assert.doesNotMatch(pane.textContent, IN_THIS_CONVERSATION);
			assert.equal(
				pane.querySelector("[data-notification-from-name]")?.textContent,
				DELETED,
				"the From card is a label, not a link to a missing conversation",
			);
			const open = pane.querySelector("[data-notification-open-conversation]");
			assert.equal(open?.getAttribute("aria-disabled"), "true");
			assert.ok(open.getAttribute("title"), "Open conversation says why");
			const send = pane.querySelector("[data-orphan-ask-send]");
			assert.equal(send?.getAttribute("aria-disabled"), "true");
			assert.ok(
				send.getAttribute("aria-describedby"),
				"Send answer names its reason",
			);
			await page.press(send);
			await page.settle(() => false, 150);
			assert.equal(
				page.posts.length,
				0,
				"a withheld Send answer posts nothing",
			);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"the list names a deleted conversation and a subagent's origin label, never Untitled",
	BOUNDED,
	async () => {
		/* The list alone: jsdom is narrow, where an open detail replaces the list. */
		const page = await mount({ openId: null });
		try {
			assert.ok(await page.settle(() => page.row(ORPHAN_ID) !== null));
			const listed = page.row(ORPHAN_ID).textContent;
			assert.ok(
				listed.includes(DELETED),
				`the orphan's source line: ${listed}`,
			);
			assert.doesNotMatch(listed, UNTITLED);
			assert.ok(await page.settle(() => page.row(SUBAGENT_NOTE.id) !== null));
			const text = page.row(SUBAGENT_NOTE.id).textContent;
			assert.ok(text.includes("Core relay patch release window"), text);
			assert.doesNotMatch(text, UNTITLED);
		} finally {
			await page.unmount();
		}
	},
);

for (const [door, field] of [
	["decline", "decline"],
	["dismiss", "dismiss"],
]) {
	test(
		`${door} on the orphan posts to the answers route and settles the row`,
		BOUNDED,
		async () => {
			const page = await mount();
			try {
				assert.ok(await ready(page));
				await page.press(
					page.pane().querySelector(`[data-orphan-ask-${door}]`),
				);
				assert.ok(await page.settle(() => page.posts.length === 1));
				const post = page.posts[0];
				assert.equal(post.op, "sessions.answer");
				assert.equal(post.sessionId, GONE);
				assert.equal(post.askId, ASK_ID);
				assert.ok(post[field], `${field} is set`);
				if (door === "dismiss") assert.equal(post.reason, "moot");
				assert.ok(
					await page.settle(
						() =>
							page.pane()?.querySelector("[data-orphan-ask-settled]") != null,
					),
					"the settled orphan is filed as settled",
				);
				const filed = page.pane().querySelector("[data-orphan-ask-settled]");
				assert.match(
					filed.textContent,
					door === "decline" ? /^Declined/ : /^Dismissed/,
				);
				assert.equal(
					page.pane().querySelector(`[data-orphan-ask-${door}]`),
					null,
					"no door is offered on a settled orphan",
				);
				assert.equal(
					page.pane()?.querySelector("[data-orphan-ask-refused]") ?? null,
					null,
					"no refusal on success",
				);
				/*
				 * D1: the instruction to decline or dismiss goes once it is done; the
				 * settled word is the only status left. Held across the refetch that
				 * 404s (core stops answering a settled ask), so the pane stays open.
				 */
				await page.settle(() => false, 300);
				/* Booleans, not nodes: a failing deepEqual would inspect the whole jsdom tree. */
				assert.ok(page.pane() != null, "the settled orphan's pane stays open");
				assert.equal(
					page
						.pane()
						.querySelector("[data-notification-conversation-deleted]") != null,
					false,
					"no 'Decline or dismiss it' notice above a settled status",
				);
				assert.doesNotMatch(page.pane().textContent, DISMISS_INSTRUCTION);
				assert.ok(
					page.pane().querySelector("[data-orphan-ask-settled]") != null,
					"the settled status is still drawn",
				);
			} finally {
				await page.unmount();
			}
		},
	);
}

test(
	"core's conversation_deleted refusal is drawn in place with its sentence",
	BOUNDED,
	async () => {
		const page = await mount({
			answer: () => ({
				status: 409,
				detail: { code: "conversation_deleted", text: "Core says: gone." },
			}),
		});
		try {
			assert.ok(await ready(page));
			await page.press(page.pane().querySelector("[data-orphan-ask-decline]"));
			const refused = () =>
				page.pane()?.querySelector("[data-orphan-ask-refused]");
			assert.ok(
				await page.settle(() => refused() != null),
				"the refusal is on screen",
			);
			assert.equal(refused().getAttribute("role"), "alert");
			assert.ok(
				refused().textContent.includes("Core says: gone."),
				refused().textContent,
			);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"a coded refusal with no sentence falls back to the app's own",
	BOUNDED,
	async () => {
		const page = await mount({
			answer: () => ({ status: 409, detail: { code: "conversation_deleted" } }),
		});
		try {
			assert.ok(await ready(page));
			await page.press(page.pane().querySelector("[data-orphan-ask-dismiss]"));
			const refused = () =>
				page.pane()?.querySelector("[data-orphan-ask-refused]");
			assert.ok(await page.settle(() => refused() != null));
			assert.match(refused().textContent, /conversation was deleted/);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"a transport failure is drawn, and a second press settles",
	BOUNDED,
	async () => {
		const page = await mount({
			answer: (n) =>
				n === 1
					? { status: 503, detail: "The local server did not answer." }
					: { status: 200 },
		});
		try {
			assert.ok(await ready(page));
			await page.press(page.pane().querySelector("[data-orphan-ask-decline]"));
			const refused = () =>
				page.pane()?.querySelector("[data-orphan-ask-refused]");
			assert.ok(
				await page.settle(() => refused() != null),
				"the failure is said",
			);
			await page.press(page.pane().querySelector("[data-orphan-ask-decline]"));
			assert.ok(
				await page.settle(
					() => page.pane()?.querySelector("[data-orphan-ask-settled]") != null,
				),
			);
			assert.equal(page.posts.length, 2);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"Dismiss all over a conversation with nothing to dismiss says so",
	BOUNDED,
	async () => {
		const page = await mount();
		try {
			assert.ok(await ready(page));
			const dismissAll = () =>
				page.pane()?.querySelector('[data-detail-dismiss-all="ready"]');
			assert.ok(
				await page.settle(() => dismissAll() != null),
				"Dismiss all is offered",
			);
			await page.press(dismissAll());
			assert.ok(
				await page.settle(() =>
					window.document.body.textContent.includes("Nothing to dismiss."),
				),
				"the empty walk is said, not swallowed",
			);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"R1: the `o` key on a deleted conversation's row says why and does not navigate",
	BOUNDED,
	async () => {
		const page = await mount({ openId: null });
		try {
			assert.ok(await page.settle(() => page.row(ORPHAN_ID) !== null));
			await page.key(page.row(ORPHAN_ID), "o");
			assert.ok(
				await page.settle(() =>
					window.document.body.textContent.includes(
						"This conversation was deleted",
					),
				),
				"the withheld door's reason is said",
			);
			/* Navigating would leave both routes: the page (and its row) would unmount. */
			assert.ok(page.row(ORPHAN_ID) != null, "still on the Notifications page");
		} finally {
			await page.unmount();
		}
	},
);

test(
	"Q-U2: a detail that reports the conversation deleted relabels its list row at once",
	BOUNDED,
	async () => {
		wideViewport = true;
		const page = await mount({ listFlagged: false });
		try {
			assert.ok(await ready(page), "the detail read carried the flag");
			assert.ok(
				page.row(ORPHAN_ID) != null,
				"the list is drawn beside the detail",
			);
			assert.ok(
				await page.settle(() =>
					page.row(ORPHAN_ID)?.textContent.includes(DELETED),
				),
				`the row agrees with the detail: ${page.row(ORPHAN_ID)?.textContent}`,
			);
			assert.doesNotMatch(page.row(ORPHAN_ID).textContent, UNTITLED);
			assert.ok(
				await page.settle(() => page.reads.list >= 2),
				"the list was re-read for core's flags",
			);
		} finally {
			wideViewport = false;
			await page.unmount();
		}
	},
);

test(
	"Q-U1: a listed ask whose detail answers 404 closes its pane and re-reads the list",
	BOUNDED,
	async () => {
		wideViewport = true;
		const page = await mount({ detail404: true, listFlagged: false });
		try {
			assert.ok(
				await page.settle(() => page.reads.list >= 2 && page.pane() == null),
				"the pane closed and the list was re-read",
			);
			assert.ok(
				await page.settle(() => page.row(ORPHAN_ID) == null),
				"the gone row left the list",
			);
			assert.equal(page.posts.length, 0);
		} finally {
			wideViewport = false;
			await page.unmount();
		}
	},
);
