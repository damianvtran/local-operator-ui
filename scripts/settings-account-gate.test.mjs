import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { act } from "react";

// THE REPORT: /settings sits on a spinner forever, with no caption and no
// settings sidebar, while the app is attached to a healthy backend.
//
// MEASURED IN THE BUILT APP (2026-09-19, an isolated daemon behind a proxy that
// answers the Radient account read 401 and every other route normally):
//
//   t=0.5s   ['config'] success/idle       ['radient-user','user'] pending/fetching
//   t=5s     ['config'] success/idle       ['radient-user','user'] pending/fetching
//   t=30s    ['config'] success/idle       ['radient-user','user'] pending/fetching
//            no settings sidebar, a11y text "Loading settings" at every sample
//
// and at the backend, 33 account reads in 33.4s (the round-1 reading), which is
// WHY THE READ LOOKS LIKE A POLL AND IS NOT ONE. Re-measured by qa round 3 at the
// backend, a refused read is 3 attempts in ~3.0s - React Query's own 1s then 2s
// backoff - and a read that never answers is 3 attempts ~21000ms and ~22000ms
// apart and then silence, those gaps being the TRANSPORT's per-op deadline
// (`DESKTOP_CONTROL_DEADLINE_MS`, 20s) plus that backoff. The renderer's own bound
// is 5s longer (20s + `DESKTOP_DEADLINE_MARGIN_MS`, measured at 25.06s) and fires
// only when main never replies at all - a different anchor, which is why the gaps
// are quoted rather than offsets from the mount. The attempt count is the retry
// policy in `use-radient-user-query.ts`; none of these is an observer-subscribe
// rate, which is a mechanism nothing here can sample. The page was held by
// `isConfigLoading || isAuthLoading` with the config read ALREADY SATISFIED, and
// the account read is the one this page does not need: it reads a single boolean,
// for two read-only fields.
//
// WHY THIS IS RENDERED AND NOT ASSERTED OVER A SELECTOR. The defect is which
// BRANCH renders, and the branch is a boolean AND of two queries' loading
// flags. A test over `isLoading` would restate the expression; rendering the
// shipped page against a real `QueryClient` sees the spinner a user sees.
//
// The cases below are the halves of that fault and of the two review rounds on
// it:
//   - a read that never settles (the measured state),
//   - a read that settles as a REFUSAL (401), which the hook does not treat as
//     the signed-out state, so the profile fields silently fall back to the
//     user store's default name "User",
//   - the PRESS that asks again, which must not erase the class it is asking
//     about (review round 2, B1), and
//   - a RESOLVED account with a failed refetch, which must not have its own name
//     and email called placeholders (review round 2, B3).
//
// The last two need a MOUNTED hook: the class the page renders for a failure is
// recorded by the query function's own catch, and a static render never
// subscribes, so it would never run the query function at all.

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { renderToStaticMarkup } from "react-dom/server";
			import { createRoot } from "react-dom/client";
			import { MemoryRouter } from "react-router-dom";
			import { QueryClientProvider } from "@tanstack/react-query";
			import { SettingsPage } from "./src/renderer/src/features/settings/components/settings-page";
			import {
				classifyRadientAccountFailure,
				radientUserKeys,
				useRadientUserQuery,
			} from "./src/renderer/src/shared/hooks/use-radient-user-query";
			export { QueryClient } from "@tanstack/react-query";
			export { configQueryKey } from "./src/renderer/src/shared/hooks/use-config";
			export { desktopResult, DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";
			export { classifyRadientAccountFailure, radientUserKeys, useRadientUserQuery };

			export const renderSettings = (client) =>
				renderToStaticMarkup(
					createElement(
						QueryClientProvider,
						{ client },
						createElement(
							MemoryRouter,
							{ initialEntries: ["/settings"] },
							createElement(SettingsPage, {}),
						),
					),
				);

			/*
			 * The MOUNTED probe: the shipped hook, publishing its own reading on every
			 * render so a test can read the classification the surfaces render from
			 * without reaching into React. refreshUser is exposed as the control the
			 * alert's Retry button calls, so the press under test is the app's own.
			 */
			export const ReadProbe = () => {
				const read = useRadientUserQuery();
				globalThis.__accountReadProbe = {
					accountRead: read.accountRead,
					isLoading: Boolean(read.isLoading),
					isFetching: Boolean(read.isFetching),
					hasAccount: Boolean(read.user),
					errorMessage: read.error ? String(read.error.message) : null,
					isRefreshing: Boolean(read.isRefreshing),
					refreshUser: read.refreshUser,
				};
				return null;
			};

			/*
			 * A SECOND consumer of the same hook, which is the rail: two observers
			 * on one query, each re-rendering on its own. It publishes separately so a
			 * case can hold the two readings side by side, which is what "one
			 * reading, four surfaces" means and what qa round 3 (Q2) found broken.
			 */
			export const ReadProbeB = () => {
				const read = useRadientUserQuery();
				globalThis.__accountReadProbeB = {
					accountRead: read.accountRead,
					isFetching: Boolean(read.isFetching),
				};
				return null;
			};

			export const mountReadProbe = (container, client) => {
				const root = createRoot(container);
				root.render(
					createElement(
						QueryClientProvider,
						{ client },
						createElement(ReadProbe),
						createElement(ReadProbeB),
					),
				);
				return root;
			};
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@assets": "./src/renderer/src/assets",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	// React, React Query and the router stay external so the bundle shares ONE
	// copy with this file's own imports; a second copy would hand the page a
	// different query client than the one the test seeds. `react-dom/client` joins
	// them for the mounted cases: a bundled second copy would feature-detect its own
	// DOM and mount a second renderer.
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react-dom/client",
		"react/jsx-runtime",
		"react-router-dom",
		"@tanstack/react-query",
	],
	// Stylesheets and images carry no assertion here, and Node can import
	// neither: the page's graph reaches the onboarding tour's screenshots.
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
	 * `import.meta.env` is the bundler's, and this is not the bundler: without
	 * it `load-config.ts` calls `Object.entries(undefined)` while the module graph
	 * is evaluated, so the page could not be imported at all. The values are the
	 * ones a build needs, not a configuration under test.
	 */
	define: { "import.meta.env": "globalThis.__RIG_ENV__" },
	jsx: "automatic",
	write: false,
});

