/**
 * When the chat sidebar may render its catalogue, and when what it is rendering
 * is a picture of the past.
 *
 * WHY this is a module of its own rather than three lines inside the component.
 * The list is one gate for three surfaces - agents, teams and chats - and the
 * gate is the conjunction of two facts main publishes (the desktop plane is
 * available AND the backend advertises `session_catalogue`), so "the list
 * disappeared" is a bug about four boolean inputs, plus the three the sentence
 * depends on. Extracting the decision - and the sentence with it - is what lets a
 * test drive those inputs directly instead of asserting against the component's
 * source text; `clear-search.ts` next door is extracted for the same reason.
 *
 * THE OPERATOR'S REPORT this answers: "sometimes all the active chats and teams
 * in the UI disappear and it needs a refresh; it happens after a while of use,
 * maybe under load; after sitting a while they come back on their own."
 *
 * The mechanism, measured in the shipped code: `ready` needs `desktop_available`
 * AND `session_catalogue`, and `capabilities` SUCCEEDS with either missing - a
 * daemon this app holds no token for answers `desktop_available: false`, and a
 * backend that predates the route answers without the feature key. So the gate
 * can close while `capabilities.error` stays null. The previous decision keyed
 * the stale treatment on that error alone, so `stale` went false, `showList`
 * went false, and every block below unmounted together - chats, agents and
 * teams - with no `role="alert"` and nothing left but the "Update the backend"
 * sentence, whose remedy is only true for the version half of the problem.
 * Nothing refetched the gate either (`staleTime: 60_000`, `retry: false`, no
 * interval), which is why only a focus or an unrelated invalidation brought it
 * back - the "needs a refresh, and later it comes back by itself" shape of the
 * report exactly.
 *
 * A WITHDRAWN gate is therefore treated like a FAILED one, which is the
 * treatment already in the component for an error: keep the structure and the
 * last-known rows mounted, mark them stale, and say what happened. What differs
 * is where recovery comes from - a failed query is React Query's to retry, a
 * withdrawn gate is main's re-negotiation to finish - and the re-negotiation in
 * `useDesktopCapabilities` is what makes that bounded rather than dependent on
 * the operator touching the window.
 */

import type { DesktopFeatureState } from "@shared/api/local-operator/desktop-hooks";
import type { DaemonPairingCause } from "../../../../shared/backend-status";
/*
 * The sentence table is imported by RELATIVE path, not by the `@shared` alias.
 *
 * This module is bundled on its own by `scripts/sidebar-catalogue-gate.test.mjs`
 * with a hand-written alias list, and an alias it does not carry is an unresolved
 * import rather than a second opinion - measured: the alias form failed that
 * harness's build outright, while the relative path is the one the type import
 * above already uses.
 */
import { backendPairingSentence } from "../../shared/api/local-operator/backend-error";

export type CatalogueGateInput = {
	/**
	 * WHICH condition closed the catalogue, not only whether it did.
	 *
	 * The tri-state, because `ready` alone could not select a sentence: the gate is
	 * the conjunction of the desktop plane being available AND the backend
	 * advertising `session_catalogue`, and the two halves need two different
	 * sentences with two different remedies (design § 4).
	 */
	state: DesktopFeatureState;
	/**
	 * Main's own pairing cause, or null when this app is paired.
	 *
	 * The sentence for an `unpaired` state is selected from the cause, and it is the
	 * SAME table the banner and the chat pane read, so the list and the pane cannot
	 * describe one condition two ways (design § 11.1).
	 */
	cause?: DaemonPairingCause | null;
	/** `capabilities.error` is non-null: the query itself failed. */
	failed: boolean;
	/** `capabilities.data` is present: an answer exists, success or stale. */
	answered: boolean;
	/** Whether the gate has been open at any point in this mount. */
	wasReady: boolean;
	/** Rows the canonical store holds RIGHT NOW. */
	rows: number;
	/** `sessions.error` is set: the store's own read failed. */
	storeFailed: boolean;
	/**
	 * Whether the answer advertises the desktop plane at all (`desktop_available`).
	 *
	 * The one input that changes the SENTENCE rather than the decision: a plane that
	 * is available and merely missing the catalogue is a backend to update, while a
	 * plane that is not available is this app not being able to use the backend's
	 * desktop controls at all.
	 */
	/**
	 * Whether a statement about this same condition is ALREADY on screen, in a
	 * stronger register than this one.
	 *
	 * `BackendCompatibilityBanner` renders full-bleed at the top of the window on
	 * the same capabilities answer this gate reads, so a withdrawn gate that is
	 * covered by it must not add a second warning - and, in the frames that carry
	 * both, the two offered identically-labelled `Retry` controls whose remedies
	 * disagreed ("restart the app" against a self-recovery the app performs
	 * itself). One statement per condition is this file's own rule for the feed
	 * line below (D9); this is the same rule applied to the banner rather than to
	 * the store's alert. Design round 1, D3; review round 2, MINOR-2; QA round 1,
	 * Q-5.
	 */
	coveredByCompatibilityBanner: boolean;
};

