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
 *   replaced control leaves, so THIS comparison alone cannot tell the two apart.
 *   Before this rule the move was consumed when it landed and no click could bring
 *   it back, so the offer is new (agent review round 1, MINOR 2).
 *
 *   THE PRESS IS WHAT MAKES THE DISTINCTION, and the bound this paragraph used to
 *   claim was wrong (UX round 4, U33; QA round 4, Q-1; UX round 4, U35). It said
 *   the offer stood only while the window below was open, and the window below is
 *   the ROW's own operation plus `FOCUS_ARM_MS` - so on a 20 s answer it stood for
 *   22.7 s, measured, and the app re-applied a move onto the row nineteen seconds
 *   after the reader had deliberately clicked away (the caret on `<body>` for 72
 *   samples, then dragged back onto the row's `⋯`). A window cannot bound an offer
 *   that the row's own operation extends: `focusHoldPointerEnds` is what bounds it,
 *   by reading the gesture the rule cannot (`pointerdown` outside the row ends the
 *   move), and the re-mount cap below is the other bound. What did NOT change is
 *   the reason for the trade: the row the reader was on is where their next Tab
 *   should continue from, and treating every `body` as "the reader left" would drop
 *   the move in the one state the rule exists for (`<body>` is exactly where a
 *   control that becomes `disabled` or unmounts leaves the caret).
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
 *   landed control leaving the document - and the move is dropped once it has
 *   followed `FOCUS_REANCHOR_CAP` of them (`m-4`), which is the FIFTH re-mount of a
 *   chain and not the fourth: four are followed, and the read that would carry the
 *   fifth is the one that gives up. That count, not a clock, is what bounds the
 *   extension: a row mounted again that many times under one move is not the
 *   single group change this rule was written for, and what m-4 refuses is a move
 *   that fires late rather than one that never happens.
 * - **A real pointer press outside the row ends the move.** `focusHoldPointerEnds`
 *   below states it: the reader's own gesture is the one signal that separates "a
 *   control was replaced" from "the reader put the caret there", and both read as
 *   `<body>` to the comparison above.
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
 * once it has FOLLOWED this many re-stands rather than chasing the next one,
 * which is what m-4 asks for in the first place: FOUR are followed, and the read
 * that would carry the fifth is the one given up on (agent review round 4, NIT 1 -
 * "dropped at the cap" read as "the fourth is dropped", and the shipped rule's own
 * cells say otherwise: "re-mount 4 of the cap is still followed").
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
		/*
		 * THE DEADLINE THIS READ COMPUTED, NOT THE FIELD THE HOLD CARRIES (QA round 3,
		 * Q-1). `until` above is the rule's answer for THIS read; `args.hold.until` is
		 * whatever the caller last wrote to its own state, and a caller that writes state
		 * only on a landing carries the arm's own deadline there for the whole of an
		 * operation. Handing that to the step put the same defect back one level down -
		 * measured live on the built app: nineteen reads at 250 ms across a 20 s test, the
		 * row `connecting` and the window answering `now + 4000` in every one of them, and
		 * the move dropped at 4 022 ms because the step judged it against the 4 000 ms the
		 * arm had written. Both readers of a window ask one rule; this is the line that
		 * makes that true for the step too.
		 */
		hold: { until, reanchors: args.hold.reanchors, landedOn },
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

/**
 * Whether a real pointer press outside the move's row ENDS the move.
 *
 * WHY THIS IS A RULE OF ITS OWN RATHER THAN A SECOND COMPARISON IN `focusHoldStep`
 * (UX round 4, U33; QA round 4, Q-1; reproduced independently on two rigs). The
 * step's refusal reads `document.activeElement`, and a reader who presses
 * NON-FOCUSABLE chrome leaves it on `<body>` - the identical value a replaced
 * control leaves behind - so the step cannot tell "the reader put the caret there on
 * purpose" from "the row took it away". A pointer event can: it names the node it
 * landed on, and the row's own element decides whether that node belongs to the
 * move's row. Measured on the built app BEFORE this rule existed, on a 20 s server:
 * a real press on the `Integrations` heading (asserted non-focusable) put the caret
 * on `<body>` for 72 samples over 18 s, and the row's group change then made a
 * SECOND `focus()` call and dragged the caret back onto the row's `⋯` for the rest
 * of the operation - focus stealing over a deliberate gesture, which is the exact
 * failure this whole mechanism exists to prevent.
 *
 * WHY THE OFFER NEEDED A BOUND OF ITS OWN. The header's note used to say the window
 * still bounded this trade. It does not: while the row's own operation runs,
 * `focusHoldWindow` answers `now + FOCUS_ARM_MS` on every read, so the offer stands
 * for the operation PLUS up to one window - 22.7 s measured on a 20 s answer - and
 * the only other bound is `FOCUS_REANCHOR_CAP` re-mounts. The reader's own gesture
 * is the bound this rule supplies (UX round 4, U35: the sentence and the code now
 * say the same thing).
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH, because the neighbouring cases are the ones
 * that were signed off: a press on a FOCUSABLE control of the reader's already ends
 * the move through the step's own refusal (the caret moves, so `activeElement` is
 * somebody), and the search field, a typed form draft, the command palette and
 * another settings row all hold with or without this rule - it must not disturb
 * them. A press INSIDE the move's own row - its controls, its confirm, its own `⋯`
 * while the operation runs - is not the reader leaving, and neither is a row that is
 * not in the document at that instant.
 */
export function focusHoldPointerEnds(args: {
	/** `event.target` of the pointer press, taken as it stands. */
	target: EventTarget | null;
	/**
	 * The move's row element as it stands now, or `null` when the page has none.
	 *
	 * A MISSING ROW IS A WAIT, NOT A DROP, and it is read the same way
	 * `focusHoldRead` reads a missing candidate: the row is unmounted for a frame
	 * while it moves between groups, and a press that lands in that frame says
	 * nothing about the reader's intent. A row that is genuinely gone (a removal)
	 * is ended by the window instead, and its move lands on the neighbour.
	 */
	row: { contains(candidate: unknown): boolean } | null | undefined;
}): boolean {
	const { row, target } = args;
	if (!row) return false;
	/*
	 * A TARGET THAT IS NOT A NODE IS NOT A GESTURE. A press reports a node; anything
	 * else (no target at all, or a synthetic event in a test) leaves the move alone
	 * rather than ending it on a guess.
	 */
	if (!target || typeof (target as Node).nodeType !== "number") return false;
	return !row.contains(target);
}

/**
 * How often an armed move is READ again while it waits: the watcher's cadence.
 *
 * WHY THE CADENCE IS A RULE RATHER THAN A NUMBER AT ONE CALL SITE (agent review
 * round 4, MINOR 2). "The move is watched on a cadence" is only true while the
 * cadence RECURS: a timer armed once and never re-armed keeps the move armed and
 * never sees the re-stand it exists to follow, which is the round-3 defect with a
 * working deadline bolted on. Measured by mutation at the round-4 head, deleting
 * the re-arm inside the section's tick left the whole suite at 64/64 green, because
 * every pin read the OUTER arm rather than what a tick does. So the answer is this
 * function's, and the section's tick has nothing of its own to decide.
 *
 * The value is short against the window it watches - about sixteen reads inside one
 * `FOCUS_ARM_MS` - and while no move is armed there is no timer at all.
 */
export const FOCUS_WATCH_MS = 250;

/**
 * Whether a control can take the caret at all.
 *
 * A DISABLED FORM CONTROL CANNOT, which is the whole of this predicate: it is not a
 * focusable area, so `focus()` on it is a no-op and the caret stays where it was. The
 * row's own controls are disabled for the frames around its operation's boundaries,
 * and that is the state U34 is about.
 */
function canTakeFocus(control: HTMLElement | null | undefined): boolean {
	if (!control) return false;
	return !(control as { disabled?: boolean }).disabled;
}

/**
 * Which of a row's two controls a landing may use, out of the ones it has right now.
 *
 * WHY THIS IS A RULE AND NOT THE TERNARY IT REPLACES (UX round 4, U34). The section
 * used to answer "the primary if the row offers one, otherwise the overflow", and the
 * row offers a primary for the whole of its own operation - the `Retry` that is
 * DISABLED until the settle finishes. So the read at the settle instant was handed a
 * control that cannot take focus, `focus()` did nothing, and the caret read `<body>`
 * while both of its controls were `disabled: true` (UX measured it on every full pass;
 * QA's own reading had the caret back on the enabled `Retry` about a second later,
 * once the poll had replaced the node). A landing that is handed a control nobody can
 * focus is not a landing: this rule prefers the control the row can actually give the
 * caret, falls back to the other one, and answers `null` when NEITHER can take it -
 * which `focusHoldRead` already reads as the frame between commit and mount ("nothing
 * to land on yet is a wait, not a failure"), so the move waits one tick rather than
 * spending itself on a dead node.
 *
 * WHAT IT DOES NOT DECIDE: whether the row offers a primary at all (that is the page's
 * read of the row), whether a move may land (the step's), or what happens when the
 * primary comes back - a candidate change is what makes the step re-apply the move, so
 * a failed test still ends with the caret on its `Retry` (U30).
 */
export function focusHoldCandidate(args: {
	/** The control the row offers as its own action, when it offers one. */
	primary: HTMLElement | null | undefined;
	/** The row's overflow, which every row has. */
	overflow: HTMLElement | null | undefined;
}): HTMLElement | null {
	if (canTakeFocus(args.primary)) return args.primary ?? null;
	if (canTakeFocus(args.overflow)) return args.overflow ?? null;
	return null;
}

/**
 * The three things one read of a move can find, as both of its callers spell them.
 *
 * `kept` is a read that leaves the move armed and lands nothing (`waitForSignIn`'s
 * wait, a row with no control committed yet, and every read that only extends the
 * window); `landed` is a read that performed the move; `finished` is a read that
 * found no hold left to keep, and it has already cleared the caller's state.
 */
export type FocusHoldVerdict = "kept" | "landed" | "finished";

/**
 * The delay until the move is read again, or `null` when the move is over.
 *
 * A move is KEPT BY BEING READ AGAIN: each read is what pushes the window out while
 * the row is moving (QA round 2, Q1 measured 21 750 ms for a 20 s server) and what
 * notices the row's re-stand, so any read that still leaves a hold asks for the next
 * one - and a read that found none is the one the watcher must stop on, because the
 * hold it was watching is already cleared. The cadence is passed in rather than read
 * from a global here, the same way `focusHoldWindow` takes its window, and the
 * verdict is the caller's own word for what its read found rather than a second
 * enumeration this module would have to keep in step with the section's.
 */
export function focusHoldWatchDelay(args: {
	/** The verdict of the read that just ran (`FocusHoldVerdict`). */
	verdict: FocusHoldVerdict;
	/** The cadence; `FOCUS_WATCH_MS` at the call site. */
	watchMs: number;
}): number | null {
	return args.verdict === "finished" ? null : args.watchMs;
}
