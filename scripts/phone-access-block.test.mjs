import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, afterEach, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * PHONE ACCESS BLOCK - what the user is shown for each backend answer, and what
 * the app is allowed to send.
 *
 * Rendered (not asserted over a selector) against a real `QueryClient`, with the
 * desktop bridge (`window.api.desktop.request`) as the only stub, because the
 * defects this guards live in which branch renders and in which requests leave:
 *
 *  - NO CAPABILITY, NO REQUEST: without `features.tunnel_setup` the block is
 *    absent and the bridge sees zero setup ops (the negative control for every
 *    case below, which all assert they DID see some).
 *  - SUCCESS IS `verified: true` ONLY: a configured, connected-looking, ready
 *    answer with `verified: false` must carry no success styling.
 *  - THE PRICE ON THE BUTTON IS THE PRICE SENT: the run body carries the exact
 *    string the backend quoted, for the explicitly shown account.
 *  - A 409 `setup_in_progress` IS "setting up", rebuilt from the backend, not an
 *    error and not a local flag.
 *  - A 5xx, a body that is not JSON and the saved-intent refusal all land on the
 *    block's own generic sentence, never on the raw text that arrived.
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
/** op -> () => {status, body}; the per-case script. */
let script = {};
globalThis.window.api = {
	openExternal: () => undefined,
	desktop: {
		request: async (request) => {
			sent.push(request);
			const reply = script[request.op];
			if (!reply) return { status: 404, body: { detail: "no script" } };
			const next = typeof reply === "function" ? reply(request) : reply;
			return next;
		},
	},
};

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { PhoneAccessBlock } from "./src/renderer/src/features/providers/phone-access-block";
 export { defaultQueryOptions } from "./src/renderer/src/shared/api/query-client";
			export { desktopEndpoint, desktopRequestSchema, desktopRequestDeadlineMs, PHONE_SETUP_REFUSAL_CODES } from "./src/shared/desktop-contract";
			export { classifyPhoneSetupError, derivePhoneSetupView } from "./src/renderer/src/shared/hooks/use-phone-setup";
			export { DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";
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
	`./_phone-access-block-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	QueryClient,
	QueryClientProvider,
	PhoneAccessBlock,
	defaultQueryOptions,
	desktopEndpoint,
	desktopRequestSchema,
	desktopRequestDeadlineMs,
	PHONE_SETUP_REFUSAL_CODES,
	classifyPhoneSetupError,
	derivePhoneSetupView,
	DesktopControlError,
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

/** One backend answer, with every field the contract guarantees. */
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

const quoted = (price = "0.05") =>
	answer({
		step: "quote",
		blocked_on: "quote",
		quote: {
			monthly_price_usd: price,
			positive_balance: true,
			eligible: false,
			account_valid: true,
		},
		remedy: {
			kind: "accept_quote",
			text: "Accept only if you agree:",
			command:
				"lop tunnel setup apply --credential-id 17 --accept-monthly-price 0.05",
			url: null,
		},
	});

const verified = () =>
	answer({
		step: "complete",
		verified: true,
		configured: true,
		url: "https://exact.fixture.example.test",
		remedy: null,
	});

const setupOps = () => sent.filter((r) => r.op.startsWith("tunnel.setup"));
const settle = async () => {
	for (let i = 0; i < 6; i += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
	}
};

/** Every mounted view, so a test that FAILS part-way still tears down. */
const mounted = [];
afterEach(async () => {
	// A failed assertion skips the test body's own `unmount()`, and an un-cleared
	// QueryClient keeps its GC/poll timers alive, so a FAILING run would idle until
	// the runner's bound instead of reporting. Teardown here is unconditional.
	while (mounted.length) await mounted.pop()();
});

async function mount(features, scripts, sharedClient) {
	sent = [];
	script = { capabilities: caps(features), ...scripts };
	// `sharedClient` lets a second mount reuse the first one's cache, which is what
	// re-opening a pane in the real app does (one QueryClient per window). Without
	// it a "re-open" test passes for ANY cache policy.
	const client =
		sharedClient ??
		new QueryClient({
			// No query `gcTime` override: the hook's own cache policy is the subject.
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
				createElement(PhoneAccessBlock, { offerSignIn: false }),
			),
		);
	});
	await settle();
	let down = false;
	const teardown = async () => {
		if (down) return;
		down = true;
		await act(async () => root.unmount());
		if (!sharedClient) client.clear();
		container.remove();
	};
	mounted.push(teardown);
	return {
		client,
		container,
		text: () => container.textContent,
		// BOOLEANS, never nodes, are what assertions see. `assert.equal(node, null)`
		// that FAILS makes node's assert deep-inspect a jsdom element to print a diff,
		// which walks the whole window/document graph and grew past 100 GB when a
		// defect-injection run made one fail. A boolean fails with `false !== true`.
		has: (selector) => container.querySelector(selector) !== null,
		alertText: () =>
			container.querySelector('[role="alert"]')?.textContent ?? null,
		// A real node for the CLICK only; callers must not hand it to `assert`.
		button: (label) =>
			[...container.querySelectorAll("button")].find((b) =>
				b.textContent.includes(label),
			),
		unmount: teardown,
	};
}

const press = async (node) => {
	await act(async () => {
		node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
	await settle();
};

test("without the tunnel_setup capability the block is absent and NO setup op is sent", async () => {
	const view = await mount(
		{ tunnel: 1 },
		{
			"tunnel.setup.read": ok(answer()),
			"tunnel.setup.plan": ok(answer()),
		},
	);
	assert.ok(
		!view.has("[data-phone-block]"),
		"unexpected element: " + "[data-phone-block]",
	);
	assert.equal(view.text(), "");
	assert.deepEqual(setupOps(), []);
	await view.unmount();
});

test("with the capability the SAME harness does send setup ops (the control for the case above)", async () => {
	const view = await mount(
		{ tunnel_setup: 1 },
		{
			"tunnel.setup.read": ok(answer({ source: "local", ready: false })),
			"tunnel.setup.plan": ok(answer()),
		},
	);
	assert.deepEqual(
		setupOps().map((r) => r.op),
		["tunnel.setup.read", "tunnel.setup.plan"],
	);
	await view.unmount();
});

test("verified:true shows the exact URL with success styling and zero POST runs", async () => {
	const view = await mount(
		{ tunnel_setup: 1 },
		{
			"tunnel.setup.read": ok(verified()),
			"tunnel.setup.plan": ok(verified()),
		},
	);
	const verifiedNode = view.container.querySelector("[data-phone-verified]");
	assert.ok(verifiedNode, "the verified state rendered");
	assert.ok(view.text().includes("https://exact.fixture.example.test"));
	assert.ok(view.text().includes("Connected"));
	assert.ok(view.has(".text-success"), "missing element: " + ".text-success");
	assert.equal(
		setupOps().filter((r) => r.op === "tunnel.setup.run").length,
		0,
		"a healthy first open must send no run",
	);
	assert.ok(
		view
			.text()
			.includes(
				"Open the URL above and sign in with the same Radient account.",
			),
	);
	await view.unmount();
});

test("verified:false never gets the success treatment, even when everything else looks ready", async () => {
	const view = await mount(
		{ tunnel_setup: 1 },
		{
			"tunnel.setup.read": ok(answer({ source: "local", configured: true })),
			"tunnel.setup.plan": ok(
				answer({
					step: "verification",
					blocked_on: "verification",
					configured: true,
					ready: false,
					url: "https://must-not-be-shown.example.test",
					remedy: {
						kind: "check_status",
						text: "Not yet confirmed.",
						command: null,
						url: null,
					},
				}),
			),
		},
	);
	assert.ok(
		!view.has("[data-phone-verified]"),
		"unexpected element: " + "[data-phone-verified]",
	);
	assert.ok(
		!view.has(".text-success"),
		"unexpected element: " + ".text-success",
	);
	assert.ok(!view.text().includes("Connected"));
	assert.ok(
		!view.text().includes("must-not-be-shown"),
		"no URL without verified",
	);
	assert.ok(view.text().includes("Not yet confirmed."));
	await view.unmount();
});

test("a quote shows the masked account, credential N, the exact price and the consent, and the button sends that exact price", async () => {
	const view = await mount(
		{ tunnel_setup: 1 },
		{
			"tunnel.setup.read": ok(answer({ source: "local", ready: false })),
			"tunnel.setup.plan": ok(quoted("0.05")),
			"tunnel.setup.run": ok(verified()),
		},
	);
	const text = view.text();
	assert.ok(
		text.includes("a***@example.test"),
		"masked identity from the backend",
	);
	assert.ok(text.includes("credential 17"));
	assert.ok(text.includes("USD 0.05 a month"));
	assert.ok(text.includes("does not purchase credit"));
	assert.ok(
		text.includes("Accept only if you agree:"),
		"backend lead-in verbatim",
	);
	const activate = view.button("Activate for USD 0.05 a month");
	assert.ok(activate, "one primary action carries the price");
	await press(activate);
	const runs = setupOps().filter((r) => r.op === "tunnel.setup.run");
	assert.equal(runs.length, 1);
	assert.deepEqual(
		{
			credentialId: runs[0].credentialId,
			acceptMonthlyPrice: runs[0].acceptMonthlyPrice,
		},
		{ credentialId: 17, acceptMonthlyPrice: "0.05" },
	);
	assert.ok(
		view.has("[data-phone-verified]"),
		"missing element: " + "[data-phone-verified]",
	);
	await view.unmount();
});

test("a no-activation plan runs WITHOUT a price, and a double press sends one run", async () => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	const view = await mount(
		{ tunnel_setup: 1 },
		{
			"tunnel.setup.read": ok(answer({ source: "local", ready: false })),
			"tunnel.setup.plan": ok(answer()),
			"tunnel.setup.run": () => gate.then(() => ok(verified())),
		},
	);
	const go = view.button("Set up phone access");
	assert.ok(go);
	assert.ok(
		!view.text().includes("USD"),
		"no price when no activation is required",
	);
	await press(go);
	await press(go);
	release();
	await settle();
	const runs = setupOps().filter((r) => r.op === "tunnel.setup.run");
	assert.equal(runs.length, 1, "one press, one POST");
	assert.equal(runs[0].acceptMonthlyPrice, undefined);
	await view.unmount();
});

test("several accounts: the block lists them by masked label and never picks one", async () => {
	const view = await mount(
		{ tunnel_setup: 1 },
		{
			"tunnel.setup.read": ok(
				answer({
					source: "local",
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
					credential_choices: [
						{ id: 17, identity_label: "a***@example.test" },
						{ id: 23, identity_label: "b***@example.test" },
					],
				}),
			),
			"tunnel.setup.plan": ok(
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
					credential_choices: [
						{ id: 17, identity_label: "a***@example.test" },
						{ id: 23, identity_label: "b***@example.test" },
					],
				}),
			),
		},
	);
	assert.ok(view.button("a***@example.test, credential 17"));
	assert.ok(view.button("b***@example.test, credential 23"));
	assert.ok(
		!view.button("Set up phone access"),
		"unexpected button: " + "Set up phone access",
	);
	assert.equal(setupOps().filter((r) => r.op === "tunnel.setup.run").length, 0);
	await press(view.button("b***@example.test, credential 23"));
	const plans = setupOps().filter((r) => r.op === "tunnel.setup.plan");
	assert.equal(
		plans.at(-1).credentialId,
		23,
		"the next question is about the chosen account",
	);
	await view.unmount();
});

test("the backend reporting a live run renders Setting up with its progress, from the backend alone", async () => {
	const view = await mount(
		{ tunnel_setup: 1 },
		{
			"tunnel.setup.read": ok(
				answer({
					source: "local",
					ready: false,
					in_progress: true,
					blocked_on: "in_progress",
					progress: [
						"Checking the selected account and required preparation before changes.",
						"Applying - preparing the background connector.",
					],
					active_credential_id: 17,
				}),
			),
			"tunnel.setup.plan": ok(answer()),
		},
	);
	assert.ok(view.text().includes("Setting up"));
	assert.ok(
		view.text().includes("Applying - preparing the background connector."),
	);
	assert.ok(
		!view.button("Set up phone access"),
		"no second owner while one runs",
	);
	assert.equal(
		setupOps().filter((r) => r.op === "tunnel.setup.plan").length,
		0,
		"no fresh plan is asked while the backend reports a run",
	);
	await view.unmount();
});

test("a 409 setup_in_progress on run becomes Setting up, not a failure banner", async () => {
	let read = 0;
	const view = await mount(
		{ tunnel_setup: 1 },
		{
			"tunnel.setup.read": () => {
				read += 1;
				return read === 1
					? ok(answer({ source: "local", ready: false }))
					: ok(
							answer({
								source: "local",
								ready: false,
								in_progress: true,
								blocked_on: "in_progress",
								// The backend's first line is the fixed "checking" text every
								// request writes; a run appends its steps after it.
								progress: ["Checking.", "Applying."],
								active_credential_id: 17,
							}),
						);
			},
			"tunnel.setup.plan": ok(answer()),
			"tunnel.setup.run": {
				status: 409,
				body: {
					detail: {
						code: "setup_in_progress",
						params: {},
						text: "Phone access setup is already in progress. Check its status before retrying.",
					},
				},
			},
		},
	);
	await press(view.button("Set up phone access"));
	assert.ok(!view.has('[role="alert"]'), "no error banner");
	assert.ok(view.text().includes("Setting up"));
	await view.unmount();
});

test("5xx, non-JSON and the saved-intent refusal use the block's own sentence, never the raw text", async () => {
	for (const [name, reply] of [
		[
			"5xx html",
			{ status: 500, body: "<html>Internal Server Error SECRET_TRACE</html>" },
		],
		["not json", { status: 200, body: "plainly not json SECRET_TRACE" }],
		[
			"setup_intent_corrupt",
			{
				status: 503,
				body: {
					detail: {
						code: "setup_intent_corrupt",
						params: {},
						text: "Leave create.json unchanged SECRET_TRACE",
					},
				},
			},
		],
	]) {
		const view = await mount(
			{ tunnel_setup: 1 },
			{ "tunnel.setup.read": reply, "tunnel.setup.plan": reply },
		);
		// Text, not the node: a failing assert would deep-inspect a React element.
		const alertText = view.alertText();
		assert.ok(alertText !== null, `${name}: a failure state renders`);
		assert.ok(
			alertText.includes("could not be checked, and nothing was changed"),
			`${name}: the block's own check sentence`,
		);
		assert.ok(!view.text().includes("SECRET_TRACE"), `${name}: no raw text`);
		assert.ok(view.button("Check again"), `${name}: a retry exists`);
		assert.ok(
			!view.has(".text-success"),
			"unexpected element: " + ".text-success",
		);
		await view.unmount();
	}
});