export type CatalogueGate = {
	/** The gate was open, and a fresh answer has closed it. */
	withdrawn: boolean;
	/** What is rendered must read as last-known rather than current. */
	stale: boolean;
	/** Whether the catalogue blocks (agents, teams, chats) are mounted. */
	showList: boolean;
	/**
	 * Whether "showing the last chats and teams that loaded" is a TRUE sentence.
	 *
	 * It is a statement about the rows on screen, so it is a read of the store
	 * rather than a read of the gate: a stale render over a store that genuinely
	 * emptied must still read as empty, and claiming last-known rows over an empty
	 * list would be the same class of mistake as calling a serving daemon offline.
	 */
	lastKnownRows: boolean;
	/**
	 * The sentence the sidebar owes the operator for a withdrawn gate, or null.
	 *
	 * It lives here rather than in the component's JSX because it is a DECISION
	 * about three inputs - which half of the gate closed, whether the store's own
	 * read has already failed, and whether there are last-known rows to speak for -
	 * and a decision in a JSX condition is one no test can reach. Two review rounds
	 * found the same class here: the sentence promising a remedy the fact did not
	 * support (round 1, F-3), and the warning stacking on the store's danger alert
	 * about the same backend (round 2, MINOR-2 / QA round 1, Q-5).
	 */
	notice: string | null;
};

export function catalogueGate({
	state,
	cause = null,
	failed,
	answered,
	wasReady,
	rows,
	storeFailed,
	coveredByCompatibilityBanner,
}: CatalogueGateInput): CatalogueGate {
	const ready = state === "enabled";
	const withdrawn = answered && !failed && !ready;
	/*
	 * The memory of a gate that was open, and why it is not the component's ref.
	 *
	 * `wasReady` is a `useRef`, so it dies with the mount; the rows it is talking
	 * about live in a module store and survive. A remount during a withdrawal -
	 * navigate away and back while the plane is unavailable - would therefore hide
	 * rows the app still holds until the re-negotiation reopens the gate (review
	 * round 2, MINOR-3). `rows > 0` is the same fact held where a remount cannot lose
	 * it, and it is sound rather than merely convenient: `sessions` is NOT persisted
	 * (`canonical-sessions-store.ts`'s `partialize` carries drafts, `cwd` and the
	 * active id), so a row is one this session's own store took from a
	 * `sessions.list` that answered.
	 *
	 * WHAT IT DOES NOT CLAIM (review round 3, NIT-1). It is not true that every row
	 * arrived through an open gate: `browser-hand-over-dialog.tsx` calls the store's
	 * `fetchSessions` when its dialog opens, with no gate in front of it, so a row
	 * can exist while this gate has never been ready. That does not weaken the
	 * soundness argument above - the row is still a row the store holds and the list
	 * may keep showing it - it just means `rows > 0` is evidence of "the store has
	 * something to show", not of "the gate was open once".
	 */
	const memo = wasReady || rows > 0;
	const stale = memo && (failed || withdrawn);
	const lastKnownRows = stale && rows > 0;
	return {
		withdrawn,
		stale,
		showList: ready || stale,
		lastKnownRows,
		/*
		 * ONE sentence, selected from the SHARED table by the cause.
		 *
		 * Review round 3 removed a second arm here, and this is not that arm restored.
		 * That one authored its own words for "the plane is unavailable" beside the
		 * banner's, so the two offered differently-labelled versions of one condition;
		 * this one selects from `backendPairingSentence`, the same table the banner and
		 * the chat pane read, so there is nothing here to drift. It is suppressed under
		 * the banner exactly as before because the banner is the stronger register for
		 * the same condition.
		 *
		 * The state may be `unpaired` for a PAIRING cause or `below-version` for a
		 * genuine gap, and the gate is the one surface that can be asked either: the
		 * gate is the CONJUNCTION of the plane being available and the backend
		 * advertising `session_catalogue`, so a boolean could not tell them apart and
		 * the sentence here could only ever be the version one - the same collapse the
		 * chat pane made, fixed in the same place (design § 1.3, § 4).
		 */
		notice:
			withdrawn && !storeFailed && !coveredByCompatibilityBanner
				? (backendPairingSentence(state, cause) ??
					`Update the backend to use canonical chats. Existing histories are unchanged.${lastKnownRows ? " Showing the last chats and teams that loaded." : ""}`)
				: null,
	};
}
