import { FloatingAlert } from "@shared/components/common/floating-alert";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui";
import {
	UpdateType,
	useDeferredUpdatesStore,
} from "@shared/store/deferred-updates-store";
import { isDevelopmentMode } from "@shared/utils/env-utils";
import { updateMessageOf } from "@shared/utils/update-error-copy";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Component that shows a button to manually check for updates.
 *
 * This component only provides the button UI and triggers the update check process.
 * It also displays confirmation and error notifications for manual update checks.
 */
export const CheckForUpdatesButton = ({
	appVersion = null,
}: {
	/**
	 * The version NOW running, as the card's own "Application version" row reads it.
	 *
	 * WHY IT IS A PROP RATHER THAN THE RECORD'S `runningVersion` (design D1): the
	 * record's field is the version that was running when the failure was WRITTEN,
	 * and the retention rule compares its TARGET against the live `app.getVersion()`
	 * - so a record kept because its target is still ahead would print "Version
	 * 0.29.2 is running" two rows under a row reading 0.29.5. That is the same
	 * class of untrue statement this change exists to remove, in a narrower window.
	 * The live reading comes from the section that already holds it (`AppUpdatesSection`
	 * reads it for its own row), so one source answers both places and neither can
	 * print a version the other contradicts. Null while it is unknown: the sentence
	 * then names the target and claims nothing about what is running.
	 */
	appVersion?: string | null;
}) => {
	/** Where a user gets a copy that installs by hand. */
	const DOWNLOAD_PAGE = "https://local-operator.com/download";
	const [checking, setChecking] = useState(false);
	const [snackbarOpen, setSnackbarOpen] = useState(false);
	const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);
	/**
	 * A failed check, held as the raw message so the alert can map it.
	 *
	 * WHY IT IS NOT `snackbarMessage`: the copy for this box is the shared rule's
	 * (`updateErrorCopy`), and the box has to stay up until it is read and offer
	 * the retry the sentence names - a message that dismisses itself in six
	 * seconds, or that paints whatever string the producer happened to set, is the
	 * defect this change exists to remove (design D2/D3, UX U1/U3, UX U6). The
	 * unrelated confirmations below keep the plain snackbar.
	 */
	const [snackbarSeverity, setSnackbarSeverity] = useState<
		"success" | "info" | "warning" | "danger"
	>("info");
	const [manualUpdateInfo, setManualUpdateInfo] = useState<{
		message: string;
		command: string;
	} | null>(null);
	/**
	 * The last install that did not complete, read from disk.
	 *
	 * This is the home of the record the failure panel points at: the panel is
	 * delivered once per process and its dismissal used to be the end of it, so a
	 * user who clicked it away - the only control it offered - had lost which
	 * version failed and when (reviews U1, D3). Reading it here means the fact
	 * survives a dismiss, a restart, and the panel never being seen at all.
	 */
	const [lastAttempt, setLastAttempt] = useState<{
		targetVersion: string;
		runningVersion: string;
		startedAt: string | null;
		detectedAt: string;
		detail: string;
		attempts: number;
	} | null>(null);
	/*
	 * The version the sentence is allowed to name: the card's own live reading, trimmed
	 * to null when it is absent or empty - a blank value would otherwise print "Version
	 *  is running".
	 */
	const liveVersion = appVersion?.trim() ? appVersion.trim() : null;

	/**
	 * Whether the check in flight is one the user asked for.
	 *
	 * It gates only the event-driven messages now (the error listener and the
	 * server-channel dev-mode note). The affirmation does not need it: it is read
	 * from the verdict of this button's own await-ed check, which cannot be
	 * another check's broadcast arriving late.
	 */
	const manualCheckRef = useRef(false);

	/**
	 * Whether the message on screen right now is the whole-check affirmation.
	 *
	 * Q1 (QA round 1): the affirmation is a claim about the WHOLE installation at
	 * one moment, and nothing ever took it back. A check that earned it left the
	 * green sentence up for its six seconds regardless of what happened next, so
	 * the NEXT check - finding a server release to offer - put the offer panel and
	 * "The application and server are up to date" on screen together: the same
	 * contradiction as the reported defect, one step later. Reading the verdict's
	 * `affirmation` while never invalidating its predecessor is what makes this a
	 * lifetime question rather than a copy question, so the lifetime lives in a
	 * ref: it is read inside callbacks and subscriptions that must not be
	 * re-created when it changes, and it must be readable synchronously by the
	 * next check, which the check's own `seq` guard below depends on.
	 */
	const showingAffirmationRef = useRef(false);

	/**
	 * Which check this component is currently answering.
	 *
	 * A check's verdict is only allowed to paint if it is still the newest check
	 * by the time it resolves. `checking` disables the button, but a background
	 * check's offer can land while a manual one is in flight, and a slow first
	 * check can resolve after a second one has already run - and an older
	 * affirmation arriving last would reintroduce exactly the stale claim the
	 * invalidation above removes. Counting check STARTS is what makes "newest"
	 * an order rather than a guess, and the counter is compared, never reset, so
	 * an out-of-order resolve cannot be mistaken for the current one.
	 */
	const checkSeqRef = useRef(0);

	/**
	 * Whether an offer arrived AFTER the check in flight started.
	 *
	 * QA round 2 (O1) = review round 3 (R9): an offer raised while a manual check
	 * is in flight is remembered nowhere. `dismissAffirmation()` is called from the
	 * offer listeners, but the claim was already retired when this check started,
	 * so that call returns early and the offer leaves no trace - and this check's
	 * affirming verdict then paints the sentence over the panel that offer raised,
	 * which is the reported contradiction in miniature. The window is narrow (the
	 * two checks must disagree about the published version, i.e. a release lands
	 * between their registry reads) but it needs no button involvement at all: the
	 * periodic `{silent:true}` check overlaps the manual one by design.
	 *
	 * Cleared at the same moment `checkSeqRef` advances, so it always answers
	 * "since THIS check started" - the same monotonic ordering the seq guard
	 * establishes - rather than "at any time", which would make the sentence
	 * unearnable for the rest of the session once any background check had found
	 * an update. Read at the verdict, below.
	 */
	const offerSinceCheckStartRef = useRef(false);

	/**
	 * Show a message that is NOT the affirmation, retiring any affirmation first.
	 *
	 * Every message path goes through here or `showAffirmation` so the ref cannot
	 * drift from what is on screen: a message that merely replaced the text while
	 * leaving the ref true would let a later offer CLOSE an error toast it has
	 * nothing to do with.
	 */
	const showMessage = useCallback(
		(message: string, severity: "success" | "info" | "warning" | "danger") => {
			showingAffirmationRef.current = false;
			setSnackbarMessage(message);
			setSnackbarSeverity(severity);
			setSnackbarOpen(true);
		},
		[],
	);

	const showAffirmation = useCallback((message: string) => {
		showingAffirmationRef.current = true;
		setSnackbarMessage(message);
		setSnackbarSeverity("success");
		setSnackbarOpen(true);
	}, []);

	/**
	 * Take back a displayed affirmation.
	 *
	 * Called from three places that each make the claim false or unproven: the
	 * start of a new check (its result is not in yet), a check that did not earn
	 * the sentence, and an offer from either channel arriving outside the manual
	 * window. An offer is the strongest signal of the three - whatever a previous
	 * check concluded, there is now something to update - and it is the one the
	 * original defect turned into a contradiction.
	 *
	 * It clears ONLY the affirmation: an info or error message is not a statement
	 * about whether the installation is current, so an unrelated offer must not
	 * dismiss it.
	 */
	const dismissAffirmation = useCallback(() => {
		if (!showingAffirmationRef.current) return;
		showingAffirmationRef.current = false;
		setSnackbarOpen(false);
		setSnackbarMessage(null);
	}, []);

	// Access the deferred updates store to clear deferred updates when manually checking
	const { clearDeferredUpdate } = useDeferredUpdatesStore();

	useEffect(() => {
		// Listen for manual update required events and general update errors
		const removeUpdateErrorListener = window.api.updater.onUpdateError(
			(message: string) => {
				if (!manualCheckRef.current) return;

				if (message.includes("manually")) {
					// Legacy wording from a main process that named pip for every
					// unmanaged server. No command is offered: the app cannot tell which
					// installer owns an environment from a string it was handed, and
					// naming the wrong one is the defect this change exists to fix.
					setManualUpdateInfo({
						message:
							"The server is installed outside the app, so use the tool you installed it with - uv, pipx or pip.",
						command: "",
					});
					/*
					 * The affirmation's TEXT is retired here, not just its severity:
					 * this path leaves `snackbarOpen` true so the manual panel above can
					 * show, and a stored success message would then be re-rendered as a
					 * warning - the up-to-date sentence in warning ink.
					 */
					showingAffirmationRef.current = false;
					setSnackbarMessage(null);
					setSnackbarSeverity("warning");
					setSnackbarOpen(true);
				}
				/*
				 * AND NOTHING FOR AN ORDINARY FAILURE. This branch used to paint one here
				 * through the shared copy (review round 1, UX U6) while the app-level alert
				 * painted the same event - two boxes for one failure, which is QA round 3's
				 * Q-1. `UpdateNotification` owns it: it is mounted on every screen this
				 * button is, its alert is held until dismissed, it carries the retry, and
				 * `updateMessageFate` is what decides whether a message is shown at all
				 * (main's `shouldFilterUpdateError` having already declined the known
				 * non-failures), so this listener needs neither its own copy nor its own
				 * suppression list.
				 */
			},
		);

		/*
		 * Nothing subscribes to `update-not-available` or
		 * `backend-update-not-available` here any more, and that is the fix.
		 *
		 * Each of those events is a statement about ONE channel - "nothing newer
		 * in the app", "nothing newer on the server" - while this button only ever
		 * asks for the aggregate check. Turning either into the sentence the user
		 * reads is how a server update offer and "You are up to date" came to be
		 * rendered in the same turn, decided by whichever event the main process
		 * happened to emit last. The sentence now comes from the verdict of the
		 * button's own check below, which knows both channels. The events stay in
		 * the main process: `update-notification.tsx` still clears a stale offer or
		 * manual panel on them.
		 */
		const removeBackendUpdateDevModeListener =
			window.api.updater.onBackendUpdateDevMode((message) => {
				if (!manualCheckRef.current) return;
				showMessage(message, "info");
			});

		/*
		 * An offer from ANY channel retires the affirmation, whether the check that
		 * raised it was the user's or the periodic one. These events carry no
		 * "manual" marker and do not need one: `available` on either channel makes
		 * the whole-installation sentence false, which is the one thing that must
		 * never be on screen beside an offer. The periodic check is exactly how
		 * QA reproduced the second half of Q1 - a background `{silent:true}` server
		 * check emits `backend-update-available` with no button involved at all.
		 *
		 * They record the OFFER as well as retiring the sentence, because
		 * `dismissAffirmation()` alone cannot: an offer raised while a check is in
		 * flight finds the claim already retired and leaves no trace, which is the
		 * ordering review round 3 asked for (R9) and `offerSinceCheckStartRef`
		 * closes at the verdict.
		 *
		 * The three channels are listed separately because they are three events:
		 * a future fourth channel must add itself here rather than inherit a rule
		 * nobody stated.
		 */
		const offerArrived = () => {
			offerSinceCheckStartRef.current = true;
			dismissAffirmation();
		};
		const removeUpdateAvailableListener =
			window.api.updater.onUpdateAvailable(offerArrived);
		const removeNpxUpdateAvailableListener =
			window.api.updater.onUpdateNpxAvailable(offerArrived);
		const removeBackendUpdateAvailableListener =
			window.api.updater.onBackendUpdateAvailable(offerArrived);

		return () => {
			removeUpdateErrorListener();
			removeBackendUpdateDevModeListener();
			removeUpdateAvailableListener();
			removeNpxUpdateAvailableListener();
			removeBackendUpdateAvailableListener();
		};
	}, [dismissAffirmation, showMessage]);

	// The durable record of the last failed install: read on mount, and re-read
	// when this start turns out to have one.
	useEffect(() => {
		let cancelled = false;
		const load = () => {
			window.api.updater
				.getLastInstallAttempt()
				.then((record) => {
					if (!cancelled) setLastAttempt(record);
				})
				.catch(() => undefined);
		};
		load();
		const removeInstallFailed = window.api.updater.onUpdateInstallFailed(() =>
			load(),
		);
		return () => {
			cancelled = true;
			removeInstallFailed();
		};
	}, []);

	/**
	 * Check for updates, from this surface's own control.
	 *
	 * It reports nothing itself: a failure this check meets is emitted as
	 * `update-error` and painted by the app-level alert, which is the single owner of
	 * that box (QA round 3, Q-1). What is left here is the component's own state -
	 * the acknowledgement sentence and the panels about the server and the bundle.
	 */
	const checkForUpdates = async () => {
		if (isDevelopmentMode()) {
			showMessage(
				"Updates are not checked in development mode. This feature is only available in production builds.",
				"info",
			);
			return;
		}

		/*
		 * Claim this check's order BEFORE the await, and take the previous verdict
		 * back in the same breath: from here on, nothing the last check concluded is
		 * still known to be true. A check that earned the sentence and is followed
		 * by one that offers an update must not leave both on screen - which is the
		 * reported contradiction, reproduced one check later.
		 */
		const seq = ++checkSeqRef.current;
		/*
		 * A new check retires the previous verdict's sentence before it resolves: this
		 * is the reader asking again, so what the last check concluded is no longer
		 * what the app knows.
		 */
		dismissAffirmation();
		// This check's own window for offers opens here: anything raised from now
		// until its verdict lands is something this verdict may not paint over.
		offerSinceCheckStartRef.current = false;
		try {
			setChecking(true);
			manualCheckRef.current = true;

			// Clear any deferred updates to ensure we see all available updates
			clearDeferredUpdate(UpdateType.UI);
			clearDeferredUpdate(UpdateType.BACKEND);

			/*
			 * The affirmation, from the verdict of the check this button just ran.
			 *
			 * `affirmation` is non-null only when the WHOLE check positively proved
			 * both channels current, so a check that offered an update - or that
			 * could not find out about one - says nothing here. That is the property
			 * the events could not provide: each of them knew only its own channel.
			 *
			 * `manual: true` also lets the main process re-offer a release whose
			 * artifact failed verification: this is the check the refusal panels
			 * send the user here to make.
			 */
			const result = await window.api.updater.checkForAllUpdates({
				manual: true,
			});

			// A superseded check paints nothing, in either direction: the newer
			// check owns the screen, and its own outcome has already been applied.
			if (seq !== checkSeqRef.current) return;

			/*
			 * An affirmation is painted only when this check's own window saw no
			 * offer. `dismissAffirmation()` at the top of this function cannot cover
			 * that case: it is a no-op once the claim is already retired, so an offer
			 * that arrived mid-check would otherwise be forgotten and this verdict
			 * would put the sentence over its panel (review round 3, R9). The flag is
			 * per check, so a window with no offer still earns the sentence.
			 */
			if (result?.affirmation && !offerSinceCheckStartRef.current) {
				showAffirmation(result.affirmation);
			} else {
				/*
				 * A check that did not earn the sentence retires the one before it.
				 * It is redundant with the dismissal at the top of this function when
				 * the check ran once, and it is NOT redundant in the case that matters:
				 * the verdict is read through the same `seq` gate, so a check whose
				 * predecessor resolved late - after this check started and stopped - is
				 * the one case where the start-of-check dismissal could have been
				 * undone by an older verdict, and taking the affirmation back here
				 * closes it.
				 */
				dismissAffirmation();
			}

			// The UpdateNotification component handles the panels an available
			// update puts on screen; this component owns the manual check's own
			// confirmation and error messages.
		} catch (error) {
			if (seq !== checkSeqRef.current) return;
			/*
			 * LOGGED, NOT PAINTED, and deliberately: the main process emits
			 * `update-error` for every failure it reports, and the app-level alert is
			 * what a reader sees for it (QA round 3, Q-1). A second paint from the
			 * invoke's own rejection is the duplicate this round removes, and a failure
			 * main declined to report - the release-artifact family - must stay silent
			 * rather than be re-raised from here.
			 */
			console.warn(
				`Update check failed; the app-level alert owns the report: ${updateMessageOf(error)}`,
			);
		} finally {
			/*
			 * Only the newest check owns the button's busy state: a slow earlier one
			 * finishing late must not re-enable the control in the middle of the
			 * check the user can see running.
			 */
			if (seq === checkSeqRef.current) setChecking(false);
			// Reset manual check flag after a short delay to allow event handlers to fire
			setTimeout(() => {
				manualCheckRef.current = false;
			}, 2000);
		}
	};

	/**
	 * Handle snackbar close
	 *
	 * Dismissal by the user or by the timer is also the end of the claim: a later
	 * offer must not try to take back something nobody is showing.
	 */
	const handleSnackbarClose = () => {
		showingAffirmationRef.current = false;
		setSnackbarOpen(false);
		setSnackbarMessage(null);
	};

	return (
		<>
			{lastAttempt && (
				/*
				 * The record the failure panel points at, in the place a user would look
				 * for it. It states the version, how many attempts have failed, and when
				 * the last one was detected, with the machine detail in the app's own
				 * second voice - and the action that actually resolves a failing install.
				 */
				<div className="mb-3 rounded-sm bg-sunken p-3">
					<p className="text-body-sm text-ink">
						The last update to version {lastAttempt.targetVersion} didn't finish
						{lastAttempt.attempts > 1
							? ` (${lastAttempt.attempts} attempts)`
							: ""}
						.{/*
						 * THE LIVE READING, never the record's captured `runningVersion` (design D1):
						 * the record is kept precisely while its target is still ahead, so a machine
						 * that has since gained a version by any other route would be told a version
						 * that is not the one running - the sentence below the card's own row
						 * contradicting it. Unknown prints no clause rather than a stale one.
						 */}
						{liveVersion ? ` Version ${liveVersion} is running.` : null}
					</p>
					<p className="mt-1 text-meta text-ink-dim">
						Detected{" "}
						{lastAttempt.detectedAt
							? new Date(lastAttempt.detectedAt).toLocaleString()
							: "at an unknown time"}
						. {lastAttempt.detail}
					</p>
					<Button
						variant="outline"
						size="sm"
						className="mt-2"
						onClick={() => void window.api.openExternal(DOWNLOAD_PAGE)}
					>
						Download a fresh copy
					</Button>
				</div>
			)}
			<Button
				variant="outline"
				onClick={() => void checkForUpdates()}
				disabled={checking}
			>
				{/* Unlabelled: the button's own caption already says what is busy. */}
				{checking ? <Spinner size="sm" /> : null}
				{checking ? "Checking..." : "Check for updates"}
			</Button>

			{/* Manual update instructions */}
			{manualUpdateInfo && (
				<FloatingAlert
					open={snackbarOpen}
					autoHideDuration={10000}
					onClose={handleSnackbarClose}
					variant="warning"
				>
					<p className="text-body-sm">{manualUpdateInfo.message}</p>
					{manualUpdateInfo.command && (
						<code className="mt-2 block rounded-sm bg-sunken p-2 text-mono-sm text-ink">
							{manualUpdateInfo.command}
						</code>
					)}
				</FloatingAlert>
			)}

			{/* General info, success, or warning messages */}
			{snackbarMessage && snackbarSeverity !== "danger" && (
				<FloatingAlert
					open={snackbarOpen}
					autoHideDuration={6000}
					onClose={handleSnackbarClose}
					variant={snackbarSeverity}
				>
					{snackbarMessage}
				</FloatingAlert>
			)}

			{/*
			 * AND NO FAILURE ALERT HERE, which is the one-painter rule (QA round 3,
			 * Q-1/Q-2). This component used to render `UpdateErrorAlert` for a check it
			 * ran, while `UpdateNotification` - mounted at the app root - rendered one
			 * for the same `update-error` event: two boxes, one failure, each with its
			 * own Copy details and Try again inside the same 400x192 rect at the same
			 * z-index, and each clearing only itself. After a retry SUCCEEDED the reader
			 * could be left looking at a card that still said the app could not reach
			 * the update server. The app-level alert is the single owner now: it is
			 * mounted wherever this button is, it holds until dismissed, it carries the
			 * retry, and a successful check clears it. What stays here is this
			 * component's OWN surfaces - the by-hand panel, the install-blocked panel
			 * and the confirmation - because those are about the server and the bundle
			 * rather than about the check.
			 */}
		</>
	);
};
