/**
 * The asks DRAWER: the side canvas the queued ask is answered in.
 *
 * ## Why the container moved, and why it is the canvas family's
 *
 * The panel used to be a column mounted ABOVE the composer (the in-band panel
 * `chat-content.tsx` drew, since replaced by this drawer): no chrome, no dismiss, and no scroll owner of its own, so a
 * queue taller than the window pushed its own content past the page's scroller and
 * the last card was unreachable (the design note's D1, and the `dom_audit`
 * `text-clipped` FAIL it was measured by: `scroll 1280x832 vs client 1280x800`).
 *
 * The fix is the container, not the symptom: the panel is now a member of the
 * CANVAS FAMILY - right-docked, a 40px chrome bar, its own scroller, the family's
 * width arithmetic (`min(560, row - 480)`, floor 400, the `overlay` literal below
 * the floor - a flex dock, not a cover, since the positioning was removed; see
 * `chat-sidebar-layout.ts`). The card can no longer be the widest thing on the
 * screen because it fills a pane the family sizes, which is also why there is no
 * separate width rule here for it to fight with.
 *
 * ## One right pane at a time
 *
 * The drawer is the FIFTH occupant of the right slot and obeys the slot's own rule
 * (§2C of the design note: "two right panes cannot both dock"): opening it closes
 * the canvas, the run panel, the browser and the console, and opening any of those
 * closes it. That exclusion is the STORE's (`claimRightSlot`), not a promise kept
 * here - this component only reads the one flag it was opened by.
 *
 * ## Scroll ownership (the D1 fix)
 *
 * Three regions, and only the middle one scrolls: the chrome bar is `shrink-0`, the
 * list is `min-h-0 flex-1 overflow-y-auto`, and there is no footer (the actions live
 * in each card). The transcript does not move when this opens, and the fix is
 * checkable as a number rather than by eye: the scroller's `scrollHeight` is what it
 * is, and `clip` is gone from the page (`virtual_size == size` on the page scroller).
 *
 * ## Dismiss
 *
 * The trailing control of the chrome bar closes the drawer WITHOUT answering, and
 * Escape does the same; neither declines. That is the ask lane's
 * Esc-collapses-without-declining rule (design §5.1's D5, carried over from the
 * in-band panel this container replaced) unchanged, and the
 * per-ask "no dismiss door" note in `ask-panel.tsx` is about DISMISSING ONE ASK (no
 * backend route) - a different act from closing the surface, which is why the two
 * are not in tension. The drawer also closes itself when the queue empties, so the
 * chip and the surface cannot disagree about whether there is anything to show, and
 * - the half this surface was missing - when it comes up over a queue with nothing
 * to show at all (a conversation switch).
 *
 * ## The chrome always renders (the stuck-slot fix)
 *
 * The bar is drawn on EVERY frame this component is mounted with, and only the body
 * varies: rows, the panel's designed empty sentence, or the quiet unread line. There
 * is deliberately no frame that draws nothing, because the component is mounted by a
 * STORE flag rather than by the frame - `isAskDrawerOpen` survives a conversation
 * switch and `SessionPanel` is keyed by conversation - while its slot is claimed by
 * the mount rather than by anything the drawer draws. A frame the drawer declined to
 * render therefore did not release the slot: it parked a 560px empty column on the
 * right of the window with no bar, no dismiss and no control of any kind, which is
 * the defect this container's first rule now forbids by construction rather than by
 * enumerating the frames (see the gate in the render below).
 *
 * ## Focus
 *
 * Entering is the user's own press and nothing else: the mount finds focus on one of
 * the lane's two DOORS - the status-row item (`ASK_ITEM_SELECTOR`, the session scope)
 * or the panel rail's asks item (`ASK_RAIL_ITEM_SELECTOR`, whichever scope it opened;
 * the conversation header's trigger until #896 moved it) - or it answers the `…`
 * menu's asks row through the store's `askOpenIntent` (round-1 Q1: that row cannot
 * leave focus on anything the mount recognises - Radix hands the keyboard back to the
 * menu's own trigger - so its press travels as a request, and the drawer's claim
 * survives the menu's own teardown; see `MENU_TRIGGER_SELECTOR` for the return half
 * and the claim note above the refs) - or it
 * moves nothing, which is what keeps the lane's no-focus-steal promise (whose subject
 * is an ask ARRIVING) intact. WHERE it lands is the CARD's first control and not the
 * bar's (UX round 1, U4): the bar's leading control in DOM order is the dismiss, so
 * the old "first focusable in the drawer" put the surface's exit under the first
 * Enter - a second press closed the thing the user had just opened. The bar is still
 * reachable, one Shift+Tab up. Leaving returns focus to the door it was opened by -
 * the chip, the rail item, or the menu trigger a request came from - but only when
 * focus was actually stranded - a close from the composer leaves the
 * caret in the box where the user is typing, and moving it there would be the same
 * theft. A STRANDED close with NO door - the auto-opened drawer, where the policy
 * moved no keyboard in and the default first act is to dismiss what the app opened
 * (agent review round 1 / UX round 1, U1) - hands the caret back to the COMPOSER,
 * the element that held it before the open, through `composer-field.ts`'s one
 * hand-off. The return is deferred one microtask because React runs an unmounting
 * component's cleanup BEFORE it detaches the nodes, so a synchronous read would still
 * see the drawer's own focused child.
 */

import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { PanelRightClose } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { CanonicalFrontendState } from "../../../../../../shared/desktop-session-contract";
import type {
	AskDraft,
	AskOutcome,
	AskPresentation,
	AskScope,
} from "../../ask-queue";
import {
	ASK_DRAWER_UNAVAILABLE_LINE,
	ASK_DRAWER_UNREAD_LINE,
	ASK_ITEM_SELECTOR,
	ASK_RAIL_ITEM_SELECTOR,
	EMPTY_DRAFTS,
	askQueueView,
	askScopeLine,
	noopDraftChange,
} from "../../ask-queue";
import { handCaretToComposer } from "../../composer-caret";
import { useAskClock } from "../../use-ask-clock";
import { AskPanel } from "./ask-panel";

/**
 * What "the drawer's first control" means when focus enters it.
 *
 * The tab-reachable set, in DOM order, and nothing else: `[tabindex]` is included
 * for controls made reachable deliberately, and the disabled/`aria-disabled`
 * exclusions are the ones this app actually uses to make a control inert - it puts
 * `aria-disabled` on controls it keeps mounted and focusable-looking
 * (`inline-edit-controls.tsx`, `autocomplete-field.tsx`, the credential-ask row in
 * `message-input.tsx`) rather than removing them. A walk that honoured only the
 * native attribute would land on the first inert control the moment one appears
 * here (agent review round 2, F6, on the surface this container replaces).
 */
