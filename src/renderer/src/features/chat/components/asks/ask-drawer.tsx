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
 * width arithmetic (`min(560, row - 480)`, floor 400, overlay below the floor; see
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
 * chip and the surface cannot disagree about whether there is anything to show.
 *
 * ## Focus
 *
 * Entering is the user's own press and nothing else: the mount finds focus on one of
 * the lane's two DOORS - the status-row item (`ASK_ITEM_SELECTOR`, the session scope)
 * or the conversation header's asks trigger (`ASK_HEADER_ITEM_SELECTOR`, whichever
 * scope it opened) - or it
 * moves nothing, which is what keeps the lane's no-focus-steal promise (whose subject
 * is an ask ARRIVING) intact. WHERE it lands is the CARD's first control and not the
 * bar's (UX round 1, U4): the bar's leading control in DOM order is the dismiss, so
 * the old "first focusable in the drawer" put the surface's exit under the first
 * Enter - a second press closed the thing the user had just opened. The bar is still
 * reachable, one Shift+Tab up. Leaving returns focus to the door it was opened by,
 * but only when focus was actually stranded - a close from the composer leaves the
 * caret in the box where the user is typing, and moving it there would be the same
 * theft. The return is deferred one microtask because React runs an unmounting
 * component's cleanup BEFORE it detaches the nodes, so a synchronous read would still
 * see the drawer's own focused child.
 */

import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { PanelRightClose } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import type { CanonicalFrontendState } from "../../../../../../shared/desktop-session-contract";
import type {
	AskDraft,
	AskOutcome,
	AskPresentation,
	AskScope,
} from "../../ask-queue";
import {
	ASK_HEADER_ITEM_SELECTOR,
	ASK_ITEM_SELECTOR,
	EMPTY_DRAFTS,
	askQueueView,
	askScopeLine,
	noopDraftChange,
	sessionAsks,
} from "../../ask-queue";
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
 * so this is a read of a contract that already exists rather than a second one: a
 * settled-only queue has no live control, and the fallbacks below then take the
 * root instead.
 */
const ASK_PANEL_SELECTOR = "[data-lo-ask-panel]";

