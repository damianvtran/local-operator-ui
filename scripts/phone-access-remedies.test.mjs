import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, afterEach, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * PHONE ACCESS REMEDIES (local-operator #3945 `features.tunnel_remedy_kinds`,
 * #3953 `features.mobile_doctor`; spec v2 §4.1) - what the desktop shows for
 * each remedy kind, the first-sign-in offer card, and Copy diagnostics.
 *
 * Same rig as `phone-access-block.test.mjs` (rendered against a real
 * `QueryClient`; the desktop bridge is the only stub), in its own file so that
 * suite's "a settled block is quiet" contract stays about the pre-#3945 block.
 * What this guards:
 *
 *  - CAPABILITY ABSENT IS TODAY'S BLOCK: every new kind, sent to a renderer
 *    whose backend does not advertise `tunnel_remedy_kinds`, renders the
 *    backend's sentence and Check again - no new button, no waiting line, no
 *    account read, no focus refetch.
 *  - ONE CONTROL PER KIND with the capability, chosen by `remedy.kind`, and the
 *    console links open ONLY the backend's https `remedy.url`.
 *  - WAITING IS NOT WORKING: `wait_*` and `reconnecting` show a static line,
 *    Last checked and a quiet Check again, never a spinner; `reconnecting`
 *    re-asks on its own and a press during it is not an error.
 *  - THE OFFER never activates anything and "Not now" sticks per account.
 *  - COPY DIAGNOSTICS copies the doctor JSON, says Copied then resets, says
 *    so when it fails, and is absent (and never called) without its capability.
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
// Radix's popper (the collapsed-strip offer's popover) measures with a
// ResizeObserver, which jsdom does not implement.
// Its dismissable layer dispatches a `CustomEvent` on the document; Node's own
// global is not jsdom's, so jsdom's `dispatchEvent` rejects it.
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
/** op -> reply or (request) => reply; the per-case script. */
let script = {};
/** URLs the app asked the OS to open. */
let opened = [];
/** What the clipboard received, or a function that throws to refuse. */
let clipboard = [];
let clipboardRefuses = false;
globalThis.window.api = {
	openExternal: async (url) => {
		opened.push(url);
	},
	desktop: {
		request: async (request) => {
			sent.push(request);
			const reply = script[request.op];
			if (!reply) return { status: 404, body: { detail: "no script" } };
			return typeof reply === "function" ? reply(request) : reply;
		},
	},
};
const fakeClipboard = {
	writeText: async (text) => {
		if (clipboardRefuses) throw new Error("clipboard refused");
		clipboard.push(text);
	},
};
// Node ships its own global `navigator` (so the bootstrap above leaves it), and
// the bundled component reads THAT one; jsdom's is the window's. Both get it.
for (const nav of [globalThis.navigator, globalThis.window.navigator]) {
	Object.defineProperty(nav, "clipboard", {
		configurable: true,
		value: fakeClipboard,
	});
}

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
			export { MemoryRouter, Routes, Route } from "react-router-dom";
			export { PhoneAccessBlock, phoneCheckedAgo, phoneRemedyLink } from "./src/renderer/src/features/providers/phone-access-block";
			export { PhoneAccessOffer, PhoneAccessOfferIcon, PHONE_OFFER_DISMISSED_KEY } from "./src/renderer/src/features/providers/phone-access-offer";
			export { buildRenderedEntries } from "./src/renderer/src/features/settings/search/settings-search-index";
			export { searchSettings } from "./src/renderer/src/features/settings/search/settings-search-match";
			export { defaultQueryOptions } from "./src/renderer/src/shared/api/query-client";
			export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";
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
	`./_phone-access-remedies-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	QueryClient,
	QueryClientProvider,
	focusManager,
	MemoryRouter,
	Routes,
	Route,
	PhoneAccessBlock,
	phoneCheckedAgo,
	phoneRemedyLink,
	PhoneAccessOffer,
	PhoneAccessOfferIcon,
	PHONE_OFFER_DISMISSED_KEY,
	buildRenderedEntries,
	searchSettings,
	defaultQueryOptions,
	desktopEndpoint,
	desktopRequestSchema,
	createElement,
} = await import(bundlePath.href);
await unlink(bundlePath);

const ok = (result) => ({ status: 200, body: { result } });
const caps = (features) =>
	ok({
		desktop_contract: 1,
		desktop_available: true,
		desktop_auth: "bearer",
		features,
	});

/** The #3945 backend: the setup route plus its remedy vocabulary. */
const REMEDIES = { radient: 1, tunnel_setup: 1, tunnel_remedy_kinds: 1 };
/** The backend this renderer ships against today. */
const TODAY = { radient: 1, tunnel_setup: 1 };

const answer = (over = {}) => ({
	step: "apply",
	blocked_on: "none",
	configured: false,
	ready: true,
	verified: false,
	url: null,
	credential_id: 17,
	identity_label: "a***@example.test",
	credential_choices: [],
	quote: null,
	receipts: [],
	remedy: {
		kind: "run",
		text: "Backend run sentence.",
		command: null,
		url: null,
	},
	source: "fresh",
	in_progress: false,
	progress: [],
	active_credential_id: null,
	...over,
});

/** A blocked answer in the shape `desktop_tunnel_setup.py::_contract` builds. */
const blocked = (step, blockedOn, kind, text, over = {}) =>
	answer({
		step,
		blocked_on: blockedOn,
		ready: false,
		remedy: { kind, text, command: null, url: null },
		...over,
	});

const CONSOLE = "https://console.example.test/billing";
const LAST_CHECKED_SECONDS = /Last checked \d+ seconds? ago/;

const account = (id, email) =>
	ok({
		data: {
			msg: "ok",
			result: {
				account: {
					id,
					tenant_id: "ten_fixture",
					email,
					name: "Fixture Owner",
					role: "owner",
					status: "active",
					created_at: "2026-01-02T03:04:05Z",
					updated_at: "2026-01-02T03:04:05Z",
				},
				identity: { email, provider: "google", provider_id: "g-1" },
			},
		},
	});

const radientAs = (id, email) => (request) =>
	request?.control?.operation === "account"
		? account(id, email)
		: { status: 404, body: { detail: "no script" } };

const ops = (prefix) => sent.filter((r) => r.op.startsWith(prefix));
const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
	}
};
const waitMs = async (ms) => {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, ms));
	});
	await settle();
};

const mounted = [];
afterEach(async () => {
	while (mounted.length) await mounted.pop()();
	opened = [];
	clipboard = [];
	clipboardRefuses = false;
	window.localStorage.clear();
	focusManager.setFocused(undefined);
});

/** Mount `element` (a function of nothing) under a fresh client and router. */
async function mountWith(features, scripts, element, settingsElement) {
	sent = [];
	script = { capabilities: caps(features), ...scripts };
	const client = new QueryClient({
		defaultOptions: {
			...defaultQueryOptions,
			mutations: { ...defaultQueryOptions.mutations, gcTime: 0 },
		},
	});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	await act(async () => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client },
				createElement(
					MemoryRouter,
					{ initialEntries: ["/chat"] },
					createElement(
						Routes,
						null,
						createElement(Route, { path: "/chat", element: element() }),
						createElement(Route, {
							path: "/settings",
							element: settingsElement
								? settingsElement()
								: createElement("p", { "data-at": "settings" }, "SETTINGS"),
						}),
					),
				),
			),
		);
	});
	await settle();
	let down = false;
	const teardown = async () => {
		if (down) return;
		down = true;
		await act(async () => root.unmount());
		client.clear();
		container.remove();
	};
	mounted.push(teardown);
	return {
		client,
		text: () => container.textContent,
		has: (selector) => container.querySelector(selector) !== null,
		attr: (selector, name) =>
			container.querySelector(selector)?.getAttribute(name) ?? null,
		alertText: () =>
			container.querySelector('[role="alert"]')?.textContent ?? null,
		// The block's spinners are the unlabelled `<Spinner />` (aria-hidden, no
		// role), so a role query never saw them (QA Q2): count the animation.
		spinners: () => container.querySelectorAll(".animate-spin").length,
		container,
		button: (label) =>
			[...container.querySelectorAll("button")].find((b) =>
				b.textContent.includes(label),
			),
		buttonLabels: () =>
			[...container.querySelectorAll("button")].map((b) => b.textContent),
		unmount: teardown,
		root,
	};
}

const mountBlock = (features, plan, props = {}, extra = {}) =>
	mountWith(
		features,
		{
			"tunnel.setup.read": ok({ ...plan, source: "local", ready: false }),
			"tunnel.setup.plan": ok(plan),
			"radient.request": radientAs("acct_1", "owner@example.test"),
			...extra,
		},
		() => createElement(PhoneAccessBlock, { offerSignIn: false, ...props }),
	);

const press = async (node) => {
	await act(async () => {
		node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
	await settle();
};

/* ---------------------------------------------------------------------------
 * Capability absent: today's block, for every new kind.
 * ------------------------------------------------------------------------- */

const NEW_KINDS = [
	blocked(
		"billing_lapsed",
		"balance",
		"add_credit",
		"Billing lapsed sentence.",
		{
			remedy: {
				kind: "add_credit",
				text: "Billing lapsed sentence.",
				command: null,
				url: CONSOLE,
			},
		},
	),
	blocked(
		"disabled",
		"disabled",
		"open_console",
		"Turned off in console sentence.",
		{
			remedy: {
				kind: "open_console",
				text: "Turned off in console sentence.",
				command: null,
				url: CONSOLE,
			},
		},
	),
	blocked("network", "network", "wait_network", "Offline sentence."),
	blocked(
		"radient_unavailable",
		"radient_unavailable",
		"wait_radient",
		"Outage sentence.",
	),
	blocked(
		"reconnecting",
		"reconnecting",
		"wait_reconnect",
		"Reconnecting sentence.",
	),
	blocked(
		"stopped",
		"stopped",
		"resume_explicitly",
		"Deliberately stopped sentence.",
	),
	blocked(
		"owner_missing",
		"owner_missing",
		"restore_owner",
		"Owner missing sentence.",
	),
];

for (const plan of NEW_KINDS) {
	test(`capability absent: ${plan.remedy.kind} renders today's block (backend sentence + Check again only)`, async () => {
		const view = await mountBlock(TODAY, plan, { offerSignIn: true });
		assert.ok(
			view.text().includes(plan.remedy.text),
			"backend sentence verbatim",
		);
		assert.deepEqual(view.buttonLabels(), ["Check again"]);
		assert.ok(!view.has("[data-phone-waiting]"), "no waiting line");
		assert.ok(!view.text().includes("turned off on this computer"));
		assert.deepEqual(
			ops("radient."),
			[],
			"no account read without the capability",
		);
		assert.deepEqual(opened, []);
		await view.unmount();
	});
}

