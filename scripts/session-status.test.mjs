import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The session status strip's arithmetic, asserted against the Python it mirrors
 * and against payloads captured from a real backend.
 *
 * Three ports are under test, each documented in its own file with the symbol
 * it mirrors:
 *
 *   - `session-cost.ts`    <- `FrontendSessionState.cumulative_cost` and
 *                             `.cumulative_cost_knowledge`, plus `format_cost`
 *                             and `_spend_text`'s zero/floor/unpriceable policy
 *   - `session-context.ts` <- `CONTEXT_COLOR_BANDS`, `CONTEXT_COLOR_WINDOW_BANDS`,
 *                             `context_semantic_color`, `context_spelling`,
 *                             `format_context_tokens`, `format_window`
 *   - `session-model.ts`   <- `_effort_label` and the band's model-name choice
 *
 * Why assert at all, when a story shows the result: a port whose rules are only
 * checked by looking at a frame drifts from its source the first time either
 * side is edited, and a cost figure is the one reading in this app where being
 * quietly wrong is indistinguishable from being right. The same argument
 * `tool-row.test.mjs` makes for the row arithmetic.
 *
 * `fixtures/session-status-capture.json` is the second half: the rules above
 * are what the Python says, and the fixture is what the wire actually carries.
 * Its header records exactly how it was captured.
 */

const ROOT = process.cwd();

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/session-status/session-cost";',
			'export * from "./src/renderer/src/features/chat/session-status/session-context";',
			'export * from "./src/renderer/src/features/chat/session-status/session-model";',
			'export * from "./src/renderer/src/features/chat/session-status/fixed-point";',
		].join("\n"),
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	CONTEXT_COLOR_BANDS,
	pyFixed,
	reconcileEffort,
	CONTEXT_COLOR_WINDOW_BANDS,
	FLOOR_MARK,
	UNPRICEABLE_TEXT,
	contextReading,
	contextSemanticColor,
	contextSpelling,
	contextTooltipLines,
	costTooltip,
	cumulativeCostKnowledge,
	effortState,
	formatContextTokens,
	formatCost,
	formatWindow,
	modelIdentity,
	sessionCost,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const CAPTURE = JSON.parse(
	readFileSync(
		join(ROOT, "scripts/fixtures/session-status-capture.json"),
		"utf8",
	),
);
const TIES = JSON.parse(
	readFileSync(
		join(ROOT, "scripts/fixtures/session-status-rounding-ties.json"),
		"utf8",
	),
);

/* ---- 1. cost: cumulative_cost ------------------------------------------ */

test("the owner ledger and the compatibility map are never summed together", () => {
	// `cumulative_cost`: children are `subagent_cost` when
	// `subagent_cost_knowledge is not None`, ELSE the child_costs sum. The owner
	// ledger already covers swept work and live descendants that the per-row
	// costs omit, so adding both double-counts. This state has both populated
	// and must report 1.0 + 4.0, never 1.0 + 4.0 + 9.0.
	const both = {
		cumulative_parent_cost: 1.0,
		child_costs: { a: 5.0, b: 4.0 },
		subagent_cost: 4.0,
		subagent_cost_knowledge: "exact",
		cost_knowledge: "exact",
	};
	assert.equal(sessionCost(both).total, 5.0);

	// With no owner knowledge at all, the compatibility map is the answer.
	const rowsOnly = { ...both, subagent_cost_knowledge: null };
	assert.equal(sessionCost(rowsOnly).total, 10.0);
});

test("`is not None` is the switch, so an owner that reports `unknown` still wins", () => {
	// The Python tests `subagent_cost_knowledge is not None`, not its truthiness
	// and not whether it is EXACT. An owner saying "I do not know what my
	// children cost" is still the authority on the question, so `child_costs`
	// stays unread — a `!==` port that checked for "exact" would silently switch
	// ledgers here and report 8.0.
	const state = {
		cumulative_parent_cost: 1.0,
		child_costs: { a: 7.0 },
		subagent_cost: 2.0,
		subagent_cost_knowledge: "unknown",
		cost_knowledge: "exact",
	};
	assert.equal(sessionCost(state).total, 3.0);
});

