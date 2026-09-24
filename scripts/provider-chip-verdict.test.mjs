#!/usr/bin/env node
/**
 * The provider chip's input: the login state, not the credential row.
 *
 * THE REPORT. On the operator's own machine, at one second, the chat composer
 * said the Radient sign-in "needs re-authentication" while Settings -> Radient
 * account rendered BOTH "You are not currently signed in" AND a green "Signed
 * in" chip under it (UX round 1, U1, on the chat session-issue PR). The chip was
 * keyed on a credential ROW, and a revoked grant keeps its row: the store keeps
 * `configured` true while the access token is inside its expiry, and
 * `disabled_cause` is never written.
 *
 * WHAT IS PROVEN HERE, and why each half needs its own case:
 *
 *  - the JOIN, over the shipped module: `loginState` refuses a claim on
 *    `login_required`, refuses one when the verdict is ABSENT and this app's own
 *    account read answers `signed-out` (design round 1's D3, the code round's
 *    M1: without that arm the fallback is the row, and the incident comes back on
 *    every runtime below `v0.61.2`), and keeps the store's answer everywhere
 *    else -- including a healthy machine whose account read failed
 *    `unavailable`, which must not be sent to a sign-in it does not need;
 *  - the RENDER, over the shipped predicate: the refused state has its own words
 *    and its own tone (D1 and D4: it used to be pixel-identical to the
 *    never-signed-in card, and its tone was the one a healthy local provider
 *    uses);
 *  - the SURFACES, mounted against a real `QueryClient`, the shipped transport
 *    and a stubbed bridge, with the bridge (not a seeded cache) answering the
 *    census, the verdict and the account read: a component that stopped asking
 *    would still render a seeded cache;
 *  - the MOUNT, which is D6: with the verdict deliberately held open, the card
 *    list must not paint a claim it is about to correct -- measured there as a
 *    green "Signed in" for 72-193 ms on a refused machine.
 *
 * WHAT THIS IS NOT. Proof of layout, of colour, or of the live app: jsdom has no
 * layout engine, so the frames are the evidence rig's business. The chip's TEXT,
 * its `title` and its tone class are asserted, not its pixels.
 */

