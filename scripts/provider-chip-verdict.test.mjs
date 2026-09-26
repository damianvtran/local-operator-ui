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
import { afterEach, beforeEach, test } from "node:test";
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
				loginClaim,
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
const bootstrapDOM = new JSDOM("<!doctype html>", {
	url: "http://localhost/",
	/* JSdom grows its own `requestAnimationFrame` only when it is visual, and Radix's
	 * menu mount waits on one. */
	pretendToBeVisual: true,
});
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
globalThis.localStorage = bootstrapDOM.window.localStorage;
/*
 * jsdom has no layout, so it ships no `scrollIntoView` — and this grid calls it
 * on the row whose panel opens (the focus the collapse hands back), which would
 * otherwise throw inside a passive effect and take the case down with it. The
 * substitution is the one `scripts/browser-tab-strip-focus.test.mjs` and
 * `scripts/picker-host-selection.test.mjs` already make for the same call.
 */
bootstrapDOM.window.Element.prototype.scrollIntoView = () => {};
/*
 * The globals Radix and its popper reach for as BARE names when a menu mounts,
 * which is how a Connected row opens its panel: the focus scope watches the
 * layer with a `MutationObserver` and tells a hidden node from a visible one
 * with `getComputedStyle`, its tab walk is built with a bare `NodeFilter` and a
 * bare `instanceof` per control type, floating-ui decides whether a node is an
 * element with a bare `Element`, and the content sizes itself with a
 * `ResizeObserver`. `requestAnimationFrame` is REACHED but deliberately never
 * runs: floating-ui only starts a frame loop when it is asked for one (`animationFrame`
 * is false for these surfaces), so a real timer here would only add a queue with
 * no ordering against React's. Two of those have no analogue outside a browser:
 * jsdom is not visual here, and the observer is the no-op the app's other jsdom
 * menu harness uses. The set is `scripts/chat-image-expand.test.mjs`'s, which
 * drives the app's other Radix menu from jsdom for the same reason; these cases
 * need it only because the row's overflow menu is the control that opens a
 * Connected row's panel.
 */
globalThis.HTMLElement = bootstrapDOM.window.HTMLElement;
globalThis.Element = bootstrapDOM.window.Element;
globalThis.Node = bootstrapDOM.window.Node;
globalThis.Event = bootstrapDOM.window.Event;
globalThis.CustomEvent = bootstrapDOM.window.CustomEvent;
globalThis.MouseEvent = bootstrapDOM.window.MouseEvent;
globalThis.KeyboardEvent = bootstrapDOM.window.KeyboardEvent;
globalThis.MutationObserver = bootstrapDOM.window.MutationObserver;
globalThis.NodeFilter = bootstrapDOM.window.NodeFilter;
globalThis.HTMLInputElement = bootstrapDOM.window.HTMLInputElement;
globalThis.getComputedStyle = bootstrapDOM.window.getComputedStyle.bind(
	bootstrapDOM.window,
);
globalThis.requestAnimationFrame =
	bootstrapDOM.window.requestAnimationFrame.bind(bootstrapDOM.window);
globalThis.cancelAnimationFrame = bootstrapDOM.window.cancelAnimationFrame.bind(
	bootstrapDOM.window,
);
globalThis.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
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
 * Whether `GET /v1/auth/status` FAILS (a 500), which is QA round 3's Q-8 state
 * and Q-6's case K: the verdict read errors and holds no data, which is the one
 * state in which React Query re-runs a query on an observer's mount and puts it
 * back to `status: "pending"` for every re-attempt.
 */
let verdictFails = false;
/**
 * Whether the capability answer advertises `tunnel`. The verdict read is the
 * composer callout's own query and is gated on that key, so a runtime without it
 * is the absent-verdict floor reached by a different road: no read at all.
 */
let tunnelCapability = true;
/** Whether the census itself fails, so the grid's own error branch is reached. */
let censusFails = false;
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
 * Whether the ACCOUNT read is held open, for design round 4's D12: with the
 * verdict read failed, that read is the only input left that can support a
 * claim, and the window it is in flight is the window D12 painted green in.
 * Answered at release with whatever `accountAnswer` names then.
 */
let holdAccount = false;
/** Releases the held account read, called from the case that held it. */
let releaseAccount = () => {};
/**
 * How many account reads the bridge is HOLDING in this case.
 *
 * `releaseAccount` is one slot, so a second held read replaces the first and the
 * case then releases a read that is not its own (review round 5, R5-1: a grid
 * left mounted by an earlier case started that second read, and the case's own
 * read was never answered). The cases that hold assert this is exactly 1 before
 * they release, so a leak fails as a leak rather than as the frame it starved.
 */
let heldAccountReads = 0;

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
	verdictFails = false;
	tunnelCapability = true;
	verdictRequests = 0;
	accountRequests = 0;
	authPollStates = [];
	authStarts = 0;
	releaseVerdict = () => {};
	holdAccount = false;
	releaseAccount = () => {};
	heldAccountReads = 0;
	censusFails = false;
});

/** The verdict route's answer for the case's current settings. */
function verdictResponse() {
	if (verdictFails) {
		return { status: 500, body: { detail: "Internal Server Error" } };
	}
	return { status: 200, body: LOGIN_ANSWERS[loginAnswer] };
}

