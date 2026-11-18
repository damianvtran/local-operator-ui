/**
 * D1 - Team Bridge without a Team plan, with the free community beside the
 * trial (RFC v2.4 §5.1).
 *
 * WHY IT REPLACES THE TRIAL EMPTY STATE ONLY WHEN THE FLAG IS ON. The page's
 * `noOrgPanel` slot is the plan-required branch; with `team-bridge-community`
 * off the page keeps mounting `TeamBridgeTrialEmpty` exactly as before, so
 * private Team Bridge does not change while this ships dark.
 *
 * THE TWO CARDS ARE INDEPENDENT. The trial card follows `trial_offer`; the
 * community card follows `community_access`, and no billing state can remove
 * it ("billing failures never disable community join"). A plan-check outage
 * replaces the trial card with "Couldn't check your Team plan · Retry" and
 * keeps the community join beside it - never a commercial claim.
 *
 * THE CHECKOUT IS THE CONSOLE'S. The trial button opens Radient Console checkout
 * pinned to the selected org (`subscribeUrlFor(tenantId)`), never the Console's
 * default org; the app starts no checkout of its own here.
 *
 * Split view/container: `CommunityNoPlanView` renders any state for stories and
 * tests without a transport; `CommunityNoPlanEntry` owns the reads.
 */
import { useMembershipsQuery } from "@features/agent-hub/hooks/use-memberships-query";
import {
	TEAMS_SUBSCRIBE_URL,
	subscribeUrlFor,
} from "@features/team-bridge-trial/team-bridge-trial-model";
import { useTeamTrialEligibility } from "@features/team-bridge-trial/use-team-trial";
import { TEAM_TRIAL_START_ENABLED } from "@shared/api/local-operator/team-trial-activation";
import { Spinner } from "@shared/components/common/spinner";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@shared/components/ui/alert";
import { Button } from "@shared/components/ui/button";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { openConsolePage } from "@shared/utils/radient-account-copy";
import { ExternalLink, Globe, Info, RefreshCw, Users } from "lucide-react";
import type { FC, ReactNode } from "react";
import {
	type CommunityAccess,
	type CommunityNoPlanView as CommunityNoPlanViewState,
	type CommunityTrialCard,
	communityNoPlanView,
	privateAccessFromMemberships,
	trialOfferFrom,
} from "./community-model";

const Card: FC<{ children: ReactNode; className?: string; state: string }> = ({
	children,
	className,
	state,
}) => (
	<section
		data-community-card={state}
		className={cn(
			"flex min-w-0 flex-1 flex-col rounded-lg border border-hairline bg-surface p-5 text-left",
			className,
		)}
	>
		{children}
	</section>
);

const CardGlyph: FC<{ children: ReactNode }> = ({ children }) => (
	<span
		aria-hidden="true"
		className="mb-3 flex size-8 items-center justify-center rounded-md bg-elevated text-ink-muted"
	>
		{children}
	</span>
);

