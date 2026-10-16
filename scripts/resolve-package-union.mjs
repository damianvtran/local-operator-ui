#!/usr/bin/env node
/**
 * Resolve a `package.json` rebase/merge conflict by UNIONING
 * `scripts['test:desktop']`, from the git merge stages, and failing closed on
 * anything else.
 *
 * WHY THIS EXISTS. Two i18n branches that each register a test file in
 * `scripts['test:desktop']` conflict in `package.json` on every rebase - the
 * same union-file class as `i18n/ledger.json` and `src/i18n/keys.gen.ts`. It
 * was resolved by hand (and by a throwaway script) several times, and on
 * 2026-10-16 a hand resolution went WRONG in a way that is worth a committed
 * tool rather than another improvisation: the resolver assumed the conflicting
 * hunk was a single line, threw on a multi-key line, and the rebase then
 * COMMITTED THE CONFLICT MARKERS into `package.json` on the branch's own
 * commits. Every behaviour gate stayed green - the marker lines are valid
 * inside the JSON only until something parses the file - and the corruption was
 * caught only because a human ran `require('./package.json')`.
 *
 * WHAT IT DOES, and why from the STAGES rather than the working tree. During a
 * conflicted merge git keeps three versions of the file:
 *   `:1:package.json` the merge base, `:2:` ours (the branch being merged into,
 *   i.e. main during a rebase), `:3:` theirs (the commit being applied). Only
 *   `scripts['test:desktop']` legitimately conflicts here - both sides appended
 *   test-file paths - so the resolution is a UNION: keep OURS' list in its
 *   order and append any of THEIRS' entries it lacks. Reading the stages means
 *   the resolution cannot be polluted by a marker line already sitting in the
 *   working tree (which is exactly how the 2026-10-16 corruption recurred).
 *
 * IT FAILS CLOSED: if any other path in the file differs between base/ours/
 * theirs, or if a stage is missing, it refuses (exit 2, nothing written) rather
 * than guessing - a `package.json` conflict that is not the test:desktop union
 * is not this tool's to resolve.
 *
 * PROOF IT WRITES GOOD JSON, every run: it parses the result before writing and
 * refuses on a parse error. That parse is the check the 2026-10-16 corruption
 * needed and did not have.
 *
 * USAGE, mid-conflict, from the conflicted worktree:
 *   node scripts/resolve-package-union.mjs            # resolve package.json
 *   node scripts/resolve-package-union.mjs --check    # report without writing
 * After it succeeds, `git add package.json` and continue the rebase/merge.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const CHECK = process.argv.includes("--check");
const PATH = "package.json";

function stage(n) {
	try {
		return execFileSync("git", ["show", `:${n}:${PATH}`], {
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		});
	} catch {
		return null;
	}
}

function refuse(message) {
	process.stderr.write(`resolve-package-union: refused - ${message}\n`);
	process.exit(2);
}

const base = stage(1);
const oursRaw = stage(2);
const theirsRaw = stage(3);

if (oursRaw === null || theirsRaw === null) {
	refuse(
		`${PATH} is not in a conflicted merge state (stage 2 and/or stage 3 missing)`,
	);
}

let ours;
let theirs;
let baseObj = null;
try {
	ours = JSON.parse(oursRaw);
	theirs = JSON.parse(theirsRaw);
	if (base !== null) baseObj = JSON.parse(base);
} catch (error) {
	refuse(`a stage is not valid JSON (${error.message})`);
}

/*
 * Refuse a conflict that moves anything other than scripts['test:desktop'].
 * Compare each top-level key's serialisation across the three sides; the union
 * shape is only safe for the one key both branches append to.
 */
const keys = new Set([
	...Object.keys(baseObj ?? {}),
	...Object.keys(ours),
	...Object.keys(theirs),
]);
const differing = [];
for (const key of keys) {
	if (key === "scripts") continue;
	const same = (a, b) =>
		JSON.stringify(a?.[key] ?? null) === JSON.stringify(b?.[key] ?? null);
	/*
	 * Flag if ANY pair differs, not only when ALL THREE do. The original
	 * `!same(base,ours) && !same(base,theirs) && !same(ours,theirs)` binds the
	 * `!` to each call, so a change made by ONE side alone (base advances to
	 * that side, so one pair is equal) slipped through - and the result then
	 * reverted it, the exact silent package.json corruption this tool exists to
	 * prevent. A key is safe only when all three sides agree.
	 */
	if (!(same(baseObj, ours) && same(baseObj, theirs) && same(ours, theirs))) {
		differing.push(key);
	}
}
if (differing.length) {
	refuse(
		`conflicting top-level key(s) beyond scripts: ${differing.join(", ")} - not a test:desktop union`,
	);
}

const scripts = new Set([
	...Object.keys(baseObj?.scripts ?? {}),
	...Object.keys(ours.scripts ?? {}),
	...Object.keys(theirs.scripts ?? {}),
]);
const differingScripts = [];
for (const key of scripts) {
	if (key === "test:desktop") continue;
	const same = (a, b) =>
		JSON.stringify(a?.scripts?.[key] ?? null) ===
		JSON.stringify(b?.scripts?.[key] ?? null);
	/* The same any-pair-differs rule as the top-level loop above. */
	if (!(same(baseObj, ours) && same(baseObj, theirs) && same(ours, theirs))) {
		differingScripts.push(key);
	}
}
if (differingScripts.length) {
	refuse(
		`conflicting script(s) beyond test:desktop: ${differingScripts.join(", ")} - not a test:desktop union`,
	);
}

const ourList = (ours.scripts?.["test:desktop"] ?? "")
	.split(/\s+/)
	.filter(Boolean);
const theirList = (theirs.scripts?.["test:desktop"] ?? "")
	.split(/\s+/)
	.filter(Boolean);
const merged = [...ourList, ...theirList.filter((x) => !ourList.includes(x))];

const result = { ...ours };
result.scripts = { ...ours.scripts, "test:desktop": merged.join(" ") };

/* The parse check the 2026-10-16 corruption did not have. */
let serialised;
try {
	serialised = `${JSON.stringify(result, null, 2)}\n`;
	JSON.parse(serialised);
} catch (error) {
	refuse(`the resolved JSON would not parse on re-read (${error.message})`);
}

const added = merged.filter((x) => !ourList.includes(x));
const addedNote = added.length
	? ` (added ${added.join(", ")})`
	: " (nothing added)";
process.stdout.write(
	`resolve-package-union: test:desktop ${ourList.length} -> ${merged.length}${addedNote}\n`,
);

if (CHECK) {
	process.stdout.write("resolve-package-union: --check, nothing written\n");
	process.exit(0);
}

const current = readFileSync(PATH, "utf8");
if (current === serialised) {
	process.stdout.write(
		`resolve-package-union: ${PATH} already holds the resolved union; nothing written\n`,
	);
} else {
	writeFileSync(PATH, serialised);
	process.stdout.write(
		`resolve-package-union: wrote ${PATH}; stage it and continue the rebase\n`,
	);
}
