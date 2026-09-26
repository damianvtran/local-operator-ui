/**
 * What changed in the server release the app is about to offer.
 *
 * THE GAP THIS FILLS. The panel that offers a server update named two version
 * numbers and a benefit sentence - "Updating the server will improve AI
 * functionality, improve security, and fix bugs" - so a reader deciding whether
 * to move had nothing about what actually moved. The app's OWN update panel has
 * carried release notes since it was written (electron-updater puts them in the
 * update feed), and that asymmetry is what this module removes: one card saying
 * what changed and the other saying only that something had.
 *
 * WHERE THE NOTES COME FROM. GitHub Releases, because that is where this
 * project's release notes are written: the release owner creates the Release by
 * hand and its body IS the notes (the server repository's release procedure ends
 * in `gh release create ... --notes-file <notes>`). The registry the app already
 * reads for the VERSION cannot answer this question - `pypi.org/pypi/
 * local-operator/json` carries files and metadata and no per-version prose at
 * all - so the version read and the notes read are deliberately two calls to two
 * hosts, and this one is allowed to fail without taking the offer with it.
 *
 * ONE REQUEST PER VERSION PER MACHINE, which is the whole rate-limit story. The
 * API is unauthenticated here, so it is bounded at 60 requests an hour per
 * address - and an offer that stands for a day is re-checked every few minutes
 * against the same tag, which would spend that budget on a fact that has not
 * changed. So a version's notes are fetched once and then read from
 * `server-release-notes.json` in userData: in memory for the life of the
 * process, on disk across launches. A published release's body is treated as
 * immutable once read, because the alternative is a request per check forever;
 * the panel's own link is the surface that always shows the release's current
 * text, so a note edited after publication is one click away rather than
 * invisible.
 *
 * WHAT IT SHOWS, AND WHAT IT DELIBERATELY DOES NOT. What the panel renders is
 * the release body's LEAD - the sentence or two the release owner wrote to say
 * what the version is about - flattened to one run of plain text and bounded to
 * `SUMMARY_LIMIT`, with a link out for the rest. That is the shape the app's own
 * panel already gives its notes (a bounded lead plus a link), so the two update
 * cards read the same way. It is PLAIN TEXT rather than rendered markdown
 * because the markdown pipeline this app owns is the chat transcript's - katex,
 * mermaid, credential citations, a block scanner over the whole document - and
 * pulling that into a card that shows at most 400 characters is a dependency
 * cost the surface does not earn. What the flattening drops (headings, bullet
 * markers, emphasis, link targets) is exactly the markup a one-paragraph lead
 * would spend its budget on rather than on words.
 *
 * PURE WHERE IT CAN BE. Nothing here imports electron. The parsers, the cache
 * and the summary rule are plain functions over strings and JSON, so
 * `scripts/server-release-notes.test.mjs` bundles this module from the shipped
 * TypeScript and exercises the lookup against a real loopback server with no
 * Electron fixture standing in for the transport.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import { join } from "node:path";

/**
 * The repository whose GitHub Releases carry the server's release notes.
 *
 * The SERVER, not the app: `damianvtran/local-operator` is the python package
 * this panel offers to update, and `local-operator-ui` is the application whose
 * own notes arrive through the update feed. Naming the wrong one here would put
 * the app's notes on the server's card, which is the one confusion this whole
 * change is about.
 */
export const SERVER_RELEASE_REPO = "damianvtran/local-operator";

/**
 * Where the lookup goes.
 *
 * Exported and overridable so the test can point the module at a loopback
 * server and exercise its real request path - headers, status handling, timeout,
 * JSON parse - rather than a stubbed transport that proves nothing about it.
 */
export const GITHUB_API_ORIGIN = "https://api.github.com";

/** The cache file, inside the app's own userData directory. */
export const RELEASE_NOTES_CACHE_FILE = "server-release-notes.json";

/**
 * How much of the release's lead the panel shows.
 *
 * The same 400 characters the app's own panel truncates its notes to, so the
 * two cards break at the same width and neither is the odd one out on a screen
 * that shows one after the other.
 */
export const SUMMARY_LIMIT = 400;

