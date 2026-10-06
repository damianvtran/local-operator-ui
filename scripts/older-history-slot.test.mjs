import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { build } from "esbuild";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/*
 * The transcript reads its cross-session visibility through react-query
 * (`useCrossSessionHidden`), so even a server render needs a client in scope.
 * Nothing is seeded: in SSR the hooks resolve to their loading state, whose
 * fail-closed answer is "show everything".
 */
const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

/*
 * THE TRANSCRIPT'S TOP SLOT: the sentence it states, and the one action it
 * withholds (design round 1, D1 and D2 of the loader-continuity remediation).
 *
 * WHY THIS FILE EXISTS. Both claims are about what is ON SCREEN, and neither
 * had an executable check anywhere. The windowed sentence was photographed into
 * `docs/evidence/chat-older-history-slot/` and asserted by nothing, so the
 * review round found its number and its noun measuring different things in a
 * frame (D1). The transport rule was measured in a rig (`child-reader-scroll-
 * evidence.mjs`) while the WIRING that carries it — `olderTransportDown`, from
 * the pane that owns the session to the slot — was checked by nothing at all,
 * which is how a child pane went on offering a retry that could not succeed
 * (D2). The markup is what these assertions read, so a reworded sentence or a
 * dropped prop fails here rather than in the next frame set.
 *
 * D1: the windowed row states NO COUNT AND NO UNIT. It counted transcript ROWS
 * and called them "messages"; a run of ≥3 actions folds into one render line,
 * so most counted rows never paint as themselves (measured on this branch: the
 * row read `14 earlier messages above — scroll up to load` with six rows on
 * screen and the bar beneath it reading `225 actions`). The assertion below is
 * a DIGIT check rather than a sentence check on purpose: the copy is allowed to
 * move, the unit mismatch is not.
 *
 * D2: the slot drops its `Try again` while the transport is down, because a
 * retry that cannot work must not be painted beside the transcript's own
 * "Reconnecting" notice. The child reader's page is a read-only GET with no
 * stream of its own — its `status` is a static `"live"` — so the pane threads
 * the SESSION's status down instead. Both arms are asserted, so a default that
 * silently means "live" cannot come back.
 */

