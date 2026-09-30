import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

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
 *  - The cache snapshot alone omitted newly stored accounts until the user
 *    clicked. The open path now performs a distinct live-but-cache-aware read,
 *    and the explicit ask has its own forced identity for repeatable clicks.
 *  - Cached reports remain placeholders while either live mode is in flight,
 *    so the existing table stays visible during the provider round trip.
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
			import {
				UsageDialog,
				UsageView,
			} from "./src/renderer/src/features/chat/pickers/usage-view";
			/*
			 * The STORIES themselves, so the evidence frames are asserted against
			 * the container rather than against a restatement of them here. A copy
			 * of the args would keep passing while the committed frame stayed a
			 * picture of an unreachable state, which is the whole finding.
			 */
			import { Checking, Fetching, Loading } from "./src/renderer/src/features/chat/pickers/usage-view.stories";
			export const loadingStoryArgs = Loading.args;
			export const fetchingStoryArgs = Fetching.args;
			export const checkingStoryArgs = Checking.args;
			export { UsageDialog, UsageView };
			export { QueryClient, QueryObserver } from "@tanstack/react-query";
			export {
				usageQueryOptions,
				nextUsageAskId,
			} from "./src/renderer/src/features/chat/pickers/usage-view";
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
			 * vacuously against `''`. The dialog chrome is replaced only for this
			 * static fixture; query transitions are covered by the real query
			 * observer below and the container wiring by a source assertion.
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

/*
 * A REAL DOM, because the defects this file now pins are about what the
 * CONTAINER does over time and what it PAINTS while it does it.
 *
 * Every test below used to go through `renderToStaticMarkup`, and a static
 * render runs no effects: the mount effect that reached the automatic check
 * could not fire in the harness, so no test here could observe the request the
 * open is supposed to issue, the answer it abandoned, or the body it painted
 * while the live read was still out. That gap is exactly why two majors stayed
 * green (review R2/Q1/Q2): the suite pinned a shape the container never
 * creates. `react-dom/client` plus jsdom runs the effects, and the container's
 * own rendered DOM becomes the thing asserted.
 *
 * The static renders stay: they are how a CONTROLLED state - a specific prop
 * combination a mounted container cannot be frozen into - is asserted.
 */
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
// React only wraps updates in `act` when it is told this is a test environment.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.api = {
	desktop: {
		request: async (request) => {
			requests.push(request);
			return respond(request);
		},
	},
};
after(() => {
	dom.window.close();
});

// Written to a real file rather than a data: URL: React DOM's server build
// resolves its own CJS entry at import time, which a data: URL has no base for.
const { createRoot } = await import("react-dom/client");
const bundlePath = new URL("./_usage-container.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	QueryClient,
	QueryObserver,
	UsageView,
	checkingStoryArgs,
	defaultQueryOptions,
	fetchingStoryArgs,
	loadingStoryArgs,
	renderDialog,
	renderUsage,
	nextUsageAskId,
	usageQueryOptions,
} = await import(bundlePath.href);
await unlink(bundlePath);

const NOW = 1_760_000_000_000;

const requestModeCounts = (observed) => ({
	cached: observed.filter((request) => !request.live && !request.refresh)
		.length,
	auto: observed.filter((request) => request.live && !request.refresh).length,
	ask: observed.filter((request) => request.live && request.refresh).length,
});

function assertRequestModeCounts(observed, expected) {
	assert.deepEqual(requestModeCounts(observed), expected);
	assert.equal(
		observed.length,
		Object.values(expected).reduce((total, count) => total + count, 0),
		"every bridge request must belong to exactly one usage mode",
	);
}

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

/**
 * The dialog's action button, found by its LABEL rather than by position: the
 * footer's `Close` is a button too, and the toolbar's is the one under
 * assertion. Shared by the mount harness and the announcement test, so both
 * read the same control.
 */
const actionButtonIn = (host) =>
	[...host.querySelectorAll("button")].find((node) =>
		/^(Ask providers|Asking providers|Checking provider usage)/.test(
			node.textContent?.trim() ?? "",
		),
	);

/** The action's rendered label. */
const actionLabelIn = (host) => actionButtonIn(host)?.textContent?.trim() ?? "";

/**
 * One mounted `/usage` container, with its effects actually run.
 *
 * `renderUsage` above is a static render and stays the right tool for a
 * controlled prop state; this is for the questions a static render cannot
 * answer at all - which bridge requests an OPEN issues, and what is on screen
 * while one of them is still out. The waits go through `act` so React flushes
 * the state those promises produce before the assertions read the DOM.
 *
 * The dialog chrome is the same stub `renderUsage` uses, so what renders here
 * is the shipped container and body, not a Radix imitation of them.
 */
