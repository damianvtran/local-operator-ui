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
 * LOCALE REPAINT BELONGS TO THE REACT CONSUMER. These derivations deliberately
 * remain framework-free and read the messages leaf at call time; PanelRail
 * subscribes through useI18nLocale so a language change calls them again. Do not
 * cache their formatted return values across a locale change.
 *
 * A COUNT IS NEVER CAPPED HERE. The `9+` cap belongs to the drawn badge
 * (`countLabel(count, 9)`), a geometry fact about a 16px glyph; the name a screen
 * reader hears and the tooltip a pointer reads carry the exact number.
 */

import { t } from "../../../../../i18n/messages";

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
	const state = open ? "open" : "closed";
	const chord = capClause(cap);
	if (attentionCount <= 0) {
		return {
			tooltip: t("ui.shell.rail.browser.tooltip", { state, chord }),
			aria: t("ui.shell.rail.browser.aria", { chord }),
		};
	}
	return {
		tooltip: t("ui.shell.rail.browser.tooltip_count", {
			state,
			chord,
			count: attentionCount,
			countText: String(attentionCount),
		}),
		aria: t("ui.shell.rail.browser.aria_count", {
			chord,
			count: attentionCount,
			countText: String(attentionCount),
		}),
	};
}

/** The console item's tooltip and accessible name; `cap` is the bound chord. */
export function consoleRailLabels(
	open: boolean,
	unseenCount: number,
	cap: string | null,
): { tooltip: string; aria: string } {
	const state = open ? "open" : "closed";
	const chord = capClause(cap);
	if (unseenCount <= 0) {
		return {
			tooltip: t("ui.shell.rail.console.tooltip", { state, chord }),
			aria: t("ui.shell.rail.console.aria", { chord }),
		};
	}
	return {
		tooltip: t("ui.shell.rail.console.tooltip_count", {
			state,
			chord,
			count: unseenCount,
			countText: String(unseenCount),
		}),
		aria: t("ui.shell.rail.console.aria_count", {
			chord,
			count: unseenCount,
			countText: String(unseenCount),
		}),
	};
}

/** The canvas item's tooltip and accessible name; `cap` is the printed chord. */
export function canvasRailLabels(
	open: boolean,
	fileCount: number,
	cap: string | null,
): { tooltip: string; aria: string } {
	const state = open ? "open" : "closed";
	const chord = capClause(cap);
	if (fileCount <= 0) {
		return {
			tooltip: t("ui.shell.rail.canvas.tooltip", { state, chord }),
			aria: t("ui.shell.rail.canvas.aria", { chord }),
		};
	}
	return {
		tooltip: t("ui.shell.rail.canvas.tooltip_count", {
			state,
			chord,
			count: fileCount,
			countText: String(fileCount),
		}),
		aria: t("ui.shell.rail.canvas.aria_count", {
			chord,
			count: fileCount,
			countText: String(fileCount),
		}),
	};
}

/**
 * The asks item's tooltip and accessible name (#896).
 *
 * THE TOOLTIP IS THE DOOR'S OWN SENTENCE, not a recomposition: `askRailToggleLabel`
 * (ask-queue.ts) is the ONE derivation of `Open asks — This conversation, 3 waiting`
 * — the string the header trigger printed before the control moved to
 * the rail — so the item cannot grow a second grammar for the same fact. The
 * sentence takes the bound cap itself (#928, review round 1's F2 = design D3), for
 * the same reason: the rail's tooltip must print the chord its dispatcher answers
 * like the five siblings, and printing it through the one derivation is what keeps
 * `Ask` from being the single item whose promise is invisible on the control.
 *
 * THE NAME IS THE STABLE NOUN, THE SCOPE AND THE COUNT — the family's U2 contract
 * (`Asks, This conversation, 3 waiting`): no verb, because `aria-pressed`
 * carries open/closed, and the subject's words come from `askScopeSubject`, the same
 * function the tooltip and the drawer's bar read, so the glyph, the words and both
 * spoken registers cannot name the two queues differently. The cap rides the noun
 * in this register too (`Asks (⌘A), This conversation…`).
 */
export function askRailLabels(
	open: boolean,
	scope: AskScope,
	count: number,
	cap: string | null,
	/*
	 * This conversation's unread notification updates (decisions D9, design
	 * § 18): the door's badge counts them beside the asks, so its accessible
	 * name must say both ("…, 1 waiting, 1 unread update"). Zero, or a backend
	 * without `features.notifications`, is exactly the pre-feature name.
	 */
	updates = 0,
): { tooltip: string; aria: string } {
	const chord = capClause(cap);
	if (updates > 0) {
		return {
			tooltip: askRailToggleLabel({ open, scope, count, cap }),
			aria: t("ui.notifications.rail.aria_with_updates", {
				chord,
				subject: askScopeSubject(scope),
				count,
				countText: String(count),
				updates,
				updatesText: String(updates),
			}),
		};
	}
	return {
		tooltip: askRailToggleLabel({ open, scope, count, cap }),
		aria:
			count > 0
				? t("ui.shell.rail.ask.aria_count", {
						chord,
						subject: askScopeSubject(scope),
						count,
						countText: String(count),
					})
				: t("ui.shell.rail.ask.aria", {
						chord,
						subject: askScopeSubject(scope),
					}),
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
	const state = open ? "open" : "closed";
	const chord = capClause(cap);
	const halves = [
		opened > 0
			? t("ui.shell.rail.code.opened", {
					count: opened,
					countText: String(opened),
				})
			: null,
		mentioned > 0
			? t("ui.shell.rail.code.mentioned", {
					count: mentioned,
					countText: String(mentioned),
				})
			: null,
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
			tooltip: t("ui.shell.rail.code.tooltip", { state, chord, mark }),
			aria: t("ui.shell.rail.code.aria", { chord, mark }),
		};
	}
	return {
		tooltip: t("ui.shell.rail.code.tooltip_details", {
			state,
			chord,
			details,
			mark,
		}),
		aria: t("ui.shell.rail.code.aria_details", { chord, details, mark }),
	};
}
