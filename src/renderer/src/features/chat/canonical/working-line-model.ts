/**
 * What the one aggregate working line says, and which phase it is timing.
 *
 * Extracted from `canonical-transcript.tsx`'s memo so the derivation can be
 * exercised directly (`scripts/tool-row.test.mjs` bundles this module), because
 * the branch this file gained is the first one that is NOT read off a frame the
 * backend sent, and a rule about when to stop claiming something is exactly the
 * kind of rule that drifts when it is only eyeballed in a story.
 *
 * Every branch but one is a fact the backend actually sent. `intent` rides
 * `tool_execution_start` and is already on the tool record; a streaming
 * assistant record IS what "responding" means; and `thinking` is the default
 * for a model call in flight with nothing on the ledger to show for it. The
 * vocabulary is the harness's own (`harness/intent.py`), so a reader who
 * learned it in the terminal does not learn it again here.
 *
 * The exception is `admitted`, and it is deliberately the weakest claim the app
 * can make:
 *
 * A send this app issued can be admitted by the owner and produce nothing at
 * all for seconds - a cold session spends ~1.15 s inside the message request
 * spawning its runtime (`use-warm-session.ts`), and the desktop surface cannot
 * warm a New-chat pane before the send because the pane has no session to warm
 * and no bridge to hold the warm with. The TUI never shows that gap: it warms
 * on the first keystroke, so its working line is almost never covering a
 * runtime start. Here it is, and before this branch the transcript showed the
 * user's own bubble and then nothing at all until the first frame landed.
 *
 * So this branch is carried by the app's own send rather than by a frame, and
 * the copy is chosen to claim nothing the renderer cannot check: it names what
 * the app is waiting for, and deliberately does NOT say the runtime or the
 * model is starting. The renderer cannot tell a session that is still engaging
 * from one that is merely slow to answer, and `thinking` - the ladder's own
 * word for "a model call is in flight", per `ACTIVITY_THINKING` - would assert
 * a model call for the whole of the engage. An earlier design reviewed here
 * also considered "starting the session" for this whole window and rejected it
 * for that reason - a WARM session would be described as starting while it is
 * already up. The design that reinstated the phrase bounded it to the window in
 * which the sentence is literally true: the create hop, before a session exists
 * at all (see `STARTING_SESSION_ACTIVITY` below).
 *
 * Its WINDOW is the whole wait, not the request. Review round 1 caught the
 * difference: bounded by the request's own lifetime, the rung vanished for a
 * frame the moment the receipt arrived and the first frame had not, so the
 * clock restarted at `0s` under the reader - the exact defect this row's own
 * contract calls out. The window is therefore "a send this pane admitted that
 * has not been answered", which is one continuous fact from Enter until the
 * owner paints something, and every clear below measures from this send's own
 * echo record rather than from the shape of the transcript.
 *
 * The phase is the ladder's `thinking` on purpose, rather than a phase of its
 * own. Phases are what the clock is keyed to, and the wait this branch names
 * and the model call that follows it are one wait to the reader: keying a
 * separate phase would restart the clock at 0s the moment the first frame
 * arrived, which is the "restarting the clock on every label change" defect
 * the working line's own contract calls out.
 */

import { epochMsFromSeconds } from "../../../../../shared/desktop-session-contract";
import type { ChatDraft } from "../../../shared/store/canonical-sessions-store";
import { displayName } from "../components/trace/tool-row-model";
import type { TranscriptRecord } from "./transcript-reducer";
import { paintsSomething } from "./transcript-rows";
import { isCompletionMarker } from "./turn-segments";

export type WorkingLineState = {
	activity: string;
	phase: string;
	/**
	 * When this PHASE began, when the state knows it.
	 *
	 * The rung's clock is otherwise anchored to the component's mount, which is
	 * wrong twice over: a re-mount mid-phase restarts a clock that is reporting
	 * the phase's duration, and a still of the rung is a function of the
	 * shutter's timing rather than of the state (design round 2, D3). The
	 * compacting phase knows its start — the pass's own `compaction_start`
	 * stamp — so it passes it down and the frame is stable.
	 */
	startedAt?: number;
	/**
	 * Whether an elapsed number would be TRUE for this rung. Defaults to true.
	 *
	 * `false` is this derivation stating that it would not, which is the one case
	 * the TUI's band also withholds it for (`app.py::_current_activity` returns
	 * `clock=False` for queued work): the dictation clock ENDED when the model
	 * stopped writing, the call has no start to count from, and the phase edge is
	 * the moment the LABEL changed — so any number here is the seat of an age
	 * nothing did. Measured on a seeded conversation, which is the operator's own
	 * "switch into a waiting conversation", that number is the mount's age.
	 */
	clock?: boolean;
};

/**
 * The label for a turn this app has admitted and that has produced nothing yet.
 *
 * Lowercase like every other rung, because this row is the machine-voice
 * column, and a sentence here would be the app narrating rather than the
 * harness reporting. It states the waiting and nothing else; see the file
 * comment for why it does not name the runtime or the model.
 */
export const ADMITTED_SEND_ACTIVITY = "waiting for the agent";

