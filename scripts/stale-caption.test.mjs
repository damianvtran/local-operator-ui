import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The cached-paint caption, asserted as RENDERED MARKUP.
 *
 * WHY THIS FILE EXISTS (design review round 2, D10). Hoisting the caption out of
 * the scroll box so it survives a transcript taller than its pane (D1) left the
 * old in-scroll paragraph behind, so a cached paint rendered the same sentence
 * twice on every short pane: once pinned to the pane's top edge, once
 * immediately above the first bubble. A long transcript hid the second copy above
 * the fold — which is exactly why the overflowing fixture passed while the
 * ordinary and narrow ones regressed, and why "the frames look right" was not
 * evidence about this.
 *
 * A COUNT is the assertion, because the defect was a duplicate rather than a
 * wrong string: `markup.match(/the caption/g).length === 1`. It is rendered from
 * the SHIPPED `CanonicalTranscript` with `renderToStaticMarkup` — no jsdom, the
 * same instrument `ask-options.test.mjs` uses for the answer card — so it fails
 * on the component that ships rather than on a transcription of it, and it needs
 * no browser: the duplication is in the element tree, not in a scroll position.
 *
 * THE PLACEMENT CHANGED (cached rows paint at once, 2026-11-10). The caption was
 * hoisted ABOVE the scroller so a tall transcript could not scroll it off screen
 * (D1), and that row's removal when the page landed grew the scroller by its own
 * height, moving the conversation in front of the reader. It now lives in the
 * FOOT slot - the row reserved at the newest edge of the scroller, mounted for
 * every conversation with rows - so its arrival and removal move nothing. The
 * second case pins that placement: the caption is INSIDE the foot slot, and
 * the foot slot is mounted for the stale pane. The third pins the older-history
 * box, which is reserved (empty, hidden from assistive technology) while the
 * paint is cached for the same reason. A cached paint always has rows - the
 * cache never stores an empty transcript - so the fixture carries rows.
 */

const bundle = await build({
	stdin: {
		contents: [
			'export { CanonicalTranscript } from "./src/renderer/src/features/chat/canonical/canonical-transcript";',
		].join("\n"),
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	mainFields: ["module", "main"],
	conditions: ["import"],
	// The renderer's aliases are tsconfig paths, not node resolutions.
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	// Stylesheets carry no assertion here and Node cannot import them.
	loader: { ".css": "empty" },
	jsx: "automatic",
	// React stays EXTERNAL so the bundle shares ONE copy with this file's own
	// imports — two copies give the component a different dispatcher than the
	// server renderer and every render throws on an invalid hook call.
	/*
	 * The renderer's `import.meta.env`, which these bundles did not need until the
	 * canonical transcript's answer action row read the speech credential probe
	 * (`@shared/hooks/use-credentials` -> `@shared/config`): `loadConfig` runs
	 * `Object.entries(import.meta.env)` at module scope, so without this define the
	 * bundle throws `Cannot convert undefined or null to object` at import time and
	 * the whole file fails before a test runs. `{}` is what `shared-composer.test.mjs`
	 * bakes for the same reason: nothing here reads a VITE_ variable.
	 */
	define: { "import.meta.env": "{}" },
	external: [
		"react",
		"react-dom",
		"react-dom/server",
		"react/jsx-runtime",
		/* One copy with the provider the renders wrap in; the hook inside the
		 * bundle must find the client. */
		"@tanstack/react-query",
	],
});

const bundlePath = new URL("./_stale-caption.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);
/*
 * The transcript reads its cross-session visibility through react-query; in a
 * server render the hooks resolve to their loading state, whose fail-closed
 * answer is "show everything". The provider is external to the bundle so this
 * client and the `useQuery` inside it are one copy.
 */
const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});
const { CanonicalTranscript } = await import(bundlePath.href);
// Unlinked as soon as the graph is evaluated, so no build artifact survives a
// crash mid-run and none can be committed by accident — the same rule, and the
// same reason, as `ask-options.test.mjs`.
await unlink(bundlePath);

/*
 * The cached paint's words since 2026-11-11: the shared conversation-loading
 * indicator's `revalidating` label, which replaced the faint caption ("Showing
 * the last saved view — checking for newer messages.") the operator reported as
 * easy to miss and not reading as loading.
 */
const CAPTION = "Checking for new messages…";