test("an empty child_costs map is no children, not children costing zero", () => {
	// `sum(...) if self.child_costs else None`. The distinction survives into
	// the total: null parent plus empty map is null, not 0.0 — which is what
	// keeps a fresh session's segment absent instead of reading `$0.0000`.
	const fresh = {
		cumulative_parent_cost: null,
		child_costs: {},
		subagent_cost: null,
		subagent_cost_knowledge: null,
		cost_knowledge: "unknown",
	};
	assert.equal(sessionCost(fresh).total, null);
	assert.equal(sessionCost(fresh).text, "");
});

test("a null parent with known children still totals", () => {
	// `float(self.cumulative_parent_cost or 0.0) + (children or 0.0)`: the
	// parent's None becomes 0.0 once ANY side is known.
	const state = {
		cumulative_parent_cost: null,
		child_costs: { a: 2.5 },
		subagent_cost: null,
		subagent_cost_knowledge: null,
		cost_knowledge: "exact",
	};
	assert.equal(sessionCost(state).total, 2.5);
});

/* ---- 2. cost: cumulative_cost_knowledge --------------------------------- */

test("the session's own floor outranks an exact child ledger", () => {
	// Order is load-bearing: the own `partial`/`floor` test comes FIRST, before
	// the owner ledger is consulted at all. A parent figure that is already a
	// floor cannot be made exact by a child that happens to be known. This is
	// exactly the combination the real capture produced.
	assert.equal(
		cumulativeCostKnowledge({
			child_costs: {},
			subagent_cost_knowledge: "exact",
			cost_knowledge: "floor",
		}),
		"floor",
	);
	assert.equal(
		cumulativeCostKnowledge({
			child_costs: {},
			subagent_cost_knowledge: "exact",
			cost_knowledge: "partial",
		}),
		"partial",
	);
});

test("a partial child ledger degrades an exact session", () => {
	assert.equal(
		cumulativeCostKnowledge({
			child_costs: {},
			subagent_cost_knowledge: "partial",
			cost_knowledge: "exact",
		}),
		"partial",
	);
});

test("an unknown child ledger degrades only when there are rows to be unknown about", () => {
	// `if self.subagent_cost_knowledge == UNKNOWN and self.child_costs`. With no
	// rows the unknown is about nothing and the session stays exact.
	assert.equal(
		cumulativeCostKnowledge({
			child_costs: {},
			subagent_cost_knowledge: "unknown",
			cost_knowledge: "exact",
		}),
		"exact",
	);
	assert.equal(
		cumulativeCostKnowledge({
			child_costs: { a: 1 },
			subagent_cost_knowledge: "unknown",
			cost_knowledge: "exact",
		}),
		"partial",
	);
});

test("an unrecognised rung degrades to unknown rather than throwing", () => {
	// A future `CostKnowledge` member must not crash a renderer that predates
	// it, and must not be mistaken for exactness.
	assert.equal(
		cumulativeCostKnowledge({
			child_costs: {},
			subagent_cost_knowledge: null,
			cost_knowledge: "speculative",
		}),
		"unknown",
	);
});

/* ---- 3. cost: how it is spelled ----------------------------------------- */

test("format_cost switches decimals at a cent and at a dollar", () => {
	// `$0.0021` under a cent, `$0.123` under a dollar, `$1.23` above.
	assert.equal(formatCost(0.0021), "$0.0021");
	assert.equal(formatCost(0.009999), "$0.0100");
	assert.equal(formatCost(0.01), "$0.010");
	assert.equal(formatCost(0.123456), "$0.123");
	assert.equal(formatCost(0.999), "$0.999");
	assert.equal(formatCost(1.0), "$1.00");
	assert.equal(formatCost(12.345), "$12.35");
});

test("a zero spend renders no segment at all", () => {
	// `_spend_text`: `if not spend: return ""`. An unpriced model reaching the
	// band as 0.0 is exactly the case that would otherwise print a confident
	// `$0.0000` over billed tokens — "the more expensive lie of the two".
	const zero = {
		cumulative_parent_cost: 0,
		child_costs: {},
		subagent_cost: null,
		subagent_cost_knowledge: null,
		cost_knowledge: "exact",
	};
	assert.equal(sessionCost(zero).total, 0);
	assert.equal(sessionCost(zero).text, "");
});