import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, beforeEach, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const bundle = await build({
	stdin: {
		contents: `
			export { ProviderGrid } from "./src/renderer/src/features/providers/provider-grid";
			export { ProviderDetail } from "./src/renderer/src/features/providers/provider-detail";
			export { RadientAccountSection } from "./src/renderer/src/features/settings/components/radient-account-section";
			export {
				loginState,
				providerReadiness,
			} from "./src/renderer/src/features/providers/provider-labels";
			export { radientSessionIssueKey } from "./src/renderer/src/shared/hooks/use-radient-session-issue";
			export { radientUserKeys } from "./src/renderer/src/shared/hooks/use-radient-user-query";
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
 * key at all -- the `"absent"` case, and the reason the key is optional on the
 * wire. `"absent"` is the state design round 1's `r6` photographed on this
 * branch's own head, where the chip fell back to the credential row.
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
	/*
	 * The OTHER `unknown`, and the one every `unknown` fixture here used to miss
	 * (code round 2, M2): `credential_id: null` is the payload
	 * `tunnels/report.py::local_payload` returns whenever NO TUNNEL IS CONFIGURED
	 * (`config.load()` raises with no `config.json`), which is a healthy, signed-in
	 * user who has never made one. It names no credential, so it is not a verdict
	 * about any stored sign-in -- only an `unknown` that names one (the field
	 * above, QA round 1's F2) is the app declining to confirm a credential.
	 */
	"unknown-no-credential": {
		result: {
			accounts: [],
			radient_login: { credential_id: null, state: "unknown" },
		},
	},
	absent: { result: { accounts: [] } },
};

/**
 * What the bridge answers for the app's own account read, per case.
 *
 * `signed-out` is the 409 the daemon in the field answers with a bare prose
 * detail -- no `radient_` code -- which is why `classifyRadientAccountFailure`
 * reads that sentence for that status and no other. `unavailable` is a healthy
 * machine's account read being unreachable (design round 1's `r4`), and it must
 * NOT narrow the chip: it is the control that keeps a working login from being
 * sent to a sign-in it does not need.
 */
const ACCOUNT_ANSWERS = {
	/*
	 * The typed refusal the backend answers a dead grant with (`401
	 * radient_credential_refused`, `_credential_refusal`/`REASON_GRANT_INVALID`,
	 * backend `28ad4dae3`). It is a DIFFERENT class from `signed-out`: this one
	 * says Radient refused the credential this app holds. Round 1's rigs ran
	 * backend `bd53de08`, which predates that commit and classifies the same dead
	 * grant as `signed-out` -- which is why the state this PR exists for was never
	 * photographed with the sentence it actually renders (QA round 2, Q-6).
	 */
	refused: {
		status: 401,
		body: {
			detail: {
				code: "radient_credential_refused",
				message: "Radient refused the credential this app holds",
				details: { reason: "grant_invalid" },
			},
		},
	},
	"signed-out": {
		status: 409,
		body: { detail: "Sign in to Radient to access your account" },
	},
	unavailable: {
		status: 502,
		body: {
			detail: {
				code: "radient_upstream_failed",
				message: "Radient could not complete this operation",
				details: { reason: "credential_unavailable" },
			},
		},
	},
	ready: {
		status: 200,
		body: {
			result: {
				data: {
					msg: "ok",
					result: {
						account: {
							id: "acct_chip_verdict",
							tenant_id: "ten_chip_verdict",
							email: "chip-verdict@example.test",
							name: "Chip Verdict",
							role: "owner",
							status: "active",
							created_at: "2026-01-02T03:04:05Z",
							updated_at: "2026-01-02T03:04:05Z",
						},
						identity: {
							email: "chip-verdict@example.test",
							provider: "google",
							provider_id: "google-chip-verdict",
						},
					},
				},
			},
		},
	},
};

/** Which answers the bridge gives, and whether the verdict is held open. */
let loginAnswer = "refused";
let accountAnswer = "ready";
let holdVerdict = false;
/**
 * Whether the capability answer advertises `tunnel`. The verdict read is the
 * composer callout's own query and is gated on that key, so a runtime without it
 * is the absent-verdict floor reached by a different road: no read at all.
 */
let tunnelCapability = true;
/** How many times the bridge was asked for the verdict route, per case. */
let verdictRequests = 0;
/**
 * How many times the bridge was asked for the ACCOUNT read, per case.
 *
 * A COUNT rather than a spy, because the defect Q-5 reports is a rate: the
 * section's re-read loop is invisible in the rendered text at the instant you
 * look (it renders the content for ~500 ms between two spinners) and unmissable
 * in the number of reads one boot costs.
 */
let accountRequests = 0;
/**
 * The states `auth.status` serves, oldest first; the last one repeats. Empty
 * means the sign-in cases are not being exercised and the op is a 503.
 */
let authPollStates = [];
let authStarts = 0;
/**
 * The census the bridge serves, mutable so the never-signed-in machine -- no row
 * at all -- can be rendered beside the incident's own state.
 */
let census = [RADIENT_ROW, OPENAI_ROW];
/** Releases the held verdict, called from the case that held it. */
let releaseVerdict = () => {};

/**
 * Every case starts from the incident's own state, and from a bridge that is not
 * holding anything.
 *
 * The reset is not tidiness: a case that HOLDS the verdict and then fails throws
 * before it releases, and the next case would inherit both the hold and its own
 * timeout -- a failure attributed to the wrong case, which is how a mutant of the
 * grid's gate looked like it had broken the detail panel.
 */
beforeEach(() => {
	loginAnswer = "refused";
	accountAnswer = "ready";
	census = [RADIENT_ROW, OPENAI_ROW];
	holdVerdict = false;
	tunnelCapability = true;
	verdictRequests = 0;
	accountRequests = 0;
	authPollStates = [];
	authStarts = 0;
	releaseVerdict = () => {};
});

globalThis.window.api = {
	desktop: {
		request: async (request) => {
			if (request?.op === "providers.list") {
				return {
					status: 200,
					body: { result: { providers: census } },
				};
			}
			if (request?.op === "accounts.list") {
				verdictRequests += 1;
				if (holdVerdict) {
					// The state D6 is about: the census has answered and the verdict has
					// not, which is when the card list used to paint "Signed in".
					// The released value is a whole desktop response, not just the result:
					// the hook unwraps this envelope, so a half-shaped answer would be a
					// transport error rather than the verdict under test.
					return await new Promise((resolve) => {
						releaseVerdict = () =>
							resolve({ status: 200, body: LOGIN_ANSWERS[loginAnswer] });
					});
				}
				return { status: 200, body: LOGIN_ANSWERS[loginAnswer] };
			}
			if (request?.control?.operation === "account") {
				accountRequests += 1;
				return ACCOUNT_ANSWERS[accountAnswer];
			}
			/*
			 * The sign-in flow, for the case that has to prove a successful sign-in
			 * refreshes the verdict the chip reads (code round 2, M3). `auth.start`
			 * opens an operation; the poll reports `succeeded` and -- as the real
			 * backend would, having just accepted a fresh credential -- the verdict
			 * route starts answering `ok`.
			 */
			if (request?.op === "auth.start") {
				authStarts += 1;
				return {
					status: 200,
					body: {
						result: {
							id: `op-${authStarts}`,
							state: "pending",
							auth_url: "https://example.invalid/radient/sign-in",
						},
					},
				};
			}
			if (request?.op === "auth.status") {
				const state = authPollStates.shift() ?? authPollStates.at(-1);
				if (state === undefined) {
					return { status: 503, body: { detail: "no auth operation here" } };
				}
				if (state === "succeeded") loginAnswer = "ok";
				return { status: 200, body: { result: { id: request.id, state } } };
			}
			if (request?.op === "capabilities") {
				// Both reads the chip joins are gated on this answer: the account read
				// on `radient`, and the verdict (the callout's shared query) on `tunnel`.
				return {
					status: 200,
					body: {
						result: {
							desktop_available: true,
							features: tunnelCapability
								? { auth: 1, radient: 1, tunnel: 1 }
								: { auth: 1, radient: 1 },
						},
					},
				};
			}
			return { status: 503, body: { detail: "not part of this test" } };
		},
		/*
		 * Main opens the operation's URL. Nothing here has a browser to open it in,
		 * and the panel's own path is what the sign-in case is after.
		 */
		openAuthorization: async () => {},
	},
};

const {
	ProviderDetail,
	ProviderGrid,
	RadientAccountSection,
	QueryClient,
	QueryClientProvider,
	createRoot,
	radientSessionIssueKey,
	loginState,
	providerReadiness,
	radientUserKeys,
} = await import(bundlePath.href);
await unlink(bundlePath);

const createElement = React.createElement;

/*
 * The three statements this file asserts, as the surfaces render them. They live
 * at the top level because `scripts/` sits outside `pnpm lint`'s path list and
 * biome's own rule wants a literal it can see once (script-lint:
 * `useTopLevelRegex`).
 */
const REFUSED_DETAIL = /no longer accepts the sign-in stored on this machine/;
const UNVERIFIED_DETAIL =
	/could not confirm the sign-in stored on this machine/;
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
 * that publishes it.
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
 * deciding readiness on "Signed in" or a refusal would time out on the state it
 * is waiting for whenever the surface got that state wrong, and a timeout hides
 * the frame the assertion is about.
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
	/*
	 * Every grid case judges a SETTLED frame. The chip's second input is this
	 * app's own account read (see `loginState`), and the card list is deliberately
	 * not gated on it -- that read is upstream-backed with retries, and holding a
	 * provider list behind it would cost a second or more on exactly the machines
	 * where it changes nothing. So the assertion belongs after both reads have
	 * answered rather than on whichever frame the cards painted first.
	 */
	await awaitReads(container, queryClient);
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
 * Flush until both reads the chip depends on have answered.
 *
 * This waits on the QUERY STATES and then reads the DOM, rather than polling the
 * DOM for the answer under test: a case whose expected answer never arrives would
 * otherwise report its own timeout instead of the frame that was on screen.
 */
async function awaitReads(container, queryClient) {
	const deadline = Date.now() + 5000;
	for (;;) {
		const verdict = queryClient.getQueryState(radientSessionIssueKey);
		const account = queryClient.getQueryState(radientUserKeys.user());
		const settled = (state) => state && state.status !== "pending";
		/*
		 * A runtime without `tunnel` never issues the verdict read: the query is
		 * disabled, and a disabled query stays `pending` for good. That is an
		 * answer ("nothing known"), not a read still out, so the wait is for the
		 * account read alone there.
		 */
		const verdictSettled = !tunnelCapability || settled(verdict);
		/*
		 * SETTLED rather than successful: the account read has cases here that are
		 * meant to fail (`unavailable`), and a case that waited for `success` would
		 * report its own timeout instead of the frame it is about.
		 */
		if (verdictSettled && settled(account)) {
			await flush();
			return;
		}
		if (Date.now() > deadline) {
			throw new Error(
				`a read never settled (verdict ${verdict?.status}, account ${account?.status}); the panel reads "${text(container)}"`,
			);
		}
		await flush();
	}
}

/**
 * The join, over the shipped module.
 *
 * Both directions are named in the cases. `login_required` is the ONE verdict
 * that refuses a claim; an ABSENT verdict refuses one only when the app's own
 * account read says no sign-in is stored; and everything else keeps the store's
 * own answer, because sending a machine whose login is fine to a sign-in it does
 * not need is the same misdirection as the green chip, in the other direction.
 */
test("loginState refuses a claim on the refusal, and on the absent-verdict contradiction", () => {
	/** An enabled account read, which is the only one that can narrow. */
	const read = (accountRead) => ({ accountRead, unavailable: false });
	assert.equal(
		loginState(
			"radient",
			{ credential_id: 7, state: "login_required" },
			read("ready"),
		),
		"refused",
	);
	// D3/M1: no verdict at all, and this app's own account read says no sign-in is
	// stored -- the state where falling back to the credential row re-creates the
	// contradiction this change removes.
	assert.equal(
		loginState("radient", undefined, read("signed-out")),
		"unverified",
	);
	assert.equal(loginState("radient", null, read("signed-out")), "unverified");
	assert.equal(
		loginState(
			"radient",
			{ credential_id: 7, state: "unknown" },
			read("signed-out"),
		),
		"unverified",
	);
	// QA round 1's F2: an ANSWERED `unknown` -- the app asked and declined to
	// confirm (a row whose token endpoint cannot be reached). No health claim,
	// whatever the account read says.
	assert.equal(
		loginState(
			"radient",
			{ credential_id: 7, state: "unknown" },
			read("ready"),
		),
		"unverified",
	);
	assert.equal(
		loginState(
			"radient",
			{ credential_id: 7, state: "unknown" },
			read("unavailable"),
		),
		"unverified",
	);
	// A healthy machine whose account read failed `unavailable` must keep its
	// claim; so must every other class of that read, WHEN THERE IS NO VERDICT AT
	// ALL -- the runtime floor the PR body states.
	for (const account of ["unavailable", "unknown", "checking", "ready"]) {
		assert.equal(
			loginState("radient", undefined, read(account)),
			"working",
			`an absent verdict with an account read of ${account} must keep the store's answer`,
		);
	}
	/*
	 * And a read that could not be ASKED is not a reading. A capability answer
	 * without `radient` disables the query, and a disabled React Query reports no
	 * data with `isLoading === false` -- which the shared hook classifies as
	 * `signed-out`: right for the surfaces rendering its sentence, wrong as
	 * evidence about a credential row.
	 */
	assert.equal(
		loginState("radient", undefined, {
			accountRead: "signed-out",
			unavailable: true,
		}),
		"working",
	);
	// The provider accepting a sign-in is not a contradiction to be doubted.
	assert.equal(
		loginState(
			"radient",
			{ credential_id: 7, state: "ok" },
			read("signed-out"),
		),
		"working",
	);
	// The verdict is about ONE provider's login, so it cannot refuse another's.
	assert.equal(
		loginState(
			"openai",
			{ credential_id: 7, state: "login_required" },
			read("signed-out"),
		),
		"working",
	);
});

