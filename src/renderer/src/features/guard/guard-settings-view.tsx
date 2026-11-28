/**
 * Settings → Radient account → Radient Guard: per-org status, what is shared,
 * Stop sharing, Share again, and the non-Team card.
 *
 * THIS SCREEN IS THE DESKTOP'S `/guard` OVERVIEW. It reads `GET /v1/desktop/guard`
 * (local facts, no network) and renders the SAME sentences the terminal screen
 * does (`ui.guard.*` mirrors `tui.guard.*`, RFC §15.4'), so a member who sees
 * "Guard: sharing with Acme" here sees it there. It can only move in the SAFE
 * direction: stop sharing and lift a sticky answer. A grant is never started from
 * this screen - "Share again" asks the host to bring the org's prompt back, and
 * the prompt is answered as the card in `GuardPromptEntries` (RFC §5, "Console can
 * stop but never start" holds for every surface that is not the host).
 *
 * ZERO GUARD TRAFFIC FOR NON-TEAM ACCOUNTS. A non-Team status answers
 * `mode: "non_team"` from cached facts; this view then draws the card and sends
 * nothing else (no revoke, no share-again, no approvals write). The renderer never
 * addresses `/v1/guard/*` itself - the host does, only for an org that raised
 * Guard - and `scripts/guard-consent-dom.test.mjs` pins the request log.
 *
 * REVOKE COPY IS EXACT PARITY WITH THE TERMINAL (RFC §15.4' C2). The
 * step-by-step-timing sentence and its backup window are shown only when that scope
 * was actually shared AND the host reports `backup_days` (the measured X); the
 * number is the host's, never a literal here.
 */

