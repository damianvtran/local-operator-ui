import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

// Design D1 / D2 and reviewer M3: two defects that only appear in a RENDERED
// frame, so both are asserted by rendering the shipped components rather than
// by restating their branching.
//
//  - D1: Retry was a dead button. `refetch()` on a query that already holds
//    data leaves `status: "error"`, so the error branch keeps winning and the
//    frame is pixel-identical for the transport's whole 30s deadline. A user
//    clicks Retry against a dead server and nothing appears to happen -- issue
//    89's own "I cannot tell whether this is working or hung", one click
//    downstream of its fix.
//  - D2: `BackendSettingsSection`'s query is gated on capabilities, and a
//    DISABLED React Query reports `isLoading: false` with no data. So when
//    capabilities FAIL -- the server is unreachable, or refused this app's
//    bearer -- the section fell through its loading gate into its error branch
//    and asserted "the backend may need an update": the one remedy that cannot
//    fix either fault, directly beneath a banner saying the opposite.
//
// Rendered with `renderToStaticMarkup` against a real `QueryClient`, so the
// assertions are about what a user would see. A unit test over the selector
// functions cannot see either defect: both are about which BRANCH renders and
// what the button says while a refetch is in flight, not about copy.

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { renderToStaticMarkup } from "react-dom/server";
			import { QueryClientProvider } from "@tanstack/react-query";
			import { ProviderGrid } from "./src/renderer/src/features/providers/provider-grid";
			import { BackendSettingsSection } from "./src/renderer/src/features/settings/components/backend-settings-section";
			import { BackendCompatibilityBanner } from "./src/renderer/src/shared/components/common/backend-compatibility-banner";
			export { QueryClient, QueryObserver } from "@tanstack/react-query";
			export { desktopKeys } from "./src/renderer/src/shared/api/local-operator/desktop-hooks";
			export { backendSettingsKeys } from "./src/renderer/src/features/settings/components/backend-settings-section";
			export { desktopResult, DesktopControlError } from "./src/renderer/src/shared/api/local-operator/desktop-api";
			export { ConfigApi } from "./src/renderer/src/shared/api/local-operator/config-api";
			export { backendErrorKind, backendLoadErrorMessage, backendCompatibilityMessage,
				BACKEND_PAIRING_SENTENCE, BACKEND_ERROR_REMEDY, BACKEND_ERROR_DIAGNOSIS,
				backendPairingSentence, backendUpdateIsRemedy, compatibilityBannerShown,
			} from "./src/renderer/src/shared/api/local-operator/backend-error";
			export { desktopFeatureState, desktopFeatureEnabled } from "./src/renderer/src/shared/api/local-operator/desktop-hooks";

			const render = (Component) => (client) =>
				renderToStaticMarkup(
					createElement(QueryClientProvider, { client }, createElement(Component, {})),
				);
			export const renderProviderGrid = render(ProviderGrid);
			export const renderBackendSettings = render(BackendSettingsSection);
			export const renderBackendCompatibilityBanner = render(BackendCompatibilityBanner);
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
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	// React and React Query stay external so the bundle shares ONE copy with
	// this file's own imports; two copies give the components a different
	// QueryClient context than the one the test seeds, and every render would
	// report a fresh pending query.
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	// Stylesheets carry no assertion here and Node cannot import them.
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
	plugins: [
		{
			/*
			 * The server-status hook is faked, and ONLY it: this file's subject is the
			 * compatibility banner's copy and controls, and the banner reads main's
			 * pairing record through this hook. Importing the real one drags the
			 * renderer's config module into a Node bundle, where it throws at load
			 * ("Failed to load configuration") because `import.meta.env` only exists
			 * under Vite - measured here, as a build-time failure rather than an
			 * assertion. The fake keeps the SHAPE the banner reads (`data.snapshot`),
			 * and the record it returns is main's own field for field.
			 */
			name: "server-health-fixture",
			setup(builder) {
				builder.onResolve(
					{ filter: /^@shared\/hooks\/use-connectivity-status$/ },
					() => ({ path: "server-health", namespace: "surfaces-fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "surfaces-fixture" }, () => ({
					contents:
						'export const serverHealthQueryKey = ["server-health"];\n' +
						"export const useServerHealth = () => ({ data: globalThis.__serverHealth });\n",
					loader: "js",
					resolveDir: process.cwd(),
				}));
			},
		},
	],
});

