import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
	driftInstallReading,
	driftRestartDecision,
	serveRecord,
	serveRecordVersion,
	servingInstallIsAppManaged,
	servingInstallIsAppOwned,
	servingInstallReadings,
	servingWorkStateFromSessions,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** A record as the daemon publishes one, with the fields these rules read. */
const record = (over = {}) => ({
	pid: 52156,
	host: "127.0.0.1",
	port: 1111,
	instance_id: "g9o4c1a2b3d4e5f6a7b8c9d0e1f2a3b4",
	version: "0.56.2",
	source_ref: "",
	prefix:
		"/Users/someone/Library/Application Support/Local Operator/managed-python/packaged/environments/183b",
	install_kind: "pip",
	desktop: true,
	claim_key: "",
	started_at: 1_759_999_000,
	heartbeat_at: 1_760_000_000,
	retiring_from: null,
	retiring_to: null,
	...over,
});

/** The managed environment roots an installed app on a darwin host declares. */
const MANAGED_ROOTS = [
	"/Users/someone/Library/Application Support/Local Operator/managed-python/packaged",
	"/Users/someone/Library/Application Support/Local Operator/local-operator-venv",
];

/** A decision input with nothing holding the restart. */
const quiet = {
	installSource: "serving-environment",
	appOwned: true,
	workState: "idle",
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
	// the skew notice's own sentence states, not a new rule. Who counts as owned is
	// `servingInstallIsAppOwned`'s answer; this only carries it.
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

	// A conversation is being watched and nothing is running in it: wait one
	// cycle, and no longer. The bounded hold is a courtesy, not the safety gate.
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

	// And a comparison that does not hold is not a skew to repair: the readings
	// describe installs nobody has shown to be the same one.
	assert.deepEqual(
		driftRestartDecision({
			...quiet,
			drift: stale,
			installSource: "unknown",
		}),
		{ restart: false, because: "serving-install-unknown" },
	);
});

/**
 * A RESTART KILLS A RUNNING TURN, so the daemon's own work state gates it.
 *
 * `stop(true)` is SIGTERM, ten seconds, SIGKILL, and the daemon declines exactly
 * that exit itself because its shutdown cancels work it owns (round 1, R2). The
 * guard this replaces was a count of renderer SUBSCRIPTIONS - a mounted chat
 * holds one while idle, and an unwatched background turn holds none - i.e.
 * backwards for the risk. `busy` is the daemon's own answer about a turn.
 */
test("work in flight holds the restart, without a bound", () => {
	const stale = backendVersionDrift("0.56.2", "0.56.11");

	// A turn is running: hold, and keep holding however many checks go by. A
	// bounded hold here would restart into the turn it was waiting for.
	assert.deepEqual(
		driftRestartDecision({ ...quiet, drift: stale, workState: "busy" }),
		{ restart: false, because: "work-in-flight" },
	);
	assert.deepEqual(
		driftRestartDecision({
			...quiet,
			drift: stale,
			workState: "busy",
			deferrals: 500,
			sessionStreamOpen: true,
		}),
		{ restart: false, because: "work-in-flight" },
	);

	// The read could not be taken (or the daemon is too old to publish the
	// signal): fail CLOSED. Unknown is not idle - a read that failed is not
	// evidence that the machine is quiet.
	assert.deepEqual(
		driftRestartDecision({ ...quiet, drift: stale, workState: "unknown" }),
		{ restart: false, because: "work-state-unknown" },
	);
});

/**
 * The roster the app reads the work state from, and the one absence that is not
 * `idle`: a daemon whose rows predate `live_state`.
 */
test("the daemon's work state is read from its own roster", () => {
	const list = (sessions) => ({ result: { sessions } });

	assert.equal(
		servingWorkStateFromSessions(
			list([
				{ id: "a", live_state: "idle" },
				{ id: "b", live_state: "busy" },
			]),
		),
		"busy",
	);
	assert.equal(
		servingWorkStateFromSessions(
			list([
				{ id: "a", live_state: "idle" },
				{ id: "b", live_state: "attached" },
				// A wedged row is somebody else's silence - a live pid that stopped
				// reporting - not this daemon's work. Holding on it would leave the
				// repair inert forever.
				{ id: "c", live_state: "wedged" },
				{ id: "d", live_state: "" },
			]),
		),
		"idle",
	);
	// No sessions at all is a quiet machine, not an unreadable one.
	assert.equal(servingWorkStateFromSessions(list([])), "idle");

	// A daemon predating the field: `_row_for` always sets `live_state` (empty
	// for a cold row), so no row carrying the key at all is a fact about the
	// BUILD, and reading it as idle would restart under work this app cannot see.
	assert.equal(
		servingWorkStateFromSessions(
			list([{ id: "a", name: "Working" }, { id: "b" }]),
		),
		"unknown",
	);

	// A read that did not answer, a non-200, and a body that is not a roster are
	// all the same absence.
	for (const nothing of [
		null,
		undefined,
		{},
		{ result: {} },
		{ result: { sessions: "nope" } },
	])
		assert.equal(
			servingWorkStateFromSessions(nothing),
			"unknown",
			`${JSON.stringify(nothing)} was read as a quiet machine`,
		);
});

