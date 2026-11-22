import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { act, createElement as h } from "react";

/*
 * The inbound Team Bridge card's body (bridge-body design §4, PR 3).
 *
 * Three layers, each exercised for real rather than through a stand-in:
 * - the desktop request boundary: the Zod union and the HTTP builder together,
 *   so the op this app sends is the route core serves (entry-keyed, GET);
 * - the closed-vocabulary parser and the collapse cut (`bridge-receipt-model`);
 * - the mounted section, against `window.api.desktop.request`, in every state
 *   the card can paint: legacy (capability absent), loading, admitted, long
 *   collapsed/expanded, held, refused, pending, not admitted, unavailable with
 *   and without a reason, malformed/failed reads, and a coalesced card.
 */

const dom = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const key of [
	"window",
	"document",
	"navigator",
	"HTMLElement",
	"Element",
	"Node",
	"SVGElement",
	"Event",
	"MouseEvent",
	"CustomEvent",
	"MutationObserver",
	"localStorage",
])
	Object.defineProperty(globalThis, key, {
		configurable: true,
		value: dom.window[key],
	});
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

const bundled = await build({
	stdin: {
		contents: `
export * from './src/renderer/src/features/chat/components/trace/bridge-receipt-model';
export {BridgeCardBodySection, readBridgeCardBody} from './src/renderer/src/features/chat/components/trace/bridge-card-body';
export * from './src/renderer/src/features/chat/components/trace/bridge-card-reread';
export {desktopEndpoint, desktopRequestSchema} from './src/shared/desktop-contract';
`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	write: false,
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
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
	external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
});
const module = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(
	createRequire(import.meta.url),
	module,
	module.exports,
);
const api = module.exports;

const SESSION = "a1b2c3d4e5f6";
const ENTRY = "e7f8a9b0";

function item(fields) {
	return {
		message_id: "bcmsg_one",
		conversation_id: "bcv_one",
		...fields,
	};
}

// ---------------------------------------------------------------- contract

test("the op is an entry-keyed GET on the pinned route, never a message-id probe", () => {
	const request = api.desktopRequestSchema.parse({
		op: "sessions.bridgeCardBody",
		sessionId: SESSION,
		entryId: ENTRY,
	});
	assert.deepEqual(api.desktopEndpoint(request), {
		path: `/v1/desktop/sessions/${SESSION}/bridge-cards/${ENTRY}/body`,
		method: "GET",
	});
	// No message id, no conversation id, no extra field: the route is keyed by
	// the card's journal entry so the client cannot ask for arbitrary messages.
	for (const extra of [{ messageId: "bcmsg_x" }, { conversation_id: "bcv_x" }])
		assert.equal(
			api.desktopRequestSchema.safeParse({
				op: "sessions.bridgeCardBody",
				sessionId: SESSION,
				entryId: ENTRY,
				...extra,
			}).success,
			false,
		);
	// A path-shaped entry id cannot escape its segment.
	assert.equal(
		api.desktopRequestSchema.safeParse({
			op: "sessions.bridgeCardBody",
			sessionId: SESSION,
			entryId: "../../team-bridge",
		}).success,
		false,
	);
});

// ------------------------------------------------------------------- model

test("parser keeps the server's closed vocabulary and fails closed on anything else", () => {
	const parsed = api.bridgeCardBodyOf({
		result: {
			v: 1,
			items: [
				item({ state: "admitted", body: "**hi**", source: "local" }),
				item({
					message_id: "bcmsg_2",
					state: "held",
					hold: { class: "awaiting_review", held_for_s: 30 },
				}),
				item({ message_id: "bcmsg_3", state: "refused" }),
				item({ message_id: "bcmsg_4", state: "pending" }),
				item({ message_id: "bcmsg_5", state: "not_admitted" }),
				item({
					message_id: "bcmsg_6",
					state: "unavailable",
					reason: "other_account",
				}),
				item({ message_id: "bcmsg_7", state: "quarantined" }),
				item({
					message_id: "bcmsg_8",
					state: "unavailable",
					reason: "made_up",
				}),
				item({ message_id: "bcmsg_9", state: "held", body: "leaked?" }),
				item({ message_id: "bcmsg_10", state: "admitted" }),
				item({ message_id: "bcmsg_11", state: "admitted", body: "   " }),
				{ conversation_id: "bcv_one", state: "admitted", body: "orphan" },
			],
			more: 0,
		},
	});
	assert.deepEqual(
		parsed.items.map((x) => [
			x.messageId,
			x.state,
			x.body ?? null,
			x.reason ?? null,
		]),
		[
			["bcmsg_one", "admitted", "**hi**", null],
			["bcmsg_2", "held", null, null],
			["bcmsg_3", "refused", null, null],
			["bcmsg_4", "pending", null, null],
			["bcmsg_5", "not_admitted", null, null],
			["bcmsg_6", "unavailable", null, "other_account"],
			// An unknown state is unavailable, never a guess.
			["bcmsg_7", "unavailable", null, null],
			// An unknown reason is dropped; the generic sentence stands.
			["bcmsg_8", "unavailable", null, null],
			// A body on a non-admitted item is never shown.
			["bcmsg_9", "held", null, null],
			// Admitted without a body cannot be shown as admitted.
			["bcmsg_10", "unavailable", null, null],
			["bcmsg_11", "unavailable", null, null],
			// An item with no message id is dropped (it cannot be attributed).
		],
	);
	// A bare v1 frame is accepted as well as the `{result}` envelope.
	assert.equal(
		api.bridgeCardBodyOf({ v: 1, items: [], more: 0 }).items.length,
		0,
	);
	for (const bad of [
		null,
		"x",
		{},
		{ v: 2, items: [] },
		{ v: 1, items: "no" },
		{ result: { v: 1 } },
	])
		assert.equal(api.bridgeCardBodyOf(bad), null, JSON.stringify(bad));
});

test("a coalesced card lists at most 20 items and counts the rest into `more`", () => {
	const items = Array.from({ length: 23 }, (_, i) =>
		item({ message_id: `bcmsg_${i}`, state: "admitted", body: `body ${i}` }),
	);
	const parsed = api.bridgeCardBodyOf({ v: 1, items, more: 177 });
	assert.equal(parsed.items.length, api.BRIDGE_CARD_BODY_MAX_ITEMS);
	assert.equal(api.BRIDGE_CARD_BODY_MAX_ITEMS, 20);
	assert.equal(parsed.more, 180);
	for (const more of [-1, 1.5, "3", Number.MAX_SAFE_INTEGER + 2])
		assert.equal(api.bridgeCardBodyOf({ v: 1, items: [], more }).more, 0);
});

test("the collapse cut prefers a reader's boundary and never splits a surrogate pair", () => {
	assert.deepEqual(api.bridgeBodyPreview("short"), {
		text: "short",
		truncated: false,
	});
	const exact = "x".repeat(600);
	assert.equal(api.bridgeBodyPreview(exact).truncated, false);
	const paragraphs = `${"a".repeat(400)}\n\n${"b".repeat(400)}`;
	assert.deepEqual(api.bridgeBodyPreview(paragraphs), {
		text: "a".repeat(400),
		truncated: true,
	});
	const words = `${"word ".repeat(200)}`;
	const cut = api.bridgeBodyPreview(words);
	assert.equal(cut.truncated, true);
	// A cut inside a line ends in "…" so it reads as a cut (#1977 D3).
	assert.ok(cut.text.length <= 601 && cut.text.endsWith("word…"));
	// One unbroken token: hard cut, and an emoji straddling the limit is not split.
	const emoji = `${"x".repeat(599)}😀${"y".repeat(50)}`;
	const hard = api.bridgeBodyPreview(emoji);
	assert.equal(hard.text, `${"x".repeat(599)}…`);
	// A boundary in the first half is ignored (it would hide most of the message).
	const early = `ab ${"z".repeat(700)}`;
	assert.equal(api.bridgeBodyPreview(early).text, `ab ${"z".repeat(597)}…`);
	// A cut at a line break needs no ellipsis: the author ended the line there.
	const lineBreak = `${"c".repeat(400)}\n${"d".repeat(400)}`;
	assert.equal(api.bridgeBodyPreview(lineBreak).text, "c".repeat(400));
});

test("short lines fold by line count even under the character limit (#1977 D3)", () => {
	assert.equal(api.BRIDGE_CARD_BODY_COLLAPSE_LINES, 7);
	const lines = (n) =>
		Array.from({ length: n }, (_, index) => `- step ${index + 1}`).join("\n");
	// 20 short lines, ~200 characters: folded to the first 7, no ellipsis.
	const list = lines(20);
	assert.ok(list.length < 600);
	assert.deepEqual(api.bridgeBodyPreview(list), {
		text: lines(7),
		truncated: true,
	});
	// Exactly 7 lines, or 7 plus trailing blank lines, is whole.
	assert.equal(api.bridgeBodyPreview(lines(7)).truncated, false);
	assert.equal(api.bridgeBodyPreview(`${lines(7)}\n\n  \n`).truncated, false);
	assert.equal(api.bridgeBodyPreview(lines(8)).text, lines(7));
	// Long lines past the character limit before line 7: the character cut wins.
	const wide = Array.from({ length: 10 }, () => "w ".repeat(60).trim()).join(
		"\n",
	);
	const cut = api.bridgeBodyPreview(wide);
	assert.equal(cut.truncated, true);
	assert.ok(cut.text.length <= 600);
	assert.ok(!cut.text.endsWith("…"), "cut at a line break, not mid-line");
});

test("a coalesced card folds past three items only when it hides two or more (#1977 D2)", () => {
	const items = (n) => Array.from({ length: n }, (_, index) => index);
	assert.deepEqual(api.bridgeCardFold(items(3)), {
		shown: items(3),
		hidden: 0,
	});
	// Hiding one row behind a toggle row of the same height saves nothing.
	assert.deepEqual(api.bridgeCardFold(items(4)), {
		shown: items(4),
		hidden: 0,
	});
	assert.deepEqual(api.bridgeCardFold(items(5)), {
		shown: items(3),
		hidden: 2,
	});
	assert.deepEqual(api.bridgeCardFold(items(20)).hidden, 17);
});

// --------------------------------------------------------------- component

async function mount(props, respond) {
	const calls = [];
	window.api = {
		desktop: {
			request: async (request) => {
				calls.push(request);
				return respond(request);
			},
		},
	};
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(h(api.BridgeCardBodySection, props));
	});
	// Let the read settle.
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	return {
		host,
		calls,
		unmount: () => act(() => root.unmount()).then(() => host.remove()),
	};
}

