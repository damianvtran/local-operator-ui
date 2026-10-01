/**
 * The ask surfaces as one mount: the minimized bar, and the panel it expands
 * into.
 *
 * ## Why a carrier rather than two mounts in the chat pane
 *
 * The bar and the panel are ONE interaction (design §5.0): the bar's chevron
 * flips the panel, the panel's Esc collapses it, and both have to agree about
 * everything that is not a property of one render - the expanded flag, the
 * refusal record keyed by ask id, and the clock the countdown reads. A mount in
 * the pane could hold the flag but not the clock, and the clock is the half that
 * is easy to get wrong: a countdown that ticks once per render is a countdown
 * that lies whenever the app is idle, which is exactly when the user is looking
 * at it.
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

import { useEffect, useRef, useState } from "react";
import type { CanonicalFrontendState } from "../../../../../../shared/desktop-session-contract";
import type { AskDraft } from "../../ask-queue";
import {
	EMPTY_DRAFTS,
	askQueueView,
	noopDraftChange,
	sessionAsks,
} from "../../ask-queue";
import { AskBar } from "./ask-bar";
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
	 * IT FIRES ON THE TRANSITION TO EMPTY, not on every render while empty, and
	 * that guard is load-bearing rather than an optimisation. The caller's door is
	 * an unstable closure (the page's own handler is), so an effect keyed on it
	 * would run on every render for as long as the queue stayed empty - and each
	 * run would swap the composer's two DRAFTS, silently trading the user's chat
	 * text for their answer text behind their back. The reference holds the last
	 * observed state, so exactly one collapse is delivered per emptying.
	 */
	const hadRows = useRef(true);
	useEffect(() => {
		if (view.rows.length > 0) {
			hadRows.current = true;
			return;
		}
		if (!hadRows.current) return;
		hadRows.current = false;
		setExpanded(false);
	});

	// An absent queue is not an empty one: `sessionAsks` returns null when this
	// backend does not publish queued asks, and nothing mounts at all.
	if (sessionAsks(frontend) === null) return null;

	return (
		<div className={className}>
			<AskBar
				view={view}
				expanded={expanded}
				onToggle={() => setExpanded(!expanded)}
			/>
			{expanded ? (
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
			) : null}
		</div>
	);
};
