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
 * exactly while it is asset-complete. `open` holds a release back until its
 * installers and update metadata exist; `finalize` promotes it the moment they
 * do, and refuses if they are missing. A build that fails therefore leaves a
 * release that is never offered -- where the old flow left an empty release as
 * latest indefinitely, so a broken build silently suppressed every update
 * rather than only the one it failed to produce.
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
import { PLATFORM_INSTALLERS, listAssets } from "./upload-release.mjs";
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
 * The update metadata electron-updater fetches before it can offer anything.
 * Mirrors the `dist/latest*.yml` artifact glob the build jobs are required to
 * produce (upload-artifact fails a platform that emits none), so this asserts
 * the same files that glob promises rather than a second, drifting list.
 */
const UPDATE_METADATA_RE = /^latest.*\.yml$/;

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
	}
	if (!names.some((name) => UPDATE_METADATA_RE.test(name)))
		missing.push("latest*.yml update metadata");
	return missing;
}

/**
 * Move one release into or out of the pre-release state, by ID.
 *
 * Both flags are sent explicitly, as typed booleans (`-F`, not `-f`, which
 * would serialize the string "false"):
 *
 * - `make_latest: false` on a hold spells out that the release must not be the
 *   one `/releases/latest` answers with; a pre-release cannot be latest, so
 *   this only makes the intent explicit rather than relying on that rule.
 * - `make_latest: true` on a promote does the same in the other direction. It
 *   is not left to the endpoint's default, which is documented for *newly
 *   published* releases and would otherwise leave the outcome of an edit to an
 *   already-published release to be confirmed on the first real run.
 */
function setReleaseState(repo, token, releaseId, { prerelease }) {
	try {
		execFileSync(
			"gh",
			[
				"api",
				"--method",
				"PATCH",
				`repos/${repo}/releases/${releaseId}`,
				"-F",
				`prerelease=${prerelease}`,
				"-F",
				`make_latest=${!prerelease}`,
			],
			{
				env: { ...process.env, GH_TOKEN: token },
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
	} catch {
		// No subprocess output: it can carry authentication details.
		throw new ValidationError(
			`Release state PATCH failed for release ${releaseId}`,
		);
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
				setReleaseState(repo, token, releaseId, { prerelease }),
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