test("a declared deadline or unavailable refusal shows the backend's sentence verbatim", async () => {
	const reply = {
		status: 504,
		body: {
			detail: {
				code: "setup_deadline",
				params: {},
				text: "Backend deadline sentence after drain.",
			},
		},
	};
	const view = await mount(
		{ tunnel_setup: 1 },
		{ "tunnel.setup.read": reply, "tunnel.setup.plan": reply },
	);
	assert.ok(view.text().includes("Backend deadline sentence after drain."));
	await view.unmount();
});

test("a sign-in blocker offers NO second sign-in button in the provider panel mount", async () => {
	const login = answer({
		step: "login",
		blocked_on: "login",
		ready: false,
		credential_id: null,
		identity_label: null,
		remedy: {
			kind: "sign_in",
			text: "Sign in first.",
			command: "lop login radient",
			url: null,
		},
	});
	const view = await mount(
		{ tunnel_setup: 1 },
		{
			"tunnel.setup.read": ok({ ...login, source: "local" }),
			"tunnel.setup.plan": ok(login),
		},
	);
	assert.ok(view.text().includes("Sign in first."));
	assert.ok(
		!view.button("Continue in browser"),
		"unexpected button: " + "Continue in browser",
	);
	assert.ok(
		!view.text().includes("lop login radient"),
		"the command is a report, not copy",
	);
	await view.unmount();
});

