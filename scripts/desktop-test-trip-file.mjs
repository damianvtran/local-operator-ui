/**
 * Records a wedge where the job's own log cannot lose it.
 *
 * WHAT WAS MEASURED, AND WHAT WAS NOT. On run 41293657583 the shard's complete log
 * - both `gh run view --log` and the API route agree, 16,586 lines - ends at
 * `09:37:13`, about 70 s into the suite, and carries nothing for the ~54 minutes
 * until the job was cancelled; the `per-lane bound 25 min` startup line IS in it,
 * so the bound code ran. Review round 1 supplied the correction this header owed:
 * the runner's stdout under CI is a PIPE to `tee`, and pipe writes queue rather
 * than block, so a bound that had fired would very probably have been written. The
 * economical reading is therefore that neither clock ever REACHED its bound - a
 * lane that stayed in view held the suite clock at zero, and a lane whose sampled
 * pid kept changing was re-timed - not that a fired bound was swallowed. The FIRST
 * half is now covered: `desktop-test-lane-bound.mjs` resets the suite clock only on
 * evidence of progress. The SECOND - a lane whose sampled pid changes and is re-timed
 * forever - is NOT fixed (review round 2, R2-4: probe B showed six ticks and zero
 * trips), and this header says so rather than implying coverage it does not have.
 *
 * SO WHY THIS FILE STILL EXISTS. Because the two channels a cancelled job keeps are
 * the ones a stream cannot take away:
 *
 *  1. a JSON file, appended to on every trip, whose path the workflow sets (so it
 *     lands under the run's artifact directory) and which is uploaded even on
 *     failure. It survives cancellation of the step, and a later reader sees the
 *     exact pids, argv and start times;
 *  2. GitHub `::error::` annotations, printed the moment the trip happens and
 *     re-emitted from the file by an `always()` step. Annotations are the surface
 *     that crosses the cut - `gh run view --log` never reaches the end of a job log,
 *     and a cancelled job runs no further steps it is not told to run.
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
