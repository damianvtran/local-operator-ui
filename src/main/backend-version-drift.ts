/**
 * Whether the process serving this app is running the code that is installed.
 *
 * THE DEFECT THIS EXISTS TO REMOVE, in the operator's own case. The desktop app's
 * backend daemon started on Sep 16 15:25 loaded build 0.56.2. The environment
 * under it was updated in place to 0.56.11 at 04:35 the next morning. The process
 * was never restarted, so it went on serving 0.56.2 out of memory for the rest of
 * the day - and every update check called it up to date, because the comparison
 * was installed-against-published and never running-against-installed. A fix that
 * had shipped hours earlier was simply not in effect, and nothing in the app could
 * see that.
 *
 * WHICH READING IS "RUNNING", and the trap that cost the day: NEVER `/health`.
 * The daemon computes that payload's `version` from the metadata installed on
 * disk at the moment it answers (`installed_version() or
 * importlib.metadata.version("local-operator")` in `server/routes/health.py`), so
 * a process running old code from memory reports the NEWER on-disk version and the
 * staleness disappears exactly when it matters. Read the same process that
 * answered `/health` with 0.56.8: its own serve record said 0.56.2.
 *
 * The honest signal is the daemon's own startup record -
 * `~/.local-operator/run/serve/<pid>.json`, written by `server/registry.py` when
 * the process starts and never re-read afterwards - so its `version` is the build
 * the running process actually loaded. `serveRecord` below is that read, and the
 * trap is pinned BEHAVIOURALLY rather than by source text: the update fixture
 * scripts the daemon's `/health` to report the NEWER on-disk version while its
 * record reports the one it booted with, so its drift case passes only while the
 * running reading comes from the record (`scripts/update-robustness.test.mjs`,
 * "a server that booted from an older build is restarted onto the install").
 *
 * Pure by construction (no Electron import), so `scripts/*.test.mjs` can bundle
 * the shipped TypeScript and call these decisions directly.
 *
 * THE SECOND HALF OF THE DEFECT, and why the readings below are shaped the way
 * they are. The comparison above is only as good as the two readings handed to
 * it, and in the operator's own modes both came out wrong. The INSTALL side was
 * the plan's `installedInstallVersion`, which is null for every mode whose
 * environment the app owns (`APP_BUNDLED_VENV` - the mode the app spawns its
 * own daemon in), so the drift was computed against nothing and the check
 * returned before it logged anything. The OWNER side was
 * `!isUsingExternalBackend()`, which is true for any daemon this app ADOPTED -
 * including the daemon a previous app process started, which is the ordinary
 * desktop lifecycle, so the app refused to restart a server it had started
 * itself. Sixty-six `APP_BUNDLED_VENV` and 400 `EXISTING_SERVER` rows, zero
 * `GLOBAL_INSTALL`, is the operator's log: the two modes in which the repair
 * could not fire, and only those. `driftInstallReading` and
 * `servingInstallIsAppOwned` are what make each side answerable in those modes:
 * the install the daemon booted from is read from the daemon's own environment,
 * and ownership from what actually started the process.
 */

import { readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { type ServeRecord, parseRecord } from "./backend/discovery";
import { isReadableVersion } from "./update-check-verdict";
import { compareVersions } from "./update-install";

/**
 * What the two readings say about each other.
 *
 * `stale` carries both versions because every sentence about it needs both: the
 * log line, the reader's report, and the drift-restart's own "was X, install is
 * Y".
 */
export type BackendVersionDrift =
	| { kind: "stale"; bootVersion: string; installVersion: string }
	| { kind: "none"; reason: DriftAbsence };

/**
 * Why there is nothing to act on.
 *
 * Separate members rather than one `none`, because each is a different absence and
 * the log has to be able to say which one it saw: a daemon too old to write a
 * version into its record is not the same fact as two equal readings, and "we could
 * not read it" must never be reported as "it is current".
 */
export type DriftAbsence =
	/** No record field, no readable record, no record at all. */
	| "no-boot-reading"
	/** The install has no readable version (a dev build, an unreadable marker). */
	| "no-install-reading"
	/** A version arrived and cannot be parsed as a version. */
	| "unreadable-boot"
	| "unreadable-install"
	/** Both readings are the same version: the process loaded what is installed. */
	| "equal"
	/** The running build is NEWER than the install: a downgrade, not a skew to fix. */
	| "running-ahead"
	/** Both parsed, neither ordered: this cannot say which is older, so it says so. */
	| "unorderable";

/**
 * Compare the daemon's boot reading against the install on disk.
 *
 * The order of the gates is the order of the evidence, and every one of them
 * answers "no" rather than guessing: an absent or unreadable reading on either side
 * and an unorderable pair all leave the skew unresolved rather than acted on. Only
 * a boot reading that is strictly OLDER than the install is `stale`.
 *
 * A boot reading NEWER than the install is deliberately not `stale`. That is a
 * downgrade on disk (or a leftover record from a newer build), and restarting there
 * would replace a newer serving process with an older install - the opposite of the
 * repair, on the strength of a comparison that cannot tell which side is meant to
 * win.
 */
export function backendVersionDrift(
	bootVersion: string | null | undefined,
	installVersion: string | null | undefined,
): BackendVersionDrift {
	const boot = bootVersion?.trim() ?? "";
	const install = installVersion?.trim() ?? "";
	if (boot === "") return { kind: "none", reason: "no-boot-reading" };
	if (install === "") return { kind: "none", reason: "no-install-reading" };
	if (!isReadableVersion(boot))
		return { kind: "none", reason: "unreadable-boot" };
	if (!isReadableVersion(install))
		return { kind: "none", reason: "unreadable-install" };
	const order = compareVersions(boot, install);
	if (order === null) return { kind: "none", reason: "unorderable" };
	if (order === 0) return { kind: "none", reason: "equal" };
	if (order > 0) return { kind: "none", reason: "running-ahead" };
	return { kind: "stale", bootVersion: boot, installVersion: install };
}

/**
 * The serve record of the daemon with this pid, or null.
 *
 * A pid that is not a positive integer is an absence, not a lookup: this must never
 * be handed `undefined` and answer with somebody else's record. A missing file, a
 * torn read and a malformed document are the same absence for the same reason the
 * record parser refuses to guess (see `parseRecord`'s own note).
 */
export function serveRecord(
	pid: number | null | undefined,
	dir: string,
): ServeRecord | null {
	if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0)
		return null;
	try {
		const file = join(dir, `${pid}.json`);
		return parseRecord(JSON.parse(readFileSync(file, "utf8")), file).record;
	} catch {
		return null;
	}
}

/**
 * The version the daemon with this pid booted with, from its own serve record.
 *
 * A record written by an install predating this field parses its `version` as
 * `""`, which is this function's `null`. That case falls to the record's absence
 * handling rather than to `/health`: an old install that cannot say what it
 * booted with has not earned a version comparison.
 */
export function serveRecordVersion(
	pid: number | null | undefined,
	dir: string,
): string | null {
	const version = serveRecord(pid, dir)?.version.trim() ?? "";
	return version === "" ? null : version;
}

/**
 * What the serving process's own record says about the install it booted from.
 *
 * This is the reading the whole repair is built on, and it is a reading of the
 * RECORD rather than of `/health` - see the module docstring for the trap. The
 * type is deliberately the record's own fields, transcribed once here so both
 * arms that reach a record (an adopted daemon's parsed record, and this app's
 * spawned child keyed by pid) produce the same shape.
 */
export type ServingInstallReadings = {
	/** The build the process loaded: the record's `version`, or null when absent. */
	bootVersion: string | null;
	/** `sys.prefix` the process runs from - "" when the record does not say. */
	prefix: string;
	/** `uv-tool` / `pipx` / `pip` / `editable` / `unknown`. */
	installKind: string;
	/**
	 * Whether the record itself says the APP started this daemon.
	 *
	 * `desktop` is the daemon's answer to "is the desktop plane governed", which
	 * is true both for a daemon the app started and for one the app has merely
	 * CLAIMED since; `claim_key` is spent by exactly that claim (`registry.py`),
	 * so an unspent key is the daemon's own word for the first case. Evidence
	 * rather than proof - a build predating the handshake publishes an empty key
	 * either way - which is why `servingInstallIsAppOwned` accepts the environment
	 * test beside it.
	 */
	startedByApp: boolean;
};

/** The readings above, from a record that may be absent. */
export function servingInstallReadings(
	record: ServeRecord | null,
): ServingInstallReadings {
	const version = record?.version?.trim() ?? "";
	return {
		bootVersion: version === "" ? null : version,
		prefix: record?.prefix?.trim() ?? "",
		installKind: record?.install_kind?.trim() ?? "",
		startedByApp: record?.desktop === true && (record.claim_key ?? "") === "",
	};
}

