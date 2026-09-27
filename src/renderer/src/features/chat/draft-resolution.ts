/**
 * The held sends NOBODY is looking at, resolved on the app's own clock.
 *
 * WHY THIS EXISTS (the operator's report, 2026-09-26: "drafts seem to be staying
 * in local-operator-ui after sending them"). A send whose outcome the client never
 * learned right - a deadline, a dropped connection - leaves a HELD CLAIM on its
 * draft row (`admissionAttempted`, no `pending`, `submittedText`), and the store's
 * answer to the claim is the server's own transcript: a read that NAMES the
 * request id proves the message landed, and `resolveHeldFromServer` ends the claim
 * from that proof. The reads that fed it, though, were the PANE's - a snapshot
 * frame or a history walk in `use-canonical-session`, both of which exist only
 * while the conversation is MOUNTED. So the claims that actually linger are
 * exactly the ones the reader has moved on from: six of the operator's, some
 * days old, each still listed in the sidebar as `Draft: …` and - once a launch
 * folded the orphaned in-flight record back into the composer
 * (`rehydrateInputRows`) - still one "New chat with <team>" away from replaying
 * a message that had already been sent.
 *
 * WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT. Once per launch, for every
 * unsettled claim that has a session to ask (`draft.sessionId`, or the session
 * named by a `send:<id>` key), it reads that session's history TAIL and hands the
 * ids to `resolveHeldFromServer` with `complete: false` - which is the
 * delivered-only half of the store's rule, and the load-bearing choice:
 *
 *  - a read that NAMES the id resolves the claim wherever the app is;
 *  - a read that does not is NOT allowed to conclude "undelivered" here. A
 *    held claim may be older than the tail page's window, and the store's
 *    "complete" is about the page's continuity rather than its reach, so silence
 *    would be a verdict this reader cannot actually stand behind. The claim
 *    stays held - retry material, by design - and the pane that reaches the
 *    conversation later can still conclude it with the read that IS the tail
 *    from its own walk. The manual clear (the sidebar's own rows) is the other
 *    door for a claim the reader simply wants gone.
 *
 * A delivered claim also gets the payload OUT of its composer rows, under both
 * identities the send touched (`draft:…`/`send:…` and the session it became):
 * that is the class the operator watched resurface, and the reconciliation is
 * the composer store's own (`reconcileDelivered`), so a box still holding
 * exactly the delivered message is emptied silently and a box edited since keeps
 * every word with the muted note.
 *
 * WHAT IT IS NOT: a poller. It runs once at launch (see the hook), it reads at
 * most `SWEEP_MAX_SESSIONS` sessions with bounded concurrency, and a session
 * whose read fails resolves nothing. A claim created while the app is open is
 * made in front of the reader - the pane that owns it is mounted, and the pane's
 * own reconciliation is already there - so the sweep exists for the ones the
 * reader walks away from, and a relaunch is the moment the app can settle them
 * without racing the pane that owns the send.
 */
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	type ChatDraft,
	composerIdentityFor,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import type { DesktopHistoryPage } from "../../../../shared/desktop-session-contract";

/** How many entries the sweep's own tail read asks for. */
const SWEEP_HISTORY_LIMIT = 100;
/** How many sessions one sweep may visit, however many claims exist. */
const SWEEP_MAX_SESSIONS = 16;
/** How many of those reads may be in flight at once. */
const SWEEP_CONCURRENCY = 3;

/** One unsettled claim, with the session a server read can answer it from. */
export type HeldSendClaim = {
	key: string;
	sessionId: string;
	/**
	 * When the press that made the claim was issued (`ChatDraft.submittedAt`), or 0
	 * when the row carries none (a claim persisted before the field, or one whose
	 * press never stamped).
	 *
	 * WHY THE CLAIM CARRIES IT (agent review round 1's R5, remediation): the sweep's
	 * `SWEEP_MAX_SESSIONS` cap makes ORDER a fairness question, and insertion order
	 * into the claims map is the drafts map's own - stable across launches - so a
	 * claims set larger than the cap leaves the same tail unvisited on every launch.
	 * The age is what can order them oldest-first; a zero is the OLDEST, which is
	 * the right direction for a row that has been lingering longest.
	 */
	submittedAt: number;
};

/** What one sweep did, for the tests and for anyone reading the log. */
export type HeldSendSweepOutcome = { visited: number; resolved: number };

/**
 * The claims a server read can settle: admission attempted, outcome unknown, and
 * a session in hand. A claim whose create never answered (`draft:<uuid>` with no
 * `sessionId`) has no server to ask and is deliberately not here - its retry
 * material is the reader's, and the sidebar row is its home.
 */
export function heldSendClaims(
	drafts: Record<string, ChatDraft>,
): HeldSendClaim[] {
	const claims: HeldSendClaim[] = [];
	for (const [key, draft] of Object.entries(drafts)) {
		if (draft.admissionAttempted !== true) continue;
		// An IN-FLIGHT attempt is not something a read should adjudicate; the
		// pane's own settle owns it.
		if (draft.pending === true) continue;
		if (draft.submittedText === undefined) continue;
		const sessionId =
			draft.sessionId ??
			(key.startsWith("send:") ? key.slice("send:".length) : undefined);
		if (!sessionId) continue;
		claims.push({ key, sessionId, submittedAt: draft.submittedAt ?? 0 });
	}
	return claims;
}

