/**
 * The Team Bridge page's no-organization empty state (teams-trial §9 Lane F).
 *
 * ONE CALM CTA, ON THIS PAGE ONLY (operator spec 2). It replaces the generic
 * "requires a Radient Team plan" panel for exactly the accounts the trial can
 * help: signed in, in no Team organization, and eligible. It is laid out like
 * `TeamBridgeEligibilityPanel` (same centred block, glyph and type steps) so the
 * page does not change character between states; there is no banner, toast or
 * popup anywhere else.
 *
 * Split container/view: `TeamBridgeTrialEmptyView` renders any state for the
 * stories without a transport; `TeamBridgeTrialEmpty` owns the reads and the
 * dialog. When no trial can be offered (an older backend, the flag off, the user
 * already on Teams) the container renders `fallback`: the page's existing panel,
 * unchanged.
 */
import { useMembershipsQuery } from "@features/agent-hub/hooks/use-memberships-query";
import { TEAM_TRIAL_START_ENABLED } from "@shared/api/local-operator/team-trial-activation";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { openConsolePage } from "@shared/utils/radient-account-copy";
import { Users } from "lucide-react";
import { type FC, type ReactNode, useState } from "react";
import { TeamBridgeTrialDialog } from "./team-bridge-trial-dialog";
import {
	type IneligibleReason,
	type TrialEmptyView,
	trialEmptyView,
} from "./team-bridge-trial-model";
import { useTeamTrialEligibility } from "./use-team-trial";

const INELIGIBLE_COPY = {
	trial_used: "ui.teamBridgeTrial.ineligible.trial_used",
	former_subscriber: "ui.teamBridgeTrial.ineligible.former_subscriber",
	not_owner: "ui.teamBridgeTrial.ineligible.not_owner",
	email_unverified: "ui.teamBridgeTrial.ineligible.email_unverified",
	other: "ui.teamBridgeTrial.ineligible.other",
} as const satisfies Record<IneligibleReason, string>;

const Frame: FC<{ children: ReactNode; state: string }> = ({
	children,
	state,
}) => (
	<div
		data-glass-region="canvas"
		data-team-bridge-trial={state}
		className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-canvas px-6"
	>
		<div className="max-w-lg text-center">
			<Users
				size={20}
				aria-hidden="true"
				className="mx-auto mb-3 text-ink-dim"
			/>
			{children}
		</div>
	</div>
);

export const TeamBridgeTrialEmptyView: FC<{
	view: Exclude<TrialEmptyView, { kind: "unchanged" }>;
	onStart?: () => void;
}> = ({ view, onStart }) => {
	useI18nLocale();
	if (view.kind === "checking")
		return (
			<div
				data-glass-region="canvas"
				data-team-bridge-trial="checking"
				className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-canvas px-6"
			>
				<Spinner size="sm" label={t("ui.teamBridgeTrial.empty.checking")} />
			</div>
		);
	if (view.kind === "ineligible")
		return (
			<Frame state="ineligible">
				<h1 className="text-balance text-[16px] font-medium text-ink">
					{t("ui.teamBridgeTrial.ineligible.title")}
				</h1>
				<p className="mt-2 text-pretty text-[13px] leading-relaxed text-ink-muted">
					{t(INELIGIBLE_COPY[view.reason])}
				</p>
				{/* Only a viewer who can buy gets the button (C3: owners AND admins
				    can subscribe; a plain member cannot, and the sentence names who
				    can act). */}
				{view.canSubscribe && (
					<Button
						variant="secondary"
						size="sm"
						className="mt-4"
						data-team-bridge-trial-action="subscribe"
						onClick={() => openConsolePage(view.subscribeUrl)}
					>
						{t("ui.teamBridgeTrial.subscribe")}
					</Button>
				)}
			</Frame>
		);
	return (
		<Frame state="eligible">
			<h1 className="text-balance text-[16px] font-medium text-ink">
				{t("ui.teamBridgeTrial.empty.title")}
			</h1>
			<p className="mt-2 text-pretty text-[13px] leading-relaxed text-ink-muted">
				{t("ui.teamBridgeTrial.empty.body")}
			</p>
			<Button
				variant="primary"
				size="sm"
				className="mt-4"
				data-team-bridge-trial-action="start"
				onClick={onStart}
			>
				{t("ui.teamBridgeTrial.empty.start")}
			</Button>
		</Frame>
	);
};

/**
 * The container the page mounts at its no-organization branch (the gate's
 * `plan_required`: surface A, no eligible organization and nothing retained).
 *
 * `fallback` is what the page would have shown without this feature (the
 * plan-required panel); it is returned verbatim whenever the trial has nothing
 * to add, so a server or build without the trial leaves the page unchanged.
 */
export const TeamBridgeTrialEmpty: FC<{ fallback: ReactNode }> = (props) => {
	// A wrapper boundary keeps the disabled release from mounting reads or the
	// dialog at all, without changing hook order when activation is reviewed.
	if (!TEAM_TRIAL_START_ENABLED) return <>{props.fallback}</>;
	return <ActivatedTeamBridgeTrialEmpty {...props} />;
};

const ActivatedTeamBridgeTrialEmpty: FC<{ fallback: ReactNode }> = ({
	fallback,
}) => {
	const eligibility = useTeamTrialEligibility(true);
	// The account's own rows: they decide whether an admin keeps Subscribe and
	// whether a paid-org member is offered no trial at all (R1-4). A failed read
	// leaves them null, which the model treats as "no extra fact".
	const memberships = useMembershipsQuery();
	const [dialogOpen, setDialogOpen] = useState(false);
	const view = trialEmptyView({
		pending: eligibility.isPending,
		unavailable: eligibility.unavailable,
		eligibility: eligibility.data,
		memberships: memberships.data?.memberships ?? null,
	});
	if (view.kind === "unchanged") return <>{fallback}</>;
	return (
		<>
			<TeamBridgeTrialEmptyView
				view={view}
				onStart={() => setDialogOpen(true)}
			/>
			{view.kind === "eligible" && (
				<TeamBridgeTrialDialog
					open={dialogOpen}
					onClose={() => setDialogOpen(false)}
					tenantId={view.tenantId}
					defaultOrgName={view.tenantName}
					endsAt={view.endsAt}
					termsVersion={view.termsVersion}
					termsUrl={view.termsUrl}
				/>
			)}
		</>
	);
};