/**
 * How long the lookup may hold up the offer.
 *
 * The offer is the thing this lookup decorates, so it is bounded rather than
 * awaited indefinitely: a machine whose route to api.github.com blackholes an
 * address would otherwise sit on a check for as long as the kernel takes to give
 * up. Measured against the existing version read, which has no timeout at all,
 * this is the stricter of the two calls on the same panel.
 */
export const RELEASE_NOTES_TIMEOUT_MS = 4000;

/** How many versions the cache keeps before the oldest is dropped. */
export const CACHE_LIMIT = 12;

/**
 * The largest answer this lookup will read.
 *
 * A release body is a few kilobytes. The bound exists so a hostile or broken
 * endpoint cannot stream an unbounded body into the main process on a path that
 * runs at launch - not because any answer this endpoint has ever given came
 * close to it.
 */
const MAX_RESPONSE_BYTES = 512 * 1024;

/** What the panel renders, and what the cache stores. */
export type ServerReleaseNotes = {
	/** The published version these notes describe, as the offer names it. */
	version: string;
	/** The release's lead, flattened to plain text and bounded to `SUMMARY_LIMIT`. */
	summary: string;
	/** The release page, for the panel's "View full release notes" link. */
	url: string;
};

/** Version -> notes, keyed the way the offer names a version (`0.62.34`). */
export type ReleaseNotesCache = Record<string, ServerReleaseNotes>;

/**
 * What one lookup found, in the shape the caller logs and the panel reads.
 *
 * `absent` carries a sentence rather than a bare null because the four ways this
 * can come back empty are four different facts about the machine - no release
 * for the tag, an unreachable host, a non-200, an empty body - and the update
 * service log is the only place any of them can be told apart when a user asks
 * why the panel had no notes.
 */
export type ReleaseNotesLookup =
	| { status: "found"; notes: ServerReleaseNotes; cached: boolean }
	| { status: "absent"; reason: string };

/** A tag that already carries the prefix every release in this repository uses. */
const TAG_PREFIX = /^v/i;

/** The tag a version is published under. `0.62.34` -> `v0.62.34`. */
export function releaseTag(version: string): string {
	const trimmed = String(version ?? "").trim();
	if (!trimmed) return "";
	return TAG_PREFIX.test(trimmed) ? trimmed : `v${trimmed}`;
}

/** The GitHub release page for a version. */
export function releasePageUrl(version: string): string {
	return `https://github.com/${SERVER_RELEASE_REPO}/releases/tag/${releaseTag(version)}`;
}

/** Where the cache lives for one userData directory. */
export function releaseNotesCachePath(userDataDir: string): string {
	return join(userDataDir, RELEASE_NOTES_CACHE_FILE);
}

/**
 * A cache read that can only ever answer with well-formed entries.
 *
 * A cache is not a source of truth and must not be able to break the panel that
 * reads it: a truncated write, a hand-edited file or a record from an older
 * shape becomes "no notes" rather than a thrown error inside a check, which is
 * why every entry is validated here rather than trusted.
 */
function normaliseCache(parsed: unknown): ReleaseNotesCache {
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
	const cache: ReleaseNotesCache = {};
	for (const [version, entry] of Object.entries(
		parsed as Record<string, unknown>,
	)) {
		if (!entry || typeof entry !== "object") continue;
		const { version: named, summary, url } = entry as Record<string, unknown>;
		if (typeof summary !== "string" || !summary.trim()) continue;
		if (typeof url !== "string" || !url.trim()) continue;
		cache[version] = {
			version: typeof named === "string" && named ? named : version,
			summary,
			url,
		};
	}
	return cache;
}

/** Every cached version, or an empty cache when there is none to read. */
export function readReleaseNotesCache(userDataDir: string): ReleaseNotesCache {
	try {
		return normaliseCache(
			JSON.parse(readFileSync(releaseNotesCachePath(userDataDir), "utf8")),
		);
	} catch {
		return {};
	}
}

/**
 * Persist the cache.
 *
 * A write failure is not the caller's business: the notes are already in hand
 * and the panel renders from them, so the only thing lost is the NEXT launch's
 * request - which is a request this lookup is allowed to make anyway. What it
 * must not do is take a check down, so it never throws.
 */
