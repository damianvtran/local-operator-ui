/**
 * What a transcript row hands the clipboard, and which rows own a copy
 * affordance of their own.
 *
 * One module rather than logic inside the menu component, for
 * `message-actions.ts`'s reason: "which rows offer copy" and "what copy writes"
 * are rules with a right answer, and a frame can only show the row it DOES
 * paint, never its absence on the rows that must not have one. The desktop
 * suite asserts these directly (`scripts/transcript-copy-affordances.test.mjs`).
 *
 * TWO PAYLOADS PER ROW, deliberately:
 *
 * - `copyTextForRecord` is the PLAIN TEXT the reader can see: markdown
 *   delimiters are dropped (fence markers, heading hashes and emphasis) while
 *   list structure is kept as markers and indentation, and a reply-quoted turn
 *   copies the reply rather than the `<reply-to>` transport markup. It never
 *   derives from `innerText` - the record is the subject, and a windowed row's
 *   DOM is not.
 * - `copyMarkdownForRecord` is the ORIGINAL source where one exists, because
 *   code fences, lists and headings are the value a markdown reader pastes into
 *   a document. It is never derived from `innerText`: that loses fences and
 *   turns a list into prose.
 *
 * A `$skill` USER TURN IS READ THROUGH `skillRowOf` FIRST, exactly as the row
 * paints it. The persisted payload is the expanded header + SKILL.md body + the
 * typed request; both clipboard forms must be the typed line the reader sees,
 * not the wall of instructions the bubble already hides (`skill-row.ts`).
 *
 * TOOL ROWS have no markdown payload of their own, so both forms carry a fenced
 * block - the row's name, the call's identity/command, and its output - which
 * is what makes the pasted text recognisable as a ledger row rather than a
 * loose paragraph.
 */

import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { askResponseSummary, askTimeoutSummary } from "../ask-queue";
import { summaryFromArgs } from "../components/trace/tool-row-model";
import { parseReplies } from "../utils/reply-utils";
import { skillRowOf } from "./skill-row";
import type { TranscriptRecord } from "./transcript-reducer";

/** The row's output without the newline its transport always leaves. */
const TRAILING_WHITESPACE = /\s+$/;

/** The unit of a fold header that Copy text hands over. */
export type CopyableGroupSummary = { units: readonly string[] };

/**
 * Whether this row is MESSAGE-level and therefore owns the trailing gutter
 * affordance. Tool rows, fold headers, receipts and every other record kind are
 * readable lines with a context menu but no per-row control: a control on every
 * ledger line is the chrome the redesign removed.
 */
export function transcriptRowActions(record: TranscriptRecord): boolean {
	return record.kind === "user" || record.kind === "assistant";
}

/**
 * The typed line a persisted user turn stands for, before `parseReplies`.
 *
 * A skill payload is read back to the line the composer sent (`skill-row.ts`);
 * every other record is its own text. The reply prefix is dropped later, so a
 * skill turn that was itself a reply keeps the same split every turn gets.
 */
function visibleSourceFor(record: TranscriptRecord): string {
	if (record.kind !== "user" && record.kind !== "assistant") return "";
	return skillRowOf(record.text)?.text ?? record.text;
}

/**
 * Markdown source reduced to the words a reader sees.
 *
 * WHY A PARSER RATHER THAN REGEX STRIPPING. The first version unwrapped inline
 * code before running emphasis passes, so identifiers such as `_init_` lost
 * their underscores and inline globs lost their asterisks; a spaced `*` in
 * prose (`2 * 3 * 4`) was read as emphasis. A markdown reader must preserve
 * every byte inside code, so the
 * plain-text form is derived from the same mdast the renderer sees: text nodes
 * are taken verbatim, inline/fenced code keeps its value, and emphasis/link
 * wrappers contribute only their children. The two menu items are different
 * promises; `Copy text` is prose, `Copy as Markdown` is the source.
 *
 * The walk is deliberately small and only names the block separators the
 * transcript's own markdown produces; an unknown node falls through to its
 * children rather than losing them.
 */
type MdNode = {
	type: string;
	value?: string;
	alt?: string | null;
	ordered?: boolean;
	start?: number | null;
	children?: MdNode[];
};

const markdown = unified().use(remarkParse).use(remarkGfm);

/** Inline content: text, code and inline HTML keep their bytes; wrappers add nothing. */
function inlineText(node: MdNode): string {
	switch (node.type) {
		case "text":
		case "inlineCode":
		case "html":
			return node.value ?? "";
		case "image":
			return node.alt ?? "";
		case "break":
			return "\n";
		default:
			return (node.children ?? []).map(inlineText).join("");
	}
}

/** A table as one line per row, cells separated by the same pipe a reader sees. */
function tableText(node: MdNode): string {
	return (node.children ?? [])
		.map((row) =>
			(row.children ?? []).map((cell) => inlineText(cell)).join(" | "),
		)
		.join("\n");
}

/** Indent every line of `text` for a list item's continuation. */
function indentLines(text: string, indent: string): string {
	return text
		.split("\n")
		.map((line) => (line.length > 0 ? indent + line : line))
		.join("\n");
}

/**
 * A list, with markers and depth.
 *
 * Numbers are CONTENT, not a delimiter: the reader sees `1.`, `2.` and a nested
 * level indented under its parent. Unordered items keep `- ` for the same
 * reason. A nested list is a child of its item, so it is emitted at depth + 1
 * without being re-indented twice.
 */
