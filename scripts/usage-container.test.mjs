import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The `/usage` CONTAINER's query wiring, asserted by rendering it.
 *
 * `usage-view.test.mjs` pins the arithmetic; nothing pinned what `UsageView`
 * hands `UsageDialog` across the live-ask lifecycle, and that is exactly where
 * two majors hid. Both are about which BRANCH renders, over time, against real
 * react-query state — neither is visible to a unit test over the model, and
 * neither is visible to a story, because a story supplies the props directly
 * and can therefore depict a state the container cannot produce:
 *
 *  - Asking for live numbers put `live` in the query key, so the new key had no
 *    data: `isLoading` went true and the body replaced the cached table with
 *    the word `Loading` for the whole multi-second provider probe. Worse, on a
 *    failed attempt's retry backoff the body fell through to the EMPTY-STATE
 *    copy ("No usage reports. Sign in to a provider…") in front of a user who
 *    has reports — a false statement about their situation, not a sparse one.
 *  - "Ask providers again" was inert: `setLive(true)` on an already-`true`
 *    state is a React no-op, the key does not change, and a fresh query does
 *    not refetch. The only recovery was Esc and reopen.
 *
 * These also decide whether the committed `loading` and `fetching` evidence
 * frames photograph reachable states, which is the one thing a reviewer cannot
 * check any other way.
 *
 * Rendered with `renderToStaticMarkup` against a real `QueryClient` and the
 * real transport, so the fault is injected at the bridge and the shipped code
 * builds every piece of state under assertion.
 */

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { renderToStaticMarkup } from "react-dom/server";
			import { QueryClientProvider } from "@tanstack/react-query";
			import { UsageDialog, UsageView } from "./src/renderer/src/features/chat/pickers/usage-view";
			/*
			 * The STORIES themselves, so the evidence frames are asserted against
			 * the container rather than against a restatement of them here. A copy
			 * of the args would keep passing while the committed frame stayed a
			 * picture of an unreachable state, which is the whole finding.
			 */
			import { Fetching, Loading } from "./src/renderer/src/features/chat/pickers/usage-view.stories";
			export const loadingStoryArgs = Loading.args;
			export const fetchingStoryArgs = Fetching.args;
			export { QueryClient, QueryObserver } from "@tanstack/react-query";
			export { usageQueryOptions } from "./src/renderer/src/features/chat/pickers/usage-view";
			/*
			 * The APP's own query defaults, so the client below is the shipped
			 * policy rather than a convenient one. See newClient.
			 */
			export { defaultQueryOptions } from "./src/renderer/src/shared/api/query-client";

			/*
			 * The picker registry mounts UsageView with a PickerContext; the only
			 * fields this container reads are \`onClose\` and \`action.args\` (the
			 * provider scope from the slash line).
			 */
			export const renderUsage = (client, args = "") =>
				renderToStaticMarkup(
					createElement(
						QueryClientProvider,
						{ client },
						createElement(UsageView, {
							onClose: () => undefined,
							action: { args },
						}),
					),
				);

			/*
			 * The dialog on its own, for the states whose INPUT is a container state
			 * that a static render cannot reach. renderToStaticMarkup mounts fresh
			 * every call, so the container's own useState (live, the last-known
			 * payload) always starts at its initial value - a test that rendered the
			 * container after a failed ask would be photographing a first paint, not
			 * the post-failure frame. So the lifecycle is asserted from the real
			 * observer and the FRAME is asserted here, from the props the container
			 * hands over at that point.
			 */
			export const renderDialog = (props) =>
				renderToStaticMarkup(
					createElement(UsageDialog, {
						onClose: () => undefined,
						onFetchLive: () => undefined,
						now: 1760000000000,
						...props,
					}),
				);
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	plugins: [
		{
			/*
			 * Un-portal the dialog chrome, and nothing else.
			 *
			 * Radix's `Portal` calls `createPortal` into `document.body`, which does
			 * not exist under `renderToStaticMarkup`, so the real `DialogContent`
			 * renders to the empty string and every assertion below would pass
			 * vacuously against `''`. There is no jsdom in this repo.
			 *
			 * The four replacements are the overlay FRAME only — an element that
			 * renders its children inline. Everything under assertion stays the
			 * shipped code: `UsageView`'s query options, `UsageDialog`'s branch
			 * selection, `PickerHost`'s body/toolbar/result wiring, and the whole
			 * report table. Nothing here can make a failing branch pass, because
			 * none of these components decides what the body shows.
			 *
			 * `title`/`description` become real elements rather than being dropped,
			 * so the description line stays assertable.
			 */
			name: "dialog-chrome-fixture",
			setup(builder) {
				builder.onResolve({ filter: /ui\/dialog$/ }, () => ({
					path: "dialog",
					namespace: "chrome",
				}));
				builder.onLoad({ filter: /.*/, namespace: "chrome" }, () => ({
					contents: `
						import { createElement } from "react";
						const passthrough = (tag) => ({ children, open, onOpenChange, onOpenAutoFocus, showClose, ...rest }) =>
							open === false ? null : createElement(tag, rest, children);
						export const Dialog = passthrough("div");
						export const DialogContent = passthrough("div");
						export const DialogTitle = passthrough("h2");
						export const DialogDescription = passthrough("p");
					`,
					loader: "js",
					resolveDir: process.cwd(),
				}));
			},
		},
	],
	// React and React Query stay external so the bundle shares ONE copy with
	// this file's own imports; two copies give the component a different
	// QueryClient context than the one the test seeds.
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
});