/**
 * The label for a send whose SESSION does not exist yet - the create hop.
 *
 * Lowercase like every other rung, for the same reason (the file comment above).
 * It is literal where the rung above is cautious: `sessions.create` is in
 * flight, so there is no session to be waiting on the agent IN - the app is
 * starting one - and on this platform the hop is the ~1.15 s a cold runtime
 * spends engaging, which used to be dead air on the one path where nothing at
 * all was claimed (`admitChatDraft` now paints at the press).
 *
 * IT IS A SECOND LABEL, NOT A SECOND PHASE, and that is the whole of the clock
 * rule: `deriveWorkingLine` returns `STARTING_SESSION_ACTIVITY` or
 * `ADMITTED_SEND_ACTIVITY` under the SAME `phase: "thinking"`, so the elapsed
 * number crosses the create's answer without restarting - the defect the file
 * comment above calls out for every label change in this row, and the reason
 * the two labels cannot be made different phases that happen to read alike.
 */
export const STARTING_SESSION_ACTIVITY = "starting the session";

/**
 * The label for a compaction pass in flight, and the phase its clock runs in.
 *
 * The copy is the terminal host's own — `local_operator/tui/app.py`'s
 * working-line fallback for `on_compaction_started` is literally `compacting
 * context` — because a reader who learned the phrase in the terminal should not
 * learn a second one here (the same reason the rest of this ladder is the
 * harness's vocabulary).
 *
 * WHY IT IS ITS OWN PHASE. Phases are what the clock is keyed to, and a pass is
 * a fact with its own duration: folded into `thinking` the clock would restart
 * under the reader at whatever label change happened next, which is the defect
 * the working line's contract calls out. A pass also outranks `waiting`: it is
 * the more specific statement about why this session is busy.
 *
 * AND WHAT OWNING A PHASE COSTS, decided rather than left to be discovered
 * (design round 1, D4: the backend CAN emit `compaction_start` inside a live
 * turn — `session.py:_run_compaction` is called mid-turn when the context
 * crosses its threshold — so the row can read `running 3 tools` ->
 * `compacting context` -> `running 3 tools`). The clock rests at 0s at BOTH
 * boundaries, and that is the right reading: the clock's contract is "how long
 * has THIS phase been running", the phase is the pass's own span, and a pass's
 * duration is exactly what the operator asked to see. Keeping one clock across
 * the interruption would print a turn's age beside the word `compacting`,
 * which is the same lie in the other direction. The rejected alternative —
 * folding the pass into the turn's phase so the clock never rests — was
 * rejected because it makes the row's duration report the TURN while claiming
 * to report the pass.
 */
export const COMPACTING_ACTIVITY = "compacting context";

/**
 * The label for the window between a Stop press and its answer, and the reason
 * the press gets a rung at all.
 *
 * THE INCIDENT (operator report, 2026-10-07): a Stop press could sit with no
 * feedback of its own while the pane's last reading still said a turn was up -
 * the band that did appear is the OTHER statement ("the turn you stopped ended
 * this way") and it could vanish without a word when the answer was `idle`.
 * Between the press and its receipt the one thing the app knows is that a
 * cancel is IN PROGRESS, and the line is where every other in-flight fact on
 * this pane already speaks, so it says that and only that.
 *
 * WHY IT CARRIES NO CLOCK, not even the phase's: a number here would measure
 * one of two things and both are wrong. Counting the turn re-narrates the work
 * the user just asked to cancel - and any RESTART of that number (0s again) is
 * the tell the operator's own report names; counting from the press would
 * invent an age for a cancel whose length nothing has measured. The queued arm
 * withholds its number for the same reason (see `clock`), and this rung keeps
 * the LIVE phase and anchor underneath its label so the clock neither restarts
 * nor jumps if the receipt turns out to say nothing was running. The copy is
 * provisional, pending the design round.
 */
export const STOPPING_ACTIVITY = "stopping the turn";

/**
 * The send a pane has admitted, read from the store's own draft row.
 *
 * WHAT THIS REPLACED, AND WHY. It used to be `admittedSendFor(sessionId,
 * draft)`, gated on three terms: `pending`, `admissionAttempted` and a PRESENT
 * session id. The third was the dead-air window the operator reported - before
 * `sessions.create` answers there is no session, so on a New chat the claim
 * was false for the whole hop - and the first two were the receipt's terms. The
 * row now EXISTS in that window (it is painted at the press, before the
 * create), so the claim moved to where the fact lives: the pane reads
 * `pendingSendForView` (the registry the row was painted into) and the box
 * reads the row directly, below. `admissionAttempted` keeps its own meaning
 * (the request was issued) for the failure arms; it is no longer this
 * question's gate.
 */

