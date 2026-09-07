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
		from: "const OPEN_NOFOLLOW = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;",
		to: "const OPEN_NOFOLLOW = fs.constants.O_RDONLY;",
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
		id: "M19",
		note: "post-mortem fires on any non-zero exit (Ctrl+C misdiagnosis)",
		file: "bin/linux-sandbox.js",
		from: "\tif (signal && USER_INITIATED_SIGNALS.has(signal)) {\n\t\treturn false;\n\t}",
		to: "",
	},
	{
		id: "M20",
		note: "startup window ignored (an hour-old crash blamed on the sandbox)",
		file: "bin/linux-sandbox.js",
		from: '\tif (typeof elapsedMs === "number" && elapsedMs >= STARTUP_WINDOW_MS) {\n\t\treturn false;\n\t}',
		to: "",
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

const requested = process.argv.slice(2);
const selected = requested.length
	? MUTATIONS.filter((m) => requested.includes(m.id))
	: MUTATIONS;

const survivors = [];
const broken = [];

for (const mutation of selected) {
	const scratch = mkdtempSync(join(tmpdir(), "lo-mutation-"));
	try {
		for (const dir of ["bin", "scripts"]) {
			cpSync(join(repoRoot, dir), join(scratch, dir), { recursive: true });
		}
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

		const run = spawnSync(
			process.execPath,
			["--test", join(scratch, "scripts", "linux-sandbox.test.mjs")],
			{ encoding: "utf8", cwd: scratch },
		);
		const passed = run.status === 0;
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
process.exit(survivors.length || broken.length ? 1 : 0);
