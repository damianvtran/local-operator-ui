import rehypeParse from "rehype-parse";
import { unified } from "unified";

type Node = {
	type: string;
	value?: string;
	tagName?: string;
	properties?: Record<string, unknown>;
	children?: Node[];
	url?: string;
	position?: { start: { offset?: number }; end: { offset?: number } };
	data?: { hName?: string; hProperties?: Record<string, unknown> };
};

const parser = unified().use(rehypeParse, { fragment: true });
const TABLE_START = /^\s*<table(?:\s|>)/i;
const UNSIGNED_INTEGER = /^\d+$/;
// HAST's property schema returns colSpan as a string but rowSpan as a number.
// Validate either representation, without accepting CSS, fractions or NaN.
const numericAttribute = (raw: unknown): number | undefined => {
	const value =
		typeof raw === "number"
			? raw
			: typeof raw === "string" && UNSIGNED_INTEGER.test(raw)
				? Number(raw)
				: Number.NaN;
	return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
};
const INLINE: Record<string, string> = {
	strong: "strong",
	b: "strong",
	em: "emphasis",
	i: "emphasis",
	del: "delete",
	s: "delete",
};
const PASSIVE = new Set(["span"]);
const PRESENTATION = new Set([
	"sub",
	"sup",
	"kbd",
	"mark",
	"u",
	"div",
	"p",
	"ul",
	"ol",
	"li",
]);
const STRUCTURE = new Set([
	"table",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"th",
	"td",
	"caption",
	"colgroup",
	"col",
]);

/**
 * Models commonly put HTML in GFM cells. Enabling raw HTML for the whole
 * transcript would also enable attributes, active elements and layout outside
 * tables. Instead parse ONLY table fragments with the existing HTML5 parser and
 * project them onto inert markdown nodes. No raw HTML reaches react-markdown.
 *
 * Existing markdown children travel as opaque placeholders. This is important:
 * serializing/reparsing them as HTML would corrupt code, math, custom citations
 * and link targets. The placeholder name is chosen outside the source, so model
 * text cannot impersonate one. Escaped HTML is text, never parsed a second time.
 */