async function mountUsage(client, args = "") {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host);
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(UsageView, {
					onClose: () => undefined,
					action: { args },
				}),
			),
		);
	});
	return {
		/** The text a user reads, with markup and layout whitespace removed. */
		text: () => text(host.innerHTML),
		html: () => host.innerHTML,
		/** The action's own label, as rendered. */
		actionLabel: () => actionLabelIn(host),
		/**
		 * Press the action, the way a user does — a real click on the real button,
		 * so the ask's query identity and the disable rule under it are the shipped
		 * ones rather than a call to the container's handler.
		 */
		clickAction: async () => {
			const button = actionButtonIn(host);
			assert.ok(button, "the dialog must render its action");
			await act(async () => {
				button.dispatchEvent(
					new dom.window.MouseEvent("click", { bubbles: true }),
				);
			});
		},
		/**
		 * Re-render the SAME mount under a new `/usage <provider>` scope, which is
		 * what a slash-line change does to a container the picker keeps mounted.
		 * A fresh root would reset the state the scope question is about.
		 */
		rerender: (args) =>
			act(async () => {
				root.render(
					React.createElement(
						QueryClientProvider,
						{ client },
						React.createElement(UsageView, {
							onClose: () => undefined,
							action: { args },
						}),
					),
				);
			}),
		/**
		 * Let time pass inside `act`, so every state update the bridge's promises
		 * produce is flushed to the DOM before an assertion reads it.
		 */
		settle: (ms = 30) =>
			act(async () => {
				await settle(ms);
			}),
		unmount: async () => {
			await act(async () => root.unmount());
			host.remove();
		},
	};
}

test("UsageView enters on the automatic check and scopes the query to the slash argument", () => {
	const source = readFileSync(
		"src/renderer/src/features/chat/pickers/usage-view.tsx",
		"utf8",
	);
	const container = source.slice(source.indexOf("export const UsageView"));
	/*
	 * The mode the view STARTS in is the whole finding (R1/Q1): subscribing on
	 * `cached` and flipping to `auto` from a mount effect made `refetchOnMount`
	 * inert, because react-query reads that option at subscribe time. So the entry
	 * mode is asserted, and the flip is asserted ABSENT — a mount effect that sets
	 * it back would restore the defect while leaving the entry mode intact.
	 */
	assert.match(
		container,
		/useState<UsageQueryMode>\("auto"\)/,
		"the view must ENTER on the automatic check",
	);
	assert.ok(
		!container.includes('setMode("auto")'),
		"no mount effect may switch the mode into `auto`: that switch is what made refetchOnMount inert",
	);
	assert.ok(
		container.includes('usageQueryOptions(provider, "cached")'),
		"the cached snapshot must stay mounted as its own query, so a cold open can paint it",
	);
	const providerLine = container.indexOf(
		"const provider = action.args.trim() || undefined;",
	);
	const queryLine = container.indexOf(
		"const usage = useQuery(usageQueryOptions(provider, mode, askId));",
	);
	assert.ok(
		providerLine >= 0 && queryLine > providerLine,
		"the slash argument must reach the real usage query options",
	);
	assert.match(source, /setAskId\(nextUsageAskId\(\)\);/);
});

test("a fresh automatic entry is re-checked on both ways into the key", async () => {
	/*
	 * R1/R2. The previous option set covered only ONE of the two ways this key can
	 * be entered, and the test beside it pinned the way the container never took,
	 * which is why the defect was green. Both are asserted here, against an entry
	 * that the APP's own policy calls FRESH, because fresh is the state the defect
	 * lived in:
	 *
	 *  - SUBSCRIBE on the key: the container's own mount path, answered by
	 *    `refetchOnMount: "always"`;
	 *  - `setOptions` ONTO the key: a provider-argument change or a remount, which
	 *    never consults `refetchOnMount` and is answered by `staleTime: 0` instead.
	 */
	const client = newClient();
	const observed = [];
	respond = async (request) => {
		observed.push(request);
		return { status: 200, body: { result: payload("live") } };
	};
	const options = usageQueryOptions("radient", "auto");
	await client.fetchQuery(options);
	assert.equal(observed.length, 1, "the cache is primed by a real bridge read");
	assert.equal(observed[0].live, true);
	assert.equal(observed[0].refresh, false);
	const primed = client.getQueryCache().find({ queryKey: options.queryKey });
	assert.ok(primed);
	assert.ok(primed.state.dataUpdatedAt > 0);
	assert.equal(
		primed.isStaleByTime(defaultQueryOptions.queries.staleTime),
		false,
		"the re-check must start with a fresh, not merely stale, cache entry",
	);

	// The mount path, which is the shape the container now takes.
	const beforeMount = observed.length;
	const reopened = new QueryObserver(client, options);
	const unsubscribe = reopened.subscribe(() => {});
	await settle();
	assert.equal(observed.length, beforeMount + 1);
	assert.deepEqual(observed.at(-1), {
		op: "usage.get",
		provider: "radient",
		live: true,
		refresh: false,
	});
	unsubscribe();

	// The key-switch path. `setOptions` asks only whether the target query is
	// stale, so this fetches nothing unless the entry is PERMANENTLY stale — the
	// assertion that fails on the previous head.
	const switched = new QueryObserver(
		client,
		usageQueryOptions("radient", "cached"),
	);
	const stopSwitched = switched.subscribe(() => {});
	await settle();
	const beforeSwitch = observed.length;
	switched.setOptions(options);
	await settle();
	assert.equal(
		observed.length,
		beforeSwitch + 1,
		"a transition INTO the automatic key must re-check even a fresh entry",
	);
	assert.deepEqual(observed.at(-1), {
		op: "usage.get",
		provider: "radient",
		live: true,
		refresh: false,
	});

	stopSwitched();
	client.clear();
});