/** Whether `path` is `root` itself or below it. Neither has to exist. */
function isInside(root: string, path: string): boolean {
	if (root === "" || path === "") return false;
	const rel = relative(root, path);
	return (
		rel === "" ||
		(!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
	);
}

/**
 * Whether a prefix is one of the environments THIS instance manages.
 *
 * The roots are the caller's, because they are the one part of this question
 * that is a fact about this process rather than about the record: the managed
 * environment tree for this instance's packaged/dev scope, plus the pre-split
 * venv names. Kept as a parameter so the rule below stays a function of strings
 * and a test can drive it with the roots it declares.
 */
export function servingInstallIsAppManaged(
	prefix: string,
	managedEnvironmentRoots: string[],
): boolean {
	return managedEnvironmentRoots.some((root) => isInside(root, prefix));
}

/**
 * Whether this app may restart the daemon whose record this is, and why not when
 * it may not.
 *
 * ONE GROUND, and the finding that removed the other two: `restart()` is
 * `stop(true)` + `start()`, and `stop()` can only terminate a generation this
 * process HOLDS (`BackendServiceManager.stopGeneration` - "A port or process name
 * is not ownership"). A daemon this app adopted has no generation here, so a
 * `restart()` of it is a stop that stops nothing followed by a `start()` that
 * re-discovers and re-adopts the same live process. QA round 1 (Q1) drove exactly
 * that on the real bundle: the skew was detected, no SIGTERM was ever sent, the pid
 * never moved, and the app logged "Restarted the server onto the installed build"
 * anyway - then latched itself inert on the pair it had not moved. Reporting a
 * repair that did not happen is the defect this PR exists to delete, so the
 * ownership question is now asked with what the repair can actually act on.
 *
 * WHY THE PROCESS IS NOT MOVED SOME OTHER WAY, because "this app built that
 * environment" reads as permission and is not. The daemon's own contract refuses
 * the exit: `server/retire.py` announces a build change in the record and keeps
 * serving, because "a marker also supplies no guarantee that a successor is
 * ready", because "neither an idle-looking daemon nor a claimed desktop daemon may
 * therefore latch, refuse, or exit on build drift", and because its own lifespan
 * shutdown cancels scheduler work the daemon owns. The app has no successor-ready
 * handshake to offer in place of that, and a pid is not a handle: signalling a
 * number this process never spawned is the recycled-pid write the codebase refuses
 * everywhere else. So the honest answer for an adopted daemon is the second half of
 * QA's own choice - the skew is REPORTED and the process is left running - and
 * `startedByEarlierAppRun` below is what makes the sentence that reports it say
 * which of the two cases the reader is in.
 */
export type ServingOwnership = {
	/**
	 * Whether THIS app process can stop the serving daemon now - the only ground
	 * `restart()` acts on, and therefore the only ground the repair may fire on.
	 */
	owned: boolean;
	/** Why, in the log's own words. */
	because: string;
	/**
	 * Whether an EARLIER Local Operator started it: an unspent claim key in its own
	 * record, or a prefix inside an environment this instance manages.
	 *
	 * NOT a ground for the repair, and deliberately still read: it is the fact that
	 * distinguishes "the app built this daemon and has lost the handle to it - the
	 * ordinary desktop lifecycle" from "something outside this app started it", and
	 * the refusal sentence has to say which one, because only the first is a daemon
	 * the reader's own Local Operator put there.
	 */
	startedByEarlierAppRun: boolean;
};

export function servingInstallIsAppOwned(input: {
	spawnedByThisProcess: boolean;
	readings: ServingInstallReadings;
	managedEnvironmentRoots: string[];
}): ServingOwnership {
	const root = input.managedEnvironmentRoots.find((candidate) =>
		isInside(candidate, input.readings.prefix),
	);
	const builtByApp = input.readings.startedByApp || root !== undefined;
	if (input.spawnedByThisProcess)
		return {
			owned: true,
			because: "this app process started it and still holds the process",
			startedByEarlierAppRun: builtByApp,
		};
	const where =
		input.readings.prefix === ""
			? "it names no environment this app can identify"
			: `it runs from ${input.readings.prefix}`;
	if (root !== undefined)
		return {
			owned: false,
			because: `${where}, an environment this app manages, but the process is not one this app run started and this app can only stop the generation it holds`,
			startedByEarlierAppRun: true,
		};
	return {
		owned: false,
		because: input.readings.startedByApp
			? `${where}, and its own record says an earlier Local Operator started it, but this app run does not hold that process`
			: `${where}, which this app does not manage`,
		startedByEarlierAppRun: builtByApp,
	};
}

/**
 * Which install the install reading describes.
 *
 * `unknown` is a first-class answer rather than a quiet fallback: it is what the
 * decision refuses to restart on, and what the log has to say out loud, because
 * the alternative - comparing a boot reading against an install the process does
 * not run from - reports a skew that may not exist and then acts on it.
 */
export type DriftInstallSource =
	/** The install the serving process runs from, read on disk at its own root. */
	| "serving-install"
	/** The two readings are not known to describe the same install. */
	| "unknown";

/**
 * The install reading the boot reading must be compared against.
 *
 * ONE ANSWER, and it is #318's (`fix(update-check): judge the install that serves
 * the app, not the one the shim names`), which landed on `main` while this branch
 * was open and answers the same question this function was invented for. It reads
 * the root `/health` names (`prefix`, with the backend's own `install_kind` beside
 * it) and takes the version on disk at THAT root, falling back to the shim's
 * install only when the server named no root at all - which is the one case this
 * function still has to refuse, and the reason it exists rather than the caller
 * comparing `plan.installedInstallVersion` blindly.
 *
 * What this branch's own first cut added beside it - a second reading of the same
 * question from `identity.venvPrefix` and `/health`'s version, `driftInstallReading`
 * picking between them by prefix equality - is RETIRED rather than reconciled line
 * by line: two functions answering "which install is this about" is how the panel,
 * the installer and this check come to disagree, and #318's answer is the stronger
 * of the two (it reads the serving root's own dist-info, and corrects the one shape
 * where that number is stale by construction - an editable or checkout-built
 * install, where `/health` carries the real version). The trap this module documents
 * is untouched by the reconciliation: `/health`'s version is still never the RUNNING
 * side, only - when the install is editable - the install side.
 */
export function driftInstallReading(input: {
	planVersion: string | null;
	/**
	 * Whether the plan's reading describes the install SERVING this app.
	 *
	 * The plan resolves the serving install when the backend named a root; when it
	 * named none, the plan's version can be the shim's install, which is a
	 * different install from the one answering - a comparison across the two is
	 * exactly the false skew this refuses.
	 */
	planDescribesServingInstall: boolean;
}): { version: string | null; source: DriftInstallSource } {
	if (!input.planDescribesServingInstall)
		return { version: input.planVersion, source: "unknown" };
	return { version: input.planVersion, source: "serving-install" };
}

/**
 * What the app can tell about the daemon's own work, from its session roster.
 *
 * `unknown` is a real state and it is NOT `idle`: a read that failed, a
 * listing whose own liveness read failed (`rosterLivenessDegraded`), a daemon
 * whose rows predate `live_state`, or a row whose spelling this app cannot
 * interpret must not license a restart that could land on a running turn. See
 * `servingWorkStateFromSessions`.
 */
export type ServingWorkState = "idle" | "busy" | "unknown";

/**
 * The daemon's work state, read from the roster `sessions.list` answers with.
 *
 * WHY THIS SIGNAL. The app has no turn-in-flight signal of its own: the daemon
 * knows whether a turn is running and main does not. What the daemon does
 * publish is `live_state` on every session row, set from the session record's
 * own `busy` bit (`server/utils/desktop_feed.py::_row_for`), which is published
 * by the runtime's turn-boundary hook and therefore means exactly "a turn is
 * running in this conversation". That is a real signal about work in flight,
 * which a count of open renderer subscriptions is not: a mounted chat holds a
 * subscription while it sits idle, and a background turn in a conversation
 * nobody has open holds none - the correlation the old guard had backwards.
 *
 * WHAT IT DOES NOT COVER, stated rather than implied: work the daemon owns
 * outside any session (its scheduler's own tick) is not on this roster, and the
 * daemon's finer-grained predicates are not reachable over the desktop surface.
 * A `wedged` row does not hold the restart either - a wedged row is a live pid
 * that stopped reporting, i.e. somebody else's silence rather than this
 * daemon's work, and holding on it would make the repair inert forever.
 *
 * AND A ROW IT CANNOT READ IS NOT A QUIET ONE. The verdict is `idle` only when
 * every row is readable and none is busy; anything else - a listing whose scan
 * failed, a row with no `live_state` at all, a `live_state` this build has never
 * heard of - is `unknown`, which the restart gates treat as a reason to WAIT
 * (and, at the end of a bounded wait, to refuse). A defaulted or unreadable
 * verdict may not be spent as a negative about work: that is the whole reason
 * the route publishes `degraded` (`DEGRADED_LIVENESS_SOURCE`).
 */
/**
 * One session row of a `sessions.list` answer, reduced to what a reader outside
 * the chat surface needs.
 *
 * The ROW rather than only the verdict, because two callers ask two questions
 * of the same read and must not answer them from two parses: the version-drift
 * gate asks whether anything is running (`servingWorkStateFromSessions`), and
 * the update path's fleet gate names who was running and re-engages the
 * sessions a restart displaced (`backend/fleet-drain.ts`).
 *
 * `liveState` is `null` when the daemon does not publish `live_state` AT ALL -
 * which is a fact about the build rather than about the session, and the
 * difference between that and a cold row is what stops this being read as
 * "idle" on a server too old to say.
 */
export type FleetRosterRow = {
	sessionId: string;
	/** The row's own display name, for a sentence that has to name somebody. */
	name: string;
	/** The record's own kind: "tui", "exec", "daemon", or "" for a cold row. */
	kind: string;
	/** `live_state`, or null when the daemon predates the field. */
	liveState: string | null;
};

/**
 * The catalogue's own name for the decoration an update gate may not shrug off.
 *
 * The route lifts the sources that could not be read onto the LISTING as
 * `degraded` (`server/routes/desktop_sessions.py`), and it exists because a
 * defaulted verdict is indistinguishable from a measured one at the client:
 * when `registry.scan()` raises, `decorate_rows` leaves every row at its
 * default `live_state: ""` and names this source, and `""` is a real string -
 * so a guard that looks for the field's ABSENCE (see the old-daemon rule in
 * `servingWorkStateFromSessions`) does not see it. `""` is also the catalogue's
 * spelling for a COLD row, a conversation with no record at all, which is why
 * the listing-level marker is the only thing that can tell a failed scan from a
 * quiet machine.
 */
export const DEGRADED_LIVENESS_SOURCE = "liveness";

/**
 * Whether the listing says its own LIVENESS read failed.
 *
 * Only liveness. `wakes` and `attention` are other decorations on the same rows,
 * and a listing missing either of them still answers the only question a restart
 * gate asks.
 */
export function rosterLivenessDegraded(body: unknown): boolean {
	const degraded = (body as { result?: { degraded?: unknown } } | null)?.result
		?.degraded;
	return Array.isArray(degraded) && degraded.includes(DEGRADED_LIVENESS_SOURCE);
}

/**
 * The `live_state` spellings the daemon publishes, from the producer itself
 * (`server/utils/desktop_feed.py::_row_for`, and `session/catalog.py`'s
 * `decorate_rows` for the same set on the list route): `""` for a row with no
 * record at all, then `wedged`, `busy`, `attached`, `idle`.
 *
 * WHY A CLOSED SET IS THE RIGHT SHAPE FOR A SAFETY GATE. A word this list does
 * not know is a word whose meaning this app cannot state, and the gate's whole
 * job is to not assert "nothing is running" on evidence it cannot read: a
 * future daemon that publishes `starting` must be added here deliberately by
 * somebody who knows what it means about a turn, rather than being silently
 * read as quiet. The cost of being wrong in this direction is a refused press
 * with a sentence that says so; the other direction restarts a daemon under
 * work.
 */
const KNOWN_LIVE_STATES = new Set(["", "wedged", "busy", "attached", "idle"]);

/**
 * The roster `sessions.list` answered with, or null when there is no roster.
 *
 * Null is a read that could not be taken - a body that is not the answer to
 * this route, a response whose `sessions` is not an array, or a listing whose
 * own liveness read failed - and it is NOT an empty fleet. Every caller treats
 * the two differently, and `null` is the one arm that already means "unknown"
 * everywhere: the verdict below, and the fleet gate's snapshot, which declines
 * to infer a displace list from a roster it could not read.
 */
export function fleetRosterFromSessions(
	body: unknown,
): FleetRosterRow[] | null {
	const sessions = (body as { result?: { sessions?: unknown } } | null)?.result
		?.sessions;
	if (!Array.isArray(sessions)) return null;
	/*
	 * A DEGRADED LIVENESS READ IS NOT A ROSTER (review round 1, B1 = QA Q-1).
	 * Every row it carries may be defaulted, so this is the one listing whose
	 * rows must not be believed: returning null puts every caller on the arm it
	 * already handles, which is why the fix is here rather than in the busy
	 * predicate - a second notion of "this row cannot be trusted" beside the
	 * "this read cannot be trusted" one is how the two would drift.
	 */
	if (rosterLivenessDegraded(body)) return null;
	return sessions
		.filter(
			(row): row is Record<string, unknown> =>
				typeof row === "object" && row !== null,
		)
		.map((row) => ({
			sessionId: typeof row.id === "string" ? row.id : "",
			name: typeof row.name === "string" ? row.name : "",
			kind: typeof row.kind === "string" ? row.kind : "",
			liveState: typeof row.live_state === "string" ? row.live_state : null,
		}));
}

/**
 * The rows whose session is running a turn, i.e. the ones a restart may not cut
 * off.
 *
 * THE busy SPELLING, stated once for both readers of this roster. A `wedged`
 * row is deliberately NOT in here - see `servingWorkStateFromSessions` for why
 * somebody else's silence must not hold a repair forever.
 */
export function busyRosterRows(
	rows: readonly FleetRosterRow[],
): FleetRosterRow[] {
	return rows.filter((row) => row.liveState === "busy");
}

/**
 * The daemon's work state, read from the roster `sessions.list` answers with.
 *
 * WHY THIS SIGNAL. The app has no turn-in-flight signal of its own: the daemon
 * knows whether a turn is running and main does not. What the daemon does
 * publish is `live_state` on every session row, set from the session record's
 * own `busy` bit (`server/utils/desktop_feed.py::_row_for`), which is published
 * by the runtime's turn-boundary hook and therefore means exactly "a turn is
 * running in this conversation". That is a real signal about work in flight,
 * which a count of open renderer subscriptions is not: a mounted chat holds a
 * subscription while it sits idle, and a background turn in a conversation
 * nobody has open holds none - the correlation the old guard had backwards.
 *
 * WHAT IT DOES NOT COVER, stated rather than implied: work the daemon owns
 * outside any session (its scheduler's own tick) is not on this roster, and the
 * daemon's finer-grained predicates are not reachable over the desktop surface.
 * A `wedged` row does not hold the restart either - a wedged row is a live pid
 * that stopped reporting, i.e. somebody else's silence rather than this
 * daemon's work, and holding on it would make the repair inert forever.
 */
export function servingWorkStateFromSessions(body: unknown): ServingWorkState {
	const rows = fleetRosterFromSessions(body);
	if (rows === null) return "unknown";
	if (busyRosterRows(rows).length > 0) return "busy";
	/*
	 * IDLE IS A CLAIM ABOUT EVERY ROW, so every row has to be readable before it
	 * may be made (review round 1, B1): a row whose `live_state` is ABSENT (a
	 * daemon predating the field - `_row_for` always sets it, "" for a cold row,
	 * so the key's absence is a fact about the build rather than about the work)
	 * or UNRECOGNISED (a spelling this app cannot interpret) is not a row this
	 * gate can call quiet, and one such row makes the whole roster unreadable
	 * rather than just itself: the alternative is a count of known-idle rows
	 * licensing a restart under the one row nobody could read.
	 *
	 * BLANK IS NOT IN THAT SET, and the distinction is load-bearing rather than
	 * a loosening: `""` is the catalogue's own spelling for a row with NO RECORD
	 * AT ALL, which is what most rows of a real store are (5,267 sessions on the
	 * operator's, nearly all cold), and refusing on it would make the gate inert
	 * on every machine. What makes the defaulted blank of a failed scan safe to
	 * distinguish from a cold one is the LISTING's own `degraded` marker, which
	 * `fleetRosterFromSessions` has already applied above: a roster whose scan
	 * raised never reaches this line.
	 */
	if (
		rows.some(
			(row) => row.liveState === null || !KNOWN_LIVE_STATES.has(row.liveState),
		)
	)
		return "unknown";
	return "idle";
}

/**
 * How many consecutive checks may defer the restart before one goes ahead anyway.
 *
 * One, and the bound is the point: the deferral exists so a restart does not land
 * in the middle of something a reader is watching, but a process serving code that
 * is not the code on disk is the whole defect, so a skew that survives one check
 * cycle (five minutes) is restarted on the next one regardless.
 *
 * It bounds the STREAM hold alone. `work-in-flight` is deliberately unbounded - a
 * count that ran out mid-turn would restart into the turn it was holding for.
 */
export const DRIFT_DEFERRALS_BEFORE_RESTART = 1;

/** Why a skew that IS present is not being acted on. */
export type DriftRestartHold =
	| "no-drift"
	/** A daemon this app did not start: not the app's to bounce. */
	| "not-app-owned"
	/** The update flow is mid-flight and will restart the daemon itself. */
	| "update-in-flight"
	/**
	 * Which install the serving process booted from cannot be told, or the two
	 * readings describe different installs: nothing is restarted on a comparison
	 * that does not hold. Logged, never silent - see `driftInstallReading`.
	 */
	| "serving-install-unknown"
	/** A turn is running in the daemon; the restart waits for it to be idle. */
	| "work-in-flight"
	/** The daemon's work state could not be read: fail closed rather than guess. */
	| "work-state-unknown"
	/**
	 * Something is watching a conversation and nothing is running in it. A
	 * courtesy hold for one check cycle, never a safety gate - the safety gate is
	 * `work-in-flight`.
	 */
	| "session-stream-open";

export type DriftRestartDecision =
	| { restart: true }
	| { restart: false; because: DriftRestartHold };

/**
 * Whether to restart the daemon now, given what the app can observe.
 *
 * A RESTART KILLS WHATEVER IS RUNNING IN THAT PROCESS, and this rule is what may
 * not be skipped on the way to the version skew. `stop(true)` is SIGTERM, ten
 * seconds, SIGKILL (`BackendServiceManager.stopGeneration`), and the daemon's own
 * `retire.py` declines that exit for the reason this app is deciding blind: its
 * lifespan shutdown cancels the scheduler work it owns, and a marker is no proof
 * a successor is ready. So the restart waits, without a bound, while the daemon
 * says a turn is running - `work-in-flight` - because a bounded wait is a wait
 * that kills the turn it was waiting for, and killing a live turn to fix a
 * version skew is the worse of the two defects.
 *
 * The three holds that are not deferrals, and why each is a refusal:
 *
 * - `not-app-owned`: not this app's process to bounce. The existing contract - see
 *   `servingInstallIsAppOwned` for what "owned" now means, which is not what
 *   `isUsingExternalBackend` meant.
 * - `update-in-flight`: the update flow stops the daemon itself and starts it on
 *   the new build, so a restart here would race a stop already under way.
 * - `serving-install-unknown`: the boot reading and the install reading are not
 *   known to describe the same install, so there is no skew to repair, only a
 *   comparison that does not hold.
 *
 * `work-state-unknown` is a hold rather than a refusal for the same reason
 * `work-in-flight` is: a read that could not be taken is not evidence that the
 * machine is quiet, and the next check will try again.
 *
 * The one bounded hold left is `session-stream-open`, and it is a courtesy rather
 * than a guard: nobody is running anything, but somebody is looking at a
 * conversation, so the restart waits one cycle and then goes ahead. It is not
 * what keeps a turn safe - `work-in-flight` is.
 */
export function driftRestartDecision(input: {
	drift: BackendVersionDrift;
	/** Which install the install reading describes, from `driftInstallReading`. */
	installSource: DriftInstallSource;
	appOwned: boolean;
	/** The daemon's own work state, from `servingWorkStateFromSessions`. */
	workState: ServingWorkState;
	sessionStreamOpen: boolean;
	updateInFlight: boolean;
	deferrals: number;
}): DriftRestartDecision {
	if (input.drift.kind !== "stale")
		return { restart: false, because: "no-drift" };
	if (input.installSource === "unknown")
		return { restart: false, because: "serving-install-unknown" };
	if (!input.appOwned) return { restart: false, because: "not-app-owned" };
	if (input.updateInFlight)
		return { restart: false, because: "update-in-flight" };
	if (input.workState === "unknown")
		return { restart: false, because: "work-state-unknown" };
	if (input.workState === "busy")
		return { restart: false, because: "work-in-flight" };
	if (
		input.sessionStreamOpen &&
		input.deferrals < DRIFT_DEFERRALS_BEFORE_RESTART
	)
		return { restart: false, because: "session-stream-open" };
	return { restart: true };
}
