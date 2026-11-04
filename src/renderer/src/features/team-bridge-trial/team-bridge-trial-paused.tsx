/**
 * The trial's two quiet page-level notes (teams-trial §9 Lane F).
 *
 * - ACTIVE: "Trial active until <date>" with an "Invite teammates" action, shown
 *   at the top of the Team Bridge page while the selected organization's trial
 *   runs, which is where the user lands after starting it (operator spec 4).
 * - PAUSED: "Your Team trial ended on <date>. Team Bridge history stays
 *   readable (read-only); subscribe to continue." with Subscribe opening the
 *   console (operator spec 5). The page renders history read-only and disables
 *   posting through its existing `readOnly` prop; the server refuses writes
 *   anyway (403 `team_trial_ended`, D9), so this note is the explanation, not
 *   the guard. A member who cannot subscribe (not an owner or admin, or one
 *   the trial end disabled, X3) reads who can act and gets no button.
 *
 * CALM, NOT A WARNING (D7). A trial reaching the end it promised is expected,
 * so the paused band uses the same neutral info band as the active note, and
 * it is the ONE place the read-only reason is said: the page drops its generic
 * composer line for this case (`readOnlyNoteShown`). The action sits right
 * after the sentence rather than pinned to the band's far edge (D8).
 *
 * Both sit in the page's existing `notice` slot, in the shared notice-band
 * grammar (`NOTICE_BAND`), so neither is a banner anywhere else in the app.
 *
 * "Invite teammates" opens the console's Team page: the desktop app has no
 * organization-invite flow today (the in-app add-members dialog adds existing
 * members to a conversation, not people to an organization).
 */
import { useMembershipsQuery } from "@features/agent-hub/hooks/use-memberships-query";
import { NOTICE_BAND } from "@shared/components/common/notice-band";
import { Alert } from "@shared/components/ui/alert";
import { Button } from "@shared/components/ui/button";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { openConsolePage } from "@shared/utils/radient-account-copy";
import type { FC } from "react";
import {
	activeUntil,
	formatTrialDate,
	pausedEndedAt,
	subscribeUrlFor,
	trialNoteAudience,
} from "./team-bridge-trial-model";
import { useTeamTrialStatus } from "./use-team-trial";

export const TeamBridgeTrialNoteView: FC<{
	kind: "active" | "paused";
	/** The instant the trial ends (active) or ended (paused). */
	at: string;
	tenantId: string | null;
	/** `member`: cannot subscribe, so the note names who can and has no button. */
	audience?: "billing" | "member";
	timeZone?: string;
}> = ({ kind, at, tenantId, audience = "billing", timeZone }) => {
	const locale = useI18nLocale();
	const date = formatTrialDate(at, locale, timeZone) ?? at;
	const url = subscribeUrlFor(tenantId);
	const member = kind === "paused" && audience === "member";
	return (
		<output
			className="block px-4 pt-2"
			data-team-bridge-trial-note={kind}
			data-team-bridge-trial-audience={audience}
		>
			<Alert variant="info" className={cn(NOTICE_BAND, "border-transparent")}>
				<div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
					<p className="min-w-0 max-w-prose text-body-sm text-ink">
						{kind === "active"
							? t("ui.teamBridgeTrial.active.note", { date })
							: member
								? t("ui.teamBridgeTrial.paused.note_member", { date })
								: t("ui.teamBridgeTrial.paused.note", { date })}
					</p>
					{!member && (
						<Button
							variant="ghost"
							size="sm"
							className="shrink-0 text-ink"
							data-team-bridge-trial-action={
								kind === "paused" ? "subscribe" : "invite"
							}
							onClick={() => openConsolePage(url)}
						>
							{kind === "paused"
								? t("ui.teamBridgeTrial.subscribe")
								: t("ui.teamBridgeTrial.active.invite")}
						</Button>
					)}
				</div>
			</Alert>
		</output>
	);
};

/**
 * The page-level trial fact for one organization: `paused` is what the page
 * ORs into its `readOnly`, `note` is what it renders in the notice slot. A
 * failed or unsupported read answers "no fact", which leaves the page as it was.
 */
export function useTeamBridgeTrialNote(tenantId: string | null | undefined): {
	paused: boolean;
	note: JSX.Element | null;
} {
	const status = useTeamTrialStatus(tenantId);
	const memberships = useMembershipsQuery({ enabled: Boolean(tenantId) });
	const ended = pausedEndedAt(status.data);
	if (ended)
		return {
			paused: true,
			note: (
				<TeamBridgeTrialNoteView
					kind="paused"
					at={ended}
					tenantId={tenantId ?? null}
					audience={trialNoteAudience(
						memberships.data?.memberships ?? null,
						tenantId,
					)}
				/>
			),
		};
	const until = activeUntil(status.data);
	return {
		paused: false,
		note: until ? (
			<TeamBridgeTrialNoteView
				kind="active"
				at={until}
				tenantId={tenantId ?? null}
			/>
		) : null,
	};
}
