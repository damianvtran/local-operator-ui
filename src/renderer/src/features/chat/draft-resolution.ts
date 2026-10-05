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
 * THE READ'S REACH IS NOW THE STORE'S OWN TEST rather than this module's private
 * rule (issue #847): `resolveHeldFromServer` draws "undelivered" only when the
 * page's oldest row is at or before the claim's own attempt time, so a shallow
 * page holds the claim for every caller. The `complete: false` this sweep passes
 * still says something the reach test does not - that a walked-back page is not
 * evidence of absence even when its window happens to be deep enough - and both
 * stay.
 *
 * AND IT WALKS FOR THE VERDICTS ALREADY WRITTEN (issue #847). The over-claiming
 * callers recorded `undelivered` for messages that had landed, and nothing
 * retracts one except a read that NAMES the id - which the tail page never will
 * for a message older than its window. So a draft carrying a stale verdict gets
 * a second, bounded question: walk BACK from the tail `HEAL_WALK_MAX_PAGES`
 * pages looking for the record the verdict names, and hand each page to the same
 * delivery rule. A page that names it is proof of delivery whatever its age;
 * a page that does not concludes nothing.
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
/**
 * How many OLDER pages the heal's walk may read, per session, looking for the
 * record a stale verdict names.
 *
 * WHY A BOUND AT ALL, and why this one: the walk is a launch-path read per stale
 * verdict, and the verdicts it exists for name a message the tail could not see -
 * typically a few pages back, not a hundred. Four pages is 400 rows behind the
 * tail, and a verdict whose record sits deeper than that keeps standing rather
 * than costing every launch an unbounded walk. The reader's own row is still
 * their statement of what happened, and the sidebar's manual clear is unaffected,
 * so the residual is a limit rather than a wrong answer.
 */
const HEAL_WALK_MAX_PAGES = 4;
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
export type HeldSendSweepOutcome = {
	visited: number;
	/** Claims the read answered (delivered, or provably not). */
	resolved: number;
	/** Stale `undelivered` verdicts a walk retracted (issue #847). */
	healed: number;
};

/**
 * The session a draft's claim can be answered FOR, or undefined when there is
 * none to ask.
 *
 * ONE COPY OF THE RULE, for the two queues below: a staged draft learns its
 * session id only when the create answers, while a send on an EXISTING
 * conversation is keyed `send:<sessionId>` and (before review round 2's R1)
 * carried no `sessionId` at all. Two copies of this expression would be two
 * opinions about WHICH server a claim is settled against.
 */
function claimedSessionFor(key: string, draft: ChatDraft): string | undefined {
	return (
		draft.sessionId ??
		(key.startsWith("send:") ? key.slice("send:".length) : undefined)
	);
}

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
		const sessionId = claimedSessionFor(key, draft);
		if (!sessionId) continue;
		claims.push({ key, sessionId, submittedAt: draft.submittedAt ?? 0 });
	}
	return claims;
}

/**
 * The STALE VERDICTS these reads can retract, keyed the same way the claims are
 * (issue #847).
 *
 * WHY THIS IS A SEPARATE SET. A draft already resolved `undelivered` has no
 * `submittedText` left - the resolution destructures it away - so the claim
 * queue above can never contain it, which is exactly why nothing has ever
 * retracted one on a machine that got a wrong verdict. Its session is the only
 * thing the walk needs, and the record id is what the walk looks for.
 */
function undeliveredRecordsBySession(
	drafts: Record<string, ChatDraft>,
): Map<string, string[]> {
	const bySession = new Map<string, string[]>();
	for (const [key, draft] of Object.entries(drafts)) {
		const recordId = draft.undelivered?.recordId;
		if (recordId === undefined) continue;
		const sessionId = claimedSessionFor(key, draft);
		if (!sessionId) continue;
		const records = bySession.get(sessionId);
		if (records) records.push(recordId);
		else bySession.set(sessionId, [recordId]);
	}
	return bySession;
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
			() => ({ visited: 0, resolved: 0, healed: 0 }),
		)
		.finally(() => {
			sweepInFlight = null;
		});
	return sweepInFlight;
}

