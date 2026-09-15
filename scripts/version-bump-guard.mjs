#!/usr/bin/env node
/**
 * Reject a `package.json` version bump outside a dedicated release PR.
 *
 * WHY THIS EXISTS. A written rule is not a control. In the backend repository
 * (`local-operator`) the rule — "PRs do not bump the version; the release owner
 * bumps it once per window" — was already in its AGENTS.md and was still broken
 * twice: two feature PRs landed their own version change, both review rounds
 * passed anyway, and `main` advertised a version that no tag, Release or
 * artifact had ever been built from. Those two numbers were consumed without
 * ever being published, and the next release had to skip them because a
 * published version cannot be reused. A rule that depends on every reviewer
 * remembering to look is a rule that fails on the day someone does not, so the
 * rule gets a check.
 *
 * This mirrors the `version-bump-guard` job in the backend `local-operator`
 * repository, adapted to this repo's version surface: `package.json` is the
 * version source, tags are `vX.Y.Z`, and the publish workflow triggers on
 * `release: published` rather than on a tag push.
 *
 * It makes the violation LOUD, it does not make it impossible: `main` here
 * configures no required status checks, so an `--admin` merge lands over a red
 * guard. Read a failing guard as a stop signal, never as an obstacle to route
 * around.
 *
 * Inputs are the PR title (env `PR_TITLE`) and, from this script itself,
 * `git diff HEAD^1 HEAD -- package.json` — see readVersionDiff for why that is
 * the one diff form that answers the question being asked.
 */
import { execFileSync } from "node:child_process";
import { isEntryPoint } from "./entry-point.mjs";

/** Thrown for conditions that must fail the job rather than pass it. */
class GuardError extends Error {}

// The acceptance rules, in one place because both directions matter:
//
//  - a release PR is exempt, keyed on the same conventional-commit title the
//    release procedure already requires;
//  - a release PR that changes NOTHING is the mirror-image failure and the more
//    dangerous direction, so it is keyed on the *fully* qualified title. The
//    window's claim PR (`chore(release): claim release window`) carries an empty
//    commit and no version change, and it is a legitimate long-lived PR — only
//    the bump title means "this PR is the release".
const RELEASE_TITLE_PREFIX = "chore(release):";
const RELEASE_BUMP_TITLE_PREFIX = "chore(release): bump version to ";

/**
 * The version line as it appears in a `package.json` diff.
 *
 * `package.json` is JSON, so the backend's `version =` shell regex does not
 * apply: the line is `"version": "0.19.5"`. Both the removed and the added side
 * of an edit match, exactly as the backend's `^[+-]version[[:space:]]*=` does,
 * because "a version line was touched" is the signal — which side of it does
 * not matter for the verdict.
 */
const VERSION_LINE_RE = /^[+-][ \t]*"version"[ \t]*:/;

/**
 * The string value of a `"version": "..."` line. Quoted-only on purpose: a
 * line this regex does not match is a version this guard cannot read, and
 * "cannot read" must not be reported as "no version".
 */
const VERSION_VALUE_RE = /:[ \t]*"([^"]*)"/;

/** A semver numeric identifier, which compares numerically and not as text. */
const NUMERIC_ID_RE = /^\d+$/;

/** `git ls-remote` prints `<sha>` then whitespace then the ref. */
const FIELD_SPLIT_RE = /\s+/;

/**
 * A PR title is attacker-controlled text and it is printed to a runner log,
 * where a line beginning `::` is a workflow command the runner acts on — so a
 * crafted title could forge an annotation (`::error::…`) in the job output.
 * Collapse CR/LF (a newline would start a new log line) and drop `::` where it
 * would be line-leading.
 *
 * Log spoofing only: a title cannot change this guard's verdict, which is read
 * from the diff and from the title's PREFIX and never from its contents.
 */
function printableTitle(title) {
	return title.replace(/[\r\n]+/g, " ").replace(/(^|\s)::/g, "$1");
}