test("capability absent: verified keeps today's 'open the URL' instruction and no app step", async () => {
	const verified = answer({
		step: "complete",
		verified: true,
		configured: true,
		url: "https://exact.fixture.example.test",
		remedy: null,
	});
	const view = await mountBlock(TODAY, verified);
	assert.ok(
		view
			.text()
			.includes(
				"Open the URL above and sign in with the same Radient account.",
			),
	);
	assert.ok(!view.has("[data-phone-next-step]"));
	await view.unmount();
});

test("capability absent: no refetch on window focus", async () => {
	const view = await mountBlock(TODAY, answer());
	const before = ops("tunnel.setup.plan").length;
	await act(async () => {
		focusManager.setFocused(false);
		focusManager.setFocused(true);
	});
	await settle();
	assert.equal(ops("tunnel.setup.plan").length, before);
	await view.unmount();
});

/* ---------------------------------------------------------------------------
 * With the capability: one control per kind.
 * ------------------------------------------------------------------------- */

test("add_credit: 'Add credit' opens exactly the backend's https remedy.url and never runs setup", async () => {
	const plan = NEW_KINDS[0];
	const view = await mountBlock(REMEDIES, plan);
	assert.ok(view.text().includes("Billing lapsed sentence."));
	assert.deepEqual(view.buttonLabels(), ["Add credit", "Check again"]);
	await press(view.button("Add credit"));
	assert.deepEqual(opened, [CONSOLE]);
	assert.deepEqual(ops("tunnel.setup.run"), []);
	await view.unmount();
});