test("the refused chip has its own words, its own tone, and the neighbour's group", () => {
	const refused = providerReadiness(RADIENT_ROW, "refused");
	// D1: the refused state used to render the never-signed-in answer verbatim.
	assert.equal(refused.label, "Needs re-authentication");
	assert.notEqual(
		refused.label,
		providerReadiness(RADIENT_ROW, "working").label,
	);
	// D4: `neutral` is what a healthy local provider says, so it carried no
	// severity on this grid; `attention` is the variant for "needs your attention".
	assert.equal(refused.tone, "attention");
	// The group is what the model picker buckets on and what the hosting filter
	// reads, and the remedy here IS a sign-in.
	assert.equal(refused.group, "Needs sign-in");
	assert.match(refused.detail, REFUSED_DETAIL);

	const unverified = providerReadiness(RADIENT_ROW, "unverified");
	assert.equal(unverified.label, "Needs sign-in");
	assert.equal(unverified.tone, "neutral");
	assert.equal(unverified.group, "Needs sign-in");
	assert.match(unverified.detail, UNVERIFIED_DETAIL);

	// A row with no credential at all reads the same in both worlds: the change
	// corrects a claim, it does not invent one.
	assert.equal(providerReadiness(OPENAI_ROW, "working").label, "Needs sign-in");
	assert.equal(providerReadiness(RADIENT_ROW, "working").label, "Signed in");
	assert.equal(providerReadiness(RADIENT_ROW, "working").tone, "success");
	/*
	 * And the unverified arm owes its long form only where there is a row to
	 * contradict: the sentence names the contradiction, so a machine with no
	 * sign-in stored at all must render exactly what it rendered before this
	 * change -- same label, same tone, and no `title` it never had.
	 */
	const noRow = { ...RADIENT_ROW, configured: false, has_credential: false };
	assert.equal(providerReadiness(noRow, "unverified").label, "Needs sign-in");
	assert.equal(providerReadiness(noRow, "unverified").detail, undefined);
	assert.match(
		providerReadiness(RADIENT_ROW, "unverified").detail,
		UNVERIFIED_DETAIL,
	);
	// A local server needs no key in every state, refusal included.
	assert.equal(
		providerReadiness(
			{ ...OPENAI_ROW, local: true, credential_optional: true },
			"refused",
		).label,
		"No key needed",
	);
});