const TrialCard: FC<{ card: CommunityTrialCard }> = ({ card }) => {
	const title = (
		<h2 className="text-[15px] font-medium text-ink">
			{t("ui.community.noplan.trial.title")}
		</h2>
	);
	if (card.kind === "reconciling")
		return (
			<Card state="trial-reconciling">
				<CardGlyph>
					<Users size={16} />
				</CardGlyph>
				{title}
				<div className="mt-3">
					<Spinner
						size="sm"
						label={t("ui.community.noplan.trial.reconciling")}
					/>
				</div>
			</Card>
		);
	if (card.kind === "ask_owner")
		return (
			<Card state="trial-ask-owner">
				<CardGlyph>
					<Users size={16} />
				</CardGlyph>
				{title}
				<p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
					{card.orgName
						? t("ui.community.noplan.trial.ask_owner_body", {
								org: card.orgName,
							})
						: t("ui.community.noplan.trial.ask_owner_body_unnamed")}
				</p>
				<div className="mt-4">
					{/* Opens the org's Console team page, where its owners are listed;
					    a member has no checkout to open (RFC §5.1). */}
					<Button
						variant="secondary"
						size="sm"
						data-community-action="ask-owner"
						onClick={() => openConsolePage(TEAMS_SUBSCRIBE_URL)}
					>
						{t("ui.community.noplan.trial.ask_owner")}
					</Button>
				</div>
			</Card>
		);
	const action =
		card.kind === "create_org"
			? {
					label: t("ui.community.noplan.trial.create_org"),
					hint: t("ui.community.noplan.trial.create_org_hint"),
				}
			: card.kind === "resume"
				? {
						label: t("ui.community.noplan.trial.resume"),
						hint: t("ui.community.noplan.trial.resume_hint"),
					}
				: {
						label: t("ui.community.noplan.trial.start"),
						hint: card.orgName
							? t("ui.community.noplan.trial.start_hint", { org: card.orgName })
							: t("ui.community.noplan.trial.start_hint_unnamed"),
					};
	return (
		<Card state={`trial-${card.kind}`}>
			<CardGlyph>
				<Users size={16} />
			</CardGlyph>
			{title}
			<p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
				{t("ui.community.noplan.trial.body")}
			</p>
			{card.kind === "create_org" && (
				<p className="mt-2 flex items-center gap-1.5 text-[12px] text-ink-muted">
					<Info size={13} aria-hidden="true" className="shrink-0" />
					{t("ui.community.noplan.trial.no_org")}
				</p>
			)}
			<div className="mt-4">
				{/* The label is RFC-fixed copy and longer in every locale but zh-CN:
				    it wraps inside the card, never past its edge, and the icon
				    keeps its size (design round 1, D1). */}
				<Button
					variant="primary"
					size="sm"
					data-community-action={`trial-${card.kind}`}
					onClick={() => openConsolePage(card.url)}
					className="h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-start"
				>
					<span className="min-w-0">{action.label}</span>
					<ExternalLink size={13} aria-hidden="true" className="shrink-0" />
				</Button>
			</div>
			<p className="mt-2 text-[12px] leading-relaxed text-ink-dim">
				{action.hint}
			</p>
		</Card>
	);
};

const CommunityCard: FC<{
	access: CommunityAccess;
	onJoin: () => void;
	onOpen: () => void;
	onRetry?: () => void;
}> = ({ access, onJoin, onOpen, onRetry }) => (
	<Card state={`community-${access}`}>
		<CardGlyph>
			<Globe size={16} />
		</CardGlyph>
		<h2 className="text-[15px] font-medium text-ink">
			{t("ui.community.noplan.community.title")}
		</h2>
		<p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
			{t("ui.community.noplan.community.body")}
		</p>
		<div className="mt-4">
			{access === "checking" ? (
				/* The list read is in flight: a quiet placeholder where the button
				   will be, never "unavailable" (review round 1, m3). Unlabelled -
				   the card's title and body already say what is coming. */
				<div aria-busy="true" className="flex h-8 items-center">
					<Spinner size="sm" />
				</div>
			) : access === "unavailable" || access === "failed" ? (
				<div className="flex flex-col items-start gap-2">
					<p className="text-[13px] text-ink-muted">
						{t("ui.community.noplan.community.unavailable")}
					</p>
					{/* A failed read is retryable; a disabled community is not. */}
					{access === "failed" && onRetry && (
						<Button
							variant="secondary"
							size="sm"
							data-community-action="retry-community"
							onClick={onRetry}
						>
							<RefreshCw size={13} aria-hidden="true" />
							{t("ui.community.noplan.retry")}
						</Button>
					)}
				</div>
			) : (
				<Button
					variant="secondary"
					size="sm"
					data-community-action={access === "joined" ? "open" : "join"}
					onClick={access === "joined" ? onOpen : onJoin}
				>
					{access === "joined"
						? t("ui.community.noplan.community.open")
						: t("ui.community.noplan.community.join")}
				</Button>
			)}
		</div>
		<p className="mt-2 text-[12px] text-ink-dim">
			{t("ui.community.noplan.community.free")}
		</p>
	</Card>
);

