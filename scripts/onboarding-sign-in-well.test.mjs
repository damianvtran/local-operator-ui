import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE FIRST PRESS OF A STAGE SIGN-IN BUTTON KEEPS ITS WELL (review round 1:
 * R1, U1, Q-1 - one BLOCKER found by three streams).
 *
 * Every sign-in button on the first-run stage ("Continue with Radient", "Log in
 * with ChatGPT/Claude", and the search step's "Sign in with Radient") opens a
 * `ProviderDetail` with `autoStart` in a well under it. `ProviderDetail`
 * reported its mount-time `idle` phase, and both stage callers read `idle` as
 * "the user pressed Cancel", so the well unmounted in the commit it mounted:
 * the browser opened, the stage showed nothing, and the unmount paused the
 * poll, so the connection was never noticed. A second press "worked" because by
 * then the session was already active.
 *
 * Static markup cannot see this - it is an effect ordering bug - so the real
 * components are mounted in jsdom against a desktop bridge that answers the
 * auth ops, the press is a real click, and the assertions are the user's facts:
 * the button says it is waiting, the well is open, and the poll keeps reading.
 * The cancel case pins the other half: a TRANSITION into idle still closes it.
 *
 * Harness: the committed one (`onboarding-search-step.test.mjs`).
 */

const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// Accessors that refuse to be read out of context; not needed here.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
globalThis.localStorage = bootstrapDOM.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
bootstrapDOM.window.matchMedia = () => ({
	matches: false,
	addEventListener() {},
	removeEventListener() {},
	addListener() {},
	removeListener() {},
});
globalThis.ResizeObserver = bootstrapDOM.window.ResizeObserver = class {
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
	VITE_PUBLIC_POSTHOG_KEY: "",
	VITE_LOG_LEVEL: "info",
};

/*
 * The bridge: a sign-in that starts and stays pending until cancelled. `ops`
 * records every request so the poll is observable as a count, not a guess.
 */
let ops = [];
let cancelled = false;
const operation = (provider) => ({
	id: `op-${provider}`,
	provider,
	method_id: `${provider}-m`,
	state: cancelled ? "cancelled" : "pending",
	auth_url: "https://example.invalid/authorize",
	user_code: null,
	verification_uri: null,
	error: null,
	defaults_applied: null,
});
let provider = "radient";
globalThis.window.api = {
	desktop: {
		openAuthorization: async () => {
			ops.push("openAuthorization");
		},
		request: async (request) => {
			ops.push(request?.op);
			switch (request?.op) {
				case "auth.start":
					provider = request.provider;
					return { status: 200, body: { result: operation(provider) } };
				case "auth.status":
					return { status: 200, body: { result: operation(provider) } };
				case "auth.cancel":
					cancelled = true;
					return { status: 200, body: { result: operation(provider) } };
				case "credentials.list":
					return { status: 200, body: { result: { keys: [] } } };
				default:
					// Not part of this test (config, capabilities): refused, the way
					// the committed search-step harness answers them.
					return { status: 503, body: { detail: "not part of this test" } };
			}
		},
	},
};

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { ConnectProviderStep } from "./src/renderer/src/features/onboarding/components/steps/connect-provider-step";
			export { SearchApiStep } from "./src/renderer/src/features/onboarding/components/steps/search-api-step";
			export { desktopKeys } from "./src/renderer/src/shared/api/local-operator/desktop-hooks";
			export { setLocale } from "./src/i18n";
			export { createElement };
		`,
		resolveDir: process.cwd(),
		loader: "tsx",
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
	// One React (and one query cache module) shared with this file's `act`.
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
	`./_onboarding-sign-in-well-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const m = await import(bundlePath.href);
await unlink(bundlePath);
m.setLocale("en");

const method = (id) => ({
	id,
	method_id: `${id}-m`,
	label: "Browser",
	kind: "browser",
	requires_secret_input: false,
	paste_fallback: false,
});
const row = (id, name) => ({
	id,
	name,
	storage_id: id,
	search_aliases: [],
	auth_methods: [method(id)],
	local: false,
	credential_optional: false,
	has_credential: false,
	configured: false,
	stored_credentials: 0,
	base_url: null,
});
const rows = [
	row("radient", "Radient"),
	row("openai", "OpenAI (ChatGPT Plus/Pro)"),
	row("anthropic", "Anthropic (Claude)"),
];

const clients = [];
after(() => {
	for (const c of clients) c.clear();
});
const mount = async (element) => {
	ops = [];
	cancelled = false;
	const client = new m.QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				staleTime: Number.POSITIVE_INFINITY,
				gcTime: Number.POSITIVE_INFINITY,
				retryOnMount: false,
			},
			// A mutation's own five-minute GC would keep the process alive.
			mutations: { gcTime: 0 },
		},
	});
	clients.push(client);
	client.setQueryData(m.desktopKeys.providers, rows);
	client.setQueryData(["credentials"], { keys: [] });
	// The credentials read is gated on connectivity; open the gate up front.
	client.setQueryData(["server-health"], { online: true, snapshot: null });
	client.setQueryData(["internet-connectivity"], true);
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(
			React.createElement(m.QueryClientProvider, { client }, element),
		);
	});
	return {
		host,
		unmount: async () => {
			await act(async () => root.unmount());
			host.remove();
		},
	};
};

