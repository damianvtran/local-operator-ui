/**
 * The ask surfaces as one mount: the PANEL the composer status row's item expands
 * into.
 *
 * ## Why a carrier rather than a mount in the chat pane
 *
 * The panel and its trigger are ONE interaction (design §5.0): the row item flips
 * the panel, the panel's Esc collapses it, and both have to agree about everything
 * that is not a property of one render - the expanded flag, the refusal record
 * keyed by ask id, and the clock the countdown reads. A mount in the pane could
 * hold the flag but not the clock, and the clock is the half that is easy to get
 * wrong: a countdown that ticks once per render is a countdown that lies whenever
 * the app is idle, which is exactly when the user is looking at it.
 *
 * ## The trigger moved, and this file keeps the half that did not
 *
 * The minimized bar used to live here, above the composer. It is gone: the ask
 * affordance is now a row item in the composer's status row
 * (`composer-status-row.tsx`), a peer of `All to-dos resolved` and `2 wakes armed`,
 * because a queued ask is one more thing a session has outstanding. That item
 * toggles the SAME flag this component reads (`expanded`), which chat-page owns, so
 * the panel is one surface with two halves in two trees - the trigger in the row,
 * the panel here. What stays here is everything that is a fact about the PANEL:
 * the clock, the Esc claim, the collapse when the queue empties, and the drafts and
 * outcomes the composer shares.
 *
 * ## The clock, and why it only runs while something is countable
 *
 * `nowMs` advances on an interval that is ARMED ONLY WHEN AT LEAST ONE OPEN ASK
 * IS ON SCREEN. A permanent 30s timer in the chat pane would be a wake-up per
 * session for a number nobody is reading, and this app is a resident process -
 * the cost is per open window, all day.
 *
 * ## Esc collapses, and never declines
 *
 * Design §5.1's D5: with queued asks, Esc closes the card and LEAVES THE ASK
 * OPEN; declining is an explicit action ("No answer - decide yourself"). The
 * blocking card's Esc-to-decline is the behaviour this must not inherit, because
 * a queued ask's Esc would otherwise silently tell the agent "I am not
 * answering" when the user only meant to get their transcript back.
 */

import { cn } from "@shared/lib/utils";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CanonicalFrontendState } from "../../../../../../shared/desktop-session-contract";
import type { AskDraft } from "../../ask-queue";
import {
	ASK_ITEM_SELECTOR,
	EMPTY_DRAFTS,
	askQueueView,
	noopDraftChange,
	sessionAsks,
} from "../../ask-queue";
import { AskPanel } from "./ask-panel";

/**
 * What "the panel's first control" means when focus enters it (UX round 1, U1).
 *
 * The tab-reachable set, in DOM order, and nothing else: `[tabindex]` is included
 * for controls made reachable deliberately, and the disabled/`aria-disabled`
 * exclusions are the ones this app actually uses to make a control inert - it puts
 * `aria-disabled` on controls it keeps mounted and focusable-looking
 * (`inline-edit-controls.tsx`, `autocomplete-field.tsx`, the credential-ask row in
 * `message-input.tsx`) rather than removing them, so a walk that honoured only the
 * native attribute would land on the first inert control the moment one appears in
 * this panel. No such control is in the panel today; the exclusion is here because
 * the doc promised it and because the next one will not announce itself (agent
 * review round 2, F6).
 */
const ASK_PANEL_FOCUSABLE =
	'a[href]:not([aria-disabled="true"]), button:not([disabled]):not([aria-disabled="true"]), [tabindex]:not([tabindex="-1"]):not([aria-disabled="true"]), input:not([disabled]):not([aria-disabled="true"]), select:not([disabled]):not([aria-disabled="true"]), textarea:not([disabled]):not([aria-disabled="true"])';

