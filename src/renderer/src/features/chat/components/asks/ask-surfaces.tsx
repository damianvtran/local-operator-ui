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

import { useEffect, useState } from "react";
import type { CanonicalFrontendState } from "../../../../../../shared/desktop-session-contract";
import { askQueueView, sessionAsks } from "../../ask-queue";
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
	/** A story pins the clock so its frames are reproducible. */
	nowMs?: number;
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
	nowMs,
	className,
}: AskSurfacesProps) => {
	const view = askQueueView(frontend);
	const [expanded, setExpanded] = useState(false);
	const now = useAskClock(view.open > 0, nowMs);

	/*
	 * The panel collapses itself when the queue empties: an expanded panel over
	 * nothing is a surface the user has to dismiss, and the section's own rule is
	 * that the affordance disappears at zero asks.
	 */
	useEffect(() => {
		if (view.rows.length === 0) setExpanded(false);
	}, [view.rows.length]);

	// An absent queue is not an empty one: `sessionAsks` returns null when this
	// backend does not publish queued asks, and nothing mounts at all.
	if (sessionAsks(frontend) === null) return null;

	return (
		<div className={className}>
			<AskBar
				view={view}
				expanded={expanded}
				onToggle={() => setExpanded((current) => !current)}
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
						onAnswer={(task, answers) => onAnswer?.(task.ask_id, answers)}
						onDecline={(task) => onDecline?.(task.ask_id)}
					/>
				</div>
			) : null}
		</div>
	);
};
