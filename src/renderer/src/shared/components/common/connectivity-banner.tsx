import {
	Alert,
	AlertDescription,
	type AlertProps,
	Button,
} from "@shared/components/ui";
import { useConnectivityStatus } from "@shared/hooks/use-connectivity-status";
import {
	msUntilOfflineReportable,
	noOfflineConfirmation,
	observeConnectivityReading,
} from "@shared/utils/offline-confirmation";
import { useEffect, useRef, useState } from "react";
import { serverBannerCopy } from "../../../../../shared/backend-status";

/**
 * Props for the ConnectivityBanner component
 */
type ConnectivityBannerProps = {
	/** Whether to automatically check connectivity on mount */
	autoCheck?: boolean;
};

/**
 * Component that displays a banner when there are connectivity issues
 */
export const ConnectivityBanner = ({
	autoCheck = true,
}: ConnectivityBannerProps) => {
	// Get connectivity status
	const {
		hostingProvider,
		shouldCheckInternet,
		/*
		 * The internet reading itself, not only the issue derived from it: the
		 * confirmation rule folds readings in, and a surface given only the derived
		 * boolean could not tell one sample from two.
		 */
		isOnline,
		hasConnectivityIssue,
		connectivityIssue,
		serverSnapshot,
		refetchServerStatus,
		refetchInternetStatus,
	} = useConnectivityStatus();

	// State to track if the internet connectivity banner has been dismissed
	const [internetBannerDismissed, setInternetBannerDismissed] = useState(false);
	/*
	 * The run of negative internet readings, and whether it has held long enough
	 * to be reported.
	 *
	 * WHY THE BANNER IS NO LONGER PAINTED STRAIGHT FROM THE READING. It used to
	 * be set true by a bare `window` `offline` event as well as by the poll, and
	 * Chromium fires that event on any connectivity TRANSITION while traffic is
	 * still flowing - so one sample of a signal that answers about the local
	 * interface, not the network, made the app claim a person's machine was
	 * disconnected. The rule now lives in `@shared/utils/offline-confirmation`:
	 * the first negative reading starts a grace, and only the same answer after
	 * it may be reported. A positive reading still clears it immediately.
	 */
	const offlineConfirmationRef = useRef(noOfflineConfirmation());
	const [internetOfflineReported, setInternetOfflineReported] = useState(false);
	// Reset dismissed state when connectivity status changes
	useEffect(() => {
		// If connectivity is restored or changes, reset the dismissed state
		if (!hasConnectivityIssue || connectivityIssue !== "internet_offline") {
			setInternetBannerDismissed(false);
		}
	}, [hasConnectivityIssue, connectivityIssue]);

	/*
	 * Also check navigator.onLine directly to start the confirmation immediately.
	 *
	 * This effect used to PAINT the banner from the event (`setShowBanner(true)`),
	 * and its `handleOnline` cleared the banner unconditionally - which hid a
	 * SERVER-offline banner until the next poll, because one boolean was asked
	 * to stand for two different claims. It now only advances the internet
	 * reading's own confirmation: the `offline` event reaches this component
	 * through the hook's listener as a negative reading, which starts the grace
	 * exactly as a poll that read offline would, and going online clears only
	 * what this effect owns. A server that has stopped is reported by the
	 * server's own state, untouched by anything here.
	 */
	useEffect(() => {
		const read = () =>
			observeConnectivityReading(offlineConfirmationRef.current, {
				isOnline: navigator.onLine,
				at: Date.now(),
			});

		const advance = () => {
			const decision = read();
			offlineConfirmationRef.current = decision.state;
			/*
			 * The READING's verdict, in both directions.
			 *
			 * This used to set the banner only when `decision.report` was true, so a
			 * positive reading reset the confirmation state and left the banner
			 * standing until the next poll happened to re-render it - the opposite of
			 * the module's own "a positive reading clears immediately" (review round
			 * 1, R7). A `false` here is the arm that takes the claim back.
			 */
			setInternetOfflineReported(decision.report);
		};

		window.addEventListener("offline", advance);
		window.addEventListener("online", advance);

		return () => {
			window.removeEventListener("offline", advance);
			window.removeEventListener("online", advance);
		};
	}, []);

	/*
	 * The poll's own readings, and the confirming re-read that follows the grace.
	 *
	 * `isOnline` is the hook's answer, which the offline/online events already
	 * feed (the hook listens for both), so the event path and the poll path obey
	 * one rule and neither can paint on its own.
	 */
	useEffect(() => {
		const decision = observeConnectivityReading(
			offlineConfirmationRef.current,
			{ isOnline, at: Date.now() },
		);
		offlineConfirmationRef.current = decision.state;
		setInternetOfflineReported(decision.report);
		// A positive reading is the answer, and a reported one needs no re-read.
		if (isOnline || decision.report) return undefined;

		/*
		 * ONE NEGATIVE READING IS NOT EVIDENCE: ask again once the grace has
		 * passed and require the same answer. The delay is the REMAINING grace
		 * rather than the whole of it, so a re-render that re-runs this effect
		 * shortens the wait instead of restarting it.
		 */
		const id = window.setTimeout(
			() => {
				void refetchInternetStatus().then((answer) => {
					const confirmed = observeConnectivityReading(
						offlineConfirmationRef.current,
						{ isOnline: answer.data !== false, at: Date.now() },
					);
					offlineConfirmationRef.current = confirmed.state;
					setInternetOfflineReported(confirmed.report);
				});
			},
			msUntilOfflineReportable(offlineConfirmationRef.current, Date.now()),
		);
		return () => window.clearTimeout(id);
	}, [isOnline, refetchInternetStatus]);

	// Auto-check server connectivity on mount if enabled
	useEffect(() => {
		if (autoCheck) {
			// Initial check
			refetchServerStatus();

			// Set up interval for continuous checking of server status
			const intervalId = setInterval(() => {
				refetchServerStatus();
			}, 3000); // Check every 3 seconds for faster detection

			// Clean up interval on unmount
			return () => clearInterval(intervalId);
		}

		return undefined;
	}, [autoCheck, refetchServerStatus]);

	// Handle retry button click
	const handleRetry = () => {
		/*
		 * Retry has to ASK MAIN TO TRY, not re-read main's answer.
		 *
		 * The snapshot is a report about what main already did, and re-discovery is
		 * main's own timer, so once the liveness signal moved to main a renderer
		 * that only re-read the snapshot rendered a control that could not cause
		 * anything - inert in the one state that offers it. Without a bridge
		 * (Storybook, a plain browser dev server) there is nothing to ask, and the
		 * refetch below is the whole of what a retry can do there.
		 */
		void (async () => {
			try {
				await window.api?.backend?.reconnect?.();
			} finally {
				refetchServerStatus();
				if (shouldCheckInternet) {
					refetchInternetStatus();
				}
			}
		})();
	};

	// Handle dismiss button click (only for internet connectivity issues)
	const handleDismiss = () => {
		setInternetBannerDismissed(true);
	};

	/*
	 * What the banner may say, decided rather than stored.
	 *
	 * The INTERNET claim waits for the confirmation above; the SERVER claim is
	 * untouched by anything in this file and still paints the moment main
	 * reports the daemon gone - a server that stopped is a fact, not a sample.
	 */
	const isInternetIssue = connectivityIssue === "internet_offline";
	const showBanner = isInternetIssue
		? internetOfflineReported && !internetBannerDismissed
		: hasConnectivityIssue;

	// If no connectivity issues or still loading, don't show anything
	if (!showBanner) {
		return null;
	}

	/*
	 * The server-side sentences come from the shared contract, not from this
	 * component: `detached`, `wedged` and the three paths into them each need a
	 * different sentence, and the one this banner used to render - "The server is
	 * offline" - asserted a transport fact for a connection state that three of
	 * those paths reach while a daemon is still running.
	 *
	 * A server issue the app is expected to recover from on its own is a WARNING
	 * rather than an alarm: "not connected, reconnecting" is not the same claim as
	 * "the server stopped", and the variant is the banner's own way of saying so.
	 */
	const serverIssue = isInternetIssue ? null : serverBannerCopy(serverSnapshot);
	const isTransientServerIssue = serverSnapshot?.reconnecting === true;
	/*
	 * A state the app is expected to recover from on its own is a warning, not an
	 * alarm: "not connected, reconnecting" is not the claim "the server stopped".
	 *
	 * `wedged` joins them because its own copy asserts the opposite of a failure -
	 * "A Local Operator server is running on this machine and this app is not
	 * attached to it" - and the two could not disagree more loudly than they did:
	 * measured in the `unattachable` frames, the band painted in the danger triple
	 * (`#2f1b19` against the warning wash `#2a2213`, rose icon against amber) while
	 * the sentence went to trouble to say nothing was wrong and nothing was started
	 * over a healthy daemon. `danger` stays for the paths that ARE failures - the
	 * server stopped, or a connection that is not coming back (design round 1, D6).
	 */
	const bannerVariant: AlertProps["variant"] =
		isInternetIssue ||
		isTransientServerIssue ||
		serverSnapshot?.state === "wedged"
			? "warning"
			: "danger";

	return (
		/*
		 * IN FLOW, as the shell's first child, rather than `fixed inset-x-0 top-0` (D9).
		 *
		 * The full-bleed styling is unchanged and is still the point: the banner spans
		 * the shell rather than sitting inside a page, so it is square-cornered and
		 * borderless on the left, right and top edges. What changed is the
		 * positioning, because a `fixed` band is painted OVER the layout: the rows it
		 * covered were absent rather than displaced, and the rows it covered were the
		 * pane's own first row and the top border of the sidebar search control
		 * (measured in `docs/evidence/band-occlusion/`). Its height follows its copy -
		 * 68 CSS px with main's second line, 53 with the title alone - so a
		 * reservation would have had to be measured from the band rather than chosen.
		 * In flow it takes that height out of the shell instead (`app.tsx` carries the
		 * rationale), and the z-index that existed only to clear the chrome it covered
		 * goes with the positioning it belonged to.
		 */
		<div className="w-full">
			<Alert
				variant={bannerVariant}
				// The banner appears in response to connectivity dropping while the
				// user is working, so it interrupts rather than waits to be found.
				role="alert"
				className="items-center rounded-none border-x-0 border-t-0"
			>
				<div className="flex w-full items-center justify-between gap-4">
					<div className="flex min-w-0 flex-col gap-1">
						<AlertDescription>
							{isInternetIssue
								? /*
									 * The provider name is interpolated only when there IS one. A
									 * config with no `hosting` value rendered "Your configured
									 * hosting provider () requires an internet connection" - an
									 * empty slot in the middle of a sentence, which QA saw in the
									 * real app rather than in a fixture (QA round 1, Q3) - and the
									 * sentence is about the machine's connection either way, so
									 * the clause is simply absent when it has nothing to name.
									 */
									`You are offline. ${hostingProvider ? `Your configured hosting provider (${hostingProvider}) requires` : "This app's updates require"} an internet connection.`
								: (serverIssue?.title ??
									"A connectivity issue has been detected.")}
						</AlertDescription>
						{/*
						 * Main's own sentence about what it observed, as a second line. The
						 * title says which KIND of state this is; this says which path into it
						 * was taken (a credential refused, a probe answered by another
						 * process, a spawn this app is not allowed to make), which is what
						 * makes the banner diagnosable rather than merely honest.
						 */}
						{!isInternetIssue && serverIssue?.detail ? (
							<AlertDescription>{serverIssue.detail}</AlertDescription>
						) : null}
					</div>

					<div className="flex shrink-0 items-center gap-2">
						<Button variant="ghost" size="sm" onClick={handleRetry}>
							Retry
						</Button>
						{isInternetIssue && (
							<Button
								variant="ghost"
								size="sm"
								aria-label="dismiss"
								onClick={handleDismiss}
							>
								Dismiss
							</Button>
						)}
					</div>
				</div>
			</Alert>
		</div>
	);
};
