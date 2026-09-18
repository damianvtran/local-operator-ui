import { cn } from "@shared/lib/utils";
import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
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
	// Completion is still the outcome after reading it; only its attention
	// mark rests. Keep failures, work and pending gates independent of receipts.
	const unseenCompletion =
		code === "complete" && row.attention?.unseen === true;
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
				 * the glyph — and the name carries it in the one case the ink moves
				 * to a state of its own (review round 3, R3-3).
				 *
				 * Gated on `unseenCompletion`, not on `row.attention?.unseen`, and
				 * the gating is the contract rather than a preference: this module's
				 * own test asserts that an ACKNOWLEDGED row renders IDENTICALLY to an
				 * unacknowledged one (`assert.equal(after, before)`) for every code
				 * but `complete`, so an unconditional suffix changes what an
				 * acknowledged danger or warning row says. Measured: the
				 * unconditional form fails 11 of those 12 cases, this one passes all
				 * twelve.
				 */}
				{unseenCompletion ? ", unread" : ""}
			</span>
		</span>
	);
}