const TS = 1_760_000_000_000;
const RECORDS = [
	{
		kind: "user",
		id: "user:1",
		ts: TS,
		text: "Which invoices were late last month?",
		images: [],
	},
	{
		kind: "assistant",
		id: "answer:1",
		ts: TS,
		text: "Four invoices were late: 1042, 1088, 1103 and 1177.",
		streaming: false,
		stopReason: null,
		error: false,
	},
];
const TRANSCRIPT = {
	records: RECORDS,
	index: new Map(RECORDS.map((record, position) => [record.id, position])),
	generation: 1,
	oldestId: null,
	hasMore: false,
	argsByCall: new Map(),
};

/**
 * The pane in the state under test.
 *
 * `hydrated: true` so the pane is not holding its placeholder (the caption and
 * the loading state are different claims), and `missing: false` so the
 * conversation-gone branch, which replaces the whole status block, is not the
 * one taken.
 */
function renderPane({
	stale,
	missing = false,
	remote = false,
	records = RECORDS,
	awaitingHydration = false,
	hydrationProven = true,
}) {
	return renderToStaticMarkup(
		createElement(
			QueryClientProvider,
			{ client: queryClient },
			createElement(CanonicalTranscript, {
				transcript: { ...TRANSCRIPT, records },
				gate: null,
				waiting: false,
				loadingOlder: false,
				onLoadOlder: async () => true,
				containerRef: { current: null },
				isSmallView: false,
				status: "live",
				hydrated: true,
				stale,
				missing,
				remote,
				awaitingHydration,
				hydrationProven,
				error: null,
				onAnswer: () => {},
			}),
		),
	);
}

const count = (markup) => markup.split(CAPTION).length - 1;

test("a cached paint states the caption exactly once", () => {
	const markup = renderPane({ stale: true });
	assert.equal(
		count(markup),
		1,
		"the caption is rendered twice: the hoisted copy and the legacy in-scroll one (design round 2, D10)",
	);
});

test("an authoritative paint states no caption at all", () => {
	// The control, so the count above is a fact about the duplication rather than
	// about the string happening to appear once for another reason.
	assert.equal(count(renderPane({ stale: false })), 0);
});

const FOOT_WITH_CAPTION = new RegExp(
	`data-lo-transcript-foot="true"[^>]*>\\s*<div data-lo-stale-caption="true"><output[^>]*data-lo-conversation-loading="revalidating"[^>]*>[\\s\\S]*?${CAPTION}</span></output></div>`,
);

test("the caption sits in the foot slot, the row reserved for the working line", () => {
	// The placement that moves nothing: the foot slot exists for every
	// conversation with rows, so the caption's removal changes what is IN it and
	// never where anything is. A caption moved back above the scroller would be a
	// row that exists only while the paint is cached, and its removal would move
	// the conversation (33.4px, measured on the cached-paint rig arm).
	const stale = renderPane({ stale: true });
	assert.match(
		stale,
		FOOT_WITH_CAPTION,
		"the caption is the foot slot's content",
	);
	const settled = renderPane({ stale: false });
	assert.ok(
		settled.includes('data-lo-transcript-foot="true"'),
		"the foot slot is still mounted once the page has landed",
	);
	assert.equal(
		settled.includes("data-lo-stale-caption"),
		false,
		"and it is empty of the caption",
	);
});

test("the caption is the shared loading indicator, set in the reading face", () => {
	// A sentence about state is not machine output: the foot slot's own
	// `font-mono` (the working line's voice) is overridden on the indicator, and
	// the label takes the status register's size at `ink-muted` - one step above
	// the `ink-dim` the faint caption sat at.
	const markup = renderPane({ stale: true });
	const tag =
		markup.match(
			/<output[^>]*data-lo-conversation-loading="revalidating"[^>]*>/,
		)?.[0] ?? "";
	assert.match(
		tag,
		/font-sans/,
		"the indicator overrides the foot slot's monospace",
	);
	// A live region, but not one named "Loading conversation": the rows under it
	// are already readable (code review round 1, C3).
	assert.equal(
		tag.includes("aria-label"),
		false,
		"the revalidating region is not named as a load",
	);
	assert.match(
		markup,
		/data-lo-loading-mark="true"[^>]*><span aria-hidden="true" class="[^"]*animate-spin/,
		"the spinner, not a presence-style dot (design review round 1, D-M1)",
	);
	const label =
		markup.match(
			new RegExp(
				`<span data-lo-loading-pill="true" class="([^"]*)">${CAPTION}</span>`,
			),
		)?.[1] ?? "";
	assert.match(label, /bg-accent\/10/, "on its translucent accent pill");
	assert.doesNotMatch(
		label,
		/(^| )(py|pt|pb|p|h|min-h)-/,
		"the pill adds no height to the reserved row",
	);
	assert.match(label, /text-meta/, "the status register's size");
	assert.match(
		label,
		/text-ink-muted/,
		"at the secondary-text ink, not ink-dim",
	);
	assert.match(label, /truncate/, "and one line, inside the reserved row");
	assert.equal(markup.includes(`text-ink-dim text-meta">${CAPTION}`), false);
});

