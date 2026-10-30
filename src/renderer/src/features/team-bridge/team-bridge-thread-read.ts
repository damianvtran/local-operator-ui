import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import type {
	TeamBridgeMessage,
	TeamBridgeThreadPage,
} from "../../../../shared/team-bridge-contract";

export type ThreadTarget = {
	tenantId: string;
	conversationId: string;
	rootId: string;
};

/** A notification link names the root, NOT a row in the bounded timeline page.
 * Keep tenant/conversation/root together; a partial link cannot borrow the rail's tenant.
 */
export function threadTargetFromSearch(
	params: URLSearchParams,
): ThreadTarget | null {
	const tenantId = params.get("tenant");
	const conversationId = params.get("conversation");
	const rootId = params.get("thread");
	return tenantId && conversationId && rootId
		? { tenantId, conversationId, rootId }
		: null;
}

/** Query keys already isolate scopes; also refuse a malformed upstream response rather than
 * painting or acknowledging another conversation's data under this thread's header.
 */
export function assertThreadPage(
	page: TeamBridgeThreadPage,
	target: ThreadTarget,
): TeamBridgeThreadPage {
	if (
		page.root.id !== target.rootId ||
		page.root.conversation_id !== target.conversationId ||
		page.root.thread_root_id ||
		page.replies.some(
			(reply) =>
				reply.conversation_id !== target.conversationId ||
				reply.thread_root_id !== target.rootId,
		)
	) {
		throw new Error("Thread response identity mismatch");
	}
	return page;
}

/** Address the root directly, even if its row has aged out of the timeline page. */
export async function loadThreadPage(
	target: ThreadTarget,
	accountId: string,
	afterSeq?: number,
) {
	return assertThreadPage(
		await TeamBridgeApi.listReplies(target.conversationId, target.rootId, {
			tenantId: target.tenantId,
			accountId,
			afterSeq,
		}),
		target,
	);
}

/** A fetched page is NOT evidence of reading. Observe only reply rows actually intersecting
 * the pane's viewport, while this document is visible and focused. No last_reply_at/latest_seq
 * shortcut: later pages and offscreen replies must never advance the conversation cursor.
 * Cleanup fences queued observer/focus callbacks after a target switch. The acknowledgement
 * is scoped by the caller; server-side followers (not opening the pane) decide unread counts.
 */
export function observeDisplayedThreadReplies(
	pane: HTMLElement,
	replies: readonly TeamBridgeMessage[],
	onRead: (seq: number) => Promise<unknown>,
): () => void {
	if (typeof IntersectionObserver === "undefined") return () => {};
	const allowed = new Map(replies.map((reply) => [reply.id, reply.seq]));
	const visible = new Map<string, number>();
	const doc = pane.ownerDocument;
	let live = true;
	let acknowledged = -1;
	const acknowledge = () => {
		if (
			!live ||
			!pane.isConnected ||
			doc.visibilityState !== "visible" ||
			!doc.hasFocus()
		)
			return;
		const newest = Math.max(-1, ...visible.values());
		if (newest <= acknowledged) return;
		acknowledged = newest;
		void onRead(newest).catch(() => {
			if (live && acknowledged === newest) acknowledged = -1;
		});
	};
	const observer = new IntersectionObserver(
		(entries) => {
			if (!live) return;
			for (const entry of entries) {
				const id = (entry.target as HTMLElement).dataset.messageId ?? "";
				const seq = allowed.get(id);
				if (
					seq !== undefined &&
					entry.isIntersecting &&
					entry.intersectionRect.height > 0
				)
					visible.set(id, seq);
				else visible.delete(id);
			}
			acknowledge();
		},
		{
			root: pane.querySelector("[data-radix-scroll-area-viewport]"),
			threshold: 0,
		},
	);
	for (const row of pane.querySelectorAll<HTMLElement>("[data-message-id]")) {
		if (allowed.has(row.dataset.messageId ?? "")) observer.observe(row);
	}
	doc.addEventListener("visibilitychange", acknowledge);
	doc.defaultView?.addEventListener("focus", acknowledge);
	return () => {
		live = false;
		observer.disconnect();
		doc.removeEventListener("visibilitychange", acknowledge);
		doc.defaultView?.removeEventListener("focus", acknowledge);
	};
}
