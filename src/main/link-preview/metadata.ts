/**
 * A bounded scanner that reads a page's preview metadata and nothing else.
 *
 * WHY NOT A PARSER. The only things needed from a third-party page are a title,
 * three or four metadata names, and an icon `href`. A full HTML parser would
 * bring (a) another dependency, (b) a document object model built from hostile
 * markup, and (c) entity expansion, which is where an "innocent" parser turns a
 * 512 KB page into gigabytes. So this walks the bytes once, at most
 * `MAX_SCAN_BYTES` of them, and recognises exactly the handful of tags it wants.
 * Nothing is executed, nothing is resolved, and the input's shape is never
 * trusted: a tag longer than `MAX_TAG_BYTES` is skipped rather than scanned.
 *
 * WHAT BOUNDS THE WORK. Five constants - scan window, tag length, attribute
 * count, title length and value length - and no regular expression over the whole
 * document. Every loop here advances an index, so a 512 KB body with a hundred
 * thousand tags costs one pass and cannot backtrack.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. No `<base href>` resolution, no script or
 * style reading, no `meta http-equiv="refresh"`, no charset re-decoding beyond the
 * ASCII-compatible assumption every previewable page satisfies for these tags.
 * Entities are decoded for a small named set plus numeric forms, bounded to
 * `MAX_DECODED_CHARS`, because a preview title of ten thousand characters is not
 * a title.
 */

/** How much of a page is scanned. The brief's cap: metadata lives in `<head>`. */
export const MAX_SCAN_BYTES = 512 * 1024;
/** A single `<...>` longer than this is not markup worth reading. */
const MAX_TAG_BYTES = 8 * 1024;
/** Attributes read from one tag; a tag with more is not real metadata. */
const MAX_ATTRIBUTES = 24;
const MAX_TITLE_CHARS = 300;
const MAX_VALUE_CHARS = 500;
const MAX_DESCRIPTION_CHARS = 500;
const MAX_DECODED_CHARS = 1000;

export interface ExtractedMetadata {
	title: string | null;
	description: string | null;
	siteName: string | null;
	/** The `href` of the page's declared icon, as written (may be relative). */
	iconHref: string | null;
	/** The `content` of the page's declared preview image, as written. */
	imageHref: string | null;
}

const EMPTY: ExtractedMetadata = {
	title: null,
	description: null,
	siteName: null,
	iconHref: null,
	imageHref: null,
};

const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
	["amp", "&"],
	["lt", "<"],
	["gt", ">"],
	["quot", '"'],
	["apos", "'"],
	["nbsp", " "],
	["#39", "'"],
	["#x27", "'"],
	["#34", '"'],
	["#x22", '"'],
	["hellip", "…"],
	["mdash", "—"],
	["ndash", "–"],
	["rsquo", "’"],
	["lsquo", "‘"],
	["ldquo", "“"],
	["rdquo", "”"],
]);

/**
 * Decode the entities a title or description realistically contains.
 *
 * A closed set plus numeric forms, with the OUTPUT bounded - never a general
 * entity table and never a recursive expansion, which is the shape that turns
 * `&amp;amp;amp;...` into an amplification attack.
 */
export function decodeEntities(input: string): string {
	if (!input.includes("&")) return input.slice(0, MAX_DECODED_CHARS);
	let out = "";
	let index = 0;
	while (index < input.length && out.length < MAX_DECODED_CHARS) {
		const amp = input.indexOf("&", index);
		if (amp === -1) {
			out += input.slice(index);
			break;
		}
		out += input.slice(index, amp);
		const semi = input.indexOf(";", amp + 1);
		// An `&` that never closes is a literal `&`, not the start of an entity.
		if (semi === -1 || semi - amp > 12) {
			out += "&";
			index = amp + 1;
			continue;
		}
		const name = input.slice(amp + 1, semi);
		const named = NAMED_ENTITIES.get(name.toLowerCase());
		if (named !== undefined) {
			out += named;
		} else if (name.startsWith("#x") || name.startsWith("#X")) {
			const code = Number.parseInt(name.slice(2), 16);
			out +=
				Number.isFinite(code) && code > 0 && code <= 0x10ffff
					? String.fromCodePoint(code)
					: "";
		} else if (name.startsWith("#")) {
			const code = Number.parseInt(name.slice(1), 10);
			out +=
				Number.isFinite(code) && code > 0 && code <= 0x10ffff
					? String.fromCodePoint(code)
					: "";
		} else {
			out += `&${name};`;
		}
		index = semi + 1;
	}
	return out.slice(0, MAX_DECODED_CHARS);
}