/**
 * The grid card, driven through the shipped hooks and the shipped transport.
 *
 * This is the case that fails before the fix: the census row carries a
 * credential, so the old predicate said "Signed in" in the success tone for a
 * login the backend had already refused.
 */
test("the grid card stops claiming a sign-in the verdict refuses", async () => {
	loginAnswer = "refused";
	accountAnswer = "ready";
	const { container } = await renderGrid();
	const rendered = text(container);
	assert.equal(
		occurrences(rendered, "Signed in"),
		0,
		`no card may claim a sign-in while the verdict refuses one: ${rendered}`,
	);
	assert.equal(occurrences(rendered, "Needs re-authentication"), 1, rendered);
	assert.equal(occurrences(rendered, "Needs sign-in"), 1, rendered);
	// D2: the long form is still reachable, and now on both surfaces.
	assert.match(container.innerHTML, REFUSED_DETAIL_ATTRIBUTE);
});

test("the grid card keeps its claim on a healthy verdict", async () => {
	loginAnswer = "ok";
	accountAnswer = "ready";
	const { container } = await renderGrid();
	const rendered = text(container);
	assert.equal(occurrences(rendered, "Signed in"), 1, rendered);
	assert.equal(occurrences(rendered, "Needs sign-in"), 1, rendered);
});