/**
 * A version this guard is willing to reason about: the component grammar of
 * `scripts/validate-release.mjs`'s `TAG_RE`, exactly, minus the leading `v`
 * and with the prerelease body captured so precedence can be compared.
 * Anything else is
 * ignored rather than fatal — validate-release.mjs rejects a non-conforming tag
 * before any build, so such a tag can never name a published release here and
 * cannot be the "highest tag" that a new version has to clear.
 *
 * The numeric identifiers are `(0|[1-9]\d*)`, not `\d+`, and that is
 * load-bearing rather than tidiness: `git tag` permits `v01.2.3`, which
 * validate-release would reject, and a loose `\d+` would parse it as version
 * `1.2.3` and let one stray tag become "the highest tag" — failing every
 * release PR with "does not sort above v01.2.3" until someone deleted the tag.
 * Ignoring it is the same reasoning that ignores `nightly`.
 */
const SEMVER_RE =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

/** Raw `+`/`-` version lines in the diff, ignoring non-version `package.json` edits. */
export function versionLineChanges(diff) {
	return diff.split("\n").filter((line) => VERSION_LINE_RE.test(line));
}

/** The version the diff adds, or null when it adds none this guard can read. */
export function newVersionFrom(changed) {
	for (const line of changed) {
		if (!line.startsWith("+")) continue;
		const value = line.slice(1).match(VERSION_VALUE_RE);
		if (value) return value[1];
	}
	return null;
}

function parseSemver(version) {
	const m = SEMVER_RE.exec(version);
	if (!m) return null;
	return {
		release: [Number(m[1]), Number(m[2]), Number(m[3])],
		prerelease: m[4] ? m[4].split(".") : null,
	};
}

function comparePrerelease(a, b) {
	// Semver precedence: a version with a prerelease sorts BELOW the release it
	// precedes, so 1.0.0-rc.1 < 1.0.0. This is deliberately not `sort -V`: GNU
	// version sort orders `1.0.0-rc.1` ABOVE `1.0.0`, which would reject the
	// ordinary rc-to-final promotion as a "rewind" and force a needless patch
	// bump. The backend's guard can use `sort -V` because it never publishes a
	// prerelease; this repo does (see CONTRIBUTING.md and validate-release.mjs,
	// which accepts `vX.Y.Z-rc.1`), so precedence has to be the real one.
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i];
		const y = b[i];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		const nx = NUMERIC_ID_RE.test(x);
		const ny = NUMERIC_ID_RE.test(y);
		if (nx && ny) {
			if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
		} else if (nx !== ny) {
			// Numeric identifiers always have lower precedence than alphanumeric.
			return nx ? -1 : 1;
		} else if (x !== y) {
			return x < y ? -1 : 1;
		}
	}
	return 0;
}

/**
 * Semver precedence, which is what "sorts above the newest tag" has to mean.
 * Not a string compare: `"0.19.10" < "0.19.5"` lexicographically, so a string
 * compare waves through a version BELOW the newest one.
 * Returns null when either side is not a version this guard understands.
 */
export function compareVersions(a, b) {
	const pa = parseSemver(a);
	const pb = parseSemver(b);
	if (!pa || !pb) return null;
	for (let i = 0; i < 3; i++) {
		if (pa.release[i] !== pb.release[i])
			return pa.release[i] < pb.release[i] ? -1 : 1;
	}
	if (pa.prerelease === null && pb.prerelease === null) return 0;
	if (pa.prerelease === null) return 1;
	if (pb.prerelease === null) return -1;
	return comparePrerelease(pa.prerelease, pb.prerelease);
}

/**
 * The verdict, as data, so the whole matrix is testable without git or network.
 * `tags` is the version list read from the remote (no `v` prefix).
 * Returns `{ ok, lines }`; callers print `lines` and exit on `ok`.
 */