/**
 * The draft row a CONVERSATION's send is travelling in, or undefined.
 *
 * WHY IT LIVES HERE, AND WITH A TYPE-ONLY IMPORT OF THE STORE. It is a rule about
 * the store's row SHAPES, but the module that consumes it is this one, and a
 * runtime import of the store would drag the desktop API and the echo seam into
 * every bundle that reads the transcript's rows - three suites that bundle this
 * model failed to build when it did (measured: `tool-row`, `tool-compose-lifecycle`
 * and `working-line-clock`, each "Could not resolve @shared/api/local-operator/desktop-api"
 * from `canonical-sessions-store.ts`). `ChatDraft` below is a TYPE, so nothing of
 * the store reaches a bundle through here.
 *
 * WHY A LOOKUP BY IDENTITY AND NOT BY KEY. A row is normally found by
 * `draftIdentityFor(draftKey, sessionId)`, and `draftKey` is a fact of the PANE
 * that issued the send - but the pane is not the only reader that needs the row,
 * and on the New-chat path it is not even the same COMPONENT: the identity flip
 * unmounts the composer that pressed Enter while its send is still going out
 * (`panelIdentityFor` says why), so every reader that asks afterwards holds the
 * session id and no draft key. Review round 2, R2-1 is that gap: a fact of the
 * send read from state of the replaced panel is a fact the replacement panel
 * cannot see.
 *
 * THREE SPELLINGS, all of them a name this same conversation's send can have:
 * a `send:<id>` row (the live-session path, whose id is in the key and never on
 * the row), a row whose `sessionId` was patched by the create (`updateDraft(key,
 * { sessionId })`, before the message POST), and - newly load-bearing - a row
 * still keyed by the DRAFT (`draft:<uuid>`), which is what a pane holds while
 * the create is in flight and what a remounted pane asks with, because the
 * pane's own identity is the draft key for that whole window.
 *
 * A lookup rather than a predicate, so the question "is this send still going
 * out" has ONE definition: the caller asks `sendUnsettledForSession`, below.
 */
export function draftRowForSession(
	drafts: Record<string, ChatDraft>,
	identity: string | null | undefined,
): ChatDraft | undefined {
	if (!identity) return undefined;
	const rows = Object.values(drafts).filter(
		(row) =>
			row.sessionId === identity ||
			row.key === `send:${identity}` ||
			row.key === identity,
	);
	/*
	 * A row that is IN FLIGHT wins when several shapes address one conversation:
	 * the caller is asking about a send, and a settling row and a starting one can
	 * overlap for a frame (the receipt and the next press are not ordered against
	 * each other). `rows[0]` is then the fallback that keeps this a lookup rather
	 * than a second predicate.
	 */
	return rows.find((row) => row.pending) ?? rows[0];
}

/**
 * Is a send for this CONVERSATION still going out? The composer's own window.
 *
 * THE SOURCE IS THE STORE'S DRAFT ROW, and that is load-bearing rather than
 * tidy: `draftRowForSession` finds it from the pane's own identity, so a panel
 * that mounts MID-SEND can see it. The New-chat identity flip unmounts the
 * panel the Enter was pressed in (`panelIdentityFor`, "THE FLIP IS A REMOUNT")
 * and the replacement mounts with no history of that press, so any flag held in
 * the replaced panel's state is false there for the whole send. Review round 1's
 * MAJOR-1 put the sentence below `awaitingReply`; review round 2's R2-1 found the
 * source had the same lifetime problem one level down, because the flag the
 * sentence was fed from was the page's own `useState`.
 *
 * THE ROW IS THE CLAIM NOW, NOT THE RECEIPT'S LATCH. `pending` alone is the
 * term: the store writes it in the same update that writes `submittedAt`, BEFORE
 * the paint and before `sessions.create` - so the sentence covers the create hop
 * (~1.15 s of engage on a New chat) as well as the message hop, and a remounted
 * composer that holds nothing in its box still says where the message went.
 * `admissionAttempted` is deliberately not a term any more: it is written after
 * the create answers, so requiring it withheld the sentence for exactly the
 * window this reader gained, and the fact it records (the request was issued) is
 * the failure arms' business rather than this sentence's.
 *
 * A failure clears `pending` in the same store update that records the error, so
 * a refused send never claims to be going out - the row's own sentence says
 * what happened instead.
 *
 * ONE SEND, TWO SURFACES. The transcript's working line reads the PAINTED send
 * (`pendingSendForView`, through the pane's `starting` latch), and this reads
 * the same send's row with no latch - which is exactly the difference between
 * the two sentences the box can say. While this is true the request has not been
 * confirmed yet, so the box says the message is going out; the receipt empties
 * the row (`finishDraft` deletes it), the latch keeps the transcript's line up
 * across that gap, and the box has nothing left to claim but the owner's answer
 * (`Waiting for the agent`).
 */
export const sendUnsettledForSession = (
	drafts: Record<string, ChatDraft>,
	identity: string | undefined,
): boolean => draftRowForSession(drafts, identity)?.pending === true;

/**
 * Whether the owner has ANSWERED a send that was admitted under `afterId`.
 *
 * Swept over every record after the anchor rather than over the tail alone, and
 * that is a correction rather than a style: `buildRows` and `AssistantRow` both
 * sweep the whole list on `paintsSomething`, so a record that paints nothing is
 * invisible to the transcript while it was decisive to this clear - painted
 * prose followed by an empty `message_start` placeholder re-asserted the rung
 * over an answer already on screen (review round 1, R3).
 *
 * The predicate is the transcript's own `paintsSomething` (one copy of the rule
 * that decides whether a record becomes a row), narrowed to the two kinds that
 * mean the OWNER produced something. A notice, a local note, a compaction or
 * the user's own later row are not the agent answering, and none of them may
 * end the wait.
 *
 * An anchor that is not in the list - an echo evicted from the buffer, a
 * transcript replaced by `/clear` mid-send - falls back to the tail, whose only
 * failure mode is to withhold the rung rather than to claim one.
 */
