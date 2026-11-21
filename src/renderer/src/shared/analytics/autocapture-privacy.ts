/**
 * The renderer's PostHog privacy filter: what autocapture may report about the
 * element a user clicked, and what an exception may say.
 *
 * WHY THIS EXISTS. Autocapture (`$autocapture`, `$rageclick`, `$dead_click`)
 * reports the clicked element's text (`$el_text`) and a serialisation of the
 * element and its ancestors (`$elements_chain`, or the older `$elements` array):
 * tag, classes, text and EVERY attribute value. posthog-js only scrubs inputs,
 * card numbers and SSNs. In this app the clickable things include file chips,
 * canvas rows, session titles and whole transcript blocks, so on 2026-11-21 the
 * external desktop users of project 145863 had sent, in 8 days: 141 events from
 * 19 users with filesystem paths and file names (a session scratchpad path
 * ending in a customer-named `.pdf`), 12 bare file names, 4 email-like strings
 * and 267 events from 30 users with element text over 120 characters (max 360).
 * Analytics consent covers PRODUCT USAGE, not user content, so none of that may
 * leave the machine. The 15,030 other events in that window were short control
 * labels ("Check again", "Send again", "More", "更多") that the onboarding funnel
 * and the daily check count, so those must arrive UNCHANGED.
 *
 * THE RULE (`scrubLabel`, applied to every element text and attribute value).
 * A value is replaced whole by `[redacted:<kind>]` when it
 *   - is wider than `MAX_LABEL_CHARS` (CJK counts 2 per char) -> long-text
 *   - contains a line break or tab                            -> multiline
 *   - contains an email address                               -> email
 *   - contains a URL (`scheme://`, `www.`, `mailto:`/`file:`) -> url
 *   - contains a path: POSIX (`/x`, `~/x`, `./x`, `a/b/c`),
 *     Windows (`C:\`, `C:/`, `\\host\`, `a\b`)                -> path
 *   - contains a file name (`name.ext`, ext 2-10 chars,
 *     starting with a letter: `report.pdf`, `报告.docx`)       -> filename
 *   - contains an opaque token (24+ id characters mixing
 *     letters and digits: keys, UUIDs)                        -> token
 * and is otherwise kept byte for byte. Hrefs keep only an http(s) origin or the
 * first segment of an in-app `#/route`; class lists drop only the class tokens
 * that match a shape above; `nth-child`/`nth-of-type` must be digits.
 *
 * WHY SHAPES AND NOT AN ALLOWLIST OF LABELS. An allowlist (the i18n catalogue)
 * would also catch short user text, but it breaks every interpolated or
 * span-concatenated label and every brand or model name, which is the data the
 * funnel reads. Shapes are what user content looks like when it is NOT short
 * prose; short prose (a session title, a word of a message) is handled at the
 * DOM instead: user-content regions carry `USER_CONTENT_CLASS`, whose
 * `ph-sensitive` makes posthog-js omit their text and links from autocapture
 * (the click itself is still counted) and whose `ph-mask` makes session replay
 * mask their text. The two layers are meant to overlap: a region someone forgot
 * to mark still loses every path, file name, email, URL and long text here.
 *
 * KNOWN, ACCEPTED LOSSES. A label that is itself shaped like content is
 * redacted too: "Node.js" looks like a file name, a docs link loses its path,
 * a "Data:"/"File:" prefix reads as a URL scheme, a `/command` or a date like
 * `11/21/2026` reads as a path. Prefer that to a leak; if a funnel needs such a
 * label, give the control a stable `data-ph-capture-attribute-*` holding a
 * STATIC, app-defined value only (those are sent as top-level properties this
 * hook never scrubs, so never interpolate a name or title into one), or a
 * named product event (`product-events.ts`), rather than loosening a shape here.
 *
 * FAIL CLOSED. `$elements_chain` is a string posthog-js builds WITHOUT escaping
 * quotes in values, so it is parsed with a strict grammar and rebuilt from
 * scrubbed parts; a chain that does not parse is dropped (sent empty), never
 * passed through. Anything that throws drops the property, never the event;
 * a failure outside any one property's step strips every content-carrying
 * property (`failClosed`) and still returns the event.
 *
 * HOW TO EXTEND. A new user-content surface: add `USER_CONTENT_CLASS` to its
 * root (a container, NOT a control whose label the funnel counts: the class
 * hides the text of everything inside it). A new content shape: add a test in
 * `scripts/autocapture-privacy.test.mjs` first, then a pattern below.
 *
 * NO `posthog-js` IMPORT HERE beyond types, for `product-events.ts`'s reason:
 * node-side test bundles reach this module and cannot load posthog-js.
 */
