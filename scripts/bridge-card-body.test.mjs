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
	assert.ok(cut.text.length <= 600 && cut.text.endsWith("word"));
	// One unbroken token: hard cut, and an emoji straddling the limit is not split.
	const emoji = `${"x".repeat(599)}😀${"y".repeat(50)}`;
	const hard = api.bridgeBodyPreview(emoji);
	assert.equal(hard.text, "x".repeat(599));
	// A boundary in the first half is ignored (it would hide most of the message).
	const early = `ab ${"z".repeat(700)}`;
	assert.equal(api.bridgeBodyPreview(early).text.length, 600);
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
		"Held by moderation.",
	],
	// A transient hold is screening not yet run / delivery unfinished: nobody
	// decided anything, so it must not read as moderation (core #4238 D3/R4).
	[
		"held",
		{ hold: { class: "transient", held_for_s: 3 } },
		"Waiting for screening — not shown to your agent yet.",
	],
	// No class, or one this client does not know, keeps the firm sentence.
	["held", {}, "Held by moderation."],
	["held", { hold: { class: "later_kind" } }, "Held by moderation."],
	["refused", {}, "Refused by moderation."],
	["pending", {}, "Still being delivered."],
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
	[
		"unavailable",
		{ reason: "offline" },
		"Couldn't reach Radient — close and reopen to retry.",
	],
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
	assert.equal(rows[1].textContent, "Held by moderation.");
	assert.equal(
		view.host.querySelector("[data-bridge-body-more]").textContent,
		"And 7 more messages",
	);
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
