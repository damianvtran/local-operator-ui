/**
 * Which files a conversation mentions, pulled out of the transcript.
 *
 * ## Why this exists
 *
 * A file the agent touched reaches the renderer only as text. The canonical
 * wire carries no file list — `CanonicalContentBlock` is `text | image`
 * (`src/shared/desktop-session-contract.ts`) — so a path survives in exactly
 * four places: prose, tool arguments, tool output, and a diff body. The old
 * producer read `message.files`, which the canonical transcript never carried,
 * and it is gone with the dead `MessageItem` effect.
 *
 * So the panel's content is *inferred* from what the agent wrote. That is a
 * weaker guarantee than a field on the wire, and the whole shape of this module
 * is a consequence: a mention is admitted on evidence, never on resemblance.
 *
 * ## Two tiers, because structured data and prose deserve different trust
 *
 * | Tier | Source | Bar |
 * |---|---|---|
 * | `file-url` | a `file://` URL anywhere | the URL alone; no extension required |
 * | `tool-arg` | a value under a path key in tool `args` | absolute, `~`-prefixed, or resolvable against the session cwd; extension optional |
 * | `prose` | assistant/user text, tool `output`, diff bodies | absolute (or `~`) **and** a known extension |
 *
 * A `file://` URL is something the app itself wrote — the canvas hands paths to
 * the OS that way — so it is admitted without asking what the file is. A path
 * *key* in tool arguments is a producer stating an intent ("this call reads
 * `path`, writes `output_file`"), so the key is the evidence and the extension
 * is not needed. Prose is the only place where a string can look like a path
 * without being one, so prose is the only tier that demands both a known shape
 * (absolute) and a known format (extension).
 *
 * ## What is deliberately NOT admitted
 *
 * Relative paths (`src/foo.py`, `node_modules/react/index.js`) are prose noise:
 * in a coding session they are everywhere, they cannot be resolved to a file
 * without guessing a root, and the guess is wrong exactly when it matters. A
 * `file://` URL or a path key can carry a relative candidate because those
 * carry an explicit intent; a bare relative token cannot.
 *
 * A path containing a space (`/Users/x/My Documents/a.pdf`) also falls out, and
 * this is the module's one accepted false negative. It is a trade, not an
 * oversight: recovering it means splitting on whitespace inside a token, which
 * is how a prose scanner invents files that do not exist. A structured value or
 * a `file://` URL recovers the same path when the agent actually worked on it.
 *
 * ## Cost control
 *
 * Extraction is memoised per record **object** in a module-level `WeakMap`,
 * which is the identity contract the reducer already guarantees
 * (`transcript-reducer.ts`: a delta that changes nothing returns the same record
 * object, and the view's memoisation depends on it). A streaming turn therefore
 * re-scans one record per delta instead of the whole transcript, and the
 * `WeakMap` cannot retain a record the transcript has dropped.
 *
 * Pure: no React, no DOM, no Electron. `import type` only, so the module bundles
 * for `node --test` without a browser.
 */

import { KNOWN_EXTENSIONS } from "@features/chat/utils/file-kind";
import {
	API_PATH_PREFIXES,
	ELLIPSIS_SEGMENT,
	MAX_CANDIDATE_LENGTH,
	MENTION_POLICY,
	PLACEHOLDER_MARKERS,
	TRAILING_PUNCTUATION,
	WHITESPACE,
	normalizeCandidate,
	targetsIn,
} from "@features/chat/utils/link-grammar";
import type { TranscriptRecord } from "./transcript-reducer";

/** Where a mention was found. Strongest first; the first find wins. */
export type MentionedFileSource = "file-url" | "tool-arg" | "prose";

export type MentionedPath = {
	/**
	 * The path as the transcript spelled it, with any `file://` prefix removed
	 * and trailing punctuation trimmed.
	 *
	 * `~` is KEPT: expansion belongs to the main process, where `app.getPath("home")`
	 * lives, and doing it here would make the renderer's idea of the home
	 * directory a second, silently wrong answer. A relative candidate is also
	 * kept relative — see `resolveUserPath` in `src/main/index.ts` for the one
	 * resolution rule.
	 */
	path: string;
	source: MentionedFileSource;
};

/**
 * Keys whose value is a path even when it looks like nothing at all.
 *
 * Semantic labels are deliberately absent. `target`, `source`, `dest` and
 * `destination` used to be listed here, and the harness's own `send` tool is
 * what turned that into a defect: `{"target": "50809"}` is a peer PID and
 * `{"target": "lop-bridge-wedge"}` is another session's conversation NAME, and
 * because a cwd was present both were admitted as files and probed to a
 * missing-file tile. A key that means "the thing this call is about" is not a
 * key that means "a path"; the real-path keys below are, and the prose scanner
 * still catches a path that genuinely appears in a `command` string.
 */
