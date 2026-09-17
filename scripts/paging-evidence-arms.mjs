#!/usr/bin/env node
/**
 * Run ONE arm of the scroll-paging evidence in place, and record the swap.
 *
 *     node scripts/paging-evidence-arms.mjs before <ref> -- <origin> <session> <out-dir>
 *     node scripts/paging-evidence-arms.mjs after        -- <origin> <session> <out-dir>
 *
 * WHY THIS EXISTS. `scripts/scroll-paging-evidence.mjs` takes a mode argument,
 * and that mode names the OUTPUT FILES AND THE REPORT'S ARM LABEL — it cannot
 * swap the code under test. So the first version of the before arm was two
 * hand-run commands and a sentence in the README saying the modules had been
 * "restored byte-identically afterwards (md5 compared)": no md5s, no script, no
 * artefact, and a reader who ran `before` on a feature branch would measure the
 * feature branch and get a report labelled `before` (review round 1, R1-4).
 *
 * What this adds is the RECORD rather than the idea. It refuses to start on a
 * dirty module, writes the ref's bytes, asserts the swap actually happened by a
 * property the arm must have (the module under test has no `LEAD_TIME_MS` before
 * the lead landed), runs the rig, restores from git, and re-reads the md5. The
 * last line is the artefact: `restored=identical`, or a non-zero exit.
 *
 * The module list is deliberately short and explicit. It is the whole of the
 * code under test for this surface: the pure policy and the DOM half beside it.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const MODULES = [
	"src/renderer/src/features/chat/canonical/scroll-paging.ts",
	"src/renderer/src/features/chat/canonical/use-scroll-paging.ts",
];

const [arm, ref, ...rest] = process.argv.slice(2);
if (arm !== "before" && arm !== "after") {
	console.error(
		"usage: paging-evidence-arms.mjs <before <ref>|after> -- <origin> <session> <out-dir>",
	);
	process.exit(2);
}
const dashDash = rest.indexOf("--");
const harnessArgs = (dashDash === -1 ? rest : rest.slice(dashDash + 1)).filter(
	(part) => part.length > 0,
);
if (harnessArgs.length < 3) {
	console.error("the harness needs <origin> <session> <out-dir> after `--`");
	process.exit(2);
}

const git = (args) => execFileSync("git", args, { encoding: "utf8" });
const digest = (path) =>
	createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);
const digests = () =>
	Object.fromEntries(MODULES.map((path) => [path, digest(path)]));

/** Refuse to overwrite an edit nobody asked us to touch. */
const dirty = git(["status", "--porcelain", "--", ...MODULES]).trim();
if (dirty && arm === "before") {
	console.error(
		`refusing to swap: these are already modified in the worktree:\n${dirty}`,
	);
	process.exit(2);
}

const before = digests();
const record = { arm, ref: ref ?? null, md5Before: before };

if (arm === "before") {
	if (!ref) {
		console.error("the before arm needs the revision to take the modules from");
		process.exit(2);
	}
	for (const path of MODULES) {
		execFileSync("git", ["checkout", ref, "--", path]);
	}
	const swapped = digests();
	record.md5AfterSwap = swapped;
	/*
	 * The swap has to be CHECKED, not assumed: an arm that silently failed to
	 * change anything produces the after measurement under the before label, which
	 * is the failure this file exists to make impossible. `LEAD_TIME_MS` is the
	 * symbol the lead added, so its absence is the property the before arm must
	 * have and the after arm must not.
	 */
	for (const path of MODULES) {
		const text = readFileSync(path, "utf8");
		const hasLead = text.includes("LEAD_TIME_MS");
		const wantLead = false;
		if (hasLead !== wantLead) {
			console.error(
				`${path} does not look like the before arm (LEAD_TIME_MS present=${hasLead})`,
			);
			process.exit(2);
		}
	}
	console.log(
		`paging-evidence-arms: arm=${arm} ref=${ref} modules=${MODULES.length} swapped=yes`,
	);
}

const harness = spawnSync(
	process.execPath,
	["scripts/scroll-paging-evidence.mjs", ...harnessArgs, arm],
	{ stdio: "inherit" },
);
record.harnessExit = harness.status ?? 1;

if (arm === "before") {
	// `git checkout <ref> -- <path>` STAGES the ref's bytes, so restoring is a
	// checkout from the index-independent HEAD and then an index reset; both are
	// needed or the swap would ride into the next commit.
	execFileSync("git", ["checkout", "HEAD", "--", ...MODULES]);
	execFileSync("git", ["reset", "-q", "HEAD", "--", ...MODULES]);
	const restored = digests();
	record.md5Restored = restored;
	record.restored = MODULES.every((path) => restored[path] === before[path]);
	console.log(
		`paging-evidence-arms: restored=${record.restored ? "identical" : "DIFFERENT"} ${JSON.stringify(
			Object.fromEntries(
				MODULES.map((path) => [path.split("/").pop(), restored[path]]),
			),
		)}`,
	);
	if (!record.restored) process.exit(1);
}
process.exit(record.harnessExit === 0 ? 0 : 1);
