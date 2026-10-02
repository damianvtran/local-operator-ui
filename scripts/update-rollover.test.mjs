import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * The rollover's post-conditions, as executed rules (2026-09-30).
 *
 * WHY THIS FILE EXISTS. Three verdicts the update service now makes are each the
 * kind a well-meaning refactor "fixes" into a wrong one, and each has a measured
 * incident behind it:
 *
 *   - `serveMovedOntoBuild` decides whether the serving process moved onto the
 *     new build WITHOUT a restart. The rule it replaced (the install's
 *     before/after diff) misbranched on 2026-09-30 - a concurrent installer
 *     flipped `current` between the app's reads, the app saw `0.64.10 -> 0.64.10`
 *     and killed the serve its own updater had just reloaded. The trap inside the
 *     replacement is `/health`'s `version`, computed from the metadata on disk
 *     when it answers, which reports the NEWER install while a process serves old
 *     code from memory - so these cases pin that the verdict reads the process's
 *     own record and never that field.
 *   - `runtimeStragglerCount` is the completion's straggler census
 *     (`GET /v1/desktop/runtimes`): a row whose `build_version` is empty is
 *     UNKNOWN, not old, and an unreadable roster is null rather than a zero.
 *   - `parseUpdateReport` reads the updater's frozen `update.report.v1` stdout
 *     line - the only daemon-moved evidence that exists - and a malformed line
 *     must degrade exactly like an absent one, never like a partial reading.
 *
 * The module is bundled from `src/` and called, so the shipped rules are what
 * these cases drive.
 */
