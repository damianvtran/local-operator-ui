#!/usr/bin/env node
/**
 * Mutation battery for the Linux sandbox repair path.
 *
 * WHY THIS EXISTS: the reviewer's round-1 battery found four surviving mutants
 * in a suite that reported 14/14 green, including the chmod-before-chown
 * inversion -- the one whose whole failure mode is that it looks like success.
 * A test suite that cannot fail for its own subject is documentation, so the
 * battery is checked in and re-runnable rather than being a transcript in a PR
 * comment.
 *
 * HOW IT WORKS: each mutation is a literal source substitution applied to a
 * scratch COPY of the tree (never the working tree), after which the suite runs
 * against the mutant. A mutant that still passes SURVIVED, meaning nothing
 * asserts the property it broke.
 *
 *   node scripts/mutation-battery.mjs           # all mutations
 *   node scripts/mutation-battery.mjs M9 M10    # a subset, by id
 */

import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * file: which shipped file to mutate.
 * from/to: a literal substitution that must match exactly once, so a mutation
 * silently becoming a no-op after a refactor is reported rather than counted as
 * a kill.
 */
const MUTATIONS = [
	{
		id: "M1",
		note: "health rule ignores the setuid bit",
		file: "bin/linux-sandbox.js",
		from: "uid === 0 && (mode & SETUID_BIT) !== 0",
		to: "uid === 0",
	},
	{
		id: "M2",
		note: "health rule ignores ownership",
		file: "bin/linux-sandbox.js",
		from: "uid === 0 && (mode & SETUID_BIT) !== 0",
		to: "(mode & SETUID_BIT) !== 0",
	},
	{
		id: "M3",
		note: "required mode drops the setuid bit (0755)",
		file: "bin/linux-sandbox.js",
		from: "const REQUIRED_MODE = 0o4755;",
		to: "const REQUIRED_MODE = 0o755;",
	},
	{
		id: "M4",
		note: "setuid bit constant wrong",
		file: "bin/linux-sandbox.js",
		from: "const SETUID_BIT = 0o4000;",
		to: "const SETUID_BIT = 0o2000;",
	},
	{
		id: "M5",
		note: "helper resolved to the wrong filename",
		file: "bin/linux-sandbox.js",
		from: '"chrome-sandbox");\n};',
		to: '"chrome_sandbox");\n};',
	},
	{
		id: "M6",
		note: "missing helper reported as needing repair",
		file: "bin/linux-sandbox.js",
		from: "\t\treturn { exists: false, needsRepair: false };\n\t}\n\ttry {\n\t\tconst stats = fs.fstatSync(fd);",
		to: "\t\treturn { exists: true, needsRepair: true };\n\t}\n\ttry {\n\t\tconst stats = fs.fstatSync(fd);",
	},
	{
		id: "M7",
		note: "needsRepair inverted",
		file: "bin/linux-sandbox.js",
		from: "\t\t\tneedsRepair: !isSetuidRoot,",
		to: "\t\t\tneedsRepair: isSetuidRoot,",
	},
	{
		id: "M8",
		note: "repair throws instead of reporting not-permitted",
		file: "bin/linux-sandbox.js",
		from: '\t\t\treturn { outcome: "not-permitted", path: helperPath, error: err };',
		to: "\t\t\tthrow err;",
	},
	{
		id: "M9",
		note: "SECURITY: chmod before chown (silently yields 0755)",
		file: "bin/linux-sandbox.js",
		from: "\t\t\tfs.fchownSync(fd, 0, 0);\n\t\t\tfs.fchmodSync(fd, REQUIRED_MODE);",
		to: "\t\t\tfs.fchmodSync(fd, REQUIRED_MODE);\n\t\t\tfs.fchownSync(fd, 0, 0);",
	},
	{
		id: "M10",
		note: "post-repair verification trusts the syscalls",
		file: "bin/linux-sandbox.js",
		from: "\t\tconst after = fs.fstatSync(fd);\n\t\treturn isHelperHealthy(after.uid, after.mode & 0o7777)",
		to: "\t\tconst after = { uid: 0, mode: 0o104755 };\n\t\treturn isHelperHealthy(after.uid, after.mode & 0o7777)",
	},
	{
		id: "M11",
		note: "root guidance wrongly recommends chmod 4755",
		file: "bin/linux-sandbox.js",
		from: '\t"Run the app as your normal desktop user instead. If you installed it with",',
		to: '\t"Try sudo chmod 4755 on the helper instead. If you installed it with",',
	},
	{
		id: "M12",
		note: "signal death reported as success (exit 0)",
		file: "bin/linux-sandbox.js",
		from: '\t\treturn typeof number === "number" ? 128 + number : 1;',
		to: "\t\treturn 0;",
	},
	{
		id: "M13",
		note: "ensureElectronDist claims success with no installer",
		file: "bin/linux-sandbox.js",
		from: "\tif (!fs.existsSync(installer)) {\n\t\treturn false;\n\t}",
		to: "\tif (!fs.existsSync(installer)) {\n\t\treturn true;\n\t}",
	},
	{
		id: "M14",
		note: "postinstall platform guard removed",
		file: "bin/postinstall.js",
		from: 'if (\n\tprocess.platform !== "linux" &&\n\tprocess.env.LOCAL_OPERATOR_UI_FORCE_POSTINSTALL !== "1"\n) {\n\tprocess.exit(0);\n}',
		to: "if (false) {\n\tprocess.exit(0);\n}",
	},
	{
		id: "M15",
		note: "postinstall exits non-zero on a failed repair (fails the install)",
		file: "bin/postinstall.js",
		from: "process.exit(0);\n",
		to: "process.exit(1);\n",
		last: true, // the trailing exit, not the platform guard
	},
	// --- added in remediation round 1: the security properties themselves ---
	{
		id: "M16",
		note: "SECURITY: O_NOFOLLOW dropped (symlink followed again)",
		file: "bin/linux-sandbox.js",
		from: "\tfs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;",
		to: "\tfs.constants.O_RDONLY | fs.constants.O_NONBLOCK;",
	},
	{
		id: "M17",
		note: "SECURITY: repair mutates by path again (TOCTOU + symlink)",
		file: "bin/linux-sandbox.js",
		from: "\t\t\tfs.fchownSync(fd, 0, 0);\n\t\t\tfs.fchmodSync(fd, REQUIRED_MODE);",
		to: "\t\t\tfs.chownSync(helperPath, 0, 0);\n\t\t\tfs.chmodSync(helperPath, REQUIRED_MODE);",
	},
	{
		id: "M18",
		note: "SECURITY: non-regular file accepted for repair",
		file: "bin/linux-sandbox.js",
		from: '\t\tif (!before.isFile()) {\n\t\t\treturn { outcome: "unsafe", path: helperPath };\n\t\t}',
		to: "",
	},
	{
		id: "M21",
		// The defect this reproduces shipped THROUGH this battery: M18 removed the
		// isFile() guard and was killed by a test whose non-regular file was a
		// DIRECTORY -- which opens instantly. A FIFO does not, so the blocking-open
		// hole was invisible to both. Mutating the flags is what proves the FIFO
		// case asserts something the directory case cannot.
		note: "O_NONBLOCK dropped (a FIFO helper hangs the install forever)",
		file: "bin/linux-sandbox.js",
		from: "\tfs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;",
		to: "\tfs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;",
	},
	{
		id: "M19",
		note: "post-mortem fires on any non-zero exit (Ctrl+C / exit(42) misdiagnosis)",
		file: "bin/linux-sandbox.js",
		from: "\tif (!signal || !ABORT_SIGNALS.has(signal)) {\n\t\treturn false;\n\t}",
		to: "\tif (code === 0) {\n\t\treturn false;\n\t}",
	},
	{
		id: "M20",
		note: "startup window ignored (an hour-old crash blamed on the sandbox)",
		file: "bin/linux-sandbox.js",
		from: '\treturn typeof elapsedMs !== "number" || elapsedMs < STARTUP_WINDOW_MS;',
		to: "\treturn true;",
	},
	{
		id: "M22",
		// The allowlist must be a real discriminator, not a formality: widening it
		// to any signal readmits SIGSEGV and (via the launcher forwarding it) SIGINT.
		note: "abort allowlist widened to any signal (crash/Ctrl+C readmitted)",
		file: "bin/linux-sandbox.js",
		from: "\tif (!signal || !ABORT_SIGNALS.has(signal)) {",
		to: "\tif (!signal) {",
	},
];

