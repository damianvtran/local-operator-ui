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
 * landed on is still the control the move would land on NOW. Two signals say it is
 * not: the landed control has left the document (the row was mounted again), or the
 * row now has a control of its own that the move is not on - it gained the primary
 * it had none of while its operation was running (UX round 2, U30). Until the move's
 * window closes, a move in either state is re-applied onto whatever the row has where
 * it now stands. Three refusals keep that from becoming the focus-stealing this whole
 * mechanism exists to avoid:
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
 * - **The window is anchored on the ROW, not on the press, and its term is read
 *   from the row's own operation rather than from a render.** `until` is not a
 *   clock that starts when the reader presses something. While the row is moving -
 *   the same two terms the list's own poll reads, a row still `connecting` or an
 *   operation of its own still running - every read pushes the deadline forward,
 *   because a move whose window closes before the operation it is following can
 *   finish is not a move this rule gets to make. Measured on the built app, the
 *   app's own landing came at 250 ms while the daemon's answer re-stood the row at
 *   4 250 ms (a 3 s server) and at 21 750 ms (a 20 s one), and the arm's
 *   `dispatch + FOCUS_ARM_MS` window had closed underneath both, leaving the caret
 *   on `<body>` for every server slower than the app's own dispatch (QA round 2,
 *   Q1; UX round 2, U31).
 *
 *   WHO READS THAT TERM IS PART OF THE RULE, not an implementation detail (QA
 *   round 3, Q-1; UX round 3, U31). A term taken from a React render is a term a
 *   poll can silently freeze: React Query's structural sharing hands the same
 *   object back for a payload deeply equal to the cached one, so a render that
 *   tracks only the props it reads need not happen at all, and an effect gated on
 *   those props need not run. The round-2 version read `rowMoving` inside exactly
 *   such an effect, so on a row whose own operation outlived the arm the deadline
 *   never advanced past `arm + FOCUS_ARM_MS` and the caret was on `<body>` for the
 *   whole of a 5 s, 8 s and 20 s answer - and no `focus()` was attempted at the
 *   group change at all, which is the reading that separates "the move was applied
 *   and lost" from "the app never tried". Both readers now take the term from the
 *   page's OWN read of the row - the document as the last poll wrote it, asked on
 *   demand rather than through a render - so the answer is fresh whether or not a
 *   render happened (`readDocument` in `use-integrations.ts`; the watcher in
 *   `mcp-management-section.tsx`).
 * - **A row that keeps re-standing is given up on.** A re-stand re-anchors the
 *   deadline, so `reanchors` counts the re-MOUNTS one move has followed - the
 *   landed control leaving the document - and the move is dropped at
 *   `FOCUS_REANCHOR_CAP` of them (`m-4`). That count, not a clock, is what bounds
 *   the extension: a row mounted again that many times under one move is not the
 *   single group change this rule was written for, and what m-4 refuses is a move
 *   that fires late rather than one that never happens.
 */

/** A focus move that has already landed: the control it focused, and its window. */
export type FocusHold = {
	/** The control the move focused, as it was when the move landed. */
	landedOn: HTMLElement;
	/**
	 * The move's own deadline, in `Date.now()` terms. The EFFECTIVE deadline is
	 * `focusHoldWindow`'s answer rather than this field: while the row is moving the
	 * deadline is later than what is stored here, and the caller is the one holding
	 * the row's state.
	 */
	until: number;
	/**
	 * How many re-MOUNTS this move has already followed (see the cap below). Not
	 * "how many times the move's target changed": a row that gains and loses its
	 * primary under one move changes its candidate without ever being mounted again,
	 * and counting that against this bound gave up on a row mid-operation (agent
	 * review round 3, MINOR 5).
	 */
	reanchors: number;
};

/**
 * How many times one move may follow a row that is MOUNTED AGAIN under it.
 *
 * NOT a duration, and that is the point (QA round 2, Q1; UX round 2, U31): the
 * extension a slow operation needs is not bounded by a clock that can expire
 * before the operation does. A row that re-stands this many times under one move
 * is flapping - one operation produces one group change - so the move is dropped
 * rather than chasing it, which is what m-4 asks for in the first place.
 *
 * WHAT IS COUNTED AGAINST IT IS THE RE-MOUNT AND NOTHING ELSE (agent review round
 * 3, MINOR 5). This bound is the only thing standing between a slow operation and
 * "the caret simply stops coming back", so a signal that fires without a re-mount
 * has no business spending it: `focusHoldRead` increments this on the landed
 * control having LEFT the document, and a move that merely re-resolves onto a
 * different control on the same mounted row does not touch it.
 */
