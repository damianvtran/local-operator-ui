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
			? "text-info motion-safe:animate-spin"
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
			<span className="sr-only">{row.status?.label ?? "Recent"}</span>
		</span>
	);
}
