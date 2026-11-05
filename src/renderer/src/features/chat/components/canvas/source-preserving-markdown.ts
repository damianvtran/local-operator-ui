import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { htmlToMarkdown } from "./wysiwyg-utils";

/** The shared editor's opt-in canonical-source port. Canvas keeps its existing
 * converter/buffer contract; instruction hosts cannot afford whole-document
 * serialization, since invisible comments and future syntax are instructions. */
export interface MarkdownEditorCodec {
	render: (source: string) => string;
	read: (root: HTMLElement) => string;
	getOpaque: (element: Element) => { id: string; source: string } | null;
	replaceOpaque: (
		root: HTMLElement,
		id: string,
		expected: string,
		source: string,
	) => string | null;
	insertSource: (source: string) => string;
}

type MarkdownNode = {
	type: string;
	children?: MarkdownNode[];
	position?: { start: { offset?: number }; end: { offset?: number } };
};

type Span = {
	id: string;
	baseId: string;
	type: string;
	text?: string;
	start: number;
	end: number;
	raw: string;
	children: string[];
	opaque: boolean;
	block: boolean;
	continuationPrefix: string;
	html?: string;
	skeleton?: string;
};
type Snapshot = {
	source: string;
	children: string[];
	start: number;
	end: number;
};
const parser = unified().use(remarkParse).use(remarkGfm);
const NODE = "data-prompt-node";
const OPAQUE = "data-prompt-opaque";
const ESCAPABLE_MARKDOWN = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const CHARACTER_REFERENCE = /^&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z\d]+);/;
const FENCE_OPENING = /^[ \t]*(`{3,}|~{3,})/;
const ELEMENT_TAG = /^<([\w-]+)/;
const TASK_MARKER = /^([ \t]*(?:[-+*]|\d+[.)])[ \t]+\[)([ xX])(\])/;
const CONTAINER_PREFIX = /^[ \t]*(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+)?/;
const CONTAINER_LIST_MARKER = /(?:[-+*]|\d+[.)])[ \t]+$/;
const NEWLINE_PARTS = /(\r\n|\r|\n)/;
const CONTINUATION_PREFIX = /^[ \t>]*/;
const TRAILING_CR = /\r$/;
const INLINE = new Set([
	"text",
	"inlineCode",
	"emphasis",
	"strong",
	"delete",
	"link",
	"linkReference",
	"break",
	"image",
	"imageReference",
	"footnoteReference",
]);
const escapeHtml = (value: string) =>
	value
		.split("&")
		.join("&amp;")
		.split("<")
		.join("&lt;")
		.split(">")
		.join("&gt;")
		.split('"')
		.join("&quot;");
let instance = 0;

const safeLink = (value: string): string | null => {
	try {
		const url = new URL(value);
		return ["https:", "http:", "mailto:"].includes(url.protocol) ? value : null;
	} catch {
		return null;
	}
};

/** Immutable source spans are also the undo history's authority. Restored HTML
 * refers to the span it originally rendered, not a mutable id-to-latest-value
 * map. Editing an opaque node allocates a new version; old versions remain
 * usable until the document editor unmounts and its bounded undo history ends. */
export class SourcePreservingMarkdown implements MarkdownEditorCodec {
	private readonly prefix = `prompt${++instance}n`;
	private next = 0;
	private readonly spans = new Map<string, Span>();
	private snapshot: Snapshot = { source: "", children: [], start: 0, end: 0 };
	private readonly snapshots = new Map<string, Snapshot>();
	constructor(
		private readonly editSourceLabel: string,
		private readonly emptyTaskLabel = "",
	) {}

	private allocate(node: MarkdownNode, source: string, block: boolean): Span {
		const id = `${this.prefix}${this.next++}`;
		const start = node.position?.start.offset ?? 0;
		const end = node.position?.end.offset ?? start;
		const lineStart = source.lastIndexOf("\n", start - 1) + 1;
		const prefix =
			source.slice(lineStart, start).match(CONTAINER_PREFIX)?.[0] ?? "";
		// The AST range starts after a list/quote marker; continuation lines
		// still need that container prefix when an edited code owner is emitted.
		const continuationPrefix = prefix.replace(CONTAINER_LIST_MARKER, (marker) =>
			" ".repeat(marker.length),
		);
		const span: Span = {
			id,
			baseId: id,
			type: node.type,
			start,
			end,
			raw: source.slice(start, end),
			children: [],
			opaque: false,
			block,
			continuationPrefix,
		};
		this.spans.set(id, span);
		return span;
	}

	private opaqueHtml(span: Span): string {
		const tag = span.block ? "div" : "span";
		// Source is TEXT, never HTML. Images, scripts, event handlers, custom tags
		// and comments are all inert atoms; no src/style/event attribute survives.
		// Keep the complete class attribute in a plain literal: the theme/source
		// gate must audit every ground without evaluating interpolated HTML.
		return [
			`<${tag} ${NODE}="${span.id}" ${OPAQUE}="true" contenteditable="false" role="button" tabindex="0" aria-label="${escapeHtml(this.editSourceLabel)}"`,
			' class="cursor-pointer whitespace-pre-wrap break-words rounded-sm bg-sunken px-1 font-mono text-mono-sm text-ink-muted">',
			`${escapeHtml(span.raw)}</${tag}>`,
		].join("");
	}

	private renderNode(
		node: MarkdownNode,
		source: string,
		parentType = "root",
		header = false,
		tableAlignment?: (string | null)[],
		columnIndex = 0,
	): string {
		const n = node as unknown as {
			type: string;
			children?: MarkdownNode[];
			value?: string;
			depth?: number;
			ordered?: boolean;
			start?: number;
			checked?: boolean | null;
			url?: string;
			title?: string | null;
			lang?: string | null;
			align?: (string | null)[];
		};
		const block =
			parentType === "root" || (!INLINE.has(n.type) && n.type !== "html");
		const span = this.allocate(node, source, block);
		if (n.type === "text") span.text = n.value ?? "";
		const attr = `${NODE}="${span.id}"`;
		const children = () =>
			(n.children ?? [])
				.map((child, index) => {
					const before = this.next;
					const html = this.renderNode(
						child,
						source,
						n.type,
						header,
						tableAlignment,
						index,
					);
					span.children.push(`${this.prefix}${before}`);
					return html;
				})
				.join("");
		let result: string;
		switch (n.type) {
			case "text":
				result = `<span ${attr}>${escapeHtml(n.value ?? "")}</span>`;
				break;
			case "paragraph":
				result = `<p ${attr}>${children()}</p>`;
				break;
			case "heading": {
				const tag = `h${Math.max(1, Math.min(6, n.depth ?? 1))}`;
				result = `<${tag} ${attr}>${children()}</${tag}>`;
				break;
			}
			case "strong":
				result = `<strong ${attr}>${children()}</strong>`;
				break;
			case "emphasis":
				result = `<em ${attr}>${children()}</em>`;
				break;
			case "delete":
				result = `<del ${attr}>${children()}</del>`;
				break;
			case "inlineCode":
				result = `<code ${attr}>${escapeHtml(n.value ?? "")}</code>`;
				break;
			case "code":
				result = `<pre ${attr}><code${n.lang ? ` class="language-${escapeHtml(n.lang)}"` : ""}>${escapeHtml(n.value ?? "")}\n</code></pre>`;
				break;
			case "blockquote":
				result = `<blockquote ${attr}>${children()}</blockquote>`;
				break;
			case "list": {
				const tag = n.ordered ? "ol" : "ul";
				result = `<${tag} ${attr}${n.ordered && n.start !== undefined ? ` start="${n.start}"` : ""}>${children()}</${tag}>`;
				break;
			}
			case "listItem": {
				const taskText = (node: MarkdownNode): string => {
					const value = (node as MarkdownNode & { value?: string }).value;
					return value ?? (node.children ?? []).map(taskText).join("");
				};
				const taskLabel =
					(n.children ?? []).map(taskText).join(" ").trim() ||
					this.emptyTaskLabel;
				result = `<li ${attr}${n.checked !== null && n.checked !== undefined ? ' class="task-list-item"' : ""}>${n.checked !== null && n.checked !== undefined ? `<input type="checkbox"${n.checked ? " checked" : ""} aria-label="${escapeHtml(taskLabel)}"/> ` : ""}${children()}</li>`;
				break;
			}
			case "break":
				result = `<br ${attr}/>`;
				break;
			case "thematicBreak":
				result = `<hr ${attr}/>`;
				break;
			case "link": {
				const href = safeLink(n.url ?? "");
				if (!href) {
					span.opaque = true;
					result = this.opaqueHtml(span);
				}
				// Editing instructions must not expose a navigation primitive:
				// auxclick/context-menu actions can bypass React click handlers.
				else
					result = `<span ${attr} data-prompt-link="true" class="text-accent underline" title="${escapeHtml(n.title ?? href)}">${children()}</span>`;
				break;
			}
			case "linkReference":
				result = `<span ${attr} class="text-accent underline">${children()}</span>`;
				break;
			case "table": {
				const rows = n.children ?? [];
				const rendered = rows.map((row, index) => {
					const before = this.next;
					const html = this.renderNode(
						row,
						source,
						n.type,
						index === 0,
						n.align,
					);
					span.children.push(`${this.prefix}${before}`);
					return html;
				});
				result = `<table ${attr}><thead>${rendered[0] ?? ""}</thead><tbody>${rendered.slice(1).join("")}</tbody></table>`;
				break;
			}
			case "tableRow":
				result = `<tr ${attr}>${children()}</tr>`;
				break;
			case "tableCell": {
				const tag = header ? "th" : "td";
				const alignment = tableAlignment?.[columnIndex];
				const align =
					alignment && ["left", "center", "right"].includes(alignment)
						? ` align="${alignment}"`
						: "";
				result = `<${tag} ${attr}${align}>${children()}</${tag}>`;
				break;
			}
			default:
				span.opaque = true;
				result = this.opaqueHtml(span);
		}
		return result;
	}

	private findSpan(element: Element): Span | undefined {
		return this.spans.get(element.getAttribute(NODE) ?? "");
	}

	/** Stop at recorded children: compare a node's own structure rather than
	 * flattening its descendants. Text-only changes can then patch a single
	 * source leaf without normalizing neighbouring delimiters or list spacing. */
	private skeleton(element: Element, owner: Element = element): string {
		if (element !== owner) {
			const child = this.findSpan(element);
			if (child) return `@${child.baseId}`;
		}
		const attrs = [...element.attributes]
			.filter(
				(a) =>
					![NODE, OPAQUE].includes(a.name) &&
					!(element.tagName === "INPUT" && a.name === "checked"),
			)
			.map((a) => `${a.name}=${a.value}`)
			.sort();
		return `<${element.tagName} ${attrs.join("|")}>${[...element.childNodes].map((child) => (child.nodeType === 1 ? this.skeleton(child as Element, owner) : child.nodeType === 3 ? JSON.stringify(child.textContent) : "")).join("")}</${element.tagName}>`;
	}

	private capture(html: string, snapshot: Snapshot): string {
		const template = window.document.createElement("template");
		template.innerHTML = html;
		for (const element of template.content.querySelectorAll(`[${NODE}]`)) {
			const span = this.findSpan(element);
			if (span) {
				span.html = element.outerHTML;
				span.skeleton = this.skeleton(element);
			}
		}
		for (const id of snapshot.children) this.snapshots.set(id, snapshot);
		return template.innerHTML;
	}

	private renderSnapshot = (source: string): string => {
		const tree = parser.parse(source);
		const ids: string[] = [];
		const html = tree.children
			.map((node) => {
				const before = this.next;
				const rendered = this.renderNode(node, source);
				ids.push(`${this.prefix}${before}`);
				return rendered;
			})
			.join("");
		this.snapshot = { source, children: ids, start: 0, end: source.length };
		return this.capture(html, this.snapshot);
	};

	render = (source: string): string => {
		// A rich/source remount has disposed the editor's old undo manager. Do
		// not retain every long-document generation across mode toggles; ids
		// remain monotonic so a dialog can never target a recycled node version.
		this.spans.clear();
		this.snapshots.clear();
		return this.renderSnapshot(source);
	};

	insertSource = (source: string): string => {
		const current = this.snapshot;
		const html = this.renderSnapshot(source);
		this.snapshot = current;
		// Toolbar links/images are inline insertions, not new paragraph owners.
		const fragment = window.document.createElement("template");
		fragment.innerHTML = html;
		return fragment.content.children.length === 1 &&
			fragment.content.firstElementChild?.tagName === "P"
			? fragment.content.firstElementChild.innerHTML
			: html;
	};

	private ownedChildren(element: Element): Element[] {
		return [...element.querySelectorAll(`[${NODE}]`)].filter(
			(child) => child.parentElement?.closest(`[${NODE}]`) === element,
		);
	}

	private serializeOwner(element: Element): string {
		const clone = element.cloneNode(true) as Element;
		const tokens = new Map<string, string>();
		for (const atom of [...clone.querySelectorAll(`[${NODE}]`)]) {
			const span = this.findSpan(atom);
			if (
				!span ||
				(!span.opaque &&
					(!INLINE.has(span.type) || atom.outerHTML !== span.html))
			)
				continue;
			// No underscores/punctuation: the converter must not escape a token or
			// interpret it as Markdown. The token never reaches canonical storage.
			let token: string;
			do {
				token = `PROMPTISLAND${this.prefix}${this.next++}END`;
			} while (clone.textContent?.includes(token));
			tokens.set(token, span.raw);
			atom.replaceWith(window.document.createTextNode(token));
		}
		let markdown = htmlToMarkdown(clone.outerHTML);
		if (tokens.size)
			markdown = markdown.replace(
				new RegExp([...tokens.keys()].join("|"), "g"),
				(token) => tokens.get(token) ?? token,
			);
		return markdown;
	}

	private patchText(span: Span, value: string): string | null {
		const previous = span.text;
		if (previous === undefined) return null;
		if (previous === value) return span.raw;
		type Segment = {
			rawStart: number;
			rawEnd: number;
			decodedStart: number;
			decodedEnd: number;
			text: string;
		};
		const segments: Segment[] = [];
		let decoded = "";
		const decodeLine = (
			raw: string,
			origin: number,
		): {
			text: string;
			pieces: { rawStart: number; rawEnd: number; text: string }[];
		} => {
			const pieces: { rawStart: number; rawEnd: number; text: string }[] = [];
			let text = "";
			for (let index = 0; index < raw.length; ) {
				const start = index;
				let part = String.fromCodePoint(raw.codePointAt(index) ?? 0);
				index += part.length;
				if (part === "\\" && ESCAPABLE_MARKDOWN.test(raw[index] ?? ""))
					part = raw[index++];
				else if (part === "&") {
					const entity = raw.slice(start).match(CHARACTER_REFERENCE);
					if (entity) {
						const decoder = window.document.createElement("textarea");
						decoder.innerHTML = entity[0];
						part = decoder.value;
						index = start + entity[0].length;
					}
				}
				pieces.push({
					rawStart: origin + start,
					rawEnd: origin + index,
					text: part,
				});
				text += part;
			}
			return { text, pieces };
		};
		const rawLines = span.raw.split(NEWLINE_PARTS);
		const expectedLines = previous.split("\n");
		const prefixes: string[] = [];
		let rawOffset = 0;
		for (let line = 0; line < expectedLines.length; line++) {
			const rawLine = rawLines[line * 2] ?? "";
			const newline = rawLines[line * 2 + 1] ?? "";
			const prefixLimit =
				line === 0 ? 0 : (rawLine.match(CONTINUATION_PREFIX)?.[0].length ?? 0);
			let matched: ReturnType<typeof decodeLine> | null = null;
			let skipped = 0;
			for (; skipped <= prefixLimit; skipped++) {
				const candidate = decodeLine(
					rawLine.slice(skipped),
					rawOffset + skipped,
				);
				if (candidate.text === expectedLines[line]) {
					matched = candidate;
					break;
				}
			}
			if (!matched) return null;
			prefixes.push(rawLine.slice(0, skipped));
			for (const piece of matched.pieces) {
				segments.push({
					...piece,
					decodedStart: decoded.length,
					decodedEnd: decoded.length + piece.text.length,
				});
				decoded += piece.text;
			}
			rawOffset += rawLine.length;
			if (newline) {
				segments.push({
					rawStart: rawOffset,
					rawEnd: rawOffset + newline.length,
					decodedStart: decoded.length,
					decodedEnd: decoded.length + 1,
					text: "\n",
				});
				decoded += "\n";
				rawOffset += newline.length;
			}
		}
		if (decoded !== previous) return null;
		let before = 0;
		let after = 0;
		while (
			before < previous.length &&
			before < value.length &&
			previous[before] === value[before]
		)
			before++;
		while (
			after < previous.length - before &&
			after < value.length - before &&
			previous[previous.length - after - 1] === value[value.length - after - 1]
		)
			after++;
		const oldEnd = previous.length - after;
		const startPiece = segments.find(
			(piece) => piece.decodedStart < before && before < piece.decodedEnd,
		);
		const endPiece = segments.find(
			(piece) => piece.decodedStart < oldEnd && oldEnd < piece.decodedEnd,
		);
		// Entities may decode to several code points; astral characters occupy
		// two UTF-16 units. Expand BOTH boundaries to their complete source
		// segments and re-emit unchanged decoded context, never a partial entity.
		const expandedStart = startPiece?.decodedStart ?? before;
		const expandedEnd = endPiece?.decodedEnd ?? oldEnd;
		const replacement = value.slice(
			expandedStart,
			value.length - after + expandedEnd - oldEnd,
		);
		const begin = `${this.prefix}BEGIN`;
		const end = `${this.prefix}END`;
		const escapeLine = (line: string): string | null => {
			const escaped = htmlToMarkdown(
				`<p>${begin}${escapeHtml(line)}${end}</p>`,
			);
			const from = escaped.indexOf(begin);
			const to = escaped.lastIndexOf(end);
			return from >= 0 && to >= from
				? escaped.slice(from + begin.length, to)
				: null;
		};
		const escapedLines = replacement.split("\n").map(escapeLine);
		if (escapedLines.some((line) => line === null)) return null;
		const newline = span.raw.includes("\r\n") ? "\r\n" : "\n";
		const continuation =
			prefixes.find((prefix) => prefix.length > 0) ?? span.continuationPrefix;
		const encoded = escapedLines.join(newline + continuation);
		const rawBoundary = (offset: number): number =>
			segments.find((piece) => piece.decodedStart === offset)?.rawStart ??
			span.raw.length;
		return (
			span.raw.slice(0, rawBoundary(expandedStart)) +
			encoded +
			span.raw.slice(rawBoundary(expandedEnd))
		);
	}

	private reconcile(span: Span, element: Element): string | null {
		const checkboxChanged = [
			...element.querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
		].some((input) => input.checked !== input.hasAttribute("checked"));
		if (span.opaque || (element.outerHTML === span.html && !checkboxChanged))
			return span.raw;
		if (
			span.type === "code" &&
			element.tagName === "PRE" &&
			element.querySelector("code")
		) {
			const firstLine = span.raw.indexOf("\n");
			const opening = span.raw.slice(0, firstLine).replace(TRAILING_CR, "");
			const match = opening.match(FENCE_OPENING);
			if (firstLine >= 0 && match) {
				const fence = match[1];
				const indent = opening.slice(0, match[0].length - fence.length);
				const info = opening.slice(match[0].length);
				const newline = span.raw[firstLine - 1] === "\r" ? "\r\n" : "\n";
				const lastLineStart = span.raw.lastIndexOf("\n") + 1;
				const lastLine = span.raw.slice(lastLineStart);
				const closing = lastLine.startsWith(span.continuationPrefix)
					? lastLine
							.slice(span.continuationPrefix.length)
							.match(
								new RegExp(`^([ \t]*)(${fence[0]}{${fence.length},})([ \t]*)$`),
							)
					: null;
				const closed = lastLineStart >= firstLine + 1 && closing !== null;
				const text = element.querySelector("code")?.textContent ?? "";
				const body = text.endsWith("\n") ? text.slice(0, -1) : text;
				// Only a matching delimiter line is a closing fence. An unclosed
				// source's final body line must not also be appended as a suffix.
				// Grow both fences beyond every literal run in the edited body so
				// inserting a delimiter cannot turn later instructions into prose.
				const runs = body.match(new RegExp(`${fence[0]}+`, "g")) ?? [];
				const length = runs.reduce(
					(length, run) => Math.max(length, run.length + 1),
					fence.length,
				);
				const marker = fence[0].repeat(length);
				const prefix = span.continuationPrefix + indent;
				const encodedBody = prefix + body.split("\n").join(newline + prefix);
				const suffix =
					closed && closing
						? newline +
							span.continuationPrefix +
							closing[1] +
							fence[0].repeat(Math.max(length, closing[2].length)) +
							closing[3]
						: span.raw.endsWith("\n")
							? newline
							: "";
				return indent + marker + info + newline + encodedBody + suffix;
			}
		}
		if (span.type === "text") {
			if (!element.children.length) {
				const patched = this.patchText(span, element.textContent ?? "");
				if (patched !== null) return patched;
			}
			// Sentinels preserve boundary whitespace; the ordinary converter trims
			// a standalone fragment and would join this leaf to the next word.
			const start = `${this.prefix}BEGIN`;
			const end = `${this.prefix}END`;
			const fragment = element.cloneNode(true) as Element;
			fragment.prepend(window.document.createTextNode(start));
			fragment.append(window.document.createTextNode(end));
			const converted = this.serializeOwner(fragment);
			const from = converted.indexOf(start);
			const to = converted.lastIndexOf(end);
			return from >= 0 && to >= from
				? converted.slice(from + start.length, to)
				: null;
		}
		if (
			element.tagName !== span.html?.match(ELEMENT_TAG)?.[1]?.toUpperCase() ||
			this.skeleton(element) !== span.skeleton
		)
			return null;
		const actual = this.ownedChildren(element);
		if (actual.length !== span.children.length) return null;
		const patches: { start: number; end: number; value: string }[] = [];
		if (span.type === "listItem") {
			const input = element.querySelector<HTMLInputElement>(
				":scope > input[type=checkbox]",
			);
			const marker = span.raw.match(TASK_MARKER);
			if (input && marker) {
				const value = input.checked
					? marker[2].trim()
						? marker[2]
						: "x"
					: " ";
				if (value !== marker[2])
					patches.push({
						start: marker[1].length,
						end: marker[1].length + 1,
						value,
					});
			}
		}
		for (let index = 0; index < actual.length; index++) {
			const child = this.findSpan(actual[index]);
			const expected = this.spans.get(span.children[index]);
			if (!child || !expected || child.baseId !== expected.baseId) return null;
			const value = this.reconcile(child, actual[index]);
			if (value === null) return null;
			if (value !== expected.raw)
				patches.push({
					start: expected.start - span.start,
					end: expected.end - span.start,
					value,
				});
		}
		let result = span.raw;
		for (const patch of patches.sort((a, b) => b.start - a.start))
			result =
				result.slice(0, patch.start) + patch.value + result.slice(patch.end);
		return result;
	}

	read = (root: HTMLElement): string => {
		const nodes = [...root.childNodes].flatMap((node) => {
			if (node.nodeType === 1) return [node as Element];
			if (node.nodeType !== 3 || !node.textContent) return [];
			const span = window.document.createElement("span");
			span.textContent = node.textContent;
			return [span];
		});
		// Undo can restore an entire earlier DOM: select the immutable document
		// snapshot referenced by those original ids, not the most recent source.
		const first = nodes.map((n) => this.findSpan(n)).find(Boolean);
		const snapshot =
			(first && this.snapshots.get(first.baseId)) ?? this.snapshot;
		const originals = snapshot.children;
		let result = "";
		let previousIndex = -1;
		for (const element of nodes) {
			const span = this.findSpan(element);
			const index = span ? originals.indexOf(span.baseId) : -1;
			const original =
				index >= 0 ? this.spans.get(originals[index]) : undefined;
			const previous =
				previousIndex >= 0
					? this.spans.get(originals[previousIndex])
					: undefined;
			const separator =
				original && index === previousIndex + 1
					? snapshot.source.slice(
							previous?.end ?? snapshot.start,
							original.start,
						)
					: result
						? "\n\n"
						: "";
			const raw = span
				? (this.reconcile(span, element) ?? this.serializeOwner(element))
				: this.serializeOwner(element);
			result += separator + raw;
			previousIndex = index;
		}
		const last =
			previousIndex >= 0 ? this.spans.get(originals[previousIndex]) : undefined;
		if (last && previousIndex === originals.length - 1)
			result += snapshot.source.slice(last.end, snapshot.end);
		else if (!nodes.length)
			return snapshot.children.length ? "" : snapshot.source;
		return result;
	};

	getOpaque = (element: Element): { id: string; source: string } | null => {
		const atom = element.closest(`[${OPAQUE}]`);
		const span = atom && this.findSpan(atom);
		return span?.opaque ? { id: span.id, source: span.raw } : null;
	};

	replaceOpaque = (
		root: HTMLElement,
		id: string,
		expected: string,
		source: string,
	): string | null => {
		if (this.read(root) !== expected) return null;
		const previous = this.spans.get(id);
		const element = root.querySelector(`[${NODE}="${id}"]`);
		if (!previous?.opaque || !element) return null;
		const next: Span = {
			...previous,
			id: `${this.prefix}${this.next++}`,
			raw: source,
		};
		this.spans.set(next.id, next);
		const template = window.document.createElement("template");
		template.innerHTML = this.opaqueHtml(next);
		const replacement = template.content.firstElementChild;
		if (!replacement) return null;
		next.html = replacement.outerHTML;
		next.skeleton = this.skeleton(replacement);
		element.replaceWith(replacement);
		return this.read(root);
	};
}
