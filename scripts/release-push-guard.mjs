#!/usr/bin/env node
/**
 * Whether a push to `main` is this workflow's own release commit.
 *
 * WHY THIS IS A SCRIPT AND NOT A `case` IN THE YAML. It is logic, and logic inside
 * a `run:` block cannot be unit-tested — the same reason the derivation lives in
 * `derive-release.mjs`. The first version of this guard was a `case` on the pushed
 * head's subject and its test asserted that the `case` existed, so it shipped with a
 * defect nothing could see: this repository lands the bump as a **merge commit**.
 * `8f80697c8` is `Merge pull request #202 from …/release-next-0236`, whose second
 * parent is `d7e7d63b7 chore(release): bump version to 0.24.0`, so a guard that
 * tests one subject shape answers "not the release commit" for exactly the push it
 * exists to catch. The consequence is not a red run: `assertVersionSurface` in
 * `derive-release.mjs` then answers a different question and returns yes once the
 * tag exists, and the run cuts a **second release of a window that has already
 * shipped** — duplicate notes, a version burned forever, and two concurrent signing
 * builds for one release.
 *
 * WHAT IT ASKS INSTEAD. The guard is defined by what the push **contains**, not by
 * how its head is spelled. Two readings, and either is enough to answer "nothing to
 * release":
 *
 *  - **what this push landed**: `package.json`'s version line and nothing else,
 *    measured against the commit's FIRST PARENT. This is the release commit in the
 *    shape this repository actually produces. Measured on the real one, not
 *    inferred: `git diff --name-only 8f80697c8^ 8f80697c8` is `package.json` and the
 *    change is `-  "version": "0.23.5", +  "version": "0.24.0",`. Note what it is
 *    NOT measured against: the newest released *tag*, which for a hand-cut release
 *    is a whole window behind and would see this push as a hundred files of content
 *    (`git diff --name-only v0.23.5 8f80697c8` is 177 files) because the window's
 *    PRs landed on `main` before the bump PR did.
 *  - **what has not been released**: nothing at all, or nothing but the version
 *    line, against the newest released tag. This catches the push whose tree the
 *    newest release already has — a bump whose tag was created, the commit that
 *    reverts one, and the same release commit seen a second time.
 *
 * `isVersionOnlyChange` is the predicate `apply-release-bump.mjs` asserts the bump
 * commit with before it is committed, so the guard and the bump share one
 * definition of "the version line and nothing else" rather than two spellings of it.
 * Every shape a bump can land in therefore answers the same way: a direct commit, a
 * merge whose second parent is the bump, a squash, a bump whose Release does not
 * exist yet, and the commit that reverts one. All of them are executed against this
 * script, in throwaway repositories, by `release-push-guard.test.mjs`.
 *
 * WHAT IT REFUSES. Anything it cannot answer stops the run, with the state named,
 * rather than falling through to a derivation that would answer a different
 * question: no released tag to measure against, or a release list naming a tag this
 * clone does not carry.
 *
 * KNOWN LIMITS, stated rather than implied:
 *
 *  - a push that lands SEVERAL commits with the bump at its tip is recognised by the
 *    last-commit reading and skipped. Nothing is released twice by that — the state
 *    it leaves is `main` advertising a version no Release explains, which the next
 *    push refuses loudly on (`assertVersionSurface`) with the recovery `AGENTS.md`
 *    documents — but it is a stall until somebody acts, and the workflow itself
 *    never pushes more than one commit;
 *  - a push carrying real content and the version line in the SAME commit is not
 *    recognised, and must not be: it carries something to release. It lands the same
 *    orphaned-version state and the same loud refusal;
 *  - an EMPTY commit (or a merge that changed nothing) is not treated as the release
 *    commit: landing nothing is not the same as landing the version line, and a push
 *    that lands nothing while content is unreleased still owes a release.
 */