import type { CaptureResult, Properties } from "posthog-js";

/**
 * The classes a user-content region carries. `ph-sensitive`: autocapture
 * omits the text and `href` of the region and everything in it, but still
 * reports the click. `ph-mask`: session replay masks its text. NOT
 * `ph-no-capture`, which would drop the click event entirely.
 *
 * LIMIT: replay masks TEXT only. rrweb still records every attribute inside a
 * marked region (`href`, `title`, `alt`, `src`, `aria-label`), so a region is
 * fully protected in autocapture (the hook drops those attributes) but not in
 * replay. Blocking them there (`blockSelector`/`maskTextFn`) is an open product
 * decision, see `docs/analytics-events.md`.
 */
export const USER_CONTENT_CLASS = "ph-sensitive ph-mask";

/**
 * The widest label kept (`labelWidth`: a CJK character counts 2). The measured
 * long tail (267 events, 120 to 360 characters) is user content; the app's own
 * control labels are a few words.
 * 64 leaves room for long localized labels (Russian, Vietnamese) while cutting
 * sentences and message excerpts.
 */
export const MAX_LABEL_CHARS = 64;

/** Exception messages are kept for debugging, scrubbed inline, then capped. */
export const MAX_EXCEPTION_CHARS = 500;

export type RedactionKind =
	| "long-text"
	| "multiline"
	| "email"
	| "url"
	| "path"
	| "filename"
	| "token";

const redacted = (kind: RedactionKind) => `[redacted:${kind}]`;