const click = async (el) => {
	assert.ok(el, "the control this case presses must be rendered");
	await act(async () => {
		el.dispatchEvent(
			new bootstrapDOM.window.MouseEvent("click", { bubbles: true }),
		);
	});
};
const settle = async (ms) => {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, ms));
	});
};
const buttonByText = (host, pattern) =>
	[...host.querySelectorAll("button")].find((b) =>
		pattern.test(b.textContent ?? ""),
	);
const count = (op) => ops.filter((entry) => entry === op).length;

const connectStep = () =>
	React.createElement(m.ConnectProviderStep, {
		providers: rows,
		isLoading: false,
		isError: false,
		onRetry() {},
		listFormat: (items) => items.join(", "),
	});

for (const [label, pattern] of [
	["Continue with Radient", /Continue with Radient/],
	["Log in with Claude", /Log in with Claude/],
]) {
	test(`W-1 one press of "${label}" opens a well that stays, says it is waiting, and keeps polling`, async () => {
		const { host, unmount } = await mount(connectStep());
		await click(buttonByText(host, pattern));
		// The poll reads at once, then every AUTH_OPERATION_POLL_MS (1.5 s): two
		// reads prove it was not paused by an unmount after its first.
		await settle(1800);
		const waiting = buttonByText(host, /Waiting for browser/);
		assert.ok(waiting, "the pressed button reads 'Waiting for browser'");
		assert.equal(waiting.getAttribute("aria-expanded"), "true");
		assert.equal(
			host.querySelectorAll(".bg-sunken").length,
			1,
			"exactly one sign-in well is open",
		);
		assert.equal(count("auth.start"), 1, "one press starts one sign-in");
		assert.ok(
			count("auth.status") >= 2,
			`the poll keeps reading (auth.status x${count("auth.status")})`,
		);
		await unmount();
	});
}

test("W-2 Cancel in the well is a transition into idle, and closes it", async () => {
	const { host, unmount } = await mount(connectStep());
	await click(buttonByText(host, /Continue with Radient/));
	await settle(100);
	assert.equal(host.querySelectorAll(".bg-sunken").length, 1);
	await click(buttonByText(host, /^Cancel$/));
	await settle(100);
	assert.equal(count("auth.cancel"), 1, "Cancel reached the backend");
	assert.equal(
		host.querySelectorAll(".bg-sunken").length,
		0,
		"the well closed on the cancel",
	);
	const button = buttonByText(host, /Continue with Radient/);
	assert.equal(button?.getAttribute("aria-expanded"), "false");
	await unmount();
});

test("W-3 the search step's Radient sign-in keeps its well on the first press", async () => {
	const { host, unmount } = await mount(
		React.createElement(m.SearchApiStep, {
			showCredentialDescription: false,
			radient: rows[0],
			radientConnected: false,
		}),
	);
	try {
		await click(buttonByText(host, /^Sign in with Radient$/));
		await settle(1800);
		assert.ok(
			buttonByText(host, /Waiting for browser/),
			"the button reads 'Waiting for browser'",
		);
		// The panel's own Cancel is the proof the well is mounted (this step's
		// well nests sunken grounds, so a class count would not say it).
		assert.ok(buttonByText(host, /^Cancel$/), "the well offers Cancel");
		assert.ok(
			count("auth.status") >= 2,
			`the poll keeps reading (auth.status x${count("auth.status")}; ops ${ops.join(",")})`,
		);
	} finally {
		await unmount();
	}
});
