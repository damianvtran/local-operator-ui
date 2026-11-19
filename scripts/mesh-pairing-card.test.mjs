import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, afterEach, beforeEach, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * MESH PAIRING CARDS in the Mesh approvals tray (`features.mesh_pairing`, core PR
 * #4259) - the real components and hook against a real `QueryClient`, with the
 * desktop bridge (requests and the feed) as the only stub; the rig is
 * `phone-pairing.test.mjs`'s. What this guards:
 *
 *  - EVERY CARD STATE from the structured row: inviter stage 1 (code + waiting,
 *    no input, no buttons), joiner awaiting (code + EMPTY input), inviter awaiting
 *    with reduce-only shares, joiner waiting for the other device, a host that
 *    cannot attest (disabled input + terminal fallback), and the time left.
 *  - THE INPUT IS NEVER PRE-FILLED (the row's own code never lands in it), Admit is
 *    disabled until six digits are typed, and Enter in the field answers nothing.
 *  - THE ANSWER: the exact `pairings.answer` request (nonce, code, sorted kept
 *    shares, the card's expiry as the deadline bound); a wrong code keeps the card
 *    with attempts left and clears the field; a provenance refusal says what to do.
 *  - OUTCOMES: a card the read stops serving becomes admitted / declined / expired.
 *  - OFFERS render from `offers.state/items`, never from a sentence, in core's
 *    final one-vocabulary `listed`/`empty` (and a legacy inviter `sent`); the
 *    inviter admits with EXACTLY the items drawn (code review F1).
 *  - ROUND 1 REMEDIATION: confirm-then-answer (US-R1-1), main's static
 *    eligibility disabling the card up front (D1/U1), retryable vs build
 *    refusals (U1), the joiner fallback with `<code>` (U2), focus back after a
 *    wrong code (U3), expired hints (U5), the sent hold (U6), live-only counts
 *    (D4), the badge reading the list before the feed speaks (Q1), "press
 *    Join again" (D6; one joiner verb, U-R3-N1).
 */

const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
});
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// jsdom accessors that refuse to be read out of context.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
globalThis.localStorage = bootstrapDOM.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.CustomEvent = bootstrapDOM.window.CustomEvent;
/*
 * The machine word in the copy follows `navigator.platform` (design round 1, D4:
 * "your Mac" / "your PC" / "your computer"). Node's own `navigator` reports the
 * host OS, so pin it: the same assertions must hold on a Mac and on CI.
 */
const setPlatform = (value) =>
	Object.defineProperty(globalThis.navigator, "platform", {
		value,
		configurable: true,
	});
setPlatform("Linux x86_64");
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

globalThis.__RIG_ENV__ = {
	VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:1",
	VITE_RADIENT_SERVER_BASE_URL: "https://api.example.invalid/v1",
	VITE_RADIENT_CLIENT_ID: "rig",
	VITE_GOOGLE_CLIENT_ID: "rig.apps.googleusercontent.com",
	VITE_MICROSOFT_CLIENT_ID: "00000000-0000-0000-0000-000000000000",
	VITE_MICROSOFT_TENANT_ID: "common",
	VITE_PUBLIC_POSTHOG_KEY: "",
	VITE_PUBLIC_POSTHOG_HOST: "https://us.i.posthog.com",
	VITE_LOG_LEVEL: "info",
};

/** Every request the renderer sent, in order. */
let sent = [];
/** op -> reply or (request) => reply | Promise<reply>; the per-case script. */
let script = {};
/** The feed's subscribers, so a case can publish a frame. */
const feedListeners = new Set();
globalThis.window.api = {
	desktop: {
		request: async (request) => {
			sent.push(request);
			const reply = script[request.op];
			// Main mints a confirmation for every click a person made (the real gate
			// is `mesh-pairing-attest.test.mjs`'s); a case scripts a refusal itself.
			if (!reply && request.op === "pairings.confirm")
				return {
					status: 200,
					body: { result: { confirmation: "c".repeat(64) } },
				};
			if (!reply) return { status: 404, body: { detail: "no script" } };
			return typeof reply === "function" ? reply(request) : reply;
		},
		feed: {
			subscribe: (listener) => {
				feedListeners.add(listener);
				return () => feedListeners.delete(listener);
			},
			watchState: () => () => {},
		},
	},
};

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { MeshPairingCard, MeshPairingSection } from "./src/renderer/src/features/mesh/mesh-pairing-card";
			export { MeshApprovalsTray } from "./src/renderer/src/features/mesh/mesh-approvals-tray";
			export { useMeshPairingTray } from "./src/renderer/src/features/mesh/use-mesh-pairing-tray";
			export * as model from "./src/renderer/src/features/mesh/mesh-pairings";
			export { approvalRows } from "./src/renderer/src/features/mesh/mesh-approvals";
			export { desktopEndpoint } from "./src/shared/desktop-contract";
			export { createElement };
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	external: [
		"react",
		"react-dom",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	packages: "external",
	loader: {
		".css": "empty",
		".png": "empty",
		".svg": "empty",
		".webp": "empty",
	},
	define: { "import.meta.env": "globalThis.__RIG_ENV__" },
	jsx: "automatic",
	write: false,
});
const bundlePath = new URL(
	`./_mesh-pairing-card-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	QueryClient,
	QueryClientProvider,
	MeshPairingCard,
	MeshPairingSection,
	MeshApprovalsTray,
	useMeshPairingTray,
	model,
	approvalRows,
	desktopEndpoint,
	createElement,
} = await import(bundlePath.href);
await unlink(bundlePath);

const ok = (result) => ({ status: 200, body: { result } });
const refuse = (status, detail) => ({ status, body: { detail } });

const NOW = () => Date.now() / 1000;
/** One card row as core #4259 serves it. */
const row = (over = {}) => ({
	id: "joiner:inv_1",
	side: "joiner",
	stage: "awaiting_confirmation",
	invite_id: "inv_1",
	network_id: "net_home",
	network_name: "Home",
	peer_device_id: "dev_studio",
	peer_name: "Studio Mac",
	role: "",
	code: "481926",
	fingerprint: "fp",
	offers: { state: "empty", items: [] },
	expires_at: NOW() + 500,
	seconds_left: 500,
	attempts_left: 3,
	nonce: "n1",
	can_answer_here: true,
	answer_unavailable: "",
	...over,
});
const inviter = (over = {}) =>
	row({
		id: "inviter:inv_1",
		side: "inviter",
		peer_device_id: "dev_laptop",
		peer_name: "Ana's Laptop",
		role: "drive",
		offers: {
			state: "listed",
			items: [
				{ key: "openai", label: "OpenAI key", kind: "api_key", share: true },
				{ key: "github", label: "GitHub token", kind: "token", share: true },
			],
		},
		...over,
	});
const list = (...rows) => ok({ pairings: rows });

let container;
let root;
let client;
beforeEach(() => {
	sent = [];
	script = {};
	feedListeners.clear();
	container = document.createElement("div");
	document.body.append(container);
});
afterEach(async () => {
	await act(async () => root?.unmount());
	root = undefined;
	// A cache entry's garbage-collection timer would otherwise hold the process
	// open for its five-minute default after the last case.
	client?.clear();
	client = undefined;
	container.remove();
	document.body.innerHTML = "";
});

async function render(element) {
	client?.clear();
	client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
			mutations: { retry: false, gcTime: Number.POSITIVE_INFINITY },
		},
	});
	root = createRoot(container);
	await act(async () => {
		root.render(createElement(QueryClientProvider, { client }, element));
	});
	await settle();
	return client;
}

async function settle(rounds = 6) {
	for (let index = 0; index < rounds; index++) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
}

async function until(predicate, label) {
	for (let index = 0; index < 60; index++) {
		if (predicate()) return;
		await settle(1);
	}
	assert.fail(`timed out waiting for ${label}`);
}

/**
 * The same wait in WALL time, for the one thing that moves on a real clock: the
 * list re-read while the person's decision is in flight (the popup's 2 s cadence).
 */
async function untilWall(predicate, label, ms = 6_000) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 100));
		});
	}
	assert.fail(`timed out waiting for ${label}`);
}

async function publish(frame) {
	await act(async () => {
		for (const listener of feedListeners) listener(frame);
	});
	await settle();
}

/** The tray as the Mesh tab mounts it: no approvals rows, the pairing bundle from the hook. */
function Tray() {
	const pairings = useMeshPairingTray(true, new Set());
	return createElement(MeshApprovalsTray, {
		rows: [],
		error: null,
		pending: null,
		refusal: null,
		onDecide: () => {},
		onRetry: () => {},
		nowSeconds: Math.floor(NOW()),
		pairings,
	});
}

const $ = (testId) => document.querySelector(`[data-testid="${testId}"]`);
const card = () =>
	document.querySelector('[data-tour-tag="mesh-pairing-card"]');
const input = () => $("mesh-pairing-code-input");
const admit = () => $("mesh-pairing-admit");
const answers = () =>
	sent.filter((request) => request.op === "pairings.answer");

async function click(element) {
	await act(async () => {
		element.dispatchEvent(
			new window.MouseEvent("click", { bubbles: true, detail: 1 }),
		);
	});
	await settle();
}
async function keyDown(element, key) {
	await act(async () => {
		element.dispatchEvent(
			new window.KeyboardEvent("keydown", { key, bubbles: true }),
		);
	});
	await settle(2);
}
async function type(element, value) {
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	).set;
	await act(async () => {
		setter.call(element, value);
		element.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
	await settle(2);
}

/* ------------------------------------------------------------- the model */

test("the parser keeps answerable rows and drops malformed ones", () => {
	const rows = model.pairingRows({
		pairings: [
			row(),
			row({ code: "12345" }),
			row({ invite_id: "../x" }),
			row({ side: "stranger" }),
			row({ nonce: "bad nonce" }),
		],
	});
	assert.equal(rows.length, 1);
	assert.equal(rows[0].inviteId, "inv_1");
	// A pre-schema-3 row (no nonce) can never be answered here.
	assert.equal(model.parsePairingRow(row({ nonce: "" })).canAnswerHere, false);
});

test("card modes follow side and stage", () => {
	const mode = (over) =>
		model.pairingCardMode(model.parsePairingRow(row(over)));
	assert.equal(
		mode({ side: "inviter", stage: "awaiting_joiner" }),
		"show_code",
	);
	assert.equal(mode({}), "type_code");
	assert.equal(mode({ side: "inviter" }), "type_code");
	assert.equal(mode({ stage: "waiting_for_other_device" }), "waiting_other");
});

test("offers come from the structured state, per side", () => {
	const view = (over) =>
		model.pairingOffersView(model.parsePairingRow(row(over)));
	assert.equal(
		view({ offers: { state: "empty", items: [] } }).sentence,
		"No credentials were offered.",
	);
	assert.match(
		view({ offers: { state: "absent", items: [] } }).sentence,
		/did not offer credentials/,
	);
	assert.equal(
		view({
			offers: {
				state: "listed",
				items: [{ key: "k", label: "Key", share: true }],
			},
		}).kind,
		"list",
	);
	const owner = (offers) =>
		model.pairingOffersView(model.parsePairingRow(inviter({ offers })));
	assert.equal(
		owner({ state: "sent", items: [] }).sentence,
		"Nothing will be shared in this pairing.",
	);
	assert.match(
		owner({ state: "skipped_peer_unsupported", items: [] }).sentence,
		/older version/,
	);
	assert.equal(owner(inviter().offers).editable, true);
	// Core's final vocabulary (#4259 remediation) on the inviter side too.
	assert.equal(
		owner({ state: "empty", items: [] }).sentence,
		"Nothing will be shared in this pairing.",
	);
	assert.equal(
		owner({ state: "listed", items: inviter().offers.items }).kind,
		"list",
	);
	// A legacy inviter `sent` with items still draws its list.
	assert.equal(
		owner({ state: "sent", items: inviter().offers.items }).kind,
		"list",
	);
	// A sentence a newer core might add is never rendered; an unknown inviter
	// state draws "nothing will be shared", which is exactly what it then sends.
	const unknown = owner({
		state: "something_new",
		items: inviter().offers.items,
		sentence: "English!",
	});
	assert.equal(unknown.sentence, "Nothing will be shared in this pairing.");
});

test("kept shares: the offered set minus what was unticked, sorted", () => {
	const inv = model.parsePairingRow(inviter());
	assert.deepEqual(model.pairingShares(inv, new Set()), ["github", "openai"]);
	assert.deepEqual(model.pairingShares(inv, new Set(["openai"])), ["github"]);
	// ONLY what is drawn is shared (code review F1): a state that draws no list
	// shares nothing, whatever items the row carries.
	for (const state of ["empty", "absent", "skipped_peer_unsupported", "new"]) {
		const hidden = model.parsePairingRow(
			inviter({ offers: { state, items: inviter().offers.items } }),
		);
		assert.deepEqual(model.pairingShares(hidden, new Set()), [], state);
	}
	assert.equal(
		model.pairingShares(model.parsePairingRow(row()), new Set()),
		undefined,
	);
});

test("outcomes name how a closed card ended", () => {
	const at = Math.floor(NOW());
	const inv = model.parsePairingRow(inviter());
	const join = model.parsePairingRow(
		row({ stage: "waiting_for_other_device" }),
	);
	assert.equal(
		model.pairingOutcome(inv, { decision: "admit", status: "sent" }, at, false),
		"admitted",
	);
	assert.equal(
		model.pairingOutcome(
			inv,
			{ decision: "decline", status: "refused" },
			at,
			false,
		),
		"declined",
	);
	assert.equal(
		model.pairingOutcome(
			inv,
			{ decision: "admit", status: "spent" },
			at,
			false,
		),
		"spent",
	);
	assert.equal(model.pairingOutcome(join, undefined, at, true), "joined");
	assert.equal(model.pairingOutcome(join, undefined, at, false), "finished");
	assert.equal(
		model.pairingOutcome({ ...inv, expiresAt: at - 5 }, undefined, at, false),
		"expired",
	);
	assert.equal(model.pairingOutcome(inv, undefined, at, false), "ended");
	const folded = model.foldPairingOutcomes({
		previous: [inv],
		rows: [],
		outcomes: [],
		answers: new Map([[inv.id, { decision: "admit", status: "sent" }]]),
		nowMs: Date.now(),
		joinedNetworks: new Set(),
	});
	assert.deepEqual(
		folded.map((o) => o.kind),
		["admitted"],
	);
});

test("refusals map to keyed copy", () => {
	const refusal = (code, detail = {}) => {
		const error = new Error("x");
		error.code = code;
		return model.pairingRefusal(Object.assign(error, { detail }));
	};
	assert.equal(model.pairingRefusal({ code: "sas_mismatch" }).kind, "mismatch");
	assert.equal(refusal("pairing_needs_app").kind, "needs_app");
	assert.equal(refusal("pairing_expired").kind, "expired");
	assert.equal(refusal("no_pending_pairing").kind, "expired");
	assert.equal(refusal("relay_unavailable").kind, "relay");
});

test("the answer op reaches core's route with core's body", () => {
	const endpoint = desktopEndpoint({
		op: "pairings.answer",
		side: "inviter",
		inviteId: "inv_1",
		nonce: "n1",
		decision: "admit",
		code: "481926",
		shares: ["a"],
		deadline: 1_763_500_030,
	});
	assert.equal(endpoint.path, "/v1/desktop/mesh/pairings/inviter/inv_1/answer");
	assert.equal(endpoint.method, "POST");
	assert.deepEqual(endpoint.body, {
		decision: "admit",
		code: "481926",
		nonce: "n1",
		deadline: 1_763_500_030,
		shares: ["a"],
	});
	assert.equal(
		desktopEndpoint({ op: "pairings.list" }).path,
		"/v1/desktop/mesh/pairings",
	);
});

/* ------------------------------------------------------------- the cards */

test("inviter stage 1: its code and the waiting line, no input and no buttons", async () => {
	script["pairings.list"] = list(
		inviter({ stage: "awaiting_joiner", can_answer_here: false }),
	);
	await render(createElement(Tray));
	assert.equal(card().dataset.pairingMode, "show_code");
	assert.equal($("mesh-pairing-local-code").textContent, "481 926");
	assert.match(card().textContent, /Show this code on Ana's Laptop/);
	assert.match(
		card().textContent,
		/Waiting for Ana's Laptop to type this code/,
	);
	assert.equal(input(), null);
	assert.equal(admit(), null);
	assert.equal($("mesh-pairing-decline"), null);
	assert.match(card().textContent, /Ana's Laptop wants to join Home/);
	assert.match(card().textContent, /as drive/);
});

test("joiner awaiting: its own code shown, the input EMPTY, Admit disabled until six digits", async () => {
	script["pairings.list"] = list(row());
	await render(createElement(Tray));
	assert.equal(card().dataset.pairingMode, "type_code");
	assert.equal($("mesh-pairing-local-code").textContent, "481 926");
	assert.match(card().textContent, /Type the code shown on Studio Mac/);
	// NEVER pre-filled: not the row's own code, not anything.
	assert.equal(input().value, "");
	assert.equal(admit().disabled, true);
	await type(input(), "48192");
	assert.equal(admit().disabled, true, "five digits do not enable Admit");
	await type(input(), "481926");
	assert.equal(input().value, "481 926");
	assert.equal(admit().disabled, false);
	// Enter in the field answers nothing.
	await keyDown(input(), "Enter");
	assert.equal(answers().length, 0);
	assert.match(card().textContent, /No credentials were offered\./);
});

test("the joiner's confirm sends the exact request and the card moves to waiting", async () => {
	let listed = list(row());
	script["pairings.list"] = () => listed;
	script["pairings.answer"] = (request) => {
		listed = list(
			row({ stage: "waiting_for_other_device", can_answer_here: false }),
		);
		return ok({ status: "waiting_for_other_device", attempts_left: 3 });
	};
	await render(createElement(Tray));
	await type(input(), "112233");
	await click(admit());
	await until(
		() => card()?.dataset.pairingMode === "waiting_other",
		"waiting card",
	);
	const [sentAnswer] = answers();
	assert.equal(sentAnswer.side, "joiner");
	assert.equal(sentAnswer.inviteId, "inv_1");
	assert.equal(sentAnswer.nonce, "n1");
	assert.equal(sentAnswer.decision, "admit");
	assert.equal(sentAnswer.code, "112233");
	assert.equal("shares" in sentAnswer, false);
	assert.equal(Number.isInteger(sentAnswer.deadline), true);
	assert.match(
		card().textContent,
		/Code matched\. Waiting for Studio Mac to confirm\./,
	);
});

test("a wrong code keeps the card open, says attempts left, and clears the field", async () => {
	script["pairings.list"] = list(inviter());
	script["pairings.answer"] = refuse(409, {
		code: "sas_mismatch",
		message: "that code does not match",
		attempts_left: 2,
	});
	await render(createElement(Tray));
	await type(input(), "000000");
	await click(admit());
	await until(() => $("mesh-pairing-error"), "mismatch error");
	assert.match(
		$("mesh-pairing-error").textContent,
		/doesn't match.*2 attempts left/,
	);
	assert.ok(card(), "card stays open");
	assert.equal(input().value, "", "field cleared for the next attempt");
	assert.equal(input().getAttribute("aria-invalid"), "true");
	assert.equal(admit().disabled, true);
	// The attempts are named once - in the sentence, not again in the meta line.
	assert.equal($("mesh-pairing-attempts"), null);
});

test("inviter awaiting: reduce-only shares; the admit carries the kept set, sorted", async () => {
	script["pairings.list"] = list(inviter());
	script["pairings.answer"] = ok({ status: "sent", attempts_left: 3 });
	await render(createElement(Tray));
	assert.match(card().textContent, /This device will share with Ana's Laptop:/);
	assert.match($("mesh-pairing-attempts").textContent, /3 attempts left/);
	// The shared Checkbox (design D2): a Radix `role="checkbox"` button.
	const boxes = [
		...card().querySelectorAll('[data-testid="mesh-pairing-share"]'),
	];
	assert.equal(boxes.length, 2);
	assert.ok(boxes.every((box) => box.getAttribute("role") === "checkbox"));
	assert.ok(boxes.every((box) => box.getAttribute("aria-checked") === "true"));
	await click(boxes[0]); // untick OpenAI key
	assert.equal(boxes[0].getAttribute("aria-checked"), "false");
	await type(input(), "481926");
	await click(admit());
	await until(() => answers().length === 1, "answer");
	assert.deepEqual(answers()[0].shares, ["github"]);
	assert.equal(answers()[0].decision, "admit");
});

test("a provenance refusal says what to do, keyed", async () => {
	script["pairings.list"] = list(row());
	script["pairings.answer"] = refuse(403, {
		code: "pairing_attest_refused",
		reason: "window_not_focused",
		message:
			"This app could not approve the pairing here (window_not_focused).",
	});
	await render(createElement(Tray));
	await type(input(), "481926");
	await click(admit());
	await until(() => $("mesh-pairing-error"), "refusal");
	// Names the button (design D6): the joiner's is Join, the sheet's verb too
	// (UX review round 3, U-R3-N1).
	assert.equal(admit().textContent, "Join");
	assert.equal(
		$("mesh-pairing-error").textContent,
		"Bring this window to the front and press Join again.",
	);
});

test("a host that cannot attest: code shown, input and buttons disabled, terminal fallback", async () => {
	script["pairings.list"] = list(
		inviter({ can_answer_here: false, answer_unavailable: "unsupported_host" }),
	);
	await render(createElement(Tray));
	assert.equal($("mesh-pairing-local-code").textContent, "481 926");
	assert.equal(input().disabled, true);
	assert.equal(admit().disabled, true);
	assert.equal($("mesh-pairing-decline").disabled, true);
	const fallback = $("mesh-pairing-terminal-fallback");
	assert.match(fallback.textContent, /needs the signed Mac app/);
	assert.match(fallback.textContent, /lop network confirm/);
});

test("decline sends no code and the closed card reads declined", async () => {
	let listed = list(inviter());
	script["pairings.list"] = () => listed;
	script["pairings.answer"] = () => {
		listed = list();
		return ok({ status: "refused", attempts_left: 3 });
	};
	await render(createElement(Tray));
	await click($("mesh-pairing-decline"));
	await until(
		() => document.querySelector("[data-pairing-outcome]"),
		"outcome",
	);
	assert.equal(answers()[0].decision, "decline");
	assert.equal(answers()[0].code, "");
	assert.equal(
		document.querySelector("[data-pairing-outcome]").dataset.pairingOutcome,
		"declined",
	);
	assert.match(
		document.body.textContent,
		/The pairing with Ana's Laptop was declined\./,
	);
});

test("an expired card closes as expired; time left counts down", async () => {
	let listed = list(row({ expires_at: NOW() + 1.5 }));
	script["pairings.list"] = () => listed;
	await render(createElement(Tray));
	assert.match($("mesh-pairing-time-left").textContent, /second/);
	await untilWall(
		() => /expired/.test($("mesh-pairing-time-left")?.textContent ?? ""),
		"lapsed",
		4_000,
	);
	assert.equal(input().disabled, true, "a lapsed card takes no typing");
	listed = list();
	await untilWall(
		() => document.querySelector("[data-pairing-outcome]"),
		"outcome",
		6_000,
	);
	assert.equal(
		document.querySelector("[data-pairing-outcome]").dataset.pairingOutcome,
		"expired",
	);
});

test("no pairings: the tray renders nothing; a read failure says so with Ask again", async () => {
	script["pairings.list"] = list();
	await render(createElement(Tray));
	assert.equal(
		document.querySelector('[data-tour-tag="mesh-approvals-tray"]'),
		null,
	);
	await act(async () => root.unmount());
	root = undefined;
	script["pairings.list"] = refuse(500, {
		code: "store_unavailable",
		message: "nope",
	});
	await render(createElement(Tray));
	assert.match(
		document.body.textContent,
		/Pairing requests could not be read\./,
	);
});

test("the feed naming a card re-reads the list at once", async () => {
	let listed = list();
	script["pairings.list"] = () => listed;
	await render(createElement(Tray));
	assert.equal(card(), null);
	listed = list(row());
	await publish({
		type: "approvals",
		payload: { pending: true, pairing_id: "joiner:inv_1" },
	});
	await until(() => card(), "card after feed frame");
});

/* ------------------------------------------------- round 1 remediation */

const confirms = () =>
	sent.filter((request) => request.op === "pairings.confirm");

test("a click asks main to confirm the EXACT answer, then answers with the same one (US-R1-1, US-R2-1)", async () => {
	script["pairings.list"] = list(row());
	script["pairings.confirm"] = ok({ confirmation: "ab".repeat(32) });
	script["pairings.answer"] = ok({
		status: "waiting_for_other_device",
		attempts_left: 3,
	});
	await render(createElement(Tray));
	await type(input(), "112233");
	await click(admit());
	await until(() => answers().length === 1, "answer");
	const ops = sent
		.map((request) => request.op)
		.filter((op) => op === "pairings.confirm" || op === "pairings.answer");
	assert.deepEqual(ops, ["pairings.confirm", "pairings.answer"]);
	assert.deepEqual(confirms()[0], {
		op: "pairings.confirm",
		side: "joiner",
		inviteId: "inv_1",
		nonce: "n1",
		decision: "admit",
		code: "112233",
	});
	assert.equal(answers()[0].confirmation, "ab".repeat(32));
	// The answer repeats the confirmed answer field for field (main refuses any other).
	const { op: _confirmOp, ...confirmedAnswer } = confirms()[0];
	const {
		op: _answerOp,
		confirmation: _token,
		deadline: _deadline,
		...answered
	} = answers()[0];
	assert.deepEqual(answered, confirmedAnswer);
});

test("a refused confirmation sends no answer and asks for the press again", async () => {
	script["pairings.list"] = list(inviter());
	script["pairings.confirm"] = refuse(403, {
		code: "pairing_attest_refused",
		reason: "no_user_action",
		message: "This app could not approve the pairing here (no_user_action).",
	});
	await render(createElement(Tray));
	await type(input(), "481926");
	await click(admit());
	await until(() => $("mesh-pairing-error"), "refusal");
	assert.equal(answers().length, 0, "nothing answered without a token");
	assert.equal(
		$("mesh-pairing-error").textContent,
		"Bring this window to the front and press Admit again.",
	);
});

test("a stale or foreign confirmation asks for the press again, too", async () => {
	for (const reason of ["no_confirmation", "confirmation_mismatch"]) {
		script = {
			"pairings.list": list(row()),
			"pairings.answer": refuse(403, {
				code: "pairing_attest_refused",
				reason,
				message: `This app could not approve the pairing here (${reason}).`,
			}),
		};
		await render(createElement(Tray));
		await type(input(), "481926");
		await click(admit());
		await until(() => $("mesh-pairing-error"), reason);
		assert.equal(
			$("mesh-pairing-error").textContent,
			"Bring this window to the front and press Join again.",
			reason,
		);
		await act(async () => root.unmount());
		root = undefined;
	}
});

test("main's static ineligibility disables the card UP FRONT with the terminal fallback (D1/U1)", async () => {
	script["pairings.eligibility"] = ok({
		eligible: false,
		reason: "not_packaged",
	});
	script["pairings.list"] = list(row());
	await render(createElement(Tray));
	await until(
		() => $("mesh-pairing-terminal-fallback"),
		"fallback before any typing",
	);
	assert.equal(input().disabled, true);
	assert.equal(admit().disabled, true);
	assert.equal($("mesh-pairing-decline").disabled, true);
	const fallback = $("mesh-pairing-terminal-fallback");
	assert.match(fallback.textContent, /can't approve pairings/);
	// The joiner's command carries its argument (U2).
	assert.equal(
		fallback.querySelector("code").textContent,
		"lop network join --confirm <code>",
	);
	// No "type the six digits" hint on a card that cannot take them.
	assert.equal($("mesh-pairing-hint"), null);
	assert.equal(answers().length + confirms().length, 0);
});

test("a non-macOS launch names the signed Mac app; an unknown eligibility stays answerable", async () => {
	script["pairings.eligibility"] = ok({ eligible: false, reason: "not_macos" });
	script["pairings.list"] = list(inviter());
	await render(createElement(Tray));
	await until(() => $("mesh-pairing-terminal-fallback"), "fallback");
	assert.match(
		$("mesh-pairing-terminal-fallback").textContent,
		/needs the signed Mac app/,
	);
	await act(async () => root.unmount());
	// Unscripted eligibility (a failed read) is unknown: the card stays live.
	script = { "pairings.list": list(row()) };
	root = undefined;
	await render(createElement(Tray));
	// Live once the failed eligibility read settles (pending is not answerable, Q2).
	await until(() => input() && !input().disabled, "card answerable");
	assert.equal(input().disabled, false);
	assert.equal($("mesh-pairing-terminal-fallback"), null);
	assert.match($("mesh-pairing-hint").textContent, /Type the six digits/);
});

test("a listener that did not answer is retryable, never 'a development build' (U1)", async () => {
	for (const reason of ["listener_unavailable", "timeout", "frame_refused"]) {
		script = {
			"pairings.list": list(row()),
			"pairings.answer": refuse(403, {
				code: "pairing_attest_refused",
				reason,
				message: "x",
			}),
		};
		sent = [];
		await act(async () => root?.unmount());
		root = undefined;
		await render(createElement(Tray));
		await type(input(), "112233");
		await click(admit());
		await until(() => $("mesh-pairing-error"), reason);
		assert.match(
			$("mesh-pairing-error").textContent,
			/didn't answer\. Try again\./,
			reason,
		);
		assert.equal($("mesh-pairing-terminal-fallback"), null, reason);
		assert.equal(input().disabled, false, reason);
	}
});

test("a build refusal at the click becomes the fallback block, said once", async () => {
	script["pairings.list"] = list(row());
	script["pairings.answer"] = refuse(403, {
		code: "pairing_attest_refused",
		// The listener refused THIS process: a property of the build.
		reason: "listener_refused",
		message: "x",
	});
	await render(createElement(Tray));
	await type(input(), "112233");
	await click(admit());
	await until(() => $("mesh-pairing-terminal-fallback"), "fallback");
	assert.equal($("mesh-pairing-error"), null, "not repeated as an error line");
	assert.equal(
		$("mesh-pairing-terminal-fallback").querySelector('[role="alert"]')
			?.textContent,
		"This copy of the app can't approve pairings (a development build, or one being driven by a tool). Use the signed app.",
	);
	assert.equal(input().disabled, true);
});

test("a wrong code puts focus back in the field (U3) with the invalid mark (D3)", async () => {
	script["pairings.list"] = list(inviter());
	script["pairings.answer"] = refuse(409, {
		code: "sas_mismatch",
		attempts_left: 2,
	});
	await render(createElement(Tray));
	await type(input(), "000000");
	admit().focus();
	await click(admit());
	await until(() => $("mesh-pairing-error"), "mismatch");
	assert.equal(document.activeElement, input());
	assert.equal(input().getAttribute("aria-invalid"), "true");
	// The shared Input: its invalid and disabled paint come with it.
	assert.match(input().className, /aria-invalid:border-danger/);
	assert.match(input().className, /disabled:bg-sunken/);
});

test("an expired card drops the typing hint for what to do next, per side (D1/U5)", async () => {
	script["pairings.list"] = list(
		row({ expires_at: NOW() - 1 }),
		inviter({ id: "inviter:inv_2", invite_id: "inv_2", expires_at: NOW() - 1 }),
	);
	await render(createElement(Tray));
	const hints = [
		...document.querySelectorAll('[data-testid="mesh-pairing-hint"]'),
	];
	assert.deepEqual(
		hints.map((hint) => hint.textContent),
		[
			"Start a new invite on Studio Mac to try again.",
			"Start a new invite to try again.",
		],
	);
	// An expired card waits on nobody: the header counts no pairing (D4).
	assert.doesNotMatch(document.body.textContent, /waiting/i);
	const joinerClosed = model.pairingOutcomeSentence({
		id: "joiner:inv_1",
		row: model.parsePairingRow(row()),
		kind: "expired",
		at: 0,
	});
	assert.equal(
		joinerClosed,
		"The pairing with Studio Mac expired. Start a new invite on Studio Mac to try again.",
	);
});

test("an accepted answer holds the sent state until the next read lands (U6)", async () => {
	let release;
	let reads = 0;
	script["pairings.list"] = () => {
		reads += 1;
		if (reads === 1) return list(inviter());
		return new Promise((resolve) => {
			release = () => resolve(list(inviter()));
		});
	};
	script["pairings.answer"] = ok({ status: "sent", attempts_left: 3 });
	await render(createElement(Tray));
	await type(input(), "481926");
	await click(admit());
	await until(() => answers().length === 1 && release, "answer + re-read");
	assert.equal(admit().disabled, true, "no second Admit with digits filled");
	assert.equal(admit().textContent, "Checking…");
	await act(async () => release());
	await settle();
	await until(() => admit().textContent === "Admit", "released by the read");
});

test("the badge reads the list before the feed speaks, and counts live cards only (Q1/D4)", async () => {
	function Badge() {
		const count = model.useMeshPairingBadgeCount(true);
		return createElement("output", { "data-testid": "badge" }, String(count));
	}
	// Launch/reload with a pairing ALREADY open: the feed never named it.
	script["pairings.list"] = list(row());
	await render(createElement(Badge));
	await until(
		() => $("badge").textContent === "1",
		"badge lit without a frame",
	);
	assert.equal(sent.filter((r) => r.op === "pairings.list").length >= 1, true);
	// The feed's "none open" stops counting (and reading).
	script["pairings.list"] = list();
	await publish({
		type: "approvals",
		payload: { pending: false, pairing_id: null },
	});
	await until(() => $("badge").textContent === "0", "dark on none");
	// An expired card does not count; a card the feed named counts before the read.
	assert.equal(
		model.pairingBadgeCount(
			[model.parsePairingRow(row({ expires_at: NOW() - 5 }))],
			undefined,
			Math.floor(NOW()),
		),
		0,
	);
	assert.equal(model.pairingBadgeCount(undefined, "joiner:inv_9", 0), 1);
	assert.equal(model.pairingReadWanted(undefined), true);
	assert.equal(model.pairingReadWanted(null), false);
});

/* ------------------------------------------------- round 2 remediation */

test("the badge counts nothing once the feed says none, whatever the read cached (M1)", () => {
	const live = [model.parsePairingRow(row())];
	const now = Math.floor(NOW());
	assert.equal(model.pairingBadgeCount(live, "joiner:inv_1", now), 1);
	assert.equal(model.pairingBadgeCount(live, undefined, now), 1);
	// `null` = "none open": the cached row is the past.
	assert.equal(model.pairingBadgeCount(live, null, now), 0);
});

test("DevTools or a debugger open NOW asks for the press again; it is not a dead end (M2)", async () => {
	for (const reason of ["devtools_open", "debugger_attached", "sheet_open"]) {
		script = {
			"pairings.list": list(row()),
			"pairings.answer": refuse(403, {
				code: "pairing_attest_refused",
				reason,
				message: "x",
			}),
		};
		sent = [];
		await act(async () => root?.unmount());
		root = undefined;
		await render(createElement(Tray));
		await type(input(), "112233");
		await click(admit());
		await until(() => $("mesh-pairing-error"), reason);
		// The window is already in front: name the real fix (U-R3-1).
		assert.equal(
			$("mesh-pairing-error").textContent,
			reason === "sheet_open"
				? "Finish the confirmation that is already open, then press Join again."
				: "Close DevTools and any attached debugger, then press Join again.",
			reason,
		);
		assert.doesNotMatch(
			$("mesh-pairing-error").textContent,
			/Bring this window to the front/,
			reason,
		);
		assert.equal($("mesh-pairing-terminal-fallback"), null, reason);
		assert.equal(input().disabled, false, reason);
		assert.equal(admit().disabled, false, reason);
	}
});

test("while main's eligibility read is pending the card is not answerable yet (Q2)", async () => {
	let answer;
	script["pairings.eligibility"] = () =>
		new Promise((resolve) => {
			answer = resolve;
		});
	script["pairings.list"] = list(inviter());
	await render(createElement(Tray));
	await until(() => input(), "card");
	assert.equal(input().disabled, true, "no live field before main has said");
	assert.equal($("mesh-pairing-decline").disabled, true);
	assert.equal(
		$("mesh-pairing-terminal-fallback"),
		null,
		"unknown is not 'cannot'",
	);
	await act(async () => answer(ok({ eligible: true, reason: null })));
	await until(() => !input().disabled, "answerable once main said yes");
	assert.equal($("mesh-pairing-decline").disabled, false);
});

test("a retry-style refusal puts focus back on the button it names (U7)", async () => {
	const cases = [
		["listener_unavailable", "admit", () => admit()],
		["window_not_focused", "admit", () => admit()],
		["pairing_changed", "admit", () => admit()],
		["no_user_action", "decline", () => $("mesh-pairing-decline")],
		// The round-3 refusals say "press it again" too (U-R3-1).
		["devtools_open", "admit", () => admit()],
		["sheet_open", "decline", () => $("mesh-pairing-decline")],
	];
	for (const [reason, decision, target] of cases) {
		let release;
		script = {
			"pairings.list": list(inviter()),
			"pairings.eligibility": ok({ eligible: true, reason: null }),
			// Held open so the case can drop focus while the button is disabled.
			"pairings.confirm": () =>
				new Promise((resolve) => {
					release = () =>
						resolve(
							refuse(403, {
								code: "pairing_attest_refused",
								reason,
								message: "x",
							}),
						);
				}),
		};
		sent = [];
		await act(async () => root?.unmount());
		root = undefined;
		await render(createElement(Tray));
		await until(() => input() && !input().disabled, "answerable");
		await type(input(), "481926");
		const button = decision === "admit" ? admit() : $("mesh-pairing-decline");
		// A dispatched click moves no focus: focus sits on the body, where
		// Chromium drops it once the pressed button is disabled in flight
		// (jsdom keeps focus on a disabled control, so this is the honest start).
		await click(button);
		await until(() => typeof release === "function", `${reason}: in flight`);
		assert.equal(button.disabled, true, `${reason}: disabled in flight`);
		// `assert.ok`, not `equal`: a failing equal would inspect the whole DOM.
		assert.ok(
			document.activeElement === document.body,
			`${reason}: focus fell to ${document.activeElement?.tagName}`,
		);
		await act(async () => release());
		await settle();
		await until(() => $("mesh-pairing-error"), reason);
		assert.ok(
			document.activeElement === target(),
			`${reason}: focus is on ${document.activeElement?.tagName} ${document.activeElement?.getAttribute?.("data-testid")}`,
		);
		assert.equal(answers().length, 0, reason);
		if (reason === "pairing_changed")
			// The card moved on while the sheet was up: look again, then press Admit.
			assert.equal(
				$("mesh-pairing-error").textContent,
				"This pairing changed while you were answering. Check it and press Admit again.",
			);
	}
});

test("a cancelled native sheet sends nothing, says nothing, and returns focus (US-R2-1, U7)", async () => {
	script["pairings.list"] = list(inviter());
	script["pairings.eligibility"] = ok({ eligible: true, reason: null });
	script["pairings.confirm"] = ok({ confirmation: null, cancelled: true });
	await render(createElement(Tray));
	await until(() => input() && !input().disabled, "answerable");
	await type(input(), "481926");
	// Focus starts on the body (a dispatched click moves none - see U7 above).
	await click(admit());
	await until(() => confirms().length === 1, "confirm");
	await settle();
	assert.equal(answers().length, 0, "nothing answered after a cancel");
	assert.equal($("mesh-pairing-error"), null, "a cancel is not an error");
	assert.equal(admit().disabled, false, "digits kept; answerable again");
	assert.ok(document.activeElement === admit(), "focus back on Admit");
	// The confirm carried the exact answer, shares sorted by the card.
	assert.deepEqual(confirms()[0].shares, ["github", "openai"]);
	assert.equal(confirms()[0].code, "481926");
});

test("a pairing already answered elsewhere closes neutrally (core 409 pairing_answered)", async () => {
	for (const [where, reply] of [
		[
			"core",
			refuse(409, {
				code: "pairing_answered",
				message: "This pairing is no longer open. This answer wasn't recorded.",
			}),
		],
		[
			"main",
			refuse(403, {
				code: "pairing_attest_refused",
				reason: "pairing_closed",
				message: "x",
			}),
		],
	]) {
		script = {
			"pairings.list": list(row()),
			"pairings.eligibility": ok({ eligible: true, reason: null }),
			[where === "core" ? "pairings.answer" : "pairings.confirm"]: reply,
		};
		sent = [];
		await act(async () => root?.unmount());
		root = undefined;
		await render(createElement(Tray));
		await until(() => input() && !input().disabled, "answerable");
		await type(input(), "112233");
		await click(admit());
		await until(() => $("mesh-pairing-error"), where);
		const line = $("mesh-pairing-error");
		assert.equal(
			line.textContent,
			"This pairing is no longer open. This answer wasn't recorded.",
			where,
		);
		assert.equal(
			line.getAttribute("role"),
			"status",
			`${where}: news, not an alarm`,
		);
		assert.doesNotMatch(line.className, /text-danger/, where);
		assert.equal(input().disabled, true, `${where}: nothing left to answer`);
		assert.equal(admit().disabled, true, where);
		assert.equal($("mesh-pairing-terminal-fallback"), null, where);
		// Every control is disabled, so focus goes to the line that says why,
		// never the page body (UX review round 3, U-R3-3).
		assert.equal(line.tabIndex, -1, where);
		assert.ok(
			document.activeElement === line,
			`${where}: focus is on ${document.activeElement?.tagName}`,
		);
	}
});

test("while the native sheet asks, the card claims nothing; after approval it says Checking (U-R3-2)", async () => {
	for (const decision of ["admit", "decline"]) {
		let approve;
		let release;
		script = {
			"pairings.list": list(inviter()),
			"pairings.eligibility": ok({ eligible: true, reason: null }),
			// The sheet stays up until the case approves it.
			"pairings.confirm": () =>
				new Promise((resolve) => {
					approve = () => resolve(ok({ confirmation: "ab".repeat(32) }));
				}),
			"pairings.answer": () =>
				new Promise((resolve) => {
					release = () => resolve(ok({ status: "sent", attempts_left: 3 }));
				}),
		};
		sent = [];
		await act(async () => root?.unmount());
		root = undefined;
		await render(createElement(Tray));
		await until(() => input() && !input().disabled, "answerable");
		await type(input(), "481926");
		const button = () =>
			decision === "admit" ? admit() : $("mesh-pairing-decline");
		await click(button());
		await until(() => typeof approve === "function", `${decision}: sheet up`);
		await settle();
		assert.equal(
			button().textContent,
			"Waiting for confirmation…",
			`${decision}: neutral while the sheet asks`,
		);
		assert.doesNotMatch(button().textContent, /Checking|Declining/);
		await act(async () => approve());
		await until(() => typeof release === "function", `${decision}: answering`);
		await settle();
		assert.equal(
			button().textContent,
			decision === "admit" ? "Checking…" : "Declining…",
			`${decision}: the act is under way only after the sheet's button`,
		);
		await act(async () => release());
		await settle();
	}
});