const EMAIL = /[^\s@<>()[\]"',;:]+@[^\s@<>()[\]"',;:]+\.[A-Za-z]{2,}/;
const URL_LIKE =
	/\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.\S|\b(?:mailto|file|data|blob):/i;
// A token that STARTS with `/`, `~/`, `./` or `../` (so "1/3" and "A / B" stay).
const POSIX_ROOTED = /(?:^|[\s(\[{"'`=,:])(?:~|\.{1,2})?\/[^\s/]/;
// Two or more separators inside one token: `a/b/c`, `src\main\x`.
const MULTI_SEGMENT = /[^\s/\\]+[/\\][^\s/\\]+[/\\][^\s/\\]*/;
const WINDOWS = /\b[A-Za-z]:[\\/]|\\\\[^\s\\]+\\|[^\s\\]\\[^\s\\]/;
const FILENAME = /[^\s.\\/][.]([A-Za-z][A-Za-z0-9]{1,9})$/;
const TOKEN = /[A-Za-z0-9_-]{24,}/g;
const WHITESPACE = /\s+/;
const TRAILING_PUNCTUATION = /[)\]}>,;:!?'"`.…]+$/u;
const DIGIT = /[0-9]/;
const LETTER = /[A-Za-z]/;
const DIGITS = /^\d+$/;
const LINE_BREAK = /[\r\n\t]/;
const HASH_ROUTE = /^#\/?([A-Za-z0-9_-]*)/;
const HTTP_URL = /^https?:\/\//i;

function hasFilename(text: string): boolean {
	for (const raw of text.split(WHITESPACE)) {
		// Trailing sentence punctuation is not part of the name ("see a.pdf.").
		const word = raw.replace(TRAILING_PUNCTUATION, "");
		if (FILENAME.test(word)) return true;
	}
	return false;
}

function hasToken(text: string): boolean {
	for (const match of text.match(TOKEN) ?? []) {
		// Long kebab-case ids the app defines (`data-testid`) have no digits.
		if (DIGIT.test(match) && LETTER.test(match)) return true;
	}
	return false;
}

/*
 * East Asian wide characters (Han, kana, Hangul, full-width forms) count twice:
 * a CJK character carries about a word, so 56 of them are a paragraph while 56
 * Latin characters are a short phrase. "更多" is 4, a sentence of Chinese is
 * well past the limit. The same weighting a terminal uses for column width.
 */
const WIDE =
	/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|[\u{20000}-\u{3fffd}]/u;

export function labelWidth(text: string): number {
	let width = 0;
	for (const char of text) width += WIDE.test(char) ? 2 : 1;
	return width;
}

/** Why `text` must not be reported, or `null` when it is a plain short label. */
export function contentKind(text: string): RedactionKind | null {
	if (EMAIL.test(text)) return "email";
	if (URL_LIKE.test(text)) return "url";
	if (POSIX_ROOTED.test(text) || MULTI_SEGMENT.test(text) || WINDOWS.test(text))
		return "path";
	if (hasFilename(text)) return "filename";
	if (hasToken(text)) return "token";
	// Length last, so a long path still reports as a path.
	if (LINE_BREAK.test(text)) return "multiline";
	if (labelWidth(text) > MAX_LABEL_CHARS) return "long-text";
	return null;
}

/** An element's text or a plain attribute value: kept, or replaced whole. */
export function scrubLabel(text: string): string {
	if (text.trim() === "") return text;
	const kind = contentKind(text);
	return kind === null ? text : redacted(kind);
}

/**
 * A link target. http(s) keeps its origin (which site, not which page); an
 * in-app hash route keeps its first segment (`#/chat/<id>` -> `#/chat`);
 * everything else (`file:`, `mailto:`, relative paths, data URLs) is redacted.
 */
export function scrubUrl(href: string): string {
	const value = href.trim();
	if (value === "" || value === "#") return value;
	if (value.startsWith("#")) {
		const first = HASH_ROUTE.exec(value)?.[1] ?? "";
		return first === "" ? "#" : `#/${first}`;
	}
	if (HTTP_URL.test(value)) {
		try {
			const url = new URL(value);
			const bare =
				(url.pathname === "/" || url.pathname === "") &&
				url.search === "" &&
				url.hash === "" &&
				url.username === "" &&
				url.password === "";
			return bare ? url.origin : `${url.origin}/${redacted("url")}`;
		} catch {
			return redacted("url");
		}
	}
	return redacted("url");
}

/** A class list: the app's own class names stay, a content-shaped one goes. */
export function scrubClassList(classes: string): string {
	return classes
		.split(WHITESPACE)
		.filter((name) => name !== "" && contentKind(name) === null)
		.join(" ");
}

const URL_KEYS = new Set([
	"href",
	"attr__href",
	"attr__src",
	"attr__action",
	"attr__xlink:href",
]);

/** One value of an element, by the key posthog-js reported it under. */
export function scrubElementValue(key: string, value: unknown): unknown {
	if (typeof value !== "string") return value;
	if (key === "nth-child" || key === "nth-of-type") {
		return DIGITS.test(value) ? value : "0";
	}
	if (URL_KEYS.has(key)) return scrubUrl(value);
	if (key === "attr__class") return scrubClassList(value);
	return scrubLabel(value);
}

/*
 * `$elements_chain`, as posthog-js 1.235 writes it (`elementsToString`):
 *   element := tag ("." class)* ":" (key '="' value '"')*
 *   chain   := element (";" element)*
 * The first key of every element is `text` or `nth-child` (nth-child is always
 * written), which is how the tag/class prefix is told apart from Tailwind
 * classes that themselves contain ":". Values are NOT escaped, so a value ends
 * at the first quote followed by another key, the next element, or the end.
 */
const KEY = String.raw`(?:text|nth-child|nth-of-type|href|attr_id|attr__[^\s"'=;]+)`;
const PREFIX_RE = /([^";]*?):(?=(?:text|nth-child)=")/y;
const PAIR_RE = new RegExp(
	String.raw`(${KEY})="([\s\S]*?)"(?=${KEY}="|;[^";]*?:(?:text|nth-child)="|$)`,
	"y",
);
const TAG_RE = /^[A-Za-z][A-Za-z0-9-]*$|^$/;

/*
 * INSIDE A USER-CONTENT REGION, attributes are dropped too. posthog-js's
 * `ph-sensitive` withholds a region's TEXT and `href`, but still reports every
 * other attribute of the clicked element and its ancestors, and in this app
 * those carry the same content (`title={sessionTitle}`, `aria-label="New chat
 * with <agent name>"`). The chain lists the target first and its ancestors
 * after it, so an element is in a region when it, or anything after it, carries
 * the class. Only these structural attributes, which are the app's own
 * vocabulary, survive there.
 */
const REGION_CLASSES = new Set(["ph-sensitive", "ph-no-capture"]);
const REGION_KEPT_KEYS = new Set([
	"nth-child",
	"nth-of-type",
	"attr_id",
	"attr__id",
	"attr__class",
	"attr__role",
	"attr__type",
	"attr__tabindex",
	"attr__disabled",
	"attr__data-state",
	"attr__data-slot",
	"attr__data-testid",
	/*
	 * Row identity without row content: `data-chat-row` is a bare marker and
	 * `data-tour-tag` a static app-defined name (`chat-session-row`), so a click
	 * on a sidebar row stays countable as a row click once the row box is a
	 * region. Their values still pass `scrubElementValue`.
	 */
	"attr__data-chat-row",
	"attr__data-tour-tag",
	"attr__aria-expanded",
	"attr__aria-selected",
	"attr__aria-pressed",
	"attr__aria-haspopup",
	"attr__aria-disabled",
]);

/** Marks each element (target first) that sits in a user-content region. */
function regionFlags(classLists: string[][]): boolean[] {
	const flags = new Array<boolean>(classLists.length).fill(false);
	let inside = false;
	for (let i = classLists.length - 1; i >= 0; i--) {
		if (classLists[i].some((name) => REGION_CLASSES.has(name))) inside = true;
		flags[i] = inside;
	}
	return flags;
}

type ParsedElement = {
	tag: string;
	classes: string[];
	pairs: [string, string][];
};

/** The chain rebuilt from scrubbed parts, or `""` when it does not parse. */
export function scrubElementsChain(chain: string): string {
	if (chain === "") return chain;
	const parsed: ParsedElement[] = [];
	let pos = 0;
	while (pos < chain.length) {
		PREFIX_RE.lastIndex = pos;
		const prefix = PREFIX_RE.exec(chain);
		if (!prefix) return "";
		const [tag, ...classes] = prefix[1].split(".");
		if (!TAG_RE.test(tag)) return "";
		const element: ParsedElement = { tag, classes, pairs: [] };
		pos = PREFIX_RE.lastIndex;
		for (;;) {
			PAIR_RE.lastIndex = pos;
			const pair = PAIR_RE.exec(chain);
			if (!pair) break;
			element.pairs.push([pair[1], pair[2]]);
			pos = PAIR_RE.lastIndex;
		}
		parsed.push(element);
		if (pos === chain.length) break;
		if (chain[pos] !== ";") return "";
		pos += 1;
	}
	const inRegion = regionFlags(parsed.map((element) => element.classes));
	return parsed
		.map((element, index) => {
			const classes = element.classes.filter(
				(name) => name !== "" && contentKind(name) === null,
			);
			let out = `${[element.tag, ...classes].join(".")}:`;
			for (const [key, value] of element.pairs) {
				if (inRegion[index] && !REGION_KEPT_KEYS.has(key)) continue;
				out += `${key}="${scrubElementValue(key, value) as string}"`;
			}
			return out;
		})
		.join(";");
}

function classesOf(element: unknown): string[] {
	if (element === null || typeof element !== "object") return [];
	const record = element as Record<string, unknown>;
	if (Array.isArray(record.classes))
		return record.classes.filter(
			(name): name is string => typeof name === "string",
		);
	return typeof record.attr__class === "string"
		? record.attr__class.split(WHITESPACE)
		: [];
}

/** One entry of the deprecated `$elements` array. */
function scrubElementObject(element: unknown, inRegion: boolean): unknown {
	if (element === null || typeof element !== "object") return element;
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(
		element as Record<string, unknown>,
	)) {
		if (key === "$el_text") {
			if (!inRegion) result[key] = scrubElementValue("text", value);
		} else if (key === "classes" && Array.isArray(value))
			result[key] = value.filter(
				(name) => typeof name === "string" && contentKind(name) === null,
			);
		else if (key.startsWith("attr__")) {
			if (!inRegion || REGION_KEPT_KEYS.has(key))
				result[key] = scrubElementValue(key, value);
		} else result[key] = value;
	}
	return result;
}

export function scrubElementsArray(elements: unknown[]): unknown[] {
	const inRegion = regionFlags(elements.map(classesOf));
	return elements.map((element, index) =>
		scrubElementObject(element, inRegion[index]),
	);
}

/*
 * Exceptions keep their message (it is how a failure is diagnosed) but not the
 * user content messages carry: `ENOENT ... '/Users/jane/Acme.pdf'`, a fetch
 * URL's path, an address, a JSON error quoting the text it failed on. Inline
 * replacement, because the rest of the sentence is the useful part; a file name
 * is redacted only for document/media extensions here, since `t.map is not a
 * function` is also "name.ext" shaped.
 */
const DOC_EXT =
	"(?:pdf|docx?|xlsx?|pptx?|csv|tsv|txt|md|rtf|odt|pages|numbers|key|json|ya?ml|xml|html?|png|jpe?g|gif|webp|heic|svg|mp3|mp4|m4a|wav|mov|zip|tar|gz|eml|msg)";
/*
 * UNQUOTED PATHS MAY CONTAIN SPACES (`/Users/jane/Client Notes/Acme Corp
 * Contract.pdf`), and stopping at the first space left the middle words of a
 * customer-named file in the message (review round 1, M2/Q1). So after a path
 * root, a directory segment may run to six space-separated words as long as it
 * ends in a separator, and the last segment may too when it ends in a document
 * extension. Otherwise the last segment stops at whitespace: an extensionless
 * unquoted name with spaces is indistinguishable from the sentence after it
 * (`/tmp/x failed to open`), and eating the sentence is the diagnostic loss the
 * inline approach exists to avoid. The quoted rule below covers that case.
 * Bounded quantifiers keep the backtracking linear in practice.
 */
const PATH_SEG = String.raw`[^\s'"\x60/\\:;,()<>|]+`;
const PATH_WORDS = String.raw`${PATH_SEG}(?: ${PATH_SEG}){0,5}`;
const PATH_TAIL = String.raw`(?:${PATH_WORDS}[\\/])*(?:${PATH_WORDS}\.${DOC_EXT}\b|[^\s'"\x60]*)`;
/*
 * A QUOTED SPAN WITH A SEPARATOR IS A PATH, whole: Node's fs errors quote the
 * path (`open '/Users/jane/Q3 plan'`), and the quotes are the only reliable
 * boundary a spaced, extensionless name has. The quote must not touch a word
 * character on its outer side, so an apostrophe (`can't`, `it's`) never opens
 * or closes a span. Use that same closing boundary inside the body: Node fs
 * errors do not escape an internal apostrophe (`Client's Notes`), so rejecting
 * every matching quote lets the unquoted fallback leak the rest of the path.
 * An http(s) URL in quotes is left to the URL rule, which keeps its origin.
 */
const QUOTED_PATH =
	/(?<!\w)(['"`])(?!https?:\/\/)((?:(?!\1(?!\w))[^\n])*?[\\/](?:(?!\1(?!\w))[^\n])*?)\1(?!\w)/g;
const QUOTED_FILENAME = new RegExp(
	String.raw`(?<!\w)(['"\x60])(?:(?!\1(?!\w))[^\n])*?\.${DOC_EXT}\1(?!\w)`,
	"gi",
);
const INLINE_RULES: Array<[RegExp, string | ((...m: string[]) => string)]> = [
	[new RegExp(EMAIL.source, "g"), redacted("email")],
	[/\bfile:\/\/\S+/gi, redacted("path")],
	[
		/\b(https?:\/\/[^\s/'"`]+)([^\s'"`]*)/gi,
		(_m, origin: string, rest: string) =>
			rest === "" || rest === "/" ? origin : `${origin}/${redacted("url")}`,
	],
	// After the URL rule, so a quoted URL keeps its origin (its kept `//host`
	// carries a `/`, hence the lookahead in `QUOTED_PATH`).
	[QUOTED_PATH, (_m, quote: string) => `${quote}${redacted("path")}${quote}`],
	[
		QUOTED_FILENAME,
		(_m, quote: string) => `${quote}${redacted("filename")}${quote}`,
	],
	[
		new RegExp(String.raw`\b[A-Za-z]:[\\/]${PATH_TAIL}`, "gi"),
		redacted("path"),
	],
	[
		new RegExp(String.raw`\\\\[^\s\\'"\x60]+\\${PATH_TAIL}`, "gi"),
		redacted("path"),
	],
	[
		// No ":" lead here, unlike the label rule: it would eat the `//host` of an
		// origin the rule above kept.
		new RegExp(
			String.raw`(^|[\s(\[{"'\x60=,])((?:~|\.{1,2})?\/(?=[^\s'"\x60])${PATH_TAIL})`,
			"gi",
		),
		(_m, lead: string) => `${lead}${redacted("path")}`,
	],
	[
		new RegExp(String.raw`[^\s'"\x60/\\]+\.${DOC_EXT}\b`, "gi"),
		redacted("filename"),
	],
	[/"[^"]{25,}"/g, `"${redacted("long-text")}"`],
];

export function scrubExceptionMessage(message: string): string {
	let out = message;
	for (const [pattern, replacement] of INLINE_RULES) {
		out =
			typeof replacement === "string"
				? out.replace(pattern, replacement)
				: out.replace(pattern, replacement as (...m: string[]) => string);
	}
	if ([...out].length > MAX_EXCEPTION_CHARS)
		out = `${[...out].slice(0, MAX_EXCEPTION_CHARS).join("")}…`;
	return out;
}

/** A stack frame's file: the bundle path stays, the account name does not. */
export function scrubFramePath(path: string): string {
	return path
		.replace(/(\/Users\/|\/home\/)[^/]+/g, "$1[user]")
		.replace(/([A-Za-z]:[\\/]Users[\\/])[^\\/]+/gi, "$1[user]");
}

function scrubException(properties: Properties): void {
	const list = properties.$exception_list;
	if (!Array.isArray(list)) return;
	for (const exception of list) {
		if (exception === null || typeof exception !== "object") continue;
		if (typeof exception.value === "string")
			exception.value = scrubExceptionMessage(exception.value);
		const frames = exception.stacktrace?.frames;
		if (!Array.isArray(frames)) continue;
		for (const frame of frames) {
			if (frame === null || typeof frame !== "object") continue;
			for (const key of ["filename", "abs_path"] as const) {
				if (typeof frame[key] === "string")
					frame[key] = scrubFramePath(frame[key]);
			}
		}
	}
}

/** Run `step`; if it throws, drop `key` rather than send what it held. */
function guarded(properties: Properties, key: string, step: () => void): void {
	try {
		step();
	} catch {
		delete properties[key];
	}
}

/**
 * The `before_send` hook. Scrubs the element properties of ANY event that has
 * them (autocapture, rageclick, dead click, copy autocapture, a custom event
 * someone builds from them) and the message and frames of `$exception`. Every
 * other property is untouched, so named product events and replay snapshots
 * pass through unchanged. Never drops an event.
 *
 * FAIL CLOSED, WHOLE. posthog-js's `_runBeforeSend` has no catch, so a throw
 * here would lose the event, and a throw between the per-property guards (a
 * throwing getter on `properties` itself, review round 1, m3) would otherwise
 * escape them. Any such failure strips every content-carrying property and
 * still returns the event: a click counted without its text beats both a
 * lost event and a leaked one.
 */
export function scrubCaptureResult(
	result: CaptureResult | null,
): CaptureResult | null {
	if (result === null) return result;
	let properties: Properties;
	try {
		properties = result.properties;
	} catch {
		return result;
	}
	if (properties === null || typeof properties !== "object") return result;
	try {
		scrubProperties(result, properties);
	} catch {
		failClosed(properties);
	}
	return result;
}

/** The element and exception keys whose values can carry user content. */
const CONTENT_KEYS = [
	"$el_text",
	"$elements_chain",
	"$elements",
	"$external_click_url",
	"$selected_content",
] as const;

/**
 * The hook's last resort: every content key goes, and each exception keeps
 * only its type (what failed, not what it said or where). Each step is guarded
 * on its own, because the thing that just threw may throw again.
 */
function failClosed(properties: Properties): void {
	for (const key of CONTENT_KEYS) {
		try {
			delete properties[key];
		} catch {
			// A non-deletable property: blank it instead, and move on if even that fails.
			try {
				properties[key] = null;
			} catch {}
		}
	}
	try {
		const list = properties.$exception_list;
		if (Array.isArray(list))
			properties.$exception_list = list.map((exception) => ({
				type: typeof exception?.type === "string" ? exception.type : "Error",
				value: UNSCRUBBED,
			}));
	} catch {
		try {
			properties.$exception_list = undefined;
		} catch {}
	}
}

const UNSCRUBBED = "[redacted:unscrubbed]";

function scrubProperties(result: CaptureResult, properties: Properties): void {
	if (typeof properties.$el_text === "string")
		guarded(properties, "$el_text", () => {
			properties.$el_text = scrubLabel(properties.$el_text);
		});
	if (typeof properties.$elements_chain === "string")
		guarded(properties, "$elements_chain", () => {
			properties.$elements_chain = scrubElementsChain(
				properties.$elements_chain,
			);
		});
	if (Array.isArray(properties.$elements))
		guarded(properties, "$elements", () => {
			properties.$elements = scrubElementsArray(properties.$elements);
		});
	if (typeof properties.$external_click_url === "string")
		guarded(properties, "$external_click_url", () => {
			properties.$external_click_url = scrubUrl(properties.$external_click_url);
		});
	if (typeof properties.$selected_content === "string")
		guarded(properties, "$selected_content", () => {
			properties.$selected_content = scrubLabel(properties.$selected_content);
		});
	if (result.event === "$exception")
		guarded(properties, "$exception_list", () => scrubException(properties));
}