test("open_console: 'Open Radient console' opens the backend's link", async () => {
	const view = await mountBlock(REMEDIES, NEW_KINDS[1]);
	assert.deepEqual(view.buttonLabels(), [
		"Open Radient console",
		"Check again",
	]);
	await press(view.button("Open Radient console"));
	assert.deepEqual(opened, [CONSOLE]);
	await view.unmount();
});

test("a console kind with no link, or a non-https link, gets no link button", async () => {
	for (const url of [
		null,
		"javascript:alert(1)",
		"http://console.example.test/",
	]) {
		const plan = blocked("balance", "balance", "add_credit", "No link.", {
			remedy: { kind: "add_credit", text: "No link.", command: null, url },
		});
		const view = await mountBlock(REMEDIES, plan);
		assert.deepEqual(view.buttonLabels(), ["Check again"], String(url));
		await view.unmount();
	}
	assert.equal(
		phoneRemedyLink(
			answer({ remedy: { kind: "add_credit", text: "", url: "not a url" } }),
		),
		null,
	);
});

for (const plan of NEW_KINDS.slice(2, 5)) {
	test(`${plan.remedy.kind}: static line, Last checked and a quiet Check again - no spinner, no fix button`, async () => {
		const view = await mountBlock(REMEDIES, plan);
		assert.ok(view.has("[data-phone-waiting]"));
		assert.equal(
			view.attr("[data-phone-waiting]", "data-remedy-kind"),
			plan.remedy.kind,
		);
		assert.ok(view.text().includes(plan.remedy.text));
		assert.match(view.text(), LAST_CHECKED_SECONDS);
		assert.deepEqual(view.buttonLabels(), ["Check again"]);
		assert.equal(view.spinners(), 0, "waiting is not working: no spinner");
		await view.unmount();
	});
}

test("stopped (backend not ready): the plain sentence, the backend's own remedy, Check again; no Turn on", async () => {
	const view = await mountBlock(REMEDIES, NEW_KINDS[5]);
	assert.ok(
		view.text().includes("Phone access is turned off on this computer."),
	);
	assert.ok(view.text().includes("Deliberately stopped sentence."));
	assert.deepEqual(view.buttonLabels(), ["Check again"]);
	await view.unmount();
});

test("stopped (backend ready): Turn on sends ONE run for the plan's own owner, no price", async () => {
	const plan = { ...NEW_KINDS[5], ready: true };
	const view = await mountBlock(
		REMEDIES,
		plan,
		{},
		{
			"tunnel.setup.run": ok(
				answer({
					step: "complete",
					verified: true,
					configured: true,
					url: "https://x.example.test",
					remedy: null,
				}),
			),
		},
	);
	assert.ok(
		view.text().includes("Phone access is turned off on this computer."),
	);
	assert.ok(
		!view.text().includes("Deliberately stopped sentence."),
		"the terminal sentence is not needed beside Turn on",
	);
	await press(view.button("Turn on"));
	assert.deepEqual(
		ops("tunnel.setup.run").map((r) => [r.credentialId, r.acceptMonthlyPrice]),
		[[17, undefined]],
	);
	await view.unmount();
});

