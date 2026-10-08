/**
 * The asks drawer's OPEN POLICY: when a conversation that carries pending asks is
 * opened, the drawer comes up on its own - once - and otherwise stays exactly where
 * the user left it.
 *
 * ## Why it exists
 *
 * The queued ask is answered in the drawer, and the only thing that announces it
 * while the drawer is shut is a chip above the composer. A first-time user does not
 * know the chip is a door: the operator's report (2026-10-07) is that the collapsed
 * component is easy to miss, so a conversation opened with an unanswered question
 * looks like a conversation with nothing to answer. The fix is discoverability, not
 * insistence: open the surface ONCE when the conversation is opened, and let go.
 *
 * ## One contract, four surfaces
 *
 * This is the web UI's half of a SHARED OPEN-POLICY CONTRACT. The TUI's ask panel,
 * the mobile relay's asks sheet and the native app's asks sheet implement the same
 * six rules in their own idiom, so a rule changed here is a rule to change there:
 *
 *  1. NOTHING PENDING ON OPEN -> closed (what every surface did before the policy).
 *  2. PENDING ON OPEN -> open, ONCE for that view of that conversation.
 *  3. ALL ADDRESSED ON OPEN -> closed, and a queue that settles never re-opens.
 *  4. A DELIBERATE CLOSE WHILE ASKS REMAIN IS RESPECTED for that conversation, for
 *     the rest of the page's lifetime: not on a re-render, a queue refresh, an ask
 *     arriving or changing, or a switch away and back. It lives in memory only (a
 *     fresh start may open again), and a NEW ask arriving later does not force the
 *     surface open - the chip and the badge already cover that.
 *  5. NO THEFT, NO TRAP, NO GUESSING: opening never moves focus, the user can always
 *     close (the drawer's own unconditional close control, #864), and the policy
 *     never acts on a frame that has not actually answered.
 *  6. AN AUTO-OPEN IS NOT A DOOR PRESS: it must not look like one to the drawer's
 *     door-focus signal (`ask-drawer.tsx`'s `openedByDoor`), which means "the user
 *     pressed the chip or the header trigger" and nothing else.
 *
 * ## Why a module and not conditions in an effect
 *
 * Every rule above is a decision about FACTS, none about React or the DOM, and each
 * is the kind of rule that is easy to get subtly wrong inside an effect body (re-fire
 * on a re-render, open on a frame that has not loaded, forget a close the moment the
 * component remounts). Kept here it is driven frame by frame in a plain node test,
 * and the module is DOM-free by construction: it holds no `focus()` call because it
 * has no document to call it on, which is rule 5's first clause as a property of the
 * file rather than a promise of its caller. `use-ask-open-policy.ts` is the thin
 * React shell that feeds it facts and applies its verdict.
 *
 * ## The decision point is the FIRST PUBLISHED frame of a view
 *
 * A "view" is one mount of a conversation's pane (the pane is keyed by conversation,
 * so switching away unmounts it and coming back is a NEW view). Each view gets
 * exactly one decision, taken on the first frame in which the queue has PUBLISHED.
 *
 *  - An UNREAD frame (`frontend == null`) is not an empty one, and a RESOLVED frame
 *    that publishes no queued engine is not an empty one either (#864's lesson: the
 *    capability is the presence of `asks` OR `asks_open`, `askQueuePublished`). Both
 *    mean "the queue has not answered", so they decide nothing and spend nothing: a
 *    runtime that warms later still gets its decision when its first real frame
 *    lands.
 *  - A TALLY-ONLY frame (`asks` absent, `asks_open: N`) HAS published, and says N asks
 *    are outstanding without being able to show one. It is not "pending asks" for
 *    this policy - the surface it would open can only say that the details could not
 *    be loaded - so the view decides `leave` and spends its chance. The chip still
 *    carries the count. (The wire only does this when the row list will not fit at
 *    all, so a later frame in the same view would not normally carry rows; waiting
 *    for one would risk opening the surface long after the conversation was opened.)
 *  - Everything after the decision is the user's: later frames cannot re-open, which
 *    is what makes "an ask arriving later does not force the surface open" a
 *    property of the view rather than a check somebody has to remember.
 */

import type { AskQueueView } from "./ask-queue";

/**
 * Why a verdict is what it is. Also the vocabulary the tests and the evidence rows
 * use, so a frame in the PR and a line in the suite name the same thing.
 */