async function sweep(): Promise<HeldSendSweepOutcome> {
	const drafts = useCanonicalSessionsStore.getState().drafts;
	const bySession = heldSendClaimsBySession(drafts);
	const stale = undeliveredRecordsBySession(drafts);
	/*
	 * ONE VISIT PER SESSION, for either reason. A session can be interesting for
	 * both - a claim still held, and an older verdict already written on another
	 * row - and a second read would be the same read twice. The claims' age order
	 * is preserved because it is the map these keys come from first; sessions
	 * interesting ONLY for a stale verdict follow it, which is the right order for
	 * them (a verdict already written is older than any claim still held).
	 */
	const queue = [...new Set([...bySession.keys(), ...stale.keys()])].slice(
		0,
		SWEEP_MAX_SESSIONS,
	);
	let visited = 0;
	let resolved = 0;
	let healed = 0;
	const worker = async () => {
		for (;;) {
			const sessionId = queue.shift();
			if (sessionId === undefined) return;
			visited += 1;
			const outcome = await resolveSession(
				sessionId,
				bySession.get(sessionId) ?? [],
				stale.get(sessionId) ?? [],
			);
			resolved += outcome.resolved;
			healed += outcome.healed;
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(SWEEP_CONCURRENCY, queue.length) }, worker),
	);
	return { visited, resolved, healed };
}

async function resolveSession(
	sessionId: string,
	keys: readonly string[],
	staleRecords: readonly string[],
): Promise<{ resolved: number; healed: number }> {
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
		return { resolved: 0, healed: 0 };
	}
	/*
	 * `complete: false`: only a DELIVERY conclusion is allowed off this read -
	 * see the module note for why silence from one tail page is not a
	 * "did not land" this reader can stand behind.
	 */
	useCanonicalSessionsStore
		.getState()
		.resolveHeldFromServer(sessionId, page.entries, false);
	const healed =
		staleRecords.length > 0
			? await healUndeliveredRecords(sessionId, page, staleRecords)
			: 0;
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
	return { resolved, healed };
}

/**
 * Walk BACK for the records a stale `undelivered` verdict names (issue #847).
 *
 * WHY A WALK AND NOT THE TAIL READ ABOVE. The verdicts that need retracting were
 * written by the over-claiming callers this change fixes, and they name a message
 * that is typically OLDER than any tail page - which is exactly why the shallow
 * page answered "did not land". So a tail read can never retract one, and nothing
 * else does either: the delivery rule retracts on a read that NAMES the id, and
 * the durable row the verdict is wrong about sits behind the window.
 *
 * SOUND, AND NO MORE THAN SOUND. `before_id` is the daemon's own backward cursor
 * (`sessions.history`; the renderer's request shape carries no `through_id` or
 * `around_id`, so a walk is the only way to name a buried row), and a page that
 * names the record is proof of delivery however old it is. Nothing is concluded
 * from a page that does not, because every page here travels with
 * `complete: false`. `has_more === false` is the journal's start - nothing
 * further back can hold the row - and the walk stops rather than spending its
 * budget on reads that cannot contain it.
 *
 * WHAT IT DOES NOT DO, said rather than implied: the walk is BOUNDED
 * (`HEAL_WALK_MAX_PAGES`), so a verdict whose record sits deeper than the budget
 * keeps standing. That is the honest direction - the row the reader sees is still
 * their statement of what happened, and the sidebar's manual clear is unaffected -
 * and these are reads the launch path pays for once, per stale verdict.
 */
async function healUndeliveredRecords(
	sessionId: string,
	tail: DesktopHistoryPage,
	recordIds: readonly string[],
): Promise<number> {
	const outstanding = new Set(recordIds);
	let cursor = tail.entries[0]?.id;
	for (let step = 0; step < HEAL_WALK_MAX_PAGES; step++) {
		if (outstanding.size === 0 || !cursor)
			return recordIds.length - outstanding.size;
		let older: DesktopHistoryPage;
		try {
			older = await desktopResult<DesktopHistoryPage>({
				op: "sessions.history",
				sessionId,
				limit: SWEEP_HISTORY_LIMIT,
				beforeId: cursor,
			});
		} catch {
			// A read that failed disproves nothing: the verdict stays.
			return recordIds.length - outstanding.size;
		}
		for (const entry of older.entries) outstanding.delete(entry.id);
		/*
		 * The same delivery rule the panes use, off the same kind of page: it
		 * retracts a verdict the page names and concludes nothing from a silence.
		 */
		useCanonicalSessionsStore
			.getState()
			.resolveHeldFromServer(sessionId, older.entries, false);
		if (!older.has_more || older.entries.length === 0)
			return recordIds.length - outstanding.size;
		cursor = older.entries[0]?.id;
	}
	return recordIds.length - outstanding.size;
}