test("a floor figure carries the mark, an exact one does not", () => {
	const base = {
		cumulative_parent_cost: 2.1,
		child_costs: {},
		subagent_cost: null,
		subagent_cost_knowledge: null,
	};
	assert.equal(
		sessionCost({ ...base, cost_knowledge: "floor" }).text,
		`${FLOOR_MARK}$2.10`,
	);
	assert.equal(
		sessionCost({ ...base, cost_knowledge: "partial" }).text,
		`${FLOOR_MARK}$2.10`,
	);
	assert.equal(sessionCost({ ...base, cost_knowledge: "exact" }).text, "$2.10");
	// The mark is `≥`, the same character `RESTORED_COST_PREFIX` uses.
	assert.equal(FLOOR_MARK, "\u2265");
});

test("billed tokens at an unresolvable price spell the unknown, not a zero", () => {
	// `tui/app.py:7703`: `"$—" if billed_unknown else None`. "We spent something
	// we cannot price" is a different fact from "we have not spent".
	const unpriced = {
		cumulative_parent_cost: null,
		child_costs: {},
		subagent_cost: null,
		subagent_cost_knowledge: null,
		cost_knowledge: "unknown",
	};
	assert.equal(
		sessionCost(unpriced, { input_tokens: 900, output_tokens: 12 }).text,
		UNPRICEABLE_TEXT,
	);
	assert.equal(UNPRICEABLE_TEXT, "$\u2014");
	// No usage at all is the honest silence, not the unknown mark.
	assert.equal(sessionCost(unpriced, null).text, "");
	// Usage that billed NOTHING is also silence: there is no spend to be unable
	// to price.
	assert.equal(
		sessionCost(unpriced, { input_tokens: 0, output_tokens: 0 }).text,
		"",
	);
});

test("the cost tooltip explains the mark rather than repeating it", () => {
	const floor = sessionCost({
		cumulative_parent_cost: 2.1,
		child_costs: {},
		subagent_cost: null,
		subagent_cost_knowledge: null,
		cost_knowledge: "floor",
	});
	assert.match(costTooltip(floor), /at least \$2\.10/);
	const exact = sessionCost({
		cumulative_parent_cost: 2.1,
		child_costs: {},
		subagent_cost: null,
		subagent_cost_knowledge: null,
		cost_knowledge: "exact",
	});
	assert.match(costTooltip(exact), /Session spend so far: \$2\.10\./);
	assert.doesNotMatch(costTooltip(exact), /at least/);
});

/* ---- 4. context: the two ladders and their union ------------------------ */

test("the band tuples match the Python constants exactly", () => {
	assert.deepEqual(
		CONTEXT_COLOR_BANDS.map((b) => [...b]),
		[
			[500_000, "danger"],
			[200_000, "label"],
		],
	);
	assert.deepEqual(
		CONTEXT_COLOR_WINDOW_BANDS.map((b) => [...b]),
		[
			[0.8, "danger"],
			[0.55, "label"],
		],
	);
});

test("the absolute ladder alone governs when the window is unknown", () => {
	// `window <= 0` falls back to the absolute ladder, since a percentage needs
	// a denominator.
	assert.equal(contextSemanticColor(10_000, 0), "signal");
	assert.equal(contextSemanticColor(250_000, 0), "label");
	assert.equal(contextSemanticColor(600_000, 0), "danger");
	// And a negative window is the same unknown, not a ratio.
	assert.equal(contextSemanticColor(600_000, -1), "danger");
});

test("the proportional ladder is what makes a small window legible", () => {
	// 70% of the registry's windowed models are 200k or smaller; on those the
	// absolute rungs are unreachable, so without this ladder the reading stayed
	// calm at 100% full with compaction already due.
	assert.equal(contextSemanticColor(120_000, 200_000), "label"); // 60%
	assert.equal(contextSemanticColor(180_000, 200_000), "danger"); // 90%
	assert.equal(contextSemanticColor(100_000, 200_000), "signal"); // 50%
});

test("the warmer of the two ladders wins, in both directions", () => {
	// Absolute says danger (over 500k), proportional says calm (25% of 2M).
	assert.equal(contextSemanticColor(600_000, 2_000_000), "danger");
	// Absolute says calm (under 200k), proportional says danger (90% of 100k).
	assert.equal(contextSemanticColor(90_000, 100_000), "danger");
	// Absolute says label (over 200k), proportional says danger (85% of 300k).
	assert.equal(contextSemanticColor(255_000, 300_000), "danger");
	// Absolute says danger, proportional says label — danger survives.
	assert.equal(contextSemanticColor(600_000, 1_000_000), "danger");
});

