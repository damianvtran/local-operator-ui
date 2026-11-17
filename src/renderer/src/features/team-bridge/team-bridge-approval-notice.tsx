/**
 * The Touch ID prompt notice: what a Team Bridge approval prompt is about to
 * confirm, shown app-wide while the daemon says it is `prompting`.
 *
 * WHY ITS OWN FILE. It is the approvals feature's one floating surface (it
 * carries `data-glass-overlay` / `data-lo-floating`), while the Requests page in
 * `team-bridge-approvals.tsx` is in-flow and uses bordered `secondary` buttons
 * on the page ground. The floating-surface guards scan per file, so sharing a
 * file forced allow-list entries for the page's buttons; split, neither file
 * needs an exemption (code review round 5, M1).
 *
 * Like the page, it comes in two halves: `TeamBridgeAuthorizeNoticeView`
 * renders props only (what the stories and frames drive) and
 * `TeamBridgeAuthorizeNotices` wires the hooks and the portal.
 */
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useQueryClient } from "@tanstack/react-query";
import { Fingerprint, ShieldAlert } from "lucide-react";
import { useCallback } from "react";
import { createPortal } from "react-dom";
import {
	type ApprovalRequestsPage,
	type AuthorizeNoticeItem,
	type AuthorizePromptNotice,
	senderLabel,
} from "./team-bridge-approvals-model";
import { teamBridgeKeys } from "./team-bridge-keys";
import {
	useAuthorizeNotices,
	useDecidedStoreOwner,
} from "./use-team-bridge-approvals";

function NoticeItemLine({
	item,
	sender,
}: {
	item: AuthorizeNoticeItem;
	sender: string | null;
}) {
	if (item.word === null)
		return <>{t("ui.teamBridge.approvals.notice.item_unrecognised")}</>;
	if (sender === null)
		return (
			<>
				{item.word === "approve"
					? t("ui.teamBridge.approvals.notice.item_approve_unlisted")
					: t("ui.teamBridge.approvals.notice.item_deny_unlisted")}
			</>
		);
	return (
		<>
			{item.word === "approve"
				? t("ui.teamBridge.approvals.notice.item_approve", { sender })
				: t("ui.teamBridge.approvals.notice.item_deny", { sender })}
		</>
	);
}

/**
 * What a Touch ID prompt is about to confirm, shown while the daemon says it
 * is `prompting`. The OS sheet itself cannot say what it is for, so this is
 * how the person sees it - and a prompt this window did not start carries the
 * "Not started in this window" label (security S-6). Rendered app-wide, not
 * only on the Team Bridge page, because a foreign prompt can appear while the
 * person is anywhere.
 *
 * THE FOREIGN VARIANT LEADS WITH THE WARNING (design D2). Every legitimate
 * batch shows the own variant, so people learn its shape; a foreign prompt in
 * the same shape with a second-line label is the habituation pattern that
 * defeats security warnings. It opens on a warning-wash strip with the shield,
 * the count moves to line two, and it is an `alert` so a screen reader speaks
 * it before the person answers the sheet (D6). Still calm: no danger colour.
 *
 * `senderOf` names each item's teammate the way their row in the Requests
 * list does (U5); the frame's own sender is the fallback.
 */
