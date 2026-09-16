import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

/*
 * Exercise the shipped manager AND installed Sonner's actual auto-close effect,
 * not an adapter which invents Sonner's lifetime. No DOM/browser engine is
 * installed here: hooks collect first-mount effects and a clock runs timers.
 * Layout, hover and pixels remain the independent browser/design gate.
 * The test-only export exposes Sonner's private Toast without changing a byte
 * on disk; an upstream rename fails this test rather than silently modeling it.
 */
const require = createRequire(import.meta.url);
const sonnerPath = require.resolve("sonner").replace(/index\.js$/, "index.mjs");
const source = (path) =>
	readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const stories = source(
	"src/renderer/src/features/chat/components/canvas/canvas.stories.tsx",
);
const refusalStory = stories
	.split("export const VariablesWriteRefused: Story = {")[1]
	.split("export const ")[0];
const bundle = await build({
	stdin: {
		contents: `
			export { ThemedToastContainer } from "./src/renderer/src/shared/components/common/themed-toast-container";
			export { showErrorToast, resetToastDedup } from "./src/renderer/src/shared/utils/toast-manager";
			export { toast, __TestToast } from "sonner";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	jsx: "automatic",
	format: "cjs",
	platform: "node",
	write: false,
	plugins: [
		{
			name: "sonner-first-mount-clock",
			setup(builder) {
				builder.onResolve({ filter: /^sonner$/ }, () => ({ path: sonnerPath }));
				builder.onLoad({ filter: /sonner\/dist\/index\.mjs$/ }, ({ path }) => ({
					contents: `${readFileSync(path, "utf8")}\nexport { Toast as __TestToast };`,
					loader: "js",
				}));
				builder.onResolve(
					{ filter: /^react(?:-dom|\/jsx-runtime)?$/ },
					({ path }) => ({ path, namespace: "hooks" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "hooks" }, ({ path }) => ({
					contents:
						path === "react-dom"
							? "export default { flushSync: fn => fn() };"
							: `
						export const createElement = (type, props, ...children) => ({type, props: {...props, children}});
						export const jsx = (type, props) => ({type, props});
						export const jsxs = jsx;
						export const forwardRef = fn => fn;
						export const useState = initial => [typeof initial === "function" ? initial() : initial, () => {}];
						export const useRef = current => ({current});
						export const useMemo = fn => fn();
						export const useCallback = fn => fn;
						export const useEffect = fn => globalThis.effects.push(fn);
						export const useLayoutEffect = useEffect;
						export default {createElement, forwardRef, useState, useRef, useMemo, useCallback, useEffect, useLayoutEffect, isValidElement: value => Boolean(value?.type)};
					`,
					loader: "js",
				}));
			},
		},
	],
});

function fixture(duration) {
	let now = 10_000;
	let nextId = 0;
	const timers = new Map();
	const context = {
		module: { exports: {} },
		effects: [],
		Date: class extends Date {
			constructor(...args) {
				super(...(args.length ? args : [now]));
			}
			static now() {
				return now;
			}
		},
		setTimeout: (fn, delay) => {
			const id = ++nextId;
			timers.set(id, { fn, at: now + delay });
			return id;
		},
		clearTimeout: (id) => timers.delete(id),
	};
	runInNewContext(bundle.outputFiles[0].text, context);
	// Sonner's CSS injection is intentionally not mounted. Only its clock and
	// visibility input participate; false means no hidden-tab/hover timer pause.
	context.document = { hidden: false, addEventListener() {} };
	context.window = { removeEventListener() {} };
	const api = context.module.exports;
	const container = api.ThemedToastContainer({ duration });
	const removed = [];
	const id = api.showErrorToast("This name is reserved for the session.");
	const toast = api.toast.getToasts().find((entry) => entry.id === id);
	const props = {
		...container.props,
		toast,
		index: 0,
		visibleToasts: 3,
		heights: [],
		toasts: [toast],
		gap: 14,
		expanded: false,
		interacting: false,
		setHeights() {},
		removeToast: (item) => removed.push(item.id),
	};
	const element = api.__TestToast(props);
	assert.equal(element.props["data-sonner-toast"], "");
	for (const effect of context.effects) effect();
	return {
		api,
		container,
		removed,
		id,
		advance(ms) {
			const end = now + ms;
			while (true) {
				const due = [...timers]
					.filter(([, timer]) => timer.at <= end)
					.sort((a, b) => a[1].at - b[1].at)[0];
				if (!due) break;
				const [id, timer] = due;
				timers.delete(id);
				now = timer.at;
				timer.fn();
			}
			now = end;
		},
	};
}

const REFUSAL_MESSAGE = "This name is reserved for the session.";

test("production default reproduces the refusal gap despite two-second retries", () => {
	const f = fixture(undefined);
	assert.equal(f.container.props.duration, undefined);
	f.advance(2000);
	assert.equal(
		f.api.showErrorToast("This name is reserved for the session."),
		null,
	);
	f.advance(2000);
	assert.equal(
		f.api.showErrorToast("This name is reserved for the session."),
		null,
	);
	f.advance(500); // includes Sonner's real exit/unmount grace period
	assert.deepEqual(
		f.removed,
		[f.id],
		"default toast really expired before cooldown ended",
	);
});

test("refusal story keeps its one real toast beyond lifetime and cooldown without retries", () => {
	assert.match(
		refusalStory,
		/parameters: \{ toastDuration: Number\.POSITIVE_INFINITY \}/,
	);
	assert.doesNotMatch(refusalStory, /setInterval|keepAlive/);
	/*
	 * One write, and this is the assertion that keeps it one. The story clicks
	 * the panel's trigger and then its submit; a second submit is exactly the
	 * two-second replay round 3 removed, because it renews the toast instead of
	 * holding it and hides a submit that never settles. Read off the click
	 * calls rather than off a fixed expression, so the waits around them (the
	 * panel's readiness, and the settlement the story now asserts) can be
	 * written out in full without this pin going stale.
	 */
	assert.equal(
		(refusalStory.match(/userEvent\.click\(/g) ?? []).length,
		2,
		"the panel trigger and its one submit, never a replay",
	);
	assert.equal(
		(refusalStory.match(/userEvent\.click\(submit\)/g) ?? []).length,
		1,
		"the submit is the one write this story drives",
	);
	assert.match(
		source(".storybook/preview.tsx"),
		/duration=\{context\.parameters\.toastDuration\}/,
	);
	const f = fixture(Number.POSITIVE_INFINITY);
	assert.equal(f.container.props.duration, Number.POSITIVE_INFINITY);
	for (const delay of [4500, 2000, 60_000]) {
		f.advance(delay);
		assert.deepEqual(
			f.removed,
			[],
			"delayed capture must still have its toast",
		);
		assert.equal(
			f.api.toast.getToasts().length,
			1,
			"one refusal, no repeated fake writes",
		);
	}
});

/*
 * Agent review round 4, C-11. An infinity toast is never dismissed and never
 * auto-closes, so an unmount is not a dismissal: sonner's list goes away with
 * the Toaster while `toast-manager`'s deduplication key does not, and the next
 * mount of the same refusal is handed the spent id instead of a toast. These
 * two tests pin the defect and the story's teardown.
 *
 * What the harness models is the manager and sonner's publication stream -
 * `getHistory()` is where every published toast lands, so its length is this
 * fixture's publication count, the quantity the review measured as
 * "publications=0" and "publications=1". A remounting Toaster's own (empty)
 * list is not modelled, because the defect is decided before it is consulted.
 */
test("a remount without the story's teardown is handed the spent refusal, and nothing is published", () => {
	const f = fixture(Number.POSITIVE_INFINITY);
	// Past both the cooldown and the count window: what still holds the key is
	// the held toast itself, not either clock.
	f.advance(60_000);
	const published = f.api.toast.getHistory().length;
	assert.equal(f.api.showErrorToast(REFUSAL_MESSAGE), f.id);
	assert.equal(
		f.api.toast.getHistory().length,
		published,
		"the remount published nothing, so its story has no refusal on screen",
	);
});

test("the story's teardown releases the toast and the dedup key, so a remount publishes again", () => {
	// Wired in the story, not merely available: the test above is only fixed if
	// the fixture really calls this when it unmounts. The teardown component is
	// declared above the story it belongs to, so it is asserted on the file and
	// the story is asserted to use it.
	assert.match(stories, /toast\.dismiss\(\)/);
	assert.match(stories, /resetToastDedup\(\)/);
	assert.match(refusalStory, /<RefusalFixture>/);
	const f = fixture(Number.POSITIVE_INFINITY);
	f.advance(60_000);
	const published = f.api.toast.getHistory().length;
	// The story's own teardown, in the story's own order.
	f.api.toast.dismiss();
	f.api.resetToastDedup();
	const again = f.api.showErrorToast(REFUSAL_MESSAGE);
	assert.ok(
		again,
		"the remedy must not suppress the toast it exists to restore",
	);
	assert.notEqual(again, f.id);
	assert.equal(
		f.api.toast.getHistory().length,
		published + 1,
		"a second mount's refusal really is published",
	);
});

/*
 * Design round 4, D1. The fixture's React Query environment is a decision, and
 * this pins the source half of it: the client is built from the policy the app
 * ships rather than React Query's defaults, and the rig states the focus fact
 * production always has (a capture tab is a background tab, and
 * `retryer.canContinue` - the only thing that lifts a paused mutation - reads
 * `focusManager`). The behavioural half is driven in
 * `scripts/storybook-query-fixture.test.mjs`.
 */
test("the fixture constructs the app's query policy and states the rig's focus fact", () => {
	const preview = source(".storybook/preview.tsx");
	assert.match(preview, /focusManager\.setFocused\(true\)/);
	assert.match(
		preview,
		/new QueryClient\(\{ defaultOptions: defaultQueryOptions \}\)/,
	);
	assert.doesNotMatch(
		preview,
		/new QueryClient\(\);/,
		"React Query's defaults are not the app's policy",
	);
});

/*
 * The transport family, one rung below the lifetime question.
 *
 * WHY THIS IS HERE. `showErrorToast` has ~50 call sites and most of them hand
 * it `error.message` from a failed `fetch`, so the toast is where a raw
 * transport string used to reach a person. The manager already mapped six
 * verbatim strings to one connection sentence - and one of those six was
 * `net::ERR_CONNECTION_REFUSED`, which is a member of a family of ~50 codes
 * having reached a toast before this. The manager now asks the shared
 * classifier (`src/shared/transport-failure.ts`, the same module MAIN retries
 * the update check against) instead of carrying a table only one of these
 * strings wide.
 *
 * The sentences are read from the toasts Sonner actually holds rather than
 * from a spy, so what is asserted is what the container would render.
 */
const titleOf = (api, id) =>
	api.toast.getToasts().find((entry) => entry.id === id)?.title;

/*
 * One message, one sentence, with the dedup released first.
 *
 * The manager's dedup is a user-facing policy keyed by error GROUP, so two
 * different messages that both say "Failed to fetch" share a key and the second
 * is suppressed - correct in the app, where they are the same refusal seen
 * twice, and noise in a case that is asking what each message WOULD say.
 */
const sentenceFor = (f, message) => {
	f.api.resetToastDedup();
	return titleOf(f.api, f.api.showErrorToast(message));
};

test("a raw transport failure is never the sentence on a toast", () => {
	const f = fixture(undefined);

	// The old table exactly: still mapped, and still mapped to the same words.
	assert.equal(
		sentenceFor(f, "Failed to fetch"),
		"Could not reach the server. Check that it is running, then try again.",
	);

	/*
	 * The member of the family the table did NOT hold, and the one the
	 * operator's update log holds 36 times. It reached a toast as-is before
	 * this change.
	 */
	assert.equal(
		sentenceFor(f, "net::ERR_NETWORK_CHANGED"),
		"Could not reach the server. Check that it is running, then try again.",
	);

	/*
	 * An errno form embedded in machine vocabulary: the sentence takes the whole
	 * message rather than being spliced into the middle of "getaddrinfo ...
	 * pypi.org", which would read worse than the code it replaced.
	 */
	assert.equal(
		sentenceFor(f, "getaddrinfo ENOTFOUND pypi.org"),
		"Could not reach the server. Check that it is running, then try again.",
	);
});

test("an authored prefix survives; only the transport fragment is replaced", () => {
	const f = fixture(undefined);

	assert.equal(
		sentenceFor(f, "Failed to post comment: Failed to fetch"),
		"Failed to post comment: Could not reach the server. Check that it is running, then try again.",
	);

	/*
	 * And the counter-case the exact-match rule existed for: this is a sentence
	 * someone wrote on purpose, where the engine's words are part of what it
	 * says. A transport string inside prose is not a clause, so the message is
	 * left exactly as the caller passed it.
	 */
	assert.equal(
		sentenceFor(f, "Failed to fetch conversation messages"),
		"Failed to fetch conversation messages",
	);
});

test("dedup still keys off what the caller passed", () => {
	const f = fixture(undefined);

	const first = f.api.showErrorToast("net::ERR_TIMED_OUT");
	assert.ok(first);
	// The same failure inside the cooldown is suppressed, and it is suppressed
	// under the caller's own string rather than under the sentence.
	assert.equal(f.api.showErrorToast("net::ERR_TIMED_OUT"), null);
	// A different code is a different failure and still gets its toast.
	assert.equal(
		sentenceFor(f, "net::ERR_CONNECTION_RESET"),
		"Could not reach the server. Check that it is running, then try again.",
	);
});