export function writeReleaseNotesCache(
	userDataDir: string,
	cache: ReleaseNotesCache,
): void {
	try {
		mkdirSync(userDataDir, { recursive: true });
		writeFileSync(
			releaseNotesCachePath(userDataDir),
			`${JSON.stringify(cache, null, 2)}\n`,
			"utf8",
		);
	} catch {
		// Deliberately swallowed - see the function's own note.
	}
}

/**
 * The cache with one version remembered, still bounded to `CACHE_LIMIT`.
 *
 * Insertion order is the eviction order, so the entry just written is the last
 * one dropped. A re-fetch of a version already present keeps its position, which
 * is fine: what the bound is for is a machine that has been through many
 * releases, not a precise LRU.
 */
export function rememberReleaseNotes(
	cache: ReleaseNotesCache,
	notes: ServerReleaseNotes,
): ReleaseNotesCache {
	const next: ReleaseNotesCache = { ...cache, [notes.version]: notes };
	const versions = Object.keys(next);
	if (versions.length <= CACHE_LIMIT) return next;
	const trimmed: ReleaseNotesCache = {};
	for (const version of versions.slice(versions.length - CACHE_LIMIT)) {
		trimmed[version] = next[version];
	}
	return trimmed;
}

/** The cached notes for a version, or null. */
export function cachedReleaseNotes(
	cache: ReleaseNotesCache,
	version: string,
): ServerReleaseNotes | null {
	return cache[String(version ?? "").trim()] ?? null;
}

/**
 * One release body's lead, as the panel shows it - or null when there is none.
 *
 * The rule, in order, and each step is there because a real release body needed
 * it:
 *
 * 1. Blocks, split on blank lines. The lead is the FIRST block that says
 *    something once markup is gone, which is what makes a body that opens with
 *    `## v0.62.33` (the house style) and one that opens with the summary
 *    sentence (also the house style) both come out right.
 * 2. Headings, horizontal rules and HTML comments drop out entirely - they are
 *    structure, and a 400-character budget spent on `## Fixes` is a budget spent
 *    on nothing.
 * 2b. So do MACHINE ROWS. The house style has two shapes, and one of them opens
 *    the window with a bare PR headline before the prose that describes it -
 *    `**#1477 — fix(mobile): rank the phone's session list on the shared
 *    catalog key, with shared pins (merge 3195481f6)**`. A reader offered an
 *    update is owed the sentence about what the release does, not a commit
 *    subject and a merge SHA, so a block that is one of those is stepped over
 *    exactly as a heading is. Measured over the 300 published releases when
 *    this rule was added: six would otherwise have led with a `#NNNN — ...`
 *    row, and every one of them had the prose paragraph directly below it.
 * 3. Blockquote and list markers drop out, and the block's lines join with a
 *    space, because a markdown paragraph is soft-wrapped and the flattening has
 *    to put its sentence back together.
 * 4. Inline markup unwraps to its text: links and images to their labels, code
 *    spans to their contents, `*`/`**` emphasis to the words. Emphasis is one
 *    tolerant pass rather than a bold pass followed by an italic one, because
 *    the release body that made this function wrong was
 *    `**A runtime whose event loop is *executing* ...**`: a `\*\*([^*]+)\*\*`
 *    cannot span the inner pair, so the italic pass then paired the wrong stars
 *    and the card showed a sentence with stray `*` in it - measured over the
 *    same corpus, three of 300 releases. Underscore emphasis is deliberately NOT
 *    unwrapped - release notes in this project name identifiers like
 *    `LOP_RUNTIME_ADOPT_SESSION`, and a rule that ate their underscores to
 *    render an italic nobody used would corrupt the one thing on the line worth
 *    reading.
 * 5. Whitespace collapses, and the result is bounded at a word boundary.
 */
export function summariseReleaseBody(
	body: unknown,
	limit = SUMMARY_LIMIT,
): string | null {
	if (typeof body !== "string") return null;
	const blocks = body.replace(CRLF, "\n").split(BLANK_LINE);
	for (const block of blocks) {
		const text = flattenBlock(block);
		if (text && !isMachineRow(text)) return truncateSummary(text, limit);
	}
	return null;
}

