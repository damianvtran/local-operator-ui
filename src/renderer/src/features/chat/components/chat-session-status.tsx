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
			: code === "approval" ||
					code === "answer" ||
					code === "wedged" ||
					code === "error"
				? CircleAlert
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
			: code === "error" || code === "wedged"
				? "text-danger"
				: code === "approval" || code === "answer" || code === "interrupted"
					? "text-warning"
					: unseenCompletion
						? "text-success"
						: "text-ink-dim";
	return (
		<span
			className="flex size-4 shrink-0"
			title={row.status?.label ?? "Recent"}
		>
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
				 * interruption" and ranks as outstanding completions. Those the name
				 * now carries while unseen, where it used to carry nothing the row's
				 * own label had not already said.
				 */}
				{unreadMark !== null ? ", unread" : ""}
			</span>
		</span>
	);
}
