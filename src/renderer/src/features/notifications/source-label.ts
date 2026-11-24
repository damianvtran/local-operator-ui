/**
 * Who a notification row is "from": the one spelling every surface uses.
 *
 * WHY ONE HELPER. The reel row, the detail header, the From card, the
 * conversation group heading and the Dismiss-all confirm each wrote
 * `session.title || "Untitled conversation"` on their own. An ask whose owning
 * conversation had been deleted therefore read "Untitled conversation" in five
 * places - a name that invites the reader to open a conversation that no longer
 * exists. Core now marks such rows `conversation_deleted` (see the contract
 * field), and core also puts a subagent's origin label in `session.title` when
 * the subagent has no title of its own, so the only decision left here is the
 * order: deleted first, then the server's title, then the generic fallback.
 */
import { t } from "@shared/i18n";
import type { DesktopNotificationItem } from "../../../../shared/desktop-control-contract";

/** Whether the row's owning session is gone (absent on older cores = false). */
export const conversationDeleted = (
	item: Pick<DesktopNotificationItem, "conversation_deleted">,
): boolean => item.conversation_deleted === true;

/** The row's source line: "Conversation deleted", the title, or "Untitled conversation". */
export const notificationSourceLabel = (
	item: Pick<DesktopNotificationItem, "conversation_deleted" | "session">,
): string =>
	conversationDeleted(item)
		? t("ui.notifications.source.conversation_deleted")
		: item.session.title || t("ui.notifications.group.untitled");

/**
 * The ask id inside an ask row's id (`ask:<session_id>:<ask_id>`), or null.
 *
 * The detail of a deleted conversation's ask settles it by id even when the
 * detail read carries no `asks` (core cannot read a transcript that is gone),
 * so the id has to come from the row itself. Session ids never contain `:`, so
 * everything after the second colon is the ask id.
 *
 * THE ASSUMPTION'S FAILURE MODE (code round 1, R3). Core's session ids are
 * 12-hex or `remote-*`/pseudo ids today, none with `:`. Should one ever carry
 * a colon, the prefix built here would still match the row's own id (it is built
 * from the same `session.id`), so the split stays right; only a row whose id
 * disagrees with its `session.id` misses the prefix, and that returns null - the
 * pane then falls back to the ordinary ask panel rather than settling a wrong id.
 */
/**
 * The rows with every row of a known-deleted conversation flagged as such.
 *
 * WHY AN OVERLAY (QA round 1, Q-U2). A conversation deleted out of band moves
 * no store fingerprint, so the list read keeps its rows unflagged ("Untitled
 * conversation", Open live) until the next poll, while the detail read - fresh
 * for the one open row - already says `conversation_deleted`. The page records
 * the session the detail reported and paints the list from that fact at once;
 * the list refetch it triggers then brings core's own flags. Identity is kept
 * when nothing changes so memoised consumers do not re-render.
 */
export const withDeletedOwners = (
	items: DesktopNotificationItem[],
	deletedSessions: ReadonlySet<string>,
): DesktopNotificationItem[] => {
	if (deletedSessions.size === 0) return items;
	let changed = false;
	const next = items.map((item) => {
		if (conversationDeleted(item) || !deletedSessions.has(item.session.id))
			return item;
		changed = true;
		return { ...item, conversation_deleted: true };
	});
	return changed ? next : items;
};

export const askIdOfItem = (item: DesktopNotificationItem): string | null => {
	if (item.source !== "ask") return null;
	const prefix = `ask:${item.session.id}:`; // i18n: ignore the wire id's prefix, not interface copy
	if (!item.id.startsWith(prefix)) return null;
	const askId = item.id.slice(prefix.length);
	return askId.length > 0 ? askId : null;
};