export function TeamBridgeAuthorizeNoticeView({
	notices,
	senderOf = () => null,
}: {
	notices: readonly AuthorizePromptNotice[];
	senderOf?: (messageId: string) => string | null;
}) {
	useI18nLocale();
	if (notices.length === 0) return null;
	return (
		<div
			aria-label={t("ui.teamBridge.approvals.notice.label")}
			/* The floating layer's markers: the notice leaves the flow over whatever
			   page is open, so it gets the forced-colors edge and focus exclusion the
			   floating vocabulary keys on - separation comes from the shadow alone,
			   never a border (glass-overlay O-7, floating-surface-no-border O-8).
			   `data-lo-security-notice` then pins it OPAQUE on window glass, with the
			   authored meaning colours (design round 3, D12/D13): it is a security
			   control, and translucent its instructions fell under 4.5:1 over bright
			   or dark content - see the rule in `styles/index.css`. */
			data-glass-overlay=""
			data-lo-floating=""
			data-lo-security-notice=""
			className="pointer-events-auto flex max-h-[60vh] w-[min(28rem,calc(100vw-2rem))] flex-col gap-3 overflow-auto rounded-lg bg-elevated p-4 text-ink shadow-overlay"
		>
			{notices.map((notice) => {
				const title = t("ui.teamBridge.approvals.notice.title", {
					count: notice.items.length,
				});
				const list = (
					<ul className="flex flex-col gap-1.5">
						{notice.items.map((item, index) => (
							<li
								key={`${item.message_id}:${index}`}
								className="flex flex-col text-sm"
							>
								<span className="font-medium">
									<NoticeItemLine
										item={item}
										sender={senderOf(item.message_id) ?? item.sender}
									/>
								</span>
								{item.excerpt && (
									<span className="line-clamp-2 text-ink-muted">
										{item.excerpt}
									</span>
								)}
							</li>
						))}
					</ul>
				);
				if (!notice.foreign)
					return (
						<output key={notice.authorizeId} className="flex flex-col gap-2">
							<p className="flex items-center gap-2 text-sm font-medium">
								<Fingerprint
									size={16}
									aria-hidden="true"
									className="shrink-0 text-ink-dim"
								/>
								{title}
							</p>
							{list}
						</output>
					);
				return (
					<div
						key={notice.authorizeId}
						role="alert"
						className="flex flex-col gap-2"
					>
						<p className="-mx-1 flex items-center gap-2 rounded-md bg-warning-wash px-2 py-1.5 text-sm font-medium text-warning">
							<ShieldAlert size={16} aria-hidden="true" className="shrink-0" />
							{t("ui.teamBridge.approvals.notice.foreign")}
						</p>
						<p className="text-sm font-medium">{title}</p>
						<p className="text-sm text-ink-muted">
							{t("ui.teamBridge.approvals.notice.foreign_help")}
						</p>
						{list}
					</div>
				);
			})}
		</div>
	);
}

/**
 * The teammate names the Requests list shows, read from the cached requests
 * page rather than fetched: the notice must not trigger a read of its own, and
 * a prompt for a request not in the list keeps the frame's sender.
 */
function useCachedSenders(): (messageId: string) => string | null {
	const client = useQueryClient();
	return useCallback(
		(messageId: string) => {
			const pages = client.getQueriesData<ApprovalRequestsPage>({
				queryKey: [...teamBridgeKeys.all, "approvals", "requests"],
			});
			for (const [, page] of pages) {
				const row = page?.items.find((item) => item.message_id === messageId);
				if (row) return senderLabel(row.sender);
			}
			return null;
		},
		[client],
	);
}

/**
 * App-wide host for the prompt notice; renders nothing while none is up.
 *
 * PORTALLED TO <body>, ABOVE THE MODAL LAYER (security S-3). Radix dialogs and
 * sheets portal to the end of <body> with a `z-50` scrim, so a host inside the
 * app root at `z-50` painted UNDER any open dialog - and Radix's modal mode
 * marks everything outside the dialog `aria-hidden`. Here the host is its own
 * <body> child at `z-[60]`, and it carries `aria-live`, which the `aria-hidden`
 * sweep Radix uses deliberately leaves alone (aria-hidden issue #10), so the
 * notice stays both visible and announced over a dialog.
 */
export function TeamBridgeAuthorizeNotices() {
	// App-wide like this host, so the decided excerpts go with the account
	// whichever page is open when it changes (review R2-02).
	useDecidedStoreOwner();
	const notices = useAuthorizeNotices();
	const senderOf = useCachedSenders();
	if (notices.length === 0 || typeof document === "undefined") return null;
	return createPortal(
		<div
			aria-live="polite"
			className="pointer-events-none fixed inset-x-0 top-10 z-[60] flex justify-center"
		>
			<TeamBridgeAuthorizeNoticeView notices={notices} senderOf={senderOf} />
		</div>,
		document.body,
	);
}
