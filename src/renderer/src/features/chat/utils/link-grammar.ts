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
 * EXACTLY THREE ADMISSION DIFFERENCES, all expressed on `TargetPolicy` so a
 * reviewer can reject one alone, plus one difference in what the answer is FOR:
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
 * 2. **`rejectFragments`.** The linkifier refuses a bare token that stopped
 *    inside a longer name (`/tmp/{a,b}.ts`, `screen(1).png`) where the panel
 *    admits it. Round 1 (review M2) measured this second one, because the round's
 *    own prose - and this file's - claimed the extension filter was the only
 *    admission difference: `/tmp/out/report.pdf(banana)` is admitted by the panel
 *    and refused by the linkifier, so there are TWO, and both are here.
 * 3. **`evidence`.** WHAT THE SHAPE ALONE CANNOT ANSWER. A bare `/abs` or `~/`
 *    token with no extension is a DIRECTORY, a slash COMMAND (`/new`), or a
 *    typo, and no amount of reading the token tells them apart - the disk does.
 *    The linkifier is given the session's own oracle (`evidenceFor`, which reads
 *    the answer the toolbar's probe already cached), so an ambiguous candidate
 *    is admitted only when the disk says it EXISTS; the panel supplies none, and
 *    an absent oracle REFUSES, which is the fail-safe direction this module
 *    trades in throughout (a missed link, never an anchor whose claim is wrong).
 *
 *    On the panel's side this difference is unobservable in practice, and
 *    deliberately so: `knownExtensionRequired` above has already refused every
 *    ambiguous shape before the evidence question is reached, so
 *    `MENTION_POLICY` refuses an ambiguous candidate whether or not an oracle is
 *    supplied. The ORDER is therefore load-bearing (see `targetsIn`), and it is
 *    what makes this third difference the LINKIFIER's alone - the property
 *    `scripts/link-targets.test.mjs` asserts rather than assumes.
 *
 *    Without this gate the linkifier underlines `/new` in a sentence about
 *    starting a conversation and the toolbar then answers `No file at /new`: an
 *    anchor whose whole claim is wrong, on the surface a reader reads most.
 * 4. **What the answer is FOR.** The panel wants a set of paths, in first-mention
 *    order, deduplicated; the linkifier wants SPANS, so a substring can be
 *    replaced in place. `targetsIn` answers both by returning spans whose `target`
 *    is already canonicalised, and the panel's list producers are one-line filters
 *    over it. This is not an admission difference and is not counted as one.
 *
 * ## Cost
 *
 * `targetsIn` is a pure function of one string with no memo of its own: the
 * panel's per-record `WeakMap` memo is the caller's and stays the caller's, and
 * the linkifier runs once per markdown parse rather than per frame.
 *
 * It CONSULTS the oracle it is handed and never calls it twice for one token,
 * but it does not run it at all for the shapes an extension answers for - so the
 * number of injected calls is the count of DISTINCT extensionless tokens, and
 * `evidenceFor` answers from a cache rather than from a stat.
 *
 * Pure: no React, no DOM, no Electron - `import type` only - so the rules below
 * are asserted by `scripts/link-targets.test.mjs` and
 * `scripts/mentioned-files.test.mjs` under plain `node --test`. An INJECTED
 * function is not a dependency: the grammar imports nothing for it, and the two
 * pure suites hand it a stub rather than a live bridge.
 */

import { KNOWN_EXTENSIONS, extensionOf } from "@features/chat/utils/file-kind";

/**
 * Characters that make a candidate a shell glob, a placeholder, or an
 * ABBREVIATION, rather than a path.
 *
 * `$PID`, `*.log`, `{a,b}.ts` and `<name>` are text a transcript legitimately
 * contains — a prompt documenting a command, a heredoc placeholder — and every
 * one of them used to reach the panel as a tile that could never open. The
 * number is known rather than guessed: the real-payload audit counted the
 * metacharacter share of admitted paths, and the QA walk found `qa-res-$PID.pdf`
 * and `<name` on screen. A path on disk may technically contain `$`, but the
 * trade is explicit: a placeholder tile is a click that fails, and the file is
 * still reachable through the structured tiers when an agent really touches it.
 *
 * `…` (U+2026) joins them for the same reason, and it was measured rather than
 * assumed: a guide that prints its own example as
 *
 *   `…/scratchpad/probe.sh`
 *
 * puts an ABBREVIATED path in the transcript, and the ellipsis segment was
 * admitted whole — `/…/scratchpad/probe.sh` reached the panel as a tile in a
 * real run (QA round 1). The cost lands in the same place as `$` and is stated
 * rather than hidden: a real file whose NAME contains an ellipsis is not
 * admitted by any tier here, because a character that means "text was removed"
 * is exactly the one a text-inferring scanner cannot tell from a name. That is
 * the fail-safe direction this module trades in throughout — a missing tile,
 * never a tile for a path no file has.
 */
