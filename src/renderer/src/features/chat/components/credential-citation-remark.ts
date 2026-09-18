/*
 * THE TRANSCRIPT'S CITATION TRANSFORM, as a pure remark plugin.
 *
 * Split out of `credential-citation.tsx` (which renders the chip) for one
 * reason: this half reads no React and no DOM, only the markdown tree, so
 * `scripts/credential-capture.test.mjs` can bundle it and drive it over real
 * mdast trees. The rule it enforces is the one a green screenshot cannot
 * falsify — "a citation inside a fenced block is left byte-identical" — and a
 * rule that can only be checked by looking at a picture is a rule that gets
 * checked by whoever remembered to look.
 *
 * WHAT THE OPERATOR SAW (report, 2026-09-17): a message sent with a pasted
 * secret reads, in the transcript, as a wall of technical text —
 *
 *   Here's a new QA key to use, can you update the QA secrets with it
 *   [credential LOP_SECRET_4CE3Y48G (73 chars) — available to bash and eval as
 *   $LOP_SECRET_4CE3Y48G; its value cannot be read]
 *
 * THE TEXT DOES NOT CHANGE, and that is the load-bearing constraint of this
 * half: the citation is what the model is given and what the transcript stores
 * (`credentialCitation` in `credential-capture.ts`), and this transform runs on
 * the way to the DOM only. Nothing here can reach a message, a draft, a payload
 * or the session credential store.
 *
 * WHY A REMARK PLUGIN AND AN ANCHOR OVERRIDE, rather than the three mechanisms
 * this change considered and rejected: a PRE-PASS that rewrote the markdown
 * before parsing would have to know where the citation sits (a paragraph? a list
 * item? already inside a fence?) and would round-trip the text through a string;
 * a POST-PASS over the rendered DOM would re-parse the text it had just produced
 * and fight React for the same nodes on every streamed delta; and allowing raw
 * HTML to solve one inline shape would open the whole document to HTML. The
 * plugin walks the mdast `text` nodes — the smallest unit the parser gives, and
 * the only one whose content is definitely prose — and turns each citation into
 * a `link` whose URL is a private fragment. The `a` override in
 * `credential-citation.tsx` recognises that scheme and renders the chip; every
 * other URL keeps the ordinary anchor.
 */

import { CREDENTIAL_KEY_PATTERN, citationSegments } from "./credential-capture";

/**
 * The scheme the plugin writes and the anchor override matches.
 *
 * A fragment rather than a fake protocol, deliberately: react-markdown's own
 * `defaultUrlTransform` passes a URL carrying no protocol through untouched and
 * BLANKS anything it does not recognise, so `lo-credential:` would silently
 * arrive at the override as an empty string while `#…` survives verbatim.
 */
const CITATION_HREF = "#lo-credential/";

/** The unstored form's URL: same scheme, no key and no count to carry. */
const CITATION_HREF_UNSTORED = `${CITATION_HREF}unstored`;

/** The count half of a citation URL, which is digits and nothing else. */
const CITATION_CHARS = /^\d+$/;

/** What a citation's URL means to the override. */
export type CitationRef =
	| { kind: "stored"; key: string; chars: number }
	| { kind: "unstored" };

/**
 * The URL for one citation segment. The node's `title` carries the words: the
 * chip's own text is two or three words, so the full sentence the app wrote
 * travels beside it rather than being reconstructed from the URL.
 */
export const citationHref = (segment: {
	kind: string;
	key?: string;
	chars?: number;
}): string => {
	if (segment.kind === "stored")
		return `${CITATION_HREF}${segment.key ?? ""}/${segment.chars ?? 0}`;
	return CITATION_HREF_UNSTORED;
};

/**
 * The citation a URL names, or `null` for every other URL.
 *
 * Validated rather than trusted: a message can contain a hand-written
 * `#lo-credential/…` link, and a link this app did not write must render as the
 * ordinary anchor it is. The key has to be a store key (`CREDENTIAL_KEY_PATTERN`,
 * the same predicate the store's own names are checked against) and the count an
 * integer, so a near-miss falls through to the anchor path.
 */
export function citationFromHref(href: string | undefined): CitationRef | null {
	if (!href || !href.startsWith(CITATION_HREF)) return null;
	const rest = href.slice(CITATION_HREF.length);
	if (rest === "unstored") return { kind: "unstored" };
	const cut = rest.lastIndexOf("/");
	if (cut === -1) return null;
	const key = rest.slice(0, cut);
	const chars = rest.slice(cut + 1);
	if (!CREDENTIAL_KEY_PATTERN.test(key)) return null;
	if (!CITATION_CHARS.test(chars)) return null;
	return { kind: "stored", key, chars: Number.parseInt(chars, 10) };
}

/**
 * The tree shapes this plugin touches, spelled structurally.
 *
 * Declared here rather than imported: `@types/mdast` and `unified` are
 * dependencies of `react-markdown` and not of this repository, so importing them
 * would make this module depend on a package the lockfile does not promise it.
 * The plugin is a function returning a transformer, which is the whole of what
 * `remarkPlugins` asks of it.
 */
export type MdastNode = {
	type: string;
	value?: string;
	url?: string;
	title?: string | null;
	children?: MdastNode[];
};

/**
 * Turn every citation in the document's text nodes into a chip-shaped link.
 *
 * The walk descends `children` and stops at any node that has none, which is
 * exactly the rule this file's header describes: `code` and `inlineCode` hold
 * their source in `value` and never in children, so a fenced citation is left
 * byte-identical and never reaches the override. A `text` node with no citation
 * is handed back as the SAME node, so a message that mentions no credential is
 * parsed once and untouched.
 */
export const remarkCredentialCitations =
	() =>
	(tree: MdastNode): void => {
		const walk = (node: MdastNode): void => {
			if (!node.children) return;
			const next: MdastNode[] = [];
			let replaced = false;
			for (const child of node.children) {
				if (child.type !== "text" || typeof child.value !== "string") {
					walk(child);
					next.push(child);
					continue;
				}
				const segments = citationSegments(child.value);
				// One TEXT segment means the node held no citation at all, and the node is
				// handed back unchanged so a message that mentions no credential is parsed
				// once. The kind is what decides, not the count: a node that is EXACTLY one
				// citation also comes back as a single segment, and that is the shape a
				// citation gets on its own line in a message the model wrote around it.
				if (segments.length === 1 && segments[0].kind === "text") {
					next.push(child);
					continue;
				}
				replaced = true;
				for (const segment of segments) {
					if (segment.kind === "text") {
						next.push({ type: "text", value: segment.text });
						continue;
					}
					next.push({
						type: "link",
						url: citationHref(segment),
						// The full sentence, which is what the chip's native `title` shows and
						// what this node renders as if anything else ever renders a tree the
						// plugin built. The child text is the same sentence for the same reason:
						// the transformed tree is faithful to the text it replaced, so the chip
						// is a PRESENTATION of the citation rather than a replacement for it.
						title: segment.text,
						children: [{ type: "text", value: segment.text }],
					});
				}
			}
			if (replaced) node.children = next;
		};
		walk(tree);
	};
