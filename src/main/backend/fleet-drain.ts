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
 * honest ceiling for noticing there is nothing left to wait for.
 */
export const FLEET_RETIRE_GRACE_MS = 60_000;

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
			return {
				kind: "refused",
				because: workState === "unknown" ? "unknown" : "busy",
				waitedMs,
				busy: busyRosterRows((await input.readRoster()) ?? []),
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
 * The refusal's sentence, in the app's existing remedy voice.
 *
 * Two arms, because the two kinds of not-idle are different facts about the
 * machine and the reader's next move is different for each:
 *
 * - measured `busy` - name how many turns are in flight and offer the by-hand
 *   route, since a release that cannot wait is exactly the case the host tool's
 *   `--force` exists for;
 * - `unknown` - the fleet could not be read at all, so say that rather than
 *   claiming work the app never saw. The by-hand command is offered here too,
 *   because it is the only way through.
 *
 * `command` is named only when the plan HAS one: the app may not invent a
 * command for an install it could not classify (the rule `resolveGlobalInstallPlan`
 * states), and an omitted clause is better than a wrong one.
 */
export function fleetDrainRefusalSentence(
	outcome: Extract<FleetDrainOutcome, { kind: "refused" }>,
	command?: string | null,
): string {
	const minutes = Math.max(1, Math.round(outcome.waitedMs / 60_000));
	const byHand = command
		? ` If you want the update now, run \`${command}\` yourself from a terminal.`
		: "";
	if (outcome.because === "unknown") {
		return `The app could not read which sessions are running, so it did not update the server: reading that as idle could cut off a turn that is in flight. Try again once the server is answering.${byHand}`;
	}
	const names = outcome.busy
		.slice(0, 3)
		.map((row) => row.name || row.sessionId)
		.join(", ");
	const more =
		outcome.busy.length > 3 ? ` and ${outcome.busy.length - 3} more` : "";
	const who =
		outcome.busy.length === 0
			? "A session on this machine is still running a turn"
			: `${outcome.busy.length} session${outcome.busy.length === 1 ? "" : "s"} on this machine ${outcome.busy.length === 1 ? "is" : "are"} still running a turn (${names}${more})`;
	return `${who}. The app waited ${minutes} minute${minutes === 1 ? "" : "s"} rather than cut off work in flight, and will offer this update again.${byHand}`;
}

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
	if (after === null) return [];
	const liveNow = new Set(
		after
			.filter((row) => row.liveState !== "" && row.liveState !== null)
			.map((row) => row.sessionId),
	);
	return before.filter(
		(row) =>
			row.liveState !== "" &&
			row.liveState !== null &&
			row.sessionId !== "" &&
			!liveNow.has(row.sessionId),
	);
}

export type FleetReengageResult = {
	/** The sessions the swap displaced, in snapshot order. */
	displaced: FleetRosterRow[];
	/** The ones whose runtime answered the re-engage. */
	engaged: string[];
	/** The ones it did not, with the reason, so a silent half is not a claim. */
	failed: { sessionId: string; reason: string }[];
};

/**
 * Put back the runtimes a swap displaced, in the host tool's own order.
 *
 * The order is the reference behaviour (`~/tools/lop-fleet-update`): snapshot,
 * drain, install, let the old runtimes retire, re-engage what is gone, then
 * verify. Steps 1-4 are the caller's; this is 5 and 6.
 *
 * WHY A WAIT BEFORE THE RE-ENGAGE. A displaced runtime has usually not been
 * DISPLACED yet when the install returns - the harness's convergence is a
 * build check, a settle window and a stagger - so re-engaging immediately can
 * spend a spawn on a session that was about to come back, and the new runtime
 * then races the retiring one for the session's writer lease. Waiting bounded
 * for the set to settle is what makes the engage a repair rather than a second
 * writer.
 *
 * SEQUENTIAL, deliberately. The point of a drain is that nothing is running;
 * spawning one session runtime per displaced session all at once would put a
 * burst of constructors on the machine the update just moved, which is the
 * shape the incident's own tooling avoids (it re-engages one at a time).
 */
export async function reengageDisplacedSessions(input: {
	/** The fleet as it was before the install, live rows included. */
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
	retirePollMs?: number;
	log?: (line: string) => void;
}): Promise<FleetReengageResult> {
	const graceMs = input.graceMs ?? FLEET_RETIRE_GRACE_MS;
	const pollMs = input.retirePollMs ?? FLEET_DRAIN_POLL_MS;
	const startedAt = input.now();
	let after = await input.readRoster();
	let displaced = displacedSessions(input.before, after);
	/*
	 * Wait for the set to SETTLE, not for it to empty: a session still live is
	 * one whose runtime never went away, and one that comes back on its own
	 * leaves the set as well. What is waited on is therefore both ends at once -
	 * the answer is stable when the set has not changed across a poll.
	 */
	if (displaced.length > 0) {
		let previous = displaced
			.map((row) => row.sessionId)
			.sort()
			.join(",");
		while (input.now() - startedAt < graceMs) {
			await input.sleep(pollMs);
			after = await input.readRoster();
			displaced = displacedSessions(input.before, after);
			const current = displaced
				.map((row) => row.sessionId)
				.sort()
				.join(",");
			if (current === previous) break;
			previous = current;
		}
	}
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
		`Re-engaged ${engaged.length} of ${displaced.length} displaced session(s)${failed.length > 0 ? `; ${failed.length} did not answer (${failed.map((row) => row.sessionId).join(", ")})` : ""}`,
	);
	return { displaced, engaged, failed };
}