export const PLACEHOLDER_MARKERS = /[$*?{}<>…]/;

/**
 * An ABBREVIATED path: a segment that is only an ellipsis.
 *
 * The ASCII spelling of the same abbreviation `PLACEHOLDER_MARKERS` rejects in
 * its Unicode form — `.../scratchpad/probe.sh` is the same truncated token as
 * `…/scratchpad/probe.sh`. A segment of three or more dots is not a directory
 * anyone names; a segment of exactly one or two dots is deliberately left alone,
 * because `..` is the grammar's own parent segment and neither scanner is the
 * place to decide what a relative path means.
 */
export const ELLIPSIS_SEGMENT = /(?:^|[/\\])\.{3,}(?=[/\\]|$)/;

/**
 * KNOWN GAP, recorded rather than fixed (QA round 3, Q-R3-2).
 *
 * Two other placeholder spellings for a path SEGMENT are still admitted whole,
 * measured on this tree: `/sessions/%s/scratchpad/run/perf.md` and
 * `/sessions/:id/scratchpad/run/perf.md`. `<id>` is covered (the angle bracket is
 * in `PLACEHOLDER_MARKERS` and the tail is caught by `isPlaceholderTail`), and the
 * ellipsis is covered by the two rules above, so the shape is a rule that knows
 * THREE spellings of "standing in for a name" and not five.
 *
 * Deliberately not closed here. The honest fix is a segment rule beside
 * `ELLIPSIS_SEGMENT` (a segment that is exactly `%s` or `:identifier`), because
 * the alternative - adding `%` and `:` to the marker character class - would
 * reject real names (`100%-done.md`, `final:notes.md`) for a placeholder it cannot
 * even tell from them. That is a new rule with its own blast radius across both
 * policies, and this change is scoped to the two shapes a real run produced
 * (rounds 1-2); a rule that is merely adjacent belongs in its own round with its
 * own evidence. The cost of leaving it is the same class of phantom tile the rest
 * of this block exists to prevent, so it is worth closing soon - just not as a
 * silent sixth change to a diff the reviewers have already cleared.
 */

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
 * BOTH TIERS TRIM IT, and the panel's tiles and the transcript's spans both stop
 * short of it (`targetsIn`), so `/a/run.mjs:59` names the `.mjs` in either
 * surface rather than a file whose name ends in `:59`.
 *
 * The `file://` tier needed it first and for the plainer reason: it admits on the
 * URL alone, so it would carry the suffix into the panel as a path that does not
 * exist. Found by running the extractor over real histories
 * (`scripts/mentioned-files-real-payload.mjs`): one of the first fifty paths was
 * `…/drive-model-picker.mjs:59`, quoted from an editor line reference.
 *
 * The PROSE tier used to refuse the token instead, by accident - its extension
 * reads `mjs:59`, which is not a known extension, so the Files panel never
 * offered it a tile. Moving the trim into `normalizeCandidate` therefore WIDENS
 * the panel's prose tier: a bare `…/run.mjs:59` in prose now yields a tile for a
 * file that really exists, which is a correct mention the panel used to miss.
 * That widening is deliberate, it is pinned in `mentioned-files.test.mjs` and in
 * `link-targets.test.mjs`, and the alternative - a third policy flag so one
 * surface could keep the old behaviour - would be a flag whose only purpose is to
 * preserve an accident.
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
 * The characters `FILE_URL`'s class stops at that are also placeholder markers,
 * so a URL whose match ends on one of them was cut short by a token that
 * continued the path (`…/a*.log`, `…/{a,b}.ts`). `>`, `*` and `}` are the
 * overlap between that class and `PLACEHOLDER_MARKERS`.
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

