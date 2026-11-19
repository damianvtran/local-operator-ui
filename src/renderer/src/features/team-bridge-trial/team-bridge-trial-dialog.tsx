/**
 * The start-trial dialog (teams-trial §8 copy, §9 Lane F).
 *
 * WHAT IT PROMISES, AND WHY EACH LINE IS HERE. The lead is the operator's
 * verbatim dialog copy (shared with the console, user-console PR #51): it is the
 * promise a customer accepts the Terms against, so it names the end date, "no
 * credit card required" and "nothing is charged automatically". The two lists
 * are documented policy, not marketing: what the trial includes (M1: Vault team
 * vaults ARE in), and what happens at the end (features pause, data kept, vaults
 * locked and restored on subscribe, bought credits stay on the org balance, M2).
 *
 * CONSENT. The Terms box is required and unticked by default; the server records
 * `terms_version` with the acceptance and refuses a stale one (409
 * `terms_outdated`), which this dialog answers by un-ticking the box and asking
 * again rather than retrying silently. The Terms link is pinned
 * (`TERMS_URL`), never taken from a response.
 *
 * ONE PRESS, ONE REQUEST ID. Every press of "Start free trial" mints a fresh
 * id (`trialStartRequest`), so a refusal or failure never poisons the next
 * press, and a changed name or a re-ticked box is a new request by
 * construction. Reusing an id after a refusal is what made every retry fail in
 * round 1 (R1-1): the core receipt store leaves a refused claim without a
 * result and rejects that id from then on.
 *
 * Uses the shared `Dialog` primitives, so it inherits the app's dialog surface,
 * elevation and every theme (light and dark) through role tokens.
 */
import { trialRefusalCode } from "@shared/api/local-operator/team-trial-api";
import { Button } from "@shared/components/ui/button";
import { Checkbox } from "@shared/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { Input } from "@shared/components/ui/input";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { openConsolePage } from "@shared/utils/radient-account-copy";
import { useQueryClient } from "@tanstack/react-query";
import { type FC, useEffect, useId, useState } from "react";
import {
	TRIAL_ORG_NAME_MAX,
	type TrialStartFailure,
	canStartTrial,
	formatTrialDate,
	trialStartFailure,
	trialStartRequest,
} from "./team-bridge-trial-model";
import { teamTrialKeys, useStartTeamTrial } from "./use-team-trial";

const INCLUDED = [
	"ui.teamBridgeTrial.dialog.included_invites",
	"ui.teamBridgeTrial.dialog.included_credits",
	"ui.teamBridgeTrial.dialog.included_bridge",
	"ui.teamBridgeTrial.dialog.included_vault",
] as const;

const AT_END = [
	"ui.teamBridgeTrial.dialog.end_pause",
	"ui.teamBridgeTrial.dialog.end_vault",
	"ui.teamBridgeTrial.dialog.end_credits",
	// X6: invitations are withdrawn at the end and NOT restored by subscribing.
	"ui.teamBridgeTrial.dialog.end_invites",
] as const;

const FAILURE_COPY = {
	terms_outdated: "ui.teamBridgeTrial.error.terms_outdated",
	not_eligible: "ui.teamBridgeTrial.error.not_eligible",
	rate_limited: "ui.teamBridgeTrial.error.rate_limited",
	generic: "ui.teamBridgeTrial.error.generic",
} as const satisfies Record<TrialStartFailure, string>;

export type TeamBridgeTrialDialogViewProps = {
	open: boolean;
	onClose: () => void;
	endsAt: string;
	termsUrl: string;
	orgName: string;
	onOrgNameChange: (value: string) => void;
	termsAccepted: boolean;
	onTermsAcceptedChange: (value: boolean) => void;
	pending?: boolean;
	failure?: TrialStartFailure | null;
	onConfirm: () => void;
	/** Test/story seam for a stable date; the app uses the reader's own zone. */
	timeZone?: string;
};