const PlanCheckFailed: FC<{ onRetry: () => void }> = ({ onRetry }) => (
	<Alert
		variant="warning"
		data-community-card="plan-check-failed"
		className="flex-1"
	>
		<AlertTitle>{t("ui.community.noplan.failed.title")}</AlertTitle>
		<AlertDescription>
			<p>{t("ui.community.noplan.failed.body")}</p>
			<Button
				variant="secondary"
				size="sm"
				className="mt-3"
				data-community-action="retry-plan"
				onClick={onRetry}
			>
				<RefreshCw size={13} aria-hidden="true" />
				{t("ui.community.noplan.retry")}
			</Button>
		</AlertDescription>
	</Alert>
);

export const CommunityNoPlanView: FC<{
	view: CommunityNoPlanViewState;
	selfName?: string | null;
	onJoin: () => void;
	onOpen: () => void;
	onRetry: () => void;
	onSignIn?: () => void;
	/** Re-read the community list after a failed read (the card's Retry). */
	onRetryCommunity?: () => void;
	/**
	 * The shipped plan-required panel (`TeamBridgeEligibilityPanel`), drawn for
	 * `plan_panel`. A slot rather than an import: that panel lives in the page
	 * module, which already imports this one.
	 */
	planPanel?: ReactNode;
}> = ({
	view,
	selfName,
	onJoin,
	onOpen,
	onRetry,
	onSignIn,
	onRetryCommunity,
	planPanel,
}) => {
	useI18nLocale();
	if (view.kind === "signed_out")
		return (
			<Frame state="signed-out">
				<h1 className="text-[18px] font-medium text-ink">
					{t("ui.community.noplan.signed_out.title")}
				</h1>
				<p className="mt-2 text-[13px] text-ink-muted">
					{t("ui.community.noplan.signed_out.body")}
				</p>
				{onSignIn && (
					<Button
						variant="primary"
						size="sm"
						className="mt-4"
						onClick={onSignIn}
					>
						{t("ui.community.noplan.signed_out.action")}
					</Button>
				)}
			</Frame>
		);
	if (view.kind === "plan_panel")
		return (
			<div
				data-glass-region="canvas"
				data-community-noplan="plan-panel"
				className="flex h-full min-h-0 w-full flex-col overflow-y-auto bg-canvas"
			>
				<div className="flex min-h-[280px] flex-1 flex-col">{planPanel}</div>
				<div className="mx-auto w-full max-w-[600px] shrink-0 px-6 pb-10">
					<CommunityCard
						access={view.community}
						onJoin={onJoin}
						onOpen={onOpen}
						onRetry={onRetryCommunity}
					/>
				</div>
			</div>
		);
	if (view.kind === "checking")
		return (
			<Frame state="checking" centered>
				<Spinner size="sm" label={t("ui.community.noplan.checking")} />
			</Frame>
		);
	return (
		<Frame state={view.kind === "offer" ? "offer" : "plan-check-failed"}>
			<h1 className="text-[18px] font-medium text-ink">
				{t("ui.community.noplan.title")}
			</h1>
			<p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
				{selfName
					? t("ui.community.noplan.body", { name: selfName })
					: t("ui.community.noplan.body_anonymous")}
			</p>
			<div className="mt-5 flex flex-col gap-4 md:flex-row md:items-stretch">
				{view.kind === "plan_check_failed" ? (
					<PlanCheckFailed onRetry={onRetry} />
				) : (
					view.trial && <TrialCard card={view.trial} />
				)}
				<CommunityCard
					access={view.community}
					onJoin={onJoin}
					onOpen={onOpen}
					onRetry={onRetryCommunity}
				/>
			</div>
		</Frame>
	);
};