/**
 * Whether the candidate starting at `index` is the TAIL of an angle-bracket
 * placeholder that sits INSIDE a path.
 *
 * A guide that documents its own result shape writes the shape as a TEMPLATE:
 *
 *   `/…/sessions/<id>/scratchpad/logs/run.md`
 *
 * The token scanner stops at `<` (it is excluded from `PROSE_PATH`), and the
 * remainder after the `>` used to be picked up as a candidate in its own right —
 * `/scratchpad/logs/run.md` measured as a tile for a file that does not exist
 * (QA round 1). This is the SAME failure the `file://` scan guards with
 * `URL_TRUNCATION`: a placeholder must be captured WHOLE so the placeholder rule
 * can reject it, never cut short into a tile for whatever follows its bracket.
 *
 * The test looks at the WORD immediately before the candidate, and it is
 * deliberately narrower than "ends with `>` and contains a `<`". That shape is
 * also every HTML tag, every TypeScript generic and every heredoc or closing-tag
 * glued to a path — measured in review round 2, `use <code>/tmp/real/notes.md`,
 * `done </b>/tmp/real/notes.md`, `Map<T>/tmp/notes/real.md` and
 * `<br/>/tmp/notes/real.md` are all real mentions that the first version
 * dropped. So the placeholder must look like one: the text BEFORE its `<` has to
 * be path-like — non-empty and carrying a `/`. That keeps the templated path
 * above (its head is `/…/sessions/`) and drops the tags, the generics and the
 * glue, while a tag at the START of a word (`<br/>`) can never qualify.
 *
 * RESIDUAL TRADE, stated because it is real and rare: a word that is BOTH
 * path-like and carries a generic — `a/b<T>/tmp/real.md` — still loses the path
 * after it. No transcript in this repository's corpus produces that shape, and
 * the alternative (dropping every closing bracket) is the false negative above,
 * which real transcripts do produce.
 */
function isPlaceholderTail(text: string, index: number): boolean {
	const word = /[^\s]*$/.exec(text.slice(0, index))?.[0] ?? "";
	if (!word.endsWith(">")) return false;
	const bracket = word.indexOf("<");
	if (bracket <= 0) return false;
	return word.slice(0, bracket).includes("/");
}

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
	let candidate = raw.trim().replace(TRAILING_PUNCTUATION, "");
	if (!candidate) return null;
	if (candidate.length > MAX_CANDIDATE_LENGTH) return null;
	/*
	 * An editor line reference is not part of a name, and the trim happens HERE so
	 * both tiers answer the same: the `file://` path already did it (see
	 * `LINE_REFERENCE`), and a prose `/a/run.mjs:59` used to be refused on its
	 * `mjs:59` "extension" instead - a rejection that happened to be right for the
	 * wrong reason and that left the reader without a link to a file that exists.
	 * `targetsIn` shortens the SPAN by the same length, so a link never covers the
	 * `:59` it just stopped naming.
	 */
	candidate = candidate.replace(LINE_REFERENCE, "");
	if (!candidate) return null;
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
	// A glob, a placeholder or an abbreviation is not a file. See
	// `PLACEHOLDER_MARKERS` and `ELLIPSIS_SEGMENT`.
	if (PLACEHOLDER_MARKERS.test(candidate)) return null;
	if (ELLIPSIS_SEGMENT.test(candidate)) return null;
	return candidate;
}

