/**
 * The tab-actions menu's wire contract (LOH-13 operator report, 2026-10-25).
 *
 * WHY THE MENU IS NATIVE. A driven page is a native `WebContentsView` painting
 * above ALL renderer DOM, so a renderer menu that reaches into the content
 * rectangle can only be visible by HIDING the page (the S5 policy, which is what
 * put the "paused" note behind this menu). Electron's native `Menu` is drawn by
 * the OS above the view, so the page stays visible and no suppression is
 * registered for it. The same reason is why the page context menu lives in main
 * (`src/main/browser/page-context-menu.ts`): the gesture cannot be seen by the
 * renderer at all.
 *
 * WHY THE LIST TRAVELS FROM THE RENDERER. Only the strip knows the facts the
 * items describe - the rendered order its "move" items index into, the counts
 * its close labels disclose, and which optional hands (`onReorder`,
 * `onTabAction`) its host wired. Re-deriving those in main would be a second
 * copy of a rule that must agree with the visible rows exactly, and the counts
 * are the disclosure for a destructive press: a label that says "Close 2 other
 * tabs" must be computed from the same list the press will close.
 *
 * WHAT THE RENDERER MAY NOT DO. Ask for an item that is not in the fixed
 * vocabulary below. The payload is validated at the main boundary
 * (`tabActionsMenuRequestOrThrow`), so one malformed or unknown item rejects the
 * whole request rather than reaching `Menu.buildFromTemplate`. The return
 * direction is validated too (`tabActionsMenuSelectionOrNull`): main answers
 * with the item that was selected, and the strip runs the EXISTING handler for
 * that id. Nothing here carries authority: the item ids map onto actions the
 * strip could already perform, and the channel is absent from the agent browser
 * protocol (it is sender-authorized in `src/main/browser/ipc.ts` like every
 * other chrome channel).
 *
 * LABELS ARE RENDERER COPY. The label is the catalogue string, already
 * interpolated with its title/count by the strip. That is what keeps the menu
 * in the app's locale (`useI18nLocale` re-renders the strip) and avoids a second
 * catalogue reader in main for strings the renderer is already showing.
 */

/**
 * Every item the menu may carry, in the order the strip presents them.
 * `separator` is an item so the ORDER rule lives with the list rather than in
 * the Electron adapter; `header` is the menu's disabled title row.
 */
export const TAB_ACTIONS_MENU_ITEM_IDS = [
	"header",
	"watch",
	"hand-over",
	"revoke-hand-over",
	"move-left",
	"move-right",
	"mute",
	"unmute",
	"duplicate",
	"reload",
	"separator",
	"close",
	"close-others",
	"close-right",
	"close-failed",
	"close-conversation",
	"copy-url",
] as const;

export type TabActionsMenuItemId = (typeof TAB_ACTIONS_MENU_ITEM_IDS)[number];

/** An id the strip can be handed back: everything except the non-actions. */
export type TabActionsMenuActionId = Exclude<
	TabActionsMenuItemId,
	"header" | "separator"
>;

export const TAB_ACTIONS_MENU_ACTION_IDS = [
	"watch",
	"hand-over",
	"revoke-hand-over",
	"move-left",
	"move-right",
	"mute",
	"unmute",
	"duplicate",
	"reload",
	"close",
	"close-others",
	"close-right",
	"close-failed",
	"close-conversation",
	"copy-url",
] as const satisfies readonly TabActionsMenuActionId[];

export interface TabActionsMenuItem {
	id: TabActionsMenuItemId;
	/** The catalogue string, already interpolated. Empty for a separator. */
	label: string;
	/** False renders disabled; the header is always false. */
	enabled: boolean;
}

export interface TabActionsMenuRequest {
	/** The tab whose trigger was pressed. Every action is scoped to it. */
	tabId: number;
	/**
	 * Where the popup hangs, in CSS px relative to the renderer viewport - the
	 * same coordinate space the page context menu's `params.x`/`params.y` use.
	 * The bottom-left corner of the trigger, so the menu opens under it.
	 */
	anchor: { x: number; y: number };
	items: TabActionsMenuItem[];
}

export type TabActionsMenuSelection = TabActionsMenuActionId | null;