export function ownerAnswered(
	records: TranscriptRecord[],
	afterId: string | null | undefined,
): boolean {
	const ownerPainted = (record: TranscriptRecord) =>
		(record.kind === "tool" || record.kind === "assistant") &&
		paintsSomething(record);
	return recordsAfter(records, afterId).some(ownerPainted);
}

/**
 * The records a clear has to sweep: everything after the send's own echo, or the
 * tail when that anchor is not in the list.
 *
 * ONE COPY of the anchor rule, because the two clears below disagree about what
 * ends a wait and must not disagree about WHEN to look. An anchor that is not in
 * the list - an echo evicted from the buffer, a transcript replaced by `/clear`
 * mid-send - falls back to the tail, whose only failure mode is to withhold the
 * rung rather than to claim one.
 */
function recordsAfter(
	records: TranscriptRecord[],
	afterId: string | null | undefined,
): TranscriptRecord[] {
	if (afterId) {
		const at = records.findIndex((record) => record.id === afterId);
		if (at >= 0) return records.slice(at + 1);
	}
	const tail = records[records.length - 1];
	return tail === undefined ? [] : [tail];
}

/**
 * Whether the turn a send admitted under `afterId` has STOPPED without painting
 * anything.
 *
 * A DURABLE COMPLETION MARKER is the transcript's own record that the turn is
 * over: the reducer writes `complete` on a `notice` for exactly three things —
 * "Stopped with an error", "Interrupted", and the v2 neutral closure
 * "Completed — runtime retired/disposed" a disposal publishes for a run that
 * spent nothing — and never for its own renderer notes (a harness recovery
 * notice, a retry line, a subagent failure all omit it). That is why the test is
 * the marker rather than the text: the copy is expected to be reworded, and
 * matching on prose would silently stop matching.
 *
 * WHY A STOP HAS TO RETIRE THE WAIT. The rung is a claim about work in flight, and
 * a turn that died before it painted anything leaves the transcript with no row
 * of its own - so on the round-1 clear set (an answer, or a dead transport) the
 * line stayed up SIGNIFICANTLY: measured in the live app at t+55s and still
 * counting, `waiting for the agent 55s` beside `Stopped with an error` in danger
 * ink, with the composer stuck on "Waiting for the agent" underneath. A stuck
 * claim about work that has stopped and then failed is worse than the dead air
 * this whole change removed (QA round 2, Q4).
 *
 * It is not a claim that the conversation is over: a later turn, or a retry, sets
 * `waiting` and the ladder above speaks for that one instead.
 */
export function turnStopped(
	records: TranscriptRecord[],
	afterId: string | null | undefined,
): boolean {
	return recordsAfter(records, afterId).some(isCompletionMarker);
}

/**
 * A stopped outcome need not have a raw transcript row: crash/refusal recovery
 * can publish only frontend attention, which the transcript synthesizes for
 * display. Compare its durable anchor with the one present at admission so an
 * old failure cannot cancel a new send. `unseen` is deliberately irrelevant:
 * acknowledging the outcome must not restart a wait for a turn that ended.
 */
export function stoppedAfterAdmission(
	attention:
		| { anchor_id?: string | null; kind?: string | null }
		| null
		| undefined,
	previousAnchor: string | null,
): boolean {
	return Boolean(
		attention?.anchor_id &&
			attention.anchor_id !== previousAnchor &&
			(attention.kind === "error" ||
				attention.kind === "interrupted" ||
				// The v2 neutral closure (2026-09-29): a disposed runtime ends the
				// wait the same way an incident does — leaving the line up would
				// claim work in flight beside a receipt that says it stopped.
				attention.kind === "closed" ||
				// The retire-for-build kind (2026-09-29): the drain is leaving and
				// the turn was cut, so a spinner beside "Retired for an update …"
				// is the same contradiction as the closure's.
				attention.kind === "retired"),
	);
}

