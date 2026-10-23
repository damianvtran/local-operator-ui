#!/usr/bin/env node
/** Three diagnostic cases only. Importing this file does not launch anything.
 * GNU timeout owns our PG; children/esbuild inherit it (never detached). Reuse
 * the repository's memory decision and identity-checked reaper, not app launch.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	readFileSync,
	readdirSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { isEntryPoint } from "./entry-point.mjs";
import {
	createMemoryWatchdog,
	killTree,
	parseProcStat,
	parseProcStatusRss,
	selectMembers,
} from "./desktop-test-memory-guard.mjs";

export const MODES = ["original", "held", "suppressed"];
const TITLE =
	"the commit record is not empty, so it cannot pass by observing nothing";
const CAP = 256 * 1024;
const RAM = 2048 * 1024 * 1024; // Diagnostic-only quarter of existing 8192MiB floor; unmeasured, never auto-raised.
const sha = (path) =>
	createHash("sha256").update(readFileSync(path)).digest("hex");

/** Pure protocol checker: expected negative FAIL is not an empty-observer PASS. */
export function checkRow(row, head) {
	if (
		!MODES.includes(row.mode) ||
		row.selected !== 1 ||
		!row.reaped ||
		!row.cleaned ||
		row.timedOut ||
		row.breached ||
		row.blind ||
		row.signal
	)
		throw new Error("incomplete execution/cleanup or bound");
	if (
		!Number.isInteger(row.pid) ||
		row.pid <= 1 ||
		!Number.isInteger(row.pgid) ||
		row.pgid <= 1
	)
		throw new Error("missing process identity");
	const s = row.summary;
	if (
		!s ||
		s.diagnostic !== "console-recorder-6911" ||
		s.mode !== row.mode ||
		s.head !== head ||
		s.node !== "v22.23.3" ||
		!/^[a-f0-9]{64}$/.test(s.compiled_sha256 ?? "")
	)
		throw new Error("missing identity/summary");
	if (
		!Number.isInteger(s.pid) ||
		s.ppid !== row.pid ||
		!Array.isArray(row.membersSeen) ||
		![row.pid, s.pid].every((pid) =>
			row.membersSeen.some(
				(m) =>
					m.pid === pid && m.pgid === row.pgid && typeof m.lstart === "string",
			),
		)
	)
		throw new Error("missing observed process lineage");
	if (
		s.createCalls !== 1 ||
		!s.entered ||
		!s.resolved ||
		!Array.isArray(s.raw) ||
		!s.raw.length ||
		s.raw.length > 64 ||
		!Array.isArray(s.recorded) ||
		s.recorded.length > 64 ||
		!Array.isArray(s.phases) ||
		s.phases.length > 16
	)
		throw new Error("empty observer/bridge witness");
	for (const r of s.raw)
		if (
			typeof r.text !== "string" ||
			r.text.length > 4096 ||
			!Number.isFinite(r.at) ||
			!Number.isFinite(r.commitTime)
		)
			throw new Error("malformed commit");
	for (const text of s.recorded)
		if (typeof text !== "string" || text.length > 4096)
			throw new Error("malformed recorded state");
	if (row.mode === "original") {
		if (
			row.rc !== 0 &&
			!(row.rc === 1 && row.output.includes("the recorder sees commits, saw"))
		)
			throw new Error("unexpected original failure");
		return row.rc === 0
			? "original PASS, N1"
			: "original recorder-count FAIL, N1";
	}
	const releases = s.phases.filter((p) => p.phase === "release");
	const fulfilled = s.phases.filter(
		(p) => p.phase === "bridge-promise-fulfilled",
	);
	const entered = s.phases.filter((p) => p.phase === "create-entered");
	if (
		releases.length !== 1 ||
		fulfilled.length !== 1 ||
		entered.length !== 1 ||
		!(entered[0].at < releases[0].at && releases[0].at <= fulfilled[0].at)
	)
		throw new Error("missing causal phase order");
	const pending = s.raw.find(
		(r) => /Starting a console/.test(r.text) && r.at < releases[0].at,
	);
	const final = s.raw.find(
		(r) => !/Starting a console/.test(r.text) && r.at >= fulfilled[0].at,
	);
	if (!pending || !final || pending.text === final.text)
		throw new Error("missing independent distinct raw states");
	if (row.mode === "held") {
		if (
			row.rc !== 0 ||
			!s.recorded.includes(pending.text) ||
			!s.recorded.includes(final.text)
		)
			throw new Error("held recorder witness");
		return "held positive PASS";
	}
	if (
		row.rc !== 1 ||
		s.recorded.length !== 0 ||
		!row.output.includes(
			"recorder must retain both causally separated committed states",
		)
	)
		throw new Error("wrong suppression oracle");
	return "suppression rejected by exact recorder oracle";
}

