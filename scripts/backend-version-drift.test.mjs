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
 * WHICH INSTALL THE COMPARISON IS AGAINST, which is finding R1 of round 1.
 *
 * The first cut compared the boot reading against the plan's
 * `installedInstallVersion`, and that field is null for every mode whose
 * environment the app owns - the mode the app spawns its own daemon in - so the
 * repair could not fire on the machine the incident came from, and said nothing.
 * `/health` cannot be the RUNNING side; as the INSTALL side, read by the serving
 * process about its own prefix, it is the only same-install reading there is.
 */
test("the install reading is the install the serving process runs from", () => {
	const bundled = servingInstallReadings(record());

	// APP_BUNDLED_VENV: the plan has no reading, and the serving environment is
	// this app's own, so `/health`'s answer is the install on disk.
	assert.deepEqual(
		driftInstallReading({
			planVersion: null,
			planPrefix: "",
			servingReadings: bundled,
			servingIsAppManaged: true,
			healthVersion: "0.56.11",
		}),
		{ version: "0.56.11", source: "serving-environment" },
	);
	// ...and it is still the skew to repair: 0.56.2 booted, 0.56.11 on disk.
	assert.deepEqual(backendVersionDrift(bundled.bootVersion, "0.56.11"), {
		kind: "stale",
		bootVersion: "0.56.2",
		installVersion: "0.56.11",
	});

	// GLOBAL_INSTALL: the plan describes the install the daemon runs from, so its
	// reading is the one the update path is held to.
	assert.deepEqual(
		driftInstallReading({
			planVersion: "0.56.11",
			planPrefix: bundled.prefix,
			servingReadings: bundled,
			servingIsAppManaged: true,
			healthVersion: "0.56.11",
		}),
		{ version: "0.56.11", source: "plan-install" },
	);

	// An adopted daemon running a DIFFERENT install from the one the plan names
	// (the operator's own pair: uv tool 0.56.13, bundled daemon 0.56.8). What the
	// plan reads describes the install an update would MOVE; the daemon's own
	// environment is the install that must be compared.
	assert.deepEqual(
		driftInstallReading({
			planVersion: "0.56.13",
			planPrefix: "/Users/someone/.local/share/uv/tools/local-operator",
			servingReadings: bundled,
			servingIsAppManaged: true,
			healthVersion: "0.56.11",
		}),
		{ version: "0.56.11", source: "serving-environment" },
	);

	// Neither install can be tied to the other and the environment is not this
	// app's: the honest answer is that which install the process booted from
	// cannot be told, and the decision refuses to act on it.
	assert.deepEqual(
		driftInstallReading({
			planVersion: "0.56.13",
			planPrefix: "/Users/someone/.local/share/uv/tools/local-operator",
			servingReadings: bundled,
			servingIsAppManaged: false,
			healthVersion: "0.56.8",
		}),
		{ version: "0.56.13", source: "unknown" },
	);

	// A record that names no prefix at all is the same absence, not a default.
	assert.deepEqual(
		driftInstallReading({
			planVersion: "0.56.13",
			planPrefix: "/Users/someone/.local/share/uv/tools/local-operator",
			servingReadings: servingInstallReadings(record({ prefix: "" })),
			servingIsAppManaged: false,
			healthVersion: "0.56.8",
		}),
		{ version: "0.56.13", source: "unknown" },
	);
});

/**
 * WHO MAY BE RESTARTED, from what actually started the serving process.
 *
 * The finding this replaces: ownership was `!isUsingExternalBackend()`, and
 * adoption sets that flag, so the daemon a PREVIOUS app process started - the
 * ordinary desktop lifecycle, and the daemon the operator's own log adopted as
 * `EXISTING_SERVER` 400 times - was refused as "a server this app did not
 * start".
 */
test("ownership follows what started the serving process", () => {
	const owned = (readings, spawnedByThisProcess = false) =>
		servingInstallIsAppOwned({
			spawnedByThisProcess,
			readings,
			managedEnvironmentRoots: MANAGED_ROOTS,
		});

	// This process's own child, whatever its record says.
	assert.deepEqual(
		owned(servingInstallReadings(record({ desktop: false })), true),
		{ owned: true, because: "this app process started it" },
	);

	// An adopted daemon whose record says the app started it (an unspent claim
	// key): the app started it, a previous app process did.
	const adopted = owned(servingInstallReadings(record()));
	assert.equal(adopted.owned, true);
	assert.match(adopted.because, /record says the app started it/);

	// A build predating the claim handshake publishes an empty key either way, so
	// the environment is the ground that holds: an environment this instance
	// manages is one whose daemon this app started.
	assert.equal(
		owned(servingInstallReadings(record({ desktop: false, claim_key: "" })))
			.owned,
		true,
	);
	assert.equal(
		owned(
			servingInstallReadings(
				record({
					desktop: false,
					prefix:
						"/Users/someone/Library/Application Support/Local Operator/managed-python/packaged/environments/28f0",
				}),
			),
		).owned,
		true,
	);

	// The pre-split venv name is still the app's environment.
	assert.equal(
		owned(
			servingInstallReadings(
				record({
					desktop: false,
					prefix:
						"/Users/someone/Library/Application Support/Local Operator/local-operator-venv",
				}),
			),
		).owned,
		true,
	);

	// A daemon a PERSON started from a shell, which the app then CLAIMED: the
	// record's `desktop` is true but the claim key is spent, and its install is
	// not one this app manages. Not this app's to bounce.
	const claimed = owned(
		servingInstallReadings(
			record({
				prefix: "/Users/someone/.local/share/uv/tools/local-operator",
				install_kind: "uv-tool",
				claim_key: "b7d1",
			}),
		),
	);
	assert.equal(claimed.owned, false);
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