test("both ladders compare strictly greater-than, so a boundary stays calm", () => {
	// A value sitting exactly on a boundary keeps the calmer colour, so a number
	// hovering there does not flicker between two hues.
	assert.equal(contextSemanticColor(200_000, 0), "signal");
	assert.equal(contextSemanticColor(200_001, 0), "label");
	assert.equal(contextSemanticColor(500_000, 0), "label");
	assert.equal(contextSemanticColor(500_001, 0), "danger");
	// Proportional: exactly 55% and exactly 80% of the window.
	assert.equal(contextSemanticColor(55_000, 100_000), "signal");
	assert.equal(contextSemanticColor(55_001, 100_000), "label");
	assert.equal(contextSemanticColor(80_000, 100_000), "label");
	assert.equal(contextSemanticColor(80_001, 100_000), "danger");
});

/* ---- 5. context: how it is spelled -------------------------------------- */

test("format_context_tokens and format_window spell a number and a label differently", () => {
	assert.equal(formatContextTokens(999), "999");
	assert.equal(formatContextTokens(12_400), "12.4k");
	assert.equal(formatContextTokens(1_200_000), "1.2m");
	// A whole window renders without a decimal: the denominator is a label, not
	// a measurement. Capital M against the measurement's lower-case m.
	assert.equal(formatWindow(1_000_000), "1M");
	assert.equal(formatWindow(1_500_000), "1.5M");
	assert.equal(formatWindow(200_000), "200k");
	assert.equal(formatWindow(128_000), "128k");
	assert.equal(formatWindow(512), "512");
});

test("a reading with no window reports against an explicit unknown", () => {
	// A percentage needs a denominator, so the spend is reported against `—`
	// rather than against an invented window.
	assert.equal(contextSpelling(12_400, 0), "12.4k/\u2014");
	// Nothing to report disappears on the same test at every caller.
	assert.equal(contextSpelling(0, 128_000), "");
	assert.equal(contextSpelling(-5, 128_000), "");
});

test("a rounded 0% over a real reading is refused", () => {
	// A child holding three thousand tokens is not holding none — the same
	// refusal `format_cost` makes of a confident `$0.0000`.
	assert.equal(contextSpelling(40, 1_000_000), "<0.1%/1M");
	assert.equal(contextSpelling(12_977, 128_000), "10.1%/128k");
	assert.equal(contextSpelling(1_000_000, 1_000_000), "100.0%/1M");
});

/* ---- 6. context: the four honest states --------------------------------- */

test("no reading yet is a state, not a zero", () => {
	const reading = contextReading({
		context_tokens: null,
		context_window: 128_000,
	});
	assert.equal(reading.status, "no-reading");
	assert.equal(reading.fraction, null);
	assert.equal(reading.spelling, "");
	// Calm, because there is no reading to be alarmed about.
	assert.equal(reading.rung, "signal");
});

test("an unknown window yields absolute tokens and no arc", () => {
	const reading = contextReading({
		context_tokens: 240_000,
		context_window: null,
	});
	assert.equal(reading.status, "window-unknown");
	assert.equal(
		reading.fraction,
		null,
		"no denominator means no fraction to sweep",
	);
	assert.equal(reading.spelling, "240.0k/\u2014");
	// The absolute ladder still governs the colour.
	assert.equal(reading.rung, "label");
	const lines = contextTooltipLines(reading);
	assert.ok(
		lines.some((line) => /not known/.test(line)),
		lines.join(" | "),
	);
});

test("an estimate is marked, and a measurement is not", () => {
	const estimate = contextReading({
		context_tokens: 50_000,
		context_window: 128_000,
		context_is_estimate: true,
	});
	assert.equal(estimate.status, "estimate");
	assert.ok(
		contextTooltipLines(estimate).some((line) => /estimate/.test(line)),
	);
	const measured = contextReading({
		context_tokens: 50_000,
		context_window: 128_000,
		context_is_estimate: false,
	});
	assert.equal(measured.status, "measured");
	assert.ok(
		!contextTooltipLines(measured).some((line) => /estimate/.test(line)),
	);
});