test("slash provider argument reaches the usage bridge request", async () => {
	const client = newClient();
	const before = requests.length;
	respond = async () => ({ status: 200, body: { result: payload("live") } });
	await client.fetchQuery(usageQueryOptions("radient", "auto"));
	assert.equal(requests.length, before + 1);
	assert.equal(requests.at(-1).provider, "radient");
	client.clear();
});

test("ask identities survive observer remounts and force distinct bridge reads", async () => {
	const client = newClient();
	const observed = [];
	respond = async (request) => {
		observed.push(request);
		return { status: 200, body: { result: payload("live") } };
	};

	const firstId = nextUsageAskId();
	const firstOptions = usageQueryOptions("radient", "ask", firstId);
	const first = new QueryObserver(client, firstOptions);
	const stopFirst = first.subscribe(() => {});
	await settle();
	assert.equal(observed.length, 1);
	assert.equal(observed[0].live, true);
	assert.equal(observed[0].refresh, true);
	stopFirst();

	// A separate mount gets its id from the same module sequence the component
	// uses. The distinct query identity must bypass the still-fresh ask cache.
	const secondId = nextUsageAskId();
	assert.ok(secondId > firstId, "ask ids must be monotonic across mounts");
	const secondOptions = usageQueryOptions("radient", "ask", secondId);
	assert.notDeepEqual(secondOptions.queryKey, firstOptions.queryKey);
	const second = new QueryObserver(client, secondOptions);
	const stopSecond = second.subscribe(() => {});
	await settle();
	assert.equal(observed.length, 2, "the remounted ask must reach the bridge");
	assert.deepEqual(
		observed.map(({ live, refresh }) => ({ live, refresh })),
		[
			{ live: true, refresh: true },
			{ live: true, refresh: true },
		],
	);

	stopSecond();
	client.clear();
});

test("open paints cached rows, discovers Radient automatically, then forces each ask", async () => {
	const client = newClient();
	const fresh = payload("live");
	fresh.reports[0].provider = "radient";
	fresh.reports[0].identity = "radient@example.com";
	let release;
	const { observer, unsubscribe, ask, observed } = await openUsage(client, {
		response: (request) =>
			request.refresh
				? Promise.resolve({ status: 200, body: { result: fresh } })
				: new Promise((resolve) => {
						release = () => resolve({ status: 200, body: { result: fresh } });
					}),
	});

	assert.equal(
		observer.getCurrentResult().data.reports[0].provider,
		"anthropic",
	);
	assertRequestModeCounts(observed, { cached: 1, auto: 1, ask: 0 });
	assert.equal(observed.at(-1).live, true);
	assert.equal(observed.at(-1).refresh, false);
	assert.equal(observer.getCurrentResult().isFetching, true);
	release();
	await settle();
	assert.equal(observer.getCurrentResult().data.reports[0].provider, "radient");
	assert.equal(
		observer.getCurrentResult().data.reports[0].identity,
		"radient@example.com",
	);

	ask(1);
	await settle();
	assert.equal(observed.at(-1).refresh, true);
	assertRequestModeCounts(observed, { cached: 1, auto: 1, ask: 1 });
	ask(2);
	await settle();
	assert.equal(observed.at(-1).refresh, true);
	assertRequestModeCounts(observed, { cached: 1, auto: 1, ask: 2 });

	unsubscribe();
	client.clear();
});

