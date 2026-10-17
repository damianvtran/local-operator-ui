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
import { Bot, MessageSquare, X } from "lucide-react";
import { useId, useRef } from "react";
import type { AgentMessagesRefusal } from "../../../../shared/agent-messages-contract";

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
	const close = () => {
		if (!pending) onDismiss();
	};
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
				onEscapeKeyDown={(event) => {
					if (pending) event.preventDefault();
				}}
				onPointerDownOutside={(event) => {
					if (pending) event.preventDefault();
				}}
			>
				<Button
					variant="ghost"
					size="icon-sm"
					className={cn("absolute top-4 right-4")}
					aria-label={t("ui.agentMessages.dialog.close")}
					disabled={pending}
					onClick={close}
				>
					<X aria-hidden="true" />
				</Button>
				{/* Decorative, static in every motion preference. The graphic gives up
				    ALL its height before consent or buttons can leave the fit region. */}
				<div
					aria-hidden="true"
					data-agent-messages-graphic=""
					className={cn(
						"flex h-[clamp(0px,calc(100dvh-740px),64px)] shrink-0 items-center justify-center gap-5 overflow-hidden text-ink-dim",
					)}
				>
					<Bot size={40} />
					<MessageSquare size={24} />
					<Bot size={40} />
				</div>
				<DialogTitle className={cn("pr-8")}>
					{t("ui.agentMessages.dialog.title")}
				</DialogTitle>
				<DialogDescription id={leadId}>
					{t("ui.agentMessages.dialog.lead")}
				</DialogDescription>
				<div className={cn("space-y-2 text-body-sm text-ink-muted")}>
					<p>{t("ui.agentMessages.dialog.activities")}</p>
					<p>{t("ui.agentMessages.dialog.reach")}</p>
				</div>
				{refusal && (
					<div role="alert" className={cn("text-body-sm text-ink")}>
						<p>{refusal.message}</p>
						{confirmed && <p>{t("ui.agentMessages.dialog.local_failure")}</p>}
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
					className={cn("whitespace-pre-wrap text-body-sm text-ink")}
				>
					{consent?.text ?? t("ui.agentMessages.dialog.consent_unavailable")}
				</p>
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
					<Button
						ref={notNow}
						variant="secondary"
						onClick={close}
						disabled={pending}
					>
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