const bundlePath = new URL(
	`./_settings-account-gate-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);

/**
 * The config the page renders, structurally complete.
 *
 * Every key the route's sections read is present with the same TYPE the daemon
 * sends (measured against a live `GET /v1/config`), because a section that
 * reaches a missing nested field throws while rendering and would fail this
 * test for a reason that has nothing to do with the gate it is about. The
 * contents are empties: this is a fixture, not a configuration under test.
 */
const TEST_CONFIG = {
	version: "0.0.0-test",
	metadata: {
		created_at: "2026-01-01T00:00:00Z",
		last_modified: "2026-01-01T00:00:00Z",
		description: "test config",
	},
	values: {
		conversation_length: 100,
		detail_length: 15,
		max_learnings_history: 50,
		hosting: "",
		model_name: "",
		model_effort: "",
		auto_save_conversation: false,
		tool_approval_mode: "ask",
		providers: {},
		retry: {},
		session: {},
		shell_environment: {},
		subagents: {},
		web_fetch: {},
		web_search: {},
	},
};

/**
 * The DOM the page's graph expects before it is evaluated.
 *
 * WHY BEFORE THE IMPORT RATHER THAN AT MOUNT: two modules in this graph read
 * browser state as they are evaluated - the onboarding store persists through
 * `localStorage`, and the user store rehydrates from it - so a missing document
 * is an import-time throw, not a render-time one. `http://localhost/` rather
 * than jsdom's default opaque origin is load-bearing for the same reason: the
 * persist middleware resolves `localStorage` once, and it stays storage-less for
 * the whole file if that read throws.
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
 * The bridge, installed before the module graph is evaluated.
 *
 * `window.api.desktop` must exist or the renderer takes its browser-dev HTTP
 * branch, which is not the code that ships. Four ops are answered: the
 * capabilities negotiation (which is what ENABLES the account read at all -
 * `desktopFeatureEnabled(capabilities, "radient")`), the config read the page
 * cannot render without, and the Radient account read under test. Everything
 * else is refused, which is how the surfaces this test is not about stay out of
 * its way.
 */
/**
 * What the bridge answers for the account op, per state under test.
 *
 * THE ENVELOPES ARE THE BACKEND'S OWN, copied from
 * `local_operator/server/routes/desktop_radient.py`'s `_failure` (main branch and
 * the paired `fix/radient-refused-credential`): `{code, message, details}`, which
 * `desktopResult` turns into `DesktopControlError.code`. The untyped answers are
 * as measured too - the daemon in the field answers the no-credential case from
 * its single-op path with a bare string detail, and the desktop plane's own
 * refusal (this app's bearer) has never carried a `radient_` code. Which of these
 * a surface may call a refused CREDENTIAL is decided by the code, not the status,
 * so the statuses here are deliberately the same 401 in two opposite meanings.
 *
 * `account` is the success envelope the read resolves to: the section renders the
 * account's own name and email from it, which is the half of review round 2's B3
 * that must survive a failed refetch.
 */
const ACCOUNT_ANSWERS = {
	account: {
		status: 200,
		body: {
			/*
			 * `result` is the desktop envelope and `data` is the upstream one:
			 * `radientProxy` reads through both (`desktopResult` -> `.result`,
			 * then `.data`, then the Radient `{msg, result}` envelope).
			 */
			result: {
				data: {
					msg: "ok",
					result: {
						account: {
							id: "acct_qa_settings_gate",
							tenant_id: "ten_qa_settings_gate",
							email: "qa-settings-gate@example.test",
							name: "QA Settings Gate",
							role: "owner",
							status: "active",
							created_at: "2026-01-02T03:04:05Z",
							updated_at: "2026-01-02T03:04:05Z",
						},
						identity: {
							email: "qa-settings-gate@example.test",
							provider: "google",
							provider_id: "google-qa-settings-gate",
						},
					},
				},
			},
		},
	},
	refused: {
		status: 401,
		body: {
			detail: {
				code: "radient_credential_refused",
				message: "Radient could not complete this operation",
				details: {},
			},
		},
	},
	"refused-plane-bearer": {
		status: 401,
		body: { detail: "Desktop authorization is required." },
	},
	"upstream-failed": {
		status: 502,
		body: {
			detail: {
				code: "radient_upstream_failed",
				message: "Radient could not complete this operation",
				details: { reason: "credential_unavailable" },
			},
		},
	},
	"signed-out": {
		status: 409,
		body: { detail: "Sign in to Radient to access your account" },
	},
};

let accountBehaviour = "pending";

/** Account reads this bridge has answered, for the `refuse-then-hold` mode. */
let attemptsOnAccount = 0;

/**
 * Releases the read the "pending" answer holds open, called from teardown.
 *
 * WHY THE RIG LETS GO AT ALL. The state under test is "the read has not answered
 * yet", which is what the assertions see - but a promise that never settles also
 * leaves the transport's per-op deadline pending and React Query's retry chain
 * running behind a destroyed observer, and those timers are what held this file
 * open for minutes after its last assertion (measured). Releasing it once nothing
 * is left to assert costs the state nothing.
 */
let releaseHeldOpenRead = () => {};

globalThis.window.api = {
	desktop: {
		request: async (request) => {
			if (request?.control?.operation === "account") {
				if (accountBehaviour === "refuse-then-hold") {
					/*
					 * The FIRST attempt fails and every attempt after it is held open:
					 * the state qa round 3 measured in the built app (`r3-hold`), where a
					 * class is recorded while the chain is still asking, and where NO
					 * prop any observer tracks changes after that first failure - which
					 * is why it is the case that discriminates a subscribed record from a
					 * map nobody re-reads.
					 */
					attemptsOnAccount += 1;
					if (attemptsOnAccount > 1) {
						return await new Promise((resolve) => {
							releaseHeldOpenRead = () =>
								resolve(ACCOUNT_ANSWERS[accountBehaviour]);
						});
					}
					return ACCOUNT_ANSWERS.refused;
				}
				if (accountBehaviour === "pending") {
					// Holds the read open - the measured state, where the read is
					// asked again on the client's own retry schedule and the query
					// stays `pending`/`fetching`, so `isLoading` never goes false and
					// no attempt of the chain ever answers. It is released by
					// `releaseHeldOpenRead()` in teardown, which is rig hygiene rather
					// than a different state: every assertion is made while it is
					// still held open.
					return await new Promise((resolve) => {
						releaseHeldOpenRead = () =>
							resolve(ACCOUNT_ANSWERS[accountBehaviour]);
					});
				}
				return ACCOUNT_ANSWERS[accountBehaviour];
			}
			if (request?.op === "capabilities") {
				// `desktop_available` plus the feature key is what the account read
				// is gated on, so a mounted probe with no answer here would never
				// fetch at all. Nothing in the static path reads it (a static render
				// does not subscribe), so this changes no existing case.
				return {
					status: 200,
					body: {
						result: {
							desktop_available: true,
							features: { radient: 1 },
						},
					},
				};
			}
			if (request?.op === "config.get") {
				return {
					status: 200,
					body: {
						status: 200,
						message: "Configuration retrieved successfully",
						result: TEST_CONFIG,
					},
				};
			}
			return { status: 503, body: { detail: "not part of this test" } };
		},
	},
};

const {
	QueryClient,
	configQueryKey,
	radientUserKeys,
	classifyRadientAccountFailure,
	desktopResult,
	DesktopControlError,
	renderSettings,
	mountReadProbe,
} = await import(bundlePath.href);
await unlink(bundlePath);

/** The rendered text a user reads, with markup and layout whitespace removed. */
function text(html) {
	return html
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * A client whose config read has already succeeded.
 *
 * Seeded through `setQueryData` because the config the page renders is a
 * PRECONDITION of these cases: the fault is what the page does while the
 * account read is not answering, not whether config arrives.
 */
function clientWithConfig(mutations = {}) {
	const client = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: Number.POSITIVE_INFINITY,
				retryOnMount: false,
			},
			/*
			 * MUTATIONS NEED THEIR OWN `gcTime`, and this is a measurement rather
			 * than tidiness. The mounted cases below press the alert's Retry, which
			 * is a MUTATION (`refreshUser`), and the MutationCache's default is five
			 * minutes and is NOT reachable through `defaultOptions.queries` - with it
			 * in place this file sat for its full 300s after the last assertion, one
			 * 300000ms `Mutation.scheduleGc` timer being all that was left (measured).
			 */
			mutations,
		},
	});
	client.setQueryData(configQueryKey, TEST_CONFIG);
	return client;
}