const ITEM_IDS = new Set<string>(TAB_ACTIONS_MENU_ITEM_IDS);
const ACTION_IDS = new Set<string>(TAB_ACTIONS_MENU_ACTION_IDS);

/** Bounds are shape checks, not display limits: a menu item's label is one
 * catalogue sentence, and an unbounded string is an unbounded IPC payload. */
const MAX_ITEMS = 40;
const MAX_LABEL = 300;
/** A menu hanging off a window that is not on a screen can use any finite
 * point; the bound keeps a nonsense payload from reaching Electron's popup. */
const MAX_ANCHOR = 100_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumberOrThrow(value: unknown, name: string): number {
	if (typeof value !== "number" || !Number.isFinite(value))
		throw new Error(`${name} must be a finite number.`);
	return value;
}

/**
 * Validate one renderer-to-main request, or throw.
 *
 * The whole request is rejected on the first unknown or malformed item: a menu
 * that silently dropped an item would be a different menu from the one the
 * strip believes it showed, and nothing in the payload is repairable without
 * guessing what the user meant to press.
 */
export function tabActionsMenuRequestOrThrow(
	value: unknown,
): TabActionsMenuRequest {
	if (!isRecord(value))
		throw new Error("A tab actions menu request is required.");
	const tabId = value.tabId;
	if (typeof tabId !== "number" || !Number.isSafeInteger(tabId) || tabId <= 0)
		throw new Error("tabId must be a positive tab id.");
	const anchor = value.anchor;
	if (!isRecord(anchor)) throw new Error("anchor is required.");
	const x = finiteNumberOrThrow(anchor.x, "anchor.x");
	const y = finiteNumberOrThrow(anchor.y, "anchor.y");
	if (Math.abs(x) > MAX_ANCHOR || Math.abs(y) > MAX_ANCHOR)
		throw new Error("anchor is out of range.");
	const items = value.items;
	if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS)
		throw new Error(`items must be a non-empty list of at most ${MAX_ITEMS}.`);
	const seen = new Set<string>();
	const parsed: TabActionsMenuItem[] = [];
	for (const raw of items) {
		if (!isRecord(raw)) throw new Error("Every menu item must be an object.");
		const id = raw.id;
		if (typeof id !== "string" || !ITEM_IDS.has(id))
			throw new Error(`Unknown menu item id: ${String(id)}.`);
		// Separators may repeat (the menu has two groups); every other id names
		// one control, and a second copy of it would be a control offered twice.
		if (id !== "separator") {
			if (seen.has(id)) throw new Error(`Duplicate menu item id: ${id}.`);
			seen.add(id);
		}
		const label = raw.label;
		if (typeof label !== "string" || label.length > MAX_LABEL)
			throw new Error(
				`Menu item ${id} needs a label of at most ${MAX_LABEL} characters.`,
			);
		const enabled = raw.enabled;
		if (typeof enabled !== "boolean")
			throw new Error(`Menu item ${id} needs an enabled flag.`);
		// The two non-actions cannot be selected, so a false flag is the only
		// truthful rendering: a selectable separator would resolve to nothing. A
		// separator carries no label; the header is nothing BUT its label.
		if (id === "separator" && (enabled || label !== ""))
			throw new Error(`Menu item ${id} is a label, not a control.`);
		if (id === "header" && (enabled || label.trim() === ""))
			throw new Error(`Menu item ${id} is a label, not a control.`);
		if (id !== "separator" && label.trim() === "")
			throw new Error(`Menu item ${id} needs a non-empty label.`);
		parsed.push({ id: id as TabActionsMenuItemId, label, enabled });
	}
	return { tabId, anchor: { x, y }, items: parsed };
}

/**
 * The item main selected, or null.
 *
 * Null covers both a dismissal and an answer outside the vocabulary. The
 * renderer must not act on an id it has no handler for, and refusing here means
 * the strip's dispatcher only ever sees a verb it implements.
 */
export function tabActionsMenuSelectionOrNull(
	value: unknown,
): TabActionsMenuSelection {
	return typeof value === "string" && ACTION_IDS.has(value)
		? (value as TabActionsMenuActionId)
		: null;
}
