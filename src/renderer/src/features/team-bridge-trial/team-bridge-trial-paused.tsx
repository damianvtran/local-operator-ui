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
	/**
	 * `member`: cannot subscribe, so the note names who can and has no button.
	 * `pending`: the role is not known yet, so the note renders NO action rather
	 * than guess (code review round 2, R2-1): on the standalone ended panel the
	 * band is the whole canvas, so a Subscribe that a disabled member sees and
	 * then loses is a visible flash, not a harmless default.
	 */
	audience?: "billing" | "member" | "pending";
	/**
	 * `ghost` in-page, where the band sits above the history the reader came
	 * for; `primary` when the band stands alone and the action is the only way
	 * forward (design round 3, D9).
	 */
	actionVariant?: "ghost" | "primary";
	timeZone?: string;
}> = ({
	kind,
	at,
	tenantId,
	audience = "billing",
	actionVariant = "ghost",
	timeZone,
}) => {
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
					{!member && audience !== "pending" && (
						<Button
							variant={actionVariant}
							size="sm"
							// `text-ink` lifts the ghost label to full ink; on `primary` it
							// would override the accent's own `text-on-accent`.
							className={cn(
								"shrink-0",
								actionVariant === "ghost" && "text-ink",
							)}
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

/**
 * The no-organization branch when the account's organization's trial ENDED
 * (QA round 1, Q5): the paused band for that organization, in place of the trial
 * on-ramp. Surface A gates the page's reads, so there is no history to sit the
 * band above here; it stands alone in the page canvas with the same sentence,
 * date and audience rule (owner/admin get Subscribe, a disabled member reads who
 * can act) as the in-page note. The date is the runtime's `trial_ended_at`, so
 * the sentence waits on no second read; the ACTION waits for the role
 * (`audience="pending"` while memberships load), so a disabled member never
 * sees a Subscribe that then disappears (R2-1). Subscribe is the primary
 * button here because it is the owner's only way forward in an otherwise empty
 * canvas (D9); the in-page note keeps the ghost weight.
 */
export const TeamBridgeTrialEndedView: FC<{
	tenantId: string;
	endedAt: string;
	audience?: "billing" | "member" | "pending";
	timeZone?: string;
}> = ({ tenantId, endedAt, audience = "billing", timeZone }) => (
	<div
		data-glass-region="canvas"
		data-team-bridge-trial="ended"
		className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-canvas px-6"
	>
		<div className="max-w-lg">
			<TeamBridgeTrialNoteView
				kind="paused"
				at={endedAt}
				tenantId={tenantId}
				audience={audience}
				actionVariant="primary"
				timeZone={timeZone}
			/>
		</div>
	</div>
);

/** The container: the audience comes from the account's own memberships. */
export const TeamBridgeTrialEndedPanel: FC<{
	tenantId: string;
	endedAt: string;
}> = ({ tenantId, endedAt }) => {
	// `enabled` stated rather than defaulted (R2-2), matching the in-page note.
	const memberships = useMembershipsQuery({ enabled: Boolean(tenantId) });
	// `isLoading` (pending AND fetching), not `isPending`: a query the hook
	// disables (signed out, no observed account) stays pending forever, and
	// would then hold the owner's only action indefinitely. A settled failure
	// keeps `trialNoteAudience`'s `billing` fallback; the console decides.
	return (
		<TeamBridgeTrialEndedView
			tenantId={tenantId}
			endedAt={endedAt}
			audience={
				memberships.isLoading
					? "pending"
					: trialNoteAudience(memberships.data?.memberships ?? null, tenantId)
			}
		/>
	);
};
