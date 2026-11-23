/**
 * D2/D3 - the two-step join dialog (RFC v2.4 §5.2).
 *
 * Step 1 shows the SERVER-VERSIONED guidelines exactly as the bootstrap read
 * returns them (`guidelines.text`, rendered as markdown) with the moderation
 * disclosure; step 2 previews what members will see and holds the primary
 * action disabled until the explicit, versioned acceptance box is ticked. The
 * version accepted is the one that was SHOWN: if the hub has published a newer
 * one meanwhile it answers 409 `guidelines_changed` and records nothing, and
 * the dialog reloads the guidelines and returns to step 1.
 *
 * THE PROFILE PREVIEW IS HONEST ABOUT ITS SOURCE. The contract's bootstrap does
 * not carry the profile projection yet ("planned additions: profile preview"),
 * and the join body cannot carry field choices yet (`profile_fields` is a 400
 * today). So the preview shows the name the app already holds for the Radient
 * account with the default avatar - which is exactly what other members see
 * until the profile fields pass moderation - and states that title and
 * description come from the Radient profile. The hide-title/description
 * toggles land with `profile_fields`; a toggle the server would ignore is not
 * drawn.
 *
 * The disabled Join button stays focusable (`aria-disabled`, not `disabled`) so
 * its reason - "Check the box to continue" - can be reached and read.
 *
 * RE-ACCEPT MODE (design review round 2, D7). A member whose accepted version
 * is stale opens the same dialog from "Review and accept", but they are not
 * joining and have a profile already: the step counter, the "Join {community}"
 * copy and the profile preview would all tell them otherwise. `mode="reaccept"`
 * is one step - the new guidelines with the same versioned acceptance box -
 * titled as a review, and its action says Accept. The write is the same join
 * call (the hub records the newly accepted version on the membership).
 */
import { TeamBridgeMarkdown } from "@features/team-bridge/team-bridge-markdown";
import {
	type CommunityBootstrap,
	communityFailure,
} from "@shared/api/local-operator/community-api";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, AlertDescription } from "@shared/components/ui/alert";
import { Button } from "@shared/components/ui/button";
import { Checkbox } from "@shared/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { type FC, useEffect, useId, useState } from "react";
import { useCommunityBootstrap, useJoinCommunity } from "./use-community";

export type CommunityJoinError =
	| { kind: "guidelines_changed" }
	| { kind: "rate_limited"; seconds: number }
	| { kind: "error" };

const WHITESPACE = /\s+/;

/** Initials for the default avatar: the first letter of the first two words. */
export function initialsFor(name: string): string {
	const parts = name.trim().split(WHITESPACE).filter(Boolean);
	return (
		parts
			.slice(0, 2)
			.map((part) => part[0]?.toLocaleUpperCase() ?? "")
			.join("") || "?"
	);
}

