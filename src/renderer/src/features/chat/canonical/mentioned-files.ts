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
 * Characters that make a candidate a shell glob or a placeholder, not a path.
 *
 * `$PID`, `*.log`, `{a,b}.ts` and `<name>` are text a transcript legitimately
 * contains — a prompt documenting a command, a heredoc placeholder — and every
 * one of them used to reach the panel as a tile that could never open. The
 * number is known rather than guessed: the real-payload audit counted the
 * metacharacter share of admitted paths, and the QA walk found `qa-res-$PID.pdf`
 * and `<name` on screen. A path on disk may technically contain `$`, but the
 * trade is explicit: a placeholder tile is a click that fails, and the file is
 * still reachable through the structured tiers when an agent really touches it.
 */
const SHELL_METACHARACTERS = /[$*?{}<>]/;

/**
 * A `?`'s tail, when that tail reads as a query rather than as the rest of a
 * filename.
 *
 * `new URL` cannot tell a glob from a query — both are `search` to it — and both
 * spellings really arrive: `file:///tmp/agent-out/a?.log` is a glob whose match
 * is a URL only because `?` happens to be a legal query delimiter, while
 * `file:///…/popup.html?state=pending&pin=86` is a real cache-busted local file
 * the operator's transcripts name. The distinguishing property is the query's
 * SHAPE — a `key=value` parameter list, `&`-joined — and that shape was counted
 * rather than assumed, over this machine's own store (1,956 session
 * directories, 91 distinct `?`-carrying `file://` tokens): 40 tails are that
 * list, 15 are a V8 stack frame's `:line:col`, 18 have nothing after the `?` at
 * all, 16 are neither — the glob and flag spellings the rule exists to reject
 * (`.log`, `x`) — and 2 carry their `?` only inside a fragment. No tail in the
 * store that reads as a query is anything but one.
 *
 * A flag with no `=` (`?debug`), and a `?` with nothing after it at all, are
 * therefore rejected along with the globs. That is the fail-safe direction this
 * module trades in throughout: a missing tile, never a tile for a path no file
 * has. (A bare trailing `?` is also how a sentence asks about a URL, and the
 * module already declines that spelling rather than guessing.)
 */
