#!/usr/bin/env node
/**
 * The next release, derived from the conventional commits since the last
 * released tag — and the notes that describe it.
 *
 * WHY THIS IS A MODULE AND NOT SHELL IN THE WORKFLOW. The version a release gets
 * is the one number in this repository that cannot be taken back: a published
 * version is spent forever, and a wrong bump is either a user-facing lie (an
 * over-called minor) or an invisible fix (an under-called patch). Shell inside a
 * YAML `run:` block cannot be unit-tested, so the derivation lives here as a pure
 * function of the commits, and `.github/workflows/auto-release.yml` only supplies
 * the commits and applies the result.
 *
 * THE MAPPING, and why it is this one. This repository is pre-1.0 and its tags are
 * plain `vX.Y.Z` (`v0.24.0`), so the mapping is stated for that world:
 *
 *   - a breaking change (`!:` before the colon, or a `BREAKING CHANGE:` footer) or
 *     a `feat:` -> **minor**. Pre-1.0, conventional commits would call a breaking
 *     change a *major*; majors are deliberately unavailable here. `AGENTS.md`
 *     reserves a major for "a new version considered a distinct product", which no
 *     commit type can assert, and a pre-1.0 `1.0.0` would be a claim about the
 *     product's stability that this workflow has no basis to make.
 *   - `fix:`, `perf:`, `revert:` -> **patch**.
 *   - `docs:`, `chore:`, `ci:`, `test:`, `refactor:`, `style:`, `build:` alone ->
 *     **no release**, and the run says so instead of inventing a number.
 *   - a conventional-looking type that is neither list (`deps:`, `security:`) ->
 *     **patch**, the conservative reading, and it is named in the notes. Silently
 *     dropping a change nobody classified is the failure mode this whole file
 *     exists to avoid.
 *
 * THE DISCONTINUITY, stated rather than hidden: `AGENTS.md`'s manual rule is
 * "choose the bump by user-facing materiality, not commit type". Automation cannot
 * read materiality, so under this workflow the commit types decide (with the
 * safety valve below for a window none of them describes). A window that lands one
 * `feat:` therefore gets a minor even if that feature is small — an over-called
 * minor is the price of not having a human read the window, and it is the direction
 * the manual rule already prefers to err away from.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
	compareVersions,
	fetchReleases,
	selectVersionAnchor,
	selectWindowAnchor,
	tagVersion,
} from "./release-baseline.mjs";

/** Bump classes, ordered so a window's class is the strongest one it contains. */
const RANK = { patch: 1, minor: 2 };

/** Types that force a minor on their own. */
const MINOR_TYPES = new Set(["feat"]);
/** Types that force a patch on their own. */
const PATCH_TYPES = new Set(["fix", "perf", "revert"]);
/** Types that release nothing on their own. */
const NO_RELEASE_TYPES = new Set([
	"docs",
	"chore",
	"ci",
	"test",
	"refactor",
	"style",
	"build",
]);

/** `type(scope)!: subject` — the only shape that carries a type at all. */
const CONVENTIONAL_SUBJECT = /^([a-z][a-z0-9-]*)(?:\([^)]*\))?(!)?: \S/;
/** The footer spelling, which GitHub's squash UI and a hand-written body both use. */
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;
/** A merge commit, whose own subject describes the landing rather than a change. */
const MERGE_SUBJECT = /^Merge (pull request|branch|remote-tracking)/;
/** The PR a landing belongs to, from either landing shape: GitHub's merge button
 * (`Merge pull request #12 from x`) or its squash button (`subject (#12)`). */
