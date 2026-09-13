import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The composer's readings row: what a DRAFT renders, and the layout contract
 * that keeps the four readings in one row without clipping any of them.
 *
 * `session-status.test.mjs` owns the strip's ARITHMETIC (three ports and the
 * payloads a real backend sent); nothing pinned what the strip renders when
 * there is no session yet, which is the state the operator reported as empty.
 * These are rendered-markup assertions because that is where the defects are:
 * a chip that renders as a control with nothing to open, a cost chip on a pane
 * that has spent nothing, and a truncation that would turn `≥$0.0…` into a
 * false claim. None of those are visible to a test over the model functions.
 *
 * Rendering with `renderToStaticMarkup`, against the shipped component with
 * the app's own aliases, on a payload shaped like the one
 * `POST /v1/desktop/sessions/preview` answers with (a `CanonicalFrontendSync`
 * whose `snapshot.session_id` is empty). A story shows the same thing to a
 * person; this fails the build when the markup changes under it.
 *
 * The row half is asserted on the SOURCE, because the composer cannot be
 * rendered in isolation: `MessageInput` needs a message list, a dispatcher and
 * the canonical store. The layout, the placement and the auto-margin rule are
 * class strings on two elements, so the source is the accurate instrument —
 * the same argument `canonical-chat.test.mjs` makes for the slash popup's
 * ancestors. The rendered geometry itself is measured in the live frames.
 */

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			import { renderToStaticMarkup } from "react-dom/server";
			import { SessionStatusStrip } from "./src/renderer/src/features/chat/session-status/session-status-strip";
			export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";

			export const renderStrip = (props) =>
				renderToStaticMarkup(createElement(SessionStatusStrip, props));
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
	// React stays external so the bundle shares ONE copy with this file's own
	// imports. Two copies give the component a different React than the server
	// renderer uses, and every render throws on an invalid hook call.
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
});

// Written to a real file rather than imported as a data: URL: React DOM's
// server build resolves its own CJS entry at import time, which a data: URL
// has no base path for.
const bundlePath = new URL("./_composer-readings.bundle.mjs", import.meta.url);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { renderStrip, desktopEndpoint, desktopRequestSchema } = await import(
	bundlePath.href
);
await unlink(bundlePath);

/** The rendered text a user reads, with markup and layout whitespace removed. */
function text(html) {
	return html
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** One element's class list, found by an attribute marker on the same tag. */
function stripRootClasses(html) {
	const match = html.match(
		/<div class="([^"]*)"[^>]*data-lo-session-strip="true"/,
	);
	assert.ok(match, "no element carries `data-lo-session-strip`");
	return match[1].split(/\s+/);
}

const UUID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

/**
 * A model spec with a four-rung ladder, i.e. a draft on this machine's config.
 * Copied from `session-status.test.mjs`'s capture fixtures: the same spec a
 * real backend sent, so the draft frame is not a shape nobody has.
 */
const GPT_5 = {
	provider: "openrouter",
	model_id: "openai/gpt-5",
	display_name: "OpenAI: GPT-5",
	reasoning: true,
	reasoning_effort: "high",
	reasoning_efforts: ["minimal", "low", "medium", "high"],
	reasoning_default_effort: null,
	context_window: 400_000,
	max_context_window: null,
};

/** A draft's payload: identity and window known, nothing measured, no spend. */
const DRAFT = {
	effective_model: GPT_5,
	selected_model: null,
	context_tokens: null,
	context_window: 400_000,
	context_is_estimate: null,
	cumulative_parent_cost: null,
	cost_knowledge: "unknown",
};

/**
 * The class list a reading's own box carries.
 *
 * Matched on the reading's `aria-label`, so the assertion is about the element
 * a screen reader is told about rather than about the Nth button in the row —
 * which is what moved in this change.
 */
function readingClasses(html, labelPrefix) {
	const match = html.match(
		new RegExp(
			`<button[^>]*aria-label="(${labelPrefix}[^"]*)"[^>]*class="([^"]*)"`,
		),
	);
	assert.ok(
		match,
		`no reading renders an aria-label starting \`${labelPrefix}\``,
	);
	return { label: match[1], classes: match[2].split(/\s+/) };
}

/* ---- 1. the draft renders three inert readings ------------------------- */