/** HTML whitespace: tested once per character in the attribute scanner, which is
 * the hottest loop in this file. */
const WHITESPACE = /\s/;
/** The `rel` attribute's space-separated tokens. */
const WHITESPACE_RUN = /\s+/;
/** Whitespace or a self-closing slash: the attribute scanner's separators. */
const WHITESPACE_OR_SLASH = /[\s/]/;

/** Collapse whitespace runs - a title in markup is usually wrapped across lines. */
function tidy(value: string): string {
	const collapsed = value.replace(WHITESPACE_RUN, " ").trim();
	return collapsed;
}

interface Tag {
	name: string;
	/** A closing tag (`</script>`) carries no attributes and must not trigger the
	 * opening tag's handling - see the loop below, where treating one as an opening
	 * `<script>` swallowed every tag after it (the real-page regression this flag
	 * exists for). */
	closing: boolean;
	attributes: Map<string, string>;
	/** Index just past the tag's `>`, or -1 when the tag was skipped. */
	end: number;
}

/**
 * Read one tag starting at `start` (which must point at `<`).
 *
 * Returns `null` when the tag is malformed, unterminated, or longer than
 * `MAX_TAG_BYTES`. Since a skipped tag still has to advance the scanner, the
 * caller uses `unterminated` to decide where to resume.
 */
function readTag(
	text: string,
	start: number,
): { tag: Tag } | { unterminated: true; resumeAt: number } {
	const limit = Math.min(text.length, start + MAX_TAG_BYTES);
	const close = text.indexOf(">", start + 1);
	if (close === -1 || close >= limit) {
		// No `>` within the tag budget: skip this whole stretch. If there is no `>`
		// at all the rest of the document is one unterminated tag, so stop.
		return {
			unterminated: true,
			resumeAt: close === -1 ? text.length : close + 1,
		};
	}
	const inner = text.slice(start + 1, close);
	let index = 0;
	// A closing tag (`</div>`) has no attributes worth reading, and must be marked
	// so the loop does not mistake it for an opening one - see `closing` in `Tag`.
	if (inner.startsWith("/")) {
		return {
			tag: {
				name: inner.slice(1).trim().toLowerCase(),
				closing: true,
				attributes: new Map(),
				end: close + 1,
			},
		};
	}
	let name = "";
	while (index < inner.length) {
		const char = inner[index] as string;
		if (WHITESPACE.test(char)) break;
		name += char;
		index += 1;
	}
	const attributes = new Map<string, string>();
	let count = 0;
	while (index < inner.length && count < MAX_ATTRIBUTES) {
		while (
			index < inner.length &&
			WHITESPACE_OR_SLASH.test(inner[index] as string)
		)
			index += 1;
		if (index >= inner.length) break;
		let attribute = "";
		while (index < inner.length) {
			const char = inner[index] as string;
			if (char === "=" || char === ">" || WHITESPACE.test(char)) break;
			attribute += char;
			index += 1;
		}
		while (index < inner.length && WHITESPACE.test(inner[index] as string))
			index += 1;
		let value = "";
		if (inner[index] === "=") {
			index += 1;
			while (index < inner.length && WHITESPACE.test(inner[index] as string))
				index += 1;
			const quote = inner[index];
			if (quote === '"' || quote === "'") {
				index += 1;
				const endQuote = inner.indexOf(quote, index);
				value = inner.slice(index, endQuote === -1 ? inner.length : endQuote);
				index = endQuote === -1 ? inner.length : endQuote + 1;
			} else {
				while (
					index < inner.length &&
					!WHITESPACE.test(inner[index] as string)
				) {
					value += inner[index];
					index += 1;
				}
			}
		}
		if (attribute !== "" && !attributes.has(attribute.toLowerCase())) {
			attributes.set(attribute.toLowerCase(), value.slice(0, MAX_VALUE_CHARS));
			count += 1;
		}
	}
	return {
		tag: {
			name: name.toLowerCase(),
			closing: false,
			attributes,
			end: close + 1,
		},
	};
}

/**
 * Extract the preview metadata from an HTML document's bytes.
 *
 * The precedence is the conventional one, so a page that publishes all three is
 * described the way its author intended: the title is `og:*` first, then
 * `<title>`, then Twitter's card field; the description is `og:description`, then
 * `<meta name="description">`, then `twitter:description`; the image is `og:image`
 * before `twitter:image`.
 */
