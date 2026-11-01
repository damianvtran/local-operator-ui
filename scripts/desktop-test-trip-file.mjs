/**
 * Records a wedge where a silenced stdout cannot lose it.
 *
 * WHY THIS EXISTS, AND IT IS THE WHOLE LESSON OF 2026-11-01. Every bound in this
 * harness reports by printing a line, and every one of those lines goes out on the
 * same stream the wedge silences. Measured on run 41293657583 (this repository's
 * own fix branch): the shard's complete log - both `gh run view --log` and the API
 * route agree, 16,586 lines - ends at `09:37:13`, about 70 s into the suite, and
 * carries NOTHING afterwards for the ~54 minutes until the job was cancelled. The
 * blocked runner's own `per-lane bound 25 min` startup line IS in that log, so the
 * code ran; neither the lane trip nor the suite trip produced a line, although
 * both were due by ~10:02. A watchdog whose only channel is the stream the stall
 * blocks cannot name that stall.
 *
 * SO A TRIP IS RECORDED TWICE, IN CHANNELS THE SUITE'S STDOUT CANNOT REACH:
 *
 *  1. a JSON file, appended to on every trip, whose path the workflow sets (so it
 *     lands under the run's artifact directory) and which is uploaded even on
 *     failure. It is the durable copy: it survives cancellation of the step, and a
 *     later reader can see the exact pids, argv and start times;
 *  2. GitHub `::error::` annotations, printed to this process's own stdout the
 *     moment the trip happens. They are written for the same reason the file is:
 *     if the step's log is truncated or lost, an annotation is a SEPARATE surface
 *     that crosses the cut (`gh run view --log` never reaches the end of a job log,
 *     and check-run annotations do not go through the log at all).
 *
 * WHAT THIS IS NOT: a substitute for the printed line. The line stays, because a
 * reader of a healthy-looking log should see it; this module is the copy that
 * survives the case the line cannot.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Where the runner writes its trip file. A workflow sets it to `$RUNNER_TEMP`. */
export const TRIP_FILE_ENV = "LOCAL_OPERATOR_UI_TRIP_FILE";

/** The document's own version, so a later reader never has to guess the shape. */
const FORMAT = 1;

/**
 * The trip file's path: the caller's own choice, or a per-run default under the
 * system temporary directory.
 *
 * A DEFAULT IS ANNOUNCED RATHER THAN SILENT, because a trip file in a temp
 * directory is not uploaded anywhere and a reader who does not know that would
 * assume the evidence was kept. `formatTripFileLine` says which path is in play.
 */
export function resolveTripFile(env = process.env) {
	const configured = env[TRIP_FILE_ENV];
	if (typeof configured === "string" && configured.trim().length > 0) {
		return { path: configured.trim(), source: "env" };
	}
	return { path: join(tmpdir(), "desktop-test-trips.json"), source: "default" };
}

/** The startup line: which file trips are recorded in, and whether it is uploaded. */
export function formatTripFileLine(decision) {
	const where =
		decision.source === "env"
			? "uploaded with the shard's artifacts"
			: `a DEFAULT path that no workflow uploads - set ${TRIP_FILE_ENV} to keep it`;
	return `desktop tests: wedge trips append to ${decision.path} (${where})`;
}

/**
 * One trip record.
 *
 * `kind` is the bound that fired (`lane`, `suite`, or `descendant`), and every
 * pid-carrying entry is recorded with the argv and start time it was sampled
 * with: a reader who only sees "a pid" cannot tell a stuck test file from a stray
 * the test itself launched, which is the distinction a wedge turns on.
 */
export function tripRecord({
	kind,
	at = new Date().toISOString(),
	detail = {},
	context = {},
}) {
	return { format: FORMAT, kind, at, ...context, ...detail };
}

/**
 * Append one record and return the path written.
 *
 * THE READ IS TOLERANT AND THE WRITE IS ATOMIC, both deliberately: this runs in
 * the one path that must not throw (a wedge is already the failure), so a missing
 * or half-written file becomes a fresh document rather than an exception, and a
 * reader in another process never observes a partial write.
 */
export function appendTrip({ path, record }) {
	let trips = [];
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (Array.isArray(parsed?.trips)) trips = parsed.trips;
	} catch {
		// Absent, unreadable or corrupt: the record being written is worth more than
		// the history that could not be read.
	}
	trips.push(record);
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(
		temporary,
		`${JSON.stringify({ format: FORMAT, trips }, null, 2)}\n`,
	);
	renameSync(temporary, path);
	return path;
}

/**
 * The annotations for one record: the surface a cancelled run still shows.
 *
 * One `::error::` per fact rather than one long one, because GitHub renders each
 * annotation separately and a single line carrying a suite, a file, three pids and
 * their argv is the line nobody reads.
 */
export function tripAnnotations(record) {
	const suffix =
		record.kind === "lane"
			? `lane ${record.lane}`
			: record.kind === "descendant"
				? `descendants of lane ${record.lane}`
				: "the suite child";
	const lines = [
		`::error title=Desktop suite wedged (${record.kind})::${suffix} wedged; recorded in the trip file at ${record.at}. Record: ${JSON.stringify(record)}`,
	];
	for (const pid of record.survivors ?? []) {
		lines.push(
			`::error title=Surviving descendant (pid ${pid.pid})::${pid.command} (start ${pid.lstart}); ${pid.outcome}`,
		);
	}
	return lines;
}

/** One process, as the detail read sampled it: pid, argv and identity. */
export function describeProcess(row) {
	return { pid: row.pid, command: row.command, lstart: row.lstart };
}
