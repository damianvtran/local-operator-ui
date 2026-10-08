import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * THE STOPPED ROW DECLARES THE CONTAINER ITS MEASURE RESOLVES AGAINST
 * (operator report, 2026-09-27).
 *
 * The report: a cancelled turn's "Stopped · Retry" line rendered at the chat
 * column's far-left edge instead of inside the conversation's shared measure.
 * The cause was structural, not a style drift: `CHAT_MEASURE`'s cap and
 * centring are container-query variants keyed to the named `chatcol` container,
 * so a row whose wrapper does not declare that container matches NEITHER
 * variant - the line keeps `w-full` and paints at the column's inset while the
 * composer box, which declares it, centres into the measure. Measured on the
 * built app at a 1120px column: line left x=284 (column + 24) against the
 * composer box's x=370 (column + 110), 86px apart. The rig that measured both
 * sides is `scripts/interrupt-esc-proof.mjs`; its frames and record live in
 * `docs/evidence/stopped-row-measure/`.
 *
 * WHY THE PIN IS STRUCTURAL. `chat-content.tsx` is a page component - it reads
 * the canonical stores, the router and the preference hooks - so it is not
 * reachable from this suite's jsdom bundles, and jsdom has no layout engine to
 * resolve a container query even if it were. What a source read CAN pin is the
 * property the geometry follows from: the stopped row's wrapper carries
 * `CHAT_COLUMN_CONTAINER` (beside the shared inset), exactly as the dock above
 * it and the composer band below it do, and the line inside keeps
 * `CHAT_MEASURE` as the thing that resolves against it. Deleting the container
 * from the wrapper - the mutation this exists for - fails the first case, and
 * renaming the container token in `chat-measure.ts` without the wrapper fails
 * the name-agreement one.
 */

/*
 * Comments are stripped because the prose around these elements discusses the
 * tokens by name, and a mention in a comment must not read as code - the same
 * strip `scripts/ask-options.test.mjs` applies to this file for the same
 * reason.
 */
const pane = readFileSync(
	"src/renderer/src/features/chat/components/chat-content.tsx",
	"utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

const measure = readFileSync(
	"src/renderer/src/features/chat/chat-measure.ts",
	"utf8",
);

test("the stopped row's wrapper declares the chatcol container, and the line keeps the shared measure", () => {
	const block = pane.indexOf("{stoppedTurnAt !== null &&");
	assert.ok(block >= 0, "the stopped row's block is not in chat-content.tsx");
	const lineAt = pane.indexOf("data-stopped-turn", block);
	assert.ok(lineAt > block, "§G3's line is not inside the stopped row's block");
	/*
	 * The wrapper is the LAST `<div` before the line: it is the element the
	 * line resolves in, and the block may grow an earlier element (a note, a
	 * control) without that changing which element must declare the container.
	 */
	const wrapperAt = pane.lastIndexOf("<div", lineAt);
	assert.ok(
		wrapperAt > block,
		"the stopped line is not inside a wrapper element",
	);
	const wrapper = pane.slice(wrapperAt, lineAt);
	assert.ok(
		/className=\{cn\(/.test(wrapper),
		`the stopped row's wrapper is not a cn() className - every className routes through cn (see AGENTS.md). Wrapper was: ${wrapper}`,
	);
	assert.ok(
		wrapper.includes("CHAT_COLUMN_CONTAINER"),
		`the stopped row's wrapper must declare CHAT_COLUMN_CONTAINER: CHAT_MEASURE's cap and centring are keyed to the named chatcol container, and without it the line hugs the column's inset while every surface that declares one centres (operator report, 2026-09-27). Wrapper was: ${wrapper}`,
	);
	assert.ok(
		wrapper.includes("CHAT_COLUMN_INSET"),
		`the stopped row's wrapper must keep the SHARED column inset: it is half of a shared edge, and the below-threshold rig run exercises it. Wrapper was: ${wrapper}`,
	);
	const line = pane.slice(lineAt, pane.indexOf(">", lineAt));
	assert.ok(
		line.includes("CHAT_MEASURE"),
		`§G3's line must keep CHAT_MEASURE - it is the thing that resolves against the container the wrapper declares. Line was: ${line}`,
	);
});

test("the stopped band renders only for a turn that ENDED and a press that was not left unconfirmed", () => {
	/*
	 * The operator incident (2026-10-07), structural half: the band said
	 * "Stopped · Retry" while the turn was still running (the fact is written at
	 * the press, and the gate used to be the fact alone), and a press whose
	 * answer was lost could leave it standing with nothing stopped. Both terms
	 * are read off the SAME block the wrapper test locates, because the gate and
	 * the row it guards are one contract:
	 *
	 * - `!canonical.turnAlive` - the pair the working line reads (`frontend ??
	 *   heldFrontend`, `chat-page.tsx`): during a receipt gap the raw `busy` is
	 *   false while the last reading still says "streaming", and a band claiming
	 *   the turn ended in that window is the lying halftone the report is about.
	 * - `canonical.stopOutcome !== "unconfirmed"` - the answer's own end: the
	 *   classification fact survives a lost answer on purpose (the reducer
	 *   reclassifies a killed call from it), so the DISPLAY is the half that must
	 *   stop claiming a stopped turn when nothing ever confirmed one.
	 */
	const block = pane.indexOf("{stoppedTurnAt !== null &&");
	assert.ok(block >= 0, "the stopped row's block is not in chat-content.tsx");
	const gateEnd = pane.indexOf("&& (", block);
	assert.ok(
		gateEnd > block,
		"the stopped row's block has no opening condition",
	);
	const gate = pane.slice(block, gateEnd);
	assert.ok(
		gate.includes("!canonical.turnAlive"),
		`the band must not render while the turn is still alive. Gate was: ${gate}`,
	);
	assert.ok(
		gate.includes('canonical.stopOutcome !== "unconfirmed"'),
		`the band must not claim a stopped turn from a press whose answer was lost. Gate was: ${gate}`,
	);
});

test("the container token the stopped row carries is the one CHAT_MEASURE queries", () => {
	/*
	 * The two halves of one name: the wrapper applies `CHAT_COLUMN_CONTAINER`
	 * and the measure's variants ask for `@min-[<threshold>px]/chatcol`.
	 * Renaming the container in `chat-measure.ts` without its query (or the
	 * reverse) is the same defect as not declaring it at all - the variants
	 * would simply never match, and the line would paint at the inset again.
	 */
	const named = /CHAT_COLUMN_CONTAINER\s*=\s*"@container\/([a-z0-9-]+)"/.exec(
		measure,
	);
	assert.ok(
		named,
		"CHAT_COLUMN_CONTAINER is not declared as a named container in chat-measure.ts",
	);
	assert.ok(
		new RegExp(`@min-\\[\\d+px\\]/${named[1]}`).test(measure),
		`CHAT_MEASURE's threshold variant does not query the container CHAT_COLUMN_CONTAINER declares (@container/${named[1]}) - the two names are one contract`,
	);
});