const MERGE_PR = /^Merge pull request #(\d+) from /;
const SQUASH_PR = /\(#(\d+)\)$/;
/** One git-log record: fields separated by US, records by RS. Chosen because
 * neither can appear in a commit subject or body. */
const FIELD = "\u001f";
const RECORD = "\u001e";

/** Thrown for anything that must fail the run rather than produce a version. */
export class DerivationError extends Error {}

/** What one commit says about the next version. */
export function classifyCommit(commit) {
	const subject = commit.subject ?? "";
	const body = commit.body ?? "";
	const breaking = BREAKING_FOOTER.test(body);
	const match = CONVENTIONAL_SUBJECT.exec(subject);
	if (!match) {
		// No type at all: a merge commit, a hand-written subject, a `wip`. Listed
		// by the caller, never guessed at here.
		return { type: null, bump: null, breaking, conventional: false };
	}
	const type = match[1];
	const bang = Boolean(match[2]);
	if (bang || breaking)
		return { type, bump: "minor", breaking: true, conventional: true };
	if (MINOR_TYPES.has(type))
		return { type, bump: "minor", breaking: false, conventional: true };
	if (PATCH_TYPES.has(type))
		return { type, bump: "patch", breaking: false, conventional: true };
	if (NO_RELEASE_TYPES.has(type))
		return { type, bump: null, breaking: false, conventional: true };
	// Conventional in shape, unknown by name: read as a patch and said so.
	return {
		type,
		bump: "patch",
		breaking: false,
		conventional: true,
		unlistedType: true,
	};
}

/** The version surface `main` must be showing before a release is derived.
 *
 * `package.json` at the head of `main` has to equal the newest released tag's
 * version. It is the same check `AGENTS.md` tells a release owner to make by hand
 * (`git diff <last-tag>..main -- package.json` must be empty), and it catches two
 * states that both end in a version nobody can reuse:
 *
 *  - a merged PR carried its own bump (the `version-bump-guard` makes that loud on
 *    the PR, but `main` here has no ruleset, so an `--admin` merge lands over a red
 *    guard and this is the backstop), or
 *  - a previous run died between pushing the bump and creating the tag, so `main`
 *    advertises a version with no tag and no Release behind it.
 *
 * Either way the answer is a human decision — tag the orphaned commit, or drop the
 * bump — so this refuses loudly and names both numbers rather than deriving a
 * version on top of a version surface it cannot account for. */
export function assertVersionSurface({ packageVersion, versionBase }) {
	if (packageVersion !== versionBase) {
		throw new DerivationError(
			`package.json at HEAD says ${packageVersion}, but the newest released tag is ${versionBase}: a merged PR carried its own bump, or a previous release died between its bump and its tag. Decide which by hand (tag the orphaned commit, or drop the stray bump) before releasing.`,
		);
	}
	return true;
}

/** The strongest bump a set of commits asks for, with the commits behind it. */
export function classifyCommits(commits) {
	let bump = null;
	let conventional = false;
	const breaking = [];
	const unlistedTypes = [];
	const unclassified = [];
	for (const commit of commits) {
		const verdict = classifyCommit(commit);
		if (verdict.breaking) breaking.push(commit.subject ?? "");
		if (verdict.unlistedType)
			unlistedTypes.push(`${verdict.type}: ${commit.subject ?? ""}`);
		if (verdict.bump && (bump === null || RANK[verdict.bump] > RANK[bump]))
			bump = verdict.bump;
		if (verdict.conventional) conventional = true;
		else unclassified.push(commit.subject ?? "");
	}
	return { bump, conventional, breaking, unlistedTypes, unclassified };
}

/** The next version, from a base version and a bump. Throws rather than
 * producing something that is not a plain `X.Y.Z`. */
export function bumpVersion(version, bump) {
	const parts = String(version).split(".").map(Number);
	if (
		parts.length !== 3 ||
		parts.some((part) => !Number.isInteger(part) || part < 0)
	)
		throw new DerivationError(`Not a plain X.Y.Z version: ${version}`);
	const [major, minor, patch] = parts;
	if (bump === "major")
		// Reachable only from a hand-written `--force-bump major`: the mapping
		// above never produces one (see the module comment).
		return `${major + 1}.0.0`;
	if (bump === "minor") return `${major}.${minor + 1}.0`;
	if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
	throw new DerivationError(`Unknown bump class: ${bump}`);
}

/**
 * The whole derivation, as a pure function of what was read.
 *
 * `commits` are every commit in `<windowBase>..<ref>`; `landings` are the
 * first-parent entries of the same range, which is what the notes list (see
 * `AGENTS.md` on why the window is counted on the first-parent chain).
 */
export function deriveRelease({
	windowBase,
	versionBase,
	commits = [],
	landings = [],
	forcedBump = null,
}) {
	if (!versionBase) throw new DerivationError("A version base is required");
	const window = classifyCommits(commits);
	const bump = forcedBump ?? window.bump;
	const unclassifiedLandings = landings.filter(
		(landing) => landing.bump === null && landing.conventional === false,
	);
	if (!bump) {
		return {
			release: false,
			bump: null,
			version: null,
			reason: `No commit in ${windowBase}..HEAD asks for a release: ${describeTypes(commits)}. A release needs a breaking change, a feat:, or a fix:/perf:/revert:; docs, chore, ci, test, refactor, style and build do not release on their own.`,
			breaking: window.breaking,
			unlistedTypes: window.unlistedTypes,
			unclassified:
				unclassifiedLandings.length > 0
					? unclassifiedLandings.map((landing) => landing.subject)
					: window.unclassified,
		};
	}
	const version = bumpVersion(versionBase, bump);
	if (compareVersions(version, versionBase) <= 0)
		throw new DerivationError(
			`Derived version ${version} is not above ${versionBase}`,
		);
	return {
		release: true,
		bump,
		version,
		forced:
			forcedBump !== null && forcedBump !== window.bump ? forcedBump : null,
		reason: forcedBump
			? `Bump forced to ${forcedBump} by the dispatch (the commits ask for ${window.bump ?? "nothing"})`
			: `Strongest conventional type in the window is ${window.bump}`,
		breaking: window.breaking,
		unlistedTypes: window.unlistedTypes,
		unclassified:
			unclassifiedLandings.length > 0
				? unclassifiedLandings.map((landing) => landing.subject)
				: window.unclassified,
	};
}

/** "3 fix:, 1 docs:" — the commit types present, for the no-release reason. */
function describeTypes(commits) {
	const counts = new Map();
	for (const commit of commits) {
		const verdict = classifyCommit(commit);
		const key = verdict.type ?? "no conventional type";
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	if (counts.size === 0) return "the range carries no non-merge commits";
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([type, count]) => `${count} ${type}`)
		.join(", ");
}

/** Parse `git log --first-parent` output in the FIELD/RECORD format above. */
export function parseLog(text) {
	return text
		.split(RECORD)
		.map((record) => record.replace(/^\n/, ""))
		.filter((record) => record.trim() !== "")
		.map((record) => {
			const [sha, subject, parents, body] = record.split(FIELD);
			return {
				sha,
				subject: subject ?? "",
				parents: (parents ?? "").split(" ").filter(Boolean),
				body: body ?? "",
			};
		});
}

/** One landing, with the PR title and body GitHub holds for it. */
function describeLanding(landing, lookupPr) {
	const merge = MERGE_PR.exec(landing.subject);
	const squash = SQUASH_PR.exec(landing.subject);
	const number = merge ? Number(merge[1]) : squash ? Number(squash[1]) : null;
	const pr = number ? lookupPr(number) : null;
	return {
		sha: landing.sha,
		subject: landing.subject,
		number,
		title: pr?.title ?? null,
		// The `Release:` line is the merger's own impact sentence, which is what
		// the notes quote; nothing in this file writes prose about a change.
		releaseLine: pr ? releaseLineOf(pr.body ?? "") : null,
		bump: landing.bump ?? null,
		conventional: landing.conventional ?? true,
	};
}

/** The `Release: <patch|minor> — <impact>` line a PR body carries, verbatim. */
export function releaseLineOf(body) {
	const match = /^Release:.*$/m.exec(body ?? "");
	return match ? match[0].trim() : null;
}

/**
 * The notes, in the shape this repository publishes.
 *
 * Two things they deliberately do not do: they do not claim a gate outcome (the
 * build has not happened yet at release time), and they do not describe a change
 * whose PR body said nothing — an absent `Release:` line is reported as absent,
 * because a sentence this workflow made up would read as the merger's.
 */
export function renderNotes({
	version,
	previousTag,
	repository,
	landings = [],
	bump = null,
	breaking = [],
	unlistedTypes = [],
	unclassified = [],
	forcedBump = null,
	windowBase = null,
}) {
	const lines = [];
	lines.push(
		"> Generated by `.github/workflows/auto-release.yml` from the commits in",
		`> \`${previousTag ?? windowBase ?? "(none)"}..v${version}\`. Nothing here is hand-written: the headings`,
		`> are rendered from the merge commits and from each PR's own body, and no`,
		"> sentence is composed by the workflow. A human may edit this body afterwards;",
		"> nothing re-renders it.",
		"",
		"## What's new",
		"",
	);
	const prs = landings.filter((landing) => landing.number !== null);
	if (prs.length === 0) {
		lines.push("No pull requests are recorded in this range.", "");
	}
	for (const landing of prs) {
		lines.push(
			`- **#${landing.number}** ${landing.title ?? landing.subject} — merge \`${landing.sha}\``,
		);
		lines.push(
			landing.releaseLine
				? `  - \`${landing.releaseLine}\``
				: "  - This PR's body carries no `Release:` line, so it contributes no impact sentence to these notes.",
		);
	}
	const direct = landings.filter((landing) => landing.number === null);
	if (direct.length > 0) {
		lines.push("", "Commits that landed on `main` without a pull request:", "");
		for (const landing of direct)
			lines.push(`- \`${landing.sha.slice(0, 10)}\` ${landing.subject}`);
	}
	lines.push("", "## Impact", "");
	if (breaking.length > 0) {
		lines.push("- **Breaking change declared**:");
		for (const subject of breaking) lines.push(`  - \`${subject}\``);
	} else {
		lines.push(
			"- No commit in this range declares a breaking change (no `!:` subject and no `BREAKING CHANGE:` footer).",
		);
	}
	lines.push(
		`- Derived bump: **${forcedBump ?? bump ?? "unknown"}**, from \`${windowBase ?? previousTag ?? "(none)"}\` to \`v${version}\`.`,
	);
	if (forcedBump)
		lines.push(
			`  - The bump was **forced to \`${forcedBump}\` by the dispatch**, not read from the commit types.`,
		);
	lines.push("", "## PRs in this release", "");
	if (prs.length === 0 && direct.length === 0) lines.push("- (none)");
	for (const landing of prs)
		lines.push(
			`- **#${landing.number}** \`${landing.title ?? landing.subject}\` — merge \`${landing.sha}\``,
		);
	for (const landing of direct)
		lines.push(
			`- \`${landing.sha.slice(0, 10)}\` ${landing.subject} (no pull request)`,
		);
	lines.push(
		"",
		`**Full Changelog**: https://github.com/${repository}/compare/${previousTag ?? windowBase}...v${version}`,
		"",
		"## Notes on the gate",
		"",
		"Nothing has been built when this body is written. The Release is created as a",
		"pre-release; `publish.yml` then builds and signs the installers and promotes the",
		"Release to `latest` **only if the artifact gate passes**",
		"(`pnpm verify-macos-artifacts` and `check-packaged-closure.mjs`). **No gate outcome",
		"is claimed here** — the verdict for this version is the `Build and Publish` run for",
		"this tag, and a release that fails the gate stays out of `latest` with no assets.",
		"",
	);
	const caveats = [];
	if (unlistedTypes.length > 0) {
		caveats.push(
			"Commits landed under a conventional type this workflow does not classify, and were read as patches:",
			...unlistedTypes.map((entry) => `- \`${entry}\``),
		);
	}
	if (unclassified.length > 0) {
		caveats.push(
			"Landings in this range that no conventional type describes, and which therefore contributed no bump:",
			...unclassified.map((subject) => `- \`${subject}\``),
		);
	}
	if (caveats.length > 0) {
		lines.push(
			"**What this window could not classify, listed rather than guessed:**",
			"",
		);
		lines.push(...caveats, "");
	}
	return lines.join("\n");
}

/** One git-log record format, shared by every read below. */
const FORMAT = `--format=%H${FIELD}%s${FIELD}%P${FIELD}%b${RECORD}`;
const git = (args) =>
	execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** Every commit in the range, merge commits included but not classified: a merge
 * commit's own subject describes a landing, and its content is in the range
 * already, so classifying it would double-count nothing but would add a
 * meaningless "no conventional type" entry for every landing. */
export function readCommits(base, ref) {
	return parseLog(git(["log", "--no-merges", FORMAT, `${base}..${ref}`])).map(
		(commit) => ({
			sha: commit.sha,
			subject: commit.subject,
			body: commit.body,
		}),
	);
}

/** The first-parent landings of the range, each with the class its own commits
 * give it: the notes list the window this way, and a landing that releases
 * nothing is named rather than omitted. */
export function readLandings(base, ref) {
	return parseLog(
		git(["log", "--first-parent", FORMAT, `${base}..${ref}`]),
	).map((landing) => {
		const own = MERGE_SUBJECT.test(landing.subject)
			? parseLog(
					git([
						"log",
						"--no-merges",
						FORMAT,
						`${landing.sha}^1..${landing.sha}^2`,
					]),
				)
			: [landing];
		const verdict = classifyCommits(own);
		return {
			sha: landing.sha,
			subject: landing.subject,
			bump: verdict.bump,
			// A landing whose commits carry no conventional type at all is the one
			// the notes must name: it is a change that no type describes, which is
			// different from a `docs:` landing that is described and releases
			// nothing (that one is classified, and silently correct).
			conventional: verdict.conventional,
			commits: own.length,
		};
	});
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
	const forcedBump = arg("--force-bump");
	/** The two anchors (see `release-baseline.mjs`). `--base` and `--version-base`
	 * exist so a reviewer can reproduce a past window — "what would this have
	 * derived for the release that shipped v0.24.0?" — and so the release job can
	 * re-derive against the anchors the dry run printed instead of resolving them
	 * a second time against a repository that has moved since. */
	const anchors = () => {
		const releases = fetchReleases(repository);
		const window = selectWindowAnchor(releases, { exclude: arg("--exclude") });
		const version = selectVersionAnchor(releases, {
			exclude: arg("--exclude"),
		});
		return {
			windowBase: arg("--base") ?? window?.tag ?? version?.tag ?? null,
			versionBase:
				arg("--version-base") ?? (version ? tagVersion(version.tag) : null),
			// An explicit anchor is a deliberate replay of a past window, so the
			// check below cannot apply to it; it is about the repository's current
			// state, not about the window being reproduced.
			resolved: !arg("--base") && !arg("--version-base"),
		};
	};
	try {
		if (forcedBump && !(forcedBump in RANK) && forcedBump !== "major")
			throw new DerivationError(
				`--force-bump must be minor, patch or major: ${forcedBump}`,
			);
		const { windowBase, versionBase, resolved } = anchors();
		if (!windowBase || !versionBase)
			throw new DerivationError(
				"No released tag found to derive a version from",
			);
		if (resolved) {
			// The version surface the release is about to be cut against, checked
			// here because the check has to happen before a version is derived from
			// it, not after it has been committed.
			assertVersionSurface({
				packageVersion: JSON.parse(
					readFileSync(arg("--package") ?? "package.json", "utf8"),
				).version,
				versionBase,
			});
		}
		const commits = readCommits(windowBase, ref);
		const landings = readLandings(windowBase, ref).map((landing) =>
			describeLanding(landing, (number) => lookupPr(repository, number)),
		);
		const result = deriveRelease({
			windowBase,
			versionBase,
			commits,
			landings,
			forcedBump,
		});
		result.windowBase = windowBase;
		result.versionBase = versionBase;
		// `--json` is a machine contract: stdout is one JSON document and nothing
		// else. The workflow redirects stdout straight into a file and parses it, so
		// a friendly human line ahead of the object is a parse error there.
		const asJson = process.argv.includes("--json");
		if (!result.release) {
			if (asJson) {
				console.log(JSON.stringify(result, null, 2));
				return;
			}
			console.log(`No release: ${result.reason}`);
			if (result.unclassified.length > 0)
				console.log(
					`Landings with no conventional type: ${result.unclassified.join(" | ")}`,
				);
			return;
		}
		result.notes = renderNotes({
			version: result.version,
			previousTag: windowBase,
			windowBase,
			bump: result.bump,
			repository,
			landings,
			breaking: result.breaking,
			unlistedTypes: result.unlistedTypes,
			unclassified: result.unclassified,
			forcedBump: result.forced,
		});
		result.windowBase = windowBase;
		result.versionBase = versionBase;
		const notesFile = arg("--notes-file");
		if (notesFile) writeFileSync(notesFile, `${result.notes}\n`);
		if (asJson) console.log(JSON.stringify(result, null, 2));
		else {
			console.log(
				`Release: ${result.bump} -> v${result.version} (${result.reason})`,
			);
			console.log(
				`Window: ${windowBase}..${ref}, ${landings.length} landing(s)`,
			);
			console.log("");
			console.log(result.notes);
		}
	} catch (error) {
		// Loud, and never a silent no-release: an error here means the run could
		// not answer the question, which is not the same answer as "nothing to
		// release" and must not be reported as one.
		console.error(
			error instanceof DerivationError
				? `Release derivation refused: ${error.message}`
				: `Release derivation failed: ${error.stack ?? error.message}`,
		);
		process.exit(1);
	}
}

/** The PR metadata the notes quote. One call per PR, cached for the run. */
const prCache = new Map();
function lookupPr(repository, number) {
	if (prCache.has(number)) return prCache.get(number);
	let value = null;
	try {
		value = JSON.parse(
			execFileSync("gh", ["api", `repos/${repository}/pulls/${number}`], {
				encoding: "utf8",
				maxBuffer: 8 * 1024 * 1024,
			}),
		);
	} catch (error) {
		// A missing PR is a note-shaped gap, not a reason to publish a version
		// nobody derived: the notes say the body was unreadable rather than
		// dropping the PR from the record.
		console.error(`Could not read PR #${number}: ${error.message}`);
	}
	prCache.set(number, value);
	return value;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main();
}