export const FOCUS_REANCHOR_CAP = 4;

/**
 * The deadline a move carries after the read that is asking.
 *
 * The two terms, and why this is a function rather than a comparison at the call
 * site: TWO callers ask (the effect that lands the move and the watcher that keeps
 * it, `focusHoldRead` beside this), and they must not answer differently.
 *
 * - `rowMoving` - the row is doing something of its own: a group change is still
 *   coming, so the window does not run and the deadline is a full window from now.
 *   The caller's own signal for this is the list's poll terms (`connecting`, or an
 *   operation of this row still running), so a row that keeps this true is also a
 *   row the page is re-reading every `INTEGRATIONS_POLL_MS` - which is why a stale
 *   `lastMovingAt` cannot be more than one poll old when the row stops.
 * - otherwise the latest of the hold's own deadline and a full window from the last
 *   read that found the row moving. THAT second term is what covers the stop: the
 *   read that carries the row's new group is the one where `rowMoving` goes false,
 *   and the window it gets starts there rather than at the press.
 *
 * `now`, `windowMs` and `lastMovingAt` are passed in rather than read here, for the
 * reason this module has no `document` at all: the rule stays a function of its
 * inputs and the suite can drive it with numbers.
 */
export function focusHoldWindow(args: {
	hold: Pick<FocusHold, "until">;
	now: number;
	windowMs: number;
	rowMoving: boolean;
	/** When a read last found the row moving; `0` if none has. */
	lastMovingAt: number;
}): number {
	if (args.rowMoving) return args.now + args.windowMs;
	return Math.max(args.hold.until, args.lastMovingAt + args.windowMs);
}

/**
 * What a landed move does now that the row may have re-stood under it.
 *
 * - `settled` - the control the move focused is in the document AND is still the
 *   control the move would land on, so the row has neither re-stood nor gained a
 *   control of its own: leave focus exactly where it is. This is the common case and
 *   the reason the hold is inert rather than a poll.
 * - `restore` - nothing holds focus, and the row's control is either not the one the
 *   move landed on (it was replaced by a re-stand, or the row has gained the primary
 *   it had none of a moment ago) or no longer in the document: land on the row's
 *   control as it stands now.
 * - `drop` - stop: the window has closed, the move has followed as many re-mounts as
 *   it may, somebody else holds focus, or the row has no control in the document to
 *   land on. `<body>` is where a move that is dropped leaves focus, which is strictly
 *   better than a move taken late.
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
	/** The row's control as it stands now - where the move WOULD land. */
	candidate: HTMLElement | null | undefined;
	/** `window.document.activeElement` when the step is taken. */
	active: Element | null;
	/** `window.document.body` - the element that means "nobody holds focus". */
	body: Element | null;
	now: number;
}): FocusHoldStep {
	if (args.now > args.hold.until) return "drop";
	if (args.hold.reanchors >= FOCUS_REANCHOR_CAP) return "drop";
	/*
	 * SETTLED MEANS "THE MOVE IS WHERE IT WOULD LAND", not merely "the node it
	 * landed on is still in the document" (UX round 2, U30).
	 *
	 * The landing resolves the row's control at the instant the operation's dispatch
	 * returns, and a row that is mid-operation has NO primary by design
	 * (`primaryAction` answers null for `connecting`), so the move lands on the row's
	 * overflow - and, under a connectedness-only test, stayed there for good: the row
	 * settles into a group with a control of its own and the move never re-resolves,
	 * leaving the reader's next Tab starting from the `⋯` rather than from the control
	 * the row is actually offering. Measured on the built app in both directions: the
	 * failing arm lands on the row's `Retry` (the re-stand re-applies the move) while
	 * the arm whose group does NOT change leaves the caret on the `⋯` for 12 s.
	 *
	 * A CANDIDATE OF NOTHING IS NOT A DIFFERENT TARGET: with no control to resolve,
	 * the move stays where it landed rather than being read as a move that must go
	 * somewhere else. The caller's own guard is what keeps that from being a landing
	 * site it never asked for.
	 */
	if (args.hold.landedOn.isConnected) {
		if (!args.candidate || args.candidate === args.hold.landedOn)
			return "settled";
	}
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
		args.active !== args.hold.landedOn
	)
		return "drop";
	return args.candidate?.isConnected ? "restore" : "drop";
}