test("a saturated window clamps the arc but not the number", () => {
	// The arc cannot sweep past its own circle; the tooltip must still say the
	// window is full, because that is the moment compaction is overdue.
	const reading = contextReading({
		context_tokens: 150_000,
		context_window: 128_000,
	});
	assert.equal(reading.fraction, 1);
	assert.equal(reading.rung, "danger");
	assert.equal(reading.spelling, "117.2%/128k");
});

test("the tooltip names the model maximum only when it differs from the budget", () => {
	// Repeating the same number under a second label reads as two facts and is
	// one.
	const reading = contextReading({
		context_tokens: 10_000,
		context_window: 200_000,
	});
	assert.ok(
		!contextTooltipLines(reading, 200_000).some((l) => /Model maximum/.test(l)),
	);
	assert.ok(
		contextTooltipLines(reading, 1_000_000).some((l) =>
			/Model maximum: 1M/.test(l),
		),
	);
});

/* ---- 7. the model name and the effort ladder ---------------------------- */

test("display_name wins, model_id is the fallback, and the selector is the tooltip", () => {
	assert.deepEqual(
		modelIdentity({
			provider: "anthropic",
			model_id: "claude-opus-5",
			display_name: "Claude Opus 5",
		}),
		{
			name: "Claude Opus 5",
			selector: "anthropic/claude-opus-5",
		},
	);
	// `""` means resolution found none, which is why readers fall back rather
	// than treat the field as authoritative.
	assert.equal(
		modelIdentity({ provider: "x", model_id: "m", display_name: "" }).name,
		"m",
	);
	// An older backend that never sends the field at all.
	assert.equal(modelIdentity({ provider: "x", model_id: "m" }).name, "m");
	// Nothing to name.
	assert.equal(modelIdentity({ provider: "", model_id: "" }), null);
	assert.equal(modelIdentity(null), null);
});

test("_effort_label's three states", () => {
	// An explicit level is the ordinary case.
	assert.equal(
		effortState({
			model_id: "m",
			reasoning_effort: "HIGH",
			reasoning_efforts: ["low", "high"],
		}).label,
		"high",
		"the label is lower-cased, as `str(explicit).strip().lower()`",
	);
	// A ladder with nothing set reads `auto` — the word `/effort auto` uses.
	assert.equal(
		effortState({
			model_id: "m",
			reasoning_effort: null,
			reasoning_efforts: ["low", "high"],
		}).label,
		"auto",
	);
	// A reasoning model with an EMPTY ladder: `reasoning` is all that can
	// honestly be said, and there is nothing to open.
	const noLadder = effortState({
		model_id: "m",
		reasoning: true,
		reasoning_effort: null,
		reasoning_efforts: [],
	});
	assert.equal(noLadder.label, "reasoning");
	assert.equal(
		noLadder.adjustable,
		false,
		"a picker with nothing in it is a dead control",
	);
	// A non-reasoning model renders nothing, which is what makes the chip's
	// presence informative.
	assert.equal(
		effortState({
			model_id: "m",
			reasoning: false,
			reasoning_effort: null,
			reasoning_efforts: [],
		}),
		null,
	);
});

test("an older backend with no ladder field degrades rather than claiming `auto`", () => {
	// A fourth state the Python has no equivalent for: the ladder is not empty,
	// it is UNKNOWN. `auto` asserts a ladder exists, so it is not available.
	const older = effortState({
		model_id: "m",
		reasoning_effort: null,
		reasoning_default_effort: "medium",
	});
	assert.equal(older.label, "medium");
	assert.equal(older.adjustable, false);
	// With no default either, there is nothing honest to show.
	assert.equal(effortState({ model_id: "m", reasoning_effort: null }), null);
	// But an explicit level on such a backend is still adjustable: the level
	// came from somewhere, so the owner's `/effort` knows the rungs.
	assert.equal(
		effortState({ model_id: "m", reasoning_effort: "low" }).adjustable,
		true,
	);
});

/* ---- 8. the captured payloads ------------------------------------------- */

