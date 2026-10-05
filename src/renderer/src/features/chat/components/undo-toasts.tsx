/**
 * The undo offers, the archive refusal and the bulk read deferral, as ordinary
 * sonner toasts.
 *
 * WHY THE RAISE LIVES HERE, MOUNTED BY `main.tsx` BESIDE THE GLOBAL CONTAINER
 * (operator request, 2026-09-27; design D11's supersession in
 * `docs/design/sidebar-row-space.md` §10). These three messages used to be drawn
 * by an effect inside `chat-sidebar.tsx`, into the panel's own sonner lane. The
 * panel is not mounted for the app's whole life - it is the EXPANDED half of the
 * sidebar column (`sidebar-navigation.tsx` returns the 56px strip, without the
 * panel, when the column is collapsed) - while the acts that raise the messages
 * are reachable from OUTSIDE it:
 *
 *  - an archive from the chat pane's own header menu (`chat-content.tsx`,
 *    `archiveFromHeader`) or a typed `/archive` (`slash-dispatch.ts`) - both on
 *    the chat route, both available while the sidebar column is collapsed;
 *  - a discard from the send-failure notice's Clear (`chat-page.tsx`, the
 *    composer's own `onClear` -> `discardDraft`).
 *
 * In any of those states the old effect never ran, so the store's newest word
 * about the act - an offer with an Undo, or a refusal with a Retry - was drawn
 * nowhere until the panel remounted. That is the "these don't properly show up"
 * half of the operator's report, and it is a property of where the raise lived
 * rather than of the library: sonner is handed a message by whoever raises it,
 * and the messages now outlive every panel state because this component is
 * mounted for the app's whole life.
 *
 * THE MESSAGES, AND THE IDS THEY SHARE. The archive's offer and refusal are ONE
 * conversation under ONE stable id (`ARCHIVE_TOAST_ID`): the answer to a press
 * REPLACES the message that asked, in place, through sonner's own update path -
 * and nothing in either path dismisses a message it is about to replace, which
 * is the rule that keeps a create out of sonner's dismiss/unmount window (the
 * measured mechanism is beside the Retry action below; UX round 1's U3). The
 * discard's offer keeps its OWN id (`DRAFTS_UNDO_TOAST_ID`), and that is a
 * decision this change makes rather than inherits: the single id existed because
 * one lane held one message, and ordinary toasts stack, so a discard and an
 * archive can now stand side by side - each slot in the store is single, each
 * message retires on its own terms, and neither has to take the other off the
 * screen to be seen. Nothing stale comes of the pair: both sentences are true at
 * once (a conversation was archived AND some drafts were discarded), and each
 * Undo repairs its own act.
 *
 * LIFETIMES ARE SONNER'S (offer and discard eight seconds, refusal ten - the
 * numbers are `archive-undo.ts`'s, one home for both offers), rather than the
 * `Infinity` + panel-clock pair this replaces. The panel armed its own clocks
 * because sonner's life belonged to the entry rather than to the message, and a
 * re-assertion could leave a stale entry - but that made hover-pause impossible
 * (the library cannot pause a clock it does not run), and an ordinary toast's
 * life pauses while the reader holds it, which is the behaviour restored here.
 * The value is cleared when its message ENDS (see `settle` below) rather than
 * when a clock fires: auto-close, the close button, and the swipe all route
 * through the same two callbacks, so nothing re-draws later (U10's clause at the
 * other end of the life).
 *
 * WHAT WAS DELIBERATELY NOT KEPT. The lane's ceilings (15s for the archive
 * offer, 8s for the discard) are gone with the lane: their job was to bound a
 * subscription that nothing else could end, and the message's own end now tears
 * the watch down (its effect re-runs when the slot clears). Keeping a ceiling
 * would also end a message the reader is HOLDING, which is exactly what
 * hover-pause exists to allow - and for the archive offer the watch must outlive
 * a held message, because the state moving while the offer is held is precisely
 * when the offer must retire (`useArchiveUndoRetirement`).
 */

import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import {
	dismissToast,
	showInfoToast,
	showWarningToast,
} from "@shared/utils/toast-manager";
import { useEffect, useRef } from "react";
import {
	ARCHIVE_FAILURE_TOAST_MS,
	ARCHIVE_OFFERED_VERB,
	ARCHIVE_UNDO_TOAST_MS,
	archiveOfferedName,
	useArchiveUndoRetirement,
} from "../archive-undo";
import { DRAFTS_OFFERED_VERB, draftsOfferedName } from "../drafts-undo";
import { markAllReadDeferredSentence } from "../mark-all-read";

