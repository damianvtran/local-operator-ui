import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, afterEach, beforeEach, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * PHONE PAIRING BY APPROVAL (local-operator #3949 `features.phone_pairing`,
 * #3950 `features.operator_setup`; pairing design v2 §4.2) - the shell-mounted
 * pairing popup and Settings → Paired phones.
 *
 * Same rig as `phone-access-remedies.test.mjs`: the real components against a
 * real `QueryClient`, with the desktop bridge (requests and the feed) as the only
 * stub. What this guards:
 *
 *  - CAPABILITY ABSENT IS TODAY'S UI: no popup, no Settings rows, and no request
 *    beyond the capabilities read.
 *  - EVERY CARD STATE: attested confirm, typed entry, wrong code with tries left,
 *    three strikes, signing, admin prompt open, paired, denied, expired, withdrawn,
 *    busy, and "not set up yet" with Turn on phone approvals.
 *  - THE SECURITY RULES: no digits on a typed card, the phone's name as inert
 *    text with bidi controls stripped and a clamp with its full form on demand,
 *    no focus taken on appearance, and no approval from an Enter that did not
 *    go down on Approve itself.
 *  - THE FEED DRIVES IT: a frame naming no live pairing removes the card.
 *  - PAIRED PHONES: list, empty, removing, remove with its dialog, 404.
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
			export { PhonePairingHost, PairingPopupView } from "./src/renderer/src/features/phone-pairing/pairing-popup";
			export { PhonePairingSettings } from "./src/renderer/src/features/phone-pairing/paired-phones-section";
			export * as model from "./src/renderer/src/features/phone-pairing/pairing-model";
			export { desktopEndpoint, desktopRequestSchema, desktopRequestDeadlineMs } from "./src/shared/desktop-contract";
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
	`./_phone-pairing-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	QueryClient,
	QueryClientProvider,
	PhonePairingHost,
	PhonePairingSettings,
	model,
	desktopEndpoint,
	desktopRequestSchema,
	desktopRequestDeadlineMs,
	createElement,
} = await import(bundlePath.href);
await unlink(bundlePath);

const ok = (result) => ({ status: 200, body: { result } });
const refuse = (status, code, text = "refused") => ({
	status,
	body: { detail: { code, text } },
});
const caps = (features) =>
	ok({
		desktop_contract: 1,
		desktop_available: true,
		desktop_auth: "bearer",
		features,
	});
const PAIRING = { approvals: 1, phone_pairing: 1 };

const ID = "ap_0123456789abcdef";
const DIGEST_R = `sha256:${"a".repeat(64)}`;
const DIGEST_D = `sha256:${"b".repeat(64)}`;
const GESTURE =
	"Your Mac will ask for Touch ID or its login password — that's your Mac confirming, not your Radient password.";

/** One `pair_phone` approvals row as core #3949 serves it. */
const pairRow = (pairing = {}, over = {}) => ({
	approval_id: ID,
	kind: "operator_device_pair",
	state: "requested",
	...over,
	pairing: {
		mode: "confirm",
		phone_name: "Ana's iPhone",
		phone_name_full: "Ana's iPhone",
		platform: "ios",
		key_fingerprint: "fp",
		sas: "482913",
		expires_at: Date.now() / 1000 + 240,
		progress: "waiting",
		reason: "waiting",
		tries_left: 3,
		account: "acct_owner",
		account_email: null,
		request_digest: DIGEST_R,
		disclosure_digest: DIGEST_D,
		assurance: "presence",
		gesture: GESTURE,
		...pairing,
	},
});
const typedRow = (pairing = {}, over = {}) =>
	pairRow({ mode: "code", sas: null, account: null, ...pairing }, over);
const list = (...rows) => ok({ approvals: rows });

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

const $ = (testId) => document.querySelector(`[data-testid="${testId}"]`);
const popup = () => $("phone-pairing-popup");
const ops = () => sent.map((request) => request.op);

async function click(element, { keyboard = false } = {}) {
	await act(async () => {
		element.dispatchEvent(
			new window.MouseEvent("click", {
				bubbles: true,
				detail: keyboard ? 0 : 1,
			}),
		);
	});
	await settle();
}

async function keyDown(element, key, init = {}) {
	await act(async () => {
		element.dispatchEvent(
			new window.KeyboardEvent("keydown", { key, bubbles: true, ...init }),
		);
	});
}

async function type(input, value) {
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	).set;
	await act(async () => {
		setter.call(input, value);
		input.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
	await settle(2);
}

async function publish(frame) {
	await act(async () => {
		for (const listener of feedListeners) listener(frame);
	});
	await settle();
}

/* ------------------------------------------------------------- the model */

test("model: a typed (custom-route) card never carries digits, whatever the row says", () => {
	const card = model.parsePairingRow(typedRow({ sas: "482913" }));
	assert.equal(card.mode, "code");
	assert.equal(card.sas, null);
	assert.equal(model.parsePairingRow(pairRow()).sas, "482913");
});

test("model: undescribable rows are dropped, not guessed at", () => {
	assert.equal(model.parsePairingRow(pairRow({ reason: "new_reason" })), null);
	assert.equal(
		model.parsePairingRow(pairRow({ request_digest: "sha256:x" })),
		null,
	);
	assert.equal(model.parsePairingRow(pairRow({ mode: "other" })), null);
	assert.equal(
		model.parsePairingRow(pairRow({}, { approval_id: "../x" })),
		null,
	);
	assert.equal(
		model.parsePairingRow({ approval_id: ID, state: "requested" }),
		null,
	);
	assert.deepEqual(
		model.pairingCards({ approvals: [pairRow(), { nope: 1 }] }).length,
		1,
	);
});

test("model: the phone's name loses bidi and invisible characters and is clamped", () => {
	assert.equal(model.displayPhoneName("Ana\u202Eenohp\u200B"), "Anaenohp");
	const long = "x".repeat(80);
	const clamped = model.displayPhoneName(long);
	assert.equal([...clamped].length, model.PHONE_NAME_DISPLAY_CHARS);
	assert.ok(clamped.endsWith("…"));
	// The zero-width joiner holds an emoji sequence together and is kept.
	assert.equal(model.displayPhoneName("👩\u200D💻"), "👩\u200D💻");
});

test("model: the live card is the one the feed names, else the newest live row", () => {
	const other = "ap_0123456789abcdeg";
	const cards = model.pairingCards({
		approvals: [pairRow(), pairRow({}, { approval_id: other })],
	});
	assert.equal(model.livePairingCard(cards, ID).approvalId, ID);
	assert.equal(model.livePairingCard(cards, undefined).approvalId, other);
	const settled = model.pairingCards({
		approvals: [pairRow({ reason: "paired" })],
	});
	assert.equal(model.livePairingCard(settled, undefined), null);
});

test("model: Paired phones hides revoked rows and ids core would refuse", () => {
	const phones = model.pairedPhones({
		devices: [
			{
				device_id: "abc123",
				name: "Ana",
				platform: "ios",
				paired_at: 1,
				last_seen: null,
				push: true,
				state: "paired",
			},
			{
				device_id: "dead00",
				name: "Old",
				platform: "",
				paired_at: null,
				last_seen: null,
				push: false,
				state: "revoked",
			},
			{ device_id: "../x", name: "Bad", platform: "", state: "paired" },
			{
				device_id: "beef01",
				name: "Half",
				platform: "android",
				state: "removing",
			},
		],
	});
	assert.deepEqual(
		phones.map((phone) => [phone.deviceId, phone.state]),
		[
			["abc123", "paired"],
			["beef01", "removing"],
		],
	);
});

/* ---------------------------------------------------------- the contract */

test("contract: pair-ack, devices and setup reach core's exact routes", () => {
	const ack = {
		op: "approvals.pairAck",
		approvalId: ID,
		requestDigest: DIGEST_R,
		disclosureDigest: DIGEST_D,
	};
	assert.deepEqual(desktopEndpoint(desktopRequestSchema.parse(ack)), {
		path: `/v1/desktop/approvals/${ID}/pair-ack`,
		method: "POST",
		body: { request_digest: DIGEST_R, disclosure_digest: DIGEST_D },
	});
	assert.deepEqual(
		desktopEndpoint(desktopRequestSchema.parse({ ...ack, code: "482913" }))
			.body,
		{ request_digest: DIGEST_R, disclosure_digest: DIGEST_D, code: "482913" },
	);
	assert.deepEqual(desktopEndpoint({ op: "devices.list" }), {
		path: "/v1/desktop/devices",
		method: "GET",
	});
	assert.deepEqual(
		desktopEndpoint({ op: "devices.remove", deviceId: "abc123" }),
		{
			path: "/v1/desktop/devices/abc123",
			method: "DELETE",
		},
	);
	assert.throws(() =>
		desktopRequestSchema.parse({ op: "devices.remove", deviceId: "../etc" }),
	);
	assert.deepEqual(desktopEndpoint({ op: "operator.setup.run" }), {
		path: "/v1/desktop/operator/setup",
		method: "POST",
		body: {},
	});
	const approve = desktopRequestSchema.parse({
		op: "approvals.approveOperation",
		approvalId: ID,
		operation: "pair_phone",
		requestDigest: DIGEST_R,
		disclosureDigest: DIGEST_D,
	});
	assert.equal(
		desktopEndpoint(approve).path,
		`/v1/desktop/approvals/${ID}/approve-operation`,
	);
	// The pairing's signature waits on Touch ID and the admin prompt: the gesture
	// budget, while a profile_save approve keeps the control budget it had.
	assert.ok(
		desktopRequestDeadlineMs(approve) >
			desktopRequestDeadlineMs({ ...approve, operation: "profile_save" }),
	);
	assert.equal(
		desktopRequestDeadlineMs(approve),
		desktopRequestDeadlineMs("approvals.approve"),
	);
});

/* ------------------------------------------------------------- the popup */

test("capability absent: no popup and no approvals read", async () => {
	script = {
		capabilities: caps({ approvals: 1 }),
		"approvals.list": list(pairRow()),
	};
	await render(createElement(PhonePairingHost));
	await settle();
	assert.equal(popup(), null);
	assert.deepEqual(ops(), ["capabilities"]);
});

test("attested request: the code as hero, read digit by digit, and no focus taken", async () => {
	const composer = document.createElement("textarea");
	document.body.append(composer);
	composer.focus();
	script = { capabilities: caps(PAIRING), "approvals.list": list(pairRow()) };
	await render(createElement(PhonePairingHost));
	await until(() => popup(), "the popup");
	assert.equal(popup().getAttribute("aria-modal"), "false");
	assert.match(popup().textContent, /A phone wants to pair with this computer/);
	assert.equal($("pairing-sas").textContent, "482 913");
	assert.equal(
		$("pairing-sas").getAttribute("aria-label"),
		"Code: 4 8 2 9 1 3",
	);
	assert.equal($("pairing-approve").textContent, "Codes match — Approve");
	assert.ok($("pairing-attested"));
	assert.match($("pairing-expires").textContent, /Expires in [34]:\d\d/);
	assert.equal($("pairing-gesture").textContent, GESTURE);
	assert.equal($("pairing-platform").textContent, "iPhone");
	assert.equal(
		document.activeElement,
		composer,
		"the composer keeps the caret",
	);
	composer.remove();
});

test("attacker-controlled name renders as inert, isolated, clamped text", async () => {
	const hostile = `<img src=x onerror=alert(1)>\u202Egnp.exe ${"A".repeat(40)}`;
	script = {
		capabilities: caps(PAIRING),
		"approvals.list": list(
			pairRow({
				phone_name: model.displayPhoneName(hostile),
				phone_name_full: model.displayPhoneName(hostile, 64),
			}),
		),
	};
	await render(createElement(PhonePairingHost));
	await until(() => popup(), "the popup");
	const name = $("pairing-phone-name");
	assert.equal(name.tagName, "BDI");
	assert.equal(popup().querySelector("img"), null, "no markup from the name");
	assert.ok(!name.textContent.includes("\u202E"));
	assert.ok(name.textContent.endsWith("…"));
	assert.equal(name.getAttribute("title"), model.displayPhoneName(hostile, 64));
	await click($("pairing-name-toggle"));
	assert.equal(
		$("pairing-phone-name").textContent,
		model.displayPhoneName(hostile, 64),
	);
	assert.equal($("pairing-name-toggle").getAttribute("aria-expanded"), "true");
});

test("confirm approve: pair-ack without a code, then the pair_phone signature; signing, admin prompt, paired", async () => {
	let finish;
	let rows = [pairRow()];
	script = {
		capabilities: caps(PAIRING),
		"approvals.list": () => list(...rows),
		"approvals.pairAck": ok({
			approval_id: ID,
			acked: true,
			mode: "confirm",
			progress: "signing",
		}),
		"approvals.approveOperation": () =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	};
	await render(createElement(PhonePairingHost));
	await until(() => $("pairing-approve"), "Approve");
	await click($("pairing-approve"));
	await until(() => $("pairing-progress"), "the signing line");
	assert.match($("pairing-progress").textContent, /Confirm on your computer/);
	assert.equal($("pairing-gesture").textContent, GESTURE);
	const ack = sent.find((request) => request.op === "approvals.pairAck");
	assert.deepEqual(ack, {
		op: "approvals.pairAck",
		approvalId: ID,
		requestDigest: DIGEST_R,
		disclosureDigest: DIGEST_D,
	});
	const approve = sent.find(
		(request) => request.op === "approvals.approveOperation",
	);
	assert.equal(approve.operation, "pair_phone");
	// Core records the admit step while the OS prompt is up.
	rows = [
		pairRow(
			{ reason: "admin_prompt_open", progress: "admin_prompt_open" },
			{ state: "connecting" },
		),
	];
	await untilWall(
		() =>
			/asking for its password/.test($("pairing-progress")?.textContent ?? ""),
		"the admin-prompt line",
	);
	rows = [
		pairRow({ reason: "paired", progress: null }, { state: "connected" }),
	];
	await act(async () =>
		finish(ok({ signed: { ok: true }, applied: { ok: true } })),
	);
	await until(() => $("pairing-outcome"), "the paired outcome");
	assert.match($("pairing-outcome").textContent, /^Paired\./);
	await click($("pairing-close"));
	assert.equal(popup(), null);
});

test("typed request: no digits shown, Approve waits for six, Enter never approves", async () => {
	script = {
		capabilities: caps(PAIRING),
		"approvals.list": list(typedRow({ sas: "482913" })),
		"approvals.pairAck": ok({ approval_id: ID, acked: true }),
		"approvals.approveOperation": ok({
			signed: { ok: true },
			applied: { ok: true },
		}),
	};
	await render(createElement(PhonePairingHost));
	await until(() => $("pairing-code-input"), "the code field");
	assert.equal(popup().getAttribute("data-pairing-mode"), "code");
	assert.equal($("pairing-sas"), null);
	assert.ok(
		!/482\s?913/.test(popup().textContent),
		"the phone's code is never on this screen",
	);
	assert.equal($("pairing-attested"), null);
	assert.equal($("pairing-approve").disabled, true);
	await type($("pairing-code-input"), "48 29");
	assert.equal($("pairing-approve").disabled, true);
	await type($("pairing-code-input"), "482-913");
	assert.equal($("pairing-code-input").value, "482 913");
	assert.equal($("pairing-approve").disabled, false);
	await keyDown($("pairing-code-input"), "Enter");
	await settle();
	assert.ok(
		!ops().includes("approvals.pairAck"),
		"Enter in the field sends nothing",
	);
	// A keyboard activation whose key did not go down on Approve (focus moved by a
	// held Enter) is ignored; one that did is the deliberate press.
	await click($("pairing-approve"), { keyboard: true });
	assert.ok(!ops().includes("approvals.pairAck"));
	await keyDown($("pairing-approve"), "Enter", { repeat: true });
	await click($("pairing-approve"), { keyboard: true });
	assert.ok(
		!ops().includes("approvals.pairAck"),
		"a repeating key is not a press",
	);
	await keyDown($("pairing-approve"), "Enter");
	await click($("pairing-approve"), { keyboard: true });
	await until(
		() => ops().includes("approvals.approveOperation"),
		"the signature",
	);
	assert.equal(
		sent.find((request) => request.op === "approvals.pairAck").code,
		"482913",
	);
});

test("wrong code: inline error with the tries left, field cleared; three strikes close it", async () => {
	let rows = [typedRow()];
	script = {
		capabilities: caps(PAIRING),
		"approvals.list": () => list(...rows),
		"approvals.pairAck": () => {
			rows = [typedRow({ tries_left: 2 })];
			return refuse(409, "pair_code_mismatch");
		},
	};
	await render(createElement(PhonePairingHost));
	await until(() => $("pairing-code-input"), "the code field");
	await type($("pairing-code-input"), "111111");
	await click($("pairing-approve"));
	await until(() => $("pairing-error"), "the error");
	assert.match($("pairing-error").textContent, /2 tries left/);
	assert.equal($("pairing-code-input").value, "");
	assert.ok(
		!ops().includes("approvals.approveOperation"),
		"a wrong code spends no signature",
	);
	script["approvals.pairAck"] = () => {
		rows = [
			typedRow(
				{ tries_left: 0, reason: "strikes_exhausted", progress: null },
				{ state: "denied" },
			),
		];
		return refuse(409, "pair_code_mismatch");
	};
	await type($("pairing-code-input"), "222222");
	await click($("pairing-approve"));
	await until(() => $("pairing-outcome"), "the strikes outcome");
	assert.match($("pairing-outcome").textContent, /three times/);
});

test("deny: the decision post, then a Denied line until closed", async () => {
	let rows = [pairRow()];
	script = {
		capabilities: caps(PAIRING),
		"approvals.list": () => list(...rows),
		"approvals.deny": () => {
			rows = [
				pairRow(
					{ reason: "denied_by_user", progress: null },
					{ state: "denied" },
				),
			];
			return ok({ approval_id: ID, state: "denied" });
		},
	};
	await render(createElement(PhonePairingHost));
	await until(() => $("pairing-deny"), "Deny");
	await click($("pairing-deny"));
	await until(() => $("pairing-outcome"), "the denied outcome");
	assert.match($("pairing-outcome").textContent, /^Denied\./);
	assert.deepEqual(
		sent.find((request) => request.op === "approvals.deny"),
		{ op: "approvals.deny", approvalId: ID },
	);
});

test("busy: both buttons disabled while the decision is in flight", async () => {
	script = {
		capabilities: caps(PAIRING),
		"approvals.list": list(pairRow()),
		"approvals.deny": () => new Promise(() => {}),
	};
	await render(createElement(PhonePairingHost));
	await until(() => $("pairing-deny"), "Deny");
	await click($("pairing-deny"));
	assert.equal($("pairing-deny").disabled, true);
	assert.equal($("pairing-approve").disabled, true);
});

test("expired: an untouched card past its window is gone; one that expires under a press says so", async () => {
	script = {
		capabilities: caps(PAIRING),
		"approvals.list": list(pairRow({ expires_at: Date.now() / 1000 - 1 })),
	};
	await render(createElement(PhonePairingHost));
	await settle();
	assert.ok(ops().includes("approvals.list"));
	assert.equal(popup(), null);
	await act(async () => root.unmount());
	root = undefined;
	let rows = [pairRow()];
	script = {
		capabilities: caps(PAIRING),
		"approvals.list": () => list(...rows),
		"approvals.pairAck": () => {
			rows = [
				pairRow({ reason: "expired", progress: null }, { state: "expired" }),
			];
			return refuse(409, "approval_expired");
		},
	};
	await render(createElement(PhonePairingHost));
	await until(() => $("pairing-approve"), "Approve");
	await click($("pairing-approve"));
	await until(() => $("pairing-outcome"), "the expired outcome");
	assert.match($("pairing-outcome").textContent, /expired/);
});

test("withdrawn or decided elsewhere: the feed's null pair_request removes the card", async () => {
	script = { capabilities: caps(PAIRING), "approvals.list": list(pairRow()) };
	await render(createElement(PhonePairingHost));
	await until(() => popup(), "the popup");
	script["approvals.list"] = list(
		pairRow({ reason: "withdrawn", progress: null }, { state: "withdrawn" }),
	);
	await publish({
		epoch: "e",
		seq: 2,
		type: "approvals",
		payload: { pending: false, pair_request: null },
	});
	assert.equal(popup(), null);
});

test("a feed frame naming a new request raises it on any route", async () => {
	script = { capabilities: caps(PAIRING), "approvals.list": list() };
	await render(createElement(PhonePairingHost));
	await settle();
	assert.equal(popup(), null);
	script["approvals.list"] = list(pairRow());
	await publish({
		epoch: "e",
		seq: 1,
		type: "open",
		payload: { approvals_pending: true, approvals_pair_request: ID },
	});
	await until(() => popup(), "the popup from the open frame");
});

test("not set up yet: says so, offers Turn on phone approvals with operator_setup", async () => {
	script = {
		capabilities: caps({ ...PAIRING, operator_setup: 1 }),
		"approvals.list": list(pairRow({ assurance: null })),
		"operator.setup.run": ok({
			outcome: "on",
			message: { code: "on", text: "Phone approvals are on." },
		}),
	};
	await render(createElement(PhonePairingHost));
	await until(() => $("pairing-unavailable"), "the not-available line");
	assert.equal($("pairing-approve"), null, "no Approve that cannot work");
	assert.ok(!/anchor/i.test(popup().textContent));
	await click($("pairing-setup"));
	await until(() => ops().includes("operator.setup.run"), "the setup run");
	assert.deepEqual(
		sent.find((request) => request.op === "operator.setup.run"),
		{ op: "operator.setup.run" },
	);
});

test("not set up yet without operator_setup: no setup button", async () => {
	script = {
		capabilities: caps(PAIRING),
		"approvals.list": list(pairRow({ assurance: null })),
	};
	await render(createElement(PhonePairingHost));
	await until(() => $("pairing-unavailable"), "the not-available line");
	assert.equal($("pairing-setup"), null);
	assert.ok($("pairing-deny"));
});

test("cancelled confirmation: Try again retries the apply without a second pair-ack", async () => {
	script = {
		capabilities: caps(PAIRING),
		"approvals.list": list(
			pairRow(
				{ reason: "failed_retryable", progress: null },
				{ state: "failed" },
			),
		),
		"approvals.applyOperation": ok({ applied: { ok: true } }),
	};
	await render(createElement(PhonePairingHost));
	await until(() => $("pairing-failed"), "the failed line");
	await click($("pairing-retry"));
	await until(() => ops().includes("approvals.applyOperation"), "the retry");
	assert.ok(!ops().includes("approvals.pairAck"));
	assert.equal(
		sent.find((request) => request.op === "approvals.applyOperation").operation,
		"pair_phone",
	);
});

/* ------------------------------------------------------ Settings section */

const phone = (over = {}) => ({
	device_id: "abc123",
	name: "Ana's iPhone",
	platform: "ios",
	paired_at: 1_763_000_000,
	last_seen: 1_763_100_000,
	push: true,
	state: "paired",
	...over,
});

test("Settings, capability absent: nothing rendered and nothing read", async () => {
	script = { capabilities: caps({ approvals: 1 }) };
	await render(createElement(PhonePairingSettings));
	assert.equal($("phone-pairing-settings"), null);
	assert.deepEqual(ops(), ["capabilities"]);
});

test("Paired phones: rows, empty state and the removing row", async () => {
	script = {
		capabilities: caps(PAIRING),
		"devices.list": ok({
			devices: [
				phone(),
				phone({
					device_id: "beef01",
					name: "Old Pixel",
					platform: "android",
					state: "removing",
				}),
			],
		}),
	};
	await render(createElement(PhonePairingSettings));
	await until(
		() =>
			document.querySelectorAll("[data-testid='paired-phone-row']").length ===
			2,
		"two rows",
	);
	assert.match($("paired-phones").textContent, /Ana's iPhone/);
	assert.match($("paired-phones").textContent, /Can't approve anymore/);
	assert.ok($("paired-phone-finish"));
	await act(async () => root.unmount());
	root = undefined;
	script["devices.list"] = ok({ devices: [] });
	await render(createElement(PhonePairingSettings));
	await until(() => $("paired-phones-empty"), "the empty state");
});

test("Paired phones: Remove asks first, then DELETEs; a cancelled prompt says removing; 404 says not found", async () => {
	script = {
		capabilities: caps(PAIRING),
		"devices.list": ok({ devices: [phone()] }),
		"devices.remove": ok({
			device_id: "abc123",
			state: "removing",
			push_revoked: true,
			anchor: "cancelled",
			detail: "",
		}),
	};
	await render(createElement(PhonePairingSettings));
	await until(() => $("paired-phone-remove"), "Remove");
	await click($("paired-phone-remove"));
	await until(() => $("paired-phone-confirm-remove"), "the dialog");
	assert.ok(
		!ops().includes("devices.remove"),
		"nothing removed before the dialog's confirm",
	);
	assert.match(document.body.textContent, /It can still open chats/);
	await click($("paired-phone-confirm-remove"));
	await until(() => ops().includes("devices.remove"), "the DELETE");
	assert.deepEqual(
		sent.find((request) => request.op === "devices.remove"),
		{ op: "devices.remove", deviceId: "abc123" },
	);
	await until(() => $("paired-phone-notice"), "the removing notice");
	assert.match($("paired-phone-notice").textContent, /didn't finish/);
	script["devices.remove"] = refuse(404, "unknown_device");
	await click($("paired-phone-remove"));
	await until(() => $("paired-phone-confirm-remove"), "the dialog again");
	await click($("paired-phone-confirm-remove"));
	await until(
		() =>
			/no longer on this computer's list/.test(
				$("paired-phone-notice")?.textContent ?? "",
			),
		"the 404 notice",
	);
});

test("Settings: the setup row offers Turn on, or Finish setup after a cancelled prompt", async () => {
	script = {
		capabilities: caps({ operator_setup: 1 }),
		"operator.setup.read": ok({
			state: "finish_setup",
			can_prompt: true,
			in_progress: false,
			blocked: null,
			message: null,
			file_only_notice: null,
		}),
	};
	await render(createElement(PhonePairingSettings));
	await until(() => $("phone-approvals-turn-on"), "the setup button");
	assert.equal($("phone-approvals-turn-on").textContent, "Finish setup");
	assert.equal(
		$("paired-phones"),
		null,
		"no Paired phones without phone_pairing",
	);
});
