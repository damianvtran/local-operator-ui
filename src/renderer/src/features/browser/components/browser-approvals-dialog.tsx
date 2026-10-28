import { BaseDialog } from "@shared/components/common/base-dialog";
import { Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import type { FC } from "react";
import type { ApprovalView } from "../hooks/use-browser-chrome";
import {
	BrowserApprovalsAgentsNotice,
	BrowserApprovalsStanding,
} from "./browser-approvals-sections";

/**
 * The Approvals dialog: where the standing grants live when the approvals surface
 * is the native corner card (S6d).
 *
 * WHY A DIALOG. The card is built for ONE job: answer what is pending, without
 * moving the page. Revoke, revoke all, Forget this site and Clear browsing data
 * are the only way to undo a durable grant, so they must stay reachable without
 * the DOM dock that PUSHES the page down (the dock is now only the kill-switch
 * fallback). They are re-homed here rather than onto a third card channel on
 * purpose: the card keeps exactly `dismiss` and `decide`, both sender-pinned and
 * re-validated by the host, and no destructive grant action ever crosses from a
 * document the page's process shares a window with.
 *
 * WHY `BaseDialog` AND NOT A NEW NATIVE SURFACE. Every `BaseDialog` registers with
 * the browser view's overlay policy (`useSuppressBrowserView`), so main hides the
 * native page view, and with it the card, while this is open and restores both on
 * close. No page rectangle moves and no native child is added. The consequence
 * the copy has to live with: a pending request is not decidable while the dialog
 * is up (the card is hidden with the page), so the waiting count is stated and
 * closing the dialog brings the card back.
 *
 * REACHED FROM two places, both in the renderer: the toolbar Approvals control
 * when nothing is pending (with a request pending the control toggles the card
 * instead), and the page menu's Approvals item at any time.
 *
 * The sections are the dock's own components (`browser-approvals-sections.tsx`),
 * so the copy and the three look-alike actions (design 9.4) have one
 * implementation.
 */

export interface BrowserApprovalsDialogProps {
	open: boolean;
	onClose: () => void;
	/** Live (expiry-aware) pending count, for the summary line. */
	waitingCount: number;
	/**
	 * Close this dialog and bring the card back. Offered only while something is
	 * waiting. It exists because below a 300px row the toolbar control is folded
	 * into the page menu, and the menu opens THIS dialog; without it a card the
	 * user had dismissed could not be recalled from the chrome at that width.
	 * It is a renderer-to-main call on the existing `openApprovalsCard` bridge, not
	 * a card channel.
	 */
	onReviewWaiting: () => void;
	/**
	 * Where keyboard focus goes when the dialog closes, by any path (U2). Radix
	 * hands focus back to whatever opened the dialog, and from the page menu that
	 * is a menu item which unmounts with the menu: focus fell to <body> and the
	 * next Tab started at the top of the document. The caller names a control that
	 * is actually mounted (the toolbar Approvals button, else the page menu's).
	 */
	returnFocusTo: () => HTMLElement | null;
	approvals: ApprovalView[];
	currentOrigin: string | null;
	busy: boolean;
	onRevoke: (origin: string) => void;
	onRevokeAll: () => void;
	onForgetSite: (origin: string) => void;
	onClearData: (what: "cookies" | "cache" | "everything") => void;
}

export const BrowserApprovalsDialog: FC<BrowserApprovalsDialogProps> = ({
	open,
	onClose,
	waitingCount,
	onReviewWaiting,
	returnFocusTo,
	approvals,
	currentOrigin,
	busy,
	onRevoke,
	onRevokeAll,
	onForgetSite,
	onClearData,
}) => {
	useI18nLocale();
	const grantedCount = approvals.filter((row) => row.scope !== "deny").length;
	const summary = [
		waitingCount > 0
			? t("ui.browser.browser_approvals_dock.waiting_count", {
					count: waitingCount,
				})
			: null,
		grantedCount > 0
			? t("ui.browser.browser_approvals_dock.approved_count", {
					count: grantedCount,
				})
			: null,
	]
		.filter(Boolean)
		.join(" \u00b7 ");
	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title={t("ui.browser.browser_approvals_dock.approvals")}
			dataTourTag="browser-approvals-dialog"
			maxWidth="xs"
			fullWidth
			dialogProps={{
				// The container is focused only to anchor the screen-reader start and the
				// Tab order; a ring around the whole panel is noise (the first control gets
				// its own ring on Tab), and it showed in the frames when the dialog was
				// opened without a prior pointer event.
				className: "outline-none focus-visible:outline-none",
				/*
				 * OPEN ON THE DIALOG, NEVER ON A DESTRUCTIVE CONTROL (D-1 / U1). Radix's
				 * default focuses the first tabbable in the body, which is "Revoke" or
				 * "Forget this site" or "Clear cookies": one Enter, a key repeat or a
				 * double press of the toolbar control then revoked a grant or signed the
				 * user out of a site with no confirmation. The fallback dock focused its
				 * heading for the same reason; the dialog container is the equivalent
				 * (it carries the title as its accessible name, and Tab reaches the
				 * first control from there).
				 */
				onOpenAutoFocus: (event: Event) => {
					event.preventDefault();
					const content = document
						.querySelector('[data-tour-tag="browser-approvals-dialog"]')
						?.closest<HTMLElement>('[role="dialog"]');
					content?.focus({ preventScroll: true });
				},
				onCloseAutoFocus: (event: Event) => {
					event.preventDefault();
					returnFocusTo()?.focus();
				},
			}}
			actions={
				<Button
					variant="ghost"
					size="sm"
					onClick={onClose}
					data-tour-tag="browser-approvals-dialog-close"
				>
					{t("ui.common.actions.close")}
				</Button>
			}
		>
			<div className="flex flex-col gap-4">
				{summary && (
					<p className="text-meta text-ink-dim" aria-live="polite">
						{summary}
					</p>
				)}
				{waitingCount > 0 && (
					<Button
						variant="outline"
						size="sm"
						className="w-full"
						// The visible label already says what is waiting; the accessible
						// name must not repeat the dialog's own title as "Open approvals"
						// (U10), so it is the same waiting sentence the toolbar control
						// carries.
						aria-label={t("ui.browser.browser_url_bar.approvals_waiting", {
							count: waitingCount,
						})}
						onClick={onReviewWaiting}
						data-tour-tag="browser-approvals-dialog-review"
					>
						{t("ui.browser.browser_approvals_tray.header_waiting", {
							count: waitingCount,
						})}
					</Button>
				)}
				<p className="text-body-sm text-ink-muted">
					{t(
						"ui.browser.browser_approvals_dock.approvals_are_kept_per_origin_and_are",
					)}
				</p>
				<BrowserApprovalsAgentsNotice />
				<BrowserApprovalsStanding
					approvals={approvals}
					currentOrigin={currentOrigin}
					busy={busy}
					onRevoke={onRevoke}
					onRevokeAll={onRevokeAll}
					onForgetSite={onForgetSite}
					onClearData={onClearData}
				/>
			</div>
		</BaseDialog>
	);
};
