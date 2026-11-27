import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * Composer readings: what a DRAFT renders, the inline strip's width ladder,
 * and how the dock mounts the strip separately from the editor controls.
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
			export { LAST_READING_NOTE, readingsDroppedNote, fastModeOnNote } from "./src/renderer/src/features/chat/session-status/session-status-strip";
			export { desktopEndpoint, desktopRequestSchema } from "./src/shared/desktop-contract";
			// Bundled, not imported natively: the port now spells its units through
			// the shared i18n layer, whose \`@shared\` alias Node cannot resolve.
			export {
				durationReading,
				formatDuration as formatSessionDuration,
			} from "./src/renderer/src/features/chat/session-status/session-duration";

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
const {
	renderStrip,
	LAST_READING_NOTE,
	readingsDroppedNote,
	fastModeOnNote,
	desktopEndpoint,
	desktopRequestSchema,
	durationReading,
	formatSessionDuration,
} = await import(bundlePath.href);
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
 * The same pane with a resolution that named NO model — the one state design
 * D3's "Choose a model" entry is for, and the state UX U3 separated from a
 * resolution that has not answered yet (or never will).
 */
const DRAFT_NO_MODEL = {
	...DRAFT,
	effective_model: null,
	selected_model: null,
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

	// INLINE AT EVERY WIDTH, immediately after the working-directory chip with the
	// row's free space falling before the controls (design round 2, D21: §G1's
	// single 32px control row). The cluster used to take the row's first line with
	// `basis-full` below 750px of COLUMN and give it back above, and both halves of
	// that are gone - so what this pins is the ABSENCE of a width-conditional shape,
	// because a reintroduced breakpoint is how the second row comes back.
	const root = stripRootClasses(html);
	assert.ok(root.includes("min-w-0"), "the cluster must be allowed to shrink");
	assert.ok(
		root.includes("flex-nowrap"),
		"the cluster must never wrap internally; only the name yields",
	);
	assert.ok(
		!root.includes("basis-full"),
		"the cluster must not claim a line of its own: the control row is one line at every width",
	);
	assert.ok(
		!root.some((c) => c.includes("chatcol:")),
		"the cluster's shape must not depend on the column's width (§G1)",
	);
	assert.ok(
		!root.some((c) => c.startsWith("order-first")),
		"the cluster must take its slot by DOM position, not by `order-first`",
	);
	assert.ok(
		!root.some((c) => /(^|:)ml-auto$/.test(c)),
		"the cluster carries NO auto margin: the controls own the row's single one",
	);
	assert.ok(
		root.includes("order-2"),
		"`order-2` is what puts the cluster between the chip and the controls in the paint",
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
		!model.classes.some((name) => name.startsWith("hover:bg-")),
		"an inert reading must not light up under the pointer",
	);
	assert.match(model.label, /This conversation will use it\./);
	assert.doesNotMatch(model.label, /Choose a different model/);

	// Effort is shown because the spec carries a ladder, in the same inert form.
	const effort = readingClasses(html, "Reasoning effort:");
	assert.match(
		effort.label,
		/^Reasoning effort: High\. Set once the conversation starts\.$/,
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
		/aria-label="Reasoning effort: High\. Set once the conversation starts\."/,
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

test("a draft without a resolved model renders nothing where the backend cannot select for it", () => {
	const html = renderStrip({
		frontend: { ...DRAFT, effective_model: null, context_window: null },
		draft: true,
	});
	assert.equal(html, "");
});

test("a draft without a resolved model offers the pick, where it used to render nothing", () => {
	// Design D3, and the operator's own report in its empty form: a pane whose
	// resolution named no model showed nothing at all, so there was no way to give
	// the first message one. With the capability it renders the ONE control that
	// fixes it, in the position the value lands in once a pick resolves (R23).
	const html = renderStrip({
		frontend: { ...DRAFT, effective_model: null, context_window: null },
		draft: true,
		onOpenDraftPicker: () => undefined,
	});
	assert.match(
		html,
		/<button type="button" aria-label="Model: none resolved yet\. Choose the model this conversation will run on\."/,
	);
	assert.match(text(html), /Choose a model/);
	assert.doesNotMatch(
		html,
		/<button type="button" aria-disabled="true" aria-label="Model:/,
		"the model chip must not keep the unavailable-button form where it can open",
	);
	// The chip is the CONTROL form — it takes the pointer and carries the hover
	// step — rather than the inert label the same reading wears without the
	// capability. The tooltip panel is rendered on focus and so is not in the
	// static markup; the accessible name carries the same sentence, and
	// `--draft-actionable-tooltip` is the frame that photographs the panel.
	assert.match(
		html,
		/<button type="button" aria-label="Model: none resolved yet[^"]*"[^>]*cursor-pointer[^>]*hover:bg-ink\/6[^>]*>\s*<span class="truncate">Choose a model<\/span>/,
	);
	// The empty ring is a draft's own, unchanged, and stays inert beside it.
	assert.match(html, /aria-label="Context: nothing measured yet/);
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
		/aria-label="Reasoning effort: High\. Slash commands are off/,
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

/* ---- 2b. the draft's chips are actionable where the backend can honour one - */

/**
 * The same draft, on a backend that CAN birth a conversation on a choice.
 *
 * `onOpenDraftPicker` is the whole capability: the strip is told nothing else,
 * because a draft's chip needs no session id, no command and no second list —
 * it opens the same two pickers a session's readings open, against the pane's
 * own selection. What changes here is the AFFORDANCE and the copy, and only on
 * the two readings that have something to open.
 */
test("a draft whose backend selects exposes model and effort as CONTROLS, in the session's voice", () => {
	const html = renderStrip({
		frontend: DRAFT,
		draft: true,
		onOpenDraftPicker: () => undefined,
	});

	// THE MODEL: a real control, not the label form. No `aria-disabled`, so a
	// screen reader is not told the chip is unavailable while it opens a dialog.
	//
	// The scope clause is UX U2's: the chip keeps the control's sentence, and says
	// what the control can affect. Before it, the only place a draft's scope was
	// ever stated was the dialog's subtitle, so a pane whose pick is
	// first-message-only stopped saying so the moment it could be picked - and the
	// user's question ("did that change my default?") had no answer on screen.
	assert.match(
		html,
		/<button type="button" aria-label="Model: openrouter\/openai\/gpt-5\. Click to choose a different model\. It applies to this conversation\."/,
	);
	assert.doesNotMatch(
		html,
		/<button type="button" aria-disabled="true" aria-label="Model: /,
		"the model reading must not keep the unavailable-button form where it can open",
	);

	// THE EFFORT: offered because this spec carries a ladder, and the sentence is
	// the control's - the same one a session's effort chip carries - one step
	// earlier, with the same U2 scope clause after it.
	assert.match(
		html,
		/<button type="button" aria-label="Reasoning effort: High\. Change it\. It applies to this conversation\."/,
	);

	// The sentences a draft may no longer say where the chip CAN open (R21/R8 of
	// the design): the old reason is a claim that the model cannot be chosen yet.
	assert.doesNotMatch(text(html), /Change it once the conversation starts/);
	assert.doesNotMatch(text(html), /Set once the conversation starts/);
	assert.doesNotMatch(text(html), /Slash commands are off/);

	// THE CONTEXT stays what it is: nothing has been measured, so there is no
	// breakdown to open and no control to offer — the inert label form, which
	// stays focusable so its explanation is reachable.
	assert.match(
		html,
		/<button type="button" aria-disabled="true" aria-label="Context: /,
	);
});

test("the draft keeps its fact-plus-reason copy wherever a chip cannot open", () => {
	// The other half of the gate: same pane, no capability. Nothing gained an
	// affordance it cannot honour, and every sentence still states the fact and
	// the reason rather than naming a control.
	const html = renderStrip({ frontend: DRAFT, draft: true });
	assert.match(
		html,
		/<button type="button" aria-disabled="true" aria-label="Model: openrouter\/openai\/gpt-5\. This conversation will use it\. Change it once the conversation starts\."/,
	);
	assert.match(
		html,
		/<button type="button" aria-disabled="true" aria-label="Reasoning effort: High\. Set once the conversation starts\."/,
	);
	assert.doesNotMatch(text(html), /Click to choose a different model/);
	assert.doesNotMatch(text(html), /Change it\./);
});

/* ---- 2c. the draft's resolution is a STATE, not an absence ---------------- */

/*
 * UX U3: `chooseModel` is `!identity && draftOpen`, which is true in three
 * different situations the render used to treat as one - the resolution is still
 * in flight, it failed, and the backend genuinely resolved a spec that names no
 * model. Only the third is a question for the user. These three cases pin the
 * split, and the middle one pins that a failed resolution is RECOVERABLE, which
 * it was not: the query is `retry: false`, and before this the whole cluster was
 * suppressed, so nothing on the pane ever asked again.
 */
test("a draft whose resolution is still in flight says so instead of offering a choice", () => {
	const html = renderStrip({
		frontend: null,
		draft: true,
		onOpenDraftPicker: () => undefined,
		draftResolution: { status: "pending" },
	});
	assert.doesNotMatch(
		html,
		/Choose a model/,
		"a resolution that has not happened is not a resolution that named nothing",
	);
	assert.match(
		html,
		/Resolving the model/,
		"the pending reading is on the pane",
	);
	assert.match(
		html,
		/aria-label="Model: resolving the model this conversation will run on\."/,
		"and it is announced as the question, not the answer",
	);
	// The app's own waiting treatment, not a bare sentence: this is the same
	// spinner the session's switching chip carries.
	assert.match(html, /role="status"/);
	assert.match(
		html,
		/<button type="button" aria-disabled="true" aria-label="Model: resolving/,
		"nothing can be opened while the resolution is in flight, and the control says so",
	);
});

test("a failed resolution offers the retry nothing else on the pane would", () => {
	const html = renderStrip({
		frontend: null,
		draft: true,
		onOpenDraftPicker: () => undefined,
		draftResolution: { status: "failed", retry: () => undefined },
	});
	assert.doesNotMatch(html, /Choose a model/);
	assert.match(html, /Retry/);
	// React escapes the apostrophe in its text projection, hence the alternation.
	assert.match(
		html,
		/<button type="button" aria-label="Model: this conversation(?:&#x27;|')s model was not resolved\. Retry\."/,
		"the failure is a control, because `retry: false` means nothing else will ask",
	);
	assert.doesNotMatch(html, /role="status"/, "nothing is in flight any more");
});

test("the resolved-no-model state keeps its own control", () => {
	// The regression pin for the split: design D3's entry is still there for the
	// one state it was written for.
	const html = renderStrip({
		frontend: DRAFT_NO_MODEL,
		draft: true,
		onOpenDraftPicker: () => undefined,
	});
	assert.match(html, /Choose a model/);
	assert.doesNotMatch(html, /Retrying|Resolving the model/);
});

test("the pane's resolution state is wired to the strip, not merely supported by it", () => {
	/*
	 * The component renders these states only when it is handed one, and the strip
	 * is rendered with each prop spelled out — so a missing forwarding line makes
	 * the whole pending/failure treatment dead code while every render test above
	 * stays green. The pane is the source, the composer is the only strip caller.
	 */
	const page = readFileSync(
		"src/renderer/src/features/chat/components/chat-page.tsx",
		"utf8",
	);
	const composer = readFileSync(
		"src/renderer/src/shared/components/composer/message-input.tsx",
		"utf8",
	);
	assert.match(
		page,
		/draftResolution: DraftResolution \| undefined = draftPreviewOn/,
		"the pane derives the state from its own preview query",
	);
	assert.match(
		page,
		/preview\.isError[\s\S]{0,120}status: "failed", retry:/,
		"a failed resolution carries the retry, which is the only route back",
	);
	assert.match(composer, /draftResolution={sessionStatus\.draftResolution}/);
	/*
	 * The no-snapshot branch: `frontend: null` and `draft: true` (the strip is told
	 * WHY there is no cluster), the resolution that names the state, and - since UX
	 * round 1's U1 - `draftResolved: false`, the fact the COMPOSER's send gate reads
	 * off the same object. Asserted as three facts rather than as one adjacency, so
	 * a fourth field on this branch is not a test failure.
	 */
	assert.match(page, /frontend: null,\s*\n\s*draft: true,/);
	assert.match(page, /draftResolved: false,/);
	assert.match(page, /^\s*draftResolution,$/m);
	assert.match(
		page,
		/draftResolved: true,/,
		"the resolved branch tells the composer the same fact the strip reads",
	);
});

test("a dial this backend cannot carry is SAID on this composer, not only filtered", () => {
	/*
	 * Round 3, code minor 2. The round-2 fix strips `fast_mode` at every sender, and
	 * the whole point of a strip is that it is not silent - F1 rejected the silent
	 * version. Deleting the pane's effect leaves every suite green, because
	 * `draft-selection.test.mjs` asserts the CONSTANT's value and never its use.
	 * These are the use: the sentence on the composer's muted line, the row it is
	 * about, and the state gate that stops an unanswered probe or a missing pairing
	 * claiming an update is needed.
	 */
	const page = readFileSync(
		"src/renderer/src/features/chat/components/chat-page.tsx",
		"utf8",
	);
	assert.match(
		page,
		/draft\?\.model\?\.fast_mode === true[\s\S]{0,160}desktopFeatureState\(capabilities\.data, "draft_fast"\) === "below-version"/,
		"the line is about a SET dial on a backend that cannot carry it, in the update case only",
	);
	assert.match(
		page,
		/setSendError\(fastUnavailableSentence\(\)\);[\s\S]{0,160}setSendErrorMuted\(true\);/,
		"the sentence is said on the composer's muted line, the register for a statement of fact",
	);
	/*
	 * AND IT NAMES ITSELF (QA round 2, Q1). Without a code it is byte-identical to
	 * the lock answer's shape, and the flight rule cleared it on the next commit -
	 * the line reached no screen in three QA runs. Both ends of that identity are
	 * pinned: the pane states the code, and the retirement is TOLD the code.
	 */
	assert.match(
		page,
		/setSendError\(fastUnavailableSentence\(\)\);[\s\S]{0,160}setSendErrorCode\(FAST_UNAVAILABLE_CODE\);/,
		"the fast-unavailable line carries its own code, not the lock answer's silence",
	);
	assert.match(
		page,
		/muted: sendErrorMuted,\s*code: sendErrorCode,/,
		"the retirement is told which notice it is looking at, so it retires the lock answer only",
	);
});

test("a session with no snapshot is still silent, not pending", () => {
	// The states are the DRAFT's: a session that has not reported has a stream to
	// report it, and claiming a resolution on its behalf would be a new lie.
	const html = renderStrip({ frontend: null });
	assert.equal(text(html), "");
});

test("a session whose readings were dropped leaves one sentence where they were", () => {
	// Task-17, U4. The terminal arms clear `heldFrontend` on purpose, but the
	// strip then vanished with no word of its own - the failure notice speaks
	// for the STREAM - and the reader watching `20.3%/1M` saw it go unexplained.
	// The flag is TOLD by the pane (which remembers the session once painted
	// readings), never inferred here.
	const html = renderStrip({ readingsDropped: true });
	assert.equal(text(html), readingsDroppedNote());
	assert.match(html, /data-lo-readings-dropped/);
	assert.match(html, /role="status"/);

	// The same flag on the two states that are NOT a drop: nothing to say.
	assert.equal(
		text(renderStrip({ readingsDropped: true, draft: true })),
		"",
		"a draft has no stream, so it can never have dropped one",
	);
});

test("the dropped sentence never outranks readings that exist", () => {
	// The flag rides the sessionStatus object beside `frontend`; a stale true
	// (one commit behind a reconnect) must not replace readings a reader can
	// see with a sentence about their disappearance.
	const html = renderStrip({ frontend: DRAFT, readingsDropped: true });
	assert.match(
		html,
		/aria-label="Model:/,
		"the readings still paint when there are readings to paint",
	);
	assert.ok(!html.includes(readingsDroppedNote()));
});

test("a ladderless draft offers no effort control even where the model can be picked", () => {
	// The same rule a session follows, with a stricter reason for the draft: a
	// model that reasons without a reported ladder reads `reasoning`, and a draft's
	// picker is a pure read of the preview, so it cannot offer a rung list this
	// wire does not carry. The reading stays (it is a fact about the model), the
	// control does not.
	const html = renderStrip({
		frontend: {
			...DRAFT,
			effective_model: {
				...GPT_5,
				reasoning_effort: null,
				reasoning_efforts: [],
			},
		},
		draft: true,
		onOpenDraftPicker: () => undefined,
	});
	// The model beside it IS a control: the gate is per reading, not per pane.
	assert.match(
		html,
		/aria-label="Model: [^"]*\. Click to choose a different model\. It applies to this conversation\."/,
	);
	const effort = readingClasses(html, "Reasoning effort:");
	assert.equal(effort.label, "Reasoning effort: reasoning.");
	assert.ok(
		effort.classes.includes("cursor-default"),
		"an effort reading with no ladder must not advertise an action",
	);
	assert.doesNotMatch(text(html), /Set once the conversation starts/);
});

test("the affordance and the sentence come from ONE decision, in both places it is printed", () => {
	// The strip prints each reason twice — the aria-label and the tooltip's last
	// line — and R21 requires them to say the same thing. They do because there is
	// one call each, so this asserts the shape that makes drift impossible rather
	// than two strings that happen to match today.
	const strip = readFileSync(
		"src/renderer/src/features/chat/session-status/session-status-strip.tsx",
		"utf8",
	);
	const modelReasons = [
		...strip.matchAll(/modelReason\(draft, Boolean\(openModel\)\)/g),
	];
	assert.equal(
		modelReasons.length,
		2,
		"the model reason must be computed once and printed twice (label + tooltip)",
	);
	const effortReasons = [
		...strip.matchAll(
			/effortReason\(draft, effort\.adjustable, Boolean\(openEffort\)\)/g,
		),
	];
	assert.equal(effortReasons.length, 1);
	// Both openers are asked about the SAME affordance the reason is chosen from.
	assert.match(strip, /onOpen=\{openModel\}/);
	assert.match(strip, /onOpen=\{openEffort\}/);
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

test("the workspace precedes the editor and the rail stays end-aligned without pickers", () => {
	const composer = readFileSync(
		"src/renderer/src/shared/components/composer/message-input.tsx",
		"utf8",
	);
	const shelf = composer.indexOf('data-lo-composer-shelf=""');
	const editor = composer.indexOf('data-lo-composer-editor=""');
	const rail = composer.indexOf('data-lo-composer-rail=""');
	const pickers = composer.indexOf("ref={setComposerPickerHost}");
	const controls = composer.indexOf("data-lo-composer-controls={true}");
	assert.ok(shelf > 0 && shelf < editor && editor < rail);
	const shelfSource = composer.slice(shelf, editor);
	assert.match(
		shelfSource,
		/<DirectoryIndicator[\s\S]*<ErrorBoundary fallback=\{null\}>\s*<SessionStatusStrip/,
	);
	assert.equal(composer.match(/<SessionStatusStrip/g)?.length, 1);
	assert.ok(rail < pickers && pickers < controls);
	assert.match(
		composer.slice(controls, controls + 600),
		/className="ms-auto flex shrink-0 items-center gap-1"/,
	);
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
			// The strip's payload: the canonical STATE the strip reads.
			rest.startsWith(".snapshot,") ||
				// Or the gate on whether a draft's picker may open at all.
				/^\s*\n\s*\?/.test(rest),
			`the preview payload is used as \`preview.data${rest.slice(0, 24)}\`; it belongs to the strip only`,
		);
	}
	// And the payload itself never reaches a store action: the canonical store's
	// rows are sessions, and a preview has no session behind it. The pane's own
	// draft CHIPS call `setDraftModel` — with the model the user picked, never
	// with the payload that resolution produced.
	for (const call of [
		"setDraftModel",
		"updateDraft",
		"upsertSession",
		"createSession",
	]) {
		assert.doesNotMatch(
			page,
			new RegExp(`${call}\\([^;]{0,200}preview\\.data`, "s"),
			`${call} must not receive the preview payload`,
		);
	}
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
	const formatDuration = formatSessionDuration;

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

test("the narrow ladder sheds effort, then cost, then context - the duration is measured, not a rung", () => {
	const strip = readFileSync(
		"src/renderer/src/features/chat/session-status/session-status-strip.tsx",
		"utf8",
	);

	/*
	 * THE LADDER (issue #918), with the duration out of it: effort (a static
	 * setting) first, then cost, then context last (the reading the band keeps
	 * the longest, because it predicts the operator's next action). Each rung
	 * sheds below a container threshold, and one step earlier while the composer
	 * draws a THIRD control box (now only a live recording) - the state half of #788 - because that box
	 * costs the row 36px at every width.
	 *
	 * The thresholds are the fit points measured in
	 * `docs/evidence/composer-readings-shed/` (frames and `numbers.json`), each
	 * derived rung rounded onto the 5px grid its neighbours sit on and clearing
	 * its fit by 0.5-8px (so the third-box rung of a pair lands 30/35/35px above
	 * its two-box twin against the fits' uniform 36px step); the class strings
	 * carry the ladder, so the values are asserted here.
	 *
	 * WHY THE DURATION IS NOT ON IT. Its fit is a function of the readings' own
	 * text, of the third box, and of `--lo-chat-measure` - which the operator
	 * can drag, so the SAME 1024px column is a 778px row at the shipped 810px
	 * cap and an 886px row at their 918px box. A container range can see none of
	 * those, which is why this reading's visibility is MEASURED (`G >= D + 4`)
	 * and its absence is asserted below: a rung reappearing here would silently
	 * restore the breakpoint this change removed.
	 */
	/*
	 * The rungs live in ONE table, `SHED_RUNGS`, keyed by reading and by the
	 * row's state: the third (recording) box, and the borrowed-access `i`
	 * readout (PR #1871), which is in flow and costs 26px (22px box + 4px gap,
	 * measured in `composer-readings-shed/README.md` §8). Every reading takes
	 * its class from that table with the same two predicates.
	 */
	const table = Object.fromEntries(
		[
			...strip.matchAll(
				/(effort|cost|context): \{\s*two: "@max-\[(\d+)px\]\/chatcol:hidden",\s*three: "@max-\[(\d+)px\]\/chatcol:hidden",\s*twoAccess: "@max-\[(\d+)px\]\/chatcol:hidden",\s*threeAccess: "@max-\[(\d+)px\]\/chatcol:hidden",\s*\}/g,
			),
		].map((m) => [
			m[1],
			{
				two: Number(m[2]),
				three: Number(m[3]),
				twoAccess: Number(m[4]),
				threeAccess: Number(m[5]),
			},
		]),
	);
	assert.deepEqual(
		table,
		{
			effort: { two: 750, three: 780, twoAccess: 775, threeAccess: 810 },
			cost: { two: 705, three: 740, twoAccess: 730, threeAccess: 765 },
			context: { two: 640, three: 675, twoAccess: 660, threeAccess: 695 },
		},
		"the measured rungs: effort first, cost, context last; the third box and the access note each move every fit",
	);
	for (const name of ["effort", "cost", "context"]) {
		assert.match(
			strip,
			new RegExp(
				`SHED_RUNGS\\.${name}\\[\\s*rungState\\(controlsThirdBox, accessNote !== null\\)\\s*\\]`,
			),
			`${name} sheds on both the third box and the access note`,
		);
	}

	/*
	 * THE DURATION HAS NO CLASS-BASED SHED AT ALL: no state term, no band, no
	 * `display: none`. It is mounted whenever there is a duration to show, marked
	 * with `data-lo-duration`, and its visibility is the measured `invisible`.
	 */
	const durationStart = strip.indexOf("data-lo-duration={true}");
	assert.ok(
		durationStart > 0,
		"the duration reading must carry its own marker",
	);
	const durationBlock = strip.slice(durationStart, durationStart + 1600);
	assert.doesNotMatch(durationBlock, /controlsThirdBox/);
	assert.doesNotMatch(durationBlock, /chatcol:hidden/);
	assert.doesNotMatch(durationBlock, /\bhidden\b/);
	assert.match(
		durationBlock,
		/!durationFits && "invisible"/,
		"the only shed the reading has is the measured visibility",
	);

	/*
	 * And the three rungs are the ONLY range-hidden readings: this is the
	 * complete set of `chatcol:hidden` strings in the file, so a `hidden`
	 * appearing on another reading - or a fourth rung smuggled in - fails here.
	 * The held mark and the pickers' leading decoration can also hide. The
	 * accessible held statement survives on the group and tooltips; the picker
	 * label and chevron remain when the leading icon gives up its width.
	 */
	assert.doesNotMatch(strip, /chatcol:sr-only/);
	assert.deepEqual(
		(strip.match(/[^\s"]*chatcol:hidden/g) ?? []).sort(),
		[
			"@max-[620px]/chatcol:hidden",
			"@max-[640px]/chatcol:hidden",
			"@max-[660px]/chatcol:hidden",
			"@max-[675px]/chatcol:hidden",
			"@max-[695px]/chatcol:hidden",
			"@max-[705px]/chatcol:hidden",
			"@max-[730px]/chatcol:hidden",
			"@max-[740px]/chatcol:hidden",
			"@max-[750px]/chatcol:hidden",
			"@max-[750px]/chatcol:hidden",
			"@max-[765px]/chatcol:hidden",
			"@max-[775px]/chatcol:hidden",
			"@max-[780px]/chatcol:hidden",
			"@max-[810px]/chatcol:hidden",
		].sort(),
		"only the three rungs, held mark and decorative picker icon may be range-hidden; duration visibility is measured",
	);

	/*
	 * And the rungs only ever tighten as the ladder descends: each reading gives
	 * up at a narrower column than the one before it, in BOTH state columns, so
	 * the readings step out in order instead of flickering between bands. Parsed
	 * from the literals asserted above - read in SHED order (effort, cost,
	 * context), which is not the file's own order (that is the cluster's render
	 * order: effort, context, cost) - so a re-tuned threshold cannot silently
	 * invert the ladder.
	 */
	for (const state of ["two", "three", "twoAccess", "threeAccess"]) {
		const order = ["effort", "cost", "context"].map((n) => table[n][state]);
		assert.ok(
			order[0] > order[1] && order[1] > order[2],
			`in the ${state} row the ladder must only tighten as it descends: ${order.join(" > ")}`,
		);
	}
	for (const name of ["effort", "cost", "context"]) {
		const r = table[name];
		assert.ok(
			r.three > r.two && r.twoAccess > r.two && r.threeAccess > r.three,
			`${name}: an extra in-flow box never sheds a rung later than the row without it`,
		);
	}
});

test("the dock does not shed workspace readings when recording adds an editor control", () => {
	const strip = readFileSync(
		"src/renderer/src/features/chat/session-status/session-status-strip.tsx",
		"utf8",
	);
	for (const reading of ["effort", "cost", "context"]) {
		assert.match(
			strip,
			new RegExp(
				`isComposerDock\\s*\\? "composer-dock-${reading}"\\s*: SHED_RUNGS\\.${reading}`,
			),
		);
	}
	assert.match(strip, /if \(!hasDuration \|\| isComposerDock\) return/);
	assert.match(
		strip,
		/isComposerDock \? "composer-dock-duration" : "absolute top-0"/,
	);
});

test("the duration's fit arithmetic is pure, and reads the row's own direction", async () => {
	const { READING_GAP, inlineGap, durationFits } = await import(
		"../src/renderer/src/features/chat/session-status/session-duration-fit.ts"
	);

	/*
	 * THE GAP IS ONE NUMBER. The strip draws it with `gap-x-1` and the anchor and
	 * the comparison cross it; this pins the pair so a change to one is a failing
	 * test rather than a 4px silent drift.
	 */
	assert.equal(READING_GAP, 4, "gap-x-1 is 4px");
	const strip = readFileSync(
		"src/renderer/src/features/chat/session-status/session-status-strip.tsx",
		"utf8",
	);
	assert.match(
		strip,
		/gap-x-1/,
		"the strip's own gap class is the visual twin",
	);

	/*
	 * LTR: the last reading is the rightmost, so the gap runs from its right edge
	 * to the controls' left edge. RTL: the row is mirrored, so "last" is the
	 * leftmost reading and the gap ends at the controls' RIGHT edge - the case the
	 * first implementation got wrong, hiding the reading at every width in `ur`.
	 */
	assert.equal(inlineGap("ltr", 500, 620, 724), 120);
	assert.equal(inlineGap("ltr", 620, 620, 724), 0);
	assert.equal(inlineGap("rtl", 500, 396, 500), 0);
	assert.equal(inlineGap("rtl", 500, 396, 380), 120);
	assert.equal(inlineGap("rtl", 180, 396, 380), -200);

	/*
	 * THE FIT BOUNDARY, in both directions and at the real value: exactly
	 * `width + gap` fits, a hair less does not. The comparison is on the gap, so
	 * the direction's only job is producing it correctly.
	 */
	const boundaries = [
		// LTR: the gap runs from the last reading's right edge to the controls' left.
		{
			direction: "ltr",
			lastEdge: 500,
			controlsLeft: 559,
			controlsRight: 663,
			width: 55,
		},
		// RTL: mirrored - from the last reading's left edge to the controls' right.
		{
			direction: "rtl",
			lastEdge: 500,
			controlsLeft: 441,
			controlsRight: 441,
			width: 55,
		},
	];
	for (const {
		direction,
		lastEdge,
		controlsLeft,
		controlsRight,
		width,
	} of boundaries) {
		// The gap is computed FROM that direction's own edges, so the loop exercises
		// two different arithmetic paths rather than the same one twice.
		const exact = inlineGap(direction, lastEdge, controlsLeft, controlsRight);
		assert.equal(exact, width + READING_GAP, direction);
		assert.equal(
			durationFits(exact, width),
			true,
			`${direction} at the boundary`,
		);
		assert.equal(
			durationFits(exact - 0.1, width),
			false,
			`${direction} a hair short`,
		);
		assert.equal(
			durationFits(exact + 0.1, width),
			true,
			`${direction} a hair clear`,
		);
	}
});

test("the duration's visibility is measured from the row, not declared from a breakpoint or a state", () => {
	const strip = readFileSync(
		"src/renderer/src/features/chat/session-status/session-status-strip.tsx",
		"utf8",
	);

	/*
	 * THE MEASUREMENT'S WIRING. One boolean, false until the first measurement so
	 * the only frame that could be wrong is the first - and it is measured in a
	 * layout effect, before paint. The effect has NO dependency array on purpose:
	 * the reading ticks at 1Hz and a digit can change its width, so every render
	 * re-asks the question rather than caching an answer that the next tick can
	 * falsify.
	 */
	assert.match(
		strip,
		/const \[durationFits, setDurationFits\] = useState\(false\);/,
	);
	assert.match(
		strip,
		/useLayoutEffect\(\(\) => \{\s*\n\s*measureDurationFit\(\);\s*\n\s*\}\);/,
	);
	/*
	 * And the observer covers what no render in this component sees: the dragged
	 * `--lo-chat-measure` (the ROW), a sibling reading's step (the STRIP), the
	 * third control box (the CONTROLS), and a late face or a changed value (the
	 * ELEMENT). Font readiness is asked once because a late face changes every
	 * text width at once.
	 */
	assert.match(strip, /new ResizeObserver\(measureDurationFit\)/);
	assert.match(strip, /\[strip\.parentElement, strip, controls, element\]/);
	assert.match(strip, /document\.fonts\?\.ready\.then\(measureDurationFit\)/);

	/*
	 * THE DIRECTION IS RESOLVED FROM THE STRIP, and the arithmetic itself is the
	 * pure module's: the last reading's inline-end edge, the controls' box, and
	 * this reading's own width.
	 */
	assert.match(
		strip,
		/getComputedStyle\(strip\)\.direction === "rtl" \? "rtl" : "ltr"/,
	);
	assert.match(strip, /const gap = inlineGap\(/);
	assert.match(
		strip,
		/gapFitsDuration\(gap, element\.getBoundingClientRect\(\)\.width\)/,
	);
	assert.match(strip, /durationFits as gapFitsDuration/);

	/*
	 * THE TWO FALLBACKS (QA round 1, Q1-2): a missing controls group leaves the
	 * reading VISIBLE rather than hidden forever, and a row with no other visible
	 * reading anchors on the strip's own inline-end edge instead of standing down.
	 */
	assert.match(
		strip,
		/if \(!controls\) \{\s*\n\s*setDurationFits\(true\);\s*\n\s*return;\s*\n\s*\}/,
	);
	assert.match(
		strip,
		/lastEdge = direction === "rtl" \? stripBox\.left : stripBox\.right;/,
	);

	/*
	 * THE ANCHOR IS LOGICAL. `insetInlineStart` flips with the direction; a
	 * physical `left` would put the reading on the wrong side in `ur`.
	 */
	assert.match(
		strip,
		/insetInlineStart: `calc\(100% \+ \$\{READING_GAP\}px\)`/,
	);
	assert.doesNotMatch(strip, /left-\[calc\(100%\+4px\)\]/);
});

test("a running session renders the duration reading; only the measurement may hide it", () => {
	/*
	 * THE OPERATOR'S REPORT AS MARKUP. While the row draws its third box
	 * (`controlsThirdBox`, now a live recording) that fact used to remove this
	 * reading from the tree at EVERY width. The element must be present, with its value, and with no
	 * class-based hide on it: the state may reach it only through the measured
	 * `invisible`, which the browser decides from the row's geometry.
	 */
	const running = renderStrip({
		frontend: {
			...DRAFT,
			context_tokens: 131_000,
			context_window: 1_000_000,
			cumulative_parent_cost: 0.346,
			cost_knowledge: "exact",
			active_duration_s: 1225,
			activity_started_at: null,
		},
		controlsThirdBox: true,
	});
	assert.match(running, /data-lo-duration/);
	assert.match(running, /Active time: 20m25s\./);
	assert.match(running, />20m25s</);
	const element = running.match(
		/<span data-lo-duration="true" class="([^"]*)"/,
	);
	assert.ok(element, "the duration element must be in the running markup");
	assert.doesNotMatch(element[1], /\bhidden\b/);
	const start = running.indexOf("data-lo-duration");
	assert.ok(start > 0);
	assert.doesNotMatch(running.slice(start, start + 700), /chatcol:hidden/);
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

/* --------------------------------------- the readings a reconnect holds */

/*
 * A server-stream gap drops the authoritative `frontend` by design (the flush's
 * replay/snapshot ordering rests on that field meaning "a snapshot for THIS
 * epoch has landed"), so the pane hands the strip the readings it was last told
 * instead — and the strip has to draw them without presenting them as current.
 *
 * The words are checked here rather than in a live frame because the CLAIM is
 * about copy: a frame can see that the strip painted, and only this can see what
 * it said.
 */

/**
 * Every READING's accessible name, in render order.
 *
 * The held cluster's own `aria-label` is excluded by name: it is the strip's
 * group statement (design D4), not a reading, and including it would make every
 * comparison below about a sentence no reading carries.
 */
const readingLabels = (html) =>
	[...html.matchAll(/aria-label="([^"]*)"/g)]
		.map((match) => match[1])
		.filter((label) => !label.startsWith("Session readings."));

/** A session's snapshot with every reading the strip draws: model, effort, context, spend, time. */
const SESSION = {
	...DRAFT,
	context_tokens: 12_977,
	// 400k window, so the reading is a percentage rather than an estimate.
	context_is_estimate: false,
	cumulative_parent_cost: 2.4,
	cost_knowledge: "exact",
	active_duration_s: 92,
};

test("a carried context reading does not claim to be measured now", () => {
	/*
	 * DESIGN ROUND 1, D1. A cold/attaching snapshot lands whole: the model, the
	 * timer and the cost in it are live again, but its occupancy is the journal's
	 * (the length at an earlier message). The cluster is therefore NOT held - no
	 * `data-lo-session-strip-held`, no "Last reading" mark - while the context
	 * sentence must still refuse "Measured now", or the strip states one reading
	 * two ways.
	 */
	const openable = { frontend: SESSION, onCommand: () => undefined };
	const live = renderStrip(openable);
	const carried = renderStrip({ ...openable, contextHeld: true });

	const contextOf = (labels) => labels.filter((l) => l.startsWith("Context: "));
	const liveLabels = readingLabels(live);
	const carriedLabels = readingLabels(carried);
	assert.equal(contextOf(carriedLabels).length, 1, "one context reading");
	assert.match(contextOf(liveLabels)[0], /Measured now;/);
	assert.doesNotMatch(
		contextOf(carriedLabels)[0],
		/Measured now|Estimated now/,
		"a carried count is a real reading, not a current one",
	);
	assert.deepEqual(
		carriedLabels.filter((l) => !l.startsWith("Context: ")),
		liveLabels.filter((l) => !l.startsWith("Context: ")),
		"every other reading is live and renders exactly its live name",
	);
	assert.ok(
		!carried.includes("data-lo-session-strip-held"),
		"the cluster is not held; only one reading is qualified",
	);

	/*
	 * THE TOOLTIP IS A THIRD BUILD SITE, and static markup cannot see it: Radix
	 * renders `TooltipContent` only when open, so a suite asserting aria-labels
	 * alone let the carried reading say "Measured now" in the tooltip while its
	 * name said the opposite (review round 3, M1). The three sites are pinned by
	 * source: the no-reading sentence, the measured sentence, and the tooltip's
	 * closing line.
	 */
	const source = readFileSync(
		new URL(
			"../src/renderer/src/features/chat/session-status/session-status-strip.tsx",
			import.meta.url,
		),
		"utf8",
	);
	/*
	 * ALL FOUR, not "at least three": the strip has four sites that build the
	 * context sentence or its held mark (the no-reading label, the measured
	 * label, the tooltip's closing line, and the reading's own `held`), and a
	 * count that tolerated three let the tooltip's site regress silently
	 * (review round 4, MINOR). A fifth site is a change to this contract and
	 * should fail here too.
	 */
	const qualified = source.match(/held \|\| contextHeld/g) ?? [];
	assert.equal(
		qualified.length,
		4,
		`every context sentence site must take the carried flag (found ${qualified.length})`,
	);
});

test("a held reading keeps its value, and the strip says once that it is the last one", () => {
	/*
	 * A DISPATCHER, so the context reading is OPENABLE and its closing line is the
	 * measured/estimated one rather than `COMMANDS_OFF`: that first branch returns
	 * before the status is read, so a fixture without one could not see D3's
	 * difference at all.
	 */
	const openable = { frontend: SESSION, onCommand: () => undefined };
	const live = renderStrip(openable);
	const held = renderStrip({ ...openable, held: true });

	/*
	 * THE VALUES ARE THE SAME, and that is the assertion the held state exists
	 * for: the reader keeps the model, the effort, the context window and the
	 * spend they were last told rather than watching four blanks come and go at
	 * the stream's cadence. A mark that replaced a value would be the app
	 * answering a question the owner has not answered.
	 */
	const liveLabels = readingLabels(live);
	const heldLabels = readingLabels(held);
	assert.ok(
		liveLabels.length >= 4,
		`the fixture must render the whole cluster (got ${liveLabels.length}: ${liveLabels.join(" | ")})`,
	);

	/*
	 * THE PROVENANCE CLAUSE IS NOT ON THE READINGS ANY MORE (design round 1, D4).
	 * It used to be appended to all four accessible names, which is the same
	 * sentence four times over and, after a pick, two qualifications in one
	 * utterance (UX round 1, U2). The cluster states it once; the tooltips keep
	 * it per reading. So no reading's name carries it now.
	 */
	for (const label of heldLabels)
		assert.ok(
			!label.includes(LAST_READING_NOTE()),
			`the clause must not be repeated on every reading: ${label}`,
		);

	/*
	 * THE ONE READING WHOSE NAME LEGITIMATELY DIFFERS WHILE HELD is the context
	 * chip, and for a different reason: its closing line may not say "Measured
	 * now" while the strip is saying the reading is from before the reconnect
	 * (design round 1, D3). Every other reading is asserted IDENTICAL to its live
	 * name, character for character.
	 */
	const contextOf = (labels) => labels.filter((l) => l.startsWith("Context: "));
	assert.equal(contextOf(heldLabels).length, 1, "one context reading");
	assert.match(
		contextOf(liveLabels)[0],
		/Measured now;/,
		"the live context reading says it was measured now",
	);
	assert.doesNotMatch(
		contextOf(heldLabels)[0],
		/Measured now|Estimated now/,
		"and the held one may not, or the panel asserts current and stale at once",
	);
	assert.deepEqual(
		heldLabels.filter((l) => !l.startsWith("Context: ")),
		liveLabels.filter((l) => !l.startsWith("Context: ")),
		"every other reading renders the value AND the name it renders live",
	);

	/*
	 * D1: A VISIBLE MARK, which the first cut of this change did not have.
	 * Measured, the transcript's "Reconnecting" line sat thousands of pixels above
	 * the readings and hit-tested none of 713 held samples, so a held band and a
	 * live one were the same glyphs in the same inks.
	 */
	assert.match(held, />\s*Last reading\s*</, "the cluster carries the word");
	assert.doesNotMatch(
		live,
		/>\s*Last reading\s*</,
		"and a live cluster does not",
	);
	/*
	 * D4: the SAME statement reaches assistive technology, once, as the group's
	 * own name -- announced on entering the group rather than four times over.
	 */
	assert.match(
		held,
		/role="group" aria-label="Session readings\. Last reading from before the reconnect\."/,
		"the strip states it once as a group name",
	);
	/*
	 * Asserted on the STATEMENT rather than on `role="group"`: the strip's own
	 * markup contains a group role elsewhere (the context wheel's), so a bare role
	 * check would be about somebody else's element. What must not exist on a live
	 * strip is the held sentence.
	 */
	assert.doesNotMatch(
		live,
		/Session readings\./,
		"and a live strip states none of it",
	);

	/*
	 * AND THE LIVE STRIP SAYS NONE OF IT. Without this half the mark could be
	 * unconditional and every reading in the app would claim to be stale.
	 */
	assert.doesNotMatch(live, /Last reading/);
	assert.doesNotMatch(live, /data-lo-session-strip-held/);
	assert.match(
		held,
		/data-lo-session-strip-held="true"/,
		"and the cluster is marked in the DOM, so a frame or a probe can ask without reading the copy",
	);

	/*
	 * THE MARK IS NOT THE PANE'S SENTENCE. The transcript paints "Reconnecting"
	 * for this whole state, and a second copy of it here would be the same claim
	 * twice - the strip's half is saying WHICH readings these are.
	 */
	assert.doesNotMatch(
		held,
		/aria-label="[^"]*Reconnecting/,
		"the strip must not restate the pane's own reconnecting notice",
	);
});

/* ---- 6. the fast badge --------------------------------------------------- */

/**
 * The badge's three states, off the SAME spec the chip labels itself from.
 *
 * The operator's mock (2026-09-29): a bolt immediately before the model name
 * when fast mode is on — hidden when the dial is off, and hidden when the
 * model reports no fast tier at all (`fastModeState`'s tri-state: `nothing` is
 * not `off`). The badge carries no tooltip trigger of its own; its sentence
 * rides the chip's single panel, and the chip's `aria-label` states the fact —
 * a screen reader hears what the bolt means (the bolt itself is decoration).
 */
test("the fast badge marks an on spec, and only an on spec", () => {
	const render = (model) =>
		renderStrip({
			frontend: { ...DRAFT, effective_model: model },
			onCommand: () => undefined,
		});
	const ON = render({ ...GPT_5, supports_fast_mode: true, fast_mode: true });
	const OFF = render({ ...GPT_5, supports_fast_mode: true, fast_mode: false });
	const NO_TIER = render(GPT_5);

	// The bolt renders as the shared `Zap` (`lucide-zap` in the markup, like
	// every other icon assertion in this suite) — before the name it qualifies,
	// which is where the mock puts it.
	assert.match(ON, /lucide-zap/, "the on spec carries the bolt");
	assert.match(
		ON,
		/lucide-zap[\s\S]*?<\/svg>\s*<span class="truncate">gpt-5<\/span>/,
		"the bolt sits immediately before the name (the aggregator's bare id, the name this chip prints)",
	);
	// The chip's accessible name states the fact the bolt marks, at the same
	// moment the bolt shows.
	assert.match(
		ON,
		/aria-label="Model: openrouter\/openai\/gpt-5, fast mode on\./,
		"the chip speaks the state it shows",
	);
	// The tooltip's line is the component's own constant; a reworded sentence
	// must move this test rather than silently leave the PR notes behind.
	assert.equal(fastModeOnNote(), "Fast mode on");

	// OFF IS NOT MARKED, and it makes no claim either: no bolt, no clause.
	assert.doesNotMatch(OFF, /lucide-zap/, "a supported off dial shows no bolt");
	assert.doesNotMatch(OFF, /fast mode on/, "and claims no state");
	assert.match(
		OFF,
		/aria-label="Model: openrouter\/openai\/gpt-5\. /,
		"the label keeps its plain form",
	);

	// NO TIER IS NOT OFF: the badge hides for it the same way, and the chip
	// stays silent about a dial the model does not have.
	assert.doesNotMatch(NO_TIER, /lucide-zap/);
	assert.doesNotMatch(NO_TIER, /fast mode on/);
});

/* ---- settings intents: a QUEUED model pick reads as waiting -------------- */

/*
 * Design D2 / UX U5 (PR #1823 round 1). A durable model intent the server has
 * queued for the session's next step used to paint the band exactly like one
 * it was applying: a spinner and "Switching; waiting for the session to
 * confirm it", while the chip line above said "applies at the next step". The
 * band now takes the chip's register - a static clock and the chip's own
 * sentence as the accessible name - and an APPLYING pick keeps the spinner.
 */
const GPT_4O_MINI = {
	...GPT_5,
	model_id: "openai/gpt-4o-mini",
	display_name: "OpenAI: GPT-4o-mini",
};
const INTENT_SESSION = {
	...DRAFT,
	context_tokens: 12_000,
	cost_knowledge: "exact",
	cumulative_parent_cost: 0.1,
};

test("a queued model intent names the next step on the band, with no spinner", () => {
	const queued = renderStrip({
		frontend: INTENT_SESSION,
		pendingModel: GPT_4O_MINI,
		pendingModelQueued: true,
		onCommand: () => undefined,
	});
	const { label } = readingClasses(queued, "OpenAI: GPT-4o-mini applies");
	assert.equal(label, "OpenAI: GPT-4o-mini applies at the next step");
	assert.doesNotMatch(queued, /waiting for the session to confirm/);
	assert.doesNotMatch(queued, /Switching the model/);

	const applying = renderStrip({
		frontend: INTENT_SESSION,
		pendingModel: GPT_4O_MINI,
		onCommand: () => undefined,
	});
	assert.doesNotMatch(applying, /applies at the next step/);
	assert.match(applying, /waiting for the session to confirm/);
});

/*
 * THE BORROWED-ACCESS NOTE (operator report, 2026-11-11). A remote session on
 * healthy borrowed access used to carry a standing card above the composer;
 * informational access states now ride the strip as an `i` readout beside the
 * model and effort, and the states that need action keep the card (asserted in
 * `session-status.test.mjs`). This renders the shipped strip for each state.
 */
function accessFrame(effective_state) {
	return {
		...DRAFT,
		selected_model: GPT_5,
		model_access: {
			state: effective_state === "effective_borrow" ? "ok" : "signed_out",
			effective_state,
			provider: "openrouter",
			label: "OpenRouter",
			owner_device: "synthetic-owner",
			owner_label: "Work laptop",
			observed_at: 1700000000,
			last_grant_at: 1699999900,
			last_grant_expires_at: 1699999950,
		},
	};
}

for (const [state, shown] of [
	["effective_borrow", true],
	["pending", true],
	["eligible_borrow_unverified", true],
	["expired", false],
	["withdrawn", false],
	["owner_unavailable", false],
	["device_bound", false],
	["absent", false],
]) {
	test(`the strip's access note for ${state}: ${shown ? "an i readout" : "none (the card owns it)"}`, () => {
		const html = renderStrip({
			frontend: accessFrame(state),
			onCommand: () => undefined,
		});
		const marker = new RegExp(`data-lo-model-access="${state}"`);
		if (!shown) {
			assert.doesNotMatch(html, /data-lo-model-access=/);
			return;
		}
		assert.match(html, marker);
		// Focusable, named by the fact, never a button with nothing to open.
		const readout = html.match(
			/<span tabindex="0" aria-label="([^"]*)"[^>]*>(?:(?!<\/span>).)*data-lo-model-access=/,
		);
		assert.ok(readout, "the icon sits inside a focusable, labelled readout");
		// The state's own title: the provider (pending) or the owner (borrow).
		assert.match(readout[1], /OpenRouter|Work laptop/);
	});
}

test("the strip names borrowed access in the readout's accessible name", () => {
	const html = renderStrip({
		frontend: accessFrame("effective_borrow"),
		onCommand: () => undefined,
	});
	assert.match(html, /aria-label="OpenRouter access from Work laptop"/);
});

test("a draft never carries the access note: its frame is a preview, not a session", () => {
	const html = renderStrip({
		frontend: accessFrame("effective_borrow"),
		draft: true,
		onOpenDraftPicker: () => undefined,
	});
	assert.doesNotMatch(html, /data-lo-model-access=/);
});
