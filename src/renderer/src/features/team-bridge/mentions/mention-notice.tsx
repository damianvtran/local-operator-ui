import { Button } from "@shared/components/ui/button";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { X } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
import type { MentionAutocomplete } from "./use-mention-autocomplete";

/**
 * "<Name> isn't in this conversation, so they won't be notified." above the
 * composer, Slack's notice.
 *
 * The hub refuses a WHOLE message whose `mentions[]` names anyone who is not an
 * active member (400 `mentions`), so a picked non-member or invited member is
 * already non-notifying text when this appears, and the sentence says so
 * (design D7). The choices only decide what happens next, never whether a
 * send fails:
 *  - Invite them: the existing add-members write (owner/admin rules are the
 *    hub's; a refusal is said in place and the notice stays). An invite is
 *    not membership, so the notice then says the mention will notify once
 *    they join, and the pill upgrades itself when a refetch shows them active.
 *  - Mention without notifying / Dismiss: keep the quiet pill.
 * A DM has no invite (fixed membership), and neither does someone already
 * invited or an agent row with no endpoint (`canInvite`).
 */
export const MentionNotice: FC<{ mentions: MentionAutocomplete }> = ({
	mentions,
}) => {
	useI18nLocale();
	const [state, setState] = useState<"idle" | "inviting" | "failed">("idle");
	const notice = mentions.notice;
	if (!notice) return null;
	const source = mentions.source;
	const onInvite =
		source?.conversationKind !== "dm" &&
		!notice.invited &&
		(source?.canInvite?.(notice.candidate) ?? false)
			? source?.onInvite
			: undefined;
	const name = notice.candidate.label;
	const sentence =
		state === "failed"
			? t("ui.teamBridge.mentions.notice.invite_failed", { name })
			: notice.invited
				? t("ui.teamBridge.mentions.notice.invited", { name })
				: notice.candidate.invited
					? t("ui.teamBridge.mentions.notice.pending", { name })
					: t("ui.teamBridge.mentions.notice.not_member", { name });
	return (
		<div
			// biome-ignore lint/a11y/useSemanticElements: `<output>` is a form result; this is a live notice with actions.
			role="status"
			data-mention-notice=""
			className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-warning-wash px-3 py-1.5 text-body-sm text-ink"
		>
			<span className="min-w-0 flex-1">{sentence}</span>
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
			{!notice.invited && (
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
			)}
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