test("every captured backend payload renders what the TUI would render", () => {
	// The rules above are what the Python says; this is what the wire carries.
	// See the fixture header for exactly how it was captured.
	assert.ok(
		CAPTURE.captures.length >= 5,
		"the capture set should not shrink silently",
	);
	for (const capture of CAPTURE.captures) {
		const where = `capture "${capture.name}"`;
		const expect = capture.expect;
		const cost = sessionCost(capture.state);
		if ("total" in expect)
			assert.equal(cost.total, expect.total, `${where}: total`);
		if ("knowledge" in expect)
			assert.equal(cost.knowledge, expect.knowledge, `${where}: knowledge`);
		if ("costText" in expect)
			assert.equal(cost.text, expect.costText, `${where}: cost text`);

		const reading = contextReading(capture.state);
		if ("spelling" in expect)
			assert.equal(reading.spelling, expect.spelling, `${where}: spelling`);
		if ("rung" in expect)
			assert.equal(reading.rung, expect.rung, `${where}: rung`);
		if ("contextStatus" in expect)
			assert.equal(
				reading.status,
				expect.contextStatus,
				`${where}: context status`,
			);

		if (capture.model) {
			const identity = modelIdentity(capture.model);
			if ("modelName" in expect)
				assert.equal(
					identity?.name ?? null,
					expect.modelName,
					`${where}: model name`,
				);
			if ("modelSelector" in expect)
				assert.equal(
					identity?.selector,
					expect.modelSelector,
					`${where}: selector`,
				);
			const effort = effortState(capture.model);
			if ("effort" in expect)
				assert.equal(effort?.label ?? null, expect.effort, `${where}: effort`);
			if ("effortAdjustable" in expect)
				assert.equal(
					effort?.adjustable,
					expect.effortAdjustable,
					`${where}: adjustable`,
				);
		}
	}
});

test("the captured floor state is the one that proves the knowledge ORDER", () => {
	// Called out separately because it is the fixture's most load-bearing row:
	// the real backend produced `cost_knowledge: floor` alongside
	// `subagent_cost_knowledge: exact`, so a port that consulted the child
	// ledger first would report this session's spend as exact.
	const capture = CAPTURE.captures.find(
		(c) => c.state.cost_knowledge === "floor",
	);
	assert.ok(capture, "the capture set must keep a floor state");
	assert.equal(capture.state.subagent_cost_knowledge, "exact");
	assert.equal(sessionCost(capture.state).isFloor, true);
	assert.ok(sessionCost(capture.state).text.startsWith(FLOOR_MARK));
});

/* ---- 9. rounding: the mode, at every tie the strip can print -------------- */

/*
 * Round 1 shipped with 31 tests and none of them pinned a TIE, which is the
 * only class of input where a rounding MODE is observable. That is why
 * `toFixed` (half away from zero) passed review while disagreeing with Python
 * (half to even, on the exact binary value) once per 351 token counts on a 32k
 * window — the strip printed `1.3%/200k` where the real TUI band printed
 * `1.2%/200k` for the same session state.
 *
 * `scripts/fixtures/session-status-rounding-ties.json` holds the ties and the
 * string real Python prints for each. Every expected value in it came OUT of
 * the imported Python functions; none was typed by hand.
 */

test("pyFixed reproduces Python's half-to-even at exact ties", () => {
	// The ties the review and QA named specifically, spelled through the shared
	// formatter rather than through any one caller.
	assert.equal(pyFixed(0.5625, 3), "0.562");
	assert.equal(pyFixed(158.25, 1), "158.2");
	assert.equal(pyFixed(1.25, 1), "1.2");
	assert.equal(pyFixed(1.125, 2), "1.12");
	assert.equal(pyFixed(0.0625, 3), "0.062");
	// Half-to-even rounds UP when the quotient is odd, so the rule is not
	// "ties always go down" — a test that only pinned downward ties would pass
	// against truncation.
	assert.equal(pyFixed(0.375, 2), "0.38");
	assert.equal(pyFixed(1.375, 2), "1.38");
});

test("pyFixed follows the BITS, not the literal, at near-ties", () => {
	/*
	 * This is the assertion that rules out `Intl.NumberFormat`'s `halfEven`,
	 * which was the obvious fix and is wrong: it rounds the shortest decimal
	 * representation, so it treats a literal that merely LOOKS like a tie as
	 * one. Python follows the stored double.
	 */
	for (const { value, digits, py } of TIES.nearTies.cases) {
		assert.equal(pyFixed(value, digits), py, `near-tie ${value} .${digits}f`);
	}
	// Spelled out, so the reason survives a fixture edit: 12.345 is stored as
	// 12.34500000000000064, i.e. ABOVE the midpoint, so it rounds up despite
	// looking like a downward tie.
	assert.equal(pyFixed(12.345, 2), "12.35");
	assert.equal(pyFixed(2.675, 2), "2.67");
});