/**
 * Whether the SHAPE alone cannot answer "is this a path".
 *
 * TRUE for a token with no extension, which is the only positive evidence of
 * file-hood this scanner has without the disk - `/new` (a slash command the
 * transcript is full of), `/tmp` (a directory), and an invented `/v2/things` are
 * one shape to a text scanner, and only the disk tells them apart. FALSE for
 * everything the extension rule already answers for, and for the two families
 * this module treats as known-good on shape alone:
 *
 * - A `file://` URL is never ambiguous: that tier is written BY the app, so its
 *   spelling is a statement about a file rather than a guess at one. (The tier
 *   is also unreachable here - `isAmbiguousCandidate` is only asked about a
 *   canonical `path` target - and the guard is stated rather than left implicit,
 *   because the predicate is exported and a second caller would not know.)
 * - A DOTFILE basename is not ambiguous either, even though it has no
 *   extension: `extensionOf` returns null for `.zshrc` as a SYNTAX artifact (a
 *   dot whose only occurrence is the first character of the name, `file-kind.ts`)
 *   rather than because the name has no extension. Reading that null as
 *   "ambiguous" would send `/Users/x/.zshrc` - a spelling nobody types by
 *   accident - to the disk gate, and a stat that came back `unknown` would
 *   demote it.
 *
 * SEGMENT COUNT, TRAILING SLASH AND THE SHAPE OF THE FIRST SEGMENT ARE NOT PART
 * OF IT. A single-segment rule would fix `/new` and leave `/v2/things` and
 * `/out/whatever` underlining away, which is the same defect in a longer string;
 * and a trailing slash is how a transcript writes "this is a directory", not a
 * statement about whether it exists. The cost of the broad rule is stated at
 * `TargetPolicy.evidence`: an existing extensionless path is one stat away from
 * its link, and an absent one renders plain.
 */
/**
 * Trailing path separators, which a token may carry and a NAME may not.
 *
 * `/Users/x/Downloads/` is how a transcript writes "this is a directory", and the
 * basename of that spelling is `Downloads` rather than the empty string a
 * `split("/")` finds without this. Module scope rather than inline for the same
 * reason `TRAILING_PUNCTUATION` is: a regex literal built inside a function is
 * rebuilt per call.
 */
const TRAILING_SLASHES = /[/\\]+$/;