/** A real wait: the hook's poll cadence is a product constant, not a test knob. */
const waitPoll = async () => {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 3300));
	});
	await settle();
};

const running = (progress) =>
	answer({
		source: "local",
		ready: false,
		in_progress: true,
		blocked_on: "in_progress",
		progress,
		active_credential_id: 17,
	});

test("M1: a run THIS window started shows the backend's progress while the run POST is still pending", async () => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	let started = false;
	let reads = 0;
	const view = await mount(
		{ tunnel_setup: 1 },
		{
			"tunnel.setup.read": () => {
				reads += 1;
				return ok(
					started
						? running([
								"Checking the selected account before changes.",
								"Applying - preparing the background connector.",
							])
						: answer({ source: "local", ready: false }),
				);
			},
			"tunnel.setup.plan": ok(answer()),
			"tunnel.setup.run": () => {
				started = true;
				return gate.then(() => {
					started = false; // the backend no longer reports a live run
					return ok(verified());
				});
			},
		},
	);
	const before = reads;
	await press(view.button("Set up phone access"));
	assert.ok(
		view.text().includes("a***@example.test"),
		"own run keeps its masked account before the first poll",
	);
	try {
		await waitPoll();
		assert.ok(
			reads > before,
			"the local read is asked again while the run POST is pending",
		);
		assert.ok(
			view.text().includes("Applying - preparing the background connector."),
			"the backend's own progress line is shown for our own run",
		);
		assert.ok(view.text().includes("Setting up"));
	} finally {
		// A failing assertion must not leave the run pending: a pending mutation
		// keeps the process alive until the runner's bound.
		release();
	}
	await settle();
	assert.ok(view.has("[data-phone-verified]"), "the run's own answer lands");
});

