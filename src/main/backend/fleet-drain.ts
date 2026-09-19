import {
	type FleetRosterRow,
	type ServingWorkState,
	busyRosterRows,
} from "../backend-version-drift";

/**
 * The fleet gate: what an update must see before it may disturb the server
 * serving this app, and what it puts back if it does.
 *
 * WHY THIS EXISTS AT ALL. A restart of the app's own daemon is `stop(true)` -
 * SIGTERM, ten seconds, SIGKILL - and the harness states why that is not a safe
 * operation in `local_operator/server/retire.py`: the daemon OWNS work in that
 * process (``SchedulerService._run_tasks`` runs there), a lifespan shutdown
 * cancels it, and an idle-looking daemon supplies no guarantee a successor is
 * ready - which is why production drift handling refuses to exit on its own
 * rather than draining to a deadline. The desktop app's update copy said the
 * quiet part out loud ("a turn that is in flight is dropped while the server
 * comes back"), and on 2026-09-18 this machine lost 25 session runtimes
 * mid-turn across four backend generations.
 * The operator's standing priority is that nothing kills runtimes en masse, so
 * the app now does what the host tool `lop-fleet-update` does by hand: wait for
 * the fleet to go quiet, and re-engage what the swap displaced.
 *
 * WHAT IS *NOT* REINVENTED HERE. The busy signal is the app's existing one -
 * `servingWorkState` -> `servingWorkStateFromSessions` -> a session row's
 * `live_state === "busy"`, which the daemon's own session record documents as
 * "a turn is running" (`local_operator/resume.py`). There is deliberately no
 * second notion of "busy" in
 * this module: `readWorkState` is the manager's own reader, and the row shape
 * (`FleetRosterRow`), the busy predicate (`busyRosterRows`) and the roster
 * parse all come from `backend-version-drift.ts`, where the version-drift gate
 * already asks the same question of the same route.
 *
 * WHY A BOUND, AND WHY THE BOUND REFUSES. The drift gate holds a restart
 * without a bound because it can simply try again next check; an update press
 * is a single request whose caller is watching a panel, so its wait has an
 * end. What happens at the end is the part that matters: the app REFUSES the
 * update and says why, naming the sessions it was waiting for. It never
 * installs or restarts through a live turn on a timer, which is the "silent
 * force" the operator's rule rules out.
 */

/**
 * How long a press may wait for the fleet to drain, mirroring the host tool's
 * own default (`DEFAULT_DRAIN_S` in `~/tools/lop-fleet-update`). A release is
 * rarely urgent enough to cut off somebody's turn, and ten minutes is the
 * number the tool that does this by hand already chose; the refusal at the end
 * of it names the sessions still working, so a reader who wants to know *why*
 * the update did not run has an answer.
 */
export const FLEET_DRAIN_BUDGET_MS = 600_000;

/** How often the drain re-reads the fleet, again mirroring the host tool. */
export const FLEET_DRAIN_POLL_MS = 5_000;

/**
 * How long a displaced runtime gets to come back on its own before the app
 * re-engages it. The harness's own convergence window is a build check, a
 * settle window and a stagger (5 + 10 + 20 s) with jitter, so a minute is the
 * honest ceiling for noticing there is nothing left to wait for - and it is also
 * the bound for the one shape only the clock can end: a pre-swap runtime that
 * never retires at all (a session that went busy again after the drain, an
 * adopted daemon), where every read looks the same and only the grace stops the
 * wait.
 */
export const FLEET_RETIRE_GRACE_MS = 60_000;

