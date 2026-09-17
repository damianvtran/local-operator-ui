/**
 * The one token grammar behind everything in this app that reads a path or a
 * `file://` URL out of text.
 *
 * ## Why there is one file and not two
 *
 * Two surfaces turn free text into targets: the Files panel
 * (`mentioned-files.ts`, which infers which files a conversation touched) and
 * the transcript's linkifier (`remark-linkify-targets.ts`, which renders what
 * the agent wrote as a link you can press). They read the SAME text, so a
 * second scanner would be a second answer to "where does a path end" - and
 * § 9 of `docs/branding.md` refuses a second implementation of one thing,
 * because the failure is not a divergence anyone sees, it is two parsers that
 * agree until one is fixed.
 *
 * So the grammar below is the record that used to live in `mentioned-files.ts`,
 * moved here verbatim (`mentioned-files.ts` imports it and behaves identically -
 * the commit that moved it says so), and `targetsIn` is the one span-producing
 * scanner both surfaces call.
 *
 * ## Where the two surfaces deliberately differ
 *
 * Exactly three named differences, and every one of them is policy rather than
 * grammar. They are expressed on `TargetPolicy` so a reviewer can reject one
 * alone:
 *
 * 1. **`knownExtensionRequired`.** The Files panel admits a prose `/abs` or
 *    `~/` token only when its extension is one the app knows (`~/x/report.xlsx`
 *    is a mention; `~/workspace/proj` is not), because a panel entry is a claim
 *    that a file exists. The linkifier drops that filter: a link is a sharper
 *    rendering of what the agent wrote, not a claim about the disk, and
 *    extensionless paths are exactly the ones a reader most wants to press -
 *    `~/workspace/opoint-renewal-2026-09-17/` names a directory, and a
 *    directory is useful to open in Finder. Every OTHER rejection (whitespace,
 *    shell metacharacters, API prefixes, length, network locations, non-file
 *    schemes) is shared, and both surfaces keep the same `file://` rule: no
 *    extension required on either side.
 * 2. **Relative tokens are admitted on NEITHER side.** `notes.md`, `src/foo.ts`
 *    - no cwd is available to the text's author, so admitting one would mean
 *    guessing a root, and a guess is wrong exactly when it matters. See
 *    `mentioned-files.ts`'s own note for the long form.
 * 3. **What the answer is FOR.** The panel wants a set of paths, in
 *    first-mention order, deduplicated; the linkifier wants SPANS, so a
 *    substring can be replaced in place. `targetsIn` answers both by returning
 *    spans whose `target` is already canonicalised, and the panel's list
 *    producers are one-line filters over it.
 *
 * ## Cost
 *
 * `targetsIn` is a pure function of one string with no memo of its own: the
 * panel's per-record `WeakMap` memo is the caller's and stays the caller's, and
 * the linkifier runs once per markdown parse rather than per frame.
 *
 * Pure: no React, no DOM, no Electron - `import type` only - so the rules below
 * are asserted by `scripts/link-targets.test.mjs` and
 * `scripts/mentioned-files.test.mjs` under plain `node --test`.
 */

import { KNOWN_EXTENSIONS, extensionOf } from "@features/chat/utils/file-kind";

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
export const SHELL_METACHARACTERS = /[$*?{}<>]/;

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
export const WHITESPACE = /\s/;

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
 * the class cannot see on its own — `targetsIn` reads the character after the
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
 * preceding-character check in `targetsIn` can tell an absolute path apart
 * from the tail of a relative one (`src/foo.py` must not match at its `/`).
 */
const PROSE_PATH = /(?:~\/|\/)[^\s"'`()\[\]{}<>,;*|]+/g;

/** Trimmed from the END of a candidate before the extension test. */
export const TRAILING_PUNCTUATION = /[.,;:)\]}"'`]+$/;

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
export const MAX_CANDIDATE_LENGTH = 4096;

