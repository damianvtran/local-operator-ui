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

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CanonicalFrontendState } from "../../../../../../shared/desktop-session-contract";
import type { AskDraft } from "../../ask-queue";
import {
	EMPTY_DRAFTS,
	askQueueView,
	noopDraftChange,
	sessionAsks,
} from "../../ask-queue";
import { AskPanel } from "./ask-panel";

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
	 * FOCUS COMES BACK TO THE ITEM THAT OPENED THE PANEL (UX round 2, U6).
	 *
	 * Escape out of the panel unmounts the option that held focus, so
	 * `document.activeElement` is the BODY and a keyboard user's next Tab starts at
	 * the top of the document - on a surface they had just left deliberately.
	 *
	 * CROSS-TREE ON PURPOSE, and the reason changed with the trigger: the control
	 * this return addresses used to be this component's own minimized bar, so a
	 * `rootRef.current.querySelector` reached it. The trigger is now the ask item in
	 * the composer's status row - a DIFFERENT React tree, rendered by
	 * `message-input.tsx` - so the handle has to be looked up from the document. It
	 * is still a `data-` handle rather than a ref, so no plumbing crosses the two
	 * trees and a story that renders the panel without the row simply finds nothing
	 * and moves no focus.
	 *
	 * NARROW ON PURPOSE: it fires only when focus actually fell to the body. A
	 * collapse from the COMPOSER (the same key, the other focus stop) leaves focus
	 * in the box where the user is typing, and moving it to the item there would be
	 * the focus theft this whole surface is built to avoid.
	 */
	const wasExpanded = useRef(false);
	/*
	 * A LAYOUT effect, matching the sibling focus return the blocking card uses: it
	 * runs in the commit that removes the panel, before the browser paints, so no
	 * frame ever shows focus on the body (agent review round 3, NIT-1).
	 */
	useLayoutEffect(() => {
		const was = wasExpanded.current;
		wasExpanded.current = expanded;
		if (!was || expanded) return;
		const active = document.activeElement;
		if (active !== null && active !== document.body) return;
		document
			.querySelector<HTMLButtonElement>("[data-lo-ask-item-toggle]")
			?.focus();
	}, [expanded]);
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
		 * `data-lo-ask-surfaces` is the lane's OWN marker, read by `askClaimsEscape`:
		 * the Escape claim covers this panel and the composer box, not the window
		 * (agent review round 3, F2). The row item carries the same attribute so the
		 * key works from either side of the interaction.
		 */
		<div className={className} data-lo-ask-surfaces="">
			<div
				/*
				 * Esc collapses rather than declines (see the module note). Claimed with
				 * `preventDefault` so the app-wide interrupt ladder does not also treat
				 * it as a stop - the same claim the blocking card makes.
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
		</div>
	);
};
