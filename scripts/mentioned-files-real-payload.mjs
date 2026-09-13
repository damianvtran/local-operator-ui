/*
 * Risk 2 of the mentioned-files design, falsified against real payloads.
 *
 * The design's extractor infers filenames from prose, tool arguments, tool
 * output and diff bodies, and the risk it named is that real transcripts make
 * it over-match until the panel fills with junk. This script answers that with
 * the operator's own durable histories rather than with fixtures: it reads the
 * backend's transcript store, feeds each session through the SHIPPED reducer
 * (so the records the extractor sees are the records the app would hand it),
 * and prints what the extractor finds.
 *
 * Read-only. It touches no session, no socket and no database; `transcript.jsonl`
 * is opened for reading and nothing is written back.
 *
 * Usage:
 *   node scripts/mentioned-files-real-payload.mjs [--limit N] [--files N]
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
	const index = args.indexOf(`--${name}`);
	return index === -1 ? fallback : Number(args[index + 1]);
};
const PATH_LIMIT = flag("limit", 50);
const SESSION_LIMIT = flag("files", 120);

const SESSIONS_DIR = join(homedir(), ".local-operator", "sessions");

const bundle = await build({
	stdin: {
		contents: `
			export { applyHistoryPage, EMPTY_TRANSCRIPT } from "./src/renderer/src/features/chat/canonical/transcript-reducer";
			export { extractMentionedPaths } from "./src/renderer/src/features/chat/canonical/mentioned-files";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	alias: {
		"@features": "./src/renderer/src/features",
		"@shared": "./src/renderer/src/shared",
	},
});
const { EMPTY_TRANSCRIPT, applyHistoryPage, extractMentionedPaths } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The same expansion `resolveUserPath` performs in main, for the audit only. */
function existsOnDisk(path) {
	const expanded = path.startsWith("~/")
		? join(homedir(), path.slice(2))
		: path;
	try {
		return existsSync(expanded);
	} catch {
		return false;
	}
}

/** The most recently written sessions, newest first. */
function recentTranscripts(limit) {
	const entries = [];
	for (const name of readdirSync(SESSIONS_DIR)) {
		const file = join(SESSIONS_DIR, name, "transcript.jsonl");
		try {
			const stat = statSync(file);
			if (stat.isFile() && stat.size > 0)
				entries.push({ file, mtime: stat.mtimeMs, size: stat.size });
		} catch {
			// A session with no transcript is a session that never ran a turn.
		}
	}
	return entries.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

const sessions = recentTranscripts(SESSION_LIMIT);
const seen = new Map();
let scannedRecords = 0;
let sessionsWithMentions = 0;

for (const session of sessions) {
	const rows = [];
	for (const line of readFileSync(session.file, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try {
			const row = JSON.parse(line);
			if (row?.id && row?.payload) rows.push(row);
		} catch {
			// A truncated final line is a session still being written.
		}
	}
	if (rows.length === 0) continue;
	const state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries: rows,
		has_more: false,
		cursor_missing: false,
	});
	scannedRecords += state.records.length;
	const mentions = extractMentionedPaths(state.records);
	if (mentions.length > 0) sessionsWithMentions += 1;
	for (const mention of mentions) {
		if (!seen.has(mention.path))
			seen.set(mention.path, {
				source: mention.source,
				session: session.file.split("/sessions/")[1].split("/")[0],
			});
	}
}

const rows = [...seen.entries()].slice(0, PATH_LIMIT).map(([path, meta]) => ({
	path,
	source: meta.source,
	session: meta.session,
	exists: existsOnDisk(path),
}));

/*
 * The audit that decides whether the prose bar is high enough.
 *
 * "Junk dominates" is not a feeling, it is a measurement: a path the extractor
 * reports for a file that does not exist is a tile the panel would show and a
 * click that would fail. So every distinct path is stat'ed, `~` expanded as the
 * probe will expand it, and the misses are grouped by what they look like.
 */
const all = [...seen.entries()].map(([path, meta]) => ({
	path,
	source: meta.source,
	exists: existsOnDisk(path),
}));
const missing = all.filter((row) => !row.exists);
const group = (rows, test) => rows.filter((row) => test(row.path)).length;
const audit = {
	total: all.length,
	exists: all.length - missing.length,
	missing: missing.length,
	missingBySource: missing.reduce((acc, row) => {
		acc[row.source] = (acc[row.source] ?? 0) + 1;
		return acc;
	}, {}),
	// Shell metacharacters and globs inside a path: never a file.
	missingWithMetacharacters: group(missing, (path) => /[$*?{}]/.test(path)),
	// Temp paths the agent really wrote are mentions, not junk; they are counted
	// separately because they are the largest legitimate-miss group.
	missingUnderTmp: group(
		missing,
		(path) => path.startsWith("/tmp/") || path.includes("/var/folders/"),
	),
	// A directory mention (no extension and on disk as a directory) is how a
	// `cwd` argument lands; counted so the decision to keep or drop it is made
	// on a number rather than an opinion.
	missingNoExtension: group(missing, (path) => !/\.[A-Za-z0-9]+$/.test(path)),
};

console.log(
	JSON.stringify(
		{
			sessionsScanned: sessions.length,
			sessionsWithMentions,
			recordsScanned: scannedRecords,
			distinctPaths: seen.size,
			bySource: [...seen.values()].reduce((acc, meta) => {
				acc[meta.source] = (acc[meta.source] ?? 0) + 1;
				return acc;
			}, {}),
			audit,
			first: rows,
		},
		null,
		2,
	),
);