const PATH_KEYS = new Set([
	"path",
	"file",
	"files",
	"filepath",
	"file_path",
	"filename",
	"output_path",
	"output_file",
	"directory",
	"dir",
	"cwd",
]);

/**
 * Memo, keyed by the record object the reducer guarantees is stable, and
 * separated per cwd.
 *
 * The cwd belongs in the key because it is an INPUT to extraction
 * (`extractFromArgs` admits a relative path key only when a cwd makes it
 * resolvable), and a transcript's cwd is learned from the canonical frontend a
 * frame or two after the first records arrive. One cache would freeze the
 * cwd-less answer for every record already scanned.
 */
const recordCaches = new Map<
	string,
	WeakMap<TranscriptRecord, MentionedPath[]>
>();

function cacheFor(cwd: string | undefined) {
	const key = cwd ?? "";
	let cache = recordCaches.get(key);
	if (!cache) {
		cache = new WeakMap();
		recordCaches.set(key, cache);
	}
	return cache;
}

/**
 * `file://` URLs in one string, in order.
 *
 * A match that stops at a space whose next token continues the path was
 * truncated by the scanner — `file:///Users/x/My Docs/a.pdf` captures
 * `/Users/x/My` — and a truncated path is dropped rather than guessed. This is
 * the documented cost of not having a quoting grammar, asserted as such in the
 * tests so the trade stays visible.
 *
 * Only a SAME-LINE continuation counts: the guard exists for a URL that
 * contained a space, and a newline is a new line. Narrowing it that way is what
 * lets a plain path list keep its `file://` entry.
 */
function scanFileUrls(text: string): string[] {
	return targetsIn(text, MENTION_POLICY)
		.filter((found) => found.kind === "file-url")
		.map((found) => found.target);
}

/**
 * Bare absolute paths in one string, in order, extension-filtered.
 *
 * `https://…` runs are removed before scanning rather than rejected after: a URL
 * contains a path, and a scanner that sees the path first admits
 * `https://example.com/a/b.png` as `/a/b.png`.
 */
function scanProse(text: string): string[] {
	return targetsIn(text, MENTION_POLICY)
		.filter((found) => found.kind === "path")
		.map((found) => found.target);
}

/**
 * Canonicalise a value that arrived under a path key.
 *
 * Looser than `normalizeCandidate` in exactly one way: a relative path is
 * returned rather than rejected, because the key already said "this is a path"
 * and the cwd decides whether it can be resolved. Everything a URL-shaped or
 * API-shaped string is rejected by is shared with the prose path.
 */
function normalizePathValue(raw: string): string | null {
	const stripped = raw.startsWith("file://")
		? raw.slice("file://".length)
		: raw;
	const candidate = stripped.trim().replace(TRAILING_PUNCTUATION, "");
	if (!candidate) return null;
	if (candidate.length > MAX_CANDIDATE_LENGTH) return null;
	if (candidate.includes("://")) return null;
	if (candidate.startsWith("//")) return null;
	if (API_PATH_PREFIXES.some((prefix) => candidate.startsWith(prefix)))
		return null;
	// Whitespace inside a path key's value means the value is prose (a whole
	// command, a sentence), and treating a sentence as a path is how a panel
	// fills with junk. The prose scanner handles those values instead.
	if (WHITESPACE.test(candidate)) return null;
	// A glob, a placeholder or an abbreviation under a path key is still not a
	// file.
	if (PLACEHOLDER_MARKERS.test(candidate)) return null;
	if (ELLIPSIS_SEGMENT.test(candidate)) return null;
	return candidate;
}

/** Every string in an arbitrarily nested argument value, in order. */
function* stringValues(value: unknown): Generator<string> {
	if (typeof value === "string") {
		yield value;
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) yield* stringValues(item);
		return;
	}
	if (value && typeof value === "object") {
		for (const item of Object.values(value as Record<string, unknown>))
			yield* stringValues(item);
	}
}

/**
 * Paths named by a tool call's arguments.
 *
 * Two sources, one tier. A value under a path key is admitted on the key alone.
 * Every OTHER string value is scanned with the prose rules, because a shell
 * command's own text is a real mention — `bash {command: "convert in.png > /tmp/out.png"}`
 * names a file the agent wrote, and the key is `command`, not `path`. The second
 * source is stricter on purpose: it is prose that happens to live in an
 * argument.
 */
