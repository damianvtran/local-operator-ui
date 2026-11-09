import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	appendFileSync,
	lstatSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectPaths } from "./ci-scope.mjs";
import { musicStoryScope } from "./storybook-music-scope.mjs";

/** Use the same merge-first-parent path inventory as CI, not a PR/branch pin.
 * Unknown classification fails explicitly: this is optional evidence, not a
 * reason to silently claim an artifact was built or widen every PR's matrix. */
export function musicEvidenceRequested(paths) {
	if (paths === null)
		throw new Error("Music evidence change inventory unavailable");
	return paths.some(
		(path) =>
			/^src\/renderer\/src\/features\/chat\/canonical\/music[^/]*\.(tsx?|mjs)$/.test(
				path,
			) ||
			/^scripts\/(?:music[.-]|storybook-music-)/.test(path) ||
			path === "scripts/fixtures/music-tone.mp3" ||
			path.startsWith(".storybook/"),
	);
}

/** Manifest only the separate static output, never Electron's closed-world out/.
 * Storybook's inert .nojekyll marker is the only allowed hidden artifact; no
 * symlink, native binary or hidden credential/config directory is publishable. */
export function musicEvidenceManifest(directory, provenance) {
	const files = [];
	const walk = (relative = "") => {
		for (const name of readdirSync(join(directory, relative)).sort()) {
			const path = relative ? `${relative}/${name}` : name;
			const absolute = join(directory, path);
			const facts = lstatSync(absolute);
			if (
				(name.startsWith(".") && path !== ".nojekyll") ||
				facts.isSymbolicLink()
			)
				throw new Error(`Unsafe music evidence path: ${path}`);
			if (facts.isDirectory()) walk(path);
			else if (!facts.isFile() || /\.(?:node|jsc|dylib|so|exe)$/i.test(path))
				throw new Error(`Non-static music evidence path: ${path}`);
			else
				files.push({
					path,
					sha256: createHash("sha256")
						.update(readFileSync(absolute))
						.digest("hex"),
				});
		}
	};
	walk();
	for (const required of ["index.html", "index.json", "iframe.html"])
		if (!files.some((file) => file.path === required))
			throw new Error(`Missing music evidence entry: ${required}`);
	const index = JSON.parse(readFileSync(join(directory, "index.json"), "utf8"));
	const ids = Object.keys(index.entries ?? {});
	for (const state of [
		"queued",
		"running",
		"narrow",
		"populated",
		"partial-failure",
		"empty",
		"jobs-cancel",
		"jobs-cancel-rtl",
		"canonical-missing-bytes",
		"canonical-rtl",
	])
		if (!ids.includes(`chat-canonical-music--${state}`))
			throw new Error(`Missing music story: ${state}`);
	if (!ids.some((id) => !id.startsWith("chat-canonical-music--")))
		throw new Error("Missing neighboring SFX stories");
	return {
		format: 1,
		...provenance,
		fixtureScope: musicStoryScope({ LOP_STORYBOOK_MUSIC_EVIDENCE: "1" }),
		nativeDependenciesIncluded: false,
		oauthPlaceholders: true,
		files,
	};
}

export function main(args = process.argv.slice(2)) {
	if (args[0] === "scope") {
		const requested = musicEvidenceRequested(
			collectPaths("HEAD^1", false, process.cwd()),
		);
		if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT required");
		appendFileSync(process.env.GITHUB_OUTPUT, `music=${requested}\n`);
		console.log(`Music static evidence requested: ${requested}`);
		return;
	}
	if (args[0] !== "manifest" || !args[1])
		throw new Error("Expected scope or manifest <static-output>");
	const git = (...parts) =>
		execFileSync("git", parts, { encoding: "utf8" }).trim();
	const requestedHead = process.env.QA_REQUESTED_HEAD;
	if (!/^[a-f0-9]{40}$/.test(requestedHead ?? ""))
		throw new Error("Valid QA_REQUESTED_HEAD required");
	const manifest = musicEvidenceManifest(args[1], {
		checkoutCommit: git("rev-parse", "HEAD"),
		requestedHead,
		srcTree: git("rev-parse", "HEAD:src"),
		scriptsTree: git("rev-parse", "HEAD:scripts"),
		storybookTree: git("rev-parse", "HEAD:.storybook"),
		workflowCommit: process.env.GITHUB_SHA,
		runId: process.env.GITHUB_RUN_ID,
		fixtureBackendUrl: process.env.VITE_LOCAL_OPERATOR_API_URL,
	});
	writeFileSync(
		join(args[1], "music-build-provenance.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
	main();