/** The settings sidebar, which renders past BOTH of the page's early returns. */
const SETTINGS_NAV = /aria-label="Settings sections"/;

/**
 * The page, rendered with one answer from the account read.
 *
 * `read` is `"pending"` (started and never awaited — the measured state) or a
 * key of `ACCOUNT_ANSWERS`. Every answering state is driven through the SHIPPED
 * transport (`desktopResult`), so the error under test is the one the app builds
 * from a bridge response, `code` and all, rather than a hand-made one.
 */
async function renderWithAccountRead(read) {
	accountBehaviour = read;
	const client = clientWithConfig();
	const queryFn = () =>
		desktopResult({ op: "radient.request", control: { operation: "account" } });
	if (read === "pending") {
		void client.fetchQuery({
			queryKey: radientUserKeys.user(),
			queryFn,
			retry: false,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
	} else {
		await assert.rejects(
			client.fetchQuery({
				queryKey: radientUserKeys.user(),
				queryFn,
				retry: false,
			}),
			(error) => {
				assert.ok(
					error instanceof DesktopControlError,
					`the account failure must carry its status, got ${error?.constructor?.name}`,
				);
				return true;
			},
		);
	}
	const html = renderSettings(client);
	return { client, html, rendered: text(html) };
}

/**
 * The aria a profile field carries ONLY while it can be edited, and the one it
 * carries when it is locked. Both are asserted in several cases; they live here
 * because `scripts/` sits outside `pnpm lint`'s path list and biome's own rule
 * wants a literal it can see once (script-lint: useTopLevelRegex).
 */
const EDITABLE_PROFILE_FIELD =
	/aria-label="Current value: User\. Click to edit\."/;
const LOCKED_PROFILE_FIELD = /aria-label="Current value: User\."/;

/**
 * The page's alert control, wired to the signal that means "the press this
 * control received is still running" (qa round 3, Q1). A static render cannot
 * carry a press of its own, so this is how the page's own JSX is pinned.
 */
const PAGE_CONTROL_WIRED_TO_PRESS = /disabled=\{isAccountRefreshing\}/;

/**
 * The alert's own Retry control AS A USER SEES IT: a button reading "Retry" and
 * carrying no `disabled` ATTRIBUTE. Both halves matter - the label is what QA
 * read as "Retrying" with nobody having pressed, and the `disabled` bit is what
 * decides whether the press can land at all (qa round 3, Q1). The lookahead asks
 * for the attribute (`disabled=`), not the word: the control's own class list
 * carries Tailwind's `disabled:` variants.
 */
const ENABLED_RETRY = /<button(?![^>]*\sdisabled=)[^>]*>\s*Retry\s*<\/button>/;

/** How many times a phrase appears in the text a reader is shown. */
function occurrences(haystack, needle) {
	return haystack.split(needle).length - 1;
}

/**
 * Flush React and the clock until `predicate` holds, or fail naming what was
 * waited for.
 *
 * A poll rather than a fixed sleep: the states below are produced by a real query
 * function, React Query's own backoff and a real `act` flush, so "how long is
 * enough" is not a number this file can know - only a condition it can wait for.
 * The bound is generous because the fault cases genuinely take ~3s (three
 * attempts with 1s and 2s backoff, the retry policy under test).
 */
async function until(predicate, what, timeoutMs = 20_000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		/*
		 * FLUSH FIRST, THEN LOOK. A query state can change a tick before the render
		 * that publishes it, so checking first would hand the assertion a snapshot
		 * from before the change (measured: the probe still reporting the previous
		 * test's class while the query had already resolved).
		 */
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
		});
		const value = predicate();
		if (value) return value;
		if (Date.now() > deadline) {
			throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
		}
	}
}

