import { cn } from "@shared/lib/utils";
import {
	type CanonicalSessionRow,
	unreadMarkKind,
} from "@shared/store/canonical-sessions-store";
import {
	Check,
	Circle,
	CircleAlert,
	Clock,
	EqualApproximately,
	HelpCircle,
	LoaderCircle,
	MessageSquare,
	Pause,
} from "lucide-react";

/** Resting codes that legitimately render as a plain ring. */
const KNOWN_RESTING = new Set(["idle", "recent"]);

export function ChatSessionStatus({ row }: { row: CanonicalSessionRow }) {
	const code = row.status?.code;
	/*
	 * WHAT THIS ROW IS DRAWING, asked of the ONE predicate (`unreadMarkKind`) the
	 * accessible name below, the sidebar row's tooltip and the bulk control's
	 * count all ask. It reads `status.code`, which is the runtime's own
	 * `shows_completion_mark` precedence over the wire; `unseen` alone cannot
	 * answer it, because a session that finished a turn and then started another
	 * still carries `unseen` — a LEVEL, cleared only by an acknowledgement — while
	 * drawing a spinner, and that row must claim neither the check nor "unread".
	 */
	const unreadMark = unreadMarkKind(row);
	// Completion is still the outcome after reading it; only its attention
	// mark rests. Keep failures, work and pending gates independent of receipts.
	const unseenCompletion = unreadMark === "complete";
	const Icon =
		code === "busy"
			? LoaderCircle
			: code === "approval" || code === "answer" || code === "error"
				? CircleAlert
				: /*
					 * `wedged` WEARS A MARK OF ITS OWN, and that is the fix rather than a
					 * flourish. It used to share `CircleAlert` with `error`, so an owner that
					 * had merely stopped reporting and a turn that had actually broken drew
					 * byte-identical output — and the two ask opposite things of a reader
					 * (reopen the failed one; do not expect a message to land in the silent
					 * one). Colour cannot carry the difference either: this app and the TUI
					 * share one brand ramp, and the measurement recorded for the same
					 * `warning`/`danger` pair collapses the two inks under deuteranopia
					 * (`session_picker.py:563-569`). SHAPE IS THE SIGNAL, so the state gets
					 * a silhouette that shares no stroke with the alert ring — two
					 * horizontal waves, which is this app's `EqualApproximately` and the
					 * TUI's `≈` for the same state.
					 *
					 * WHY NOT THE NEAR MISSES: `WifiOff` belongs to the app's
					 * daemon-connection vocabulary for a different fact with a different
					 * remedy (`shared/backend-status.ts`); `HelpCircle` already means "a code
					 * this build does not know" two branches below; and
					 * `CircleDashed`/`CircleDotDashed` would put a second RING in the amber
					 * class beside `approval`/`answer`, which is the grouping failure the
					 * TUI's marker register warns about.
					 *
					 * IT STAYS STATIC while `busy` spins. Nothing about this state is
					 * turning: the runtime's beat stopped landing, and an animation here
					 * would both borrow the busy reading and assert an activity the stale
					 * heartbeat cannot support.
					 */
					code === "wedged"
					? EqualApproximately
					: code === "interrupted" || code === "dormant"
						? Pause
						: code === "complete"
							? unseenCompletion
								? Check
								: Circle
							: code === "scheduled"
								? Clock
								: code === "attached"
									? MessageSquare
									: // `idle`/`recent` are ordinary resting states and keep the plain
										// ring. Anything else is a code this build does not know, so it
										// must not be normalised into looking like "Recent" — a backend
										// newer than the UI would silently misreport state. An ABSENT
										// status is a different case: a locally created row carries none
										// until the next fetch, and the label already reads "Recent", so
										// treating it as unknown made the icon contradict the label.
										KNOWN_RESTING.has(code ?? "recent")
										? Circle
										: HelpCircle;
	const ink =
		code === "busy"
			? // LIVENESS IS `accent` (or motion). It was `info` here and the accent
				// in the transcript, so one fact wore two hues depending on which
				// surface carried it — and `info` means "here is a fact" on the six
				// sites that own it. Motion still carries the state on its own; the
				// accent is the second channel, not the only one.
				"text-accent motion-safe:animate-spin"
			: code === "wedged"
				? /*
					 * `warning`, not `danger`, and the product already agreed with itself
					 * about this everywhere except here: `warning` is the role reserved
					 * for "read this, nothing has broken" — the same reading that moved
					 * `interrupted` off danger — and it is what the `/info` badge
					 * (`pickers/panels/info-panel.tsx`) and the connectivity banner
					 * already render for this state. The row was the outlier.
					 *
					 * NO NEW TOKEN, so no palette edit, no `gen-themes` run and no row in
					 * `scripts/contrast-contract.mjs`: `warning` is an existing semantic
					 * with a measured 4.5:1 text floor (docs/branding.md § 3), and this is
					 * an ink on an icon rather than a component fill/border triple.
					 *
					 * NOT `text-ink-dim`: the state changes what the user can expect of
					 * the row — their next message may silently not land — so it stays
					 * louder than a resting row, which is also why it must not be quieter
					 * than `busy`.
					 */
					"text-warning"
				: code === "error"
					? "text-danger"
					: code === "approval" || code === "answer" || code === "interrupted"
						? "text-warning"
						: unseenCompletion
							? "text-success"
							: "text-ink-dim";
	return (
		/*
		 * NO `title` ON THIS SPAN (review round 1, MINOR 1). It used to carry
		 * `row.status?.label`, and because this span sits INSIDE the row's button it won
		 * the nested-`title` rule: hovering the 16px mark showed the state's sentence
		 * WITHOUT the remedy clause the row composes, so the one piece of advice this
		 * change adds was unreachable exactly over the mark it is about — and the row's
		 * own tooltip, which carries the clause, was shadowed over that square of pixels.
		 * The sentence is not lost by dropping it: the row's button owns the tooltip for
		 * the whole row (including the mark), and the `sr-only` span below carries the
		 * same words to the accessibility tree.
		 */
		<span className="flex size-4 shrink-0">
			<Icon className={cn("size-4", ink)} aria-hidden="true" />
			<span className="sr-only">
				{row.status?.label ?? "Recent"}
				{/*
				 * THE UNREAD SEMANTIC IS AN INK STEP, so on its own it tells a screen
				 * reader nothing — the arrival is visible only to someone looking at
				 * the glyph — and the name carries it in the cases the ink moves to a
				 * state of its own (review round 3, R3-3).
				 *
				 * Gated on `unreadMark`, not on `row.attention?.unseen`, and the gating
				 * is the contract rather than a preference: this module's own test
				 * asserts that an ACKNOWLEDGED row renders IDENTICALLY to an
				 * unacknowledged one for every code that draws NO mark, so an
				 * unconditional suffix changes what an acknowledged busy, wedged or
				 * gated row says — and a busy row claiming ", unread" is the reported
				 * defect in the one place the ink cannot show it.
				 *
				 * The marks are the predicate's three: `complete`, and the `error` and
				 * `interrupted` codes the runtime labels "Unseen error" / "Unseen
				 * interruption" and ranks as outstanding completions.
				 *
				 * THE TWO FAILURE CODES THEREFORE SAY "UNSEEN" TWICE — "Unseen error,
				 * unread" — and that redundancy is ACCEPTED rather than trimmed (design
				 * D4 and QA Q-2 both raised it). Gating the suffix on `unreadMark ===
				 * "complete"` would be a SECOND rule about which codes carry the
				 * suffix, which is the two-derivations class this whole change removes:
				 * the suffix would become the check's property rather than the mark's,
				 * and a counted row's name would say nothing about the mark it draws.
				 * It is also the CLIENT's own statement of the level, where the
				 * "Unseen" in the label is the backend's word for it — which is what
				 * keeps the name true if that label is ever reworded for a code whose
				 * ink does not step between read and unseen.
				 */}
				{unreadMark !== null ? ", unread" : ""}
			</span>
		</span>
	);
}