export type AskOpenReason =
	/** The only reason that opens. */
	| "pending-on-open"
	/** No conversation (a draft): there is no queue to have an opinion about. */
	| "no-conversation"
	/** The queue has not answered (unread, or a runtime that publishes nothing yet). */
	| "unresolved"
	/** This view already took its one decision. */
	| "already-decided"
	/** The queue answered and nothing in it is pending (rules 1 and 3). */
	| "nothing-pending"
	/**
	 * The queue answered with a TALLY and no pending row to show (the wire bound's
	 * frame: `asks` absent, `asks_open: N`). Asks ARE outstanding, so
	 * `nothing-pending` would be a false sentence; but the surface it would open can
	 * only apologise for the missing details, so it stays shut (rule 5).
	 */
	| "tally-only"
	/** The user closed this conversation's surface while asks remained (rule 4). */
	| "dismissed"
	/** The composer holds text: the user's draft is not ours to swap out (rule 5). */
	| "composer-has-text"
	/** The keyboard is on one of the drawer's doors: an open would read as a press (rule 6). */
	| "door-focused"
	/** The asks drawer is already up, in either scope: there is nothing to open. */
	| "drawer-open";

export type AskOpenVerdict = {
	action: "open" | "leave";
	/**
	 * Whether this verdict SPENDS the view's one decision. `false` only for the two
	 * "the queue has not answered" reasons: the caller asks again on the next frame.
	 * Every other verdict - including every `leave` - is final for the view.
	 */
	settled: boolean;
	reason: AskOpenReason;
};

/** What a caller must know to decide. Every field is a fact, none is a handle. */
export type AskOpenInput = {
	/** The conversation this view shows, or nothing for a draft. */
	conversationId: string | null | undefined;
	/**
	 * Whether the queue has PUBLISHED (`AskQueueView.published`): an `asks` array or an
	 * `asks_open` tally is on the frame. NOT merely "a frame arrived".
	 */
	resolved: boolean;
	/** Outstanding rows the frame actually carries - open or timed out, answerable. */
	pendingRows: number;
	/**
	 * The wire's own outstanding tally (`AskQueueView.open`). Read for ONE purpose: to
	 * tell a queue with nothing in it from a queue whose rows were dropped (see
	 * `tally-only`). It never opens anything by itself.
	 */
	outstanding: number;
	/** The conversations whose surface the user has closed while asks remained. */
	dismissed: Pick<AskDismissals, "has">;
	/** Whether this view already took its one decision. */
	viewDecided: boolean;
	/**
	 * Whether the composer holds text at this instant - typed, or a draft restored for
	 * this conversation. Empty is the ordinary state and is not a reason to wait.
	 *
	 * WHY A HELD DRAFT BLOCKS THE OPEN. Opening flips `askExpanded`, which is the same
	 * flag that puts the composer into answer mode (`chat-page.tsx`): the box's text is
	 * swapped out for the ask buffer, so an unrequested open over a draft would make the
	 * user's words vanish from under their cursor. Even without that routing, a surface
	 * docking beside the line being typed is motion nobody asked for. The user's own
	 * press on the chip is still the door; this only declines to be the one to knock.
	 */
	composerHasText: boolean;
	/**
	 * Whether the keyboard is on one of the drawer's two DOORS (the composer chip or the
	 * header trigger) at this instant.
	 *
	 * RULE 6 AS A FACT RATHER THAN A PROMISE. The drawer decides "the user pressed a door"
	 * by reading what held focus when it mounted (`ask-drawer.tsx`'s entry effect), and
	 * on that reading it moves the keyboard into its list. An auto-open that landed while
	 * focus happened to be on a door would therefore be read as a press and would move
	 * the keyboard - a theft by a mount nobody pressed. Declining to auto-open in that
	 * one moment keeps the drawer's signal meaning exactly what #864 made it mean, with
	 * no change to the drawer.
	 */
	keyboardOnDoor: boolean;
	/**
	 * Whether the asks drawer is already open, in either scope. The flag survives a
	 * conversation switch on purpose (`isAskDrawerOpen`), so a drawer the user opened
	 * stays, and a fleet pane they opened is not swapped for this conversation's.
	 *
	 * A DURABLE PANE (canvas, run panel, browser, console) IS DELIBERATELY NOT A REASON
	 * TO LEAVE. The drawer is the right slot's one transient occupant and BORROWS the
	 * slot (`askDrawerEvictedPane`): closing it gives the displaced pane back, exactly
	 * as a press on the chip does today. An auto-open that refused to borrow would hide
	 * the asks from precisely the users who keep a pane open, and rule 2 has no such
	 * exception - a surface-specific one here would be a fifth idiom for a contract that
	 * is meant to read the same on all four.
	 */
	drawerOpen: boolean;
};

