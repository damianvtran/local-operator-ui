import { compareVersions } from "./update-install";

/**
 * The post-conditions of a server rollover, as pure functions.
 *
 * TWO QUESTIONS, ONE MODULE, because they are the two halves of the same
 * sentence the update panel has to be able to make:
 *
 * 1. **Did the server serving this app provably move onto the new build
 *    without a restart?** (`serveMovedOntoBuild`.) The app used to answer this
 *    from the INSTALL's before/after versions (`before === after` meant
 *    "nothing left to install", which routed the press into the restart leg) -
 *    a decision that is racy by construction on a machine where several actors
 *    install concurrently (measured 2026-09-30: a concurrent installer flipped
 *    the `current` pointer between the check and the press, so the app read
 *    `0.64.10 -> 0.64.10`, took the restart branch, and killed the serve the
 *    updater had JUST reloaded, paying the restart plus the 60 s retire wait
 *    after a rollover that had already landed). The post-condition replaces the
 *    diff: read the serving process's OWN record after the updater exits and
 *    prove the move from what the machine says, not from what was expected.
 *
 * 2. **How many runtimes are still on the old build?** (`runtimeStragglerCount`
 *    over the machine's runtime roster, `GET /v1/desktop/runtimes`.) The count
 *    the completion notice carries used to be a LIVENESS reading - the pre-swap
 *    sessions still resident when a wait ended - whose row shape
 *    (`FleetRosterRow`) carries no build at all, with a documented over-count
 *    (a session re-warmed onto the new build inside the window stays counted).
 *    The roster answers the real question, per runtime, from a build recorded
 *    by the process itself.
 *
 * WHY THE EVIDENCE RULES ARE HERE AND NOT IN THE SERVICE. Each rule below is
 * the kind of thing that must be readable and testable on its own - the
 * `/health` TRAP (its `version` is computed from the metadata on disk when it
 * ANSWERS, so a process serving old code out of memory reports the newer
 * install; `backend-version-drift.ts` documents the day-long staleness this
 * once caused) is exactly the sort of rule that gets "fixed" by a helpful
 * refactor unless a test pins it. The service does the reads; this module owns
 * the verdicts.
 *
 * THE UPDATER'S STRUCTURED REPORT (`update.report.v1`, frozen 2026-09-30). The
 * updater prints ONE stdout line at exit carrying what IT did:
 *
 *     {"update_report": {"schema": "update.report.v1",
 *       "install_version": "<str>", "target": "<str>",
 *       "serve": [{"pid": <int>, "from": "<str>", "to": "<str>",
 *                  "moved": <bool>, "instance": "<str>"}],
 *       "daemons": [{"name": "<str>",
 *                    "status": "refreshed"|"already"|"failed"|"unsupervised",
 *                    "version": "<str>"}]}}
 *
 * It is what makes the daemons PROVABLE: serve has its own record the app can
 * read, but tunnel/wakes have no health surface in the read modules, so the
 * report is the only evidence a daemon moved. Until a core build emits it, the
 * app degrades honestly - serve is proven by its record, and the daemons are
 * best-effort with NO evidence - rather than inventing daemon evidence from a
 * line that is not there (`daemonMoveOutcome` returns null, and the caller says
 * so in its log; nothing user-facing claims a daemon moved either way).
 */

/** The top-level key the report line carries, per the frozen contract. */
export const UPDATE_REPORT_KEY = "update_report";

/** The schema family this parser accepts. A different family is not read. */
export const UPDATE_REPORT_SCHEMA_PREFIX = "update.report.";

/** One serve entry of the report: what the updater did to the serving process. */
export type UpdateReportServeEntry = {
	pid: number;
	/** The build the process served before the updater acted. */
	from: string;
	/** The build it serves after, as the updater observed it. */
	to: string;
	/** The updater's own verdict that the process moved. */
	moved: boolean;
	/**
	 * A token that changes when the serving process moves (core documents the
	 * provenance; in the generation layout it is the serve record's own
	 * `instance_id`, which is minted per process start and republished by the
	 * reload). Compared against the PRE-SWAP reading for the same token.
	 */
	instance: string;
};

export type UpdateReportDaemonStatus =
	| "refreshed"
	| "already"
	| "failed"
	| "unsupervised";

/** One supervised daemon of the report. */
export type UpdateReportDaemon = {
	name: string;
	status: UpdateReportDaemonStatus;
	version: string;
};

/** The report, validated. Every field is required by the frozen contract. */
export type UpdateReport = {
	schema: string;
	install_version: string;
	target: string;
	serve: UpdateReportServeEntry[];
	daemons: UpdateReportDaemon[];
};