export type AskSurfacesProps = {
	frontend: Pick<
		CanonicalFrontendState,
		"asks" | "asks_open" | "asks_truncated"
	> | null;
	/**
	 * The three doors, addressed by ASK ID rather than by the record: the caller
	 * posts to a session by id and has no use for the rest of the row, and passing
	 * the whole ask up would invite a caller to read a status this surface has
	 * already classified.
	 */
	onAnswer?: (askId: string, answers: Record<string, string[]>) => void;
	onDecline?: (askId: string) => void;
	answering?: boolean;
	outcomes?: Record<
		string,
		{ sending: boolean; refused: string | null } | undefined
	>;
	/** The in-flight answers, keyed by ask id then question id. Caller-owned: the composer and this panel are one draft. */
	drafts?: Record<string, AskDraft>;
	onDraftChange?: (askId: string, next: AskDraft) => void;
	/** A story pins the clock so its frames are reproducible. */
	nowMs?: number;
	/**
	 * Whether the surface is expanded, and the door that flips it.
	 *
	 * OPTIONAL, and controlled when supplied. The routing rule this state decides
	 * is the composer's (design §5.0): while the answer surface is expanded the
	 * composer answers the ask, and while it is collapsed the composer is an
	 * ordinary conversation box. That decision lives in the page that owns the
	 * composer, so when the page wants to state it the state has to come from
	 * there - a second copy in here would let the bar and the composer disagree
	 * about which mode the user is in, which is the one thing the rule forbids.
	 * A story that does not care lets this component own it.
	 */
	expanded?: boolean;
	onToggle?: (next: boolean) => void;
	className?: string;
};

/** How often the countdown is re-read while an open ask is on screen. */
const ASK_CLOCK_MS = 30_000;

const useAskClock = (active: boolean, pinned?: number): number => {
	const [now, setNow] = useState(() => pinned ?? Date.now());
	useEffect(() => {
		if (pinned !== undefined || !active) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), ASK_CLOCK_MS);
		return () => window.clearInterval(timer);
	}, [active, pinned]);
	// A pinned clock wins over every tick, so a story's frames are stable.
	return pinned ?? now;
};