export type WorkingLineInput = {
	/** The owner is generating and nothing has painted yet for this turn. */
	waiting: boolean;
	/**
	 * When the in-flight pass began, on this reader's clock
	 * (`TranscriptState.compactingSince`), for the phase's own start.
	 */
	compactingSince?: number;
	/**
	 * A compaction pass is in flight (`TranscriptState.compacting`).
	 *
	 * The transcript's own fact, and the reconciliation for every way the pass
	 * stops lives in the reducer that owns it: `compaction_end` (success, refusal
	 * or failure), a replaced/durable transcript, a new turn, and a receipt gap
	 * that drops live-only claims. A DEAD TRANSPORT is the one case handled here
	 * rather than there, because it is this row's rule and not the flag's: an
	 * unavailable transport suppresses the rung instead of being cleared by it, so
	 * a reconnection cannot resurrect a claim by leaving the flag set.
	 */
	compacting: boolean;
	/**
	 * A send from this conversation has been admitted and the owner has not
	 * answered it. The app's own fact, not the owner's; see the file comment for
	 * why its window is the whole wait rather than the request.
	 */
	starting: boolean;
	/** The echo record that send painted; every clear below measures from it. */
	startingAfterId?: string | null;
	/**
	 * Whether that send is still in its CREATE hop, i.e. no session exists yet.
	 *
	 * Read off the draft row's `sessionId` at the pane (`starting &&
	 * !draft?.sessionId`), which is the same fact `paintPendingSend` addressed
	 * the row by: the draft key answers until the create patches the id, the id
	 * answers after. Absent means false, so every caller that predates this
	 * label derives exactly what it derived before.
	 */
	startingSession?: boolean;
	/**
	 * When the claim began, epoch ms - the press's own `submittedAt` on the draft
	 * row.
	 *
	 * WHY THE ROW AND NOT THIS COMPONENT'S MOUNT. This rung's clock is the one
	 * number the user watches through the engage, and the wait outlives every
	 * component that renders it: the identity flip remounts the panel as soon as
	 * the create answers, and a switch away and back remounts again. A local
	 * zero would restart under the reader at each of those (the defect the file
	 * comment above records for the receipt), which is exactly what the persisted
	 * `submittedAt` exists to prevent. `clock: false` is not used here: the app
	 * is this wait's producer and it knows the start.
	 */
	startingSince?: number | null;
	/**
	 * A Stop press is in flight for this conversation - or its receipt has
	 * confirmed the cancel and the stream has not yet shown the turn ending.
	 *
	 * Those are the two phases of the page's press machine
	 * (`chat-page.tsx`'s `stopOutcome`: `pending` and `awaiting-end`) in which
	 * the rung must stand: from the press until the turn itself is confirmed
	 * over, because dropping back to `running bash Ns` between the two was the
	 * measured regression (a receipt delivered inside a gap) - the rung is the
	 * one surface that says the cancel the user asked for is still being
	 * carried out. It is here because this line already speaks for in-flight
	 * facts on this pane. Absent means false, so every caller that predates
	 * this field derives exactly what it derived before.
	 */
	stopping?: boolean;
	/**
	 * An `idle` receipt arrived while this pane still claimed a live turn, and
	 * the disputed sentence is standing in the composer (UX round 2, U9).
	 *
	 * The claim STAYS - the runtime's `idle` and the pane's held reading
	 * disagree, and neither side can be declared the liar from here - but the
	 * clock is withheld: a ticking `running bash 15s` asserts a duration the
	 * pane has just admitted it cannot vouch for. Label without number until
	 * the claim re-states (the pane's own re-read, or the stream catching up -
	 * the sentence and this flag share one lifetime, both folded from the
	 * notice's kind in `chat-page.tsx`). Absent means false, so every caller
	 * that predates this field derives exactly what it derived before.
	 */
	idleDisputed?: boolean;
	/** A question is pending; it outranks every working state (branding § 7). */
	gate: boolean;
	/**
	 * The producer's OWN folded phase and the instant it began, straight off the
	 * frontend state (`activity_phase` / `activity_phase_started_at`).
	 *
	 * The instant is in epoch SECONDS on the wire, the unit `FrontendSessionState`
	 * stamps it in; the conversion is the shared `epochMsFromSeconds`, so this
	 * reader and the reducer's `started_at_epoch` reader cannot drift apart about
	 * the unit. Both members are optional because a facade in tests, a legacy
	 * runtime and a session between turns all legitimately have neither — and an
	 * absent phase or stamp must keep today's honest local zero rather than invent
	 * an age (see `foldedSeed` below).
	 */
	foldedPhase?: string;
	foldedPhaseStartedAt?: number | null;
	/**
	 * The stream has failed unrecoverably and the transcript is rendering that
	 * failure instead. A working line next to it would claim progress the
	 * transport is not making.
	 */
	unavailable: boolean;
	records: TranscriptRecord[];
};

/**
 * The derivation, plus the one rung that is not a reading of the turn at all:
 * a Stop press in flight relabels the line and withholds its clock.
 *
 * WHY AN OVERLAY AND NOT A BRANCH INSIDE THE LADDER. The press is a fact about
 * the USER'S REQUEST, not about the work, so it can land on any rung - running
 * a batch, composing, responding, thinking - and a branch per rung would be
 * five copies of the same rule. Overlaying instead keeps the live state's
 * PHASE and ANCHOR underneath the label, which is the whole of the no-restart
 * guarantee: the label changes, the clock cell goes empty rather than
 * restarting, and if the receipt turns out to say nothing was running the
 * number resumes from the same zero (`STOPPING_ACTIVITY` carries the why).
 *
 * A state the ladder does not claim stays unclaimed: `gate` and `unavailable`
 * still return null before the overlay is reached, so a pending question or a
 * terminal transport is never relabelled into a claim.
 */