/**
 * Whether a flattened block is a release note's own bookkeeping rather than prose.
 *
 * Two shapes, both taken from the published corpus rather than invented.
 *
 * A PR HEADLINE IS A NUMBER, A DASH AND A TITLE - not any block that opens with
 * `#N`. The first spelling of this rule was `/^#\d+\b/`, and the corpus caught
 * what it cost: v0.49.9 opens with its own bullet lead,
 * `- **#687** \`de06da6c\` — viewing a session in a focused TUI now marks its
 * completion read ...`, which is prose about the change - and that rule stepped
 * over it and led the card with the `## Release record` paragraph instead, i.e.
 * it landed one block LATER than the failure it exists to prevent. Requiring the
 * dash keeps all five real machine rows skipped (v0.62.36, v0.62.35, v0.52.16,
 * v0.51.27, v0.51.26), restores v0.49.9's lead, and changes exactly one of the
 * 300 published summaries.
 *
 * The merge citation is the other shape: a row whose only content is the merge
 * it names, which carries nothing a reader can act on.
 */
function isMachineRow(text: string): boolean {
	return PR_HEADLINE.test(text) || MERGE_CITATION.test(text);
}

/*
 * The markup vocabulary, hoisted rather than written inline in the two functions
 * below. `useTopLevelRegex` is a lint rule here rather than a style preference,
 * and these two run once per block and once per line of every release body on a
 * path that executes at launch - so the cost the rule is about is real on this
 * file rather than theoretical.
 */
const CRLF = /\r\n?/g;
const BLANK_LINE = /\n{2,}/;
const HEADING_LINE = /^#{1,6}\s/;
const RULE_LINE = /^(?:[-*_]\s*){3,}$/;
const COMMENT_OPEN = /^<!--/;
const COMMENT_CLOSE = /-->$/;
const BLOCKQUOTE_MARKER = /^>\s?/;
const LIST_MARKER = /^(?:[-*+]|\d+[.)])\s+/;
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const CODE_SPAN = /`([^`]*)`/g;
/*
 * Where a code span waits while the emphasis pass runs. A PRIVATE-USE character
 * rather than a control one: biome refuses a control character in a regex, and
 * the sentinel has to be something a release body does not contain - U+E000 and
 * U+E001 are unassigned for exactly this kind of use.
 */
const CODE_PLACEHOLDER = /\uE000(\d+)\uE001/g;
/** The two code points the mask uses, removed from any input before masking. */
const MASK_ALPHABET = /[\uE000\uE001]/g;
/*
 * One tolerant pass over emphasis: triple, then double, then single, each
 * non-greedy so a run can span an inner pair of the other kind. Applied TWICE by
 * `flattenInline`, because a replace pass consumes what it matches - the inner
 * `*executing*` of `**... *executing* ...**` comes out of the first pass still
 * wrapped, and the second pass is what unwraps it.
 *
 * THE LOOKAROUNDS ARE NOT DECORATION: without them the single-star arm happily
 * pairs a lone `*` with the first star of the NEXT bold run, so
 * `a stray * star and **bold**` came out as `a stray star and bold*` - a literal
 * character displaced. A run may not begin or end inside a longer one, which is
 * what the four `(?<!\*)`/`(?!\*)` guards say. Measured over the corpus: byte-
 * identical summaries to the unguarded version, with that class fixed.
 */
const EMPHASIS =
	/(?<!\*)\*{3}([\s\S]+?)(?<!\*)\*{3}(?!\*)|(?<!\*)\*{2}([\s\S]+?)(?<!\*)\*{2}(?!\*)|(?<!\*)\*(?!\*)([\s\S]+?)(?<!\*)\*(?!\*)/g;
const WHITESPACE_RUN = /\s+/g;
/** `#1477 — title`: a number, a dash, then the title. See `isMachineRow`. */
const PR_HEADLINE = /^#\d+\s+[—–-]\s/;
const MERGE_CITATION = /\(merge [0-9a-f]{7,40}\)$/i;