test("a draft mounts the strip inline, with the model as a label and an empty ring", () => {
	const html = renderStrip({ frontend: DRAFT, draft: true });

	// The QA/E2E hook and the row's identity: one node, in the row, told it is a
	// draft rather than inferring it.
	assert.match(html, /data-lo-session-strip="true"/);
	assert.match(html, /data-lo-session-strip-draft="true"/);

	// Inline above 750px of column, where it sits immediately after the
	// working-directory chip with the row's free space falling before the
	// controls; first-on-its-own-line below it, by DOM position rather than by
	// `order-first`, so the wrapped tab order matches the painted order.
	const root = stripRootClasses(html);
	assert.ok(root.includes("flex-wrap"), "the cluster must wrap internally");
	assert.ok(root.includes("min-w-0"), "the cluster must be allowed to shrink");
	assert.ok(root.includes("basis-full"));
	assert.ok(
		!root.some((c) => c.startsWith("order-first")),
		"the cluster must take the first line by DOM position, not by `order-first`",
	);
	assert.ok(
		!root.some((c) => /(^|:)ml-auto$/.test(c)),
		"the cluster carries NO auto margin at any width: the controls own the row's single one",
	);
	assert.ok(root.includes("@min-[750px]/chatcol:order-2"));
	assert.ok(root.includes("@min-[750px]/chatcol:basis-auto"));
	assert.ok(
		root.includes("@min-[750px]/chatcol:flex-nowrap"),
		"above the threshold the cluster must not wrap: the name truncates first",
	);

	// The model is a LABEL: a real button with `aria-disabled`, focusable so the
	// tooltip stays reachable, no hover step that would advertise an action.
	const model = readingClasses(html, "Model:");
	assert.ok(
		/<button type="button" aria-disabled="true" aria-label="Model:/.test(html),
		"the draft's model reading must render as the label form, not as a control",
	);
	assert.ok(model.classes.includes("cursor-default"));
	assert.ok(!model.classes.includes("cursor-pointer"));
	assert.ok(
		!model.classes.includes("hover:bg-accent-wash"),
		"an inert reading must not light up under the pointer",
	);
	assert.match(model.label, /The first message will use it\./);
	assert.doesNotMatch(model.label, /Choose a different model/);

	// Effort is shown because the spec carries a ladder, in the same inert form.
	const effort = readingClasses(html, "Reasoning effort:");
	assert.match(
		effort.label,
		/^Reasoning effort: high\. Set once the conversation starts\.$/,
	);

	// Context: an empty ring, and a sentence rather than a number. A percentage,
	// a token count or a `$` here would all be claims about a session that does
	// not exist.
	const context = readingClasses(html, "Context:");
	assert.match(context.label, /^Context: nothing measured yet\./);
	assert.doesNotMatch(html, /\d+(\.\d+)?%/);
	assert.doesNotMatch(html, /\$/);
	assert.match(html, /<svg/);

	// And the draft is labelled as one: the sentences live in the tooltips and the
	// `aria-label`s, which is where a static render carries them (Radix mounts a
	// tooltip's content only when it opens, deliberately — see `Tooltip`).
	assert.match(
		html,
		/aria-label="Reasoning effort: high\. Set once the conversation starts\."/,
	);
});

/* ---- 1b. a draft shows effort only where a ladder exists ---------------- */

/**
 * The spec `sessions.preview` actually returns, copied from the live frame.
 *
 * The preview route skips the account-metadata step a cold open runs, so the
 * model arrives as a selector with NO metadata: an empty name, `reasoning:
 * false`, an empty ladder. `specUnresolved` is the test for exactly that shape
 * (an empty ladder NEXT TO an empty name is a snapshot nobody has told, not a
 * model with nothing to tell), and it sends `effortState` down its
 * `metadataAbsent` branch, whose label is the word `unknown`.
 */
const PREVIEW_SPEC = {
	...GPT_5,
	display_name: "",
	reasoning: false,
	reasoning_effort: null,
	reasoning_efforts: [],
};

