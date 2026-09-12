#!/usr/bin/env node
/**
 * Notarize, staple and re-hash the macOS disk images after a build.
 *
 * Why this is a post-build step and not an `afterAllArtifactBuild` hook:
 * electron-builder computes each artifact's sha512 for `latest-mac.yml` while
 * the artifact is created - i.e. before any hook runs - and only writes the
 * file later. Stapling the DMG changes its bytes, so a hash recorded before the
 * staple is wrong for the artifact we ship. Running after electron-builder has
 * finished means the rewrite below lands on the real file, and the update
 * metadata then describes the artifact a user actually downloads.
 *
 * Why the DMG has to be notarized at all: only the `.app` inside the image was
 * notarized before (`afterSign` / `mac.notarize: false`), so a freshly
 * downloaded, quarantined DMG had no usable signature of its own -
 * `spctl -a -vvv -t open --context context:primary-signature` answered
 * "rejected / source=no usable signature" for the 0.17.0 release. That is the
 * Gatekeeper-friction surface behind the operator's "damaged and can't be
 * opened" report.
 *
 * Usage: node scripts/notarize-artifacts.mjs [--dist dist]
 * Env: APPLE_ID, APPLE_ID_PASSWORD (app-specific password), APPLE_TEAM_ID,
 *      NOTARIZE=true. Loaded from .env.build when present.
 */
import { createHash } from "node:crypto";
import {
	createReadStream,
	existsSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { notarize } from "@electron/notarize";
import { loadBuildEnv } from "./build-env.mjs";

/** Disk images in a build's artifact list. */
export function dmgArtifacts(artifactPaths = []) {
	return artifactPaths.filter((path) => path.endsWith(".dmg"));
}

/**
 * Rewrite one file entry inside an electron-updater yml.
 *
 * A targeted line rewrite rather than a parse-and-re-dump: the rest of the file
 * (release date, channel, paths) is not ours to reformat, and the file is read
 * by tools that care about the values, not the layout.
 *
 * Returns `matched` as well as the text: a stapled image whose entry is not in
 * the file leaves the pre-staple hash in place, and the caller has to be able
 * to tell that from "rewritten" rather than shipping a hash of bytes nobody
 * downloads (review R8). `matched` answers "is the entry here"; `replaced`
 * answers "was anything in it rewritten", and the caller needs the second -
 * an entry whose keys have drifted matches and rewrites nothing (review R12).
 */
export function updateUpdateYmlEntry(ymlText, fileName, { sha512, size }) {
	const lines = ymlText.split("\n");
	const entryIndex = lines.findIndex((line) => line.trim() === `- url: ${fileName}`);
	if (entryIndex === -1) return { text: ymlText, matched: false, replaced: 0 };

	let replaced = 0;
	for (let index = entryIndex + 1; index < lines.length; index++) {
		const line = lines[index];
		// The entry ends at the next file or at the first unindented key.
		if (/^\s*- url:/.test(line) || /^[^ \t-]/.test(line)) break;
		if (/^\s*sha512:/.test(line)) {
			lines[index] = line.replace(/sha512:.*$/, `sha512: ${sha512}`);
			replaced++;
		} else if (/^\s*size:/.test(line)) {
			lines[index] = line.replace(/size:.*$/, `size: ${size}`);
			replaced++;
		}
	}
	return {
		text: replaced > 0 ? lines.join("\n") : ymlText,
		matched: true,
		replaced,
	};
}

export function sha512Base64(filePath) {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha512");
		const stream = createReadStream(filePath);
		stream.on("error", reject);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("end", () => resolve(hash.digest("base64")));
	});
}

/**
 * Remove a `<dmg>.zip` left beside the image.
 *
 * @electron/notarize zips an `.app` before uploading it and would leave that
 * zip next to the artifact; for a `.dmg` it uploads the image directly, so
 * there is normally nothing to remove. The check stays because a stray zip is
 * uploaded and attached to the release, and a 366 MB file nobody asked for is
 * not a thing to discover by surprise.
 */
export function removeTransientZip(dmgPath) {
	const zipPath = `${dmgPath}.zip`;
	if (!existsSync(zipPath)) return null;
	rmSync(zipPath, { force: true });
	return zipPath;
}

/** Every `latest*.yml` beside the artifacts. */
export function updateYmlFiles(distDir) {
	if (!existsSync(distDir)) return [];
	return readdirSync(distDir)
		.filter((name) => /^latest.*\.yml$/.test(name))
		.map((name) => join(distDir, name));
}

function parseArgs(argv) {
	const args = { dist: "dist" };
	for (let index = 0; index < argv.length; index++) {
		if (argv[index] === "--dist") args.dist = argv[index + 1];
	}
	return args;
}


/**
 * Rewrite every update-metadata file that lists `name`, and fail when none of
 * them was rewritten.
 *
 * Why this is its own function: it is the decision that ships a hash of bytes
 * nobody downloads when it is wrong, and it needs no signing identity to
 * exercise - a temp directory of `.yml` files is the whole fixture. It used to
 * live inline in the notarization step, where only a real Apple credential could
 * reach it, which is how an entry whose `sha512`/`size` lines had drifted passed
 * the step with the PRE-staple hash still in the file (review R12).
 *
 * A rewrite is the only thing that counts as "described". `matched` alone is true
 * whenever the `- url:` line exists, so the two are reported as the different
 * failures they are: listed-but-not-rewritten names the file that drifted, and
 * described-nowhere names the ymls that do not mention the image at all. No
 * metadata at all is the second case with nothing to name.
 *
 * Failing is deliberate over both. electron-updater verifies a download against
 * this hash, so a stale one is a failed install for every user of the release:
 * the release is late rather than wrong (reviews R8, R12).
 */
