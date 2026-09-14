/**
 * Turn grouping for the message list.
 *
 * The conversation is not a list of nine equal rows; it is a handful of
 * *turns*, each of which may contain several rows. A user turn is one message.
 * An agent turn is everything the agent did before handing back: some trace
 * lines, maybe a security notice, maybe a question, and the answer.
 *
 * Every messaging surface worth copying draws that distinction with space
 * rather than chrome — Slack and iMessage collapse consecutive messages from
 * one speaker into a block with a single avatar and a single timestamp; Linear's
 * activity feed does the same for consecutive events by one actor. Before this
 * existed, `messages-view` used one flat 16px gap for every pair of rows and
 * `message-item` cancelled it again with a `-mt-4` sibling hack so that runs of
 * traces would close up. Both the rhythm and the hack are replaced by one
 * pass over the list that answers three questions per row:
 *
 *  - how much air goes above it (`boundary`),
 *  - does it open an agent turn, and therefore carry the avatar (`isTurnStart`),
 *  - is a time divider due before it (`divider`).
 *
 * The pass runs over *rendered* rows only. `message-item` hides several record
 * kinds outright, and a hidden row must not consume the turn's avatar or leave
 * a gap behind, so `isMessageHidden` — the same predicate `message-item`
 * itself uses — filters the list first.
 */

import type { Message } from "../types/message";

/** How a row relates vertically to the row above it. */
export type TurnBoundary =
	/** First row in the list: no space above. */
	| "first"
	/** A new speaker, or a divider: the section-tier gap. */
	| "turn"
	/** Another row of the same turn, of a different kind: component tier. */
	| "item"
	/** Another trace line directly below a trace line: within-component tier. */
	| "trace";

export type MessageKind = "divider" | "user" | "trace" | "agent";

export type GroupedMessage = {
	message: Message;
	kind: MessageKind;
	boundary: TurnBoundary;
	/** The row opens an agent turn, so it carries the avatar. */
	isTurnStart: boolean;
	/** A time divider to render above the row, or undefined. */
	divider?: string;
};

/**
 * A new-day divider always appears. Within a day, a divider appears when the
 * conversation was genuinely put down and picked up again — an hour is long
 * enough that no single agent run spans it, so this never splits a turn.
 */
const SAME_DAY_GAP_MS = 60 * 60 * 1000;

const isSameDay = (a: Date, b: Date): boolean =>
	a.getFullYear() === b.getFullYear() &&
	a.getMonth() === b.getMonth() &&
	a.getDate() === b.getDate();

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
	hour: "numeric",
	minute: "2-digit",
});
const WEEKDAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
	day: "numeric",
	month: "long",
	year: "numeric",
});

/**
 * The divider label: a day name where the day is what changed, a clock time
 * where only the hour did. Deliberately not "2026-03-14" on every row — the
 * exact stamp of any single message is still one hover away on its meta row.
 */
export const formatDividerLabel = (date: Date, now = new Date()): string => {
	if (isSameDay(date, now)) return `Today ${TIME_FORMAT.format(date)}`;

	const yesterday = new Date(now);
	yesterday.setDate(now.getDate() - 1);
	if (isSameDay(date, yesterday))
		return `Yesterday ${TIME_FORMAT.format(date)}`;

	const weekAgo = new Date(now);
	weekAgo.setDate(now.getDate() - 6);
	if (date > weekAgo) {
		return `${WEEKDAY_FORMAT.format(date)} ${TIME_FORMAT.format(date)}`;
	}

	return `${DATE_FORMAT.format(date)}, ${TIME_FORMAT.format(date)}`;
};

/**
 * Whether `message-item` renders nothing for this record.
 *
 * Lives here rather than in `message-item` because the grouping pass has to
 * agree with it exactly: a row that renders nothing must not take the avatar,
 * open a turn, or leave its gap behind. `message-item` imports it back.
 */