test("a draft with an unresolved spec renders no effort reading, so the first turn adds no chip that shifts one", () => {
	// Measured live (UX round 1, U1): the draft showed `unknown` and the first
	// turn replaced it with `auto`, sliding the model chip and the ring beside
	// it 21.6px. R19 renders a draft's effort only where the spec carries a
	// ladder, and this spec carries none - so the reading is ABSENT, which is
	// this strip's own honest rule for "no level to show here".
	const html = renderStrip({
		frontend: { ...DRAFT, effective_model: PREVIEW_SPEC },
		draft: true,
	});

	assert.doesNotMatch(html, /Reasoning effort:/);
	assert.doesNotMatch(html, /unknown/);
	assert.doesNotMatch(html, /Set once the conversation starts/);
	// The other two readings are unaffected: the draft still shows the identity
	// the first turn will use and an empty ring.
	assert.match(html, /aria-label="Model: /);
	assert.match(html, /aria-label="Context: /);
});

test("a session with the same unresolved spec keeps `unknown`, because there the ladder can still be found", () => {
	// The same metadata-absent spec on a session with a live owner: `unknown` is
	// the honest label there (the chip opens the picker, which asks the owner and
	// resolves the ladder), and the draft rule must not leak into it.
	const html = renderStrip({
		frontend: {
			...DRAFT,
			effective_model: PREVIEW_SPEC,
			context_tokens: 12_977,
		},
	});

	assert.match(html, /aria-label="Reasoning effort: unknown\./);
});

test("a draft without a resolved model renders nothing, never a row of dashes", () => {
	const html = renderStrip({
		frontend: { ...DRAFT, effective_model: null, context_window: null },
		draft: true,
	});
	assert.equal(html, "");
});

/* ---- 2. D3: an inert reading never advertises a control ---------------- */

test("an inert reading states its reason instead of naming a control it cannot open", () => {
	// The other way to have nothing to open: a live session on a backend whose
	// command surface is off (`onCommand === undefined`). The line used to be the
	// same constant in both states — "Click to choose a different model" — which
	// is the D3 defect, and the context reading had the same shape ("Click for
	// the full breakdown").
	const inert = renderStrip({
		frontend: {
			...DRAFT,
			context_tokens: 12_977,
			context_is_estimate: false,
			cumulative_parent_cost: 2.1,
			cost_knowledge: "floor",
		},
	});
	assert.doesNotMatch(inert, /choose a different model/i);
	assert.doesNotMatch(inert, /open the context breakdown/i);
	assert.doesNotMatch(inert, /for the full breakdown/i);
	assert.match(inert, /Slash commands are off on this server/);
	// The readings themselves are unaffected: this is a copy defect, not a
	// rendering one.
	assert.match(
		inert,
		/aria-label="Reasoning effort: high\. Slash commands are off/,
	);
	assert.match(text(inert), /3\.2%\/400k/);
});

test("a session with a dispatcher keeps the copy that names its controls", () => {
	// The other half of the fix: the actionable state must NOT have been
	// weakened while the inert one was corrected.
	const live = renderStrip({
		frontend: {
			...DRAFT,
			context_tokens: 12_977,
			context_is_estimate: false,
			cumulative_parent_cost: 2.1,
			cost_knowledge: "floor",
		},
		onCommand: () => undefined,
	});
	assert.match(live, /Click to choose a different model/);
	assert.match(live, /Change it\./);
	assert.match(live, /for the full breakdown/);
	assert.doesNotMatch(live, /Slash commands are off/);
});

/* ---- 3. the 220px column contract -------------------------------------- */

test("below 750px the value readings neither truncate nor collapse, and only the name does", () => {
	const html = renderStrip({
		frontend: {
			...DRAFT,
			effective_model: {
				...GPT_5,
				display_name: "",
				model_id: "moonshotai/kimi-k2-instruct-0905-preview-long-context",
			},
			context_tokens: 352_000,
			context_is_estimate: true,
			cumulative_parent_cost: 4.02,
			cost_knowledge: "floor",
		},
		onCommand: () => undefined,
	});

	// Exactly ONE truncation in the whole cluster. `≥$0.0…` or `52.5%/40…` would
	// be false or unverifiable (§ 8), and the wheel's arc is a second channel for
	// a number the tooltip states in full.
	assert.equal(
		html.match(/truncate/g)?.length ?? 0,
		1,
		"only the model NAME may truncate",
	);

	// The name keeps its floor, so a truncated name still names something.
	const model = readingClasses(html, "Model:");
	assert.ok(model.classes.includes("min-w-14"));
	assert.ok(model.classes.includes("shrink"));
	assert.ok(model.classes.includes("max-w-full"));

	// The three value readings are whole, with their marks and denominators.
	const shown = text(html);
	assert.match(shown, /88\.0%\/400k/);
	assert.match(shown, /estimate/);
	assert.match(shown, /≥\$4\.02/);
});

/* ---- 4. the composer row ------------------------------------------------- */

/**
 * The row's three children, in DOM order, as `{ name, classes }`.
 *
 * Parsed out of the JSX rather than matched as literal strings because the
 * properties that matter are structural: WHO carries the auto margin, WHICH
 * slot the cluster occupies, and whether either depends on a sibling that can
 * return `null`. The previous version of this test asserted two class strings
 * and passed in exactly the broken state it was written to prevent - zero live
 * margins once the cluster is absent (code review round 1, MINOR 5).
 */
function rowChildren(composer) {
	const rowAt = composer.indexOf(
		'className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2',
	);
	assert.ok(rowAt > 0, "the row container is not where this test expects it");
	const row = composer.slice(rowAt);

	const clusterAt = row.indexOf("<SessionStatusStrip");
	const leftAt = row.indexOf("<DirectoryIndicator");
	const controlsAt = row.indexOf("Right side: microphone, send or stop");
	assert.ok(clusterAt > 0 && leftAt > 0 && controlsAt > 0);
	assert.ok(
		clusterAt < leftAt && leftAt < controlsAt,
		"the cluster's DOM slot must be first, so the wrapped order and the tab order agree",
	);

	// The error boundary wraps the strip (a crash must not take the composer
	// down), which is what makes the cluster the nullable child.
	assert.match(
		composer,
		/<ErrorBoundary fallback=\{null\}>\s*<SessionStatusStrip/,
	);

	return {
		rowClasses: composer
			.slice(rowAt, composer.indexOf(">", rowAt))
			.match(/className="([^"]*)"/)[1]
			.split(/\s+/),
		controlsClasses: row
			.slice(row.indexOf("<div", controlsAt))
			.match(/className="([^"]*)"/)[1]
			.split(/\s+/),
	};
}

test("the row right-justifies its controls whether or not the readings render", () => {
	const composer = readFileSync(
		"src/renderer/src/features/chat/components/message-input.tsx",
		"utf8",
	);
	const { rowClasses, controlsClasses } = rowChildren(composer);
	const strip = readFileSync(
		"src/renderer/src/features/chat/session-status/session-status-strip.tsx",
		"utf8",
	);

	// ONE node, ONE place, for every state.
	assert.equal(
		composer.match(/<SessionStatusStrip/g)?.length,
		1,
		"the strip must render once; a second render is a second layout to keep in step",
	);

	// THE BLOCKER: the auto margin is on the group that always renders. `ml-auto`
	// alone - not `ml-auto` plus a threshold override that hands it to a child
	// which can return `null`. Three ordinary states null the cluster (no
	// `frontend` yet, nothing known, the error boundary's empty fallback), and in
	// those states a margin owned by the cluster leaves the row with NONE: the
	// controls sat flush against the directory chip (round 1, BLOCKER 1).
	assert.ok(
		controlsClasses.includes("ml-auto"),
		"the controls group must carry the row's auto margin",
	);
	assert.ok(
		!controlsClasses.some((c) => c.includes("chatcol:ml-")),
		"the controls' margin must not be conditional on the cluster's presence",
	);
	assert.ok(
		!stripHasAutoMargin(strip),
		"the cluster must carry NO auto margin: two live margins share the free space and float it mid-row",
	);

	// The row itself: wrapping below the threshold is what gives the cluster its
	// own line, and `flex-nowrap` above it is what stops a long name pushing the
	// controls down instead of truncating.
	assert.ok(rowClasses.includes("flex-wrap"));
	assert.ok(rowClasses.includes("@min-[750px]/chatcol:flex-nowrap"));

	// The cluster is the row's first line below the threshold, and the second
	// child above it (`order-2`, with the controls last at `order-3`) - which is
	// only coherent because the DOM slot is first.
	assert.match(
		strip,
		/basis-full @min-\[750px\]\/chatcol:order-2/,
		"the cluster must take the first line below 750 and follow the chip above it",
	);
	assert.ok(controlsClasses.includes("@min-[750px]/chatcol:order-3"));
});

/**
 * Whether the strip's root carries an auto margin, at any width.
 *
 * The cluster's classes are one long string two thirds of the way down the
 * file; the property is "no `ml-auto` and no `chatcol:ml-auto` anywhere in it",
 * which is what this reads.
 */
/**
 * Whether the cluster claims the row's free space at ANY width.
 *
 * The property, not one literal: `ml-auto`, `ms-auto`, `mx-auto` and a
 * container-scoped `@min-[750px]/chatcol:ml-auto` all do the same thing to the
 * row, and round 1's blocker shipped precisely because the test named one
 * string. Anything that resolves to an automatic inline-start margin counts,
 * whatever variant carries it.
 */
function stripHasAutoMargin(strip) {
	const root = strip.match(/"basis-full[^"]*"/);
	assert.ok(
		root,
		"the strip's root class list is not where this test expects it",
	);
	return /(^|\s|:)(ml|ms|mx)-auto/.test(root[0]);
}

test("the inline layout is a PAIRING, and neither half works alone", () => {
	// `display: contents` on the button line and `order-2`/`order-3` on the
	// cluster and controls are one mechanism with two halves: the wrapper exists
	// so the narrow row keeps its button line on ONE line, and it must dissolve
	// above the threshold or the cluster would sit inside it instead of between
	// the chip and the controls. Deleting either half inverts the inline layout
	// while every rendering test stays green, because the strip's own markup is
	// unchanged - so the pairing is asserted where it lives.
	const composer = readFileSync(
		"src/renderer/src/features/chat/components/message-input.tsx",
		"utf8",
	);
	const strip = readFileSync(
		"src/renderer/src/features/chat/session-status/session-status-strip.tsx",
		"utf8",
	);

	const wrapper = composer.match(
		/<div className="([^"]*@min-\[750px\]\/chatcol:contents[^"]*)">/,
	);
	assert.ok(wrapper, "the button line's wrapper must exist");
	// Below the threshold it IS a flex item and must not wrap internally: that
	// is what makes "the second line" mean one line rather than three.
	assert.match(wrapper[1], /\bflex\b/);
	assert.match(wrapper[1], /\bflex-nowrap\b/);
	assert.match(wrapper[1], /\bw-full\b/);
	assert.match(wrapper[1], /\bmin-w-0\b/);

	// The other half: with the wrapper dissolved, order is what restores the
	// painted sequence [attach][chip] [readings] [mic][send] out of a DOM whose
	// first child is the cluster.
	assert.match(strip, /@min-\[750px\]\/chatcol:order-2/);
	assert.match(composer, /@min-\[750px\]\/chatcol:order-3/);

	// And the left group holds its width above the threshold. Without this the
	// chip's own `shrink-0` (which makes the NAME truncate first) let the group
	// close around it, and the path painted across the readings - visible only
	// in a frame, because `row.overflowX` reads 0 when the group fits and its
	// child does not (code review round 2).
	assert.match(composer, /@min-\[750px\]\/chatcol:shrink-0/);
});

// The draft's payload reaches the STRIP and nothing else. Asserted on the
// source because `SessionPanel` cannot be rendered in isolation (it needs the
// router, the canonical stream and the store), and the claim is structural:
// every read of the preview's payload is the strip's prop, so it cannot have
// been written into the canonical sessions store, whose rows are sessions.
test("the preview payload never enters the canonical store", () => {
	const page = readFileSync(
		"src/renderer/src/features/chat/components/chat-page.tsx",
		"utf8",
	);
	const reads = [...page.matchAll(/preview\.data/g)];
	assert.ok(reads.length > 0, "the preview payload is not read at all");
	for (const read of reads) {
		const rest = page.slice(read.index + "preview.data".length);
		assert.ok(
			rest.startsWith(".frontend.snapshot,") || /^\s*\n\s*\?/.test(rest),
			`the preview payload is used as \`preview.data${rest.slice(0, 24)}\`; it belongs to the strip only`,
		);
	}
	// And nothing hands it to a store action: the canonical store's rows are
	// sessions, and a preview has no session behind it.
	assert.doesNotMatch(page, /useCanonicalSessionsStore[\s\S]{0,240}preview/);
	// Told it is a draft, so the copy can say why nothing opens (R22).
	assert.match(page, /draft: true,/);
});

/* ---- 5. the control contract -------------------------------------------- */

test("sessions.preview routes to its own POST, with create's body and a closed schema", () => {
	assert.deepEqual(
		desktopEndpoint({
			op: "sessions.preview",
			requestId: UUID,
			cwd: "/tmp/example",
			target: { kind: "agent", name: "reviewer" },
		}),
		{
			path: "/v1/desktop/sessions/preview",
			method: "POST",
			body: {
				request_id: UUID,
				cwd: "/tmp/example",
				target: { kind: "agent", name: "reviewer" },
			},
		},
	);
	// No target is legal: a plain new chat is bound to nothing.
	assert.deepEqual(
		desktopEndpoint({ op: "sessions.preview", requestId: UUID, cwd: "/tmp" })
			.body,
		{ request_id: UUID, cwd: "/tmp" },
	);

	const ok = desktopRequestSchema.safeParse({
		op: "sessions.preview",
		requestId: UUID,
		cwd: "/tmp",
	});
	assert.equal(ok.success, true);
	// A draft with no settled directory has nothing to preview, and the backend
	// requires 1..4096 characters: the schema refuses rather than sending.
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "sessions.preview",
			requestId: UUID,
			cwd: "",
		}).success,
		false,
	);
	// The receipt key is not optional: an unkeyed request is not a request this
	// vocabulary can describe.
	assert.equal(
		desktopRequestSchema.safeParse({ op: "sessions.preview", cwd: "/tmp" })
			.success,
		false,
	);
	// Closed: the renderer selects an operation, it never smuggles a field.
	assert.equal(
		desktopRequestSchema.safeParse({
			op: "sessions.preview",
			requestId: UUID,
			cwd: "/tmp",
			sessionId: "aaaaaaaaaaaa",
		}).success,
		false,
	);
});

