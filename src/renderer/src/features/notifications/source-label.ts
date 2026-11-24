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
 */
export const askIdOfItem = (item: DesktopNotificationItem): string | null => {
	if (item.source !== "ask") return null;
	const prefix = `ask:${item.session.id}:`; // i18n: ignore the wire id's prefix, not interface copy
	if (!item.id.startsWith(prefix)) return null;
	const askId = item.id.slice(prefix.length);
	return askId.length > 0 ? askId : null;
};