/**
 * D3 / M1, on the surface: a runtime whose route predates `radient_login`, with
 * the app's own account read answering that no sign-in is stored. The chip may
 * not fall back to the credential row here -- that fallback IS the incident.
 */
test("an absent verdict plus a signed-out account read does not claim a sign-in", async () => {
	loginAnswer = "absent";
	accountAnswer = "signed-out";
	const { container } = await renderGrid();
	const rendered = text(container);
	assert.equal(
		occurrences(rendered, "Signed in"),
		0,
		`the row may not be read as a working sign-in without a verdict: ${rendered}`,
	);
	assert.equal(occurrences(rendered, "Needs sign-in"), 2, rendered);
	assert.match(
		container.innerHTML,
		/title="This app could not confirm the sign-in stored on this machine"/,
	);
});

/**
 * The never-signed-in machine, which must be UNCHANGED by this change: it is the
 * picture D1's remedy has to pull the refused card apart from, and the pair only
 * reads as a distinction if this half is still the plain one.
 */
test("a machine with no stored sign-in keeps the card it had before this change", async () => {
	loginAnswer = "unknown";
	accountAnswer = "signed-out";
	census = [
		{
			...RADIENT_ROW,
			configured: false,
			has_credential: false,
			stored_credentials: 0,
		},
		OPENAI_ROW,
	];
	const { container } = await renderGrid();
	const rendered = text(container);
	assert.equal(occurrences(rendered, "Signed in"), 0, rendered);
	assert.equal(occurrences(rendered, "Needs sign-in"), 2, rendered);
	assert.equal(
		occurrences(container.innerHTML, 'title="This app could not confirm'),
		0,
		`a machine with no sign-in owes no contradiction prose: ${container.innerHTML}`,
	);
	// And the distinction itself: with a row, the same state DOES carry the long
	// form, which is the whole reason the two cards stop being one picture.
	census = [RADIENT_ROW, OPENAI_ROW];
	const withRow = await renderGrid();
	assert.equal(
		occurrences(
			withRow.container.innerHTML,
			'title="This app could not confirm',
		),
		1,
	);
});

/**
 * QA round 1's F2, on the surface: the verdict ANSWERED `unknown` (a row whose
 * token endpoint cannot be reached) with the account read failing `unavailable`.
 * Neither read confirms the login, so no surface may render the green claim.
 */
test("an unknown verdict does not claim a sign-in either", async () => {
	loginAnswer = "unknown";
	accountAnswer = "unavailable";
	const { container } = await renderGrid();
	const rendered = text(container);
	assert.equal(
		occurrences(rendered, "Signed in"),
		0,
		`an unconfirmed verdict is not a health claim: ${rendered}`,
	);
	assert.equal(occurrences(rendered, "Needs sign-in"), 2, rendered);
	assert.match(
		container.innerHTML,
		/title="This app could not confirm the sign-in stored on this machine"/,
	);
});

/**
 * The control for the case above, and the direction that must NOT narrow: a
 * runtime with no verdict at all, whose account read is unreachable, keeps the
 * store's own answer. That is the floor the PR body states.
 */
test("an absent verdict with an unreachable account read keeps the store's answer", async () => {
	for (const account of ["unavailable", "ready"]) {
		loginAnswer = "absent";
		accountAnswer = account;
		const { container } = await renderGrid();
		const rendered = text(container);
		assert.equal(
			occurrences(rendered, "Signed in"),
			1,
			`an account read of ${account} must not narrow the chip: ${rendered}`,
		);
	}
});

/**
 * The fold onto #416: the verdict is now the composer callout's own query, gated
 * on the `tunnel` capability. A runtime that does not advertise it is below the
 * field's first release, so it is the absent-verdict floor -- and the chip's
 * fallback must still hold there, and the grid must not wait forever on a read
 * that is never issued.
 */
test("without the tunnel capability the verdict is never read, and the fallback still holds", async () => {
	tunnelCapability = false;
	loginAnswer = "refused";
	accountAnswer = "signed-out";
	const narrowed = await renderGrid();
	const narrowedText = text(narrowed.container);
	assert.equal(verdictRequests, 0, "a gated read was issued anyway");
	assert.equal(occurrences(narrowedText, "Signed in"), 0, narrowedText);
	assert.equal(occurrences(narrowedText, "Needs sign-in"), 2, narrowedText);
	assert.equal(
		occurrences(narrowedText, "Needs re-authentication"),
		0,
		`a verdict the runtime was never asked for cannot refuse: ${narrowedText}`,
	);

	accountAnswer = "unavailable";
	const floor = await renderGrid();
	const floorText = text(floor.container);
	assert.equal(occurrences(floorText, "Signed in"), 1, floorText);
});

/**
 * The same cache entry, read by both surfaces: the chip and the composer callout
 * cannot disagree about one verdict, because there is one.
 */
test("the chip's verdict is the callout's cache entry", async () => {
	loginAnswer = "refused";
	accountAnswer = "ready";
	const { container, queryClient } = await renderGrid();
	assert.equal(occurrences(text(container), "Needs re-authentication"), 1);
	assert.equal(
		queryClient.getQueryData(radientSessionIssueKey)?.radient_login?.state,
		"login_required",
	);
	assert.equal(verdictRequests, 1);
});