import { execFileSync } from "node:child_process";
import { isVersionOnlyChange } from "./apply-release-bump.mjs";
import { isEntryPoint } from "./entry-point.mjs";
import { fetchReleases, selectVersionAnchor } from "./release-baseline.mjs";

/** Thrown for anything that must stop the run rather than be guessed around. */
export class PushGuardError extends Error {}

const git = (args) =>
	// stderr is piped rather than inherited: every git failure below is turned into
	// a named refusal, and git's own `fatal: ambiguous argument` in the run summary
	// is not the copy the rest of this project uses for a refusal.
	execFileSync("git", args, {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		stdio: ["ignore", "pipe", "pipe"],
	});

/** The files that differ between two commits. Read rather than inferred from the
 * subject: a subject says nothing about what landed. */
export function readChangedFiles(from, to) {
	try {
		return git(["diff", "--name-only", from, to])
			.split("\n")
			.filter((line) => line.trim() !== "");
	} catch {
		// Named rather than surfacing git's own `fatal: ambiguous argument`: a
		// release list that names a tag this clone does not carry is a refusal a
		// reader has to be able to act on (fetch the tags), not git internals.
		throw new PushGuardError(
			`${from} or ${to} is not a ref this clone carries, so this push cannot be read`,
		);
	}
}

/** `package.json` as one side of a diff sees it. A missing file is a refusal:
 * "there is no version line to compare" is not "the version line is unchanged". */
export function readPackageAt(rev) {
	try {
		return git(["show", `${rev}:package.json`]);
	} catch {
		throw new PushGuardError(
			`${rev} has no package.json, so the version line this guard compares cannot be read`,
		);
	}
}

/** The commit's first parent, or null for a commit that has none. A root commit
 * cannot answer "what did this push land", which is a question about a parent. */
export function readFirstParent(ref) {
	try {
		return git(["rev-parse", "--verify", "--quiet", `${ref}^`]).trim();
	} catch {
		return null;
	}
}

/** The version values a version-only change moved between, for the summary only:
 * the SHAPE of the change is decided by `isVersionOnlyChange`, and this just names
 * the two numbers a reader wants to see. */
const versionIn = (text) => /"version"\s*:\s*"([^"]+)"/.exec(text)?.[1] ?? "?";

/** Whether a reading is "the version line and nothing else": exactly one file, it is
 * `package.json`, and the only lines that moved are the version line. */
function isVersionOnly({ files, packageAtFrom, packageAtTo }) {
	return (
		files.length === 1 &&
		files[0] === "package.json" &&
		isVersionOnlyChange(packageAtFrom, packageAtTo)
	);
}

/**
 * The verdict, as a pure function of the two readings.
 *
 * `unreleased` is what HEAD has that the newest released tag does not; `landed` is
 * what this push itself added (HEAD against its first parent), or null when there is
 * no parent to read. `skip: true` means "this push has nothing to release", which is
 * a real answer and not an error: the run reports it and stops. Everything else
 * proceeds to the derivation, which is the only thing allowed to decide a version.
 */
export function pushVerdict({ releasedTag, unreleased, landed }) {
	if (!releasedTag)
		throw new PushGuardError(
			"No released tag exists in this repository, so there is no release for this push to be measured against",
		);
	if (unreleased.files.length === 0)
		return {
			skip: true,
			shape: "nothing-unreleased",
			message: `Nothing has landed since ${releasedTag}, so there is nothing to release.`,
		};
	if (isVersionOnly(unreleased))
		return {
			skip: true,
			shape: "version-line-only",
			message: `Since ${releasedTag}, nothing has landed but \`package.json\`'s version line — the release commit itself, whichever shape it landed in. There is nothing to release.`,
		};
	if (landed && isVersionOnly(landed))
		return {
			skip: true,
			shape: "release-commit",
			message: `This push landed one line in one file, \`package.json\`'s version line (${versionIn(landed.packageAtFrom)} -> ${versionIn(landed.packageAtTo)}), and nothing else. That is this workflow's own release commit — its bump lands as a merge as often as directly — so there is nothing to release.`,
		};
	return {
		skip: false,
		shape: "content",
		message: `This push carries content ${releasedTag} does not have (${unreleased.files.length} file(s), ${(landed?.files.length ?? 0)} of them landed by this push).`,
	};
}

