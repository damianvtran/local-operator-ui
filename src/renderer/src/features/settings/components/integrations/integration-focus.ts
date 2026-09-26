/**
 * What a row's focus move does when the row re-stands under it.
 *
 * ## Why this is a module of its own
 *
 * It lived as the body of a `useEffect` in `mcp-management-section.tsx`, and the
 * only thing that could exercise it was a live pointer on a running app: the
 * decision it makes - a landed move whose control has been replaced is RE-APPLIED
 * onto the control the row has now, and is abandoned the moment anybody else
 * holds focus - is three comparisons over a node, a deadline and
 * `document.activeElement`, with no React in it at all. Left inline, the arm that
 * matters had no cell anywhere: CI could not reach it and the walk that found
 * the defect (UX round 5, U21) had to be repeated by hand after every change.
 * A leaf module with no imports is bundlable in memory and drivable with fake
 * nodes (`scripts/integration-model.test.mjs`), exactly as
 * `features/chat/sidebar-focus-hold.ts` beside it is.
 *
 * ## The defect it decides about
 *
 * A row that changes group is MOUNTED AGAIN, not moved: each group is its own
 * `<ul>` under its own `<section>`, so React unmounts the row in the old list and
 * mounts a fresh node in the new one, and a focused control cannot survive its
 * own node being replaced. Measured on the built app after a successful sign-out:
 * the row's `⋯` held focus at 1.5 s, `<body>` at 2.8 s, `⋯` again at 3.1 s and
 * `<body>` at 5.3 s, with the sampled row and menu reporting `isConnected: false`
 * (UX round 5, U21; the same signature on a key save's Available -> Connected,
 * while the remove flow - which lands on a NEIGHBOURING row - holds, which is what
 * makes this the row's own re-stand rather than the mechanism failing).
 *
 * ## The rule, and what it refuses to do
 *
 * The move is not finished when it lands; it is finished when the control it
 * landed on is still the row's control. Until the move's window closes, a
 * detached landing is the signal that the row re-stood, and the move is
 * re-applied onto whatever the row has where it now stands. Two refusals keep
 * that from becoming the focus-stealing this whole mechanism exists to avoid:
 *
 * - **Nobody else's focus is taken.** A landing is only re-applied while the
 *   document's active element is nobody: `<body>`, nothing at all, or the move's
 *   OWN landed node when the engine is still reporting that detached element as
 *   active. The moment a control of the reader's holds the caret, that is the
 *   answer and the move is dropped.
 *
 *   WHAT "NOBODY" DOES NOT MEAN, stated because the difference is a behaviour this
 *   rule INTRODUCES and the first version of this doc claimed otherwise: a reader
 *   who TABS or CLICKS A CONTROL is covered - the caret moves and the move is
 *   dropped - but one who clicks NON-FOCUSABLE chrome leaves
 *   `document.activeElement === body`, which is indistinguishable from the state a
 *   replaced control leaves, so the move can still be re-applied onto the row after
 *   such a click. Before this rule the move was consumed when it landed and no click
 *   could bring it back, so this is new (agent review round 1, MINOR 2). It is the
 *   deliberate side of the trade: the row the reader was on is where their next Tab
 *   should continue from, the window below still bounds how long that offer stands,
 *   and the alternative - treating every `body` as "the reader left" - would drop the
 *   move in the one state the rule exists for (`<body>` is exactly where a control
 *   that becomes `disabled` or unmounts leaves the caret).
 * - **The window still bounds the move.** Past `until` the hold is dropped
 *   whatever the nodes say, so a row that keeps re-standing cannot keep a move
 *   alive indefinitely (`m-4`: a focus move that does not happen is a small
 *   thing, one that happens at the wrong moment is not).
 */

/** A focus move that has already landed: the control it focused, and its window. */
export type FocusHold = {
	/** The control the move focused, as it was when the move landed. */
	node: HTMLElement;
	/** The move's own deadline, in `Date.now()` terms. */
	until: number;
};

/**
 * What a landed move does now that the row may have re-stood under it.
 *
 * - `settled` - the control the move focused is still in the document, so the row
 *   has not re-stood: leave focus exactly where it is. This is the common case and
 *   the reason the hold is inert rather than a poll.
 * - `restore` - the landed control has left the document and nothing holds focus,
 *   while the row has a control that is in the document: land on that one instead.
 *   A row that moved group under a focused control is the case this exists for.
 * - `drop` - stop: the window has closed, or somebody else holds focus, or the row
 *   has no control in the document to land on. `<body>` is where a move that is
 *   dropped leaves focus, which is strictly better than a move taken late.
 */
export type FocusHoldStep = "settled" | "restore" | "drop";

/**
 * The step a landed move takes, given the row's control as it stands now.
 *
 * `active` and `body` are passed in rather than read here so the rule stays a
 * function of its inputs: this module has no `document`, which is what lets the
 * suite drive it with fake nodes, and it is also why `body` is compared by
 * identity rather than by tag name.
 */
export function focusHoldStep(args: {
	hold: FocusHold;
	candidate: HTMLElement | null | undefined;
	/** `window.document.activeElement` when the step is taken. */
	active: Element | null;
	/** `window.document.body` - the element that means "nobody holds focus". */
	body: Element | null;
	now: number;
}): FocusHoldStep {
	if (args.now > args.hold.until) return "drop";
	if (args.hold.node.isConnected) return "settled";
	/*
	 * THE MOVE'S OWN LANDED NODE COUNTS AS NOBODY (agent review round 1, MINOR 1).
	 *
	 * A control removed from the document is USUALLY reported by the engine as
	 * `<body>` - that is what the walk measured (`<body>` at 2.8 s) - but nothing
	 * makes that a property, and a detached element CAN still be the active one.
	 * When it is, the thing holding focus is the control this move landed on, left
	 * behind by the very re-stand the rule exists for, so the move is ours to
	 * re-apply rather than somebody else's to own. Reading it as "somebody else
	 * holds focus" would return `drop` in exactly the state this rule was written
	 * for, and leave focus on `<body>` for good - the U21 defect, restored.
	 */
	if (
		args.active &&
		args.active !== args.body &&
		args.active !== args.hold.node
	)
		return "drop";
	return args.candidate?.isConnected ? "restore" : "drop";
}
