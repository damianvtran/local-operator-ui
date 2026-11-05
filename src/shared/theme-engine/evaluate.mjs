/**
 * The contrast contract's PER-PALETTE assertions, as a function.
 *
 * WHY THIS FILE EXISTS. The theme composition engine (`compose.mjs`) re-solves
 * a built-in palette at a contrast preset, or a user's custom theme, in the
 * RENDERER. It may never return a palette that fails a legibility floor, and the
 * only honest definition of "fails a floor" is the gate's own: the same tables
 * (`contract-tables.mjs`) evaluated by the same code. A second, re-typed
 * evaluator would be green about palettes the gate rejects, and vice versa. So
 * the per-palette loop that was the body of `scripts/contrast-contract.mjs`
 * moved here verbatim, and the contract calls `evaluatePalette` once per palette
 * on one shared `run` - its Standard output is byte-identical to the pre-move
 * contract's (192,000 assertions after #1668 was ported in).
 *
 * WHAT STAYS IN THE CONTRACT: everything that is not about ONE palette - the
 * stylesheet-reading checks (the arrival band's alpha and lift, the panel seam class), the §5b fleet
 * rules across palettes, window glass, the staleness checks that read the
 * consulted-pin sets after the run, and the report.
 *
 * CONSTRAINTS.
 *  - No `fs`, no `process`: the renderer imports this module.
 *  - A composed run (`createRun({ composed: true })`) asserts every floor; it
 *    skips only what is a claim about the AUTHORED values - the L* band - and
 *    reads pins as "never worse than authored" (see `pinMatches`).
 *  - The body was moved mechanically and kept as written, including its
 *    comments, so a later edit to a floor's reasoning has one place to go.
 */
import { deltaE, isHex, over, r2, ratio, toLab } from "./color.mjs";
import {
	ADJACENT,
	ALT_ACCENT_CHROMA_FLOOR,
	ARRIVAL_BAND_ALPHA,
	AS_TEXT,
	CHART_HOVER_GROUND,
	CHART_HOVER_SEPARATION_FLOOR,
	COMMAND_TOKEN,
	COMMAND_TOKEN_FLOOR,
	COMMAND_TOKEN_GROUNDS,
	COMMAND_TOKEN_PINNED,
	CONTROLS,
	CONTROL_EDGE_PINNED,
	DISABLED_CEILING,
	ELEVATED_PANEL_DELTA_E,
	EXCEPTIONS,
	EXEMPT_INK,
	FIELD_SEPARATION_FLOOR,
	FLOOR,
	GRAPHICS,
	GROUNDS,
	GROUNDS6,
	GROUND_RATIO,
	GROUND_STEP_DELTA_E,
	HAIRLINE_RATIO_CEILING,
	HAIRLINE_RATIO_FLOOR,
	HOVER_DELTA_E,
	IDENTITY_PAIR_FLOOR,
	INKS,
	INK_CANVAS_FLOOR,
	INK_STEP_DELTA_E,
	INK_STEP_FLOOR,
	INK_STEP_PINNED,
	KEYCAP_DELTA_E,
	LIFT,
	LINE_SEPARATION_FLOOR,
	LIVENESS_PAIR_FLOOR,
	MEDIA_SURFACE_DELTA_E,
	MEDIA_SURFACE_LIGHTNESS_STEP,
	MESSAGE_SURFACE_DELTA_E,
	MESSAGE_SURFACE_LIGHTNESS_STEP,
	PAIR_PINS,
	PANEL_SEAM_ALPHA,
	PERCEPTIBLE,
	PERCEPTIBLE_EXCEPTIONS,
	REGION_SEPARATION_FLOOR,
	REQUIRED_ROLES,
	ROW_HOVER_CAST_FLOOR_SHARE,
	ROW_HOVER_CHROMA_FLOOR,
	ROW_HOVER_STEP_FLOOR,
	ROW_HOVER_STEP_SHARE_FLOOR,
	ROW_PAIR_SEPARATION,
	ROW_SELECTED_CHROMA_FLOOR,
	ROW_SELECTED_CHROMA_RISE,
	ROW_SELECTED_STEP_CEILING,
	ROW_SELECTED_STEP_FLOOR,
	ROW_STATE_ACCENTLESS,
	ROW_STATE_CHROMA_CAP,
	ROW_STATE_CHROMA_CAP_SLACK,
	ROW_STATE_CHROMA_FLOOR_SLACK,
	ROW_STATE_CHROMA_RANK,
	ROW_STATE_FLOOR_UNREACHABLE,
	ROW_STATE_HOVER_RANK,
	ROW_STATE_HUE_LIMIT,
	ROW_STATE_MEASURED_SHORTFALL,
	ROW_STATE_NEUTRAL_PANEL,
	ROW_STATE_STEP_SLACK,
	ROW_STATE_WASH_FLOOR,
	SEAM_PAIRS,
	SELECTION_DELTA_E,
	SELECTION_LIGHTNESS_STEP,
	SEPARABLE,
	SEPARATION_FLOOR,
	STEP,
	STRUCTURAL,
	SYNTAX_COMMENT_FLOOR,
	SYNTAX_HUE_ROLES,
	TERMINAL_PAIRS,
} from "./contract-tables.mjs";

/**
 * One run's state: the failure log, the assertion count, and the consulted-pin
 * sets the contract's staleness checks read after every palette has been seen.
 *
 * `composed` is true when the palettes under test are COMPOSED (a contrast
 * preset applied over a built-in, or a user's custom theme) rather than the
 * authored sources. See `pinMatches` for the one rule that changes.
 */
export const createRun = ({ composed = false } = {}) => {
	const run = { assertions: 0, failures: 0, composed };
	/*
	 * PINNED EXCEPTIONS ON A COMPOSED PALETTE: "never worse than authored".
	 * A pin records the ratio or ΔE00 an AUTHORED palette measures, and matches
	 * it to the hundredth so a moved value re-opens the exemption. A composed
	 * palette moved its values on purpose, so an exact match can never hold -
	 * and failing every pin would bury the real findings, while dropping pins
	 * would silently waive them. So on a composed run a pin covers a reading
	 * that is AT LEAST its recorded value (minus the usual hundredth): the
	 * composition may not make a pinned shortfall worse, which is the whole of
	 * what the pin ever granted. On an authored run the match stays exact.
	 */
	const pinMatches = (recorded, got) =>
		composed ? got >= recorded - 0.01 : Math.abs(recorded - got) < 0.01;
	/*
	 * The ledger rows (`ROW_STATE_MEASURED_SHORTFALL`, `COMMAND_TOKEN_PINNED`,
	 * `INK_STEP_PINNED`) are the same kind of claim, with their own tolerance, and
	 * get the same composed reading: the shortfall may not get worse. Their
	 * "stale: the palette now clears the floor" checks are authored-only, because
	 * a preset that happens to clear a recorded shortfall is an improvement, not a
	 * dead ledger row.
	 */
	const ledgerHolds = (recorded, got, tolerance) =>
		composed
			? got >= recorded - tolerance
			: Math.abs(recorded - got) <= tolerance;
	/** Entries consulted during the run, so an exception that stops firing is caught. */
	const perceptibleSeen = new Set();

	const findPerceptibleException = (theme, role, ground, got) => {
		const hit = PERCEPTIBLE_EXCEPTIONS.find(
			(e) =>
				e.theme === theme &&
				e.role === role &&
				e.ground === ground &&
				pinMatches(e.got, got),
		);
		if (hit) perceptibleSeen.add(hit);
		return hit;
	};

	/** `PAIR_PINS` entries consulted during the run, for the same staleness guard. */
	const pairPinSeen = new Set();

	const findPairPin = (theme, a, b, got) => {
		const hit = PAIR_PINS.find(
			(e) =>
				e.theme === theme && e.a === a && e.b === b && pinMatches(e.got, got),
		);
		if (hit) pairPinSeen.add(hit);
		return hit;
	};

	/** Every palette whose ink step was MEASURED - the stale check's theme-existence set. */
	const inkStepSeen = new Set();

	/**
	 * The pins the run actually looked up, which is what the summary line reports. The
	 * two sets are not the same thing and the difference is the whole of review round
	 * 2's F1: every measured palette is added to `inkStepSeen`, so printing ITS size
	 * reported 59 pinned ink steps against a table with no rows - a headline asserting
	 * a pin population the tree does not have, one field to the right of the fix made
	 * for exactly that. A pin whose theme is gone is never looked up, so it cannot be
	 * counted here, and the stale check below fails it.
	 */
	const inkStepPinSeen = new Set();

	const controlEdgeSeen = new Set();

	/**
	 * The identity of one pinned measurement: which control, on which ground, in which
	 * palette. Used for BOTH the match and the stale check so the two cannot disagree
	 * about what a pin covers - the defect review round 3's A-2 named, one key along.
	 */
	const controlEdgeKey = (control, ground, theme) =>
		`${control} on ${ground} in ${theme}`;

	/* ---- 5. the run --------------------------------------------------------- */

	const log = [];

	const fail = (msg) => {
		run.failures++;
		log.push(`FAIL  ${msg}`);
	};

	/*
	 * Entries consulted during the run.
	 *
	 * The consultation is what makes a pin removable. `assertPair` returns the
	 * moment the raw ratio clears its floor, so an exception whose palette has been
	 * fixed is never looked up - and a table that only checks the entry still
	 * DESCRIBES something (the theme still exists, the pair still measures what the
	 * row says) will keep a dead row alive for as long as nobody asks. Counted here,
	 * failed below. Its siblings `perceptibleSeen`, `controlEdgeSeen` and
	 * `inkStepPinSeen` are the same mechanism - each holds the entries the run
	 * CONSULTED rather than the entries the table declares - and this table was the one
	 * missing it. The remaining set, `inkStepSeen`, is deliberately not one of them: it
	 * holds the palettes whose ink step was measured, which is the question the ink-step
	 * stale check asks, and the summary line reads `inkStepPinSeen` instead precisely
	 * because the two are not interchangeable.
	 */
	const exceptionSeen = new Set();

	const findException = (theme, fg, bg, got) => {
		const hit = EXCEPTIONS.find(
			(e) =>
				e.theme === theme &&
				e.fg === fg &&
				e.bg === bg &&
				pinMatches(e.got, got),
		);
		if (hit) exceptionSeen.add(hit);
		return hit;
	};

	/*
	 * Compare the raw ratio; round only to report it.
	 *
	 * Rounding first quietly widens every floor in this file by half a hundredth:
	 * 4.4951 becomes 4.5 and clears a 4.5 floor it does not actually meet. That is
	 * a gate reporting on its own rounding rather than on the palette, and it is
	 * exactly how `localOperatorLight`'s 1.02666 ground separation passed a 1.03
	 * requirement. The displayed value stays rounded because three decimal places
	 * of a contrast ratio are noise to the person reading the failure.
	 */
	const assertPair = (theme, p, fg, bg, floor, label) => {
		const a = p[fg];
		const b = p[bg];
		if (!isHex(a) || !isHex(b)) return;
		run.assertions++;
		const raw = ratio(a, b);
		if (raw >= floor) return;
		const got = r2(raw);
		if (findException(theme, fg, bg, got)) return;
		fail(
			`${theme}: ${label} — ${fg} ${a} on ${bg} ${b} = ${got}:1, need ${floor}:1`,
		);
	};

	/**
	 * Two ROLES that must be told apart, rather than an ink on a ground.
	 *
	 * The other instrument, and the one the pair floors need: `ratio` is
	 * luminance-only, so two roles can be equally legible on every ground and still
	 * be the same colour to a reader — which is the whole of the tool row's
	 * defect. `label` comes from the floors' own constants, so a pin records the
	 * FLOOR it was granted under and not just a number: a pin whose floor no longer
	 * matches the assertion reaching it fails here rather than quietly relaxing a
	 * bound that was raised since it was written.
	 */
	const assertIdentityPair = (theme, p, a, b, floor, label) => {
		const va = p[a];
		const vb = p[b];
		if (!isHex(va) || !isHex(vb)) return;
		run.assertions++;
		const got = r2(deltaE(va, vb));
		if (got >= floor) return;
		const pin = findPairPin(theme, a, b, got);
		if (pin) {
			if (pin.floor !== floor) {
				fail(
					`${theme}: \`${a}\`/\`${b}\` is pinned at floor ${pin.floor} but this assertion asks for ${floor} — a pin records the bound it was granted under, so the pin and the floor have to be raised together`,
				);
			}
			return;
		}
		fail(
			`${theme}: ${label} — \`${a}\` ${va} and \`${b}\` ${vb} are ΔE00 ${got} apart (need ${floor}) — two roles a reader has to tell apart at this site cannot be one colour at two weights; move the palette value, or pin the palette in \`PAIR_PINS\` with the constraint that refuses it`,
		);
	};

	/* A ledger row is a CLAIM, and a claim that is not needed any more is a defect:
	   these read the tables above and refuse to let one outlive its cause. */
	const floorUnreachablePin = (id, role) => {
		const row = ROW_STATE_FLOOR_UNREACHABLE.find(
			(r) => r.id === id && r.role === role,
		);
		return row ?? null;
	};

	const shortfallPin = (id, role, bound) => {
		const row = ROW_STATE_MEASURED_SHORTFALL.find(
			(r) => r.id === id && r.role === role && r.bound === bound,
		);
		return row ?? null;
	};

	/*
	 * What the per-palette assertions CLAIM as they run: one key per ledger row,
	 * `id:role:bound`. The fleet section at the end reads it, so a ledger row that
	 * no longer describes anything fails the gate instead of sitting there.
	 */
	const pinClaims = new Set();
	Object.assign(run, {
		pinMatches,
		ledgerHolds,
		log,
		fail,
		exceptionSeen,
		perceptibleSeen,
		pairPinSeen,
		inkStepSeen,
		inkStepPinSeen,
		controlEdgeSeen,
		controlEdgeKey,
		pinClaims,
		findException,
		findPerceptibleException,
		findPairPin,
		assertPair,
		assertIdentityPair,
		floorUnreachablePin,
		shortfallPin,
	});
	return run;
};