const bundle = await build({
	stdin: {
		contents: `export * from "./src/main/update-rollover";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	daemonMoveOutcome,
	parseUpdateReport,
	runtimeStragglerCount,
	serveMovedOntoBuild,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** A report line as the frozen contract states it, overridable per case. */
const reportLine = (over = {}) =>
	JSON.stringify({
		update_report: {
			schema: "update.report.v1",
			install_version: "0.56.0",
			target: "0.56.0",
			serve: [
				{
					pid: 4242,
					from: "0.55.10",
					to: "0.56.0",
					moved: true,
					instance: "i-after",
				},
			],
			daemons: [
				{ name: "mobile", status: "refreshed", version: "0.56.0" },
				{ name: "tunnel", status: "already", version: "0.56.0" },
			],
			...over,
		},
	});

test("the report line parses out of the updater's own prose, and malformed lines do not", () => {
	const stdout = [
		"Resolved 55 packages in 1.25s",
		"local-operator 0.55.10 -> 0.56.0",
		reportLine(),
		"Done.",
	].join("\n");
	const report = parseUpdateReport(stdout);
	assert.ok(report, "the line must be found among the prose");
	assert.equal(report.install_version, "0.56.0");
	assert.equal(report.serve[0].instance, "i-after");
	assert.equal(report.serve[0].moved, true);
	assert.equal(report.daemons[1].status, "already");

	// The LAST valid line wins: the last word is the end of the run.
	const twice = `${reportLine({ target: "0.56.0" })}\n${reportLine({ target: "0.56.2" })}`;
	assert.equal(parseUpdateReport(twice)?.target, "0.56.2");

	// An absent line is null, and so is prose that merely mentions the key.
	assert.equal(parseUpdateReport("no report here"), null);
	assert.equal(parseUpdateReport('{"update_report":'), null);
	assert.equal(
		parseUpdateReport("the update_report line was not produced"),
		null,
	);

	// A DIFFERENT SCHEMA FAMILY is not read (the contract's own versioning).
	assert.equal(
		parseUpdateReport(reportLine({ schema: "other.report.v1" })),
		null,
	);
	assert.equal(
		parseUpdateReport(reportLine({ schema: "update_report" })),
		null,
		"the family prefix is part of the contract",
	);

	/*
	 * A PARTIAL REPORT IS NOT A READING. One wrong field is one null, never a
	 * half-report the daemon evidence could lean on.
	 */
	assert.equal(
		parseUpdateReport(reportLine({ serve: [{ pid: 1, from: "a" }] })),
		null,
	);
	assert.equal(
		parseUpdateReport(
			reportLine({
				daemons: [{ name: "mobile", status: "maybe", version: "0.56.0" }],
			}),
		),
		null,
	);
	assert.equal(parseUpdateReport(reportLine({ serve: undefined })), null);
	assert.equal(parseUpdateReport(reportLine({ target: 7 })), null);

	// A v2 that keeps the fields still parses; forward-compatible by contract.
	assert.equal(
		parseUpdateReport(reportLine({ schema: "update.report.v2" }))?.schema,
		"update.report.v2",
	);
});

test("the daemons' verdict comes from the report alone, and no report is no evidence", () => {
	assert.equal(daemonMoveOutcome(null), null, "no report, no evidence");

	const moved = daemonMoveOutcome(parseUpdateReport(reportLine()));
	assert.deepEqual(moved, {
		source: "report",
		moved: true,
		failed: [],
	});

	const failed = daemonMoveOutcome(
		parseUpdateReport(
			reportLine({
				daemons: [
					{ name: "mobile", status: "refreshed", version: "0.56.0" },
					{ name: "wakes", status: "failed", version: "" },
					{ name: "tunnel", status: "unsupervised", version: "" },
				],
			}),
		),
	);
	assert.equal(failed.moved, false);
	assert.deepEqual(failed.failed, ["wakes", "tunnel"]);

	// An empty list is vacuously moved: there is nothing the updater failed to
	// refresh, and the report's own word for that is true.
	const empty = daemonMoveOutcome(
		parseUpdateReport(reportLine({ daemons: [] })),
	);
	assert.deepEqual(empty, { source: "report", moved: true, failed: [] });
});

test("the move verdict reads the process's record, never /health's version", () => {
	const before = "i-before";
	const moved = serveMovedOntoBuild({
		instanceBefore: before,
		recordAfter: { bootVersion: "0.56.0", instanceId: "i-after" },
		installVersion: "0.56.0",
		target: "0.56.0",
		reportServe: null,
		healthOk: true,
	});
	assert.equal(
		moved,
		true,
		"a changed instance at the boot reading is the proof",
	);

	/*
	 * THE AT-OR-PAST RULE: a release published between the offer and the press
	 * comes back one past the string that was asked for, and equality there failed
	 * a move that landed.
	 */
	assert.equal(
		serveMovedOntoBuild({
			instanceBefore: before,
			recordAfter: { bootVersion: "0.56.2", instanceId: "i-after" },
			installVersion: "0.56.2",
			target: "0.56.0",
			reportServe: null,
			healthOk: true,
		}),
		true,
	);

	/*
	 * UNPROVEN ARMS, one each: no health, no pre-swap instance (the record was
	 * unreadable then), an unchanged instance (the skew panel's restart press
	 * reaches the service exactly like this), a boot reading BEHIND the target,
	 * and no boot reading at all. Every one of them is "roll the restart
	 * fallback", never "assume moved".
	 */
	const base = {
		instanceBefore: before,
		recordAfter: { bootVersion: "0.56.0", instanceId: "i-after" },
		installVersion: "0.56.0",
		target: "0.56.0",
		reportServe: null,
		healthOk: true,
	};
	assert.equal(serveMovedOntoBuild({ ...base, healthOk: false }), false);
	assert.equal(serveMovedOntoBuild({ ...base, instanceBefore: null }), false);
	assert.equal(
		serveMovedOntoBuild({
			...base,
			recordAfter: { bootVersion: "0.56.0", instanceId: "i-before" },
		}),
		false,
	);
	assert.equal(
		serveMovedOntoBuild({
			...base,
			recordAfter: { bootVersion: "0.55.10", instanceId: "i-after" },
		}),
		false,
	);
	assert.equal(
		serveMovedOntoBuild({
			...base,
			recordAfter: { bootVersion: null, instanceId: "i-after" },
		}),
		false,
	);

	/*
	 * THE REPORT JOINS ONLY AS THE TOKEN FALLBACK: with the record readable but its
	 * instance missing, the report's token can complete the pair - and a report
	 * token equal to the pre-swap one is still not a move. The report's own
	 * `moved: false` cannot veto a record-proven move (the record describes the
	 * process that is actually serving).
	 */
	assert.equal(
		serveMovedOntoBuild({
			...base,
			recordAfter: { bootVersion: "0.56.0", instanceId: null },
			reportServe: {
				pid: 1,
				from: "0.55.10",
				to: "0.56.0",
				moved: true,
				instance: "i-after",
			},
		}),
		true,
	);
	assert.equal(
		serveMovedOntoBuild({
			...base,
			recordAfter: { bootVersion: "0.56.0", instanceId: null },
			reportServe: {
				pid: 1,
				from: "0.55.10",
				to: "0.56.0",
				moved: false,
				instance: "i-before",
			},
		}),
		false,
	);
	assert.equal(
		serveMovedOntoBuild({
			...base,
			recordAfter: { bootVersion: "0.56.0", instanceId: "i-after" },
			reportServe: {
				pid: 1,
				from: "0.55.10",
				to: "0.55.10",
				moved: false,
				instance: "i-before",
			},
		}),
		true,
		"the record is the machine's own word; a stale report cannot veto it",
	);
});

test("the straggler census counts known-old runtimes, and unknowns are not old", () => {
	const body = (runtimes) => ({
		status: 200,
		message: "",
		result: { runtimes },
	});
	assert.equal(
		runtimeStragglerCount(
			body([
				{ pid: 1, build_version: "0.56.0" },
				{ pid: 2, build_version: "0.55.10" },
				{ pid: 3, build_version: "0.55.10" },
				{ pid: 4, build_version: "" },
				{ pid: 5 },
			]),
			"0.56.0",
		),
		2,
		"an empty build_version is UNKNOWN and must not be counted as old",
	);
	assert.equal(runtimeStragglerCount(body([]), "0.56.0"), 0, "a measured zero");
	assert.equal(
		runtimeStragglerCount(
			body([{ pid: 1, build_version: "0.55.10" }]),
			"0.56.0",
		),
		1,
	);

	// Not measured: unreadable bodies, and no current build to compare against.
	assert.equal(runtimeStragglerCount(null, "0.56.0"), null);
	assert.equal(runtimeStragglerCount("nope", "0.56.0"), null);
	assert.equal(runtimeStragglerCount(body("nope"), "0.56.0"), null);
	assert.equal(runtimeStragglerCount({}, "0.56.0"), null);
	assert.equal(runtimeStragglerCount(body([{ pid: 1 }]), null), null);
	assert.equal(runtimeStragglerCount(body([{ pid: 1 }]), "  "), null);
});
