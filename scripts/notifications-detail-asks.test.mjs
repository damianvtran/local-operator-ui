import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * THE NOTIFICATIONS DETAIL PANE'S ASK CARD, MOUNTED (the stale-card bug).
 *
 * WHY THIS FILE EXISTS. After Send answer / Decline / Dismiss in the detail pane the
 * card kept saying `Queued — the agent is continuing; expires in …` with live options
 * and `Send answer`: the pane recorded only `{sending, refused}`, and its rows are a
 * READ that core stops answering once the ask is settled (`notifications/items.py::
 * detail` keeps only OUTSTANDING ask rows, so the refetch is a 404 and the query keeps
 * the stale `open` rows). Only a mount of the shipped `NotificationsPage` over a bridge
 * that behaves like core can see that, so this renders the page in jsdom at
 * `/notifications/<ask item id>` with a real `QueryClient`.
 *
 * WHAT IS STUBBED: the transport (`window.api.desktop.request`). The detail route 404s
 * a settled ask exactly as core does; `asks.list` (the fleet aggregate, the same
 * durable index) returns settled rows with `delivered`, as core's `index_asks` does.
 * jsdom has no layout, so the overflow case asserts STRUCTURE (`min-w-0` on the pane
 * column and its scroller, no `overflow-x-hidden` mask), not pixels - the pixel
 * measurement is the rendered-frame evidence on the PR.
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
	`./_notifications-detail-asks-${process.pid}.mjs`,
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
async function mount({ openId, answer = () => ({ status: 200 }) } = {}) {
	const asks = [askRow("a-1111", QUESTION_A), askRow("a-2222", QUESTION_B)];
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
								? [NOTE]
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
						return {
							status: 200,
							body: { result: { asks: structuredClone(asks) } },
						};
					case "sessions.answer": {
						posts.push(request);
						const reply = answer(posts.length);
						if (reply.status !== 200)
							return {
								status: reply.status,
								body: { detail: reply.detail ?? "offline" },
							};
						const ask = asks.find((row) => row.ask_id === request.askId);
						if (request.decline) ask.status = "declined";
						else if (request.dismiss) {
							ask.status = "dismissed";
							ask.dismissed_reason = request.dismiss.reason ?? request.dismiss;
						} else {
							ask.status = "answered";
							ask.answers = request.answers;
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
					h(
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
	const pane = () => container.querySelector("[data-notification-detail]");
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
		container.remove();
	};
	return {
		container,
		client,
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

const RX_1 = /Answered/;
const RX_2 = /expires in/;
const RX_3 = /Rotate after the leaks close/;
const RX_4 = /Answered — delivering/;
const RX_5 = /no longer needed|moot/i;
const RX_6 = /Dismissed — (no longer needed|settled in chat)/;
const RX_7 = /\s+/;
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
	"Send answer settles the card in place and moves it Pending → Settled",
	BOUNDED,
	async () => {
		const page = await openOnA();
		try {
			assert.deepEqual(page.filterText(), [
				"All · 2",
				"Pending · 2",
				"Settled · 0",
			]);
			await chooseFirstOption(page);
			await page.press(page.buttonIn(page.card("a-1111"), "Send answer"));
			assert.ok(
				await page.settle(
					() =>
						page.card("a-1111")?.getAttribute("data-lo-ask-status") ===
						"answered",
				),
				`card A reads answered (status=${page.card("a-1111")?.getAttribute("data-lo-ask-status")}, text=${page.card("a-1111")?.textContent})`,
			);
			assert.equal(page.posts.length, 1);
			assert.deepEqual(page.posts[0].answers, {
				q1: ["Rotate after the leaks close"],
			});
			const a = page.card("a-1111").textContent;
			assert.match(a, RX_1);
			assert.doesNotMatch(a, RX_2, "no countdown on an answered card");
			assert.equal(
				page.buttonIn(page.card("a-1111"), "Send answer"),
				null,
				"no Send answer on an answered card",
			);
			assert.match(a, RX_3, "the card shows the chosen option");
			/* Two near-identical asks: B stays pending and answerable. */
			assert.equal(
				page.card("a-2222").getAttribute("data-lo-ask-status"),
				"open",
			);
			assert.ok(page.buttonIn(page.card("a-2222"), "Send answer"));
			/*
			 * AN UNDELIVERED ANSWER IS STILL PENDING (design §10, `askPanelHalves`): the
			 * drawer files it there too, and it moves to Settled once delivered - pinned by
			 * the delivered test below.
			 */
			assert.match(a, RX_4);
			/* The item stays selected: the pane is still on ask A after the refetch 404s. */
			await page.settle(() => false, 400);
			assert.ok(page.pane(), "the detail pane stays open on the answered item");
			assert.equal(
				page.card("a-1111")?.getAttribute("data-lo-ask-status"),
				"answered",
			);
		} finally {
			await page.unmount();
		}
	},
);

test("Decline settles the card as Declined", BOUNDED, async () => {
	const page = await openOnA();
	try {
		await page.press(page.buttonIn(page.card("a-1111"), "Decline"));
		assert.ok(
			await page.settle(() =>
				page.settledRows().some((row) => row.startsWith("Declined")),
			),
			`ask A is filed as Declined (${JSON.stringify(page.settledRows())})`,
		);
		assert.equal(page.posts[0].decline, true);
		assert.ok(
			page.settledRows()[0].includes(QUESTION_A),
			"the settled row names ask A's question",
		);
		assert.equal(
			page.card("a-2222").getAttribute("data-lo-ask-status"),
			"open",
			"ask B stays pending",
		);
		assert.deepEqual(page.filterText(), [
			"All · 2",
			"Pending · 1",
			"Settled · 1",
		]);
	} finally {
		await page.unmount();
	}
});

test(
	"Dismiss settles the card as Dismissed with its reason",
	BOUNDED,
	async () => {
		const page = await openOnA();
		try {
			await page.press(page.buttonIn(page.card("a-1111"), "Dismiss…"));
			const reason =
				page
					.card("a-1111")
					.querySelector(
						"[data-lo-ask-dismiss-reason], [data-dismiss-reason]",
					) ??
				[...page.card("a-1111").querySelectorAll("button")].find((node) =>
					RX_5.test(node.textContent),
				);
			assert.ok(
				reason,
				`a dismissal reason is offered (${page.card("a-1111").textContent})`,
			);
			await page.press(reason);
			assert.ok(
				await page.settle(() =>
					page.settledRows().some((row) => row.startsWith("Dismissed")),
				),
				`ask A is filed as Dismissed (${JSON.stringify(page.settledRows())})`,
			);
			assert.ok(page.posts[0].dismiss, "the POST carried the dismissal");
			assert.ok(
				page.settledRows()[0].includes(QUESTION_A),
				"the settled row names ask A's question",
			);
			assert.equal(
				page.card("a-2222").getAttribute("data-lo-ask-status"),
				"open",
				"ask B stays pending",
			);
			/* The reason is the expanded card's status line, as on the drawer's PR-4c wire. */
			await page.press(
				page.pane().querySelector("[data-lo-ask-settled] button"),
			);
			assert.match(page.card("a-1111")?.textContent ?? "", RX_6);
			assert.deepEqual(page.filterText(), [
				"All · 2",
				"Pending · 1",
				"Settled · 1",
			]);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"a transport failure shows the error with Retry, keeps the choice, and Retry lands",
	BOUNDED,
	async () => {
		const page = await openOnA({
			answer: (call) =>
				call === 1
					? { status: 503, detail: "The local server did not answer." }
					: { status: 200 },
		});
		try {
			await chooseFirstOption(page);
			await page.press(page.buttonIn(page.card("a-1111"), "Send answer"));
			assert.ok(
				await page.settle(() =>
					page.card("a-1111")?.querySelector("[data-lo-ask-refused]"),
				),
				"the failure is drawn in the card",
			);
			const card = page.card("a-1111");
			assert.equal(
				card.getAttribute("data-lo-ask-status"),
				"open",
				"never a silent settle",
			);
			const retry = page.buttonIn(
				card.querySelector("[data-lo-ask-refused]"),
				"Retry",
			);
			assert.ok(retry, "Retry is offered for a transport failure");
			assert.equal(
				card
					.querySelector('[data-ask-option="Rotate after the leaks close"]')
					?.getAttribute("aria-checked"),
				"true",
				"the chosen option is preserved across the failure",
			);
			await page.press(retry);
			assert.ok(
				await page.settle(
					() =>
						page.card("a-1111")?.getAttribute("data-lo-ask-status") ===
						"answered",
				),
				"Retry sends the same answer and the card settles",
			);
			assert.equal(page.posts.length, 2);
			assert.deepEqual(
				page.posts[1].answers,
				page.posts[0].answers,
				"Retry re-sent the same map",
			);
			assert.equal(
				page.card("a-1111").querySelector("[data-lo-ask-refused]"),
				null,
			);
		} finally {
			await page.unmount();
		}
	},
);

test(
	"the aggregate's delivered row moves the card from delivering to Answered",
	BOUNDED,
	async () => {
		const page = await openOnA();
		try {
			await chooseFirstOption(page);
			await page.press(page.buttonIn(page.card("a-1111"), "Send answer"));
			assert.ok(
				await page.settle(() =>
					RX_4.test(page.card("a-1111")?.textContent ?? ""),
				),
				"first the accepted-but-undelivered state",
			);
			/* Core marks it delivered; the aggregate (which the pane now reads) carries it. */
			page.asks[0].delivered = true;
			await act(async () => {
				await page.client.invalidateQueries({ queryKey: ["desktop", "asks"] });
			});
			assert.ok(
				await page.settle(() =>
					page.settledRows().some((row) => row.startsWith("Answered")),
				),
				`delivered, ask A moves to Settled (${JSON.stringify(page.settledRows())})`,
			);
			assert.deepEqual(page.filterText(), [
				"All · 2",
				"Pending · 1",
				"Settled · 1",
			]);
			/* Two near-identical asks: the settled row names its question AND its answer. */
			const settled = page.pane().querySelector("[data-lo-ask-settled]");
			assert.ok(settled.textContent.includes(QUESTION_A));
			assert.ok(
				!settled.textContent.includes(QUESTION_B),
				"ask B is not the settled one",
			);
			assert.match(
				settled.querySelector("[data-lo-ask-settled-answer]")?.textContent ??
					"",
				RX_3,
			);
			assert.equal(
				page.card("a-2222").getAttribute("data-lo-ask-status"),
				"open",
			);
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
