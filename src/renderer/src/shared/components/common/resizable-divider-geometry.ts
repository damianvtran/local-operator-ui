/**
 * The axis arithmetic a resizable separator shares with the panels it sizes.
 *
 * WHY this is its own module rather than a handful of expressions inside
 * `resizable-divider.tsx`. The separator learned a second axis (the chat
 * sidebar's list region is sized by a boundary it sits under), and every rule
 * on that axis is a pure function of four things: which edge the handle is
 * anchored to, which way the pointer or the key is travelling, and the two
 * bounds. Written inline, the horizontal case would be a second copy of the
 * sign rule and a second copy of the key map beside the vertical one - and the
 * defect that costs is the one no test can reach, because `pnpm test:desktop`
 * bundles modules in memory rather than rendering the component
 * (`sidebar-catalogue-gate.ts` states the same argument for the same reason).
 * `scripts/sidebar-split.test.mjs` drives THESE functions, and the component
 * calls them, so the arithmetic under test is the arithmetic that ships.
 *
 * The module imports nothing, deliberately: the separator itself pulls in
 * React and `@shared/lib/utils`, and a test that had to bundle those to reach
 * four pure functions would be paying for the component to check the maths.
 *
 * WHAT THIS FILE DOES NOT DECIDE: which side a panel's handle is on, where the
 * bounds come from, and what a write is refused for. Those are the caller's -
 * the chat sidebar's own decisions live in `features/chat/sidebar-split.ts`.
 */

/** The four edges a separator can be anchored to. */
export type DividerSide = "left" | "right" | "top" | "bottom";

/** The axis a separator runs along. */
export type DividerOrientation = "vertical" | "horizontal";

/** Arrow-key resize step, and the coarse step Shift selects. */
export const KEYBOARD_STEP = 16;
export const KEYBOARD_STEP_COARSE = 64;

/**
 * `+1` when movement in the axis's POSITIVE direction (`+x` rightwards, `+y`
 * downwards) grows the sized panel, `-1` when it shrinks it.
 *
 * The rule is "wider is away from the pane's anchored edge": a pane whose
 * handle is on its LEFT edge is anchored at its right, so moving the handle
 * leftwards - a negative `x` - makes it wider. `bottom` is the same shape one
 * axis over: a pane whose handle is on its bottom edge is anchored at its top,
 * so moving the handle down makes it taller.
 */
export const growSign = (side: DividerSide): 1 | -1 =>
	side === "right" || side === "bottom" ? 1 : -1;

/** The clamp both of the separator's inputs share. */
export const clampRegion = (value: number, min: number, max: number): number =>
	Math.max(min, Math.min(max, value));

/**
 * The size a drag lands on: the size it started at, plus the pointer's travel
 * along the axis with the anchored-edge sign, clamped to the live bounds.
 *
 * `start` is the DRAWED size the drag began at, which is not always a stored
 * value: a panel whose size is `auto` measures itself at `pointerdown` and
 * hands the measurement in, because the first move should move the panel by
 * the pointer's travel rather than snap it to a number nobody chose.
 */
export const dragTarget = (
	start: number,
	delta: number,
	side: DividerSide,
	min: number,
	max: number,
): number => clampRegion(start + delta * growSign(side), min, max);

/** The axis a side implies. Derived rather than passed, so the two cannot disagree. */
const isHorizontal = (side: DividerSide): boolean =>
	side === "top" || side === "bottom";

export type KeyboardTargetInput = {
	shiftKey: boolean;
	/** The size the panel is drawn at right now. */
	value: number;
	min: number;
	max: number;
	side: DividerSide;
	/**
	 * Which extremes `Home`/`End` answer to.
	 *
	 * `"axis"` (the default, and every call site that passes nothing) keeps the
	 * shipped meaning: Home is the size the panel has when the handle sits at the
	 * AXIS's start, which is `min` for a right/bottom-anchored panel and `max` for
	 * a left/top-anchored one.
	 *
	 * `"value"` is the APG register for a separator whose VALUE is a pane's size:
	 * Home is that pane's smallest and End its largest, whichever edge of it the
	 * handle sits on. The chat sidebar's boundary is exactly that separator - its
	 * value is the chats list's height, its name is `Resize the chats list`, and
	 * its `aria-valuemin`/`max` are that region's bounds - and in the default order
	 * (the handle on the list region's TOP edge) the axis register put Home at the
	 * list's MAXIMUM, inverting it against both the pattern and this app's own
	 * `Resize chat sidebar` (design round 2, D8).
	 *
	 * A REGISTER RATHER THAN A NEW RULE, because the two registers disagree only
	 * for a handle on a pane's left/top edge: `side="right"` reads the same under
	 * both, so the sidebar's own width divider is unaffected, while the three
	 * `side="left"` panels in `chat-content.tsx` (canvas, run, browser) would have
	 * their Home/End silently swapped by making `"value"` the default. That is a
	 * user-visible behaviour change on three surfaces this change has no business
	 * touching; those call sites keep `"axis"` and their divergence from the
	 * pattern is recorded on the pull request as deferred.
	 */
	homeEnd?: "axis" | "value";
};