/**
 * D6: the claim waits for the read that can correct it.
 *
 * The verdict is held open with the census already answered -- the window design
 * round 1 measured as a green "Signed in" for 72-193 ms, then corrected. The card
 * list must not be on screen claiming anything until the verdict has answered.
 */
test("the card list does not paint a claim while the verdict read is out", async () => {
	loginAnswer = "refused";
	accountAnswer = "ready";
	holdVerdict = true;
	releaseVerdict = () => {};
	const queryClient = client();
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	mounted.push({ root, queryClient });
	await act(async () => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client: queryClient },
				createElement(ProviderGrid, {}),
			),
		);
	});
	/*
	 * Sampled repeatedly rather than once: the census HAS answered by now (the
	 * bridge answers it immediately), so a single sample could pass on the frame
	 * before the query ran. Four flushes is far more than the 46-99 ms the design
	 * round measured this flash lasting.
	 */
	for (let sample = 0; sample < 4; sample++) {
		await flush();
		const rendered = text(container);
		assert.equal(
			occurrences(rendered, "Signed in"),
			0,
			`sample ${sample + 1} painted a claim before the verdict answered: ${rendered}`,
		);
		assert.ok(
			rendered.includes("Loading providers"),
			`sample ${sample + 1} should still be holding the grid's own loading state: ${rendered}`,
		);
	}
	holdVerdict = false;
	releaseVerdict();
	const deadline = Date.now() + 5000;
	for (;;) {
		await flush();
		if (text(container).includes("Needs re-authentication")) break;
		if (Date.now() > deadline) {
			throw new Error(
				`the refused card never arrived after the verdict answered: ${text(container)}`,
			);
		}
	}
	const settled = text(container);
	assert.equal(occurrences(settled, "Signed in"), 0, settled);
	assert.equal(occurrences(settled, "Needs re-authentication"), 1, settled);
});

/**
 * The detail panel, which is the surface the incident was photographed on: its
 * green "Signed in" badge sat directly under the account section's own "You are
 * not currently signed in to Radient".
 */
test("the detail panel's badge is keyed on the verdict, not on the credential row", async () => {
	loginAnswer = "refused";
	accountAnswer = "ready";
	const refused = await renderDetail();
	await awaitReads(refused.container, refused.queryClient);
	const refusedText = text(refused.container);
	assert.equal(occurrences(refusedText, "Signed in"), 0, refusedText);
	assert.equal(
		occurrences(refusedText, "Needs re-authentication"),
		1,
		refusedText,
	);
	assert.match(refused.container.innerHTML, REFUSED_DETAIL_ATTRIBUTE);
	// A real unmount rather than a second container: the healthy half asserts
	// against a panel that rendered from its own answer, not from this one's
	// state or from a leftover DOM.
	await act(async () => {
		refused.root.unmount();
	});

	loginAnswer = "ok";
	const healthy = await renderDetail();
	await awaitReads(healthy.container, healthy.queryClient);
	const healthyText = text(healthy.container);
	assert.equal(occurrences(healthyText, "Signed in"), 1, healthyText);
});

/* ---- round 2: the two `unknown` shapes, the refused fallback, and the ---- */
/* ---- account section that stopped settling -------------------------------- */

/**
 * M2: the backend's OTHER `unknown` names no credential, so it is no verdict.
 *
 * `tunnels/report.py::local_payload` answers `{credential_id: null, state:
 * "unknown"}` whenever no tunnel is configured, which is a signed-in, healthy
 * user who has never made one. Read as a verdict it told that user "Needs sign-in"
 * on a working login -- the incident inverted, and invisible to this file before
 * this case because every `unknown` fixture here named `credential_id: 7`.
 */
test("an unknown that names no credential is not a verdict about one", () => {
	/** An enabled account read, which is the only one that can narrow. */
	const read = (accountRead) => ({ accountRead, unavailable: false });
	// The payload with no tunnel configured, on a healthy read: the store answers,
	// exactly as it does when the field is absent entirely.
	assert.equal(
		loginState(
			"radient",
			{ credential_id: null, state: "unknown" },
			read("ready"),
		),
		"working",
	);
	assert.equal(loginState("radient", undefined, read("ready")), "working");
	// QA round 1's F2 (a row whose token endpoint is down) still names its
	// credential, and that one IS the app declining to confirm one.
	assert.equal(
		loginState(
			"radient",
			{ credential_id: 7, state: "unknown" },
			read("ready"),
		),
		"unverified",
	);
	// And the null-credential shape cannot rescue the absent-verdict arm either:
	// an account read that says no sign-in is stored still narrows on its own.
	assert.equal(
		loginState(
			"radient",
			{ credential_id: null, state: "unknown" },
			read("signed-out"),
		),
		"unverified",
	);
});

