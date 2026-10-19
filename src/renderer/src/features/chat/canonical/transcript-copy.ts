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
 * - `copyTextForRecord` is what the reader can SEE, so a reply-quoted turn
 *   copies the reply rather than the `<reply-to>` transport markup - the same
 *   derivation the prose renders (`parseReplies(...).remainingContent`), which
 *   is what keeps the clipboard from disagreeing with the screen.
 * - `copyMarkdownForRecord` is the ORIGINAL source where one exists
 *   (`record.text`), because code fences, lists and headings are the value a
 *   markdown reader pastes into a document. It is never derived from
 *   `innerText`: that loses fences and turns a list into prose.
 *
 * TOOL ROWS have no markdown payload of their own, so both forms carry a fenced
 * block - the row's name, the call's identity/command, and its output - which
 * is what makes the pasted text recognisable as a ledger row rather than a
 * loose paragraph.
 */

import { askResponseSummary, askTimeoutSummary } from "../ask-queue";
import { summaryFromArgs } from "../components/trace/tool-row-model";
import { parseReplies } from "../utils/reply-utils";
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
 * The visible words of a row.
 *
 * A record kind this switch does not know is a compile error in the default
 * arm's `satisfies` check, so a new row cannot silently copy nothing.
 */
export function copyTextForRecord(record: TranscriptRecord): string {
	switch (record.kind) {
		case "user":
		case "assistant":
			return parseReplies(record.text).remainingContent;
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
			 * it is dropped for the same reason the visible half drops it.
			 */
			return parseReplies(record.text).remainingContent;
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