test("restore_owner: the existing browser sign-in is the fix in the Settings mount", async () => {
	const view = await mountBlock(REMEDIES, NEW_KINDS[6], { offerSignIn: true });
	assert.ok(view.text().includes("Owner missing sentence."));
	assert.deepEqual(view.buttonLabels(), ["Continue in browser", "Check again"]);
	await view.unmount();
});

test("sign_in, run, reconnect, accept_quote, check_status keep one primary control each", async () => {
	const cases = [
		[
			blocked("login", "login", "sign_in", "Sign in first.", {
				credential_id: null,
			}),
			{ offerSignIn: true },
			["Continue in browser", "Check again"],
		],
		[answer(), {}, ["Set up phone access", "Check again"]],
		[answer({ step: "reconnect" }), {}, ["Reconnect", "Check again"]],
		[
			answer({
				step: "quote",
				blocked_on: "quote",
				quote: {
					monthly_price_usd: "0.05",
					positive_balance: true,
					eligible: false,
					account_valid: true,
				},
				remedy: {
					kind: "accept_quote",
					text: "Accept only if you agree:",
					command: null,
					url: null,
				},
			}),
			{},
			["Activate for USD 0.05 a month", "Check again"],
		],
		[
			blocked(
				"verification",
				"verification",
				"check_status",
				"Not yet confirmed.",
			),
			{},
			["Check again"],
		],
	];
	for (const [plan, props, labels] of cases) {
		const view = await mountBlock(REMEDIES, plan, props);
		assert.deepEqual(view.buttonLabels(), labels, plan.remedy.kind);
		await view.unmount();
	}
});

test("an unknown kind still falls back to the backend sentence and Check again", async () => {
	const view = await mountBlock(
		REMEDIES,
		blocked("future", "future", "brand_new_kind", "Future sentence."),
	);
	assert.ok(view.text().includes("Future sentence."));
	assert.deepEqual(view.buttonLabels(), ["Check again"]);
	await view.unmount();
});

/* ---------------------------------------------------------------------------
 * Reconnecting (U10) and focus.
 * ------------------------------------------------------------------------- */

test("reconnecting re-asks on its own, a press during it is not an error, and it ends on the backend's answer", async () => {
	const reconnecting = NEW_KINDS[4];
	let current = reconnecting;
	const view = await mountWith(
		REMEDIES,
		{
			"tunnel.setup.read": ok({ ...reconnecting, source: "local" }),
			"tunnel.setup.plan": () => ok(current),
			"radient.request": radientAs("acct_1", "owner@example.test"),
		},
		() => createElement(PhoneAccessBlock, { offerSignIn: false }),
	);
	assert.ok(view.has("[data-phone-waiting]"));
	await press(view.button("Check again"));
	assert.equal(
		view.alertText(),
		null,
		"a press during reconnecting is not a failure",
	);
	assert.ok(view.has("[data-phone-waiting]"));
	const before = ops("tunnel.setup.plan").length;
	current = answer({
		step: "complete",
		verified: true,
		configured: true,
		url: "https://done.example.test",
		remedy: null,
	});
	await waitMs(3300);
	assert.ok(
		ops("tunnel.setup.plan").length > before,
		"polled while reconnecting",
	);
	assert.ok(
		view.has('[data-phone-verified="true"]'),
		"settled on the backend's verified answer",
	);
	const settled = ops("tunnel.setup.plan").length;
	await waitMs(3300);
	assert.equal(
		ops("tunnel.setup.plan").length,
		settled,
		"the poll stops once reconnecting ends",
	);
	assert.deepEqual(ops("tunnel.setup.run"), []);
	await view.unmount();
});

test("with the capability, window focus asks for a fresh plan", async () => {
	const view = await mountBlock(REMEDIES, NEW_KINDS[2]);
	const before = ops("tunnel.setup.plan").length;
	await act(async () => {
		focusManager.setFocused(false);
		focusManager.setFocused(true);
	});
	await settle();
	assert.equal(ops("tunnel.setup.plan").length, before + 1);
	await view.unmount();
});

test("a Radient sign-in that settles on another account re-plans", async () => {
	let who = radientAs("acct_1", "one@example.test");
	const view = await mountWith(
		REMEDIES,
		{
			"tunnel.setup.read": ok({ ...NEW_KINDS[2], source: "local" }),
			"tunnel.setup.plan": ok(NEW_KINDS[2]),
			"radient.request": (r) => who(r),
		},
		() => createElement(PhoneAccessBlock, { offerSignIn: false }),
	);
	await settle();
	const before = ops("tunnel.setup.plan").length;
	who = radientAs("acct_2", "two@example.test");
	await act(async () => {
		await view.client.invalidateQueries({ queryKey: ["radient-user"] });
	});
	await settle();
	assert.ok(
		ops("tunnel.setup.plan").length > before,
		"re-planned for the new account",
	);
	await view.unmount();
});

test("verified with the capability: the native-app step names the signed-in email; the URL stays as the alternative", async () => {
	const verified = answer({
		step: "complete",
		verified: true,
		configured: true,
		url: "https://exact.fixture.example.test",
		remedy: null,
	});
	const view = await mountBlock(REMEDIES, verified);
	await settle();
	assert.ok(
		view
			.text()
			.includes(
				"Install Local Operator on your phone and sign in as owner@example.test.",
			),
	);
	assert.ok(
		view.text().includes("Or open this address in your phone’s browser"),
	);
	assert.ok(view.text().includes("https://exact.fixture.example.test"));
	assert.ok(!view.text().includes("Open the URL above"));
	await view.unmount();
});