const wait = (reason: AskOpenReason): AskOpenVerdict => ({
	action: "leave",
	settled: false,
	reason,
});

const leave = (reason: AskOpenReason): AskOpenVerdict => ({
	action: "leave",
	settled: true,
	reason,
});

/**
 * The decision, as a pure function of the facts.
 *
 * THE ORDER IS THE SPEC for which reason is reported, because each `leave` should
 * name the first thing that kept the drawer closed: `dismissed`, `composer-has-text`,
 * `door-focused` and `drawer-open` are reported only for a queue that WOULD have
 * opened (they are overrides on a pending queue, so a settled queue in a dismissed
 * conversation says `nothing-pending`, which is the truer sentence). Only
 * `no-conversation` and `unresolved` return without settling.
 */
export const decideAskAutoOpen = (input: AskOpenInput): AskOpenVerdict => {
	const { conversationId } = input;
	if (!conversationId) return wait("no-conversation");
	if (input.viewDecided) return leave("already-decided");
	if (!input.resolved) return wait("unresolved");
	if (input.pendingRows <= 0) {
		return leave(input.outstanding > 0 ? "tally-only" : "nothing-pending");
	}
	if (input.dismissed.has(conversationId)) return leave("dismissed");
	if (input.composerHasText) return leave("composer-has-text");
	if (input.keyboardOnDoor) return leave("door-focused");
	if (input.drawerOpen) return leave("drawer-open");
	return { action: "open", settled: true, reason: "pending-on-open" };
};

/**
 * The queue facts a decision reads off a view, derived once.
 *
 * `resolved` is `published`, not "a frame arrived": a frame with no `asks` and no
 * `asks_open` has not answered (see the module note). `pendingRows` counts ROWS that
 * are still answerable (`open` is the backend's outstanding fold: `open` plus
 * `timed_out`, because a late answer still reaches the agent - the same set the
 * header badge counts), never the wire's tally: rule 5 opens only over rows that are
 * actually there. An unknown status is not pending: `presentAsk` refuses to coerce it
 * into `open`, and this inherits that.
 */
export const askOpenFacts = (
	view: Pick<AskQueueView, "published" | "rows" | "open">,
): { resolved: boolean; pendingRows: number; outstanding: number } => ({
	resolved: view.published,
	pendingRows: view.rows.filter((row) => row.open).length,
	outstanding: view.open,
});

/**
 * The conversations whose surface the user has closed while asks remained.
 *
 * IN MEMORY AND NOWHERE ELSE, on purpose (rule 4): a dismissal is a remark about
 * what the user wanted to see in the window they have open, not a preference. It is
 * not persisted, so a fresh start may open the surface again; it is keyed by
 * conversation, so dismissing one never mutes another; and it is never cleared by
 * the queue changing, because "the asks changed" is exactly the event the contract
 * says must not bring the surface back.
 */
export type AskDismissals = {
	has: (conversationId: string) => boolean;
	record: (conversationId: string) => void;
	/** The test seam. The app never forgets a dismissal inside a page's lifetime. */
	clear: () => void;
	readonly size: number;
};

export const createAskDismissals = (): AskDismissals => {
	const ids = new Set<string>();
	return {
		has: (conversationId) => ids.has(conversationId),
		record: (conversationId) => {
			if (conversationId) ids.add(conversationId);
		},
		clear: () => ids.clear(),
		get size() {
			return ids.size;
		},
	};
};

/**
 * The page's own record. A module singleton because its lifetime IS the page's:
 * the renderer's module graph lives exactly as long as the app window does, and that
 * is the "same app/page lifetime" rule 4 is written in. Tests build their own with
 * `createAskDismissals` so no case inherits another's.
 */
export const askDismissals: AskDismissals = createAskDismissals();

/** What a view is fed on each frame: the decision's inputs minus its own memory. */
export type AskOpenFrame = Omit<AskOpenInput, "dismissed" | "viewDecided"> & {
	/**
	 * Whether the SESSION-scoped drawer is the one up (`isAskDrawerOpen` and the
	 * session scope). Distinct from `drawerOpen`, which is true for a fleet pane too:
	 * a session pane replaced by the fleet pane was not closed by the user, it was
	 * swapped, and the close watch must not read the swap as a dismissal.
	 */
	sessionDrawerOpen: boolean;
};