test("M1b: the poll seeing the run END before the run POST resolves does not re-plan over the run's own receipts", async () => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	let phase = "idle";
	let plans = 0;
	const view = await mount(
		{ tunnel_setup: 1 },
		{
			"tunnel.setup.read": () =>
				ok(
					phase === "live"
						? running(["Checking.", "Applying - installing."])
						: answer({ source: "local", ready: false }),
				),
			"tunnel.setup.plan": () => {
				plans += 1;
				return ok(plans === 1 ? answer() : answer({ receipts: [] }));
			},
			"tunnel.setup.run": () => {
				phase = "live";
				return gate.then(() =>
					ok({
						...verified(),
						receipts: [{ step: "installation", ok: true, text: "OWN RECEIPT" }],
					}),
				);
			},
		},
	);
	await press(view.button("Set up phone access"));
	await waitPoll(); // poll sees it live
	phase = "idle"; // backend finishes; the POST answer has NOT reached us yet
	await waitPoll(); // poll sees live -> idle while the run is still pending
	release();
	await settle();
	await settle();
	assert.equal(plans, 1, "no plan was sent over our own run");
	assert.ok(
		view.text().includes("OWN RECEIPT"),
		"the run's receipts are what is shown",
	);
});

test("m1: a plan refused with 409 while no run is live ends in Check again, never an empty Checking", async () => {
	const view = await mount(
		{ tunnel_setup: 1 },
		{
			"tunnel.setup.read": ok(answer({ source: "local", ready: false })),
			"tunnel.setup.plan": {
				status: 409,
				body: {
					detail: {
						code: "setup_in_progress",
						params: {},
						text: "Phone access setup is already in progress. Check its status before retrying.",
					},
				},
			},
		},
	);
	await settle();
	assert.ok(view.button("Check again"), "a control exists");
	assert.ok(!view.text().includes("Checking"), "not stuck on Checking");
});