test("Last checked reads in seconds, minutes and hours", () => {
	const now = 10_000_000;
	assert.equal(phoneCheckedAgo(now, now), "1 second ago");
	assert.equal(phoneCheckedAgo(now - 42_000, now), "42 seconds ago");
	assert.equal(phoneCheckedAgo(now - 5 * 60_000, now), "5 minutes ago");
	assert.equal(phoneCheckedAgo(now - 2 * 3_600_000, now), "2 hours ago");
});

/* ---------------------------------------------------------------------------
 * Copy diagnostics.
 * ------------------------------------------------------------------------- */

const DOCTOR = {
	version: 1,
	tunnel: { state: "parked", reason: "billing_lapsed" },
	phone_password: "(withheld)",
};
const DIAG = { ...REMEDIES, mobile_doctor: 1 };

test("Copy diagnostics copies the doctor JSON, shows Copied, then resets", async () => {
	const view = await mountBlock(
		DIAG,
		NEW_KINDS[2],
		{ diagnostics: true },
		{
			"mobile.doctor": ok(DOCTOR),
		},
	);
	assert.deepEqual(ops("mobile.doctor"), [], "never prefetched");
	await press(view.button("Copy diagnostics"));
	assert.equal(ops("mobile.doctor").length, 1);
	assert.deepEqual(JSON.parse(clipboard[0]), DOCTOR);
	assert.equal(
		view.attr("[data-phone-diagnostics]", "data-phone-diagnostics"),
		"copied",
	);
	assert.ok(view.button("Copied"));
	await waitMs(2200);
	assert.equal(
		view.attr("[data-phone-diagnostics]", "data-phone-diagnostics"),
		"idle",
	);
	assert.ok(view.button("Copy diagnostics"));
	await view.unmount();
});

test("Copy diagnostics says so when the read fails, and when the clipboard refuses", async () => {
	const failing = await mountBlock(
		DIAG,
		NEW_KINDS[2],
		{ diagnostics: true },
		{
			"mobile.doctor": { status: 500, body: "<html>upstream</html>" },
		},
	);
	await press(failing.button("Copy diagnostics"));
	assert.equal(
		failing.alertText(),
		"Diagnostics could not be copied. Try again.",
	);
	assert.deepEqual(clipboard, []);
	await failing.unmount();

	clipboardRefuses = true;
	const refused = await mountBlock(
		DIAG,
		NEW_KINDS[2],
		{ diagnostics: true },
		{
			"mobile.doctor": ok(DOCTOR),
		},
	);
	await press(refused.button("Copy diagnostics"));
	assert.equal(
		refused.alertText(),
		"Diagnostics could not be copied. Try again.",
	);
	await refused.unmount();
});

test("Copy diagnostics is absent without features.mobile_doctor, and on a mount that does not ask for it", async () => {
	const noCap = await mountBlock(
		REMEDIES,
		NEW_KINDS[2],
		{ diagnostics: true },
		{ "mobile.doctor": ok(DOCTOR) },
	);
	assert.ok(!noCap.button("Copy diagnostics"));
	await noCap.unmount();
	const panel = await mountBlock(
		DIAG,
		NEW_KINDS[2],
		{ diagnostics: false },
		{ "mobile.doctor": ok(DOCTOR) },
	);
	assert.ok(!panel.button("Copy diagnostics"));
	await panel.unmount();
	assert.deepEqual(ops("mobile.doctor"), []);
});

test("transport: mobile.doctor is a bare GET of the doctor route", () => {
	assert.ok(desktopRequestSchema.safeParse({ op: "mobile.doctor" }).success);
	assert.ok(
		!desktopRequestSchema.safeParse({ op: "mobile.doctor", extra: 1 }).success,
	);
	assert.deepEqual(desktopEndpoint({ op: "mobile.doctor" }), {
		path: "/v1/desktop/mobile/doctor",
		method: "GET",
	});
});

/* ---------------------------------------------------------------------------
 * The first-sign-in offer card.
 * ------------------------------------------------------------------------- */

const mountOffer = (
	features,
	local,
	who = radientAs("acct_1", "one@example.test"),
) =>
	mountWith(
		features,
		{
			"tunnel.setup.read": ok({ ...local, source: "local" }),
			"radient.request": who,
		},
		() => createElement(PhoneAccessOffer),
	);

test("offer: signed in with no phone access shows the card; Set up only navigates (no plan, no run)", async () => {
	const view = await mountOffer(
		REMEDIES,
		answer({ configured: false, ready: false }),
	);
	assert.ok(view.has("[data-phone-offer]"));
	assert.ok(view.text().includes("Use Local Operator from your phone?"));
	assert.ok(
		view
			.text()
			.includes("Any monthly price is shown before anything is billed."),
	);
	await press(view.button("Set up phone access"));
	assert.ok(view.has('[data-at="settings"]'), "navigated to Settings");
	assert.deepEqual(
		ops("tunnel.setup").map((r) => r.op),
		["tunnel.setup.read"],
	);
	await view.unmount();
});