const applyOnce = (source, from, to, last) => {
	const idx = last ? source.lastIndexOf(from) : source.indexOf(from);
	if (idx === -1) {
		return null;
	}
	if (!last && source.indexOf(from, idx + 1) !== -1) {
		return { ambiguous: true };
	}
	return source.slice(0, idx) + to + source.slice(idx + from.length);
};

/**
 * The identical spawn used for the baseline and for every mutant, so "the
 * baseline is green" is a statement about the same command that later reports
 * kills -- a guard that ran the suite a different way could pass while the
 * battery's own runs all failed for an unrelated reason.
 */
const runSuite = (scratch) =>
	spawnSync(
		process.execPath,
		["--test", join(scratch, "scripts", "linux-sandbox.test.mjs")],
		{
			encoding: "utf8",
			cwd: scratch,
			// A mutant can HANG rather than fail -- M21 restores a blocking open(2)
			// on a FIFO, which wedges the interpreter synchronously where the test
			// runner's own timer can never fire. Without a bound here the battery
			// waits forever and reports nothing, so the mutation that matters most
			// is the one that silences it. SIGKILL because a wedged process inside
			// a blocking syscall need not honour SIGTERM.
			timeout: 60_000,
			killSignal: "SIGKILL",
		},
	);

const stage = () => {
	const scratch = mkdtempSync(join(tmpdir(), "lo-mutation-"));
	for (const dir of ["bin", "scripts"]) {
		cpSync(join(repoRoot, dir), join(scratch, dir), { recursive: true });
	}
	return scratch;
};