export function rewriteUpdateMetadata({ ymlPaths, name, sha512, size, log = () => {} }) {
	let describedSomewhere = false;
	const matchedButNotRewritten = [];
	for (const ymlPath of ymlPaths) {
		const before = readFileSync(ymlPath, "utf8");
		const entry = updateUpdateYmlEntry(before, name, { sha512, size });
		if (entry.replaced > 0) describedSomewhere = true;
		else if (entry.matched) matchedButNotRewritten.push(basename(ymlPath));
		if (entry.text !== before) {
			writeFileSync(ymlPath, entry.text, "utf8");
			log(`Updated ${basename(ymlPath)}: ${name} size ${size}`);
		}
	}
	if (matchedButNotRewritten.length > 0) {
		throw new Error(
			`Stapled disk image ${name} is listed in ${matchedButNotRewritten.join(", ")} but its sha512/size lines were not rewritten; the update metadata still describes the pre-staple bytes`,
		);
	}
	if (!describedSomewhere) {
		throw new Error(
			ymlPaths.length > 0
				? `Stapled disk image ${name} has no entry in ${ymlPaths.map((yml) => basename(yml)).join(", ")}; its update metadata cannot be rewritten`
				: `Stapled disk image ${name} was stapled but no update metadata was found to re-hash it in`,
		);
	}
}

export async function notarizeArtifacts({ dist, artifactPaths, log = console.log }) {
	const env = loadBuildEnv();

	if (process.platform !== "darwin") {
		log("Skipping disk image notarization: not macOS");
		return { notarized: [] };
	}
	if (process.env.NOTARIZE !== "true") {
		log("Skipping disk image notarization: NOTARIZE not set to true");
		return { notarized: [] };
	}
	if (!process.env.APPLE_ID || !process.env.APPLE_ID_PASSWORD || !process.env.APPLE_TEAM_ID) {
		log(
			"Skipping disk image notarization: set APPLE_ID, APPLE_ID_PASSWORD and APPLE_TEAM_ID (in .env.build when building locally)",
		);
		return { notarized: [] };
	}
	if (env.loaded) log(`Loaded build environment from ${env.path}`);

	// Absolute paths, resolved once here so every consumer below gets the same
	// one. `--dist dist` (the default, and what CI runs) makes these paths
	// relative to the working directory, and `@electron/notarize` resolves a
	// relative `appPath` for a `.dmg`/`.pkg` against ITS OWN submission temp dir
	// (`path.resolve(dir, opts.appPath)` in lib/notarytool.js), where the image
	// of course does not exist - the 0.17.2 release failed in the notarytool
	// submission for exactly that reason. The app bundle never hit it because
	// `afterSign` is handed an absolute `appOutDir` by electron-builder. The
	// staple and re-hash use the same path, so resolving at discovery keeps one
	// answer for submit, staple, hash, size and the transient-zip cleanup.
	const distDir = resolve(dist);
	const discovered = existsSync(distDir) ? readdirSync(distDir) : [];
	const dmgs = dmgArtifacts(
		artifactPaths ??
			discovered
				.filter((name) => name.endsWith(".dmg"))
				.map((name) => join(distDir, name)),
	).map((dmgPath) => resolve(dmgPath));
	if (dmgs.length === 0) {
		log(`No disk images found in ${distDir}`);
		return { notarized: [] };
	}

	const ymlFiles = updateYmlFiles(distDir);
	const notarized = [];

	for (const dmgPath of dmgs) {
		log(`Notarizing disk image: ${dmgPath}`);
		// Submits the image itself (notarize skips its app-zipping path for a
		// .dmg) and staples the returned ticket to it.
		await notarize({
			tool: "notarytool",
			appPath: dmgPath,
			appleId: process.env.APPLE_ID,
			appleIdPassword: process.env.APPLE_ID_PASSWORD,
			teamId: process.env.APPLE_TEAM_ID,
		});

		const removedZip = removeTransientZip(dmgPath);
		if (removedZip) log(`Removed transient archive: ${removedZip}`);

		const sha512 = await sha512Base64(dmgPath);
		const size = statSync(dmgPath).size;
		const name = basename(dmgPath);
		// The staple rewrote the image, so the hash electron-builder recorded before
		// this step no longer describes the file that ships; every metadata file that
		// references it has to be rewritten, and the step fails if none was.
		rewriteUpdateMetadata({ ymlPaths: ymlFiles, name, sha512, size, log });
		notarized.push({ path: dmgPath, sha512, size });
		log(`Disk image notarized and stapled: ${dmgPath}`);
	}

	return { notarized };
}

const isMain =
	process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
	const args = parseArgs(process.argv.slice(2));
	notarizeArtifacts({ dist: args.dist }).catch((error) => {
		console.error("Disk image notarization failed:", error);
		process.exit(1);
	});
}