export function deriveWorkingLine(
	input: WorkingLineInput,
): WorkingLineState | null {
	const live = deriveLiveWorkingLine(input);
	if (live === null) return live;
	if (input.stopping === true)
		return { ...live, activity: STOPPING_ACTIVITY, clock: false };
	/*
	 * The disputed idle's half (U9): the same overlay shape as `stopping`, one
	 * rung less - the label stays the live state's own, only the number goes.
	 * Two overlays rather than one flag because they are different facts with
	 * different copy (`stopping` relabels, this one only withholds), and they
	 * cannot coincide: the disputed sentence is written by the idle receipt
	 * that RESOLVES the press window.
	 */
	if (input.idleDisputed === true) return { ...live, clock: false };
	return live;
}

function deriveLiveWorkingLine({
	waiting,
	compacting,
	compactingSince,
	starting,
	startingAfterId,
	startingSession,
	startingSince,
	gate,
	unavailable,
	foldedPhase,
	foldedPhaseStartedAt,
	records,
}: WorkingLineInput): WorkingLineState | null {
	if (gate) return null;

	/*
	 * The producer's OWN start instant for `phase`, when the producer agrees
	 * that this is the phase. This is the whole of the anchor's safety, and the
	 * gate is the same one the TUI applies (`OperatorApp._folded_phase_epoch`,
	 * `tui/app.py`): the phase folded from the runtime's events is compared by
	 * STRING with the phase derived here, and any disagreement withholds the
	 * instant instead of passing a zero that does not belong.
	 *
	 * The two are different reductions of one stream, so a disagreement means
	 * one of them has missed events — the disagreement cases are real rather
	 * than defensive dressing: a compaction or retry fallback phase the fold
	 * does not model, a legacy runtime whose events carry no phase, and every
	 * reduced facade in tests. Withholding the clock THERE is what the row
	 * already did, so a mismatch can only preserve behaviour, never invent an
	 * age; on a match, a viewer that attached mid-turn resumes the true age
	 * instead of counting from its arrival (the operator report: "each time I
	 * resume it says it's been waiting for 0s regardless of how long").
	 *
	 * The refusals are `epochMsFromSeconds`' — a non-positive, non-finite or
	 * non-numeric stamp is a producer that has not stated one (not an instant in
	 * 1970), and the same helper is what the reducer reads a tool frame's
	 * `started_at_epoch` through, so the two surfaces cannot disagree about what a
	 * stated instant is.
	 */
	const foldedSeed = (phase: string): number | null => {
		if (foldedPhase !== phase) return null;
		return epochMsFromSeconds(foldedPhaseStartedAt);
	};

	/*
	 * The pass outranks `waiting`, and `unavailable` outranks the pass: a rung
	 * that claims a compaction is progressing beside a pane that is saying the
	 * transport died is claiming progress nobody can vouch for. The check sits
	 * here rather than in the reducer because suppressing a claim and retiring a
	 * fact are different repairs — a dead transport hides the rung without
	 * deciding the pass is over, and a later end frame still paints its line.
	 *
	 * Review round 1 (R4) asked what restores the rung after a reconnect, and the
	 * answer is nothing does: the seed's `live_events` fold carries no
	 * `compaction_start` (the reducer's `applyLiveSeed` names the fold), so a
	 * reconnect mid-pass drops the rung and the pass keeps running. Withholding
	 * it is the safe direction and the claim is the thing this ladder refuses to
	 * invent.
	 */
	if (compacting) {
		if (unavailable) return null;
		return {
			activity: COMPACTING_ACTIVITY,
			phase: "compacting",
			// Spread rather than set, so a caller with no stamp produces the SAME
			// object shape as before this field existed (`tool-row.test.mjs` compares
			// the derived state deeply, and an explicit `undefined` is a different
			// object).
			...(compactingSince === undefined ? {} : { startedAt: compactingSince }),
		};
	}

	if (waiting) {
		/*
		 * THE RUNG YIELDS TO A TERMINAL STATEMENT, AND TO NOTHING SOFTER (operator
		 * incident, 2026-10-07).
		 *
		 * `unavailable` is the pane's own "this statement is terminal" fact - the
		 * failure notice it is rendering instead of the conversation, a session this
		 * machine no longer has, or nothing but a cached page. Beside any of those a
		 * line claiming progress is claiming progress nobody can vouch for, which is
		 * why the compacting and admitted-send arms already yield to it and this one
		 * now does too.
		 *
		 * WHAT IT DELIBERATELY IS NOT: the reconnecting window. A receipt gap is not
		 * a statement that the turn ended; the pane says the connection is being
		 * rebuilt while the app still holds the last reading, and on a flaky link -
		 * the operator's own incident - the work on the far side is real the whole
		 * time. Blanking this rung through every ~1.5-4 s reconnect is what left a
		 * running turn with NO in-flight indicator at all, so the call sites feed
		 * this door the terminal fact (`canonicalTranscriptTerminal`,
		 * `transcript-pane.ts`) rather than "anything the pane is saying".
		 */
		if (unavailable) return null;
		const runningTools = records.filter(
			(record) => record.kind === "tool" && record.phase === "running",
		) as Extract<TranscriptRecord, { kind: "tool" }>[];
		if (runningTools.length > 0) {
			// One call states its own purpose; a batch states a COUNT. Presenting
			// one call's intent as the whole batch's activity is a claim the rows
			// above it immediately contradict, and the count is the one fact this
			// line has that appears nowhere else on screen.
			const activity =
				runningTools.length === 1
					? (runningTools[0].intent ??
						`running ${displayName(runningTools[0].toolName)}`)
					: `running ${runningTools.length} tools`;
			/*
			 * A running batch is measured from the OLDEST running card's own start,
			 * never from the folded phase edge: the phase restarts on every call
			 * that joins the batch while the batch's clock must not, so the cards
			 * are the finer anchor (`frontend_state.py`'s `_fold_activity_phase`,
			 * `the running phase is folded so the end rule can tell a batch that
			 * still has siblings from one that has just lost its last call. Its
			 * clock does NOT come from here`).
			 *
			 * EVERY running card must date itself: one unknown start poisons the
			 * batch's zero, because the call the clock claims to measure is exactly
			 * the oldest one. That is the TUI's rule for the same row
			 * (`_current_activity`'s `dateable`), and it is what a row restored
			 * from a durable page alone produces — a running entry the durable fold
			 * cannot stamp carries `startedAt: null`, so the row falls back to its
			 * own local zero rather than wearing a sibling's age.
			 */
			const starts = runningTools
				.map((record) => record.startedAt)
				.filter((start): start is number => start !== null);
			const since =
				starts.length === runningTools.length ? Math.min(...starts) : null;
			return {
				activity,
				phase: "running",
				...(since === null ? {} : { startedAt: since }),
			};
		}
		const composing = records.filter(
			(record) => record.kind === "tool" && record.phase === "composing",
		).length;
		if (composing > 0) {
			// The tool's NAME is deliberately absent: it arrives in fragments, and
			// `composing wr` reads as a typo rather than as a state.
			const since = foldedSeed("composing");
			return {
				activity: `composing ${composing === 1 ? "a call" : `${composing} calls`}`,
				phase: "composing",
				...(since === null ? {} : { startedAt: since }),
			};
		}
		/*
		 * The queued rung, split from the composing one because the registry case
		 * holds two different facts. A row is `composing` while the model is still
		 * writing its call and `queued` once the producer's terminal dictation frame
		 * says the writing stopped and the call has not started — it may wait behind
		 * a sibling's execution group for as long as that sibling runs. Saying
		 * `composing` under a row whose model stopped writing minutes ago is the
		 * header agreeing with the stuck row the operator reported, and a queued call
		 * left behind a long sibling is exactly when this line was wrong longest.
		 *
		 * The TUI's own arm, word for word (`app.py::_current_activity`): queued work
		 * is `waiting to run`, carrying no clock, because the dictation clock these
		 * rows had ENDED and the call has no start to count from. A `phase` of its
		 * own rather than `composing` so nothing downstream can mistake the two.
		 */
		const queued = records.filter(
			(record) => record.kind === "tool" && record.phase === "queued",
		).length;
		if (queued > 0) {
			return {
				activity: `waiting to run ${queued === 1 ? "a call" : `${queued} calls`}`,
				phase: "queued",
				// The TUI's `clock=False` for this arm, and the reason is stated there:
				// the dictation clock these rows carried has ENDED, the call has no
				// start, and the only zero left is the phase edge. Withheld rather than
				// understated — a number counted from the label's own change is the
				// invented age the phase arms exist to avoid.
				clock: false,
			};
		}
		const tail = records[records.length - 1];
		if (tail?.kind === "assistant" && tail.streaming) {
			// Only once prose is ACTUALLY streaming. `message_start` fires from a
			// placeholder at the top of every provider call, before the first
			// token, so flipping on it would claim the model is writing for the
			// whole of every turn — which is why the record's own `text` is the
			// trigger here, not its existence.
			if (tail.text) {
				const since = foldedSeed("responding");
				return {
					activity: "responding",
					phase: "responding",
					...(since === null ? {} : { startedAt: since }),
				};
			}
		}
		// The turn's fallback rung. It carries the fold's `thinking` edge when
		// the producer agrees it is thinking, which is the one rung with no card
		// behind it and therefore the only one a per-call stamp cannot answer:
		// without this a viewer joining mid-model-call watched the label it just
		// resumed start counting from its own arrival.
		const since = foldedSeed("thinking");
		return {
			activity: "thinking",
			phase: "thinking",
			...(since === null ? {} : { startedAt: since }),
		};
	}

	if (!starting) return null;
	if (unavailable) return null;
	if (ownerAnswered(records, startingAfterId)) return null;
	// The turn ended without painting: an incident is the app's own record that
	// what this rung claims is in flight has stopped.
	if (turnStopped(records, startingAfterId)) return null;
	/*
	 * ONE WAIT, TWO LABELS, ONE CLOCK. The phase is `thinking` for BOTH rungs,
	 * because phases are what the clock is keyed to: keying a separate phase for
	 * the create hop would restart the elapsed number at the create's own answer,
	 * which is the label-change defect this row's contract calls out - and the
	 * answer to "when did this wait start" is now a fact the ROW carries
	 * (`submittedAt`), not the age of whichever component happens to be mounted
	 * (see `startingSince`).
	 */
	return {
		activity:
			startingSession === true
				? STARTING_SESSION_ACTIVITY
				: ADMITTED_SEND_ACTIVITY,
		phase: "thinking",
		...(startingSince == null ? {} : { startedAt: startingSince }),
	};
}