// Written to a real file rather than imported as a data: URL. React DOM's
// server build resolves its own CJS entry at import time, which a data: URL
// has no base path for.
const bundlePath = new URL(
	"./_backend-error-surfaces.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);

// The fault is injected AT THE BRIDGE, so the shipped transport is what builds
// the error and attaches its status. A test that threw a hand-made
// `DesktopControlError` would pass even if `desktopRequest` stopped carrying
// the status at all -- which is the exact half of D2 that had regressed.
//
// The bridge must exist before the module graph is evaluated: without
// `window.api.desktop` the renderer takes its browser-dev HTTP branch, which is
// not the code that ships.
let bridgeStatus = 503;
/**
 * The banner's two main-process reads, faked at the bridge for the same reason the
 * transport is: main's pairing record and the reconnect verb are MAIN's, and a test
 * that hand-made them would not notice the banner reading the wrong field.
 * The verb is counted rather than called for real (design § 2, § 11.2).
 */
const daemonSnapshot = null;
globalThis.window = {
	api: {
		/*
		 * The updater surface IN FULL, not only the two members this file calls.
		 * A component that mounts under a partial stub throws inside its effect and
		 * nothing re-drives it, so `scripts/preload-updater-surface.test.mjs` sweeps
		 * every fixture that installs one for completeness - the shape that caught this
		 * stub (and the reason the list is copied from the preload rather than guessed).
		 */
		updater: {
			checkForAllUpdates: async () => undefined,
			checkForBackendUpdates: async () => undefined,
			checkForUpdates: async () => undefined,
			downloadUpdate: async () => undefined,
			getLastInstallAttempt: async () => null,
			onBackendUpdateAvailable: () => () => undefined,
			onBackendUpdateCompleted: () => () => undefined,
			onBackendUpdateDevMode: () => () => undefined,
			onBackendUpdateError: () => () => undefined,
			onBackendUpdateManualRequired: () => () => undefined,
			onBackendUpdateNotAvailable: () => () => undefined,
			onBackendUpdateProgress: () => () => undefined,
			onBeforeQuitForUpdate: () => () => undefined,
			onUpdateAvailable: () => () => undefined,
			onUpdateDevMode: () => () => undefined,
			onUpdateDownloaded: () => () => undefined,
			onUpdateError: () => () => undefined,
			onUpdateInstallBlocked: () => () => undefined,
			onUpdateInstallFailed: () => () => undefined,
			onUpdateInstallInFlight: () => () => undefined,
			onUpdateNotAvailable: () => () => undefined,
			onUpdateNpxAvailable: () => () => undefined,
			onUpdateProgress: () => () => undefined,
			quitAndInstall: () => () => undefined,
			quitForUpdateInstall: () => () => undefined,
			updateBackend: async () => true,
		},
		backend: {
			getStatus: async () => daemonSnapshot,
			onStatusChange: () => () => undefined,
			reconnect: async () => daemonSnapshot,
		},
		desktop: {
			request: async () => ({
				status: bridgeStatus,
				body: { detail: "denied" },
			}),
		},
	},
};

const {
	QueryClient,
	QueryObserver,
	DesktopControlError,
	desktopResult,
	desktopKeys,
	backendSettingsKeys,
	ConfigApi,
	backendErrorKind,
	backendLoadErrorMessage,
	backendCompatibilityMessage,
	renderProviderGrid,
	renderBackendSettings,
	renderBackendCompatibilityBanner,
	BACKEND_PAIRING_SENTENCE,
	BACKEND_ERROR_REMEDY,
	BACKEND_ERROR_DIAGNOSIS,
	backendPairingSentence,
	backendUpdateIsRemedy,
	compatibilityBannerShown,
	desktopFeatureState,
	desktopFeatureEnabled,
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
 * Whether the rendered Retry control is actually disabled.
 *
 * Matches the ATTRIBUTE, not the substring: every button in this system ships
 * `disabled:` Tailwind variants in its class list, so a bare `/disabled/` test
 * is true of a fully enabled button and would assert nothing.
 */
function retryIsDisabled(html) {
	return /<button[^>]*\sdisabled(?=[\s>=])/.test(html);
}

const newClient = () =>
	new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: Number.POSITIVE_INFINITY,
				// A component mounting against an errored query re-runs it by
				// default, which resets `status` to pending and would render the
				// loading branch instead of the state under test. The app does not
				// re-mount these surfaces between the failure and the frame the user
				// sees; this keeps the render honest to that.
				retryOnMount: false,
			},
		},
	});

/**
 * Seed a client with the failure a real capabilities call produces.
 *
 * Goes through `desktopResult` -- the shipped path -- so the error under test
 * is one the transport constructed from a bridge response, status and all.
 */
async function seedCapabilitiesFailure(client, status) {
	bridgeStatus = status;
	try {
		await client.fetchQuery({
			queryKey: desktopKeys.capabilities,
			queryFn: () => desktopResult({ op: "capabilities" }),
			retry: false,
		});
	} catch {
		// Expected: the seeding IS the failure.
	}
}

/**
 * Drive one query through load -> error -> Retry, and render the frame at each
 * step.
 *
 * A `QueryObserver` is used rather than `fetchQuery` because it is what
 * `useQuery` is built on, and the distinction is the whole finding: refetching
 * a query that never held data RESETS it to pending, while refetching one that
 * holds data keeps `status: "error"` and only flips `fetchStatus`. The second
 * is the state a user reaches by clicking Retry on a surface that had loaded,
 * and it is the state in which the old button changed nothing on screen.
 */
