import { Button, Separator } from "@shared/components/ui";
import { formatDateTime, t } from "@shared/i18n";
import { ShieldCheck } from "lucide-react";
import type { FC } from "react";
import type { ApprovalView } from "../hooks/use-browser-chrome";
import { approvalScopeLabel } from "../model/approval-queue-model";

/**
 * The approvals surface's STANDING sections: what an agent may do as the user
 * (Approved, Denied), the per-site action (Forget this site) and the data actions
 * (Browsing data), plus the agents notice.
 *
 * WHY THIS IS ITS OWN MODULE (S6d). These sections used to live inside the DOM
 * dock, and the dock is a flex sibling that PUSHES the page. With the native
 * approvals card on by default the dock is only the kill-switch fallback, but
 * revoke, revoke-all, forget and clear are the only way to undo a durable grant,
 * so they cannot disappear with it. Both the dock and the Approvals dialog
 * (`browser-approvals-dialog.tsx`, reachable from the toolbar control and the page
 * menu) render THESE components, so there is one implementation of each
 * destructive affordance and one set of copy keys; a second copy would drift.
 *
 * The sections own no state: every action is a prop the surface wires to the host,
 * exactly as the dock's were. The three affordances that look alike and are not
 * (design 9.4) keep their copy: Revoke withdraws an approval only; Forget this
 * site also clears that origin's data; Clear browsing data touches no approval.
 */

export interface BrowserApprovalsStandingProps {
	approvals: ApprovalView[];
	/** The active tab's origin, for the per-site action. Null when the tab is on
	 * `about:blank` or has no URL yet. */
	currentOrigin: string | null;
	busy: boolean;
	onRevoke: (origin: string) => void;
	onRevokeAll: () => void;
	onForgetSite: (origin: string) => void;
	onClearData: (what: "cookies" | "cache" | "everything") => void;
}

function grantedWhen(grantedAt: number): string {
	if (!grantedAt) return "";
	return formatDateTime(new Date(grantedAt), {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
	});
}

/**
 * The persistent statement (design 9.3): a standing notice in the browser feature
 * that agents can drive tabs here, so the capability is never something the user
 * has to remember. It is FIRST in both hosts because its words are "each site
 * BELOW".
 */
export const BrowserApprovalsAgentsNotice: FC = () => (
	<div
		className="flex items-start gap-2 rounded-sm bg-accent-wash px-3 py-2"
		data-tour-tag="browser-agents-notice"
	>
		<ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-ink" />
		<p className="text-body-sm text-ink">
			{t("ui.browser.browser_approvals_dock.agents_can_drive_tabs_in_this_app")}
		</p>
	</div>
);

/**
 * Approved, Denied, This site and Browsing data, in the order the dock has always
 * shown them. A fragment: the host owns the container and its gap.
 */
