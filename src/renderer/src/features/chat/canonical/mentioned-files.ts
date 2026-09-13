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

import { KNOWN_EXTENSIONS, extensionOf } from "@features/chat/utils/file-kind";
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

/** Keys whose value is a path even when it looks like nothing at all. */
const PATH_KEYS = new Set([
	"path",
	"file",
	"files",
	"filepath",
	"file_path",
	"filename",
	"target",
	"source",
	"destination",
	"dest",
	"output_path",
	"output_file",
	"directory",
	"dir",
	"cwd",
]);

/**
 * A `file://` URL, one capture group holding the path.
 *
 * `localhost` is allowed because the app writes both spellings (`file:///…` and
 * `file://localhost/…`). The character class stops at whitespace and at the
 * punctuation that usually follows a path in a sentence — a markdown link's
 * `)`, a JSON string's `"`, a bullet's `*`. `(`, `[` and `{` are deliberately
 * absent from it: a path is far more likely to be followed by a closing bracket
 * than to contain an opening one, and the trailing-punctuation trim below
 * catches the leftovers.
 *
 * The `]` is escaped on purpose. The design's version of this pattern wrote the
 * closing bracket unescaped inside the class, which ENDS the class there and
 * turns the rest of the expression into literal characters that no text can
 * satisfy — the pattern silently matched nothing at all. Escaping it is the
 * difference between a rule and a comment.
 */
const FILE_URL = /file:\/\/(?:localhost)?(\/[^\s"')}\]>*,;`]+)/g;

/**
 * A bare absolute or `~`-relative path token.
 *
 * Requires the token to start at `/` or `~/` — which is the whole reason
 * relative paths cannot match — and to contain no whitespace, quote or unquoted
 * bracket. The leading `/` is captured as part of the token so the
 * preceding-character check in `scanProse` can tell an absolute path apart from
 * the tail of a relative one (`src/foo.py` must not match at its `/`).
 */
const PROSE_PATH = /(?:~\/|\/)[^\s"'`()\[\]{}<>,;*|]+/g;

/** Trimmed from the END of a candidate before the extension test. */
const TRAILING_PUNCTUATION = /[.,;:)\]}"'`]+$/;

/** Characters a path may legally follow in prose. */
const ALLOWED_PREFIX = new Set([
	"\n",
	"\t",
	" ",
	"`",
	'"',
	"'",
	"(",
	"[",
	"{",
	"<",
	">",
	"=",
	",",
	";",
	":",
	"|",
	"*",
	"\u2014",
]);

/** Anything longer is not a path; it is a paste that happens to contain a slash. */
const MAX_CANDIDATE_LENGTH = 4096;

/**
 * Paths the backend owns rather than the disk.
 *
 * `/v1/…` is the API's own namespace: `{"path": "/v1/static/images?path=/a.png"}`
 * appears in this app's own source, and admitting it would put a URL where a
 * file belongs. `/api/` is the same idea for any future mounted prefix.
 */
const API_PATH_PREFIXES = ["/v1/", "/api/"];

/** Cap on candidates from one pass, so a pathological transcript stays bounded. */
export const MAX_CANDIDATES_PER_PASS = 200;

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
 * Canonicalise one raw candidate, or reject it.
 *
 * Exported because the rejection rules are the interesting half of this module
 * and the tests assert them one at a time.
 */
export function normalizeCandidate(raw: string): string | null {
	const candidate = raw.trim().replace(TRAILING_PUNCTUATION, "");
	if (!candidate) return null;
	if (candidate.length > MAX_CANDIDATE_LENGTH) return null;
	// A scheme other than `file:` is a URL, not a path. `file://` has already
	// been stripped by the caller.
	if (candidate.includes("://")) return null;
	// `//host/share` is a network location, not an absolute path on this machine.
	if (candidate.startsWith("//")) return null;
	if (API_PATH_PREFIXES.some((prefix) => candidate.startsWith(prefix)))
		return null;
	if (!candidate.startsWith("/") && !candidate.startsWith("~/")) return null;
	// A path token never contains whitespace: the scanners split on it, so a
	// candidate that still has some came from a value that was prose rather than
	// a path, and admitting it would put a phrase in the panel.
	if (/\s/.test(candidate)) return null;
	return candidate;
}

/**
 * Strip a `file://` prefix and canonicalise, for candidates that arrived as a
 * URL and therefore do not need the absolute-path test.
 */
function normalizeFileUrl(raw: string): string | null {
	const stripped = raw.startsWith("file://")
		? raw.slice("file://".length)
		: raw;
	const candidate = stripped.replace(TRAILING_PUNCTUATION, "");
	if (!candidate || candidate.length > MAX_CANDIDATE_LENGTH) return null;
	if (API_PATH_PREFIXES.some((prefix) => candidate.startsWith(prefix)))
		return null;
	return candidate.startsWith("/") ? candidate : null;
}

/**
 * `file://` URLs in one string, in order.
 *
 * A match that stops at a space whose next token continues the path was
 * truncated by the scanner — `file:///Users/x/My Docs/a.pdf` captures
 * `/Users/x/My` — and a truncated path is dropped rather than guessed. This is
 * the documented cost of not having a quoting grammar, asserted as such in the
 * tests so the trade stays visible.
 */
function scanFileUrls(text: string): string[] {
	const found: string[] = [];
	for (const match of text.matchAll(FILE_URL)) {
		const raw = match[1];
		if (!raw) continue;
		const end = (match.index ?? 0) + match[0].length;
		const next = text[end];
		if (next !== undefined && /\s/.test(next)) {
			const rest = text.slice(end).trimStart();
			const token = rest.split(/[\s"'`()\[\]{}<>,;*|]/, 1)[0] ?? "";
			// More path after the space: the URL contained a space and the match
			// is a fragment of it. Returning a fragment would put a path in the
			// panel that no file has.
			if (token.includes("/") || token.includes(".")) continue;
		}
		const candidate = normalizeFileUrl(raw);
		if (candidate) found.push(candidate);
	}
	return found;
}

/**
 * Bare absolute paths in one string, in order, extension-filtered.
 *
 * `https://…` runs are removed before scanning rather than rejected after: a URL
 * contains a path, and a scanner that sees the path first admits
 * `https://example.com/a/b.png` as `/a/b.png`.
 */
function scanProse(text: string): string[] {
	const stripped = text.replace(/https?:\/\/\S+/g, " ");
	const found: string[] = [];
	for (const match of stripped.matchAll(PROSE_PATH)) {
		const index = match.index ?? 0;
		const previous = index > 0 ? stripped[index - 1] : undefined;
		if (previous !== undefined && !ALLOWED_PREFIX.has(previous)) continue;
		const candidate = normalizeCandidate(match[0]);
		if (!candidate) continue;
		// The extension test, after the trim, so `saved to /tmp/a.pdf.` matches.
		// `~` paths carry their extension after the last dot exactly like
		// absolute ones.
		const extension = extensionOf(candidate);
		if (!extension || !KNOWN_EXTENSIONS.has(extension)) continue;
		found.push(candidate);
	}
	return found;
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
	if (/\s/.test(candidate)) return null;
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
			if (found.length >= MAX_CANDIDATES_PER_PASS) return found;
		}
	}
	return found;
}

/** Re-exported so a caller deciding "is this a file?" asks the same set. */
export { KNOWN_EXTENSIONS };