test("offer: Not now hides it and is remembered for THIS account on this machine only", async () => {
	const first = await mountOffer(
		REMEDIES,
		answer({ configured: false, ready: false }),
	);
	await press(first.button("Not now"));
	assert.ok(!first.has("[data-phone-offer]"));
	assert.deepEqual(
		JSON.parse(window.localStorage.getItem(PHONE_OFFER_DISMISSED_KEY)),
		["acct_1"],
	);
	await first.unmount();

	const again = await mountOffer(
		REMEDIES,
		answer({ configured: false, ready: false }),
	);
	assert.ok(
		!again.has("[data-phone-offer]"),
		"still dismissed after a remount",
	);
	assert.deepEqual(ops("tunnel.setup"), [], "a dismissed offer asks nothing");
	await again.unmount();

	const other = await mountOffer(
		REMEDIES,
		answer({ configured: false, ready: false }),
		radientAs("acct_2", "two@example.test"),
	);
	assert.ok(
		other.has("[data-phone-offer]"),
		"another account is still asked once",
	);
	await other.unmount();
});

test("offer: absent when phone access exists, when signed out, and without the capability", async () => {
	const configured = await mountOffer(REMEDIES, answer({ configured: true }));
	assert.ok(!configured.has("[data-phone-offer]"));
	await configured.unmount();

	const signedOut = await mountOffer(
		REMEDIES,
		answer({ configured: false }),
		() => ({
			// The backend's no-credential answer (`radient_no_credential`), which the
			// account read classifies as signed out rather than retrying.
			status: 409,
			body: {
				detail: {
					code: "radient_no_credential",
					message: "Sign in to Radient",
				},
			},
		}),
	);
	assert.ok(!signedOut.has("[data-phone-offer]"));
	assert.deepEqual(
		ops("tunnel.setup"),
		[],
		"no setup read before an account is known",
	);
	await signedOut.unmount();

	const today = await mountOffer(TODAY, answer({ configured: false }));
	assert.ok(!today.has("[data-phone-offer]"));
	assert.deepEqual(ops("tunnel.setup"), []);
	await today.unmount();
});

/* ---------------------------------------------------------------------------
 * Round-1 remediation (PR #1910): reviewer F1/F2/N1, UX U1-U5, design D2/N2.
 * ------------------------------------------------------------------------- */

const VERIFIED = answer({
	step: "complete",
	verified: true,
	configured: true,
	url: "https://done.example.test",
	remedy: null,
});
const CHECK_FAILED = /could not be checked/;
const WHITESPACE = /\s+/;
const classes = (element) => element.className.split(WHITESPACE);

/** The block on a plan script the test can change between polls. */
const mountScripted = (plan, props = {}) =>
	mountWith(
		REMEDIES,
		{
			"tunnel.setup.read": ok({ ...NEW_KINDS[4], source: "local" }),
			"tunnel.setup.plan": () => plan(),
			"radient.request": radientAs("acct_1", "owner@example.test"),
		},
		() => createElement(PhoneAccessBlock, { offerSignIn: false, ...props }),
	);

test("F1: reconnecting, one failed poll, then verified shows verified and no alert", async () => {
	let reply = ok(NEW_KINDS[4]);
	const view = await mountScripted(() => reply);
	assert.ok(view.has("[data-phone-waiting]"));
	reply = { status: 500, body: "<html>upstream</html>" };
	await waitMs(3300);
	assert.match(
		view.alertText() ?? "",
		CHECK_FAILED,
		"precondition: the failed background poll is shown",
	);
	reply = ok(VERIFIED);
	await waitMs(3300);
	assert.ok(
		view.has('[data-phone-verified="true"]'),
		"the next successful answer replaces the failed re-check",
	);
	assert.equal(view.alertText(), null);
	assert.deepEqual(ops("tunnel.setup.run"), []);
	await view.unmount();
});

test("F1: a run's failure is NOT cleared by a later plan", async () => {
	const view = await mountWith(
		REMEDIES,
		{
			"tunnel.setup.read": ok({ ...answer(), source: "local", ready: false }),
			"tunnel.setup.plan": ok(answer()),
			"tunnel.setup.run": { status: 500, body: "<html>upstream</html>" },
			"radient.request": radientAs("acct_1", "owner@example.test"),
		},
		() => createElement(PhoneAccessBlock, { offerSignIn: false }),
	);
	await press(view.button("Set up phone access"));
	const runFailure = view.alertText();
	assert.ok(runFailure && !CHECK_FAILED.test(runFailure), runFailure);
	await act(async () => {
		focusManager.setFocused(false);
		focusManager.setFocused(true);
	});
	await settle();
	assert.equal(
		view.alertText(),
		runFailure,
		"a fresh plan does not undo a run",
	);
	await view.unmount();
});

