#!/usr/bin/env node
/**
 * Preserve one macOS architecture's update-feed entries across the other's build.
 *
 * WHY THIS EXISTS. `latest-mac.yml` is ONE file describing BOTH macOS
 * architectures — the shipped v0.30.10 feed lists the x64 and arm64 zip and dmg
 * together — and electron-builder REWRITES it from scratch at the end of every
 * run, listing only the artifacts that run produced. That was free while a
 * single `electron-builder --mac` pass built both arches. It is not free now:
 * building each architecture in its own pass (so each gets V8 bytecode for its
 * own runtime — see the macOS steps in .github/workflows/publish.yml) means the
 * second pass's feed would list only the second architecture, and every user on
 * the first would be told there is no update. Splitting the build without this
 * step trades a brick for a silently dead update channel.
 *
 * WHAT IT DOES. Snapshot the feed after pass one (`--save`), then after pass two
 * merge the saved entries back into the freshly written file (`--merge`). Only
 * the `files:` list is merged; every other key in the new file is left exactly
 * as electron-builder wrote it.
 *
 * WHICH ENTRY WINS on a name collision: the NEW one. A rerun that rebuilds the
 * same architecture must not resurrect a stale hash from a previous pass, and
 * the new file is the one that describes bytes that exist on this runner.
 *
 * ORDER IS PRESERVED — new entries first, then saved ones that the new file does
 * not mention — because `path:`/`sha512:` at the top level name the DEFAULT
 * download and electron-builder points those at its own first entry. Merging
 * must not change which artifact that is.
 *
 * Parsed and re-dumped with `yaml` (a declared dependency) rather than
 * line-rewritten like `updateUpdateYmlEntry` in notarize-artifacts.mjs: that one
 * edits values inside an entry it must not reformat, whereas this one has to
 * splice whole entries into a sequence — and the notarization step that fixes
 * post-staple hashes runs AFTER this, over whatever layout this leaves.
 *
 *   node scripts/merge-update-feed.mjs --save  --dist dist --state <file>
 *   node scripts/merge-update-feed.mjs --merge --dist dist --state <file>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parse, stringify } from "yaml";
import { isEntryPoint } from "./entry-point.mjs";

/** The macOS feeds a mac build writes. Both are channel files for the same build. */
export const MAC_FEED_NAMES = [
	"latest-mac.yml",
	"beta-mac.yml",
	"alpha-mac.yml",
];

/**
 * Merge two feed documents' `files:` lists, new entries taking precedence.
 *
 * Exported for its own test: this is the whole correctness question, and it is a
 * pure function of two documents so it can be asserted without a build.
 */
export function mergeFeedFiles(newText, savedText) {
	const next = parse(newText);
	const saved = parse(savedText);
	if (!next || !Array.isArray(next.files)) return newText;
	if (!saved || !Array.isArray(saved.files)) return newText;

	// A feed may only describe ONE version. Merging across versions would offer
	// users an artifact this release did not build, so a mismatch is left alone.
	if (saved.version !== next.version) return newText;

	const seen = new Set(next.files.map((entry) => entry?.url));
	const carried = saved.files.filter(
		(entry) => entry?.url && !seen.has(entry.url),
	);
	if (carried.length === 0) return newText;

	next.files = [...next.files, ...carried];
	return stringify(next, { lineWidth: 0 });
}

function feedPaths(distDir) {
	return MAC_FEED_NAMES.map((name) => join(distDir, name)).filter((p) =>
		existsSync(p),
	);
}

export function saveFeeds(distDir, stateDir, log = console.log) {
	const saved = [];
	for (const path of feedPaths(distDir)) {
		writeFileSync(join(stateDir, basename(path)), readFileSync(path));
		saved.push(basename(path));
	}
	// Not an error: a build that produced no feed (nothing to publish) is a
	// different failure, and it belongs to the step that expected the artifact.
	log(
		saved.length > 0
			? `Saved update feed(s) before the next architecture's build: ${saved.join(", ")}`
			: "No macOS update feed to save yet",
	);
	return saved;
}

export function mergeFeeds(distDir, stateDir, log = console.log) {
	const merged = [];
	for (const name of MAC_FEED_NAMES) {
		const current = join(distDir, name);
		const savedPath = join(stateDir, name);
		if (!existsSync(current) || !existsSync(savedPath)) continue;
		const before = readFileSync(current, "utf8");
		const after = mergeFeedFiles(before, readFileSync(savedPath, "utf8"));
		if (after !== before) {
			writeFileSync(current, after);
			merged.push(name);
		}
	}
	// LOUD ON THE EMPTY CASE, because a merge that silently did nothing is
	// indistinguishable from a working one until users stop receiving updates.
	if (merged.length === 0) {
		throw new Error(
			`No macOS update feed was merged. Both architectures' builds must have run, each writing ${MAC_FEED_NAMES[0]} into ${distDir}, with the first pass's copy saved into ${stateDir}. Publishing now would offer updates to only one architecture.`,
		);
	}
	log(`Merged both architectures into: ${merged.join(", ")}`);
	return merged;
}

if (isEntryPoint(import.meta.url)) {
	const argv = process.argv.slice(2);
	const flagValue = (flag, fallback) => {
		const index = argv.indexOf(flag);
		return index === -1 ? fallback : argv[index + 1];
	};
	const distDir = flagValue("--dist", "dist");
	const stateDir = flagValue("--state", process.env.RUNNER_TEMP || "/tmp");
	try {
		if (argv.includes("--save")) saveFeeds(distDir, stateDir);
		else if (argv.includes("--merge")) mergeFeeds(distDir, stateDir);
		else throw new Error("Pass --save or --merge");
	} catch (error) {
		console.error(`Update feed step failed: ${error.message}`);
		process.exit(1);
	}
}