globalThis.window.api = {
	desktop: {
		request: async (request) => {
			if (request?.op === "providers.list") {
				if (censusFails) {
					return { status: 500, body: { detail: "Internal Server Error" } };
				}
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
					// Decided at RELEASE, not at the request, so a case can hold a read
					// and then let it fail.
					return await new Promise((resolve) => {
						releaseVerdict = () => resolve(verdictResponse());
					});
				}
				return verdictResponse();
			}
			if (request?.control?.operation === "account") {
				accountRequests += 1;
				if (holdAccount) {
					heldAccountReads += 1;
					return await new Promise((resolve) => {
						releaseAccount = () => resolve(ACCOUNT_ANSWERS[accountAnswer]);
					});
				}
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
	loginClaim,
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
/*
 * The panel's own sign-in control, and the receipt's action -- the two controls a
 * case here presses INSIDE an opened panel.
 *
 * Named by their words rather than by position, because the panel's anatomy
 * moved with the rest of this change: the primary action is "Continue in
 * browser" / "Get a sign-in code" (the button a provider's `method.label` used to
 * fill), and the receipt's action is "Done" in this context. The method TABS are
 * deliberately not what a case presses: their labels are the method NAMES
 * ("Browser sign-in"), which is the naming the tab and the button are kept apart
 * by (design D4).
 */
const CONTINUE_IN_BROWSER = /continue in browser/i;
const RECEIPT_DONE = /^done$/i;
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

/** Every surface the CURRENT case mounted; drained when the case ends. */
const mounted = [];

/**
 * Take down every surface the case mounted before the next case starts: unmount
 * its root, clear its client, and drop its container.
 *
 * PER CASE, NOT ONCE AT THE END (review round 5, R5-1). This used to be a
 * file-level `after`, so a grid a case did not unmount itself stayed LIVE to the
 * end of the file, with its observers, its account-read retries and its
 * verdict `refetchInterval`. Its reads then landed inside a later case's held
 * window, on the module-global bridge counters and the single `releaseAccount`
 * slot: measured by the reviewer in ~5 of 20 whole-file runs, the D12 release
 * case held TWO account reads (its own and a leftover's) and released the
 * leftover's, and the Q-8 press cases charged leftover verdict reads to the
 * press -- a failure that read as the Q-8 loop coming back when nothing had.
 *
 * Unmounting alone is not enough either: with every observer gone this file
 * still sat for a full minute after its last assertion -- the verdict read's own
 * `refetchInterval`, which the hook sets and this file must not restate.
 * Clearing the client destroys the queries (and any pending retry) that would
 * schedule another read. An unmount a case already did is a no-op here.
 */
afterEach(async () => {
	for (const surface of mounted.splice(0)) await teardown(surface);
});

/**
 * Unmount one surface and clear its client. Also called INSIDE a case for a
 * scaffold grid whose reads must not reach the case's own window
 * (`forgetAccountFailure`).
 */
async function teardown({ root, queryClient, container }) {
	await act(async () => {
		root.unmount();
	});
	queryClient.clear();
	container.remove();
}

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
	mounted.push({ root, queryClient: element.props.client, container });
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
async function renderGrid({ providerId = null } = {}) {
	const queryClient = client();
	const { container } = await mountUntil(
		createElement(
			QueryClientProvider,
			{ client: queryClient },
			createElement(
				ProviderGrid,
				providerId === null ? {} : { initialProviderId: providerId },
			),
		),
		(node) =>
			node.textContent.includes("Radient") &&
			node.textContent.includes("OpenAI"),
		"the provider rows",
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

/**
 * Every class `RadientAccountRead` names, so the contract table below can prove
 * it covers each of them rather than the ones someone remembered.
 */
const ACCOUNT_CLASSES = [
	"checking",
	"ready",
	"signed-out",
	"refused",
	"unavailable",
	"unknown",
];

/**
 * The PAINT contract, over the shipped module (design round 4, D12): which
 * combinations of the two reads withhold the Radient claim (`null`) and which
 * release it. Every row names the state it is; the ones marked D12 and D6 are the
 * two claim-then-correct windows this contract exists to close, and the ones
 * marked #416 are the opposite misdirection -- telling a machine whose reads have
 * not answered that it needs a sign-in.
 */
test("loginClaim withholds the claim until a read that can support it has answered", () => {
	const read = (accountRead, unavailable = false) => ({
		accountRead,
		unavailable,
	});
	const pending = { data: null, isPending: true };
	const failed = { data: null, isPending: false };
	const verdict = (state, credential_id = 7) => ({
		data: { credential_id, state },
		isPending: false,
	});
	const rows = [
		// The verdict's first read out.
		["D6: first read out, account in flight", pending, read("checking"), null],
		[
			"D6: first read out, account ready (the incident's own pair)",
			pending,
			read("ready"),
			null,
		],
		[
			"#416: first read out, account unavailable",
			pending,
			read("unavailable"),
			null,
		],
		[
			"first read out, account refused -- this app's own reading of the fault",
			pending,
			read("refused"),
			"refused",
		],
		/*
		 * NOT released: before the capability answers, the account read is DISABLED,
		 * and a disabled read classifies as `signed-out` -- so here it is no answer.
		 */
		[
			"first read out, account signed-out (or a disabled read on a cold mount)",
			pending,
			read("signed-out"),
			null,
		],
		// D6's class too: `unknown` keeps the store's green answer on the fallback
		// arm, and the verdict can still overrule it.
		["D6: first read out, account unknown", pending, read("unknown"), null],
		/*
		 * A read this app cannot ask is no answer, whatever class it reports -- not
		 * even `refused`: only an ASKED read's refusal may speak before the verdict.
		 */
		...ACCOUNT_CLASSES.map((accountRead) => [
			`first read out, account read cannot be asked (${accountRead})`,
			pending,
			read(accountRead, true),
			null,
		]),
		// The verdict answered without a claim: failed, absent, disabled, null-credential unknown.
		["D12: verdict failed, account in flight", failed, read("checking"), null],
		["verdict failed, account ready", failed, read("ready"), "working"],
		["verdict failed, account refused", failed, read("refused"), "refused"],
		[
			"verdict failed, account unavailable (a healthy machine's failure)",
			failed,
			read("unavailable"),
			"working",
		],
		[
			"verdict failed, account signed-out -- the fallback narrows",
			failed,
			read("signed-out"),
			"unverified",
		],
		[
			"verdict failed, account unknown (an answer the arm keeps)",
			failed,
			read("unknown"),
			"working",
		],
		/*
		 * The pre-verdict floor the PR body states: a read this app cannot ask is
		 * neither waited for (`checking` is only withheld while ENABLED) nor allowed
		 * to narrow (`signed-out`/`refused` there are the disabled query's own
		 * classification, not a reading).
		 */
		...ACCOUNT_CLASSES.map((accountRead) => [
			`verdict failed, account read cannot be asked (${accountRead})`,
			failed,
			read(accountRead, true),
			"working",
		]),
		[
			"D12: null-credential unknown, account in flight",
			verdict("unknown", null),
			read("checking"),
			null,
		],
		// The verdict answered WITH a claim: the account read is not waited for.
		[
			"login_required, account in flight",
			verdict("login_required"),
			read("checking"),
			"refused",
		],
		["ok, account in flight", verdict("ok"), read("checking"), "working"],
		[
			"unknown naming a credential, account in flight",
			verdict("unknown"),
			read("checking"),
			"unverified",
		],
	];
	for (const [what, login, account, expected] of rows) {
		assert.equal(loginClaim("radient", login, account), expected, what);
	}
	/*
	 * The two halves the contract states per account input -- the verdict's first
	 * read out, and a verdict answered without a claim -- must each have a row for
	 * EVERY class of the account read, asked and unaskable. Review round 5 (R5-2)
	 * found this table a subset of its contract: three mutants of stated rows
	 * passed the whole file. Checked here so a row cannot be dropped silently.
	 */
	for (const [half, login] of [
		["first read out", pending],
		["verdict failed", failed],
	]) {
		for (const accountRead of ACCOUNT_CLASSES) {
			for (const unavailable of [false, true]) {
				assert.ok(
					rows.some(
						([, l, a]) =>
							l === login &&
							a.accountRead === accountRead &&
							a.unavailable === unavailable,
					),
					`no row states ${half} x ${accountRead} (unavailable: ${unavailable})`,
				);
			}
		}
	}
	const everyAccount = ACCOUNT_CLASSES.flatMap((accountRead) => [
		read(accountRead),
		read(accountRead, true),
	]);
	for (const account of everyAccount) {
		const which = `${account.accountRead} (unavailable: ${account.unavailable})`;
		// The `unknown` that names no credential is not a verdict about one: it is
		// the failed half, input for input.
		assert.equal(
			loginClaim("radient", verdict("unknown", null), account),
			loginClaim("radient", failed, account),
			`null-credential unknown, account ${which}`,
		);
		// A verdict WITH a claim is that claim, whatever the account read is doing.
		for (const [state, claim] of [
			["login_required", "refused"],
			["ok", "working"],
			["unknown", "unverified"],
		]) {
			assert.equal(
				loginClaim("radient", verdict(state), account),
				claim,
				`${state}, account ${which}`,
			);
		}
	}
	// Only the Radient row reads either input; nothing else is ever withheld.
	assert.equal(loginClaim("openai", pending, read("checking")), "working");
	assert.equal(loginClaim("openai", failed, read("checking")), "working");
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
 * The grid's Connected row, driven through the shipped hooks and the shipped
 * transport.
 *
 * This is the case that fails before the fix: the census row carries a
 * credential, so the old predicate said "Signed in" in the success tone for a
 * login the backend had already refused.
 */
test("the grid row stops claiming a sign-in the verdict refuses", async () => {
	loginAnswer = "refused";
	accountAnswer = "ready";
	const { container } = await renderGrid();
	const rendered = text(container);
	assert.equal(
		occurrences(rendered, "Signed in"),
		0,
		`no row may claim a sign-in while the verdict refuses one: ${rendered}`,
	);
	assert.equal(occurrences(rendered, "Needs re-authentication"), 1, rendered);
	/*
	 * `Needs sign-in` is ZERO here, where the card grid counted one: OpenAI is an
	 * ADD row, and an Add row states the action it performs rather than a status.
	 * The page-wide count is still a count of the claims on screen, and there is
	 * now exactly one -- the Connected row's, which the two assertions above and
	 * the row-scoped one below name.
	 */
	assert.equal(occurrences(rendered, "Needs sign-in"), 0, rendered);
	assert.equal(radientChip(container), "Needs re-authentication", rendered);
	assert.match(rowText(container, "openai"), /Paste an API key/);
	// D2: the long form is still reachable, and now on both surfaces.
	assert.match(container.innerHTML, REFUSED_DETAIL_ATTRIBUTE);
});

test("the grid row keeps its claim on a healthy verdict", async () => {
	loginAnswer = "ok";
	accountAnswer = "ready";
	const { container } = await renderGrid();
	const rendered = text(container);
	assert.equal(occurrences(rendered, "Signed in"), 1, rendered);
	assert.equal(radientChip(container), "Signed in", rendered);
	// A healthy verdict must not blank the list behind the claim: the Add row is
	// still there, still stating its own action.
	assert.match(rowText(container, "openai"), /Paste an API key/);
	assert.equal(occurrences(rendered, "Needs sign-in"), 0, rendered);
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
	assert.equal(occurrences(rendered, "Needs sign-in"), 1, rendered);
	assert.equal(radientChip(container), "Needs sign-in", rendered);
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
test("a machine with no stored sign-in keeps the row it had before this change", async () => {
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
	/*
	 * ZERO, where the card grid counted two: a provider whose census counts no
	 * credential is an ADD row, and the Add block makes no claim about a sign-in at
	 * all -- it states the action. So the property this case exists for (the
	 * never-signed-in machine keeps the picture it had) is asserted on the row that
	 * renders it, and the row still offers the sign-in.
	 */
	assert.equal(occurrences(rendered, "Needs sign-in"), 0, rendered);
	assert.match(rowText(container, "radient"), /Sign in/);
	assert.equal(
		occurrences(container.innerHTML, 'title="This app could not confirm'),
		0,
		`a machine with no sign-in owes no contradiction prose: ${container.innerHTML}`,
	);
	// And the distinction itself: with a row, the same state DOES carry the long
	// form, which is the whole reason the two rows stop being one picture.
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
	assert.equal(occurrences(rendered, "Needs sign-in"), 1, rendered);
	assert.equal(radientChip(container), "Needs sign-in", rendered);
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
	assert.equal(occurrences(narrowedText, "Needs sign-in"), 1, narrowedText);
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
 * One provider's row, and the words of its OWN line.
 *
 * The grid's anatomy is a LIST, and which block a provider lands in is the
 * census's answer: a row in the Connected block makes a claim about its sign-in,
 * and a row in the Add block makes none at all (it states an action). So a
 * page-wide count of "Needs sign-in" no longer says whose claim it read -- it
 * used to be every unconfigured card's own chip -- and these read one row.
 *
 * `rowText` reads the row's HEADER (`firstElementChild`) rather than the whole
 * `<li>`: an open row renders its panel inside that same `<li>`, and the panel's
 * badge makes the same claim, so a query over the `<li>` could read the panel's
 * answer and call it the row's.
 */
const rowOf = (container, id) =>
	container.querySelector(`[data-provider-id="${id}"]`);

function rowText(container, id) {
	const row = rowOf(container, id);
	assert.ok(row, `no row for ${id}: ${text(container).slice(0, 300)}`);
	const header = row.firstElementChild;
	assert.ok(header, `row ${id} has no header: ${text(row).slice(0, 200)}`);
	return text(header);
}

/**
 * The Radient row's claim as a user sees it, or a marker for its state.
 *
 * `withheld` is the reserved-but-invisible slot `loginClaim`'s `null` renders
 * (design round 4, D12); `none` is no Radient row at all (the list is not on
 * screen). Read from the ROW's header, not from the page text and not from the
 * `<li>`, for the reason `rowText` states.
 */
function radientChip(container) {
	const row = rowOf(container, "radient");
	if (!row) return "none";
	const header = row.firstElementChild;
	if (!header) return "none";
	if (header.querySelector('[data-claim="withheld"]')) return "withheld";
	for (const label of [
		"Signed in",
		"Needs re-authentication",
		"Needs sign-in",
		"No key needed",
	]) {
		if (text(header).includes(label)) return label;
	}
	return "unlabelled";
}

/**
 * Mount the grid WITHOUT waiting for anything, so a case can sample its frames
 * from the very first commit.
 */
async function mountGridRaw(providerId = null) {
	const queryClient = client();
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const entry = { root, queryClient, container };
	mounted.push(entry);
	await act(async () => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client: queryClient },
				createElement(
					ProviderGrid,
					providerId === null ? {} : { initialProviderId: providerId },
				),
			),
		);
	});
	return { container, queryClient, root, entry };
}

/**
 * Sample the Radient chip on every flush until `done` says stop, and return the
 * DISTINCT consecutive readings. A sequence rather than one frame is what D6 and
 * D12 are about: the defect was a claim that was painted and then corrected, and
 * only a sequence can show there was no such pair.
 */
async function chipSequence(container, done, timeoutMs = 5000) {
	const seen = [];
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const now = radientChip(container);
		if (seen.at(-1) !== now) seen.push(now);
		if (done(now)) return seen;
		if (Date.now() > deadline) {
			throw new Error(
				`timed out; the chip went ${seen.join(" -> ")} and the grid reads "${text(container)}"`,
			);
		}
		await flush();
	}
}

/**
 * What a second held account read means, said where it fails: another client
 * is live inside this case's window, so the release below would answer ITS read
 * and not this case's (R5-1).
 */
const HELD_READ_LEAK =
	"the bridge is holding more than this case's own account read: a surface from another case is still live, so releasing would answer the wrong read";

/** Flush until the verdict read has FAILED, which is D12's starting state. */
async function awaitVerdictError(queryClient) {
	const deadline = Date.now() + 5000;
	while (
		queryClient.getQueryState(radientSessionIssueKey)?.status !== "error"
	) {
		if (Date.now() > deadline) throw new Error("the verdict read never failed");
		await flush();
	}
	await flush();
}

/**
 * Clear the account read's RECORDED failure class, which is module state that
 * outlives a case's own `QueryClient` (see `accountFailureKinds` in the hook):
 * it is forgotten only by an answer, so an earlier case's `unavailable` or
 * `refused` would be on screen from this case's first frame, and D12's window
 * -- the account read genuinely `checking` -- could not be reached. One answered
 * read does exactly what a real one does.
 */
async function forgetAccountFailure() {
	const saved = { loginAnswer, accountAnswer };
	loginAnswer = "ok";
	accountAnswer = "ready";
	const scaffold = await mountGridRaw();
	const deadline = Date.now() + 5000;
	while (accountRequests === 0 || holdAccount) {
		if (Date.now() > deadline) throw new Error("no account read to clear with");
		await flush();
	}
	await flush();
	// Cleared, not just unmounted: the case holds its account read next, and no
	// read of this scaffold's may land in that window (R5-1).
	mounted.splice(mounted.indexOf(scaffold.entry), 1);
	await teardown(scaffold.entry);
	({ loginAnswer, accountAnswer } = saved);
	verdictRequests = 0;
	accountRequests = 0;
}

/**
 * D6: the claim waits for the read that can correct it.
 *
 * The verdict is held open with the census already answered -- the window design
 * round 1 measured as a green "Signed in" for 72-193 ms, then corrected. The card
 * list IS on screen in that window (holding it was round 3's Q-8 and round 4's
 * D14), but the Radient card carries no claim until the verdict answers, and then
 * carries the verdict's own.
 */
test("the card list does not paint a claim while the verdict read is out", async () => {
	loginAnswer = "refused";
	accountAnswer = "ready";
	holdVerdict = true;
	releaseVerdict = () => {};
	const { container } = await mountGridRaw();
	/*
	 * Sampled repeatedly rather than once: the census HAS answered by now (the
	 * bridge answers it immediately), so a single sample could pass on the frame
	 * before the query ran. Four flushes is far more than the 46-99 ms the design
	 * round measured this flash lasting -- and the ACCOUNT read answers `ready`
	 * inside them, which is the input that must NOT be enough on its own while
	 * the verdict's first read is out: a refused grant beside an access token
	 * inside its expiry reads `ready` and is the incident itself.
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
			!rendered.includes("Loading providers"),
			`sample ${sample + 1} held the whole list behind one row's verdict: ${rendered}`,
		);
		assert.equal(
			radientChip(container),
			"withheld",
			`sample ${sample + 1}: ${rendered}`,
		);
		assert.ok(rendered.includes("OpenAI"), rendered);
	}
	holdVerdict = false;
	releaseVerdict();
	const sequence = await chipSequence(
		container,
		(chip) => chip === "Needs re-authentication",
	);
	assert.deepEqual(sequence, ["withheld", "Needs re-authentication"]);
	const settled = text(container);
	assert.equal(occurrences(settled, "Signed in"), 0, settled);
	assert.equal(occurrences(settled, "Needs re-authentication"), 1, settled);
});

/**
 * D12 (design round 4): a FAILED verdict read is an answer to the list's gate
 * but not a claim, and while the app's own account read is still out the
 * fallback arm had nothing but the census -- so the card painted the green
 * "Signed in" and corrected it when the account read answered `refused`
 * (measured 2,493 ms on the live app). The claim must wait for the account read
 * instead, and must not guess the other way either.
 */
test("a failed verdict read does not paint a claim while the account read is out", async () => {
	await forgetAccountFailure();
	verdictFails = true;
	holdAccount = true;
	accountAnswer = "refused";
	const { container, queryClient } = await mountGridRaw();
	await awaitVerdictError(queryClient);
	for (let sample = 0; sample < 6; sample++) {
		await flush();
		const rendered = text(container);
		assert.equal(
			occurrences(rendered, "Signed in"),
			0,
			`sample ${sample + 1} painted a claim on a failed verdict with the account read still out: ${rendered}`,
		);
		assert.equal(radientChip(container), "withheld", rendered);
		// And the opposite misdirection: a machine whose reads have not answered is
		// not a machine that needs a sign-in.
		assert.equal(occurrences(rendered, "Needs re-authentication"), 0, rendered);
		assert.ok(!rendered.includes("Loading providers"), rendered);
		assert.ok(rendered.includes("OpenAI"), rendered);
	}
	assert.equal(
		queryClient.getQueryState(radientUserKeys.user())?.status,
		"pending",
		"the account read answered early, so this case sampled nothing",
	);
	assert.equal(heldAccountReads, 1, HELD_READ_LEAK);
	holdAccount = false;
	releaseAccount();
	const sequence = await chipSequence(
		container,
		(chip) => chip === "Needs re-authentication",
	);
	assert.deepEqual(sequence, ["withheld", "Needs re-authentication"]);
});

/**
 * D12's other half: the withheld claim is RELEASED by the account read's answer,
 * not held until the verdict route recovers. A healthy machine whose verdict
 * route fails must still be told it is signed in once its own account read says
 * so -- the pre-verdict floor this PR states. The panel is opened INSIDE the
 * window, so its badge is held to the same rule as the row: none while no read
 * can support one, then the account read's answer.
 */
test("on a failed verdict, the claim appears once the account read answers", async () => {
	await forgetAccountFailure();
	verdictFails = true;
	holdAccount = true;
	accountAnswer = "ready";
	const { container, queryClient } = await mountGridRaw("radient");
	await awaitVerdictError(queryClient);
	assert.equal(radientChip(container), "withheld", text(container));
	/*
	 * The panel is OPEN FROM THE MOUNT, through the grid's own deep link rather
	 * than by pressing the row's control: `expandAddRow`'s note records the
	 * measurement that keeps the Connected row's overflow menu out of this
	 * harness. The window this case is about is the one in which no read that can
	 * support a claim has answered, and the panel subscribes to both reads inside
	 * it, which is what the samples below measure.
	 */
	assert.ok(panelOpen(container), text(container).slice(0, 200));
	for (let sample = 0; sample < 4; sample++) {
		await flush();
		const opened = text(container);
		assert.equal(occurrences(opened, "Signed in"), 0, opened);
		assert.equal(occurrences(opened, "Needs re-authentication"), 0, opened);
	}
	assert.equal(heldAccountReads, 1, HELD_READ_LEAK);
	holdAccount = false;
	releaseAccount();
	const deadline = Date.now() + 5000;
	while (!text(container).includes("Signed in")) {
		if (Date.now() > deadline) {
			throw new Error(`the panel's badge never arrived: ${text(container)}`);
		}
		await flush();
	}
	/*
	 * ONE SURFACE STATES ONE VERDICT. The row's claim is the claim; the panel used to
	 * carry the same words in a badge 40 px below it, which design round 4 (D15) and UX
	 * round 4 (U16) asked to remove, and the panel now states only what the row cannot
	 * -- a refusal, in its own words, where its controls are. The panel cannot be
	 * collapsed from here either (this row's own control is its overflow menu), so the
	 * sequence below polls the row's claim with the panel still open, which the header
	 * scope in `radientChip` is what makes a fact about the row.
	 */
	assert.equal(radientChip(container), "Signed in", text(container));
	const panel = rowOf(container, "radient")?.querySelector(
		"[data-sign-in-state]",
	);
	assert.ok(panel, `the panel's body is on screen: ${text(container)}`);
	assert.equal(
		occurrences(text(panel), "Signed in"),
		0,
		`the panel must not restate the row's claim: ${text(panel)}`,
	);
	await chipSequence(container, (chip) => chip === "Signed in");
});

/**
 * The list is never stuck, in every state the verdict can be in that is not an
 * answer: never answering, no `tunnel` capability (the read is never issued),
 * and -- with the census itself failing -- the census's own error branch and its
 * Retry, which a verdict gate once swallowed (`backend-error-surfaces`).
 */
test("the card list is never held behind the verdict read", async () => {
	holdVerdict = true;
	const hung = await mountGridRaw();
	await chipSequence(hung.container, (chip) => chip === "withheld");
	for (let sample = 0; sample < 4; sample++) {
		await flush();
		assert.ok(
			!text(hung.container).includes("Loading providers"),
			`sample ${sample + 1} under a never-answering verdict: ${text(hung.container)}`,
		);
		assert.ok(text(hung.container).includes("OpenAI"), text(hung.container));
	}
	await act(async () => {
		hung.root.unmount();
	});
	/*
	 * And under the same never-answering verdict, a fault this app has already
	 * read for itself is not withheld behind it: the account read's `refused`
	 * speaks without the verdict (the live rig measured the chip withheld to the
	 * transport's 20,040 ms deadline on a machine whose account read had said
	 * `refused` at ~300 ms, before this arm existed).
	 */
	accountAnswer = "refused";
	const hungRefused = await mountGridRaw();
	const refusedSequence = await chipSequence(
		hungRefused.container,
		(chip) => chip === "Needs re-authentication",
	);
	assert.ok(
		!refusedSequence.includes("Signed in"),
		refusedSequence.join(" -> "),
	);
	await act(async () => {
		hungRefused.root.unmount();
	});
	accountAnswer = "ready";
	holdVerdict = false;
	releaseVerdict();

	tunnelCapability = false;
	accountAnswer = "ready";
	verdictRequests = 0;
	const gated = await mountGridRaw();
	const sequence = await chipSequence(
		gated.container,
		(chip) => chip === "Signed in",
	);
	assert.equal(verdictRequests, 0, "a gated read was issued anyway");
	assert.ok(
		!sequence.includes("Needs re-authentication"),
		sequence.join(" -> "),
	);
	await act(async () => {
		gated.root.unmount();
	});
	tunnelCapability = true;

	censusFails = true;
	holdVerdict = true;
	const broken = await mountGridRaw();
	const deadline = Date.now() + 5000;
	while (!text(broken.container).includes("Retry")) {
		if (Date.now() > deadline) {
			throw new Error(
				`the census error never replaced the loading state: ${text(broken.container)}`,
			);
		}
		await flush();
	}
	assert.ok(!text(broken.container).includes("Loading providers"));
	holdVerdict = false;
	releaseVerdict();
});

/**
 * The detail panel, which is the surface the incident was photographed on, and the
 * surface whose badge design round 4 (D15) removed: the row above it already says
 * which verdict this is, in the verdict's own tone, with the long form on its
 * `title` -- so the panel states a refusal in its own words where its controls are
 * and carries no badge at all.
 */
test("the detail panel states a refused verdict in its own words, with no badge", async () => {
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
	/*
	 * The long form reaches the user through the ALERT's body now, not through a
	 * badge's `title` -- the badge is gone (D15/U16), and this is the assertion that
	 * says the sentence did not go with it.
	 */
	assert.match(
		refusedText,
		REFUSED_DETAIL,
		`the panel must state the refusal in the verdict's own words: ${refusedText}`,
	);
	assert.doesNotMatch(refused.container.innerHTML, /<span[^>]*>Signed in</);
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
	/*
	 * And a healthy panel states NOTHING: the row above it owns the claim. A count of
	 * one here is the duplication this round removed; a count of one there is the fix.
	 */
	assert.equal(occurrences(healthyText, "Signed in"), 0, healthyText);
});

/**
 * The other arm of the panel's `retryOnMount: false` (review round 4, m3), which
 * was promised only in `RadientLoginVerdictOptions`' docstring: the option stops
 * a mount from RE-asking a failed read, and must not stop the FIRST read when
 * nothing has asked yet. The panel is mounted alone, on a client whose verdict
 * key has never been queried -- so if the option suppressed the first read the
 * panel would have no verdict at all, and (since round 4) no badge either.
 */
test("the panel still starts the first verdict read when nothing has asked yet", async () => {
	loginAnswer = "ok";
	accountAnswer = "ready";
	const { container, queryClient } = await renderDetail();
	await awaitReads(container, queryClient);
	assert.equal(verdictRequests, 1, "the panel never asked for the verdict");
	assert.equal(
		queryClient.getQueryData(radientSessionIssueKey)?.radient_login?.state,
		"ok",
	);
	/*
	 * The read happens; the claim is not made HERE. The panel is passed the surround's
	 * verdict when there is one and derives its own only for a surface that hands it
	 * nothing -- and neither arm paints a claim the row above already paints (D15/U16).
	 */
	assert.equal(occurrences(text(container), "Signed in"), 0, text(container));
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
	/*
	 * ZERO, where the card grid counted one: with the Radient row in the Connected
	 * block, no row on this page says "Needs sign-in" -- an Add row states the action
	 * it performs, not a status. The property this case is about (RADIENT is not
	 * among the rows told to sign in) is read off the row itself, below, rather than
	 * off a total that a second row's chip used to inflate.
	 */
	assert.equal(occurrences(body, "Needs sign-in"), 0, body);
	assert.equal(radientChip(container), "Signed in", body);
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
	/*
	 * The long form rides the ROW's `title` here -- the row states the claim, tone and
	 * detail, and the panel adds nothing to it (design round 4 D15, UX round 4 U16).
	 */
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
	/*
	 * The long form -- which names a sign-in stored on this machine -- is gone, and
	 * the label is the verdict's own word for one condition (D5). Where the label
	 * LIVES moved with this change's anatomy: a provider whose census counts no
	 * credential is an Add row, and the Add block makes no claim about a sign-in at
	 * all, so no row on this page states either word. The label-versus-long-form
	 * distinction is therefore asserted where it still lives -- on
	 * `providerReadiness` below, which is the one owner of both words -- and the
	 * surface half is asserted on the surface that would carry it: Radient's own
	 * panel, whose badge is gated on the census counting a credential.
	 */
	assert.equal(occurrences(body, "Needs re-authentication"), 0, body);
	assert.equal(occurrences(body, "Signed in"), 0, body);
	assert.doesNotMatch(container.innerHTML, REFUSED_DETAIL_ATTRIBUTE);
	await expandAddRow(container, "radient");
	const panel = rowOf(container, "radient")?.querySelector(
		"[data-sign-in-state]",
	);
	assert.ok(panel, `the Add row did not open its panel: ${text(container)}`);
	assert.equal(
		occurrences(text(panel), "Needs re-authentication"),
		0,
		`a removed row carries no badged claim: ${text(panel)}`,
	);
	assert.doesNotMatch(panel.innerHTML, REFUSED_DETAIL_ATTRIBUTE);
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
 * M3: a sign-in started from the Radient ROW refreshes the verdict the claim reads.
 *
 * The claim is keyed on the verdict query, and `refreshProviders` -- the callback
 * the row's panel runs the moment a sign-in succeeds -- refreshed only the
 * provider census. So the user who had just repaired the fault was told it was
 * still broken: the row kept reading "Needs re-authentication" until the 60 s
 * poll or a window focus. Driven the way the reviewer reproduced it (refused /
 * open the row's panel / sign in / `auth.status` answers `succeeded` / press the
 * receipt's action), and asserted on the REQUEST COUNT as well as the words,
 * because a claim that flipped for some other reason would not prove the verdict
 * was re-asked.
 */
test("a successful sign-in from the row refreshes the verdict the claim reads", async () => {
	loginAnswer = "refused";
	accountAnswer = "ready";
	authPollStates = ["succeeded"];
	/*
	 * Mounted with the panel already open on Radient, through the grid's own deep
	 * link (`initialProviderId`) rather than by pressing the row's control: see
	 * `expandAddRow`'s note. Everything else about this case is unchanged, and the
	 * press it drives is the panel's own sign-in control below.
	 */
	const { container } = await renderGrid({ providerId: "radient" });
	/*
	 * Read on the surface that carries it: with the panel open, the page says the
	 * verdict TWICE -- the row's line above and the panel's badge beside its own
	 * control -- and each is asserted where it lives rather than summed into a total
	 * that no longer means one claim.
	 */
	assert.equal(
		radientChip(container),
		"Needs re-authentication",
		text(container),
	);
	const panel = rowOf(container, "radient")?.querySelector(
		"[data-sign-in-state]",
	);
	assert.ok(
		panel,
		`the deep link did not open the panel: ${text(container).slice(0, 300)}`,
	);
	assert.equal(
		occurrences(text(panel), "Needs re-authentication"),
		1,
		`the panel's badge states the refusal too: ${text(panel)}`,
	);
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

	const signIn = [...container.querySelectorAll("button")].find((candidate) =>
		CONTINUE_IN_BROWSER.test(candidate.textContent ?? ""),
	);
	assert.ok(
		signIn,
		`the row did not open its panel: ${text(container).slice(0, 300)}`,
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
		"the verdict was never re-read, so the claim could only change by luck",
	);
	/*
	 * The receipt's own action collapses the panel (`onDone`), which is the
	 * close this anatomy has for a row: the row that opened the panel is what
	 * closes it, and here the control is the receipt's, not a "Back to providers"
	 * header. With the panel gone the page's only claim is the row's, so the count
	 * below is a count of one row.
	 */
	await press((label) => RECEIPT_DONE.test(label.trim()));
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
	/*
	 * THE SECTION'S OWN SENTENCE, not the badge's title: the badge this assertion used
	 * to read is gone (D15/U16), and what the user is owed -- why the details could not
	 * be read -- is the account read's sentence in the body.
	 */
	assert.match(body, /refused the sign-in this app is holding/);
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

/* ---- Q-8: a FAILED verdict read, and the two surfaces that used to loop on it -- */

/**
 * Whether the grid is showing an opened provider's panel.
 *
 * Identified by the panel's OWN body rather than by a control: the panel is no
 * longer a screen with its own "Back to providers" header, it is a block inside
 * the row that opened it, and the body it renders in every phase carries
 * `data-sign-in-state` (the marker the sign-in stories read too). Nothing else in
 * this grid renders one.
 */
const panelOpen = (container) =>
	container.querySelector("[data-sign-in-state]") !== null;

/**
 * Press an ADD row's own control, which is the button that opens its panel.
 *
 * ONE ROW KIND ONLY, deliberately. An Add row carries one control and it IS the
 * action (`aria-expanded`, its label reading "Close" while its panel is open),
 * so a press both opens and closes it. A CONNECTED row has no such control: its
 * panel is reached through the row's overflow MENU, and this helper asserts the
 * trigger is not one rather than reaching for it, because driving that menu under
 * this harness's jsdom does not merely fail -- it stops the process (measured on
 * the fold: the `pointerdown` returns, no render lands, and no later event-loop
 * phase runs, so neither a timer nor a `setImmediate` in the case ever fires, and
 * the file is killed at its timeout). Radix's menu content is what does it: the
 * same press on the same trigger with the content never mounted is harmless. Each
 * case that needs a Connected row's panel open therefore mounts it through the
 * grid's own deep link (`initialProviderId`, which is `renderGrid`'s and
 * `mountGridRaw`'s argument here, and what Settings' `?provider=` query and the
 * connect dialog use in the app) and says so in its own words.
 */
async function expandAddRow(container, id) {
	const row = rowOf(container, id);
	assert.ok(row, `no row for ${id}: ${text(container).slice(0, 300)}`);
	const header = row.firstElementChild;
	const action = header?.querySelector("button[aria-expanded]");
	assert.ok(action, `no control on ${id}'s row: ${text(row).slice(0, 200)}`);
	assert.equal(
		action.getAttribute("aria-haspopup"),
		null,
		`${id} is a CONNECTED row, whose panel is behind its overflow menu - open it with the grid's \`initialProviderId\` instead (see this helper's own note)`,
	);
	await act(async () => {
		action.dispatchEvent(
			new window.MouseEvent("click", { bubbles: true, cancelable: true }),
		);
	});
	await act(async () => {});
}

/**
 * Sample the surface for `ms`, recording every frame that was on the loading gate
 * and every frame that had lost the panel. A LOOP, not a single read, is the
 * thing asserted against: the pre-fix grid alternated between the panel and the
 * gate every attempt, so any one sample could land on either.
 */
async function watch(container, ms, { expectPanel }) {
	const started = Date.now();
	let gated = 0;
	let panelLost = 0;
	let samples = 0;
	while (Date.now() - started < ms) {
		await flush();
		samples += 1;
		const rendered = text(container);
		if (rendered.includes("Loading providers")) gated += 1;
		if (expectPanel && !panelOpen(container)) panelLost += 1;
	}
	return { gated, panelLost, samples };
}

/**
 * Count the verdict fetches THIS client starts, from its own query cache.
 *
 * WHY NOT THE BRIDGE COUNTER (review round 5, R5-1). `verdictRequests` counts
 * every request that reaches the one stubbed bridge, from any client alive in
 * the process; when a grid from an earlier case was still mounted, its reads
 * were charged to the press and the case reported the Q-8 loop that had not
 * come back. A `fetch` action on this client's own verdict query is a read this
 * client commissioned and nothing else. (`retry: false` on that query, so one
 * fetch is one request.)
 */
function ownVerdictFetches(queryClient) {
	const counted = { count: 0 };
	const key = JSON.stringify(radientSessionIssueKey);
	counted.stop = queryClient.getQueryCache().subscribe((event) => {
		if (
			event.type === "updated" &&
			event.action.type === "fetch" &&
			JSON.stringify(event.query.queryKey) === key
		) {
			counted.count += 1;
		}
	});
	return counted;
}

/**
 * Q-8 (QA round 3): with `GET /v1/auth/status` failing, pressing ANY card left
 * the grid on "Loading providers" for good and never opened the panel, at ~70
 * requests a second (QA: 1,579 in 20 s from the Radient card, 1,459 from
 * OpenAI's; `origin/main` 0 and the panel opens).
 *
 * The mechanism, two halves: the panel mounted the verdict read with React
 * Query's default `retryOnMount`, which re-runs a FAILED, data-less query when an
 * observer mounts; and the grid held its list on `isPending`, which a data-less
 * query re-enters for every attempt. So the press mounted the panel, the mount
 * re-asked, the gate unmounted the panel, the read failed, the panel remounted.
 * The list-hold half is gone at the source in this anatomy -- nothing waits on the
 * verdict but the Radient row's claim (D12/D14, asserted above) -- so the panel's
 * mount is the only variable the press leaves behind.
 *
 * THE BOUND: the press may cost ZERO further verdict reads. The grid already
 * owns the read and has recorded its failure; the panel only reports it. The
 * window is two seconds, which the pre-fix loop fills with dozens of reads here.
 */
for (const [card, providerId] of [
	["OpenAI", null],
	["Radient", "radient"],
]) {
	test(`a failing verdict route does not stop the ${card} row from opening`, async () => {
		verdictFails = true;
		accountAnswer = "ready";
		/*
		 * HOW EACH ROW'S PANEL IS REACHED, and it is not the same control. An ADD row
		 * (OpenAI here) owns its action button, and this case presses it. A CONNECTED
		 * row reaches its panel through its overflow MENU, which this harness cannot
		 * drive at all -- see `expandAddRow`'s note for the measurement -- so Radient's
		 * panel is opened through the grid's own deep link, and the property this case
		 * is about (the panel's mount must not re-commission a failed verdict read) is
		 * asserted on the same composition either way.
		 */
		const { container, queryClient } = await renderGrid({ providerId });
		assert.equal(
			queryClient.getQueryState(radientSessionIssueKey)?.status,
			"error",
		);
		const before = verdictRequests;
		const own = ownVerdictFetches(queryClient);
		if (providerId === null) await expandAddRow(container, "openai");
		const seen = await watch(container, 2000, { expectPanel: true });
		own.stop();
		const reads = own.count;
		const stray = verdictRequests - before - reads;
		// Asserted first, and in its own words: a read the bridge saw that this
		// case's client did not start is a leaked surface, not the press (R5-1).
		assert.equal(
			stray,
			0,
			`${stray} verdict read(s) inside the press window came from ANOTHER client - a surface outlived its case; this is not the Q-8 loop`,
		);
		assert.equal(
			reads,
			0,
			`the press re-commissioned the failed verdict read ${reads} times in 2 s - the loop`,
		);
		assert.equal(
			seen.gated,
			0,
			`${seen.gated} of ${seen.samples} frames after the press were "Loading providers"`,
		);
		assert.equal(
			seen.panelLost,
			0,
			`${seen.panelLost} of ${seen.samples} frames after the press had no panel: ${text(container).slice(0, 200)}`,
		);
	});
}

/**
 * The gate's own half of Q-8, asserted where it is reachable without a panel:
 * once the verdict read has ANSWERED - here, by failing - a later attempt at it
 * (the 60 s poll, a window focus, `refreshProviders`' invalidation) must not put
 * the card list, or an open panel, back behind "Loading providers". A data-less
 * query is `pending` again for every attempt, which is what the old
 * `isPending` hold read. Since round 4 the FIRST read holds only the Radient
 * card's claim, never the list (D6/D12, asserted above).
 *
 * The re-attempt is HELD open so the frame under it can be sampled; releasing it
 * lets it fail again, and the list must still be there after.
 */
test("a failed verdict read never puts the row list back behind its loading gate", async () => {
	accountAnswer = "ready";
	// The first read, held and then FAILED: the hold releases on a failure too.
	verdictFails = true;
	holdVerdict = true;
	const queryClient = client();
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	mounted.push({ root, queryClient, container });
	await act(async () => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client: queryClient },
				createElement(ProviderGrid, {}),
			),
		);
	});
	await flush();
	// The first read out: the list is on screen and the Radient claim withheld
	// (D12/D14), rather than the whole list held as it was before round 4.
	assert.ok(!text(container).includes("Loading providers"), text(container));
	assert.equal(radientChip(container), "withheld", text(container));
	holdVerdict = false;
	releaseVerdict();
	await awaitReads(container, queryClient);
	assert.equal(
		queryClient.getQueryState(radientSessionIssueKey)?.status,
		"error",
	);
	assert.ok(
		!text(container).includes("Loading providers"),
		`a failed first read left the list on its gate: ${text(container)}`,
	);

	const reattempt = async (
		label,
		expectPanel,
		grid = { container, queryClient },
	) => {
		const { container, queryClient } = grid;
		holdVerdict = true;
		const before = verdictRequests;
		await act(async () => {
			void queryClient.invalidateQueries({ queryKey: radientSessionIssueKey });
		});
		const deadline = Date.now() + 5000;
		while (verdictRequests === before && Date.now() < deadline) await flush();
		assert.ok(
			verdictRequests > before,
			`${label}: the re-attempt was never made`,
		);
		const held = await watch(container, 300, { expectPanel });
		assert.equal(
			held.gated,
			0,
			`${label}: ${held.gated} of ${held.samples} frames under a re-read of a failed verdict were "Loading providers"`,
		);
		assert.equal(
			held.panelLost,
			0,
			`${label}: the re-read unmounted the open panel`,
		);
		holdVerdict = false;
		releaseVerdict();
		const after = await watch(container, 300, { expectPanel });
		assert.equal(
			after.gated,
			0,
			`${label}: gated after the re-read failed again`,
		);
		assert.equal(
			after.panelLost,
			0,
			`${label}: the panel was lost after the re-read`,
		);
	};

	// With the ROW list on screen.
	await reattempt("row list", false);
	assert.ok(text(container).includes("OpenAI"), text(container));
	/*
	 * And with a panel open, which is the composition the loop lived in. A SECOND
	 * grid, mounted with Radient's panel already open through the grid's own deep
	 * link rather than by pressing a control in the first one: this harness cannot
	 * drive the overflow menu a Connected row reaches its panel through, and
	 * `expandAddRow`'s note records the measurement. Waiting for the first grid's
	 * reads (then releasing the hold) keeps the two mounts from sharing a frame.
	 */
	holdVerdict = false;
	releaseVerdict();
	await awaitReads(container, queryClient);
	const opened = await mountGridRaw("radient");
	/*
	 * The second mount's own reads have to have answered before its panel exists at
	 * all: a grid whose provider census is still in flight renders "Loading
	 * providers", and there is no row for the deep link to open under.
	 */
	await awaitReads(opened.container, opened.queryClient);
	assert.ok(
		panelOpen(opened.container),
		`the deep link did not open the panel: ${text(opened.container).slice(0, 200)}`,
	);
	await reattempt("open panel", true, opened);
});