/**
 * Mount the SHIPPED hook against a real `QueryClient`, a real transport and a
 * real DOM, and hand back what it says.
 *
 * WHY A MOUNT, WHEN EVERY OTHER CASE HERE IS A STATIC RENDER. The class the page
 * renders for a failure is recorded by the query function's own catch, and
 * `renderToStaticMarkup` never subscribes - so no fetch, no query function and
 * nothing recorded, which is exactly the state review round 2's B1 is about. The
 * press is driven through the hook's own `refreshUser`, the function the alert's
 * Retry button calls, rather than by invalidating the cache by hand.
 */
async function mountAccountRead(behaviour) {
	accountBehaviour = behaviour;
	attemptsOnAccount = 0;
	const client = clientWithConfig({ gcTime: 0 });
	const container = bootstrapDOM.window.document.createElement("div");
	bootstrapDOM.window.document.body.appendChild(container);
	/*
	 * `act` reads this flag, and without it React only WARNS and lets the effects
	 * flush on their own schedule - which is how a mount test becomes a race that
	 * passes locally and hangs in CI (`scripts/agent-hub-queries.test.mjs`).
	 */
	globalThis.IS_REACT_ACT_ENVIRONMENT = true;
	let root;
	await act(async () => {
		root = mountReadProbe(container, client);
	});
	/*
	 * The press the alert's Retry button performs: `refreshUser`'s mutation function
	 * is this insertion of the query, and it is used by the cases below and by the
	 * teardown, which is why it is a closure rather than inline in the test bodies.
	 */
	const pressed = async () => {
		await act(async () => {
			globalThis.__accountReadProbe.refreshUser();
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	};
	const state = () => client.getQueryState(radientUserKeys.user());
	/* What the last render published: the reading the surfaces actually used. */
	const snapshot = () => globalThis.__accountReadProbe;
	/* The second surface's own render, published separately (see `ReadProbeB`). */
	const snapshotB = () => globalThis.__accountReadProbeB;
	/*
	 * A FLUSHED SAMPLE, and every assertion about the CLASS the page renders goes
	 * through it rather than through `snapshot()` directly. The probe publishes on
	 * render, and the query layer commits a class rewrite a flush before the render
	 * that publishes it - so a value read straight off the last render can still be
	 * the class from BEFORE the change, which would let an assertion pass on a
	 * state the page never showed (review round 3, n1). `act` here makes the sample
	 * the newest render's, which is what these cases are about.
	 */
	const read = async () => {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
		return snapshot();
	};
	return {
		client,
		state,
		snapshot,
		snapshotB,
		read,
		/*
		 * The settle helpers wait on what the PROBE published, not on the query
		 * state: a state change is visible to `getQueryState` a flush before the
		 * render that reads it is, and every assertion below is about the render.
		 * Waiting on the state instead handed these cases a snapshot from the
		 * previous render (measured while writing them).
		 */
		settleOnFailure: async () => {
			await until(() => {
				const s = snapshot();
				return (
					s &&
					s.isFetching === false &&
					s.isLoading === false &&
					s.accountRead !== "checking"
				);
			}, "the failure to be rendered");
			return { state: state(), snapshot: snapshot() };
		},
		/* The query holds the account. */
		settleOnAccount: async () => {
			await until(
				() => snapshot()?.hasAccount === true,
				"the account to be rendered",
			);
			return { state: state(), snapshot: snapshot() };
		},
		press: pressed,
		/*
		 * THE RIG LEAVES THE READ ANSWERED, AND ONLY THEN TEARS ANYTHING DOWN.
		 *
		 * Two things depend on it. The reading an earlier answer held open is
		 * RELEASED, so the transport's own per-op deadline is not left as an orphan
		 * (measured: two timers still pending and a ~3 minute tail on the file after
		 * its last assertion). And the class recorded at the failure's source - which
		 * is module state shared by every case in this file - is CLEARED, because a
		 * read that ANSWERS is the only thing that clears it (`accountFailureKinds`):
		 * the press below is the app's own path to that answer rather than a reset
		 * exported for tests, and the assertion is what stops a later case from
		 * rendering this one's fault.
		 */
		teardown: async () => {
			accountBehaviour = "account";
			releaseHeldOpenRead();
			await pressed();
			await until(
				() => snapshot()?.accountRead === "ready",
				"the rig to leave the account read answered",
				5_000,
			);
			assert.equal(
				(await read())?.accountRead,
				"ready",
				"the rig must leave the account read ANSWERED, or the module's recorded failure outlives the case that produced it",
			);
			await act(async () => root.unmount());
			/*
			 * `clear()`, not just unmount: unmount destroys the observers, but the
			 * QUERY keeps the fetch and its retry chain alive, and this client's
			 * queries have an infinite `gcTime` - so removing them is what stops the
			 * timers.
			 */
			client.clear();
			container.remove();
			globalThis.__accountReadProbe = undefined;
			globalThis.__accountReadProbeB = undefined;
			globalThis.IS_REACT_ACT_ENVIRONMENT = false;
		},
	};
}

/**
 * The page, rendered against a client a mounted probe has already driven.
 *
 * The two cases below need BOTH instruments: the mount to produce the state
 * (which a static render cannot), and the page render to read what the surfaces
 * state in it. The dynamic import is cached, so this is the same module instance
 * the probe recorded into.
 */
function renderedAgainst(client) {
	const html = renderSettings(client);
	return { html, rendered: text(html) };
}

/**
 * The Retry controls a rendered frame offers.
 *
 * Counted as a DELTA against the signed-out render rather than as an absolute:
 * this fixture refuses every route it is not about, so other sections (the
 * providers grid) may carry a retry of their own, and an absolute number would
 * encode their behaviour into a test about this fault. What the design round
 * found was one fault adding a SECOND warning and a SECOND retry; the delta is
 * the property, not the total.
 */
function retryControls(html) {
	return (html.match(/>\s*Retry\s*</g) ?? []).length;
}

test("a Radient account read that never settles does not hold the settings page", async () => {
	const { client, html, rendered } = await renderWithAccountRead("pending");
	const state = client.getQueryState(radientUserKeys.user());
	assert.equal(
		state.status,
		"pending",
		"the seeded account read must still be pending",
	);
	assert.equal(
		state.fetchStatus,
		"fetching",
		"the seeded account read must still be in flight",
	);
	assert.ok(
		SETTINGS_NAV.test(html),
		`settings did not render while the account read was in flight; the page showed: ${rendered.slice(0, 200)}`,
	);
	/*
	 * The General section itself, which is behind BOTH of the page's early
	 * returns. `Loading settings` is deliberately NOT the assertion: that string
	 * is also the label of `BackendSettingsSection`'s own waiting spinner
	 * (`backend-settings-section.tsx`), which renders INSIDE a page that is
	 * already up - so its presence says nothing about this gate, and an
	 * assertion on it would fail here for a reason unrelated to the fault.
	 */
	assert.ok(
		typeof rendered === "string" && rendered.includes("User profile"),
		`the settings content did not render; the page showed: ${rendered.slice(0, 200)}`,
	);
	/*
	 * And the fields must not present the user store's placeholder as the
	 * reader's own while the app does not know whose they are. That was the
	 * operator's actual state (design round 1, D2: the 1.2s, 30s and 45s frames
	 * byte-identical, `Display name` reading "User" in editable styling, and the
	 * in-flight frame indistinguishable from the signed-out one).
	 */
	assert.ok(
		rendered.includes("Checking your Radient account"),
		`an unanswered account read said nothing about itself; the page showed: ${rendered.slice(0, 600)}`,
	);
	/*
	 * ONE read, ONE sentence (review round 2, m2). The page's caption sits beside
	 * the fields it qualifies; the section's own waiting state carries words of its
	 * own. When both spelled the same sentence, one read was described twice - the
	 * property design round 1's D1 decided - so the COUNT is asserted, not just the
	 * presence, and the section's own wording is pinned with it.
	 */
	assert.equal(
		occurrences(rendered, "Checking your Radient account"),
		1,
		`one read was stated twice on one page; the page showed: ${rendered.slice(0, 600)}`,
	);
	assert.ok(
		rendered.includes("Loading your Radient account details"),
		`the section's waiting state carried no words of its own; the page showed: ${rendered.slice(0, 600)}`,
	);
	assert.ok(
		!EDITABLE_PROFILE_FIELD.test(html),
		"the profile fields were editable while the account read was still out, so an edit made here is silently replaced when it resolves",
	);
	assert.ok(
		LOCKED_PROFILE_FIELD.test(html),
		"the display name field did not render as a disabled current value",
	);
	assert.ok(
		!rendered.includes("Radient account could not be read"),
		"a read that had not answered was reported as a failure",
	);
	client.clear();
});

test("a refused Radient account read is classified by the backend's code, and said once", async () => {
	const refused = await renderWithAccountRead("refused");
	assert.ok(
		SETTINGS_NAV.test(refused.html),
		`settings did not render beside a refused account read; the page showed: ${refused.rendered.slice(0, 200)}`,
	);
	/*
	 * The two profile fields render the user store's own copy, whose default is
	 * the literal name "User". The failure has to be said next to them, or a
	 * person whose Radient credential was rejected is looking at placeholder
	 * data with no reason for it and no way to act on it.
	 */
	const expected =
		/Your Radient account could not be read, so the name and email below are placeholders rather than your account details/;
	assert.match(
		refused.rendered,
		expected,
		`a refused account read rendered no explanation: ${refused.rendered.slice(0, 600)}`,
	);
	/*
	 * Classified as the REFUSAL, which only the backend's own code establishes
	 * (`radient_credential_refused`): the account section says what the failure
	 * means for its own state, in place of the ordinary signed-out sentence.
	 */
	assert.ok(
		refused.rendered.includes(
			"Radient refused the sign-in this app is holding",
		),
		`the refusal was not classified as one: ${refused.rendered.slice(0, 900)}`,
	);
	assert.ok(
		!refused.rendered.includes("You are not currently signed in to Radient."),
		"the section rendered the signed-out sentence beside a refusal: design round 1 (D1) is that the reader is shown one of the two, never both",
	);
	/*
	 * ONE fault, ONE warning, ONE retry (design round 1, D1). The delta against
	 * the signed-out render is the assertion, so a retry belonging to another
	 * section cannot be mistaken for the second one this fault used to add.
	 */
	const signedOut = await renderWithAccountRead("signed-out");
	assert.equal(
		retryControls(refused.html) - retryControls(signedOut.html),
		1,
		`one fault must add exactly one Retry control, got ${retryControls(refused.html)} against ${retryControls(signedOut.html)}`,
	);
	refused.client.clear();
	signedOut.client.clear();
});

test("a 401 without a radient_ code is not read as a refused Radient credential", async () => {
	/*
	 * The SAME status as the case above, in its other meaning: the desktop plane
	 * refusing this app's own bearer, whose remedy is a restart or a re-pair and
	 * which `backend-error.ts` owns. Only the code separates the two, and the
	 * copy may not assert a cause a bare status cannot establish (review round 1,
	 * m1; design round 1, D5).
	 */
	const plane = await renderWithAccountRead("refused-plane-bearer");
	assert.ok(SETTINGS_NAV.test(plane.html));
	assert.ok(
		plane.rendered.includes("Radient account could not be read"),
		"the failure was not said at all",
	);
	assert.ok(
		!plane.rendered.includes("refused the sign-in"),
		`a 401 with no radient_ code must not assert a Radient cause: ${plane.rendered.slice(0, 900)}`,
	);
	assert.ok(
		!plane.rendered.includes("sign in to Radient again"),
		"a 401 with no radient_ code offered the Radient sign-in remedy",
	);
	plane.client.clear();
});

test("the ordinary signed-out state is not a fault", async () => {
	accountBehaviour = "signed-out";
	const { client, html, rendered } = await renderWithAccountRead("signed-out");
	assert.ok(SETTINGS_NAV.test(html));
	assert.ok(
		rendered.includes("You are not currently signed in to Radient."),
		`the signed-out sentence is the one this state renders: ${rendered.slice(0, 600)}`,
	);
	assert.ok(
		!rendered.includes("could not be read"),
		'a 409 that means "no credential stored" was reported as a fault',
	);
	assert.ok(
		EDITABLE_PROFILE_FIELD.test(html),
		"signed out, the profile fields are the reader's own local profile and must stay editable",
	);
	client.clear();
});

test("an upstream failure is a retry, not a refusal", async () => {
	const upstream = await renderWithAccountRead("upstream-failed");
	assert.ok(
		upstream.rendered.includes("Radient account could not be read"),
		`a 502 rendered no explanation: ${upstream.rendered.slice(0, 600)}`,
	);
	assert.ok(
		!upstream.rendered.includes("refused the sign-in"),
		"an upstream outage was reported as a refused sign-in",
	);
	upstream.client.clear();
});

/*
 * THE PRESS THAT ASKS AGAIN MUST NOT ERASE WHAT IT IS ASKING ABOUT (review round
 * 2, B1).
 *
 * The state: the account read has failed, the reader presses the alert's Retry,
 * and the read behind it never answers. On the pinned React Query a new fetch
 * reverts the query to `pending` and clears `error` AND `failureCount`
 * (`query-core` 5.73.3, `fetchState()`), so a rule gated on either of them says
 * nothing for the whole attempt - ~21s at the transport's deadline - and the
 * reader is told the fault is gone by the act of asking again (design round 1,
 * D4). The fixture's own state is asserted below BEFORE the property is, so this
 * case cannot pass by having measured a different one.
 */
test("a failed account read survives the press that starts the next attempt", async () => {
	const mounted = await mountAccountRead("refused");
	try {
		const failed = await mounted.settleOnFailure();
		assert.equal(failed.state.status, "error");
		/*
		 * THREE, which is the retry policy's whole shape rather than an incidental
		 * number: `retry: failureCount < 2` (`use-radient-user-query.ts`) is three
		 * attempts, and qa round 2 measured those three taking ~3.0s at the backend
		 * - the number this case waits out.
		 */
		assert.equal(
			failed.state.fetchFailureCount,
			3,
			"the fixture must be the settled end of the retry chain",
		);
		assert.equal((await mounted.read()).accountRead, "refused");

		/* READING the read again: nothing at all answers. */
		accountBehaviour = "pending";
		await mounted.press();
		await until(
			() => mounted.snapshot()?.isFetching === true,
			"the page to render the re-read in flight",
		);

		const pressing = mounted.state();
		assert.equal(
			pressing.status,
			"pending",
			"the fixture must be the state a new fetch produces, not the failed one",
		);
		assert.equal(
			pressing.fetchFailureCount,
			0,
			"the fixture must show React Query resetting the failure count on the new fetch",
		);
		assert.equal(
			pressing.error,
			null,
			"the fixture must show React Query clearing the error on the new fetch",
		);

		/*
		 * THE PAGE FIRST, because this is the half a reader sees: the fault stated
		 * nowhere is what the round-2 review measured (no alert copy, no section
		 * refusal sentence, and the checking caption printed twice).
		 */
		const { rendered } = renderedAgainst(mounted.client);
		assert.ok(
			rendered.includes("Your Radient account could not be read"),
			`the fault is stated nowhere while its own re-read is out; the page showed: ${rendered.slice(0, 900)}`,
		);
		assert.equal(
			occurrences(rendered, "Checking your Radient account"),
			0,
			`a read whose failure is on screen was reported as merely checking; the page showed: ${rendered.slice(0, 900)}`,
		);
		/*
		 * And the control reports THIS press: `isRefreshing` is true from the press
		 * until the re-read it began settles, which is the half design round 1's D4
		 * asked for and the half qa round 3 (Q1) found inverted for reads nobody
		 * pressed (see the case below for that half).
		 *
		 * Asserted at the HOOK rather than through this page render, and the reason
		 * is the fix itself: the signal is the mutation's pending state, and that
		 * belongs to the control that was pressed. This render is static and owns no
		 * press, so it can only show the unpressed control - which is what the case
		 * below pins. The page's own wiring is pinned by source, where a static
		 * render cannot reach it.
		 */
		assert.equal(
			(await mounted.read()).isRefreshing,
			true,
			"the press left no trace in the signal the control reads",
		);
		assert.match(
			await readFile(
				"src/renderer/src/features/settings/components/settings-page.tsx",
				"utf8",
			),
			PAGE_CONTROL_WIRED_TO_PRESS,
			"the alert's control is not wired to the press's own pending state",
		);

		/* And the mechanism behind it, so a fix that only moves copy fails here. */
		const afterPress = await mounted.read();
		assert.equal(
			afterPress.accountRead,
			"refused",
			"the press erased the class the page was rendering, so the fault is now stated nowhere",
		);
		assert.equal(
			afterPress.isFetching,
			true,
			"the control's pending state must be reachable while its own re-read is out",
		);
	} finally {
		await mounted.teardown();
	}
});

/*
 * A RESOLVED ACCOUNT IS NOT A PLACEHOLDER (review round 2, B3).
 *
 * The state: the account read resolved, and a later refetch failed. React Query
 * keeps `data` across that failure, and `refetchOnWindowFocus` with `staleTime:
 * 30s` puts the state in front of any signed-in session whose credential expires
 * after a first success. With the failure winning, ONE render read "the name and
 * email below are placeholders rather than your account details" while the
 * account section said "Connected" and the rail showed the account's real name:
 * the D1 defect, with the placeholder claim false as well.
 */
test("a failed refetch of a resolved account does not call its details placeholders", async () => {
	const mounted = await mountAccountRead("account");
	try {
		const resolved = await mounted.settleOnAccount();
		assert.equal((await mounted.read()).accountRead, "ready");
		assert.ok(resolved.state.data);
		/*
		 * `ready` is the state the lock is FOR: the account owns these two fields,
		 * so an edit would be undone by the store-sync effect. Asserted here
		 * because the failure classes were just made editable (design round 2, B2)
		 * and a predicate that unlocked everything would look the same from the
		 * cases below.
		 */
		assert.ok(
			!EDITABLE_PROFILE_FIELD.test(renderedAgainst(mounted.client).html),
			"a resolved account left the reader's own profile editable, so an edit here is silently replaced",
		);

		accountBehaviour = "upstream-failed";
		await mounted.press();
		const failed = await mounted.settleOnFailure();
		/* The fixture the reviewer measured, asserted before the property. */
		assert.equal(failed.state.status, "error");
		assert.ok(
			failed.state.data,
			"the fixture must keep the account across the failed refetch, or this case is about a different state",
		);
		assert.notEqual(
			failed.snapshot.errorMessage,
			null,
			"the fixture must be a real failure",
		);

		/*
		 * THE PAGE FIRST, because this is the half a reader sees: one render calling
		 * a resolved account's own name and email "placeholders" while the section
		 * below it said "Connected" is what the round-2 review measured.
		 */
		const { html, rendered } = renderedAgainst(mounted.client);
		assert.ok(
			!rendered.includes("placeholders"),
			`a resolved account's own name and email were called placeholders; the page showed: ${rendered.slice(0, 1200)}`,
		);
		assert.ok(
			!rendered.includes("could not be read"),
			`a resolved account was described as unreadable; the page showed: ${rendered.slice(0, 1200)}`,
		);
		/*
		 * And the other surface is still there, saying the same thing the alert would
		 * have contradicted: the account, by name, with its status.
		 */
		assert.ok(
			rendered.includes("Connected"),
			`the section's own statement vanished; the page showed: ${rendered.slice(0, 1200)}`,
		);
		assert.ok(
			rendered.includes("QA Settings Gate"),
			`the account's own name is the one surface that cannot be a placeholder; the page showed: ${rendered.slice(0, 1200)}`,
		);
		assert.ok(
			!EDITABLE_PROFILE_FIELD.test(html),
			"a failed refetch of a resolved account unlocked fields the account still owns",
		);
		/* And the mechanism behind it, so a fix that only moves copy fails here. */
		assert.equal(
			(await mounted.read()).accountRead,
			"ready",
			"a failed refetch outranked the account it had already resolved",
		);
	} finally {
		await mounted.teardown();
	}
});

/*
 * WHO MAY EDIT THE READER'S OWN PROFILE (design round 2, ruling on B2).
 *
 * The lock answers one question - "could what I type be replaced without my
 * knowing?" - and the states below are the ones the shipped predicate got wrong:
 * it asked whether the read was unresolved, so a reader with NO Radient account
 * and a failing read had two controls locked for good, with no release that ever
 * arrives. Signed out is the reference render: there the fields are the reader's
 * own local profile and editing them is the point, and every class where nothing
 * can overwrite an edit must look the same. The `ready` and `checking` halves are
 * asserted where they can be produced - the mounted cases below and the
 * never-settling one above.
 */
test("a failed account read leaves the reader's own profile editable", async () => {
	const signedOut = await renderWithAccountRead("signed-out");
	const refused = await renderWithAccountRead("refused");
	const unknown = await renderWithAccountRead("refused-plane-bearer");
	assert.ok(
		EDITABLE_PROFILE_FIELD.test(signedOut.html),
		"the reference state must be the editable one",
	);
	const locked = [
		["a refused credential", refused],
		["a 401 this app cannot classify", unknown],
	];
	for (const [what, state] of locked) {
		assert.ok(
			EDITABLE_PROFILE_FIELD.test(state.html),
			`${what} left the reader's own profile locked with no release (design round 2, B2): ${state.rendered.slice(0, 600)}`,
		);
		assert.ok(
			state.rendered.includes("could not be read"),
			`${what} left the fields usable without saying why the read failed: ${state.rendered.slice(0, 600)}`,
		);
	}
	signedOut.client.clear();
	refused.client.clear();
	unknown.client.clear();
});

/*
 * ONE READING, TWO SURFACES, WHILE THE READ IS STILL ASKING (qa round 3: Q2 for
 * the reading, Q1 and Q4 for what the fields and the control may say).
 *
 * The state is the operator's own: the read's first attempt fails and every
 * attempt after it never answers. A class is recorded while the query is still
 * `pending`/`fetching`, and NOTHING any observer tracks changes after that first
 * failure - `error` stays null until the chain ends, `isLoading` and `isFetching`
 * stay true throughout - so this is the case that tells a SUBSCRIBED record from a
 * map nobody re-reads.
 *
 * Q2 measured the consequence in the built app: the page (which re-renders for
 * reasons of its own) stated the failure while the rail kept "Checking account…";
 * a cold remount fixed it and a props change did not. The two probes mounted here
 * are the page and the rail, and both must publish the failure with no props
 * change at all.
 */
test("a read that never answers keeps both surfaces on one reading", async () => {
	const mounted = await mountAccountRead("refuse-then-hold");
	try {
		const published = await until(() => {
			const page = mounted.snapshot();
			const rail = mounted.snapshotB();
			if (!page || !rail) return null;
			if (page.accountRead === "checking") return null;
			return rail.accountRead === page.accountRead ? { page, rail } : false;
		}, "both surfaces to publish the recorded failure");
		assert.equal(
			published.page.accountRead,
			"refused",
			"the page did not state the failure it had already recorded",
		);
		assert.equal(
			published.rail.accountRead,
			"refused",
			`the second surface kept a reading the page had replaced: ${published.rail.accountRead}`,
		);
		/* And the read really is still out, which is what makes this the state. */
		assert.equal(published.page.isFetching, true);
		assert.equal(mounted.state().fetchStatus, "fetching");

		const { html, rendered } = renderedAgainst(mounted.client);
		/* Q1: nobody pressed, so the control must not claim a press. */
		assert.ok(
			ENABLED_RETRY.test(html),
			`the alert offered no usable Retry while the read was still asking; the page showed: ${rendered.slice(0, 900)}`,
		);
		assert.ok(
			!rendered.includes("Retrying"),
			`the control reported a press nobody made; the page showed: ${rendered.slice(0, 900)}`,
		);
		/* Q4: an edit made now could be replaced by this same chain's next attempt. */
		assert.ok(
			!EDITABLE_PROFILE_FIELD.test(html),
			`a read still in flight left the reader's own profile editable; the page showed: ${rendered.slice(0, 900)}`,
		);
	} finally {
		await mounted.teardown();
	}
});

test("the account read's classes come from the backend's code, never from a status", () => {
	const control = (status, code, message) =>
		new DesktopControlError(status, message, undefined, code);
	assert.equal(
		classifyRadientAccountFailure(
			control(
				409,
				"radient_no_credential",
				"Sign in to Radient to access your account",
			),
		),
		"signed-out",
	);
	assert.equal(
		classifyRadientAccountFailure(
			control(
				401,
				"radient_credential_refused",
				"Radient could not complete this operation",
			),
		),
		"refused",
	);
	assert.equal(
		classifyRadientAccountFailure(
			control(
				502,
				"radient_upstream_failed",
				"Radient could not complete this operation",
			),
		),
		"unavailable",
	);
	/*
	 * The pre-code daemon: a bare 409 whose detail is the sentence. Narrowed to
	 * the status it belongs to, which is the half of the old prose test that was
	 * worth keeping.
	 */
	assert.equal(
		classifyRadientAccountFailure(
			new DesktopControlError(409, "Sign in to Radient to access your account"),
		),
		"signed-out",
	);
	/*
	 * And the reading the prose test got WRONG: the same words on a 401 are the
	 * account's credential being refused, and must never read as "not signed in".
	 */
	assert.equal(
		classifyRadientAccountFailure(
			new DesktopControlError(401, "Sign in to Radient to access your account"),
		),
		"unknown",
	);
	assert.equal(
		classifyRadientAccountFailure(
			new DesktopControlError(401, "Desktop authorization is required."),
		),
		"unknown",
	);
});

/*
 * The scene that produced the measurements above is `--scene settings-gate`
 * (`scripts/renderer-driver.mjs`), which samples the surface and the query cache
 * at 0.5s/5s/30s and names the two surfaces by their accessible text. This file
 * pins the DECISION; the scene's frames are what say it looks right.
 */
test("the scene that measures this is still registered", async () => {
	const driver = await readFile("scripts/renderer-driver.mjs", "utf8");
	assert.match(driver, /SCENE === "settings-gate"/);
});
