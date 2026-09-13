#!/usr/bin/env node
/**
 * Hold a release back while it is being built, and promote it once it can be
 * offered.
 *
 * Why the window exists: electron-updater resolves its feed from GitHub's
 * `/releases/latest`, which answers with the newest non-prerelease, non-draft
 * release whether or not that release has assets. This pipeline is triggered by
 * the release being published and builds the installers after that, so for the
 * whole 25-35 minute build the feed points at a release with no `latest*.yml`,
 * the metadata request 404s, and every running app folds that into "no updates
 * available" -- users are told they are up to date while a newer version is
 * already published. v0.17.2 and v0.19.1/v0.19.2 all shipped that way; the
 * v0.17.2 release had to be marked a pre-release by hand for exactly this
 * reason. Marking a release a pre-release takes it out of `/releases/latest`,
 * so the previous, asset-complete release keeps answering until this one can.
 *
 * The invariant both directions enforce: a release is advertised as latest
 * exactly while it is asset-complete and it is the newest release eligible for
 * `/releases/latest`. `open` holds a release back until its installers and
 * update metadata exist; `finalize` promotes it the moment they do, and refuses
 * if they are missing -- or if a newer release is already eligible there. That
 * second refusal is reachable through a documented operator action: `gh run
 * rerun` replays an older release event's original payload, so without the
 * check the old tag would be attached to and promoted, and `latest` would move
 * backwards, silently denying users the newer release that was already
 * published. A build that fails therefore leaves a release that is never
 * offered -- where the old flow left an empty release as latest indefinitely,
 * so a broken build silently suppressed every update rather than only the one
 * it failed to produce.
 *
 * Event scoping. Every mutation refuses when IS_MANUAL_DISPATCH is set: a
 * manual dispatch is the repair path for an old tag, and a repair must not
 * touch release metadata (see the notes on attach-to-release in publish.yml).
 * Promoting a tag because somebody re-ran its pipeline is the class of edit the
 * pins exist to prevent, and it could re-point `latest` at a release nobody
 * validated for that purpose. Both mutations are pinned twice -- to the release
 * ID validate-release read from this event's own tag, and to the full source
 * SHA that tag must resolve to -- so they can only edit the release they were
 * triggered for.
 *
 * The flip does not re-trigger this workflow. publish.yml subscribes to
 * `release: published`, which fires when a release or pre-release is published;
 * a pre-release flag edit surfaces as `edited` and a pre-release converted into
 * a release as `released`, and neither is in `on:`.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
	PLATFORM_INSTALLERS,
	PLATFORM_UPDATE_METADATA,
	listAssets,
} from "./upload-release.mjs";
import {
	ValidationError,
	createApi,
	validateInputs,
	validateRelease,
} from "./validate-release.mjs";

/**
 * Only a plain X.Y.Z tag is a release this workflow may promote. A tag with a
 * pre-release suffix (v1.2.3-rc.1) is published through this same pipeline on
 * purpose (validate-release documents that), and promoting it would put a
 * pre-release into `/releases/latest` -- the opposite of what its author asked
 * for. Such a tag keeps whatever pre-release state it was published with.
 */
const STABLE_TAG_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** The two pins upload-release also requires, named as validate-release names its own. */
const SOURCE_SHA_RE = /^[0-9a-f]{40}$/;
const RELEASE_ID_RE = /^[1-9]\d*$/;

/**
 * Why a release may not be offered yet, as a list of missing pieces.
 *
 * An asset in any state other than `uploaded` is an interrupted upload: it is
 * listed on the release but its bytes are not there, and the updater's fetch of
 * it would fail exactly like the 404 this window exists to prevent. Counting it
 * as present would be "we could not find out" answered as "yes".
 */
function missingAssets(assets) {
	const names = assets
		.filter((asset) => asset.state === "uploaded")
		.map((asset) => asset.name);
	const missing = [];
	for (const [platform, installer] of Object.entries(PLATFORM_INSTALLERS)) {
		if (!names.some((name) => installer.test(name)))
			missing.push(`${platform} installer`);
		// The channel file is required by name, per platform, rather than as one
		// `latest*.yml` match for the whole release. electron-updater fetches only
		// its own platform's file, and `upload-artifact`'s `if-no-files-found`
		// fails a build job only when the whole glob matched nothing -- so the
		// looser check would promote a release whose Windows job emitted an .exe
		// and no latest.yml on the strength of the macOS metadata, and Windows
		// users would get the 404 this gate exists to prevent.
		if (!names.includes(PLATFORM_UPDATE_METADATA[platform]))
			missing.push(`${platform} update metadata`);
	}
	return missing;
}