/** One markdown block as a single run of readable text, or "" when it says nothing. */
function flattenBlock(block: string): string {
	const lines = block.split("\n").flatMap((line) => {
		const trimmed = line.trim();
		if (!trimmed) return [];
		if (HEADING_LINE.test(trimmed)) return [];
		if (RULE_LINE.test(trimmed)) return [];
		if (COMMENT_OPEN.test(trimmed) || COMMENT_CLOSE.test(trimmed)) return [];
		return [trimmed.replace(BLOCKQUOTE_MARKER, "").replace(LIST_MARKER, "")];
	});
	if (lines.length === 0) return "";
	return collapseWhitespace(flattenInline(lines.join(" ")));
}

/**
 * Inline markdown unwrapped to its text.
 *
 * CODE SPANS ARE TAKEN OUT OF THE TEXT WHILE EMPHASIS RUNS, and put back after.
 * Two properties need that, and each was measured on a released body rather than
 * imagined:
 *
 * - A span's contents are the one place a `*` is NOT markup, so unwrapping first
 *   and flattening after ate characters the rule exists to preserve: a lead
 *   naming two globs (`` `*.ts` ... `*.md` ``) came out as "the glob .ts ... as
 *   does .md".
 * - Splitting the text on spans instead - the obvious alternative, and what this
 *   function did for one round - breaks the OTHER direction, because emphasis is
 *   allowed to span a code span: `**The `foo` flag**` becomes three parts, so
 *   neither `**` is ever paired and both survive into the summary. Masking keeps
 *   the text contiguous for the emphasis pass.
 */
function flattenInline(text: string): string {
	const code: string[] = [];
	const masked = text
		/*
		 * THE MASK'S ALPHABET IS TAKEN OUT OF THE INPUT FIRST. A body containing
		 * U+E000 or U+E001 (none of the 300 published does) could otherwise
		 * impersonate a slot: a probe measured `"before \uE0000\uE001 after"`
		 * losing its middle and ``"\uE0000\uE001 and `real`"`` rendering the real
		 * span's contents twice. Substituting a space keeps the words apart and
		 * cannot be confused with a slot.
		 */
		.replace(MASK_ALPHABET, " ")
		.replace(IMAGE, "$1")
		.replace(LINK, "$1")
		.replace(CODE_SPAN, (_span, inner: string) => {
			code.push(inner);
			return `\uE000${code.length - 1}\uE001`;
		});
	const unwrapped = masked
		.replace(EMPHASIS, unwrapEmphasis)
		.replace(EMPHASIS, unwrapEmphasis);
	return unwrapped.replace(CODE_PLACEHOLDER, (placeholder, index: string) => {
		// A slot this pass did not mint cannot be filled, and deleting the text
		// that looks like one is the failure the alphabet strip exists to stop.
		return code[Number(index)] ?? placeholder;
	});
}

/** The words inside whichever emphasis run matched. */
function unwrapEmphasis(
	_match: string,
	triple: string | undefined,
	strong: string | undefined,
	italic: string | undefined,
): string {
	return triple ?? strong ?? italic ?? "";
}

/** One space between words, never a run of them, and no leading/trailing space. */
function collapseWhitespace(text: string): string {
	return text.replace(WHITESPACE_RUN, " ").trim();
}

/**
 * Bound a lead to `limit`, cutting at a word boundary rather than mid-word.
 *
 * The guard on the cut position is the one judgement here: a lead with no space
 * in its last stretch (a long URL, a wall of identifiers) would otherwise be cut
 * back to wherever the previous space happened to be, which can be far enough
 * back to throw away most of the summary. Inside the last half of the budget a
 * word boundary is worth taking; before that, a hard cut at the limit is the
 * better answer.
 *
 * A DANGLING FUNCTION WORD GOES WITH THE CUT. v0.62.33's lead continues "A
 * foreground `bash` call ...", and the word boundary landed exactly there - so
 * the card read "...refused before it runs. A..." with the link on the same
 * line, which looks like a sentence that stopped rather than a quote that was
 * cut.
 *
 * THE WORD LIST IS CLOSED, not "anything short". A length rule alone is
 * content-blind, and a probe found what it costs: with the cut landing right
 * after them it dropped `ms`, `GB`, `v2`, `IO`, `42`, `id` and `kg`, so "the
 * bound is 500 ms" could become "the bound is 500...". Articles and the short
 * prepositions and conjunctions are the words a cut may drop; a unit, an
 * identifier or a number never is, whatever its length.
 */
