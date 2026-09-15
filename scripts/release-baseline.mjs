#!/usr/bin/env node
/**
 * Which released tag a release is measured against.
 *
 * TWO ANCHORS, and the distinction is the whole point of this module:
 *
 *  - the **version anchor** is the newest released tag of any kind. The next
 *    version is derived from it so a number is never reused: a published version
 *    cannot be re-published, so a version that went backwards would consume a
 *    number that has already been used and has to be skipped by the next release.
 *    It is ALSO what bounds the commit range a release describes (`derive-release.mjs`
 *    takes both bases from it), because the range that has not been released yet
 *    starts after the newest tag — a release this workflow creates stays a
 *    pre-release for the 25-50 minutes its pipeline takes, and anchoring the range
 *    at the newest *non*-pre-release would leave the release-in-flight's own
 *    commits inside it for that whole window.
 *  - the **incumbent anchor** is the newest release a user could actually be
 *    running: published, not a pre-release, and carrying the architecture-matched
 *    archive its feed needs. It is the release a signed update upgrades FROM, and
 *    the only question it answers is that one (`release-candidate.mjs`). It is
 *    deliberately NOT the bound on a derivation range: it lags by one release for
 *    the length of every publish.
 *
 * They are normally the same tag. They differ in exactly the cases worth being
 * explicit about, and both were observed in this repository on 2026-09-15:
 * `v0.23.2` was tagged and held out of `/releases/latest` with **zero** assets
 * after its publish failed the artifact gate, so no user ever had it and it must
 * not bound the next window; and a release that reaches `latest` without its
 * `latest*.yml` is a release whose feed 404s, which is a release no incumbent
 * should be taken from either.
 *
 * WHY ASSETS ARE PART OF "RELEASED". `electron-updater` resolves its feed from
 * `/releases/latest`, which answers with the newest non-pre-release Release
 * whether or not it has assets — so a Release can be advertised to every running
 * app and still have nothing to download. A tag alone is therefore not evidence
 * that a version was ever reachable by a user.
 */
import { execFileSync } from "node:child_process";
import { isEntryPoint } from "./entry-point.mjs";

/** A release tag this repository publishes: `v<major>.<minor>.<patch>`. */
const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;
/** The archive `electron-updater` downloads for a given architecture. */
const ARCHIVE_RE = /-(arm64|x64)\.zip$/;

/** Thrown for anything that must fail the run rather than be guessed around. */
export class BaselineError extends Error {}

/** The version of a `vX.Y.Z` tag, or null for anything else (including the
 * pre-release spellings `validate-release.mjs` also accepts: no tag of that
 * shape is a baseline here, because none of them is the plain tag this repo
 * publishes). */
export function tagVersion(tag) {
	const match = TAG_RE.exec(tag ?? "");
	return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

/** Numeric comparison of two `X.Y.Z` versions. Never lexicographic: `0.9.10`
 * sorts above `0.9.2`, which a string compare gets backwards. */
export function compareVersions(a, b) {
	const left = tagVersion(`v${a}`) ?? a;
	const right = tagVersion(`v${b}`) ?? b;
	const [la, lb, lc] = left.split(".").map(Number);
	const [ra, rb, rc] = right.split(".").map(Number);
	return la - ra || lb - rb || lc - rc;
}

/** The newest version among `releases`, whose tag is returned with it. */
function newest(releases) {
	return releases.reduce(
		(best, release) =>
			!best || compareVersions(release.version, best.version) > 0
				? release
				: best,
		null,
	);
}

/** A release's assets, normalised to names only: nothing downstream needs more. */
function assetNames(release) {
	return (release.assets ?? []).map((asset) => asset.name ?? "");
}

/** Releases the API reported, reduced to the fields the selectors ask about. */
export function normaliseReleases(releases) {
	return (releases ?? [])
		.filter((release) => release && !release.draft)
		.map((release) => ({
			tag: release.tag_name ?? "",
			version: tagVersion(release.tag_name),
			prerelease: Boolean(release.prerelease),
			published: Boolean(release.published_at),
			assets: assetNames(release),
		}))
		.filter((release) => release.version !== null && release.published);
}

/**
 * The newest release a user could be running (the *incumbent*), or null when
 * there is none.
 *
 * `below` bounds the search under a candidate version so that a repair of an old
 * Release derives the incumbent *that* release's users upgrade from, rather than
 * the newest release in the repository. `exclude` names the candidate tag, which
 * is the same exclusion when the candidate is the newest release (the normal
 * case at publish time, because the candidate has just been published).
 *
 * It answers "what could a machine have been running", and that is the only
 * question it may be asked: a caller that wants "what has not been released yet"
 * wants `selectVersionAnchor` (see the module note above).
 */
export function selectIncumbentAnchor(
	releases,
	{ below = null, exclude = null } = {},
) {
	const candidates = normaliseReleases(releases).filter(
		(release) =>
			!release.prerelease &&
			release.tag !== exclude &&
			(below === null || compareVersions(release.version, below) < 0) &&
			release.assets.some((name) => ARCHIVE_RE.test(name)),
	);
	return newest(candidates);
}

/** The newest released tag of any kind: the version anchor, which only exists to
 * keep the next number above every number already spent. */
export function selectVersionAnchor(releases, { exclude = null } = {}) {
	const candidates = normaliseReleases(releases).filter(
		(release) => release.tag !== exclude,
	);
	return newest(candidates);
}

/** One page of releases, newest first. A page that comes back short is the end:
 * the API has no "last page" header through `gh api`. */
function releasePage(repository, page) {
	const out = execFileSync(
		"gh",
		[
			"api",
			`repos/${repository}/releases?per_page=100&page=${page}`,
			"--paginate=false",
		],
		{ encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
	);
	return JSON.parse(out);
}

/** Every release in the repository, newest first, stopped by a short page. This
 * repository has ~100 of them and each carries a body and an asset list, so the
 * walk is bounded rather than unbounded. */
export function fetchReleases(repository, { maxPages = 10 } = {}) {
	const all = [];
	for (let page = 1; page <= maxPages; page += 1) {
		const batch = releasePage(repository, page);
		all.push(...batch);
		if (batch.length < 100) break;
	}
	return all;
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
	try {
		const releases = fetchReleases(repository);
		const result = {
			incumbent: selectIncumbentAnchor(releases, {
				below: arg("--below"),
				exclude: arg("--exclude"),
			}),
			version: selectVersionAnchor(releases, { exclude: arg("--exclude") }),
		};
		const wanted = arg("--which") ?? "incumbent";
		const selected = wanted === "version" ? result.version : result.incumbent;
		if (!selected) {
			// Loud, and naming the question that failed: "no baseline" is a
			// different fact from "the API returned nothing useful", and the
			// caller decides what to do about each.
			throw new BaselineError(
				`No released ${wanted} anchor found among ${releases.length} release(s) in ${repository}`,
			);
		}
		if (process.argv.includes("--json")) {
			console.log(JSON.stringify({ ...result, selected }, null, 2));
		} else {
			console.log(`${wanted}: ${selected.tag} (${selected.version})`);
		}
	} catch (error) {
		console.error(
			error instanceof BaselineError
				? error.message
				: `Release lookup failed: ${error.message}`,
		);
		process.exit(1);
	}
}

if (isEntryPoint(import.meta.url)) {
	main();
}