export function decideVersionBump({ prTitle, diff, tags = [] }) {
	const lines = [];
	const changed = versionLineChanges(diff);

	if (changed.length === 0) {
		if (prTitle.startsWith(RELEASE_BUMP_TITLE_PREFIX)) {
			// The mirror-image case, and the more dangerous one. A release PR that
			// changes nothing ships the PREVIOUS release's code under a new number:
			// the tag, the GitHub Release and the installers all agree with each
			// other about the wrong tree, so nothing looks wrong. The usual cause is
			// an amend made on a detached HEAD — the branch ref never moved, and
			// `--force-with-lease` reports success honestly because nothing needed
			// overwriting. So the check names the tell rather than the symptom.
			lines.push(
				"::error file=package.json::A release PR must actually change the version.",
				`This PR is titled '${printableTitle(prTitle)}' but its diff does not touch the version`,
				"line in package.json, so the release would carry the previous version's",
				"code under a new number.",
				"",
				"The usual cause is an amend made on a detached HEAD: the branch ref never",
				"moved, and --force-with-lease still reports success because nothing needed",
				"overwriting. Check what the FORGE has, not what your local clone has:",
				"  gh pr view <n> --json headRefOid --jq .headRefOid",
				"  gh api repos/damianvtran/local-operator-ui/contents/package.json?ref=<that-sha> --jq .content | base64 -d | grep '\"version\"'",
			);
			return { ok: false, lines };
		}
		lines.push("No version change in package.json.");
		return { ok: true, lines };
	}

	if (!prTitle.startsWith(RELEASE_TITLE_PREFIX)) {
		lines.push(
			"::error file=package.json::A feature PR must not change the project version.",
			"This PR changes the version line in package.json:",
			...changed,
			"",
			"Versions are bumped only by a dedicated release PR whose title starts with",
			"'chore(release):', cut by the release window owner. Drop the bump from this",
			"branch; package.json stays at the last released version on every feature",
			"branch.",
		);
		return { ok: false, lines };
	}

	lines.push("Release PR, version change allowed:", ...changed);

	const newVersion = newVersionFrom(changed);
	if (newVersion === null) {
		// An unparsable version must never pass unchecked: this guard's whole job
		// is to be the thing that read the line, and "I could not read it" is not
		// "it was fine".
		lines.push(
			"::error file=package.json::Could not parse the new version.",
			"The diff adds a version line this job cannot read:",
			...changed,
			'Expected a JSON string, e.g. "version": "X.Y.Z". Fix the line, or update',
			"this job if the project's version syntax has genuinely changed.",
		);
		return { ok: false, lines };
	}

	// The new version must sort above the highest existing release tag. A
	// published version cannot be corrected: an installer that already holds a
	// newer number silently declines to move a user onto the real release, and a
	// number consumed by an unreleased in-PR bump is skipped, never reused.
	const highest = tags
		.filter((tag) => parseSemver(tag) !== null)
		.sort((a, b) => compareVersions(a, b))
		.at(-1);

	if (highest === undefined) {
		// Same fallback as the backend guard: with nothing to compare against,
		// the ordering check cannot reach a verdict, and failing every release on
		// a repo that has no tags yet would be the check being wrong.
		lines.push(
			"No release tags found on the remote; skipping the ordering check.",
		);
		return { ok: true, lines };
	}

	const order = compareVersions(newVersion, highest);
	if (order === null || order <= 0) {
		lines.push(
			"::error file=package.json::Release version must be above the highest tag.",
			`New version '${newVersion}' does not sort above the highest release tag 'v${highest}'.`,
			"A published version cannot be corrected, so pick the next unused number",
			`above v${highest} rather than reusing or rewinding one.`,
		);
		return { ok: false, lines };
	}

	lines.push(
		`Version ${newVersion} sorts above the highest release tag v${highest}.`,
	);
	return { ok: true, lines };
}

/**
 * The diff of `package.json` introduced by this PR, as CI sees it.
 *
 * `HEAD^1 HEAD` and NOT a three-dot diff against `github.event.pull_request.base.sha`.
 * Actions checks out the RECOMPUTED `refs/pull/N/merge`, whose first parent is
 * the base branch as of this run, while `base.sha` is frozen when the event
 * fires. Once `main` moves — which is exactly what happens during the busy
 * release window this guard protects — the frozen SHA becomes an ancestor of
 * HEAD, `merge-base` returns it unchanged, and the three-dot form silently
 * degrades to two-dot, sweeping in every version bump `main` itself landed and
 * failing an innocent PR for a diff it never wrote. The first person failed by
 * a version diff they did not write is the person who disables the guard.
 *
 * A FAILING diff command THROWS rather than returning "". This is the
 * fail-open guard: an empty string is indistinguishable from "no version
 * change", which is the one verdict that lets a real bump through unexamined —
 * a shallow checkout, a wrong ref or a broken `git` would all read as a pass.
 */