const ASK_DRAWER_FOCUSABLE =
	'a[href]:not([aria-disabled="true"]), button:not([disabled]):not([aria-disabled="true"]), [tabindex]:not([tabindex="-1"]):not([aria-disabled="true"]), input:not([disabled]):not([aria-disabled="true"]), select:not([disabled]):not([aria-disabled="true"]), textarea:not([disabled]):not([aria-disabled="true"])';

/**
 * The panel whose first control the keyboard lands on, and its own marker.
 *
 * The drawer is a bar plus a list, and the LIST is what the user opened the surface
 * for. `ASK_PANEL_SELECTOR` is the panel's existing root marker (`ask-panel.tsx`),
 * so this is a read of a contract that already exists rather than a second one.
 */
const ASK_PANEL_SELECTOR = "[data-lo-ask-panel]";

/**
 * WHERE IN THE LIST the entry move lands, in document order: the head PENDING card,
 * or - when there is none - the settled group, whose own first focusable is its first
 * row's trigger.
 *
 * WHY THE WALK IS SCOPED AND NOT "the first focusable in the panel" (agent review
 * round 1, m1). The panel grew a FILTER above the list, whose buttons are
 * legitimately focusable, so a bare walk landed on the filter rather than on the ask
 * the reader pressed the door to answer - UX round 1's U4 fault with a new control
 * wearing it. Scoping to `[data-lo-ask-row]` fixed the pending case and left the
 * settled-only case broken, because a settled row lives inside its own `Disclosure`
 * and a collapsed `Disclosure` paints no children at all: no `[data-lo-ask-row]`
 * exists, so the walk fell back to the filter again. Naming the settled group as the
 * second target is what makes the docblock's claim true - a settled-only queue walks
 * to the first settled ROW, exactly as it did before the filter existed - and the
 * `[data-lo-ask-settled]` marker is `ask-panel.tsx`'s own, not a new one.
 */
const ASK_LANDING_TARGET = "[data-lo-ask-row], [data-lo-ask-settled]";

/**
 * THE MENU DOOR'S RETURN TARGET (#896 round 1, Q1): the `…` menu's asks row is
 * the third door to this drawer, and the one that cannot signal its press
 * through focus - Radix hands the keyboard back to the menu's own trigger when
 * it closes, so the mount's door read finds nothing there. Its open travels as
 * the store's `askOpenIntent` instead (see the entry effect), and a stranded
 * close returns focus HERE: the trigger is the control that was pressed, so it
 * is the control focus goes back to - the same rule as the chip and the rail
 * item. The handle is the attribute the delete dialog already hands focus back
 * to (`chat-header.tsx`), not a new one.
 *
 * THE TRIGGER IS TAKEN FROM FOCUS FIRST: the restore Radix performs is what the
 * bootstrap actually sees (pinned in `panel-rail.test.mjs`'s menu-door case),
 * and a focused element that IS the trigger states the fact most directly. The
 * document query is the belt for a paint where the restore has not landed yet;
 * when neither finds a trigger (a story or a rig with no header), nothing is
 * recorded and the stranded close takes the drawer's existing no-door path -
 * the composer hand-off - rather than guessing a control.
 */
const MENU_TRIGGER_SELECTOR = "[data-conversation-actions]";

/** See `MENU_TRIGGER_SELECTOR`: the trigger if it is what focus holds, else the one on the page. */
const menuReturnTarget = (active: Element): Element | null =>
	active.matches(MENU_TRIGGER_SELECTOR)
		? active
		: document.querySelector(MENU_TRIGGER_SELECTOR);

/**
 * Whether the keyboard is still where the menu row's press left it, or nowhere:
 * Radix restores focus to the trigger as the menu closes, and `<body>` is the
 * paint on which that restore has not landed yet. Anything else means the user
 * has claimed the keyboard since the press - the composer, a palette - and the
 * entry move must stand down, the same way the door path stands down when its
 * door is no longer focused (it gets this property for free by re-reading
 * focus every commit; the request has no live focus signal by construction, so
 * the guard is stated here instead).
 */
const keyboardLeftOnMenuPress = (active: Element): boolean =>
	active === document.body || active.matches(MENU_TRIGGER_SELECTOR);

/**
 * HOW MANY TIMES the claim below may re-take the keyboard before it gives up.
 *
 * A BOUND, NOT A TUNING KNOB. The menu's close writes focus more than once on
 * its way out (the trapped scope pulls a departing focus back, then the restore
 * hands the trigger the keyboard), and every one of those writes is answered -
 * but a menu that somehow never settles must not leave a listener fighting
 * focus forever. Measured in `scripts/panel-rail.test.mjs`'s menu-door case:
 * three answers complete the open.
 */
const MENU_CLAIM_LIMIT = 8;

export type AskDrawerProps = {
	frontend: Pick<
		CanonicalFrontendState,
		"asks" | "asks_open" | "asks_truncated"
	> | null;
	/**
	 * Which queue this drawer is showing, carried by the ENTRY POINT rather than
	 * chosen here (design note §4.4): a session's chip opens `session` and the rail's
	 * asks item opens `fleet` at the top level (or `session` inside one). It is read
	 * for the chrome bar's scope line, the surface's accessible name, and the per-row
	 * conversation line (`conversationOf` below) - the three places the two contexts
	 * differ - so the two queues share one container rather than growing a second
	 * drawer.
	 */
	scope: AskScope;
	/**
	 * The door that closes the drawer WITHOUT answering. The caller owns the flag
	 * (the store does), so this reports the request rather than applying it.
	 */
	onClose: () => void;
	/**
	 * The three doors, addressed by ASK ID rather than by the record: the caller
	 * posts to a session by id and has no use for the rest of the row, and passing
	 * the whole ask up would invite a caller to read a status this surface has
	 * already classified.
	 */
	onAnswer?: (askId: string, answers: Record<string, string[]>) => void;
	onDecline?: (askId: string) => void;
	/**
	 * CHANGE a recorded-but-undelivered answer (design §10, #1936). Addressed by ASK
	 * ID for the same reason the two doors above are: the caller posts by id, and
	 * the whole-map body is built inside the card where the edit buffer lives.
	 */
	onRevise?: (askId: string, answers: Record<string, string[]>) => void;
	answering?: boolean;
	/** This surface's own record of the asks it posted for: `AskOutcome`, passed through untouched. */
	outcomes?: Record<string, AskOutcome | undefined>;
	/** The in-flight answers, keyed by ask id then question id. Caller-owned so a draft outlives the drawer being closed; the panel's own controls are its only writers. */
	drafts?: Record<string, AskDraft>;
	onDraftChange?: (askId: string, next: AskDraft) => void;
	/**
	 * WHICH CONVERSATION A ROW BELONGS TO, when the surface is showing more than
	 * one - the per-card conversation line the fleet scope draws (see
	 * `AskPanelProps.conversationOf`).
	 *
	 * THE CALLER SUPPLIES IT rather than this container deciding from `scope`.
	 * Naming a conversation is a property of the READ, not of the container: the
	 * fleet model resolves it from the aggregate row plus the sessions catalogue
	 * (the same catalogue the list names rows by), and the session scope has
	 * nothing to pass because its rows are all about the conversation the user is
	 * already in. Reading the fleet model from here would be the container reaching
	 * into one of its two callers, which is the coupling the two-homes split
	 * exists to avoid.
	 */
	conversationOf?: (row: AskPresentation) => string | null;
	/** A story pins the clock so its frames are reproducible. */
	nowMs?: number;
};