export const isMessageHidden = (
	message: Message,
	showAgentReasoning: boolean,
): boolean => {
	const executionType = message.execution_type;
	const isTrace = executionType === "action";
	const isReasoning =
		executionType === "plan" || executionType === "reflection";
	const isActionish =
		isTrace || isReasoning || executionType === "security_check";

	// ASK/DONE action records of a conversation task duplicate the paired
	// response record, so the pair renders once.
	if (
		(message.action === "DONE" || message.action === "ASK") &&
		isTrace &&
		message.task_classification === "conversation"
	) {
		return true;
	}

	const isContentEmpty =
		!message.message &&
		(!message.files || message.files.length === 0) &&
		!message.code &&
		!message.stdout &&
		!message.stderr &&
		!message.logging;
	if (isContentEmpty && message.is_complete && !isActionish) {
		return true;
	}

	return isReasoning && !showAgentReasoning;
};

export const getMessageKind = (message: Message): MessageKind => {
	if (message.execution_type === "info") return "divider";
	if (message.role === "user") return "user";
	if (message.execution_type === "action" && message.action !== "ASK") {
		return "trace";
	}
	return "agent";
};

/** Which side of the column a row sits on. Dividers belong to neither. */
const speakerOf = (kind: MessageKind): "user" | "agent" | "none" =>
	kind === "divider" ? "none" : kind === "user" ? "user" : "agent";

/**
 * Decorates the rendered rows with their vertical relation, avatar ownership
 * and any due time divider.
 *
 * @param messages - The rows in display order, oldest first.
 * @param showAgentReasoning - The user preference; hidden reasoning rows are
 *   dropped before grouping so they leave no gap.
 * @param now - Injectable clock, so divider labels are testable and stories
 *   are deterministic.
 */
export const groupMessages = (
	messages: Message[],
	showAgentReasoning: boolean,
	now?: Date,
): GroupedMessage[] => {
	const visible = messages.filter(
		(message) => !isMessageHidden(message, showAgentReasoning),
	);

	let previousKind: MessageKind | null = null;
	let previousTime: Date | null = null;

	return visible.map((message) => {
		const kind = getMessageKind(message);
		const time = message.timestamp;

		let divider: string | undefined;
		if (previousTime && time instanceof Date && !Number.isNaN(+time)) {
			const gap = +time - +previousTime;
			if (!isSameDay(time, previousTime) || gap >= SAME_DAY_GAP_MS) {
				divider = formatDividerLabel(time, now);
			}
		}

		let boundary: TurnBoundary;
		if (previousKind === null) {
			boundary = "first";
		} else if (
			divider ||
			kind === "divider" ||
			previousKind === "divider" ||
			speakerOf(kind) !== speakerOf(previousKind)
		) {
			boundary = "turn";
		} else if (kind === "trace" && previousKind === "trace") {
			boundary = "trace";
		} else {
			boundary = "item";
		}

		const isTurnStart =
			speakerOf(kind) === "agent" &&
			(boundary === "first" || boundary === "turn");

		previousKind = kind;
		if (time instanceof Date && !Number.isNaN(+time)) previousTime = time;

		return { message, kind, boundary, isTurnStart, divider };
	});
};

/**
 * The gap above a row, as Tailwind classes. Three tiers off the 4px ramp
 * (§ 5): 24px between turns, 12px between rows of one turn, 4px between
 * adjacent trace lines so a run of actions closes into one block. The compact
 * column takes the next tier down at each step.
 */
export const boundarySpacing = (
	boundary: TurnBoundary,
	isSmallView: boolean,
): string => {
	switch (boundary) {
		case "first":
			return "";
		case "turn":
			return isSmallView ? "mt-4" : "mt-6";
		case "item":
			return isSmallView ? "mt-2" : "mt-3";
		case "trace":
			return isSmallView ? "mt-0.5" : "mt-1";
	}
};
