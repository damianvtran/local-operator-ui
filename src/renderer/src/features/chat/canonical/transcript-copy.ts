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
 * - `copyTextForRecord` is the PLAIN TEXT the reader can see: markdown syntax
 *   is stripped (fence markers, list bullets, heading hashes and emphasis all
 *   disappear) and a reply-quoted turn copies the reply rather than the
 *   `<reply-to>` transport markup. It never derives from `innerText` - the
 *   record is the subject, and a windowed row's DOM is not.
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
 * WHY A LOCAL DERIVATION. The two menu items are different promises: `Copy
 * text` is for pasting into prose, `Copy as Markdown` is for pasting into a
 * document that understands fences and lists. Returning the source for both
 * made the labels lie. The transform is deliberately small and line-oriented -
 * it handles the constructs the transcript renders most (fences, headings,
 * lists, tables, emphasis, links) and leaves anything it does not recognise as
 * written rather than guessing at a second markdown parser.
 */
function markdownToText(markdown: string): string {
	const lines = markdown.split("\n");
	const out: string[] = [];
	let inFence = false;
	for (const line of lines) {
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) {
			out.push(line);
			continue;
		}
		const tableRule = /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(line);
		if (tableRule) continue;
		const heading = line.replace(/^\s{0,3}#{1,6}\s+/, "");
		const quoted = heading.replace(/^\s{0,3}>\s?/, "");
		const bullet = quoted.replace(/^\s{0,3}[-*+]\s+/, "• ");
		const ordered = bullet.replace(/^\s{0,3}(\d+)[.)]\s+/, "$1. ");
		const task = ordered.replace(/^\s{0,3}\[[ xX]\]\s+/, "");
		const table = task.includes("|")
			? task
					.replace(/^\s*\|/, "")
					.replace(/\|\s*$/, "")
					.split("|")
					.map((cell) => cell.trim())
					.join(" | ")
			: task;
		out.push(
			table
				.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
				.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
				.replace(/`([^`]+)`/g, "$1")
				.replace(/\*\*([^*]+)\*\*/g, "$1")
				.replace(/__([^_]+)__/g, "$1")
				.replace(/~~([^~]+)~~/g, "$1")
				.replace(/(^|[^\w])\*([^*\n]+)\*(?=[^\w]|$)/g, "$1$2")
				.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, "$1$2"),
		);
	}
	return out
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
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