/**
 * WHICH INSTALL THE COMPARISON IS AGAINST - finding R1 of round 1, RECONCILED with
 * the reading that landed on `main` while this branch was open (#318, "judge the
 * install that serves the app, not the one the shim names").
 *
 * Both changes answer one question, and the answer kept is #318's: the install the
 * plan resolves when the backend named the root it runs from - the version on disk
 * at that root. This branch's own second reading (`identity.venvPrefix` equality
 * plus `/health`'s version) is retired, because two functions answering "which
 * install is this about" is how the panel, the installer and this check come to
 * disagree; the trap this module exists for is untouched, because `/health`'s
 * version is still never the RUNNING side.
 *
 * What is left for THIS check to refuse is the one case #318 still falls back in:
 * a server that named no root, where the plan's reading is the shim's install -
 * a different install from the one answering, and a skew across the two that may
 * not exist.
 */
test("the install reading is the serving install's own, and is refused when it is not", () => {
	const bundled = servingInstallReadings(record());

	// The plan's reading when it describes the serving install - the app-owned mode
	// (#318 gives it a reading now: the version at the root the server named) and
	// the mode where the serving root's own identity answered.
	assert.deepEqual(
		driftInstallReading({
			planVersion: "0.56.11",
			planDescribesServingInstall: true,
		}),
		{ version: "0.56.11", source: "serving-install" },
	);

	// ...and it is still the skew to repair: 0.56.2 booted, 0.56.11 on disk.
	assert.deepEqual(backendVersionDrift(bundled.bootVersion, "0.56.11"), {
		kind: "stale",
		bootVersion: "0.56.2",
		installVersion: "0.56.11",
	});

	// A server that named no root leaves the plan on the shim's install (the
	// operator's own pair: uv tool 0.56.13, bundled daemon 0.56.8). Comparing a boot
	// reading against THAT is a skew between two installs nobody showed to be the
	// same one.
	assert.deepEqual(
		driftInstallReading({
			planVersion: "0.56.13",
			planDescribesServingInstall: false,
		}),
		{ version: "0.56.13", source: "unknown" },
	);
	assert.deepEqual(
		driftRestartDecision({
			...quiet,
			drift: backendVersionDrift("0.56.2", "0.56.13"),
			installSource: "unknown",
		}),
		{ restart: false, because: "serving-install-unknown" },
	);
});

/**
 * WHO MAY BE RESTARTED: the process THIS app run holds, and nothing else.
 *
 * Narrowed by QA round 1's Q1, which drove the loose answer on the real bundle. The
 * repair acts through `restart()` = `stop(true)` + `start()`; `stop()` can only
 * terminate a generation this process HOLDS, so for a daemon discovery adopted
 * there is nothing to stop, the pid cannot move, and "restarted" was a claim about
 * a call rather than about the machine. Two readings that describe a daemon this app
 * BUILT but does not hold - an unspent claim key, an environment this instance
 * manages - are therefore reported as unrepairable instead of acted on, and
 * `startedByEarlierAppRun` is what makes that refusal say which case the reader is
 * in. The process is not killed by pid instead: the app has no successor-readiness
 * handshake, `server/retire.py` refuses the exit by contract, and a pid is not a
 * handle.
 */