function owned(pgid, leaderPid) {
	const rows = [];
	let blind = false;
	for (const name of readdirSync("/proc")) {
		if (!/^[0-9]+$/.test(name)) continue;
		const pid = Number(name);
		if (pid === process.pid || pid === process.ppid) continue;
		try {
			const facts = parseProcStat(readFileSync(`/proc/${pid}/stat`, "utf8"));
			if (facts) rows.push({ pid, ...facts });
		} catch {
			if (existsSync(`/proc/${pid}`)) blind = true;
		}
	}
	const descendants = new Set(selectMembers(rows, leaderPid).map((r) => r.pid));
	const members = rows.filter((r) => r.pgid === pgid || descendants.has(r.pid));
	let totalBytes = 0;
	blind ||= members.length > 256;
	for (const member of members) {
		try {
			const status = readFileSync(`/proc/${member.pid}/status`, "utf8");
			const stat = readFileSync(`/proc/${member.pid}/stat`, "utf8");
			if (!/VmRSS:/.test(status) && !stat.includes(") Z ")) blind = true;
			member.rssBytes = parseProcStatusRss(status);
			totalBytes += member.rssBytes;
		} catch {
			if (existsSync(`/proc/${member.pid}`)) blind = true;
		}
	}
	return { members, totalBytes, blind };
}
async function reap(leaderPid, pgid, signal) {
	const reading = owned(pgid, leaderPid);
	if (reading.blind) return false;
	// Children deliberately inherit the outer timeout PG, which includes us.
	// Reuse killTree's fresh /proc identity checks, but prohibit group sends;
	// every selected member is outside leaderPid's (nonexistent) inner group.
	if (reading.members.length) {
		const outcome = await killTree(leaderPid, reading.members, {
			signal,
			recheckTimeoutMs: 500,
			kill: (pid, sig) => {
				if (pid > 0) process.kill(pid, sig);
			},
		});
		if (outcome.skipped || outcome.errors.length) return false;
	}
	return true;
}
async function one(mode, root, out, head, pgid) {
	const temp = mkdtempSync(join(out, `case-${mode}-`));
	const row = {
		mode,
		membersSeen: [],
		selected: 0,
		reaped: false,
		cleaned: false,
		timedOut: false,
		breached: false,
		blind: false,
		output: "",
		summary: null,
	};
	let child, watchdog, timer;
	let timerKill = Promise.resolve(),
		hardKill = Promise.resolve();
	const caseDeadline = Date.now() + 20000;
	let sampling = Promise.resolve();
	let tripKill = Promise.resolve();
	let closed;
	try {
		const env = {
			PATH: process.env.PATH,
			HOME: temp,
			TMPDIR: temp,
			XDG_CONFIG_HOME: temp,
			XDG_CACHE_HOME: temp,
			CONSOLE_RECORDER_PROBE: mode,
			CONSOLE_RECORDER_HEAD: head,
		};
		child = spawn(
			process.execPath,
			[
				"--max-old-space-size=512",
				"--test",
				"--test-concurrency=1",
				"--test-reporter=tap",
				`--test-name-pattern=^${TITLE}$`,
				"scripts/console-pane-record-6911.diag.mjs",
			],
			{ cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
		);
		// Ownership/finally begins before any PID/proc/guard operation can throw.
		row.pid = child.pid;
		row.pgid = pgid;
		closed = new Promise((resolveClose, reject) => {
			child.once("error", reject);
			child.once("close", (rc, signal) => {
				row.rc = rc;
				row.signal = signal;
				row.reaped = true;
				resolveClose();
			});
		});
		for (const stream of [child.stdout, child.stderr])
			stream.on("data", (chunk) => {
				if (Buffer.byteLength(row.output) + chunk.length > CAP) {
					row.blind = true;
					child.kill("SIGTERM");
				} else row.output += chunk.toString();
			});
		timer = setTimeout(() => {
			row.timedOut = true;
			timerKill = reap(child.pid, pgid, "SIGTERM");
		}, 15000);
		watchdog = createMemoryWatchdog({
			leaderPid: child.pid,
			budgetBytes: RAM,
			intervalMs: 500,
			sample: () => {
				const reading = owned(pgid, child.pid);
				for (const member of reading.members)
					if (
						!row.membersSeen.some(
							(m) => m.pid === member.pid && m.lstart === member.lstart,
						)
					)
						row.membersSeen.push({
							pid: member.pid,
							ppid: member.ppid,
							pgid: member.pgid,
							lstart: member.lstart,
						});
				if (row.membersSeen.length > 256)
					throw new Error("process evidence bound");
				return (sampling = Promise.resolve(reading));
			},
			kill: () => (tripKill = reap(child.pid, pgid, "SIGKILL")),
			onTrip: () => {
				row.breached = true;
			},
			onBreach: () => {},
			onBlind: () => {
				row.blind = true;
				child.kill("SIGTERM");
			},
		});
		watchdog.start();
		const killer = setTimeout(() => {
			row.timedOut = true;
			hardKill = reap(child.pid, pgid, "SIGKILL");
		}, 19000);
		try {
			await closed;
		} finally {
			clearTimeout(killer);
		}
	} finally {
		clearTimeout(timer);
		watchdog?.stop();
		await sampling;
		await tripKill;
		await timerKill;
		await hardKill;
		if (!child?.pid) {
			rmSync(temp, { recursive: true, force: true });
			throw new Error("spawn failed before child ownership");
		}
		const end = Math.min(Date.now() + 5000, caseDeadline);
		await reap(child.pid, pgid, "SIGTERM");
		while (
			Date.now() < end &&
			owned(pgid, child.pid).members.some((r) => existsSync(`/proc/${r.pid}`))
		) {
			await reap(child.pid, pgid, "SIGKILL");
			await new Promise((r) => setTimeout(r, 25));
		}
		const final = owned(pgid, child.pid);
		row.cleaned = !final.blind && final.members.length === 0;
		if (closed) await closed;
		if (row.cleaned) rmSync(temp, { recursive: true, force: true });
		const summaries = row.output
			.split("\n")
			.filter((l) => l.startsWith('# {"diagnostic":"console-recorder-6911"'))
			.map((l) => JSON.parse(l.slice(2)));
		if (summaries.length === 1) row.summary = summaries[0];
		row.selected = row.output
			.split("\n")
			.filter((l) => l === `# Subtest: ${TITLE}`).length;
		row.elapsedMs = 20000 - Math.max(0, caseDeadline - Date.now());
		if (Date.now() > caseDeadline) row.timedOut = true;
		const artifact = {
			...row,
			output: row.output
				.split("\n")
				.filter(
					(line) =>
						line.includes(TITLE) ||
						line.includes("the recorder sees commits, saw") ||
						line.includes(
							"recorder must retain both causally separated committed states",
						),
				)
				.join("\n"),
		};
		const encoded = JSON.stringify(artifact, null, 2);
		if (Buffer.byteLength(encoded) > CAP)
			throw new Error("artifact exceeds 256KiB");
		writeFileSync(join(out, `${mode}.json`), encoded);
		if (!row.cleaned) {
			process.kill(-pgid, "SIGKILL");
			throw new Error("owned group cleanup failed");
		}
	}
	return { ...row, verdict: checkRow(row, head) };
}
export async function main(args) {
	if (
		args.length !== 3 ||
		args[0] !== "probe" ||
		!/^[a-f0-9]{40}$/.test(args[1])
	)
		throw new Error("Expected explicit probe <full-head> <output-dir>");
	const [, head, destination] = args;
	const root = process.cwd(),
		out = resolve(destination);
	if (process.platform !== "linux" || process.version !== "v22.23.3")
		throw new Error("requires reviewed Linux/Node22.23.3");
	const self = parseProcStat(readFileSync(`/proc/${process.pid}/stat`, "utf8"));
	if (!self || self.pgid !== process.ppid)
		throw new Error(
			"must be direct child of GNU timeout's owned process group",
		);
	mkdirSync(out, { recursive: true });
	const manifest = JSON.parse(
		readFileSync(
			join(root, "scripts/console-recorder-6911-manifest.json"),
			"utf8",
		),
	);
	if (
		!manifest.files ||
		Object.keys(manifest.files).length !== 6 ||
		manifest.featureBase !== "abd3bc060f3fca14d1020fec36db5bc7b409a555"
	)
		throw new Error("incomplete source manifest");
	for (const [path, digest] of Object.entries(manifest.files))
		if (sha(join(root, path)) !== digest)
			throw new Error("source manifest mismatch");
	writeFileSync(
		join(out, "identity.json"),
		JSON.stringify(
			{
				head,
				node: process.version,
				pid: process.pid,
				pgid: self.pgid,
				manifest,
				ramBudgetBytes: RAM,
				heapMiB: 512,
				bounds: "3 serial,15s+5s each,outer55s+5s",
				environment: "allowlisted; no credentials",
			},
			null,
			2,
		),
	);
	const rows = [];
	for (const mode of MODES) {
		rows.push(await one(mode, root, out, head, self.pgid));
		console.log(mode, rows.at(-1).verdict);
	}
	writeFileSync(
		join(out, "result.json"),
		JSON.stringify(
			{
				modes: rows.map((r) => r.mode),
				verdicts: rows.map((r) => r.verdict),
				noProductCauseClaim: true,
			},
			null,
			2,
		),
	);
}
if (isEntryPoint(import.meta.url)) {
	try {
		await main(process.argv.slice(2));
	} catch (error) {
		console.error(`Console diagnostic blocked: ${error.message}`);
		process.exitCode = 1;
	}
}
