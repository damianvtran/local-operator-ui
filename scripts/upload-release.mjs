#!/usr/bin/env node
/**
 * Repair assets on a pinned, already-published release. Never create a release,
 * replace a COMPLETE asset, change release metadata, or resolve an upload target
 * by tag.
 *
 * WHAT A NAME ALREADY ATTACHED TO THIS RELEASE MEANS, one case at a time. GitHub
 * refuses a duplicate asset name, and the upload endpoint creates the asset record
 * when an upload STARTS (`state: "starter"`) rather than when it finishes. Those two
 * facts together are what stopped every release after v0.26.5 published on
 * 2026-09-16: a POST of the 158 MB arm64 dmg stalled, the record it had already
 * created stayed behind in the `starter` state, and every later attempt -- a re-run
 * of the job, a repair dispatch from another session -- was refused over the name
 * that wreckage held, so a release could not be repaired without hand-surgery on the
 * API. The rule set below keeps the invariant that matters (a good asset is never
 * replaced) and drops the one that cost three releases (a partially-attached release
 * is repairable by re-running the job):
 *
 *   - name absent                              -> upload;
 *   - name present, `state: "starter"`         -> DELETE it, then upload: that record
 *     is the wreckage of an upload that never finished, not an asset anybody can
 *     download;
 *   - name present, complete, same size as ours -> skip it: the asset is already
 *     attached, which is also how a retry whose response was lost settles on success
 *     instead of duplicating the file;
 *   - name present, complete, different size   -> refuse, naming both sizes: that is
 *     a genuine collision with something else's asset, and replacing it is how a
 *     signed installer would start silently disagreeing with the update metadata
 *     that names its hash.
 *
 * HOW IT UPLOADS. Each artifact is streamed from disk -- never buffered, since the
 * mac dmg alone is 158 MB -- with an explicit per-attempt timeout and a bounded
 * number of backoff retries when an attempt fails transiently (timeout, reset
 * connection, 5xx). The stall that broke v0.26.5 held the job open until the runner's
 * own limit precisely because the old `execFileSync` call had no timeout and nothing
 * retried it.
 *
 * EVERY FAILURE SAYS WHAT ACTUALLY HAPPENED. The HTTP status and the endpoint's own
 * message are reported for the file that failed, and the word "collision" is used
 * only where the reconciliation above really found one. The old catch-all reported
 * every failure as "existing assets were not replaced", which names a name conflict
 * even when the cause was a stall -- and sent a reader hunting for an asset to delete
 * while the real fault was an upload that never finished.
 *
 * GITHUB_UPLOADS_URL overrides the upload host. GitHub Enterprise Server serves asset
 * uploads from its own host rather than uploads.github.com, and the attach path's
 * tests point it at a stub server, because this path cannot otherwise be exercised
 * without cutting a real release.
 */