test("only the process this app run holds may be restarted", () => {
	const owned = (readings, spawnedByThisProcess = false) =>
		servingInstallIsAppOwned({
			spawnedByThisProcess,
			readings,
			managedEnvironmentRoots: MANAGED_ROOTS,
		});

	// This process's own child, whatever its record says.
	const child = owned(servingInstallReadings(record({ desktop: false })), true);
	assert.equal(child.owned, true);
	assert.match(child.because, /this app process started it/);

	// THE OPERATOR'S OWN MODE, and the case Q1 is about: adopted as
	// `EXISTING_SERVER`, its record says the app started it (an unspent claim key)
	// and it runs from an environment this instance manages - and it is NOT
	// restarted, because this app run holds no process to stop.
	const adopted = owned(servingInstallReadings(record()));
	assert.equal(adopted.owned, false);
	assert.equal(adopted.startedByEarlierAppRun, true);
	assert.match(adopted.because, /an environment this app manages/);

	// A build predating the claim handshake publishes an empty key either way, so
	// the environment is the reading that still says who built it - and the answer
	// is the same one: reportable, not restarted.
	const preHandshake = owned(
		servingInstallReadings(
			record({
				desktop: false,
				prefix:
					"/Users/someone/Library/Application Support/Local Operator/managed-python/packaged/environments/28f0",
			}),
		),
	);
	assert.equal(preHandshake.owned, false);
	assert.equal(preHandshake.startedByEarlierAppRun, true);

	// The pre-split venv name is still the app's environment, and still not a
	// process this app run holds.
	const preSplit = owned(
		servingInstallReadings(
			record({
				desktop: false,
				prefix:
					"/Users/someone/Library/Application Support/Local Operator/local-operator-venv",
			}),
		),
	);
	assert.equal(preSplit.owned, false);
	assert.equal(preSplit.startedByEarlierAppRun, true);

	// A daemon a PERSON started from a shell, which the app then CLAIMED: the
	// record's `desktop` is true but the claim key is spent, and its install is
	// not one this app manages. Not this app's to bounce, and not an earlier app
	// run's either - the sentence has to say so.
	const claimed = owned(
		servingInstallReadings(
			record({
				desktop: false,
				prefix: "/Users/someone/.local/share/uv/tools/local-operator",
				install_kind: "uv-tool",
			}),
		),
	);
	assert.equal(claimed.owned, false);
	assert.equal(claimed.startedByEarlierAppRun, false);
	assert.match(claimed.because, /does not manage/);

	// And the packaged/dev split is not crossed: a DEV instance's roots do not
	// claim the installed app's environment.
	assert.equal(
		servingInstallIsAppManaged(record().prefix, [
			"/Users/someone/Library/Application Support/Local Operator/managed-python/dev",
		]),
		false,
	);

	// A prefix under a root only by string accident (a sibling whose name starts
	// with the root's) is not inside it.
	assert.equal(
		servingInstallIsAppManaged(
			"/Users/someone/Library/Application Support/Local Operator/managed-python/packaged-evil/x",
			MANAGED_ROOTS,
		),
		false,
	);
});

test("the boot reading comes from the daemon's own record", () => {
	const dir = mkdtempSync(join(tmpdir(), "lo-serve-record-"));
	trees.push(dir);

	// The operator's record, read from the running daemon's file. Everything
	// beyond the fields the parser requires is noise this read must pass through.
	writeFileSync(join(dir, "52156.json"), JSON.stringify(record()));
	assert.equal(serveRecordVersion(52156, dir), "0.56.2");
	// The whole record, not just the version: the drift needs the prefix and the
	// claim handshake off the SAME document.
	const parsed = serveRecord(52156, dir);
	assert.equal(parsed.prefix, record().prefix);
	assert.equal(parsed.install_kind, "pip");
	assert.deepEqual(servingInstallReadings(parsed), {
		bootVersion: "0.56.2",
		prefix: record().prefix,
		installKind: "pip",
		startedByApp: true,
	});

	// A record published by a build predating the claim handshake: the version is
	// still the build it loaded, and the ownership grounds fall back to the
	// environment.
	assert.deepEqual(
		servingInstallReadings(serveRecord(52156, dir)),
		servingInstallReadings(record()),
	);

	// An install whose record predates the version field: an absence, and
	// specifically NOT a fallback to `/health` (which answers with the on-disk
	// version and would hide the skew entirely).
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
	assert.equal(serveRecord(52500, dir).prefix, "");

	// No record for this pid, a torn document, and pids that are not pids are all
	// the same absence rather than somebody else's version.
	assert.equal(serveRecordVersion(99999, dir), null);
	writeFileSync(join(dir, "52501.json"), "{ not json");
	assert.equal(serveRecordVersion(52501, dir), null);
	// A document that parses but is not a record at all (no pid/instance id).
	writeFileSync(join(dir, "52502.json"), JSON.stringify({ version: "9.9.9" }));
	assert.equal(serveRecordVersion(52502, dir), null);
	assert.equal(serveRecord(52502, dir), null);
	for (const notAPid of [null, undefined, 0, -4, 1.5, Number.NaN]) {
		assert.equal(serveRecordVersion(notAPid, dir), null, `pid ${notAPid}`);
		assert.equal(serveRecord(notAPid, dir), null, `pid ${notAPid}`);
	}
});

/*
 * WHAT IS NOT TESTED HERE, and where it is: the WIRING.
 *
 * A restart is triggered by `UpdateService.settleBackendVersionDrift`, and the
 * reading it consumes is `BackendServiceManager.servingInstall()` - both of them
 * Electron-side, and both driven end to end by `scripts/update-robustness.test.mjs`
 * through its stand-in manager instead of by source text read here (review round 1,
 * R8: this file used to assert on exact method-body substrings of
 * `update-service.ts`, so a formatter line-wrap or a signature touch-up failed a
 * behaviour-preserving edit, and one of its negative assertions only passed
 * because a doc comment happened to sit outside the slice).
 */