/** The claims, keyed by the session whose read answers them. */
export function heldSendClaimsBySession(
	drafts: Record<string, ChatDraft>,
): Map<string, string[]> {
	const bySession = new Map<string, string[]>();
	/*
	 * OLDEST CLAIM FIRST, so the sweep's cap cannot starve the tail (agent review
	 * round 1's R5). The queue the sweep builds is this map's insertion order, and
	 * before this it was the drafts map's order - stable across launches - so a
	 * claims set larger than `SWEEP_MAX_SESSIONS` left the same tail unvisited on
	 * every visit, while new claims kept arriving above it. Age orders the visit; a
	 * session with several claims takes its slot at its EARLIEST claim's age, which
	 * is the one that has been lingering longest.
	 *
	 * WHAT THIS DOES NOT FIX, said rather than implied: if a claims set larger than
	 * the cap consists entirely of claims that CANNOT resolve (a message that never
	 * landed), the 16 oldest are re-read every launch and the newer ones wait. That
	 * residual is the honest direction - a stuck claim is a row the reader sees and
	 * can discard by hand, while a fresh claim's own pane settles it - and the
	 * alternative (a persisted rotation cursor) is a store field this sweep does not
	 * yet need. The outcome's `visited`/`resolved` numbers say which shape a launch
	 * actually met.
	 */
	const ordered = heldSendClaims(drafts).sort(
		(a, b) => a.submittedAt - b.submittedAt,
	);
	for (const claim of ordered) {
		const keys = bySession.get(claim.sessionId);
		if (keys) keys.push(claim.key);
		else bySession.set(claim.sessionId, [claim.key]);
	}
	return bySession;
}

let sweepInFlight: Promise<HeldSendSweepOutcome> | null = null;

/**
 * Run one sweep. Coalesces: a second call while one is running answers with the
 * same promise rather than a second set of reads.
 */
export function resolveHeldSendsFromServer(): Promise<HeldSendSweepOutcome> {
	if (sweepInFlight) return sweepInFlight;
	sweepInFlight = sweep()
		.catch(
			/*
			 * Nothing above throws by design (each session swallows its own read
			 * failure); this is the belt for a synchronous surprise, because the
			 * sweep runs off the launch path and must never be the reason a boot
			 * reports a failure.
			 */
			() => ({ visited: 0, resolved: 0 }),
		)
		.finally(() => {
			sweepInFlight = null;
		});
	return sweepInFlight;
}

async function sweep(): Promise<HeldSendSweepOutcome> {
	const bySession = heldSendClaimsBySession(
		useCanonicalSessionsStore.getState().drafts,
	);
	const queue = [...bySession.keys()].slice(0, SWEEP_MAX_SESSIONS);
	let visited = 0;
	let resolved = 0;
	const worker = async () => {
		for (;;) {
			const sessionId = queue.shift();
			if (sessionId === undefined) return;
			visited += 1;
			resolved += await resolveSession(
				sessionId,
				bySession.get(sessionId) ?? [],
			);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(SWEEP_CONCURRENCY, queue.length) }, worker),
	);
	return { visited, resolved };
}

async function resolveSession(
	sessionId: string,
	keys: readonly string[],
): Promise<number> {
	let page: DesktopHistoryPage;
	try {
		page = await desktopResult<DesktopHistoryPage>({
			op: "sessions.history",
			sessionId,
			limit: SWEEP_HISTORY_LIMIT,
		});
	} catch {
		/*
		 * A session this process cannot read resolves nothing: the claim stays
		 * held, which is the retry-material-preserving direction, and the next
		 * launch tries again.
		 */
		return 0;
	}
	/*
	 * `complete: false`: only a DELIVERY conclusion is allowed off this read -
	 * see the module note for why silence from one tail page is not a
	 * "did not land" this reader can stand behind.
	 */
	useCanonicalSessionsStore.getState().resolveHeldFromServer(
		sessionId,
		page.entries.map((entry) => entry.id),
		false,
	);
	let resolved = 0;
	for (const key of keys) {
		const draft = useCanonicalSessionsStore.getState().drafts[key];
		const stillHeld =
			draft !== undefined &&
			draft.admissionAttempted === true &&
			draft.submittedText !== undefined;
		if (stillHeld) continue;
		resolved += 1;
		/*
		 * The claim ended, and off THIS read that means the message landed
		 * (`complete: false`). Take its payload out of the composer rows, under
		 * both identities the send touched - the draft/send key it was staged
		 * under and the session it became - with the composer store's own
		 * reconciliation, so the delivery semantics (silent clear / keep the
		 * edit with the note) are the same the pane path applies.
		 */
		for (const identity of [key, composerIdentityFor(key, sessionId)])
			useConversationInputStore.getState().reconcileDelivered(identity);
	}
	return resolved;
}