/*
 * The desktop bridge. Every response the container sees is built by the SHIPPED
 * transport from what this returns, so a test cannot accidentally assert
 * against a hand-made payload shape the backend never sends.
 *
 * Must exist before the module graph is evaluated: without `window.api.desktop`
 * the renderer takes its browser-dev HTTP branch, which is not what ships.
 */
let respond = async () => ({ status: 200, body: { result: emptyPayload() } });
const requests = [];
globalThis.window = {
	api: {
		desktop: {
			request: async (request) => {
				requests.push(request);
				return respond(request);
			},
		},
	},
};

// Written to a real file rather than a data: URL: React DOM's server build
// resolves its own CJS entry at import time, which a data: URL has no base for.
const bundlePath = new URL("./_usage-container.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	QueryClient,
	QueryObserver,
	defaultQueryOptions,
	fetchingStoryArgs,
	loadingStoryArgs,
	renderDialog,
	renderUsage,
	usageQueryOptions,
} = await import(bundlePath.href);
await unlink(bundlePath);

const NOW = 1_760_000_000_000;

function emptyPayload() {
	return { reports: [], source: "cached", fetched_at: NOW };
}

/** A cached response carrying one real window, as the route shapes it. */
function payload(source = "cached", used_fraction = 0.62) {
	return {
		reports: [
			{
				provider: "anthropic",
				fetched_at: NOW,
				identity: "damian@example.com",
				notes: null,
				consecutive_failures: 0,
				usage_unavailable: false,
				next_probe_at_ms: null,
				credential_invalid: false,
				age_ms: 0,
				state: "available",
				limits: [
					{
						id: "five_hour",
						label: "5-hour",
						window: "five_hour",
						status: null,
						resets_at: null,
						resets_at_ms: NOW + 3_600_000,
						tier: "",
						shared: true,
						amount: {
							used: used_fraction * 100,
							limit: 100,
							remaining: null,
							used_fraction,
							unit: "percent",
						},
					},
				],
			},
		],
		source,
		fetched_at: NOW,
	};
}

/** The rendered text a user reads, with markup and layout whitespace removed. */
const text = (html) =>
	html
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();