/**
 * How long the pre-swap live set must be UNCHANGED before the retirement wave is
 * over.
 *
 * WHY A SETTLE WINDOW AND NOT "wait for the set to stop repeating" (review
 * round 1, M1 = QA Q-2). A runtime does not go cold the moment the restart
 * returns: it retires ITSELF, and only after it has seen the new generation on a
 * build check (`BUILD_CHECK_S = 5 s`), waited for the marker to have settled
 * (`BUILD_SETTLE_S = 10 s`) and then slept a staggered slice of
 * `BUILD_STAGGER_S = 20 s` (`local_operator/buildwatch.py`; the same numbers the
 * grace above quotes). So the set of pre-swap runtimes still alive legitimately
 * stops changing and then keeps stopping for a stride - while a wait that ends on
 * the first repeat, or that is skipped because the first read shows nothing
 * displaced yet, ends BEFORE the wave it exists for. 30 s is that stride
 * (`BUILD_SETTLE_S + BUILD_STAGGER_S`): a pre-swap runtime cannot still be on its
 * way out that long after the last read that changed, and waiting longer only
 * holds the panel.
 *
 * The interval is a field of the re-engage rather than a bare constant used
 * inline, so a test can pin both ends of the rule (the set that settles early, and
 * the set that never does) on a virtual clock instead of in real seconds.
 */
export const FLEET_RETIRE_SETTLE_MS = 30_000;

export type FleetDrainOutcome =
	| { kind: "drained"; waitedMs: number; fleet: number }
	| {
			kind: "refused";
			/**
			 * `busy` is a measured busy fleet; `unknown` is a read that could not be
			 * taken at all. They are different facts and the refusal says which.
			 */
			because: "busy" | "unknown";
			waitedMs: number;
			/** The sessions still mid-turn when the budget ran out, when readable. */
			busy: FleetRosterRow[];
			/**
			 * For the `unknown` arm: whether the server ANSWERED and refused this
			 * app's credentials (401/403), rather than never answering at all.
			 *
			 * Both land in `unknown` and both block the update, which is the safe
			 * direction either way - but they are not the same next step for the
			 * reader, and a refusal that told a signed-out app to "try again once the
			 * server is answering" would send them at a door that is already open
			 * (QA round 1, observation b). Optional, so an older or simpler reader of
			 * the outcome keeps the generic arm.
			 */
			credentialsRefused?: boolean;
	  };

/**
 * Wait until no session is running a turn, or until the budget runs out.
 *
 * The FIRST read decides whether anything is waited for at all, and it is taken
 * before the caller installs anything: on a quiet machine this returns in one
 * round trip, which is the ordinary case and must not cost a poll interval.
 *
 * `unknown` is waited on rather than refused immediately, and that is the
 * deliberate direction: a read that could not be taken is not evidence that the
 * machine is quiet (the same rule `servingWorkState` states), and a daemon that
 * is rotating or briefly busy answers again a moment later. At the end of the
 * budget it is still a refusal - never a restart under work the app could not
 * see.
 */
export async function waitForFleetIdle(input: {
	readWorkState: () => Promise<ServingWorkState>;
	/**
	 * The session rows, for naming who was still working. Only read when the
	 * budget expires, so the poll itself stays one small request.
	 */
	readRoster: () => Promise<FleetRosterRow[] | null>;
	/**
	 * WHICH unreadable a refusal on the `unknown` arm was, answered from the
	 * transport's own reading rather than guessed from the verdict: a server that
	 * answered 401 and a socket that never answered both read as `unknown`, and
	 * only the transport knows which happened. Read only when the budget expires
	 * and the refusal is being composed, so the poll pays nothing for it.
	 */
	readUnreadableReason?: () => "unreachable" | "refused-credentials";
	sleep: (ms: number) => Promise<void>;
	now: () => number;
	budgetMs?: number;
	pollMs?: number;
	/** Called before each wait, so a panel can say the update is waiting. */
	onWait?: (elapsedMs: number, workState: ServingWorkState) => void;
}): Promise<FleetDrainOutcome> {
	const budgetMs = input.budgetMs ?? FLEET_DRAIN_BUDGET_MS;
	const pollMs = input.pollMs ?? FLEET_DRAIN_POLL_MS;
	const startedAt = input.now();
	let workState = await input.readWorkState();
	let waitedMs = 0;
	while (workState !== "idle") {
		waitedMs = input.now() - startedAt;
		if (waitedMs >= budgetMs) {
			const unknown = workState === "unknown";
			/*
			 * THE REASON IS READ BEFORE THE ROSTER, deliberately (review round 2,
			 * R2-n1). `readUnreadableReason` answers from the transport's own
			 * per-request reading, and `servingSessionFleet` OVERWRITES it - so a poll
			 * that saw a 401 followed by a failed roster read used to compose its
			 * refusal from the later, different failure and take the "try again once
			 * the server is answering" arm about a door that was already open. The two
			 * fields of one refusal must describe one reading of the server.
			 */
			const refusedCredentials =
				unknown && input.readUnreadableReason?.() === "refused-credentials";
			return {
				kind: "refused",
				because: unknown ? "unknown" : "busy",
				waitedMs,
				busy: busyRosterRows((await input.readRoster()) ?? []),
				credentialsRefused: refusedCredentials,
			};
		}
		input.onWait?.(waitedMs, workState);
		await input.sleep(Math.min(pollMs, budgetMs - waitedMs));
		workState = await input.readWorkState();
	}
	return {
		kind: "drained",
		waitedMs: input.now() - startedAt,
		fleet: (await input.readRoster())?.length ?? 0,
	};
}