/**
 * Whether this pane is claiming work at all - the composer's hint, derived from
 * the same expression that renders the transcript's line.
 *
 * ONE CLAIM, TWO SURFACES, ONE EXPRESSION. The composer used to test the latch
 * itself (`awaitingReply={canonical.starting}`), so it kept saying "Waiting for
 * the agent" in the states the line deliberately yields in - a pending question,
 * and a dead transport whose own story says a line claiming progress would be
 * claiming progress nobody is making - 46px above a pane that had already
 * withdrawn the claim for a stated reason (review round 2, R2-3; design round 2,
 * D5). Deriving it here means a gate, a failure, an answer or a stopped turn
 * retire both surfaces together, and no second condition can drift from the
 * first.
 *
 * THE STRING IS NOT A PHASE LABEL, which is why this asks whether the line is up
 * rather than whether it is the admitted-send rung: the placeholder says "the
 * agent is working and you are waiting for it", and it stays up through the
 * hand-off from the wait to `thinking` exactly as it did before this change.
 * Matching the rung's own phrase instead would swap a true sentence for
 * "Ask me for help" while the agent is demonstrably writing.
 */
export function workingLineClaimed(input: WorkingLineInput): boolean {
	return deriveWorkingLine(input) !== null;
}

/**
 * The derivation's input, read off one pane's canonical state.
 *
 * Exported so the rung and the composer are handed the same facts from one
 * builder rather than two constructions that can drift, and so `unavailable`
 * is the pane's own terminal-statement predicate (`canonicalTranscriptTerminal`,
 * `transcript-pane.ts`) rather than a second copy of the rule - the one
 * deliberate exception is the reconnecting window, which is not terminal and
 * must not stand the line down (see the waiting arm). The records are NOT one
 * list in every caller: the transcript's rung is handed the cross-session
 * filter's `shownRecords` while the composer's hint still reads the raw
 * records, and no divergence is reachable
 * today because the one predicate that could flip on the dropped rows
 * (`ownerAnswered`) is decided over raw records in `chat-page` before either
 * reader is built - the trace and the dependency live beside the rung
 * (`canonical-transcript.tsx`, the `paneWorking` memo).
 */