test("F2: choosing another account after this window's run re-enables focus re-checks", async () => {
	const choices = [
		{ id: 17, identity_label: "a***@example.test" },
		{ id: 23, identity_label: "b***@example.test" },
	];
	const view = await mountWith(
		REMEDIES,
		{
			"tunnel.setup.read": ok({ ...answer(), source: "local", ready: false }),
			"tunnel.setup.plan": (request) =>
				ok(request.credentialId === 23 ? NEW_KINDS[2] : answer()),
			// The run answers with a choice, so this window's own result is on
			// screen (focus refetch paused) while an account can still be chosen.
			"tunnel.setup.run": ok(
				answer({
					step: "owner_choice",
					ready: false,
					credential_id: null,
					identity_label: null,
					blocked_on: "choose_account",
					remedy: {
						kind: "choose_account",
						text: "Choose the intended account.",
						command: null,
						url: null,
					},
					credential_choices: choices,
				}),
			),
			"radient.request": radientAs("acct_1", "owner@example.test"),
		},
		() => createElement(PhoneAccessBlock, { offerSignIn: false }),
	);
	await press(view.button("Set up phone access"));
	await press(view.button("b***@example.test, credential 23"));
	const before = ops("tunnel.setup.plan").length;
	await act(async () => {
		focusManager.setFocused(false);
		focusManager.setFocused(true);
	});
	await settle();
	assert.equal(
		ops("tunnel.setup.plan").length,
		before + 1,
		"the chosen account's plan is re-asked on focus",
	);
	assert.equal(ops("tunnel.setup.plan").at(-1).credentialId, 23);
	await view.unmount();
});

test("N1: the 3 s reconnecting poll stops when the block unmounts", async () => {
	const view = await mountBlock(REMEDIES, NEW_KINDS[4]);
	assert.ok(view.has("[data-phone-waiting]"));
	// Unmount the block only: the QueryClient stays alive, so a timer left armed
	// by an observer would still fire against it.
	await act(async () => view.root.render(createElement("div")));
	const before = ops("tunnel.setup.plan").length;
	await waitMs(3400);
	assert.equal(ops("tunnel.setup.plan").length, before);
	assert.equal(
		view.client
			.getQueryCache()
			.find({ queryKey: ["desktop", "tunnel", "setup", "fresh", null] }),
		undefined,
	);
	await view.unmount();
});

test("U3b: a state change that removes the focused button moves focus to the block's heading", async () => {
	let current = NEW_KINDS[4];
	const view = await mountScripted(() => ok(current));
	const checkAgain = view.button("Check again");
	checkAgain.focus();
	assert.equal(document.activeElement, checkAgain);
	current = VERIFIED;
	await waitMs(3300);
	assert.ok(view.has('[data-phone-verified="true"]'));
	assert.ok(!checkAgain.isConnected, "the focused button was replaced");
	assert.ok(
		document.activeElement?.hasAttribute("data-phone-heading"),
		`focus landed on ${document.activeElement?.tagName}`,
	);
	assert.equal(document.activeElement.getAttribute("tabindex"), "-1");
	await view.unmount();
});

test("U3b: focus that left the block for another control is never pulled back", async () => {
	let current = NEW_KINDS[4];
	const view = await mountScripted(() => ok(current));
	const outside = document.createElement("button");
	document.body.append(outside);
	view.button("Check again").focus();
	outside.focus();
	current = VERIFIED;
	await waitMs(3300);
	assert.ok(view.has('[data-phone-verified="true"]'));
	assert.equal(document.activeElement, outside);
	outside.remove();
	await view.unmount();
});

test("U4: one polite live region announces Connected and, after Check again, Last checked", async () => {
	let current = NEW_KINDS[4];
	const view = await mountScripted(() => ok(current));
	const live = view.container.querySelector("[data-phone-announcement]");
	assert.equal(live.getAttribute("aria-live"), "polite");
	assert.equal(live.textContent, "", "nothing is said on open");
	await press(view.button("Check again"));
	assert.match(live.textContent, LAST_CHECKED_SECONDS);
	const first = live.textContent;
	await press(view.button("Check again"));
	assert.match(live.textContent, LAST_CHECKED_SECONDS);
	assert.notEqual(
		live.textContent,
		first,
		"a repeat press is re-announced (the text differs)",
	);
	current = VERIFIED;
	await waitMs(3300);
	assert.ok(view.has('[data-phone-verified="true"]'));
	assert.equal(
		view.container.querySelector("[data-phone-announcement]"),
		live,
		"the region stayed mounted across the swap",
	);
	assert.equal(live.textContent, "Phone access is connected.");
	await view.unmount();
});

test("U4: a background move into reconnecting is announced", async () => {
	let current = NEW_KINDS[2];
	const view = await mountScripted(() => ok(current));
	const live = view.container.querySelector("[data-phone-announcement]");
	current = NEW_KINDS[4];
	await act(async () => {
		focusManager.setFocused(false);
		focusManager.setFocused(true);
	});
	await settle();
	assert.equal(live.textContent, "Phone access is reconnecting.");
	await view.unmount();
});

test("U5: Copy diagnostics says Copying while busy, keeps focus, and explains it is redacted", async () => {
	let release;
	const view = await mountBlock(
		DIAG,
		NEW_KINDS[2],
		{ diagnostics: true },
		{
			"mobile.doctor": () =>
				new Promise((resolve) => {
					release = () => resolve(ok(DOCTOR));
				}),
		},
	);
	const button = view.button("Copy diagnostics");
	const help = document.getElementById(button.getAttribute("aria-describedby"));
	assert.ok(help && view.container.contains(help));
	assert.equal(
		help.textContent,
		"A redacted report on phone access for this computer. It’s safe to paste to whoever is helping you.",
	);
	button.focus();
	await press(button);
	assert.equal(button.textContent, "Copying diagnostics…");
	assert.equal(button.getAttribute("aria-disabled"), "true");
	assert.equal(button.getAttribute("aria-busy"), "true");
	assert.equal(document.activeElement, button, "focus stays on the button");
	await press(button);
	assert.equal(ops("mobile.doctor").length, 1, "a busy press asks nothing");
	await act(async () => release());
	await settle();
	assert.equal(button.textContent, "Copied");
	assert.equal(button.getAttribute("aria-disabled"), null);
	assert.equal(clipboard.length, 1);
	await view.unmount();
});