const Frame: FC<{ children: ReactNode; state: string; centered?: boolean }> = ({
	children,
	state,
	centered = false,
}) => (
	<div
		data-glass-region="canvas"
		data-community-noplan={state}
		className="flex h-full min-h-0 w-full items-center justify-center overflow-y-auto bg-canvas px-6 py-10"
	>
		<div
			className={cn("w-full max-w-[600px]", centered && "flex justify-center")}
		>
			{children}
		</div>
	</div>
);

/**
 * The container the Team Bridge page mounts in its plan-required slot when the
 * community flag is on. `communityAccess` comes from the page's community list
 * read (one source for the switcher and this card).
 *
 * THE TRIAL HOLD IS RESPECTED (review round 1, m5; product decision). While
 * `TEAM_TRIAL_START_ENABLED` is false the slot shows what the page shows today
 * without the community - the plan-required panel with its existing upgrade
 * link - plus the community card, and mounts neither the eligibility read nor
 * the trial copy: turning the community flag on must not also turn on a trial
 * the release has not opened. The wrapper boundary is the
 * `TeamBridgeTrialEmpty` pattern, so hook order is unchanged when the hold is
 * lifted.
 */
export const CommunityNoPlanEntry: FC<NoPlanEntryProps> = ({
	trialStartEnabled = TEAM_TRIAL_START_ENABLED,
	...props
}) => {
	if (!trialStartEnabled)
		return (
			<CommunityNoPlanView
				view={{ kind: "plan_panel", community: props.communityAccess }}
				selfName={props.selfName}
				onJoin={props.onJoin}
				onOpen={props.onOpen}
				onRetry={() => undefined}
				onRetryCommunity={props.onRetryCommunity}
				planPanel={props.planPanel}
			/>
		);
	return <TrialNoPlanEntry {...props} />;
};

type NoPlanEntryProps = {
	communityAccess: CommunityAccess;
	selfName?: string | null;
	onJoin: () => void;
	onOpen: () => void;
	onRetryCommunity?: () => void;
	/** The shipped plan-required panel; see `CommunityNoPlanView`. */
	planPanel: ReactNode;
	/** The release hold; a parameter only so stories can render both ways. */
	trialStartEnabled?: boolean;
};

const TrialNoPlanEntry: FC<Omit<NoPlanEntryProps, "trialStartEnabled">> = ({
	communityAccess,
	selfName,
	onJoin,
	onOpen,
	onRetryCommunity,
	planPanel,
}) => {
	const memberships = useMembershipsQuery();
	const eligibility = useTeamTrialEligibility(true);
	const { access, selected } = privateAccessFromMemberships({
		pending: memberships.isPending,
		failed: memberships.isError,
		memberships: memberships.data?.memberships ?? null,
	});
	const view = communityNoPlanView({
		signedIn: true,
		// A pending eligibility read is still "checking": no trial card is drawn
		// and then replaced.
		privateAccess:
			access === "no_team_plan" && eligibility.isPending ? "unknown" : access,
		trialOffer: trialOfferFrom({
			eligibility:
				eligibility.unavailable || !eligibility.data
					? null
					: {
							eligible: eligibility.data.eligible,
							reason: eligibility.data.reason,
						},
			selected,
		}),
		communityAccess,
		selectedTenantId: selected?.tenant_id ?? null,
		selectedOrgName: selected?.tenant_name ?? null,
		subscribeUrl: subscribeUrlFor,
		trialStartEnabled: true,
	});
	return (
		<CommunityNoPlanView
			view={view}
			selfName={selfName}
			onJoin={onJoin}
			onOpen={onOpen}
			onRetry={() => {
				void memberships.refetch();
				void eligibility.refetch?.();
			}}
			onRetryCommunity={onRetryCommunity}
			planPanel={planPanel}
		/>
	);
};