const ok = (result) => () => ({ status: 200, body: { result } });

test("capability absent: today's sentence, and no request at all", async () => {
	const view = await mount(
		{ sessionId: SESSION, entryId: ENTRY, enabled: false },
		ok({ v: 1, items: [item({ state: "admitted", body: "secret" })], more: 0 }),
	);
	assert.equal(view.calls.length, 0);
	assert.equal(view.host.textContent, "Message body unavailable.");
	assert.ok(view.host.querySelector('[data-bridge-body-state="legacy"]'));
	await view.unmount();
});

test("no session (a child or remote transcript) also asks nothing", async () => {
	const view = await mount(
		{ sessionId: null, entryId: ENTRY, enabled: true },
		ok({ v: 1, items: [], more: 0 }),
	);
	assert.equal(view.calls.length, 0);
	assert.equal(view.host.textContent, "Message body unavailable.");
	await view.unmount();
});

test("loading paints a busy line until the read lands", async () => {
	let release;
	const pending = new Promise((resolve) => {
		release = resolve;
	});
	const view = await mount(
		{ sessionId: SESSION, entryId: "loadingentry", enabled: true },
		() => pending,
	);
	const loading = view.host.querySelector('[data-bridge-body-state="loading"]');
	assert.ok(loading);
	assert.equal(loading.getAttribute("aria-busy"), "true");
	assert.equal(loading.textContent, "Loading message…");
	await act(async () => {
		release({
			status: 200,
			body: {
				result: {
					v: 1,
					items: [item({ state: "admitted", body: "done" })],
					more: 0,
				},
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	assert.equal(
		view.host.querySelector('[data-bridge-body-state="loading"]'),
		null,
	);
	assert.ok(view.host.textContent.includes("done"));
	await view.unmount();
});

test("admitted: the body renders as markdown, inertly, with the exact request", async () => {
	const view = await mount(
		{ sessionId: SESSION, entryId: ENTRY, enabled: true },
		ok({
			v: 1,
			items: [
				item({
					state: "admitted",
					body: "Hello **team**\n\n![pixel](http://127.0.0.1:1111/v1/x)\n\n<script>alert(1)</script>",
				}),
			],
			more: 0,
		}),
	);
	assert.deepEqual(view.calls, [
		{ op: "sessions.bridgeCardBody", sessionId: SESSION, entryId: ENTRY },
	]);
	const body = view.host.querySelector('[data-detail-section="bridge-body"]');
	assert.ok(body);
	assert.equal(body.querySelector("strong")?.textContent, "team");
	// Untrusted: an image is text, raw HTML is not an element.
	assert.equal(body.querySelector("img"), null);
	assert.equal(body.querySelector("script"), null);
	assert.equal(view.host.querySelector("[data-bridge-body-toggle]"), null);
	await view.unmount();
});

test("a long body collapses with Show more and expands with Show less", async () => {
	const long = `${"First paragraph sentence. ".repeat(20)}\n\n${"Second paragraph tail. ".repeat(30)}END`;
	const view = await mount(
		{ sessionId: SESSION, entryId: "longentry", enabled: true },
		ok({ v: 1, items: [item({ state: "admitted", body: long })], more: 0 }),
	);
	const toggle = view.host.querySelector("[data-bridge-body-toggle]");
	assert.equal(toggle.textContent, "Show more");
	assert.equal(toggle.getAttribute("aria-expanded"), "false");
	assert.ok(!view.host.textContent.includes("END"));
	await act(async () => {
		toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	assert.ok(view.host.textContent.includes("END"));
	assert.equal(toggle.textContent, "Show less");
	assert.equal(toggle.getAttribute("aria-expanded"), "true");
	await view.unmount();
});

for (const [state, extra, sentence] of [
	[
		"held",
		{ hold: { class: "awaiting_review", held_for_s: 12 } },
		"Held for review.",
	],
	// A transient hold is screening not yet run / delivery unfinished: nobody
	// decided anything, so it must not read as moderation (core #4238 D3/R4).
	[
		"held",
		{ hold: { class: "transient", held_for_s: 3 } },
		"Waiting for screening — not shown to your agent yet.",
	],
	// No class, or one this client does not know, keeps the firm sentence.
	["held", {}, "Held for review."],
	["held", { hold: { class: "later_kind" } }, "Held for review."],
	["refused", {}, "Refused by moderation."],
	["pending", {}, "Waiting to be delivered to your agent."],
	["not_admitted", {}, "Not delivered to this agent."],
	["unavailable", {}, "Message body unavailable."],
	[
		"unavailable",
		{ reason: "other_account" },
		"Message body unavailable. It was received by a different Team Bridge account.",
	],
	[
		"unavailable",
		{ reason: "signed_out" },
		"Message body unavailable. Sign in to Team Bridge to load it.",
	],
	["unavailable", { reason: "deleted" }, "This message was deleted."],
	["unavailable", { reason: "offline" }, "Couldn't reach Radient — retrying."],
]) {
	const variant = extra.reason ?? extra.hold?.class ?? "";
	test(`${state}${variant ? `/${variant}` : ""} says so, never 'unavailable' for a moderation outcome`, async () => {
		const view = await mount(
			{
				sessionId: SESSION,
				entryId: `entry${state}${variant.replaceAll("_", "")}`,
				enabled: true,
			},
			ok({ v: 1, items: [item({ state, ...extra })], more: 0 }),
		);
		const line = view.host.querySelector("[data-bridge-body-state]");
		assert.equal(line.getAttribute("data-bridge-body-state"), state);
		assert.equal(line.textContent, sentence);
		assert.equal(
			view.host.querySelector('[data-detail-section="bridge-body"]'),
			null,
		);
		await view.unmount();
	});
}

for (const [name, respond] of [
	["a refusal status", () => ({ status: 404, body: { detail: "Not Found" } })],
	["a dead transport", () => ({ status: null, body: null })],
	[
		"a thrown transport",
		() => {
			throw new Error("ipc down");
		},
	],
	["a malformed frame", ok({ v: 9, items: [] })],
]) {
	test(`${name} reads as unavailable, not as a moderation state`, async () => {
		const view = await mount(
			{
				sessionId: SESSION,
				entryId: `fail${name.replaceAll(" ", "")}`,
				enabled: true,
			},
			respond,
		);
		const line = view.host.querySelector("[data-bridge-body-state]");
		assert.equal(line.getAttribute("data-bridge-body-state"), "unavailable");
		assert.equal(line.textContent, "Message body unavailable.");
		await view.unmount();
	});
}

test("a coalesced card lists each message and counts the overflow", async () => {
	const items = [
		item({ message_id: "bcmsg_a", state: "admitted", body: "first" }),
		item({ message_id: "bcmsg_b", state: "held" }),
		item({ message_id: "bcmsg_c", state: "admitted", body: "third" }),
	];
	const view = await mount(
		{ sessionId: SESSION, entryId: "coalesced", enabled: true },
		ok({ v: 1, items, more: 7 }),
	);
	const rows = [...view.host.querySelectorAll("[data-bridge-message-id]")];
	assert.deepEqual(
		rows.map((row) => row.getAttribute("data-bridge-message-id")),
		["bcmsg_a", "bcmsg_b", "bcmsg_c"],
	);
	assert.equal(rows[1].textContent, "Held for review.");
	assert.equal(
		view.host.querySelector("[data-bridge-body-more]").textContent,
		"And 7 more messages",
	);
	await view.unmount();
});

test("a many-message card folds behind one Show more and keeps the overflow count for the full list (#1977 D2)", async () => {
	const items = Array.from({ length: 20 }, (_, index) =>
		item({
			message_id: `bcmsg_${index}`,
			state: "admitted",
			body: `body ${index}`,
		}),
	);
	const view = await mount(
		{ sessionId: SESSION, entryId: "coalescedmany", enabled: true },
		ok({ v: 1, items, more: 3 }),
	);
	const ids = () =>
		[...view.host.querySelectorAll("[data-bridge-message-id]")].map((row) =>
			row.getAttribute("data-bridge-message-id"),
		);
	assert.deepEqual(ids(), ["bcmsg_0", "bcmsg_1", "bcmsg_2"]);
	const toggle = view.host.querySelector("[data-bridge-card-toggle]");
	assert.equal(toggle.textContent, "Show more");
	assert.equal(toggle.getAttribute("aria-expanded"), "false");
	// Folded, "And 3 more" would undercount what is hidden, so it waits.
	assert.equal(view.host.querySelector("[data-bridge-body-more]"), null);
	await act(async () => {
		toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	assert.equal(ids().length, 20);
	assert.equal(toggle.textContent, "Show less");
	assert.equal(toggle.getAttribute("aria-expanded"), "true");
	assert.equal(
		view.host.querySelector("[data-bridge-body-more]").textContent,
		"And 3 more messages",
	);
	await act(async () => {
		toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	assert.equal(ids().length, 3);
	await view.unmount();
});

test("a short-line body folds by lines in the rendered card (#1977 D3)", async () => {
	const body = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join(
		"\n\n",
	);
	const view = await mount(
		{ sessionId: SESSION, entryId: "shortlines", enabled: true },
		ok({ v: 1, items: [item({ state: "admitted", body })], more: 0 }),
	);
	const text = () =>
		view.host.querySelector('[data-detail-section="bridge-body"]').textContent;
	assert.ok(text().includes("line 4") && !text().includes("line 5"));
	const toggle = view.host.querySelector("[data-bridge-body-toggle]");
	assert.ok(toggle, "a short-line body under 600 characters still folds");
	await act(async () => {
		toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	assert.ok(text().includes("line 20"));
	await view.unmount();
});

test("two mounts of one card share one in-flight read; a later open reads again", async () => {
	let count = 0;
	const transport = async () => {
		count += 1;
		return { v: 1, items: [item({ state: "admitted", body: "x" })], more: 0 };
	};
	const [a, b] = await Promise.all([
		api.readBridgeCardBody(SESSION, "shared", transport),
		api.readBridgeCardBody(SESSION, "shared", transport),
	]);
	assert.equal(count, 1);
	assert.equal(a, b);
	// Revocation is live: nothing is cached once the read settles.
	await api.readBridgeCardBody(SESSION, "shared", transport);
	assert.equal(count, 2);
});

// ------------------------------------------------- re-reading an open card

/*
 * The operator's report: a card opened while its message was still `pending`
 * said "Still being delivered." forever, because the pane read once per open.
 * These drive the re-read schedule with a fake clock (the `clock` seam) and a
 * scripted transport (the `transport` seam), so every step is deterministic.
 */

function fakeClock() {
	let next = 1;
	const timers = new Map();
	return {
		delays: [],
		setTimeout(run, ms) {
			const id = next++;
			timers.set(id, run);
			this.delays.push(ms);
			return id;
		},
		clearTimeout(id) {
			timers.delete(id);
		},
		get pending() {
			return timers.size;
		},
		/** Fire the one scheduled re-read and let its answer land. */
		async fire() {
			assert.equal(timers.size, 1, "exactly one re-read is scheduled");
			const [[id, run]] = timers;
			timers.delete(id);
			await act(async () => {
				run();
				await new Promise((resolve) => setTimeout(resolve, 0));
			});
		},
	};
}

/** A transport answering from a script; the last answer repeats. */
function scripted(...answers) {
	const calls = [];
	return {
		calls,
		transport: async (input) => {
			calls.push(input);
			const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
			return typeof answer === "function" ? answer() : answer;
		},
	};
}

const frame = (...items) => ({ v: 1, items, more: 0 });

async function mountOpen(entryId, transport, clock) {
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(
			h(api.BridgeCardBodySection, {
				sessionId: SESSION,
				entryId,
				enabled: true,
				transport,
				clock,
			}),
		);
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	return {
		host,
		state: () =>
			[...host.querySelectorAll("[data-bridge-body-state]")].map((node) =>
				node.getAttribute("data-bridge-body-state"),
			),
		unmount: () => act(() => root.unmount()).then(() => host.remove()),
	};
}

test("final vs non-final: only answers that can still change keep the pane reading", () => {
	const of = (...items) => api.bridgeCardBodyOf(frame(...items));
	assert.equal(api.bridgeCardBodyIsFinal(null), false, "a failed read retries");
	for (const [label, read, final] of [
		["pending", of(item({ state: "pending" })), false],
		[
			"held for review",
			of(item({ state: "held", hold: { class: "awaiting_review" } })),
			false,
		],
		[
			"held transient",
			of(item({ state: "held", hold: { class: "transient" } })),
			false,
		],
		["offline", of(item({ state: "unavailable", reason: "offline" })), false],
		[
			"not loaded",
			of(item({ state: "unavailable", reason: "not_loaded" })),
			false,
		],
		["admitted", of(item({ state: "admitted", body: "hi" })), true],
		["refused", of(item({ state: "refused" })), true],
		["not admitted", of(item({ state: "not_admitted" })), true],
		["deleted", of(item({ state: "unavailable", reason: "deleted" })), true],
		[
			"signed out",
			of(item({ state: "unavailable", reason: "signed_out" })),
			true,
		],
		[
			"hub unsupported",
			of(item({ state: "unavailable", reason: "hub_unsupported" })),
			true,
		],
		["unknown future state", of(item({ state: "quarantined" })), true],
		[
			"coalesced, one still pending",
			of(
				item({ state: "admitted", body: "old" }),
				item({ message_id: "bcmsg_new", state: "pending" }),
			),
			false,
		],
	])
		assert.equal(api.bridgeCardBodyIsFinal(read), final, label);
});

test("the backoff is 5 s, 10 s, 20 s, 30 s, then 60 s with no give-up", () => {
	assert.deepEqual(
		Array.from({ length: 8 }, (_, attempt) =>
			api.bridgeCardRereadDelay(attempt),
		),
		[5000, 10000, 20000, 30000, 60000, 60000, 60000, 60000],
	);
	assert.equal(api.bridgeCardRereadDelay(10_000), 60000);
});

test("pending -> admitted while open: the body appears without reopening, then reading stops", async () => {
	const clock = fakeClock();
	const script = scripted(
		frame(item({ state: "pending" })),
		frame(item({ state: "pending" })),
		frame(item({ state: "pending" })),
		frame(item({ state: "pending" })),
		frame(item({ state: "pending" })),
		frame(item({ state: "pending" })),
		frame(item({ state: "admitted", body: "**finally here**" })),
	);
	const view = await mountOpen("rereadadmit", script.transport, clock);
	assert.equal(view.host.textContent, "Waiting to be delivered to your agent.");
	for (let step = 0; step < 6; step += 1) await clock.fire();
	assert.equal(script.calls.length, 7, "one fresh request per re-read");
	assert.deepEqual(clock.delays, [5000, 10000, 20000, 30000, 60000, 60000]);
	assert.deepEqual(view.state(), ["admitted"]);
	assert.equal(view.host.querySelector("strong")?.textContent, "finally here");
	assert.equal(clock.pending, 0, "a final answer schedules nothing");
	await view.unmount();
});

test("a re-read keeps the last answer on screen: no flash back to Loading", async () => {
	const clock = fakeClock();
	let release;
	const slow = new Promise((resolve) => {
		release = resolve;
	});
	const script = scripted(frame(item({ state: "pending" })), () => slow);
	const view = await mountOpen("rereadnoflash", script.transport, clock);
	await clock.fire();
	assert.equal(script.calls.length, 2, "the re-read is in flight");
	assert.deepEqual(view.state(), ["pending"]);
	assert.equal(view.host.querySelector('[aria-busy="true"]'), null);
	await act(async () => {
		release(frame(item({ state: "admitted", body: "landed" })));
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	assert.deepEqual(view.state(), ["admitted"]);
	await view.unmount();
});

test("held for review keeps reading until moderation decides; refused is final", async () => {
	const clock = fakeClock();
	const script = scripted(
		frame(item({ state: "held", hold: { class: "awaiting_review" } })),
		frame(item({ state: "refused" })),
	);
	const view = await mountOpen("rereadrefused", script.transport, clock);
	assert.equal(view.host.textContent, "Held for review.");
	assert.equal(clock.pending, 1);
	await clock.fire();
	assert.equal(view.host.textContent, "Refused by moderation.");
	assert.equal(clock.pending, 0);
	await view.unmount();
});

test("offline says it is retrying, and does: a later read shows the body", async () => {
	const clock = fakeClock();
	const script = scripted(
		frame(item({ state: "unavailable", reason: "offline" })),
		frame(item({ state: "admitted", body: "back online" })),
	);
	const view = await mountOpen("rereadoffline", script.transport, clock);
	assert.equal(view.host.textContent, "Couldn't reach Radient — retrying.");
	await clock.fire();
	assert.ok(view.host.textContent.includes("back online"));
	assert.equal(clock.pending, 0);
	await view.unmount();
});

test("closing the pane stops the schedule and drops a read still in flight", async () => {
	const clock = fakeClock();
	let release;
	const slow = new Promise((resolve) => {
		release = resolve;
	});
	const script = scripted(
		frame(item({ state: "pending" })),
		frame(item({ state: "pending" })),
		() => slow,
	);
	const view = await mountOpen("rereadunmount", script.transport, clock);
	assert.equal(clock.pending, 1);
	await view.unmount();
	assert.equal(clock.pending, 0, "unmount clears the scheduled re-read");

	// Same again with a read in flight at close: its answer lands nowhere.
	const second = await mountOpen("rereadunmount2", script.transport, clock);
	await clock.fire();
	await second.unmount();
	await act(async () => {
		release(frame(item({ state: "pending" })));
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	assert.equal(clock.pending, 0, "a late answer schedules nothing");
});

test("regaining window focus re-reads a waiting pane at once", async () => {
	const clock = fakeClock();
	const script = scripted(
		frame(item({ state: "pending" })),
		frame(item({ state: "admitted", body: "seen on focus" })),
	);
	const view = await mountOpen("rereadfocus", script.transport, clock);
	assert.equal(clock.pending, 1);
	await act(async () => {
		window.dispatchEvent(new window.Event("focus"));
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	assert.equal(script.calls.length, 2);
	assert.ok(view.host.textContent.includes("seen on focus"));
	assert.equal(clock.pending, 0, "the cleared tick is not left behind");
	// Settled: focus again asks nothing.
	await act(async () => {
		window.dispatchEvent(new window.Event("focus"));
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	assert.equal(script.calls.length, 2);
	await view.unmount();
});

test("the open headline's thread-reply marker comes only from the card's anchored thread line", () => {
	const card = (lines) =>
		[
			"Thread reply · #ops · from Aida (agent, same tenant)",
			"mention: no",
			...lines,
		].join("\n");
	assert.equal(
		api.bridgeReceiptOf({}, card(["thread_root_id: bcmsg_0d6a21b5 (reply to)"]))
			.thread,
		true,
	);
	for (const text of [
		"",
		card([]),
		card(["thread_root_id: bcmsg_0d6a21b5"]),
		card(["  thread_root_id: bcmsg_0d6a21b5 (reply to)"]),
		card(["thread_root_id: not-an-id (reply to)"]),
	])
		assert.equal(api.bridgeReceiptOf({}, text).thread, undefined, text);
});