/**
 * One id for the archive's OFFER and its REFUSAL, so the newer one REPLACES the
 * one on screen rather than stacking under it.
 *
 * The design's rule is the spec's ("stable toast ids so a second archive replaces
 * the first", `docs/design/sidebar-row-space.md` §10), and the mechanism is the
 * store's single-value model read through sonner's update path: a create on a
 * mounted id updates the entry, and the update is also what keeps a refusal that
 * follows a refusal an UPDATE rather than a stack - the last answer to a press on
 * this conversation is the only one there is room for.
 */
export const ARCHIVE_TOAST_ID = "archive";

/**
 * The discard offer's own id. Separate from the archive's (see the header): the
 * two messages are about different acts and may stand together now that ordinary
 * toasts stack.
 */
export const DRAFTS_UNDO_TOAST_ID = "drafts-undo";

/**
 * The bulk read deferral's own id: a second press REPLACES the message rather
 * than stacking under it, because it is the same fact restated (the archive's
 * one-slot rule, on a message with no action to press).
 */
export const BULK_READ_DEFERRAL_TOAST_ID = "bulk-read-deferral";

/**
 * Its life: eight seconds, the offers' own span (`ARCHIVE_UNDO_TOAST_MS`): long
 * enough to read the sentence once, and sonner ends it on its own - with
 * hover-pause for a reader holding it.
 */
const BULK_READ_DEFERRAL_TOAST_MS = 8000;

/**
 * Raise the three messages, and take each one down when its value is gone.
 *
 * Renders nothing itself; `main.tsx` mounts it beside `ThemedToastContainer`, so
 * what the reader sees is the one global container (bottom-right) every other
 * toast in the app uses.
 */