async function frames({ queryKey, render, ok, options = {} }) {
	const client = newClient();
	let mode = "ok";
	const observer = new QueryObserver(client, {
		queryKey,
		retry: false,
		...options,
		queryFn: () => {
			if (mode === "ok") return Promise.resolve(ok);
			if (mode === "fail")
				return Promise.reject(options.failure ?? new Error("boom"));
			// A request that never settles: the shape the transport's deadline
			// exists for, and the one that keeps Retry in flight long enough to
			// matter.
			return new Promise(() => {});
		},
	});
	const unsubscribe = observer.subscribe(() => {});
	await new Promise((resolve) => setTimeout(resolve, 40));

	mode = "fail";
	await observer.refetch();
	const errored = render(client);

	mode = "hang";
	void observer.refetch();
	await new Promise((resolve) => setTimeout(resolve, 40));
	const retrying = render(client);
	const state = observer.getCurrentResult();

	unsubscribe();
	client.clear();
	return { errored, retrying, state };
}

const A_PROVIDER = [
	{
		id: "openai",
		name: "OpenAI",
		search_aliases: [],
		methods: [{ kind: "api_key" }],
		local: false,
		credential_optional: false,
		has_credential: false,
		configured: false,
	},
];

test("the providers Retry reflects the in-flight refetch instead of a dead frame", async () => {
	const { errored, retrying, state } = await frames({
		queryKey: desktopKeys.providers,
		render: renderProviderGrid,
		ok: A_PROVIDER,
		options: { staleTime: 30_000 },
	});

	// The precondition the finding rests on. If this ever reports `pending`,
	// the assertions below stop measuring D1 -- the loading branch would render
	// during the refetch and the button would be gone rather than pending.
	assert.equal(
		state.status,
		"error",
		"a refetch of an errored query no longer keeps status=error; this test no longer covers D1",
	);
	assert.equal(state.isFetching, true);
	assert.equal(
		state.isLoading,
		false,
		"isLoading is true during the refetch, which would make the dead-button finding unreachable",
	);

	assert.match(text(errored), /Retry(?!ing)/, "the error frame offers Retry");
	assert.equal(
		retryIsDisabled(errored),
		false,
		"Retry is not clickable before the click",
	);

	// The frame after the click must differ. Both halves matter: the label tells
	// a sighted user the click landed, and `disabled` stops a user who cannot
	// see the change from queuing four more requests against a dead server.
	assert.match(
		text(retrying),
		/Retrying/,
		"Retry does not acknowledge the click",
	);
	assert.equal(
		retryIsDisabled(retrying),
		true,
		"Retry stays clickable while its own refetch is in flight",
	);
	assert.notEqual(
		errored,
		retrying,
		"the frame is identical after clicking Retry: the button is still dead",
	);
});

test("settings classifies a rejected bearer as unauthorized, not as an unreachable or outdated server", async () => {
	// The D2 defect in its exact shape. Capabilities fail with 401, so the
	// settings query never becomes `enabled` -- and a DISABLED React Query
	// reports `isLoading: false` with no data, so the section fell straight
	// through its loading gate into an error branch that asserted "the backend
	// may need an update". That is the one remedy which cannot fix a bearer the
	// running server refuses, rendered directly beneath a banner saying the
	// opposite.
	const client = newClient();
	await seedCapabilitiesFailure(client, 401);
	const rendered = text(renderBackendSettings(client));

	// The remedy, which is the part that has to be right: restart, because the
	// app starts and pairs with its own server.
	assert.match(
		rendered,
		/Restart the app so it starts and pairs with its own server\./,
	);
	assert.match(rendered, /This app cannot authenticate to the running/);
	// The wrong answers, each of which shipped on this surface: the update
	// remedy, the "may not be running" hedge about a server that is
	// demonstrably running and answering, and the raw exception.
	assert.doesNotMatch(
		rendered,
		/update/i,
		"a rejected bearer is told to install a newer server",
	);
	assert.doesNotMatch(rendered, /may not be running|not answering/i);
	assert.doesNotMatch(
		rendered,
		/401|request failed|denied/,
		"a raw exception reached the user",
	);
	assert.match(rendered, /Your settings could not be loaded\./);

	client.clear();
});

test("settings reports an unreachable server as offline rather than as needing an update", async () => {
	// The other half of D2's classification, and the standing state of this
	// surface whenever the server is simply off. 503 is the main process's own
	// "could not complete this request"; it must not reach the update copy
	// either.
	const client = newClient();
	await seedCapabilitiesFailure(client, 503);
	const rendered = text(renderBackendSettings(client));

	assert.match(rendered, /The Local Operator server is not answering\./);
	assert.match(rendered, /Restart the app so it can start its own server\./);
	assert.doesNotMatch(rendered, /update/i);

	client.clear();
});