const requested = process.argv.slice(2);
const selected = requested.length
	? MUTATIONS.filter((m) => requested.includes(m.id))
	: MUTATIONS;

// BASELINE GATE. A mutant counts as "killed" when the suite FAILS against it, so
// if the suite already fails UNMUTATED then every mutant is killed vacuously and
// the battery reports a perfect score while asserting nothing. Not hypothetical:
// as root the suite was red and the battery reported 22/22 killed and exited 0,
// including M8 -- the disclosed EQUIVALENT mutant that must always survive.
// Refuse to report at all rather than report success, because this battery is
// the change's central evidence and a silently vacuous one is worse than none.
// Exit 2, distinct from the 1 used for real survivors: "did not measure" is a
// different answer from "measured, and something survived".
const baselineScratch = stage();
try {
	const baseline = runSuite(baselineScratch);
	if (baseline.status !== 0) {
		const euid =
			typeof process.geteuid === "function" ? process.geteuid() : "n/a";
		console.error(
			`REFUSING TO RUN: the UNMUTATED suite does not pass, so every mutant would be reported killed vacuously. Fix the suite first.
  baseline status=${baseline.status} signal=${baseline.signal} euid=${euid}
--- baseline output ---
${baseline.stdout ?? ""}${baseline.stderr ?? ""}`,
		);
		process.exit(2);
	}
} finally {
	rmSync(baselineScratch, { recursive: true, force: true });
}

const survivors = [];
const broken = [];

for (const mutation of selected) {
	const scratch = stage();
	try {
		const target = join(scratch, mutation.file);
		const original = readFileSync(target, "utf8");
		const mutated = applyOnce(
			original,
			mutation.from,
			mutation.to,
			mutation.last,
		);
		if (mutated === null || mutated.ambiguous) {
			broken.push({
				...mutation,
				why: mutated === null ? "no match" : "ambiguous",
			});
			console.log(
				`?? ${mutation.id}  MUTATION DID NOT APPLY (${mutation.note})`,
			);
			continue;
		}
		writeFileSync(target, mutated);

		const run = runSuite(scratch);
		// A timeout kill is a KILL, not a survival: the suite did not pass, it never
		// finished. status is null in that case, and `null === 0` is false, so this
		// counts it as a kill; the tempting `run.status !== 0` would be true for the
		// same null and would also count it -- correct here by accident, but wrong
		// the moment the sense is flipped. Test the pass explicitly.
		const passed = run.status === 0;
		// Distinguish OUR timeout from someone else's kill. Both are correctly
		// counted as kills, but on a shared box the OOM killer is live, and
		// reporting an external SIGKILL as "suite hung" sends the reader after a
		// hang that never happened. Node sets error.code to ETIMEDOUT only for the
		// timeout above; an external kill carries no code.
		if (run.signal) {
			console.log(
				run.error?.code === "ETIMEDOUT"
					? `   (${mutation.id} killed by ${run.signal} -- suite hung past the timeout; counted as killed)`
					: `   (${mutation.id} killed by ${run.signal} from OUTSIDE the battery (not our timeout -- OOM killer?); counted as killed)`,
			);
		}
		if (passed) {
			survivors.push(mutation);
		}
		console.log(
			`${passed ? "!! SURVIVED" : "ok KILLED  "} ${mutation.id}  ${mutation.note}`,
		);
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

console.log(
	`\n${selected.length - survivors.length - broken.length}/${selected.length - broken.length} killed` +
		(broken.length ? `, ${broken.length} did not apply` : ""),
);
if (survivors.length) {
	console.log("SURVIVORS:");
	for (const s of survivors) {
		console.log(`  ${s.id}  ${s.note}`);
	}
}

// CANARY. M8 is a disclosed EQUIVALENT mutant -- the outer catch reconstructs the
// identical result object, so no test can distinguish it and it MUST survive. It
// is therefore the one mutant whose expected outcome is known independently of
// the suite, which makes it a free end-to-end check that the battery still
// discriminates at all: if the canary dies, the run measured nothing, whatever
// the score says. The baseline gate above catches the known cause of that (a red
// suite); this catches the ones nobody has thought of yet. Only meaningful when
// M8 was actually selected, so a subset run stays usable.
if (
	selected.some((m) => m.id === "M8") &&
	!survivors.some((s) => s.id === "M8")
) {
	console.error(
		`
REFUSING TO REPORT: M8 is a known equivalent mutant and MUST survive, but it was counted as killed.
The battery is not discriminating, so the score above is meaningless. Investigate before trusting any result.`,
	);
	process.exit(2);
}

process.exit(survivors.length || broken.length ? 1 : 0);
