/**
 * The agent's profile picture, edited as one row of its General fields.
 *
 * WHY IT IS HERE, ABOVE THE NAME. The picture is the one field on this pane
 * that is not the agent's definition: it is a mark this machine draws, keyed by
 * the agent's id. It sits first because that is where the sidebar shows it and
 * the row is answering "which agent am I editing".
 *
 * WHAT IT DOES NOT CLAIM. The image is stored on this computer only (see
 * `shared/store/agent-avatar-store.ts` for the seam and its limits), so the
 * hint under the controls says so rather than leaving a user to discover it on
 * their second machine.
 *
 * THE TWO REFUSALS THE BRIEF ASKS FOR LIVE IN THE PICKER, not in a toast: a
 * file that is the wrong type, too large, or undecodable leaves the row exactly
 * where it was and states what happened beside the buttons. A toast for a file
 * the user just chose would also disappear before they re-pick.
 */

import {
	AGENT_AVATAR_ACCEPT,
	AGENT_AVATAR_MAX_BYTES,
	type AgentAvatarRefusal,
} from "@shared/agent-avatar/avatar-image";
import {
	AgentAvatarError,
	downscaleAgentAvatar,
} from "@shared/agent-avatar/downscale-image";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
	Button,
	Label,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import {
	clearAgentAvatar,
	setAgentAvatar,
	useAgentAvatar,
} from "@shared/store/agent-avatar-store";
import { Bot, Upload } from "lucide-react";
import { type ChangeEvent, type FC, useId, useRef, useState } from "react";

type AgentAvatarFieldProps = {
	/** The agent whose picture is being edited. */
	agentId: string;
	className?: string;
};

const MEGABYTES = Math.round(AGENT_AVATAR_MAX_BYTES / (1024 * 1024));

const refusalCopy = (refusal: AgentAvatarRefusal): string => {
	switch (refusal) {
		case "type":
			return t("ui.agents.settings.general.profile_picture_error_type");
		case "size":
			return t("ui.agents.settings.general.profile_picture_error_size", {
				size: String(MEGABYTES),
			});
		default:
			return t("ui.agents.settings.general.profile_picture_error_decode");
	}
};

export const AgentAvatarField: FC<AgentAvatarFieldProps> = ({
	agentId,
	className,
}) => {
	// Refresh translated copy without discarding a pending picker or error.
	useI18nLocale();
	const avatar = useAgentAvatar(agentId);
	const inputRef = useRef<HTMLInputElement>(null);
	const inputId = useId();
	const [busy, setBusy] = useState(false);
	const [refusal, setRefusal] = useState<AgentAvatarRefusal | null>(null);

	const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		// The same file must be re-pickable after a refusal, so the input is
		// cleared before anything can return early.
		event.target.value = "";
		if (!file) return;
		setBusy(true);
		setRefusal(null);
		try {
			const dataUrl = await downscaleAgentAvatar(file);
			setAgentAvatar(agentId, dataUrl);
		} catch (error) {
			setRefusal(error instanceof AgentAvatarError ? error.code : "decode");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className={cn("flex flex-col gap-2", className)}>
			<Label htmlFor={inputId}>
				{t("ui.agents.settings.general.profile_picture")}
			</Label>
			<div className="flex flex-wrap items-center gap-3">
				{/*
				 * The preview wears the same pair the sidebar row does - the `sunken`
				 * plate and a `border-control` edge - because it is showing that row's
				 * mark, and an edge that appears in one place and not the other reads as
				 * two different objects.
				 */}
				<Avatar className="size-10 shrink-0">
					{avatar ? (
						<AvatarImage
							src={avatar}
							alt=""
							className="lo-avatar-arrival border border-control"
						/>
					) : null}
					<AvatarFallback className="border border-control bg-sunken">
						<Bot size={18} aria-hidden="true" />
					</AvatarFallback>
				</Avatar>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					disabled={busy}
					onClick={() => inputRef.current?.click()}
				>
					<Upload aria-hidden="true" />
					{t("ui.agents.settings.general.profile_picture_upload")}
				</Button>
				{avatar ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={busy}
						onClick={() => {
							clearAgentAvatar(agentId);
							setRefusal(null);
						}}
					>
						{t("ui.agents.settings.general.profile_picture_remove")}
					</Button>
				) : null}
			</div>
			<p className="text-ink-dim text-meta">
				{t("ui.agents.settings.general.profile_picture_hint")}
			</p>
			{refusal ? (
				<p className="text-danger text-meta" role="alert">
					{refusalCopy(refusal)}
				</p>
			) : null}
			{/*
			 * `hidden`, not `sr-only`: the visible door is the Upload button (and the
			 * label, which a native label still forwards to this input), so the file
			 * input must not also be a tab stop with nothing painted at it.
			 */}
			<input
				ref={inputRef}
				id={inputId}
				type="file"
				accept={AGENT_AVATAR_ACCEPT}
				className="hidden"
				onChange={(event) => void onPick(event)}
			/>
		</div>
	);
};
