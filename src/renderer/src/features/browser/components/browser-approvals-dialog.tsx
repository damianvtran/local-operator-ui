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
						// The card's own Review-all wording: the visible label keeps the
						// count, the accessible name says what pressing it does.
						aria-label={t("ui.browser.browser_approvals_tray.open_approvals")}
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