export function isAmbiguousCandidate(target: string): boolean {
	const name = target.replace(TRAILING_SLASHES, "").split("/").pop() ?? "";
	if (name.startsWith(".")) return false;
	return extensionOf(target) === null;
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
	if (PLACEHOLDER_MARKERS.test(candidate)) return null;
	if (ELLIPSIS_SEGMENT.test(candidate)) return null;
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
/*
 * NAMED FOR ITS JOB, and that is a fix rather than a preference (round 1, review
 * N2): `link-actions.ts` exports its own `LinkTarget` - `{kind, target}`, the
 * thing an ANCHOR acts on - and two exported types with one name and two shapes
 * is an import that compiles and then reads like a typo at the call site. This
 * one is a SPAN: where the token is in the text, and what it resolves to.
 */
export type TargetSpan = {
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
	 * "Open folder" exists for. The extension it drops is not replaced by
	 * nothing on that side: `evidence` below answers the question the extension
	 * was standing in for.
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
	 * ON for the linkifier for exactly that reason, and it is the SECOND of the
	 * THREE ways the two surfaces differ in what they ADMIT (with
	 * `knownExtensionRequired` and `evidence`; see the module header). Kept as its
	 * own flag rather than folded into the extension one so a reviewer can reject
	 * it alone — and so that a future decision to bring the panel the same guard
	 * is one line here rather than a rewrite of both.
	 */
	rejectFragments: boolean;
	/**
	 * What is on disk, for the shapes the extension test cannot answer.
	 *
	 * INJECTED, and that is the point: this module is pure and importable by
	 * `node --test`, so it holds no bridge to the filesystem and knows nothing
	 * about Electron. The one caller that has a disk - the transcript - passes the
	 * session's own answer (`link-actions.ts`'s `evidenceFor`, which reads the
	 * probe cache the link toolbar already fills).
	 *
	 * ABSENT MEANS NO EVIDENCE IS AVAILABLE, and an ambiguous candidate is then
	 * REFUSED. That is the fail-safe default and the one both pure suites assert,
	 * so a policy assembled without thinking about the disk misses links rather
	 * than inventing them.
	 *
	 * ONLY consulted for an ambiguity - `isAmbiguousCandidate` - which is what
	 * keeps it off the hot path: the two shapes every transcript is full of (an
	 * extensioned path, a `file://` URL) never reach it, and a dotfile does not
	 * either, because `extensionOf` answering null for a dotfile is a SYNTAX
	 * artifact rather than a statement that the name has no extension.
	 */
	evidence?: TargetOracle;
};

/**
 * What the disk says about one spelling.
 *
 * Three states rather than a boolean, because "the stat failed" is not "the file
 * is missing": `use-mentioned-files` states the same rule for its tiles, and a
 * failed stat that demoted a real path to plain text would be a link lost to a
 * flaky IPC rather than to a fact.
 */
export type TargetEvidence = "exists" | "missing" | "unknown";

/** The disk oracle, as this module consumes it. */
export type TargetOracle = (target: string) => TargetEvidence;

/** The Files panel's admission: a known extension on every bare prose token. */
export const MENTION_POLICY: TargetPolicy = {
	knownExtensionRequired: true,
	rejectFragments: false,
};

/**
 * The transcript linkifier's admission, as the two pure suites see it: shape
 * only, and no oracle.
 *
 * NOTE THE CONSEQUENCE, which is the design rather than an oversight: with no
 * `evidence`, every AMBIGUOUS candidate is refused here too, so a caller that
 * imports this constant gets the fail-safe answer. The renderer does not use it
 * directly - `remark-linkify-targets.ts` spreads it and injects the session's
 * oracle as `LINK_POLICY_EVIDENCED` - and this constant stays oracle-free so a
 * `node --test` bundle can keep asserting the gate's INJECTED behaviour with a
 * stub instead of a live bridge.
 */
export const LINK_POLICY: TargetPolicy = {
	knownExtensionRequired: false,
	rejectFragments: true,
};
/*
 * NOT A POLICY: the `#` cut in `targetsIn`'s prose branch, which BOTH surfaces
 * take. A fragment is not a path - the rule `normalizeFileUrl` already states
 * for a `file://` URL - so `/tmp/a.pdf#page=2` is the file `/tmp/a.pdf` on either
 * side, and a future policy that wanted the fragment linked would have to argue
 * against that rule rather than flip a flag. Its cost is documented at the cut.
 */

/**
 * The characters a prose token loses off its END before it is a target.
 *
 * Both of the rules `normalizeCandidate` applies are tail trims - sentence
 * punctuation, then an editor line reference - so the span has to stop short of
 * what they removed. Computed in that order and on the trimmed string, because
 * `normalizeCandidate` sees `/a/run.mjs:59:` after the punctuation step, and a
 * length measured on the untrimmed token would leave the span covering a colon.
 *
 * The `file://` branch keeps the narrower `trailingPunctuationLength` below: its
 * `normalizeFileUrl` never had the punctuation-then-reference ordering to mirror
 * (it trims both, and the span arithmetic there is over a `raw` the URL class
 * already ended).
 */
const trimmedTailLength = (token: string): number => {
	const trimmed = token.replace(TRAILING_PUNCTUATION, "");
	return token.length - trimmed.replace(LINE_REFERENCE, "").length;
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
export function targetsIn(text: string, policy: TargetPolicy): TargetSpan[] {
	const found: TargetSpan[] = [];

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
		// The tail of a placeholder is not a path; see `isPlaceholderTail`.
		if (isPlaceholderTail(masked, index)) continue;
		const raw = match[0];
		/*
		 * A FRAGMENT IS NOT A PATH, on this tier as much as on the `file://` one
		 * (round 1, review M4). `/tmp/a.pdf#page=2` used to be admitted whole - an
		 * anchor whose `target` named a file nothing on disk has, on the very tier
		 * that STRIPS the fragment when the same path arrives as a URL. `#` is not a
		 * character this grammar's paths carry: what follows it is an editor line
		 * reference or a URL fragment, and the file is what precedes it, so the span
		 * ENDS at the `#` and the reader's `#page=2` stays ordinary text.
		 *
		 * The cost of the rule, stated because it is real: a file whose NAME contains
		 * a `#` is linked as the part before it, and the toolbar reports the path it
		 * cannot find rather than opening a file it cannot name. Measured against the
		 * alternative (refusing the whole token): refusal is silent, and the reader
		 * gets no toolbar to explain itself.
		 */
		const fragmentAt = raw.indexOf("#");
		const written = fragmentAt === -1 ? raw : raw.slice(0, fragmentAt);
		if (!written) continue;
		if (
			policy.rejectFragments &&
			isFragment(masked.slice(index + written.length))
		) {
			continue;
		}
		const candidate = normalizeCandidate(written);
		if (!candidate) continue;
		/*
		 * The extension test, after the trim, so `saved to /tmp/a.pdf.` matches.
		 * `~` paths carry their extension after the last dot exactly like absolute
		 * ones. This is ONE of the THREE admission differences between the policies
		 * - see `TargetPolicy.knownExtensionRequired` - and it runs BEFORE the
		 * evidence gate below on purpose: it is what keeps the panel's answer
		 * unchanged whether or not an oracle is supplied.
		 */
		if (policy.knownExtensionRequired) {
			const extension = extensionOf(candidate);
			if (!extension || !KNOWN_EXTENSIONS.has(extension)) continue;
		}
		/*
		 * The evidence gate, AFTER the extension test and after the canonicalisation,
		 * in that order and for a measured reason: an AMBIGUOUS candidate - a token
		 * whose canonical form has no extension, so the shape cannot say whether it
		 * names a directory, a slash command or nothing - is admitted only when the
		 * caller's oracle says the disk has it. See `isAmbiguousCandidate` for what
		 * "ambiguous" is exactly, and `TargetPolicy.evidence` for why this is the
		 * linkifier's difference and not the panel's.
		 *
		 * ABSENT ORACLE AND "unknown" BOTH REFUSE, which is the module's fail-safe
		 * direction (`:86`: a missing tile, never a tile for a path no file has) and
		 * the reason `/new` is plain text rather than an anchor that answers `No file
		 * at /new`. The visible cost is stated at `TargetPolicy.evidence`: an
		 * extensionless path that really exists links one round trip after the row
		 * paints, and one created after the message painted stays plain.
		 */
		if (
			isAmbiguousCandidate(candidate) &&
			policy.evidence?.(candidate) !== "exists"
		) {
			continue;
		}
		found.push({
			start: index,
			end: index + written.length - trimmedTailLength(written),
			kind: "path",
			target: candidate,
			href: candidate,
		});
	}

	return found.sort((a, b) => a.start - b.start);
}

/**
 * The policy that SUSPENDS the evidence question, for the pre-scan below.
 *
 * `evidence: () => "exists"` admits every ambiguous candidate, which is what
 * makes the ambiguity *visible* to `ambiguousTargetsIn` - and it is a policy
 * object rather than a second scanner for the reason this module exists at all:
 * two scanners are two answers to "where does a path end", and they agree until
 * one of them is fixed.
 *
 * Module-private, and deliberately NOT exported: nothing outside the query below
 * has any business admitting a token the disk has not vouched for, and an
 * exported suspend-everything policy is one import away from being used for
 * rendering.
 */
const DISCOVERY_POLICY: TargetPolicy = {
	...LINK_POLICY,
	evidence: () => "exists",
};

/**
 * Every AMBIGUOUS candidate in `text`, deduped, in document order.
 *
 * The pre-scan the renderer runs before its first parse, so the tokens whose
 * answer the disk owes are known in one pass and can be asked about in one
 * batch. It is a SUPERSET of what the linkifier will end up linking, and that is
 * stated rather than engineered away: `text` is a whole markdown document, so
 * this sees a path inside a code fence or inside an existing link's label, which
 * the plugin's walker refuses. The cost is at most a handful of extra answers per
 * row, asked once per spelling per session and cached by the same map the toolbar
 * uses (`link-actions.ts`'s `evidenceFor`); the alternative is a second scanner
 * (`docs/branding.md` § 9) or a two-pass parse.
 *
 * The property that makes it checkable rather than merely plausible: for any
 * `text`, this returns exactly the `path` targets that `DISCOVERY_POLICY` admits
 * and `{ ...LINK_POLICY, evidence: () => "missing" }` refuses - asserted in
 * `scripts/link-targets.test.mjs`, which is what keeps the query and the gate
 * from drifting apart.
 */
export function ambiguousTargetsIn(text: string): string[] {
	const seen = new Set<string>();
	const suspects: string[] = [];
	for (const span of targetsIn(text, DISCOVERY_POLICY)) {
		if (span.kind !== "path") continue;
		if (!isAmbiguousCandidate(span.target)) continue;
		if (seen.has(span.target)) continue;
		seen.add(span.target);
		suspects.push(span.target);
	}
	return suspects;
}
