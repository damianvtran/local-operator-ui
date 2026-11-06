/**
 * The links a Team Bridge message carries, in the order a link-preview index is
 * assigned to them.
 *
 * WHAT `index` MEANS, AND WHY THIS FILE DOES NOT FILTER. Core enforces the
 * per-message cap on the `index` the renderer sends, and defines it as "the
 * link's position among its message's links" (`PER_MESSAGE_CAP` in
 * `local_operator/team_bridge/link_preview/service.py`). So every link the
 * message renders takes the next position, in document order, whatever it
 * points at: a `mailto:`, a relative path, a private address and a link core
 * will refuse all spend a position. Judging eligibility here (dropping the
 * `mailto:` so the fourth link becomes the third) would be a second rule for a
 * question core already answers - its `unsupported-scheme`, `local-or-private`
 * and `blocked-host` refusals - and the two would disagree about which links a
 * message's three cards belong to. The renderer asks; core decides.
 *
 * WHAT COUNTS AS A LINK is what the message renderer draws as one: the same
 * parser and GFM extension `TeamBridgeMarkdown` hands to react-markdown, so a
 * bare `https://...` (a GFM autolink literal), `<https://...>`, `[text](url)` and
 * a reference link whose definition exists are links, while an image is not (the
 * renderer draws it as text) and neither is a URL inside inline code or a code
 * block. Duplicates keep their own positions, for the same reason nothing is
 * filtered.
 *
 * THE BODY IS SPLIT THE WAY `InlineDataBody` SPLITS IT. A legacy inline-data
 * region is drawn as a receipt, never as markdown, so its text is not parsed
 * here either: parsing a multi-megabyte `data:` run is the cost `InlineDataBody`
 * exists to avoid, and links inside one are not links the reader can see. Each
 * text segment is parsed as its own document because each is rendered as its
 * own `TeamBridgeMarkdown`, so a reference definition does not reach across a
 * receipt.
 */
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { inlineImageSpans } from "../inline-data-receipt";

/* Built once: `parse` freezes the processor on first use, and the GFM extension's
 * tokenizers are the same for every message. */
const PARSER = unified().use(remarkParse).use(remarkGfm);

/* The three mdast node shapes read here, declared locally: `@types/mdast` is not
 * a direct dependency of this package (the sibling `remark-mentions.ts` types
 * its nodes the same way), and these fields are the only ones used. */
type UrlNode = {
	type: "link" | "definition";
	url: string;
	identifier?: string;
};
type ReferenceNode = { type: "linkReference"; identifier: string };

function segmentLinks(text: string): string[] {
	const tree = PARSER.parse(text);
	// A reference resolves against a definition anywhere in its document, earlier
	// or later, and the first definition of an identifier wins (CommonMark), so
	// every definition is collected before any link is read.
	const definitions = new Map<string, string>();
	visit(tree, "definition", (node) => {
		const { identifier, url } = node as UrlNode;
		if (identifier !== undefined && !definitions.has(identifier)) {
			definitions.set(identifier, url);
		}
	});
	const links: string[] = [];
	visit(tree, (node) => {
		if (node.type === "link") {
			links.push((node as UrlNode).url);
		} else if (node.type === "linkReference") {
			// A reference with no definition is drawn as its literal text, not as a
			// link, so it takes no position.
			const url = definitions.get((node as ReferenceNode).identifier);
			if (url !== undefined) links.push(url);
		}
	});
	return links;
}

/**
 * Every link in `body`, in document order. The position in the returned array
 * IS the link-preview `index` for that link.
 */
export function teamBridgeMessageLinks(body: string): string[] {
	if (body.trim() === "") return [];
	const spans = inlineImageSpans(body);
	if (spans.length === 0) return segmentLinks(body);
	const links: string[] = [];
	let cursor = 0;
	for (const span of spans) {
		const before = body.slice(cursor, span.start);
		if (before) links.push(...segmentLinks(before));
		cursor = span.end;
	}
	if (cursor < body.length) links.push(...segmentLinks(body.slice(cursor)));
	return links;
}