export function extractFromArgs(
	args: Record<string, unknown> | null,
	cwd?: string,
): MentionedPath[] {
	if (!args) return [];
	const found: MentionedPath[] = [];
	const seen = new Set<string>();
	const push = (path: string, source: MentionedFileSource) => {
		if (seen.has(path)) return;
		seen.add(path);
		found.push({ path, source });
	};

	for (const [key, value] of Object.entries(args)) {
		if (PATH_KEYS.has(key)) {
			for (const raw of stringValues(value)) {
				// A path key may hold a relative path, so this normaliser accepts one
				// — but a relative candidate is admitted only when a cwd makes it
				// resolvable, and it is stored exactly as written. Resolution happens
				// in main (`resolveUserPath`), so a relative candidate never becomes
				// an invented absolute path here.
				const candidate = normalizePathValue(raw);
				if (!candidate) continue;
				if (candidate.startsWith("/") || candidate.startsWith("~/") || cwd)
					push(candidate, "tool-arg");
			}
			continue;
		}
		// Not a path key. Prose rules, and only over absolute-looking text.
		for (const raw of stringValues(value)) {
			for (const candidate of scanFileUrls(raw)) push(candidate, "tool-arg");
			for (const candidate of scanProse(raw)) push(candidate, "tool-arg");
		}
	}
	return found;
}

/** The text-bearing fields of a record, in the order they are scanned. */
function recordText(record: TranscriptRecord): {
	text: string | null;
	output: string | null;
	diff: string | null;
} {
	switch (record.kind) {
		case "user":
		case "assistant":
			return { text: record.text || null, output: null, diff: null };
		case "tool":
			return {
				text: null,
				output: record.output,
				// Only the `+`/`-`/`@@` body: a diff header (`--- a/x`) is relative
				// and unhelpful, and the structured `args.path` already carries the
				// file the call touched.
				diff: record.diff?.join("\n") ?? null,
			};
		default:
			return { text: null, output: null, diff: null };
	}
}

/** Extract from one record, in tier order so the stronger source wins. */
function extractFromRecord(
	record: TranscriptRecord,
	cwd?: string,
): MentionedPath[] {
	const { text, output, diff } = recordText(record);
	const found: MentionedPath[] = [];
	const seen = new Set<string>();
	const push = (path: string, source: MentionedFileSource) => {
		if (seen.has(path)) return;
		seen.add(path);
		found.push({ path, source });
	};

	// Tier 1: a `file://` URL anywhere in the record's own words.
	for (const body of [text, output]) {
		if (!body) continue;
		for (const candidate of scanFileUrls(body)) push(candidate, "file-url");
	}
	// Tier 2: path keys and command text in tool arguments.
	if (record.kind === "tool") {
		for (const mention of extractFromArgs(record.args, cwd))
			push(mention.path, "tool-arg");
	}
	// Tier 3: prose, output and diff bodies.
	for (const body of [text, output, diff]) {
		if (!body) continue;
		for (const candidate of scanProse(body)) push(candidate, "prose");
	}
	return found;
}

/**
 * Every path the records mention, in first-mention order.
 *
 * Order is the record list's own order — the reducer keeps it chronological,
 * durable pages before live — and within a record it is tier order, so a path
 * named both in prose and in a `read` call is reported once, at its strongest
 * source. Nothing is ever re-sorted: a re-scan after an older page arrives must
 * not shuffle entries a reader is already looking at, and the store's append
 * order is the only order the panel has.
 *
 * ## There is no output cap, and its absence is the fix
 *
 * This used to stop at 200 candidates. Because records only ever append and a
 * re-scan restarts from record 0 in the same order, the same first 200 mentions
 * came back on every pass — so paths 201+ were not merely delayed, they were
 * unreachable for the life of the conversation, and `use-mentioned-files` saw
 * an empty delta and stopped probing. Measured on this machine's own durable
 * store, 23 of 1,735 sessions returned exactly 200 paths and one real session
 * lost ~1,700 of them. A scan bound belongs at the SCAN (how far back the
 * producer pages, which the panel states and can extend); an output bound here
 * dropped files silently, which is the failure the panel exists to prevent.
 *
 * Cost is bounded without it: the per-record memo means a re-scan is O(new
 * records), and the number of paths is bounded by the conversation itself.
 */
export function extractMentionedPaths(
	records: readonly TranscriptRecord[],
	cwd?: string,
): MentionedPath[] {
	const found: MentionedPath[] = [];
	const seen = new Set<string>();
	for (const record of records) {
		const cache = cacheFor(cwd);
		let perRecord = cache.get(record);
		if (!perRecord) {
			perRecord = extractFromRecord(record, cwd);
			cache.set(record, perRecord);
		}
		for (const mention of perRecord) {
			if (seen.has(mention.path)) continue;
			seen.add(mention.path);
			found.push(mention);
		}
	}
	return found;
}

/** Re-exported so a caller deciding "is this a file?" asks the same set. */
export { KNOWN_EXTENSIONS };

/**
 * The grammar's own canonicaliser, re-exported rather than copied.
 *
 * It moved to `link-grammar.ts` with the rest of the token grammar, and the
 * tests that pin its rejection rules one at a time still import it from here
 * (`scripts/mentioned-files.test.mjs`) - so a reader who came for the panel
 * finds the rule where the panel's own answer is decided instead of following a
 * second definition. There is one implementation; this is a name for it.
 */
export { normalizeCandidate };
