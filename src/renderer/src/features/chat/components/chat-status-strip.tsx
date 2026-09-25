import { Button } from "@shared/components/ui";
import { useConnectivityStatus } from "@shared/hooks/use-connectivity-status";
import { cn } from "@shared/lib/utils";
import {
	type OfflineConfirmation,
	noOfflineConfirmation,
	observeConnectivityReading,
} from "@shared/utils/offline-confirmation";
import { AlertTriangle, Loader2, WifiOff, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatStatusDisplay } from "../chat-status";
import { chatStatusDisplay, chatStatusKey } from "../chat-status";

/**
 * THE CHAT PANE'S ONE CONNECTION SURFACE (chat redesign §F2, design round 1 D3).
 *
 * It replaces the two bands that used to mount in the shell root - a connectivity
 * band and a compatibility band stacked ABOVE the window, over the sidebar rail
 * and under the traffic lights, each stating its own version of a lost daemon.
 * §F2's contract, and what each part of this file is for:
 *
 * - INSIDE the conversation pane and under the top row, so it can never span the
 *   sidebar or sit above the window controls;
 * - ONE message per root cause, chosen by `chat-status.ts` (the table is a module
 *   so it can be tested without rendering this);
 * - ONE Retry, the same word everywhere, calling the app's existing
 *   `window.api.backend.reconnect()` - the same IPC both bands' Retry already
 *   called - and reporting its outcome IN the strip rather than silently doing
 *   nothing, which was U7's report ("clicked Retry, nothing changed, no spinner");
 * - dismissible to a 24px pill that re-expands, keyed on the state the reader
 *   dismissed so a new root cause is never muted by an old press;
 * - ONE live region: `role=alert` for the two states that interrupt a send,
 *   `role=status` for the two that leave a working app.
 *
 * PRESENTATION IS SPLIT FROM THE READINGS, for one reason and it is the same
 * reason the two bands this replaces were stories: four of the states this
 * surface exists for (unreachable, a refused credential, a degraded server, a
 * dismissed strip) are conditions of a running daemon, so a frame cannot arrange
 * them through the hook. `ChatStatusStripView` takes them as props, which makes
 * each state a Storybook story the rig can photograph (§N).
 */

export type ChatStatusStripViewProps = {
	display: ChatStatusDisplay | null;
	dismissedKey: string | null;
	onDismiss: (key: string) => void;
	onShow: () => void;
	retrying?: boolean;
	outcome?: string | null;
	onRetry?: () => void;
};

export const ChatStatusStripView = ({
	display,
	dismissedKey,
	onDismiss,
	onShow,
	retrying = false,
	outcome = null,
	onRetry,
}: ChatStatusStripViewProps) => {
	const key = chatStatusKey(display);
	const collapsed = key !== null && dismissedKey === key;

	/*
	 * The strip is the pane's own live region, so Escape while it holds focus
	 * dismisses it - §F2's ladder puts the strip below menus and the question card -
	 * and this listener is scoped to the strip's own subtree rather than to the
	 * window, so it can never take Escape from a running turn.
	 */
	const onKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			if (event.key !== "Escape" || !key) return;
			event.stopPropagation();
			onDismiss(key);
		},
		[key, onDismiss],
	);

	if (!display) return null;

	if (collapsed) {
		return (
			<div className={cn("flex items-center px-6 py-1")} data-lo-status-pill="">
				<button
					type="button"
					onClick={onShow}
					className={cn(
						"flex h-6 items-center gap-1.5 rounded-sm px-2",
						"text-meta text-ink-muted hover:text-ink",
						"focus-visible:outline-2 focus-visible:outline-accent",
					)}
					/*
					 * THE PILL ANNOUNCES WHAT THE STRIP WAS SAYING, NOT THE PRE-RETRY HALF OF IT
					 * (UX round 1's U12). The name carried `display.title` alone, so a reader who
					 * dismissed a strip whose second line was Retry's own outcome heard a sentence
					 * that had been superseded on screen by the press before it was dismissed -
					 * the outcome is the NEWEST fact about the same root cause, and it is the half
					 * that answers "did that button do anything". Both lines are in the name now,
					 * in the order the strip draws them, so collapsing cannot lose one.
					 */
					aria-label={`Connection status: ${display.title}${
						outcome ? ` ${outcome}` : ""
					} Show details`}
				>
					<span
						aria-hidden="true"
						className={cn(
							"size-1.5 rounded-full",
							display.dot === "danger" ? "bg-danger" : "bg-warning",
						)}
					/>
					{display.kind === "internet-offline" ? "Offline" : "Connection"}
				</button>
			</div>
		);
	}

	return (
		/*
		 * `px-6` puts the strip on the column's own gutter rather than on the pane's
		 * edge: it is a block of the conversation, and the conversation's measure
		 * starts 24px in. `py-1` is the 4px tier - the strip is a line of text with an
		 * action, not a card, and the two-line case (message plus Retry's outcome) is
		 * what the second line is for.
		 */
		<div
			className={cn("shrink-0 px-6 py-1")}
			data-lo-status-strip=""
			onKeyDown={onKeyDown}
		>
			<div
				role={display.role}
				className={cn(
					"flex items-center gap-2 rounded-md px-3 py-2",
					display.wash === "danger-wash" ? "bg-danger-wash" : "bg-warning-wash",
				)}
			>
				{display.dot === "danger" ? (
					<AlertTriangle aria-hidden="true" className="size-3.5 text-danger" />
				) : (
					<WifiOff aria-hidden="true" className="size-3.5 text-warning" />
				)}
				<span className="min-w-0 text-body-sm text-ink">
					{display.title}
					{display.detail ? (
						<span className="block text-meta text-ink-muted">
							{display.detail}
						</span>
					) : null}
					{outcome && !retrying ? (
						<span className="block text-meta text-ink-muted">{outcome}</span>
					) : null}
				</span>
				{display.action === "retry" && (
					<span className="ml-auto flex shrink-0 items-center gap-2">
						<Button
							variant="secondary"
							size="sm"
							type="button"
							onClick={onRetry}
							disabled={retrying}
							className="border-control font-medium"
						>
							{retrying ? (
								<Loader2 aria-hidden="true" className="animate-spin" />
							) : null}
							{retrying ? "Retrying…" : (display.actionLabel ?? "Retry")}
						</Button>
						<button
							type="button"
							onClick={() => key && onDismiss(key)}
							className={cn(
								"flex size-6 items-center justify-center rounded-sm",
								"text-ink-muted hover:text-ink",
								"focus-visible:outline-2 focus-visible:outline-accent",
							)}
							aria-label="Dismiss"
						>
							<X aria-hidden="true" className="size-3.5" />
						</button>
					</span>
				)}
			</div>
		</div>
	);
};