/* ---- 5. the duration reading -------------------------------------------- */

test("the duration port spells what the band spells, bounded at six cells", async () => {
	// The port's contract is the Python function's domain, so the cases are the
	// ones `format_duration`'s own docstring names, plus the boundaries that
	// decide a branch. A number this app prints in two places has to be the same
	// number in both, which is the whole reason it is a port.
	const { formatDuration } = await import(
		"../src/renderer/src/features/chat/session-status/session-duration.ts"
	);

	const cases = [
		[0, "0s"],
		// Sub-second WORK renders 0s rather than vanishing: a finished turn
		// always leaves a mark. (Whether a turn happened at all is the reading's
		// question, not the formatter's - see the guard test below.)
		[0.4, "0s"],
		[9, "9s"],
		[59, "59s"],
		[60, "1m"],
		// A whole minute drops its seconds; a partial one keeps them.
		[300, "5m"],
		[2461, "41m1s"],
		[3599, "59m59s"],
		[3600, "1h"],
		[3720, "1h2m"],
		[86_399, "23h59m"],
		[86_400, "1d"],
		[363_600, "4d5h"],
		[8_639_999, "99d23h"],
		// The cap names the bound it fired at: `99d+` would read as the duration
		// having got SMALLER one minute after `99d23h`.
		[8_640_000, "100d+"],
	];
	for (const [input, expected] of cases)
		assert.equal(formatDuration(input), expected, `${input}s`);

	// The six-cell bound is a CONTRACT, not an accident of the cases above: the
	// reading is never truncated, and that is only affordable because the widest
	// string is known. Swept across the whole domain rather than asserted on the
	// three known-widest strings, so a new branch cannot quietly exceed it.
	for (let s = 0; s < 400 * 86_400; s += 997)
		assert.ok(
			formatDuration(s).length <= 6,
			`${s}s renders ${formatDuration(s)}, which is wider than six cells`,
		);
});