const URL_QUERY = /^[^&#]+=[^&#]*(?:&[^&#]+=[^&#]*)*$/;

/**
 * An editor line reference: `/a/run.mjs:59` and `/a/run.mjs:59:12`.
 *
 * Only the file-url tier needs the trim. Prose already rejects such a token
 * because its extension reads `ts:59`, while a `file://` URL is admitted on the
 * URL alone and would carry the suffix into the panel as a path that does not
 * exist. Found by running the extractor over real histories
 * (`scripts/mentioned-files-real-payload.mjs`): one of the first fifty paths was
 * `…/drive-model-picker.mjs:59`, quoted from an editor line reference.
 */
const LINE_REFERENCE = /:[0-9]+(?::[0-9]+)?$/;

/** Where a prose path token ends: whitespace, a quote, or sentence punctuation. */
const PROSE_TOKEN_END = /[\s"'`()\[\]{}<>,;*|]/;

/** An http(s) URL, removed before prose is scanned (it contains a path). */
const HTTP_URL = /https?:\/\/\S+/g;

/** A line break, which is what tells a continuation from a new line. */
const LINE_BREAK = /[\n\r]/;

/** Any whitespace. A path never contains it, so a value that does is prose. */
const WHITESPACE = /\s/;

/**
 * The characters `FILE_URL`'s class stops at that are also shell
 * metacharacters, so a URL whose match ends on one of them was cut short by a
 * token that continued the path (`…/a*.log`, `…/{a,b}.ts`). `>`, `*` and `}`
 * are the overlap between that class and `SHELL_METACHARACTERS`.
 */
const URL_TRUNCATION = new Set(["*", "}", ">"]);

/**
 * A `file://` URL, one capture group holding the path.
 *
 * `localhost` is allowed because the app writes both spellings (`file:///…` and
 * `file://localhost/…`). The character class stops at whitespace and at the
 * punctuation that usually terminates a URL in a sentence — a JSON string's
 * `"`, a bullet's `*`, an inline-code backtick.
 *
 * `(`, `)`, `[`, `]`, `{` and `<` ARE allowed, and that is the difference
 * between a rule and a guess. macOS names screenshots
 * `Screenshot … (1).png`, so excluding `(` recorded a truncated
 * `/Users/x/Downloads/screen(1` for a file that plainly exists; the square
 * bracket is the same truncation through the other pair, and the store's own
 * transcripts spell it their own way (`…/run-details/[eval1` — node's eval
 * frame — and `/tmp/x/notes[1`), where excluding `]` recorded `…/a[1` instead of
 * the token's own path (round 4, Q3-2). A placeholder like
 * `file:///tmp/out/<name>.` must be captured whole so the metacharacter rule
 * can REJECT it, rather than being cut short into a tile for the directory that
 * happens to precede it — and a bracket that CLOSES a sentence is trimmed by
 * `TRAILING_PUNCTUATION` below, which is what makes admitting it safe.
 *
 * The whole match is used, not a capture group: the path is parsed out of the
 * URL with `new URL` (`normalizeFileUrl`), which is the only way to tell a
 * bracket inside a name from a bracket that closes a sentence.
 *
 * The class still stops at `*`, `}` and `>`, and that stopping is a TRUNCATION
 * the class cannot see on its own — `scanFileUrls` reads the character after the
 * match for it (`URL_TRUNCATION`).
 *
 * `?` is NOT excluded, and cannot be: it is the URL's own query delimiter, so
 * the parser below is where a glob has to be told from a query (`URL_QUERY`).
 */
const FILE_URL = /file:\/\/(?:localhost)?\/[^\s"'`>*,;}]+/g;

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
	if (WHITESPACE.test(candidate)) return null;
	// A glob or a placeholder is not a file. See `SHELL_METACHARACTERS`.
	if (SHELL_METACHARACTERS.test(candidate)) return null;
	return candidate;
}

/**
 * Strip a `file://` prefix and canonicalise, for candidates that arrived as a
 * URL and therefore do not need the absolute-path test.
 */
function normalizeFileUrl(raw: string): string | null {
	/*
	 * Parsed as a URL, not string-stripped.
	 *
	 * Slicing `file://` off the front cannot see a path that contains the very
	 * characters a name may legally contain: a screenshot called `screen(1).png`
	 * was captured as `/Users/x/Downloads/screen(1` because the scanner's
	 * character class had to stop at `(` to avoid swallowing a markdown link's
	 * closing bracket. `new URL` separates the two questions — where the URL
	 * ends and what the path is — and percent-decodes the result, so a URL that
	 * reached the transcript as `My%20Docs` names the file on disk.
	 *
	 * The metacharacter rule runs on the PARSED PATHNAME, not on the raw text.
	 * Where a metacharacter survives parsing (`a*.log`, `qa-res-$PID.pdf`) the
	 * pathname is the thing that carries it, and that is where the rule looks.
	 * Where it does not survive — `?` — the parser has turned a glob into a
	 * query, and the query's SHAPE is what tells the two apart (`URL_QUERY`):
	 * `a?.log` is rejected because `.log` is not a query, and
	 * `popup.html?state=pending&pin=86` keeps its path because it is one. The
	 * check reads the RAW text (up to any `#`, since a fragment is not a path
	 * either and may itself contain a `?`) rather than `parsed.search`, because
	 * `new URL` reports an empty query as no query at all — `file:///a.pdf?`
	 * would slip through as `/a.pdf`.
	 *
	 * Running the rule on the raw match instead (round 2, Q2-1 to round 4) closed
	 * the glob hole by rejecting every `?`, which also threw away that real,
	 * cache-busted local file — the module's own asymmetry, since a missed
	 * mention is the bug this change exists to fix (round 4, R4-3).
	 */
	const rawPath = raw.split("#", 1)[0] ?? raw;
	const queryAt = rawPath.indexOf("?");
	if (queryAt !== -1 && !URL_QUERY.test(rawPath.slice(queryAt + 1)))
		return null;
	let candidate: string;
	try {
		const parsed = new URL(raw);
		if (parsed.protocol !== "file:") return null;
		// `file://other-host/share` names another machine's share, not a local
		// file. Only the empty host and the app's own `localhost` spelling are
		// accepted; both are already written by the canvas.
		if (parsed.host && parsed.host !== "localhost") return null;
		candidate = parsed.pathname;
		try {
			candidate = decodeURIComponent(candidate);
		} catch {
			// A malformed escape is not a reason to drop the path: the encoded
			// form is what the transcript wrote, and it is still a path.
		}
	} catch {
		return null;
	}
	candidate = candidate.replace(TRAILING_PUNCTUATION, "");
	if (!candidate || candidate.length > MAX_CANDIDATE_LENGTH) return null;
	candidate = candidate.replace(LINE_REFERENCE, "");
	if (!candidate) return null;
	if (API_PATH_PREFIXES.some((prefix) => candidate.startsWith(prefix)))
		return null;
	if (SHELL_METACHARACTERS.test(candidate)) return null;
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
 *
 * Only a SAME-LINE continuation counts: the guard exists for a URL that
 * contained a space, and a newline is a new line. Narrowing it that way is what
 * lets a plain path list keep its `file://` entry.
 */
function scanFileUrls(text: string): string[] {
	const found: string[] = [];
	for (const match of text.matchAll(FILE_URL)) {
		const end = (match.index ?? 0) + match[0].length;
		const rest = text.slice(end);
		const trimmed = rest.trimStart();
		// The gap between the URL and the next token, and whether that token is on
		// the SAME line. A newline is a new line, never a continuation: a plain
		// path list (`file:///…/AGENTS.md\n~/…/AGENTS.md`) used to lose the URL
		// entry because the line below happened to start with a path.
		const gap = rest.slice(0, rest.length - trimmed.length);
		const continues = (token: string) =>
			token.includes("/") || token.includes(".");
		if (gap !== "" && !LINE_BREAK.test(gap)) {
			const token = trimmed.split(PROSE_TOKEN_END, 1)[0] ?? "";
			// More path after the space: the URL contained a space and the match
			// is a fragment of it. Returning a fragment would put a path in the
			// panel that no file has.
			if (continues(token)) continue;
		}
		/*
		 * The class stops at `*`, `}` and `>`, so a match that ends on one of them
		 * is a fragment of a longer token — `file:///tmp/agent-out/a*.log` for a
		 * log glob, `file:///tmp/out/{a,b}.ts` for a brace expansion — and the
		 * fragment before it is a path no file has. Same guard shape as the space
		 * check above, and for the same reason: only a token that CONTINUES A PATH
		 * means truncation rather than markup, so `**file:///…/a.pdf**` keeps its
		 * tile (nothing path-like follows the marker) while the glob does not
		 * (round 2, Q2-1).
		 */
		const next = rest[0];
		if (next !== undefined && URL_TRUNCATION.has(next)) {
			const token = rest.slice(1).split(PROSE_TOKEN_END, 1)[0] ?? "";
			if (continues(token)) continue;
		}
		const candidate = normalizeFileUrl(match[0]);
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
	const stripped = text.replace(HTTP_URL, " ");
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
	if (WHITESPACE.test(candidate)) return null;
	// A glob or a placeholder under a path key is still not a file.
	if (SHELL_METACHARACTERS.test(candidate)) return null;
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
