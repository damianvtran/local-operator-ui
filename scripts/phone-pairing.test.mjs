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
			export { PhonePasswordDisclosure } from "./src/renderer/src/features/phone-pairing/phone-password";
			export { requestDesktop } from "./src/main/desktop-transport";
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
	PhonePasswordDisclosure,
	requestDesktop,
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
	// D6: a cancelled prompt is ONE warning sentence with Finish removing - not
	// the row's removing line plus the same fact again in danger red.
	await until(() => $("paired-phone-unfinished"), "the unfinished line");
	assert.match($("paired-phone-unfinished").textContent, /didn't finish/);
	assert.ok($("paired-phone-unfinished").classList.contains("text-warning"));
	assert.equal(
		$("paired-phones").querySelectorAll(".text-danger").length,
		0,
		"nothing in danger red",
	);
	assert.ok(
		!/Can't approve anymore/.test($("paired-phones").textContent),
		"the fact is said once",
	);
	assert.ok($("paired-phone-finish"), "Finish removing is offered");
	// D8 / code N2: the 404 notice is said at LIST level, so it outlives the row
	// the settle refetch drops.
	script["devices.remove"] = refuse(404, "unknown_device");
	script["devices.list"] = ok({ devices: [] });
	await click($("paired-phone-finish"));
	await until(() => $("paired-phones-list-notice"), "the 404 notice");
	await until(() => $("paired-phones-empty"), "the row gone");
	assert.match(
		$("paired-phones-list-notice").textContent,
		/no longer on this computer's list/,
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

/* ------------------------------------------------- round-1 remediation */

const ID_B = "ap_0123456789abcdeg";

/** Type one character at the field's CURRENT caret, as a browser would. */
async function typeAtCaret(input, character) {
	const at = input.selectionStart ?? input.value.length;
	const end = input.selectionEnd ?? at;
	const next = input.value.slice(0, at) + character + input.value.slice(end);
	await setValue(input, next, at + character.length);
}

/** What a browser's own Backspace does when nothing intercepts it. */
async function nativeBackspace(input) {
	const at = input.selectionStart ?? 0;
	if (at === 0) return;
	await setValue(
		input,
		input.value.slice(0, at - 1) + input.value.slice(at),
		at - 1,
	);
}

async function setValue(input, value, caret) {
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	).set;
	await act(async () => {
		setter.call(input, value);
		input.setSelectionRange(caret, caret);
		input.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
	await settle(2);
}

/** A Backspace/Delete keydown; runs the browser's own edit only if not prevented. */
async function pressDelete(input, key) {
	let prevented = false;
	await act(async () => {
		const event = new window.KeyboardEvent("keydown", {
			key,
			bubbles: true,
			cancelable: true,
		});
		input.dispatchEvent(event);
		prevented = event.defaultPrevented;
	});
	await settle(2);
	if (!prevented && key === "Backspace") await nativeBackspace(input);
}

test("D1: the code reads left to right in every language - hero and typed field pinned LTR and isolated", async () => {
	script = { capabilities: caps(PAIRING), "approvals.list": list(pairRow()) };
	await render(createElement(PhonePairingHost));
	await until(() => $("pairing-sas"), "the code");
	assert.equal($("pairing-sas").getAttribute("dir"), "ltr");
	assert.equal($("pairing-sas").style.unicodeBidi, "isolate");
	// The accessible name still reads the digits in order.
	assert.equal(
		$("pairing-sas").getAttribute("aria-label"),
		"Code: 4 8 2 9 1 3",
	);
	await act(async () => root.unmount());
	root = undefined;
	script["approvals.list"] = list(typedRow());
	await render(createElement(PhonePairingHost));
	await until(() => $("pairing-code-input"), "the field");
	assert.equal($("pairing-code-input").getAttribute("dir"), "ltr");
	assert.equal($("pairing-code-input").style.unicodeBidi, "isolate");
});

test("U2: a mid-field correction changes only that digit, keeps the caret, and Backspace over the space deletes a digit", async () => {
	script = { capabilities: caps(PAIRING), "approvals.list": list(typedRow()) };
	await render(createElement(PhonePairingHost));
	await until(() => $("pairing-code-input"), "the field");
	const input = $("pairing-code-input");
	input.focus();
	await setValue(input, "482913", 6);
	assert.equal(input.value, "482 913");
	// The UX round's repro: caret after the 8, Backspace, then 7.
	await act(async () => input.setSelectionRange(2, 2));
	await pressDelete(input, "Backspace");
	assert.equal(input.value, "429 13");
	assert.equal(input.selectionStart, 1, "the caret stays where the edit was");
	await typeAtCaret(input, "7");
	assert.equal(input.value, "472 913", "only the corrected digit changed");
	assert.equal(input.selectionStart, 2);
	// Backspace just after the group space removes the digit before it.
	await act(async () => input.setSelectionRange(4, 4));
	await pressDelete(input, "Backspace");
	assert.equal(input.value, "479 13");
	assert.equal(input.selectionStart, 2);
	// Delete just before the space removes the digit after it.
	await setValue(input, "472 913", 7);
	await act(async () => input.setSelectionRange(3, 3));
	await pressDelete(input, "Delete");
	assert.equal(input.value, "472 13");
	assert.equal(input.selectionStart, 3);
});

test("U2: a paste that would make more than six digits is refused whole, never clipped into a submittable code", async () => {
	script = { capabilities: caps(PAIRING), "approvals.list": list(typedRow()) };
	await render(createElement(PhonePairingHost));
	await until(() => $("pairing-code-input"), "the field");
	const input = $("pairing-code-input");
	input.focus();
	await setValue(input, "1", 1);
	await typeAtCaret(input, "482 913");
	assert.equal(input.value, "1", "the field keeps what it had");
	assert.equal($("pairing-approve").disabled, true, "nothing to submit");
	assert.equal(input.getAttribute("maxlength"), null);
});

test("U7: a refused seventh digit keeps the caret where it was, so Backspace removes the digit beside it", async () => {
	script = { capabilities: caps(PAIRING), "approvals.list": list(typedRow()) };
	await render(createElement(PhonePairingHost));
	await until(() => $("pairing-code-input"), "the field");
	const input = $("pairing-code-input");
	input.focus();
	await setValue(input, "482913", 6);
	assert.equal(input.value, "482 913");
	// The UX round's repro: Home, Right x2, type 5.
	await act(async () => input.setSelectionRange(2, 2));
	await typeAtCaret(input, "5");
	assert.equal(input.value, "482 913", "the seventh digit is refused");
	assert.equal(input.selectionStart, 2, "the caret stays after the 8");
	assert.equal(input.selectionEnd, 2);
	await pressDelete(input, "Backspace");
	assert.equal(input.value, "429 13", "Backspace removed the 8, not the 3");
	// A refused paste after the space keeps its caret too.
	await setValue(input, "482913", 6);
	await act(async () => input.setSelectionRange(5, 5));
	await typeAtCaret(input, "77");
	assert.equal(input.value, "482 913");
	assert.equal(input.selectionStart, 5);
});

test("M1: a new request replacing the shown one starts with an empty field", async () => {
	let rows = [typedRow()];
	script = {
		capabilities: caps(PAIRING),
		"approvals.list": () => list(...rows),
	};
	await render(createElement(PhonePairingHost));
	await until(() => $("pairing-code-input"), "the field");
	await type($("pairing-code-input"), "123");
	assert.equal($("pairing-code-input").value, "123");
	rows = [
		typedRow({ reason: "withdrawn", progress: null }, { state: "withdrawn" }),
		typedRow({}, { approval_id: ID_B }),
	];
	await publish({
		epoch: "e",
		seq: 3,
		type: "approvals",
		payload: { pending: true, pair_request: ID_B },
	});
	await until(
		() => $("pairing-code-input")?.value === "",
		"the field cleared for the new request",
	);
});

test("M3: a null in the open frame does not hide a live request the list still shows", async () => {
	script = { capabilities: caps(PAIRING), "approvals.list": list(pairRow()) };
	await render(createElement(PhonePairingHost));
	await publish({
		epoch: "e",
		seq: 1,
		type: "open",
		payload: { approvals_pending: true, approvals_pair_request: null },
	});
	await until(() => popup(), "the card from the list");
	// A null after the feed NAMED it still hides that id at once.
	await publish({
		epoch: "e",
		seq: 2,
		type: "approvals",
		payload: { pending: true, pair_request: ID },
	});
	await publish({
		epoch: "e",
		seq: 3,
		type: "approvals",
		payload: { pending: false, pair_request: null },
	});
	assert.ok(popup() === null);
});

/*
 * QA round 3: a press that FAILED leaves no outcome, so the held card has to be
 * released by the same signals that remove an untouched one - otherwise the
 * dead request kept its Deny on screen and the next request never showed.
 */
const benRow = (pairing = {}) =>
	pairRow(
		{ phone_name: "Ben's Pixel", phone_name_full: "Ben's Pixel", ...pairing },
		{ approval_id: ID_B },
	);
const shownName = () => $("pairing-phone-name")?.textContent ?? "";

/** Raise A, press Approve, and let core answer 500: the error stays on A. */
async function failedApprove(rows, onAck = () => {}, { named = true } = {}) {
	script = {
		capabilities: caps(PAIRING),
		"approvals.list": () => list(...rows()),
		"approvals.pairAck": () => {
			onAck();
			return refuse(500, "internal_error");
		},
	};
	await render(createElement(PhonePairingHost));
	if (named) {
		await publish({
			epoch: "e",
			seq: 1,
			type: "approvals",
			payload: { pending: true, pair_request: ID },
		});
	}
	await until(() => $("pairing-approve"), "Approve on A");
	await click($("pairing-approve"));
	await until(() => $("pairing-error"), "the failed approve's error");
	assert.match(shownName(), /Ana/);
}

test("QA r3: a failed approve, then the phone withdraws: A's card goes and B's is shown", async () => {
	let rows = [pairRow()];
	await failedApprove(() => rows);
	rows = [
		pairRow({ reason: "withdrawn", progress: null }, { state: "withdrawn" }),
	];
	await publish({
		epoch: "e",
		seq: 2,
		type: "approvals",
		payload: { pending: false, pair_request: null },
	});
	// `ok`, not `equal`: a failing `equal` inspects the jsdom node (gigabytes).
	assert.ok(popup() === null, "the withdrawn card is gone");
	rows = [...rows, benRow()];
	await publish({
		epoch: "e",
		seq: 3,
		type: "approvals",
		payload: { pending: true, pair_request: ID_B },
	});
	await until(() => /Ben/.test(shownName()), "B's card");
	assert.doesNotMatch(popup().textContent, /Ana/);
	assert.ok($("pairing-error") === null, "A's error does not carry over");
});

test("QA r3: a failed approve, then A decided elsewhere: B's card is shown", async () => {
	let rows = [pairRow()];
	await failedApprove(() => rows);
	rows = [
		pairRow({ reason: "denied_by_user", progress: null }, { state: "denied" }),
		benRow(),
	];
	await publish({
		epoch: "e",
		seq: 2,
		type: "approvals",
		payload: { pending: true, pair_request: ID_B },
	});
	await until(() => /Ben/.test(shownName()), "B's card");
	assert.doesNotMatch(popup().textContent, /Ana/);
});

test("QA r3: a failed approve, then A's window runs out: B's card is shown", async () => {
	// A's row still reads `waiting` (core has not folded it yet) and no frame
	// has spoken, so only A's own clock can release it.
	const soon = Date.now() / 1000 + 2;
	let rows = [pairRow({ expires_at: soon })];
	await failedApprove(
		() => rows,
		() => {
			rows = [pairRow({ expires_at: soon }), benRow()];
		},
		{ named: false },
	);
	assert.match(shownName(), /Ana/, "held while A's window is open");
	await untilWall(() => /Ben/.test(shownName()), "B's card after A expired");
	assert.doesNotMatch(popup().textContent, /Ana/);
});

test("QA r3 guard: a failed approve whose request is still pending keeps A held", async () => {
	let rows = [pairRow()];
	await failedApprove(
		() => rows,
		() => {
			rows = [pairRow(), benRow()];
		},
	);
	await settle();
	assert.match(shownName(), /Ana/, "A is still held");
	assert.ok($("pairing-error"), "with its error");
	assert.ok($("pairing-deny"));
});

test("M2/U4/D2: turning on from the popup says where the prompt is, and a failure is the keyed alert, never a raw message", async () => {
	let release;
	script = {
		capabilities: caps({ ...PAIRING, operator_setup: 1 }),
		"approvals.list": list(pairRow({ assurance: null })),
		"operator.setup.run": () =>
			new Promise((resolve) => {
				release = resolve;
			}),
	};
	await render(createElement(PhonePairingHost));
	await until(() => $("pairing-setup"), "Turn on");
	await click($("pairing-setup"));
	await until(() => $("pairing-setup-working"), "the waiting line");
	assert.match(
		$("pairing-setup-working").textContent,
		/password prompt\. It may be behind this window/,
	);
	assert.ok(
		document.activeElement === $("pairing-setup-working"),
		"focus is on $('pairing-setup-working')",
	);
	await act(async () =>
		release({
			status: 500,
			body: { detail: { code: "internal", text: "Traceback: KeyError 'x'" } },
		}),
	);
	await until(() => $("pairing-setup-error"), "the failure");
	assert.equal($("pairing-setup-error").getAttribute("role"), "alert");
	assert.match($("pairing-setup-error").textContent, /couldn't be turned on/);
	assert.ok(!popup().textContent.includes("Traceback"));
});

test("U1/U3/D3: focus follows the person's press, a polite region announces each step, and the settled card names the phone", async () => {
	let finish;
	let rows = [pairRow()];
	script = {
		capabilities: caps(PAIRING),
		"approvals.list": () => list(...rows),
		"approvals.pairAck": ok({ approval_id: ID, acked: true }),
		"approvals.approveOperation": () =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	};
	script["approvals.list"] = () => list();
	await render(createElement(PhonePairingHost));
	// Mounted EMPTY before any card, so its first change is announced.
	assert.ok($("pairing-live"), "the live region exists before a card");
	assert.equal($("pairing-live").getAttribute("aria-live"), "polite");
	assert.equal($("pairing-live").textContent, "");
	script["approvals.list"] = () => list(...rows);
	await publish({
		epoch: "e",
		seq: 1,
		type: "approvals",
		payload: { pending: true, pair_request: ID },
	});
	await until(() => popup(), "the popup");
	assert.equal(
		$("pairing-live").textContent,
		"A phone wants to pair with this computer",
	);
	assert.ok(document.activeElement === document.body, "no focus on arrival");
	$("pairing-approve").focus();
	await click($("pairing-approve"));
	await until(() => $("pairing-progress"), "the signing line");
	assert.ok(
		document.activeElement === $("pairing-progress"),
		"focus is on $('pairing-progress')",
	);
	assert.match($("pairing-live").textContent, /^Confirm on your computer/);
	rows = [
		pairRow({ reason: "paired", progress: null }, { state: "connected" }),
	];
	await act(async () =>
		finish(ok({ signed: { ok: true }, applied: { ok: true } })),
	);
	await until(() => $("pairing-outcome"), "the outcome");
	assert.ok(
		document.activeElement === $("pairing-close"),
		"focus is on $('pairing-close')",
	);
	assert.match($("pairing-live").textContent, /^Paired\./);
	assert.equal(
		popup().querySelector("h2").textContent,
		"Phone pairing request",
		"the settled title no longer says 'wants to pair'",
	);
	assert.equal($("pairing-phone-name").textContent, "Ana's iPhone");
	assert.match(
		$("pairing-manage-where").textContent,
		// Design round 2, D10: the path names the sidebar entry the person sees.
		/Settings → Radient account → Paired phones/,
	);
	// N4: Escape closes a settled card.
	await keyDown($("pairing-close"), "Escape");
	await settle();
	assert.ok(popup() === null);
});

test("U1/N2: a wrong code returns focus to the field, which names the error", async () => {
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
	await until(() => $("pairing-code-input"), "the field");
	await type($("pairing-code-input"), "111111");
	$("pairing-approve").focus();
	await click($("pairing-approve"));
	await until(() => $("pairing-error"), "the error");
	assert.ok(
		document.activeElement === $("pairing-code-input"),
		"focus is on $('pairing-code-input')",
	);
	assert.equal($("pairing-code-input").getAttribute("aria-invalid"), "true");
	const describedBy = $("pairing-code-input")
		.getAttribute("aria-describedby")
		.split(" ");
	assert.ok(describedBy.includes($("pairing-error").id));
});

/*
 * Review round 2, R2-1: after Approve the person goes back to the composer
 * while "Confirm on your computer…" shows. The outcome, or a late failure that
 * on the confirm route would focus Deny, must leave their focus where it is.
 */
async function approveThenLeave({ result, rows: settled, wait }) {
	let finish;
	let rows = [pairRow()];
	script = {
		capabilities: caps(PAIRING),
		"approvals.list": () => list(...rows),
		"approvals.pairAck": ok({ approval_id: ID, acked: true }),
		"approvals.approveOperation": () =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	};
	await render(createElement(PhonePairingHost));
	await until(() => $("pairing-approve"), "Approve");
	$("pairing-approve").focus();
	await click($("pairing-approve"));
	await until(() => $("pairing-progress"), "the signing line");
	return {
		/** Settle the approve post with `focus` applied first. */
		async settle(focus) {
			await act(async () => focus());
			if (settled) rows = settled;
			await act(async () => finish(result));
			await until(() => $(wait), wait);
		},
	};
}

test("R2-1: the outcome does not take focus back from the composer", async () => {
	const flow = await approveThenLeave({
		result: ok({ signed: { ok: true }, applied: { ok: true } }),
		rows: [
			pairRow({ reason: "paired", progress: null }, { state: "connected" }),
		],
		wait: "pairing-outcome",
	});
	const composer = document.createElement("textarea");
	document.body.append(composer);
	await flow.settle(() => composer.focus());
	assert.ok(
		document.activeElement === composer,
		`focus stays in the composer (got ${document.activeElement?.dataset?.testid ?? document.activeElement?.tagName})`,
	);
});

test("R2-1: a late failure does not move focus onto Deny, so Enter in the composer cannot deny", async () => {
	const flow = await approveThenLeave({
		result: refuse(500, "internal"),
		wait: "pairing-error",
	});
	const composer = document.createElement("textarea");
	document.body.append(composer);
	await flow.settle(() => composer.focus());
	assert.ok($("pairing-deny"), "the confirm route's error stage offers Deny");
	assert.ok(
		document.activeElement === composer,
		`focus stays in the composer (got ${document.activeElement?.dataset?.testid ?? document.activeElement?.tagName})`,
	);
	assert.ok(!ops().includes("approvals.deny"), "nothing was denied");
});

test("R2-1: focus still in the card, or dropped to <body>, moves to the new stage as designed", async () => {
	const inCard = await approveThenLeave({
		result: refuse(500, "internal"),
		wait: "pairing-error",
	});
	// Focus is on the progress line, inside the card.
	await inCard.settle(() => $("pairing-progress").focus());
	assert.ok(
		document.activeElement === $("pairing-deny"),
		"focus is on $('pairing-deny')",
	);
	await act(async () => root.unmount());
	root = undefined;
	const dropped = await approveThenLeave({
		result: ok({ signed: { ok: true }, applied: { ok: true } }),
		rows: [
			pairRow({ reason: "paired", progress: null }, { state: "connected" }),
		],
		wait: "pairing-outcome",
	});
	await dropped.settle(() => document.activeElement?.blur());
	assert.ok(
		document.activeElement === $("pairing-close"),
		"focus is on $('pairing-close')",
	);
});

test("D2: Deny says Denying… while its post is in flight", async () => {
	let release;
	script = {
		capabilities: caps(PAIRING),
		"approvals.list": list(pairRow()),
		"approvals.deny": () =>
			new Promise((resolve) => {
				release = resolve;
			}),
	};
	await render(createElement(PhonePairingHost));
	await until(() => $("pairing-deny"), "Deny");
	await click($("pairing-deny"));
	await until(() => $("pairing-deny")?.disabled, "busy");
	assert.equal($("pairing-deny").textContent, "Denying…");
	await act(async () => release(ok({ approval_id: ID, state: "denied" })));
});

test("D5: the card is bounded by the window; only its middle scrolls", async () => {
	script = { capabilities: caps(PAIRING), "approvals.list": list(pairRow()) };
	await render(createElement(PhonePairingHost));
	await until(() => popup(), "the popup");
	assert.ok(popup().className.includes("max-h-[calc(100vh-2rem)]"));
	assert.ok($("pairing-body").className.includes("overflow-y-auto"));
	assert.ok(!$("pairing-body").contains(popup().querySelector("h2")));
	assert.ok(!$("pairing-body").contains($("pairing-approve")));
	assert.ok($("pairing-actions").contains($("pairing-approve")));
});

test("D4: the machine is 'your Mac' on macOS and 'your PC' on Windows", async () => {
	try {
		setPlatform("MacIntel");
		assert.equal(model.hostOs(), "mac");
		let rows = [pairRow({ reason: "signing", progress: "signing" })];
		script = {
			capabilities: caps(PAIRING),
			"approvals.list": () => list(...rows),
		};
		await render(createElement(PhonePairingHost));
		await until(() => $("pairing-progress"), "the signing line");
		assert.match($("pairing-progress").textContent, /^Confirm on your Mac\./);
		await act(async () => root.unmount());
		root = undefined;
		setPlatform("Win32");
		rows = [
			pairRow({ reason: "admin_prompt_open", progress: "admin_prompt_open" }),
		];
		await render(createElement(PhonePairingHost));
		await until(() => $("pairing-progress"), "the admin line");
		assert.match($("pairing-progress").textContent, /^Your PC is asking/);
		assert.match(popup().textContent, /Your PC/);
	} finally {
		setPlatform("Linux x86_64");
	}
});

test("N1: a name core clipped shows an ellipsis beside Show full name", async () => {
	const full = "A".repeat(50);
	script = {
		capabilities: caps(PAIRING),
		"approvals.list": list(
			pairRow({ phone_name: "A".repeat(40), phone_name_full: full }),
		),
	};
	await render(createElement(PhonePairingHost));
	await until(() => $("pairing-name-toggle"), "the toggle");
	assert.equal($("pairing-phone-name").textContent, `${"A".repeat(40)}…`);
});

test("U1/U4/D7: Settings quotes names, says where the removal prompt is, and Cancel returns focus to the row", async () => {
	let release;
	script = {
		capabilities: caps(PAIRING),
		"devices.list": ok({ devices: [phone()] }),
		"devices.remove": () =>
			new Promise((resolve) => {
				release = resolve;
			}),
	};
	await render(createElement(PhonePairingSettings));
	await until(() => $("paired-phone-remove"), "Remove");
	assert.equal($("paired-phone-name").parentElement.tagName, "Q");
	$("paired-phone-remove").focus();
	await click($("paired-phone-remove"));
	await until(() => $("paired-phone-dialog"), "the dialog");
	assert.equal($("paired-phone-dialog-name").parentElement.tagName, "Q");
	const cancel = Array.from(
		$("paired-phone-dialog").querySelectorAll("button"),
	).find((button) => button.textContent === "Cancel");
	await click(cancel);
	await until(() => !$("paired-phone-dialog"), "the dialog closed");
	await settle();
	assert.ok(
		document.activeElement === $("paired-phone-remove"),
		"focus is on $('paired-phone-remove')",
	);
	await click($("paired-phone-remove"));
	await until(() => $("paired-phone-confirm-remove"), "the dialog again");
	await click($("paired-phone-confirm-remove"));
	await until(() => $("paired-phone-working"), "the waiting line");
	assert.match(
		$("paired-phone-working").textContent,
		/password prompt\. It may be behind this window/,
	);
	// Its button is disabled while the removal runs, so focus goes to the heading.
	await settle();
	assert.ok(
		document.activeElement === $("paired-phones-heading"),
		"focus is on $('paired-phones-heading')",
	);
	await act(async () =>
		release(ok({ device_id: "abc123", state: "revoked", anchor: "ok" })),
	);
});

test("N3: Finish setup says why the first attempt did not finish", async () => {
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
	await until(() => $("phone-approvals-finish-reason"), "the reason line");
	assert.match(
		$("phone-approvals-finish-reason").textContent,
		/prompt was cancelled/,
	);
});

/* ------------------------------------------- D10: Show phone password */

const SECRET = "hunter2-Correct-Horse-7Q";

/** Every console call made while `work` runs, as strings. */
async function consoleDuring(work) {
	const lines = [];
	const methods = ["log", "info", "warn", "error", "debug", "trace"];
	const saved = methods.map((name) => console[name]);
	for (const name of methods)
		console[name] = (...args) =>
			lines.push(
				args
					.map((arg) =>
						typeof arg === "string"
							? arg
							: (JSON.stringify(arg) ?? String(arg)),
					)
					.join(" "),
			);
	try {
		await work();
	} finally {
		methods.forEach((name, index) => {
			console[name] = saved[index];
		});
	}
	return lines;
}

test("D10: without mobile_password_read there is no disclosure and nothing is read", async () => {
	script = { capabilities: caps(PAIRING), "devices.list": ok({ devices: [] }) };
	await render(createElement(PhonePairingSettings));
	await until(() => $("paired-phones-empty"), "the list");
	assert.ok($("phone-password-disclosure") === null);
	assert.ok(!ops().includes("mobile.password"));
});

test("D10: the password is read on click only, masked by default, copyable, cleared on collapse, and never logged by main or the renderer", async () => {
	const { createServer } = await import("node:http");
	let hits = 0;
	const server = createServer((request, response) => {
		if (request.url === "/v1/desktop/mobile/password") hits++;
		response.writeHead(200, {
			"content-type": "application/json",
			"cache-control": "no-store",
		});
		response.end(
			JSON.stringify({
				status: 200,
				message: "Mobile password.",
				result: { password: SECRET },
			}),
		);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${server.address().port}`;
	const copied = [];
	const savedClipboard = Object.getOwnPropertyDescriptor(
		globalThis.navigator,
		"clipboard",
	);
	Object.defineProperty(globalThis.navigator, "clipboard", {
		value: { writeText: async (text) => copied.push(text) },
		configurable: true,
	});
	try {
		const lines = await consoleDuring(async () => {
			script = {
				capabilities: caps({ mobile_password_read: 1 }),
				// The renderer's request goes through MAIN's real transport to HTTP.
				"mobile.password": (request) =>
					requestDesktop(request, url, "desktop-token"),
			};
			await render(createElement(PhonePairingSettings));
			await until(() => $("phone-password-disclosure"), "the disclosure");
			assert.ok($("phone-password-panel") === null, "collapsed by default");
			await click(
				$("phone-password-disclosure").querySelector("button[aria-expanded]"),
			);
			await until(() => $("phone-password-read"), "the read button");
			assert.equal(hits, 0, "opening the disclosure reads nothing");
			assert.ok(!ops().includes("mobile.password"));
			await click($("phone-password-read"));
			await until(() => $("phone-password-masked"), "the masked value");
			assert.equal(hits, 1);
			assert.deepEqual(
				sent.filter((request) => request.op === "mobile.password"),
				[{ op: "mobile.password" }],
			);
			assert.ok(
				!document.body.textContent.includes(SECRET),
				"masked by default",
			);
			await click($("phone-password-copy"));
			await until(() => copied.length === 1, "the copy");
			assert.equal(copied[0], SECRET);
			assert.equal($("phone-password-copy").textContent, "Copied");
			await click($("phone-password-toggle"));
			assert.equal($("phone-password-value").textContent, SECRET);
			assert.equal($("phone-password-value").getAttribute("dir"), "ltr");
			// Collapse: the panel, and the value with it, leave the tree.
			await click(
				$("phone-password-disclosure").querySelector("button[aria-expanded]"),
			);
			assert.ok($("phone-password-panel") === null);
			assert.ok(!document.body.textContent.includes(SECRET));
			// Reopening starts over: nothing shown, nothing read until clicked.
			await click(
				$("phone-password-disclosure").querySelector("button[aria-expanded]"),
			);
			await until(() => $("phone-password-read"), "the read button again");
			assert.equal(hits, 1);
		});
		assert.ok(
			lines.every((line) => !line.includes(SECRET)),
			`no console line carries the password (${lines.length} lines seen)`,
		);
	} finally {
		if (savedClipboard)
			Object.defineProperty(globalThis.navigator, "clipboard", savedClipboard);
		else Reflect.deleteProperty(globalThis.navigator, "clipboard");
		await new Promise((resolve) => server.close(resolve));
	}
});

test("D10: 404 mobile_password_unset says no password is set; other failures are a keyed retry line", async () => {
	script = {
		capabilities: caps({ mobile_password_read: 1 }),
		"mobile.password": refuse(404, "mobile_password_unset"),
	};
	await render(createElement(PhonePasswordDisclosure, { defaultOpen: true }));
	await until(() => $("phone-password-read"), "the read button");
	await click($("phone-password-read"));
	await until(() => $("phone-password-unset"), "the unset line");
	assert.equal(
		$("phone-password-unset").textContent,
		"No phone password is set.",
	);
	script["mobile.password"] = refuse(500, "internal", "secret-ish trace");
	await click($("phone-password-read"));
	await until(() => $("phone-password-error"), "the error line");
	assert.match($("phone-password-error").textContent, /couldn't be read/);
	assert.ok(!document.body.textContent.includes("trace"));
});

test("U6/D11: after the read, focus lands on Show (or back on the read button), and Show/Hide is a plain button", async () => {
	let release;
	script = {
		capabilities: caps({ mobile_password_read: 1 }),
		"mobile.password": () =>
			new Promise((resolve) => {
				release = resolve;
			}),
	};
	await render(createElement(PhonePasswordDisclosure, { defaultOpen: true }));
	await until(() => $("phone-password-read"), "the read button");
	$("phone-password-read").focus();
	await click($("phone-password-read"), { keyboard: true });
	await act(async () => release(ok({ password: SECRET })));
	await until(() => $("phone-password-masked"), "the masked value");
	assert.ok(
		document.activeElement === $("phone-password-toggle"),
		`focus is on Show (got ${document.activeElement?.dataset?.testid ?? document.activeElement?.tagName})`,
	);
	// D11: the label says the action; no aria-pressed to contradict it.
	const toggle = $("phone-password-toggle");
	assert.equal(toggle.textContent, "Show");
	assert.equal(toggle.hasAttribute("aria-pressed"), false);
	await click(toggle, { keyboard: true });
	assert.equal($("phone-password-toggle").textContent, "Hide");
	assert.equal($("phone-password-toggle").hasAttribute("aria-pressed"), false);
	assert.ok(document.activeElement === $("phone-password-toggle"));
	await act(async () => root.unmount());
	root = undefined;
	// Not set: focus returns to the (re-enabled) read button beside the line.
	script["mobile.password"] = refuse(404, "mobile_password_unset");
	await render(createElement(PhonePasswordDisclosure, { defaultOpen: true }));
	await until(() => $("phone-password-read"), "the read button");
	$("phone-password-read").focus();
	await click($("phone-password-read"), { keyboard: true });
	await until(() => $("phone-password-unset"), "the unset line");
	assert.ok(
		document.activeElement === $("phone-password-read"),
		"focus is back on the read button",
	);
	// A slow read never pulls focus back from somewhere else.
	await act(async () => root.unmount());
	root = undefined;
	script["mobile.password"] = () =>
		new Promise((resolve) => {
			release = resolve;
		});
	await render(createElement(PhonePasswordDisclosure, { defaultOpen: true }));
	await until(() => $("phone-password-read"), "the read button");
	await click($("phone-password-read"), { keyboard: true });
	const elsewhere = document.createElement("textarea");
	document.body.append(elsewhere);
	await act(async () => elsewhere.focus());
	await act(async () => release(ok({ password: SECRET })));
	await until(() => $("phone-password-masked"), "the masked value");
	assert.ok(document.activeElement === elsewhere, "focus stays elsewhere");
});

test("contract: mobile.password is a bodiless GET of core's route", () => {
	assert.deepEqual(desktopEndpoint({ op: "mobile.password" }), {
		path: "/v1/desktop/mobile/password",
		method: "GET",
	});
	assert.equal(
		desktopRequestSchema.safeParse({ op: "mobile.password", extra: 1 }).success,
		false,
	);
});
