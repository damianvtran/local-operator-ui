import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { build } from "esbuild";

/*
 * The reading that can see a stale process, and the decision to act on it.
 *
 * WHY THESE CASES. A daemon that had booted build 0.56.2 went on serving it for a
 * day after the disk was updated to 0.56.11, and every check reported the install
 * up to date: the comparison was installed-against-published and never
 * running-against-installed. Two things can bring that back, and this file pins
 * both - the honest reading being replaced by a comfortable one, and the decision
 * to restart being taken on a reading that cannot order the two versions.
 *
 * The module is bundled from the shipped TypeScript and CALLED (the decisions are
 * still green under a mutation of the copy, which is the hole this shape closes).
 */
const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/backend-version-drift";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	DRIFT_DEFERRALS_BEFORE_RESTART,
	backendVersionDrift,
	driftRestartDecision,
	serveRecordVersion,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const quiet = {
	appOwned: true,
	sessionStreamOpen: false,
	updateInFlight: false,
	deferrals: 0,
};

/** Temp trees this file creates, removed when it finishes. */
const trees = [];
after(() => {
	for (const dir of trees) rmSync(dir, { recursive: true, force: true });
});

test("an older boot reading than the install is the skew to repair", () => {
	// The operator's pair, from the two real readings: the serve record says the
	// process booted 0.56.2, the install on disk is 0.56.11.
	assert.deepEqual(backendVersionDrift("0.56.2", "0.56.11"), {
		kind: "stale",
		bootVersion: "0.56.2",
		installVersion: "0.56.11",
	});
	// Whitespace is not a version, and a padded reading is still a reading.
	assert.deepEqual(backendVersionDrift(" 0.55.0\n", " 0.56.11 "), {
		kind: "stale",
		bootVersion: "0.55.0",
		installVersion: "0.56.11",
	});
	// A four-part release (the backend has published them) is ordered by its first
	// three components - the same convention the install marker's own comparison
	// uses, so the two cannot disagree about which build is older.
	assert.deepEqual(backendVersionDrift("0.56.2.1", "0.56.11"), {
		kind: "stale",
		bootVersion: "0.56.2.1",
		installVersion: "0.56.11",
	});
});

test("equal, newer-running and every absent reading are not restarts", () => {
	const cases = [
		[["0.56.11", "0.56.11"], "equal"],
		[["0.56.11", "0.56.2"], "running-ahead"],
		[[null, "0.56.11"], "no-boot-reading"],
		[[undefined, "0.56.11"], "no-boot-reading"],
		// A record written before this field existed parses as "" (parseRecord):
		// the record's absence handling, never `/health`.
		[["", "0.56.11"], "no-boot-reading"],
		[["   ", "0.56.11"], "no-boot-reading"],
		[["0.56.2", null], "no-install-reading"],
		[["0.56.2", ""], "no-install-reading"],
		[["unknown", "0.56.11"], "unreadable-boot"],
		[["0.56.2", "not-a-version"], "unreadable-install"],
		// Orderable to the grammar but not as `x.y.z`, which is the form the install
		// path orders with: this cannot say which is older, so it says so rather than
		// restarting on a guess.
		[["0.56", "0.56.11"], "unorderable"],
	];
	for (const [[boot, install], reason] of cases) {
		assert.deepEqual(
			backendVersionDrift(boot, install),
			{ kind: "none", reason },
			`${boot} vs ${install} was not reported as ${reason}`,
		);
		assert.equal(
			driftRestartDecision({
				...quiet,
				drift: backendVersionDrift(boot, install),
			}).restart,
			false,
			`${boot} vs ${install} restarted on a reading that cannot order them`,
		);
	}
});

test("the decision restarts what the app owns, and only that", () => {
	const stale = backendVersionDrift("0.56.2", "0.56.11");
	assert.deepEqual(driftRestartDecision({ ...quiet, drift: stale }), {
		restart: true,
	});

	// A daemon this app did not start is not its to bounce - the existing contract
	// the skew notice's own sentence states, not a new rule.
	assert.deepEqual(
		driftRestartDecision({ ...quiet, drift: stale, appOwned: false }),
		{ restart: false, because: "not-app-owned" },
	);

	// An update already under way stops and starts the daemon itself; a restart
	// here would race it.
	assert.deepEqual(
		driftRestartDecision({ ...quiet, drift: stale, updateInFlight: true }),
		{ restart: false, because: "update-in-flight" },
	);

	// A conversation is being watched: wait, but not forever. The count is the
	// reason the hold cannot last the session.
	assert.deepEqual(
		driftRestartDecision({ ...quiet, drift: stale, sessionStreamOpen: true }),
		{ restart: false, because: "session-stream-open" },
	);
	assert.deepEqual(
		driftRestartDecision({
			...quiet,
			drift: stale,
			sessionStreamOpen: true,
			deferrals: DRIFT_DEFERRALS_BEFORE_RESTART,
		}),
		{ restart: true },
	);

	// The refusals are not deferrals: an unowned daemon stays unowned however many
	// checks have gone by.
	assert.deepEqual(
		driftRestartDecision({
			...quiet,
			drift: stale,
			appOwned: false,
			sessionStreamOpen: true,
			deferrals: 99,
		}),
		{ restart: false, because: "not-app-owned" },
	);
});

