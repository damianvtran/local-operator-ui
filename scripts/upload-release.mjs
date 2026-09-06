#!/usr/bin/env node
/**
 * Repair assets on a pinned, already-published release. Never create a release,
 * replace an asset, change release metadata, or resolve an upload target by tag.
 * GitHub rejects duplicate asset names; unlike a release action we never delete
 * an existing asset to retry, including when another upload races our precheck.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	ValidationError,
	createApi,
	validateInputs,
	validateRelease,
} from "./validate-release.mjs";

function artifactFiles(root) {
	const platforms = {
		macos: /\.(dmg|zip)$/,
		windows: /\.(exe|msi)$/,
		linux: /\.(deb|AppImage|rpm)$/,
	};
	return Object.entries(platforms).flatMap(([platform, installer]) => {
		const dir = join(root, `${platform}-artifacts`);
		const files = readdirSync(dir, { withFileTypes: true });
		if (!files.some((f) => f.isFile() && installer.test(f.name))) {
			throw new ValidationError(`Missing ${platform} installer artifacts`);
		}
		if (files.some((f) => !f.isFile()))
			throw new ValidationError(`Unexpected non-file in ${platform} artifacts`);
		return files.map((f) => join(dir, f.name));
	});
}

function checkAssetCollisions(api, releaseId, files) {
	if (!files.length) throw new ValidationError("No artifacts to upload");
	const names = files.map((file) => basename(file));
	if (new Set(names).size !== names.length)
		throw new ValidationError("Duplicate artifact filenames across platforms");
	// The release summary can truncate its assets; page the ID-addressed list.
	const existing = new Set();
	for (let page = 1; ; page++) {
		const assets = api(
			`/releases/${releaseId}/assets?per_page=100&page=${page}`,
		);
		for (const asset of assets) existing.add(asset.name);
		if (assets.length < 100) break;
	}
	const collisions = names.filter((name) => existing.has(name));
	if (collisions.length)
		throw new ValidationError(
			`Asset filename collisions: ${collisions.join(", ")}`,
		);
}

function uploadRelease({
	api,
	tag,
	expectedSha,
	expectedReleaseId,
	files,
	upload,
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
	checkAssetCollisions(api, release.release_id, files);
	for (const file of files) upload(release.release_id, file);
	return release;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
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
		uploadRelease({
			api: createApi(repo, token),
			tag,
			expectedSha,
			expectedReleaseId,
			files: artifactFiles(process.env.ARTIFACTS_DIR || "artifacts"),
			upload: (releaseId, file) => {
				try {
					execFileSync(
						"gh",
						[
							"api",
							"--method",
							"POST",
							`https://uploads.github.com/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(basename(file))}`,
							"-H",
							"Content-Type: application/octet-stream",
							"--input",
							file,
						],
						{
							env: { ...process.env, GH_TOKEN: token },
							stdio: ["ignore", "pipe", "pipe"],
						},
					);
					console.log(`Uploaded ${basename(file)} to release ${releaseId}`);
				} catch {
					throw new ValidationError(
						`Asset upload failed: ${basename(file)}; existing assets were not replaced`,
					);
				}
			},
		});
	} catch (error) {
		console.error(
			error instanceof ValidationError
				? error.message
				: "Release upload failed; inspect artifact inputs",
		);
		process.exitCode = 1;
	}
}

export { artifactFiles, checkAssetCollisions, uploadRelease };