/** M2, on the rendered grid: a healthy user is not sent to a sign-in. */
test("a signed-in machine that never made a tunnel is not told to sign in", async () => {
	loginAnswer = "unknown-no-credential";
	accountAnswer = "ready";
	const { container } = await renderGrid();
	const body = text(container);
	assert.equal(occurrences(body, "Signed in"), 1, body);
	// The other card is the never-configured one, which is what "Needs sign-in"
	// belongs to here: the reading is that RADIENT is not among them.
	assert.equal(occurrences(body, "Needs sign-in"), 1, body);
	assert.doesNotMatch(container.innerHTML, UNVERIFIED_DETAIL);
});

/**
 * Q-6: the fallback's `refused` arm, which round 1 left out.
 *
 * A verdict that is absent or unreadable AND an account read that says Radient
 * REFUSED this app's credential is the incident's own state on `v0.61.0`/`v0.61.1`
 * (they classify the refusal without shipping the verdict -- measured at both
 * tags), and on any runtime whose `/v1/auth/status` read fails. It rendered the
 * pre-fix green "Signed in" for a dead grant, because the fallback narrowed on
 * `signed-out` alone.
 */
test("the fallback refuses a claim when the account read says the sign-in was refused", async () => {
	loginAnswer = "absent";
	accountAnswer = "refused";
	const { container } = await renderGrid();
	const body = text(container);
	assert.equal(occurrences(body, "Signed in"), 0, body);
	assert.equal(occurrences(body, "Needs re-authentication"), 1, body);
	assert.match(container.innerHTML, REFUSED_DETAIL_ATTRIBUTE);

	// The arm this must NOT swallow: `unavailable` is what a healthy machine's
	// read fails as, and the store's own answer stands there (the floor the PR
	// body states). Asserted here so the two classes cannot be collapsed by a
	// later edit that widens the condition above.
	const unavailable = await renderGridWith({ accountAnswer: "unavailable" });
	const unavailableBody = text(unavailable.container);
	assert.equal(occurrences(unavailableBody, "Signed in"), 1, unavailableBody);
	assert.equal(occurrences(unavailableBody, "Needs re-authentication"), 0);
});

/** M4 (QA's case D): a refused verdict on a machine with no stored sign-in. */
test("a refused verdict with no stored sign-in owes no sentence about one", async () => {
	loginAnswer = "refused";
	accountAnswer = "ready";
	// The census row QA's case D carried: the credential was removed, so
	// `has_credential` and `configured` are both false while the verdict still
	// names a credential (`report.py:226`: a `None` row returns `dead`).
	const noRow = { ...RADIENT_ROW, has_credential: false, configured: false };
	census = [noRow, OPENAI_ROW];
	const { container } = await renderGrid();
	const body = text(container);
	// The label stays -- it is the verdict's own word for one condition (D5) --
	// and the long form, which names a sign-in stored on this machine, is gone.
	assert.equal(occurrences(body, "Needs re-authentication"), 1, body);
	assert.doesNotMatch(container.innerHTML, REFUSED_DETAIL_ATTRIBUTE);
	assert.equal(
		providerReadiness(
			noRow,
			loginState(
				"radient",
				{ credential_id: 1, state: "login_required" },
				{ accountRead: "ready", unavailable: false },
			),
		).detail,
		undefined,
	);
	// The contrast that keeps this from being "drop the long form everywhere":
	// a row that DOES count a credential still carries it.
	assert.equal(
		providerReadiness(
			RADIENT_ROW,
			loginState(
				"radient",
				{ credential_id: 1, state: "login_required" },
				{ accountRead: "ready", unavailable: false },
			),
		).detail,
		"Radient no longer accepts the sign-in stored on this machine",
	);
});

/**
 * M3: a sign-in started from the Radient card refreshes the verdict the chip reads.
 *
 * The chip's badge is keyed on the verdict query, and `refreshProviders` -- the
 * callback the card runs the moment a sign-in succeeds -- refreshed only the
 * provider census. So the user who had just repaired the fault was told it was
 * still broken: the grid kept reading "Needs re-authentication" until the 60 s
 * poll or a window focus. Driven the way the reviewer reproduced it (refused /
 * open the card / sign in / `auth.status` answers `succeeded` / back to
 * providers), and asserted on the REQUEST COUNT as well as the words, because a
 * badge that flipped for some other reason would not prove the verdict was re-asked.
 */
