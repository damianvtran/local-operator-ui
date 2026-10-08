/**
 * The panel rail's copy and its fixed order, as pure functions (#872).
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
 * A COUNT IS NEVER CAPPED HERE. The `9+` cap belongs to the drawn badge
 * (`countLabel(count, 9)`), a geometry fact about a 16px glyph; the name a screen
 * reader hears and the tooltip a pointer reads carry the exact number.
 */

/** The four triggers, in the rail's fixed top-to-bottom order. */
export const PANEL_RAIL_ORDER = [
	"run",
	"browser",
	"console",
	"canvas",
] as const;

export type PanelRailItemId = (typeof PANEL_RAIL_ORDER)[number];

const plural = (count: number, one: string, many: string): string =>
	count === 1 ? one : many;

/** The browser item's tooltip and accessible name. */
export function browserRailLabels(
	open: boolean,
	attentionCount: number,
): { tooltip: string; aria: string } {
	const verb = open ? "Close" : "Open";
	if (attentionCount <= 0) {
		return { tooltip: `${verb} browser`, aria: `${verb} browser` };
	}
	return {
		tooltip: `${verb} browser — ${attentionCount} ${plural(attentionCount, "approval", "approvals")} waiting`,
		aria: `${verb} browser, ${attentionCount} waiting`,
	};
}

/** The console item's tooltip and accessible name. */
export function consoleRailLabels(
	open: boolean,
	unseenCount: number,
): { tooltip: string; aria: string } {
	const verb = open ? "Close" : "Open";
	if (unseenCount <= 0) {
		return { tooltip: `${verb} console`, aria: `${verb} console` };
	}
	return {
		tooltip: `${verb} console — ${unseenCount} finished since you looked`,
		aria: `${verb} console, ${unseenCount} finished since you looked`,
	};
}

/** The canvas item's tooltip and accessible name; `cap` is the printed chord. */
export function canvasRailLabels(
	open: boolean,
	fileCount: number,
	cap: string,
): { tooltip: string; aria: string } {
	const verb = open ? "Close" : "Open";
	if (fileCount <= 0) {
		return {
			tooltip: `${verb} canvas (${cap})`,
			aria: `${verb} canvas (${cap})`,
		};
	}
	const noun = plural(fileCount, "file", "files");
	return {
		tooltip: `${verb} canvas (${cap}) — ${fileCount} ${noun}`,
		aria: `${verb} canvas (${cap}), ${fileCount} ${noun}`,
	};
}
