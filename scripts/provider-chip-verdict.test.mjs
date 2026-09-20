#!/usr/bin/env node
/**
 * The provider chip's input: the login verdict, not the credential row.
 *
 * THE REPORT. On the operator's own machine, at one second, the chat composer
 * said the Radient sign-in "needs re-authentication" while Settings -> Radient
 * account rendered BOTH "You are not currently signed in" AND a green "Signed
 * in" chip under it (UX round 1, U1, on the chat session-issue PR). The chip was
 * keyed on `provider.configured` / `has_credential`, which are facts about the
 * CREDENTIAL STORE: a revoked grant kept its row, kept `configured` true because
 * its access token was still inside its expiry, and left `disabled_cause` NULL,
 * so nothing in the census could tell a working sign-in from a dead one.
 *
 * WHAT IS PROVEN HERE, and why each half needs its own case:
 *
 *  - the PREDICATE, over the shipped module: `login_required` refuses a claim,
 *    while `unknown`, an absent verdict and a verdict about ANOTHER provider all
 *    keep the store's own answer (the direction that matters is "do not send a
 *    machine with a working login to a sign-in it does not need");
 *  - the READ: the shipped hook, mounted against a real `QueryClient` and the
 *    shipped transport, parsing `GET /v1/auth/status`' payload through the
 *    `accounts.list` op. A seeded cache key would prove nothing about this half;
 *  - the SURFACES: the shipped grid card and the shipped detail panel, which are
 *    the two places this change is visible. They are mounted rather than
 *    rendered statically, because the claim is that the surface READS the
 *    verdict -- a component that stopped calling the hook would still render a
 *    seeded cache.
 *
 * WHAT THIS IS NOT. Proof of layout, of colour, or of the live app: jsdom has no
 * layout engine, so the frames are the evidence rig's business. The badge's TEXT
 * and its `title` are asserted, not its pixels.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const bundle = await build({
	stdin: {
		contents: `
			export { ProviderGrid } from "./src/renderer/src/features/providers/provider-grid";
			export { ProviderDetail } from "./src/renderer/src/features/providers/provider-detail";
			export {
				providerReadiness,
				loginRefused,
			} from "./src/renderer/src/features/providers/provider-labels";
			export { desktopKeys } from "./src/renderer/src/shared/api/local-operator/desktop-hooks";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { createRoot } from "react-dom/client";
		`,
		loader: "ts",
		resolveDir: process.cwd(),
	},
	tsconfig: "tsconfig.web.json",
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	// Stylesheets, fonts and images carry no assertion here, and Node can import
	// neither.
	loader: {
		".css": "empty",
		".png": "empty",
		".svg": "empty",
		".jpg": "empty",
		".webp": "empty",
		".woff": "empty",
		".woff2": "empty",
	},
	/*
	 * `import.meta.env` belongs to the bundler and this is not the bundler: the
	 * module graph reads it while it is being evaluated.
	 */
	define: { "import.meta.env": "globalThis.__RIG_ENV__" },
	write: false,
});
const bundlePath = new URL(
	`./_provider-chip-verdict-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);

/*
 * THE DOM, INSTALLED BEFORE THE GRAPH IS EVALUATED. Modules in this graph reach
 * for `localStorage` and the preload bridge as they are evaluated, so a missing
 * document is an import-time throw rather than a render-time one, and
 * `http://localhost/` rather than jsdom's default opaque origin is load-bearing
 * for the same reason: a store that resolves `localStorage` once, at import,
 * stays storage-less for the whole file if that read throws.
 */
const bootstrapDOM = new JSDOM("<!doctype html>", { url: "http://localhost/" });
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
globalThis.localStorage = bootstrapDOM.window.localStorage;
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

/**
 * The census the bridge serves: the row the incident was about, and a control.
 *
 * `has_credential` and `configured` are BOTH true on the Radient row, because
 * that pair IS the state the incident was in -- the app held a credential the
 * provider had already stopped accepting -- and it is the state the old
 * predicate read as "Signed in". The second row has no credential and must
 * answer "Needs sign-in" in every case here, so a case that accidentally blanked
 * the grid cannot pass by rendering nothing.
 */
const RADIENT_ROW = {
	id: "radient",
	name: "Radient",
	storage_id: "radient",
	search_aliases: ["radient"],
	auth_methods: [
		{
			id: "radient",
			method_id: "browser",
			label: "Sign in to Radient",
			kind: "browser",
			requires_secret_input: false,
			paste_fallback: true,
		},
	],
	local: false,
	configured: true,
	credential_optional: false,
	has_credential: true,
	stored_credentials: 1,
	base_url: null,
};

const OPENAI_ROW = {
	id: "openai",
	name: "OpenAI (ChatGPT Plus/Pro)",
	storage_id: "openai",
	search_aliases: ["openai", "gpt"],
	auth_methods: [
		{
			id: "openai",
			method_id: "api_key",
			label: "API key",
			kind: "api_key",
			requires_secret_input: true,
			paste_fallback: false,
		},
	],
	local: false,
	configured: false,
	credential_optional: false,
	has_credential: false,
	stored_credentials: 0,
	base_url: null,
};

/**
 * What the bridge answers for `accounts.list`, per case.
 *
 * The envelopes are the route's own: the verdict rides BESIDE `accounts` on
 * `GET /v1/auth/status`, and a backend older than the route answers without the
 * key at all -- which is the `"absent"` case, and the reason the key is optional
 * on the wire.
 */
const LOGIN_ANSWERS = {
	refused: {
		result: {
			accounts: [],
			radient_login: { credential_id: 7, state: "login_required" },
		},
	},
	ok: {
		result: {
			accounts: [],
			radient_login: { credential_id: 7, state: "ok" },
		},
	},
	unknown: {
		result: {
			accounts: [],
			radient_login: { credential_id: 7, state: "unknown" },
		},
	},
	absent: { result: { accounts: [] } },
};

/** Which answer the bridge gives the verdict read. Set per case. */
let loginAnswer = "refused";

globalThis.window.api = {
	desktop: {
		request: async (request) => {
			if (request?.op === "providers.list") {
				return {
					status: 200,
					body: { result: { providers: [RADIENT_ROW, OPENAI_ROW] } },
				};
			}
			if (request?.op === "accounts.list") {
				return { status: 200, body: LOGIN_ANSWERS[loginAnswer] };
			}
			return { status: 503, body: { detail: "not part of this test" } };
		},
	},
};

const {
	ProviderDetail,
	ProviderGrid,
	QueryClient,
	QueryClientProvider,
	createRoot,
	desktopKeys,
	loginRefused,
	providerReadiness,
} = await import(bundlePath.href);
await unlink(bundlePath);

const createElement = React.createElement;

/*
 * The refused statement, as the two surfaces render it. Both are asserted in a
 * case apiece, and they live at the top level because `scripts/` sits outside
 * `pnpm lint`'s path list and biome's own rule wants a literal it can see once
 * (script-lint: `useTopLevelRegex`).
 */
const REFUSED_DETAIL = /no longer accepts the sign-in stored on this machine/;
const REFUSED_DETAIL_ATTRIBUTE =
	/title="Radient no longer accepts the sign-in stored on this machine"/;

/** The text a user reads, with the markup's own whitespace collapsed. */
function text(root) {
	return (root.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** How many times a phrase appears in the text a user is shown. */
function occurrences(haystack, needle) {
	return haystack.split(needle).length - 1;
}

/** One `act` flush, which is what lets a query's answer reach its render. */
async function flush() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 10));
	});
}