/**
 * The refusal's sentence, in the app's existing remedy voice - and in TWO
 * PARTS, because the panel that shows it has two jobs.
 *
 * WHY A LEAD LINE AND A BODY, separated by a blank line (review round 1, D5).
 * The panel used to render this as one muted five-line paragraph in which the
 * count and the session names - the reason the update did not run, and the only
 * thing a reader can act on - sat in parentheses halfway down. The producer is
 * the one author of what is said (a renderer that composed its own sentence for
 * the same state is how the two come to disagree), so the SHAPE travels with the
 * words: the lead line is the actionable fact, the body is the explanation, and
 * the renderer gives them different ink. One blank line is the same seam
 * convention `installerOutput` already uses.
 *
 * Two arms, because the two kinds of not-idle are different facts about the
 * machine and the reader's next move is different for each:
 *
 * - measured `busy` - name how many turns are in flight and offer the by-hand
 *   route, since a release that cannot wait is exactly the case the host tool's
 *   `--force` exists for;
 * - `unknown` - the fleet could not be read at all, so say that rather than
 *   claiming work the app never saw, and say WHICH unreadable it was when the
 *   server answered and refused the app's credentials.
 *
 * The by-hand command is NOT in this sentence. It travels as its own field on
 * the report and renders as the panel's existing `CommandBlock`, which is what
 * the sibling manual panel has always done (design D2): the sentence used to
 * print it as literal backticks, in body ink, with no way to copy it.
 */
export function fleetDrainRefusalSentence(
	outcome: Extract<FleetDrainOutcome, { kind: "refused" }>,
	/**
	 * Whether the install this press was asked for has already landed.
	 *
	 * WHY THE SENTENCE TAKES IT (design round 2, D6). The two arms of a refusal used
	 * to be composed by two authors - this function wrote "Nothing was installed and
	 * the server keeps running the build it loaded" and the caller appended "The
	 * install itself has landed" - so the panel that keyed its heading on the second
	 * fact printed both clauses in one paragraph, three lines apart, about one
	 * event. The facts are alternatives, not additions: on the install leg nothing
	 * was installed, and on the restart legs the build is on disk and the bounce is
	 * what was held back. One author, two arms.
	 */
	installLanded = false,
): string {
	const minutes = Math.max(1, Math.round(outcome.waitedMs / 60_000));
	const waited = `${minutes} minute${minutes === 1 ? "" : "s"}`;
	/**
	 * The closing clause, which is the only place the two arms differ: what the app
	 * did or did not leave on disk, and what the server is running as a result.
	 */
	const closing = installLanded
		? "The install itself has landed, and the server keeps running the build it loaded until it can restart onto it; the app will offer this update again."
		: "Nothing was installed and the server keeps running the build it loaded; the app will offer this update again.";
	if (outcome.because === "unknown") {
		const lead = outcome.credentialsRefused
			? "The server refused this app's credentials, so the app could not read which sessions are running on this machine."
			: "The app could not read which sessions are running on this machine, so it did not update the server.";
		return `${lead}\n\nReading an unreadable fleet as idle could cut off a turn that is in flight, so the app waited ${waited} and then stopped. ${closing}`;
	}
	const names = outcome.busy
		.slice(0, 3)
		.map((row) => row.name || row.sessionId)
		.join(", ");
	const more =
		outcome.busy.length > 3 ? ` and ${outcome.busy.length - 3} more` : "";
	/*
	 * The zero-busy fallback says what was MEASURED and no more: a refused roster
	 * read at the end of the budget leaves `busy` empty, and the old sentence
	 * asserted "A session on this machine is still running a turn" about a fleet it
	 * had just failed to read (review round 1, NIT n3).
	 */
	const lead =
		outcome.busy.length === 0
			? "The app could not name the sessions that were still working."
			: `${outcome.busy.length} session${outcome.busy.length === 1 ? " is" : "s are"} still running a turn on this machine: ${names}${more}.`;
	return `${lead}\n\nThe app waited ${waited} for them to finish and then stopped rather than cut a turn short. ${closing}`;
}

