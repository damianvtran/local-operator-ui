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
 * also considered "starting the session"; it was rejected for the same reason,
 * because a warm session would be described as starting while it is already up.
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
import { displayName } from "../components/trace/tool-row-model";
import type { TranscriptRecord } from "./transcript-reducer";
import { paintsSomething } from "./transcript-rows";

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
 * A send this pane made that the owner has not answered: the request id its
 * optimistic echo was painted under, which is also the id the owner's durable
 * row coalesces onto.
 *
 * The id is the ANCHOR every clear measures from, which is why the identity is
 * carried rather than a boolean: "no answer yet" is a statement about the
 * records AFTER this one, and without it the only thing left to inspect is the
 * tail of the transcript - which is the scope error review round 1 found.
 */
export type AdmittedSend = { requestId: string };

/**
 * The send a pane has admitted, read from the store's own draft row.
 *
 * The one load-bearing rule of this change, kept pure and exported (the way
 * `draftIdentityFor` and `panelIdentityFor` are) so it can be asserted rather
 * than only exercised through a panel: swapping it for the composer's local
 * `admitting` state, or dropping the `sessionId` conjunct, restores the
 * operator's dead-air report while every other test stays green.
 *
 * Both flags, deliberately. `pending` is the request being in flight;
 * `admissionAttempted` is the store's record that the request was actually
 * ISSUED, i.e. that the owner may have the message. A send that failed before
 * admission clears both, which is why a refusal shows a failure and not a
 * rung.
 *
 * `sessionId` is required because the rung is a claim about a CONVERSATION:
 * before the create returns there is no session for the owner to answer on, and
 * on that hop the composer still holds the user's text.
 */
export function admittedSendFor(
	sessionId: string | undefined,
	draft:
		| {
				pending?: boolean;
				admissionAttempted?: boolean;
				admissionRequestId?: string;
		  }
		| undefined,
): AdmittedSend | null {
	if (!sessionId || !draft?.pending || !draft.admissionAttempted) return null;
	if (!draft.admissionRequestId) return null;
	return { requestId: draft.admissionRequestId };
}

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
 * over: the reducer writes `complete` on a `notice` for exactly two things, both
 * of them an incident - "Stopped with an error" and "Interrupted" - and never
 * for its own renderer notes (a harness recovery notice, a retry line, a subagent
 * failure all omit it). That is why the test is the marker rather than the text:
 * the copy is expected to be reworded, and matching on prose would silently stop
 * matching.
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
	return recordsAfter(records, afterId).some(
		(record) => record.kind === "notice" && record.complete === true,
	);
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
			(attention.kind === "error" || attention.kind === "interrupted"),
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

export function deriveWorkingLine({
	waiting,
	compacting,
	compactingSince,
	starting,
	startingAfterId,
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
	 * The ADMITTED-SEND rung KEEPS its local zero, and that is deliberate rather
	 * than the fold being forgotten here: this expression began when THIS app
	 * sent, so the app is the clock's own producer and there is nothing older to
	 * resume. Seeding it from the runtime's `thinking` edge would be a second
	 * answer to a question this branch already has the first answer to.
	 */
	return { activity: ADMITTED_SEND_ACTIVITY, phase: "thinking" };
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
 * Exported so the rung and the composer are handed the SAME FACTS rather than
 * two constructions that can drift: the records are the list both of them render,
 * and `unavailable` is the pane's own `canonicalTranscriptSpeaks`, so neither
 * reader keeps a second copy of the rule that decides it.
 */
export function workingLineInputFor(pane: {
	waiting: boolean;
	compacting: boolean;
	compactingSince?: number;
	starting: boolean;
	startingAfterId?: string | null;
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
		gate: Boolean(pane.gate),
		unavailable: pane.unavailable,
		...folded,
		records: pane.records,
	};
}
