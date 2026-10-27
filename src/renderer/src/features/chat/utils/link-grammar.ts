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
 * EXPORTED because the panel's two tiers and this module's span arithmetic all
 * apply it - `normalizeCandidate`, `normalizePathValue` and `trimmedTailLength` -
 * and a rule that lives in three places is three rules (`docs/branding.md` § 9).
 *
 * EVERY TIER TRIMS IT - in the VALUE and in the SPAN - so `/a/run.mjs:59` names
 * the `.mjs` wherever it is read: the panel's prose tiles and its path-keyed
 * arguments (`normalizeCandidate`, `normalizePathValue`) and both of the
 * transcript's spans (`targetsIn`), the prose one and the `file://` one, which
 * subtracts the reference from its end as well as the sentence punctuation.
 *
 * That last clause is round 1's finding R1-3, and it was measured rather than
 * assumed: the `file://` branch subtracted the punctuation alone, so
 * `file:///Users/x/proj/run.mjs:59` rendered an anchor whose TARGET was
 * `…/run.mjs` while its visible TEXT was `file:///…/run.mjs:59`. A span that does
 * not name the file it opens is wrong on any tier, and worst on this one, whose
 * whole claim is that the app wrote the URL itself. The arithmetic is the same
 * punctuation-then-reference order `normalizeFileUrl` trims in
 * (`trimmedTailLength`), and `scripts/link-targets.test.mjs` pins the span.
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
export const LINE_REFERENCE = /:[0-9]+(?::[0-9]+)?$/;

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

/**
 * Whether a prose token may FOLLOW this character.
 *
 * The predecessor rule lives here because TWO callers need the same answer:
 * `targetsIn` applies it to the character before a token in the text it scans,
 * and `remark-linkify-targets.ts` applies it to the character the SOURCE holds
 * before a node's first character - the one position where a node value has no
 * predecessor of its own to test, because markdown consumed whatever stood
 * there (`_` for underscore emphasis, `~` for a strikethrough run).
 *
 * `_` is deliberately NOT in `ALLOWED_PREFIX` and must not be added for that
 * caller's sake: it is a legal path character, so admitting it would link the
 * TAIL of a longer relative name (`x_/tmp/a.pdf`) - the class `rejectFragments`
 * exists for, one character over. The direction this keeps is the module's own
 * (`:86`): a token the asker could not have asked about is REFUSED, so the cost
 * is a missed link rather than an anchor whose existence depends on some other
 * row's cache.
 *
 * THE WALKER'S APPLICATION IS SCOPED TO AN AMBIGUOUS TOKEN (round 2, review
 * R2-3). It is the ask that the refusal protects, and only an ambiguous token is
 * asked about, so a caller applying this to a target the extension rule already
 * admitted would be refusing a link for no reason - which is what it did before
 * this note existed.
 */
export function allowsProsePathAfter(character: string | undefined): boolean {
	return character === undefined || ALLOWED_PREFIX.has(character);
}

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
 * Trailing path separators, which a token may carry and a NAME may not.
 *
 * `/Users/x/Downloads/` is how a transcript writes "this is a directory", and the
 * basename of that spelling is `Downloads` rather than the empty string a
 * `split("/")` finds without this. Module scope rather than inline for the same
 * reason `TRAILING_PUNCTUATION` is: a regex literal built inside a function is
 * rebuilt per call.
 */