test("m2: re-opening the pane plans again, so a price from an earlier open is never shown", async () => {
	// ONE client for both opens, created here so the first mount's teardown does not
	// clear it: the cache surviving an unmount is exactly what is under test.
	const windowClient = new QueryClient({
		defaultOptions: {
			...defaultQueryOptions,
			mutations: { ...defaultQueryOptions.mutations, gcTime: 0 },
		},
	});
	const first = await mount(
		{ tunnel_setup: 1 },
		{
			"tunnel.setup.read": ok(answer({ source: "local", ready: false })),
			"tunnel.setup.plan": ok(quoted("0.05")),
		},
		windowClient,
	);
	assert.ok(first.text().includes("USD 0.05"));
	await first.unmount();
	const second = await mount(
		{ tunnel_setup: 1 },
		{
			"tunnel.setup.read": ok(answer({ source: "local", ready: false })),
			"tunnel.setup.plan": ok(quoted("0.07")),
		},
		windowClient,
	);
	try {
		assert.ok(
			second.text().includes("USD 0.07"),
			"the new open shows the new price",
		);
		assert.ok(!second.text().includes("USD 0.05"), "the old price is gone");
	} finally {
		await second.unmount();
		windowClient.clear();
	}
});

for (const [name, reply] of [
	[
		"transport failure",
		{
			status: 503,
			body: {
				detail: { code: "transport.failed", message: "raw transport text" },
			},
		},
	],
	[
		"client deadline",
		{
			status: 504,
			body: {
				detail: { code: "deadline_exceeded", message: "raw deadline text" },
			},
		},
	],
]) {
	test(`m3: a run that ends without the backend's answer (${name}) is unconfirmed: no failure, no second run, then re-planned`, async () => {
		let ended = false;
		let pressed = false;
		let plans = 0;
		const view = await mount(
			{ tunnel_setup: 1 },
			{
				"tunnel.setup.read": () =>
					ok(
						ended || !pressed
							? answer({ source: "local", ready: false })
							: running(["Checking.", "Applying - installing."]),
					),
				"tunnel.setup.plan": () => {
					plans += 1;
					return ok(plans === 1 ? answer() : verified());
				},
				"tunnel.setup.run": () => {
					pressed = true;
					return reply;
				},
			},
		);
		await press(view.button("Set up phone access"));
		assert.ok(!view.has('[role="alert"]'), "never a failure banner");
		assert.ok(!view.text().includes("raw "), "no raw transport text");
		assert.ok(view.text().includes("Setting up"));
		ended = true;
		await waitPoll();
		const runs = setupOps().filter((r) => r.op === "tunnel.setup.run").length;
		assert.equal(runs, 1, "exactly one run was ever sent");
		assert.ok(
			view.has("[data-phone-verified]"),
			"the re-plan says it ended connected",
		);
	});
}