export function readVersionDiff({ cwd = process.cwd() } = {}) {
	try {
		return execFileSync(
			"git",
			["diff", "HEAD^1", "HEAD", "--", "package.json"],
			{
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
	} catch (err) {
		const detail = (err.stderr || err.message || "").toString().trim();
		throw new GuardError(
			[
				"::error file=package.json::Could not read the package.json diff.",
				"`git diff HEAD^1 HEAD -- package.json` failed, so this guard cannot tell",
				"whether the PR changes the version. It must not assume it does not:",
				"that is the fail-open direction, where a real bump passes unexamined.",
				detail,
			].join("\n"),
		);
	}
}

/**
 * Every `v<semver>` tag the remote advertises.
 *
 * `ls-remote`, NOT `git describe`, and that is load-bearing rather than taste:
 * `actions/checkout@v4` passes `--no-tags` unless `fetch-tags: true` (its
 * default is false), so the checkout carries ZERO tags and `describe` exits 128
 * on every real run — a check that used it would be dead code that passes a
 * backward bump green. `fetch-tags: true` does not fix it either: it reaches
 * only as deep as the fetch window, so `describe` finds the tag when it sits on
 * the checked-out commit's parent and still fails once the tag is deeper than
 * that window — which is the normal state during a release window, when more
 * than one merge has landed since the last tag. `ls-remote` asks the forge
 * instead of
 * the local object store, needs no history, and so reports the highest tag
 * REPO-WIDE rather than merely the newest reachable one — the stricter reading,
 * and the right one: a release must be forward of everything ever published.
 *
 * One limit worth knowing: `actions/checkout` sets `origin` to the FORK for a
 * pull request opened from one, so a fork that carries no tags would take the
 * "no release tags found" path and skip the ordering check. Detection of a
 * version change is unaffected — only the ordering half goes unchecked — and
 * every PR in this repository is pushed from the same remote.
 */
export function listReleaseTags({
	cwd = process.cwd(),
	remote = "origin",
} = {}) {
	let out;
	try {
		out = execFileSync(
			"git",
			["ls-remote", "--tags", "--refs", remote, "v[0-9]*"],
			{ cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
	} catch (err) {
		// Fails closed, like the backend's pipeline under `set -euo pipefail`: an
		// unreadable tag list is not evidence that the version is fine.
		const detail = (err.stderr || err.message || "").toString().trim();
		throw new GuardError(
			[
				"::error file=package.json::Could not read the release tags.",
				`\`git ls-remote --tags --refs ${remote} 'v[0-9]*'\` failed, so the new version`,
				"cannot be checked against the highest existing tag:",
				detail,
			].join("\n"),
		);
	}
	return out
		.split("\n")
		.map((line) => line.trim().split(FIELD_SPLIT_RE)[1] ?? "")
		.filter((ref) => ref.startsWith("refs/tags/v"))
		.map((ref) => ref.slice("refs/tags/v".length));
}

function main() {
	const prTitle = process.env.PR_TITLE;
	if (!prTitle) {
		// An unset title would make every `startsWith` false and silently turn a
		// release PR into a rejected feature PR, or the reverse. Refuse instead.
		console.error(
			"::error::PR_TITLE is not set. This guard reads the pull request title " +
				"from the environment and must not guess at it.",
		);
		process.exit(1);
	}

	let verdict;
	try {
		verdict = decideVersionBump({
			prTitle,
			diff: readVersionDiff(),
			tags: listReleaseTags(),
		});
	} catch (err) {
		if (err instanceof GuardError) {
			console.error(err.message);
			process.exit(1);
		}
		throw err;
	}

	for (const line of verdict.lines) console.log(line);
	process.exit(verdict.ok ? 0 : 1);
}

// Importable for the test suite; only the CLI path reads the environment.
if (isEntryPoint(import.meta.url)) main();
