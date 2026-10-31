/**
 * An agent's profile picture editor, inline in its detail view on the Agents
 * page.
 *
 * WHY INLINE, NOT A DIALOG (operator's ask, after the Radient console's
 * `avatar-card.tsx`). The file pick, the crop and the live previews are one
 * task; a modal would hide the "what will this look like" answer at the moment
 * the person commits. The field swaps between three states in place - the
 * current picture with Upload or Replace/Remove, the cropper, and the save in
 * flight - and every other door to this editor (the pencil on a picture in the
 * chat header or sidebar, `AgentAvatarEditLink`) is a plain link here, so this
 * is the ONE place editing logic lives.
 *
 * WHERE THE PICTURE GOES. Core owns it (`PUT /v1/agents/{id}/avatar`, through
 * `shared/agent-avatar/agent-avatar.ts`), so the hint says it follows the
 * agent on this machine rather than #1517's "this computer only" caveat.
 *
 * REFUSALS ARE STATED HERE, not in a toast. A file that is the wrong type, too
 * large, too many pixels or undecodable leaves the field where it was and says
 * which; a failed upload keeps the cropper open with its framing, so a retry is
 * one press. A toast would vanish before the person re-picks.
 *
 * THE DEEP LINK (`?edit=picture`). `focusRequest` changes when the page is
 * opened with that parameter: the field scrolls itself into view and focuses
 * its first control, so a pencil pressed in the chat sidebar lands on the
 * control that answers it rather than at the top of a long pane.
 */

