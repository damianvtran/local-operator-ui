#!/usr/bin/env node
/**
 * Run ONE arm of the child-reader scroll evidence, and record the swap.
 *
 *     node scripts/child-reader-scroll-evidence-arms.mjs before <ref> -- <rig args>
 *     node scripts/child-reader-scroll-evidence-arms.mjs after        -- <rig args>
 *
 * WHY THIS EXISTS. `scripts/child-reader-scroll-evidence.mjs` takes an `--arm`
 * argument, and that argument names the OUTPUT DIRECTORY and the report's label;
 * it cannot swap the code under test. So the first version of the before arm was
 * two hand-run commands in the README — `git stash push -- <module>` and then the
 * rig with `--arm=before` — and on the branch, where that change is COMMITTED,
 * the stash prints "No local changes to save", exits 0, and the rig then labels
 * AFTER bytes as `before` (review round 1, R1-1; the reviewer followed the
 * shipped recipe and got exactly that, with the control `on` in a report whose
 * whole point is that the control is absent).
 *
 * This is the same lesson `scripts/paging-evidence-arms.mjs` already carries, and
 * the same shape: swap the module, ASSERT the swap by the module's digest, hand
 * that digest to the rig so it refuses to mislabel the run, then restore from git
 * and re-read the digest. The last lines are the artefact — `restored=identical`
 * or a non-zero exit.
 *
 * The module list is one file, because one file is what this change is: the
 * reader. The rig prints the other three it measures, and they must not differ
 * between arms.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MODULE =
	"src/renderer/src/features/chat/components/run-details/run-child-reader.tsx";

const [arm, ref, ...rest] = process.argv.slice(2);
/*
 * `after` is the working tree's own bytes and needs no revision. ANY OTHER NAME is
 * an arm taken from a revision — `before` (this branch's base) and `prev` (a
 * head whose bytes a round is comparing against, e.g. the round that added the
 * chip band without the clip that keeps the focus ring out of it, design round 2
 * D6) are the same operation with a different label, and the rig's `--arm` is
 * already just a label plus an output directory.
 */
if (!arm || (arm === "after" && ref?.startsWith("--"))) {
	console.error(
		"usage: child-reader-scroll-evidence-arms.mjs <after | <arm-name> <ref>> -- <rig args>",
	);
	process.exit(2);
}
const swappedArm = arm !== "after";
if (swappedArm && (!ref || ref.startsWith("--"))) {
	console.error(
		`the ${arm} arm needs the revision to take the module from: \`... ${arm} <ref> -- <rig args>\``,
	);
	process.exit(2);
}
const dashDash = rest.indexOf("--");
const rigArgs = (dashDash === -1 ? rest : rest.slice(dashDash + 1)).filter(
	(part) => part.length > 0,
);

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
	encoding: "utf8",
}).trim();
const git = (args) =>
	execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
const digest = () =>
	createHash("md5")
		.update(readFileSync(join(ROOT, MODULE)))
		.digest("hex");

/** Refuse to overwrite an edit nobody asked this script to touch. */
const dirty = git(["status", "--porcelain", "--", MODULE]).trim();
if (dirty && swappedArm) {
	console.error(
		`refusing to swap: ${MODULE} is already modified in the worktree:\n${dirty}`,
	);
	process.exit(2);
}

const before = digest();
console.log(`arm=${arm} ref=${ref ?? "HEAD"} md5Before=${before}`);

if (swappedArm) {
	/*
	 * The revision the arm is taken from has to carry the module, or the swap
	 * silently reads the CURRENT file back (a bad ref, a shallow clone) and the
	 * digest assertion below is the only thing left holding the line.
	 */
	execFileSync("git", ["cat-file", "-e", `${ref}:${MODULE}`], { cwd: ROOT });
	git(["checkout", ref, "--", MODULE]);
}

const swapped = digest();
if (swappedArm && swapped === before) {
	console.error(
		`the swap did not change ${MODULE} (md5 ${swapped} before and after): ${ref} must not already be the working tree's content`,
	);
	process.exit(2);
}
console.log(`md5Swap=${swapped}`);

const result = spawnSync(
	"node",
	[
		"scripts/child-reader-scroll-evidence.mjs",
		`--arm=${arm}`,
		`--expect-digest=${swapped}`,
		...rigArgs,
	],
	{ cwd: ROOT, stdio: "inherit" },
);

/*
 * Restore unconditionally: a failed rig run must not leave the worktree holding
 * the other arm's module, which would make the NEXT run measure it too.
 */
if (swappedArm) git(["checkout", "HEAD", "--", MODULE]);
const restored = digest();
const identical = restored === before;
console.log(
	`restored=${identical ? "identical" : `DIFFERENT (${before} -> ${restored})`}`,
);
if (!identical || result.status !== 0) process.exit(1);