test("a peer's cached paint says it is syncing from the other device", () => {
	const markup = renderPane({
		stale: true,
		remote: true,
		hydrationProven: false,
	});
	assert.match(
		markup,
		/data-lo-stale-caption="true"><output[^>]*data-lo-conversation-loading="remote"/,
	);
	assert.ok(markup.includes("Syncing from your other device…"));
	assert.equal(count(markup), 0, "one label per state, not both");
});

test("a cold open renders the same indicator where the rows will land", () => {
	// No rows and a page owed: the pane holds the indicator in the content
	// column (`transcriptPaneHoldsPlaceholder`), and for a peer's conversation it
	// names the sync instead.
	const cold = renderPane({
		stale: false,
		records: [],
		awaitingHydration: true,
	});
	assert.match(cold, /<output[^>]*data-lo-conversation-loading="cold"/);
	assert.ok(cold.includes("Loading conversation…"));
	const remote = renderPane({
		stale: false,
		records: [],
		awaitingHydration: true,
		remote: true,
		hydrationProven: false,
	});
	assert.match(remote, /<output[^>]*data-lo-conversation-loading="remote"/);
	assert.ok(remote.includes("Syncing from your other device…"));
});

/*
 * The settings-filter hold, armed the way a real window arms it: a persisted
 * `display.hide_cross_session: true` seed and a settings answer still owed (a
 * server render never resolves the query). The hold is LOCAL - the pane is
 * waiting on this window's own settings read - so it is a sync only when the
 * peer conversation's history is also unproven (code review round 1, C2).
 */
function renderFilterHeld(props) {
	const previous = globalThis.localStorage;
	const seed = JSON.stringify({ "display.hide_cross_session": true });
	globalThis.localStorage = {
		getItem: (key) => (key === "display-settings" ? seed : null),
		setItem: () => {},
		removeItem: () => {},
	};
	try {
		return renderPane({ stale: false, ...props });
	} finally {
		globalThis.localStorage = previous;
	}
}

test("a local filter hold over a peer's proven history says loading, not syncing", () => {
	const proven = renderFilterHeld({ remote: true, hydrationProven: true });
	// The control that the hold is what is rendering: rows withheld, the cold
	// slot standing in for them.
	assert.match(proven, /<output[^>]*data-lo-conversation-loading="cold"/);
	assert.equal(proven.includes(RECORDS[1].text), false, "rows are withheld");
	assert.ok(proven.includes("Loading conversation…"));
	assert.equal(proven.includes("Syncing from your other device…"), false);
	const unproven = renderFilterHeld({ remote: true, hydrationProven: false });
	assert.match(unproven, /<output[^>]*data-lo-conversation-loading="remote"/);
	assert.ok(unproven.includes("Syncing from your other device…"));
});

test("a peer's cached paint over proven history is a revalidation, not a sync", () => {
	const markup = renderPane({
		stale: true,
		remote: true,
		hydrationProven: true,
	});
	assert.match(
		markup,
		/data-lo-stale-caption="true"><output[^>]*data-lo-conversation-loading="revalidating"/,
	);
	assert.equal(markup.includes("Syncing from your other device…"), false);
});

const RESERVE = /aria-hidden="true" class="@container\/olderhistory /;

test("the older-history box is reserved, empty, while the paint is cached", () => {
	// The real slot reads `exhausted` over a cache entry (its rows are trimmed and
	// carry no paging cursor) and would say "Start of conversation" over a
	// transcript that may be a thousand messages in, so it is withheld; but
	// withholding its BOX moved the conversation by 44px when the page landed.
	const stale = renderPane({ stale: true });
	assert.match(
		stale,
		RESERVE,
		"the box is mounted, hidden from assistive technology",
	);
	assert.equal(
		stale.includes("Start of conversation"),
		false,
		"and it states nothing",
	);
	assert.equal(
		RESERVE.test(renderPane({ stale: false })),
		false,
		"the authoritative pane mounts the real slot, not the reserve",
	);
});