export type AskOpenObservation = {
	verdict: AskOpenVerdict;
	/**
	 * What the close watch made of an open -> closed edge on THIS frame, or `null`
	 * when the frame was not one:
	 *  - `dismissed`: a close while asks remained, now recorded for the conversation;
	 *  - `before-decision`: a close over a frame that had not answered, which spends
	 *    this view's one decision without recording anything (nothing was on screen
	 *    to have turned away, so a later view of the conversation may still open);
	 *  - `nothing-to-show`: a close over a queue with nothing in it (the drawer's own
	 *    auto-close, #864), which is no remark by the user and records nothing.
	 */
	closeWatch: "dismissed" | "before-decision" | "nothing-to-show" | null;
};

/**
 * One view's memory: the bit that makes "ONCE" true and the edge that makes rule 4
 * observable.
 *
 * Created per mounted pane (and so per view: remounting is a new one) and fed every
 * frame. The hook that applies the policy holds exactly this object, which is why
 * the tests drive it rather than a copy of its loop: what is asserted frame by frame
 * here is what runs in the app.
 *
 * THE CLOSE WATCH LIVES HERE, not in each close door. The drawer is closed by the
 * chrome's X, by Escape inside it, by the window-level Escape claim, by a toggle on
 * the composer chip, by a toggle on the header trigger, and by another pane claiming
 * the slot - six writers to one store flag. Wrapping each would be six places to
 * forget; observing the flag's open -> closed edge catches all of them, and a pane
 * that replaced the drawer is correctly a dismissal too (the user chose something
 * else for the slot, and reopening the asks over it on every visit is insistence).
 *
 * WHAT IS NOT A DISMISSAL, which is the other half of the rule:
 *  - a close with nothing outstanding: the drawer's own auto-close (#864) fires only
 *    when there is nothing to show, as does the queue settling under it;
 *  - a close over a frame that has not answered: nothing was on screen to have turned
 *    away (it still spends the view's decision - see `closeWatch`);
 *  - a swap to the fleet pane (see `sessionDrawerOpen`).
 *
 * A pane that took the slot from the drawer IS read as a dismissal, even when the
 * pane opened itself (an agent's `reveal`): the store cannot say who wrote the flag,
 * and the two mistakes are not symmetric - a missed auto-open costs a discoverability
 * nudge the chip and the badge still make, a wrong one puts the asks back over what
 * somebody chose to show there.
 */
export type AskOpenView = {
	observe: (frame: AskOpenFrame) => AskOpenObservation;
	/** Whether this view has taken its decision (tests and evidence read it). */
	readonly settled: boolean;
};

export const createAskOpenView = (dismissals: AskDismissals): AskOpenView => {
	let settled = false;
	let wasSessionOpen = false;
	return {
		observe(frame) {
			let closeWatch: AskOpenObservation["closeWatch"] = null;
			/*
			 * THE EDGE: this view's session drawer was up on the previous frame and is gone
			 * now, and no drawer of the other scope took its place. `conversationId` gates
			 * it because a draft has no queue to have turned away.
			 */
			if (
				wasSessionOpen &&
				!frame.sessionDrawerOpen &&
				!frame.drawerOpen &&
				frame.conversationId
			) {
				if (!frame.resolved) {
					/*
					 * CLOSED BEFORE THE QUEUE ANSWERED (a slow or cold conversation shows the
					 * unread line for as long as the read takes). The press is still a
					 * decision, and popping the surface back open when the frame lands would
					 * be the insistence rule 4 forbids, so it spends the view's chance. It
					 * records NOTHING against the conversation: nobody saw whether asks
					 * remained, and a later view that finds them should still open once.
					 */
					settled = true;
					closeWatch = "before-decision";
				} else if (frame.pendingRows > 0 || frame.outstanding > 0) {
					/*
					 * ASKS REMAIN - a pending row, or a tally the frame could not show rows
					 * for (the chip still counts them). That is the rule-4 dismissal.
					 */
					dismissals.record(frame.conversationId);
					closeWatch = "dismissed";
				} else {
					closeWatch = "nothing-to-show";
				}
			}
			wasSessionOpen = frame.sessionDrawerOpen;
			const verdict = decideAskAutoOpen({
				...frame,
				dismissed: dismissals,
				viewDecided: settled,
			});
			if (verdict.settled) settled = true;
			return { verdict, closeWatch };
		},
		get settled() {
			return settled;
		},
	};
};