/**
 * A client whose per-query interval cannot outlive the case.
 *
 * `retry: false` because every read here is meant to answer on its first
 * attempt, and `gcTime: Infinity` so a case's own reads are still in the cache
 * when it asserts. The verdict read's `refetchInterval` is left exactly as the
 * hook sets it -- this file must not test a cadence it configured itself -- and
 * it is released by unmounting the last observer, which is what the cases and
 * the teardown below do.
 */
function client() {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
		},
	});
}

const mounted = [];

/**
 * Release every timer this file created, so the suite does not sit on them.
 *
 * Unmounting is not enough on its own here, and the measurement is the reason
 * this hook exists: with four mounted cases and their observers gone, this file
 * still sat for a full minute after its last assertion -- the verdict read's own
 * `refetchInterval`, which the hook sets and this file must not restate. Clearing
 * the clients destroys the queries that scheduled it, and `duration_ms` falls to
 * the tests' own cost.
 */
after(async () => {
	for (const { root, queryClient } of mounted) {
		await act(async () => {
			root.unmount();
		});
		queryClient.clear();
	}
});

/**
 * Mount a component and wait until its own DOM says something.
 *
 * A BOUNDED POLL rather than a sleep: the state under test is reached through a
 * real query, a real transport and a real render, so "how long is enough" is not
 * a number this file can know -- only a condition it can wait for. The flush
 * BEFORE the look is deliberate: a query can settle a tick before the render
 * that publishes it, so checking first would hand the assertion a snapshot from
 * before the answer.
 */