test("the boot reading comes from the daemon's own record", () => {
	const dir = mkdtempSync(join(tmpdir(), "lo-serve-record-"));
	trees.push(dir);

	// The operator's record, read from the running daemon's file. Everything
	// beyond the fields the parser requires is noise this read must pass through.
	writeFileSync(
		join(dir, "52156.json"),
		JSON.stringify({
			instance_id: "g9o4c1a2b3d4e5f6a7b8c9d0e1f2a3b4",
			pid: 52156,
			host: "127.0.0.1",
			port: 1111,
			version: "0.56.2",
			prefix: "/Users/someone/.local/share/uv/tools/local-operator",
			install_kind: "uv-tool",
			heartbeat_at: 1_760_000_000,
			started_at: 1_759_999_000,
		}),
	);
	assert.equal(serveRecordVersion(52156, dir), "0.56.2");

	// An install whose record predates the field: an absence, and specifically NOT
	// a fallback to `/health` (which answers with the on-disk version and would
	// hide the skew entirely).
	writeFileSync(
		join(dir, "52500.json"),
		JSON.stringify({
			instance_id: "a".repeat(32),
			pid: 52500,
			host: "127.0.0.1",
			port: 1112,
		}),
	);
	assert.equal(serveRecordVersion(52500, dir), null);

	// No record for this pid, a torn document, and pids that are not pids are all
	// the same absence rather than somebody else's version.
	assert.equal(serveRecordVersion(99999, dir), null);
	writeFileSync(join(dir, "52501.json"), "{ not json");
	assert.equal(serveRecordVersion(52501, dir), null);
	// A document that parses but is not a record at all (no pid/instance id).
	writeFileSync(join(dir, "52502.json"), JSON.stringify({ version: "9.9.9" }));
	assert.equal(serveRecordVersion(52502, dir), null);
	for (const notAPid of [null, undefined, 0, -4, 1.5, Number.NaN]) {
		assert.equal(serveRecordVersion(notAPid, dir), null, `pid ${notAPid}`);
	}
});

test("the drift is wired to the record and not to /health", () => {
	// The trap, pinned as a test rather than a sentence in a comment. `/health`'s
	// `version` is computed from the metadata ON DISK, so a stale process answers
	// with the newer version and the skew is invisible; the serve record is written
	// once at boot and cannot lie that way. A future edit that reaches for the
	// convenient field fails here.
	const service = readFileSync("src/main/backend/backend-service.ts", "utf8");
	const method = service.slice(
		service.indexOf("getAttachedBootVersion(): string | null {"),
		service.indexOf("hasOpenSessionStreams(): boolean {"),
	);
	assert.ok(method.length > 0, "getAttachedBootVersion is gone");
	assert.ok(
		method.includes("serveRecordVersion("),
		"the boot reading no longer reads the daemon's serve record",
	);
	assert.ok(
		method.includes("attachedRecord"),
		"the adopted daemon's own record is no longer read",
	);
	for (const forbidden of [
		"/health",
		"getStatusSnapshot",
		"identity.version",
	]) {
		assert.ok(
			!method.includes(forbidden),
			`getAttachedBootVersion reads ${forbidden}, which cannot see a stale process`,
		);
	}

	const updateService = readFileSync("src/main/update-service.ts", "utf8");
	assert.ok(
		updateService.includes(
			"const bootVersion = this.backendService?.getAttachedBootVersion() ?? null;",
		),
		"the check no longer takes the boot reading from the record",
	);
	assert.ok(
		updateService.includes("backendVersionDrift(bootVersion, installVersion)"),
		"the check no longer compares the boot reading against the INSTALL on disk",
	);
	assert.ok(
		updateService.includes(
			"await this.settleBackendVersionDrift(installVersion)",
		),
		"the drift is computed but never acted on from the check",
	);
});