import { execFileSync } from "node:child_process";
import { createReadStream, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { isEntryPoint } from "./entry-point.mjs";
import {
	ValidationError,
	createApi,
	validateInputs,
	validateRelease,
} from "./validate-release.mjs";

// One installer class per platform, and the only definition of "this platform
// shipped something installable". The upload gate below and the release-window
// finalizer in release-state.mjs both assert against it, so a platform added to
// the build matrix cannot satisfy one check and silently miss the other.
const PLATFORM_INSTALLERS = {
	macos: /\.(dmg|zip)$/,
	windows: /\.(exe|msi)$/,
	linux: /\.(deb|AppImage|rpm)$/,
};

// The channel file electron-builder writes beside each platform's installer, and
// the file electron-updater fetches before it can offer anything: latest-mac.yml,
// latest.yml and latest-linux.yml, each promised to its own build job by that
// job's `dist/latest*.yml` artifact glob. Named per platform and declared beside
// PLATFORM_INSTALLERS for the same reason: a platform that ships an installer
// without its channel file leaves that platform's users with a 404 the moment the
// release is advertised, so the release-window checks in release-state.mjs must be
// able to name the platform that is short instead of accepting one platform's
// metadata as proof for all three.
const PLATFORM_UPDATE_METADATA = {
	macos: "latest-mac.yml",
	windows: "latest.yml",
	linux: "latest-linux.yml",
};

// Where release assets are POSTed. Not the API host: reads and deletes go through
// `gh api`, which talks to api.github.com (or the GHES host it is configured for),
// while an asset upload goes to uploads.github.com. Overridable for the reason in
// the header -- GHES, and the tests' stub server.
const DEFAULT_UPLOADS_BASE = "https://uploads.github.com";

/**
 * The two states GitHub reports on a release asset. `uploaded` is a complete asset
 * that anyone can download; `starter` is the record of an upload that began and has
 * not completed, and `scripts/release-state.mjs` already treats it as nothing (its
 * `missingAssets` counts only `uploaded` assets). An asset in any other state is
 * neither: this script refuses it by name rather than guessing whether replacing or
 * skipping it would be safe, because both guesses lose a file.
 */
const ASSET_STATE_UPLOADED = "uploaded";
const ASSET_STATE_STARTER = "starter";

// The per-attempt ceiling, the retry budget, and the first backoff step (doubled per
// attempt). Generous on purpose: a 158 MB installer over a GitHub-hosted runner is
// minutes of legitimate work, while the pathological case this bound exists for -- an
// accepted connection that never answers -- is indistinguishable from a slow upload
// until something gives up. Three attempts against a 10-minute ceiling bounds a
// healthy upload while turning last night's indefinite hang into a failed step a
// re-run can pick up.
const UPLOAD_ATTEMPT_TIMEOUT_MS = 10 * 60 * 1000;
const UPLOAD_ATTEMPTS = 3;
const UPLOAD_BACKOFF_MS = 5_000;

function artifactFiles(root) {
	return Object.entries(PLATFORM_INSTALLERS).flatMap(
		([platform, installer]) => {
			const dir = join(root, `${platform}-artifacts`);
			const files = readdirSync(dir, { withFileTypes: true });
			if (!files.some((f) => f.isFile() && installer.test(f.name))) {
				throw new ValidationError(`Missing ${platform} installer artifacts`);
			}
			if (files.some((f) => !f.isFile()))
				throw new ValidationError(
					`Unexpected non-file in ${platform} artifacts`,
				);
			return files.map((f) => join(dir, f.name));
		},
	);
}

// The release summary can truncate its assets, so every reader pages the
// ID-addressed list. Upload and the release-state checks must agree on what is
// actually attached, otherwise one of them is reasoning about a partial view.
function listAssets(api, releaseId) {
	const assets = [];
	for (let page = 1; ; page++) {
		const batch = api(
			`/releases/${releaseId}/assets?per_page=100&page=${page}`,
		);
		assets.push(...batch);
		if (batch.length < 100) break;
	}
	return assets;
}

/**
 * What this run should do about `name` on a release that already has `assets`.
 *
 * Returns one of `{action: "upload"}`, `{action: "skip", asset}` or
 * `{action: "replace", assets}`, and throws for the one case that must stop the run:
 * a complete asset of this name at a different size. Pure -- it reads the list it is
 * handed and nothing else -- because both the pre-write check and the per-attempt
 * reconciliation below must reach the same verdict from the same evidence.
 */
function classifyAsset(assets, name, size) {
	const sameName = assets.filter((asset) => asset.name === name);
	const unknown = sameName.filter(
		(asset) =>
			asset.state !== ASSET_STATE_UPLOADED &&
			asset.state !== ASSET_STATE_STARTER,
	);
	const complete = sameName.filter(
		(asset) => asset.state === ASSET_STATE_UPLOADED,
	);
	const incomplete = sameName.filter(
		(asset) => asset.state === ASSET_STATE_STARTER,
	);
	if (unknown.length) {
		throw new ValidationError(
			`Asset ${name} is attached to this release in state ${JSON.stringify(unknown[0].state)}, which this script does not recognise as complete or incomplete; resolve it by hand and re-run`,
		);
	}
	if (complete.length) {
		// A release can only carry one asset per name, so a second complete asset of
		// this name is a state this script has never seen; comparing against the
		// first is the conservative reading of it (refusing when the sizes disagree,
		// and skipping only when the bytes on the release are the bytes we built).
		const attached = complete[0];
		if (Number(attached.size) === size)
			return { action: "skip", asset: attached };
		throw new ValidationError(
			`Asset ${name} is already attached to this release with a different size: attached ${attached.size} bytes, this build's ${size} bytes. Refusing to replace a complete asset; if this build is the one that should ship, delete that asset by hand and re-run`,
		);
	}
	if (incomplete.length) return { action: "replace", assets: incomplete };
	return { action: "upload" };
}

/**
 * The artifacts as reconciliation sees them: the name GitHub addresses them by, the
 * path to stream, and the byte count the size comparison needs. Read with `statSync`
 * rather than from the file's contents, so nothing here loads an installer into
 * memory.
 */
function artifactRecords(files, sizeOf = (file) => statSync(file).size) {
	return files.map((file) => {
		const size = sizeOf(file);
		if (!Number.isSafeInteger(size) || size < 0)
			throw new ValidationError(
				`Could not read a byte size for ${file}; refusing to upload blind`,
			);
		return { path: file, name: basename(file), size };
	});
}

/**
 * Classify every artifact against the release BEFORE any write, so a genuine
 * collision stops the run with nothing uploaded rather than halfway through the
 * artifact set.
 */
function planAssetUploads(api, releaseId, artifacts) {
	if (!artifacts.length) throw new ValidationError("No artifacts to upload");
	const names = artifacts.map((artifact) => artifact.name);
	if (new Set(names).size !== names.length)
		throw new ValidationError("Duplicate artifact filenames across platforms");
	const assets = listAssets(api, releaseId);
	return artifacts.map((artifact) => ({
		artifact,
		verdict: classifyAsset(assets, artifact.name, artifact.size),
	}));
}

/**
 * A failed upload attempt that carries whether trying again can plausibly help.
 *
 * The distinction is the whole point of this class: a reset connection, a timeout or
 * a 5xx is worth another attempt, while a 4xx is an answer -- most often GitHub
 * refusing the request itself -- and retrying it only delays the report.
 */
class UploadAttemptError extends Error {
	constructor(message, { status = 0, transient = false } = {}) {
		super(message);
		this.name = "UploadAttemptError";
		this.status = status;
		this.transient = transient;
	}
}

/**
 * The underlying fault, as the runtime names it.
 *
 * A streamed `fetch` reports a broken connection as `TypeError: fetch failed` and
 * keeps the real reason on `cause` (ECONNRESET, ENOTFOUND, a TLS error), so the cause
 * is read first and its `code` wins WHEN that code is a name: the outer message names
 * nothing a reader can act on, and this string is what the run's failure line carries.
 * `Error` and `TypeError` are dropped as names for the same reason -- a bare "Error"
 * in front of a real message is noise -- while a `TimeoutError` names something the
 * message does not.
 */
function describeError(error) {
	const cause = error?.cause ?? error;
	// A string `code` is the runtime's own name for the fault (ECONNRESET, ENOTFOUND,
	// UND_ERR_SOCKET) and is what a reader looks up. A NUMERIC one is not: 23 is an
	// aborted request in libuv's errno numbering and in a DOMException's, and printing
	// "23" as the cause of a failed release is worse than printing nothing.
	if (typeof cause?.code === "string") return cause.code;
	const name =
		cause?.name && !["Error", "TypeError"].includes(cause.name)
			? cause.name
			: "";
	const message = cause?.message ?? String(error);
	return name ? `${name}: ${message}` : message;
}

/**
 * The endpoint's own explanation, from the body of a refused upload. GitHub answers
 * an asset POST with `{"message": ..., "errors": [...]}`, and that message is the
 * difference between "HTTP 422" and a sentence naming what it refused.
 */
function endpointMessage(body) {
	const trimmed = body.trim();
	if (!trimmed) return "(no response body)";
	try {
		const parsed = JSON.parse(trimmed);
		const errors = (parsed.errors ?? [])
			.map((entry) => entry?.message ?? JSON.stringify(entry))
			.filter(Boolean);
		const message = [parsed.message, ...errors].filter(Boolean).join("; ");
		if (message) return message;
	} catch {
		// Not JSON: fall through to the raw body, which is all the endpoint gave us.
	}
	return trimmed.slice(0, 500);
}

/**
 * One streamed attempt: POST the artifact to the release's upload endpoint with the
 * same auth and content type `gh api` used, with this attempt's own deadline.
 *
 * Streams a `Readable` from disk as the request body (`duplex: "half"` is what tells
 * the runtime the body arrives incrementally) and sets `content-length` from the
 * stat we already have, so the endpoint can tell a truncated upload from a complete
 * one instead of receiving an unbounded chunked body.
 */
async function streamUpload({
	baseUrl = DEFAULT_UPLOADS_BASE,
	repo,
	releaseId,
	artifact,
	token,
	timeoutMs = UPLOAD_ATTEMPT_TIMEOUT_MS,
	fetchImpl = fetch,
}) {
	const url = `${baseUrl}/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(artifact.name)}`;
	const body = createReadStream(artifact.path);
	try {
		let response;
		try {
			response = await fetchImpl(url, {
				method: "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/octet-stream",
					"content-length": String(artifact.size),
				},
				body,
				duplex: "half",
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (error) {
			// A stall, a reset socket and our own deadline all arrive here, and all
			// three are worth another attempt. Reported with the deadline, because
			// "TimeoutError" alone does not say how long we waited.
			throw new UploadAttemptError(
				`${artifact.name}: ${describeError(error)} after a ${timeoutMs / 1000}s attempt deadline`,
				{ transient: true },
			);
		}
		const text = await response.text().catch(() => "");
		if (response.ok) return response.status;
		throw new UploadAttemptError(
			`${artifact.name}: HTTP ${response.status} from the upload endpoint: ${endpointMessage(text)}`,
			{
				status: response.status,
				// 5xx is the endpoint failing; 429 is the endpoint asking us to slow
				// down. Both are worth another attempt, and a 4xx is not.
				transient: response.status >= 500 || response.status === 429,
			},
		);
	} finally {
		// The stream is the request body, so an aborted attempt leaves it open; the
		// next attempt builds its own.
		body.destroy();
	}
}

/**
 * Delete one incomplete upload's record, addressed by asset ID.
 *
 * Uses `gh api` like every other read and write in this pair of scripts. The
 * subprocess's output is deliberately not echoed: it can carry authentication
 * detail, which is the same reason `validate-release.mjs` keeps it out of its lookup
 * failures. What the reader needs is the record and the exit status.
 */
function removeAsset(repo, token, asset) {
	try {
		execFileSync(
			"gh",
			[
				"api",
				"--method",
				"DELETE",
				`repos/${repo}/releases/assets/${asset.id}`,
			],
			{
				env: { ...process.env, GH_TOKEN: token },
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
	} catch (error) {
		throw new ValidationError(
			`Unable to remove the incomplete upload of ${asset.name} (asset ${asset.id}), which holds the name this upload is refused over: gh exited with status ${error?.status ?? "unknown"}. Delete that asset by hand and re-run`,
		);
	}
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Upload one artifact, retrying a transient failure with backoff.
 *
 * Reconciles before EVERY attempt rather than only once, because a failed attempt
 * changes what is on the release: the endpoint creates the asset record as the
 * upload starts, so a timed-out attempt leaves a `starter` record that the retry's
 * own POST would be refused over (GitHub rejects the duplicate name). And a retry
 * that finds the complete asset at our size is the case where the upload succeeded
 * and only the response was lost -- success, not a duplicate to send again.
 */
async function uploadArtifact({
	api,
	releaseId,
	artifact,
	attempt,
	remove,
	log = console.log,
	sleep = defaultSleep,
	attempts = UPLOAD_ATTEMPTS,
	backoffMs = UPLOAD_BACKOFF_MS,
}) {
	for (let index = 1; index <= attempts; index++) {
		const verdict = classifyAsset(
			listAssets(api, releaseId),
			artifact.name,
			artifact.size,
		);
		if (verdict.action === "skip") {
			log(
				`Already attached at this size, nothing to upload: ${artifact.name} (${artifact.size} bytes, asset ${verdict.asset.id})`,
			);
			return verdict;
		}
		if (verdict.action === "replace") {
			for (const asset of verdict.assets) {
				remove(asset);
				log(
					`Removed an incomplete upload of ${artifact.name} (asset ${asset.id}, state ${ASSET_STATE_STARTER}) left behind by an earlier attempt`,
				);
			}
		}
		try {
			const status = await attempt(artifact);
			log(
				`Uploaded ${artifact.name} (${artifact.size} bytes) to release ${releaseId} [HTTP ${status}]`,
			);
			return { action: "upload", status };
		} catch (error) {
			const cause =
				error instanceof UploadAttemptError
					? error.message
					: `${artifact.name}: ${describeError(error)}`;
			const retryable =
				index < attempts &&
				error instanceof UploadAttemptError &&
				error.transient;
			if (!retryable) {
				// The real cause, the file it happened to, and how much of the budget
				// was spent on it. Deliberately NOT the word collision: a stall, a 5xx
				// and an exhausted retry budget are not name conflicts, and reporting
				// them as one is what cost a reader a wrong turn last night.
				throw new ValidationError(
					`Asset upload failed on attempt ${index} of ${attempts}: ${cause}. No complete asset was replaced; re-run this job to retry, since an incomplete upload left behind by this attempt is removed rather than blocking the name it holds`,
				);
			}
			const wait = backoffMs * 2 ** (index - 1);
			log(
				`Attempt ${index} of ${attempts} failed for ${artifact.name}: ${cause}; retrying in ${wait} ms`,
			);
			await sleep(wait);
		}
	}
	// Unreachable: every loop iteration either returns or throws. Kept as a refusal
	// rather than a silent fall-through, because "no attempt ran" must not read as
	// success for a release whose assets are how users get the new version.
	throw new ValidationError(
		`Asset upload made no attempt for ${artifact.name}; refusing to report success`,
	);
}

/**
 * Attach every artifact to the pinned release.
 *
 * Async because the upload is: a streamed body with a deadline cannot be driven
 * synchronously, and the alternative -- a subprocess with no timeout -- is the shape
 * that hung a release. The caller awaits it, so a failed upload is a rejected promise
 * the entry point reports rather than an unhandled rejection nobody reads.
 */
async function uploadRelease({
	api,
	tag,
	expectedSha,
	expectedReleaseId,
	files,
	upload,
	remove,
	fileSize,
	log = console.log,
	sleep = defaultSleep,
	attempts = UPLOAD_ATTEMPTS,
	backoffMs = UPLOAD_BACKOFF_MS,
}) {
	// Both pins must survive the build, even for release events (not just repairs).
	if (!/^[0-9a-f]{40}$/.test(expectedSha || ""))
		throw new ValidationError("EXPECTED_SOURCE_SHA required for upload");
	if (!/^[1-9]\d*$/.test(String(expectedReleaseId || "")))
		throw new ValidationError("EXPECTED_RELEASE_ID required for upload");
	const release = validateRelease(
		api,
		tag,
		expectedSha,
		false,
		expectedReleaseId,
	);
	const artifacts = artifactRecords(files, fileSize);
	// Every artifact is classified before the first write: a genuine collision stops
	// the run with nothing uploaded, rather than after some of the set is on the
	// release and the rest is not.
	const plan = planAssetUploads(api, release.release_id, artifacts);
	for (const { artifact, verdict } of plan) {
		if (verdict.action === "skip") {
			log(
				`Already attached at this size, nothing to upload: ${artifact.name} (${artifact.size} bytes, asset ${verdict.asset.id})`,
			);
			continue;
		}
		await uploadArtifact({
			api,
			releaseId: release.release_id,
			artifact,
			attempt: (item) => upload(release.release_id, item),
			remove,
			log,
			sleep,
			attempts,
			backoffMs,
		});
	}
	return release;
}

if (isEntryPoint(import.meta.url)) {
	try {
		const {
			RELEASE_TAG: tag,
			EXPECTED_SOURCE_SHA: expectedSha,
			EXPECTED_RELEASE_ID: expectedReleaseId,
		} = process.env;
		const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
		const repo = process.env.GITHUB_REPOSITORY;
		validateInputs(tag, expectedSha, true, token);
		if (!repo) throw new ValidationError("GITHUB_REPOSITORY required");
		const uploadsBase = process.env.GITHUB_UPLOADS_URL || DEFAULT_UPLOADS_BASE;
		await uploadRelease({
			api: createApi(repo, token),
			tag,
			expectedSha,
			expectedReleaseId,
			files: artifactFiles(process.env.ARTIFACTS_DIR || "artifacts"),
			upload: (releaseId, artifact) =>
				streamUpload({
					baseUrl: uploadsBase,
					repo,
					releaseId,
					artifact,
					token,
				}),
			remove: (asset) => removeAsset(repo, token, asset),
		});
	} catch (error) {
		// A ValidationError is this script's own finding and is already a sentence; an
		// unexpected one is reported with its own type and message rather than a
		// generic line, because "release upload failed" for a TypeError (a bug here)
		// and for a refused request (the API's answer) are different problems.
		console.error(
			error instanceof ValidationError
				? error.message
				: `Release upload failed: ${describeError(error)}; inspect artifact inputs`,
		);
		process.exitCode = 1;
	}
}

export {
	PLATFORM_INSTALLERS,
	PLATFORM_UPDATE_METADATA,
	ASSET_STATE_STARTER,
	ASSET_STATE_UPLOADED,
	UPLOAD_ATTEMPTS,
	UPLOAD_ATTEMPT_TIMEOUT_MS,
	UPLOAD_BACKOFF_MS,
	UploadAttemptError,
	artifactFiles,
	artifactRecords,
	classifyAsset,
	describeError,
	endpointMessage,
	listAssets,
	planAssetUploads,
	removeAsset,
	streamUpload,
	uploadArtifact,
	uploadRelease,
};