/** The newest released tag, as the derivation will resolve it as well.
 *
 * A release list that cannot be read is a refusal rather than an empty one: "I could
 * not find out what has been released" and "nothing has been released" are different
 * facts, and reporting the second when the first is true is how a push gets skipped
 * instead of derived. */
export function releasedTagOf(repository) {
	try {
		return selectVersionAnchor(fetchReleases(repository))?.tag ?? null;
	} catch {
		throw new PushGuardError(
			`The release list for ${repository} could not be read, so this guard cannot tell whether this push carries anything to release. Nothing has been derived and nothing has been skipped.`,
		);
	}
}

function main() {
	const arg = (name) => {
		const index = process.argv.indexOf(name);
		return index < 0 ? null : (process.argv[index + 1] ?? null);
	};
	const repository =
		arg("--repository") ??
		process.env.GITHUB_REPOSITORY ??
		"damianvtran/local-operator-ui";
	const ref = arg("--ref") ?? "HEAD";
	try {
		// `--released-tag` exists so the guard can be driven against a scratch
		// repository without a forge, which is how its behaviour is tested; the
		// workflow leaves it unset and resolves the same anchor the derivation will.
		const releasedTag =
			arg("--released-tag") ?? releasedTagOf(repository) ?? null;
		if (!releasedTag)
			throw new PushGuardError(
				"No released tag exists in this repository, so there is no release for this push to be measured against",
			);
		const previous = readFirstParent(ref);
		const head = git(["rev-parse", ref]).trim();
		// Read ONCE and used twice: `pushVerdict` decides the shape from this reading,
		// and the `--json` document carries the very same value, so a reader of
		// `push-guard.json` (and the suite) can see which landing the verdict was
		// about instead of inferring it from the message.
		const landed = previous
			? {
					files: readChangedFiles(previous, ref),
					packageAtFrom: readPackageAt(previous),
					packageAtTo: readPackageAt(ref),
				}
			: null;
		const verdict = pushVerdict({
			releasedTag,
			unreleased: {
				files: readChangedFiles(releasedTag, ref),
				packageAtFrom: readPackageAt(releasedTag),
				packageAtTo: readPackageAt(ref),
			},
			landed,
		});
		if (process.argv.includes("--json")) {
			console.log(
				JSON.stringify(
					{ ...verdict, ref, sha: head, releasedTag, previous, landed },
					null,
					2,
				),
			);
		} else {
			console.log(
				`${verdict.skip ? "No release" : "Release"}: ${verdict.message}`,
			);
		}
	} catch (error) {
		// Loud, and never a silent "nothing to release": a guard that cannot answer
		// its question has not answered it, and reporting "no release" here is how
		// the window would be skipped rather than derived.
		console.error(
			error instanceof PushGuardError
				? `Push guard refused: ${error.message}`
				: `Push guard failed: ${error.stack ?? error.message}`,
		);
		process.exit(1);
	}
}

// The guard reaches its own entry point by PHYSICAL path like every other release
// script (`./entry-point.mjs` says why). Its own stake in that is the largest of
// the eight: this is the script that decides whether a push is the release commit,
// so a spelling that silenced it did not fail the run, it let the release proceed
// unguarded — the workflow's `jq -r .skip` read the empty file as "not a skip".
// `release-push-guard.test.mjs` drives that invocation, and the consumer half of
// the same defect — treating an empty result as an answer — is refused in
// `auto-release.yml`.
if (isEntryPoint(import.meta.url)) {
	main();
}