/**
 * The container: the app's readings in, the presentation out.
 *
 * It owns the three things that need the running app - the connectivity hook, the
 * confirmation of an offline reading, and the Retry that calls the app's own
 * reconnect IPC - and nothing about how the strip looks.
 */
export const ChatStatusStrip = () => {
	const { connectivityIssue, serverSnapshot, refetchServerStatus } =
		useConnectivityStatus();

	/*
	 * The internet reading is CONFIRMED before it paints, through the app's own
	 * debounce helper. A single `navigator.onLine === false` sample is a routine
	 * event on a laptop that just woke up, and a strip that appears and vanishes
	 * with it is noise; `observeConnectivityReading` is the rule the old banner
	 * used, so the new surface cannot be more trigger-happy than the one it
	 * replaces.
	 */
	const [internetOffline, setInternetOffline] = useState(false);
	const confirmationRef = useRef<OfflineConfirmation>(noOfflineConfirmation());

	useEffect(() => {
		const advance = () =>
			setInternetOffline(
				observeConnectivityReading(confirmationRef.current, {
					isOnline: navigator.onLine,
					at: Date.now(),
				}).report,
			);
		advance();
		window.addEventListener("offline", advance);
		window.addEventListener("online", advance);
		return () => {
			window.removeEventListener("offline", advance);
			window.removeEventListener("online", advance);
		};
	}, []);

	/*
	 * The hook types the reading as a plain string; the vocabulary is
	 * `backend-status.ts`'s two causes, so it is narrowed HERE rather than at every
	 * read, and an unrecognised value draws nothing rather than being coerced into
	 * one of the two.
	 */
	const cause =
		connectivityIssue === "server_offline" ||
		connectivityIssue === "internet_offline"
			? connectivityIssue
			: null;

	const display = useMemo(
		() =>
			chatStatusDisplay({
				connectivityIssue: cause,
				server: serverSnapshot,
				internetOffline,
			}),
		[cause, serverSnapshot, internetOffline],
	);

	/*
	 * DISMISSAL IS KEYED, not boolean. The reader dismissed a STATE; when the state
	 * changes - a different root cause, or the same one with a different path into
	 * it - the strip is owed to them again. See `chatStatusKey`.
	 */
	const [dismissedKey, setDismissedKey] = useState<string | null>(null);

	const [retrying, setRetrying] = useState(false);
	const [outcome, setOutcome] = useState<string | null>(null);
	/*
	 * THE OUTCOME BELONGS TO THE STATE IT WAS REPORTED AGAINST, and it is dropped with
	 * it (UX round 1's U5, and the stale-caption half of U12). `retry` sets this on
	 * every return, including the one where the app came back - and nothing ever cleared
	 * it - so a state the reader reached LATER inherited a sentence about an earlier
	 * condition and drew it under a root cause it does not describe, which is §F2's "two
	 * root causes at once" reached by staleness rather than by composition. The press
	 * records the key it was made against and the sentence is retired when the key moves:
	 * the same key means the same fact, including its path into it, so a retry that
	 * changed nothing keeps its answer, and a retry that changed something loses a
	 * sentence that is no longer about anything on screen.
	 */
	const outcomeKeyRef = useRef<string | null>(null);
	const key = chatStatusKey(display);
	useEffect(() => {
		if (outcome === null) return;
		if (outcomeKeyRef.current === key) return;
		outcomeKeyRef.current = null;
		setOutcome(null);
	}, [key, outcome]);
	const retry = useCallback(async () => {
		setRetrying(true);
		setOutcome(null);
		outcomeKeyRef.current = key;
		try {
			await window.api?.backend?.reconnect?.();
		} finally {
			setRetrying(false);
			/*
			 * ITS OUTCOME IS IN THE STRIP (U7: "clicked Retry, nothing changed, no
			 * spinner"). What this can honestly claim is bounded by what the app knows
			 * when the call returns: the strip's own state is re-read by the hook, so a
			 * successful reconnect clears the strip by itself, and reaching this line
			 * means the reason the reader pressed the button was still there a moment
			 * later. So the sentence names the state rather than a countdown nobody
			 * measured.
			 */
			setOutcome("Still unreachable.");
			void refetchServerStatus();
		}
	}, [key, refetchServerStatus]);

	return (
		<ChatStatusStripView
			display={display}
			dismissedKey={dismissedKey}
			onDismiss={setDismissedKey}
			onShow={() => setDismissedKey(null)}
			retrying={retrying}
			outcome={outcome}
			onRetry={() => void retry()}
		/>
	);
};