async function mountUntil(element, predicate, what, timeoutMs = 5000) {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	mounted.push({ root, queryClient: element.props.client });
	await act(async () => {
		root.render(element);
	});
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		await flush();
		if (predicate(container)) return { container, root };
		if (Date.now() > deadline) {
			throw new Error(
				`timed out after ${timeoutMs}ms waiting for ${what}; the surface reads "${text(container)}"`,
			);
		}
	}
}

/**
 * The grid, mounted, once both cards are on screen.
 *
 * The predicate is about the grid being READY rather than about either answer:
 * deciding readiness on "Signed in" or "Needs sign-in" would time out on the
 * state it is waiting for whenever the surface got that state wrong, and a
 * timeout hides the frame the assertion is about.
 */
async function renderGrid() {
	const queryClient = client();
	const { container } = await mountUntil(
		createElement(
			QueryClientProvider,
			{ client: queryClient },
			createElement(ProviderGrid, {}),
		),
		(node) =>
			node.textContent.includes("Radient") &&
			node.textContent.includes("OpenAI"),
		"the provider cards",
	);
	return { container, queryClient };
}

/** The detail panel for the Radient row, mounted and holding its own root. */
async function renderDetail() {
	const queryClient = client();
	const { container, root } = await mountUntil(
		createElement(
			QueryClientProvider,
			{ client: queryClient },
			createElement(ProviderDetail, { provider: RADIENT_ROW }),
		),
		(node) => Boolean(node.querySelector("button")),
		"the sign-in control",
	);
	return { container, root, queryClient };
}

/**
 * Flush until the verdict read has ANSWERED, so the panel is rendered from it.
 *
 * This waits on the query's own state and then reads the DOM, rather than
 * polling the DOM for the answer under test: a case whose expected answer never
 * arrives would otherwise report its own timeout instead of the frame that was
 * on screen.
 */
async function awaitVerdict(container, queryClient) {
	const deadline = Date.now() + 5000;
	for (;;) {
		const read = queryClient.getQueryState(desktopKeys.radientLogin);
		if (read?.status === "success") {
			await flush();
			return;
		}
		if (Date.now() > deadline) {
			throw new Error(
				`the verdict read never answered (saw ${read?.status}); the panel reads "${text(container)}"`,
			);
		}
		await flush();
	}
}

/**
 * The predicate, over the shipped module.
 *
 * Both directions are named in the cases: `login_required` is the ONE state that
 * refuses a claim, and everything else keeps the store's own answer. A predicate
 * that treated `unknown` as a refusal would pass a test written only about the
 * incident and fail a machine that is merely offline.
 */
test("the verdict refuses a claim on login_required, and on nothing else", () => {
	assert.equal(
		loginRefused("radient", { credential_id: 7, state: "login_required" }),
		true,
	);
	assert.equal(
		loginRefused("radient", { credential_id: 7, state: "ok" }),
		false,
	);
	// A check that could not RUN is not a verdict about the login.
	assert.equal(
		loginRefused("radient", { credential_id: 7, state: "unknown" }),
		false,
	);
	// A backend older than the route answers without the key at all.
	assert.equal(loginRefused("radient", undefined), false);
	assert.equal(loginRefused("radient", null), false);
	// The verdict is about ONE provider's login, so it cannot refuse another's.
	assert.equal(
		loginRefused("openai", { credential_id: 7, state: "login_required" }),
		false,
	);
});