test("clicking Retry on the settings section always changes the frame", async () => {
	// D1 on this surface. React Query resolves the click into two different
	// states depending on whether anything ever loaded, and BOTH have to give
	// the user feedback -- the defect is a frame that does not change, not a
	// particular label.
	//
	// (a) The settings query holds data from an earlier success, so its refetch
	//     keeps `status: "error"` and the error branch keeps winning. Nothing
	//     but the button can change here, which is exactly why the button has
	//     to.
	const withData = newClient();
	withData.setQueryData(desktopKeys.capabilities, {
		desktop_available: true,
		features: { settings: 1 },
	});
	let mode = "ok";
	const settings = new QueryObserver(withData, {
		queryKey: backendSettingsKeys.all,
		retry: false,
		staleTime: 10_000,
		queryFn: () => {
			if (mode === "ok")
				return Promise.resolve({
					sections: [{ name: "General" }],
					settings: [
						{
							key: "a.b",
							label: "A",
							help: "h",
							section: "General",
							value: "1",
							type: "string",
						},
					],
				});
			if (mode === "fail") return Promise.reject(new Error("boom"));
			return new Promise(() => {});
		},
	});
	const stopSettings = settings.subscribe(() => {});
	await new Promise((resolve) => setTimeout(resolve, 40));
	mode = "fail";
	await settings.refetch();

	const errored = renderBackendSettings(withData);
	assert.match(text(errored), /Retry(?!ing)/);
	assert.equal(retryIsDisabled(errored), false);

	mode = "hang";
	void settings.refetch();
	await new Promise((resolve) => setTimeout(resolve, 40));
	assert.equal(
		settings.getCurrentResult().status,
		"error",
		"a refetch holding data no longer keeps status=error; this case no longer covers D1",
	);

	const retrying = renderBackendSettings(withData);
	assert.match(
		text(retrying),
		/Retrying/,
		"Retry does not acknowledge the click",
	);
	assert.equal(retryIsDisabled(retrying), true);
	stopSettings();
	withData.clear();

	// (b) Capabilities never succeeded, so re-asking them resets the query to
	//     pending and the section legitimately returns to its spinner. That is
	//     a visible acknowledgement too -- the frame must simply not be the one
	//     the user just clicked on.
	const gated = newClient();
	await seedCapabilitiesFailure(gated, 401);
	const gatedError = renderBackendSettings(gated);

	bridgeStatus = 401;
	const capabilities = new QueryObserver(gated, {
		queryKey: desktopKeys.capabilities,
		retry: false,
		queryFn: () => new Promise(() => {}),
	});
	const stopCapabilities = capabilities.subscribe(() => {});
	void capabilities.refetch();
	await new Promise((resolve) => setTimeout(resolve, 40));

	const gatedRetrying = renderBackendSettings(gated);
	assert.notEqual(
		gatedError,
		gatedRetrying,
		"the frame is identical after clicking Retry: the button is dead on the gated path",
	);
	assert.match(text(gatedRetrying), /Loading settings/);
	stopCapabilities();
	gated.clear();
});

test("a settings load that fails on its own request is still classified", async () => {
	// Capabilities succeed, so the query runs and fails by itself. The surface
	// must classify THAT error rather than falling back to a default, which is
	// what the shared `loadError` selection is for.
	const client = newClient();
	client.setQueryData(desktopKeys.capabilities, {
		desktop_available: true,
		features: { settings: 1 },
	});
	bridgeStatus = 404;
	const observer = new QueryObserver(client, {
		queryKey: backendSettingsKeys.all,
		retry: false,
		queryFn: () => desktopResult({ op: "settings.list" }),
	});
	const unsubscribe = observer.subscribe(() => {});
	await new Promise((resolve) => setTimeout(resolve, 40));

	const rendered = text(renderBackendSettings(client));
	// 404 is the one status an update actually repairs, so here the update
	// remedy is correct -- the fix is that it is now SELECTED rather than
	// asserted for everything.
	assert.match(rendered, /older than this app expects/);
	assert.match(rendered, /Update the server and try again\./);
	assert.doesNotMatch(
		rendered,
		/404|denied|does not support/,
		"a raw exception reached the user",
	);

	unsubscribe();
	client.clear();
});

test("a config failure carries its status, so Settings can classify it", async () => {
	// The reviewer's MAJOR and the second half of D2. `config-api` threw a plain
	// `Error`, which discards the status -- so every consumer that classified
	// one fell to `backendErrorKind`'s `status: null` default and concluded
	// "nothing answered". At 401 the Settings page told a user whose server was
	// running and refusing its bearer that the server "may not be running", and
	// offered no restart.
	//
	// Driven through the shipped `ConfigApi` against the bridge, because the
	// defect is in what the API layer THROWS; a test that constructed the error
	// itself would pass against the broken version.
	const cases = [
		{ status: 401, kind: "unauthorized" },
		{ status: 403, kind: "unauthorized" },
		{ status: 503, kind: "unreachable" },
		{ status: 404, kind: "outdated" },
		{ status: 500, kind: "unknown" },
	];

	for (const { status, kind } of cases) {
		bridgeStatus = status;
		const error = await ConfigApi.getConfig("").then(
			() => null,
			(caught) => caught,
		);

		assert.ok(error, `a ${status} must reject`);
		assert.ok(
			error instanceof DesktopControlError,
			`a ${status} threw a plain Error, so its status is lost and it classifies as unreachable`,
		);
		assert.equal(error.status, status);
		assert.equal(
			backendErrorKind(error),
			kind,
			`a ${status} config failure classifies as ${backendErrorKind(error)}, not ${kind}`,
		);
	}

	// The sentence the Settings page renders from that classification. Stated
	// here as well as in the render tests because this is the pairing the defect
	// was reported as: a running server described as one that may not be
	// running.
	bridgeStatus = 401;
	const unauthorized = await ConfigApi.getConfig("").catch((caught) => caught);
	const sentence = backendLoadErrorMessage(
		"Your settings could not be loaded.",
		unauthorized,
	);
	assert.match(
		sentence,
		/cannot authenticate to the running Local Operator server/,
	);
	assert.match(
		sentence,
		/Restart the app so it starts and pairs with its own server\./,
	);
	assert.doesNotMatch(sentence, /may not be running|not answering|update/i);
	// The raw exception stays on the error for logs and support, and off the
	// sentence the user reads.
	assert.match(unauthorized.message, /Get config request failed: 401/);
	assert.doesNotMatch(sentence, /request failed|401/);
});

