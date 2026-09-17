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
 * the running process actually loaded. `serveRecordVersion` below is that read, and
 * the drift test pins the wiring so a future reader cannot reach for the wrong
 * field first.
 *
 * Pure by construction (no Electron import), so `scripts/*.test.mjs` can bundle
 * the shipped TypeScript and call these decisions directly.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRecord } from "./backend/discovery";
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
 * The version the daemon with this pid booted with, from its own serve record.
 *
 * A pid that is not a positive integer is an absence, not a lookup: this must never
 * be handed `undefined` and answer with somebody else's record. A missing file, a
 * torn read and a malformed document are the same absence for the same reason the
 * record parser refuses to guess (see `parseRecord`'s own note) - and a record
 * written by an install predating this field parses its `version` as `""`, which is
 * this function's `null`. That case falls to the record's absence handling rather
 * than to `/health`: an old install that cannot say what it booted with has not
 * earned a version comparison.
 */
export function serveRecordVersion(
	pid: number | null | undefined,
	dir: string,
): string | null {
	if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0)
		return null;
	try {
		const file = join(dir, `${pid}.json`);
		const entry = parseRecord(JSON.parse(readFileSync(file, "utf8")), file);
		const version = entry.record?.version?.trim() ?? "";
		return version === "" ? null : version;
	} catch {
		return null;
	}
}

/**
 * How many consecutive checks may defer the restart before one goes ahead anyway.
 *
 * One, and the bound is the point: the deferral exists so a restart does not land
 * in the middle of something a reader is watching, but a process serving code that
 * is not the code on disk is the whole defect, so a skew that survives one check
 * cycle (five minutes) is restarted on the next one regardless.
 */
export const DRIFT_DEFERRALS_BEFORE_RESTART = 1;

/** Why a skew that IS present is not being acted on. */
export type DriftRestartHold =
	| "no-drift"
	/** A daemon this app did not start: not the app's to bounce. */
	| "not-app-owned"
	/** The update flow is mid-flight and will restart the daemon itself. */
	| "update-in-flight"
	/** Something is watching a conversation; wait one cycle. */
	| "session-stream-open";

export type DriftRestartDecision =
	| { restart: true }
	| { restart: false; because: DriftRestartHold };

/**
 * Whether to restart the daemon now, given what the app can observe.
 *
 * WHAT THE APP CAN AND CANNOT SEE, stated here because it is what shapes this
 * rule. There is no turn-in-flight signal in main: the daemon knows whether a turn
 * is running, main does not, and the relay's open subscriptions are a count of
 * conversations being VIEWED (a mounted chat holds one while it sits idle, and a
 * turn in a conversation nobody has open holds none). So the app cannot honour "do
 * not kill a backend mid-turn" exactly. What it can do is the lesser version: hold
 * the restart while a session stream is open - the only in-flight-ish evidence it
 * has - and never hold it for more than one check cycle.
 *
 * `not-app-owned` is not a deferral but a refusal, and it is the existing contract
 * rather than something new: the app does not stop a daemon it did not start (see
 * `BackendServiceManager.backendIsAppOwned` and the skew notice's own sentence).
 * The reader is already told about that case by the update notice; this reports it
 * in the log and leaves the process alone.
 *
 * `update-in-flight` takes the same shape: the update flow stops the daemon itself
 * and starts it on the new build, so a restart here would race a stop that is
 * already under way.
 */
export function driftRestartDecision(input: {
	drift: BackendVersionDrift;
	appOwned: boolean;
	sessionStreamOpen: boolean;
	updateInFlight: boolean;
	deferrals: number;
}): DriftRestartDecision {
	if (input.drift.kind !== "stale")
		return { restart: false, because: "no-drift" };
	if (!input.appOwned) return { restart: false, because: "not-app-owned" };
	if (input.updateInFlight)
		return { restart: false, because: "update-in-flight" };
	if (
		input.sessionStreamOpen &&
		input.deferrals < DRIFT_DEFERRALS_BEFORE_RESTART
	)
		return { restart: false, because: "session-stream-open" };
	return { restart: true };
}