/**
 * A client running the SHIPPED policy.
 *
 * This used to build `retry: false`, and that one divergence is why a blocker
 * survived a full review round (UX U8): under `retry: false` a failure settles
 * in a single tick, so no test here could observe the window where an attempt
 * has failed, `errorUpdatedAt` is still 0, and the query reports neither
 * loading nor settled. The app spent ~1s in that window on every failed ask and
 * showed nothing at all. A test that only passes under a policy the app does
 * not use is not evidence about the app, so the defaults are IMPORTED.
 *
 * `gcTime` is the one deliberate override, and it is about the test rather than
 * the policy: `renderToStaticMarkup` mounts and unmounts on every call, and a
 * collected query between two steps would make a later assertion measure a cold
 * start instead of the state the previous step left behind.
 */
const newClient = () =>
	new QueryClient({
		defaultOptions: {
			...defaultQueryOptions,
			queries: {
				...defaultQueryOptions.queries,
				gcTime: Number.POSITIVE_INFINITY,
			},
		},
	});

/** Let react-query settle its microtasks and any queued state. */
const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** Seed the cached (live: false) key the dialog opens on. */
async function seedCached(client, provider = "") {
	respond = async () => ({ status: 200, body: { result: payload("cached") } });
	await client.fetchQuery({
		queryKey: ["desktop", "usage", provider, false],
		queryFn: async () => {
			const { desktopResult } = await import(
				"./_usage-container.transport.mjs"
			).catch(() => ({}));
			return undefined;
		},
	});
}

test("the loading story photographs the toolbar the container really produces", async () => {
	// The `loading` evidence frame photographed `Ask providers now`, ENABLED,
	// and the shipped container cannot produce that at first paint: react-query
	// sets `isLoading` and `isFetching` together on a first load, so the action
	// is always in-flight and disabled. The frame was a picture of a state the
	// app has no path to — and loading is precisely the state a reviewer cannot
	// check any other way, which is what makes an unreachable frame worse than
	// no frame.
	//
	// The in-flight label at FIRST PAINT is `Reading cached usage`, not
	// `Asking providers`: opening the view reads the backend's cache, and the
	// ask has not been made (UX U9). The two labels are asserted apart here
	// precisely because they used to be the same string.
	//
	// So this asserts the STORY against the CONTAINER rather than either against
	// itself: render the container at first paint, render the dialog with the
	// story's own args, and require the toolbars to agree.
	const client = newClient();
	let release;
	respond = () =>
		new Promise((resolve) => {
			release = () => resolve({ status: 200, body: { result: payload() } });
		});

	const firstPaint = renderUsage(client);
	assert.match(
		text(firstPaint),
		/Reading cached usage/,
		"first paint must show the in-flight label for a CACHED read",
	);
	assert.doesNotMatch(
		text(firstPaint),
		/Asking providers/,
		"first paint must not claim a live provider ask the user never made",
	);
	assert.match(
		firstPaint,
		/<button[^>]*\sdisabled(?=[\s>=])/,
		"the action is disabled while the first load is out",
	);
	assert.doesNotMatch(text(firstPaint), /Ask providers now/);
	// And the body is the loading state, not the empty-state copy.
	assert.doesNotMatch(text(firstPaint), /No usage reports/);

	// The story's own args, read from the story module rather than restated
	// here — a copy would pass while the committed frame stayed wrong.
	const storyFrame = renderDialog({ ...loadingStoryArgs });
	assert.match(
		text(storyFrame),
		/Reading cached usage/,
		"the loading story must depict the toolbar the container produces",
	);
	assert.match(
		storyFrame,
		/<button[^>]*\sdisabled(?=[\s>=])/,
		"the loading story's action must be disabled, as it is in the app",
	);
	assert.doesNotMatch(text(storyFrame), /Ask providers now/);

	release?.();
	await settle();
	client.clear();
});