function listText(node: MdNode, depth: number): string {
	const ordered = node.ordered === true;
	const start = typeof node.start === "number" ? node.start : 1;
	const indent = "  ".repeat(depth);
	const lines: string[] = [];
	(node.children ?? []).forEach((item, index) => {
		const marker = ordered ? `${start + index}. ` : "- ";
		let emitted = false;
		for (const child of item.children ?? []) {
			if (child.type === "list") {
				const nested = listText(child, depth + 1);
				if (!emitted) {
					lines.push(`${indent}${marker.trimEnd()}`);
					emitted = true;
				}
				lines.push(nested);
				continue;
			}
			const text = blockText(child, depth);
			if (text.trim().length === 0) continue;
			const textLines = text.split("\n");
			if (!emitted) {
				lines.push(`${indent}${marker}${textLines[0] ?? ""}`);
				for (const line of textLines.slice(1)) {
					lines.push(line.length > 0 ? `${indent}  ${line}` : line);
				}
				emitted = true;
				continue;
			}
			lines.push(indentLines(text, `${indent}  `));
		}
		if (!emitted) lines.push(`${indent}${marker.trimEnd()}`);
	});
	return lines.join("\n");
}

/** One block-level node as plain text, without its own trailing separator. */
function blockText(node: MdNode, depth: number): string {
	switch (node.type) {
		case "paragraph":
		case "heading":
			return inlineText(node);
		case "code":
		case "html":
			return node.value ?? "";
		case "blockquote":
			return blocksText(node.children ?? [], depth);
		case "list":
			return listText(node, depth);
		case "table":
			return tableText(node);
		case "thematicBreak":
			return "";
		default:
			if (node.children) return blocksText(node.children, depth);
			return node.value ?? "";
	}
}

/** Block children separated by a blank line, empty blocks dropped. */
function blocksText(nodes: MdNode[], depth: number): string {
	return nodes
		.map((node) => blockText(node, depth))
		.filter((text) => text.trim().length > 0)
		.join("\n\n");
}

function markdownToText(source: string): string {
	return blocksText(
		(markdown.parse(source) as unknown as MdNode).children ?? [],
		0,
	).trim();
}

/** The row's name and command, in the ledger's own vocabulary. */
function toolHeadline(
	record: Extract<TranscriptRecord, { kind: "tool" }>,
): string {
	return `${record.toolName} · ${summaryFromArgs(record.toolName, record.args)}`;
}

/** A tool row's output, when it produced one, without trailing blank lines. */
function toolOutput(
	record: Extract<TranscriptRecord, { kind: "tool" }>,
): string {
	return (record.output ?? "").replace(TRAILING_WHITESPACE, "");
}

/** The plain-text form of a tool row: the head line, then its output. */
function toolText(record: Extract<TranscriptRecord, { kind: "tool" }>): string {
	const output = toolOutput(record);
	return output.length > 0
		? `${toolHeadline(record)}\n\n${output}`
		: toolHeadline(record);
}

/** The same facts as one fenced block, so a paste keeps its machine register. */
function toolMarkdown(
	record: Extract<TranscriptRecord, { kind: "tool" }>,
): string {
	const output = toolOutput(record);
	const body = [`# ${toolHeadline(record)}`, output]
		.filter(Boolean)
		.join("\n\n");
	return `\`\`\`text\n${body}\n\`\`\``;
}

/**
 * The visible words of a row, as plain text.
 *
 * A record kind this switch does not know fails the declared `string` return,
 * so a new row cannot silently copy nothing.
 */
export function copyTextForRecord(record: TranscriptRecord): string {
	switch (record.kind) {
		case "user":
		case "assistant":
			return markdownToText(
				parseReplies(visibleSourceFor(record)).remainingContent,
			);
		case "tool":
			return toolText(record);
		case "custom":
			return [record.headline, record.detail].filter(Boolean).join("\n\n");
		case "peer":
			return record.body;
		case "wake":
		case "notice":
		case "compaction":
			return record.text;
		case "ask_response": {
			/*
			 * A dismissal has no answers to list; the harness renders it as one
			 * sentence for the same reason (`asks/render.py` refuses to pass a
			 * dismissed ask through the answer report).
			 */
			if (record.status === "dismissed") return askResponseSummary(record);
			const answered = record.questions.flatMap((question) => {
				const answers = record.answers[question.id] ?? [];
				return [
					question.question,
					answers.length > 0 ? answers.join(", ") : "No answer given",
				].join("\n");
			});
			return [askResponseSummary(record), ...answered]
				.filter(Boolean)
				.join("\n\n");
		}
		case "ask_timeout":
			return askTimeoutSummary(record);
		case "supplement":
			return record.files.map((file) => file.path).join("\n");
	}
}

/** The original markdown/source form of a row, where the row has one. */
export function copyMarkdownForRecord(record: TranscriptRecord): string {
	switch (record.kind) {
		case "user":
		case "assistant":
			/*
			 * The raw source, not the rendered text: a fence, a list and a table
			 * survive here and do not survive an `innerText` read. The
			 * `<reply-to>` prefix is transport, not markdown the reader wrote, so
			 * it is dropped for the same reason the visible half drops it. A skill
			 * payload is read back to the typed line first, so markdown does not
			 * smuggle the expanded SKILL.md past the row's own gate.
			 */
			return parseReplies(visibleSourceFor(record)).remainingContent;
		case "tool":
			return toolMarkdown(record);
		default:
			/*
			 * Receipts, wakes, notices, asks and supplement rows have no
			 * markdown source on the record; their visible sentence IS the
			 * source. Keeping one fallback here is what stops a second
			 * rendering-shaped copy path from growing per kind.
			 */
			return copyTextForRecord(record);
	}
}

/** A fold header's summary line, as the header paints it. */
export function copyTextForGroup(summary: CopyableGroupSummary): string {
	return summary.units.join(" · ").trim();
}

/** A fold summary carries no markdown; its sentence is already the source. */
export function copyMarkdownForGroup(summary: CopyableGroupSummary): string {
	return copyTextForGroup(summary);
}