test("n2: another owner's mere plan (one fixed line, no run steps) is not labelled Setting up", async () => {
	const view = await mount(
		{ tunnel_setup: 1 },
		{
			"tunnel.setup.read": ok(running(["Checking the selected account."])),
			"tunnel.setup.plan": ok(answer()),
		},
	);
	assert.ok(!view.text().includes("Setting up"), "does not overclaim a setup");
	assert.ok(view.text().includes("Checking"));
});

// U2/Q1: import the REAL app policy, including mutations.retry=1. Only GC time is
// shortened by mount() for teardown; never replace retry with a hand-written default.
for (const scenario of ["409", "deadline", "transport"]) {
	test(`production policy: ONE gesture ONE run after ${scenario}, both while writer active and after it finishes`, async () => {
		assert.equal(
			defaultQueryOptions.mutations.retry,
			1,
			"negative control requires the real app retry1 policy",
		);
		let phase = "idle";
		let plans = 0;
		const view = await mount(
			{ tunnel_setup: 1 },
			{
				"tunnel.setup.read": () =>
					ok(
						phase === "active"
							? running(["Checking.", "Applying - worker active."])
							: answer({ source: "local", ready: false }),
					),
				"tunnel.setup.plan": () => ok(++plans === 1 ? answer() : verified()),
				"tunnel.setup.run": () => {
					phase = "active";
					if (scenario === "transport") throw new Error("lost IPC response");
					return {
						status: scenario === "409" ? 409 : 504,
						body: {
							detail: {
								code:
									scenario === "409"
										? "setup_in_progress"
										: "deadline_exceeded",
								message: "fixture loss",
							},
						},
					};
				},
			},
		);
		await press(view.button("Set up phone access"));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 1700));
		});
		await settle();
		assert.equal(
			setupOps().filter((r) => r.op === "tunnel.setup.run").length,
			1,
			"no automatic replay while writer active",
		);
		phase = "finished";
		await waitPoll();
		await settle();
		assert.equal(
			setupOps().filter((r) => r.op === "tunnel.setup.run").length,
			1,
			"no automatic replay after writer finishes",
		);
	});
}

test("declared partial outcomes retain canonical backend copy independently of receipts", async () => {
	const view = await mount(
		{ tunnel_setup: 1 },
		{
			"tunnel.setup.read": ok(answer({ source: "local", ready: false })),
			"tunnel.setup.plan": ok(
				answer({
					step: "failed",
					blocked_on: "failed",
					ready: false,
					billing_outcome: "unconfirmed",
					reservation_outcome: "saved",
					failure_stage: "installation",
					remedy: {
						kind: "check_status",
						text: "BACKEND REMEDY VERBATIM",
						command: null,
						url: null,
					},
					receipts: [{ step: "billing", ok: true, text: "RECEIPT VERBATIM" }],
				}),
			),
		},
	);
	assert.ok(
		view
			.text()
			.includes(
				"Billing: activation was requested but its outcome is unconfirmed.",
			),
	);
	assert.ok(
		view
			.text()
			.includes(
				"Phone address: reservation saved on this computer; retry reuses it.",
			),
	);
	assert.ok(
		view.text().includes("Did not finish: background connector installation."),
	);
	assert.ok(view.text().includes("BACKEND REMEDY VERBATIM"));
	assert.ok(view.text().includes("RECEIPT VERBATIM"));
});

