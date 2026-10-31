import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build, stop } from "esbuild";

/*
 * THE NOTIFICATIONS DETAIL PANE, MOUNTED - its READ state, layout and secret field.
 *
 * WHY THIS FILE EXISTS. The pane's rows are a READ that core stops answering once an
 * ask is settled (`notifications/items.py::detail` keeps only OUTSTANDING ask rows, so
 * the refetch is a 404 and the query keeps the stale `open` rows), and the card's
 * answer path has to reconcile against that. Only a mount of the shipped
 * `NotificationsPage` over a bridge that behaves like core can see it, so this renders
 * the page in jsdom at `/notifications/<ask item id>` with a real `QueryClient`.
 *
 * WHAT IS HERE: what the pane READS and how it is bounded - jsdom has no layout, so the
 * overflow case asserts STRUCTURE (`min-w-0` on the pane column and its scroller, no
 * `overflow-x-hidden` mask) rather than pixels; the overlay over a timed_out ask; the
 * settled word in all seven translated locales; and the secret field's state
 * discipline (R1-1: no typed secret in DOM, React state or record; R2-1: a Retry
 * repeats the original request while an edit sends the new one, and closing the surface
 * clears the form). The card's WRITE path is `notifications-detail-asks-card.test.mjs`.
 *
 * WHAT IS STUBBED: the transport (`window.api.desktop.request`), which 404s a settled
 * ask exactly as core does.
 */