export const remarkTableHtml =
	() =>
	(tree: Node, file: { value?: unknown }): void => {
		const convert = (
			nodes: Node[],
			placeholder?: { name: string; originals: Node[] },
			structural = false,
		): Node[] =>
			nodes.flatMap((node): Node[] => {
				if (node.type === "text") return [{ type: "text", value: node.value }];
				if (node.type !== "element") return [];
				const tag = node.tagName ?? "";
				if (placeholder && tag === placeholder.name) {
					const index = Number(node.properties?.dataIndex);
					return placeholder.originals[index]
						? [placeholder.originals[index]]
						: [];
				}
				// Unknown elements are discarded WITH their contents, not unwrapped:
				// script/style/iframe/svg text must not become visible answer content.
				if (
					!Object.hasOwn(INLINE, tag) &&
					!PASSIVE.has(tag) &&
					!PRESENTATION.has(tag) &&
					tag !== "br" &&
					tag !== "code" &&
					tag !== "a" &&
					!(structural && STRUCTURE.has(tag))
				)
					return [];
				const children = convert(node.children ?? [], placeholder, structural);
				if (tag === "br") return [{ type: "break" }];
				if (Object.hasOwn(INLINE, tag))
					return [{ type: INLINE[tag], children }];
				if (tag === "code") {
					const text = (items: Node[]): string =>
						items
							.map((item) => item.value ?? text(item.children ?? []))
							.join("");
					return [{ type: "inlineCode", value: text(children) }];
				}
				if (tag === "a")
					return [
						{
							type: "link",
							url: String(node.properties?.href ?? ""),
							children,
						},
					];
				if (PRESENTATION.has(tag) || (structural && STRUCTURE.has(tag))) {
					// hName is selected from this fixed allowlist, never from arbitrary HTML.
					// Only cell geometry/alignment survives. Styles, ids, events and
					// data-* never do; URL policy remains react-markdown's own.
					const hProperties: Record<string, unknown> = {};
					if (tag === "td" || tag === "th") {
						for (const key of ["colSpan", "rowSpan"]) {
							const value = numericAttribute(node.properties?.[key]);
							if (
								typeof value === "number" &&
								Number.isSafeInteger(value) &&
								(value > 0 || (key === "rowSpan" && value === 0))
							)
								hProperties[key] = value;
						}
						const scope = node.properties?.scope;
						if (
							tag === "th" &&
							(scope === "row" ||
								scope === "col" ||
								scope === "rowgroup" ||
								scope === "colgroup")
						)
							hProperties.scope = scope;
						const align = node.properties?.align;
						if (align === "left" || align === "center" || align === "right")
							hProperties.align = align;
					}
					if (tag === "col" || tag === "colgroup") {
						const span = numericAttribute(node.properties?.span);
						if (
							typeof span === "number" &&
							Number.isSafeInteger(span) &&
							span > 0
						)
							hProperties.span = span;
					}
					return [
						{
							type: "tableHtmlElement",
							data: { hName: tag, hProperties },
							children,
						},
					];
				}
				return children;
			});
		const parse = (html: string): Node[] =>
			(parser.parse(html) as Node).children ?? [];

		const walk = (node: Node, inTable = false): void => {
			if (!node.children) return;
			const table = inTable || node.type === "table";
			for (const child of node.children) walk(child, table);
			if (table && node.children.some((child) => child.type === "html")) {
				const source = node.children
					.filter((child) => child.type === "html")
					.map((child) => child.value ?? "")
					.join("");
				let name = "lo-table-node";
				while (source.toLowerCase().includes(name)) name += "-x";
				const originals: Node[] = [];
				const html = node.children
					.map((child) => {
						if (child.type === "html") return child.value ?? "";
						const index = originals.push(child) - 1;
						return `<${name} data-index="${index}"></${name}>`;
					})
					.join("");
				node.children = convert(parse(html), { name, originals });
			} else {
				const next: Node[] = [];
				for (let index = 0; index < node.children.length; index += 1) {
					const child = node.children[index];
					if (child.type !== "html" || !TABLE_START.test(child.value ?? "")) {
						next.push(child);
						continue;
					}
					let html = child.value ?? "";
					// CommonMark ends an HTML block at a blank line, even inside a
					// table. Use the HTML5 parser's source boundary to reunite that
					// table, not a regex searching for a possibly quoted closing tag.
					const sentinel = "<lo-table-end></lo-table-end>";
					const openTable = parse(html + sentinel).find(
						(item) => item.tagName === "table",
					);
					const start = child.position?.start.offset;
					if (
						typeof file.value === "string" &&
						start !== undefined &&
						(openTable?.position?.end.offset ?? 0) > html.length
					) {
						// Only adjacent HTML blocks participate: a Markdown paragraph,
						// list or code fence is an opaque boundary, not more raw HTML.
						const barrier = node.children
							.slice(index + 1)
							.find((item) => item.type !== "html");
						const last =
							barrier?.position?.start.offset ??
							node.children.at(-1)?.position?.end.offset;
						const suffix = file.value.slice(start, last);
						const table = parse(suffix + sentinel).find(
							(item) => item.tagName === "table",
						);
						const end = table?.position?.end.offset;
						// An unfinished table must not swallow later Markdown blocks,
						// especially fenced examples of the markup itself.
						if (end !== undefined && end <= suffix.length) {
							html = suffix.slice(0, end);
							while (
								index + 1 < node.children.length &&
								(node.children[index + 1].position?.start.offset ??
									Number.POSITIVE_INFINITY) <
									start + end
							)
								index += 1;
						}
					}
					next.push(...convert(parse(html), undefined, true));
				}
				node.children = next;
			}
		};
		walk(tree);
	};