/** What one read of a move leaves behind. */
export type FocusHoldRead = {
	/**
	 * The hold this read leaves, or `null` when the move is finished. `landedOn` is
	 * `null` only in the state no move has landed in yet.
	 */
	hold: {
		until: number;
		reanchors: number;
		landedOn: HTMLElement | null;
	} | null;
	/** The control this read lands on, or `null` when it leaves focus alone. */
	land: HTMLElement | null;
};

/**
 * ONE READ OF A MOVE: everything both of its readers decide, in one place.
 *
 * WHY THIS EXISTS AS A RULE AND NOT AS THE EFFECT'S BODY (agent review round 3,
 * MINOR 4; QA round 3, Q-1; UX round 3, U31). Two things run this read - the
 * effect, when a payload arrives, and the watcher, on its own cadence - and the
 * round-3 defect was those two answering the same question differently: the
 * watcher asked `focusHoldWindow` with `rowMoving: false` and a term only a render
 * could advance, cleared the hold at the arm's own deadline, and the re-stand it
 * was waiting for then found nothing armed. Stating the read as a function of
 * numbers and nodes makes the disagreement impossible rather than unlikely, and it
 * is what lets the suite drive the whole sequence - a 20 s operation, the identical
 * payload that changes no reference, the re-mount - with no DOM and no clock.
 *
 * WHAT EACH ARGUMENT IS FOR, and which one the caller has to get right: `rowMoving`
 * and `lastMovingAt` are the row's own operation, read from the page's own read of
 * it whenever the caller asks (`readDocument`); `candidate` is the row's control as
 * it stands now, and a falsy one is a WAIT rather than a drop - a row whose control
 * has not been committed yet must not cost the move its window.
 */
export function focusHoldRead(args: {
	hold: { until: number; reanchors: number; landedOn?: HTMLElement | null };
	now: number;
	windowMs: number;
	/** The row's own operation is in flight, as the page's last read of it has it. */
	rowMoving: boolean;
	/** When a read last found it in flight, or 0 if none has. */
	lastMovingAt: number;
	/** The row's control as it stands now. */
	candidate: HTMLElement | null | undefined;
	active: Element | null;
	body: Element | null;
}): FocusHoldRead {
	const until = focusHoldWindow({
		hold: args.hold,
		now: args.now,
		windowMs: args.windowMs,
		rowMoving: args.rowMoving,
		lastMovingAt: args.lastMovingAt,
	});
	/*
	 * THE WINDOW IS CHECKED FIRST, before anything can ask for a landing: a move
	 * past its deadline is dropped rather than performed, whichever read finds it
	 * there (m-4).
	 */
	if (args.now > until) return { hold: null, land: null };
	/*
	 * NOTHING TO LAND ON YET IS A WAIT, NOT A FAILURE. The row's control is not in
	 * the document for the frame between a re-stand's unmount and its mount, and a
	 * read that lands in that frame must leave the move armed rather than reading the
	 * gap as a row with no control to offer - the wait is still bounded by the window
	 * above.
	 */
	const landedOn = args.hold.landedOn ?? null;
	const element = args.candidate;
	if (!element)
		return {
			hold: { until, reanchors: args.hold.reanchors, landedOn },
			land: null,
		};
	if (!landedOn)
		return {
			hold: { until, reanchors: args.hold.reanchors, landedOn: element },
			land: element,
		};
	const step = focusHoldStep({
		hold: { ...args.hold, landedOn },
		candidate: element,
		active: args.active,
		body: args.body,
		now: args.now,
	});
	if (step === "settled")
		return {
			hold: { until, reanchors: args.hold.reanchors, landedOn },
			land: null,
		};
	if (step === "drop") return { hold: null, land: null };
	/*
	 * A RE-MOUNT IS WHAT RE-ANCHORS THE WINDOW, AND WHAT SPENDS THE CAP (agent review
	 * round 3, MINOR 5). `restore` fires for two different signals - the landed
	 * control having left the document (the row was mounted again in another group),
	 * and the row having gained or lost the control the move would land on (U30) -
	 * and only the FIRST of them is a re-stand. A move that kept re-anchoring on the
	 * second would extend its own window on a row that never moves, and one that spent
	 * the cap on it would give up on a row whose only sin was gaining a primary.
	 */
	const remounted = !landedOn.isConnected;
	return {
		hold: {
			until: remounted ? args.now + args.windowMs : until,
			reanchors: remounted ? args.hold.reanchors + 1 : args.hold.reanchors,
			landedOn: element,
		},
		land: element,
	};
}
