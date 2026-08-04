/**
 * Derives the one-line label for a completed agent action, per
 * docs/branding.md § 7: the action named in the user's terms and the object
 * in monospace — "Read invoices/march.csv", not "Executing Code".
 *
 * The object slot has a fixed priority: the record's file path, then a count
 * of its attached files, then the first clause of the agent's own narration
 * of the step. The narration is deliberately last: it is the agent's voice,
 * and when a concrete object exists the verb plus object already says
 * everything the user needs at a glance.
 */

import type { ActionType } from "@shared/api/local-operator/types";
import {
	Book,
	CircleCheck,
	Code2,
	DoorOpen,
	HelpCircle,
	type LucideIcon,
	Pencil,
	PencilLine,
	Share2,
} from "lucide-react";

export type TraceLabel = {
	/** Past-tense verb for a completed action: "Read", "Ran code". */
	verb: string;
	/** Present-tense verb while the action is running: "Reading", "Running code". */
	runningVerb: string;
	/** The object of the verb: a path, a file count, or a short narration. */
	object?: string;
	/** Lucide glyph at 14px. An icon tile is forbidden (§ 7). */
	icon: LucideIcon;
};

/**
 * Strips a narration string down to one short clause suitable for a trace
 * line: no code fences, no markdown links, no newlines, capped in length.
 */
const shortenNarration = (text: string, max = 72): string => {
	const withoutFences = text.replace(/```[\s\S]*?```/g, " ");
	const withoutLinks = withoutFences.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
	let flat = withoutLinks.replace(/\s+/g, " ").trim();
	if (flat.length > max) {
		const cut = flat.slice(0, max);
		const lastSpace = cut.lastIndexOf(" ");
		flat = `${cut.slice(0, lastSpace > 32 ? lastSpace : max).trimEnd()}…`;
	}
	// A label reads worse with the sentence punctuation it was clipped from.
	return flat.replace(/[.!?…]+$/g, "").trimEnd();
};

/** Normalises a file reference for display: drops the file:// scheme. */
const displayPath = (path: string): string =>
	path.startsWith("file://") ? path.slice(7) : path;

const ACTION_META: Record<
	ActionType,
	{ verb: string; runningVerb: string; icon: LucideIcon }
> = {
	READ: { verb: "Read", runningVerb: "Reading", icon: Book },
	WRITE: { verb: "Wrote", runningVerb: "Writing", icon: Pencil },
	EDIT: { verb: "Edited", runningVerb: "Editing", icon: PencilLine },
	CODE: { verb: "Ran code", runningVerb: "Running code", icon: Code2 },
	DELEGATE: {
		verb: "Delegated work",
		runningVerb: "Delegating work",
		icon: Share2,
	},
	DONE: { verb: "Finished", runningVerb: "Finishing", icon: CircleCheck },
	ASK: { verb: "Asked", runningVerb: "Asking", icon: HelpCircle },
	BYE: {
		verb: "Ended the conversation",
		runningVerb: "Ending",
		icon: DoorOpen,
	},
};

const FALLBACK = {
	verb: "Worked on the request",
	runningVerb: "Working on the request",
	icon: Code2,
};

/**
 * Builds the label for one agent action.
 *
 * @param action - The record's action, if it carried one.
 * @param filePath - The record's `file_path`, if any.
 * @param files - The record's attached files, if any.
 * @param narration - The record's message text, used only as a last resort.
 */
export const getTraceLabel = (
	action?: ActionType,
	filePath?: string,
	files?: string[],
	narration?: string,
): TraceLabel => {
	const meta = action ? ACTION_META[action] : FALLBACK;

	let object: string | undefined;
	if (filePath) {
		object = displayPath(filePath);
	} else if (files && files.length > 0) {
		const concrete = files.filter((f) => !f.startsWith("data:"));
		if (concrete.length === 1) {
			object = displayPath(concrete[0]);
		} else if (concrete.length > 1) {
			object = `${concrete.length} files`;
		}
	}
	if (!object && narration) {
		const short = shortenNarration(narration);
		if (short) object = short;
	}

	return {
		verb: meta.verb,
		runningVerb: meta.runningVerb,
		object,
		icon: meta.icon,
	};
};