function truncateSummary(text: string, limit: number): string {
	if (text.length <= limit) return text;
	const cut = text.slice(0, Math.max(0, limit - 3));
	const lastSpace = cut.lastIndexOf(" ");
	const words = lastSpace > limit / 2 ? cut.slice(0, lastSpace) : cut;
	const trimmed = words.trimEnd();
	const dropped = DanglingWord.test(trimmed)
		? trimmed.slice(0, trimmed.lastIndexOf(" ")).trimEnd()
		: trimmed;
	/*
	 * A CUT CAN LAND INSIDE A MARKUP RUN, and then its delimiters are in the
	 * summary as characters - `**A shell command that wr...` is what the card
	 * would show for a lead that opens with an unclosed run. An unpaired run at
	 * either edge of the cut is markup the cut broke, so it goes; a run with a
	 * partner inside the kept text is left alone, because `flattenInline` has
	 * already had its chance at a complete pair.
	 *
	 * NO PUBLISHED RELEASE REACHES THIS TODAY, and the comment says so rather
	 * than implying a corpus instance: with the strip removed, none of the 300
	 * summaries changes. It is pinned by a unit case instead, because the failure
	 * it prevents is a literal `**` on the card and the next lead to open with an
	 * unclosed run is one release away.
	 */
	const balanced = stripUnpairedEmphasis(dropped);
	const sentence = balanced.replace(TRAILING_STOP, "");
	return `${sentence}...`;
}

/**
 * A final function word, which a cut may drop rather than leave at the seam.
 *
 * `and`, `the`, `for` and the rest are longer than two characters and so can
 * never reach the cut's last word anyway; the list is what the rule can actually
 * see, spelled out rather than inferred from length.
 */
const DanglingWord = /(?:^|\s)(?:a|an|as|at|by|in|of|on|or|to)$/i;
/** The stop a cut sentence already carries, so the marker does not double it. */
const TRAILING_STOP = /[.!?]$/;

/**
 * Drop an emphasis run the cut left without a partner, at either edge.
 *
 * Only the EDGES are considered, and only when the rest of the text holds no
 * asterisk at all: `the * in a glob` keeps its star, and a summary with a whole
 * pair inside it (`**scratchpad://**`) is not this function's business - the
 * inline pass has already had its chance at that text.
 */
function stripUnpairedEmphasis(text: string): string {
	const leading = text.match(/^\*{1,3}/);
	if (leading && !text.slice(leading[0].length).includes("*")) {
		return text.slice(leading[0].length).trimStart();
	}
	const trailing = text.match(/\*{1,3}$/);
	if (trailing && !text.slice(0, -trailing[0].length).includes("*")) {
		return text.slice(0, -trailing[0].length).trimEnd();
	}
	return text;
}

/**
 * A GitHub release payload as the notes the panel shows, or null.
 *
 * `html_url` is preferred over the URL this module can build, because that is
 * the address GitHub itself serves and it survives a repository rename; the
 * built URL is the fallback for an answer that named none.
 */
export function parseReleaseResponse(
	payload: unknown,
	version: string,
): ServerReleaseNotes | null {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return null;
	}
	const release = payload as Record<string, unknown>;
	const summary = summariseReleaseBody(release.body);
	if (!summary) return null;
	const url =
		typeof release.html_url === "string" && release.html_url.trim()
			? release.html_url.trim()
			: releasePageUrl(version);
	return { version: String(version).trim(), summary, url };
}

/**
 * The notes for a version: from the cache when this machine has them, and from
 * GitHub otherwise.
 *
 * Never throws and never rejects - every failure is one of `absent`'s reasons -
 * because the caller is composing the offer a reader is waiting for, and a
 * missing summary must not cost them the offer itself.
 */
