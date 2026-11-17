/**
 * The local-model panel's status and next steps, presentational.
 *
 * `LocalProviderReachability` (provider-detail.tsx) owns the probe; this file
 * paints one `LocalDiagnosis` (see `local-provider-diagnosis.ts` for what each
 * kind means and how it is derived). Split out so Storybook and the focused
 * test render every state without a backend.
 *
 * Layout rules, so the panel stays one column the reader scans top-down:
 * the verdict line, the cause's steps (a link and/or a copyable command), the
 * "Check again" control with its receipt beside it, then the hosted way out
 * below a hairline. The receipt sits next to the control it answers, so a
 * press always changes text right where the pointer is.
 */

import { CopyButton } from "@shared/components/common/copy-button";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui";
import { formatTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { openConsolePage } from "@shared/utils/radient-account-copy";
import { Check, ExternalLink } from "lucide-react";
import type { FC, ReactNode } from "react";
import type { DesktopProvider } from "../../../../shared/desktop-contract";
import {
	LOCAL_DOWNLOAD_URLS,
	type LocalDiagnosis,
	OLLAMA_RECOMMENDED_MODEL,
} from "./local-provider-diagnosis";
import { brandOf } from "./provider-catalog";

/*
 * Seconds on purpose: two presses inside one minute must paint different
 * receipts, or the second press reads as one that did nothing.
 */
const CLOCK_WITH_SECONDS: Intl.DateTimeFormatOptions = {
	hour: "numeric",
	minute: "2-digit",
	second: "2-digit",
};

/** A command the reader runs in their own terminal, with its copy control. */
const CommandRow: FC<{ command: string }> = ({ command }) => {
	useI18nLocale();
	return (
		<div
			data-local-command=""
			className="flex w-full items-center gap-2 rounded-sm bg-sunken px-2 py-1"
		>
			<code className="min-w-0 flex-1 truncate font-mono text-body-sm text-ink">
				{command}
			</code>
			<CopyButton value={command} label={t("ui.recovery.local.copy")} />
		</div>
	);
};

const Steps: FC<{ children: ReactNode }> = ({ children }) => (
	<div className="flex w-full flex-col items-start gap-2">{children}</div>
);

/*
 * The private-use slot the address is passed to `t()` as, so the sentence can be
 * split around it and the address set in code type (design round 1, D6) without
 * a rich-text mechanism the catalogue does not have. Same pattern as
 * `agent-messages-screening-model.tsx`'s `MODEL_SLOT`.
 */
const ADDRESS_SLOT = "\uE000";

/** A sentence with `{address}` rendered as code, so a copy never takes the full stop. */
const WithAddress: FC<{ text: string; address: string }> = ({
	text,
	address,
}) => {
	const [before, after = ""] = text.split(ADDRESS_SLOT);
	return (
		<>
			{before}
			<code data-local-address="" className="font-mono">
				{address}
			</code>
			{after}
		</>
	);
};

/**
 * The muted in-flight label of a control whose label IS the press's status
 * (design round 1, D1): body ink (8.37:1) rather than the disabled palette
 * (2.65:1). The press is refused with `aria-disabled` and an early return.
 */
const BUSY_CONTROL = "cursor-progress text-ink-muted";

export const LocalProviderStatusView: FC<{
	provider: Pick<DesktopProvider, "id" | "name" | "base_url" | "brand">;
	/** `null` while the first check is in flight. */
	diagnosis: LocalDiagnosis | null;
	testing: boolean;
	checkedAt: number | null;
	/** Consecutive checks that did not find a ready server. */
	failedChecks: number;
	onCheckAgain: () => void;
	onUseHosted?: () => void;
	/**
	 * The model chats already use on THIS runtime (the configured default is this
	 * provider), or null. Set, the ready state states it instead of offering the
	 * use action.
	 */
	inUse?: string | null;
	/** Makes this runtime the default for chats (U1); absent where it cannot. */
	onUseForChats?: () => void;
	using?: boolean;
	useError?: string | null;
	/** The flow's next step once chats use this runtime (`Continue` in a dialog). */
	onContinue?: () => void;
	continueLabel?: string;
}> = ({
	provider,
	diagnosis,
	testing,
	checkedAt,
	failedChecks,
	onCheckAgain,
	onUseHosted,
	inUse = null,
	onUseForChats,
	using = false,
	useError = null,
	onContinue,
	continueLabel,
}) => {
	useI18nLocale();
	const brand = brandOf(provider);
	const address = provider.base_url ?? "";
	const isOllama = provider.id === "ollama";
	const download = LOCAL_DOWNLOAD_URLS[provider.id];
	const time =
		checkedAt === null ? null : formatTime(checkedAt, CLOCK_WITH_SECONDS);

	let verdict: ReactNode;
	let steps: ReactNode = null;
	if (diagnosis === null) {
		verdict = (
			<p className="flex items-center gap-2 text-body-sm text-ink-muted">
				<Spinner size="sm" />
				{t("ui.recovery.local.checking", { brand })}
			</p>
		);
	} else if (diagnosis.kind === "ready") {
		verdict = (
			<p className="text-body-sm text-success">
				{diagnosis.models === null
					? t("ui.recovery.local.running", { brand })
					: t("ui.recovery.local.running_with_models", {
							brand,
							count: diagnosis.models,
						})}
			</p>
		);
		/*
		 * U1: a ready runtime is ONE press from a working chat. Without this the
		 * state's only control was Check again, and the replays pressed it dozens
		 * of times with Ollama serving the model they had picked.
		 */
		const useAction =
			inUse !== null ? (
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
					<p
						data-local-in-use=""
						className="flex items-center gap-1 text-body-sm text-success"
					>
						<Check aria-hidden="true" className="size-3.5 shrink-0" />
						{t("ui.recovery.local.in_use", { brand, model: inUse })}
					</p>
					{onContinue && continueLabel ? (
						<Button variant="primary" size="sm" onClick={onContinue}>
							{continueLabel}
						</Button>
					) : null}
				</div>
			) : onUseForChats && diagnosis.firstModel ? (
				<div className="flex flex-col items-start gap-1">
					<Button
						variant="primary"
						size="sm"
						data-local-use-for-chats=""
						aria-disabled={using || undefined}
						aria-busy={using || undefined}
						className={using ? BUSY_CONTROL : undefined}
						onClick={() => {
							if (!using) onUseForChats();
						}}
					>
						{using
							? t("ui.recovery.local.using_for_chats", { brand })
							: t("ui.recovery.local.use_for_chats", { brand })}
					</Button>
					{useError ? (
						<output className="text-body-sm text-danger">
							{t("ui.recovery.send.use_local_failed", { brand })}
						</output>
					) : null}
				</div>
			) : null;
		steps =
			diagnosis.emptyListing || useAction ? (
				<Steps>
					{diagnosis.emptyListing ? (
						<>
							<p className="text-body-sm text-ink-muted">
								{isOllama
									? t("ui.recovery.local.empty_listing_ollama")
									: t("ui.recovery.local.empty_listing_other", { brand })}
							</p>
							{isOllama ? (
								<CommandRow
									command={`ollama pull ${OLLAMA_RECOMMENDED_MODEL}`}
								/>
							) : null}
						</>
					) : null}
					{useAction}
				</Steps>
			) : null;
	} else if (diagnosis.kind === "not_running") {
		verdict = (
			<p className="font-medium text-body-sm text-ink">
				{t("ui.recovery.local.not_running_title", { brand })}
			</p>
		);
		steps = (
			<Steps>
				<p className="text-body-sm text-ink-muted">
					<WithAddress
						address={address}
						text={t("ui.recovery.local.not_running_body", {
							brand,
							address: ADDRESS_SLOT,
						})}
					/>
				</p>
				{download ? (
					<Button
						variant="secondary"
						size="sm"
						data-local-download=""
						onClick={() => openConsolePage(download)}
					>
						<ExternalLink aria-hidden="true" />
						{t("ui.recovery.local.download", { brand })}
					</Button>
				) : null}
				{isOllama ? (
					<>
						<p className="text-body-sm text-ink-muted">
							{t("ui.recovery.local.start_ollama")}
						</p>
						<CommandRow command="ollama serve" />
					</>
				) : null}
			</Steps>
		);
	} else if (diagnosis.kind === "no_address") {
		verdict = (
			<p className="font-medium text-body-sm text-ink">
				{t("ui.recovery.local.no_address_title", { brand })}
			</p>
		);
		steps = (
			<p className="text-body-sm text-ink-muted">
				{t("ui.recovery.local.no_address_body")}
			</p>
		);
	} else if (diagnosis.kind === "check_failed") {
		verdict = (
			<p className="font-medium text-body-sm text-ink">
				{t("ui.recovery.local.check_failed_title", { brand })}
			</p>
		);
		steps = (
			<p className="text-body-sm text-ink-muted">
				{t("ui.recovery.local.check_failed_body", { brand })}
			</p>
		);
	} else {
		verdict = (
			<p className="font-medium text-body-sm text-ink">
				{diagnosis.status === null ? (
					<WithAddress
						address={address}
						text={t("ui.recovery.local.no_answer_title", {
							address: ADDRESS_SLOT,
						})}
					/>
				) : (
					t("ui.recovery.local.wrong_server_title", {
						address,
						brand,
						status: String(diagnosis.status),
					})
				)}
			</p>
		);
		steps = (
			<p className="text-body-sm text-ink-muted">
				{diagnosis.status === null
					? t("ui.recovery.local.no_answer_body", { brand })
					: t("ui.recovery.local.wrong_server_body", { brand })}
			</p>
		);
	}

	const failing = diagnosis !== null && diagnosis.kind !== "ready";
	/*
	 * THE REPEAT RECEIPT NAMES WHAT REPEATED (design round 1, D2; review N2).
	 * "Still not found" only where nothing was found; where something answered
	 * (the wrong program, a refused check, no address to try) the press found the
	 * same thing again, and saying "not found" contradicted the verdict above.
	 */
	const nothingFound =
		diagnosis?.kind === "not_running" ||
		(diagnosis?.kind === "wrong_address" && diagnosis.status === null);
	const receipt =
		time === null || testing
			? null
			: !failing || failedChecks <= 1
				? t("ui.recovery.local.checked_at", { time })
				: nothingFound
					? t("ui.recovery.local.still_not_found", { time })
					: t("ui.recovery.local.same_result", { time });
	return (
		<div
			data-local-status={diagnosis?.kind ?? "checking"}
			className="flex flex-col items-start gap-3"
		>
			{verdict}
			{steps}
			{/*
			 * ONE SPINNER PER ACTION (design round 1, D8): the first check's spinner
			 * is the verdict line's, so the control row waits for an answer rather
			 * than showing a second one directly under it.
			 */}
			{diagnosis !== null ? (
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
					<Button
						variant="secondary"
						size="sm"
						onClick={() => {
							if (!testing) onCheckAgain();
						}}
						aria-disabled={testing || undefined}
						aria-busy={testing || undefined}
						className={testing ? BUSY_CONTROL : undefined}
						data-local-check-again=""
					>
						{testing ? <Spinner size="sm" /> : null}
						{testing
							? t("ui.providers.provider_detail.checking")
							: t("ui.providers.provider_detail.check_again")}
					</Button>
					{/*
					 * THE RECEIPT (D1): every finished check restamps it, so a press that
					 * finds the same state still changes visible text. `<output>` is a
					 * status role, so a screen reader hears each result once.
					 */}
					<output
						data-local-checked-at=""
						className="text-meta text-ink-dim tabular-nums"
					>
						{receipt}
					</output>
				</div>
			) : null}
			{failing && onUseHosted ? (
				<div
					data-local-alternative=""
					className="flex w-full flex-col items-start gap-2 border-hairline border-t pt-3"
				>
					<p className="text-body-sm text-ink-muted">
						{t("ui.recovery.local.alternative_body")}
					</p>
					<Button variant="primary" size="sm" onClick={onUseHosted}>
						{t("ui.recovery.local.use_radient")}
					</Button>
				</div>
			) : null}
		</div>
	);
};
