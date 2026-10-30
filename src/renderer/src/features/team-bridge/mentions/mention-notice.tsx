import { Button } from "@shared/components/ui/button";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { X } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
import type { MentionAutocomplete } from "./use-mention-autocomplete";

/**
 * "<Name> isn't in this conversation." above the composer, Slack's notice.
 *
 * The hub only wakes members, so a mention of someone outside the room would
 * read as sent and reach nobody. This makes the reader choose, and never
 * drops the mention behind their back:
 *  - Invite them: the existing add-members write (owner/admin rules are the
 *    hub's; a refusal is said in place and the notice stays).
 *  - Mention without notifying: the pill stays, styled as quiet text, and the
 *    token leaves `mentions[]`.
 *  - Dismiss: closes the notice; the mention is still sent as typed.
 * A DM has no invite (its membership is fixed), so only the second action is
 * offered there. A host that cannot invite passes no `onInvite`.
 */
export const MentionNotice: FC<{ mentions: MentionAutocomplete }> = ({
	mentions,
}) => {
	useI18nLocale();
	const [state, setState] = useState<"idle" | "inviting" | "failed">("idle");
	const notice = mentions.notice;
	if (!notice) return null;
	const onInvite =
		mentions.source?.conversationKind === "dm"
			? undefined
			: mentions.source?.onInvite;
	const name = notice.candidate.label;
	return (
		<div
			// biome-ignore lint/a11y/useSemanticElements: `<output>` is a form result; this is a live notice with actions.
			role="status"
			data-mention-notice=""
			className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-warning-wash px-3 py-1.5 text-body-sm text-ink"
		>
			<span className="min-w-0 flex-1">
				{state === "failed"
					? t("ui.teamBridge.mentions.notice.invite_failed", { name })
					: t("ui.teamBridge.mentions.notice.not_member", { name })}
			</span>
			{onInvite && (
				<Button
					variant="link"
					size="sm"
					className="h-7 px-1.5"
					disabled={state === "inviting"}
					onClick={() => {
						setState("inviting");
						void onInvite(notice.candidate).then(
							() => {
								setState("idle");
								mentions.resolveNotice();
							},
							() => setState("failed"),
						);
					}}
				>
					{t("ui.teamBridge.mentions.notice.invite")}
				</Button>
			)}
			<Button
				variant="link"
				size="sm"
				className="h-7 px-1.5"
				onClick={() => {
					setState("idle");
					mentions.silenceNotice();
				}}
			>
				{t("ui.teamBridge.mentions.notice.silent")}
			</Button>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={t("ui.common.actions.dismiss")}
				title={t("ui.common.actions.dismiss")}
				onClick={() => {
					setState("idle");
					mentions.dismissNotice();
				}}
			>
				<X size={14} aria-hidden="true" />
			</Button>
		</div>
	);
};