test("a successful sign-in from the card refreshes the verdict the chip reads", async () => {
	loginAnswer = "refused";
	accountAnswer = "ready";
	authPollStates = ["succeeded"];
	const { container } = await renderGrid();
	assert.equal(occurrences(text(container), "Needs re-authentication"), 1);
	const before = verdictRequests;

	const press = (matcher) => {
		const button = [...container.querySelectorAll("button")].find((candidate) =>
			matcher(candidate.textContent ?? ""),
		);
		assert.ok(button, `no control matched: ${text(container).slice(0, 300)}`);
		return act(async () => {
			button.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true, cancelable: true }),
			);
		});
	};

	await press((label) => label.startsWith("Radient"));
	const signIn = [...container.querySelectorAll("button")].find((candidate) =>
		/sign in to radient/i.test(candidate.textContent ?? ""),
	);
	assert.ok(
		signIn,
		`the card did not open its panel: ${text(container).slice(0, 300)}`,
	);
	await act(async () => {
		signIn.dispatchEvent(
			new window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
	// The poll's first tick is immediate, and the bridge flips the verdict to
	// `ok` when it reports `succeeded` -- which is what the real backend does
	// having just accepted a fresh credential.
	const deadline = Date.now() + 5000;
	while (Date.now() < deadline && verdictRequests <= before) {
		await flush();
	}
	assert.ok(
		verdictRequests > before,
		"the verdict was never re-read, so the chip could only change by luck",
	);
	await press((label) => /back to providers/i.test(label));
	const body = text(container);
	assert.equal(occurrences(body, "Signed in"), 1, body);
	assert.equal(occurrences(body, "Needs re-authentication"), 0, body);
});

/* ---- D7/Q-5: the account section's own read, and the loop it was in -------- */

/**
 * The settings section, mounted with its own sign-in block.
 *
 * This is the composition the regression lives in -- the section renders
 * `RadientAuthButtons`, which renders `ProviderDetail` -- so the case mounts the
 * section rather than the panel, and the thing it watches is the section's own
 * readiness rather than either surface's words.
 */
async function renderSection() {
	const queryClient = client();
	const { container, root } = await mountUntil(
		createElement(
			QueryClientProvider,
			{ client: queryClient },
			createElement(RadientAccountSection, {}),
		),
		(node) => !node.textContent.includes("Loading account"),
		"the account section to leave its spinner",
	);
	return { container, root, queryClient };
}

/**
 * D7/Q-5: the section settles on a refused read, and renders what it owes.
 *
 * WHAT WENT WRONG, so the assertions read as the defect rather than as taste.
 * The section early-returns its spinner for `isLoading` -- true again the moment
 * any observer starts a read -- and the sign-in block it hides contains
 * `ProviderDetail`, which this PR taught to observe this same read. React Query
 * re-runs a failed, data-less query when a new observer mounts on it
 * (`retryOnMount` defaults true), so the read re-commissioned itself every time
 * the panel remounted: measured on this composition, 14 reads in 14 s with the
 * section never leaving the spinner, `status: pending`, `fetchStatus: fetching`
 * -- the shape QA read off the live app (54 reads a boot) and design read off its
 * own rig (39 in 30 s against 4 on `main`).
 *
 * The two half-assertions are the two halves of the finding: the section SETTLES
 * (and stays settled through a hold window, which is what a one-shot wait would
 * miss), and the chip and the sign-in control -- both of which live inside the
 * branch the spinner was replacing -- RENDER.
 */
test("the account section settles on a refused read, with its chip and its sign-in control", async () => {
	loginAnswer = "refused";
	accountAnswer = "refused";
	const { container, queryClient } = await renderSection();
	/*
	 * The section renders the content for ~500 ms between two spinners, so a wait
	 * for the sentence alone would pass on the loop as well. What settles a loop
	 * is the READ COUNT, and what stays still is the frame: hold the case for
	 * three seconds (about three loop iterations at the measured rate) and assert
	 * both.
	 */
	const settledAt = await (async () => {
		const started = Date.now();
		while (Date.now() - started < 5000) {
			await flush();
			if (text(container).includes("refused the sign-in this app is holding")) {
				return Date.now() - started;
			}
		}
		throw new Error(
			`the section never rendered its refusal sentence: "${text(container)}"`,
		);
	})();
	const readsAtSettle = accountRequests;
	await new Promise((resolve) => setTimeout(resolve, 3000));
	await flush();
	const body = text(container);
	const readsAfterHold = accountRequests;
	assert.ok(
		readsAfterHold <= readsAtSettle + 1,
		`the section re-read the account ${readsAfterHold - readsAtSettle} times while idle (${readsAtSettle} reads to settle) - it is looping`,
	);
	assert.ok(
		readsAfterHold <= 3,
		`one boot cost ${readsAfterHold} account reads, which is the re-read loop, not a retry chain`,
	);
	// The two things Q-5's second half is about, both inside the branch the
	// spinner was standing in for.
	assert.equal(
		occurrences(body, "Loading your Radient account details"),
		0,
		body,
	);
	assert.equal(occurrences(body, "Needs re-authentication"), 1, body);
	assert.match(container.innerHTML, REFUSED_DETAIL_ATTRIBUTE);
	assert.ok(
		/sign in/i.test(body),
		`the section rendered no sign-in control: ${body}`,
	);
	// And the read really is the app's own refused one, not an empty cache: the
	// section's sentence is the class' own sentence (`accountRead === "refused"`).
	assert.equal(
		queryClient.getQueryState(radientUserKeys.user())?.status,
		"error",
	);
	assert.ok(settledAt < 5000);
});

/** The grid with one answer overridden, for a case that needs both halves. */
async function renderGridWith({ accountAnswer: answer }) {
	accountAnswer = answer;
	return renderGrid();
}