test("the chip keeps 'Signed in' for every answer except the refusal", () => {
	assert.equal(
		providerReadiness(RADIENT_ROW, loginRefused("radient", { state: "ok" }))
			.label,
		"Signed in",
	);
	for (const verdict of [{ state: "unknown" }, undefined, null]) {
		assert.equal(
			providerReadiness(RADIENT_ROW, loginRefused("radient", verdict)).label,
			"Signed in",
			`${JSON.stringify(verdict)} must keep the store's own answer`,
		);
	}
	const refused = providerReadiness(
		RADIENT_ROW,
		loginRefused("radient", { state: "login_required" }),
	);
	assert.equal(refused.label, "Needs sign-in");
	// The group is what the model picker and the picker's own filter bucket on, so
	// a chip that stopped saying "Signed in" but stayed in "Ready to use" would
	// contradict itself on the next surface.
	assert.equal(refused.group, "Needs sign-in");
	assert.equal(refused.tone, "neutral");
	assert.match(refused.detail, REFUSED_DETAIL);
	// A row with no credential at all reads the same in both worlds: the change
	// corrects a claim, it does not invent one.
	assert.equal(providerReadiness(OPENAI_ROW, false).label, "Needs sign-in");
});

/**
 * The grid card, driven through the shipped hook and the shipped transport.
 *
 * This is the case that fails before the fix: the census row carries a
 * credential, so the old predicate said "Signed in" in the success tone for a
 * login the backend had already refused.
 */
test("the grid card stops claiming a sign-in the verdict refuses", async () => {
	loginAnswer = "refused";
	const { container } = await renderGrid();
	const rendered = text(container);
	assert.equal(
		occurrences(rendered, "Signed in"),
		0,
		`no card may claim a sign-in while the verdict refuses one: ${rendered}`,
	);
	assert.equal(occurrences(rendered, "Needs sign-in"), 2, rendered);
	// The long form still reaches the card's tooltip, so the short label did not
	// lose the reason it is short.
	assert.match(container.innerHTML, REFUSED_DETAIL_ATTRIBUTE);
});

test("the grid card still claims the sign-in a healthy verdict allows", async () => {
	loginAnswer = "ok";
	const { container } = await renderGrid();
	const rendered = text(container);
	assert.equal(occurrences(rendered, "Signed in"), 1, rendered);
	assert.equal(occurrences(rendered, "Needs sign-in"), 1, rendered);
});

test("a backend that cannot answer the verdict leaves the chip as it was", async () => {
	for (const answer of ["absent", "unknown"]) {
		loginAnswer = answer;
		const { container } = await renderGrid();
		const rendered = text(container);
		assert.equal(
			occurrences(rendered, "Signed in"),
			1,
			`the "${answer}" answer must keep the store's own answer: ${rendered}`,
		);
	}
});

/**
 * The detail panel, which is the surface the incident was photographed on: its
 * green "Signed in" badge sat directly under the account section's own "You are
 * not currently signed in to Radient".
 */
test("the detail panel's badge is keyed on the verdict, not on the credential row", async () => {
	loginAnswer = "refused";
	const refused = await renderDetail();
	await awaitVerdict(refused.container, refused.queryClient);
	const refusedText = text(refused.container);
	assert.equal(occurrences(refusedText, "Signed in"), 0, refusedText);
	assert.equal(occurrences(refusedText, "Needs sign-in"), 1, refusedText);
	// A real unmount rather than a second container: the healthy half asserts
	// against a panel that rendered from its own answer, not from this one's
	// state or from a leftover DOM.
	await act(async () => {
		refused.root.unmount();
	});

	loginAnswer = "ok";
	const healthy = await renderDetail();
	await awaitVerdict(healthy.container, healthy.queryClient);
	const healthyText = text(healthy.container);
	assert.equal(occurrences(healthyText, "Signed in"), 1, healthyText);
});