/**
 * Whether a roster row is one with a LIVE runtime behind it.
 *
 * `liveState === ""` is the catalogue's spelling for a session with no record at
 * all - a conversation on disk - so it is not live, and neither is a row from a
 * daemon that does not publish the field. The row id has to be there too: an
 * engage is addressed by it.
 */
export const isLiveRow = (row: FleetRosterRow): boolean =>
	row.liveState !== "" && row.liveState !== null && row.sessionId !== "";

/**
 * Whether one session has a runtime behind it, from a roster read.
 *
 * Exported because the re-engage's own verification asks it (`session-engage.ts`
 * decides whether a lease actually produced a runtime by asking this of the same
 * roster the gate reads), and a second spelling of "live" is how the engage and
 * the diff would come to disagree about what came back. Null is a roster that
 * could not be read, which is not evidence either way.
 */
export const sessionHasRuntime = (
	rows: readonly FleetRosterRow[] | null,
	sessionId: string,
): boolean | null => {
	if (rows === null) return null;
	return rows.some((row) => row.sessionId === sessionId && isLiveRow(row));
};

/**
 * The ids of the rows that are live, or null when the roster did not answer.
 *
 * One definition, because three readers ask it: the displaced diff below and
 * both ends of the re-engage's retire wait. A second spelling of "live" is how
 * the wait and the diff would come to disagree about what left.
 */
const liveRosterIds = (
	rows: readonly FleetRosterRow[] | null,
): Set<string> | null => {
	if (rows === null) return null;
	return new Set(rows.filter(isLiveRow).map((row) => row.sessionId));
};

/**
 * The sessions a swap displaced: live in the snapshot, not live now.
 *
 * A COLD ROW IS NOT A LIVE ONE. `liveState === ""` is the catalogue's spelling
 * for a session with no record at all - a conversation on disk - so a session
 * that was live before and is cold now is exactly a runtime that went away,
 * which is what gets re-engaged. A session absent from the second listing is
 * displaced too: it did not report at all.
 */
export function displacedSessions(
	before: readonly FleetRosterRow[],
	after: readonly FleetRosterRow[] | null,
): FleetRosterRow[] {
	/*
	 * A read that could not be taken is not a pile of displaced sessions. Null means
	 * the roster did not answer, and an empty `liveNow` built from it would report
	 * every live session on the machine as gone - which is an engage storm on a
	 * daemon that merely failed to answer once.
	 */
	const liveNow = liveRosterIds(after);
	if (liveNow === null) return [];
	return before.filter((row) => isLiveRow(row) && !liveNow.has(row.sessionId));
}

