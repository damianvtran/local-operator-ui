/**
 * The panel rail's copy and its fixed order, as pure functions (#872, #896).
 *
 * WHY A MODULE OF STRINGS. These sentences were the chat header's, and four
 * harnesses, the onboarding tour and the accessibility name of every trigger read
 * them: the tooltip and the announced name of one control are two spellings of one
 * fact (`Open browser — 2 approvals waiting` against `Open browser, 2 waiting`),
 * and a function per control is what keeps the pair from drifting. The strings are
 * moved VERBATIM from `chat-header.tsx` (open states, singular/plural, the em dash)
 * so a user who learned them keeps them; the only new sentences are the two
 * CLOSE states the console and canvas never had, because their old triggers hid
 * while the pane was open and the rail's items do not.
 *
 * THE ASK ITEM'S SENTENCES ARE THE FIFTH AND KEEP THE SAME PROVENANCE (#896),
 * one hop removed: `askRailToggleLabel` in `ask-queue.ts` is the sentence the
 * header's asks trigger printed, and this module prints it rather than spelling
 * it a second time — see `askRailLabels` below for the two halves and their
 * sources.
 *
 * THE ACCESSIBLE NAME CARRIES NO STATE VERB (UX round 1, U2). Every item also
 * exposes `aria-pressed`, so a name that flipped to "Close browser" while the
 * control announced itself as pressed said the same fact twice, in two grammars
 * ("Close browser, toggle button, pressed"). The name is therefore the STABLE noun
 * ("Browser, 2 waiting") and the pressed state is the one voice for open/closed;
 * the TOOLTIP keeps the verb, because a sighted pointer user is reading the action
 * the press will take, and its sentences are the header's verbatim.
 *
 * A COUNT IS NEVER CAPPED HERE. The `9+` cap belongs to the drawn badge
 * (`countLabel(count, 9)`), a geometry fact about a 16px glyph; the name a screen
 * reader hears and the tooltip a pointer reads carry the exact number.
 */

import {
	type AskScope,
	askRailToggleLabel,
	askScopeSubject,
} from "@features/chat/ask-queue";

/**
 * The six triggers, in the rail's fixed top-to-bottom order.
 *
 * ASK GOES SECOND, its historical slot (#896). The pre-#872 header order was
 * Run -> Asks -> Browser -> Console -> Canvas (`9c0da1382af^`'s `chat-header.tsx`),
 * and the four panel triggers moved to the rail with their relative order
 * preserved; the asks trigger's return to its old position is the fifth item
 * arriving where it always stood. CODE REVIEW IS APPENDED LAST (the #927 fold
 * onto #917): its appearing moves nothing above it.
 */
export const PANEL_RAIL_ORDER = [
	"run",
	"ask",
	"browser",
	"console",
	"canvas",
	"code",
] as const;

export type PanelRailItemId = (typeof PANEL_RAIL_ORDER)[number];

const plural = (count: number, one: string, many: string): string =>
	count === 1 ? one : many;

/**
 * The parenthesised chord a BOUND action prints, or nothing when unbound.
 *
 * The canvas item established the shape (`Open canvas (⌘⇧C)`) and the family
 * follows it: the cap rides BOTH registers — the tooltip a pointer reads and
 * the accessible name a screen reader hears — because a promise the control
 * makes on the app's behalf is not a sighted-only fact (issue #928; unbound
 * actions print no parens at all rather than an empty pair).
 */
const capClause = (cap: string | null): string =>
	cap === null ? "" : ` (${cap})`;

/** The browser item's tooltip and accessible name; `cap` is the bound chord. */
export function browserRailLabels(
	open: boolean,
	attentionCount: number,
	cap: string | null,
): { tooltip: string; aria: string } {
	const verb = open ? "Close" : "Open";
	const chord = capClause(cap);
	if (attentionCount <= 0) {
		return { tooltip: `${verb} browser${chord}`, aria: `Browser${chord}` };
	}
	return {
		tooltip: `${verb} browser${chord} — ${attentionCount} ${plural(attentionCount, "approval", "approvals")} waiting`,
		aria: `Browser${chord}, ${attentionCount} waiting`,
	};
}

