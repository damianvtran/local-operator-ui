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
	symlinkSync,
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
 * suite: which test file must catch it, defaulting to the sandbox suite. Named
 * per mutation rather than running everything, because a mutant is only
 * evidence about the suite that OWNS the property it breaks - and running the
 * full matrix per mutant costs minutes for assertions that cannot fire.
 * stage: which top-level directories the mutant's suite needs copied.
 */
const SANDBOX_SUITE = "scripts/linux-sandbox.test.mjs";
const SANDBOX_DIRS = ["bin", "scripts"];
const RENDERER_SUITE = "scripts/desktop-renderer-transport.test.mjs";
// The renderer suite bundles the shipped modules with esbuild from `src/`, so
// the mutant only takes effect if `src` is staged with it - a battery that
// copied only `scripts` would compile the UNMUTATED file and report every
// mutant killed or survived for the wrong reason.
const RENDERER_DIRS = ["bin", "scripts", "src"];
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
	// --- added in remediation round 2: the image ladder's own invariants ---
	//
	// Round 2 found two of round 1's nine new regression tests VACUOUS: they
	// passed against the pre-fix file because their fixtures never reached the
	// code under test, and two mutants - flatten-everything and last-rung -
	// survived a 16-test green suite silently. These four are that battery,
	// checked in for the same reason the sandbox ones are: the transcript of a
	// battery in a PR comment is not re-runnable, and the fixture is where this
	// change has twice been weakest.
	{
		id: "B1",
		note: "JPEG rung stops flattening onto white (transparent corners go black)",
		file: "src/renderer/src/features/chat/utils/bound-image.ts",
		from: '\t\tflatContext.fillStyle = "#ffffff";\n\t\tflatContext.fillRect(0, 0, width, height);',
		to: "",
		suite: RENDERER_SUITE,
		stage: RENDERER_DIRS,
	},
	{
		id: "B2",
		// The specific NEW defect round 1 warned the fix against introducing: a
		// flatten applied to the shared canvas destroys PNG alpha on every rung.
		// It survived round 1's suite because the PNG-alpha test's fixture took the
		// verbatim passthrough and never encoded anything.
		note: "SHARED canvas is flattened, so PNG alpha is destroyed on every rung",
		file: "src/renderer/src/features/chat/utils/bound-image.ts",
		from: "	context.drawImage(bitmap, 0, 0, width, height);",
		to: '\tcontext.fillStyle = "#ffffff";\n\tcontext.fillRect(0, 0, width, height);\n\tcontext.drawImage(bitmap, 0, 0, width, height);',
		suite: RENDERER_SUITE,
		stage: RENDERER_DIRS,
	},
	{
		id: "B3",
		note: "never-grow guard disabled while downscaling (F2: payload inflates)",
		file: "src/renderer/src/features/chat/utils/bound-image.ts",
		from: "	if (bestBytes >= originalBytes) return original;",
		to: "	if (bestBytes >= originalBytes && scale === 1) return original;",
		suite: RENDERER_SUITE,
		stage: RENDERER_DIRS,
	},
	{
		id: "B4",
		// F3's regression: `best` becomes the LAST rung tried rather than the
		// smallest set seen, so an exhausted ladder can return something bigger
		// than its own input. Survived round 1's suite because the test that names
		// this logic set a budget ABOVE the originals and returned before the loop.
		note: "ladder keeps the LAST rung instead of the smallest set (F3)",
		file: "src/renderer/src/features/chat/utils/bound-image.ts",
		from: "		if (consider(stepped) <= budget) return stepped;",
		to: "\t\tconst steppedBytes = consider(stepped);\n\t\tbest = stepped;\n\t\tif (steppedBytes <= budget) return stepped;",
		suite: RENDERER_SUITE,
		stage: RENDERER_DIRS,
	},
	{
		id: "B5",
		// The command char cap (round 2, Q-7). The byte check alone admitted a
		// 400,000-character paste, which then died in the schema parse as "Invalid
		// desktop operation." with the user's draft already discarded.
		note: "command pre-flight drops the character cap (Q-7 re-opens)",
		file: "src/renderer/src/features/chat/utils/message-budget.ts",
		from: "	if (args.length > DESKTOP_MESSAGE_MAX_CHARS) {",
		to: "	if (false) {",
		suite: RENDERER_SUITE,
		stage: RENDERER_DIRS,
	},
	{
		id: "B6",
		note: "GIF loses its exemption, so animations are flattened to one frame",
		file: "src/renderer/src/features/chat/utils/bound-image.ts",
		from: '\t"image/webp",\n]);',
		to: '\t"image/webp",\n\t"image/gif",\n]);',
		suite: RENDERER_SUITE,
		stage: RENDERER_DIRS,
	},
	{
		id: "B7",
		// The system-prompt char cap (round 3, R1). This branch shipped in round 2
		// under a docstring asserting it "could never fire", and a reviewer's
		// `if (false)` mutant passed 23/23 - the branch had no coverage at all,
		// while in fact being the one that binds on ordinary ASCII prose. Kept as
		// a permanent mutant so the claim cannot rot back into a comment.
		note: "system-prompt pre-flight drops the character cap (N4 re-opens)",
		file: "src/renderer/src/features/chat/utils/message-budget.ts",
		from: "	if (systemPrompt.length > DESKTOP_SYSTEM_PROMPT_MAX_CHARS) {",
		to: "	if (false) {",
		suite: RENDERER_SUITE,
		stage: RENDERER_DIRS,
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
const runSuite = (scratch, suite = SANDBOX_SUITE) =>
	// TAP explicitly: node's DEFAULT reporter is `spec`, whose output carries no
	// `not ok <n> - <name>` lines, so naming which test caught a mutant silently
	// found nothing and every kill was reported as unattributed (round 2).
	spawnSync(
		process.execPath,
		["--test", "--test-reporter=tap", join(scratch, suite)],
		{
			encoding: "utf8",
			cwd: scratch,
			// A mutant can HANG rather than fail -- M21 restores a blocking open(2)
			// on a FIFO, which wedges the interpreter synchronously where the test
			// runner's own timer can never fire. Without a bound here the battery
			// waits forever and reports nothing, so the mutation that matters most
			// is the one that silences it. SIGKILL because a wedged process inside
			// a blocking syscall need not honour SIGTERM.
			// The renderer suite bundles and drives real codecs, so it needs longer
			// than the sandbox one; 60 s would report every renderer mutant as a hang.
			timeout: suite === SANDBOX_SUITE ? 60_000 : 300_000,
			killSignal: "SIGKILL",
		},
	);

const stage = (dirs = SANDBOX_DIRS) => {
	const scratch = mkdtempSync(join(tmpdir(), "lo-mutation-"));
	for (const dir of dirs) {
		cpSync(join(repoRoot, dir), join(scratch, dir), { recursive: true });
	}
	// The renderer suite resolves `sharp` and `esbuild`, and a scratch tree has no
	// install of its own. Symlinked rather than copied: this branch changes no
	// dependency, so the shared install resolves the same set, and copying a
	// node_modules per mutant would cost gigabytes per run.
	if (dirs.includes("src")) {
		symlinkSync(
			join(repoRoot, "node_modules"),
			join(scratch, "node_modules"),
			"dir",
		);
		cpSync(join(repoRoot, "package.json"), join(scratch, "package.json"));
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
//
// Gated PER SUITE, because the battery now spans two of them: a green sandbox
// baseline says nothing about whether the renderer suite passes unmutated, and
// only the suite that owns a mutant can vacuously "kill" it.
for (const suite of new Set(selected.map((m) => m.suite ?? SANDBOX_SUITE))) {
	const dirs = suite === SANDBOX_SUITE ? SANDBOX_DIRS : RENDERER_DIRS;
	const baselineScratch = stage(dirs);
	try {
		const baseline = runSuite(baselineScratch, suite);
		if (baseline.status !== 0) {
			const euid =
				typeof process.geteuid === "function" ? process.geteuid() : "n/a";
			console.error(
				`REFUSING TO RUN: the UNMUTATED suite ${suite} does not pass, so every mutant would be reported killed vacuously. Fix the suite first.
  baseline status=${baseline.status} signal=${baseline.signal} euid=${euid}
--- baseline output ---
${baseline.stdout ?? ""}${baseline.stderr ?? ""}`,
			);
			process.exit(2);
		}
	} finally {
		rmSync(baselineScratch, { recursive: true, force: true });
	}
}

/**
 * A one-line summary of what actually changed on disk, for the run log.
 *
 * The point is not a readable diff - it is that the NUMBERS come from re-reading
 * the mutated file, so a mutation that quietly failed to apply cannot be
 * reported as an applied one.
 */
function diffLines(before, after) {
	const from = before.split("\n");
	const to = after.split("\n");
	let head = 0;
	while (head < from.length && head < to.length && from[head] === to[head])
		head += 1;
	let tail = 0;
	while (
		tail < from.length - head &&
		tail < to.length - head &&
		from[from.length - 1 - tail] === to[to.length - 1 - tail]
	)
		tail += 1;
	const removed = from.length - head - tail;
	const added = to.length - head - tail;
	return `line ${head + 1}: -${removed} +${added}`;
}

const survivors = [];
const broken = [];

for (const mutation of selected) {
	const suite = mutation.suite ?? SANDBOX_SUITE;
	const scratch = stage(mutation.stage ?? SANDBOX_DIRS);
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

		// PROVE THE MUTATION LANDED, in the file the suite will actually read.
		// `applyOnce` returning a string only says the substitution matched in
		// memory; this re-reads from disk and reports the changed lines. A mutation
		// that silently no-ops is indistinguishable from a test correctly passing,
		// which is the same "cannot fail" defect this battery exists to detect -
		// one level up (round 2).
		const onDisk = readFileSync(target, "utf8");
		if (onDisk === original) {
			broken.push({ ...mutation, why: "no-op on disk" });
			console.log(`?? ${mutation.id}  MUTATION DID NOT LAND ON DISK`);
			continue;
		}
		const changedLines = diffLines(original, onDisk);
		// A mutant that does not PARSE fails every test for the wrong reason and
		// reads as a kill while having asserted nothing. Only TypeScript sources go
		// through esbuild here; `node --check` handles the plain-JS ones.
		const parse = mutation.file.endsWith(".ts")
			? spawnSync(
					join(repoRoot, "node_modules", ".bin", "esbuild"),
					// Compiled to nowhere: the exit code is the whole point, and the
					// extension already selects the TS loader (an explicit `--loader`
					// is rejected for file input and would fail EVERY mutant).
					[target, "--outfile=/dev/null"],
					{ encoding: "utf8", stdio: ["ignore", "ignore", "pipe"] },
				)
			: spawnSync(process.execPath, ["--check", target], {
					encoding: "utf8",
					stdio: ["ignore", "ignore", "pipe"],
				});
		if (parse.status !== 0) {
			broken.push({ ...mutation, why: "mutant does not parse" });
			console.log(
				`?? ${mutation.id}  MUTANT DOES NOT PARSE - a kill here would be spurious\n${parse.stderr}`,
			);
			continue;
		}
		console.log(`-- ${mutation.id}  applied (${changedLines}), parses ok`);

		const run = runSuite(scratch, suite);
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
		// WHICH test caught it, not merely that the suite went red. A mutant killed
		// by an unrelated test - or by an import error the parse check above did not
		// cover - is not evidence that the property it breaks is guarded, and
		// "suite went red" cannot tell those apart.
		if (!passed) {
			const failed = [
				...(run.stdout ?? "").matchAll(/^not ok \d+ - (.+)$/gm),
			].map((match) => match[1].trim());
			console.log(
				failed.length
					? failed.map((name) => `     caught by: ${name}`).join("\n")
					: "     (no named test failure - the suite failed to RUN, so this kill proves nothing)",
			);
		}
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