export type FleetReengageResult = {
	/** The sessions the swap displaced, in snapshot order. */
	displaced: FleetRosterRow[];
	/** The ones whose runtime answered the re-engage. */
	engaged: string[];
	/** The ones it did not, with the reason, so a silent half is not a claim. */
	failed: { sessionId: string; reason: string }[];
	/**
	 * The pre-swap sessions still running when the wait ended, in snapshot order.
	 *
	 * Not a failure and not a displaced session: their runtime is still there, so
	 * there is nothing to put back. It is reported because it is the arm the wait
	 * cannot see the end of - an idle-gated retirement has no clock bound (a runtime
	 * that declined a build because it had work leaves when its turn ends) - so a
	 * caller reading only `displaced` would record "nothing to do" about sessions the
	 * app stopped watching one moment before they went cold.
	 */
	stillResident: FleetRosterRow[];
};

/**
 * The union of two fleet snapshots, deduplicated by session id.
 *
 * WHY A UNION IS THE HONEST DIFF ON ONE ROUTE (review round 1, M2). A rebuild
 * reinstalls this machine's checkout IN PLACE, so runtimes it kills vanish
 * between the install and the restart - a diff taken only across the restart
 * cannot see them, because they were already gone when the pre-restart snapshot
 * was read. The union of the two readings is still "what actually vanished"
 * (every member was live when one of them was taken), and it is why the install
 * leg's snapshot is kept rather than dropped. Re-engaging a session that retired
 * on its own during a rebuild is the acceptable side of that trade: a rebuild
 * that rewrote the tree a runtime was reading is not a retirement anybody can
 * tell apart from a kill, and an idle runtime is cheaper than a lost one.
 *
 * Null is a snapshot that could not be read, and it contributes nothing: a union
 * with an unreadable side is the readable side, or null when both failed.
 */
export function unionFleetSnapshots(
	first: readonly FleetRosterRow[] | null,
	second: readonly FleetRosterRow[] | null,
): FleetRosterRow[] | null {
	if (first === null) return second === null ? null : [...second];
	if (second === null) return [...first];
	const seen = new Set(first.map((row) => row.sessionId));
	return [...first, ...second.filter((row) => !seen.has(row.sessionId))];
}

/**
 * Put back the runtimes a swap displaced, in the host tool's own order.
 *
 * The order is the reference behaviour (`~/tools/lop-fleet-update`): snapshot,
 * drain, install, let the old runtimes retire, re-engage what is gone, then
 * verify. Steps 1-4 are the caller's; this is 5 and 6.
 *
 * WHY A WAIT BEFORE THE RE-ENGAGE, AND WHY IT IS NOT SKIPPED. A displaced
 * runtime has usually not been DISPLACED yet when the restart returns - the
 * harness's convergence is a build check, a settle window and a stagger, and
 * session runtimes are separate processes that survived the daemon bounce - so
 * re-engaging on the first read either finds nothing (and, as this used to, waits
 * for nothing) or spawns a successor that races the retiring runtime for the
 * session's writer lease. The wait is therefore keyed on the PRE-SWAP LIVE SET,
 * which is the thing that empties as the wave passes: it is entered even when the
 * first read shows nothing displaced yet (that read is the ordinary shape
 * immediately after a restart), and it ends only when the wave is genuinely over
 * - see `FLEET_RETIRE_SETTLE_MS`.
 *
 * SEQUENTIAL, deliberately. The point of a drain is that nothing is running;
 * spawning one session runtime per displaced session all at once would put a
 * burst of constructors on the machine the update just moved, which is the
 * shape the incident's own tooling avoids (it re-engages one at a time).
 *
 * IDEMPOTENT, AND IT IS THE READ THAT MAKES IT SO. The engage is issued for the
 * sessions the LAST read shows gone and for no others, so a runtime that came
 * back on its own is never spawned twice, and the whole thing may be run again
 * after a second restart without inventing work.
 */