test("a settled block is quiet: no further requests, from any state, once answers are in", async () => {
	// The guard against a render/poll loop. Every state is mounted, allowed to settle,
	// then left alone for several more settle windows; the request count must not move.
	// Numbers, not nodes, are what is asserted (see `has` in `mount`).
	const states = {
		verified: ok(verified()),
		quoted: ok(quoted("0.05")),
		ready: ok(answer()),
	};
	for (const [name, plan] of Object.entries(states)) {
		const view = await mount(
			{ tunnel_setup: 1 },
			{
				"tunnel.setup.read": ok(answer({ source: "local" })),
				"tunnel.setup.plan": plan,
			},
		);
		const afterSettle = sent.length;
		await settle();
		await settle();
		await settle();
		assert.equal(sent.length, afterSettle, `${name}: requests kept coming`);
		// One capabilities read, one local read, one plan: three, never a stream.
		assert.ok(afterSettle <= 3, `${name}: ${afterSettle} requests to settle`);
		await view.unmount();
	}
});

test("transport: three ops, one route, required owner for run, string price, deadlines above the backend's", () => {
	assert.deepEqual(desktopEndpoint({ op: "tunnel.setup.read" }), {
		path: "/v1/desktop/tunnel/setup",
		method: "GET",
	});
	assert.deepEqual(
		desktopEndpoint({ op: "tunnel.setup.read", credentialId: 17 }),
		{
			path: "/v1/desktop/tunnel/setup?credential_id=17",
			method: "GET",
		},
	);
	assert.deepEqual(desktopEndpoint({ op: "tunnel.setup.plan" }).body, {
		action: "plan",
	});
	assert.deepEqual(
		desktopEndpoint({
			op: "tunnel.setup.run",
			credentialId: 17,
			acceptMonthlyPrice: "0.05",
		}).body,
		{ action: "run", credential_id: 17, accept_monthly_price: "0.05" },
	);
	assert.deepEqual(
		desktopEndpoint({ op: "tunnel.setup.run", credentialId: 17 }).body,
		{ action: "run", credential_id: 17 },
	);
	const parses = (r) => desktopRequestSchema.safeParse(r).success;
	assert.equal(
		parses({ op: "tunnel.setup.run" }),
		false,
		"run without an owner is refused before the wire",
	);
	assert.equal(parses({ op: "tunnel.setup.run", credentialId: "17" }), false);
	assert.equal(
		parses({
			op: "tunnel.setup.run",
			credentialId: 17,
			acceptMonthlyPrice: 0.05,
		}),
		false,
		"a number price is refused",
	);
	assert.equal(
		parses({
			op: "tunnel.setup.plan",
			credentialId: 17,
			acceptMonthlyPrice: "0.05",
		}),
		false,
		"plan never carries a price",
	);
	// Strictly above the backend's 120 s plan and 900 s run budgets.
	assert.ok(desktopRequestDeadlineMs("tunnel.setup.plan") > 120_000);
	assert.ok(desktopRequestDeadlineMs("tunnel.setup.run") > 900_000);
	assert.ok(PHONE_SETUP_REFUSAL_CODES.has("setup_in_progress"));
});

test("classification and view derivation: in-progress is not a failure; a failure beats a stale answer", () => {
	const refusal = (code) =>
		new DesktopControlError(409, "text", undefined, code);
	assert.equal(
		classifyPhoneSetupError(refusal("setup_in_progress"), "run"),
		"in-progress",
	);
	assert.deepEqual(
		classifyPhoneSetupError(refusal("setup_intent_corrupt"), "check"),
		{ kind: "generic", during: "check" },
	);
	assert.deepEqual(classifyPhoneSetupError(new Error("boom"), "run"), {
		kind: "generic",
		during: "run",
	});
	const stale = answer();
	assert.equal(
		derivePhoneSetupView({
			enabled: true,
			local: undefined,
			fresh: stale,
			failure: { kind: "generic", during: "check" },
			runPending: false,
		}).kind,
		"failure",
	);
	assert.equal(
		derivePhoneSetupView({
			enabled: true,
			local: { ...stale, in_progress: true },
			fresh: stale,
			failure: null,
			runPending: false,
		}).kind,
		"applying",
		"a backend-reported run outranks a stale plan",
	);
	assert.equal(
		derivePhoneSetupView({
			enabled: false,
			local: undefined,
			fresh: undefined,
			failure: null,
			runPending: false,
		}).kind,
		"hidden",
	);
});