test("the loading story photographs the frame every open paints first", async () => {
	// The `loading` frame has been a picture of an unreachable toolbar TWICE.
	// First it showed `Ask providers now`, ENABLED, while the action was disabled
	// for every in-flight read; then it carried `Reading cached usage`, a third
	// in-flight label fed by a `checking` flag only a story sets — while the
	// container ENTERS on the automatic check and so paints `Checking provider
	// usage` from its first frame (design D1). Loading is precisely the state a
	// reviewer cannot check any other way, which is what makes an unreachable
	// frame worse than no frame.
	//
	// The third arm of the label and the flag that fed it are gone from the
	// shipped dialog now, so the question this test asks is the reachable one: do
	// the story's own args describe the frame a real open produces? The frame is
	// asserted against the story module's args (a copy would keep passing while
	// the committed frame stayed wrong) and the mount is asserted to paint the
	// same three things — skeleton body, the check's label, a usable action.
	const client = newClient();

	let release;
	respond = async () =>
		new Promise((resolve) => {
			release = () =>
				resolve({ status: 200, body: { result: payload("live") } });
		});
	const view = await mountUsage(client);
	try {
		assert.match(
			view.text(),
			/Loading provider usage/,
			"the skeleton is the first paint of an open",
		);
		assert.match(
			view.text(),
			/Checking provider usage/,
			"the open's own read is what the first paint names",
		);
		assert.doesNotMatch(
			view.text(),
			/Asking providers/,
			"first paint must not claim an ask the user never made",
		);
		assert.doesNotMatch(
			view.html(),
			/<button[^>]*\sdisabled(?=[\s>=])/,
			"a background read must leave the action usable",
		);
		assert.doesNotMatch(view.text(), /No usage reports/);
	} finally {
		release?.();
		await view.unmount();
	}

	// The story's own args, read from the story module rather than restated
	// here. Every flag is the one the container hands over at first paint: no
	// payload yet, a read in flight, nothing asked for by the user.
	assert.equal(
		loadingStoryArgs.payload,
		null,
		"an open starts with no payload of its own",
	);
	assert.equal(
		loadingStoryArgs.fetching,
		true,
		"the automatic check is out on the first frame",
	);
	assert.equal(
		loadingStoryArgs.loading,
		true,
		"and nothing has answered it yet",
	);
	assert.equal(
		Boolean(loadingStoryArgs.asked),
		false,
		"the first paint is not an ask the user made",
	);

	const beforeStatic = requests.length;
	const storyFrame = renderDialog({ ...loadingStoryArgs });
	const storyText = text(storyFrame);
	assert.match(
		storyText,
		/Checking provider usage/,
		"the frame must carry the label a real open paints, not a story-only one",
	);
	assert.match(storyText, /Loading provider usage/);
	assert.doesNotMatch(storyText, /Asking providers/);
	assert.doesNotMatch(
		storyText,
		/Reading cached usage/,
		"that label no longer exists in the shipped dialog, so a frame carrying it photographs nothing",
	);
	assert.doesNotMatch(
		storyFrame,
		/<button[^>]*\sdisabled(?=[\s>=])/,
		"the frame must agree with the story it is captured from: a background read leaves the action enabled",
	);
	assert.doesNotMatch(storyText, /No usage reports/);
	assert.equal(
		requests.length - beforeStatic,
		0,
		"a static render issues no backend requests",
	);

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
	const { observer, unsubscribe, release, observed } = await askLive(client);
	assertRequestModeCounts(observed, { cached: 1, auto: 1, ask: 1 });
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
	assertRequestModeCounts(observed, { cached: 1, auto: 1, ask: 1 });
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

test("opening /usage re-checks a FRESH automatic entry, so a new login appears", async () => {
	/*
	 * R1/Q1, reproduced on the path the container actually takes.
	 *
	 * The previous revision subscribed on the `cached` key and switched to `auto`
	 * from a mount effect. react-query consults `refetchOnMount` only from
	 * `QueryObserver.onSubscribe`, so the switch went through `setOptions` — which
	 * asks only whether the target query `isStale` — and inside the app's
	 * 5-minute `staleTime` the answer was no: the open issued NO request at all.
	 * That is the reported flow exactly (open `/usage`, store a Radient login,
	 * open it again seconds later), and the provider set stayed as it was.
	 *
	 * So the entry is primed with a real bridge read and confirmed FRESH under
	 * the app's own policy before the view opens; the open must still cross the
	 * bridge. On the previous head this assertion reads 0.
	 */
	const client = newClient();
	const observed = [];
	respond = async (request) => {
		observed.push(request);
		return { status: 200, body: { result: payload("live") } };
	};
	const options = usageQueryOptions("radient", "auto");
	await client.fetchQuery(options);
	assert.equal(observed.length, 1, "the cache is primed by a real bridge read");
	const primed = client.getQueryCache().find({ queryKey: options.queryKey });
	assert.equal(
		primed.isStaleByTime(defaultQueryOptions.queries.staleTime),
		false,
		"the reopen starts from an entry the app's own 5-minute policy calls fresh",
	);

	const before = observed.length;
	const view = await mountUsage(client, "radient");
	await view.settle();
	try {
		const opened = observed.slice(before);
		assertRequestModeCounts(opened, { cached: 1, auto: 1, ask: 0 });
		const autoRequest = opened.find(
			(request) => request.live && !request.refresh,
		);
		assert.deepEqual(autoRequest, {
			op: "usage.get",
			provider: "radient",
			live: true,
			refresh: false,
		});
	} finally {
		await view.unmount();
		client.clear();
	}
});

test("a cold open paints the cached rows while the live read is still out", async () => {
	/*
	 * Q2/D1/U1. The cached snapshot answers in a local read; the live check is a
	 * network round trip across every signed-in provider. The previous revision
	 * switched keys before the snapshot answered, so its result was never
	 * rendered and the body was the skeleton for the whole live check — worse
	 * than the branch it replaced, which painted the backend's cached rows on a
	 * single SQLite read. Measured here as the user sees it: the row label is on
	 * screen while the live read is deliberately never answered.
	 */
	const client = newClient();
	respond = async (request) =>
		request.live
			? new Promise(() => undefined)
			: { status: 200, body: { result: payload("cached") } };
	const view = await mountUsage(client);
	await view.settle(60);
	try {
		assert.match(
			view.text(),
			/5-hour/,
			"the cached numbers must paint while the live read is out",
		);
		assert.doesNotMatch(
			view.text(),
			/Loading provider usage/,
			"the skeleton must be gone once the cached answer landed",
		);
		assert.match(view.text(), /Checking provider usage/);
	} finally {
		await view.unmount();
		client.clear();
	}
});

test("a failed automatic read keeps the cached numbers on screen", async () => {
	/*
	 * Q3, same root cause as Q2. The automatic read is unforced and unrequested,
	 * and when it failed the cached answer that had arrived seconds earlier was
	 * thrown away with it, so the open ended in an error body where `main` kept
	 * the table. A failure of a probe the user did not start must not take their
	 * numbers with it.
	 */
	const client = newClient();
	respond = async (request) => {
		if (!request.live)
			return { status: 200, body: { result: payload("cached") } };
		throw new Error("providers refused");
	};
	const view = await mountUsage(client);
	await view.settle(80);
	try {
		assert.match(
			view.text(),
			/5-hour/,
			"the cached numbers must survive a failed automatic read",
		);
		assert.doesNotMatch(view.text(), /Loading provider usage/);
		assert.doesNotMatch(
			view.text(),
			/No usage reports/,
			"the empty state must never render for a user who has numbers",
		);
	} finally {
		await view.unmount();
		client.clear();
	}
});

test("the checking story's args are the ones the container hands over, and the check is announced", async () => {
	/*
	 * D2: `Checking` was the one in-flight story the container pin did not
	 * reach, so it could drift into depicting a toolbar the container cannot
	 * produce — the failure mode the pin exists for.
	 *
	 * U3: the polite region stayed silent for the automatic check, which is the
	 * only in-flight state this view adds. The label that changes is on a
	 * disabled-then-enabled control the user is not on, so a screen-reader user
	 * had no in-flight state and no completion signal for the flow this view
	 * exists to fix. Its sentence is now its own rather than the button's label
	 * (design D2), and the region is mounted empty and filled from an effect so
	 * the sentence is a CHANGE to a region that already exists — see
	 * `the polite region is mounted empty...` below.
	 */
	const client = newClient();
	const observed = [];
	respond = async (request) => {
		observed.push(request);
		return { status: 200, body: { result: payload("live") } };
	};
	// Prime the automatic key so the re-check has rows to keep on screen and
	// `isLoading` is false, then let the re-check hang: that is the instant the
	// story depicts.
	await client.fetchQuery(usageQueryOptions(undefined, "auto"));
	respond = async () => new Promise(() => undefined);
	const view = await mountUsage(client);
	await view.settle();
	const observer = new QueryObserver(
		client,
		usageQueryOptions(undefined, "auto"),
	);
	const stop = observer.subscribe(() => {});
	try {
		const live = observer.getCurrentResult();
		// What the container passes at this instant, read from the same query the
		// container renders rather than restated.
		const fromContainer = {
			payload: live.data,
			loading: live.isLoading,
			fetching: live.isFetching,
			asked: false,
		};
		assert.ok(fromContainer.payload, "the container must still hold a payload");
		assert.equal(checkingStoryArgs.fetching, fromContainer.fetching);
		assert.equal(Boolean(checkingStoryArgs.loading), fromContainer.loading);
		assert.equal(Boolean(checkingStoryArgs.asked), false);
		for (const [name, args] of [
			["container", fromContainer],
			["story", checkingStoryArgs],
		]) {
			const frame = text(renderDialog(args));
			assert.match(frame, /Checking provider usage/, name);
			assert.match(frame, /5-hour/, `${name} keeps the cached numbers`);
			assert.doesNotMatch(frame, /Asking providers/, name);
		}
		/*
		 * The check is announced through the polite region — and with a sentence of
		 * its own rather than the button's label, which is the echo the region
		 * exists to avoid (design D2). Read from the MOUNT: a static render runs no
		 * effects and so paints the region empty by construction.
		 */
		assert.match(
			view.html(),
			/<output[^>]*aria-live="polite"[^>]*>Checking for an updated usage report\.<\/output>/,
			"the automatic check must be announced through the polite region",
		);
		assert.doesNotMatch(view.html(), /Getting fresh usage from providers\./);
	} finally {
		stop();
		await view.unmount();
		client.clear();
	}
});

test("a failed explicit ask keeps the live rows it discovered", async () => {
	/*
	 * Review R8 / QA Q1, at the level the defect lived at.
	 *
	 * Every failed-ask assertion in this file drove a bare `QueryObserver` or read
	 * the receipt copy, and none of them mounted the container — which is exactly
	 * why the defect stayed green. It was a render-ORDER bug in the container's
	 * own last-known store: the cached snapshot re-asserted itself on the render
	 * where the ask's `data` is undefined, and that is the render react-query
	 * produces for a failed forced ask. So a user who opened `/usage` (the
	 * automatic check discovering the newly stored login), then pressed the ask
	 * and had it fail, watched the row this PR exists to surface leave the screen
	 * while the age line fell back from `Live report` to `Cached report`.
	 *
	 * Mounted, clicked, failed, read: the live rows must still be the ones on
	 * screen after that failure.
	 */
	const client = newClient();
	const live = payload("live");
	live.reports.push({
		...live.reports[0],
		provider: "radient",
		identity: "radient@example.com",
	});
	respond = async (request) => {
		if (!request.live)
			return { status: 200, body: { result: payload("cached") } };
		if (request.refresh) throw new Error("providers refused");
		return { status: 200, body: { result: live } };
	};
	const view = await mountUsage(client);
	try {
		await view.settle(60);
		assert.match(
			view.text(),
			/radient/,
			"the open's live read discovers the newly stored provider",
		);
		assert.match(view.text(), /Live report/);

		await view.clickAction();
		await view.settle(150);

		assert.equal(view.actionLabel(), "Ask providers again");
		assert.match(
			view.text(),
			/radient/,
			"a failed ask must not drop the rows the live read discovered",
		);
		assert.match(
			view.text(),
			/Live report/,
			"and the age line must keep the live vintage rather than the older cached one",
		);
		assert.doesNotMatch(view.text(), /Cached report/);
		assert.doesNotMatch(view.text(), /No usage reports/);
	} finally {
		await view.unmount();
		client.clear();
	}
});

test("the last-known payload is scoped to the provider argument", async () => {
	/*
	 * QA R9. The store is a ref and a ref outlives the provider argument: the
	 * picker re-renders this container when the slash line changes, so a payload
	 * remembered for one provider would paint under another's scope until that
	 * scope's own read landed. A skeleton is honest about not knowing; another
	 * provider's rows are not, and nothing on screen would say whose they were.
	 *
	 * The new scope's reads are left unanswered, so the only rows that could
	 * appear are the previous scope's.
	 */
	const client = newClient();
	const radientOnly = payload("live");
	radientOnly.reports[0].provider = "radient";
	radientOnly.reports[0].identity = "radient@example.com";
	respond = async (request) =>
		request.provider === "anthropic"
			? new Promise(() => undefined)
			: { status: 200, body: { result: radientOnly } };
	const view = await mountUsage(client, "radient");
	try {
		await view.settle(40);
		assert.match(
			view.text(),
			/radient/,
			"the scoped open must paint its own provider's rows",
		);

		await view.rerender("anthropic");
		await view.settle(40);

		assert.doesNotMatch(
			view.text(),
			/radient/,
			"the previous scope's rows must not paint under the new one",
		);
		assert.match(
			view.text(),
			/Loading provider usage/,
			"the new scope has no answer yet, and that is what it must say",
		);
	} finally {
		await view.unmount();
		client.clear();
	}
});

test("the polite region is mounted empty, and its sentence arrives as a change", async () => {
	/*
	 * Design D2 / code R9. A live region announces a CHANGE to a region that is
	 * already in the document; a sentence that arrives WITH the node is its
	 * initial content, which browsers and screen readers do not reliably
	 * announce. Measured on the previous head: the commit that created the
	 * `<output>` already carried `Checking provider usage`, in a single insertion
	 * with no `characterData` record — so the automatic check, the announcement
	 * this region was added for, was silent, and the region's own comment claimed
	 * the opposite.
	 *
	 * Three things, all at MOUNT level because a static render runs no effects and
	 * so paints the region empty whatever the component does:
	 *  1. the region is EMPTY in the first committed frame;
	 *  2. its sentence arrives as a MUTATION of the region, `characterData`/child
	 *     insertion into a node the document already has — not carried in with it;
	 *  3. the two in-flight sentences are distinct from each other and from the
	 *     action's label, the region goes quiet on settle, and a plain re-render
	 *     repeats neither.
	 */
	const CHECK_SENTENCE = "Checking for an updated usage report.";
	const ASK_SENTENCE = "Getting fresh usage from providers.";
	const client = newClient();

	let release = () => undefined;
	respond = async (request) =>
		request.live
			? new Promise((resolve) => {
					release = () =>
						resolve({ status: 200, body: { result: payload("live") } });
				})
			: { status: 200, body: { result: payload("cached") } };

	const host = document.createElement("div");
	document.body.appendChild(host);
	const frames = [];
	const changes = [];
	const region = () => host.querySelector('output[aria-live="polite"]');
	const regionText = () => region()?.textContent ?? null;
	/*
	 * The instrument is pointed at the REGION, not at the host, and it is
	 * attached from inside the first layout effect — the only moment at which the
	 * region is known to be in the document and still empty. A region that
	 * arrives already carrying its text produces no record HERE, which is
	 * precisely the shape that is not announced; a sentence written afterwards is
	 * a mutation of a node the document already has, which is.
	 */
	const watcher = new dom.window.MutationObserver((entries) => {
		for (const entry of entries) changes.push(entry.type);
	});
	let watching = false;

	let bump = () => undefined;
	function Wrapper() {
		const [, setTick] = React.useState(0);
		bump = () => setTick((tick) => tick + 1);
		/*
		 * A parent LAYOUT effect, so each reading is the COMMITTED frame rather
		 * than a later look at it: passive effects — where the sentence is written
		 * — run after layout effects, which is what makes "empty at first paint"
		 * measurable instead of a race.
		 */
		React.useLayoutEffect(() => {
			frames.push(regionText());
			if (!watching && region()) {
				watching = true;
				watcher.observe(region(), {
					childList: true,
					characterData: true,
					subtree: true,
				});
			}
		});
		return React.createElement(UsageView, {
			onClose: () => undefined,
			action: { args: "" },
		});
	}

	const root = createRoot(host);
	await act(async () => {
		root.render(
			React.createElement(
				QueryClientProvider,
				{ client },
				React.createElement(Wrapper),
			),
		);
	});
	try {
		assert.ok(region(), "the region must be mounted from the first paint");
		assert.equal(
			frames[0],
			"",
			"the region must enter the document EMPTY: text that arrives with the node is its initial content, and is not announced",
		);

		assert.ok(
			changes.length > 0,
			"the sentence must arrive as a MUTATION of the region: text that arrives with the node is its initial content, and is not announced",
		);
		assert.equal(
			regionText(),
			CHECK_SENTENCE,
			"the automatic check is what the open announces",
		);
		assert.notEqual(
			CHECK_SENTENCE,
			ASK_SENTENCE,
			"the check and the ask must not be the same sentence",
		);
		assert.equal(actionLabelIn(host), "Checking provider usage");
		assert.notEqual(
			CHECK_SENTENCE,
			actionLabelIn(host),
			"the announced sentence must not echo the button's label",
		);

		// The user's own ask gets its own sentence, on the same mounted region.
		await act(async () => {
			actionButtonIn(host).dispatchEvent(
				new dom.window.MouseEvent("click", { bubbles: true }),
			);
		});
		assert.equal(actionLabelIn(host), "Asking providers");
		assert.equal(
			regionText(),
			ASK_SENTENCE,
			"the ask announces itself in its own words",
		);

		// A plain re-render must not repeat it.
		const before = changes.length;
		await act(async () => {
			bump();
		});
		await act(async () => {
			bump();
		});
		assert.equal(
			changes.length,
			before,
			"a re-render of the same in-flight state must write nothing into the region",
		);
		assert.equal(regionText(), ASK_SENTENCE);

		// And it goes quiet once the read settles: nothing to announce.
		release();
		await act(async () => {
			await settle(60);
		});
		assert.equal(
			regionText(),
			"",
			"the region must be silent once the read settles",
		);
	} finally {
		watcher.disconnect();
		await act(async () => root.unmount());
		host.remove();
		client.clear();
	}
});

/**
 * Drive the shipped query options through the same cache/auto/ask transitions
 * as the container. The observer is what `useQuery` is built on, and its bridge
 * requests let these tests verify the mode contract alongside its state.
 */
async function openUsage(client, { hang = true, response } = {}) {
	let release;
	const observed = [];
	const answer = (request) => {
		if (!request.live)
			return { status: 200, body: { result: payload("cached") } };
		if (response) return response(request);
		return hang
			? new Promise((resolve) => {
					release = () =>
						resolve({ status: 200, body: { result: payload("live") } });
				})
			: Promise.reject(new Error("providers refused"));
	};
	respond = (request) => {
		observed.push(request);
		return answer(request);
	};

	const observer = new QueryObserver(
		client,
		usageQueryOptions(undefined, "cached"),
	);
	const unsubscribe = observer.subscribe(() => {});
	await settle();
	observer.setOptions(usageQueryOptions(undefined, "auto"));
	await settle(5);
	return {
		observer,
		unsubscribe,
		observed,
		release: () => release?.(),
		ask: (requestId) =>
			observer.setOptions(usageQueryOptions(undefined, "ask", requestId)),
	};
}

async function askLive(client, options) {
	const opened = await openUsage(client, options);
	opened.ask(1);
	await settle(5);
	return opened;
}

test("asking for live numbers keeps the cached table on screen", async () => {
	// `live` is part of the query key, so the ask starts a query with no cached
	// entry. Without `placeholderData` the body rendered the bare word
	// `Loading` and the tally vanished for the whole probe — a regression
	// against the TUI, which paints cached reports while the fetch runs behind
	// them (`UsagePanel.show_cached`).
	const client = newClient();

	const { observer, unsubscribe, release, observed } = await askLive(client);
	assertRequestModeCounts(observed, { cached: 1, auto: 1, ask: 1 });
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

	const { observer, unsubscribe, observed } = await askLive(client, {
		hang: false,
	});
	await settle(60);
	const state = observer.getCurrentResult();
	assertRequestModeCounts(observed, { cached: 1, auto: 1, ask: 1 });

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

test("each explicit ask gets a fresh query key", async () => {
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
	const { unsubscribe, ask, observed } = await openUsage(client, {
		response: async () => ({ status: 200, body: { result: payload("live") } }),
	});
	await settle(30);
	assertRequestModeCounts(observed, { cached: 1, auto: 1, ask: 0 });
	assert.equal(observed.at(-1).refresh, false);

	ask(1);
	await settle(30);
	assertRequestModeCounts(observed, { cached: 1, auto: 1, ask: 1 });
	assert.equal(observed.at(-1).refresh, true);
	ask(2);
	await settle(30);
	assertRequestModeCounts(observed, { cached: 1, auto: 1, ask: 2 });
	const last = observed[observed.length - 1];
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
	client.setQueryData(
		usageQueryOptions(undefined, "cached").queryKey,
		emptyPayload(),
	);
	const beforeRender = requests.length;
	const rendered = text(renderUsage(client));
	assert.equal(requests.length - beforeRender, 0);
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
	client.setQueryData(
		usageQueryOptions(undefined, "cached").queryKey,
		payload("cached"),
	);
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
	const options = usageQueryOptions(undefined, "ask", 1);
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
	const { observer, unsubscribe, observed } = await askLive(client, {
		hang: false,
	});
	await settle(60);
	const state = observer.getCurrentResult();
	assertRequestModeCounts(observed, { cached: 1, auto: 1, ask: 1 });

	assert.equal(state.isError, true, "the failed ask must reach an error state");
	assert.ok(
		state.errorUpdatedAt > 0,
		"the failure must be stamped, or no receipt can be derived from it",
	);
	assert.equal(state.fetchStatus, "idle", "nothing may still be in flight");
	// Exactly one attempt per ask: the retry contract, observed at the bridge
	// rather than read off the options.
	assertRequestModeCounts(observed, { cached: 1, auto: 1, ask: 1 });
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

	const { observer, unsubscribe, ask, observed } = await askLive(client, {
		hang: false,
	});
	await settle(60);
	assert.equal(observer.getCurrentResult().isError, true);
	assertRequestModeCounts(observed, { cached: 1, auto: 1, ask: 1 });

	const afterFailure = observed.length;
	// Re-enter ask mode with a new identity, as the button handler does.
	ask(2);
	await settle(60);

	assert.equal(observed.length - afterFailure, 1);
	assertRequestModeCounts(observed, { cached: 1, auto: 1, ask: 2 });
	const last = observed[observed.length - 1];
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

test("the in-flight label names the read that is out, and only that read", async () => {
	// Opening does a cache-aware check, not the user's forced ask. The label has
	// TWO in-flight arms and this view can only paint two: ask and check. It used
	// to carry a third, `Reading cached usage`, fed by a `checking` flag no wiring
	// could set — the container enters on the automatic check, so the arm was
	// unreachable and a committed frame photographed it anyway (design D1). The
	// flag and the arm are gone, and this asserts what replaced them: an in-flight
	// non-ask read reads as the check, and the settled states keep their verbs.
	//
	// The region is EMPTY in every render below, and that is a property of the
	// instrument rather than a gap: `renderToStaticMarkup` runs no effects, and
	// the sentence is written by an effect so that it is a CHANGE to a region
	// that already exists. The mount-level half lives in
	// `the polite region is mounted empty...` below.
	const automaticCheckMarkup = renderDialog({
		payload: payload("cached"),
		loading: false,
		fetching: true,
	});
	const automaticCheck = text(automaticCheckMarkup);
	assert.match(automaticCheck, /Checking provider usage/);
	assert.doesNotMatch(automaticCheck, /Asking providers/);
	assert.doesNotMatch(automaticCheck, /Reading cached usage/);
	assert.match(
		automaticCheckMarkup,
		/<output[^>]*aria-live="polite"[^>]*><\/output>/,
		"the region is mounted from the first paint and filled later, so a static render shows the empty node its sentence lands in",
	);
	assert.doesNotMatch(
		automaticCheckMarkup,
		/Getting fresh usage from providers\./,
	);

	const liveAskMarkup = renderDialog({
		payload: payload("cached"),
		loading: false,
		fetching: true,
		asked: true,
	});
	const liveAsk = text(liveAskMarkup);
	assert.match(liveAsk, /Asking providers/);
	assert.doesNotMatch(liveAsk, /Checking provider usage/);
	assert.match(
		liveAskMarkup,
		/<output[^>]*aria-live="polite"[^>]*><\/output>/,
		"and empty here too: the ask's sentence is an effect's work, not markup",
	);

	// Settled, both modes return the action to its imperative.
	assert.match(
		text(
			renderDialog({
				payload: payload("live"),
				loading: false,
				fetching: false,
			}),
		),
		/Ask providers now/,
	);
	assert.match(
		text(
			renderDialog({
				payload: payload("live"),
				loading: false,
				fetching: false,
				asked: true,
			}),
		),
		/Ask providers again/,
	);
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