export const BrowserApprovalsStanding: FC<BrowserApprovalsStandingProps> = ({
	approvals,
	currentOrigin,
	busy,
	onRevoke,
	onRevokeAll,
	onForgetSite,
	onClearData,
}) => {
	// A `deny` record is a durable NO, not a grant: the agent stops asking about
	// that origin. It is listed separately because "what may the agent reach" and
	// "what have I turned off" are two different readings of the same store, and
	// mixing them puts a refusal under a heading that says an agent may act there.
	const granted = approvals.filter((row) => row.scope !== "deny");
	const denied = approvals.filter((row) => row.scope === "deny");
	return (
		<>
			<section
				aria-label={t("ui.browser.browser_approvals_dock.approved_sites")}
			>
				<h3 className="text-heading text-ink">
					{t("ui.browser.browser_approvals_dock.approved")}
				</h3>
				{granted.length === 0 ? (
					<p className="mt-2 text-body-sm text-ink-muted">
						{t(
							"ui.browser.browser_approvals_dock.no_site_is_approved_yet_the_agent",
						)}
					</p>
				) : (
					<ul className="mt-2 flex flex-col gap-2">
						{granted.map((row) => (
							<li
								key={`${row.scope}:${row.origin}`}
								className="flex items-center justify-between gap-2 rounded-sm bg-surface px-2 py-1.5"
							>
								<div className="min-w-0">
									<p className="truncate font-mono text-mono-sm text-ink">
										{row.origin}
									</p>
									<p className="text-meta text-ink-dim">
										{approvalScopeLabel(row.scope)}
										{grantedWhen(row.grantedAt)
											? ` · ${grantedWhen(row.grantedAt)}`
											: ""}
									</p>
								</div>
								<Button
									variant="outline"
									size="sm"
									disabled={busy}
									onClick={() => onRevoke(row.origin)}
									data-tour-tag="browser-revoke-approval"
								>
									{t("ui.browser.browser_approvals_dock.revoke")}
								</Button>
							</li>
						))}
					</ul>
				)}
				{granted.length > 0 && (
					<Button
						// THE SAME TREATMENT AS `Forget this site` (design round 2, D7). This is
						// the widest-blast-radius control in the panel — it drops every site
						// approval at once — and it was plain body text at the end of a list
						// whose per-row `Revoke` is an outlined control and whose `Forget this
						// site` is a danger-outlined one. One class of action, three
						// affordances, and the loudest action was the quietest.
						variant="danger"
						size="sm"
						className="mt-3 w-full"
						disabled={busy}
						onClick={onRevokeAll}
						data-tour-tag="browser-revoke-all"
					>
						{t("ui.browser.browser_approvals_dock.revoke_all_site_approvals")}
					</Button>
				)}
			</section>

			{denied.length > 0 && (
				<section
					aria-label={t("ui.browser.browser_approvals_dock.denied_sites")}
				>
					<h3 className="text-heading text-ink">
						{t("ui.browser.browser_approvals_dock.denied")}
					</h3>
					<p className="mt-1 text-body-sm text-ink-muted">
						{t(
							"ui.browser.browser_approvals_dock.the_agent_stops_asking_about_these_revoking",
						)}
					</p>
					<ul className="mt-2 flex flex-col gap-2">
						{denied.map((row) => (
							<li
								key={`${row.scope}:${row.origin}`}
								className="flex items-center justify-between gap-2 rounded-sm bg-surface px-2 py-1.5"
							>
								<p className="min-w-0 truncate font-mono text-mono-sm text-ink">
									{row.origin}
								</p>
								<Button
									variant="outline"
									size="sm"
									disabled={busy}
									onClick={() => onRevoke(row.origin)}
								>
									{t("ui.browser.browser_approvals_dock.revoke")}
								</Button>
							</li>
						))}
					</ul>
				</section>
			)}

			{currentOrigin && (
				<section
					aria-label={t("ui.browser.browser_approvals_dock.current_site")}
				>
					<h3 className="text-heading text-ink">
						{t("ui.browser.browser_approvals_dock.this_site")}
					</h3>
					<p className="mt-1 text-body-sm text-ink-muted">
						{t(
							"ui.browser.browser_approvals_dock.the_page_the_active_tab_is_on",
						)}
					</p>
					<p className="mt-2 truncate font-mono text-mono-sm text-ink">
						{currentOrigin}
					</p>
					<Button
						variant="danger"
						size="sm"
						className="mt-3"
						disabled={busy}
						onClick={() => onForgetSite(currentOrigin)}
						data-tour-tag="browser-forget-site"
					>
						{t("ui.browser.browser_approvals_dock.forget_this_site")}
					</Button>
					<p className="mt-1 text-meta text-ink-dim">
						{t(
							"ui.browser.browser_approvals_dock.revokes_any_approval_for_it_and_clears",
						)}
					</p>
				</section>
			)}

			<Separator className="my-1" />

			<section
				aria-label={t("ui.browser.browser_approvals_dock.browsing_data")}
			>
				<h3 className="text-heading text-ink">
					{t("ui.browser.browser_approvals_dock.browsing_data")}
				</h3>
				{/* The sentence the design asks for by name: revoking and clearing are
				    different actions with different consequences, and a user who has
				    just revoke-all'd needs to know that clearing cookies will NOT bring
				    the deny state back. */}
				<p className="mt-1 text-body-sm text-ink-muted">
					{t(
						"ui.browser.browser_approvals_dock.these_clear_what_this_app_s_browser",
					)}
				</p>
				<div className="mt-3 flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => onClearData("cookies")}
						data-tour-tag="browser-clear-cookies"
					>
						{t("ui.browser.browser_approvals_dock.clear_cookies_and_site_data")}
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => onClearData("cache")}
					>
						{t("ui.browser.browser_approvals_dock.clear_cache")}
					</Button>
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => onClearData("everything")}
					>
						{t("ui.browser.browser_approvals_dock.clear_everything")}
					</Button>
				</div>
				<p className="mt-2 text-meta text-ink-dim">
					{t(
						"ui.browser.browser_approvals_dock.clearing_cookies_signs_this_app_out_of",
					)}
				</p>
			</section>
		</>
	);
};