export const AskSurfaces = ({
	frontend,
	onAnswer,
	onDecline,
	answering = false,
	outcomes,
	drafts,
	onDraftChange,
	nowMs,
	expanded: expandedProp,
	onToggle,
	className,
}: AskSurfacesProps) => {
	const view = askQueueView(frontend);
	const [uncontrolledExpanded, setUncontrolledExpanded] = useState(false);
	/*
	 * CONTROLLED WHEN THE CALLER SUPPLIES IT. See `AskSurfacesProps.expanded`: the
	 * page that owns the composer owns this flag, because the composer's routing
	 * rule is what the flag means. `expanded` is read for truthiness rather than
	 * against `undefined` so a caller passing `false` is honoured, and a caller
	 * passing nothing falls back to this component's own state.
	 */
	const expanded = expandedProp ?? uncontrolledExpanded;
	const setExpanded = (next: boolean) => {
		setUncontrolledExpanded(next);
		onToggle?.(next);
	};
	const now = useAskClock(view.open > 0, nowMs);

	/*
	 * The panel collapses itself when the queue empties: an expanded panel over
	 * nothing is a surface the user has to dismiss, and the section's own rule is
	 * that the affordance disappears at zero asks.
	 *
	 * TWO GUARDS, and both are load-bearing rather than tidy-up (agent review F1,
	 * QA Q-1):
	 *
	 *  - `hadRows.current === null` is "not yet observed", so a MOUNT into an
	 *    empty-but-published queue is not an emptying. The first version started at
	 *    `true`, so every pane mount fired the door - and `SessionPanel` is keyed by
	 *    conversation, so that is every conversation switch.
	 *  - `expanded` is tested before collapsing, because a door that says
	 *    "collapsed" to a page that is already collapsed makes the caller's draft
	 *    swap run for no reason at all. The caller guards too (the swap is a
	 *    no-op when the mode does not move); this half keeps the call itself honest,
	 *    so a future caller without that guard cannot be hurt by us.
	 */
	const hadRows = useRef<boolean | null>(null);
	useEffect(() => {
		if (view.rows.length > 0) {
			hadRows.current = true;
			return;
		}
		const wasPopulated = hadRows.current === true;
		hadRows.current = false;
		if (!wasPopulated || !expanded) return;
		setExpanded(false);
	});
	/*
	 * FOCUS ENTERS THE PANEL WHEN THE USER PRESSED THE ITEM (UX round 1, U1).
	 *
	 * WHY THIS EXISTS. The panel sits ABOVE the row in the DOM (it is the composer
	 * band's first child, the row is inside `MessageInput`), so after a press the
	 * thing that just opened is behind the reader: forward Tab from the chip walks out
	 * of the lane entirely, and the panel's own controls are reachable only backwards.
	 * The base had them in one mount with the trigger first, so this is a regression
	 * the move introduced rather than a pre-existing quirk.
	 *
	 * THIS IS NOT THE FOCUS-STEAL THE LANE FORBIDS. That rule is about an ask
	 * ARRIVING: nothing here mounts, opens or moves focus on its own. The guard makes
	 * that structural rather than promised - the move happens only when the transition
	 * to expanded found focus ALREADY on the item, which is reachable only by the
	 * user's own press or Enter (or by a caller that deliberately focuses the chip).
	 * A programmatic expansion, a story pinning the flag, or a second mount leaves
	 * focus exactly where it was.
	 *
	 * THE FIRST FOCUSABLE CONTROL, else the panel itself (which carries `tabIndex={-1}`
	 * for exactly this case): a settled queue has no controls to land on, and a panel
	 * the keyboard cannot enter at all would be the same dead end for a two-key
	 * queue.
	 */
	const panelRef = useRef<HTMLDivElement | null>(null);
	/*
	 * ONE EFFECT FOR BOTH DIRECTIONS, and the ref is why: two effects sharing a
	 * `wasExpanded` ref cannot both read the transition, because whichever runs first
	 * has already written the new value (found by the round-1 driven test - the
	 * return-to-item half silently stopped firing the moment the enter half landed).
	 *
	 * The ref SEEDS with the mount's own value, so a mount is not a transition in
	 * either direction: a panel that arrives already open (`defaultOpen`, or a host
	 * that pins the flag) must not run the enter branch, whose guard would be the only
	 * thing standing between it and a focus move on arrival - the exact focus theft
	 * the lane forbids. `useRef(false)` looked equivalent and was not (agent review
	 * round 2, F8).
	 */
	const wasExpanded = useRef(expanded);
	useLayoutEffect(() => {
		const was = wasExpanded.current;
		wasExpanded.current = expanded;
		if (was === expanded) return;
		if (expanded) {
			/*
			 * INTO THE PANEL, and only for the user's own press: the transition must find
			 * focus ALREADY on the item, which is reachable only from a press or Enter on
			 * the chip (or a caller that deliberately focuses it). A programmatic
			 * expansion, a story pinning the flag, or a second mount moves nothing - which
			 * is what keeps this separate from the lane's no-focus-steal promise, whose
			 * subject is an ask ARRIVING.
			 */
			const active = document.activeElement;
			if (active === null || !active.matches?.(ASK_ITEM_SELECTOR)) return;
			const panel = panelRef.current;
			if (panel === null) return;
			(panel.querySelector<HTMLElement>(ASK_PANEL_FOCUSABLE) ?? panel).focus();
			return;
		}
		/*
		 * BACK TO THE ITEM, and only when focus actually fell to the body: a collapse
		 * from the COMPOSER (the same key, the other focus stop) leaves focus in the box
		 * where the user is typing, and moving it to the item there would be the focus
		 * theft this whole surface is built to avoid.
		 */
		const active = document.activeElement;
		if (active !== null && active !== document.body) return;
		const item = document.querySelector<HTMLButtonElement>(ASK_ITEM_SELECTOR);
		if (item?.isConnected) item.focus();
	}, [expanded]);
	/*
	 * The U6 note this effect carries, kept beside its own paragraph because the two
	 * halves of the focus story are one decision:
	 *
	 * CROSS-TREE ON PURPOSE: the control this return addresses used to be this
	 * component's own minimized bar, so a `rootRef.current.querySelector` reached it.
	 * The trigger is now the ask item in the composer's status row - a DIFFERENT React
	 * tree, rendered by `message-input.tsx` - so the handle has to be looked up from
	 * the document. It is still a `data-` handle rather than a ref, so no plumbing
	 * crosses the two trees, and a story that renders the panel without the row simply
	 * finds nothing and moves no focus.
	 *
	 * ONE COMPOSER PER DOCUMENT is the invariant the document-wide query rests on, and
	 * it is the app's own: `chat-page.tsx` mounts a single `MessageInput`, and the mini
	 * quick-send window is a SEPARATE document (`mini.html`). It is written down rather
	 * than assumed, and `isConnected` is asserted rather than chained: a detached match
	 * would turn this return into a silent no-op, and a node that is not in the tree
	 * must not be handed focus (agent review round 1, F4).
	 */
	// An absent queue is not an empty one: `sessionAsks` returns null when this
	// backend does not publish queued asks, and nothing mounts at all.
	if (sessionAsks(frontend) === null) return null;
	/*
	 * COLLAPSED RENDERS NOTHING AT ALL. The panel is the only surface left in this
	 * component, so a collapsed panel is an empty div above the composer - and an
	 * empty div that reserved the band's measure and padding would put 8px of blank
	 * over every session with a settled queue. The trigger's own state is the row
	 * item's; when it is collapsed there is nothing for this mount to draw.
	 */
	if (!expanded) return null;

	return (
		/*
		 * `data-lo-ask-surfaces` is the PANEL's own marker, read by `askClaimsEscape`:
		 * the Escape claim covers this panel, the row item that expands it and the
		 * composer box, not the window (agent review round 3, F2). The trigger is NOT
		 * inside this root (it lives in the row), which is why `pressIsOurs` accepts the
		 * item's own handle as a second clause - and why this marker can be trusted as a
		 * "is the panel open?" probe, since the root renders nothing while collapsed
		 * (UX round 1, U3). `tabIndex={-1}` makes the panel itself the landing stop when
		 * it has no controls (a settled queue).
		 */
		<div
			ref={panelRef}
			/*
			 * Focusable by SCRIPT only (`-1`): it is the landing stop when the panel has
			 * no controls of its own (a settled queue, U1), and it must not become a
			 * second tab stop in front of the options when it has some.
			 */
			tabIndex={-1}
			/*
			 * NO `outline-none`, DELIBERATELY (agent review round 2, F9; UX round 2, U4).
			 * This root is the one scripted landing stop the panel has, so when a settled
			 * queue is opened by keyboard the focus the reader's own press moved must be
			 * VISIBLE: the base layer paints the app's `:focus-visible` ring on any focused
			 * element (`styles/index.css`, `html :focus-visible`), which is exactly what the
			 * chips beside it rely on, and suppressing it here made this the one landing that
			 * painted nothing. A container with no controls needs no decoration of its own -
			 * only an indicator that the keyboard is on it.
			 */
			className={cn(className, "flex flex-col")}
			data-lo-ask-surfaces=""
			/*
			 * Esc collapses rather than declines (see the module note). Claimed with
			 * `preventDefault` so the app-wide interrupt ladder does not also treat it as
			 * a stop - the same claim the blocking card makes. It sits on the root because
			 * the root is now itself a focus stop.
			 */
			onKeyDown={(event) => {
				if (event.key !== "Escape") return;
				event.preventDefault();
				setExpanded(false);
			}}
		>
			<AskPanel
				view={view}
				nowMs={now}
				answering={answering}
				outcomes={outcomes}
				drafts={drafts ?? EMPTY_DRAFTS}
				onDraftChange={onDraftChange ?? noopDraftChange}
				onAnswer={(task, answers) => onAnswer?.(task.ask_id, answers)}
				onDecline={(task) => onDecline?.(task.ask_id)}
			/>
		</div>
	);
};