test("the fetching story photographs a state the container can now reach", async () => {
	// The `fetching` frame showed cached numbers retained during a live ask,
	// which the container could not produce: `live` is in the key, so the ask
	// started a query with no data and the body rendered the word `Loading`.
	// The frame was hand-fed story props. With `placeholderData` the state is
	// real, and this asserts the story's args are the ones the container
	// actually hands over mid-ask.
	const client = newClient();
	respond = async () => ({ status: 200, body: { result: payload("cached") } });
	const { observer, unsubscribe, release } = await askLive(client);
	const live = observer.getCurrentResult();

	// What the container passes at this instant.
	const fromContainer = {
		payload: live.data,
		loading: live.isLoading,
		fetching: live.isFetching,
		asked: true,
	};
	// What the story pins. The flags must agree, or the frame is fiction.
	assert.equal(fetchingStoryArgs.fetching, fromContainer.fetching);
	assert.equal(Boolean(fetchingStoryArgs.loading), fromContainer.loading);
	assert.ok(fromContainer.payload, "the container must still hold a payload");
	// Both render a table with the in-flight label above it.
	for (const [name, args] of [
		["container", fromContainer],
		["story", fetchingStoryArgs],
	]) {
		const frame = text(renderDialog(args));
		assert.match(frame, /Asking providers/, name);
		assert.match(frame, /5-hour/, `${name} keeps the cached numbers`);
		assert.doesNotMatch(frame, /No usage reports/, name);
	}

	release();
	await settle();
	unsubscribe();
	client.clear();
});

/**
 * Drive the SHIPPED query options through the key switch a live ask performs.
 *
 * This is the heart of the finding and it cannot be faked: the options are the
 * container's own (`usageQueryOptions`), the observer is what `useQuery` is
 * built on, and switching its key is exactly what `setLive(true)` does. What is
 * asserted is the state the container would hand `UsageDialog` at that instant.
 */
async function askLive(client, { hang = true } = {}) {
	const observer = new QueryObserver(client, usageQueryOptions(undefined, false));
	const unsubscribe = observer.subscribe(() => {});
	await settle();

	let release;
	respond = () =>
		hang
			? new Promise((resolve) => {
					release = () =>
						resolve({ status: 200, body: { result: payload("live") } });
				})
			: Promise.reject(new Error("providers refused"));

	// The ask: same options, `live` now true — a DIFFERENT query key.
	observer.setOptions(usageQueryOptions(undefined, true));
	await settle(5);
	return { observer, unsubscribe, release: () => release?.() };
}

test("asking for live numbers keeps the cached table on screen", async () => {
	// `live` is part of the query key, so the ask starts a query with no cached
	// entry. Without `placeholderData` the body rendered the bare word
	// `Loading` and the tally vanished for the whole probe — a regression
	// against the TUI, which paints cached reports while the fetch runs behind
	// them (`UsagePanel.show_cached`).
	const client = newClient();
	respond = async () => ({ status: 200, body: { result: payload("cached") } });

	const { observer, unsubscribe, release } = await askLive(client);
	const state = observer.getCurrentResult();

	// The state the dialog receives mid-ask: the previous payload is STILL there
	// and the query is visibly fetching. Without `placeholderData` this is
	// `data: undefined, isLoading: true`, which renders the word `Loading`.
	assert.equal(state.isFetching, true, "the ask must be in flight");
	assert.ok(state.data, "the cached payload must survive the key switch");
	assert.equal(state.data.reports[0].limits[0].label, "5-hour");
	// `isLoading` is false precisely because placeholder data stands in, which
	// is what lets the dialog's `loading && !payload` guard keep the table up.
	assert.equal(state.isLoading, false);

	release();
	await settle();
	unsubscribe();
	client.clear();
});

