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
 *
 * AND A THIRD ANSWER FOR A WRITE THE BROWSER REFUSED (review round 1, R1-1).
 * A full or blocked `localStorage` accepts nothing, while the picture itself is
 * already in memory: the file was read, so the read sentences are all false.
 * The store reports that separately and this row has its own sentence for it,
 * so what the user is told matches what happened and what to do next.
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
	const uploadRef = useRef<HTMLButtonElement>(null);
	const inputId = useId();
	const labelId = useId();
	const hintId = useId();
	const [busy, setBusy] = useState(false);
	const [refusal, setRefusal] = useState<AgentAvatarRefusal | null>(null);
	const [saveFailed, setSaveFailed] = useState(false);

	const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		// The same file must be re-pickable after a refusal, so the input is
		// cleared before anything can return early.
		event.target.value = "";
		if (!file) return;
		setBusy(true);
		setRefusal(null);
		setSaveFailed(false);
		try {
			const dataUrl = await downscaleAgentAvatar(file);
			/*
			 * THE READ AND THE WRITE ARE DIFFERENT ANSWERS. The picture is already in
			 * memory when a browser refuses the write, so calling that "could not be
			 * read" would describe a file that decoded fine; `setAgentAvatar` answers
			 * whether the bytes reached this machine's storage (review round 1, R1-1).
			 */
			setSaveFailed(!setAgentAvatar(agentId, dataUrl));
		} catch (error) {
			setRefusal(error instanceof AgentAvatarError ? error.code : "decode");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className={cn("flex flex-col gap-2", className)}>
			<Label id={labelId} htmlFor={inputId}>
				{t("ui.agents.settings.general.profile_picture")}
			</Label>
			{/*
			 * A GROUP NAMED BY THE LABEL (UX round 1, U5). The label points at the file
			 * input, which is `display: none` and absent from the accessibility tree, so
			 * on its own it named nothing reachable and a forms-mode reader heard bare
			 * "Upload image". The group says which field these two buttons belong to,
			 * and the hint is attached to the same group so the storage limit is read
			 * once with it.
			 *
			 * A `<fieldset>` rather than a `role="group"` div: it is the element the role
			 * stands for (the a11y lint says so), and the reset classes take away the
			 * browser's border and padding so it paints as the flex row it replaces.
			 */}
			<fieldset
				aria-labelledby={labelId}
				aria-describedby={hintId}
				className="m-0 flex min-w-0 flex-wrap items-center gap-3 border-0 p-0"
			>
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
					ref={uploadRef}
					type="button"
					variant="secondary"
					size="sm"
					/*
					 * `aria-disabled`, NOT `disabled` (review round 1, R1-3). The picker's
					 * return starts a decode on the button the user pressed, and the disabled
					 * attribute drops that focus to `<body>` mid-flow; the click guard below
					 * is what makes the state real, so the affordance and the behaviour agree.
					 */
					aria-disabled={busy}
					onClick={() => {
						if (busy) return;
						inputRef.current?.click();
					}}
				>
					<Upload aria-hidden="true" />
					{t("ui.agents.settings.general.profile_picture_upload")}
				</Button>
				{avatar ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						aria-disabled={busy}
						onClick={() => {
							if (busy) return;
							setSaveFailed(!clearAgentAvatar(agentId));
							setRefusal(null);
							/*
							 * REMOVE TAKES ITSELF AWAY: the button renders only while a picture
							 * exists, so pressing it unmounts the focused control. Focus moves to
							 * the Upload button, which is the same field's surviving door, rather
							 * than falling back to `<body>` (review round 1, R1-3).
							 */
							uploadRef.current?.focus();
						}}
					>
						{t("ui.agents.settings.general.profile_picture_remove")}
					</Button>
				) : null}
			</fieldset>
			<p id={hintId} className="text-ink-dim text-meta">
				{t("ui.agents.settings.general.profile_picture_hint")}
			</p>
			{refusal ? (
				<p className="text-danger text-meta" role="alert">
					{refusalCopy(refusal)}
				</p>
			) : null}
			{saveFailed ? (
				<p className="text-danger text-meta" role="alert">
					{t("ui.agents.settings.general.profile_picture_error_save")}
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