/**
 * Assert every per-palette floor in the contract over ONE palette, into `run`.
 *
 * This is the contract's per-palette loop body, moved verbatim (only the run
 * counters are qualified). The single-entry `for` keeps the body's own
 * `continue` statements meaning what they meant in the loop.
 */
export const evaluatePalette = (run, entry) => {
	const {
		fail,
		assertPair,
		assertIdentityPair,
		findException,
		findPerceptibleException,
		floorUnreachablePin,
		shortfallPin,
		pinClaims,
		inkStepSeen,
		inkStepPinSeen,
		controlEdgeSeen,
		controlEdgeKey,
		pinMatches,
		ledgerHolds,
	} = run;
	for (const { id, palette: p } of [entry]) {
		/* Completeness first. A missing role is a worse defect than a low ratio,
	   because it silently falls through to MUI's stock palette — which is how
	   this app shipped a blue `info` that appeared in no theme file. */
		for (const role of REQUIRED_ROLES) {
			run.assertions++;
			if (!(role in p)) fail(`${id}: missing required role \`${role}\``);
		}

		/*
		 * Ink on every ground, the EIGHT of them.
		 *
		 * `accentWash` and `highlight` are grounds a body ink is genuinely read on
		 * - a keycap on a selected row, a reading button on its own hover fill, the
		 * selected sidebar row, the chip labels in the composer - and they were not
		 * measured here until this pass, which is exactly how `inkDim` came to sit
		 * at 3.91:1 on a selected row in `cyberpunk` with every gate green.
		 */
		for (const [inkRole, floor] of INKS) {
			if (EXEMPT_INK.has(inkRole)) continue;
			for (const g of GROUNDS6) {
				assertPair(id, p, inkRole, g, floor, "body ink");
			}
		}

		/* The four grounds must be distinguishable from each other, since
	   elevation in this system is a lightness step and not a shadow. This is a
	   separation floor rather than a contrast floor: adjacent steps only need
	   to be perceptibly different, not legible against each other. */
		for (let i = 0; i < GROUNDS.length; i++) {
			for (let j = i + 1; j < GROUNDS.length; j++) {
				const a = p[GROUNDS[i]];
				const b = p[GROUNDS[j]];
				if (!isHex(a) || !isHex(b)) continue;
				run.assertions++;
				if (ratio(a, b) < 1.03) {
					fail(
						`${id}: grounds \`${GROUNDS[i]}\` ${a} and \`${GROUNDS[j]}\` ${b} are indistinguishable (${r2(ratio(a, b))}:1) — elevation is a lightness step here, so they must differ`,
					);
				}
			}
		}

		/*
		 * THE TWO ROW STATES, asserted.
		 *
		 * Every bound in the constants above is applied here, per palette and per
		 * role, and every failure names the rule and the number. The order is the
		 * order a reader debugging a value needs it in: what the value IS (hue,
		 * cast), then how far it is from the panel in both channels, then how far
		 * from its sibling state, then how far from the wash it must not merge with.
		 *
		 * WHAT THIS LOOP NO LONGER ASSERTS, and why. Two of the three were collision
		 * floors, and both are the direction's structural consequence rather than a
		 * relaxation of convenience:
		 *
		 *   - the ΔE00 band off `surface` at 4.0 - withdrawn rather than lowered. A
		 *     fill at the panel's own hue and cast reaches it on 40 of the 59 palettes
		 *     and bottoms at 2.08, so it is not a floor a backdrop-relative fill can
		 *     hold; the shipped values only met it by leaving the panel's colour
		 *     family. `FIELD_SEPARATION_FLOOR` is what replaces it, plus the two step
		 *     floors and the two rank floors.
		 *   - the `canvas` / `elevated` / `sunken` collision floor (ΔE00 1.0). A fill
		 *     that is the panel's own colour one step up IS a rung of the ladder -
		 *     the sentence this contract already carried for the neutral class,
		 *     generalised to every palette - and 7 of the 59 breach it under the rule
		 *     (`alucard` 0.44 against `sunken`, `arcade` 0.0 against `elevated`,
		 *     `duskfox` 0.47, `kanagawaLotus` 0.83, `rosePine` 0.85, `tokyoNightDay`
		 *     0.51) where the shipped values escaped only by being rotated to a
		 *     different hue. THE WITHDRAWAL'S ARGUMENT USED TO BE THAT THESE PAIRS
		 *     NEVER OCCUR INSIDE ONE LIST, AND THAT SENTENCE WAS FALSE: the app rail's
		 *     own `<nav>` was `bg-sunken` and the agent-hub categories rail was on
		 *     `canvas`, and both of them are LISTS whose rows carry these two roles, so
		 *     the row sat directly on the rung - measured at ΔE00 0.44 (`alucard`, the
		 *     rail) and 0.83 (`kanagawaLotus`, categories), and on 13 of the 59 the
		 *     hovered row read at least as far off the rail's ground as the row the
		 *     reader was ON. THE FIX IS THE RULE THE DIRECTION STATES, not a value: a
		 *     surface that paints these two roles wears `surface`, so both of those
		 *     surfaces were re-grounded (`shared/components/navigation/
		 *     sidebar-navigation.tsx`, and the categories column in
		 *     `features/agent-hub/agent-hub-page.tsx`), the rail taking
		 *     `border-r border-hairline` for the boundary the tonal step used to carry.
		 *     The `rowCurrent` surfaces are therefore on `surface`: the chat
		 *     sidebar, the app rail, the categories rail, the agents
		 *     sidebar and the agents page's roster.
		 *     WHAT THE WITHDRAWAL STILL ACCEPTS is the one ground class that is not a
		 *     row's backdrop at all: a SELECTED ROW CAN BE THE SAME COLOUR AS A
		 *     DIALOG'S GROUND OR AN INPUT WELL. `elevated` keeps its exemption because
		 *     a menu, popover, tooltip, dialog or drawn card is not a row's plane and
		 *     no row is painted on one; this panel's own `elevated` use is the
		 *     `· lopdev` cap and the `⋯` button, both text-sized rather than full-width
		 *     rows. The two `hover`-only sites that still ride a rung are recorded
		 *     rather than re-grounded, with their numbers, in
		 *     `scripts/chat-sidebar-selection.test.mjs`'s `HOVER_STATES_ON_A_RUNG`:
		 *     the canvas document-tab strip and the schedules page's legacy annex.
		 *   - the two `accent`-bar ratios (`ROW_STATE_BAR_FLOOR`,
		 *     `ROW_STATE_BAR_DELTA_E`) - retired with the bar. They never measured the
		 *     bar being visible; they measured the FILL being distinct enough for a bar
		 *     to sit on, and the fill now has to rank the pair itself.
		 */
		const ROW_ROLE_RULES = [
			{
				role: "rowHover",
				/*
				 * The hover's cast: a FRACTION of the panel's, floored at the rule's
				 * own 2.5 for a panel with no cast to take a fraction of. Its ceiling
				 * is the panel's own cast, with the same absolute term underneath: a
				 * hover may be lighter than its ground, it may not be a more coloured
				 * plane than it.
				 */
				castFloor: (panelChroma) =>
					Math.max(
						ROW_HOVER_CHROMA_FLOOR,
						ROW_HOVER_CAST_FLOOR_SHARE * panelChroma,
					),
				castCeiling: (panelChroma) =>
					Math.max(panelChroma, ROW_HOVER_CHROMA_FLOOR),
				stepFloor: ROW_HOVER_STEP_FLOOR,
				stepCeiling: null,
			},
			{
				role: "rowSelected",
				/*
				 * The selection's cast: the panel's own plus a bounded rise of 4 - the
				 * one axis on which a row may be more coloured than its backdrop, and
				 * what buys the pair's rank where the ink floors leave no `L*` room -
				 * floored at 5.0 for a cast-less panel and capped at the flat 24. The
				 * ceiling is the rule's own clamp rather than `C*(surface) + 4` alone:
				 * on a panel with no cast the formula yields the 5.0 FLOOR, so a
				 * ceiling written as `min(C*(surface) + 4, 24)` would sit below its own
				 * floor on two palettes (`oneLight` and `highContrastLight`, both panels
				 * at C* 0.00).
				 */
				castFloor: (panelChroma) =>
					Math.max(ROW_SELECTED_CHROMA_FLOOR, panelChroma),
				castCeiling: (panelChroma) =>
					Math.min(
						Math.max(
							panelChroma + ROW_SELECTED_CHROMA_RISE,
							ROW_SELECTED_CHROMA_FLOOR,
						),
						ROW_STATE_CHROMA_CAP,
					),
				stepFloor: ROW_SELECTED_STEP_FLOOR,
				stepCeiling: ROW_SELECTED_STEP_CEILING,
			},
		];
		for (const rowRule of ROW_ROLE_RULES) {
			const role = rowRule.role;
			const value = p[role];
			if (!isHex(value)) continue;
			const [l, a, b] = toLab(value);
			const [panelL, panelA, panelB] = toLab(p.surface);
			const [, accentA, accentB] = toLab(p.accent);
			const accentChroma = Math.hypot(accentA, accentB);
			const panelChroma = Math.hypot(panelA, panelB);
			const chroma = Math.hypot(a, b);
			const castFloor = rowRule.castFloor(panelChroma);
			const castCeiling = rowRule.castCeiling(panelChroma);
			/* The NEUTRAL CLASS, derived from the panel rather than named. */
			const neutral = panelChroma < ROW_STATE_NEUTRAL_PANEL;

			/* 1. The hue, and where it is allowed to come from. The PANEL's, because
		      a state of a row has to be a colour the row's own backdrop has; the
		      `accent`'s only where the panel has no cast of its own (C* <
		      ROW_STATE_NEUTRAL_PANEL) AND the accent has one to speak with. The
		      authored values sit at the source hue exactly; the hex round trip
		      costs up to 8.57 degrees of it (measured, `autumn`'s hover), which is
		      why the limit is not the thing the values press against. */
			run.assertions++;
			const hueSource =
				panelChroma >= ROW_STATE_NEUTRAL_PANEL
					? { name: "the panel's", hue: Math.atan2(panelB, panelA) }
					: accentChroma >= ROW_STATE_ACCENTLESS
						? { name: "`accent`'s", hue: Math.atan2(accentB, accentA) }
						: { name: "the panel's", hue: Math.atan2(panelB, panelA) };
			const rowHue = Math.atan2(b, a);
			const hueOff = Math.abs(
				((((rowHue - hueSource.hue) * 180) / Math.PI + 540) % 360) - 180,
			);
			if (chroma >= ROW_STATE_NEUTRAL_PANEL && hueOff > ROW_STATE_HUE_LIMIT) {
				fail(
					`${id}: \`${role}\` ${value} sits ${r2(hueOff)} degrees off ${hueSource.name} hue (the limit is ${ROW_STATE_HUE_LIMIT}) — a row state has to be the colour of the backdrop it is a state of, and the values this round replaced took the \`accent\`'s hue instead, which is more than 45 degrees off the panel on 25 of the 59 palettes and is the off-colour the operator reported. Take the hue from ${hueSource.name} and re-author the value at it`,
				);
			}

			/* 2a. The cast FLOOR - the bound this file was missing, and the reason the
		      operator's report was possible. A row state carries AT LEAST half its
		      panel's cast (and never less than the rule's own floor), so a fill can
		      no longer read as a grey wash of the surface it sits on while passing
		      the gate: the shipped hover measured C* 4.79 against `tokyoNight`'s
		      panel of 13.44, and the ΔE00 7.05 it was scored on *was* that removal
		      (ΔL* +1.72 against ΔC* -8.65). */
			run.assertions++;
			if (castFloor > castCeiling + 1e-9) {
				/*
				 * The floor is ABOVE the ceiling: no authored value can hold both, so
				 * the value sits at the ceiling and the row is a LEDGER entry rather
				 * than an exemption. A palette in this position with no entry is a
				 * palette that has to be re-authored.
				 */
				pinClaims.add(`${id}:${role}:floor`);
				run.assertions++;
				const pin = floorUnreachablePin(id, role);
				if (!pin) {
					fail(
						`${id}: \`${role}\` ${value} carries C* ${r2(chroma)}, and its cast floor ${r2(castFloor)} is ABOVE its ceiling ${r2(castCeiling)} — the panel's own cast is louder than this role is allowed to be, so the value has to sit at the ceiling and \`${id}\`'s \`${role}\` has to be in ROW_STATE_FLOOR_UNREACHABLE naming the constraint that refuses the floor (the flat cap, the rise, or the role's absolute term)`,
					);
				}
				run.assertions++;
				if (chroma < castCeiling - ROW_STATE_CHROMA_CAP_SLACK) {
					fail(
						`${id}: \`${role}\` ${value} carries C* ${r2(chroma)} where its cast floor ${r2(castFloor)} is above its ceiling ${r2(castCeiling)} — the floor cannot be held, but the CEILING is reachable and is what the ledger row promises this value sits at`,
					);
				}
			} else if (chroma < castFloor - ROW_STATE_CHROMA_FLOOR_SLACK) {
				fail(
					`${id}: \`${role}\` ${value} carries C* ${r2(chroma)}, under the cast floor ${r2(castFloor)} — a row state has to carry the cast of the panel it sits on, and a fill quieter than its own backdrop reads as a grey wash of that backdrop. This is the defect that was reachable because the two \`ROW_*_CHROMA_FLOOR\` constants were declared and asserted NOWHERE, and the measurement that found it was a hover at C* 4.79 on a panel of 13.44. Author the value at the panel's own hue, at the cast the rule names and the step the inks allow`,
				);
			}

			/* 2b. The cast CEILING. A tint, never a saturated plane beside the panel
		      - the 1.4x over-cast of the shipped `tokyoNightStorm`, bought
		      entirely on the chroma axis so the band could be met without
		      lighting the row. The reference is the PANEL's cast, not the
		      `accent`'s: `min(0.6 x C*(accent), 24)` permitted C* 24 against a
		      panel of 16.3. */
			run.assertions++;
			if (chroma > castCeiling + ROW_STATE_CHROMA_CAP_SLACK) {
				fail(
					`${id}: \`${role}\` ${value} carries C* ${r2(chroma)}, past the ${r2(castCeiling)} this file allows — ${
						role === "rowHover"
							? "the hover may be lighter than its ground, it may not be a MORE coloured plane than it"
							: `the selection may carry the panel's cast and the rule's rise of ${ROW_SELECTED_CHROMA_RISE} above it, and no more`
					}, and the flat cap is ${ROW_STATE_CHROMA_CAP}. Search the chroma back toward the panel and let the step and the pair's cast rank carry what the fill no longer can`,
				);
			}

			/* 3. The step, its DIRECTION, its ceiling, and - for the selection - its
		      rank above the hover on BOTH channels. */
			run.assertions++;
			const rawStep = l - panelL;
			const step = p.mode === "dark" ? rawStep : -rawStep;
			if (step < rowRule.stepFloor - 1e-9) {
				fail(
					`${id}: \`${role}\` ${value} sits ${r2(Math.abs(rawStep))} \`L*\` ${p.mode === "dark" ? "above" : "below"} \`surface\` ${p.surface}, so the step is ${p.mode === "dark" ? "LIGHTER" : "DARKER"}-by-${r2(step)} where the floor is ${rowRule.stepFloor} \`L*\` in the mode's raised direction — ΔE00 is a budget a chroma-only step can spend while moving the wrong way in lightness, and the three palettes that did exactly that were the same report answered twice`,
				);
			}
			if (rowRule.stepCeiling !== null) {
				run.assertions++;
				if (step > rowRule.stepCeiling + ROW_STATE_STEP_SLACK + 1e-9) {
					fail(
						`${id}: \`${role}\` ${value} sits ${r2(step)} \`L*\` from \`surface\`, past the ${rowRule.stepCeiling} \`L*\` ceiling — every L* the row rises is ink headroom spent on the caps drawn inside it, so the step is taken as far as the inks allow and no further`,
					);
				}
			}
			if (role === "rowSelected" && isHex(p.rowHover)) {
				const [hoverL, hoverA, hoverB] = toLab(p.rowHover);
				const hoverStep = p.mode === "dark" ? hoverL - panelL : panelL - hoverL;
				const hoverChroma = Math.hypot(hoverA, hoverB);
				/* 3a. The `L*` rank. The fill ranks the pair now that the bar is
			      gone, and this is the axis a reader scans by. */
				run.assertions++;
				if (step < hoverStep + ROW_STATE_HOVER_RANK - 1e-9) {
					const pin = shortfallPin(id, "rowSelected", "rank");
					pinClaims.add(`${id}:rowSelected:rank`);
					run.assertions++;
					if (!pin) {
						fail(
							`${id}: \`rowSelected\` ${value} is ${r2(step)} \`L*\` from \`surface\` where \`rowHover\` ${p.rowHover} is ${r2(hoverStep)} — the selection has to be at least ${ROW_STATE_HOVER_RANK} \`L*\` further out than the hover, or a reader scanning sees one mark at two strengths rather than two states. A palette that cannot reach it has its whole legal step consumed by the ink floors, and that is a ledger row rather than a relaxed floor`,
						);
					} else if (!ledgerHolds(pin.measured, step - hoverStep, 0.05)) {
						fail(
							`${id}: the rank row in ROW_STATE_MEASURED_SHORTFALL is stale — it records ${pin.measured} and the pair now ranks ${r2(step - hoverStep)}. A ledger row is a claim about a value, so it is re-measured every run`,
						);
					}
				} else if (!run.composed && shortfallPin(id, "rowSelected", "rank")) {
					fail(
						`${id}: the rank row in ROW_STATE_MEASURED_SHORTFALL is stale — the pair ranks ${r2(step - hoverStep)} \`L*\`, clear of the ${ROW_STATE_HOVER_RANK} the row claims it misses. Remove the row`,
					);
				}
				/* 3b. The `C*` rank, and it is the axis that costs nothing: `L*`
			      determines relative luminance, so the contrast floors are blind
			      to chroma and the pair can be ranked on cast at zero ink cost. */
				run.assertions++;
				if (chroma < hoverChroma + ROW_STATE_CHROMA_RANK - 1e-9) {
					fail(
						`${id}: \`rowSelected\` ${value} carries C* ${r2(chroma)} where \`rowHover\` ${p.rowHover} carries ${r2(hoverChroma)} — the selection has to carry at least ${ROW_STATE_CHROMA_RANK} chroma more than the hover. This is the rank that costs nothing: a fill may be ranked on cast without spending a single L* of the ink budget, and the shipped fleet's chroma rank was INVERTED on 14 palettes because the hover desaturated while the selection did not`,
					);
				}
				/* 3c. How much of the selection's step the hover SPENDS, which is
			      clause 2 of the ask stated as the relationship it is. */
				run.assertions++;
				if (hoverStep < ROW_HOVER_STEP_SHARE_FLOOR * step - 1e-9) {
					fail(
						`${id}: \`rowHover\` ${p.rowHover} takes ${r2(hoverStep)} \`L*\` of the ${r2(step)} the selection takes (${Math.round((hoverStep / step) * 100)}%), under the ${Math.round(ROW_HOVER_STEP_SHARE_FLOOR * 100)}% this file requires — the operator asked for MORE of the brightening than the shipped 30%, and an absolute hover floor cannot state that on a fleet whose budgets differ by 2.5x`,
					);
				}
			}

			/* 4. The band off `surface`, at the file's own field floor now that the
		      4.0 band is withdrawn: a fill indistinguishable from its own panel
		      still fails, and a palette that cannot clear even this one is a
		      ledger row naming the floor that refuses it. */
			run.assertions++;
			const panelGap = deltaE(value, p.surface);
			if (panelGap < FIELD_SEPARATION_FLOOR - 1e-9) {
				const pin = shortfallPin(id, role, "band");
				pinClaims.add(`${id}:${role}:band`);
				run.assertions++;
				if (!pin) {
					fail(
						`${id}: \`${role}\` ${value} is ΔE00 ${r2(panelGap)} from \`surface\` ${p.surface} (the field floor is ${FIELD_SEPARATION_FLOOR}) — below this the mark is not findable while scanning, which is the operator's report restated. The band this role used to be held to was 4.0 and is WITHDRAWN because a backdrop-faithful fill cannot reach it on lightness; this floor is what is left, and a palette that misses even it needs a ledger row with the floor that refuses it`,
					);
				} else if (!ledgerHolds(pin.measured, panelGap, 0.05)) {
					fail(
						`${id}: the band row in ROW_STATE_MEASURED_SHORTFALL is stale — it records ${pin.measured} and the palette now measures ${r2(panelGap)}. A ledger row is a claim about a value, so it is re-measured every run`,
					);
				}
			} else if (!run.composed && shortfallPin(id, role, "band")) {
				fail(
					`${id}: the band row in ROW_STATE_MEASURED_SHORTFALL is stale — \`${role}\` ${value} is ΔE00 ${r2(panelGap)} from \`surface\`, clear of the ${FIELD_SEPARATION_FLOOR} the row claims it misses. Remove the row`,
				);
			}

			/* 5. How far from the wash it must not merge with: a state-distinction at
		      the FIELD floor, not asserted where the palette has no cast at all. */
			run.assertions++;
			const washGap = deltaE(value, p.accentWash);
			if (!neutral && washGap < ROW_STATE_WASH_FLOOR) {
				const pin = shortfallPin(id, role, "wash");
				pinClaims.add(`${id}:${role}:wash`);
				run.assertions++;
				if (!pin) {
					fail(
						`${id}: \`${role}\` ${value} is ΔE00 ${r2(washGap)} from \`accentWash\` ${p.accentWash} (need ${ROW_STATE_WASH_FLOOR}) — a hovered row beside a hovered button would merge into one mark, and they are a row state and a control state, so they have to be two. A backdrop-relative fill and an accent-derived wash are the same kind of rung, so this can bite on a palette with a strong cast in both; that is a ledger row with the reading, not a widened floor`,
					);
				} else if (!ledgerHolds(pin.measured, washGap, 0.05)) {
					fail(
						`${id}: the wash row in ROW_STATE_MEASURED_SHORTFALL is stale — it records ${pin.measured} and the palette now measures ${r2(washGap)}. A ledger row is a claim about a value, so it is re-measured every run`,
					);
				}
			} else if (!run.composed && !neutral && shortfallPin(id, role, "wash")) {
				fail(
					`${id}: the wash row in ROW_STATE_MEASURED_SHORTFALL is stale — \`${role}\` ${value} is ΔE00 ${r2(washGap)} from \`accentWash\`, clear of the ${ROW_STATE_WASH_FLOOR} the row claims it misses. Remove the row`,
				);
			}
		}

		/* 6. The separation - the half the second report is about. Measured between
	      the two SHIPPED values, so a palette cannot be ranked by its own numbers
	      on one side and another's on the other. */
		if (isHex(p.rowHover) && isHex(p.rowSelected)) {
			run.assertions++;
			const apart = deltaE(p.rowSelected, p.rowHover);
			/* The pair's separation is the FLEET's floor on every palette, including the
		   cast-less class: this used to be a collision floor (1.0) for that class
		   and no palette ever used it (their pairs run 2.15-3.71), so the waiver is
		   retired - see the note beside `ROW_HOVER_STEP_FLOOR`. What ranks the two
		   states is the fill's own two ranks above plus `font-medium`, so all the
		   colour has to do is not be the same mark twice. */
			const apartFloor = ROW_PAIR_SEPARATION;
			if (apart < apartFloor - 1e-9) {
				fail(
					`${id}: \`rowHover\` ${p.rowHover} and \`rowSelected\` ${p.rowSelected} are ΔE00 ${r2(apart)} apart (need ${apartFloor}) — the reader sees two marks and cannot rank them. This was the second half of the operator's report: on \`neon\` the shipped pair sat 1.80 ΔE apart while each was ~6.2 ΔE off the panel. The ranking is the fill's now, so a palette that misses this is missing because the two fills are the SAME MARK — give the selection more step or more cast than the hover`,
				);
			}
		}

		/*
		 * THE RAIL'S ACCOUNT PLATE LEFT THIS PAIR in design review round 1 of the
		 * own-avatar change (D2). It was `elevated` with a `border-control` edge, and
		 * this block asked one of those two arms to clear `rowHover`. The operator
		 * asked for borderless avatars and the ring visibly dropped away when the
		 * photo landed, so the plate now wears Team Bridge's `mediaSurface` with no
		 * edge, and its pairs are asserted where that fill already is: the
		 * `team bridge borderless person and agent plates` row in `PERCEPTIBLE`
		 * (`surface` and `rowHover` are two of its hosts) and the `team bridge person
		 * initial plate` row in `CONTROLS` (`inkMuted` initials on the fill). The
		 * account row is not a destination, so `rowSelected`, where that fill bottoms
		 * out, is never under it; `scripts/chat-sidebar-selection.test.mjs` asserts
		 * both the class and that scope.
		 */

		/*
		 * THE PLATE INSIDE A DESTINATION ROW, the state the rail's account plate never
		 * had to answer: the agents sidebar's own row IS a destination, so it paints
		 * `rowCurrent` under a selection as well as `hover:bg-row-hover` under the
		 * pointer (`features/agents/components/agents-sidebar.tsx`; both are asserted
		 * from that call site in `scripts/chat-sidebar-selection.test.mjs`). Its avatar
		 * plate is `sunken` with the same `border-control` edge, and the same two-arm
		 * pair is asked of BOTH states the row can be in — `sunken` at the field floor
		 * OR the edge at the non-text floor, per state, per palette.
		 *
		 * The pair is what makes this satisfiable rather than a flat 3:1 on the edge:
		 * `borderControl` against `rowSelected` bottoms at 2.77 (`vaporwave`, tied with
		 * `catppuccinMocha` - the two are the joint minimum, so neither is "the" worst)
		 * and against
		 * `rowHover` at 2.92 (`catppuccinMocha`), so an edge-only floor would fail 12 and
		 * 5 palettes respectively — and on every one of those the FILL clears the field
		 * floor. The other arm fails in the other direction: `sunken` misses the field
		 * floor against the selection on seven palettes (the tightest `alucard` 0.44) and
		 * against the hover on one (`iceberg` 1.86), and on every one of those the edge
		 * clears, 3.02-4.66 against the selection and 3.35 against the hover. No palette
		 * fails both arms on either state, which is what this asserts.
		 *
		 * The class half — that the plate still wears the edge, and that the class of
		 * "an object inside a row state with a ground of its own" is enumerated rather
		 * than assumed — is in `scripts/chat-sidebar-selection.test.mjs`.
		 *
		 * THE TEAM AVATAR BUBBLE LEFT THIS PAIR on 2026-10-02: it wore the same
		 * `sunken` plate and `borderControl` edge, and the operator's report replaced
		 * both with the rail's quiet-count register (`elevated` + `inkDim`, no edge),
		 * which moved its row up in `CONTROLS` and took it out from under this block's
		 * arithmetic. Named here so a reader who remembers it resting here finds where
		 * it went rather than nothing.
		 */
		if (
			isHex(p.sunken) &&
			isHex(p.rowHover) &&
			isHex(p.rowSelected) &&
			isHex(p.borderControl)
		) {
			for (const state of ["rowHover", "rowSelected"]) {
				run.assertions++;
				const avatarField = deltaE(p.sunken, p[state]);
				const avatarEdge = ratio(p.borderControl, p[state]);
				if (
					avatarField < FIELD_SEPARATION_FLOOR &&
					avatarEdge < FLOOR.nonText
				) {
					fail(
						`${id}: the agents sidebar's avatar plate has no perceivable edge against \`${state}\` — its \`sunken\` fill ${p.sunken} is ΔE00 ${r2(avatarField)} from it (need ${FIELD_SEPARATION_FLOOR}) and the plate's \`borderControl\` edge ${p.borderControl} is ${r2(avatarEdge)}:1 against that same fill (need ${FLOOR.nonText}:1), so the row's own ${state === "rowHover" ? "hover" : "selection"} turns the avatar into a disc of the row's fill. Give the plate an edge the row's state cannot overrun, or a fill that state cannot land on`,
					);
				}
			}
		}

		/*
		 * THE LIGHTBOX'S OWN GROUND: the scrim, and the current-tile ring on it.
		 *
		 * WHY THIS PAIR EXISTS (PR #990, design round 1's D1-1). The scrim is in no
		 * ground list above, so everything painted on it was unmeasured: on the
		 * committed frames the carousel's current-tile ring read 1.52:1 on
		 * `localOperatorLight`'s overlay and the accent focus ring about 2.1:1 -
		 * both under the 3:1 non-text floor, with every assertion in this file
		 * green. The ring now out-ranks that edge on the slot (`ring-ink`,
		 * `image-group-lightbox.tsx`), and this is the floor under the choice.
		 *
		 * The scrim is not ONE ground, because it dims whatever the app has open
		 * under it - the overlay can be raised over any surface the transcript
		 * draws - so the ring is asserted against the scrim composited over each
		 * of the eight state grounds in turn. Measured before it was written, over
		 * all 59 palettes x 8 grounds: `ink` clears everywhere (worst:
		 * everforestLight over `sunken`, 3.37:1) and `inkMuted` - the role the
		 * first fix reached for, chosen on ONE composite - fails 3 composites on
		 * kanagawaLotus (2.78 over `sunken`, 2.82 over `accentWash`, 2.96 over
		 * `rowSelected`), which is why the ring is not drawn in it.
		 */
		if (typeof p.scrim === "string" && isHex(p.ink)) {
			const scr = p.scrim.match(/rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\)/);
			if (scr) {
				const [sr, sg, sb, sa] = scr.slice(1).map(Number);
				for (const g of GROUNDS6) {
					if (!isHex(p[g])) continue;
					const under = [1, 3, 5].map((i) =>
						Number.parseInt(p[g].slice(i, i + 2), 16),
					);
					const composite = `#${[sr, sg, sb]
						.map((v, i) =>
							Math.round(v * sa + under[i] * (1 - sa))
								.toString(16)
								.padStart(2, "0"),
						)
						.join("")}`;
					run.assertions++;
					const got = ratio(p.ink, composite);
					if (got < FLOOR.nonText) {
						fail(
							`${id}: the lightbox's current-tile ring has no perceivable edge over \`${g}\` — \`ink\` is ${r2(got)}:1 against the scrim composited over it (need ${FLOOR.nonText}:1). The scrim dims whatever is open under it, so the ring's role has to clear every ground the overlay can open over`,
						);
					}
				}
			}
		}

		/* Structural edges: the control's own boundary, the focus ring, and each
	   semantic's edge, on all four grounds. */
		for (const role of STRUCTURAL) {
			for (const g of GROUNDS) {
				assertPair(id, p, role, g, FLOOR.nonText, "structural edge");
			}
		}

		/*
		 * Semantic and accent colours used as text, on all six grounds.
		 *
		 * `sunken` is in this list because it is the editor's own ground: every
		 * syntax colour is painted on it. `elevated`, `accentWash` and the two row
		 * states are in it because each is a ground a tone role is really drawn on -
		 * a dialog's required-mark and a danger button's label on `elevated`, the
		 * ask-option card's text on `accentWash`, the selected sidebar row on
		 * `rowSelected` - and the old list stopped at `sunken`, which is how `danger`
		 * came to be drawn at 3.76:1 on `elevated` in `monokai` behind three
		 * recorded pins rather than a floor. Those pins are gone; see `EXCEPTIONS`.
		 */
		/*
		 * The TONE grounds are the six, not the eight, and the two the row states
		 * add are deliberately excluded HERE while being asserted in the ink loop
		 * above. The measurement is the reason: a tone role reaches a selected row
		 * only as a badge or a dot, and on the accent-derived fills the four tones plus
		 * `accent` measure 4.45-4.50:1 in five palettes - the chroma ceiling is what
		 * caps them, so the shortfall is a property of the rule rather than of a value.
		 * What a row DOES carry is its own text, and that is the ink layer, which is
		 * asserted on both row states. `messageSurface` is the sixth: the block renders
		 * user prose - links and markdown included - so a tone role is genuinely drawn
		 * on it (fleet minimum 4.60:1, measured). So the tones stay on the six grounds
		 * this file measures them on - the four elevations, `accentWash` and
		 * `messageSurface` - and the row states are held to the ink floors.
		 */
		const TONE_GROUNDS = [...GROUNDS, "accentWash", "messageSurface"];
		for (const role of AS_TEXT) {
			for (const g of TONE_GROUNDS) {
				assertPair(id, p, role, g, FLOOR.text, "colour as text");
			}
		}

		/*
		 * The picker's partial-listing note, on the dialog's own ground.
		 *
		 * It is asserted here rather than left to the `AS_TEXT` loop above because
		 * the row names a CALL SITE: `models.catalogue` can answer with rows AND
		 * per-provider errors, and the note about what is missing belongs above the
		 * list rather than instead of it (design D4). `warning` is the role it
		 * renders in, so that is the pair asserted. `elevated` is now one of
		 * `AS_TEXT`'s grounds as well, so this row is the same assertion stated at
		 * the place it is rendered - which is the half a palette loop cannot see.
		 */
		assertPair(
			id,
			p,
			"warning",
			"elevated",
			FLOOR.text,
			"the picker's partial-listing note",
		);

		/*
		 * The second place, and the one that used to be invisible to this file.
		 *
		 * `danger` is drawn as TEXT on `elevated` by two surfaces: the required-mark
		 * asterisk beside every label in a dialog, and the danger-variant button's
		 * label (the delete confirmation). Asserting the pair is what makes the
		 * decision visible — three palettes are below the floor (monokai 3.76,
		 * dracula 3.81, neon 4.43) and each is pinned below with its measured ratio.
		 * The alternative was a design change to two shared components (a required
		 * mark's colour, and a destructive control's variant on dialog grounds),
		 * which is a decision for the whole app rather than for the code-memory
		 * panel that surfaced it, so it is recorded here instead of made here
		 * (design round 2, D3).
		 *
		 * The code-memory panel's OWN error sentences do not join this list: they
		 * render in `ink` precisely so the panel does not add a third user
		 * (`variable-form-dialog.tsx`).
		 */
		assertPair(
			id,
			p,
			"danger",
			"elevated",
			FLOOR.text,
			"danger as text on a dialog's ground",
		);

		/*
		 * Settings > Integrations' "Needs sign-in" words on a deep-linked row: TEXT
		 * in `warning` on the `rowSelected` ground a `/mcp <name>` reveal paints.
		 * `AS_TEXT` covers the four grounds and `accentWash`, not the row states, so
		 * the pair the deep link actually produces is asserted where it renders.
		 *
		 * `danger` is deliberately NOT here: it measured 4.23-4.47:1 on this ground
		 * in six palettes, so a highlighted row draws "Couldn't start" in `ink` and
		 * leaves the tone to the dot beside it (`integration-row.tsx`, STATUS_INK).
		 */
		assertPair(
			id,
			p,
			"warning",
			"rowSelected",
			FLOOR.text,
			"integration status text on a deep-linked row",
		);

		/*
		 * THE MODEL-ACCESS BAND'S LINKS (design review round 1, D4). The band the
		 * access-aware picker adds paints `text-accent` link actions (`Switch model`,
		 * `Connect`) directly on `warningWash`, and no row asserted accent-as-TEXT on
		 * that wash: the only `on: ["warningWash"]` ink row in `CONTROLS` asserts
		 * `onAccent` over an accent FILL, a different pairing. The band's sibling
		 * (`radient-session-issue.tsx`, same `variant="warning"` Alert, same `link`
		 * actions) has shipped the same pairing unasserted, so this row asserts the
		 * FAMILY's ink-on-wash rather than a new surface's.
		 *
		 * Measured before it was written: `localOperatorLight` is the tight sweep
		 * palette at 4.77:1, and the 59-palette run finds palettes below the floor —
		 * pinned in `EXCEPTIONS` with their ratios and the reason a palette move is
		 * not this change's to make (a link ink shared by two shipped bands is a
		 * decision for the design system, recorded here rather than changed here).
		 * `danger`/`info` washes are the sibling's other two variants and are not
		 * asserted: this row is scoped to the wash the model-access band paints.
		 */
		assertPair(
			id,
			p,
			"accent",
			"warningWash",
			FLOOR.text,
			"model-access band links on the warning wash",
		);

		/*
		 * The tool ledger's PARTIAL delivery word (`wake unconfirmed`, `unconfirmed`)
		 * on the ground the row paints under the pointer.
		 *
		 * The word is `warning` text and it is the row's only loud ink, so the pair
		 * owes the text floor wherever the row draws it. Two of its three grounds were
		 * already asserted before this row existed: `canvas` and `surface` by `AS_TEXT`
		 * (the four elevations, `accentWash` and `messageSurface`), and the settled
		 * row's own ground IS the transcript's canvas. The HOVER states are the ones
		 * `AS_TEXT` deliberately leaves to the ink loop - it holds `ink`, `inkMuted`
		 * and `inkDim`, not the tone roles - and `rowHover` is exactly the ground a
		 * hovered row wears (`hover:bg-row-hover`), so the amber word on it was the
		 * one pair in this state that nothing measured.
		 *
		 * Measured before it was written: worst palette `warning`/`rowHover` is
		 * 4.696:1 (rose-pine-dawn), clear of the floor in all 59, so no pin is
		 * recorded here. `rowSelected` is not listed: a transcript row is never
		 * selected, and the ledger's own row has no selected state.
		 */
		assertPair(
			id,
			p,
			"warning",
			"rowHover",
			FLOOR.text,
			"the partial delivery word on the hovered row's ground",
		);

		/*
		 * And the border that goes with it, because it is the whole boundary of the
		 * control: the danger-variant button draws `border-danger-border` with no
		 * fill until hover (`button.tsx`), so on a dialog the edge IS the control.
		 *
		 * Eight palettes are under 3:1 here (monokai 2.49 through dune 2.88, measured
		 * from the palettes) and each is pinned below. Repainting a shared control's
		 * variant is an app-wide decision and not this PR's to take; measuring it is
		 * this PR's, because the delete-confirmation frame it adds is where the pair
		 * is now drawn (design round 2, D3).
		 */
		assertPair(
			id,
			p,
			"dangerBorder",
			"elevated",
			FLOOR.nonText,
			"the danger control's only edge on a dialog's ground",
		);

		/* Component triples. */
		for (const c of CONTROLS) {
			for (const g of c.on) {
				const ground = p[g];
				const fill = c.fill ? p[c.fill] : ground;
				const ink = p[c.ink];
				const border = c.border ? p[c.border] : null;
				if (!isHex(ground) || !isHex(fill) || !isHex(ink)) continue;

				/* The control's own label against the control's own fill. */
				run.assertions++;
				const inkOnFill = ratio(ink, fill);
				if (
					inkOnFill < FLOOR.text &&
					/*
					 * `EXEMPT_INK`'s own rule, applied to a CONTROL's label as well as to a
					 * bare ink: SC 1.4.3 exempts inactive controls, and a disabled control
					 * that meets 4.5:1 does not read as disabled (see the set's comment at
					 * the top of this file, and § 4 of `docs/branding.md`). This loop was
					 * the one place that still demanded the floor of that role - which no
					 * row had asked it for until the composer's refusal state needed one,
					 * and which would have made the state unlistable rather than
					 * unmeasurable. The EDGE assertion below is untouched, so the row still
					 * fails if the boundary stops being perceivable.
					 */
					!EXEMPT_INK.has(c.ink) &&
					!findException(id, c.ink, c.fill ?? g, inkOnFill)
				) {
					fail(
						`${id}: ${c.name} on ${g} — ink ${c.ink} ${ink} on fill ${fill} = ${inkOnFill}:1, need ${FLOOR.text}:1`,
					);
				}

				/*
				 * The control's edge against the ground behind it: fill OR border.
				 *
				 * A row may declare `edge: false` when the component deliberately draws
				 * NEITHER and its separation is a ground STEP rather than a boundary — the
				 * composer box since chat redesign §G1. Without the opt-out the floor below
				 * would demand a border the design removed on purpose, and the only ways to
				 * satisfy it would be to invent one or to stop listing the state, which is
				 * the "green output about a component nobody listed" failure this section
				 * opens with. The step it spends instead is asserted where a step belongs —
				 * `PERCEPTIBLE`'s ground-step rows, and the palette ladder's own
				 * `canvas` -> `elevated` bounds — and the call site is pinned in
				 * `STRUCTURAL_CALL_SITES` ("composer box ground"), so the opt-out removes no
				 * coverage: it moves the claim to the instrument that can measure it.
				 */
				if (c.edge !== false) {
					run.assertions++;
					const fillEdge = ratio(fill, ground);
					const borderEdge = isHex(border) ? ratio(border, ground) : 0;
					const edge = Math.max(fillEdge, borderEdge);
					if (edge < FLOOR.nonText) {
						/*
						 * This assertion had no pin path, which made it the one floor in this
						 * file that a shared control's colour could only satisfy by being
						 * changed where it was measured. `CONTROL_EDGE_PINNED` records the
						 * case instead, under the same rule as `INK_STEP_PINNED`: the pin is
						 * consulted only when the edge is still under the floor, and the stale
						 * check below fails a pin whose palette no longer needs it.
						 */
						const pin = CONTROL_EDGE_PINNED.find(
							(x) =>
								x.control === c.name &&
								x.ground === g &&
								x.theme === id &&
								pinMatches(x.got, r2(edge)),
						);
						if (pin) {
							controlEdgeSeen.add(
								controlEdgeKey(pin.control, pin.ground, pin.theme),
							);
						} else {
							fail(
								`${id}: ${c.name} on ${g} has no perceivable edge — fill ${fillEdge}:1, border ${borderEdge}:1, need one at ${FLOOR.nonText}:1`,
							);
						}
					}
				}
			}
		}

		/*
		 * The console terminal's own pair (§9.3), after the component triples because
		 * it is a pair between two ROLES rather than a control's boundary: the block
		 * cursor's ink on the block cursor.
		 */
		for (const row of TERMINAL_PAIRS) {
			assertPair(id, p, row.fg, row.on, row.floor, row.name);
		}

		/* Graphic objects against the ground they are drawn on. `floor` is per row
	   where a row's own measured worst case is tighter than the 3:1 non-text
	   floor: pinning it at 3.0 would let a token move that halves the margin
	   still pass. */
		for (const g of GRAPHICS) {
			for (const ground of g.on) {
				assertPair(id, p, g.fg, ground, g.floor ?? FLOOR.nonText, g.name);
			}
		}

		/* Foreground pairs: an edge whose two sides are both foreground roles. */
		for (const pair of ADJACENT) {
			const b = p[pair.b];
			if (!isHex(b)) continue;
			for (const roleName of pair.a) {
				const a = p[roleName];
				if (!isHex(a)) continue;
				run.assertions++;
				const got = ratio(a, b);
				if (got < pair.floor && !findException(id, roleName, pair.b, got)) {
					fail(
						`${id}: ${pair.name} — ${roleName} ${a} against ${pair.b} ${b} = ${got}:1, need ${pair.floor}:1`,
					);
				}
			}
		}

		/* Decorative lines: seen rather than contrasted, and stable across states. */
		for (const item of PERCEPTIBLE) {
			const role = p[item.role];
			if (!isHex(role)) continue;
			for (const g of item.on) {
				if (!isHex(p[g])) continue;
				run.assertions++;
				const got = deltaE(role, p[g]);
				if (
					got < item.minDeltaE &&
					!findPerceptibleException(id, item.role, g, r2(got))
				) {
					fail(
						`${id}: ${item.name} — ${item.role} ${role} on ${g} ${p[g]} is ΔE00 ${r2(got)}, need ${item.minDeltaE} to be seen at all`,
					);
				}
			}
			/*
			 * ONE COMPONENT, TWO STATES: the weight may not jump. OPT-IN, because a row
			 * can state a separation with no second state to weigh against — the mention
			 * chip's edge is the first (review round 2, R2) — and the shape it used to
			 * have was worse than either: a row missing `pairedWith`/`against` was skipped
			 * WHOLE, so a row written without them looked like an assertion and was none
			 * at all. A row that declares them gets the parity check; a row that does not
			 * says so by leaving them out.
			 */
			if (!item.pairedWith || !item.against) continue;
			const sibling = p[item.pairedWith];
			const ground = p[item.against];
			if (!isHex(sibling) || !isHex(ground)) continue;
			run.assertions++;
			const a = ratio(role, ground);
			const b = ratio(sibling, ground);
			const change = Math.max(a / b, b / a);
			if (change > item.maxWeightChange) {
				fail(
					`${id}: ${item.name} — ${item.role} is ${r2(change)}x the weight of ${item.pairedWith} against ${item.against}; one component must not change weight by more than ${item.maxWeightChange}x between states`,
				);
			}
		}

		/* Semantics must be distinguishable from each other, not merely legible. */
		for (let i = 0; i < SEPARABLE.length; i++) {
			for (let j = i + 1; j < SEPARABLE.length; j++) {
				const [a, b] = [SEPARABLE[i], SEPARABLE[j]];
				if (!isHex(p[a]) || !isHex(p[b])) continue;
				run.assertions++;
				const got = deltaE(p[a], p[b]);
				if (got < SEPARATION_FLOOR) {
					fail(
						`${id}: \`${a}\` ${p[a]} and \`${b}\` ${p[b]} are too close to tell apart (ΔE00 ${r2(got)}, need ${SEPARATION_FLOOR}) — a semantic a reader cannot distinguish from another semantic is not a semantic`,
					);
				}
			}
		}

		/*
		 * The second accent: the two accents must be two accents, and the decorative
		 * hue must never be mistakable for a semantic or for a grey.
		 *
		 * One argument in four assertions, and the argument is why `accentAlt` was
		 * worth adding rather than a muted copy of the first hue:
		 *
		 * - ΔE00 15 from `accent` is this file's own "difference of category, not of
		 *   shade" number (`SEPARATION_FLOOR`), and here it is asked at SMALL sizes - a
		 *   1px bar in a 40px miniature, a 6px mark in a diagram - so recall is the
		 *   question rather than side-by-side comparison. It is not a wall: a hue
		 *   rotation clears it on 58 of the 59 palettes, and the 59th (`obsidian`)
		 *   resolves once the chroma is searched upward rather than downward.
		 * - ΔE00 15 from `success`/`warning`/`danger` is the one that costs a reader
		 *   something real: a decorative mark read as "something broke". It is
		 *   deliberately the same constant rather than a harder one - the weakest
		 *   legitimate pair in the tree is `dune`'s `danger`/`info` at 18.4, and a new
		 *   role asked to clear more than the semantics clear against each other is a
		 *   gate that fails by design.
		 * - `info` is treated as its own family rather than as a semantic: the floors
		 *   this role holds against it are argued at the two SITES that draw the two
		 *   together, and they are different bounds for different jobs.
		 *
		 *   As the ledger's two CATEGORY inks - `accentAlt` is the settled `meta` row's
		 *   identity and `info` is `read`'s, one line apart in one column - the pair is
		 *   asked at `SEPARATION_FLOOR` (15) below, the contract's own "difference of
		 *   category, not of shade". Five palettes cannot reach it and are pinned in
		 *   `PAIR_PINS` with the constraint that refuses each: the three `catppuccin*`
		 *   palettes, whose second hue sits in `info`'s own family (2.68, 17.02 and
		 *   19.42 degrees off it), and the two desktop-only palettes whose second hue is
		 *   a rotation of their accent rather than a `label` token to port
		 *   (`localOperatorDark` 12.57, `ayuLight` 13.57).
		 *
		 *   At the role's DECORATIVE sites - a 1px bar in the 40px miniature, a 6px mark
		 *   in a diagram - the same pair takes the reduced `SYNTAX_COMMENT_FLOOR` (8),
		 *   because recall at a size too small to resolve is the question there.
		 *
		 *   NO FIGURE IS TYPED INTO THIS COMMENT, deliberately. The number that ran in
		 *   three places and disagreed in three ways is this pair's: the contract
		 *   carried 8.01, which was its value BEFORE the register re-solve moved both of
		 *   its values (measured on the pre-values `#719AD4`/`#89B4FA`, which is what
		 *   8.01 is), a PR body carried 8.19, and a reviewer's independent computation
		 *   carried 8.70. The run now PRINTS the fleet's tightest pair from the same
		 *   `deltaE` the assertion uses - the `Identity pairs:` line, beside the pin
		 *   count - so there is one number and one source, and a reader who wants it
		 *   reads the run rather than a document that cannot go red.
		 * - `ALT_ACCENT_CHROMA_FLOOR` (15) asserts the AXIS: all three floors above
		 *   can be satisfied by draining the hue toward the ink, which turns the second
		 *   accent into a second grey. See the constant.
		 *
		 * The text floor is asserted below, on the three grounds its own decorative sites
		 * paint it on PLUS the row's state ground (`elevated`), which the trace row
		 * added. It is NOT the `AS_TEXT` loop's six: the alt hue is never drawn on a
		 * dialog's `elevated`, on the selection wash or on the current row, and the
		 * ledger's settled-row hover is the ONE state ground it reaches — asserting the
		 * `rowHover`/`rowSelected` fills here would demand palette values for a pair no
		 * site paints (they are a sibling pass's roles; if the trace row's hover moves
		 * to `rowHover`, this pair moves with it, which is why the comment above the
		 * call says so). The rule that keeps the list honest is the role's own: no text
		 * is painted on `accentAlt`, and none of those pairs can arise.
		 */
		if (isHex(p.accentAlt)) {
			if (isHex(p.accent)) {
				run.assertions++;
				const got = deltaE(p.accentAlt, p.accent);
				if (got < SEPARATION_FLOOR) {
					fail(
						`${id}: the second accent \`accentAlt\` ${p.accentAlt} is ΔE00 ${r2(got)} from \`accent\` ${p.accent} (need ${SEPARATION_FLOOR}) — two accents have to be two accents at the sizes this one is drawn at, and a value that buys its separation by darkening is the same hue at another weight rather than a second hue`,
					);
				}
			}
			for (const semantic of ["success", "warning", "danger"]) {
				if (!isHex(p[semantic])) continue;
				run.assertions++;
				const got = deltaE(p.accentAlt, p[semantic]);
				if (got < SEPARATION_FLOOR) {
					fail(
						`${id}: \`accentAlt\` ${p.accentAlt} is ΔE00 ${r2(got)} from \`${semantic}\` ${p[semantic]} (need ${SEPARATION_FLOOR}) — a decorative mark a reader can mistake for "${semantic === "danger" ? "something broke" : semantic}" costs them something real, so the palette moves the hue rather than the assertion`,
					);
				}
			}
			if (isHex(p.info)) {
				run.assertions++;
				/*
				 * The DECORATIVE-site floor, and the ledger's own pair is asserted
				 * separately below (`assertIdentityPair`) at 15: this one is the 1px bar in
				 * the miniature and the 6px mark in the diagram, where recall at a size too
				 * small to resolve is the question. The comment above the block carries the
				 * argument for the two bounds and for why no figure is typed into it.
				 */
				const got = deltaE(p.accentAlt, p.info);
				if (got < SYNTAX_COMMENT_FLOOR) {
					fail(
						`${id}: \`accentAlt\` ${p.accentAlt} is ΔE00 ${r2(got)} from \`info\` ${p.info} (need ${SYNTAX_COMMENT_FLOOR}) — \`info\` is the family the port mapped the TUI's \`signal\` onto, so the floor here is the reduced one and not ${SEPARATION_FLOOR}; below it the two take the same name`,
					);
				}
			}
			const [, acA, acB] = toLab(p.accentAlt);
			const chroma = Math.hypot(acA, acB);
			run.assertions++;
			if (chroma < ALT_ACCENT_CHROMA_FLOOR) {
				fail(
					`${id}: \`accentAlt\` ${p.accentAlt} is C* ${r2(chroma)} (need ${ALT_ACCENT_CHROMA_FLOOR}) — a second accent drained toward the ink passes every separation above and stops being a hue, which is the one way this role fails while the gate stays green`,
				);
			}
			/* The three grounds its own sites paint it on. */
			for (const g of ["canvas", "surface", "sunken"]) {
				assertPair(id, p, "accentAlt", g, FLOOR.text, "second accent as text");
			}
			/*
			 * AND THE FOURTH, which is the one the tool row added and the reason this
			 * block grew a ground at all.
			 *
			 * `accentAlt` is the settled `meta` row's identity ink (`tool-row.tsx`'s
			 * `CATEGORY_INK`), and a settled row's hover paints `bg-elevated`
			 * (`tool-row.tsx:633`) — so hovering a `hub`/`task`/`todo` row draws this
			 * role as 12px TEXT on `elevated`. Neither prior site did: the theme picker's
			 * miniature is 1px-2.5px bars and mermaid's categorical fill carries `ink`
			 * labels, so the role's text floor was asserted on the three grounds a CHIP
			 * paints it on and no state ground was ever measured. That is exactly the
			 * scope gap this asserts shut, and it is asserted rather than pinned: 4.5:1
			 * on text is the floor the whole file is for, and ten palettes were below it
			 * before the palette pass beside this assertion (worst `kanagawaWave`
			 * 4.05:1).
			 *
			 * The `meta` ink's own re-seat is recorded in the palettes: where the role was
			 * seated at its floor on `surface` (catppuccinMocha 4.51:1) an added ground
			 * had no headroom to spend, so those ten values were re-seated at their own
			 * hue — measured, `elevated` 4.05-4.23:1 -> 4.55-4.60:1 — which is the
			 * palette moving rather than the floor.
			 *
			 * COORDINATION, stated because the ground is not this change's to own:
			 * `rowHover`/`rowSelected` are a sibling pass's roles (PR #386) and a row's
			 * hover is heading for `rowHover` there. This asserts the ground the row
			 * RESOLVES TO today — `elevated`, the class in `tool-row.tsx` — so if that
			 * class moves, this pair moves with it and re-measures against the new fill
			 * rather than silently asserting a ground nothing paints any more.
			 */
			assertPair(
				id,
				p,
				"accentAlt",
				"elevated",
				FLOOR.text,
				"second accent as text on a row's state ground",
			);
		}

		/*
		 * ------------------------------------------------------------------
		 * THE TOOL ROW'S TWO IDENTITY PAIRS, as text in one column.
		 *
		 * Both are new SITES for roles whose floors were written for other ones, and
		 * both are asserted here rather than left to the prose that already described
		 * the failure. See the two floors' own comment for the bound each pair takes
		 * and the argument for it; the shape below is the same for both: measure, and
		 * accept a below-floor pair ONLY through a `PAIR_PINS` entry whose recorded
		 * value still matches and whose reason names the refusing constraint.
		 */
		assertIdentityPair(
			id,
			p,
			"accentAlt",
			"info",
			IDENTITY_PAIR_FLOOR,
			"the tool row's two category inks",
		);
		assertIdentityPair(
			id,
			p,
			"info",
			"accent",
			LIVENESS_PAIR_FLOOR,
			"the settled read ink against the liveness ink",
		);

		/*
		 * And the two washes may sit adjacent in one ramp.
		 *
		 * `accentAltWash` is the index-1 entry of mermaid's categorical cycle, so it
		 * is painted directly beside `accentWash`. The floor is the file's field floor
		 * (2.0) and NOT the 4 or 8 a line and a token take: measured on the tree's own
		 * wash pairs, cross-hue washes run as low as 1.18 (`catppuccinFrappe`'s
		 * `accentWash`/`dangerWash`), so a floor of 8 would fail pairs that ship today.
		 * Where a palette genuinely cannot reach it - the wash axis is where
		 * near-neutral palettes run out of chroma - the pair is pinned in `EXCEPTIONS`
		 * with its measured ΔE00 and a reason, which is the contract's own mechanism
		 * for an accepted sub-floor pair and is not a mute: moving the token breaks the
		 * pin. Tightest measured today: `rosePine` at 2.05.
		 */
		if (isHex(p.accentAltWash) && isHex(p.accentWash)) {
			run.assertions++;
			const got = deltaE(p.accentAltWash, p.accentWash);
			if (got < FIELD_SEPARATION_FLOOR) {
				fail(
					`${id}: \`accentAltWash\` ${p.accentAltWash} is ΔE00 ${r2(got)} from \`accentWash\` ${p.accentWash} (need ${FIELD_SEPARATION_FLOOR}) — the two washes sit adjacent in mermaid's categorical ramp, so a step the reader cannot see is not a step`,
				);
			}
		}

		/* Syntax tokens must stand apart from the comments and names they sit
	   beside. See SYNTAX_HUE_ROLES for what is excluded and why. */
		for (const role of SYNTAX_HUE_ROLES) {
			if (!isHex(p[role]) || !isHex(p.inkDim)) continue;
			run.assertions++;
			const got = deltaE(p[role], p.inkDim);
			if (got < SYNTAX_COMMENT_FLOOR) {
				fail(
					`${id}: syntax \`${role}\` ${p[role]} sits at ΔE00 ${r2(got)} from comment \`${p.inkDim}\` (need ${SYNTAX_COMMENT_FLOOR}) — a token the eye cannot separate from the comment beside it is not highlighted`,
				);
			}
		}

		/*
		 * The composer's command token. Floors: 4.5:1 as TEXT on the field and on the
		 * popup's ground, and a ΔE00 separation from the three inks it is read beside
		 * in one line — prose `ink`, `accent`, and the resolved roster name.
		 *
		 * The name's own ratification is asserted here too (`success` vs `ink` only):
		 * the design round measured that no text role separates from `accent` in all
		 * twelve palettes then shipping, so the name keeps the palette's green — which
		 * is what the TUI does with `$lo-string` — and the four accent identities are
		 * recorded above as prose rather than asserted into a false floor.
		 */
		if (isHex(p[COMMAND_TOKEN]) && isHex(p.ink)) {
			const pin = COMMAND_TOKEN_PINNED.find((e) => e.theme === id);
			for (const ground of COMMAND_TOKEN_GROUNDS) {
				if (!isHex(p[ground])) continue;
				run.assertions++;
				const got = ratio(p[COMMAND_TOKEN], p[ground]);
				if (got < 4.5) {
					fail(
						`${id}: the command token \`tokenCommand\` ${p[COMMAND_TOKEN]} reads ${r2(got)}:1 on \`${ground}\` (need 4.5) - the token is text a user typed (the composer's leading /word, or the sent \`$skill\` mention), not decoration`,
					);
				}
			}
			for (const against of ["ink", "accent", "success"]) {
				if (!isHex(p[against])) continue;
				run.assertions++;
				const got = deltaE(p[COMMAND_TOKEN], p[against]);
				const pinned = Boolean(pin?.against.includes(against));
				if (pinned) {
					if (!pinMatches(pin.got, got))
						fail(
							`${id}: COMMAND_TOKEN_PINNED records ${pin.got} for \`command\`/\`${against}\` but it now measures ${r2(got)} - re-measure and update the pin (${pin.why})`,
						);
					continue;
				}
				if (got < COMMAND_TOKEN_FLOOR)
					fail(
						`${id}: the command token \`tokenCommand\` ${p[COMMAND_TOKEN]} sits at ΔE00 ${r2(got)} from \`${against}\` ${p[against]} (need ${COMMAND_TOKEN_FLOOR}) - the composer paints this run in the same box as that ink, so a reader cannot tell which is which`,
					);
			}
			if (isHex(p.success)) {
				run.assertions++;
				const got = deltaE(p.success, p.ink);
				if (got < COMMAND_TOKEN_FLOOR)
					fail(
						`${id}: the roster NAME's ink \`success\` ${p.success} sits at ΔE00 ${r2(got)} from prose \`ink\` ${p.ink} (need ${COMMAND_TOKEN_FLOOR}) - a resolved name that reads as prose is not a run`,
					);
			}
		}

		/* The control/readout ink step: measured always, floored where it can be. */
		if (isHex(p.inkMuted) && isHex(p.inkDim)) {
			run.assertions++;
			inkStepSeen.add(id);
			const got = deltaE(p.inkMuted, p.inkDim);
			const pin = INK_STEP_PINNED.find((e) => e.theme === id);
			if (pin) inkStepPinSeen.add(pin);
			if (got < INK_STEP_FLOOR) {
				if (!pin)
					fail(
						`${id}: the control ink \`inkMuted\` ${p.inkMuted} sits at ΔE00 ${r2(got)} from the readout ink \`inkDim\` ${p.inkDim} (need ${INK_STEP_FLOOR}) - a chip that opens cannot be told from a reading that does not`,
					);
				else if (!pinMatches(pin.got, got))
					fail(
						`${id}: INK_STEP_PINNED records ${pin.got} but \`inkMuted\`/\`inkDim\` now measure ${r2(got)} - re-measure and update the pin, so the recorded number stays the one in the palette`,
					);
			} else if (pin && !run.composed) {
				fail(
					`${id}: the ink step is pinned at ${pin.got} but now measures ${r2(got)}, clearing the ${INK_STEP_FLOOR} floor - delete the pin rather than leaving dead weight in the contract`,
				);
			}
		}

		/* Adjacent grounds must be a perceptible step, not merely a passing ratio.
	   D21 established that 1.03:1 is a gate floor, not a human threshold -
	   sage's canvas/surface at 1.9 dE00 renders a visible card boundary and
	   localOperatorLight at 1.5 did not.

	   `canvas`/`sunken` is not in this list, and the reason it used to give -
	   "they are never adjacent on screen" - was false: `output-block.tsx` and
	   `log-block.tsx` render `bg-sunken` inside a trace that sits on `canvas`.
	   The real reason is that the pair cannot be separated by luminance in the
	   near-black palettes at all: obsidian's canvas is #09090B and its sunken
	   #030307, ΔE00 1.23, and there is no darker value left to move to that is
	   not black. So those two blocks now carry `border-hairline`. Their sibling
	   `error-block.tsx` has always been bounded too, though by a louder edge -
	   `border-danger-border` on `bg-danger-wash` - because it is reporting a
	   failure; the hairline is the neutral form of the same idea.

	   That edge is asserted here, against all four grounds it is drawn on. It
	   is NOT in `STRUCTURAL`, and an earlier version of this comment claimed it
	   was: `STRUCTURAL` holds `borderControl` and asserts a 3:1 ratio, which a
	   hairline is designed never to reach - a separator that shouted would be a
	   border. Perceptibility is the right question for it, and ΔE00 is what
	   asks it.

	   But NOT at the same floor. 2.0 was calibrated on adjacent ground FIELDS -
	   two large planes meeting - and a 1px line is not a field. The frames
	   proved the difference: at 2.10, localOperatorDark's dropdown separator
	   rendered byte-identical to the panel around it, while the same 2.0 floor
	   is plainly enough for a card sitting on a canvas. A line has almost no
	   area to integrate over, so it needs roughly twice the separation to
	   register at all. Hence two floors, and the line floor is the one that
	   moved five palettes. */
		/* The accent's three states are a ramp the user reads as one control
	   changing, so each step has to be visible for the same reason the ground
	   steps do. Nothing asserted them until now, which is how round 5's
	   pressed-fill repair could cut dracula's rest-to-pressed distance from
	   10.43 to 5.72 without a single gate noticing. These are fields - a whole
	   button fill - so they take the field floor. */
		for (const [a, b, floor = FIELD_SEPARATION_FLOOR] of [
			["canvas", "surface"],
			["surface", "elevated"],
			["elevated", "sunken"],
			["accent", "accentHover"],
			["accentHover", "accentActive"],
			["accent", "accentActive"],
			/* The secondary button's ramp is the ground roles - `surface` at rest,
		   `elevated` on hover, `sunken` when pressed - and its rest-to-pressed
		   pair is the one a keyboard user holding Space actually sees. The two
		   adjacent steps were already asserted above as grounds; the end-to-end
		   distance was not, which is the same gap `accent`/`accentActive`
		   closed for the primary. */
			["surface", "sunken"],
			/* THE REGION BOUNDARY (design round, D3): the conversation's ground against
		   the drawer's, the pair the pane-slot lane paints and `pane-slot-ground`'s
		   claim 1 derives from the same two tokens. It is in THIS list because the
		   pair meets on screen exactly like the steps above it - and it takes its
		   own floor (`REGION_SEPARATION_FLOOR`) because two full-height planes with
		   no rule between them are not a card on a canvas. Measured over the 59
		   palettes: 4.17 (`catppuccinMacchiato`) to 11.64 (`radient`), median 5.46,
		   0 under 4.0. */
			["canvas", "elevated", REGION_SEPARATION_FLOOR],
		]) {
			if (!isHex(p[a]) || !isHex(p[b])) continue;
			run.assertions++;
			const got = deltaE(p[a], p[b]);
			if (got < floor) {
				fail(
					`${id}: adjacent \`${a}\` and \`${b}\` are ΔE00 ${r2(got)} apart (need ${floor}) — a step the eye cannot see is not a step`,
				);
			}
		}

		/*
		 * ---- the legibility pass -------------------------------------------------
		 *
		 * The operator's report was two defects that read as one - "the background
		 * behind the main text is too dark/black" and "text is a little too grey on
		 * grey" - plus a third that arrived beside them: "selections are not very
		 * appealing and look very off, and are often not well contrasted".
		 *
		 * THE LIFT AND THE INKS ARE ONE CHANGE, and this block is the reason. Lifting
		 * a dark ground raises the luminance every ink is measured against, so every
		 * ink ratio falls: simulated with the ladder preserved, `localOperatorDark`'s
		 * `inkDim` on `elevated` goes 4.61 -> 3.71 and `inkDisabled` 2.28 -> 1.83, and
		 * all 23 sub-floor dark palettes gain NEW ink-floor violations. A change that
		 * lifted the grounds without re-authoring the inks would therefore make the
		 * operator's complaint worse, which is why the grounds, the ink weights and
		 * `borderControl` - which fails 3:1 on the lifted `elevated` in eight palettes
		 * - all land in one commit. All 59 palettes satisfy this block with zero
		 * exemptions, which is why it is asserted strictly.
		 */

		/* 1. The lift. A floor on the page ground, and a ceiling at the top of the
	      ladder: both are load-bearing, and for the same reason. */
		{
			const lc = toLab(p.canvas)[0];
			const ls = toLab(p.surface)[0];
			const le = toLab(p.elevated)[0];
			const lk = toLab(p.sunken)[0];
			const dark = p.mode === "dark";

			/* TIER C, AUTHORED IDENTITY: the L* band is where the AUTHORED palettes
			   sit, and a contrast preset leaves it by definition (High is a darker
			   canvas than the band allows, Soft a lighter one). So it is asserted on
			   an authored run only. Every step, ratio and ΔE00 floor around it still
			   runs on a composed palette - the band is the one rule that is a claim
			   about the authored values rather than about legibility. */
			if (!run.composed) {
				run.assertions++;
				if (dark && (lc < LIFT.dark.canvasMin || lc > LIFT.dark.canvasMax)) {
					fail(
						`${id}: dark \`canvas\` ${p.canvas} sits at L* ${r2(lc)} — the band is [${LIFT.dark.canvasMin}, ${LIFT.dark.canvasMax}] in L*. Below the floor the three ink weights and the three ladder steps stop fitting above each other without one of them breaking its own floor; above the ceiling the canvas is no longer the darker tone the operator asked for (2026-11-03), and a palette above it was not re-lit by the band's proportional map`,
					);
				}
				run.assertions++;
				if (dark && le > LIFT.dark.elevatedMax) {
					fail(
						`${id}: dark \`elevated\` ${p.elevated} sits at L* ${r2(le)} — the ceiling is L* ${LIFT.dark.elevatedMax}, because at L* 34 an \`inkDim\` at its floor needs L* 85 and the ink/hover distinction disappears into the top of the ramp`,
					);
				}
				run.assertions++;
				if (!dark && lc > LIFT.light.canvasMax) {
					fail(
						`${id}: light \`canvas\` ${p.canvas} sits at L* ${r2(lc)} — the ceiling is L* ${LIFT.light.canvasMax}. \`elevated\` at L* 100 is the end of sRGB's ramp and the minimum canvas-to-elevated spread is 2.5 + 2.5 L*, so a canvas above 95 has no room for both steps; 94 leaves 1 L* for 8-bit rounding`,
					);
				}
				run.assertions++;
				if (!dark && lk < LIFT.light.sunkenMin) {
					fail(
						`${id}: light \`sunken\` ${p.sunken} sits at L* ${r2(lk)} — the floor is L* ${LIFT.light.sunkenMin}. A light theme's recessed ground is the darkest plane in it, so it is the cap for every ink there and the keycap's ground on every selected row`,
					);
				}
			}

			/* 2. The ladder, as L* offsets from the canvas. `sunken` is measured
		      from the canvas going down, the other two going up. */
			for (const [name, from, to, [lo, hi], step] of [
				["canvas -> surface", "canvas", "surface", STEP.canvasSurface, ls - lc],
				[
					"surface -> elevated",
					"surface",
					"elevated",
					STEP.surfaceElevated,
					le - ls,
				],
				["canvas -> sunken", "canvas", "sunken", STEP.canvasSunken, lc - lk],
			]) {
				run.assertions++;
				if (step < lo - 1e-9 || step > hi + 1e-9) {
					fail(
						`${id}: the ${name} step is ${r2(step)} L*, outside [${lo}, ${hi}] — the bounds are both ends of the same budget: below the floor the two grounds merge, and above the ceiling the step eats the room the ink ladder needs`,
					);
				}
				/* The ratio half of every ground pair (1.03) is asserted by the
			   four-grounds loop above, which covers all six pairs; it is asserted
			   here as well for the three NAMED steps, so the ladder's own rule is
			   stated where the ladder is. */
				assertPair(id, p, from, to, GROUND_RATIO, `${name} step`);
				/* This adds the perceptual half for the two pairs no loop measured
			   before: the well under the canvas, and - since the row/hover pass -
			   the hovered rung over its panel, whose L* floor above is only a
			   proxy for it. See `ELEVATED_PANEL_DELTA_E` for why the proxy had to
			   become the looser of the two. */
				if (
					(from === "canvas" && to === "sunken") ||
					(from === "surface" && to === "elevated")
				) {
					run.assertions++;
					const got = deltaE(p[from], p[to]);
					const need =
						from === "canvas" ? GROUND_STEP_DELTA_E : ELEVATED_PANEL_DELTA_E;
					if (got < need) {
						fail(
							from === "canvas"
								? `${id}: \`canvas\` and \`sunken\` are ΔE00 ${r2(got)} apart (need ${need}) — a well nobody can see is not a well, and both blocks that paint one are read inside a trace that sits on the canvas`
								: `${id}: \`surface\` ${p.surface} and \`elevated\` ${p.elevated} are ΔE00 ${r2(got)} apart (need ${need}) — the hover rung is the ground a hover, a menu and a dialog are all painted on, so it cannot sit closer to the panel than this and still report the pointer; it is also the ground the current row has to outrank, so a rung at this floor is what the row/hover ordering is measured against. Place it at the lowest \`L*\` that clears this and no lower - the row's own rank against the hover is asserted in the row-state loop below, so a rung placed here is a rung the two row fills have to fit above`,
						);
					}
				}
			}
		}

		/* 3. The transcript's own floor: `ink` on `canvas` gets 8.0:1. */
		assertPair(
			id,
			p,
			"ink",
			"canvas",
			INK_CANVAS_FLOOR,
			"the transcript's body ink",
		);

		/* 4. `inkDisabled` is constrained from ABOVE, and only from above: it has no
	      floor, but it must stay weaker than `inkDim` on every ground, or a
	      disabled control stops reading as disabled. */
		for (const g of GROUNDS6) {
			if (!isHex(p.inkDisabled) || !isHex(p.inkDim) || !isHex(p[g])) continue;
			run.assertions++;
			const got = ratio(p.inkDisabled, p[g]);
			const reference = ratio(p.inkDim, p[g]);
			if (got > DISABLED_CEILING * reference + 1e-9) {
				fail(
					`${id}: \`inkDisabled\` on ${g} measures ${r2(got)}:1 against \`inkDim\`'s ${r2(reference)}:1 — a factor of ${r2(got / reference)}, over the ${DISABLED_CEILING} ceiling. A disabled control that meets the ink floors does not read as disabled`,
				);
			}
		}

		/* 5. The ink weights are a hierarchy, so the floors alone are not enough:
	      three inks each at their floor can be the same colour. */
		for (const [lower, upper] of [
			["inkDim", "inkMuted"],
			["inkMuted", "ink"],
		]) {
			if (!isHex(p[lower]) || !isHex(p[upper])) continue;
			run.assertions++;
			const got = deltaE(p[lower], p[upper]);
			if (got < INK_STEP_DELTA_E) {
				fail(
					`${id}: \`${upper}\` and \`${lower}\` are ΔE00 ${r2(got)} apart (need ${INK_STEP_DELTA_E}) — the three weights are a ladder, and a rung the eye cannot see is not a rung`,
				);
			}
		}

		/*
		 * 6. The selection row: the command palette's active row and the picker's
		 * keyboard row, both painted on a dialog's `elevated`.
		 *
		 * Both take `bg-sunken`, which is the repo's own answer and not this pass's:
		 * `picker-host.tsx` chose it for the keyboard's row because it is "the only
		 * ground role that steps perceptibly away from the dialog's own `bg-elevated`
		 * in every one of the palettes" (re-measured here: ΔE00 6.07-16.18 across all 59
		 * on the grounds this branch ships - the figure at the commit that chose the role
		 * was 5.85-16.70, measured before the legibility pass lifted 31 `sunken` and 32
		 * `elevated` values), and
		 * the command palette's active row was the sibling that kept the accent wash
		 * alone - the row the operator screenshotted, which read 1.003:1 on
		 * `localOperatorDark` while passing every threshold by hue.
		 *
		 * WHAT THIS DOES NOT ASSERT, and why - it is a RECORDED deviation rather than
		 * a passed check. The rule a purpose-authored selection step has to satisfy
		 * also includes a hue clause (within 45° of its base where the base's chroma
		 * is >= 4, else chroma within the base's plus 4). `sunken` is the palette's
		 * own recessed ground rather than a tint authored for this row, and it does not
		 * satisfy that clause in eight palettes: seven light palettes carry more chroma
		 * in `sunken` than their own near-neutral `elevated` plus the 4 the clause
		 * grants - alucard 9.98 C* against 6.56, ayuLight 4.75 against 4.00,
		 * localOperatorLight 7.54 against 5.56, mintLight 10.01 against 5.24,
		 * rosePineDawn 7.81 against 5.07, sage 9.67 against 6.56, solarizedLight 10.10
		 * against 6.06 - and `dune`'s sunken sits 49.58° from its elevated, 4.58°
		 * outside the limit. Both are the palette's own cast on a
		 * recessed plane, which is what the clause exists to catch only when it has
		 * been AUTHORED onto a selection; the two marks the clause would otherwise
		 * separate are separated here by ΔE00 6.07-16.18, the widest margin in the
		 * system. Recorded as an open question for the design round rather than
		 * silently dropped.
		 */
		{
			const got = deltaE(p.sunken, p.elevated);
			run.assertions++;
			if (got < SELECTION_DELTA_E) {
				fail(
					`${id}: the palette/picker active row (\`sunken\` ${p.sunken}) is ΔE00 ${r2(got)} from the dialog ground it is painted on (\`elevated\` ${p.elevated}), need ${SELECTION_DELTA_E} — a selection is a state the reader has to find while scanning, not a surface they read, and below this band it stops being findable`,
				);
			}
			run.assertions++;
			const step = Math.abs(toLab(p.sunken)[0] - toLab(p.elevated)[0]);
			if (step < SELECTION_LIGHTNESS_STEP) {
				fail(
					`${id}: the palette/picker active row sits ${r2(step)} L* from \`elevated\`, under the ${SELECTION_LIGHTNESS_STEP} L* floor — ΔE00 is a budget a chroma-only step can spend while the mark vanishes in a greyscale render, so the lightness half is asserted too`,
				);
			}
		}

		/*
		 * 6b. The user message block's fill: its boundary IS the fill (D10), so it
		 * has to be findable, and on the palettes where the shared `surface` step
		 * lands low it is not (sage 2.05, `catppuccinMacchiato` 2.08, `oneLight`
		 * 2.10 - the operator's "the contrast between the user message background and
		 * the chat background is quite poor on some themes"). The floor is
		 * `MESSAGE_SURFACE_DELTA_E` (its own comment carries why 4.0), measured off
		 * `canvas` - the working surface the block is drawn on - with the lightness
		 * half asserted too so a chroma-only step cannot pass while the fill vanishes
		 * in a greyscale render. The `CONTROLS` row titled "user message bubble" was
		 * retired here: post-D10 the component draws no edge of its own, so the row
		 * measured a `borderControl` border that no longer renders; this block is
		 * what asserts the pairing the component actually has.
		 */
		{
			/* A palette missing the role already failed the completeness check above;
		   this block must skip rather than crash on it, the way every other loop
		   here does. A PRESENT-but-malformed value is the other case, and it must
		   FAIL rather than skip: measured (agent review round 1, R2), setting
		   `messageSurface: "notahex"` left this gate exiting 0 with the count
		   falling 28,111 -> 28,083 - the block's whole floor silently switched off
		   by a value the palette parser accepts, and a tree that looks green. A
		   skip guard may answer "absent"; "malformed" has to be loud, because a
		   malformed value that disarms a floor is worse than no floor. */
			if (p.messageSurface === undefined) continue;
			if (!isHex(p.messageSurface)) {
				fail(
					`${id}: the user message block's fill \`messageSurface\` ${JSON.stringify(p.messageSurface)} is present but not a flat hex colour, so the role's floor would be silently unmeasured - a malformed value must not switch a floor off`,
				);
				continue;
			}
			if (!isHex(p.canvas)) continue;
			const got = deltaE(p.messageSurface, p.canvas);
			run.assertions++;
			if (got < MESSAGE_SURFACE_DELTA_E) {
				fail(
					`${id}: the user message block's fill \`messageSurface\` ${p.messageSurface} is ΔE00 ${r2(got)} from \`canvas\` ${p.canvas} (need ${MESSAGE_SURFACE_DELTA_E}) — the fill IS the block's boundary, and below this band it stops being findable`,
				);
			}
			run.assertions++;
			const step = Math.abs(toLab(p.messageSurface)[0] - toLab(p.canvas)[0]);
			if (step < MESSAGE_SURFACE_LIGHTNESS_STEP) {
				fail(
					`${id}: the user message block's fill sits ${r2(step)} L* from \`canvas\`, under the ${MESSAGE_SURFACE_LIGHTNESS_STEP} L* floor — ΔE00 is a budget a chroma-only step can spend while the mark vanishes in a greyscale render, so the lightness half is asserted too`,
				);
			}
		}

		/*
		 * 6c. The media tile's fill: the tile's extent at rest IS the fill (it draws
		 * no edge until hover/focus), so it has to be findable, and the shared
		 * `sunken` well it used to wear cannot carry that - below ΔE00 4.0 on 55 of
		 * the 59 palettes, bottoming at 2.00 (`iceberg`, `neonNoir`) - which is the
		 * tile a page-toned picture had. The floor is `MEDIA_SURFACE_DELTA_E` (its own
		 * comment carries why 4.0), measured off `canvas` - the ground the strip is
		 * drawn on - with the lightness half asserted too so a chroma-only step
		 * cannot pass while the fill vanishes in a greyscale render. No ink sits on
		 * this fill (the failed-tile receipt is the one tile state with a glyph, and
		 * it keeps `sunken`; see its pin below), so there is no ink row here, unlike
		 * `messageSurface`'s. The fill is also deliberately not paired with the
		 * returning edge: `borderControl`'s >= 3:1 is the ground relationship (see
		 * `MEDIA_SURFACE_DELTA_E`'s comment), so no edge-vs-fill row exists here and
		 * none should be added - on 10 light palettes that pairing measures below
		 * 3:1 (2.78 worst, `catppuccinLatte`), and the frame the design round asked
		 * for lives in `docs/evidence/chat-media-slot-fill/letterbox-hover/`.
		 */
		{
			/* Absent values are the completeness check's business; a PRESENT but
		   malformed one must fail loudly rather than switch the floor off - the
		   same guard, for the same reason, as the block one over. */
			if (p.mediaSurface === undefined) continue;
			if (!isHex(p.mediaSurface)) {
				fail(
					`${id}: the media tile's fill \`mediaSurface\` ${JSON.stringify(p.mediaSurface)} is present but not a flat hex colour, so the role's floor would be silently unmeasured - a malformed value must not switch a floor off`,
				);
				continue;
			}
			if (!isHex(p.canvas)) continue;
			const got = deltaE(p.mediaSurface, p.canvas);
			run.assertions++;
			if (got < MEDIA_SURFACE_DELTA_E) {
				fail(
					`${id}: the media tile's fill \`mediaSurface\` ${p.mediaSurface} is ΔE00 ${r2(got)} from \`canvas\` ${p.canvas} (need ${MEDIA_SURFACE_DELTA_E}) — the fill IS the borderless tile's extent, and below this band it stops being findable`,
				);
			}
			run.assertions++;
			const step = Math.abs(toLab(p.mediaSurface)[0] - toLab(p.canvas)[0]);
			if (step < MEDIA_SURFACE_LIGHTNESS_STEP) {
				fail(
					`${id}: the media tile's fill sits ${r2(step)} L* from \`canvas\`, under the ${MEDIA_SURFACE_LIGHTNESS_STEP} L* floor — ΔE00 is a budget a chroma-only step can spend while the fill vanishes in a greyscale render, so the lightness half is asserted too`,
				);
			}
		}

		/*
		 * 7. The accent wash is a HOVER and CALLOUT tint - not a selection ground.
		 *
		 * It keeps every other use it has (pointer hover fills, chips, the find-match
		 * tint, the ask-option card, the browser tab-strip marker, the `border-accent`
		 * markers) and gains this one floor: half a selection's, because a hover is
		 * transient and is paired with the pointer. It fails in 11 palettes at the
		 * old scope - 7 on `surface` (`catppuccinMacchiato` 0.80, `tokyoNight` 1.05,
		 * `alucard` 1.22, `solarizedDark` 1.61, `catppuccinFrappe` 1.79, `everforest`
		 * 1.80, `kanagawaWave` 1.89), 2 on `elevated` (`obsidian` 0.77, `everforest`
		 * 1.42) and 2 on `sunken` (`tokyoNightDay` 1.13, `ayuLight` 1.81) - which is
		 * why the wash is re-authored in those 11 rather than the floor being set
		 * where the existing values happen to sit.
		 */
		for (const g of GROUNDS) {
			if (!isHex(p.accentWash) || !isHex(p[g])) continue;
			run.assertions++;
			const got = deltaE(p.accentWash, p[g]);
			if (got < HOVER_DELTA_E) {
				fail(
					`${id}: the accent wash on ${g} is ΔE00 ${r2(got)} (need ${HOVER_DELTA_E}) — a hover tint the reader cannot see is a hover state the pointer cannot report, and this pair reads 1.00-1.24:1, so no ratio assertion in this file can see it`,
				);
			}
		}

		/*
		 * 8. The keycap's ground, against everything it can be painted on.
		 *
		 * A keycap is an annotation on the row the user has just SELECTED, so the
		 * pair that decides whether it survives is `sunken` against the state
		 * grounds: measured at the old scope, `tokyoNightDay` rendered it at ΔE00
		 * 1.13 on `accentWash` and `ayuLight` at 1.81 - a cap whose ground disappears
		 * under it. The cap's SHAPE and its ink are other rows; this is its ground.
		 *
		 * THE TWO ROW STATES ARE NO LONGER IN THIS PAIR (row-state refinement,
		 * 2026-09-18), by the same argument that withdrew the row roles' own
		 * `canvas`/`elevated`/`sunken` collision floor: a row fill that is the panel's
		 * own colour one step up IS a rung of the ladder, and `sunken` is the rung one
		 * below it - so on the 9 palettes whose ladder is at its own 2.0 floor the
		 * measured gap runs 0.44 (`alucard`) to 1.86 (`iceberg`), and no legal fill
		 * can clear it, because clearing it would mean leaving the ladder the fill
		 * has just been put on. The premise moved too: the cap carries NO fill of its
		 * own any more (the `bg-sunken` cap was removed by the operator's report in
		 * `keyboard-shortcut.tsx`), so what a cap needs on a row is its INK against
		 * that row, which is asserted for all four ink weights where the rows are
		 * grounds in `GROUNDS6`. The risk this accepts: a `bg-sunken` box placed
		 * INSIDE a selected or hovered row would merge with it on those 9 palettes.
		 * Nothing in the tree does that today - the rail's current rows are
		 * `rowSelected` and the caps on them are fill-less text - and it is stated
		 * here rather than left for a reviewer to discover.
		 */
		for (const g of ["canvas", "surface", "elevated", "accentWash"]) {
			if (!isHex(p.sunken) || !isHex(p[g])) continue;
			run.assertions++;
			const got = deltaE(p.sunken, p[g]);
			if (got < KEYCAP_DELTA_E) {
				fail(
					`${id}: the keycap's ground \`sunken\` ${p.sunken} is ΔE00 ${r2(got)} from ${g} ${p[g]} (need ${KEYCAP_DELTA_E}) — the cap annotates the row the reader has just selected, so its ground has to survive being painted on that row`,
				);
			}
		}

		/* The chart's hover mark: findable among its siblings, and never closer to the
	   plot ground than the resting mark. */
		if (
			isHex(p.chartBarHover) &&
			isHex(p.accent) &&
			isHex(p[CHART_HOVER_GROUND])
		) {
			run.assertions++;
			const separation = deltaE(p.chartBarHover, p.accent);
			if (separation < CHART_HOVER_SEPARATION_FLOOR) {
				fail(
					`${id}: \`chartBarHover\` ${p.chartBarHover} is ΔE00 ${r2(separation)} from \`accent\` ${p.accent}, need ${CHART_HOVER_SEPARATION_FLOOR} — a mark the reader has to find among its SIBLINGS is compared with them, not with itself across two states`,
				);
			}
			run.assertions++;
			const hovered = ratio(p.chartBarHover, p[CHART_HOVER_GROUND]);
			const resting = ratio(p.accent, p[CHART_HOVER_GROUND]);
			if (hovered < resting) {
				fail(
					`${id}: \`chartBarHover\` is ${r2(hovered)}:1 on ${CHART_HOVER_GROUND} where \`accent\` is ${r2(resting)}:1 — the hovered mark must not recede toward the ground it is drawn on`,
				);
			}
		}

		/* Both ends of the hairline's range, because only one of them was gated.
		 *
		 * The floor doubled to 4.0 on the argument that a rule needs more than a
		 * field, and the thing that stops that argument running away - "and it
		 * still has to stay a hairline, not become a border" - was written in prose
		 * and enforced nowhere. A `#6e6e73` obsidian hairline passes at 4.06:1
		 * against canvas, sits ΔE00 2.70 from `borderControl`, and clears every
		 * other assertion in this file. So the ceiling is a rule now too.
		 */
		for (const ground of GROUNDS) {
			if (!isHex(p.hairline) || !isHex(p[ground])) continue;
			run.assertions++;
			const got = deltaE(p.hairline, p[ground]);
			if (got < LINE_SEPARATION_FLOOR) {
				fail(
					`${id}: \`hairline\` on \`${ground}\` is ΔE00 ${r2(got)} (need ${LINE_SEPARATION_FLOOR}) — a 1px line has no area to integrate over, so a step that reads between two fields disappears in a rule`,
				);
			}
			const luminance = ratio(p.hairline, p[ground]);
			run.assertions++;
			if (luminance < HAIRLINE_RATIO_FLOOR) {
				fail(
					`${id}: \`hairline\` on \`${ground}\` is ${r2(luminance)}:1 (need ${HAIRLINE_RATIO_FLOOR}) — its ΔE00 is carried in chroma, which a 1px line does not survive`,
				);
			}
			run.assertions++;
			if (luminance > HAIRLINE_RATIO_CEILING) {
				fail(
					`${id}: \`hairline\` on \`${ground}\` is ${r2(luminance)}:1 (max ${HAIRLINE_RATIO_CEILING}) — past this it is drawing a border, and the system already has one of those`,
				);
			}
		}

		/*
		 * The panel seam, in both places it is drawn: `hairline` at
		 * `PANEL_SEAM_ALPHA` over a `surface` panel (the sidebar and the rail) and over
		 * an `elevated` pane. Each is measured against the ground it composites onto AND
		 * against the plane it faces, because a seam invisible from either side is a
		 * seam that only reads along part of its length.
		 *
		 * The three facing pairs are the shell's adjacencies: chrome beside the
		 * conversation (`surface`/`canvas`), chrome beside an open pane
		 * (`surface`/`elevated`), and a pane beside the conversation
		 * (`elevated`/`canvas`). The second is the tightest in the shipped fleet because
		 * the seam is composited on `surface` while it faces `elevated` - which is
		 * exactly the pair a marker drawn on one side is easy to forget.
		 */
		for (const [ground, facing] of SEAM_PAIRS) {
			if (!isHex(p.hairline) || !isHex(p[ground]) || !isHex(p[facing]))
				continue;
			const seam = over(p.hairline, p[ground], PANEL_SEAM_ALPHA);
			run.assertions++;
			const fromGround = deltaE(seam, p[ground]);
			if (fromGround < FIELD_SEPARATION_FLOOR) {
				fail(
					`${id}: the panel seam over \`${ground}\` is ΔE00 ${r2(fromGround)} from that ground (need ${FIELD_SEPARATION_FLOOR}) — the seam is half the boundary, and half a boundary the reader cannot see is a panel edge that disappears`,
				);
			}
			run.assertions++;
			const fromFacing = deltaE(seam, p[facing]);
			if (fromFacing < FIELD_SEPARATION_FLOOR) {
				fail(
					`${id}: the panel seam over \`${ground}\` is ΔE00 ${r2(fromFacing)} from \`${facing}\` (need ${FIELD_SEPARATION_FLOOR}) — the seam has to read from the plane it faces as well as the one it sits on`,
				);
			}
		}

		/*
		 * THE TEAM BRIDGE ARRIVAL BAND (contract section 5a; reasoning at
		 * `ARRIVAL_BAND_ALPHA`). Moved here from the contract's own palette loop
		 * (agent review round 1, M1 on #1674) so the composition engine's accent
		 * and contrast solvers, which use this function as their oracle, honour the
		 * band's rank over `rowSelected`/`rowHover` - before the move a custom
		 * accent could be applied that `pnpm check-themes` rejects.
		 */
		const band = over(p.accent, p.surface, ARRIVAL_BAND_ALPHA);
		for (const [role, floor, label] of [
			["inkMuted", FLOOR.text, "washed row metadata ink"],
			// Transient ground: see why this is not the strong-text floor above.
			["ink", FLOOR.text, "washed row body ink"],
		]) {
			const ink = p[role];
			if (!isHex(ink)) continue;
			run.assertions++;
			const got = r2(ratio(ink, band));
			if (got >= floor) continue;
			fail(
				`${id}: ${label} — ${role} ${ink} on the arrival band ${band} (accent ${ARRIVAL_BAND_ALPHA} over surface) = ${got}:1, need ${floor}:1`,
			);
		}
		const arrival = ratio(band, p.surface);
		const hover = ratio(p.rowHover, p.surface);
		const current = ratio(p.rowSelected, p.surface);
		run.assertions += 2;
		if (arrival <= hover)
			fail(
				`${id}: the arrival band is ${r2(arrival)}:1 over the pane and the row hover is ${r2(hover)}:1 — the mark the reader was TOLD about cannot be drawn more quietly than one their pointer rests on`,
			);
		if (arrival <= current)
			fail(
				`${id}: the arrival band is ${r2(arrival)}:1 over the pane and the selected row is ${r2(current)}:1 — the arrival must outrank the row the reader is already on, or the landing reads as a selection`,
			);
	}
};