const pageBundle = await build({
	stdin: {
		contents: [
			'export { NotificationsPage } from "./src/renderer/src/features/notifications/components/notifications-page";',
			'export { FleetAskDrawer } from "./src/renderer/src/features/chat/components/asks/fleet-ask-drawer";',
			'export { askQueueView, ASK_STATUS_COPY, askStatusWord } from "./src/renderer/src/features/chat/ask-queue";',
			'export { setLocale } from "./src/i18n";',
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
	 * Minified and written as UTF-8 for the SHARD's memory, not this file's
	 * convenience, and split from the card's answer path so one process no longer
	 * carries both halves of the graph: measured 2026-10-30 on head a4922b13, the
	 * single file reached 5.9 GB before the guard killed it while fifteen of its cases
	 * had shared ~620 MB of process tree. The full measured table, the reason
	 * `charset: "utf8"` earns its place across eight locales, and the rejected
	 * `packages: "external"` build are in the sibling's build comment.
	 *
	 * This half names the page, the fleet drawer, the ask-queue copy and `setLocale`,
	 * because it is the half that renders the overlay and the settled word in every
	 * locale. Nothing here is named that only the sibling reads.
	 */

	minify: true,
	charset: "utf8",
	tsconfig: "tsconfig.web.json",
});
/* On disk for the length of the import only: a data: URL cannot resolve bare specifiers. */
const pageBundlePath = new URL(
	`./_notifications-detail-asks-pane-${process.pid}.mjs`,
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
const SESSION = "aaaaaaaaaaa2";
const MINUTE = 60_000;

/** Two near-identical asks in ONE conversation: the confusion the operator hit. */
const askRow = (askId, question) => ({
	ask_id: askId,
	session_id: SESSION,
	created_at: NOW - 20 * MINUTE,
	expires_at: NOW + 23 * 60 * MINUTE,
	timeout_s: 86_400,
	urgent: false,
	status: "open",
	delivered: false,
	questions: [
		{
			id: "q1",
			question,
			multi: false,
			options: [
				{ label: "Rotate after the leaks close" },
				{ label: "No rotation" },
			],
		},
	],
});
const QUESTION_A = "Should the edge secret be rotated once the fixes are live?";
const QUESTION_B =
	"Should the edge secret be rotated before the fixes are live?";
const itemFor = (ask) => ({
	id: `ask:${SESSION}:${ask.ask_id}`,
	source: "ask",
	priority: "high",
	title: ask.questions[0].question,
	excerpt: "",
	created_at: ask.created_at,
	updated_at: ask.created_at,
	seq: 1,
	revision: 1,
	read: false,
	read_via: null,
	dismissed: false,
	repeat_count: 1,
	session: { id: SESSION, title: "POC Radient proxy" },
	ask: { status: "open", question_count: 1, deadline_at: ask.expires_at },
});
const LONG_TOKEN = "x".repeat(200);
const NOTE = {
	id: "n_longbodyeo",
	source: "notify",
	priority: "normal",
	title: "Cloud node: Slack works remotely now",
	excerpt: "",
	created_at: NOW - MINUTE,
	updated_at: NOW - MINUTE,
	seq: 2,
	revision: 1,
	read: false,
	read_via: null,
	dismissed: false,
	repeat_count: 1,
	session: { id: SESSION, title: "POC Radient proxy" },
};
/**
 * Mount the page on one item, over a bridge that answers like core does.
 *
 * `answer` decides the `sessions.answer` reply per call (a function of the call count),
 * so a failure-then-success sequence is one mount.
 */
async function mount({
	openId,
	notes = [NOTE],
	wide = false,
	surface = "pane",
	answer = () => ({ status: 200 }),
	/** Edit the seeded asks (a secret question, a timed-out ask, a withdrawn one). */
	seed = () => {},
	/**
	 * Freeze `asks.list` at its FIRST answer, the window the overlay paints in - the
	 * aggregate poll has not landed yet. This is where a secret leaked (R1-1).
	 */
	holdAggregate = false,
} = {}) {
	const previousMatchMedia = window.matchMedia;
	if (wide)
		window.matchMedia = (query) => ({
			...shims.matchMedia(query),
			matches: query.includes("min-width: 1100px"),
		});
	const asks = [askRow("a-1111", QUESTION_A), askRow("a-2222", QUESTION_B)];
	seed(asks);
	let firstAggregate = null;
	const reads = { aggregate: 0 };
	const posts = [];
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
						const waiting = asks
							.filter((ask) => ask.status === "open")
							.map(itemFor);
						const items =
							request.source === "notify" || request.op === "notifications.list"
								? notes
								: [];
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
									high_water: 2,
								},
							},
						};
					}
					case "notifications.get": {
						if (request.id === NOTE.id)
							return {
								status: 200,
								body: {
									result: {
										item: {
											...NOTE,
											body_md: `A token: ${LONG_TOKEN}\n\n\`\`\`\nssh -L 8000:localhost:8000 -i ~/.ssh/key.pem ec2-user@16.52.14.1 ${LONG_TOKEN}\n\`\`\``,
										},
										history: [],
										session: NOTE.session,
										anchor: null,
										projects: [],
										asks: [],
									},
								},
							};
						const ask = asks.find((row) =>
							request.id.endsWith(`:${row.ask_id}`),
						);
						/* Core's rule: a SETTLED ask's item is no longer found. */
						if (!ask || ask.status !== "open")
							return { status: 404, body: { detail: "no such notification" } };
						return {
							status: 200,
							body: {
								result: {
									item: itemFor(ask),
									history: [],
									session: itemFor(ask).session,
									anchor: null,
									projects: [],
									asks: structuredClone(asks),
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
						reads.aggregate += 1;
						if (holdAggregate) firstAggregate ??= structuredClone(asks);
						return {
							status: 200,
							body: {
								result: {
									asks: holdAggregate
										? structuredClone(firstAggregate)
										: structuredClone(asks),
								},
							},
						};
					case "sessions.answer": {
						posts.push(request);
						const reply = await answer(posts.length);
						if (reply.status !== 200)
							return {
								status: reply.status,
								body: {
									detail:
										typeof reply.detail === "object"
											? reply.detail
											: (reply.detail ?? "offline"),
								},
							};
						const ask = asks.find((row) => row.ask_id === request.askId);
						if (request.decline) ask.status = "declined";
						else if (request.dismiss) {
							ask.status = "dismissed";
							ask.dismissed_reason = request.dismiss.reason ?? request.dismiss;
						} else {
							ask.status = "answered";
							/* Core's rule: a secret cell is stored as its KEY NAME, never the value. */
							ask.answers = Object.fromEntries(
								Object.entries(request.answers).map(([id, cell]) => [
									id,
									ask.questions.find((q) => q.id === id)?.secret
										? [`[${id.toUpperCase()}]`]
										: cell,
								]),
							);
						}
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
				{ initialEntries: [`/notifications/${encodeURIComponent(openId)}`] },
				h(
					QueryClientProvider,
					{ client },
					surface === "fleet"
						? h(PAGE.FleetAskDrawer, { onClose: () => {} })
						: h(
								Routes,
								null,
								h(Route, {
									path: "/notifications/:notificationId",
									element: h(PAGE.NotificationsPage, { nowMs: NOW }),
								}),
							),
				),
			),
		);
	});
	const pane = () =>
		surface === "fleet"
			? container
			: container.querySelector("[data-notification-detail]");
	const card = (askId) =>
		pane()?.querySelector(`[data-lo-ask-row="${askId}"]`) ?? null;
	const filterText = () =>
		[...(pane()?.querySelectorAll("[data-lo-ask-filter] button") ?? [])].map(
			(node) => node.textContent,
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
	const press = async (node) => {
		await act(async () => {
			node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
		});
	};
	const buttonIn = (scope, label) =>
		[...(scope?.querySelectorAll("button") ?? [])].find(
			(node) => node.textContent.trim() === label,
		) ?? null;
	/* The settled half's one-line rows: `<status word> - <question>` triggers. */
	const settledRows = () =>
		[...(pane()?.querySelectorAll("[data-lo-ask-settled] button") ?? [])].map(
			(node) => node.textContent,
		);
	const unmount = async () => {
		await act(async () => root.unmount());
		/* The aggregate polls; a client left holding it keeps the file's event loop open. */
		client.clear();
		container.remove();
		window.matchMedia = previousMatchMedia;
	};
	return {
		container,
		client,
		reads,
		pane,
		card,
		filterText,
		settledRows,
		settle,
		press,
		buttonIn,
		posts,
		asks,
		unmount,
	};
}
test("reel preserves visible row offset across refresh, then follows the next user scroll", async () => {
	const notes = Array.from({ length: 30 }, (_, i) => ({
		...NOTE,
		id: `n_fixture${i}`,
		seq: 30 - i,
	}));
	const page = await mount({ openId: "not-selected", notes });
	try {
		await page.settle(() =>
			Boolean(page.container.querySelector("[data-notifications-list]")),
		);
		const port = page.container.querySelector("[data-notifications-list]");
		assert.ok(port);
		let shift = 0;
		port.getBoundingClientRect = () => ({ top: 0, bottom: 300, height: 300 });
		const measureRows = () => {
			[...port.querySelectorAll("[data-notification-row]")].forEach(
				(row, i) => {
					row.getBoundingClientRect = () => ({
						top: i * 56 + shift - port.scrollTop,
						bottom: (i + 1) * 56 + shift - port.scrollTop,
						height: 56,
					});
				},
			);
		};
		measureRows();
		const scroll = async (top) => {
			await act(async () => {
				port.scrollTop = top;
				port.dispatchEvent(new window.Event("scroll", { bubbles: true }));
			});
		};
		const refresh = async (delta) => {
			shift += delta;
			await act(async () =>
				page.client.setQueriesData(
					{ queryKey: ["desktop", "notifications", "list"] },
					(data) => {
						if (!data?.pages) return data;
						return {
							...data,
							pages: data.pages.map((p) => ({
								...p,
								items: p.items.map((row) => ({
									...row,
									revision: row.revision + 1,
								})),
							})),
						};
					},
				),
			);
			await page.settle(() => port.scrollTop !== (delta === 80 ? 500 : 700));
		};
		await scroll(500);
		await refresh(80);
		assert.equal(
			port.scrollTop,
			580,
			"refresh keeps the visible row at its previous offset",
		);
		await scroll(700);
		await refresh(24);
		assert.equal(
			port.scrollTop,
			724,
			"the next user scroll replaces the old viewport anchor",
		);
	} finally {
		await page.unmount();
	}
});

for (const surface of ["pane", "fleet"]) {
	for (const holdAggregate of [true, false]) {
		test(
			`R11 ${surface}: revision keeps accepted receipt through sending failure retry (${holdAggregate ? "lagged" : "fresh"} read)`,
			{ timeout: 30_000 },
			async () => {
				let finishRevision;
				const page = await openOnA({
					surface,
					wide: true,
					holdAggregate,
					seed: (asks) =>
						asks[0].questions.push({
							id: "SECRET",
							question: "Synthetic mixed marker",
							secret: true,
							persist: false,
							options: [],
						}),
					answer: (call) =>
						call === 2
							? new Promise((resolve) => {
									finishRevision = resolve;
								})
							: { status: 200 },
				});
				try {
					await chooseFirstOption(page);
					await typeSecret(page.card("a-1111"));
					await page.press(page.buttonIn(page.card("a-1111"), "Send answer"));
					assert.ok(
						await page.settle(() =>
							Boolean(page.buttonIn(page.card("a-1111"), "Change answer")),
						),
					);
					const assertAccepted = (revisionFormLive = false) => {
						assert.deepEqual(page.filterText(), [
							"All · 2",
							"Pending · 1",
							"Settled · 1",
						]);
						assert.equal(page.card("a-1111").dataset.loAskStatus, "answered");
						assert.equal(
							Boolean(page.buttonIn(page.card("a-1111"), "Send answer")),
							false,
						);
						assert.equal(
							page.card("a-1111").textContent.includes(SECRET_VALUE),
							false,
						);
						/* A live failed form keeps its retyped value for Retry/edit;
						 * neither successful acceptance may retain it in state. */
						if (!revisionFormLive)
							assert.equal(
								stateBlob(page.container).includes(SECRET_VALUE),
								false,
								"successful acceptance/revision retires the typed secret",
							);
					};
					assertAccepted();
					await page.press(page.buttonIn(page.card("a-1111"), "Change answer"));
					await page.press(
						page.card("a-1111").querySelectorAll("[data-ask-option]")[1],
					);
					await typeSecret(page.card("a-1111"));
					await page.press(page.buttonIn(page.card("a-1111"), "Update answer"));
					assert.ok(await page.settle(() => page.posts.length === 2));
					assertAccepted(true);
					await act(async () =>
						finishRevision({
							status: 503,
							detail: {
								code: "transport.failed",
								message: "Synthetic interrupted transport",
							},
						}),
					);
					assert.ok(
						await page.settle(() =>
							Boolean(page.buttonIn(page.card("a-1111"), "Retry")),
						),
					);
					assertAccepted(true);
					await page.press(page.buttonIn(page.card("a-1111"), "Retry"));
					assert.ok(
						await page.settle(
							() =>
								page.posts.length === 3 &&
								Boolean(page.buttonIn(page.card("a-1111"), "Change answer")),
						),
					);
					assertAccepted();
					assert.equal(
						page.card("a-1111").textContent.includes("No rotation"),
						true,
					);
					assert.equal(page.posts[2].revise, true);
					assert.equal(page.card("a-2222").dataset.loAskStatus, "open");
				} finally {
					finishRevision?.({ status: 200 });
					await page.unmount();
				}
			},
		);
	}
}

test(
	"R11: owner-closed revision keeps masked receipt and retires the secret form",
	{ timeout: 30_000 },
	async () => {
		const page = await openOnA({
			holdAggregate: true,
			wide: true,
			seed: (asks) =>
				asks[0].questions.push({
					id: "SECRET",
					question: "Synthetic mixed marker",
					secret: true,
					persist: false,
					options: [],
				}),
			answer: (call) =>
				call === 2
					? { status: 409, detail: "already answered by desktop." }
					: { status: 200 },
		});
		try {
			await chooseFirstOption(page);
			await typeSecret(page.card("a-1111"));
			await page.press(page.buttonIn(page.card("a-1111"), "Send answer"));
			assert.ok(
				await page.settle(() =>
					Boolean(page.buttonIn(page.card("a-1111"), "Change answer")),
				),
			);
			await page.press(page.buttonIn(page.card("a-1111"), "Change answer"));
			await typeSecret(page.card("a-1111"));
			await page.press(page.buttonIn(page.card("a-1111"), "Update answer"));
			assert.ok(
				await page.settle(
					() =>
						page.posts.length === 2 &&
						!page.buttonIn(page.card("a-1111"), "Change answer"),
				),
			);
			assert.deepEqual(page.filterText(), [
				"All · 2",
				"Pending · 1",
				"Settled · 1",
			]);
			assert.equal(page.card("a-1111").dataset.loAskStatus, "answered");
			assert.equal(Boolean(page.buttonIn(page.card("a-1111"), "Retry")), false);
			assert.equal(stateBlob(page.container).includes(SECRET_VALUE), false);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"D9 U5: accepted ask keeps its action slot in All without changing truthful counts",
	{ timeout: 30_000 },
	async () => {
		const page = await openOnA({ wide: true, holdAggregate: true });
		try {
			const firstId = () =>
				page.pane().querySelector("[data-lo-ask-row]")?.dataset.loAskRow;
			assert.equal(firstId(), "a-1111");
			await chooseFirstOption(page);
			const send = page.buttonIn(page.card("a-1111"), "Send answer");
			send.focus();
			await page.press(send);
			assert.ok(
				await page.settle(() =>
					Boolean(page.buttonIn(page.card("a-1111"), "Change answer")),
				),
			);
			assert.equal(
				document.activeElement?.closest("[data-lo-ask-row]")?.dataset.loAskRow,
				"a-1111",
				"lost submit focus stays on its own acknowledgement",
			);
			assert.equal(
				firstId(),
				"a-1111",
				"the action slot acknowledges this ask instead of substituting the unrelated pending ask",
			);
			assert.deepEqual(page.filterText(), [
				"All · 2",
				"Pending · 1",
				"Settled · 1",
			]);
			assert.equal(page.card("a-2222").dataset.loAskStatus, "open");
		} finally {
			await page.unmount();
		}
	},
);

const RX_7 = /\s+/;
const RX_NO_ANSWER = /No answer given/;
const BOUNDED = { timeout: 30_000 };
const ITEM_A = `ask:${SESSION}:a-1111`;
/** Open the pane on ask A and wait for both cards. */
async function openOnA(options) {
	const page = await mount({ openId: ITEM_A, ...options });
	assert.ok(
		await page.settle(() => page.card("a-1111") && page.card("a-2222")),
		"the detail pane drew both asks of the conversation",
	);
	return page;
}
/** Choose the first option on ask A's card. */
async function chooseFirstOption(page) {
	const option = page.card("a-1111").querySelector("[data-ask-option]");
	await page.press(option);
}
test(
	"accepted drawer answer settles only its bound reel row before authoritative refresh",
	BOUNDED,
	async () => {
		const page = await openOnA({ wide: true, holdAggregate: true });
		try {
			await chooseFirstOption(page);
			await page.press(page.buttonIn(page.card("a-1111"), "Send answer"));
			assert.ok(
				await page.settle(() =>
					page.container
						.querySelector(`[data-notification-row="${ITEM_A}"]`)
						?.textContent.includes("Answered"),
				),
			);
			const answered = page.container.querySelector(
				`[data-notification-row="${ITEM_A}"]`,
			);
			assert.ok(answered.textContent.includes("Answered"));
			assert.ok(page.card("a-2222").textContent.includes("Queued"));
			assert.ok(
				page.container.querySelector(`[data-notification-row="${NOTE.id}"]`),
			);
			assert.equal(page.posts.length, 1);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"the detail column is width-bounded: min-w-0 and no overflow-x mask",
	BOUNDED,
	async () => {
		const page = await mount({ openId: NOTE.id });
		try {
			assert.ok(
				await page.settle(() =>
					page.pane()?.textContent.includes(LONG_TOKEN.slice(0, 50)),
				),
				"the long body rendered",
			);
			const scroller = page.pane();
			const column = scroller.parentElement;
			const classes = (node) => node.className.split(RX_7);
			assert.ok(
				classes(column).includes("min-w-0"),
				`pane column has min-w-0 (${column.className})`,
			);
			assert.ok(
				classes(column).includes("rounded-md"),
				"pane column wears the panel radius",
			);
			assert.ok(
				classes(scroller).includes("min-w-0"),
				`pane scroller has min-w-0 (${scroller.className})`,
			);
			assert.ok(
				!classes(scroller).includes("overflow-x-hidden"),
				"no overflow-x mask on the scroller",
			);
			assert.ok(
				classes(scroller).includes("[overflow-wrap:anywhere]"),
				"long unbroken text wraps anywhere",
			);
			assert.ok(
				scroller.querySelector(".lo-markdown pre"),
				"the fenced command is a pre block",
			);
		} finally {
			await page.unmount();
		}
	},
);
/*
 * ROUND 1 REMEDIATION. R1-1: a typed SECRET answer must never be painted, held in
 * state or recorded - in the pane OR the fleet drawer - between accept and the next
 * aggregate read. The aggregate is frozen at its first answer so the overlay is the
 * only thing that could paint the answer.
 */
const SECRET_VALUE = "sk-live-9f2c4e1a7b3d";
const secretSeed = (asks) => {
	asks[0].questions = [
		{ id: "edge_key", question: "Paste the edge key", secret: true },
	];
};

/** Every string a React fiber holds in state for the subtree, as one blob. */
const stateBlob = (root) => {
	const seen = new Set();
	const parts = [];
	const walk = (value, depth) => {
		if (depth > 7 || value === null || value === undefined) return;
		if (typeof value === "string") {
			parts.push(value);
			return;
		}
		if (typeof value !== "object" || seen.has(value)) return;
		if (value instanceof window.Node) return;
		seen.add(value);
		for (const key of Object.keys(value)) {
			if (
				key === "_owner" ||
				key === "return" ||
				key === "child" ||
				key === "sibling"
			)
				continue;
			try {
				walk(value[key], depth + 1);
			} catch {
				/* a getter that throws is not state */
			}
		}
	};
	/*
	 * The node's fiber may be the STALE half of React's double buffer (it keeps the
	 * fiber it was created with); the live state is on whichever half the root's
	 * `current` tree reaches.
	 */
	const isCurrent = (fiber) => {
		let top = fiber;
		while (top.return) top = top.return;
		return top.stateNode?.current === top;
	};
	const visit = (node) => {
		const fiberKey = Object.keys(node).find((key) =>
			key.startsWith("__reactFiber$"),
		);
		let start = fiberKey ? node[fiberKey] : null;
		if (start && !isCurrent(start) && start.alternate) start = start.alternate;
		for (let fiber = start; fiber; fiber = fiber.return) {
			for (
				let hook = fiber.memoizedState;
				hook && typeof hook === "object";
				hook = hook.next
			) {
				walk(hook.memoizedState, 0);
				if (!("next" in hook)) break;
			}
		}
	};
	for (const node of root.querySelectorAll("*")) visit(node);
	return parts.join("\n");
};

/** Type into a secret field the way a reader does: React's value setter, then `input`. */
const typeSecret = async (scope, value = SECRET_VALUE) => {
	const field = scope.querySelector("input[data-ask-secret]");
	assert.ok(field, "the secret question has a field");
	const setter = Object.getOwnPropertyDescriptor(
		field instanceof window.HTMLTextAreaElement
			? window.HTMLTextAreaElement.prototype
			: window.HTMLInputElement.prototype,
		"value",
	).set;
	await act(async () => {
		setter.call(field, value);
		field.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
};

test(
	"R1-1 pane: after accept, no DOM node, state or record holds a typed secret",
	BOUNDED,
	async () => {
		const page = await openOnA({ seed: secretSeed, holdAggregate: true });
		try {
			/* Let the first aggregate read land, so the card is not re-keyed mid-typing. */
			await page.settle(() => page.reads.aggregate > 0);
			await page.settle(() => false, 100);
			await typeSecret(page.card("a-1111"));
			let send = page.buttonIn(page.card("a-1111"), "Send answer");
			await page.settle(
				() => !page.buttonIn(page.card("a-1111"), "Send answer")?.disabled,
				1_500,
			);
			const field = page.card("a-1111").querySelector("input[data-ask-secret]");
			send = page.buttonIn(page.card("a-1111"), "Send answer");
			assert.ok(
				send && !send.disabled,
				`Send answer is live after typing (field=${field?.value?.length}, send=${send?.disabled})`,
			);
			await page.press(send);
			assert.ok(
				await page.settle(
					() =>
						page.card("a-1111")?.getAttribute("data-lo-ask-status") ===
						"answered",
				),
				`the secret ask settled in place (posts=${page.posts.length}, status=${page.card("a-1111")?.getAttribute("data-lo-ask-status")})`,
			);
			assert.equal(
				page.posts[0].answers.edge_key[0],
				SECRET_VALUE,
				"the value WAS sent",
			);
			assert.ok(
				!page.container.innerHTML.includes(SECRET_VALUE),
				"no DOM node holds the value",
			);
			assert.ok(
				!stateBlob(page.container).includes(SECRET_VALUE),
				"no React state holds the value",
			);
			assert.ok(
				page.card("a-1111").textContent.includes("[EDGE_KEY]"),
				"the masked key form is painted",
			);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"R1-1 drawer: the fleet drawer's overlay never holds a typed secret either",
	BOUNDED,
	async () => {
		const asks = [askRow("a-1111", QUESTION_A)];
		secretSeed(asks);
		const posts = [];
		let frozen = null;
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
									features: {},
								},
							},
						};
					if (request.op === "asks.list") {
						frozen ??= structuredClone(asks);
						return {
							status: 200,
							body: { result: { asks: structuredClone(frozen) } },
						};
					}
					if (request.op === "sessions.answer") {
						posts.push(request);
						return { status: 200, body: { result: { status: "accepted" } } };
					}
					return {
						status: 404,
						body: { detail: `test bridge: ${request.op}` },
					};
				},
			},
		};
		const container = window.document.createElement("div");
		window.document.body.append(container);
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const root = createRoot(container);
		try {
			await act(async () => {
				root.render(
					h(
						MemoryRouter,
						null,
						h(
							QueryClientProvider,
							{ client },
							h(PAGE.FleetAskDrawer, { onClose: () => {} }),
						),
					),
				);
			});
			const card = () => container.querySelector('[data-lo-ask-row="a-1111"]');
			for (let at = 0; at < 200 && !card(); at += 1)
				await act(
					async () => new Promise((resolve) => setTimeout(resolve, 15)),
				);
			assert.ok(card(), "the drawer drew the secret ask");
			await typeSecret(card());
			const send = [...card().querySelectorAll("button")].find(
				(node) => node.textContent.trim() === "Send answer",
			);
			await act(async () => {
				send.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			});
			for (let at = 0; at < 200 && posts.length === 0; at += 1)
				await act(
					async () => new Promise((resolve) => setTimeout(resolve, 15)),
				);
			await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
			assert.equal(
				posts[0]?.answers.edge_key[0],
				SECRET_VALUE,
				"the value WAS sent",
			);
			assert.ok(
				!container.innerHTML.includes(SECRET_VALUE),
				"no DOM node holds the value",
			);
			assert.ok(
				!stateBlob(container).includes(SECRET_VALUE),
				"no React state holds the value",
			);
		} finally {
			await act(async () => root.unmount());
			client.clear();
			container.remove();
		}
	},
);

test(
	"R1-2 the overlay applies over a timed_out ask, not only an open one",
	BOUNDED,
	() => {
		/*
		 * `timed_out` is outstanding and still takes a dismissal (and core accepts a late
		 * answer), so an accepted act on it must paint at once exactly as on `open`. The
		 * view is what both the pane and the drawer render, so it is asserted directly.
		 */
		const lapsed = { ...askRow("a-1111", QUESTION_A), status: "timed_out" };
		const outcome = {
			sending: false,
			refused: null,
			settled: { status: "dismissed", at: Date.now(), reason: "moot" },
		};
		const view = PAGE.askQueueView(
			{ asks: [lapsed], asks_open: 1 },
			{ "a-1111": outcome },
		);
		const row = view.rows.find((entry) => entry.ask.ask_id === "a-1111");
		assert.equal(
			row.status,
			"dismissed",
			"the accepted dismissal paints over timed_out",
		);
		const untouched = PAGE.askQueueView({ asks: [lapsed], asks_open: 1 }, {});
		assert.equal(
			untouched.rows.find((entry) => entry.ask.ask_id === "a-1111").status,
			"timed_out",
			"without a record the wire's status stands",
		);
	},
);

test(
	"Q-2 a withdrawn ask reads Withdrawn under Settled, never Waiting on an answer",
	BOUNDED,
	async () => {
		const page = await openOnA({
			seed: (asks) => {
				asks.push({
					...askRow("a-3333", "A withdrawn question?"),
					status: "withdrawn",
				});
			},
		});
		try {
			assert.ok(
				await page.settle(() =>
					page
						.settledRows()
						.some((row) => row.includes("A withdrawn question?")),
				),
				`the withdrawn ask is filed under Settled (${JSON.stringify(page.settledRows())})`,
			);
			const row = page
				.settledRows()
				.find((text) => text.includes("A withdrawn question?"));
			assert.ok(row.startsWith("Withdrawn"), `it wears Withdrawn (${row})`);
			assert.ok(!page.pane().textContent.includes("Waiting on an answer"));
			await page.press(
				page
					.pane()
					.querySelector('[data-lo-ask-settled] button[aria-expanded="false"]'),
			);
			const expanded = page.pane().querySelector("[data-lo-ask-settled]");
			assert.equal(
				expanded.textContent.split("A withdrawn question?").length - 1,
				1,
				"the expanded withdrawn context does not repeat its question",
			);
			assert.match(expanded.textContent, RX_NO_ANSWER);
			/* Read after mount: neither the map nor the badge may freeze English at import. */
			for (const [locale, label] of Object.entries({
				fr: "Retirée",
				es: "Retirada",
				"zh-CN": "已撤回",
				ru: "Отозвано",
				vi: "Đã rút lại",
				ur: "واپس لیا گیا",
				hi: "वापस लिया गया",
			})) {
				await act(async () => PAGE.setLocale(locale));
				assert.equal(PAGE.askStatusWord("withdrawn"), label);
				assert.ok(PAGE.ASK_STATUS_COPY.withdrawn.startsWith(label));
				assert.ok(
					await page.settle(() =>
						page
							.settledRows()
							.some(
								(text) =>
									text.startsWith(label) &&
									text.includes("A withdrawn question?"),
							),
					),
					`the mounted Settled row follows ${locale}`,
				);
			}
		} finally {
			await act(async () => PAGE.setLocale("en"));
			await page.unmount();
		}
	},
);

/* R2-1/U1: edits carry only a revision; Retry intentionally keeps its original request. */
for (const surface of ["pane", "fleet"]) {
	for (const mixed of [false, true]) {
		test(
			`R2-1 ${surface}: ${mixed ? "mixed" : "secret-only"} retry keeps original; an edit sends the new secret`,
			BOUNDED,
			async () => {
				const original = "synthetic-original-for-retry";
				const edited = "synthetic-corrected-for-new-send";
				const page = await openOnA({
					surface,
					holdAggregate: true,
					seed: (asks) => {
						const ordinary = asks[0].questions;
						secretSeed(asks);
						if (mixed) asks[0].questions.push(...ordinary);
					},
					answer: (call) =>
						call <= 2
							? {
									status: 503,
									detail: {
										code: "transport.failed",
										message:
											"The backend could not complete this request. Check its connection and try again.",
									},
								}
							: { status: 200 },
				});
				try {
					await page.settle(() => page.reads.aggregate > 0);
					await typeSecret(page.card("a-1111"), original);
					if (mixed) await chooseFirstOption(page);
					await page.press(page.buttonIn(page.card("a-1111"), "Send answer"));
					assert.ok(
						await page.settle(() =>
							page.buttonIn(page.card("a-1111"), "Retry"),
						),
					);
					assert.ok(page.buttonIn(page.card("a-1111"), "Send answer").disabled);
					await page.press(page.buttonIn(page.card("a-1111"), "Retry"));
					assert.ok(
						await page.settle(
							() =>
								page.posts.length === 2 &&
								page.buttonIn(page.card("a-1111"), "Retry"),
						),
					);
					assert.equal(
						page.posts[1].answers.edge_key[0],
						original,
						"unchanged Retry repeats original",
					);
					assert.ok(
						page.buttonIn(page.card("a-1111"), "Send answer").disabled,
						"new failed attempt resets revision baseline",
					);
					await typeSecret(page.card("a-1111"), edited);
					assert.equal(
						page.buttonIn(page.card("a-1111"), "Send answer").disabled,
						false,
						"secret edit re-arms a NEW Send answer",
					);
					assert.equal(
						page.buttonIn(page.card("a-1111"), "Retry"),
						null,
						"a corrected draft cannot resend the superseded request",
					);
					const liveControls = [
						...page
							.card("a-1111")
							.querySelectorAll(
								"button:not([disabled]), input:not([disabled]), textarea:not([disabled])",
							),
					];
					const fieldIndex = liveControls.indexOf(
						page.card("a-1111").querySelector("input[data-ask-secret]"),
					);
					/*
					 * U3: after the field, the first stop that is not one of the card's
					 * own ANSWER controls is the corrected Send answer, never a stale
					 * Retry. In the mixed card the ordinary question's option rows sit
					 * between the field and the actions, so the very next stop is an
					 * option there. Only the secret-only card has Send immediately after.
					 *
					 * Compare a string, never the elements themselves. If `assert.equal`
					 * gets two React-owned jsdom nodes that differ, it builds the failure
					 * by inspecting and diffing their whole object graph (fiber expandos,
					 * the owning document), which runs synchronously. That grew this
					 * process past 3 GB in under a second and was what killed Desktop
					 * Tests shard 2. A string keeps the failure readable at no cost.
					 */
					const ANSWER_CONTROL =
						"[data-ask-option], [data-ask-option-other], [data-ask-secret], [data-ask-other]";
					const nextAction = liveControls
						.slice(fieldIndex + 1)
						.find((node) => !node.matches(ANSWER_CONTROL));
					assert.equal(
						nextAction?.textContent.trim() ?? null,
						"Send answer",
						"the corrected action is the next keyboard stop after the answer fields",
					);
					assert.ok(
						nextAction === page.buttonIn(page.card("a-1111"), "Send answer"),
						"that stop is the card's own Send answer control",
					);
					if (!mixed)
						assert.ok(
							liveControls[fieldIndex + 1] === nextAction,
							"with no other question, Send answer directly follows the field",
						);
					await page.press(page.buttonIn(page.card("a-1111"), "Send answer"));
					assert.ok(
						await page.settle(
							() =>
								page.card("a-1111")?.getAttribute("data-lo-ask-status") ===
								"answered",
						),
					);
					assert.equal(page.posts.length, 3);
					assert.equal(
						page.posts[2].answers.edge_key[0],
						edited,
						"new send carries current secret, not retry snapshot",
					);
					if (mixed)
						assert.deepEqual(
							page.posts[2].answers.q1,
							page.posts[0].answers.q1,
							"ordinary choice survives secret correction",
						);
					assert.equal(page.buttonIn(page.card("a-1111"), "Retry"), null);
					for (const value of [original, edited]) {
						assert.ok(
							!page.container.innerHTML.includes(value),
							"no secret in settled DOM",
						);
						assert.ok(
							!stateBlob(page.container).includes(value),
							"no secret in current hook state after acceptance",
						);
					}
				} finally {
					await page.unmount();
				}
			},
		);
	}
	test(
		`R2-1 ${surface}: failed secret retry stays with its ask; closing clears the form`,
		BOUNDED,
		async () => {
			const seed = (asks) => {
				for (const ask of asks)
					ask.questions = [
						{ id: "edge_key", question: ask.ask_id, secret: true },
					];
			};
			let page = await openOnA({
				surface,
				seed,
				holdAggregate: true,
				answer: (call) =>
					call === 1
						? {
								status: 503,
								detail: {
									code: "transport.failed",
									message:
										"The backend could not complete this request. Check its connection and try again.",
								},
							}
						: { status: 200 },
			});
			try {
				await page.settle(() => page.reads.aggregate > 0);
				await typeSecret(page.card("a-1111"), "synthetic-failed-ask-a");
				await page.press(page.buttonIn(page.card("a-1111"), "Send answer"));
				assert.ok(
					await page.settle(() => page.buttonIn(page.card("a-1111"), "Retry")),
				);
				assert.equal(
					page.buttonIn(page.card("a-2222"), "Retry"),
					null,
					"another ask never inherits the retry closure",
				);
				await typeSecret(page.card("a-2222"), "synthetic-answer-ask-b");
				await page.press(page.buttonIn(page.card("a-2222"), "Send answer"));
				assert.ok(await page.settle(() => page.posts.length === 2));
				assert.equal(page.posts[1].askId, "a-2222");
				assert.equal(
					page.posts[1].answers.edge_key[0],
					"synthetic-answer-ask-b",
				);
			} finally {
				await page.unmount();
			}
			/* Close/cancel the surface, then reopen it: outcomes and secret fields are mount-local. */
			page = await openOnA({ surface, seed, holdAggregate: true });
			try {
				assert.equal(page.buttonIn(page.card("a-1111"), "Retry"), null);
				assert.equal(
					page.card("a-1111").querySelector("input[data-ask-secret]").value,
					"",
				);
				assert.ok(
					!stateBlob(page.container).includes("synthetic-failed-ask-a"),
				);
				assert.equal(
					page.posts.length,
					0,
					"reopening did not replay the old request",
				);
			} finally {
				await page.unmount();
			}
		},
	);
}