const offerScripts = (local = answer({ configured: false, ready: false })) => ({
	"tunnel.setup.read": ok({ ...local, source: "local" }),
	"tunnel.setup.plan": ok(answer()),
	"radient.request": radientAs("acct_1", "one@example.test"),
});

test("U3a + D2/N2: Not now hands focus to the next foot control; the card keeps its height and a medium title", async () => {
	const view = await mountWith(REMEDIES, offerScripts(), () =>
		createElement(
			"div",
			null,
			createElement(PhoneAccessOffer),
			createElement(
				"button",
				{ type: "button", "data-account-row": "" },
				"Fixture Owner",
			),
		),
	);
	const card = view.container.querySelector("[data-phone-offer]");
	assert.ok(classes(card).includes("shrink-0"));
	assert.ok(classes(card.querySelector("p")).includes("font-medium"));
	const notNow = view.button("Not now");
	notNow.focus();
	await press(notNow);
	assert.ok(!view.has("[data-phone-offer]"));
	assert.equal(
		document.activeElement?.getAttribute("data-account-row"),
		"",
		`focus landed on ${document.activeElement?.tagName}`,
	);
	await view.unmount();
});

test("U3c: Set up phone access lands focus on the Phone access block in Settings, once", async () => {
	const view = await mountWith(
		REMEDIES,
		offerScripts(),
		() => createElement(PhoneAccessOffer),
		() =>
			createElement(PhoneAccessBlock, {
				offerSignIn: true,
				diagnostics: true,
				searchRow: "radient.phone-access",
			}),
	);
	await press(view.button("Set up phone access"));
	assert.ok(view.has("[data-phone-block]"), "navigated to the block");
	const heading = view.container.querySelector("[data-phone-heading]");
	assert.equal(document.activeElement, heading);
	await view.unmount();
	// The intent was consumed: a later Settings visit lands nowhere special.
	const later = await mountWith(REMEDIES, offerScripts(), () =>
		createElement(PhoneAccessBlock, { offerSignIn: true }),
	);
	assert.ok(
		!document.activeElement?.hasAttribute("data-phone-heading"),
		"no stale landing",
	);
	await later.unmount();
});

test("U1: the collapsed sidebar offers the same card from an icon; Not now there is remembered", async () => {
	const view = await mountWith(REMEDIES, offerScripts(), () =>
		createElement(
			"div",
			null,
			createElement(PhoneAccessOfferIcon),
			createElement("button", { type: "button", "data-gear": "" }, "Gear"),
		),
	);
	const icon = view.container.querySelector("[data-phone-offer-icon]");
	assert.ok(icon, "the icon shows when the card would");
	assert.equal(
		icon.getAttribute("aria-label"),
		"Use Local Operator from your phone?",
	);
	await press(icon);
	// The popover portals to <body>.
	const card = document.querySelector("[data-phone-offer]");
	assert.ok(card, "the same card opened");
	assert.ok(
		card.textContent.includes(
			"Any monthly price is shown before anything is billed.",
		),
	);
	const notNow = [...card.querySelectorAll("button")].find(
		(b) => b.textContent === "Not now",
	);
	await press(notNow);
	assert.equal(view.container.querySelector("[data-phone-offer-icon]"), null);
	assert.equal(document.querySelector("[data-phone-offer]"), null);
	assert.deepEqual(
		JSON.parse(window.localStorage.getItem(PHONE_OFFER_DISMISSED_KEY)),
		["acct_1"],
	);
	assert.equal(document.activeElement?.getAttribute("data-gear"), "");
	await view.unmount();

	const today = await mountWith(TODAY, offerScripts(), () =>
		createElement(PhoneAccessOfferIcon),
	);
	assert.ok(
		!today.has("[data-phone-offer-icon]"),
		"no icon without the capability",
	);
	await today.unmount();
});

test("U2: the Settings mount is a search row, so 'phone' and 'mobile' find Phone access", async () => {
	const settings = await mountBlock(REMEDIES, NEW_KINDS[2], {
		offerSignIn: true,
		searchRow: "radient.phone-access",
	});
	const entries = buildRenderedEntries(settings.container);
	assert.equal(entries.length, 1);
	assert.equal(entries[0].id, "page:radient.phone-access");
	assert.equal(entries[0].label, "Phone access");
	for (const query of ["phone", "mobile", "remote access"]) {
		const { results } = searchSettings(entries, query, 50);
		assert.equal(results.length, 1, `"${query}" finds the block`);
	}
	await settings.unmount();
	const panel = await mountBlock(REMEDIES, NEW_KINDS[2]);
	assert.deepEqual(
		buildRenderedEntries(panel.container),
		[],
		"the panel mount is not a settings row",
	);
	await panel.unmount();
});