export function UndoToasts() {
	const archiveFailure = useCanonicalSessionsStore(
		(state) => state.archiveFailure,
	);
	const archiveUndo = useCanonicalSessionsStore((state) => state.archiveUndo);
	const draftsUndo = useCanonicalSessionsStore((state) => state.draftsUndo);
	const bulkReadDeferral = useCanonicalSessionsStore(
		(state) => state.bulkReadDeferral,
	);
	const clearArchiveFailure = useCanonicalSessionsStore(
		(state) => state.clearArchiveFailure,
	);
	const setArchiveUndo = useCanonicalSessionsStore(
		(state) => state.setArchiveUndo,
	);
	const setSessionArchived = useCanonicalSessionsStore(
		(state) => state.setSessionArchived,
	);
	const restoreDraftsUndo = useCanonicalSessionsStore(
		(state) => state.restoreDraftsUndo,
	);
	/*
	 * THE OFFER'S OWN RETIREMENT WATCH (design round 8, D27). The offer is RAISED by
	 * the store - in the update that settles the write - and what stays with the
	 * offer's module is WHEN it stops being true: the subscription retires it when
	 * the conversation stops holding the state the offer was taken from, and only
	 * then (`archive-undo.ts`).
	 */
	useArchiveUndoRetirement();

	/*
	 * WHAT THIS COMPONENT LAST DREW, AND ITS STAMP: the clearing rule below needs
	 * BOTH - which message the reader was last looking at, and whether the one that
	 * replaces it outranks it - because clearing on the ordering alone removed a
	 * refusal while its own card was still up (the finish of the archive walk).
	 * `null` is also "no archive message is on screen", which is what lets the
	 * empty branch below know whether a dismissal is owed.
	 */
	const archiveDrawnRef = useRef<{
		kind: "offer" | "failure";
		at: number;
	} | null>(null);

	useEffect(() => {
		/*
		 * THE ONE DISMISSAL IS BOTH SLOTS GOING EMPTY, and the ref above is what makes
		 * that answerable: the effect asks whether it DREW a message, never what the
		 * store happens to hold, because a store value can outlive its own message
		 * (agent review round 1, R-1: gating the offer's retirement on
		 * `archiveFailure` let one refused archive disable retirement for the rest of
		 * a session).
		 *
		 * The dismissal is safe for the same reason the old one was: the two paths
		 * that DRAIN this id before it is replaced are now the two ends of a life -
		 * the state moving (retirement) or the write's answer clearing the slot - and
		 * neither can be followed by a create on this id within sonner's own unmount
		 * window by anything but a second archive pressed in that same sliver. The
		 * recorded hazard was the other order (a press dismissing its own message and
		 * its answer arriving 2-4ms later, UX round 1's U3), and presses no longer
		 * dismiss anything: their answer arrives as an update of the mounted entry.
		 */
		if (archiveFailure === null && archiveUndo === null) {
			if (archiveDrawnRef.current === null) return;
			archiveDrawnRef.current = null;
			dismissToast(ARCHIVE_TOAST_ID);
			return;
		}
		/*
		 * WHICH MESSAGE WINS IS DECIDED BY CURRENCY, NOT BY KIND (agent review round
		 * 3, R3-1 = UX round 3, U7). Both messages carry the stamp of the write that
		 * raised them (`ArchiveUndoOffer.at`, `ArchiveFailure.at`), the refusal
		 * advances the counter as it lands so it can never TIE with the offer it
		 * re-raises, and on a tie the refusal is the message that stands - a refusal
		 * is a fact about a press that was ANSWERED while an offer is a fact about a
		 * write (`canonical-sessions-store.ts` says so where it builds it).
		 */
		const newest: "offer" | "failure" =
			archiveFailure && archiveUndo
				? archiveUndo.at > archiveFailure.at
					? "offer"
					: "failure"
				: archiveFailure
					? "failure"
					: "offer";
		/*
		 * AND THE MESSAGE A NEWER ONE SUPERSEDED IS CLEARED ONLY WHEN THAT NEWER ONE
		 * WAS ACTUALLY DRAWN OVER IT, AND IS STRICTLY NEWER (the walk's finishing
		 * sequence proved what clearing on the ordering alone costs: the refusal for
		 * a press the reader had just made was removed from the store while its OWN
		 * CARD was still on screen, so the clock re-armed from what the store did
		 * hold and the Retry had nothing left to be). U10 is the other half: archive
		 * a second conversation while a refusal stands and the offer takes the card,
		 * press that offer's own Undo, and without this clause the surface went EMPTY
		 * and then re-printed the OLD refusal with a fresh clock (measured: empty at
		 * +450ms, the refusal back at +1.75s in the dark palette).
		 */
		const drawnAt =
			newest === "offer" ? (archiveUndo?.at ?? 0) : (archiveFailure?.at ?? 0);
		const drawnBefore = archiveDrawnRef.current;
		archiveDrawnRef.current = { kind: newest, at: drawnAt };
		if (
			drawnBefore !== null &&
			drawnBefore.kind !== newest &&
			drawnAt > drawnBefore.at
		) {
			if (newest === "failure") setArchiveUndo(null);
			else clearArchiveFailure();
		}
		/*
		 * THE MESSAGE'S END TAKES ITS VALUE WITH IT, guarded by the value's own
		 * identity so a retiree's callback cannot take a message that replaced it off
		 * the screen. Both callbacks sonner fires on an ending route here:
		 * `onAutoClose` for the timed end and `onDismiss` for the close button and
		 * the swipe. Programmatic dismissals (`dismissToast` above) fire neither -
		 * and need none, because that path only runs when the slot is already empty.
		 */
		const settle = (kind: "offer" | "failure", at: number) => () => {
			const state = useCanonicalSessionsStore.getState();
			if (kind === "offer") {
				if (state.archiveUndo?.at === at) state.setArchiveUndo(null);
			} else if (state.archiveFailure?.at === at) {
				state.clearArchiveFailure();
			}
			const drawn = archiveDrawnRef.current;
			if (drawn !== null && drawn.kind === kind && drawn.at === at)
				archiveDrawnRef.current = null;
		};
		if (newest === "failure" && archiveFailure) {
			showWarningToast(
				`Could not ${archiveFailure.archived ? "archive" : "unarchive"} “${archiveFailure.title}”.${archiveFailure.detail ? ` ${archiveFailure.detail}` : ""}`,
				{
					id: ARCHIVE_TOAST_ID,
					duration: ARCHIVE_FAILURE_TOAST_MS,
					onAutoClose: settle("failure", archiveFailure.at),
					onDismiss: settle("failure", archiveFailure.at),
					action: {
						label: "Retry",
						/*
						 * SONNER DISMISSES THE TOAST AFTER AN ACTION UNLESS THE HANDLER
						 * PREVENTS IT. 2.0.3's action button is `onClick(event); if
						 * (event.defaultPrevented) return;` and then the dismiss - and the
						 * dismissal below the guard is what UX report round 1, U3 is (the
						 * answer to this very press arrives in 2-4ms against a daemon on this
						 * machine, and a create that lands inside sonner's dismiss/unmount
						 * window - a `requestAnimationFrame` plus a 200ms delay - is merged
						 * into the entry being removed and destroyed with it: measured in the
						 * running app, `showWarningToast` called and no toast element ever
						 * mounted; in jsdom against the installed 2.0.3, painted at +50ms
						 * and gone by +600ms). So the handler prevents the library's
						 * dismissal and does its own write, and nothing takes this message
						 * down before its answer: the refusal stays UP while the retry is in
						 * flight - the last answer to a press on this conversation is still
						 * the honest thing to show - and the answer replaces it in place.
						 */
						onClick: (event) => {
							event.preventDefault();
							void setSessionArchived(
								archiveFailure.sessionId,
								archiveFailure.archived,
								archiveFailure.title,
							);
							/*
							 * ONE ACT, ONE REGISTER (UX round 1, U2): an accepted retry is
							 * the same act as the row's own press, so the store raises the
							 * same offer for it in the update that settles the write - the
							 * refusal is retired by the offer landing rather than by another
							 * write here.
							 */
						},
					},
				},
			);
			return;
		}
		if (archiveUndo) {
			showInfoToast(
				/*
				 * THE NAME FLEXES; THE VERB DOES NOT (agent review round 2, R2-3). The
				 * sentence is two elements because a single string that overflows loses
				 * its TAIL - which for `“<title>” archived.` is the verb, i.e. the half
				 * that says what happened. The name ellipsises inside its own box
				 * (`truncate`) and the verb is a fixed tail that always fits; the full
				 * name is one dwell away in the row's own flyout.
				 */
				<span className={cn("flex min-w-0 items-baseline gap-1")}>
					<span className={cn("min-w-0 truncate")}>
						{archiveOfferedName(archiveUndo.title)}
					</span>
					<span className={cn("shrink-0")}>{ARCHIVE_OFFERED_VERB}</span>
				</span>,
				{
					id: ARCHIVE_TOAST_ID,
					duration: ARCHIVE_UNDO_TOAST_MS,
					/*
					 * THE FLEX CHAIN HAS TO BE ABLE TO SHRINK TO THE CARD, and the class is how:
					 * sonner's `[data-content]` is a flex item whose automatic minimum size is
					 * its content's, so a long name inside a `nowrap` box refused to give, the
					 * card overran its own width and the Undo was pushed out of it (the lane's
					 * own stylesheet measured exactly that, and this is that rule carried as a
					 * utility). `min-w-0` on the content box is what lets the name - the only
					 * part meant to give - ellipsise.
					 */
					classNames: { content: "min-w-0" },
					onAutoClose: settle("offer", archiveUndo.at),
					onDismiss: settle("offer", archiveUndo.at),
					action: {
						label: "Undo",
						/*
						 * THE UNDO SENDS ITS WRITE AND NOTHING ELSE (agent review round 2,
						 * R2-1), the Retry's own rule one control over: a `dismissToast(id)`
						 * here would take this message down before the answer, and a refused
						 * unarchive (the conversation is live, or the transport failed) would
						 * raise its refusal on the id that was just dismissed - the
						 * destroy-inside-the-unmount-window pattern, on a refusal that is an
						 * ordinary outcome. NOTHING here or in the store retires the offer at
						 * the press: the retirement subscription skips a press whose fact is
						 * still unanswered, so the offer is held while its own write is out,
						 * and the ANSWER settles it - an accepted undo clears
						 * `archiveUndo` (both slots empty, which is the one dismissal with
						 * nothing to replace it) and a refused one replaces the offer in
						 * place with the refusal the store raises for this conversation.
						 */
						onClick: (event) => {
							event.preventDefault();
							void setSessionArchived(
								archiveUndo.sessionId,
								!archiveUndo.archived,
								archiveUndo.title,
							);
						},
					},
				},
			);
		}
	}, [
		archiveFailure,
		archiveUndo,
		setArchiveUndo,
		clearArchiveFailure,
		setSessionArchived,
	]);

	/*
	 * THE DISCARD OFFER, on its own id and its own effect: a second discard
	 * REPLACES the first (the store keeps ONE slot, `DraftsUndoOffer`), and the
	 * update restarts the entry's life at the offer's documented eight seconds. The
	 * empty branch is the offer's own end - the Undo press clears the slot - and
	 * dismisses what the slot no longer stands behind.
	 */
	const draftsDrawnRef = useRef(false);
	useEffect(() => {
		if (draftsUndo === null) {
			if (!draftsDrawnRef.current) return;
			draftsDrawnRef.current = false;
			dismissToast(DRAFTS_UNDO_TOAST_ID);
			return;
		}
		draftsDrawnRef.current = true;
		const settle = () => {
			const state = useCanonicalSessionsStore.getState();
			if (state.draftsUndo?.at !== draftsUndo.at) return;
			state.setDraftsUndo(null);
			draftsDrawnRef.current = false;
		};
		showInfoToast(
			<span className={cn("flex min-w-0 items-baseline gap-1")}>
				<span className={cn("min-w-0 truncate")}>
					{draftsOfferedName(draftsUndo.keys.length)}
				</span>
				<span className={cn("shrink-0")}>{DRAFTS_OFFERED_VERB}</span>
			</span>,
			{
				id: DRAFTS_UNDO_TOAST_ID,
				duration: ARCHIVE_UNDO_TOAST_MS,
				/* The offer's own shrink rule (`min-w-0` on the content box): the count is
				   short at every width, but the chain that lets a long NAME give is the chain,
				   and one shape keeps the two offers' cards identical. */
				classNames: { content: "min-w-0" },
				onAutoClose: settle,
				onDismiss: settle,
				action: {
					label: "Undo",
					onClick: (event) => {
						event.preventDefault();
						/*
						 * ONE WRITE, THEN THE LANE DRAWS WHATEVER IS LEFT: the store puts
						 * the snapshot back and clears `draftsUndo` in the same update, so
						 * the dismissal is the effect's own empty branch - the one
						 * dismissal with nothing to replace it. Unlike an archive undo
						 * there is no answer to wait for: the restore is local and
						 * immediate.
						 */
						restoreDraftsUndo();
						/*
						 * AND THE PANE GOES BACK TO WHAT CAME BACK (UX round 2's U7),
						 * where that is unambiguous: a ONE-key offer whose key the
						 * discard replaced with a freshly staged draft the pane still
						 * shows. The staged key is written by the panel's discard
						 * handlers (`setStagedByDiscard`; it moved into the store with
						 * this component, because the writer is the panel and the reader
						 * is this app-level surface), and it is compared against the
						 * CURRENT key here: a reader who has since opened something else
						 * is not moved, and the batch's offer - several subjects - leaves
						 * the pane where it was either way.
						 */
						const state = useCanonicalSessionsStore.getState();
						const staged = state.stagedByDiscard;
						state.setStagedByDiscard(null);
						if (draftsUndo.keys.length === 1 && staged !== null) {
							if (
								useCanonicalSessionsStore.getState().activeDraftKey === staged
							)
								useCanonicalSessionsStore
									.getState()
									.openDraft(draftsUndo.keys[0]);
						}
					},
				},
			},
		);
	}, [draftsUndo, restoreDraftsUndo]);

	/*
	 * THE BULK READ DEFERRAL (operator report, 2026-10-05; raised here since agent
	 * review round 2, B2 = QA round 2, Q3): the panel's own press cannot raise it -
	 * the archive guard's toast discipline bans a raiser in `chat-sidebar.tsx` - so
	 * the slot the panel writes is drawn here, on the app's always-mounted surface,
	 * exactly once. No action: the state is self-resolving (each mark clears when
	 * the owning device updates), so the message only has to be read once. The
	 * non-error register is the point - a deferral is not a failure.
	 */
	const bulkDeferralDrawnRef = useRef(false);
	useEffect(() => {
		if (bulkReadDeferral === null) {
			if (!bulkDeferralDrawnRef.current) return;
			bulkDeferralDrawnRef.current = false;
			dismissToast(BULK_READ_DEFERRAL_TOAST_ID);
			return;
		}
		bulkDeferralDrawnRef.current = true;
		const settle = () => {
			const state = useCanonicalSessionsStore.getState();
			if (state.bulkReadDeferral?.at !== bulkReadDeferral.at) return;
			state.clearBulkReadDeferral();
			bulkDeferralDrawnRef.current = false;
		};
		showInfoToast(markAllReadDeferredSentence(bulkReadDeferral.count), {
			id: BULK_READ_DEFERRAL_TOAST_ID,
			duration: BULK_READ_DEFERRAL_TOAST_MS,
			onAutoClose: settle,
			onDismiss: settle,
		});
	}, [bulkReadDeferral]);

	/*
	 * RENDERS NOTHING. Every message above is raised into the shared container
	 * `main.tsx` mounts; this component is the always-mounted place the raises and the
	 * stores' lifecycles meet, and the empty tree is what keeps it out of the layout.
	 */
	return null;
}