export function workingLineInputFor(pane: {
	waiting: boolean;
	compacting: boolean;
	compactingSince?: number;
	starting: boolean;
	startingAfterId?: string | null;
	/** See `WorkingLineInput.startingSession`: the create hop's own label. */
	startingSession?: boolean;
	/** See `WorkingLineInput.startingSince`: the press's persisted anchor. */
	startingSince?: number | null;
	/** See `WorkingLineInput.stopping`: the press's own window, page-owned. */
	stopping?: boolean;
	/** See `WorkingLineInput.idleDisputed`: the disputed idle's clock-withhold. */
	idleDisputed?: boolean;
	gate?: unknown;
	unavailable: boolean;
	records: TranscriptRecord[];
	/** The producer's folded phase, matching `CanonicalFrontendState.activity_phase`. */
	foldedPhase?: string;
	/**
	 * When that phase began, in epoch SECONDS as the wire states it
	 * (`activity_phase_started_at`). Passed through unconverted: the unit is
	 * normalised once, in `deriveWorkingLine`, so the two readers of this input
	 * cannot disagree about it.
	 */
	foldedPhaseStartedAt?: number | null;
}): WorkingLineInput {
	/*
	 * Spread rather than spelled out, so a pane with no fold produces the SAME
	 * object shape as before these fields existed: a facade in tests, a legacy
	 * runtime and a session between turns all have no phase, and an explicit
	 * `foldedPhase: undefined` would be a different object to every depth-aware
	 * comparison in `tool-row.test.mjs`. An EMPTY phase is the producer's own
	 * "no phase" (`FrontendSessionState` folds `""` at a turn end), so it is
	 * treated as absent rather than as a phase nothing will ever match.
	 */
	const folded =
		typeof pane.foldedPhase === "string" && pane.foldedPhase !== ""
			? {
					foldedPhase: pane.foldedPhase,
					foldedPhaseStartedAt: pane.foldedPhaseStartedAt ?? null,
				}
			: {};
	return {
		waiting: pane.waiting,
		compacting: pane.compacting === true,
		compactingSince: pane.compactingSince,
		starting: pane.starting,
		startingAfterId: pane.startingAfterId ?? null,
		// Spread, for the same shape reason as `folded` above: a caller that
		// knows neither answers EXACTLY the object it always did, so growing
		// this input cannot change a comparison in the suites that pin it.
		...(pane.startingSession === true ? { startingSession: true } : {}),
		...(pane.startingSince == null
			? {}
			: { startingSince: pane.startingSince }),
		// Spread, for the same shape reason as `folded` above.
		...(pane.stopping === true ? { stopping: true } : {}),
		// Spread, for the same shape reason as `folded` above.
		...(pane.idleDisputed === true ? { idleDisputed: true } : {}),
		gate: Boolean(pane.gate),
		unavailable: pane.unavailable,
		...folded,
		records: pane.records,
	};
}