test("the slow-load explanation is inside a live region", async () => {
	// Design D6. A sighted user gets a visible state change at 4s telling them
	// the app is alive; before this fix a screen-reader user got "Loading
	// settings" once at mount and then silence for up to 30s -- and under
	// `prefers-reduced-motion` the global cap freezes the ring, so that user had
	// no liveness signal at all. The text whose entire purpose is "you cannot
	// tell waiting from hung" was reaching only the users who could already
	// tell.
	//
	// Asserted on the source because the branch is behind a 4s timer and a real
	// config load; the structural facts are the announcement contract itself.
	const { readFile } = await import("node:fs/promises");
	const page = await readFile(
		"src/renderer/src/features/settings/components/settings-page.tsx",
		"utf8",
	);

	const waiting = page.slice(page.indexOf("if (isLoading) {"));
	const region = waiting.slice(0, waiting.indexOf("if (!config)"));
	assert.ok(
		/role="status"/.test(region),
		"the waiting stack is not a live region, so the 4s explanation is announced to nobody",
	);
	assert.ok(
		/label=\{isSlowLoad \? undefined :/.test(region),
		"the Spinner keeps its label beside its own caption, announcing the same fact twice",
	);
	// D11: the copy must describe the user's situation, not the app's control
	// flow. "This will stop and offer a retry" made the machinery the subject.
	assert.ok(
		region.includes("taking longer than usual to answer"),
		"the slow-load copy is not the agreed sentence",
	);
	assert.ok(
		!region.includes("This will stop and offer a retry"),
		"the slow-load copy still narrates the app's plan rather than the user's situation",
	);
});

test("settings renders the classifier's sentence rather than its own", async () => {
	// A source guard, for the same reason the timing test carries one: the
	// rendered assertions above would all still pass if a surface re-inlined
	// copy that happened to match today, and the two surfaces drifting apart is
	// precisely the defect this change set exists to remove.
	const { readFile } = await import("node:fs/promises");
	for (const path of [
		"src/renderer/src/features/settings/components/settings-page.tsx",
		"src/renderer/src/features/settings/components/backend-settings-section.tsx",
	]) {
		const source = await readFile(path, "utf8");
		assert.ok(
			source.includes("backendLoadErrorMessage("),
			`${path} no longer routes its error copy through the shared classifier`,
		);
		// Comments quote the removed strings to explain why they went, so this
		// looks at rendered JSX text rather than at the whole file.
		const rendered = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
		assert.ok(
			!rendered.includes("may not be running"),
			`${path} re-inlined the hedge the connectivity banner contradicts`,
		);
		assert.ok(
			!rendered.includes("may need an update"),
			`${path} re-inlined the update remedy for faults an update cannot fix`,
		);
		assert.ok(
			!/\{configError\.message\}|\{query\.error\?\.message\}/.test(source),
			`${path} renders a raw exception string to the user`,
		);
	}
});

test("the settings Retry is wired to the query that actually failed", async () => {
	// Reviewer M2. Test 4(b) proves the frame changes while a capabilities
	// refetch is in flight, but it drives its own QueryObserver rather than the
	// button -- so collapsing this onClick to a bare `void query.refetch()`,
	// which reintroduces the inert gated Retry, passed the entire suite. The
	// click and the capabilities query were never connected by any assertion.
	//
	// Asserted on the source for the same reason the grid's `isFetching` guard
	// is (provider-grid-error-copy.test.mjs): `renderToStaticMarkup` does not
	// dispatch events, so the handler's BODY is unreachable to a rendered test
	// here, and the wiring is the whole finding.
	const { readFile } = await import("node:fs/promises");
	const source = await readFile(
		"src/renderer/src/features/settings/components/backend-settings-section.tsx",
		"utf8",
	);
	const rendered = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

	assert.ok(
		/capabilities\.isError[\s\S]{0,80}capabilities\.refetch\(\)/.test(rendered),
		"the settings Retry no longer refetches capabilities on the gated path, so the click cannot fix the fault that gated it",
	);
	// The other half: the ungated path must still re-ask the settings query
	// itself, or a failure of this query alone would have no retry at all.
	// The section binds that observer as `settingsQuery` (the page also has a
	// `filter` state, so `query` was ambiguous to read); the marker is the
	// binding's own call, not a substring any refetch would satisfy.
	assert.ok(
		rendered.includes("settingsQuery.refetch()"),
		"the settings Retry no longer refetches the settings query",
	);
	// The M1 fix is a single expression that a later edit could quietly
	// simplify back into the regression. The rendered test above catches that,
	// but only while it keeps reaching the state it seeds; this says the intent
	// out loud at the source.
	assert.ok(
		/capabilities\.data \? null : capabilities\.error/.test(rendered),
		"a capabilities error is fatal again even when capabilities still holds data",
	);
});

test("a failed background capabilities refetch does not blank a loaded settings page", async () => {
	// Reviewer M1. React Query keeps `data` and `error` set together after a
	// failed refetch of a query that had already succeeded, so a capabilities
	// error is NOT on its own evidence that the section has nothing to render.
	// Gating the error branch on `capabilities.error` alone therefore replaced a
	// fully-loaded page with "the server is not answering" whenever a background
	// refetch failed -- and `staleTime: 60_000` + `refetchOnWindowFocus` means
	// alt-tabbing back after a minute is enough to reach it.
	//
	// The cost is data loss, not just a wrong frame: the SECTION holds every
	// draft in its own state, and this file's header promises drafts survive
	// failures. Unmounting the section destroys typed-but-unsaved edits.
	//
	// The marker is the row's `data-setting-key` rather than a word from a row's
	// chrome: a row's copy is the design's to change, while the anchor is the
	// contract every deep link and every test in this repo reaches for.
	//
	// Every other test here seeds capabilities failure with NO prior success, so
	// `capabilities.data` is undefined in all of them -- which is why the whole
	// suite stayed green over this. The success-then-failure seeding below is
	// the entire point of this case.
	const client = newClient();
	client.setQueryData(backendSettingsKeys.all, {
		sections: [{ name: "General" }],
		settings: [
			{
				key: "a.b",
				label: "A",
				help: "h",
				section: "General",
				value: "1",
				type: "string",
				// The tier a server may carry. Without it this fixture's key is not
				// in the UI's curation map, so it lands under the advanced tier and
				// the section opens CLOSED -- the row this test is about would never
				// render, and the assertion below would be testing an empty page.
				tier: "core",
			},
		],
	});

	let capabilitiesMode = "ok";
	const capabilities = new QueryObserver(client, {
		queryKey: desktopKeys.capabilities,
		retry: false,
		staleTime: 60_000,
		queryFn: () => {
			if (capabilitiesMode === "ok")
				return Promise.resolve({
					desktop_available: true,
					features: { settings: 1 },
				});
			return Promise.reject(new Error("boom"));
		},
	});
	const unsubscribe = capabilities.subscribe(() => {});
	await new Promise((resolve) => setTimeout(resolve, 40));

	const healthy = renderBackendSettings(client);
	assert.match(
		healthy,
		/data-setting-key="a\.b"/,
		"the seeded healthy frame never loaded",
	);
	assert.match(
		text(healthy),
		/Use default/,
		"the seeded healthy row is not the off-default row this case is about",
	);

	capabilitiesMode = "fail";
	await capabilities.refetch();

	// The precondition the finding rests on. If a refetch ever stops preserving
	// data alongside the error, this test silently stops covering M1 -- which is
	// exactly how the regression survived 41 green tests.
	const state = capabilities.getCurrentResult();
	assert.equal(state.status, "error", "capabilities did not reach an error");
	assert.ok(
		state.data,
		"capabilities dropped its data on a failed refetch; this test no longer covers M1",
	);

	const afterFailure = renderBackendSettings(client);
	assert.doesNotMatch(
		afterFailure,
		/Your settings could not be loaded\./,
		"a background capabilities failure blanked a loaded settings page, destroying unsaved row drafts",
	);
	assert.match(
		afterFailure,
		/data-setting-key="a\.b"/,
		"the settings rows are gone after a background capabilities failure",
	);
	assert.equal(
		afterFailure,
		healthy,
		"a background capabilities failure changed the loaded settings frame",
	);

	unsubscribe();
	client.clear();
});

// Review R4 / design D3: a request that ran out of its budget is a state with an
// explanation and an action, on the surfaces that CLASSIFY rather than render
// the request's own sentence.
//
// The 504 split this change set introduces was right about the panels and wrong
// about everything downstream of them: `backendErrorKind` answered `unknown`,
// whose diagnosis and remedy are both empty, so the compatibility banner — the
// one surface with no in-place retry — told a user their server "did not answer
// as expected" and stopped. A server wedged for the app's whole budget is the
// case that banner exists for, and its instruction is what gets it answered.
test("an expired request keeps a diagnosis and its instruction", () => {
	const ours = new DesktopControlError(
		504,
		"The app waits up to 20 seconds for this request, and it was still running when the app stopped waiting.",
		undefined,
		"deadline_exceeded",
	);
	assert.equal(backendErrorKind(ours), "deadline");

	const sentence = backendLoadErrorMessage(
		"Your settings could not be loaded.",
		ours,
	);
	assert.match(sentence, /did not answer in time/);
	assert.match(sentence, /Restart the app so it can start its own server\./);
	// Not the offline claim, which this is not: nothing established that the
	// server was stopped, only that it stayed silent for the whole budget.
	assert.doesNotMatch(sentence, /is not answering\./);

	const banner = backendCompatibilityMessage({
		kind: "deadline",
		unpaired: false,
		missing: [],
		answered: false,
	});
	assert.match(banner, /did not answer in time/);
	assert.match(banner, /Restart the app so it can start its own server\./);

	// And a 504 that is NOT ours — an upstream gateway's — keeps the honest
	// "we cannot advise" instead of borrowing our reason (review round 1, N2).
	const upstream = new DesktopControlError(504, "upstream timeout");
	assert.equal(backendErrorKind(upstream), "unknown");
	assert.equal(
		backendLoadErrorMessage("Your settings could not be loaded.", upstream),
		"Your settings could not be loaded.",
	);
});

/*
 * The pairing causes, one sentence each - and the controls each state is entitled
 * to offer (design § 2, § 3, § 11.1-2).
 *
 * The operator's screenshot had three surfaces disagreeing about ONE fact: a banner
 * asking them to make the app manage the server, a chat pane calling their server
 * old, and a sidebar printing the daemon's own prose. So these cases are about the
 * two properties that make that impossible rather than about wording: every cause's
 * sentence exists ONCE and is selected by both surfaces from the same exported
 * decision, and a control is offered only where an act exists that can change the
 * condition.
 */
const ALL_FEATURES = {
	auth: 1,
	settings: 1,
	commands: 1,
	catalogues: 1,
	lifecycle: 1,
	mcp: 1,
	radient: 1,
	session_catalogue: 2,
};

/** The banner's two reads, answered the way main answers them. */
function bannerClient({ pairing, features = ALL_FEATURES, owned = false }) {
	const client = newClient();
	client.setQueryData(desktopKeys.capabilities, {
		desktop_available: pairing.available,
		features,
	});
	globalThis.__serverHealth = {
		online: true,
		snapshot: {
			state: "attached",
			reconnecting: false,
			owned,
			url: "http://127.0.0.1:7341",
			instanceId: "instance-1",
			pid: 4321,
			version: "0.55.6",
			prefix: "/Users/x/.local/share/uv/tools/local-operator",
			installKind: "uv-tool",
			desktopAvailable: pairing.available,
			pairing,
			failures: 0,
			capabilityStatus: null,
			unanswered: 0,
			lastTransportAt: null,
			detail: "Connected to the daemon.",
			updatedAt: 0,
		},
	};
	return client;
}

/** The rendered text a user reads, with the entities a server render escapes. */
function renderedText(html) {
	return text(html)
		.replace(/&#x27;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&");
}

const PAIRING_CAUSES = [
	"successor",
	"governed-elsewhere",
	"pre-handshake",
	"credential-refused",
	"unpaired",
];

test("one cause, one sentence: every pairing cause is worded once, and it is not a version problem", () => {
	for (const cause of PAIRING_CAUSES) {
		const sentence = BACKEND_PAIRING_SENTENCE[cause];
		assert.ok(sentence, `${cause}: the table must carry a sentence`);

		/*
		 * The banner renders that exact sentence - not a paraphrase of it - and the
		 * per-surface decision hands the SAME string to the chat pane and the sidebar,
		 * which is what "one authority" has to mean to be assertable.
		 */
		const message = backendCompatibilityMessage({
			kind: "unknown",
			unpaired: true,
			missing: [],
			answered: true,
			cause,
		});
		assert.equal(
			message,
			sentence,
			`${cause}: the banner's sentence is the table's`,
		);
		assert.equal(
			backendPairingSentence("unpaired", cause),
			sentence,
			`${cause}: the pane and the list read the same sentence as the banner`,
		);

		// The app-managed clause this change removes (design § 3.1), and the version
		// sentence a pairing condition must never borrow (design § 4).
		assert.doesNotMatch(sentence, /manage its own server/);
		assert.doesNotMatch(sentence, /Update the (backend|server)/i);
		assert.doesNotMatch(sentence, /older than this app expects/);
		assert.doesNotMatch(sentence, /Update/, `§ 4's prediction, for ${cause}`);
	}

	// S3 is the ONE cause that names an age, and it also says what still works -
	// both halves are decisions rather than implications (design § 3.3).
	assert.match(
		BACKEND_PAIRING_SENTENCE["pre-handshake"],
		/older than the pairing handshake/,
	);
	assert.match(
		BACKEND_PAIRING_SENTENCE["pre-handshake"],
		/CLI and the TUI are unaffected/,
	);

	/*
	 * And the tri-state is what keeps that true at the surfaces: a payload that
	 * closes the desktop plane is `unpaired` even with every feature advertised -
	 * the case the chat pane used to report as a version gap.
	 */
	assert.equal(
		desktopFeatureState(
			{ desktop_available: false, features: ALL_FEATURES },
			"session_catalogue",
			2,
		),
		"unpaired",
	);
	assert.equal(
		desktopFeatureEnabled(
			{ desktop_available: false, features: ALL_FEATURES },
			"session_catalogue",
			2,
		),
		false,
		"the boolean stays the projection, so no call site changes meaning",
	);
	assert.equal(
		desktopFeatureState(
			{ desktop_available: true, features: ALL_FEATURES },
			"session_catalogue",
			3,
		),
		"below-version",
	);
});

test("the banner offers only the controls that can change the condition", () => {
	const cases = [
		// cause, retry offered, update offered
		["successor", true, false],
		["credential-refused", true, false],
		["unpaired", true, false],
		// Another program's plane: the daemon refuses a second claim even with the
		// correct key, so a Retry there is a button that provably cannot work
		// (design § 2 S2, § 10.2).
		["governed-elsewhere", false, false],
		// An install older than the handshake: the update IS the remedy, but only for
		// an install this app holds.
		["pre-handshake", false, false],
	];
	for (const [cause, retry, update] of cases) {
		const rendered = renderedText(
			renderBackendCompatibilityBanner(
				bannerClient({ pairing: { available: false, cause } }),
			),
		);
		assert.ok(
			rendered.includes(BACKEND_PAIRING_SENTENCE[cause]),
			`${cause}: the banner renders its sentence, and this one is not it: ${rendered}`,
		);
		assert.equal(
			/Retry/.test(rendered),
			retry,
			`${cause}: Retry is offered only where re-claiming can change the state`,
		);
		assert.equal(
			/Update backend/.test(rendered),
			update,
			`${cause}: an update is offered only where it is the remedy that exists`,
		);
	}

	// The SAME S3 state, with main saying this app holds the serving install: there
	// the install is its to move, so the update is offered (design § 3.4).
	const owned = renderedText(
		renderBackendCompatibilityBanner(
			bannerClient({
				pairing: { available: false, cause: "pre-handshake" },
				owned: true,
			}),
		),
	);
	assert.match(owned, /Update backend/);
	assert.doesNotMatch(owned, /Retry/);

	// And a PAIRED app with a genuine version gap keeps the negotiated remedy.
	const versionGap = renderedText(
		renderBackendCompatibilityBanner(
			bannerClient({
				pairing: { available: true, cause: null },
				features: { ...ALL_FEATURES, mcp: 0 },
			}),
		),
	);
	assert.match(versionGap, /Update backend/);

	// The update decision itself, stated at the seam: S3 without ownership is not an
	// update, and no other pairing cause ever is.
	assert.equal(
		backendUpdateIsRemedy({
			kind: "unknown",
			unpaired: true,
			answered: true,
			cause: "pre-handshake",
			servedByThisApp: false,
		}),
		false,
	);
	assert.equal(
		backendUpdateIsRemedy({
			kind: "unknown",
			unpaired: true,
			answered: true,
			cause: "pre-handshake",
			servedByThisApp: true,
		}),
		true,
	);
	for (const cause of [
		"successor",
		"governed-elsewhere",
		"credential-refused",
		"unpaired",
	]) {
		assert.equal(
			backendUpdateIsRemedy({
				kind: "unknown",
				unpaired: true,
				answered: true,
				cause,
				servedByThisApp: true,
			}),
			false,
			`${cause}: installing a server cannot repair a pairing this app performs itself`,
		);
	}
});

test("the banner is on screen for a pairing cause the capability answer cannot show", () => {
	/*
	 * WHY this is its own case. `/v1/capabilities` admits nobody, so a daemon this
	 * app is not paired with answers it normally - including `desktop_available:
	 * true`, which is what a successor with an env-governed plane reports. A banner
	 * gated on the capability payload alone would stay silent in exactly the state
	 * the operator photographed, so the pairing RECORD is half the condition.
	 */
	const healthy = { desktop_available: true, features: ALL_FEATURES };
	assert.equal(
		compatibilityBannerShown(healthy),
		false,
		"an answer that opens every surface is not on its own a reason to speak",
	);
	assert.equal(
		compatibilityBannerShown(healthy, "successor"),
		true,
		"a pairing cause main published is a reason to speak whatever the payload says",
	);
	const rendered = renderedText(
		renderBackendCompatibilityBanner(
			bannerClient({ pairing: { available: false, cause: "successor" } }),
		),
	);
	assert.match(rendered, /was replaced while this app was running/);
});

test("the banner's Retry reaches main's reconnect verb, not a refetch of a public route", () => {
	/*
	 * A source assertion against the shipped component, and deliberately so: the
	 * defect is a control whose HANDLER cannot work, and `invalidateQueries` on a
	 * public route is invisible in a rendered frame - the button looks identical and
	 * the state does not move (design § 2, § 11.2). The behavioural half is driven
	 * live by the frame rig, where the daemon's own access log shows the claim the
	 * control caused.
	 */
	const source = readFileSync(
		"src/renderer/src/shared/components/common/backend-compatibility-banner.tsx",
		"utf8",
	);
	assert.match(source, /window\.api\?\.backend\?\.reconnect\?\.\(\)/);
	const verb = source.indexOf("backend?.reconnect?.()");
	const invalidate = source.indexOf("invalidateQueries", verb);
	assert.ok(verb > 0, "the reconnect verb must be the control's act");
	assert.ok(
		invalidate > verb,
		"the refetch follows the verb rather than replacing it",
	);
});