/**
 * The size a key press targets, or `null` for "restore your default", or
 * `undefined` when the key is not this separator's to consume.
 *
 * THREE answers rather than two, and the third is load-bearing: a separator
 * that returned only a number could not tell a caller whether it may
 * `preventDefault()`, and the panel's own walk does not consult
 * `defaultPrevented` at all - it reads the key itself on `[data-chat-row]` and
 * on the disclosures - so a key this separator does not own must be left
 * UNTOUCHED, not merely reported unchanged.
 *
 * The key set is AXIS-MATCHED. A vertical separator owns Left/Right; a
 * horizontal one owns Up/Down. It must not own both: `chat-sidebar.tsx`'s
 * `keyDown` walks the panel's rows on Up/Down and jumps to the first and last
 * on Home/End, so a horizontal separator that answered Up/Down without
 * `stopPropagation` would resize the panel and move focus on one press
 * (`sidebar-split.test.mjs` pins the answer, the QA matrix pins the bubbling).
 *
 * Home and End go to the AXIS extremes rather than to min and max: Home is the
 * size the panel has when the handle sits at the axis's start, which is `min`
 * for a handle on the pane's right or bottom edge and `max` for one on its
 * left or top edge - the same `growSign` the drag reads.
 */
export const keyboardTarget = (
	key: string,
	{ shiftKey, value, min, max, side, homeEnd = "axis" }: KeyboardTargetInput,
): number | null | undefined => {
	const step = shiftKey ? KEYBOARD_STEP_COARSE : KEYBOARD_STEP;
	const axisStart = growSign(side) === 1 ? min : max;
	const axisEnd = growSign(side) === 1 ? max : min;
	/*
	 * `homeEnd` decides the EXTREMES and nothing else: the arrows stay axis-based
	 * in both registers, because those move the HANDLE and the handle's travel is
	 * a fact about the layout rather than about which pane is named. See the input
	 * type for why the two registers disagree and why the default is `"axis"`.
	 */
	const homeValue = homeEnd === "value" ? min : axisStart;
	const endValue = homeEnd === "value" ? max : axisEnd;
	/*
	 * Positive is the axis's own positive direction, so the arrow that points
	 * that way moves the size that way - and "the size that way" already
	 * carries the anchored-edge sign through `dragTarget`.
	 *
	 * WHAT THE NUMBER DOES DEPENDS ON THE ORDER, and the recorded rationale for
	 * keeping this register has to say so (UX round 1's U6 kept it; agent review
	 * round 2's NIT-4 found the note one fact short): the announced value is the
	 * CHATS REGION's height, and `chats-first` puts that region ABOVE this
	 * boundary, so the same `ArrowDown` raises the advertised number in one
	 * persisted order and lowers it in the other. That is the labelled pane's
	 * position rather than a defect - the arrows move the HANDLE, and the handle's
	 * travel is a fact about the layout - but a reader weighing the alternative
	 * (an arrow that raises the advertised number in both orders) needs the fact
	 * in front of them rather than an assertion that the register is consistent.
	 */
	if (isHorizontal(side)) {
		if (key === "ArrowDown") return dragTarget(value, step, side, min, max);
		if (key === "ArrowUp") return dragTarget(value, -step, side, min, max);
	} else {
		if (key === "ArrowRight") return dragTarget(value, step, side, min, max);
		if (key === "ArrowLeft") return dragTarget(value, -step, side, min, max);
	}
	if (key === "Home") return homeValue;
	if (key === "End") return endValue;
	/* The caller's own default, which only it can restore. */
	if (key === "Enter") return null;
	return undefined;
};