export function extractMetadata(bytes: Uint8Array): ExtractedMetadata {
	const view = bytes.subarray(0, MAX_SCAN_BYTES);
	// Latin-1 decoding keeps one character per byte, so the scanner's indices are
	// byte indices and a multi-byte character cannot split a tag boundary.
	const text = new TextDecoder("latin1").decode(view);
	// Lowercased ONCE: the script/style skip searches for closing tags, and a
	// per-iteration `toLowerCase()` over half a megabyte is how a bounded scan
	// stops being bounded.
	const lower = text.toLowerCase();
	let title: string | null = null;
	let description: string | null = null;
	let iconHref: string | null = null;
	let imageHref: string | null = null;
	let ogTitle: string | null = null;
	let twitterTitle: string | null = null;
	let ogDescription: string | null = null;
	let twitterDescription: string | null = null;
	let ogSiteName: string | null = null;
	let twitterImage: string | null = null;

	let index = 0;
	while (index < text.length) {
		const open = text.indexOf("<", index);
		if (open === -1) break;
		const read = readTag(text, open);
		if ("unterminated" in read) {
			index = read.resumeAt;
			continue;
		}
		const { tag } = read;
		index = tag.end;
		// A closing tag is position, not information: `</script>` must not be read as
		// an opening `<script>` and skip forward to the NEXT script's end.
		if (tag.closing) continue;
		if (tag.name === "script" || tag.name === "style") {
			// Do not scan inside them: a JSON island or a CSS rule can hold strings
			// that look exactly like the tags this scanner wants.
			const close = lower.indexOf(`</${tag.name}`, index);
			if (close === -1) break;
			index = close;
			continue;
		}
		if (tag.name === "title" && title === null) {
			const close = text.indexOf("</title", index);
			const raw =
				close === -1
					? ""
					: text.slice(index, Math.min(close, index + MAX_TITLE_CHARS));
			const value = tidy(decodeEntities(raw)).slice(0, MAX_TITLE_CHARS);
			if (value !== "") title = value;
			if (close !== -1) index = close;
			continue;
		}
		if (tag.name === "meta") {
			const key = (
				tag.attributes.get("property") ??
				tag.attributes.get("name") ??
				""
			).toLowerCase();
			const content = tag.attributes.get("content");
			if (content === undefined) continue;
			const value = tidy(decodeEntities(content)).slice(
				0,
				MAX_DESCRIPTION_CHARS,
			);
			if (value === "") continue;
			switch (key) {
				case "og:title":
					ogTitle = ogTitle ?? value;
					break;
				case "twitter:title":
					twitterTitle = twitterTitle ?? value;
					break;
				case "og:description":
					ogDescription = ogDescription ?? value;
					break;
				case "description":
					if (description === null) {
						description = tidy(decodeEntities(content)).slice(
							0,
							MAX_DESCRIPTION_CHARS,
						);
					}
					break;
				case "twitter:description":
					twitterDescription = twitterDescription ?? value;
					break;
				case "og:site_name":
					ogSiteName =
						ogSiteName ??
						tidy(decodeEntities(content)).slice(0, MAX_VALUE_CHARS);
					break;
				case "og:image":
				case "og:image:url":
				case "og:image:secure_url":
					imageHref = imageHref ?? content.slice(0, MAX_VALUE_CHARS);
					break;
				case "twitter:image":
				case "twitter:image:src":
					twitterImage = twitterImage ?? content.slice(0, MAX_VALUE_CHARS);
					break;
			}
			continue;
		}
		if (tag.name === "link" && iconHref === null) {
			const rel = (tag.attributes.get("rel") ?? "").toLowerCase();
			const href = tag.attributes.get("href");
			if (href !== undefined && rel.split(WHITESPACE_RUN).includes("icon")) {
				iconHref = href.slice(0, MAX_VALUE_CHARS);
			}
		}
	}

	const resolvedTitle = ogTitle ?? title ?? twitterTitle;
	const resolvedDescription =
		ogDescription ?? description ?? twitterDescription;
	const resolvedImage = imageHref ?? twitterImage;
	const result: ExtractedMetadata = {
		title:
			resolvedTitle === null ? null : resolvedTitle.slice(0, MAX_TITLE_CHARS),
		description:
			resolvedDescription === null
				? null
				: resolvedDescription.slice(0, MAX_DESCRIPTION_CHARS),
		siteName: ogSiteName,
		iconHref,
		imageHref: resolvedImage,
	};
	if (
		result.title === null &&
		result.description === null &&
		result.siteName === null &&
		result.iconHref === null &&
		result.imageHref === null
	) {
		return EMPTY;
	}
	return result;
}

/** Whether anything about this page is worth a card. A page with only an icon is
 * not: the card would be a picture of a globe and no words. */
export function hasPreviewContent(metadata: ExtractedMetadata): boolean {
	return (
		metadata.title !== null ||
		metadata.description !== null ||
		metadata.siteName !== null
	);
}
