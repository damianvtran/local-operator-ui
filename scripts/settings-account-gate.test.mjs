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
let accountBehaviour = "pending";
const ACCOUNT_REFUSAL = {
	status: 401,
	body: { detail: "Radient could not complete this operation" },
};

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
				return ACCOUNT_REFUSAL;
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

test("a Radient account read that never settles does not hold the settings page", async () => {
	accountBehaviour = "pending";
	const client = clientWithConfig();
	// Started, never awaited: this is `useQuery`'s own state for a request that
	// has not answered, which is what the shipped app was measured in.
	void client.fetchQuery({
		queryKey: radientUserKeys.user(),
		queryFn: () =>
			desktopResult({
				op: "radient.request",
				control: { operation: "account" },
			}),
		retry: false,
	});
	await new Promise((resolve) => setTimeout(resolve, 0));

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

	const html = renderSettings(client);
	const rendered = text(html);
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
		rendered.includes("User profile"),
		`the settings content did not render; the page showed: ${rendered.slice(0, 200)}`,
	);
	client.clear();
});

test("a refused Radient account read renders an actionable state, not the placeholder profile", async () => {
	accountBehaviour = "refusal";
	const client = clientWithConfig();
	// Driven through the shipped transport so the error is the one the app
	// builds from a bridge response, status and all.
	try {
		await client.fetchQuery({
			queryKey: radientUserKeys.user(),
			queryFn: () =>
				desktopResult({
					op: "radient.request",
					control: { operation: "account" },
				}),
			retry: false,
		});
		assert.fail("the bridge answered 401, so the account read must reject");
	} catch (error) {
		assert.ok(
			error instanceof DesktopControlError,
			`the account failure must carry its status, got ${error?.constructor?.name}`,
		);
		assert.equal(error.status, 401);
	}

	const html = renderSettings(client);
	const rendered = text(html);
	assert.ok(
		SETTINGS_NAV.test(html),
		`settings did not render beside a refused account read; the page showed: ${rendered.slice(0, 200)}`,
	);
	/*
	 * The two profile fields render the user store's own copy, whose default is
	 * the literal name "User". The failure has to be said next to them, or a
	 * person whose Radient credential was rejected is looking at placeholder
	 * data with no reason for it and no way to act on it.
	 */
	assert.ok(
		rendered.includes("Radient account could not be read"),
		`a refused account read rendered no explanation: ${rendered.slice(0, 400)}`,
	);
	assert.ok(
		rendered.includes("Retry"),
		"the explanation offers no way to act on it",
	);
	client.clear();
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