const TRAILING_SLASHES = /[/\\]+$/;

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
 * Which of the two SURFACES' admissions a caller wants.
 *
 * A named object rather than a boolean argument at the call site, because the
 * difference between the two surfaces is the interesting thing about this
 * module and `targetsIn(text, true)` says nothing about which one you asked
 * for. `MENTION_POLICY` (the Files panel) and `LINK_POLICY` (the transcript's
 * linkifier) are the two surfaces' policies, and each is imported where it is
 * used. Two more are built from them and are deliberately NOT part of that
 * vocabulary: `LINK_POLICY_EVIDENCED` in `remark-linkify-targets.ts`, which is
 * `LINK_POLICY` plus the disk's own oracle, and this module's private
 * `DISCOVERY_POLICY`, which SUSPENDS the evidence question so the pre-scan can
 * see the ambiguous candidates at all.
 *
 * (Round 1, review R1-1: this block called the flags "the two admissions" and
 * claimed the two policies were "the only two in the app". The count is THREE -
 * see the header - and the four policies are the two named here, the plugin's
 * evidenced one and `DISCOVERY_POLICY`.)
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
 * The characters a prose or `file://` token loses off its END before it is a target.
 *
 * Both of the trims the grammar applies to a tail - sentence punctuation, then
 * an editor line reference - are mirrored here, so a span stops short of what
 * they removed. Computed in that order and on the trimmed string, because
 * `normalizeCandidate` sees `/a/run.mjs:59:` after the punctuation step, and a
 * length measured on the untrimmed token would leave the span covering a colon.
 *
 * BOTH span producers use it. The prose branch always did; the `file://` branch
 * subtracts only this (`targetsIn`) since round 1's R1-3, because
 * `normalizeFileUrl` trims the same two things in the same order and a span that
 * kept the reference would name a different token than its own target. The
 * narrower `trailingPunctuationLength` that used to serve that branch is gone
 * with the divergence it encoded.
 */