test("a failed ask never shows empty-state copy to a user who has reports", async () => {
	// During a failed attempt's retry backoff the query reports neither loading
	// nor fetching, and the body fell through to "No usage reports. Sign in to a
	// provider that publishes quota…" — shown to someone looking at their own
	// reports a moment earlier. That is a false claim about their situation.
	const client = newClient();
	respond = async () => ({ status: 200, body: { result: payload("cached") } });

	const { observer, unsubscribe } = await askLive(client, { hang: false });
	await settle(60);
	const state = observer.getCurrentResult();

	assert.equal(state.isError, true, "the ask must have failed");
	// react-query DROPS the placeholder on a final error, so the query itself
	// no longer holds the payload. That is the state the empty-state copy used
	// to render in — `isPending` is false, `isFetching` is false, and `data` is
	// undefined, so every guard phrased in terms of the query alone falls
	// through to "you have no reports" in front of someone who does.
	assert.equal(state.data, undefined);
	assert.equal(state.isFetching, false);

	// The container holds the last-known payload across that drop, so the frame
	// it renders in this state still has numbers in it. Asserted on the dialog
	// with the props the container hands over here, because a static render
	// remounts the container and cannot carry its state across the failure.
	const frame = text(
		renderDialog({
			payload: payload("cached"),
			loading: false,
			fetching: false,
			asked: true,
			error: null,
			outcome: { tone: "error", text: "providers refused" },
		}),
	);
	assert.match(frame, /5-hour/, "the last-known table must stay on screen");
	assert.doesNotMatch(
		frame,
		/No usage reports/,
		"empty-state copy must never render for a user who has reports",
	);
	// The failure is still reported, in the action's receipt rather than by
	// blanking the numbers.
	assert.match(frame, /providers refused/);

	unsubscribe();
	client.clear();
});

test("a failed ask with nothing cached still reports the failure", async () => {
	// The guard above must not swallow the error for a user who has no numbers:
	// with nothing to keep on screen, the error IS the body.
	const frame = text(
		renderDialog({
			payload: null,
			loading: false,
			fetching: false,
			asked: true,
			error: "The backend could not be reached.",
		}),
	);
	assert.match(frame, /The backend could not be reached\./);
	assert.doesNotMatch(frame, /No usage reports/);
});

test("a second ask cannot be a state set, because that sends nothing", async () => {
	// Why "Ask providers again" was inert: the handler was `setLive(true)`, and
	// once `live` is already true that is a React no-op — the query key does not
	// change, so react-query re-applies the SAME options and a still-fresh query
	// does not refetch. The button relabelled itself to promise a repeat and
	// then did nothing; the only recovery was Esc and reopen.
	//
	// This pins the trap itself, at the bridge, so the fix cannot regress into
	// another key-identity trick: re-applying identical options sends nothing,
	// therefore the handler MUST issue an explicit refetch.
	//
	// NOTE this test characterises react-query rather than falsifying the old
	// code: it passes on the parent commit too, because the dead path was in
	// the CLICK HANDLER and a static render dispatches no events. The handler
	// itself is verified against the running app's request log — see the
	// remediation comment on the PR.
	const client = newClient();
	respond = async () => ({ status: 200, body: { result: payload("live") } });

	const observer = new QueryObserver(client, usageQueryOptions(undefined, true));
	const unsubscribe = observer.subscribe(() => {});
	await settle(30);

	const afterFirstAsk = requests.length;
	assert.ok(afterFirstAsk > 0, "the first ask must have reached the bridge");

	// Exactly what `setLive(true)` produced on an already-live view.
	observer.setOptions(usageQueryOptions(undefined, true));
	await settle(30);
	assert.equal(
		requests.length,
		afterFirstAsk,
		"re-applying the same options sends nothing — this is the dead button",
	);

	// The shipped handler's recovery: an explicit refetch, which does reach the
	// backend and does force it past its own cache.
	await observer.refetch();
	await settle();
	assert.equal(
		requests.length,
		afterFirstAsk + 1,
		"asking again must send another request",
	);
	const last = requests[requests.length - 1];
	assert.equal(last.op, "usage.get");
	assert.equal(last.live, true);
	assert.equal(last.refresh, true);

	unsubscribe();
	client.clear();
});

test("the empty-state copy still renders when there genuinely are no reports", async () => {
	// The guard above must not be so broad that the real empty state stops
	// rendering: a user with no quota-publishing provider still needs the
	// sentence that names the remedy.
	const client = newClient();
	client.setQueryData(["desktop", "usage", "", false], emptyPayload());
	const rendered = text(renderUsage(client));
	assert.match(rendered, /No usage reports/);
	assert.match(rendered, /Sign in to a provider that publishes quota/);
	// And no tally, since there is nothing to count.
	assert.doesNotMatch(rendered, /\d+ window/);
	client.clear();
});

