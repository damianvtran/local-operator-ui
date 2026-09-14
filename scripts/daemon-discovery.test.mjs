/**
 * Regression guards for daemon discovery: which serve record the app attaches
 * to, and why it refuses the rest.
 *
 * These are the rules that replaced "probe one URL and accept any 200". They run
 * against REAL loopback HTTP servers and REAL record files in a temporary config
 * root, because the failures they encode were all about a live process answering
 * something plausible:
 *
 *   - a 200 with no `instance_id` (the old bug: a dev server eleven releases
 *     behind, accepted as "the backend");
 *   - a 200 from a process that is not the one the record described;
 *   - a record whose pid is gone, and one whose heartbeat stopped;
 *   - two live daemons, where the app must prefer the install the user's CLI
 *     runs over the newest process.
 *
 * The app is never launched: this bundles the shipped TypeScript in memory and
 * drives it directly, which is what makes it a unit-level guard rather than a
 * claim about the app.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: 'export * from "./src/main/backend/discovery";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const discovery = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const {
	classifyRecord,
	claimDesktopPlane,
	compareVersions,
	configRoot,
	discoverDaemons,
	normaliseAddress,
	parseRecord,
	pidLiveness,
	probeIdentity,
	rankCandidates,
	reapStaleRecords,
	readDesktopAvailable,
	readServeRecords,
	serveRunDir,
	HEARTBEAT_TIMEOUT_MS,
} = discovery;

let configRootPath;
let runDir;
// Every server this file opens is registered here, so a failing assertion can
// never leak a listener and hang the runner on an open handle.
const openServers = new Set();

before(() => {
	configRootPath = mkdtempSync(join(tmpdir(), "lop-ui-discovery-"));
	runDir = join(configRootPath, "run", "serve");
	mkdirSync(runDir, { recursive: true });
});

after(async () => {
	for (const server of openServers) {
		await new Promise((resolve) => server.close(resolve));
	}
	rmSync(configRootPath, { recursive: true, force: true });
});

/** A real daemon: a loopback HTTP server that answers `/health` like one. */
async function startDaemon({
	instanceId,
	version,
	prefix = "/tmp/prefix",
	installKind = "uv-tool",
	pid = process.pid,
	healthStatus = 200,
	healthBody,
	claim = null,
} = {}) {
	const seen = [];
	const server = createServer(async (req, res) => {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		seen.push({
			path: req.url,
			method: req.method,
			authorization: req.headers.authorization,
			body: Buffer.concat(chunks).toString(),
		});
		if (req.url === "/v1/desktop/claim") {
			const verdict = claim ?? { status: 200 };
			res.writeHead(verdict.status, {
				"Content-Type": "application/json",
			});
			res.end(JSON.stringify(verdict.body ?? { status: verdict.status }));
			return;
		}
		if (req.url === "/v1/capabilities") {
			res.setHeader("Content-Type", "application/json");
			res.end(
				JSON.stringify({
					status: 200,
					message: "ok",
					result: { desktop_available: false },
				}),
			);
			return;
		}
		if (req.url === "/health") {
			res.writeHead(healthStatus, { "Content-Type": "application/json" });
			if (healthBody !== undefined) {
				res.end(JSON.stringify(healthBody));
				return;
			}
			res.end(
				JSON.stringify({
					status: 200,
					message: "ok",
					result: {
						version,
						instance_id: instanceId,
						pid,
						prefix,
						install_kind: installKind,
					},
				}),
			);
			return;
		}
		res.writeHead(404).end();
	});
	openServers.add(server);
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = `http://127.0.0.1:${server.address().port}`;
	return {
		address,
		port: server.address().port,
		seen,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}

/** Write a record into the isolated run dir, or anywhere it is told to. */
function writeRecord(
	{
		pid,
		port,
		instanceId,
		version = "0.54.46",
		prefix = "/tmp/prefix",
		heartbeatAt,
		startedAt,
		claimKey = "",
		host = "127.0.0.1",
	},
	dir = runDir,
	name = null,
) {
	const now = Date.now() / 1000;
	// Keyed by pid in production; the tests name files explicitly where two
	// records must coexist for one live pid (the ranking case).
	const file = join(dir, name ?? `${pid}.json`);
	writeFileSync(
		file,
		JSON.stringify({
			pid,
			host,
			port,
			instance_id: instanceId,
			version,
			source_ref: "",
			prefix,
			install_kind: "uv-tool",
			desktop: false,
			claim_key: claimKey,
			started_at: startedAt ?? now - 10,
			heartbeat_at: heartbeatAt ?? now - 1,
		}),
		{ mode: 0o600 },
	);
	return file;
}

/** A pid that is definitely gone: a child we waited out. */
async function deadPid() {
	const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
	const pid = child.pid;
	await new Promise((resolve) => child.on("exit", resolve));
	return pid;
}

const env = () => ({ LOCAL_OPERATOR_CONFIG_DIR: configRootPath });

const silence = () => {};

test("the config root honours LOCAL_OPERATOR_CONFIG_DIR over the home default", () => {
	assert.equal(
		configRoot({ LOCAL_OPERATOR_CONFIG_DIR: "/tmp/isolated" }),
		"/tmp/isolated",
	);
	assert.equal(
		serveRunDir({ LOCAL_OPERATOR_CONFIG_DIR: "/tmp/isolated" }),
		"/tmp/isolated/run/serve",
	);
	assert.match(configRoot({}), /\.local-operator$/);
	assert.match(serveRunDir({}), /\.local-operator\/run\/serve$/);
});

test("a live daemon with a matching instance_id is discovered and identified", async () => {
	const daemon = await startDaemon({
		instanceId: "instance-live-1",
		version: "0.54.46",
		prefix: "/Users/x/.local/share/uv/tools/local-operator",
	});
	const file = writeRecord({
		pid: process.pid,
		port: daemon.port,
		instanceId: "instance-live-1",
	});
	const lines = [];
	const result = await discoverDaemons({
		env: env(),
		configuredUrl: daemon.address,
		log: (line) => lines.push(line),
	});
	assert.equal(result.candidates.length, 1);
	assert.equal(result.picked.record.instance_id, "instance-live-1");
	assert.equal(result.picked.identity.version, "0.54.46");
	// The configured URL does not ELEVATE: an address it names ranks last.
	assert.equal(result.picked.source, "configured");
	assert.equal(result.noRecordsAtAll, false);
	assert.ok(
		lines.some((line) => line.includes("candidate")),
		"every candidate is logged so a wrong pick is diagnosable",
	);
	await daemon.close();
	rmSync(file, { force: true });
});

test("a listener that answers 200 without an instance_id is REJECTED (the old bug)", async () => {
	// :8080 in the operator's report: a live server, answering health, that is
	// not the daemon the record described. A bare 200 used to be enough.
	const stranger = await startDaemon({
		healthBody: { hello: "world" },
	});
	const result = await discoverDaemons({
		env: env(),
		configuredUrl: stranger.address,
		log: silence,
	});
	assert.equal(result.picked, null);
	assert.equal(result.candidates.length, 0);
	const rejection = result.rejected.find((r) => r.subject === stranger.address);
	assert.ok(
		rejection,
		"the configured address is reported, not silently skipped",
	);
	assert.equal(rejection.reason, "not-a-daemon");
	await stranger.close();
});

test("a daemon answering with a DIFFERENT instance_id is rejected", async () => {
	const daemon = await startDaemon({
		instanceId: "instance-actual",
		version: "0.54.46",
	});
	// A record that names the same address but a different process: the pid
	// reuse / port reuse case the identity check exists for.
	const file = writeRecord({
		pid: process.pid,
		port: daemon.port,
		instanceId: "instance-recorded",
	});
	const result = await discoverDaemons({ env: env(), log: silence });
	assert.equal(result.picked, null);
	assert.equal(result.rejected[0].reason, "identity-mismatch");
	assert.match(result.rejected[0].detail, /instance-recorded/);
	await daemon.close();
	rmSync(file, { force: true });
});

test("a record whose pid is gone is rejected as stale and offered for reaping", async () => {
	const pid = await deadPid();
	const file = writeRecord({
		pid,
		port: 65533,
		instanceId: "instance-dead",
		heartbeatAt: Date.now() / 1000 - (HEARTBEAT_TIMEOUT_MS + 5_000) / 1000,
	});
	const before = readServeRecords(runDir).files.length;
	const result = await discoverDaemons({ env: env(), log: silence });
	assert.equal(result.picked, null);
	const rejection = result.rejected.find((r) => r.subject === file);
	assert.equal(rejection.reason, "pid-dead");
	assert.deepEqual(result.reapable, [file]);
	assert.equal(
		readServeRecords(runDir).files.length,
		before,
		"discovery itself does not delete",
	);
	assert.deepEqual(reapStaleRecords(result.reapable), [file]);
	assert.ok(!readServeRecords(runDir).files.some((f) => f.file === file));
});

test("a WEDGED record (live pid, stopped heartbeat) is reported, not attached to, not reaped", async () => {
	const file = writeRecord({
		pid: process.pid,
		port: 65534,
		instanceId: "instance-wedged",
		heartbeatAt: Date.now() / 1000 - (HEARTBEAT_TIMEOUT_MS + 5_000) / 1000,
	});
	const result = await discoverDaemons({ env: env(), log: silence });
	const rejection = result.rejected.find((r) => r.subject === file);
	assert.equal(rejection.reason, "wedged");
	assert.equal(result.picked, null);
	assert.deepEqual(result.reapable, [], "a live process keeps its record");
	rmSync(file, { force: true });
});

test("a record from the future is ignored rather than trusted for ordering", async () => {
	const file = writeRecord({
		pid: process.pid,
		port: 65535,
		instanceId: "instance-future",
		startedAt: Date.now() / 1000 + 3600,
	});
	const result = await discoverDaemons({ env: env(), log: silence });
	assert.equal(
		result.rejected.find((r) => r.subject === file).reason,
		"clock-skew",
	);
	rmSync(file, { force: true });
});

test("ranking prefers the install the user's CLI runs over the newest process", async () => {
	const pinnedPrefix = "/tmp/uv-tools/local-operator";
	const older = await startDaemon({
		instanceId: "instance-cli",
		version: "0.54.46",
		prefix: pinnedPrefix,
	});
	const newer = await startDaemon({
		instanceId: "instance-newest",
		version: "0.99.0",
		prefix: "/tmp/bundled-venv",
	});
	const olderFile = writeRecord(
		{
			pid: process.pid,
			port: older.port,
			instanceId: "instance-cli",
			version: "0.54.46",
			prefix: pinnedPrefix,
		},
		runDir,
		"cli-install.json",
	);
	const newerFile = writeRecord(
		{
			pid: process.pid,
			port: newer.port,
			instanceId: "instance-newest",
			version: "0.99.0",
			prefix: "/tmp/bundled-venv",
		},
		runDir,
		"bundled-venv.json",
	);

	const result = await discoverDaemons({
		env: env(),
		preferredPrefix: pinnedPrefix,
		log: silence,
	});
	assert.equal(result.candidates.length, 2);
	assert.equal(result.picked.record.prefix, pinnedPrefix);

	// Without a named preferred install, the NEWER build wins instead.
	const unpinned = await discoverDaemons({ env: env(), log: silence });
	assert.equal(unpinned.picked.record.version, "0.99.0");

	await older.close();
	await newer.close();
	rmSync(olderFile, { force: true });
	rmSync(newerFile, { force: true });
});

test("ranking compares versions numerically, and treats the configured URL as last", () => {
	const candidate = (version, source, startedAt = 0, prefix = "/p") => ({
		address: `http://${version}:1`,
		record: { version, source_ref: "", started_at: startedAt, prefix },
		file: "f",
		health: "live",
		source,
		identity: {},
	});
	assert.ok(
		compareVersions("0.54.46", "0.54.9") > 0,
		"the patch component is numeric, not lexicographic",
	);
	assert.equal(compareVersions("0.55.0", "0.54.99"), 1);
	assert.equal(compareVersions("1.0.0", "1.0.0-rc1"), 0);
	const ranked = rankCandidates(
		[candidate("9.9.9", "configured"), candidate("0.1.0", "record")],
		null,
	);
	assert.equal(
		ranked[0].record.version,
		"0.1.0",
		"a configured address never outranks a found daemon",
	);
	const byVersion = rankCandidates(
		[candidate("0.1.0", "record", 999), candidate("0.2.0", "record")],
		null,
	);
	assert.equal(byVersion[0].record.version, "0.2.0");
});

test("a daemon with no records at all is reported, so the caller knows to use the legacy probe", async () => {
	const emptyRoot = mkdtempSync(join(tmpdir(), "lop-ui-discovery-empty-"));
	const result = await discoverDaemons({
		env: { LOCAL_OPERATOR_CONFIG_DIR: emptyRoot },
		log: silence,
	});
	assert.equal(result.noRecordsAtAll, true);
	assert.equal(result.picked, null);
	rmSync(emptyRoot, { recursive: true, force: true });
});

test("pid liveness follows the backend's own rule: ESRCH is gone, EPERM is alive", async () => {
	assert.equal(pidLiveness(process.pid), "alive");
	assert.equal(pidLiveness(await deadPid()), "dead");
	// PID 1 is alive but not ours: EPERM means alive for this question.
	assert.equal(pidLiveness(1), "alive");
});

test("classification needs BOTH a dead pid and an aged heartbeat to call a record stale", async () => {
	const now = Date.now();
	const gone = await deadPid();
	const record = (pid, heartbeatAgeMs) => ({
		pid,
		host: "127.0.0.1",
		port: 1111,
		instance_id: "i",
		version: "0.54.46",
		source_ref: "",
		prefix: "",
		install_kind: "",
		desktop: false,
		claim_key: "",
		started_at: 0,
		heartbeat_at: (now - heartbeatAgeMs) / 1000,
	});
	assert.equal(classifyRecord(record(process.pid, 1_000), now), "live");
	assert.equal(
		classifyRecord(record(gone, 1_000), now),
		"wedged",
		"a fresh heartbeat on a dead pid is not yet stale",
	);
	assert.equal(
		classifyRecord(record(gone, HEARTBEAT_TIMEOUT_MS + 1_000), now),
		"stale",
	);
	assert.equal(
		classifyRecord(record(process.pid, HEARTBEAT_TIMEOUT_MS + 1_000), now),
		"wedged",
		"a live process is never stale",
	);
});

test("record parsing refuses a record with no dialable address rather than guessing", () => {
	assert.equal(
		parseRecord({ pid: 1, host: "127.0.0.1", port: 0, instance_id: "i" }, "f")
			.problem,
		"malformed",
	);
	assert.equal(
		parseRecord({ host: "127.0.0.1", port: 1, instance_id: "i" }, "f").problem,
		"malformed",
	);
	assert.equal(
		parseRecord({ pid: 1, host: "127.0.0.1", port: 1 }, "f").problem,
		"malformed",
	);
	assert.equal(parseRecord([], "f").problem, "malformed");
	const ok = parseRecord(
		{ pid: 1, host: "::1", port: 1111, instance_id: "i" },
		"f",
	);
	assert.equal(ok.problem, undefined);
	assert.equal(discovery.recordAddress(ok.record), "http://[::1]:1111");
});

test("the claim handshake sends the record's key as the bearer, never null or a wildcard", async () => {
	const claimed = await startDaemon({
		instanceId: "instance-claim",
		version: "0.54.46",
		claim: {
			status: 200,
			body: { claimed: true, instance_id: "instance-claim" },
		},
	});
	const outcome = await claimDesktopPlane(
		claimed.address,
		"key-from-the-record",
		{
			origins: [
				"http://localhost:5173",
				"null",
				"*",
				"file:///x",
				"not-an-origin",
			],
		},
	);
	assert.deepEqual(outcome, {
		outcome: "claimed",
		origins: ["http://localhost:5173"],
	});
	const request = claimed.seen.find((r) => r.path === "/v1/desktop/claim");
	assert.equal(request.method, "POST");
	assert.equal(request.authorization, "Bearer key-from-the-record");
	assert.deepEqual(JSON.parse(request.body), {
		origins: ["http://localhost:5173"],
	});
	await claimed.close();

	// A native caller (no renderer origin to declare) sends an empty object.
	const native = await startDaemon({
		instanceId: "instance-native",
		version: "0.54.46",
		claim: { status: 200, body: { claimed: true } },
	});
	await claimDesktopPlane(native.address, "another-key", { origins: ["null"] });
	const nativeClaim = native.seen.find((r) => r.path === "/v1/desktop/claim");
	assert.deepEqual(JSON.parse(nativeClaim.body), {});
	await native.close();
});

test("the claim latch's 409 and a wrong key's 401 are distinct, named outcomes", async () => {
	const latched = await startDaemon({
		instanceId: "instance-latched",
		version: "0.54.46",
		claim: {
			status: 409,
			body: { detail: "This desktop plane is already controlled." },
		},
	});
	assert.deepEqual(await claimDesktopPlane(latched.address, "key", {}), {
		outcome: "already-claimed",
		status: 409,
	});
	await latched.close();

	const wrongKey = await startDaemon({
		instanceId: "instance-wrongkey",
		version: "0.54.46",
		claim: {
			status: 401,
			body: { detail: "Desktop claim authorization is required." },
		},
	});
	assert.deepEqual(await claimDesktopPlane(wrongKey.address, "stale-key", {}), {
		outcome: "wrong-key",
		status: 401,
	});
	await wrongKey.close();

	const refused = await startDaemon({
		instanceId: "instance-refused",
		version: "0.54.46",
		claim: {
			status: 503,
			body: { detail: "This backend published no desktop claim key." },
		},
	});
	assert.deepEqual(await claimDesktopPlane(refused.address, "key", {}), {
		outcome: "refused",
		status: 503,
		detail: "claim refused with 503",
	});
	await refused.close();
});

test("a capability refusal is read as a capability, never as liveness", async () => {
	const gated = await startDaemon({
		instanceId: "instance-gated",
		version: "0.54.46",
	});
	const reported = await readDesktopAvailable(gated.address);
	assert.equal(
		reported.available,
		false,
		"desktop_available false before a claim",
	);
	assert.equal(reported.status, 200);
	await gated.close();

	// A daemon that is not there answers nothing - a null, not a "false".
	const gone = await readDesktopAvailable("http://127.0.0.1:1");
	assert.equal(gone.available, null);
	assert.equal(gone.status, null);
});

test("a probe with a 2 s budget does not wait out a hung listener", async () => {
	const hung = createServer(() => {
		/* never answers */
	});
	await new Promise((resolve) => hung.listen(0, "127.0.0.1", resolve));
	const address = `http://127.0.0.1:${hung.address().port}`;
	const started = Date.now();
	const probe = await probeIdentity(address, "whatever", { timeoutMs: 500 });
	assert.equal(probe.outcome, "unreachable");
	assert.ok(Date.now() - started < 5_000);
	await new Promise((resolve) => hung.close(resolve));
});

test("addresses are normalised so an address comparison is exact", () => {
	assert.equal(
		normaliseAddress("http://127.0.0.1:1111/"),
		"http://127.0.0.1:1111",
	);
	assert.equal(
		normaliseAddress("http://localhost:1111"),
		"http://localhost:1111",
	);
	assert.equal(normaliseAddress("not a url"), null);
	assert.equal(normaliseAddress(""), null);
	assert.equal(normaliseAddress(null), null);
});