/** The console item's tooltip and accessible name; `cap` is the bound chord. */
export function consoleRailLabels(
	open: boolean,
	unseenCount: number,
	cap: string | null,
): { tooltip: string; aria: string } {
	const verb = open ? "Close" : "Open";
	const chord = capClause(cap);
	if (unseenCount <= 0) {
		return { tooltip: `${verb} console${chord}`, aria: `Console${chord}` };
	}
	return {
		tooltip: `${verb} console${chord} — ${unseenCount} finished since you looked`,
		aria: `Console${chord}, ${unseenCount} finished since you looked`,
	};
}

/** The canvas item's tooltip and accessible name; `cap` is the printed chord. */
export function canvasRailLabels(
	open: boolean,
	fileCount: number,
	cap: string | null,
): { tooltip: string; aria: string } {
	const verb = open ? "Close" : "Open";
	const chord = capClause(cap);
	if (fileCount <= 0) {
		return {
			tooltip: `${verb} canvas${chord}`,
			aria: `Canvas${chord}`,
		};
	}
	const noun = plural(fileCount, "file", "files");
	return {
		tooltip: `${verb} canvas${chord} — ${fileCount} ${noun}`,
		aria: `Canvas${chord}, ${fileCount} ${noun}`,
	};
}

/**
 * The asks item's tooltip and accessible name (#896).
 *
 * THE TOOLTIP IS THE DOOR'S OWN SENTENCE, not a recomposition: `askRailToggleLabel`
 * (ask-queue.ts) is the ONE derivation of `Open asks — This conversation, 3 waiting
 * or moved on` — the string the header trigger printed before the control moved to
 * the rail — so the item cannot grow a second grammar for the same fact.
 *
 * THE NAME IS THE STABLE NOUN, THE SCOPE AND THE COUNT — the family's U2 contract
 * (`Asks, This conversation, 3 waiting or moved on`): no verb, because `aria-pressed`
 * carries open/closed, and the subject's words come from `askScopeSubject`, the same
 * function the tooltip and the drawer's bar read, so the glyph, the words and both
 * spoken registers cannot name the two queues differently.
 */
export function askRailLabels(
	open: boolean,
	scope: AskScope,
	count: number,
): { tooltip: string; aria: string } {
	return {
		tooltip: askRailToggleLabel({ open, scope, count }),
		aria:
			count > 0
				? `Asks, ${askScopeSubject(scope)}, ${count} waiting or moved on`
				: `Asks, ${askScopeSubject(scope)}`,
	};
}

/**
 * The code review item's tooltip and accessible name (§8).
 *
 * APPENDED LAST, which is why the item may appear mid-session without moving
 * anything above it (the rail's own order note). The counts are `opened` and
 * `mentioned` - the two groups the pane draws - and a zero half is dropped,
 * because "0 mentioned" beside a count of everything states nothing; the mark
 * for attention adds its own clause (`checks failing` / `findings open`), the
 * chip's own tail.
 *
 * The CAP is never applied to a count here (the file's own rule): the name a
 * screen reader hears carries the exact numbers. The chord cap, when one is
 * bound, rides both registers like its four siblings' (issue #928) — it is a
 * promise about a press, not a count.
 */
export function codeRailLabels(
	open: boolean,
	opened: number,
	mentioned: number,
	attention: string | null,
	cap: string | null,
): { tooltip: string; aria: string } {
	const verb = open ? "Close" : "Open";
	const chord = capClause(cap);
	const halves = [
		opened > 0 ? `${opened} opened` : null,
		mentioned > 0 ? `${mentioned} mentioned` : null,
	].filter((half): half is string => half !== null);
	const details = halves.length > 0 ? halves.join(", ") : "";
	/*
	 * THE CAUSE, NAMED IN BOTH REGISTERS (design round 1, D5 / UX U6): the
	 * marker used to say "findings open" for a red pipeline, and the sighted
	 * tooltip did not carry it at all - the dot had no visible explanation.
	 * `attention` is the cause string (`checks failing` / `findings open` /
	 * both), not a boolean.
	 */
	const mark = attention ? `, ${attention}` : "";
	if (details === "") {
		return {
			tooltip: `${verb} code review${chord}${mark}`,
			aria: `Code review${chord}${mark}`,
		};
	}
	return {
		tooltip: `${verb} code review${chord} — ${details}${mark}`,
		aria: `Code review${chord}, ${details}${mark}`,
	};
}