/**
 * How many releases are read when deciding whether this one is still the newest
 * candidate for `/releases/latest`. The endpoint pages at 100, and the loop
 * below follows that pagination rather than trusting the first page.
 */
const RELEASES_PER_PAGE = 100;

/**
 * Every release the repository has, read the way every other reader here pages.
 */
function listReleases(api) {
	const releases = [];
	for (let page = 1; ; page++) {
		const batch = api(`/releases?per_page=${RELEASES_PER_PAGE}&page=${page}`);
		releases.push(...batch);
		if (batch.length < RELEASES_PER_PAGE) break;
	}
	return releases;
}

/**
 * A release `/releases/latest` would answer with instead of this one, or null
 * when this one is the newest eligible release.
 *
 * One list read decides it. The endpoint answers with "the most recent
 * non-prerelease, non-draft release, sorted by the created_at attribute" (GitHub
 * REST API docs), so eligibility is that subset; this release is kept in it even
 * while the window holds it as a pre-release, because that flag is the only
 * thing excluding it and the promote is about to flip it. Recency is compared on
 * `created_at`, the attribute the endpoint itself sorts by, rather than on
 * semantic version: a release published later genuinely is the one the endpoint
 * answers with even when its version is lower, and a version comparison here
 * would disagree with the feed this check protects. Equal timestamps refuse as
 * well -- two releases created in the same second cannot be ordered from this
 * data, and "we could not tell which is newest" is answered as "we cannot
 * promote", the same way an interrupted upload is.
 */
function newerLatestCandidate(api, candidate) {
	const createdAt = (release) =>
		Date.parse(release.created_at || release.published_at || "");
	const releases = listReleases(api);
	const mine = releases.find(
		(release) => String(release.id) === String(candidate.release_id),
	);
	if (!mine)
		throw new ValidationError(
			`Release ${candidate.release_tag} (id ${candidate.release_id}) is not in the release list; refusing to promote a release the feed cannot see`,
		);
	const mineAt = createdAt(mine);
	if (Number.isNaN(mineAt))
		throw new ValidationError(
			`Release ${candidate.release_tag} (id ${candidate.release_id}) has no readable creation time; refusing to promote without it`,
		);
	const eligible = releases.filter(
		(release) =>
			release.draft === false &&
			(release.prerelease === false ||
				String(release.id) === String(candidate.release_id)),
	);
	let newest = null;
	for (const release of eligible) {
		if (String(release.id) === String(candidate.release_id)) continue;
		if (Number.isNaN(createdAt(release)))
			throw new ValidationError(
				`Release ${release.tag_name} (id ${release.id}) has no readable creation time; refusing to promote ${candidate.release_tag} because the newest release cannot be determined`,
			);
		if (!newest || createdAt(release) > createdAt(newest)) newest = release;
	}
	return newest && createdAt(newest) >= mineAt ? newest : null;
}

/**
 * The command an operator runs when the pipeline cannot flip the flag itself.
 *
 * `--latest` belongs to the close: `gh release edit` sends `make_latest` only
 * when that flag is passed, so a release closed without it can end up complete
 * and unadvertised -- silently no offer, which is the defect class this window
 * exists to remove. Holding needs no such flag: a pre-release is out of
 * `/releases/latest` by definition.
 */
function manualRepair(tag, prerelease) {
	return prerelease
		? `gh release edit ${tag} --prerelease=true`
		: `gh release edit ${tag} --prerelease=false --latest`;
}

/**
 * How many times the state PATCH is attempted, and the pause between attempts.
 *
 * The call sets a fixed state on a release identified by its pinned ID, so a
 * repeat is idempotent; what the retry absorbs is a transient 5xx or
 * secondary-rate-limit response, which would otherwise fail a whole release in
 * seconds for no reason. A persistent failure still fails the run, deliberately:
 * see the note on `open-release-window` in publish.yml.
 */
const PATCH_ATTEMPTS = 3;
const PATCH_RETRY_MS = 1000;

