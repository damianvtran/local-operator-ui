#!/usr/bin/env node
/**
 * The one-line `package.json` bump a release commit is allowed to make.
 *
 * WHY A SCRIPT AND NOT `npm version`/`jq`. Two constraints, both learned from a
 * release that went wrong here:
 *
 *  - the bump commit must be **one line in one file**. `AGENTS.md` calls a bump
 *    commit that also carries code a defect, and a reviewer's whole job on that
 *    commit is "the diff is exactly the version line". A tool that re-serialises
 *    `package.json` reformats the file, and reformatting is a diff nobody
 *    reviewed: this repository's `package.json` is tab-indented with fields in a
 *    deliberate order, and `JSON.parse`/`JSON.stringify` does not preserve either.
 *  - the version that lands must be the version that was **derived**. `npm version`
 *    edits from the current file's value and would happily produce a number that
 *    disagrees with the tag the workflow is about to create.
 *
 * So the value is written textually, and the result is asserted to be
 * line-for-line identical to the input except for that single line — checked here,
 * before anything is committed, rather than trusted to a later `git diff`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The version line, quoted-only: an unquoted `version` key is not JSON and is
 * not a shape this file ever wrote. */
const VERSION_LINE = /^([ \t]*)"version"[ \t]*:[ \t]*"([^"]+)",[ \t]*$/m;

export class BumpError extends Error {}

/**
 * The version line's own text, with the value replaced.
 *
 * Exactly one match is required. Zero means `package.json` is not the shape this
 * assumes (a second definition of the version would be the real defect); more than
 * one means the same, and either way a guess would edit the wrong copy.
 */
export function bumpVersionText(text, version) {
	if (!/^\d+\.\d+\.\d+$/.test(version))
		throw new BumpError(`Not a plain X.Y.Z version: ${version}`);
	const matches = text.match(new RegExp(VERSION_LINE.source, "gm")) ?? [];
	if (matches.length !== 1)
		throw new BumpError(
			`Expected exactly one "version" line in package.json, found ${matches.length}`,
		);
	return text.replace(VERSION_LINE, `$1"version": "${version}",`);
}

/**
 * The lines that differ between two texts, as `git diff --numstat` would count
 * them but without needing a repository or an index.
 *
 * This is the assertion that makes the commit reviewable, so it is computed from
 * the bytes rather than from a re-read of the file: a write that raced something
 * else would still be caught.
 */
export function changedLines(before, after) {
	const count = (text) => {
		const counts = new Map();
		for (const line of text.split("\n"))
			counts.set(line, (counts.get(line) ?? 0) + 1);
		return counts;
	};
	const base = count(before);
	const next = count(after);
	const removed = [];
	const added = [];
	for (const [line, seen] of base) {
		const now = next.get(line) ?? 0;
		for (let i = 0; i < seen - now; i += 1) removed.push(line);
	}
	for (const [line, seen] of next) {
		const was = base.get(line) ?? 0;
		for (let i = 0; i < seen - was; i += 1) added.push(line);
	}
	return { removed, added };
}

/** Whether every changed line is a version line, which is the property the bump
 * commit's review round checks and the one this script refuses to violate. */
export function isVersionOnlyChange(before, after) {
	const { removed, added } = changedLines(before, after);
	if (removed.length !== 1 || added.length !== 1) return false;
	return removed[0].includes('"version"') && added[0].includes('"version"');
}

function main() {
	const arg = (name) => {
		const index = process.argv.indexOf(name);
		return index < 0 ? null : (process.argv[index + 1] ?? null);
	};
	const path = arg("--package") ?? "package.json";
	const version = arg("--version");
	try {
		if (!version) throw new BumpError("--version is required");
		const before = readFileSync(path, "utf8");
		const after = bumpVersionText(before, version);
		if (!isVersionOnlyChange(before, after)) {
			const { removed, added } = changedLines(before, after);
			throw new BumpError(
				`Refusing a bump that is not one version line: -${removed.length} +${added.length}`,
			);
		}
		// `--print` is what the workflow uses when it wants the next version only;
		// writing is the release path, and it is the only mutation in this script.
		if (process.argv.includes("--print")) console.log(version);
		else writeFileSync(path, after);
		console.log(`package.json version -> ${version} (one line changed)`);
	} catch (error) {
		console.error(
			error instanceof BumpError
				? `Bump refused: ${error.message}`
				: `Bump failed: ${error.stack ?? error.message}`,
		);
		process.exit(1);
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main();
}