export type AskDrawerProps = {
	frontend: Pick<
		CanonicalFrontendState,
		"asks" | "asks_open" | "asks_truncated"
	> | null;
	/**
	 * Which queue this drawer is showing, carried by the ENTRY POINT rather than
	 * chosen here (design note §4.4): a session's chip opens `session` and the
	 * sidebar's top-level `Asks` row opens `fleet`. It is read for the chrome bar's
	 * scope line, the surface's accessible name, and the per-row conversation line
	 * (`conversationOf` below) - the three places the two contexts differ - so the
	 * two queues share one container rather than growing a second drawer.
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
	/** The in-flight answers, keyed by ask id then question id. Caller-owned: the composer and this drawer are one draft. */
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
	 * The drawer closes itself when the queue empties: an open drawer over nothing is
	 * a surface the user has to dismiss, and the lane's own rule is that the
	 * affordance disappears at zero asks.
	 *
	 * `hadRows.current === null` is "not yet observed", so a MOUNT into an
	 * empty-but-published queue is not an emptying - the drawer is opened by the
	 * user, who may open it on a settled-only queue to read the history, and closing
	 * it the instant it arrived would be a control that refuses its own door. This
	 * guard is the one the surface this container replaces had, kept because the
	 * reason has not changed.
	 */
	const hadRows = useRef<boolean | null>(null);
	useEffect(() => {
		if (view.rows.length > 0) {
			hadRows.current = true;
			return;
		}
		const wasPopulated = hadRows.current === true;
		hadRows.current = false;
		if (!wasPopulated) return;
		onClose();
	}, [view.rows.length, onClose]);

	/*
	 * INTO THE DRAWER, and only for the user's own press: the mount must find focus
	 * ALREADY on one of the lane's two doors - the composer chip (the session
	 * scope) or the sidebar's `Asks` row (the fleet scope) - so a programmatic open,
	 * a story pinning the flag, or a second mount moves nothing.
	 *
	 * BOTH DOORS, because the fleet door is a rail row: with only the chip accepted,
	 * an open from the rail left the keyboard on the row, nothing inside the pane
	 * could consume Escape, and the press reached the app's interrupt rung and
	 * stopped the agent's turn (UX round 1, U1 / agent review round 1, F1). The
	 * returned `Element` is remembered so the door that was pressed is the one focus
	 * goes back to - two doors, one of which is on the rail and one in a composer
	 * that may not even be mounted on the route under the fleet pane.
	 */
	const wasBootstrapped = useRef(false);
	const doorRef = useRef<Element | null>(null);
	useLayoutEffect(() => {
		if (wasBootstrapped.current) return;
		const active = document.activeElement;
		if (active === null || typeof active.matches !== "function") return;
		/*
		 * EITHER DOOR: the composer chip (session) or the header's asks trigger
		 * (either scope). Both are the user's own press; nothing else moves focus.
		 */
		const door =
			active.matches(ASK_ITEM_SELECTOR) ||
			active.matches(ASK_HEADER_ITEM_SELECTOR)
				? active
				: null;
		const root = rootRef.current;
		/*
		 * THE ONE-SHOT IS CONSUMED ON THE FIRST COMMIT THAT IS NOT THE AWAITING READ,
		 * and that bound is the whole of this lane's no-focus-steal promise. The only
		 * thing there is to wait for is the fleet pane's read: its first commits carry
		 * `frontend === null`, so the container draws nothing and `rootRef.current` is
		 * null while the door that opened it is still under the keyboard. `door !==
		 * null && root === null` is exactly that state, and it is the ONLY state that
		 * retries.
		 *
		 * EVERY OTHER COMMIT RESOLVES THE MOVE, and it resolves it whether or not a
		 * door is under focus. Spending the flag only on a commit that found BOTH a door
		 * and a surface (the shape this used to have) left it false for as long as a
		 * drawer mounted with nothing focused stayed up: the header trigger is still on
		 * screen and still matches `ASK_HEADER_ITEM_SELECTOR`, and the ask clock re-renders once
		 * a second, so the next Tab onto that row plus any commit moved focus into the
		 * pane - the steal that old docblock said could not happen. Focus moves ONLY on
		 * a commit that has both a door and a surface, so the bounded wait cannot move
		 * anything either.
		 */
		if (door !== null && root === null) return;
		wasBootstrapped.current = true;
		if (door === null || root === null) return;
		doorRef.current = door;
		/*
		 * THE CARD'S FIRST CONTROL, not the bar's (UX round 1, U4). The bar leads the
		 * DOM, and its first focusable is the DISMISS - so the surface used to open with
		 * its exit under the keyboard: press the chip, press Enter again, and the drawer
		 * you just opened closes. The focused node is the head card's first live option
		 * (`input`, an option row, or the free-text field), falling back to the panel
		 * root (a settled-only queue has no control, and `tabIndex={-1}` there is the
		 * deliberate landing) and then to the drawer itself.
		 */
		const panel = root.querySelector<HTMLElement>(ASK_PANEL_SELECTOR);
		/*
		 * THE HEAD CARD SCOPES THE WALK (operator ask, 2026-10-05). The panel now leads
		 * with the FILTER control, whose buttons are legitimately focusable - so a bare
		 * "first focusable in the panel" would land on the filter rather than on the ask
		 * the reader pressed the door to answer, which is UX round 1's U4 fault with a
		 * new control wearing it. Scoping to the first `[data-lo-ask-row]` puts the
		 * landing back on the head CARD's first live option (`input`, an option row, or
		 * the free-text field) whatever chrome the panel grows ABOVE the list, and the
		 * fallbacks below are unchanged: a settled-only queue draws no card, so it walks
		 * the panel exactly as it always did.
		 */
		const headCard = panel?.querySelector<HTMLElement>("[data-lo-ask-row]");
		const landing =
			headCard?.querySelector<HTMLElement>(ASK_DRAWER_FOCUSABLE) ??
			headCard ??
			panel?.querySelector<HTMLElement>(ASK_DRAWER_FOCUSABLE) ??
			panel ??
			root;
		landing.focus();
		/*
		 * NO DEPENDENCY ARRAY, and that is the whole point rather than an oversight.
		 * The one-shot has to be offered every commit until it is consumed, because the
		 * surface it may focus is not drawn on the fleet pane's first commits (the read
		 * has not answered, so the mount commit renders nothing at all and
		 * `rootRef.current` is null on it). A `[]` here ran exactly once, on that empty
		 * commit, and the re-render carrying the rows never got a second chance — the
		 * key stayed on the rail row, which is the state UX round 1, U1 recorded. The
		 * work per commit until the flag is set is two `matches` calls, and after it is
		 * set the first line returns.
		 */
	});

	/*
	 * BACK TO THE DOOR, and only when focus actually fell to the body: a close from
	 * the composer (Escape while typing) leaves focus in the box where the user is
	 * typing, and moving it to a row there would be the theft this whole lane avoids.
	 *
	 * The remembered door, not a fresh `querySelector(ASK_ITEM_SELECTOR)`: the fleet
	 * pane is opened from the rail and the session chip may not even be mounted on the
	 * route beneath it, so looking the chip up would either find nothing or focus the
	 * wrong control - the same defect UX round 1, U1 recorded from the other end.
	 *
	 * A MICROTASK, not a read at cleanup time: React runs an unmounting component's
	 * cleanup as part of the commit that deletes it, and at that instant the node
	 * inside this drawer can still hold focus - a synchronous read would see the
	 * drawer's own child and return early, leaving the keyboard nowhere. The microtask
	 * runs once the commit has finished, so the focused node is gone by then.
	 * (`requestAnimationFrame` would also work in the app and does not exist in a
	 * plain jsdom harness, which is the other half of why this is a microtask.)
	 */
	useEffect(() => {
		return () => {
			queueMicrotask(() => {
				const active = document.activeElement;
				if (active !== null && active !== document.body) return;
				const door = doorRef.current as HTMLButtonElement | null;
				if (door?.isConnected) door.focus();
			});
		};
	}, []);

	/*
	 * An absent queue is not an empty one: `sessionAsks` returns null when this
	 * backend does not publish queued asks, and nothing mounts at all - the same
	 * capability rule the chip and the panel follow, read from the same function.
	 */
	if (sessionAsks(frontend) === null) return null;

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
			 * reaches the window's right edge while it is open.
			 */}
			<div
				className={cn(
					"flex h-10 shrink-0 items-center justify-between gap-2 px-2",
					"[padding-inline-end:max(0.5rem,var(--chrome-inset-end))]",
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
			</div>
		</section>
	);
};