export const CommunityJoinDialogView: FC<{
	open: boolean;
	onClose: () => void;
	/** `undefined` while loading; `null` when the read failed. */
	bootstrap: CommunityBootstrap | null | undefined;
	onRetryLoad: () => void;
	selfName: string | null;
	joining: boolean;
	error: CommunityJoinError | null;
	onJoin: (guidelinesVersion: string) => void;
	/** `reaccept`: an existing member accepting changed guidelines (D7). */
	mode?: "join" | "reaccept";
	/** Story/capture seed only. */
	defaultStep?: 1 | 2;
	/** Story/capture seed only. */
	defaultAccepted?: boolean;
}> = ({
	open,
	onClose,
	bootstrap,
	onRetryLoad,
	selfName,
	joining,
	error,
	onJoin,
	mode = "join",
	defaultStep = 1,
	defaultAccepted = false,
}) => {
	useI18nLocale();
	const [step, setStep] = useState<1 | 2>(defaultStep);
	const [accepted, setAccepted] = useState(defaultAccepted);
	const checkboxId = useId();
	const hintId = useId();
	const version = bootstrap?.guidelines.version ?? "";
	const community = bootstrap?.community.name ?? "";
	const reaccept = mode === "reaccept";
	// Where the acceptance box and the primary action live: the join's step 2,
	// or re-accept's only step.
	const accepting = reaccept || step === 2;
	/*
	 * A changed version invalidates the acceptance: the reader agreed to the
	 * text they saw, so new text means step 1 again with the box clear.
	 */
	useEffect(() => {
		if (error?.kind === "guidelines_changed") {
			setStep(1);
			setAccepted(false);
		}
	}, [error]);
	useEffect(() => {
		if (!open) {
			setStep(defaultStep);
			setAccepted(defaultAccepted);
		}
	}, [open, defaultStep, defaultAccepted]);

	const errorCopy =
		error?.kind === "guidelines_changed"
			? t("ui.community.join.error.guidelines_changed")
			: error?.kind === "rate_limited"
				? t("ui.community.join.error.rate_limited", { seconds: error.seconds })
				: error
					? t("ui.community.join.error.generic")
					: null;

	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogContent
				data-community-join-step={reaccept ? "reaccept" : step}
				className="max-h-[calc(100vh-4rem)] max-w-[480px] gap-0 overflow-hidden p-0"
			>
				<div className="flex min-h-0 flex-col gap-1 px-5 pt-5 pe-12">
					{!reaccept && (
						<p className="text-meta-sm text-ink-dim">
							{t("ui.community.join.step", { step: String(step) })}
							{" · "}
							{step === 1
								? t("ui.community.join.step1.label")
								: t("ui.community.join.step2.label")}
						</p>
					)}
					<DialogTitle className="text-[16px] font-medium">
						{reaccept
							? t("ui.community.join.reaccept.title")
							: step === 1
								? t("ui.community.join.step1.title", { community })
								: t("ui.community.join.step2.title")}
					</DialogTitle>
					<DialogDescription className="text-[13px] text-ink-muted">
						{reaccept
							? t("ui.community.join.reaccept.body", { community })
							: step === 1
								? t("ui.community.join.step1.body")
								: t("ui.community.join.step2.body")}
					</DialogDescription>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
					{bootstrap === undefined ? (
						<div className="flex justify-center py-10">
							<Spinner size="sm" label={t("ui.community.join.loading")} />
						</div>
					) : bootstrap === null ? (
						<Alert variant="danger">
							<AlertDescription>
								<p>{t("ui.community.join.load_error")}</p>
								<Button
									variant="secondary"
									size="sm"
									className="mt-2"
									onClick={onRetryLoad}
								>
									<RefreshCw size={13} aria-hidden="true" />
									{t("ui.community.noplan.retry")}
								</Button>
							</AlertDescription>
						</Alert>
					) : reaccept || step === 1 ? (
						<GuidelinesStep bootstrap={bootstrap} />
					) : (
						<ProfileStep selfName={selfName} />
					)}
					{errorCopy && (
						<Alert
							variant={error?.kind === "guidelines_changed" ? "info" : "danger"}
							className="mt-3"
							// Mounted by the reader's Join press: announce it (design D4).
							role="alert"
							data-community-join-error={error?.kind}
						>
							<AlertDescription>{errorCopy}</AlertDescription>
						</Alert>
					)}
					{accepting && bootstrap && (
						<div className="mt-4 flex items-start gap-2.5">
							<Checkbox
								id={checkboxId}
								checked={accepted}
								onCheckedChange={(value) => setAccepted(value === true)}
								className="mt-0.5"
								data-community-join-accept=""
							/>
							<label
								htmlFor={checkboxId}
								className="text-[13px] leading-relaxed text-ink"
							>
								{t("ui.community.join.agree", { version })}
							</label>
						</div>
					)}
				</div>
				<div className="flex items-center justify-between gap-3 bg-surface px-5 py-3">
					<p id={hintId} className="text-meta-sm text-ink-dim">
						{!accepting
							? t("ui.community.join.next_hint")
							: accepted
								? ""
								: t("ui.community.join.agree_hint")}
					</p>
					<div className="flex shrink-0 gap-2">
						{!accepting ? (
							<>
								<Button variant="ghost" size="sm" onClick={onClose}>
									{t("ui.community.join.cancel")}
								</Button>
								<Button
									variant="primary"
									size="sm"
									disabled={!bootstrap}
									data-community-action="join-continue"
									onClick={() => setStep(2)}
								>
									{t("ui.community.join.continue")}
								</Button>
							</>
						) : (
							<>
								{reaccept ? (
									<Button variant="ghost" size="sm" onClick={onClose}>
										{t("ui.community.join.cancel")}
									</Button>
								) : (
									<Button variant="ghost" size="sm" onClick={() => setStep(1)}>
										{t("ui.community.join.back")}
									</Button>
								)}
								<Button
									variant="primary"
									size="sm"
									aria-disabled={!accepted || joining}
									aria-describedby={hintId}
									data-community-action="join-submit"
									className={cn(
										(!accepted || joining) &&
											"bg-sunken text-ink-disabled hover:bg-sunken active:bg-sunken",
									)}
									onClick={() => {
										if (!accepted) {
											// The reason is the box: put the reader there.
											document.getElementById(checkboxId)?.focus();
											return;
										}
										if (joining || !bootstrap) return;
										onJoin(bootstrap.guidelines.version);
									}}
								>
									{reaccept
										? joining
											? t("ui.community.join.reaccept.accepting")
											: t("ui.community.join.reaccept.submit")
										: joining
											? t("ui.community.join.joining")
											: t("ui.community.join.submit")}
								</Button>
							</>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
};

const GuidelinesStep: FC<{ bootstrap: CommunityBootstrap }> = ({
	bootstrap,
}) => (
	<div className="flex flex-col gap-3">
		<div className="flex items-center gap-2">
			<span className="text-[13px] font-medium text-ink">
				{t("ui.community.join.guidelines.heading")}
			</span>
			<span className="rounded-sm border border-hairline px-1.5 font-mono text-mono-sm text-ink-muted">
				{bootstrap.guidelines.version}
			</span>
		</div>
		<div
			data-community-guidelines=""
			// Focusable so a keyboard reader can scroll the rules (D2).
			// biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll region must take focus to scroll by keyboard.
			tabIndex={0}
			className="max-h-[220px] overflow-y-auto rounded-md border border-hairline bg-sunken px-3 py-2 text-[13px]"
		>
			<TeamBridgeMarkdown>{bootstrap.guidelines.text}</TeamBridgeMarkdown>
		</div>
		<Alert variant="info" icon={<ShieldCheck size={15} aria-hidden="true" />}>
			<p className="text-[13px] font-medium text-ink">
				{t("ui.community.join.disclosure.title")}
			</p>
			<AlertDescription className="text-[13px]">
				{t("ui.community.join.disclosure.body")}
			</AlertDescription>
		</Alert>
	</div>
);

const ProfileStep: FC<{ selfName: string | null }> = ({ selfName }) => {
	const name = selfName?.trim() || "";
	return (
		<div
			data-community-profile-preview=""
			className="rounded-md border border-hairline bg-sunken"
		>
			<p className="px-3 pt-3 font-mono text-mono-sm uppercase text-ink-dim">
				{t("ui.community.join.preview.heading")}
			</p>
			<div className="flex items-center gap-3 px-3 py-3">
				<span
					aria-hidden="true"
					className="flex size-10 shrink-0 items-center justify-center rounded-md bg-elevated text-[14px] font-medium text-ink"
				>
					{initialsFor(name)}
				</span>
				<span className="min-w-0 truncate text-[14px] font-medium text-ink">
					{name}
				</span>
			</div>
			<div className="flex items-center justify-between gap-3 border-t border-hairline px-3 py-2.5">
				<div>
					<p className="text-meta-sm text-ink-dim">
						{t("ui.community.join.preview.name_avatar")}
					</p>
					<p className="text-[13px] text-ink">
						{t("ui.community.join.preview.always_shown")}
					</p>
				</div>
				<Lock size={13} aria-hidden="true" className="text-ink-dim" />
			</div>
			<p className="border-t border-hairline px-3 py-2.5 text-meta-sm text-ink-muted">
				{t("ui.community.join.preview.pending_note")}
			</p>
			<p className="border-t border-hairline px-3 py-2.5 text-meta-sm text-ink-muted">
				{t("ui.community.join.preview.not_shown")}
			</p>
		</div>
	);
};

/**
 * The dialog with its reads: the bootstrap (current guidelines, read while
 * open) and the join write. `onJoined` hands the community id back so the page
 * can select it in the switcher and open #welcome-and-rules (RFC §5.2).
 */
export const CommunityJoinDialog: FC<{
	communityId: string | null;
	open: boolean;
	onClose: () => void;
	selfName: string | null;
	onJoined: (communityId: string) => void;
	/** An existing member accepting changed guidelines (D7). */
	reaccept?: boolean;
}> = ({ communityId, open, onClose, selfName, onJoined, reaccept = false }) => {
	const bootstrap = useCommunityBootstrap(open ? communityId : null);
	const join = useJoinCommunity();
	const [error, setError] = useState<CommunityJoinError | null>(null);
	useEffect(() => {
		if (!open) setError(null);
	}, [open]);
	return (
		<CommunityJoinDialogView
			open={open}
			onClose={onClose}
			bootstrap={bootstrap.isError ? null : bootstrap.data}
			onRetryLoad={() => void bootstrap.refetch()}
			selfName={selfName}
			mode={reaccept ? "reaccept" : "join"}
			joining={join.isPending}
			error={error}
			onJoin={(guidelinesVersion) => {
				if (!communityId) return;
				setError(null);
				join.mutate(
					{ communityId, guidelinesVersion },
					{
						onSuccess: () => onJoined(communityId),
						onError: (cause) => {
							const failure = communityFailure(cause);
							if (failure.kind === "guidelines_changed") {
								// Re-read the guidelines the reader must accept now.
								void bootstrap.refetch();
								setError({ kind: "guidelines_changed" });
							} else if (failure.kind === "rate_limited")
								setError({
									kind: "rate_limited",
									seconds: failure.retryAfterS,
								});
							else setError({ kind: "error" });
						},
					},
				);
			}}
		/>
	);
};