const trimmedTailLength = (token: string): number => {
	const trimmed = token.replace(TRAILING_PUNCTUATION, "");
	return token.length - trimmed.replace(LINE_REFERENCE, "").length;
};

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
				end: end - trimmedTailLength(match[0]),
				kind: "file-url",
				target: candidate,
				href: candidate,
			});
	}

	const masked = text.replace(HTTP_URL, (url) => " ".repeat(url.length));
	for (const match of masked.matchAll(PROSE_PATH)) {
		const index = match.index ?? 0;
		const previous = index > 0 ? masked[index - 1] : undefined;
		if (!allowsProsePathAfter(previous)) continue;
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
 * batch. It is a SUPERSET of what the linkifier will end up linking, and the half
 * of that which is ENGINEERED rather than asserted is the NODE BOUNDARY the
 * walker answers at. The walker applies this module's own predecessor rule
 * (`allowsProsePathAfter`) to the character the SOURCE holds before an ambiguous
 * node's first character, which is the one position where a node value has no
 * character of its own to test - so a token the raw scan could not name is
 * refused THERE rather than linked because a neighbour happened to prime the
 * cache (round 1, review R1-4, measured: `ambiguousTargetsIn` on
 * `"_/Users/x/workspace_"` returned `[]` while the plugin linked
 * `/Users/x/workspace` as soon as another row had asked about that spelling).
 *
 * WHERE THAT RULE DOES NOT REACH, stated because the sentence above is about the
 * boundary and not about every index (round 2, review R2-4): markdown can also
 * consume a character INSIDE a node value, where no boundary test can see it. In
 * `see \/Users/x/workspace here` micromark decodes the escape, so the node value
 * holds `see /Users/x/workspace here` - the token is at index 4, not at index 0 -
 * while the raw text this function scans holds `\/…` with a predecessor no
 * `ALLOWED_PREFIX` member admits. Measured: this returns `[]` for that document
 * while the walker links the spelling as soon as a row has primed it, on this
 * head and on `74f6ea96c` alike, so it is a gap this rule neither introduced nor
 * closes (an entity before a token, `see &#47;…`, is the same class). It is
 * pinned where the boundary is - `scripts/link-targets.test.mjs`.
 *
 * BEYOND THAT RULE the superset gap is the walker's own refusals: `text` is a
 * whole markdown document, so this sees a path inside a code fence or inside an
 * existing link's label, which the plugin never visits. The cost is at most a
 * handful of extra answers per row, asked once per spelling per session and
 * cached by the same map the toolbar uses (`link-actions.ts`'s `evidenceFor`);
 * the alternative is a second scanner (`docs/branding.md` § 9) or a two-pass
 * parse.
 *
 * The property that makes it checkable rather than merely plausible: for any
 * `text`, this returns exactly the `path` targets that `DISCOVERY_POLICY` admits
 * and `{ ...LINK_POLICY, evidence: () => "missing" }` refuses - asserted in
 * `scripts/link-targets.test.mjs`, which is what keeps the query and the gate
 * from drifting apart.
 */
export function ambiguousTargetsIn(text: string): string[] {
	const seen = new Set<string>();
	const suspects: TargetSpan[] = [];
	for (const span of targetsIn(text, DISCOVERY_POLICY)) {
		if (span.kind !== "path") continue;
		if (!isAmbiguousCandidate(span.target)) continue;
		suspects.push(span);
	}
	/*
	 * EVERY directory-anchored listed candidate is a suspect: with an oracle
	 * present, `listedEntryFor` admits none of them without the disk's "exists"
	 * (round 1, review F1 / QA Q1), and the oracle can only answer what was
	 * asked. `DISCOVERY_POLICY` suspends that question, so this is exactly the
	 * set of shapes the transcript could link - the same property as the rest of
	 * this query, with no second walk to diff (round 1, review F7).
	 */
	suspects.push(...listedTargetsIn(text, DISCOVERY_POLICY));
	return suspects
		.sort((a, b) => a.start - b.start)
		.map((span) => span.target)
		.filter((target) => {
			if (seen.has(target)) return false;
			seen.add(target);
			return true;
		});
}

/* ======================================================= directory-anchored listing */

/**
 * THE AGENT IDIOM THIS SECTION EXISTS FOR (operator report, 2026-10-27).
 *
 * An agent naming its deliverables very often writes the directory ONCE and the
 * files under it as bare names:
 *
 *   Files are in `~/Documents/Radient/`:
 *   - Radient-IP-Scope-for-Counsel-2026-10-27.pdf
 *   - Radient-IP-Scope-for-Counsel-2026-10-27 (editable).docx
 *
 * The rest of this grammar refuses a bare name on purpose - with no cwd,
 * admitting `notes.md` means guessing a root - so both deliverables were dead
 * text in the transcript and absent from the Files panel, while the directory
 * above them linked. The listing supplies the root the bare name lacks: the
 * ABSOLUTE directory that introduces the list. That is not a guess; the agent
 * wrote it, one line up, as the thing the list is "in".
 *
 * WHY THE SHAPE IS SO NARROW. Each condition is the one that keeps the rule from
 * becoming the relative-path guess the header refuses:
 *
 * - The introducer is the LAST target on its line and the line ENDS with `:`.
 *   "I looked in ~/x/ and found these:" names a directory mid-sentence and says
 *   nothing about where the following names live; only a line that ends on the
 *   directory and a colon is a heading for what follows.
 * - Only the IMMEDIATELY following list, and only its own items. A list after a
 *   paragraph, a nested list, a later list: each is a new context the introducer
 *   no longer speaks for.
 * - An item is resolved only when its WHOLE text is one name - no `/` (a sub-path
 *   or an absolute path is the existing rules' business), no line break, no
 *   placeholder, and an extension that is a short alphanumeric token. Spaces and
 *   parentheses are allowed because the whole item is the name
 *   (`X (editable).docx` is a real deliverable), and that is why the extension
 *   test is the backstop: `Open report.pdf for the summary` has the "extension"
 *   `pdf for the summary` and is refused, a sentence with no dot has none at all.
 *   A name containing whitespace additionally needs a KNOWN extension on BOTH
 *   surfaces, because whitespace is where a list of names and a list of phrases
 *   overlap and a known extension is the one positive signal left.
 * - A bare name WITHOUT an introducer stays unresolved, exactly as before.
 * - An ANNOTATED item - `<name><separator><description>` - resolves its head only,
 *   and only with the disk's word for it. See `LISTED_ANNOTATION_SEPARATORS` and
 *   `listedEntryFor`, which carry the exact contract.
 *
 * ONE GRAMMAR, TWO WALKERS. The Files panel reads the raw markdown string and
 * the transcript reads the mdast, so each walks lines or nodes its own way, but
 * BOTH ask the two questions below - `listingDirectoryIn` (is this line an
 * introducer, and of which directory) and `listedEntryFor` (is this item a name,
 * and what does it resolve to under this policy) - so "where does a listed name
 * end" has one answer. `listedTargetsIn` is the panel's line walker; the
 * transcript's is the `list` branch in `remark-linkify-targets.ts`.
 *
 * WHAT THE POLICIES DO HERE. `knownExtensionRequired` keeps its meaning (the
 * panel admits only a known extension). An extensionless list item (`Done`,
 * `Makefile`) is refused by shape rather than probed. EVERY other listed
 * candidate - whole item or annotated head - takes the evidence gate when the
 * policy carries an oracle (see `listedEntryFor`), whatever its extension, and
 * `ambiguousTargetsIn` lists every one of them so the renderer asks the disk
 * before it can link one. Without an oracle (`MENTION_POLICY`) nothing with
 * whitespace, a separator or an unknown extension is admitted at all.
 */

/** What may follow the introducer's directory: closing emphasis/code, then a colon. */
const LISTING_INTRODUCER_TAIL = /^[`*_]*\s*:\s*$/;

/** The cheap pre-test for an introducer: the line's last character is a colon. */
const ENDS_WITH_COLON = /:\s*$/;

/** A listed name's extension: a short alphanumeric token, never a phrase. */
const LISTED_EXTENSION = /^[a-z0-9]{1,10}$/;

/** Sentence punctuation a list item may end with that no name ends with. */
const LISTED_TRAILING_PUNCTUATION = /[.,;:]+$/;

/**
 * The directory a line INTRODUCES as the root of a following list, or null.
 *
 * The directory token is found by the SAME scanner as every other target, with
 * the evidence question suspended (`DISCOVERY_POLICY`): the directory is never
 * emitted as a target by this rule, only used as a root, and the panel has no
 * oracle to ask. What stands in for the disk is shape: the token must read as a
 * directory (a trailing slash or no extension) and must not be a one-segment
 * `/word`, which is as likely a slash command (`Run /new:`) as a folder - `~/x`,
 * `/tmp/out` and any `file://` URL qualify, a bare `/tmp` does not. That refusal
 * is a deliberate cost: a list under `/tmp:` stays unresolved.
 */
export function listingDirectoryIn(line: string): string | null {
	// Most lines end in no colon at all, and they are refused before the scanner
	// runs: the panel asks this of every line of every record it reads.
	if (!ENDS_WITH_COLON.test(line)) return null;
	/*
	 * A HEADING or BLOCKQUOTE line never introduces, on either walker (round 1,
	 * review F3). Decided here, once, because both walkers hand this function the
	 * RAW source line: the transcript's mdast already refuses a heading (it is not
	 * a paragraph), and a quoted paragraph's raw line still starts `>`. Refusing
	 * both is the fail-safe direction - `## Files in ~/out/:` misses its links -
	 * and is what the panel's line walker can match without walking quotes.
	 */
	const content = line.slice(CONTENT_INDENT.exec(line)?.[0].length ?? 0);
	if (QUOTE_OR_HEADING.test(content)) return null;
	const spans = targetsIn(line, DISCOVERY_POLICY);
	const last = spans[spans.length - 1];
	if (!last) return null;
	if (!LISTING_INTRODUCER_TAIL.test(line.slice(last.end))) return null;
	const directory = last.target;
	/*
	 * DIRECTORY SHAPE (round 1, review F2): a trailing slash, or a last segment
	 * with no dot past its first character (a dot-directory like `~/.config` is
	 * a directory name, not an extension). The oracle answers
	 * exists/missing/unknown, not "is a directory", so it cannot vouch for the
	 * introducer itself; what it does vouch for on the transcript is every ITEM
	 * (`listedEntryFor`), and `<dir>/<name>` existing proves `<dir>` is a
	 * directory - a file has no children. So `Edit ~/repo/Makefile:` (no dot,
	 * shape-admitted) costs one probe of `~/repo/Makefile/<item>`, which says
	 * missing, and nothing links; `~/repo/v1.2.3:` and `~/x/Next.js:` are
	 * refused here before any probe. The legacy panel has no oracle, so for it
	 * `Makefile:` stays a root and only its known-extension rule applies.
	 */
	const lastSegment = directory.slice(directory.lastIndexOf("/") + 1);
	const isDirectory =
		directory.endsWith("/") || lastSegment.indexOf(".", 1) === -1;
	if (!isDirectory) return null;
	const rooted =
		last.kind === "file-url" ||
		directory.startsWith("~/") ||
		directory.indexOf("/", 1) !== -1;
	return rooted ? directory : null;
}

/**
 * `<directory>/<name>` for one list item's WHOLE text, admitted by SHAPE under
 * `policy`, or null. See the section header for every rejection and why. This is
 * the shape half only: `listedEntryFor` adds the evidence half, which decides.
 */
export function listedTargetFor(
	directory: string,
	item: string,
	policy: TargetPolicy,
): string | null {
	const name = item.trim().replace(LISTED_TRAILING_PUNCTUATION, "");
	if (!name || name.length > MAX_CANDIDATE_LENGTH) return null;
	if (LINE_BREAK.test(name)) return null;
	if (name.includes("/") || name.includes("\\")) return null;
	if (PLACEHOLDER_MARKERS.test(name)) return null;
	const extension = extensionOf(name);
	if (!extension || !LISTED_EXTENSION.test(extension)) return null;
	const known = KNOWN_EXTENSIONS.has(extension);
	if (policy.knownExtensionRequired && !known) return null;
	if (WHITESPACE.test(name) && !known) return null;
	/*
	 * No oracle (the legacy Files scan, `MENTION_POLICY`): nothing can tell a
	 * name with a space in it from a sentence that ends in one (`Fixed the parser
	 * in parse.ts`), and every annotation separator carries a space - so only a
	 * whitespace-free name with a KNOWN extension is admitted. The cost, stated:
	 * `X (editable).docx` gets no tile from this scan. The current daemon's Files
	 * panel is the backend's session-files ledger, which stats every name, so the
	 * shape this refuses is still answered there.
	 */
	if (!policy.evidence && (WHITESPACE.test(name) || !known)) return null;
	return `${directory.replace(TRAILING_SLASHES, "")}/${name}`;
}

/**
 * The separators that split an ANNOTATED list item into `<name>` and a
 * description, EXACTLY these four, spaces included:
 *
 *   " — "  (space, U+2014 em dash, space)
 *   " – "  (space, U+2013 en dash, space)
 *   " - "  (space, U+002D hyphen-minus, space)
 *   ": "   (U+003A colon, space)
 *
 * WHY: listing a deliverable with a note after it is the normal agent shape -
 * the operator's own report (2026-10-27, 12:27) ended
 * `- Radient-IP-Scope-for-Counsel-2026-10-27 (editable).docx — the same text
 * without the Radient styling, so the lawyers can mark it up`. The spaces are
 * part of every dash separator so that a hyphen INSIDE a filename
 * (`2026-10-27`) never splits it, and the colon needs only the space after it
 * because that is how a note is written (`report.pdf: the summary`) and a colon
 * is not a character a listed name carries. TO BE MIRRORED 1:1 by the backend's
 * session-files ledger (`local_operator/session_files/scan.py`) in the in-flight
 * core PR damianvtran/local-operator#3041 - not on that repository's main yet;
 * once it lands, a change here is a change there.
 */
export const LISTED_ANNOTATION_SEPARATORS = [
	" — ",
	" – ",
	" - ",
	": ",
] as const;

/** One resolved list item: its target, and how much of the item's text is the name. */
export type ListedEntry = {
	/** `<directory>/<name>`. */
	target: string;
	/** Length of the name at the start of the (trimmed) item text: the span a link covers. */
	length: number;
};

/**
 * Where the first annotation separator starts in `item`, or -1.
 *
 * The FIRST one, by position, across all four: the head is everything before it.
 */
const firstSeparatorIn = (item: string): number => {
	let at = -1;
	for (const separator of LISTED_ANNOTATION_SEPARATORS) {
		const index = item.indexOf(separator);
		if (index > 0 && (at === -1 || index < at)) at = index;
	}
	return at;
};

/**
 * THE LISTED-ITEM RULE: what one list item under an introducing directory
 * resolves to, or null. Both surfaces call this - the transcript's `list` walker
 * and the Files panel's `listedTargetsIn` - so the contract is here once:
 *
 * 1. ANNOTATED, tried first. The item contains one of
 *    `LISTED_ANNOTATION_SEPARATORS`; the HEAD is the text before the FIRST
 *    separator (by position). The head resolves only when ALL of:
 *    - it is a complete name by `listedTargetFor`'s rules (no `/` or `\`, no
 *      placeholder, no line break);
 *    - its extension is in `KNOWN_EXTENSIONS` (the panel's `MENTION_POLICY`
 *      list) on EITHER surface - a head is cut out of prose, and a known
 *      extension is the one positive sign that it is a name and not a phrase
 *      (`Run the tests - they pass` has none and stays plain);
 *    - the disk says `<directory>/<head>` EXISTS: `policy.evidence` answers
 *      "exists". Absent oracle, "missing" and "unknown" all refuse - the same
 *      gate an ambiguous prose token takes in `targetsIn`, applied here to every
 *      annotated head because a cut is a guess the shape alone cannot back.
 *      Consequence, stated: `MENTION_POLICY` carries no oracle, so the renderer's
 *      legacy Files scan never admits an annotated head (the backend's ledger,
 *      which stats, is the panel's answer for that shape).
 *    Once a head qualifies by SHAPE the decision is final: a head the disk
 *    refuses is not retried as a whole-item name, because the whole item is
 *    then a name plus prose, and linking it would be the wrong claim.
 * 2. WHOLE ITEM, otherwise: the entire item text is one name by
 *    `listedTargetFor`'s SHAPE rules, AND - when the policy carries an oracle -
 *    the disk says `<directory>/<name>` EXISTS, the same gate as a head (round 1,
 *    review F1 / QA Q1). A bare listed name is a guess anchored on the line
 *    above, weaker than an `/abs` token the agent spelled out in full, so shape
 *    alone never links it: `Fixed the parser in parse.ts`, `Notes: final.pdf`,
 *    `Next.js` and a deliverable that was never written all stay plain unless
 *    they are on disk. With NO oracle (the legacy Files scan), `listedTargetFor`
 *    admits only a whitespace-free name with a known extension instead.
 *
 * Missing and unknown refuse alike, on both branches. A sentence item, and a
 * head with no known extension, stay unresolved. Only the HEAD is ever a link; the description is never part of
 * the span (`length`).
 */
export function listedEntryFor(
	directory: string,
	item: string,
	policy: TargetPolicy,
): ListedEntry | null {
	const text = item.trim();
	const at = firstSeparatorIn(text);
	if (at > 0) {
		const head = text.slice(0, at);
		const extension = extensionOf(head);
		if (extension !== null && KNOWN_EXTENSIONS.has(extension)) {
			const target = listedTargetFor(directory, head, policy);
			// The trailing-punctuation trim must not have changed the head: the span
			// covers what was written, and a target that differs from it is a guess.
			if (target?.endsWith(`/${head}`)) {
				if (policy.evidence?.(target) !== "exists") return null;
				return { target, length: head.length };
			}
		}
	}
	const target = listedTargetFor(directory, text, policy);
	if (!target) return null;
	// The same gate as a head: a bare name is a guess anchored on the line above,
	// weaker than an `/abs` token the agent spelled out (round 1, F1 / Q1).
	if (policy.evidence && policy.evidence(target) !== "exists") return null;
	return {
		target,
		length: target.length - target.lastIndexOf("/") - 1,
	};
}

/** A markdown list item line: indent, marker, optional GFM task box, content. */
const LIST_ITEM_LINE =
	/^(\s*)([-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?(.*)$/;

/**
 * What identifies ONE list to CommonMark: the bullet character, or an ordered
 * list's delimiter. `- a` then `+ b` are two lists, and the second follows a
 * list rather than its introducer, so it is not resolved on either surface.
 */
const markerKind = (marker: string): string =>
	ORDERED_MARKER.test(marker) ? `ordered${marker.slice(-1)}` : marker;

/** An ordered list marker (`1.`, `2)`), as opposed to a bullet. */
const ORDERED_MARKER = /^\d/;

/** An item that is exactly one code span, whose content is the name. */
const WHOLE_CODE_SPAN = /^`([^`]+)`$/;

/** A CRLF line's carriage return, which `split("\n")` leaves on the line. */
const CARRIAGE_RETURN = /\r$/;

/** Where an introducer's own CONTENT starts, past any list marker it sits in. */
const CONTENT_INDENT = /^\s*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?/;

/** A line's content that opens a blockquote or an ATX heading. */
const QUOTE_OR_HEADING = /^(?:>|#{1,6}(?:[ \t]|$))/;

/** A fence line: up to any indent, three or more backticks or tildes, then info. */
const FENCE_LINE = /^\s*(`{3,}|~{3,})(.*)$/;

/** An ordered marker's number, for CommonMark's "only `1.` interrupts" rule. */
const ORDERED_START = /^(\d+)/;

/** Indent in columns, a tab advancing to the next multiple of four. */
const indentColumns = (line: string): number => {
	let columns = 0;
	for (const char of line) {
		if (char === " ") columns += 1;
		else if (char === "\t") columns += 4 - (columns % 4);
		else break;
	}
	return columns;
};

/**
 * Which lines sit in a CODE region - a fenced block (its fence lines included) or
 * an indented code block - which the transcript's mdast never walks for a
 * listing (round 1, review F3: the panel resolved a listing inside both).
 *
 * An APPROXIMATION of CommonMark's block parse, scoped to what this walker needs
 * and erring toward "code" only where that drops a tile, never adds one:
 * - a fence opens at any indent (deeper than three spaces it is indented code
 *   instead, which is code all the same) and closes on a run of the same
 *   character at least as long, alone on its line; an unclosed fence runs to the
 *   end, as CommonMark's does;
 * - an indented block is a line four columns in, after a blank line (or at the
 *   start), outside a list - inside a list that indent is item content, not
 *   code - and it runs over blank lines until a shallower line.
 */
const codeLinesOf = (lines: readonly string[]): boolean[] => {
	const code: boolean[] = [];
	let fence: { char: string; length: number } | null = null;
	let previousBlank = true;
	let inList = false;
	let inIndented = false;
	for (const raw of lines) {
		const line = raw.replace(CARRIAGE_RETURN, "");
		const blank = line.trim() === "";
		if (fence) {
			code.push(true);
			const trimmed = line.trim();
			let run = 0;
			while (trimmed[run] === fence.char) run += 1;
			if (run >= fence.length && run === trimmed.length) fence = null;
			previousBlank = false;
			continue;
		}
		const open = FENCE_LINE.exec(line);
		// A backtick fence's info string may not hold a backtick: that line is an
		// inline code span that happens to start it (`markdown-remend.ts`'s rule).
		const marker = open?.[1] ?? "";
		if (open && !(marker[0] === "`" && (open[2] ?? "").includes("`"))) {
			fence = { char: marker[0] ?? "`", length: marker.length };
			code.push(true);
			inIndented = false;
			previousBlank = false;
			continue;
		}
		const indent = indentColumns(line);
		if (!blank && indent >= 4 && (inIndented || (previousBlank && !inList))) {
			code.push(true);
			inIndented = true;
			previousBlank = false;
			continue;
		}
		if (!blank) {
			inIndented = false;
			inList =
				LIST_ITEM_LINE.test(line) || (inList && (indent > 0 || !previousBlank));
		}
		code.push(false);
		previousBlank = blank;
	}
	return code;
};

/** Markdown's backslash escapes, which the mdast decodes and a raw line keeps. */
const MARKDOWN_ESCAPE = /\\([!-/:-@[-`{-~])/g;

/** An item that OPENS with one code span, which an annotation may follow. */
const LEADING_CODE_SPAN = /^`([^`]+)`(.*)$/;

/**
 * One item's text as the mdast would hold it, plus how many raw characters the
 * name's span is offset by: escapes decoded, and a whole or LEADING code span
 * unwrapped (`` `X.docx` — note `` reads as `X.docx — note`, the head being the
 * code span's own value - the shape the transcript walker sees as an
 * `inlineCode` node followed by a `text` node).
 */
const itemText = (content: string): { text: string; code: boolean } => {
	const trimmed = content.trim();
	const whole = WHOLE_CODE_SPAN.exec(trimmed);
	if (whole) return { text: whole[1] ?? "", code: true };
	const leading = LEADING_CODE_SPAN.exec(trimmed);
	if (leading) {
		return {
			text: `${leading[1] ?? ""}${(leading[2] ?? "").replace(MARKDOWN_ESCAPE, "$1")}`,
			code: true,
		};
	}
	return { text: trimmed.replace(MARKDOWN_ESCAPE, "$1"), code: false };
};

/**
 * Every listed target in a raw markdown string, as spans over the item's name,
 * in document order - the Files panel's walker (see the section header).
 *
 * It follows CommonMark's list structure as far as the transcript's mdast would
 * see it, so the two surfaces resolve the same items:
 *
 * - blank lines may separate the introducer from the list and items from each
 *   other (a loose list is still the list);
 * - the list's items sit at the indent of its first item, which must be inside
 *   the introducer's own block (at or past its content indent, under four more);
 *   a deeper marker is a NESTED list and is skipped, a shallower one ends it;
 * - a non-marker line straight after an item is a continuation of that item, so
 *   the item is no longer one name and is dropped; after a blank line, a
 *   non-marker line that is not indented under the list ends the list.
 *
 * - an ordered list straight under the introducer must start at `1`, the only
 *   number CommonMark lets interrupt a paragraph;
 * - an introducer inside a code region (fenced or indented, `codeLinesOf`) is
 *   not one, and a heading or blockquote line never introduces
 *   (`listingDirectoryIn`) - on the transcript too.
 *
 * That parity is asserted, input by input, through both walkers in
 * `scripts/link-targets.test.mjs`. What it does NOT claim: this is a line
 * approximation of CommonMark, not a parser, so an exotic block shape (a list
 * inside a quote, HTML blocks, setext headings) is not modelled. Each of those
 * resolves here only where the shape above matches, and the panel's oracle-free
 * policy admits only whitespace-free known-extension names, so the worst
 * disagreement is one tile the transcript would not link.
 */
export function listedTargetsIn(
	text: string,
	policy: TargetPolicy,
): TargetSpan[] {
	if (!text.includes(":")) return [];
	const found: TargetSpan[] = [];
	const lines = text.split("\n");
	const offsets: number[] = [];
	let offset = 0;
	for (const line of lines) {
		offsets.push(offset);
		offset += line.length + 1;
	}
	const code = codeLinesOf(lines);
	for (let index = 0; index < lines.length; index += 1) {
		if (code[index]) continue;
		const introducer = lines[index] ?? "";
		const directory = listingDirectoryIn(introducer);
		if (!directory) continue;
		const floor = CONTENT_INDENT.exec(introducer)?.[0].length ?? 0;
		let base: number | null = null;
		let marker = "";
		let pending: TargetSpan | null = null;
		let blank = false;
		let cursor = index + 1;
		for (; cursor < lines.length; cursor += 1) {
			const line = (lines[cursor] ?? "").replace(CARRIAGE_RETURN, "");
			if (line.trim() === "") {
				blank = true;
				continue;
			}
			const item = LIST_ITEM_LINE.exec(line);
			const indent = line.length - line.trimStart().length;
			if (code[cursor]) {
				// A fence at the list's level ends it (fenced code interrupts a
				// paragraph); one indented under an item makes that item more than
				// one name, which the transcript walker refuses too.
				if (base !== null && indent > base) {
					pending = null;
					continue;
				}
				break;
			}
			if (!item) {
				// Before the first item nothing introduces anything any more; after
				// it, a line straight under an item continues that item, and one
				// after a blank line ends the list unless it is indented under it.
				if (base === null) break;
				if (!blank) {
					pending = null;
					continue;
				}
				if (indent > base) {
					pending = null;
					continue;
				}
				break;
			}
			const afterBlank = blank;
			blank = false;
			const kind = markerKind(item[2] ?? "");
			if (base === null) {
				if (indent < floor || indent > floor + 3) break;
				// CommonMark: only an ordered list starting at 1 may interrupt a
				// paragraph; `2.` straight under the introducer is that paragraph's
				// continuation, so the mdast has no list there (round 1, F3).
				const number = ORDERED_START.exec(item[2] ?? "")?.[1];
				if (!afterBlank && number !== undefined && Number(number) !== 1) break;
				base = indent;
				marker = kind;
			}
			if (indent > base) continue; // a nested list: a new context
			if (indent < base || kind !== marker) break;
			if (pending) found.push(pending);
			pending = null;
			const content = item[3] ?? "";
			const read = itemText(content);
			const entry = listedEntryFor(directory, read.text, policy);
			if (!entry) continue;
			const start = (offsets[cursor] ?? 0) + line.length - content.length;
			pending = {
				start,
				// A code-wrapped name's span keeps its two backticks.
				end: start + entry.length + (read.code ? 2 : 0),
				kind: "path",
				target: entry.target,
				href: entry.target,
			};
		}
		if (pending) found.push(pending);
		// The list's own lines cannot introduce another list at this level.
		index = Math.max(index, cursor - 1);
	}
	return found;
}
