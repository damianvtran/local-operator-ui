/*
 * The Storybook fixture's React Query environment, driven rather than read.
 *
 * Design round 4 (D1) measured, in a real browser, a refusal story whose single
 * write never settled: the dialog sat on `Saving…` for minutes, the toast region
 * stayed empty, no field sentence appeared and no rejection was logged. The wire
 * was fine - `desktopResult` rejects the same 409 envelope - so the fault was in
 * the fixture's own React/React Query layer, and it was invisible to every
 * fixture in this suite.
 *
 * This drives that layer directly, with the modules the app ships and the story's
 * own 409 answer: `defaultQueryOptions` (the policy `query-client.ts` exports for
 * exactly this purpose) and `createSessionVariable`. Two properties of the
 * fixture's environment decide the outcome, and both are stated here rather than
 * assumed:
 *
 *   - `networkMode`: the app ships `always`, React Query's default is `online`,
 *     and an `online` mutation is parked - without the request even being issued
 *     - while `onlineManager` reports offline;
 *   - focus: the only thing that lifts a paused mutation is
 *     `retryer.canContinue` = `focusManager.isFocused() && (networkMode ===
 *     "always" || online)`, and `isFocused()` is `document.visibilityState !==
 *     "hidden"`. A capture tab is a background tab by construction (UX round 4,
 *     M1), so it reads unfocused while the app's own `mutations.retry: 1` retries
 *     every refusal after a one-second sleep that checks exactly that condition.
 *
 * A parked mutation is the whole defect: `onError` never runs, so the hook's
 * toast never appears, and the caller's `await onSubmit(...)` never returns, so
 * the dialog's own catch - the sentence beside the Name field - never runs
 * either.
 *
 * What this does NOT model, and what therefore remains the browser's to prove:
 * React's rendering, Storybook's decorator re-renders, and pixels. This is the
 * same bounded shape as the other fixture tests here - the environment is real,
 * the surface is not.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `
			export { createSessionVariable } from "./src/renderer/src/shared/api/local-operator/session-variables-api";
			export { defaultQueryOptions } from "./src/renderer/src/shared/api/query-client";
			export { QueryClient, focusManager, onlineManager } from "@tanstack/react-query";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	external: ["react", "react-dom", "sonner"],
});
/*
 * A data URL rather than a scratch file: this suite runs from several
 * worktrees at once and a temp module on disk is one more thing a killed run
 * leaves behind.
 */
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const { QueryClient, focusManager, onlineManager } = mod;

/** Every desktop op the fixture issues, in order. */
let ops = [];
globalThis.window = {};
globalThis.fetch = async (_input, init) => {
	ops.push(JSON.parse(String(init?.body ?? "{}")).op);
	// The story's own `write` answer: HTTP 200 carrying a 409 envelope, which is
	// the shape both real transports return and what `desktopResult` rejects on.
	return new Response(
		JSON.stringify({
			status: 409,
			body: {
				detail: {
					code: "reserved_name",
					message: "'secrets' is a name the session keeps for its own tools.",
				},
			},
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);
};

/**
 * Drive `useCreateSessionVariable`'s mutation under one environment.
 *
 * The options are the hook's own, verbatim - no explicit `retry` or
 * `networkMode`, so the client's policy decides, which is the difference under
 * test - and the client is mounted, because that is what wires the focus and
 * online subscriptions that are supposed to resume a parked mutation.
 */
const drive = async ({ shipped, offline, focused, healAfterMs }) => {
	ops = [];
	focusManager.setFocused(focused);
	onlineManager.setOnline(!offline);
	const client = new QueryClient(
		shipped ? { defaultOptions: mod.defaultQueryOptions } : undefined,
	);
	client.mount();
	const mutation = client.getMutationCache().build(client, {
		mutationFn: ({ sessionId, ...write }) =>
			mod.createSessionVariable(sessionId, write),
		onError: () => {},
		onSettled: async (_data, _error, variables) => {
			await client.invalidateQueries({
				queryKey: ["desktop", "sessions", variables.sessionId, "variables"],
			});
		},
	});

	let settled = false;
	const finished = mutation
		.execute({
			sessionId: "8fd6c6a40934",
			key: "secrets",
			value: "",
			type: "str",
		})
		.then(
			() => {
				settled = true;
			},
			() => {
				settled = true;
			},
		);
	/*
	 * The blip heals: the browser fires `online` again while the tab is still
	 * hidden, which is what a fixture actually saw. The subscriptions are given
	 * a real tick to act on it.
	 */
	let healed = null;
	if (healAfterMs) {
		healed = new Promise((resolve) =>
			setTimeout(() => {
				onlineManager.setOnline(true);
				resolve();
			}, healAfterMs),
		);
	}
	await Promise.race([
		finished,
		new Promise((resolve) => setTimeout(resolve, 2000)),
	]);
	if (healed) await healed;
	// A mutation resumed by the heal can still be mid-flight: give the two round
	// trips it needs (the refusal, then the policy's own retry) real time.
	const deadline = Date.now() + 2000;
	while (!settled && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	client.unmount();
	return { settled, ops, status: mutation.state.status };
};

test("a refused write settles through the fixture's policy in a hidden tab (D1)", async () => {
	const result = await drive({
		shipped: true,
		offline: true,
		// What the fixture states at import time: the one environment fact the
		// capture rig cannot provide and a production window always has.
		focused: true,
	});
	assert.equal(
		result.settled,
		true,
		`the refusal must settle, not park (status ${result.status}, ops ${result.ops.join(",")})`,
	);
	/*
	 * Two ops, and that is the point of constructing the policy rather than
	 * approximating it: the app ships `mutations.retry: 1`, so a refused write
	 * really is attempted twice before the user is told. A fixture that dropped
	 * the retry would photograph a state the app does not produce.
	 */
	assert.deepEqual(result.ops, [
		"sessions.variables.create",
		"sessions.variables.create",
	]);
});

test("the bare client the fixture used to build parks the refusal, and a healed blip does not free it (D1)", async () => {
	const result = await drive({
		shipped: false,
		offline: true,
		focused: false,
		healAfterMs: 100,
	});
	assert.equal(
		result.settled,
		false,
		"React Query's own defaults are what parked it, so this is the regression's control",
	);
	assert.deepEqual(
		result.ops,
		[],
		"parked before the request: the fixture never even reached its own stub",
	);
	assert.equal(result.status, "pending");
});
