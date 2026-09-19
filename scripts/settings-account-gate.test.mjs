import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

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
// and at the backend, 33 account reads in 33.4s -- one per second, in a
// repeating {1s, 2s, ~20ms} unit, so the read is re-issued rather than waiting
// on anything. The page was held by `isConfigLoading || isAuthLoading` with the
// config read ALREADY SATISFIED, and the account read is the one this page does
// not need: it reads a single boolean, for two read-only fields.
//
// WHY THIS IS RENDERED AND NOT ASSERTED OVER A SELECTOR. The defect is which
// BRANCH renders, and the branch is a boolean AND of two queries' loading
// flags. A test over `isLoading` would restate the expression; rendering the
// shipped page against a real `QueryClient` sees the spinner a user sees.
//
// The two cases below are the two halves of the same fault:
//   - a read that never settles (the measured state),
//   - a read that settles as a REFUSAL (401), which the hook does not treat as
//     the signed-out state, so the profile fields silently fall back to the
//     user store's default name "User".

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { renderToStaticMarkup } from "react-dom/server";
			import { MemoryRouter } from "react-router-dom";
			import { QueryClientProvider } from "@tanstack/react-query";
			import { SettingsPage } from "./src/renderer/src/features/settings/components/settings-page";
			export { QueryClient } from "@tanstack/react-query";
			export { configQueryKey } from "./src/renderer/src/shared/hooks/use-config";
			export { radientUserKeys } from "./src/renderer/src/shared/hooks/use-radient-user-query";
			export { classifyRadientAccountFailure } from "./src/renderer/src/shared/hooks/use-radient-user-query";
			export { desktopResult, DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";

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
	// different query client than the one the test seeds.
	external: [
		"react",
		"react-dom",
		"react-dom/server",
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
 * branch, which is not the code that ships. Only two ops are answered: the
 * config read the page cannot render without, and the Radient account read
 * under test. Everything else is refused, which is how the surfaces this test
 * is not about stay out of its way.
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
 */
const ACCOUNT_ANSWERS = {
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

globalThis.window.api = {
	desktop: {
		request: async (request) => {
			if (request?.control?.operation === "account") {
				if (accountBehaviour === "pending") {
					// Never settles: the measured state, where the read is
					// re-issued once a second and the query never leaves
					// `pending`/`fetching`, so `isLoading` never goes false.
					return await new Promise(() => {});
				}
				return ACCOUNT_ANSWERS[accountBehaviour];
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
function clientWithConfig() {
	const client = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: Number.POSITIVE_INFINITY,
				retryOnMount: false,
			},
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
	assert.ok(
		!/aria-label="Current value: User\. Click to edit\."/.test(html),
		"the profile fields were editable while the account read was still out, so an edit made here is silently replaced when it resolves",
	);
	assert.ok(
		/aria-label="Current value: User\."/.test(html),
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
		/aria-label="Current value: User\. Click to edit\."/.test(html),
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