/**
 * Paths the backend owns rather than the disk.
 *
 * `/v1/…` is the API's own namespace: `{"path": "/v1/static/images?path=/a.png"}`
 * appears in this app's own source, and admitting it would put a URL where a
 * file belongs. `/api/` is the same idea for any future mounted prefix.
 */
export const API_PATH_PREFIXES = ["/v1/", "/api/"];

/**
 * Canonicalise one bare `/abs` or `~/` token, or reject it.
 *
 * Exported because the rejection rules are the interesting half of this module
 * and the tests assert them one at a time - they used to be asserted in
 * `mentioned-files.ts`, which now re-exports this one so that its own tests (and
 * any other reader) keep asking the same question at the same name.
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
 *
 * Exported because the renderer's href classifier (`link-actions.ts`) meets
 * `file://` hrefs a hand-written markdown link can carry, and the two questions
 * it answers there - where the URL ends, what the path is - are exactly these.
 * A second slice-and-decode at the call site is how `My%20Docs` becomes a path
 * that does not exist.
 */
export function normalizeFileUrl(raw: string): string | null {
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
 * What a scan found, and where it found it.
 *
 * The span is the TOKEN as the text spells it, with the trailing punctuation
 * `TRAILING_PUNCTUATION` removes already excluded: a linkifier that underlined
 * the full stop at the end of a sentence would be rendering `a.pdf.` as the
 * target, which is the same off-by-one the Files panel would suffer as a
 * missing tile.
 */
export type LinkTarget = {
	/** Offset of the token's first character in the scanned text. */
	start: number;
	/** Offset one past its last character. */
	end: number;
	/**
	 * Which rule admitted it, named as the Files panel's tiers name it - so a
	 * `file-url` is admitted on the URL alone and a `path` is a bare token that
	 * still had to survive every rejection in its normaliser.
	 */
	kind: "file-url" | "path";
	/**
	 * The canonical form: a path, with any `file://` prefix parsed off and
	 * percent-decoding applied, and trailing punctuation trimmed.
	 *
	 * `~` is KEPT - expansion belongs to the main process, where
	 * `app.getPath("home")` lives, and doing it here would make the renderer's
	 * idea of the home directory a second, silently wrong answer.
	 */
	target: string;
	/**
	 * What an anchor should carry, which is NEVER a `file://` URL.
	 *
	 * react-markdown runs every `href` through remark-rehype's
	 * `defaultUrlTransform`, whose safe list is `https?|ircs?|mailto|xmpp`: a
	 * `file:///…` href is silently replaced with `""`, so a detected file link
	 * that carried one would render an anchor that goes nowhere - and the
	 * failure is invisible in the markup. The path is the thing the click
	 * handler needs anyway.
	 */
	href: string;
};

/**
 * Which of the two admissions a caller wants.
 *
 * A named object rather than a boolean argument at the call site, because the
 * difference between the two surfaces is the interesting thing about this
 * module and `targetsIn(text, true)` says nothing about which one you asked
 * for. `MENTION_POLICY` and `LINK_POLICY` are the only two in the app, and each
 * is imported where it is used.
 */
export type TargetPolicy = {
	/**
	 * Demand a known extension of a bare `/abs` or `~/` token.
	 *
	 * ON for the Files panel (`MENTION_POLICY`): a panel entry claims a file
	 * exists, so a token that only looks path-shaped is refused.
	 *
	 * OFF for the linkifier (`LINK_POLICY`): the link renders what the agent
	 * wrote, and an extensionless path is the directory case the toolbar's
	 * "Open folder" exists for.
	 */
	knownExtensionRequired: boolean;
	/**
	 * Drop a bare token that stopped inside a longer name, rather than linking
	 * the fragment before the stop.
	 *
	 * OFF for the Files panel, and the reason is that the panel never needed it:
	 * the extension rule above is doing this job by accident on that side.
	 * `/tmp/{a,b}.ts` was refused because its candidate `/tmp/` has no extension,
	 * and `/Users/x/Downloads/screen(1).png` because `screen` has none — so a
	 * fragment never reached a tile. The linkifier drops the extension rule, and
	 * with it that accident: without this guard the brace expansion renders a
	 * link to `/tmp/` and the screenshot renders one to `screen`, i.e. an anchor
	 * whose whole claim is wrong, in a way a missing tile never was.
	 *
	 * ON for the linkifier for exactly that reason, and it is the fourth way the
	 * two surfaces differ. Kept as its own flag rather than folded into the
	 * extension one so a reviewer can reject it alone — and so that a future
	 * decision to bring the panel the same guard is one line here rather than a
	 * rewrite of both.
	 */
	rejectFragments: boolean;
};

/** The Files panel's admission: a known extension on every bare prose token. */
export const MENTION_POLICY: TargetPolicy = {
	knownExtensionRequired: true,
	rejectFragments: false,
};

/** The transcript linkifier's admission: shape only, never a claim about disk. */
export const LINK_POLICY: TargetPolicy = {
	knownExtensionRequired: false,
	rejectFragments: true,
};

/**
 * The characters `TRAILING_PUNCTUATION` would remove from the end of a token,
 * which a span has to stop short of.
 */
const trailingPunctuationLength = (token: string): number =>
	token.length - token.replace(TRAILING_PUNCTUATION, "").length;

/**
 * The characters that can continue a path where `PROSE_PATH`'s class stops, and
 * the bracket that closes each opening one.
 *
 * The class excludes `,;()[]{}<>*|` so a sentence's punctuation stays out of a
 * token — which means a name that CONTAINS one is cut short, and `/tmp/{a,b}.ts`
 * arrives as `/tmp/`. The file-url scanner has the same problem one character
 * set over and solves it the same way `TRAILING_PUNCTUATION` does: admit the
 * bracket, and decide from what follows. Here the decision is simpler, because
 * a span that is a FRAGMENT of a name has no honest rendering at all — an
 * anchor reading `/tmp/` for text that says `/tmp/{a,b}.ts` is a link to
 * somewhere else — so a fragment is dropped rather than guessed at, the same
 * direction `scanFileUrls`'s space guard takes.
 *
 * Closers (`)`, `]`, `}`, `>`) are deliberately absent: a token ending before
 * one is what the class is FOR (`(see /tmp/a.pdf)` must not link the bracket),
 * and `TRAILING_PUNCTUATION` is what removes one that ends up inside a
 * `file://` URL's match.
 */
const FRAGMENT_OPENERS: Record<string, string> = {
	"(": ")",
	"[": "]",
	"{": "}",
	"<": ">",
};

/**
 * The other characters that can continue a path where the class stops.
 *
 * `URL_TRUNCATION` above is this set's `file://` half — the three its own class
 * can stop on — and it keeps its own name because the guard that reads it is the
 * one the file-url scanner arrived at first and documents. `|` is here and not
 * there because a URL's class already admits it.
 */
const PATH_TRUNCATION = new Set(["*", "}", ">", "|"]);

/**
 * Whether the text right after a match is a longer name carrying on, rather
 * than a sentence carrying on about the name.
 *
 * Three shapes, and each one is a real string from this machine's transcripts:
 *
 * 1. an OPENING BRACKET that closes further along the same token —
 *    `/tmp/{a,b}.ts`, the brace expansion; `/Users/x/Downloads/screen(1).png`,
 *    which is what macOS names a screenshot;
 * 2. a `*`, which is a glob or markdown emphasis. `continues()` tells them
 *    apart, the way `scanFileUrls` already does: `/tmp/a*.log` continues a path
 *    (an emphasis-wrapped `tmp/a.pdf` does not, and keeps its link);
 * 3. a `|`, `>`, `}`, or the like followed by something that continues a path.
 *    `/tmp/out|grep` is left alone — `grep` continues nothing — while
 *    `/tmp/a|b.ts` is dropped.
 */
const continuesPath = (token: string): boolean =>
	token.includes("/") || token.includes(".");

const isFragment = (rest: string): boolean => {
	const next = rest[0];
	if (next === undefined) return false;
	const closer = FRAGMENT_OPENERS[next];
	if (closer) {
		/*
		 * To the next whitespace rather than to the next character the class
		 * stops at: the closer may itself be one of those characters, or may sit
		 * behind one (`a,b}.ts` behind the `{`) - which is the `\s` split's whole
		 * point, and the reason a `PROSE_TOKEN_END` split here would answer no
		 * fragment for every brace expansion in existence.
		 */
		const line = rest.slice(1).split(WHITESPACE, 1)[0] ?? "";
		return line.includes(closer);
	}
	if (!PATH_TRUNCATION.has(next)) return false;
	return continuesPath(rest.slice(1).split(PROSE_TOKEN_END, 1)[0] ?? "");
};

/**
 * Every target in one string, in document order.
 *
 * `https://…` runs are masked out before the path scan rather than rejected
 * after, because a URL contains a path and a scanner that saw the path first
 * would admit `https://example.com/a/b.png` as `/a/b.png`. The mask is
 * SAME-LENGTH (one space per character of the URL) rather than the single space
 * this used to substitute, so every index in the masked string is also an index
 * in the original - which is the whole reason spans can be answered from this
 * function at all - and the character a token follows is still a space, so the
 * `ALLOWED_PREFIX` decision is unchanged.
 */
export function targetsIn(text: string, policy: TargetPolicy): LinkTarget[] {
	const found: LinkTarget[] = [];

	/*
	 * `file://` URLs, with the two truncation guards `scanFileUrls` documented:
	 * a match that stopped at a space whose next token continues the path, and
	 * one that ended on a character the class cannot see through (`*`, `}`, `>`).
	 * Both mean the match is a FRAGMENT of a longer token, and a fragment is a
	 * path no file has.
	 */
	for (const match of text.matchAll(FILE_URL)) {
		const index = match.index ?? 0;
		const end = index + match[0].length;
		const rest = text.slice(end);
		const trimmed = rest.trimStart();
		const gap = rest.slice(0, rest.length - trimmed.length);
		const continues = (token: string) =>
			token.includes("/") || token.includes(".");
		if (gap !== "" && !LINE_BREAK.test(gap)) {
			const token = trimmed.split(PROSE_TOKEN_END, 1)[0] ?? "";
			if (continues(token)) continue;
		}
		const next = rest[0];
		if (next !== undefined && URL_TRUNCATION.has(next)) {
			const token = rest.slice(1).split(PROSE_TOKEN_END, 1)[0] ?? "";
			if (continues(token)) continue;
		}
		const candidate = normalizeFileUrl(match[0]);
		if (candidate)
			found.push({
				start: index,
				end: end - trailingPunctuationLength(match[0]),
				kind: "file-url",
				target: candidate,
				href: candidate,
			});
	}

	const masked = text.replace(HTTP_URL, (url) => " ".repeat(url.length));
	for (const match of masked.matchAll(PROSE_PATH)) {
		const index = match.index ?? 0;
		const previous = index > 0 ? masked[index - 1] : undefined;
		if (previous !== undefined && !ALLOWED_PREFIX.has(previous)) continue;
		const raw = match[0];
		if (
			policy.rejectFragments &&
			isFragment(masked.slice(index + raw.length))
		) {
			continue;
		}
		const candidate = normalizeCandidate(raw);
		if (!candidate) continue;
		/*
		 * The extension test, after the trim, so `saved to /tmp/a.pdf.` matches.
		 * `~` paths carry their extension after the last dot exactly like
		 * absolute ones. This is the ONE admission the two policies differ on -
		 * see `TargetPolicy.knownExtensionRequired`.
		 */
		if (policy.knownExtensionRequired) {
			const extension = extensionOf(candidate);
			if (!extension || !KNOWN_EXTENSIONS.has(extension)) continue;
		}
		found.push({
			start: index,
			end: index + raw.length - trailingPunctuationLength(raw),
			kind: "path",
			target: candidate,
			href: candidate,
		});
	}

	return found.sort((a, b) => a.start - b.start);
}
