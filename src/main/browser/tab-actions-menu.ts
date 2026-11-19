import type { MenuItemConstructorOptions } from "electron";
import type {
	TabActionsMenuActionId,
	TabActionsMenuItem,
} from "../../shared/browser-tab-actions-menu";

/**
 * The tab-actions menu's Electron template (LOH-13 operator report, 2026-10-25).
 *
 * This is the adaptor half of the native-menu change: the item RULE, ordering
 * and copy stay with the strip (which owns the counts and the optional hands),
 * the wire shape is validated once at the IPC boundary, and this module turns an
 * already-validated list into the one thing Electron understands. It is split
 * from `src/main/browser/ipc.ts` for the same reason `page-context-menu.ts` is:
 * the mapping must be testable without an Electron process, and a click handler
 * must never be attached to an item that is drawn disabled.
 *
 * WHY DISABLED ITEMS CARRY NO HANDLER. Electron still invokes `click` for some
 * disabled items on some platforms if one is attached; the guard here makes the
 * menu's enabled flag the only thing standing between a press and a close, which
 * is the property the old Radix items expressed with `disabled`.
 *
 * THE HEADER IS A DISABLED ITEM, not a menu section label: Electron's native
 * menus have no section-label primitive, and the strip's title row ("Actions for
 * X") is how a menu opened from one of several identical marks names its tab
 * (design round 2, D4). Disabled means it is read but never pressed.
 */
export function buildTabActionsMenuTemplate(
	items: readonly TabActionsMenuItem[],
	onSelect: (id: TabActionsMenuActionId) => void,
): MenuItemConstructorOptions[] {
	return items.map((item): MenuItemConstructorOptions => {
		// A const binding so the narrowed id survives into the click closure.
		const id = item.id;
		if (id === "separator") return { type: "separator" };
		if (id === "header") return { label: item.label, enabled: false };
		return {
			label: item.label,
			enabled: item.enabled,
			click: item.enabled ? () => onSelect(id) : undefined,
		};
	});
}
