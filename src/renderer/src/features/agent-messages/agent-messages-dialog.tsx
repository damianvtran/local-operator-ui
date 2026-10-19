import { Button } from "@shared/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { AgentMessagesRefusal } from "../../../../shared/agent-messages-contract";

import { AgentMessagesHero } from "./agent-messages-hero";

export type AgentMessagesDialogProps = {
	consent: { version: string; text: string } | null;
	accountGuard: boolean;
	canEnable: boolean;
	pending: boolean;
	confirmed: boolean;
	refusal: AgentMessagesRefusal | null;
	onDismiss: () => void;
	onEnable: () => void;
};

export function AgentMessagesDialog({
	consent,
	accountGuard,
	canEnable,
	pending,
	confirmed,
	refusal,
	onDismiss,
	onEnable,
}: AgentMessagesDialogProps) {
	useI18nLocale();
	const leadId = useId();
	const consentId = useId();
	const notNow = useRef<HTMLButtonElement>(null);
	const error = useRef<HTMLDivElement>(null);
	// Keep feedback before the actions so initial autofocus cannot hide it below
	// them. Scrolled dialogs still need the outcome brought back into view.
	useEffect(() => {
		if (refusal) error.current?.scrollIntoView?.({ block: "nearest" });
	}, [refusal]);
	const close = () => onDismiss();
	const detail = refusal?.details;
	const field = typeof detail?.field === "string" ? detail.field : null;
	const rule = typeof detail?.rule === "string" ? detail.rule : null;

	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) close();
			}}
		>
			<DialogContent
				showClose={false}
				aria-describedby={consent ? `${leadId} ${consentId}` : leadId}
				className={cn(
					"max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-3xl gap-3 overflow-y-auto",
				)}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					notNow.current?.focus();
				}}
			>
				{/* Theme-native geometry is decorative; the served consent stays inert text. */}
				<div
					data-agent-messages-hero=""
					className={cn(
						"relative -mx-6 -mt-6 h-[clamp(160px,40dvh,295px)] shrink-0 overflow-hidden rounded-t-lg border-b border-hairline",
					)}
				>
					<AgentMessagesHero />
					<div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-transparent to-elevated" />
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					className={cn(
						"absolute top-4 right-4 size-8 border border-control bg-elevated text-ink shadow-sm hover:bg-accent-wash",
					)}
					aria-label={t("ui.agentMessages.dialog.close")}
					onClick={close}
				>
					<X aria-hidden="true" />
				</Button>
				<DialogTitle className={cn("mt-3 pr-8 text-title text-ink")}>
					{t("ui.agentMessages.dialog.title")}
				</DialogTitle>
				<DialogDescription id={leadId} className={cn("text-body text-ink")}>
					{t("ui.agentMessages.dialog.lead")}
				</DialogDescription>
				<div className={cn("space-y-2")}>
					<p className={cn("text-body text-ink-muted")}>
						{t("ui.agentMessages.dialog.activities")}
					</p>
					<p className={cn("text-body-sm text-ink-muted")}>
						{t("ui.agentMessages.dialog.reach")}
					</p>
				</div>
				{!accountGuard && (
					<output className={cn("block text-body-sm text-ink-muted")}>
						{t("ui.agentMessages.dialog.account_guard_unavailable")}
					</output>
				)}
				{/* Inert plain text, byte-for-byte served: no markdown, auto-link,
				    read-more, clipping or embedded-copy substitution at this seam. */}
				<p
					id={consentId}
					data-agent-messages-consent-version={consent?.version}
					className={cn("whitespace-pre-wrap text-meta text-ink-muted")}
				>
					{consent?.text ?? t("ui.agentMessages.dialog.consent_unavailable")}
				</p>
				{refusal && (
					<div
						ref={error}
						role="alert"
						data-agent-messages-error=""
						className={cn("space-y-1 text-body-sm text-ink")}
					>
						<p>
							{t(
								confirmed
									? "ui.agentMessages.dialog.local_failure"
									: "ui.agentMessages.dialog.failure",
							)}
						</p>
						<p className={cn("text-meta text-ink-muted")}>{refusal.message}</p>
						{refusal.code === "consent_version_unknown" && consent && (
							<p>{t("ui.agentMessages.dialog.consent_changed")}</p>
						)}
						{field && rule && (
							<>
								<p>{t("ui.agentMessages.dialog.validation_failure")}</p>
								{/* Raw identifiers are retained as SECONDARY diagnostics
								    (design D1): never the only detail. */}
								<p className={cn("text-meta text-ink-muted")}>
									{t("ui.agentMessages.dialog.validation_detail", {
										field,
										rule,
									})}
								</p>
							</>
						)}
					</div>
				)}
				<div className={cn("flex flex-wrap gap-2")}>
					<Button
						variant="primary"
						onClick={onEnable}
						disabled={!canEnable || pending}
						aria-busy={pending}
					>
						{t(
							pending
								? "ui.agentMessages.dialog.enabling"
								: "ui.agentMessages.dialog.enable",
						)}
					</Button>
					<Button ref={notNow} variant="secondary" onClick={close}>
						{t("ui.agentMessages.dialog.not_now")}
					</Button>
				</div>
				<p className={cn("text-meta text-ink-dim")}>
					{t("ui.agentMessages.dialog.later")}
				</p>
			</DialogContent>
		</Dialog>
	);
}