import {
	Alert,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { formatCalendarDate } from "@shared/utils/date-utils";
import { openConsolePage } from "@shared/utils/radient-account-copy";
import { Shield } from "lucide-react";
import { type FC, useRef, useState } from "react";
import {
	GUARD_SCOPE_ORDER,
	type GuardScope,
} from "../../../../shared/guard-consent";
import {
	GUARD_PAUSE_REASONS,
	type GuardNonTeamCard,
	type GuardOrg,
	type GuardPauseReason,
	type GuardRevokeResult,
	type GuardStatus,
} from "../../../../shared/guard-status";

/** Console's Team page: pinned, because a link a person follows to pay must not be steerable by a response. */
export const GUARD_TEAM_URL = "https://console.radienthq.com/dashboard/team";
const CONSOLE_ORIGIN = "https://console.radienthq.com/";

/** The host's `team_url` when it is a first-party Console page, else the pinned one. */
export function guardTeamUrl(candidate: string | undefined): string {
	return candidate?.startsWith(CONSOLE_ORIGIN) ? candidate : GUARD_TEAM_URL;
}

function pauseReasonText(org: GuardOrg): string | null {
	const known = (GUARD_PAUSE_REASONS as readonly string[]).includes(org.reason);
	if (!known) return null;
	switch (org.reason as GuardPauseReason) {
		case "entitlement_lapsed":
			return t("ui.guard.reason_entitlement_lapsed");
		case "org_off":
			return t("ui.guard.reason_org_off", { org: org.org });
		case "membership_ended":
			return t("ui.guard.reason_membership_ended", { org: org.org });
		case "scope_revoked":
			return t("ui.guard.reason_scope_revoked");
		case "revoke_pending":
			return t("ui.guard.reason_revoke_pending");
		case "console_revoked":
			return t("ui.guard.reason_console_revoked", {
				date: org.since ? formatCalendarDate(new Date(org.since * 1000)) : "",
			});
	}
}

/**
 * The passive indicator sentence for one org (RFC §13.3', §15.4' C9). A paused
 * state with a reason this build has no sentence for reads the plain "Guard:
 * paused", never an enum; `sharing_pending` is NEVER drawn as paused.
 */
export function guardIndicatorText(org: GuardOrg): string {
	switch (org.state) {
		case "sharing":
			return t("ui.guard.indicator_sharing", { org: org.org });
		case "sharing_pending":
			return t("ui.guard.indicator_sharing_pending", { org: org.org });
		case "waiting":
			return t("ui.guard.indicator_waiting", { org: org.org });
		case "not_sharing":
			return t("ui.guard.indicator_not_sharing", { org: org.org });
		case "will_ask":
			return t("ui.guard.indicator_will_ask", { org: org.org });
		case "paused": {
			const reason = pauseReasonText(org);
			return reason
				? t("ui.guard.indicator_paused", { reason })
				: t("ui.guard.indicator_paused_plain");
		}
	}
}

function scopeLine(scope: GuardScope, org: string): string {
	switch (scope) {
		case "decisions":
			return t("ui.guard.scope_decisions");
		case "posture":
			return t("ui.guard.scope_posture");
		case "task_time":
			return t("ui.guard.scope_task_time");
		case "review_cycles":
			return t("ui.guard.scope_review_cycles");
		case "reports":
			return t("ui.guard.scope_reports", { org });
		case "trace_detail":
			return t("ui.guard.scope_trace_detail");
		case "admin_share":
			return t("ui.guard.scope_admin_share", { org });
	}
}

/** The Stop-sharing confirm's body: C2, with the timing/backup sentence only when it is true. */
export function guardRevokeBody(
	org: GuardOrg,
	backupDays: number | null,
): string[] {
	const timing =
		org.scopes_shared.includes("trace_detail") && backupDays !== null;
	return [
		timing
			? t("ui.guard.revoke_body_trace", { backup_days: String(backupDays) })
			: t("ui.guard.revoke_body"),
		t("ui.guard.revoke_retained"),
		t("ui.guard.revoke_totals"),
	];
}

/** Who sees which non-Team variant (RFC §14' C11). `member` draws nothing. */
export type GuardViewerRole = "owner" | "admin" | "member";

export function guardViewerRole(role: string | undefined): GuardViewerRole {
	if (role === "admin") return "admin";
	if (role === "owner" || role === undefined) return "owner";
	// An unread membership answers the owner variant: Console decides who can pay,
	// and guessing "member" would hide the card from the person it is for.
	return "member";
}

export const GuardNonTeamCardView: FC<{
	role: GuardViewerRole;
	card: GuardNonTeamCard | null;
	loading: boolean;
}> = ({ role, card, loading }) => {
	useI18nLocale();
	if (role === "member") return null;
	const trial = card?.trial_days ?? null;
	return (
		<div
			data-testid="guard-non-team-card"
			className="flex flex-col gap-2 rounded-sm border border-hairline bg-surface p-3"
		>
			<p className="text-body-sm text-ink">{t("ui.guard.card_title")}</p>
			<p className="text-body-sm text-ink-muted">{t("ui.guard.card_body")}</p>
			<div className="flex items-center gap-3">
				{role === "admin" ? (
					<p
						className="text-body-sm text-ink-muted"
						data-testid="guard-ask-owner"
					>
						{t("ui.guard.card_ask_owner")}
					</p>
				) : (
					<Button
						variant="secondary"
						size="sm"
						disabled={loading}
						data-testid="guard-card-cta"
						onClick={() => openConsolePage(guardTeamUrl(card?.url))}
					>
						{loading
							? t("ui.guard.card_cta_loading")
							: trial
								? t("ui.guard.card_cta_trial", { trial_days: String(trial) })
								: t("ui.guard.card_cta_see")}
					</Button>
				)}
			</div>
			{card?.org ? (
				<p className="text-meta text-ink-dim">
					{t("ui.guard.card_footer", { org: card.org })}
				</p>
			) : null}
		</div>
	);
};

export type GuardSettingsViewProps = {
	/** `loading` before the first answer; `unavailable` when the read failed or the host lacks it. */
	load: "loading" | "ready" | "unavailable";
	status: GuardStatus | null;
	role: GuardViewerRole;
	nonTeamCard: GuardNonTeamCard | null;
	nonTeamLoading: boolean;
	/** Whether a Stop sharing / Share again write is in flight for this tenant. */
	busyTenant: string | null;
	/** The last write that failed, by tenant: the calm "nothing changed" line. */
	failedTenant: string | null;
	/** What the last Stop sharing answered, by tenant (never an error for revoke_pending). */
	revoked: Pick<GuardRevokeResult, "tenant" | "status"> | null;
	onRevoke: (tenant: string) => void;
	onShareAgain: (tenant: string) => void;
	/** Rendered above the orgs: the pending prompt entries (a slot so stories can fix them). */
	prompts?: React.ReactNode;
};

const OrgBlock: FC<{
	org: GuardOrg;
	status: GuardStatus;
	busy: boolean;
	failed: boolean;
	revoked: GuardSettingsViewProps["revoked"];
	onAskRevoke: (tenant: string) => void;
	onShareAgain: (tenant: string) => void;
}> = ({ org, status, busy, failed, revoked, onAskRevoke, onShareAgain }) => {
	const sharing = org.state === "sharing" || org.state === "sharing_pending";
	const shared = GUARD_SCOPE_ORDER.filter((s) => org.scopes_shared.includes(s));
	return (
		<div
			data-testid="guard-org"
			data-state={org.state}
			className="flex flex-col gap-2"
		>
			{/*
			 * With more than one org the paused sentences ("you stopped sharing") name no
			 * org, as in the terminal; the org's own name above each block says which is
			 * which. Untrusted text, isolated in <bdi>.
			 */}
			{status.orgs.length > 1 ? (
				<p className="text-meta text-ink-dim" data-testid="guard-org-name">
					<bdi>{org.org}</bdi>
				</p>
			) : null}
			<p className="text-body-sm text-ink" data-testid="guard-indicator">
				{guardIndicatorText(org)}
			</p>
			{org.answered_via && org.answered_via !== "desktop" ? (
				<p className="text-meta text-ink-dim">
					{t("ui.guard.answered_on", {
						surface:
							org.answered_via === "tui"
								? t("ui.guard.surface_tui")
								: org.answered_via === "mobile"
									? t("ui.guard.surface_mobile")
									: org.answered_via,
					})}
				</p>
			) : null}
			{sharing ? (
				<>
					<p className="text-body-sm text-ink-muted">
						{t("ui.guard.screen_shared", { org: org.org })}
					</p>
					<ul
						className="flex list-disc flex-col gap-1 ps-5 text-body-sm text-ink-muted"
						data-testid="guard-shared"
					>
						{shared.map((scope) => (
							<li key={scope} data-scope={scope}>
								{scopeLine(scope, org.org)}
							</li>
						))}
					</ul>
					<p className="text-meta text-ink-dim">
						{t("ui.guard.prompt_never_sent")}
					</p>
				</>
			) : null}
			{/*
			 * "Stopped sharing" is said once, by the answer; a `revoke_pending` answer
			 * says nothing more because the indicator above already reads "will stop once
			 * Radient confirms" - a second copy of the same sentence is two claims.
			 */}
			{revoked?.tenant === org.tenant && revoked.status === "revoked" ? (
				<p className="text-meta text-ink-dim" data-testid="guard-revoked">
					{t("ui.guard.screen_revoked", { org: org.org })}
				</p>
			) : null}
			{failed ? (
				<Alert variant="warning" data-testid="guard-write-failed">
					{t("ui.guard.screen_failed")}
				</Alert>
			) : null}
			<div className="flex items-center gap-2">
				{org.can_revoke ? (
					<Button
						variant="danger"
						size="sm"
						disabled={busy}
						data-testid="guard-stop"
						onClick={() => onAskRevoke(org.tenant)}
					>
						{t("ui.guard.button_stop_sharing")}
					</Button>
				) : null}
				{org.can_share_again && status.can_answer ? (
					<Button
						variant="secondary"
						size="sm"
						disabled={busy}
						data-testid="guard-share-again"
						onClick={() => onShareAgain(org.tenant)}
					>
						{t("ui.guard.button_share_again")}
					</Button>
				) : null}
				{busy ? (
					<output className="text-meta text-ink-dim">
						{t("ui.guard.screen_working")}
					</output>
				) : null}
			</div>
		</div>
	);
};

export const GuardSettingsView: FC<GuardSettingsViewProps> = ({
	load,
	status,
	role,
	nonTeamCard,
	nonTeamLoading,
	busyTenant,
	failedTenant,
	revoked,
	onRevoke,
	onShareAgain,
	prompts,
}) => {
	useI18nLocale();
	const [confirm, setConfirm] = useState<string | null>(null);
	const keepRef = useRef<HTMLButtonElement>(null);
	const confirmOrg = status?.orgs.find((o) => o.tenant === confirm) ?? null;
	return (
		<div className="flex flex-col gap-4" data-testid="guard-section">
			<div className="flex items-center gap-2">
				<Shield className="size-4 shrink-0 text-ink-dim" aria-hidden="true" />
				<h3 className="text-body-sm text-ink">{t("ui.guard.screen_title")}</h3>
			</div>
			{prompts}
			{load === "loading" ? (
				<output className="text-meta text-ink-dim">
					{t("ui.guard.screen_working")}
				</output>
			) : load === "unavailable" || !status || status.mode === "unavailable" ? (
				<p
					className="text-body-sm text-ink-muted"
					data-testid="guard-unavailable"
				>
					{t("ui.guard.screen_unavailable")}
				</p>
			) : status.mode === "non_team" ? (
				<GuardNonTeamCardView
					role={role}
					card={nonTeamCard}
					loading={nonTeamLoading}
				/>
			) : status.orgs.length === 0 ? (
				<p className="text-body-sm text-ink-muted" data-testid="guard-none">
					{t("ui.guard.screen_none")}
				</p>
			) : (
				status.orgs.map((org) => (
					<OrgBlock
						key={org.tenant}
						org={org}
						status={status}
						busy={busyTenant === org.tenant}
						failed={failedTenant === org.tenant}
						revoked={revoked}
						onAskRevoke={setConfirm}
						onShareAgain={onShareAgain}
					/>
				))
			)}
			{/* The stop confirm: focus starts on the non-destructive "Keep sharing" (RFC C2). */}
			<Dialog
				open={confirmOrg !== null}
				onOpenChange={(next) => {
					if (!next) setConfirm(null);
				}}
			>
				<DialogContent
					data-testid="guard-revoke-dialog"
					showClose={false}
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						keepRef.current?.focus();
					}}
				>
					{confirmOrg && status ? (
						<>
							<DialogHeader>
								<DialogTitle>
									{t("ui.guard.revoke_title", { org: confirmOrg.org })}
								</DialogTitle>
								<DialogDescription asChild>
									<div className="flex flex-col gap-2">
										{guardRevokeBody(confirmOrg, status.backup_days).map(
											(line) => (
												<p key={line}>{line}</p>
											),
										)}
									</div>
								</DialogDescription>
							</DialogHeader>
							<DialogFooter>
								<Button
									ref={keepRef}
									variant="secondary"
									data-testid="guard-keep"
									onClick={() => setConfirm(null)}
								>
									{t("ui.guard.button_keep_sharing")}
								</Button>
								<Button
									variant="danger"
									data-testid="guard-confirm-stop"
									onClick={() => {
										const tenant = confirmOrg.tenant;
										setConfirm(null);
										onRevoke(tenant);
									}}
								>
									{t("ui.guard.button_stop_sharing")}
								</Button>
							</DialogFooter>
						</>
					) : null}
				</DialogContent>
			</Dialog>
		</div>
	);
};