/** Sync pause: this CLI runs before any build starts, so nothing else is waiting. */
function pause(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Move one release into or out of the pre-release state, by ID.
 *
 * Each field goes out in the form its REST schema declares:
 *
 * - `prerelease` is a boolean, so it is sent as a typed boolean (`-F`).
 * - `make_latest` is a *string* enum (`true`, `false`, `legacy`), not a boolean,
 *   so it is sent with `-f` as the documented string. A typed boolean there is a
 *   body shape the schema does not declare, and a 422 on it fails this call
 *   before any build starts, which costs the release every one of its assets.
 * - The hold sends `prerelease` alone. "Drafts and prereleases cannot be set as
 *   latest" (same docs), so the flag alone takes the release out of the feed;
 *   spelling out `make_latest=false` would add a value the server derives, and
 *   that `false` would outlive the hold on a release later closed by hand.
 * - The promote states `make_latest=true` rather than leaving the outcome of an
 *   edit to an already-published release to the endpoint default, which the docs
 *   give for *newly published* releases.
 */
function setReleaseState(repo, token, releaseId, { prerelease, tag }) {
	const args = [
		"api",
		"--method",
		"PATCH",
		`repos/${repo}/releases/${releaseId}`,
		"-F",
		`prerelease=${prerelease}`,
	];
	if (!prerelease) args.push("-f", "make_latest=true");
	for (let attempt = 1; attempt <= PATCH_ATTEMPTS; attempt++) {
		try {
			execFileSync("gh", args, {
				env: { ...process.env, GH_TOKEN: token },
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			});
			return;
		} catch {
			// No subprocess output: it can carry authentication details. The manual
			// repair names the state this call asked for, so the line tells the
			// operator how to finish the flip the pipeline could not make -- a window
			// that cannot be flipped leaves the release unoffered until somebody
			// closes it.
			if (attempt === PATCH_ATTEMPTS)
				throw new ValidationError(
					`Release state PATCH failed for release ${releaseId} (${tag}) after ${attempt} attempts; close the window by hand with: ${manualRepair(tag, prerelease)}`,
				);
			pause(PATCH_RETRY_MS);
		}
	}
}

function pinnedRelease(api, tag, expectedSha, expectedReleaseId) {
	// The same pins upload-release enforces, for the same reason: both must
	// survive the build, on release events as well as repairs.
	if (!SOURCE_SHA_RE.test(expectedSha || ""))
		throw new ValidationError("EXPECTED_SOURCE_SHA required for release state");
	if (!RELEASE_ID_RE.test(String(expectedReleaseId || "")))
		throw new ValidationError("EXPECTED_RELEASE_ID required for release state");
	const release = validateRelease(
		api,
		tag,
		expectedSha,
		false,
		expectedReleaseId,
	);
	// validateRelease re-reads the release and the tag from the API, so a tag
	// that moved or a release that was deleted and recreated since
	// validate-release ran is caught here rather than edited.
	return {
		release,
		missing: missingAssets(listAssets(api, release.release_id)),
	};
}

/**
 * Close the window: take a release that cannot be offered yet out of
 * `/releases/latest`.
 *
 * No-op when the release already carries its assets -- a complete release is
 * never hidden, which is what makes a duplicate or re-run event harmless -- and
 * no-op when it is already a pre-release.
 *
 * There is deliberately no recency gate here, unlike the promote: holding back a
 * release that is not the newest can only remove an offer that could not be
 * served anyway (a pre-release is out of `/releases/latest` regardless), whereas
 * promoting has to prove this release is the one the feed should move to.
 */
export function openReleaseWindow({
	api,
	tag,
	expectedSha,
	expectedReleaseId,
	isManual,
	setFlag,
}) {
	if (isManual) {
		console.log(
			"Manual dispatch: release state is not mutated by a repair; leaving the release as it is.",
		);
		return { action: "skipped", reason: "manual dispatch" };
	}
	const { release, missing } = pinnedRelease(
		api,
		tag,
		expectedSha,
		expectedReleaseId,
	);
	if (!missing.length) {
		console.log(
			`Release ${tag} (id ${release.release_id}) already carries every installer and its update metadata; not holding it back.`,
		);
		return { action: "skipped", reason: "release is already asset-complete" };
	}
	if (release.prerelease) {
		console.log(
			`Release ${tag} (id ${release.release_id}) is already a pre-release; still building (${missing.join(", ")}).`,
		);
		return { action: "skipped", reason: "already a pre-release" };
	}
	setFlag(release.release_id, { prerelease: true });
	console.log(
		`Release ${tag} (id ${release.release_id}) held as a pre-release until it is asset-complete; missing: ${missing.join(", ")}.`,
	);
	return { action: "held", release_id: release.release_id, missing };
}

/**
 * Open the window: promote a release once its assets are attached.
 *
 * The asset check is the point of the whole exercise, so it is a hard
 * requirement here rather than an assumption inherited from attach-to-release:
 * promoting a release whose installers or `latest*.yml` are missing is exactly
 * the state that produced the 404 users were told was "no update available".
 *
 * Promotion also has to be the direction the feed moves: this release must be
 * the newest one eligible for `/releases/latest`, or a re-run of an older
 * release would re-point the feed at an old tag and stop offering users the
 * newer release.
 */
export function finalizeRelease({
	api,
	tag,
	expectedSha,
	expectedReleaseId,
	isManual,
	setFlag,
}) {
	if (isManual) {
		console.log(
			"Manual dispatch: release state is not mutated by a repair; leaving the release as it is.",
		);
		return { action: "skipped", reason: "manual dispatch" };
	}
	if (!STABLE_TAG_RE.test(tag)) {
		console.log(
			`Tag ${tag} is a pre-release by name; it is not promoted to latest.`,
		);
		return { action: "skipped", reason: "pre-release tag" };
	}
	const { release, missing } = pinnedRelease(
		api,
		tag,
		expectedSha,
		expectedReleaseId,
	);
	if (!release.prerelease) {
		console.log(
			`Release ${tag} (id ${release.release_id}) is already a full release; nothing to promote.`,
		);
		return { action: "skipped", reason: "already a full release" };
	}
	// Recency is asked before completeness because it scopes the whole promote: a
	// re-run of an older release must never move `latest` backwards, and reporting
	// it as a missing-asset problem would send an operator to rebuild a release
	// that must not be promoted at all.
	const newer = newerLatestCandidate(api, release);
	if (newer) {
		console.log(
			`Release ${tag} (id ${release.release_id}) is not the newest release eligible for /releases/latest; ${newer.tag_name} (id ${newer.id}) is. Leaving ${tag} a pre-release.`,
		);
		return { action: "skipped", reason: "not the newest release" };
	}
	if (missing.length)
		throw new ValidationError(
			`Refusing to promote ${tag}: missing ${missing.join(", ")}`,
		);
	setFlag(release.release_id, { prerelease: false });
	console.log(
		`Release ${tag} (id ${release.release_id}) promoted to a full release; it now answers /releases/latest.`,
	);
	return { action: "promoted", release_id: release.release_id };
}

const MODES = {
	open: openReleaseWindow,
	finalize: finalizeRelease,
};

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	const mode = process.argv[2];
	try {
		if (!Object.hasOwn(MODES, mode))
			throw new ValidationError(
				`Usage: node scripts/release-state.mjs <open|finalize>, got: ${mode || "(nothing)"}`,
			);
		const {
			RELEASE_TAG: tag,
			EXPECTED_SOURCE_SHA: expectedSha,
			EXPECTED_RELEASE_ID: expectedReleaseId,
		} = process.env;
		const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
		const repo = process.env.GITHUB_REPOSITORY;
		validateInputs(tag, expectedSha, true, token);
		if (!repo) throw new ValidationError("GITHUB_REPOSITORY required");
		MODES[mode]({
			api: createApi(repo, token),
			tag,
			expectedSha,
			expectedReleaseId,
			// Anything but an explicit "false" is treated as a repair and refuses to
			// mutate, so a missing or mistyped variable can only ever hold the
			// mutation back, never authorize one.
			isManual: process.env.IS_MANUAL_DISPATCH !== "false",
			setFlag: (releaseId, { prerelease }) =>
				setReleaseState(repo, token, releaseId, { prerelease, tag }),
		});
	} catch (error) {
		console.error(
			error instanceof ValidationError
				? error.message
				: "Release state change failed; inspect the release target",
		);
		process.exitCode = 1;
	}
}

export { missingAssets, STABLE_TAG_RE, setReleaseState };