test("a hairline separates the pairing set from the approvals below it (D7)", async () => {
	const pairings = {
		rows: [model.parsePairingRow(row())],
		outcomes: [],
		loading: false,
		error: null,
		onRetry: () => {},
		nowSeconds: Math.floor(NOW()),
		pending: null,
		refusal: null,
		eligibility: { eligible: true, reason: "" },
		onAnswer: () => {},
	};
	const approvals = approvalRows({
		approvals: [
			{
				approval_id: "ap_2v9k4m0q7r1s",
				state: "requested",
				what: {
					connect: true,
					install: true,
					unattended: true,
					grant: ["approve"],
					network_id: "net_home",
					role: "drive",
				},
				requested_by: { surface: "cli", session_id: "0123456789ef" },
				expires_at: NOW() + 42 * 60,
				device: {
					device_id: "dev_devon",
					name: "devon-laptop",
					host: "devon-laptop.local",
					user: "damian",
					transport: "ssh",
					host_key_fp: "SHA256:9f3cQm2p",
				},
			},
		],
	});
	const tray = (withPairings) =>
		createElement(MeshApprovalsTray, {
			rows: approvals,
			error: null,
			pending: null,
			refusal: null,
			onDecide: () => {},
			onRetry: () => {},
			nowSeconds: Math.floor(NOW()),
			...(withPairings ? { pairings } : {}),
		});
	const live = () =>
		document.querySelector('[data-tour-tag="mesh-approvals-live"]');
	await render(tray(true));
	assert.match(live().className, /border-t/);
	assert.match(live().className, /border-hairline/);
	assert.match(live().className, /pt-3/);
	await act(async () => root.unmount());
	root = undefined;
	await render(tray(false));
	assert.doesNotMatch(live().className, /border-t/);
});