const bundle = await build({
	stdin: {
		contents: `export { OlderHistorySlot } from "./src/renderer/src/features/chat/canonical/older-history-slot";
export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";
export { EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The app's config loader reads `import.meta.env` at import time; an empty
	// object is the established stand-in (`backend-error-surfaces.test.mjs`).
	// This bundle needs it because its `stdin` entry re-exports
	// `CanonicalTranscript`, whose import graph reaches `@shared/config` through
	// the answer action row; the sibling bundles that stop short of that module
	// do not need it. Without the define this file dies at import, before a
	// single assertion runs, with `Cannot read properties of undefined`.
	define: { "import.meta.env": "{}" },
	jsx: "automatic",
	alias: {
		"@renderer": "./src/renderer/src",
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
		"@assets": "./src/renderer/src/assets",
	},
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
	},
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		/* One copy with the provider below; the hook inside the bundle must find
		 * the client the renders provide. */
		"@tanstack/react-query",
	],
});
const bundlePath = new URL("./_older-history-slot.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
let OlderHistorySlot;
let CanonicalTranscript;
let EMPTY_TRANSCRIPT;
try {
	({ OlderHistorySlot, CanonicalTranscript, EMPTY_TRANSCRIPT } = await import(
		bundlePath.href
	));
} finally {
	await unlink(bundlePath);
}

/** The rendered words, with the tags — and so the class names — taken out. */
const textOf = (html) => html.replace(/<[^>]*>/g, "").replaceAll("&#x27;", "'");

/*
 * The sentences these renders are about, hoisted to the top level: biome's
 * `useTopLevelRegex` is a gate here, and a named pattern is what makes an
 * assertion readable. Each one is a CLAIM, so two states sharing a pattern is
 * the difference between "the count is gone" and "the count moved".
 */
/** The windowed sentence, which D1 rewrote. */
const WINDOWED_FULL = /Earlier history above — scroll up to load/;
/** Its narrow-column spelling, which D1 did not have to move. */
const WINDOWED_SHORT = /Scroll up for earlier/;
/** The statement on its own: what the transport-down arm keeps. */
const WINDOWED_STATEMENT = /Earlier history above/;
/** The clause it drops, because a fetch cannot follow the local widen. */
const SCROLL_TO_LOAD = /scroll up to load/;
/** A count, in any unit — the shape D1 removed. */
const ANY_DIGIT = /\d/;
/** The unit the removed count was labelled with. */
const THE_MESSAGE_NOUN = /message/i;
/** The full sentence reachable where truncation would eat it. */
const WINDOWED_TITLE = /title="Earlier history above — scroll up to load"/;
/** The recoverable fault, and the action that must sit beside it. */
const FAILED_RECOVERABLE = /Could not load earlier messages/;
const RETRY_CONTROL = />Try again</;
/** The quiet one, which must carry no action. */
const FAILED_QUIET = /Earlier messages did not load/;
/** The end of history — the copy that may only be stated once PROVEN. */
const START_OF_CONVERSATION = /Start of conversation/;
/** The unproven end: the fact, in both spellings, and the action beside it. */
const UNPROVEN_FULL = /Earlier history not loaded/;
const UNPROVEN_SHORT = /Not loaded yet/;

/** The slot on its own, in one state, with the transport the caller claims. */
const slot = ({ state, transportDown = false, onRetryHydration }) =>
	renderToStaticMarkup(
		h(OlderHistorySlot, {
			state,
			transportDown,
			onLoadOlder: () => {},
			onRetryHydration,
		}),
	);

/**
 * One record, from the shape the reducer builds for a durable custom row.
 *
 * Any record that paints will do: what these renders are about is the SLOT
 * above the rows, and the row only has to exist for the slot to be mounted
 * (`transcript.records.length > 0`).
 */
const RECORD = {
	kind: "custom",
	id: "job-regression",
	ts: 1_760_000_000_000,
	customType: "job_result",
	level: "info",
	category: null,
	provider: null,
	headline: "background job 'slot-fixture' completed",
	text: "background job 'slot-fixture' completed: the row exists so the slot above it mounts.",
	attribution: "system",
	detail: null,
};

/**
 * The slot inside the REAL transcript, which is where the wiring lives.
 *
 * `hiddenRows` is zero for this transcript (one record, a sixty-row window), so
 * `olderFailed` alone decides the slot's state — which is what makes the two
 * arms below differ in exactly one thing, the transport.
 */
const transcriptRender = ({ status = "live", ...overrides } = {}) =>
	renderToStaticMarkup(
		h(
			QueryClientProvider,
			{ client: queryClient },
			h(CanonicalTranscript, {
				transcript: { ...EMPTY_TRANSCRIPT, records: [RECORD] },
				gate: null,
				waiting: false,
				loadingOlder: false,
				onLoadOlder: async () => true,
				containerRef: { current: null },
				isSmallView: false,
				status,
				failure: null,
				awaitingHydration: false,
				onReconnect: () => {},
				olderFailed: true,
				...overrides,
			}),
		),
	);

test("the windowed row names the history and the gesture, and states no count", () => {
	const html = slot({ state: "windowed" });
	const text = textOf(html);
	// The sentence, in both spellings: the full one and the narrow-column one.
	assert.match(text, WINDOWED_FULL);
	assert.match(text, WINDOWED_SHORT);
	// D1: no number, and no unit for one. The row counted ROWS as "messages".
	assert.equal(
		ANY_DIGIT.test(text),
		false,
		`the windowed row states a count: ${JSON.stringify(text)}`,
	);
	assert.equal(
		THE_MESSAGE_NOUN.test(text),
		false,
		`the windowed row names a unit the count never measured: ${JSON.stringify(text)}`,
	);
	// And the full sentence stays reachable where truncation would eat it.
	assert.match(
		html,
		WINDOWED_TITLE,
		"the truncated spelling loses the gesture without a title to recover it",
	);
});

test("the windowed row drops the gesture, not the statement, while the transport is down", () => {
	const text = textOf(slot({ state: "windowed", transportDown: true }));
	assert.match(text, WINDOWED_STATEMENT);
	assert.equal(
		SCROLL_TO_LOAD.test(text),
		false,
		"a fetch cannot follow the local widen while the transport is down",
	);
});

test("a failed page ask keeps the fault and the action, when the transport is up", () => {
	const html = slot({ state: "failed" });
	assert.match(textOf(html), FAILED_RECOVERABLE);
	assert.match(html, RETRY_CONTROL);
});

test("the same failure goes quiet and action-free while the transport is down", () => {
	const html = slot({ state: "failed", transportDown: true });
	assert.match(textOf(html), FAILED_QUIET);
	assert.equal(
		html.includes("Try again"),
		false,
		"a retry that cannot succeed must not be painted beside the transcript's own notice",
	);
});

test("the pane's transport reaches the slot, and the parent's status still does when it is not given", () => {
	/*
	 * The child reader's own shape: a static `"live"` status, from a page with no
	 * stream of its own, and the pane's transport threaded as `olderTransportDown`.
	 */
	const child = transcriptRender({ olderTransportDown: true });
	assert.match(textOf(child), FAILED_QUIET);
	assert.equal(
		child.includes("Try again"),
		false,
		"olderTransportDown must reach the slot: this is the child's failed row",
	);
	// The same failure with the pane's transport up: the recoverable composition,
	// which is the arm a default of "live" would have painted in both cases.
	const up = transcriptRender({});
	assert.match(textOf(up), FAILED_RECOVERABLE);
	assert.match(up, RETRY_CONTROL);
	// And the parent's own derivation is unchanged where nothing is threaded.
	const reconnecting = transcriptRender({ status: "reconnecting" });
	assert.match(textOf(reconnecting), FAILED_QUIET);
	assert.equal(reconnecting.includes("Try again"), false);
});

/*
 * THE HONEST END (remote-load-hydration). The slot's `unproven` arm exists so
 * that `has_more: false` from a read that never saw the conversation (a COLD
 * read's empty page; see the proof rule in `use-canonical-session.ts`'s walk)
 * can never render as "Start of conversation". These cases hold the two
 * directions apart at the rendered words — the transcript's own composition,
 * not a re-statement of the rule: unproven gets the fact and the retry, proven
 * gets the end copy, and the retry is dropped while a retry cannot succeed.
 */
test("an unproven end states not-loaded and offers the read again — never the end copy", () => {
	const html = transcriptRender({
		olderFailed: false,
		hydrationProven: false,
		onRetryHydration: () => {},
	});
	const text = textOf(html);
	assert.match(text, UNPROVEN_FULL);
	assert.match(text, UNPROVEN_SHORT);
	assert.match(html, RETRY_CONTROL, "the retry control must be operable");
	assert.equal(
		START_OF_CONVERSATION.test(text),
		false,
		`unproven hydration painted the end copy: ${JSON.stringify(text)}`,
	);
});

test("a proven end still states the start of the conversation", () => {
	const html = transcriptRender({ olderFailed: false, hydrationProven: true });
	const text = textOf(html);
	assert.match(text, START_OF_CONVERSATION);
	assert.equal(
		UNPROVEN_FULL.test(text),
		false,
		`a proven end must not paint the not-loaded copy: ${JSON.stringify(text)}`,
	);
});

test("the unproven row drops its retry while the transport is down", () => {
	const html = transcriptRender({
		olderFailed: false,
		hydrationProven: false,
		olderTransportDown: true,
		onRetryHydration: () => {},
	});
	assert.match(textOf(html), UNPROVEN_FULL);
	assert.equal(
		html.includes("Try again"),
		false,
		"a retry that cannot succeed must not be painted beside the transcript's own notice",
	);
});