test("a session that has done nothing renders no duration, and a running one always does", async () => {
	const { durationReading } = await import(
		"../src/renderer/src/features/chat/session-status/session-duration.ts"
	);

	// Nothing banked and nothing running: no reading. `0s` would claim a turn
	// completed in under a second, which is the claim `$0.00` makes about a
	// session that has spent nothing (R19, D21). This is also exactly a DRAFT's
	// input, which is why the draft needs no branch of its own.
	assert.equal(durationReading(0, null), null);
	assert.equal(durationReading(null, null), null);
	assert.equal(durationReading(undefined, undefined), null);

	// Banked, not running: the frozen truth and NO timer.
	assert.deepEqual(durationReading(41, null), { banked: 41, startedAt: null });

	// Running at zero banked seconds is never null: work is happening, and the
	// reading appearing as the first turn starts is the point.
	const live = durationReading(0, 1_760_000_000);
	assert.ok(live);
	assert.equal(live.banked, 0);
	// The wire carries epoch SECONDS; every clock in this app is Date.now()-based.
	assert.equal(live.startedAt, 1_760_000_000_000);
});

test("a draft renders four fewer claims than a running session: no cost, no duration", () => {
	// The two ends of D21 in one assertion, because they are one rule: a surface
	// with nothing to report reports nothing, rather than reporting a zero.
	const draft = renderStrip({
		frontend: { ...DRAFT, active_duration_s: 0, activity_started_at: null },
		draft: true,
	});
	assert.doesNotMatch(draft, /Active time:/);
	assert.doesNotMatch(draft, /aria-label="Spend/);

	// The same strip on a session that HAS run carries both.
	const ran = renderStrip({
		frontend: {
			...DRAFT,
			context_tokens: 15_200,
			cumulative_parent_cost: 0.0603,
			cost_knowledge: "floor",
			active_duration_s: 2461,
			activity_started_at: null,
		},
	});
	// D17 spells the label and the tooltip differently on purpose: the label is
	// spoken in one breath on every focus, the tooltip is read at leisure.
	assert.match(
		ran,
		/aria-label="Active time: 41m1s\. Time spent working; waiting is not counted\."/,
	);
	// Inert, and a readout rather than a disabled button: it opens nothing, so
	// there is no control for `aria-disabled` to describe as unavailable.
	assert.doesNotMatch(ran, /aria-label="Active time[^"]*"[^>]*aria-disabled/);
});

test("duration is the only reading that may be shed, and only between the two thresholds", () => {
	const strip = readFileSync(
		"src/renderer/src/features/chat/session-status/session-status-strip.tsx",
		"utf8",
	);

	// The shed is a container-range query: a single `@max` would hide it at the
	// wrapped widths too, where the cluster owns its own line and has room for
	// it (D20 rung 3). `hidden`, not `sr-only` - a shed reading does not exist,
	// unlike the chip's icon-only text, which is still readable by a screen
	// reader.
	assert.match(
		strip,
		/className="@min-\[750px\]\/chatcol:@max-\[860px\]\/chatcol:hidden"/,
		"duration must drop only in the band between the wrap threshold and the width where five readings fit",
	);
	assert.doesNotMatch(strip, /@max-\[860px\]\/chatcol:sr-only/);

	// And it is the ONLY one: the other four are protected by R8/R14, so a
	// `hidden` anywhere else in this file is a reading being dropped that the
	// design says must never drop.
	assert.equal(
		strip.match(/chatcol:hidden/g)?.length,
		1,
		"only the duration reading may be shed",
	);
});

test("the value readings hold their width; only the model name yields", () => {
	const strip = readFileSync(
		"src/renderer/src/features/chat/session-status/session-status-strip.tsx",
		"utf8",
	);

	// D10: the value readings kept the default shrink, so a long model name
	// squeezed them below their content and their glyphs overlapped - `high` cut
	// mid-word, `66.0%/400k` and `≥$2.41` drawn on top of each other, at 750 AND
	// 900. A clipped figure is a false one, so the shared box refuses to shrink
	// and the name opts back in as the single item allowed to yield.
	assert.match(
		strip,
		/const READING_BOX =\s*\n?\s*"[^"]*\bshrink-0\b/,
		"every reading box must refuse to shrink by default",
	);
	// The override is on the MODEL reading and nowhere else: `shrink` (not
	// `shrink-0`) appears exactly once in the file, in the model's className.
	const shrinkOverrides = strip.match(/"min-w-14 max-w-full shrink"/g) ?? [];
	assert.equal(
		shrinkOverrides.length,
		1,
		"exactly one reading may opt back into shrinking, and it is the name",
	);
});