export async function fetchServerReleaseNotes(
	version: string,
	options: {
		/** Where `server-release-notes.json` lives. */
		userDataDir: string;
		/** Overridable for the loopback test; production uses the GitHub API. */
		apiOrigin?: string;
		timeoutMs?: number;
	},
): Promise<ReleaseNotesLookup> {
	const named = String(version ?? "").trim();
	const tag = releaseTag(named);
	if (!tag) return { status: "absent", reason: "the offer named no version" };

	const cache = readReleaseNotesCache(options.userDataDir);
	const hit = cachedReleaseNotes(cache, named);
	if (hit) return { status: "found", notes: hit, cached: true };

	const origin = options.apiOrigin ?? GITHUB_API_ORIGIN;
	const url = `${origin}/repos/${SERVER_RELEASE_REPO}/releases/tags/${tag}`;

	let answer: { status: number; body: string };
	try {
		answer = await getJson(url, options.timeoutMs ?? RELEASE_NOTES_TIMEOUT_MS);
	} catch (error) {
		return {
			status: "absent",
			reason: `the lookup for ${tag} failed: ${
				error instanceof Error ? error.message : String(error)
			}`,
		};
	}
	if (answer.status !== 200) {
		return {
			status: "absent",
			reason: `GitHub answered ${answer.status} for ${tag}`,
		};
	}

	let payload: unknown;
	try {
		payload = JSON.parse(answer.body);
	} catch {
		return {
			status: "absent",
			reason: `GitHub's answer for ${tag} was not JSON`,
		};
	}

	const notes = parseReleaseResponse(payload, named);
	if (!notes) {
		return { status: "absent", reason: `the ${tag} release carries no notes` };
	}
	writeReleaseNotesCache(
		options.userDataDir,
		rememberReleaseNotes(cache, notes),
	);
	return { status: "found", notes, cached: false };
}

/**
 * One GET, bounded, over the protocol the URL names.
 *
 * THE BOUND IS SET TWICE, ON PURPOSE, because either half alone leaves a hole.
 * `timeout` in the request options is what covers the CONNECT: Node arms
 * `request.setTimeout` only once a socket is assigned, and for a socket that is
 * still connecting it defers the timer to the `connect` event
 * (`_http_client.js`, `if (sock.connecting) sock.once('connect', ...)`) - so a
 * blackholed route gets no timer of ours at all and waits out the agent's own
 * default, measured at 5.0 s against a 4 s setting before this line existed.
 * `request.setTimeout` is what covers the IDLE answer: a connection that is
 * established and then says nothing, which the option alone does not end.
 *
 * `http` is reachable as well as `https` so the test can run a real loopback
 * server and exercise this function rather than replace it. Nothing in the
 * product passes an `http` origin.
 */
function getJson(
	url: string,
	timeoutMs: number,
): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const settle = (finish: () => void) => {
			if (settled) return;
			settled = true;
			finish();
		};
		const fail = (error: unknown) =>
			settle(() =>
				reject(error instanceof Error ? error : new Error(String(error))),
			);

		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch (error) {
			fail(error);
			return;
		}

		const transport = parsed.protocol === "http:" ? http : https;
		const request = transport.get(
			parsed,
			{
				timeout: timeoutMs,
				headers: {
					// GitHub refuses a request with no user agent, and the versioned
					// media type is what pins the payload shape this module parses.
					"user-agent": "local-operator-ui",
					accept: "application/vnd.github+json",
				},
			},
			(response) => {
				const chunks: Buffer[] = [];
				let length = 0;
				response.on("data", (chunk: Buffer) => {
					length += chunk.length;
					if (length > MAX_RESPONSE_BYTES) {
						request.destroy();
						fail(new Error("the answer was larger than this lookup accepts"));
						return;
					}
					chunks.push(chunk);
				});
				response.on("end", () =>
					settle(() =>
						resolve({
							status: response.statusCode ?? 0,
							body: Buffer.concat(chunks).toString("utf8"),
						}),
					),
				);
				response.on("error", fail);
			},
		);
		request.setTimeout(timeoutMs, () => {
			request.destroy();
			fail(new Error(`no answer within ${timeoutMs}ms`));
		});
		request.on("error", fail);
	});
}
