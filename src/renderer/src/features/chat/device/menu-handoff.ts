/**
 * Handing a menu's press to a surface that outlives the menu.
 *
 * WHY IT EXISTS (UX review round 3, U6 pointer door). A `DropdownMenu` restores
 * focus to its trigger when its content unmounts - Radix's `FocusScope` does that
 * in `onUnmountAutoFocus`, which is the `onCloseAutoFocus` prop. That restore runs
 * AFTER a dialog opened from the same press has taken its own focus, so the caret
 * landed back on the chip while the dialog had already marked the page
 * `aria-hidden`: the trap never engaged and the first Tab walked the hidden page.
 *
 * PREVENTING THE RESTORE IS NOT ENOUGH ON ITS OWN. The menu's focus scope is still
 * mounted while `onSelect` runs, so a surface opened synchronously from there is
 * still there when the scope unmounts; the surface has to open after that. So the
 * opener is not called directly: it is handed to the menu's own `onCloseAutoFocus`,
 * which drops the restore and defers the open by one frame -
 * `settings/components/accent-row.tsx` is the same deferral for a popover, and the
 * reason it records is this one.
 *
 * WITH NO PROVIDER THE CALL IS IMMEDIATE, because there is no restore to lose
 * against: a story or a test mounts a surface outside any menu.
 */
import { createContext, useContext } from "react";

/** What a row inside a menu may ask of the menu that holds it. */
export type MenuHandOff = {
	/** Ask the enclosing menu to hand its focus to `open` instead of its trigger. */
	handOff: (open: () => void) => void;
	/**
	 * CLOSE THE MENU, SO A LATE HAND-OFF CAN STILL BE SPENT (UX round 4, U14).
	 *
	 * The hand-off fires from the menu's own close, so a row that takes it before
	 * there is anything to open has to close the menu itself once the answer lands. A
	 * press on the picker's first read is exactly that case: the press is held, and
	 * the open follows an answer the menu is still on screen for.
	 */
	close: () => void;
};

const MenuHandOffContext = createContext<MenuHandOff | null>(null);

export const MenuHandOffProvider = MenuHandOffContext.Provider;

/** No enclosing menu: nothing to hand to and nothing to close. */
const DIRECT: MenuHandOff = {
	handOff: (open) => open(),
	close: () => undefined,
};

/** The enclosing menu's own doors, or the immediate call when there is none. */
export const useMenuHandOff = (): MenuHandOff =>
	useContext(MenuHandOffContext) ?? DIRECT;