test("the scroll body is a labelled, focusable region", async () => {
	// The rows are plain `li`s with nothing focusable in them, so without an
	// explicit tab stop the container could not receive focus and PageDown /
	// End / arrows did nothing — at real-account density roughly two thirds of
	// the content sits below the fold, locked behind a mouse wheel.
	const client = newClient();
	client.setQueryData(["desktop", "usage", "", false], payload("cached"));
	const rendered = renderUsage(client);
	// A labelled `<section>` IS the region landmark, so the role is implicit —
	// asserted on the element rather than on a `role` attribute that biome
	// correctly rejects as redundant.
	assert.match(
		rendered,
		/<section[^>]*aria-label="Report list"[^>]*>/,
		"the scroll body must be a labelled region",
	);
	assert.match(
		rendered,
		/<section[^>]*tabindex="0"[^>]*aria-label="Report list"/i,
		"the region must be a tab stop, or a keyboard user cannot scroll it",
	);
	// And it is the element that actually scrolls, not a sibling of it: the
	// overflow container has to be its ancestor for the key events to land.
	assert.match(
		rendered,
		/overflow-y-auto[^"]*"[^>]*>\s*<section[^>]*tabindex="0"/i,
		"the tab stop must sit inside the overflow container",
	);
	client.clear();
});

/*
 * ---------------------------------------------------------------------------
 * The failure contract, under the policy the app actually ships.
 *
 * These exist because the round that verified the receipt and the re-ask wiring
 * did so under a `retry: false` client this file used to construct, and the app
 * runs `retry: 1`. Everything below therefore asserts against `newClient()`,
 * which imports `defaultQueryOptions` from the app.
 * ---------------------------------------------------------------------------
 */

test("the query owns its retry contract instead of inheriting the global one", () => {
	// The app-wide default is `retry: 1`, which is right for a cheap read and
	// wrong for a fan-out across every signed-in provider's rate-limited usage
	// endpoint — and, left inherited, it put a silent retry window between the
	// click and any settled state, which is the window a failed ask showed
	// nothing in. The value matters less than the fact that this query STATES
	// one; an option object that omits `retry` is the defect.
	const options = usageQueryOptions(undefined, true);
	assert.ok(
		Object.hasOwn(options, "retry"),
		"usageQueryOptions must state its own retry policy, not inherit it",
	);
	assert.equal(options.retry, 0);

	// And the policy it is being stated AGAINST is the one the app ships, so a
	// change to `query-client.ts` re-opens this decision rather than silently
	// altering what these tests are evidence about.
	assert.equal(defaultQueryOptions.queries.retry, 1);
});

test("a failed ask settles and carries a reason under the shipped policy", async () => {
	// The blocker: under `retry: 1` the failure did not settle inside the window
	// the user was looking at, so `errorUpdatedAt` stayed 0 and the view had
	// nothing to report. With the contract owned above, one attempt fires and
	// the query settles into a real error state carrying the provider's own
	// message.
	const client = newClient();
	respond = async () => ({ status: 200, body: { result: payload("cached") } });

	const before = requests.length;
	const { observer, unsubscribe } = await askLive(client, { hang: false });
	await settle(60);
	const state = observer.getCurrentResult();

	assert.equal(state.isError, true, "the failed ask must reach an error state");
	assert.ok(
		state.errorUpdatedAt > 0,
		"the failure must be stamped, or no receipt can be derived from it",
	);
	assert.equal(state.fetchStatus, "idle", "nothing may still be in flight");
	// Exactly one attempt per ask: the retry contract, observed at the bridge
	// rather than read off the options.
	assert.equal(
		requests.length - before,
		2,
		"the cached read plus exactly one live attempt — no silent retry",
	);
	// The reason survives, which is what the receipt prints. `askLive`'s failure
	// mode is a rejected bridge call, so the shipped transport reports it as an
	// unreachable backend rather than as a provider's own refusal — either way
	// the receipt has a real sentence to print instead of nothing.
	assert.match(
		String(state.failureReason ?? state.error),
		/could not reach the backend/i,
	);

	unsubscribe();
	client.clear();
});

test("the re-ask sends a request after a failure, measured at the bridge", async () => {
	// U8's user-visible half: after a failed ask the button relabelled itself
	// and then sent nothing. Asserted by REQUEST COUNT rather than by reading
	// the rendered label, because the label was already right while the click
	// was dead.
	const client = newClient();
	respond = async () => ({ status: 200, body: { result: payload("cached") } });

	const { observer, unsubscribe } = await askLive(client, { hang: false });
	await settle(60);
	assert.equal(observer.getCurrentResult().isError, true);

	const afterFailure = requests.length;
	// The shipped handler's recovery path on an already-live view.
	await observer.refetch().catch(() => undefined);
	await settle(60);

	assert.equal(
		requests.length - afterFailure,
		1,
		"asking again after a failure must reach the backend",
	);
	const last = requests[requests.length - 1];
	assert.equal(last.op, "usage.get");
	assert.equal(last.live, true);
	assert.equal(last.refresh, true);

	unsubscribe();
	client.clear();
});

test("a failed initial load shows the failure, never the sign-in copy", async () => {
	// The second consequence of U8: with the backend down at open there is no
	// payload, so `reports.length === 0` was true and the body told a user with
	// eleven reports to go sign in to a provider — outage advice replaced by
	// sign-in advice. The empty state is a claim about an ANSWER, so it now
	// requires one.
	const frame = text(
		renderDialog({
			payload: null,
			loading: false,
			fetching: false,
			asked: false,
			error: "Providers refused.",
		}),
	);
	assert.match(frame, /Providers refused\./);
	assert.doesNotMatch(
		frame,
		/No usage reports/,
		"a failed load must not render the empty state",
	);
	assert.doesNotMatch(frame, /Sign in to a provider that publishes quota/);
});

test("an unanswered load shows neither the empty copy nor a false receipt", async () => {
	// The in-between: no payload, no error, nothing settled. Previously this
	// fell through to the empty-state sentence as well, because every branch
	// above it required a payload or an error.
	const frame = text(
		renderDialog({
			payload: null,
			loading: false,
			fetching: true,
			asked: false,
			error: null,
		}),
	);
	assert.doesNotMatch(frame, /No usage reports/);
	assert.doesNotMatch(frame, /Sign in to a provider that publishes quota/);
});

test("the in-flight label distinguishes a cached read from a live ask", async () => {
	// U9: opening the view reads the backend's cache, and labelling that
	// `Asking providers` claimed a provider probe the user never asked for.
	const cachedRead = text(
		renderDialog({ payload: null, loading: true, fetching: true, asked: false }),
	);
	assert.match(cachedRead, /Reading cached usage/);
	assert.doesNotMatch(cachedRead, /Asking providers/);

	const liveAsk = text(
		renderDialog({
			payload: payload("cached"),
			loading: false,
			fetching: true,
			asked: true,
		}),
	);
	assert.match(liveAsk, /Asking providers/);
});

test("a balance row is spoken as missing a limit, not as missing a report", async () => {
	// U10: a remaining-only row prints `519.86 USD left` and was announced
	// `519.86 USD left, not reported` — the spoken status contradicting the
	// printed number. What is missing is the LIMIT.
	const balance = payload("cached");
	balance.reports[0].limits[0].amount = {
		used: null,
		limit: null,
		remaining: 519.86,
		used_fraction: null,
		unit: "usd",
	};
	const frame = text(renderDialog({ payload: balance, now: NOW }));
	assert.match(frame, /519\.86 USD left/);
	assert.match(frame, /no limit reported/);
	assert.doesNotMatch(
		frame,
		/519\.86 USD left, not reported/,
		"the spoken status must not contradict the printed number",
	);
});
