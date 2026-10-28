import { useMediaQuery } from "@shared/hooks/use-media-query";
import { cn } from "@shared/lib/utils";
import {
	type CSSProperties,
	type FC,
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

/** §7.3's fade + 8px slide, followed by the height collapse. */
const EXIT_FADE_MS = 120;
const EXIT_COLLAPSE_MS = 180;
const EXIT_TOTAL_MS = EXIT_FADE_MS + EXIT_COLLAPSE_MS;

type Phase = "idle" | "leaving" | "collapsing";

/**
 * A dismissing row's exit, specified in design §7.3 (design audit OD8).
 *
 * THE CONSTRAINT IS THE LIST, not the row: a notification row is 56px of fixed
 * height inside a flex column, so deleting it in the same commit as the write
 * made every row below jump by 56px at once. The row is therefore RETAINED for
 * one bounded exit instead of removed at once: it fades and slides 8px over the
 * house's 120ms fast duration, then its height collapses over the 180ms base
 * duration, and only then is it taken out of the layout. Rows below move with
 * the collapse rather than teleporting - the FLIP effect the spec asks for,
 * without a second coordinate system.
 *
 * THE WRITE DOES NOT WAIT FOR THE ANIMATION. `onExited` only releases the row's
 * layout slot; the receipt/Undo path is already in flight, and a refused write
 * restores the row immediately (the parent clears `exiting`). A hidden tab may
 * never deliver `transitionend`, so a hard timer is the release as well as the
 * normal path - a row can never be retained forever by a missing CSS event.
 *
 * Reduced motion collapses the whole thing to an immediate removal: no fade,
 * no slide, no delayed height change, and no retained interactive row.
 */
export const NotificationRowExit: FC<{
	exiting: boolean;
	children: ReactNode;
	/** Release the retained row after the exit (or immediately under reduce). */
	onExited: () => void;
}> = ({ exiting, children, onExited }) => {
	const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
	const [phase, setPhase] = useState<Phase>("idle");
	const [retainedHeight, setRetainedHeight] = useState<number | null>(null);
	const rowRef = useRef<HTMLDivElement>(null);
	const wasExiting = useRef(false);

	useLayoutEffect(() => {
		if (exiting && !wasExiting.current) {
			wasExiting.current = true;
			if (reduceMotion) {
				onExited();
				return;
			}
			// Measure once, at the moment the exit starts: the row's fixed height is
			// the value the collapse interpolates away from.
			setRetainedHeight(rowRef.current?.getBoundingClientRect().height ?? 56);
			setPhase("leaving");
		} else if (!exiting && wasExiting.current) {
			wasExiting.current = false;
			setPhase("idle");
			setRetainedHeight(null);
		}
	}, [exiting, reduceMotion, onExited]);

	useEffect(() => {
		if (!exiting || reduceMotion || phase === "idle") return;
		if (phase === "leaving") {
			const timer = setTimeout(() => setPhase("collapsing"), EXIT_FADE_MS);
			return () => clearTimeout(timer);
		}
		const timer = setTimeout(onExited, EXIT_COLLAPSE_MS);
		return () => clearTimeout(timer);
	}, [exiting, phase, reduceMotion, onExited]);

	const style: CSSProperties = {
		height: phase === "collapsing" ? 0 : (retainedHeight ?? undefined),
		overflow: phase === "idle" ? undefined : "hidden",
		transition:
			phase === "idle" || reduceMotion
				? undefined
				: phase === "leaving"
					? `opacity ${EXIT_FADE_MS}ms var(--ease-out-quart), transform ${EXIT_FADE_MS}ms var(--ease-out-quart)`
					: `height ${EXIT_COLLAPSE_MS}ms var(--ease-out-quart), opacity ${EXIT_COLLAPSE_MS}ms var(--ease-out-quart)`,
		opacity: phase === "idle" ? undefined : 0,
		transform: phase === "leaving" ? "translateY(-8px)" : undefined,
		pointerEvents: phase === "idle" ? undefined : "none",
	};

	return (
		<div
			ref={rowRef}
			style={style}
			className={cn("shrink-0", phase !== "idle" && "motion-reduce:hidden")}
			aria-hidden={phase !== "idle" || undefined}
			{...(phase !== "idle" ? { inert: "" } : {})}
			data-notification-exit={phase === "idle" ? undefined : phase}
		>
			{children}
		</div>
	);
};

/** The bounded exit budget, exported for tests and stories. */
export const NOTIFICATION_EXIT_MS = EXIT_TOTAL_MS;