export async function reengageDisplacedSessions(input: {
	/** The fleet as it was IMMEDIATELY BEFORE the swap, live rows included. */
	before: readonly FleetRosterRow[];
	/** Read the fleet as it is now, for the retire wait and the verify read. */
	readRoster: () => Promise<FleetRosterRow[] | null>;
	/**
	 * Start one session's runtime. Resolves true when the daemon took the
	 * engage; a false or a throw is reported, never swallowed.
	 */
	engage: (row: FleetRosterRow) => Promise<boolean>;
	sleep: (ms: number) => Promise<void>;
	now: () => number;
	graceMs?: number;
	/** How long the pre-swap live set must hold still: `FLEET_RETIRE_SETTLE_MS`. */
	settleMs?: number;
	retirePollMs?: number;
	log?: (line: string) => void;
}): Promise<FleetReengageResult> {
	const graceMs = input.graceMs ?? FLEET_RETIRE_GRACE_MS;
	const settleMs = input.settleMs ?? FLEET_RETIRE_SETTLE_MS;
	const pollMs = input.retirePollMs ?? FLEET_DRAIN_POLL_MS;
	const startedAt = input.now();
	const snapshot = input.before.filter(isLiveRow);
	/*
	 * Nothing was running before the swap, so nothing can have been displaced by
	 * it: a machine whose sessions were all cold has no runtime to put back, and
	 * this is the one arm that may answer without reading anything. It is NOT the
	 * "first read shows nothing displaced" arm - see the loop below.
	 */
	if (snapshot.length === 0)
		return { displaced: [], engaged: [], failed: [], stillResident: [] };
	const snapshotIds = snapshot.map((row) => row.sessionId);
	/**
	 * The pre-swap sessions still live in a read, or null when it did not answer.
	 * A failed read is NO INFORMATION rather than "everything retired": treating
	 * it as an empty set would call every live session displaced and spawn a
	 * runtime for each of them.
	 */
	const stillLiveIn = (
		rows: readonly FleetRosterRow[] | null,
	): Set<string> | null => {
		const live = liveRosterIds(rows);
		if (live === null) return null;
		return new Set(snapshotIds.filter((id) => live.has(id)));
	};
	let after = await input.readRoster();
	let stillLive = stillLiveIn(after) ?? new Set(snapshotIds);
	let lastChangeAt = input.now();
	/*
	 * WHETHER THE WAVE HAS BEEN SEEN TO MOVE AT ALL, which is the difference between
	 * a fleet that has NOT BEGUN to retire and one that has finished (review round 2,
	 * R2-M2). `lastChangeAt` used to start at the call's own first instant, so a
	 * quiet pre-swap set - the ordinary shape for the first seconds after a restart,
	 * because a runtime retires on its own build check - left the loop free to end
	 * after ONE stride from the call. The wave's own horizon is up to ~35 s after the
	 * marker (`BUILD_CHECK_S + BUILD_SETTLE_S + BUILD_STAGGER_S`, and the marker is
	 * published before the drain), so that stride expired before the first
	 * retirement had a chance to land: wait ended at 30 s, `engaged=[]`, and the
	 * unwatched session lost its runtime anyway.
	 */
	let waveMoved = stillLive.size < snapshotIds.length;
	/*
	 * THE WAIT ENDS THREE WAYS, and only one of them is a stride. Two are facts about
	 * the fleet rather than about the clock:
	 *
	 * - the pre-swap live set is EMPTY, i.e. every pre-swap runtime has left - the
	 *   reference tool's own exit (`~/tools/lop-fleet-update`'s `wait_for_retire`
	 *   returns the moment its pid set is empty) and the one arm where waiting longer
	 *   cannot find anything;
	 * - the wave has MOVED and then held still for a full convergence stride, which is
	 *   the statement "nothing more is coming" the stride was always meant to make;
	 * - the grace ran out (a runtime that is never leaving - an idle-gated retirement
	 *   after a turn that outlasted the wait, or a session that went busy again).
	 *
	 * A repeated set BEFORE anything has moved is not any of those: it is a wave that
	 * has not started, and ending there is what the old rule did one poll after the
	 * restart. A read that could not be taken is no information rather than a move, so
	 * it neither ends the wait nor resets its clock.
	 */
	for (;;) {
		const elapsed = input.now() - startedAt;
		if (elapsed >= graceMs) break;
		if (stillLive.size === 0) break;
		if (waveMoved && input.now() - lastChangeAt >= settleMs) break;
		await input.sleep(Math.min(pollMs, Math.max(1, graceMs - elapsed)));
		after = await input.readRoster();
		const next = stillLiveIn(after);
		if (next === null) continue;
		if (
			next.size !== stillLive.size ||
			[...next].some((id) => !stillLive.has(id))
		) {
			stillLive = next;
			lastChangeAt = input.now();
			waveMoved = true;
		}
	}
	/*
	 * LOOK AGAIN (review round 2, R2-M2). The engage set is the difference the LAST
	 * read shows, and the waiter's last read is up to one poll old by the time the
	 * loop leaves - a retirement that landed inside that window would be named by a
	 * read taken a moment later and missed by the one the diff is built from. This is
	 * also the read a full-grace exit needs: at the grace the question is not "did the
	 * wave stop" but "what is gone NOW", and the answer has to be a fresh reading
	 * rather than the one that expired the clock.
	 */
	const finalRead = await input.readRoster();
	if (finalRead !== null) after = finalRead;
	const displaced = displacedSessions(input.before, after);
	/*
	 * WHAT IS STILL LIVE IS NAMED, NOT DROPPED, AND NOTHING IS COMING FOR IT (review
	 * round 3, R3-m1). A pre-swap runtime still resident when the wait ends is not
	 * "nothing to do": it is a runtime that declined to retire - an idle-gated one
	 * retires when its TURN ends, which no clock here can cover - and its session has
	 * no runtime the moment it leaves.
	 *
	 * THIS USED TO SAY THE CALLER'S OWN REPAIR WALKS WOULD ACT ON IT, AND THERE ARE
	 * NONE. Every caller of this function is `reengageFleetAfterRestart`
	 * (`update-service.ts`, both update paths), and it reports what this returns and
	 * then stops; nothing in `src/main` re-engages a session after that report, and
	 * the shipped log line on the other side says so plainly ("will go cold on their
	 * own schedule"). So the honest statement is the loss rather than a mechanism:
	 * the app has stopped watching, and that session goes cold on its own schedule
	 * with nothing left to put it back. Naming it is the difference between a log
	 * that says that and one that claims the fleet had nothing left to put back.
	 *
	 * TWO WAYS A MEMBER CAN STILL BE HERE, and neither is repaired by this function:
	 * the grace ran out (the arm above), or the wave MOVED and then held still for a
	 * full convergence stride - which ends the wait early BY DESIGN, and so can end it
	 * while a member whose own retirement was more than one stride behind the last
	 * movement is still live. Both arms report through this one field, and the stride
	 * arm is the narrow one (the wave's own stagger is 20 s, so a >30 s gap between
	 * retirements is the unusual shape) - narrow, and named rather than covered.
	 */
	const stillResident = snapshot.filter((row) => stillLive.has(row.sessionId));
	const engaged: string[] = [];
	const failed: { sessionId: string; reason: string }[] = [];
	for (const row of displaced) {
		try {
			if (await input.engage(row)) engaged.push(row.sessionId);
			else
				failed.push({
					sessionId: row.sessionId,
					reason: "the server did not take the engage",
				});
		} catch (error) {
			failed.push({
				sessionId: row.sessionId,
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}
	input.log?.(
		`Re-engaged ${engaged.length} of ${displaced.length} displaced session(s)${failed.length > 0 ? `; ${failed.length} did not answer (${failed.map((row) => row.sessionId).join(", ")})` : ""}${stillResident.length > 0 ? `; ${stillResident.length} pre-swap runtime(s) still resident when the wait ended (${stillResident.map((row) => row.sessionId).join(", ")}), which nothing re-engages afterwards and which go cold on their own schedule` : ""}`,
	);
	return { displaced, engaged, failed, stillResident };
}