import {
	clearAgentAvatar,
	setAgentAvatar,
} from "@shared/agent-avatar/agent-avatar";
import { AgentMark } from "@shared/agent-avatar/agent-mark";
import {
	AGENT_AVATAR_ACCEPT,
	AGENT_AVATAR_MAX_BYTES,
	type AgentAvatarRefusal,
} from "@shared/agent-avatar/avatar-image";
import {
	AgentAvatarError,
	decodeAgentAvatar,
} from "@shared/agent-avatar/decode-image";
import { Button, Label } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Bot, ImagePlus, Trash2 } from "lucide-react";
import {
	type ChangeEvent,
	type FC,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { AgentAvatarCropper, type CropSource } from "./agent-avatar-cropper";

type AgentAvatarFieldProps = {
	/** The agent whose picture is being edited. */
	agentId: string;
	/**
	 * Changes to ask the field to scroll into view and take focus (a test seam;
	 * the shipped trigger is the `?edit=picture` deep link below).
	 */
	focusRequest?: number;
	className?: string;
	/**
	 * Story seams: a source already decoded (the cropper state without a file
	 * pick) and a picture URL (the uploaded state without a backend).
	 */
	initialSource?: CropSource | null;
	pictureSrc?: string | null;
};

/** The DOM id the `?edit=picture` link scrolls to. */
export const AGENT_AVATAR_FIELD_ANCHOR = "agent-picture";

const MEGABYTES = Math.round(AGENT_AVATAR_MAX_BYTES / (1024 * 1024));

const refusalCopy = (refusal: AgentAvatarRefusal): string => {
	switch (refusal) {
		case "type":
			return t("ui.agents.avatar.editor.error_type");
		case "size":
			return t("ui.agents.avatar.editor.error_size", {
				size: String(MEGABYTES),
			});
		default:
			return t("ui.agents.avatar.editor.error_decode");
	}
};

export const AgentAvatarField: FC<AgentAvatarFieldProps> = ({
	agentId,
	focusRequest,
	className,
	initialSource = null,
	pictureSrc,
}) => {
	// Refresh translated copy without discarding a pending crop or error.
	useI18nLocale();
	const rootRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const uploadRef = useRef<HTMLButtonElement>(null);
	const cropRef = useRef<HTMLCanvasElement | null>(null);
	const inputId = useId();
	const labelId = useId();
	const hintId = useId();
	const [source, setSource] = useState<CropSource | null>(initialSource);
	const [decoding, setDecoding] = useState(false);
	const [saving, setSaving] = useState(false);
	const [removing, setRemoving] = useState(false);
	const [refusal, setRefusal] = useState<AgentAvatarRefusal | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [removeError, setRemoveError] = useState<string | null>(null);
	// Whether a picture is on screen now: the mark answers `null` until loaded.
	const [hasPicture, setHasPicture] = useState(Boolean(pictureSrc));

	/*
	 * A decoded bitmap holds the whole source in renderer memory; it is closed
	 * as soon as the cropper lets go of it (saved, cancelled, replaced or the
	 * field unmounted), never left for the collector.
	 */
	useEffect(
		() => () => {
			if (source && "close" in source && typeof source.close === "function")
				source.close();
		},
		[source],
	);

	const [params, setParams] = useSearchParams();
	/*
	 * THE DEEP LINK (`?edit=picture`). The pencil on a picture in the chat header
	 * or a sidebar row navigates here with it; this is the one place that knows
	 * what the instruction means, and it is one-shot - the parameter is dropped
	 * from the URL after the field takes focus, so a later visit (or a Back) does
	 * not steal the reader's attention again.
	 *
	 * The parameter is only honoured for the agent whose pane is open, because
	 * that is the agent whose field is mounted. The URL's `name` chooses the pane;
	 * this component cannot re-point it.
	 */
	const requested = params.get("edit") === "picture";
	useEffect(() => {
		if (!requested) return;
		rootRef.current?.scrollIntoView({ block: "center" });
		(cropRef.current ?? uploadRef.current)?.focus({ preventScroll: true });
		const next = new URLSearchParams(params);
		next.delete("edit");
		setParams(next, { replace: true });
	}, [requested, params, setParams]);
	useEffect(() => {
		if (focusRequest === undefined) return;
		rootRef.current?.scrollIntoView({ block: "center" });
		(cropRef.current ?? uploadRef.current)?.focus({ preventScroll: true });
	}, [focusRequest]);

	const busy = decoding || saving || removing;

	const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		// The same file must be re-pickable after a refusal.
		event.target.value = "";
		if (!file) return;
		setDecoding(true);
		setRefusal(null);
		setSaveError(null);
		setRemoveError(null);
		try {
			setSource(await decodeAgentAvatar(file));
		} catch (error) {
			setRefusal(error instanceof AgentAvatarError ? error.code : "decode");
		} finally {
			setDecoding(false);
		}
	};

	const onSave = async (blob: Blob) => {
		setSaving(true);
		setSaveError(null);
		try {
			await setAgentAvatar(agentId, blob);
			setSource(null);
			setHasPicture(true);
			// The cropper unmounts with the focused Save; land on the field's door.
			requestAnimationFrame(() => uploadRef.current?.focus());
		} catch (error) {
			setSaveError(
				error instanceof Error && error.message
					? error.message
					: t("ui.agents.avatar.editor.error_save"),
			);
		} finally {
			setSaving(false);
		}
	};

	const onRemove = async () => {
		if (busy) return;
		setRemoving(true);
		setRemoveError(null);
		setRefusal(null);
		try {
			await clearAgentAvatar(agentId);
			setHasPicture(false);
		} catch (error) {
			setRemoveError(
				error instanceof Error && error.message
					? error.message
					: t("ui.agents.avatar.editor.error_remove"),
			);
		} finally {
			setRemoving(false);
			/*
			 * REMOVE TAKES ITSELF AWAY: it renders only while a picture exists, so
			 * focus moves to the field's surviving door (#1517's R1-3).
			 */
			uploadRef.current?.focus();
		}
	};

	return (
		<div
			ref={rootRef}
			id={AGENT_AVATAR_FIELD_ANCHOR}
			className={cn("flex scroll-mt-4 flex-col gap-2", className)}
			data-agent-avatar-field=""
		>
			<Label id={labelId} htmlFor={inputId}>
				{t("ui.agents.settings.general.profile_picture")}
			</Label>
			{source ? (
				<AgentAvatarCropper
					source={source}
					onSave={(blob) => void onSave(blob)}
					onCancel={() => {
						setSource(null);
						setSaveError(null);
						requestAnimationFrame(() => uploadRef.current?.focus());
					}}
					saving={saving}
					error={saveError}
					viewportRef={cropRef}
				/>
			) : (
				/*
				 * A GROUP NAMED BY THE LABEL (#1517's UX round 1, U5): the label points
				 * at a hidden file input, so the fieldset is what names the buttons.
				 */
				<fieldset
					aria-labelledby={labelId}
					aria-describedby={hintId}
					className="m-0 flex min-w-0 flex-wrap items-center gap-3 border-0 p-0"
				>
					<PictureProbe
						agentId={agentId}
						src={pictureSrc}
						onPresence={setHasPicture}
					/>
					<Button
						ref={uploadRef}
						type="button"
						variant="secondary"
						size="sm"
						// `aria-disabled`, not `disabled`, so focus survives a decode.
						aria-disabled={busy}
						className="aria-disabled:text-ink-disabled!"
						data-agent-avatar-upload=""
						onClick={() => {
							if (busy) return;
							inputRef.current?.click();
						}}
					>
						<ImagePlus aria-hidden="true" />
						{/* ONE VOCABULARY PER OBJECT (design review round 1, D5): this editor says
						    "picture" everywhere - the field's label, Replace, Save, Recenter and
						    the pencil's name - so Upload and Remove say it too, rather than
						    borrowing the settings surface's "image" and leaving one glance with
						    two names for one thing. */}
						{hasPicture
							? t("ui.agents.avatar.editor.replace")
							: t("ui.agents.avatar.editor.upload")}
					</Button>
					{hasPicture ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							aria-disabled={busy}
							className="aria-disabled:text-ink-disabled!"
							onClick={() => void onRemove()}
						>
							<Trash2 aria-hidden="true" />
							{t("ui.agents.avatar.editor.remove")}
						</Button>
					) : null}
				</fieldset>
			)}
			<p id={hintId} className="text-ink-dim text-meta">
				{t("ui.agents.avatar.editor.hint")}
			</p>
			{refusal ? (
				<p className="text-danger text-meta" role="alert">
					{refusalCopy(refusal)}
				</p>
			) : null}
			{removeError ? (
				<p className="text-danger text-meta" role="alert">
					{removeError}
				</p>
			) : null}
			{/* `hidden`: the Upload button is the visible door, not this input. */}
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

/**
 * The current picture at the roster's 40px, reporting whether one is shown so
 * the field can label its door Upload or Replace and offer Remove.
 */
function PictureProbe({
	agentId,
	src,
	onPresence,
}: {
	agentId: string;
	src?: string | null;
	onPresence: (present: boolean) => void;
}) {
	return (
		<AgentMark
			agentId={agentId}
			src={src}
			className="size-10"
			fallback={
				<span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-control bg-sunken text-ink-dim">
					<Bot size={18} aria-hidden="true" />
				</span>
			}
			onPresence={onPresence}
		/>
	);
}