/** The presentational dialog: every state a story or a test needs, no transport. */
export const TeamBridgeTrialDialogView: FC<TeamBridgeTrialDialogViewProps> = ({
	open,
	onClose,
	endsAt,
	termsUrl,
	orgName,
	onOrgNameChange,
	termsAccepted,
	onTermsAcceptedChange,
	pending = false,
	failure = null,
	onConfirm,
	timeZone,
}) => {
	const locale = useI18nLocale();
	const nameId = useId();
	const termsId = useId();
	const date = formatTrialDate(endsAt, locale, timeZone) ?? endsAt;
	const ready = canStartTrial({ termsAccepted, orgName, pending });
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next && !pending) onClose();
			}}
		>
			<DialogContent className="gap-4" data-team-bridge-trial="dialog">
				<DialogTitle>{t("ui.teamBridgeTrial.dialog.title")}</DialogTitle>
				<DialogDescription className="text-[13px] leading-relaxed text-ink-muted">
					{t("ui.teamBridgeTrial.dialog.lead", { date })}
				</DialogDescription>

				<label
					htmlFor={nameId}
					className="flex flex-col gap-1 text-[13px] text-ink-muted"
				>
					{t("ui.teamBridgeTrial.dialog.org_label")}
					<Input
						id={nameId}
						value={orgName}
						onChange={(event) => onOrgNameChange(event.target.value)}
						maxLength={TRIAL_ORG_NAME_MAX}
						disabled={pending}
					/>
				</label>

				<section className="flex flex-col gap-1">
					<h2 className="text-[13px] font-medium text-ink">
						{t("ui.teamBridgeTrial.dialog.included_heading")}
					</h2>
					<ul className="list-disc ps-5 text-[13px] leading-relaxed text-ink-muted">
						{INCLUDED.map((key) => (
							<li key={key}>{t(key)}</li>
						))}
					</ul>
				</section>

				<section className="flex flex-col gap-1">
					<h2 className="text-[13px] font-medium text-ink">
						{t("ui.teamBridgeTrial.dialog.end_heading")}
					</h2>
					<ul className="list-disc ps-5 text-[13px] leading-relaxed text-ink-muted">
						{AT_END.map((key) => (
							<li key={key}>{t(key)}</li>
						))}
					</ul>
				</section>

				<div className="flex flex-col gap-1">
					<div className="flex items-center gap-2">
						<Checkbox
							id={termsId}
							checked={termsAccepted}
							onCheckedChange={(value) => onTermsAcceptedChange(value === true)}
							disabled={pending}
							aria-required="true"
						/>
						<label htmlFor={termsId} className="text-[13px] text-ink">
							{t("ui.teamBridgeTrial.dialog.terms_agree")}
						</label>
					</div>
					<Button
						type="button"
						variant="link"
						size="sm"
						className="self-start ps-6"
						onClick={() => openConsolePage(termsUrl)}
					>
						{t("ui.teamBridgeTrial.dialog.terms_read")}
					</Button>
				</div>

				{failure && (
					<p role="alert" className="text-[13px] text-danger">
						{t(FAILURE_COPY[failure])}
					</p>
				)}

				<div className="flex justify-end gap-2">
					<Button
						type="button"
						variant="ghost"
						onClick={onClose}
						disabled={pending}
					>
						{t("ui.teamBridgeTrial.dialog.cancel")}
					</Button>
					<Button
						type="button"
						variant="primary"
						disabled={!ready}
						onClick={onConfirm}
						data-team-bridge-trial-action="confirm"
					>
						{pending
							? t("ui.teamBridgeTrial.dialog.starting")
							: t("ui.teamBridgeTrial.dialog.confirm")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
};

/** The dialog with its state and the start mutation. */
export const TeamBridgeTrialDialog: FC<{
	open: boolean;
	onClose: () => void;
	tenantId: string;
	defaultOrgName: string;
	endsAt: string;
	termsVersion: string;
	termsUrl: string;
}> = ({
	open,
	onClose,
	tenantId,
	defaultOrgName,
	endsAt,
	termsVersion,
	termsUrl,
}) => {
	const start = useStartTeamTrial();
	const client = useQueryClient();
	const [orgName, setOrgName] = useState(defaultOrgName);
	const [termsAccepted, setTermsAccepted] = useState(false);
	const [failure, setFailure] = useState<TrialStartFailure | null>(null);
	useEffect(() => {
		if (!open) return;
		setOrgName(defaultOrgName);
		setTermsAccepted(false);
		setFailure(null);
	}, [open, defaultOrgName]);

	return (
		<TeamBridgeTrialDialogView
			open={open}
			onClose={onClose}
			endsAt={endsAt}
			termsUrl={termsUrl}
			orgName={orgName}
			onOrgNameChange={setOrgName}
			termsAccepted={termsAccepted}
			onTermsAcceptedChange={(value) => {
				setTermsAccepted(value);
				setFailure(null);
			}}
			pending={start.isPending}
			failure={failure}
			onConfirm={() => {
				setFailure(null);
				start.mutate(
					trialStartRequest(
						{ tenantId, termsVersion, orgName, defaultOrgName },
						() => crypto.randomUUID(),
					),
					{
						onSuccess: () => onClose(),
						onError: (error) => {
							const kind = trialStartFailure(trialRefusalCode(error));
							if (kind === "terms_outdated") {
								// The box is un-ticked and eligibility re-read, so the next
								// press sends the CURRENT version the user is agreeing to.
								setTermsAccepted(false);
								void client.invalidateQueries({ queryKey: teamTrialKeys.all });
							}
							setFailure(kind);
						},
					},
				);
			}}
		/>
	);
};