test("every context percentage tie prints what Python prints", () => {
	assert.ok(
		TIES.percent.length >= 50,
		"the tie set should not shrink silently",
	);
	for (const { tokens, window, py } of TIES.percent) {
		assert.equal(
			contextSpelling(tokens, window),
			`${py}/${formatWindow(window)}`,
			`percent tie ${tokens}/${window}`,
		);
	}
	// The reviewer's and QA's own reproductions, named rather than left to the
	// sweep, so a regression report can point at a line.
	assert.equal(contextSpelling(500, 200_000), "0.2%/200k");
	assert.equal(contextSpelling(2_500, 200_000), "1.2%/200k");
	assert.equal(contextSpelling(320, 128_000), "0.2%/128k");
	assert.equal(contextSpelling(2_048, 32_768), "6.2%/32.8k");
});

test("every token and window tie prints what Python prints", () => {
	for (const { tokens, py } of TIES.tokens)
		assert.equal(formatContextTokens(tokens), py, `token tie ${tokens}`);
	for (const { window, py } of TIES.window)
		assert.equal(formatWindow(window), py, `window tie ${window}`);
	// QA's reproduction: 158250 through the tokens formatter.
	assert.equal(formatContextTokens(158_250), "158.2k");
	assert.equal(formatContextTokens(1_250_000), "1.2m");
	assert.equal(formatWindow(1_250_000), "1.2M");
});

test("every cost tie prints what Python prints, in all three magnitude bands", () => {
	const bands = new Set();
	for (const { value, py } of TIES.cost) {
		assert.equal(formatCost(value), py, `cost tie ${value}`);
		bands.add(value < 0.01 ? "sub-cent" : value < 1 ? "sub-dollar" : "dollar");
	}
	// A tie set that only exercised one magnitude would leave two `toFixed`
	// calls unmeasured; `format_cost` switches precision twice.
	assert.ok(bands.has("sub-dollar"), "no sub-dollar tie in the set");
	assert.ok(bands.has("dollar"), "no dollar-magnitude tie in the set");
	assert.equal(formatCost(0.5625), "$0.562");
	assert.equal(formatCost(0.0625), "$0.062");
	assert.equal(formatCost(1.125), "$1.12");
});