const DAEMON_STATUSES: ReadonlySet<string> = new Set([
	"refreshed",
	"already",
	"failed",
	"unsupervised",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The report line a stdout captured, or null.
 *
 * A SINGLE LINE with the top-level key, per the frozen contract. The scan is
 * tolerant about WHERE the line sits (the updater's human sentences share the
 * stream, and a future build may wrap it) and strict about the SHAPE: a
 * payload that does not carry every field with its declared type is null, not a
 * half-reading - a report is evidence, and a partial one is not evidence. The
 * LAST valid line wins if a run ever prints more than one, because the last
 * word is the end of the run the caller is about to judge.
 *
 * `schema` must name the `update.report.` family but is NOT pinned to `.v1`:
 * the version is read forward-compatible the way the contract states (a v2
 * that keeps these fields still parses; one that changes them fails the field
 * checks and degrades like an absent report, which is the honest direction).
 */
export function parseUpdateReport(stdout: string): UpdateReport | null {
	let found: UpdateReport | null = null;
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		// The cheap pre-filter first: most lines are the updater's own prose, and
		// JSON.parse on each of them is the only cost this loop can incur.
		if (!trimmed.startsWith("{") || !trimmed.includes(UPDATE_REPORT_KEY))
			continue;
		let payload: unknown;
		try {
			payload = JSON.parse(trimmed);
		} catch {
			continue;
		}
		const report = reportFromPayload(payload);
		if (report) found = report;
	}
	return found;
}

/** The frozen shape, or null. Split out so one malformed field is one null. */
function reportFromPayload(payload: unknown): UpdateReport | null {
	if (!isRecord(payload)) return null;
	const raw = payload[UPDATE_REPORT_KEY];
	if (!isRecord(raw)) return null;
	const schema = raw.schema;
	if (
		typeof schema !== "string" ||
		!schema.startsWith(UPDATE_REPORT_SCHEMA_PREFIX)
	)
		return null;
	const installVersion = raw.install_version;
	const target = raw.target;
	if (typeof installVersion !== "string" || typeof target !== "string")
		return null;
	const serve = raw.serve;
	const daemons = raw.daemons;
	if (!Array.isArray(serve) || !Array.isArray(daemons)) return null;
	const serveEntries: UpdateReportServeEntry[] = [];
	for (const entry of serve) {
		if (!isRecord(entry)) return null;
		const { pid, from, to, moved, instance } = entry;
		if (
			typeof pid !== "number" ||
			typeof from !== "string" ||
			typeof to !== "string" ||
			typeof moved !== "boolean" ||
			typeof instance !== "string"
		)
			return null;
		serveEntries.push({ pid, from, to, moved, instance });
	}
	const daemonEntries: UpdateReportDaemon[] = [];
	for (const entry of daemons) {
		if (!isRecord(entry)) return null;
		const { name, status, version } = entry;
		if (
			typeof name !== "string" ||
			typeof status !== "string" ||
			!DAEMON_STATUSES.has(status) ||
			typeof version !== "string"
		)
			return null;
		daemonEntries.push({
			name,
			status: status as UpdateReportDaemonStatus,
			version,
		});
	}
	return {
		schema,
		install_version: installVersion,
		target,
		serve: serveEntries,
		daemons: daemonEntries,
	};
}

export type ServeRecordReading = {
	/** The build the serving process BOOTED with, from its own record. */
	bootVersion: string | null;
	/** The process's instance token (`instance_id`), from the same record. */
	instanceId: string | null;
};

export type ServeMoveInput = {
	/** The pre-swap instance token, from the serve record read before the run. */
	instanceBefore: string | null;
	/** The serve record read after the updater exited. */
	recordAfter: ServeRecordReading;
	/** The install version read after the attempt (the fallback target). */
	installVersion: string | null;
	/** The version this attempt was asked to move the server onto, when known. */
	target: string | null;
	/** The report's serve entry, when the updater emitted one. */
	reportServe: UpdateReportServeEntry | null;
	/** Whether `/health` answered 200. Liveness ONLY - never its `version`. */
	healthOk: boolean;
};

/**
 * Whether the server serving this app PROVABLY moved onto the new build.
 *
 * The rule, in the order the clauses matter:
 *
 * - `/health` must have answered 200. Liveness only: its body may carry a
 *   `version`, and that field is computed from the metadata on disk WHEN IT
 *   ANSWERS - a process serving old code out of memory reports the NEWER
 *   install - so it proves nothing about the move and is never read here.
 * - The serving process's record must name a build AT OR PAST the target (the
 *   same at-or-past rule `didUpgradeLand` and `waitForBackendVersion` state: a
 *   release published between the offer and the press comes back one past the
 *   string that was asked for, and equality there failed a move that landed).
 *   With no target the install's own post reading is the bar.
 * - The instance must have CHANGED: the reload machinery's own proof of a move
 *   is a new `instance_id` under the same pid, and an unchanged identity under
 *   an unchanged build is exactly the state the restart leg exists for (the
 *   skew panel's "restart the server onto the new build" press, which reaches
 *   the service with the install already current). The post-swap token comes
 *   from the record when one could be read - the process that serves
 *   republishes it, so it is the machine's own word - and falls back to the
 *   report's token only when the record carries none.
 *
 * The report's `moved` does NOT veto a record-proven move and cannot make one
 * by itself while the record is readable: on a multi-actor machine the record
 * describes the process that is actually serving, which is the question this
 * verdict answers. It joins the evidence only as the token fallback above.
 * A missing instance on either side makes the move UNPROVEN, and unproven is
 * "roll the restart fallback", never "assume moved".
 */
export function serveMovedOntoBuild(input: ServeMoveInput): boolean {
	if (!input.healthOk) return false;
	const before = input.instanceBefore?.trim() ?? "";
	if (before === "") return false;
	const after =
		input.recordAfter.instanceId?.trim() ||
		input.reportServe?.instance.trim() ||
		"";
	if (after === "" || after === before) return false;
	return serveOnTarget(
		input.recordAfter.bootVersion,
		input.installVersion,
		input.target,
	);
}

/** The at-or-past rule, spelled once. Empty/unreadable readings do not pass. */
function serveOnTarget(
	bootVersion: string | null,
	installVersion: string | null,
	target: string | null,
): boolean {
	const boot = bootVersion?.trim() ?? "";
	if (boot === "") return false;
	const wanted = target?.trim() ?? "";
	if (wanted !== "") {
		const order = compareVersions(boot, wanted);
		return order !== null && order >= 0;
	}
	const installed = installVersion?.trim() ?? "";
	if (installed === "") return false;
	const order = compareVersions(boot, installed);
	return order === null ? boot === installed : order >= 0;
}

/**
 * How many runtimes are still on the OLD build, from a runtime-roster body.
 *
 * The body is the desktop transport's parsed `CRUDResponse` for
 * `GET /v1/desktop/runtimes` (`{ result: { runtimes: [...] } }`), and a row
 * whose `build_version` is EMPTY is UNKNOWN, not old - the absence of evidence
 * may not be counted as evidence, which is the roster journal's own rule. Null
 * is "not measured" and travels as such: an unreadable body, or no current
 * build to compare against, may not degrade to a zero count (0 is a measured
 * zero and draws no straggler line at all; null draws the numberless
 * sentence).
 */
export function runtimeStragglerCount(
	body: unknown,
	current: string | null,
): number | null {
	const currentBuild = current?.trim() ?? "";
	if (currentBuild === "") return null;
	if (!isRecord(body)) return null;
	const result = body.result;
	if (!isRecord(result)) return null;
	const runtimes = result.runtimes;
	if (!Array.isArray(runtimes)) return null;
	let count = 0;
	for (const row of runtimes) {
		if (!isRecord(row)) continue;
		const build =
			typeof row.build_version === "string" ? row.build_version.trim() : "";
		if (build === "") continue;
		if (build !== currentBuild) count += 1;
	}
	return count;
}

/** What the updater's report says about the supervised daemons. */
export type DaemonMoveOutcome = {
	source: "report";
	/** True when every daemon is refreshed/already (an empty list is vacuous). */
	moved: boolean;
	/** The daemons whose status is `failed` or `unsupervised`, by name. */
	failed: string[];
};

/**
 * The daemons' evidence from the report, or null when there is none.
 *
 * NULL IS THE HONEST DEGRADE, and it is the only arm available until a core
 * build emits the report: with no report there is no evidence about tunnel or
 * wakes at all (they have no record the app can read), so the caller says
 * "serve proven; daemons best-effort" and claims nothing else. `failed` names
 * the daemons the updater could not refresh; the caller surfaces them as a
 * warning and never as a completed-with-claims. `moved` is true when every
 * status is `refreshed`/`already`, including the vacuous empty list - there is
 * nothing the updater failed to move.
 */
export function daemonMoveOutcome(
	report: UpdateReport | null,
): DaemonMoveOutcome | null {
	if (report === null) return null;
	const failed = report.daemons
		.filter(
			(daemon) =>
				daemon.status === "failed" || daemon.status === "unsupervised",
		)
		.map((daemon) => daemon.name);
	return { source: "report", moved: failed.length === 0, failed };
}