/**
 * The countdown is re-read on the lane's own clock, which lives in
 * `features/chat/use-ask-clock` so the status row's ask item (which prints the same
 * countdown on its collapsed face) reads the SAME one: two intervals would let the
 * chip and the drawer it opens disagree about one deadline for up to a tick.
 */
export const AskDrawer = ({
	frontend,
	scope,
	onClose,
	onAnswer,
	onDecline,
	onRevise,
	answering = false,
	outcomes,
	drafts,
	onDraftChange,
	conversationOf,
	nowMs,
}: AskDrawerProps) => {
	/*
	 * THE VIEW IS READ THROUGH THIS DRAWER'S OWN OUTCOMES, so its `delivering` count
	 * excludes a row the owner has already refused to change (design round 2, D7 =
	 * UX round 2, U6). The chrome line is drawn directly above the cards, so counting
	 * a refused ask as still changeable put `you can still change it` on the same
	 * screen as that card's own `already delivered — send a new message`. A refusal
	 * that never reached the owner leaves the row counted - the door is still open
	 * (`AskOutcome.refusedByOwner`).
	 */
	const view = askQueueView(frontend, outcomes);
	const now = useAskClock(view.open > 0, nowMs);
	const rootRef = useRef<HTMLElement | null>(null);
	/*
	 * THE UNREAD FRAME IS THE VIEW'S OWN FACT, not a second read of `frontend` here
	 * (remediation round 1, D1 keeps it separate from `published`, and R1 needs it in
	 * the close gate). `AskQueueView.unread` is `frontend == null` derived once, so the
	 * bar's copy, the body's copy, the entry move and the auto-close cannot drift about
	 * which of the three unresolved-looking states this is.
	 */
	const frameUnread = view.unread;

	/*
	 * THE MENU'S OPEN REQUEST, AND ITS ANSWER (round-1 Q1). `askOpenIntent` is
	 * written by the `…` menu's asks row - the one door that cannot announce
	 * itself through focus (see `MENU_TRIGGER_SELECTOR`) - and the entry effect
	 * below consumes it for the matching scope: `clearAskOpenIntent` is the
	 * drawer's acknowledgement, called on the commit that acts on the request and
	 * again on unmount so a request can never outlive its open.
	 */
	const askOpenIntent = useUiPreferencesStore((state) => state.askOpenIntent);
	const clearAskOpenIntent = useUiPreferencesStore(
		(state) => state.clearAskOpenIntent,
	);

	/*
	 * THE DOOR THAT OPENED THIS MOUNT, remembered so the auto-close below can tell
	 * the user's own press from a mount that merely inherited the open flag.
	 *
	 * WHY THE DISTINCTION IS THE WHOLE FINE PRINT. `isAskDrawerOpen` is a STORE flag
	 * and deliberately survives a conversation switch - the drawer follows the user
	 * into whatever conversation is opened next - and the FLEET-scoped door is offered at
	 * ZERO outstanding asks, so a press on it opens this surface over a queue with
	 * nothing in it ON PURPOSE. Auto-closing THAT mount would be a control that
	 * refuses its own door. The signal is the lane's existing one, latched where it
	 * is computed: the entry effect's `ASK_ITEM_SELECTOR` / `ASK_RAIL_ITEM_SELECTOR`
	 * read of the element that held focus. It is a LATCH, never cleared, because the
	 * entry effect runs on every commit until its one-shot is spent and a later
	 * commit could find focus back on the door with no press behind it.
	 */
	const openedByDoor = useRef(false);

	/*
	 * The drawer closes itself when the queue empties: an open drawer over nothing is
	 * a surface the user has to dismiss, and the lane's own rule is that the
	 * affordance disappears at zero asks.
	 *
	 * TWO TRANSITIONS, TWO DIFFERENT FACTS, AND ONLY ONE OF THEM WAS HERE.
	 *
	 *  - THE SAME-INSTANCE EMPTYING (`hadRows.current === true`, kept exactly as it
	 *    was): the ask under the open drawer settled - answered from the phone,
	 *    declined, timed out - and the drawer closes rather than sitting over the
	 *    nothing it now shows.
	 *  - THE SWITCH (new, and the defect this file carries): the drawer mounts over a
	 *    DIFFERENT conversation's frame, and that frame has nothing to show. Nothing
	 *    emptied here; the surface simply came up over an empty queue. It used to
	 *    stay up drawing nothing at all - no bar, no dismiss - while its slot kept
	 *    the right side of the window, because the open flag is the store's and
	 *    `SessionPanel` is keyed by conversation, so the mount happens on every
	 *    switch with no door behind it.
	 *
	 * WHICH IS WHY THE DOOR GUARD IS THE SECOND HALF OF THE RULE, not a nicety: the
	 * switch case is EXACTLY the case the user's own press never opens (see
	 * `openedByDoor` above), and the door case is exactly the one the switch rule must
	 * not touch. And `frameUnread` bounds the third state: an unresolved frame closes
	 * nothing (the read has not answered, so there is no fact to act on) and - since
	 * the chrome below now renders unconditionally - traps nothing either.
	 */
	const hadRows = useRef<boolean | null>(null);
	/*
	 * One close per mount, whatever the caller's `onClose` identity does. The effect
	 * re-runs whenever a dependency's identity changes, and one caller passes an inline
	 * arrow (`chat-layout.tsx` mounts the fleet drawer with
	 * `onClose={() => setAskDrawerOpen(false, "fleet")}`), so a rule that only compares
	 * deps would re-close on every render it happened to see. The drawer unmounts on a
	 * close, so a per-mount latch is exactly "fire once" rather than a weakening of the
	 * per-emptying rule.
	 */
	const closedOnce = useRef(false);
	/*
	 * WHY A LAYOUT EFFECT LOOKS RIGHT HERE, AND WHY IT WAS REJECTED. A passive effect
	 * runs AFTER the browser has painted the commit, which invites the guess that the
	 * chrome is painted over the conversation being left; the counter-measure would be
	 * `useLayoutEffect`, which lands the close before paint. It was tried and measured,
	 * and it buys nothing: what this effect can act on is bounded by the FRAME it has to
	 * wait for, not by the paint phase. A switch to a conversation whose frame has not
	 * landed yet reads as UNREAD, and that state must close NOTHING - a switch to a
	 * conversation that DOES have asks is indistinguishable from it for exactly that
	 * interval, and there the surface must stay up and show them. The chrome is
	 * therefore on screen for as long as the read takes (the rig reads four painted
	 * frames, gone within ~110 ms on this host; `docs/evidence/ask-drawer-stuck/README.md`
	 * states the reading rather than a constant), and no paint-phase change moves it.
	 *
	 * A LAYOUT EFFECT WOULD ALSO HAVE COST SOMETHING REAL: a declaration-order
	 * dependency against the entry effect's door latch. React runs a component's
	 * effects in declaration order, so a layout close declared above the entry effect
	 * reads `openedByDoor` before that effect sets it and shuts the surface the user had
	 * just pressed a door to open (measured while this was a layout effect, and pinned
	 * by the door arm of `scripts/ask-draft-swap.test.mjs`).
	 *
	 * IT DOES NOT WEAKEN EITHER OF THE OTHER GUARDS: the door latch and the unread
	 * frame are read the same way, and the effect is still offered every commit until
	 * the latch is spent.
	 */
	useEffect(() => {
		if (closedOnce.current) return;
		/*
		 * NOTHING TO SHOW IS `open === 0` AND NO ROWS, NOT ROWS ALONE (remediation round
		 * 1, R1). A frame whose LIST the wire bound dropped but whose TALLY survived
		 * (`{asks: null, asks_open: 4}`, `_bound_asks_in_place`) has no rows and four
		 * outstanding asks: closing over it would release the slot and leave every one of
		 * them unreachable, which is the reported defect with the sign flipped.
		 */
		if (view.rows.length > 0 || view.open > 0) {
			hadRows.current = true;
			return;
		}
		const wasPopulated = hadRows.current === true;
		hadRows.current = false;
		if (wasPopulated) {
			closedOnce.current = true;
			onClose();
			return;
		}
		/*
		 * A MOUNT over a queue with nothing to show: the switch case. Never a judgement about the
		 * read - an unread frame is not an empty one, and the map it would close on is
		 * exactly the read's own pending state.
		 */
		if (frameUnread) return;
		if (openedByDoor.current) return;
		closedOnce.current = true;
		onClose();
		/*
		 * `view.open` IS A DEPENDENCY BECAUSE THE GATE READS IT (R1). The gate is
		 * `rows > 0 || open > 0`, and a frame whose ROWS were dropped while its TALLY
		 * survived changes `open` without changing `rows.length` - so without this the
		 * effect could sit on a stale close verdict for exactly the frame the guard was
		 * added for.
		 */
	}, [view.rows.length, view.open, frameUnread, onClose]);

	/*
	 * INTO THE DRAWER, and only for the user's own press: the mount must find focus
	 * ALREADY on one of the lane's two doors - the composer chip (the session
	 * scope) or the panel rail's asks item (either scope; the conversation header's
	 * trigger until #896 moved it) - so a
	 * programmatic open, a story pinning the flag, or a second mount moves nothing.
	 *
	 * BOTH DOORS, because the rail door is outside the pane: with only the chip
	 * accepted, an open from the header (the door's home until #896) left the keyboard
	 * on the trigger, nothing
	 * inside the pane could consume Escape, and the press reached the app's interrupt
	 * rung and stopped the agent's turn (UX round 1, U1 / agent review round 1, F1).
	 * The returned `Element` is remembered so the door that was pressed is the one
	 * focus goes back to - the chip and the rail item, either of which may be
	 * unmounted on the route under the open surface.
	 */
	/*
	 * WHETHER THIS MOUNT ANSWERED A REQUEST, remembered locally so the one-shot
	 * survives the request being consumed: the store copy is cleared the moment
	 * it is seen (so no later mount can inherit it), and this ref is what keeps
	 * the WAIT and the entry move running for the mount it was written for. It is
	 * per instance, so a carried drawer that remounts over another conversation
	 * starts without it - a carried flag must move no keyboard, the oldest
	 * promise in this file.
	 */
	const requestedOpen = useRef(false);
	/*
	 * THE MENU'S RESTORE, ANSWERED (round-1 Q1, second half).
	 *
	 * The menu's close does not end when its row is picked: Radix tears the menu
	 * down asynchronously, and its teardown writes focus more than once - the
	 * trapped scope pulls a departing focus back into the menu, then the compose
	 * of the content's close-autofocus hands the keyboard to the `…` trigger
	 * (through a `setTimeout` in the focus scope's cleanup). Measured in jsdom
	 * against the real components (the pins in `scripts/panel-rail.test.mjs`'s
	 * menu-door case): an entry move written at the mount commit is overwritten
	 * by that teardown, so without an answer the keyboard the row promised the
	 * drawer ends up back on the trigger.
	 *
	 * SO THE CLAIM IS A WAIT, NOT A RACE. While this mount's request is fresh, a
	 * capture-phase `focusin` watcher re-takes the keyboard at the landing
	 * whenever the menu hands it BACK - a focusin on the trigger - until the
	 * menu is out of the document and the keyboard is inside the drawer, bounded
	 * by `MENU_CLAIM_LIMIT`. A focusin anywhere else is the user speaking (a
	 * palette, the composer) and disarms it, the same stand-down the entry
	 * guard (`keyboardLeftOnMenuPress`) keeps for the commit-time move. The
	 * menu's own internal churn (its portal furniture) is neither ours nor the
	 * user's and is left alone.
	 *
	 * AND IT SETTLES ONLY ONCE THE MENU IS OUT AND THE KEYBOARD HAS STAYED IN
	 * (round-2 M1). "One quiet macrotask after the last write" was timing-fragile:
	 * the restore is a `setTimeout(0)` the menu's teardown queues, and on a loaded
	 * host its delivery can land after the drawer's own beat - reproduced
	 * deterministically (a restore deferred past the old settle put the keyboard
	 * back on the trigger with the drawer OPEN, which is Q1's defect). The settle
	 * therefore waits on TWO facts, and the beats are TWO-STEP:
	 *
	 *  - THE MENU'S REMOVAL: the content node the row lived in is captured when
	 *    the claim arms; while it is in the document no beat may settle, and its
	 *    removal - watched, because nothing else is guaranteed to follow it -
	 *    opens the chain. No node found at arm (a rig mounting the drawer alone)
	 *    means there is nothing to wait for.
	 *  - THE TWO-STEP BEAT: the first beat after a write or a removal observation
	 *    can never END the claim, it only opens the chain; the next beat may
	 *    settle, and every delivered write cancels the pending beat and re-opens
	 *    the chain. A restore still in flight arrives while the chain is open, is
	 *    answered, and re-opens it - which a single quiet beat could have settled
	 *    ahead of. The teardown writes more than once (two trigger writes in a
	 *    StrictMode pass, one otherwise), and this absorbs that second write.
	 *
	 * WHILE ARMED a trigger focusin is answered even with the menu gone (that
	 * late write is what this whole wait exists for); once the claim has SETTLED,
	 * a trigger focusin is the user's and is not answered - the disarm is what
	 * keeps a deliberate Tab to the trigger from being bounced (round-2 N2).
	 *
	 * THIS IS NOT AN INTERCEPTION OF `onCloseAutoFocus` (which belongs to
	 * `chat-header`'s menu, and is deliberately not touched): it is the request
	 * signal's other half - the press arrived by request, so the restore it
	 * causes is the drawer's to answer.
	 */
	const claimRef = useRef<{
		attempts: number;
		handler: ((event: FocusEvent) => void) | null;
		/** The menu content node the row lived in, captured when the claim arms. */
		menu: Element | null;
		/** Whether that node has left the document; the settle waits on this. */
		menuGone: boolean;
		/** The pending quiet beat and whether it may end the claim (see `armMenuClaim`). */
		beat: ReturnType<typeof setTimeout> | null;
		beatMaySettle: boolean;
		/** Watches the captured menu out of the document (see `armMenuClaim`). */
		observer: MutationObserver | null;
	}>({
		attempts: 0,
		handler: null,
		menu: null,
		menuGone: false,
		beat: null,
		beatMaySettle: false,
		observer: null,
	});
	/* Whether the claim reached a terminal state (success, a user's own focus, or
	 * the bound); a mount that has one is never re-armed. */
	const claimSettled = useRef(false);
	/* The node the entry move landed on, for the claim to re-take (set at resolve). */
	const landingRef = useRef<HTMLElement | null>(null);
	const disarmMenuClaim = useCallback(() => {
		const claim = claimRef.current;
		if (claim.handler !== null) {
			document.removeEventListener("focusin", claim.handler, true);
			claim.handler = null;
		}
		if (claim.beat !== null) {
			clearTimeout(claim.beat);
			claim.beat = null;
		}
		claim.observer?.disconnect();
		claim.observer = null;
	}, []);
	const armMenuClaim = useCallback(() => {
		const claim = claimRef.current;
		if (claim.handler !== null || claimSettled.current) return;
		claim.attempts = 0;
		/*
		 * THE MENU THE ROW LIVED IN, captured here: the settle waits for THIS node
		 * to leave the document, because a menu whose teardown is still running can
		 * still write focus. `null` - no menu on the page, e.g. a rig that mounts
		 * the drawer alone - means "already gone": the beats alone carry the settle.
		 */
		claim.menu = document.querySelector('[role="menu"]');
		claim.menuGone = claim.menu === null || !claim.menu.isConnected;
		const settle = () => {
			claimSettled.current = true;
			disarmMenuClaim();
		};
		const menuGone = () => claim.menu === null || !claim.menu.isConnected;
		/**
		 * ONE BEAT, TWO STEPS (see the note at `claimRef`): a beat that MAY settle
		 * is always preceded by one that may not, so no single quiet stretch can
		 * end the claim while a teardown write is still in flight. `scheduleBeat`
		 * is idempotent - any newer reason to wait replaces the pending beat - and
		 * a beat that finds the menu still in the document or the keyboard outside
		 * ends nothing: the removal observer or a later write opens the chain again.
		 */
		const scheduleBeat = (maySettle: boolean) => {
			if (claim.beat !== null) clearTimeout(claim.beat);
			claim.beatMaySettle = maySettle;
			claim.beat = setTimeout(() => {
				claim.beat = null;
				if (claimSettled.current) return;
				if (!menuGone()) return;
				if (!rootRef.current?.contains(document.activeElement)) return;
				if (!claim.beatMaySettle) {
					scheduleBeat(true);
					return;
				}
				settle();
			}, 0);
		};
		/*
		 * THE REMOVAL, WATCHED. The settle's gate needs the menu's removal, and if
		 * no write follows it nothing else would open the chain again - so the
		 * observer is what turns "the menu left" into the beat that carries the
		 * claim to its end. Guarded for a rig with no `MutationObserver` global:
		 * the chain then depends on the writes alone, which every rig that mounts
		 * a menu shims, and the real components always provide.
		 */
		if (
			claim.menu !== null &&
			!claim.menuGone &&
			typeof MutationObserver !== "undefined"
		) {
			const observer = new MutationObserver(() => {
				if (claimSettled.current) return;
				if (claim.menu !== null && !claim.menu.isConnected) {
					claim.menuGone = true;
					observer.disconnect();
					claim.observer = null;
					scheduleBeat(false);
				}
			});
			observer.observe(document.body, { childList: true, subtree: true });
			claim.observer = observer;
		}
		const handler = (event: FocusEvent) => {
			const target = event.target as Element | null;
			if (target === null) return;
			if (rootRef.current?.contains(target)) {
				/* Where the press promised the keyboard: open the quiet chain. */
				scheduleBeat(false);
				return;
			}
			if (target.matches(MENU_TRIGGER_SELECTOR)) {
				/* The restore the menu performs on its way out: answer it. */
				if (claim.attempts >= MENU_CLAIM_LIMIT) {
					settle();
					return;
				}
				claim.attempts += 1;
				const landing = landingRef.current;
				(landing?.isConnected ? landing : rootRef.current)?.focus();
				return;
			}
			if (
				target.closest('[role="menu"]') !== null ||
				target.closest("[data-radix-popper-content-wrapper]") !== null ||
				target.closest("[data-radix-focus-guard]") !== null
			) {
				/* The menu's own machinery: neither ours nor the user's. */
				return;
			}
			/* The user has taken the keyboard elsewhere: stand down, terminally. */
			settle();
		};
		claim.handler = handler;
		document.addEventListener("focusin", handler, true);
	}, [disarmMenuClaim]);

	const wasBootstrapped = useRef(false);
	const doorRef = useRef<Element | null>(null);
	useLayoutEffect(() => {
		/*
		 * THE CLAIM RE-ARMS ON EVERY COMMIT UNTIL IT SETTLES, including a commit a
		 * StrictMode pass causes after its simulated teardown has disarmed it - so
		 * this check sits ABOVE the bootstrap guard rather than inside the
		 * consumption branch.
		 */
		if (requestedOpen.current) armMenuClaim();
		if (wasBootstrapped.current) return;
		const active = document.activeElement;
		if (active === null || typeof active.matches !== "function") return;
		/*
		 * EITHER DOOR: the composer chip (session) or the panel rail's asks item
		 * (either scope). Both are the user's own press; nothing else moves focus.
		 */
		const door =
			active.matches(ASK_ITEM_SELECTOR) ||
			active.matches(ASK_RAIL_ITEM_SELECTOR)
				? active
				: null;
		/*
		 * THE MENU'S REQUEST IS THE THIRD SIGNAL (round-1 Q1), consumed where it is
		 * SEEN: the `…` menu's row cannot put focus on a door (Radix restores it to
		 * the menu's trigger), so its open writes `askOpenIntent`, and this effect
		 * reads the request against its OWN scope. The store copy is CLEARED IN THE
		 * COMMIT THAT ANSWERS IT, so a remount - a conversation switch carrying the
		 * open flag, a scope swap - can never inherit it and move a keyboard nobody
		 * pressed; `requestedOpen` keeps the fact locally for the wait and the move
		 * below. A request for the other queue is left alone: the drawer that was
		 * asked for answers it.
		 */
		if (askOpenIntent === scope) {
			clearAskOpenIntent(scope);
			requestedOpen.current = true;
			/*
			 * THE RETURN TARGET IS RECORDED AT THE PRESS, not at the resolve: the
			 * trigger is what the keyboard ends on once Radix's own restore lands,
			 * and recording the fact here - rather than one or more commits later -
			 * keeps it stable across the unread wait, in which focus may legitimately
			 * move and a StrictMode pass tears the mount down once. See
			 * `MENU_TRIGGER_SELECTOR`.
			 */
			doorRef.current = menuReturnTarget(active);
			/* And the claim is armed for the restore that is coming (see `claimRef`). */
			armMenuClaim();
		}
		const requested = door === null && requestedOpen.current;
		/*
		 * THE DOOR IS LATCHED AS SOON AS IT IS SEEN, before the wait below can return: the
		 * auto-close effect reads it, and although that effect is declared ABOVE this one,
		 * it is a PASSIVE effect while this one is a layout effect - so it always runs
		 * after this, and the latch is set by the time it asks. (That ordering is why the
		 * close can stay where it is rather than moving below this effect.)
		 * THE REQUEST LATCHES THE SAME WAY, for the same reason and the same window: the
		 * emptiest queue a serving session carries - a live, empty one - is the state
		 * whose door must keep working, which is exactly where QA round 1 measured the
		 * menu row as a no-op.
		 */
		if (door !== null || requested) openedByDoor.current = true;
		const root = rootRef.current;
		/* No container yet: nothing to move focus into, and the one-shot is not spent. */
		if (root === null) return;
		/*
		 * THE ONE-SHOT IS CONSUMED ON THE FIRST COMMIT THAT IS NOT THE AWAITING READ,
		 * and that bound is the whole of this lane's no-focus-steal promise. The only
		 * thing there is to wait for is the read behind the pane: the fleet pane's first
		 * commits carry `frontend === null`, and so does a session frame that has not
		 * landed. `(door !== null || requested) && frameUnread` is exactly that state,
		 * and it is the ONLY state that retries.
		 *
		 * IT USED TO BE SPELLED `root === null`, WHICH NO LONGER NAMES IT: the container
		 * draws its chrome on every frame now (see the gate below), so a root exists from
		 * the first commit and the wait was silently spent while the frame was still
		 * unread - moving the keyboard to the drawer's own section rather than into the
		 * LIST the door was pressed for. What the wait is waiting for is the FRAME, so the
		 * frame is what it reads.
		 *
		 * EVERY OTHER COMMIT RESOLVES THE MOVE, and it resolves it whether or not a
		 * user's signal is present. Spending the flag only on a commit that found BOTH a
		 * door and a surface (the shape this used to have) left it false for as long as a
		 * drawer mounted with nothing focused stayed up: the rail's asks item is still on
		 * screen and still matches `ASK_RAIL_ITEM_SELECTOR`, and the ask clock re-renders
		 * once a second, so the next Tab onto that row plus any commit moved focus into
		 * the pane - the steal that old docblock said could not happen. Focus moves ONLY
		 * on a commit that carries a user's signal (the door under focus, or the request
		 * answered here), so the bounded wait cannot move anything either.
		 */
		if ((door !== null || requested) && frameUnread) return;
		wasBootstrapped.current = true;
		if (door === null && !requested) return;
		/*
		 * THE RETURN TARGET: the pressed door itself, or - for the menu's request -
		 * the trigger Radix handed the keyboard back to (`MENU_TRIGGER_SELECTOR`).
		 *
		 * AND THE REQUEST'S ONE GUARD, which the door path gets for free: that path
		 * re-reads focus every commit, so a user who moved the keyboard while the
		 * frame was unread resolves with no door and no move. The request has no live
		 * focus signal by construction, so the guard is stated - the move happens
		 * while the keyboard is still where the press left it, or on `<body>` before
		 * Radix's restore has landed - and a keyboard the user has since claimed
		 * elsewhere (the composer, a palette) keeps their newer act. Either way the
		 * one-shot is SPENT above, so a later Tab cannot resurrect the move.
		 */
		if (door !== null) doorRef.current = door;
		/* The request's target was recorded when the request was SEEN (above); this
		 * is the fallback for a paint that could not find one then. */
		doorRef.current ??= menuReturnTarget(active);
		if (door === null && !keyboardLeftOnMenuPress(active)) return;
		/*
		 * THE LIST'S FIRST CONTROL, not the bar's and not the filter's (UX round 1, U4;
		 * agent review round 1, m1). The bar leads the DOM and its first focusable is
		 * the DISMISS - so the surface used to open with its exit under the keyboard:
		 * press the chip, press Enter again, and the drawer you just opened closes. The
		 * landing is therefore the first thing in the LIST: the head card's first live
		 * option (`input`, an option row, or the free-text field) when a pending card is
		 * drawn, and otherwise the first settled row's own trigger. The fallbacks below
		 * stay for a panel with neither, and the LAST of them is the drawer itself
		 * (`tabIndex={-1}` on its own section, which is the stop the keyboard is meant to
		 * land on when the pane has no controls at all).
		 */
		const panel = root.querySelector<HTMLElement>(ASK_PANEL_SELECTOR);
		/*
		 * THE LIST SCOPES THE WALK. The panel leads with the FILTER control, whose
		 * buttons are legitimately focusable - so a bare "first focusable in the panel"
		 * lands on the filter rather than on the ask the reader pressed the door to
		 * answer, which is U4's fault with a new control wearing it. `ASK_LANDING_TARGET`
		 * names the list's own two shapes and says why the settled group has to be one of
		 * them.
		 */
		const landingRoot = panel?.querySelector<HTMLElement>(ASK_LANDING_TARGET);
		/*
		 * A NODE THAT CANNOT TAKE FOCUS IS NEVER THE LANDING (UX round 2, U2-1). The
		 * chain used to fall through to the bare `panel`, and `AskPanel`'s root is a plain
		 * `<div>` with no `tabIndex` - so `panel.focus()` was inert and the `?? root` term
		 * below it was dead code. On a pane with no rows (the state R3/Q1's widened door
		 * made reachable: a live-but-EMPTY queue) the entry move therefore moved nothing,
		 * and the cost was not cosmetic: the lane's Escape claim is the pane, the chip and
		 * the composer box, while focus stayed on the HEADER DOOR - which is not in that
		 * set - so Escape did nothing on a fully mounted pane (`panel.focus()` left
		 * `document.activeElement` unchanged; `root.focus()` lands; both measured).
		 *
		 * SO THE CHAIN SKIPS THE PANEL ROOT AND KEEPS THE SURFACE as its last resort, which
		 * is the stop this component already documents for itself. Giving the panel root a
		 * `tabIndex` was the alternative, and it was rejected: it would add a content `<div>`
		 * to the reading order for the sake of a fallback, and the surface's own section is
		 * inside `ASK_SURFACE_SELECTOR` with an `aria-label` naming the queue - a better
		 * landing than an unlabelled panel would be. `ASK_DRAWER_FOCUSABLE` excludes
		 * `[tabindex="-1"]`, so the root can never be picked as the "first control" above.
		 */
		const landing =
			landingRoot?.querySelector<HTMLElement>(ASK_DRAWER_FOCUSABLE) ??
			landingRoot ??
			panel?.querySelector<HTMLElement>(ASK_DRAWER_FOCUSABLE) ??
			root;
		landingRef.current = landing;
		landing.focus();
		/*
		 * NO DEPENDENCY ARRAY, and that is the whole point rather than an oversight.
		 * The one-shot has to be offered every commit until it is consumed, because the
		 * surface it may focus is not drawn on the fleet pane's first commits (the read
		 * has not answered, so the mount commit renders nothing at all and
		 * `rootRef.current` is null on it). A `[]` here ran exactly once, on that empty
		 * commit, and the re-render carrying the rows never got a second chance — the
		 * key stayed on the door the user pressed, which is the state UX round 1, U1
		 * recorded. The work per commit until the flag is set is two `matches` calls, and
		 * after it is set the first line returns.
		 */
	});

	/*
	 * BACK TO THE DOOR, and only when focus actually fell to the body: a close from
	 * the composer (Escape while typing) leaves focus in the box where the user is
	 * typing, and moving it to a row there would be the theft this whole lane avoids.
	 *
	 * The remembered door, not a fresh `querySelector(ASK_ITEM_SELECTOR)`: the fleet
	 * pane's door is the rail item and the session chip may not even be mounted on
	 * the route beneath it, so looking the chip up would either find nothing or focus
	 * the wrong control - the same defect UX round 1, U1 recorded from the other end.
	 *
	 * A MICROTASK, not a read at cleanup time: React runs an unmounting component's
	 * cleanup as part of the commit that deletes it, and at that instant the node
	 * inside this drawer can still hold focus - a synchronous read would see the
	 * drawer's own child and return early, leaving the keyboard nowhere. The microtask
	 * runs once the commit has finished, so the focused node is gone by then.
	 * (`requestAnimationFrame` would also work in the app and does not exist in a
	 * plain jsdom harness, which is the other half of why this is a microtask.)
	 *
	 * FOR THE MENU'S REQUEST the recorded door is the `…` TRIGGER
	 * (`MENU_TRIGGER_SELECTOR`): the row was the control pressed, and the trigger is
	 * what holds the keyboard once the menu has closed - so the rule the header
	 * trigger's own contract states ("the door that was pressed is the one focus goes
	 * back to") holds for all three doors.
	 */
	useEffect(() => {
		return () => {
			/* The claim watcher's life is the mount's (see `claimRef`). */
			disarmMenuClaim();
			/*
			 * THE REQUEST'S LIFE ENDS WITH THE OPEN IT WAS WRITTEN FOR. A request is
			 * normally consumed on the commit that acts on it (see the entry effect);
			 * this is the belt for the mount that never got that far - closed while the
			 * frame was still unread, or swapped away before it resolved - and it is
			 * SCOPE-GUARDED, so a drawer closing cannot clear a request the other queue
			 * is still owed. Without it a stale request would be inherited by the next
			 * mount (a carried drawer over the next conversation) and move a keyboard
			 * nobody pressed.
			 */
			clearAskOpenIntent(scope);
			queueMicrotask(() => {
				const active = document.activeElement;
				if (active !== null && active !== document.body) return;
				const door = doorRef.current as HTMLButtonElement | null;
				if (door !== null) {
					if (door.isConnected) door.focus();
					return;
				}
				/*
				 * NO DOOR WAS RECORDED, so there is none to go back to: this drawer was
				 * opened by the POLICY (or pinned programmatically by a story or rig), and
				 * the entry effect above deliberately moves no keyboard for anything but a
				 * press. The caret went into the drawer, the drawer unmounted, focus fell to
				 * `<body>` - and on the auto-opened drawer that is the DEFAULT first act
				 * (dismiss what the app opened) with the reader's next keystrokes lost to
				 * nothing (agent review round 1 / UX round 1, U1). The composer held the
				 * keyboard before the policy opened the drawer (measured: the active element
				 * at the open is the composer textarea), so the caret goes back there -
				 * through the composer's own hand-off, which is the one door that clears
				 * the "user took the box" flag (`composer-field.ts`), never a direct
				 * `focus()` on a queried node.
				 */
				handCaretToComposer();
			});
		};
		/*
		 * THE THREE NAMED VALUES ARE STABLE FOR THE LIFE OF THE MOUNT (a zustand
		 * action, a `[]`-memoised callback, and the scope this instance was mounted
		 * for), so this list is the empty one spelled out rather than a re-run
		 * trigger: the cleanup is the MOUNT's own and must not fire mid-life - it
		 * disarms a live claim and can hand a stranded keyboard back.
		 */
	}, [clearAskOpenIntent, disarmMenuClaim, scope]);

	/*
	 * THE CHROME RENDERS ON EVERY FRAME - there is no early return here any more, and that
	 * absence is the fix.
	 *
	 * WHAT USED TO BE HERE, AND WHY IT WAS RIGHT WHEN IT WAS WRITTEN. The gate was
	 * `sessionAsks(frontend) === null` -> draw nothing: "an absent queue is not an empty
	 * one, and this backend does not publish queued asks". That was the lane's capability
	 * rule, and it was CORRECT while the core published `asks` exactly while its queue had
	 * rows - the array's absence and the engine's absence were one fact. The WIRE FIX
	 * separated them (`ask-queue.ts`'s `askQueuePublished`, the core's `ask_wire`
	 * docblock): a live-but-EMPTY queue is now published as `asks` ABSENT with
	 * `asks_open: 0`, so this read turned a live, empty engine into a dead one. An older
	 * rule reading a changed contract, not a mistake - and the cost of the collision was
	 * a claimed slot: the drawer mounted (the open flag is the store's and survives a
	 * conversation switch, and `SessionPanel` is keyed by conversation, so the mount
	 * happens on every switch), drew nothing at all - no bar, no dismiss, no way out -
	 * while its 560px `PaneSlot` kept holding the right side of the window.
	 *
	 * THE RULE THAT REPLACES IT IS STRUCTURAL: while this component is mounted, its
	 * chrome (scope line + dismiss) is drawn, and only the BODY varies with the frame.
	 * That is what makes "no state may hold a claimed slot without a close control" true
	 * by construction rather than by enumerating the frames, which is the enumeration
	 * that produced the defect. The body has three readings: the rows, the panel's own
	 * designed empty sentence (a published queue with nothing in it), and - for a frame
	 * that has not been read, or one that publishes no queued engine at all - the quiet
	 * unread line, which states what the surface is doing rather than a count it cannot
	 * substantiate.
	 */
	return (
		/*
		 * `data-lo-ask-surfaces` is the lane's own marker, read by `askClaimsEscape`:
		 * the Escape claim covers this drawer, the row item that opens it and the
		 * composer box, not the window. It is kept on the container's root (where it
		 * was on the in-band panel) so the claim and the "is the surface up?" probe go
		 * on naming one thing.
		 *
		 * `tabIndex={-1}` makes the drawer itself the landing stop when it has no
		 * controls (a settled-only queue), and it must not become a second tab stop in
		 * front of the options when it has some. No `outline-none`, deliberately: the
		 * base layer's `:focus-visible` ring is what shows the keyboard landed here.
		 */
		<section
			ref={rootRef}
			aria-label={scope === "fleet" ? "All asks" : "This conversation's asks"}
			data-lo-ask-surfaces=""
			data-ask-drawer={scope}
			tabIndex={-1}
			className={cn("flex h-full flex-col bg-elevated")}
			/*
			 * Esc closes rather than declines (see the module note). Claimed with
			 * `preventDefault` so the app-wide interrupt ladder does not also treat it as
			 * a stop - the same claim `chat-page.tsx`'s window listener makes, which then
			 * stands down on `defaultPrevented`.
			 */
			onKeyDown={(event) => {
				if (event.key !== "Escape") return;
				event.preventDefault();
				onClose();
			}}
		>
			{/*
			 * ONE 40px chrome bar: which queue you are looking at on the left, the
			 * dismiss last. The trailing glyph is the FAMILY's - `PanelRightClose`, the
			 * same control the canvas's bar carries under `aria-label="Close canvas"`,
			 * which the design note's family table calls the X. A generic ✕ here would be
			 * a second glyph for the act the canvas already spells one way, and the
			 * canvas's own note refuses it for that reason.
			 *
			 * `[padding-inline-end:...]` reserves the OS caption buttons' corner, exactly
			 * as the canvas's bar does (chat redesign §J4): this pane's bar is what
			 * reaches the window's right edge while it is open - on the SETTINGS and
			 * agents routes, where the fleet drawer mounts with no panel rail beside it,
			 * the shell publishes the full inset; on the chat route the rail covers its
			 * own 44px of it (`--chrome-inset-end-pane`, #872).
			 */}
			<div
				className={cn(
					"flex h-10 shrink-0 items-center justify-between gap-2 px-2",
					"[padding-inline-end:max(0.5rem,var(--chrome-inset-end-pane,var(--chrome-inset-end)))]",
				)}
			>
				<span
					className="truncate text-ink-muted text-xs"
					/*
					 * The scope line is the surface's own name, so a reader who arrives by
					 * keyboard hears which queue this is rather than only "Asks".
					 */
					data-ask-scope=""
				>
					{askScopeLine(scope, view)}
				</span>
				<Tooltip content="Close asks">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Close asks"
						onClick={onClose}
						data-tour-tag="close-asks-button"
					>
						<PanelRightClose aria-hidden="true" />
					</Button>
				</Tooltip>
			</div>
			{/*
			 * The list, and the ONLY scroller in the lane: `min-h-0` lets a flex child
			 * shrink below its content so `overflow-y-auto` can actually take the overflow
			 * (without it the drawer grows and the page scroller returns - the D1 defect).
			 */}
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2">
				{/*
				 * THE BODY, AND WHY THERE ARE THREE READINGS RATHER THAN TWO (remediation round
				 * 1, D1). `AskPanel` draws the queue, its designed empty sentence and - R1 - the
				 * clipped-list statement for a PUBLISHED frame (`asks` OR `asks_open` present),
				 * including the live-but-empty one the drawer used to render as nothing. The
				 * two unpublishable frames are NOT one state: an UNREAD frame is a progress
				 * state that will resolve, and a RESOLVED frame that publishes no engine is a
				 * terminal answer about the runtime - the same words over both parked a
				 * permanent `Reading the asks…` on a runtime that will never read anything.
				 * So each gets its own honest line, and the second is not a claim that can
				 * never complete.
				 */}
				{view.published ? (
					<AskPanel
						view={view}
						nowMs={now}
						answering={answering}
						outcomes={outcomes}
						drafts={drafts ?? EMPTY_DRAFTS}
						onDraftChange={onDraftChange ?? noopDraftChange}
						onAnswer={(task, answers) => onAnswer?.(task.ask_id, answers)}
						onDecline={(task) => onDecline?.(task.ask_id)}
						onRevise={
							onRevise === undefined
								? undefined
								: (task, answers) => onRevise(task.ask_id, answers)
						}
						/*
						 * THE CONVERSATION LINE IS THE FLEET'S OWN, and the CALLER supplies it (see
						 * `AskDrawerProps.conversationOf`): a session drawer's rows are all about the
						 * conversation the user is in, so naming it on every card would be the same word
						 * N times. The panel stays scope-agnostic, which is what lets one list serve
						 * both contexts.
						 */
						conversationOf={conversationOf}
					/>
				) : (
					/*
					 * `frameUnread` is `view.unread`, so this is the unresolved frame; the other
					 * falsy-`published` case is the resolved-but-unsupported one below it.
					 */
					<p className="text-ink-muted text-body">
						{frameUnread ? ASK_DRAWER_UNREAD_LINE : ASK_DRAWER_UNAVAILABLE_LINE}
					</p>
				)}
			</div>
		</section>
	);
};