test("no reading anywhere in the strip is spelled with toFixed", () => {
	/*
	 * The rule this file exists to protect is "one rounding mode, one
	 * implementation". A future edit that reaches for `toFixed` in any of the
	 * mirror modules would reintroduce R1/Q1 silently — every existing
	 * assertion above would still pass, because they pin VALUES and a new call
	 * site is a new value nobody pinned yet.
	 */
	const sources = [
		"session-cost.ts",
		"session-context.ts",
		"session-model.ts",
		"session-status-strip.tsx",
		"context-wheel.tsx",
	];
	for (const name of sources) {
		const text = readFileSync(
			join(ROOT, "src/renderer/src/features/chat/session-status", name),
			"utf8",
		);
		// `fixed-point.ts` names it in prose; these five must not CALL it.
		assert.ok(
			!/\.toFixed\s*\(/.test(text),
			`${name} calls toFixed; every reading must go through pyFixed`,
		);
	}
});

/* ---- 10. naming, cold snapshots and the picker's veto ------------------- */

/** A catalogue row as `refresh_model_catalogue` publishes it. */
const CATALOGUE = [
	{ provider: "anthropic", model_id: "claude-opus-5", label: "Claude Opus 5" },
	{
		provider: "openrouter",
		model_id: "openai/gpt-5",
		// What `model_label` returns for a RESELLER: it refuses to borrow the
		// model's name for a route, so the label is the selector again.
		label: "openrouter/openai/gpt-5",
	},
];

test("the model name comes from the catalogue when the spec has none", () => {
	// Q2/U1: the band supplies a curated name through `format_model_label`
	// exactly when metadata resolution gave none, and the catalogue's `label`
	// IS that pass, computed backend-side.
	const cold = {
		provider: "anthropic",
		model_id: "claude-opus-5",
		display_name: "",
	};
	assert.equal(modelIdentity(cold, CATALOGUE).name, "Claude Opus 5");
	assert.equal(
		modelIdentity(cold, CATALOGUE).selector,
		"anthropic/claude-opus-5",
	);
	// Without a catalogue there is nothing better than the id, and that is the
	// honest floor rather than an invented name.
	assert.equal(modelIdentity(cold, undefined).name, "claude-opus-5");
	assert.equal(modelIdentity(cold, []).name, "claude-opus-5");
});

test("the spec's own display_name still wins over the catalogue", () => {
	const warm = {
		provider: "anthropic",
		model_id: "claude-opus-5",
		display_name: "Claude Opus 5 (preview)",
	};
	assert.equal(modelIdentity(warm, CATALOGUE).name, "Claude Opus 5 (preview)");
});

test("a catalogue label that is just the selector is not treated as a name", () => {
	// `model_label` returns the selector when it refuses to name a reseller's
	// route. Printing that in the chip would be strictly worse than the id.
	const route = {
		provider: "openrouter",
		model_id: "openai/gpt-5",
		display_name: "",
	};
	assert.equal(modelIdentity(route, CATALOGUE).name, "openai/gpt-5");
});

test("a catalogue row matches on provider AND model_id", () => {
	// An aggregator's model_id carries its own slashes, so a joined selector
	// cannot be split back apart reliably.
	const other = [
		{ provider: "openai", model_id: "gpt-5", label: "WRONG ROW" },
		{
			provider: "openrouter",
			model_id: "openai/gpt-5",
			label: "OpenAI: GPT-5",
		},
	];
	assert.equal(
		modelIdentity(
			{ provider: "openrouter", model_id: "openai/gpt-5", display_name: "" },
			other,
		).name,
		"OpenAI: GPT-5",
	);
});

test("a cold snapshot reports effort as unknown, not as absent", () => {
	/*
	 * U1: `GET /sessions/{id}` answers with a selector and every metadata field
	 * empty, for a model that in fact has a full ladder. Round 1 read that as
	 * "no ladder" and rendered nothing, so the effort chip vanished after every
	 * reload until the next turn ran.
	 */
	const cold = effortState({
		provider: "openai",
		model_id: "gpt-5-mini",
		display_name: "",
		reasoning: false,
		reasoning_efforts: [],
		reasoning_effort: null,
		reasoning_default_effort: null,
	});
	assert.ok(cold, "a cold snapshot must still render a reading");
	assert.equal(cold.label, "unknown");
	assert.equal(cold.adjustable, false);

	// And a GENUINE non-reasoning model - which always arrives with a real
	// display_name - still renders nothing, so the chip's presence stays
	// informative.
	assert.equal(
		effortState({
			provider: "openai",
			model_id: "gpt-4o-mini",
			display_name: "OpenAI: GPT-4o-mini",
			reasoning: false,
			reasoning_efforts: [],
			reasoning_effort: null,
			reasoning_default_effort: null,
		}),
		null,
	);
});

test("the picker's empty ladder vetoes the chip's offer", () => {
	// U3: the stream said four rungs while `commands.entities` said none, so the
	// chip offered a control the picker then refused. The picker's list wins on
	// adjustability, because it is the one `/effort <value>` validates against.
	const offered = effortState({
		provider: "openrouter",
		model_id: "openai/gpt-5-mini",
		display_name: "OpenAI: GPT-5 Mini",
		reasoning: true,
		reasoning_efforts: ["minimal", "low", "medium", "high"],
		reasoning_effort: null,
		reasoning_default_effort: null,
	});
	assert.equal(offered.adjustable, true, "the stream's own reading");

	const vetoed = reconcileEffort(offered, []);
	assert.equal(vetoed.adjustable, false);
	assert.equal(vetoed.label, offered.label, "the level in force is still true");

	// Pending is NOT empty: an unresolved query must not flicker the chip to
	// inert on every mount.
	assert.equal(reconcileEffort(offered, undefined).adjustable, true);
	// A non-empty list leaves the reading exactly as the stream stated it.
	assert.deepEqual(reconcileEffort(offered, [{ value: "high" }]), offered);
	// Nothing to reconcile stays nothing.
	assert.equal(reconcileEffort(null, []), null);
});
