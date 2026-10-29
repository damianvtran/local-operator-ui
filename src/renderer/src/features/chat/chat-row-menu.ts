/** A row menu is a detached overlay, not another scroller in the sidebar's
 * ordinary-flow regions. Keep its chrome separate from the region definitions.
 * At the supported 600px app floor this caps the ten-row menu at 300px, while
 * preserving 32px targets and keyboard reach instead of clipping later actions. */
export const CHAT_ROW_MENU_SCROLL_CLASS =
	"max-h-[min(var(--radix-context-menu-content-available-height),50dvh)] overflow-y-auto [&_[role=menuitem]]:min-h-8";
