/**
 * Team Bridge image attachments: the composer strip and the message's images.
 *
 * TWO SURFACES, ONE RULE. Pictures in a message come ONLY from the structured
 * `message.attachments[]` list, fetched through main's bearer relay
 * (`TeamBridgeApi.attachmentBytes` → `team_bridge.attachment`) into the shared
 * refcounted `blob-url-cache`. Nothing here reads the body, and the Markdown
 * `img` renderer stays alt-only (`team-bridge-markdown.tsx`): a teammate's text
 * can never make the reader's app fetch an address, while an image the author
 * attached is still shown - because it was screened into the message, not
 * pointed at by it.
 *
 * Fail closed: only an absent/`bound` state is fetched (`attachmentView`).
 * `expired` says "Image expired"; every other state says "Image unavailable"
 * and makes no request. A fetch that fails is the same "unavailable" receipt,
 * with a retry, because the commonest cause is a transient relay error.
 *
 * Bytes are never logged and no element carries the attachment's id, digest
 * or filename as text (D9). Alt text is a positional label ("Image 2 of 4").
 */

import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import { ImageLightbox } from "@shared/components/common/image-lightbox";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import {
	createBlobUrl,
	peek,
	publish,
	release,
	retain,
	revokeBlobUrl,
} from "@shared/lib/blob-url-cache";
import { cn } from "@shared/lib/utils";
import {
	AlertCircle,
	Clock,
	ImageOff,
	ImagePlus,
	RotateCw,
	X,
} from "lucide-react";
import type { ClipboardEvent, DragEvent, FC } from "react";
import { useEffect, useRef, useState } from "react";
import type {
	TeamBridgeAttachment,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import { AttachmentFrame } from "../chat/components/message-item/attachment-frame";
import {
	type AttachmentFailure,
	attachmentView,
	imageFiles,
	uploadPreview,
} from "./team-bridge-attachments-model";
import type {
	AttachmentChip,
	TeamBridgeAttachmentsState,
} from "./use-team-bridge-attachments";

/* ------------------------------------------------------------------------- */
/* Composer                                                                   */
/* ------------------------------------------------------------------------- */

const failureCopy = (reason: AttachmentFailure | undefined): string => {
	switch (reason) {
		case "unsupported":
			return t("ui.teamBridge.attachments.error_type");
		case "too_large":
			return t("ui.teamBridge.attachments.error_size");
		case "invalid":
			return t("ui.teamBridge.attachments.error_invalid");
		case "rate_limited":
			return t("ui.teamBridge.attachments.error_rate");
		case "limit":
			return t("ui.teamBridge.attachments.error_quota");
		case "expired":
			return t("ui.teamBridge.attachments.expired_staged");
		case "offline":
			return t("ui.teamBridge.attachments.error_offline");
		default:
			return t("ui.teamBridge.attachments.error_upload");
	}
};

/**
 * One staged image. The chip is the picture itself at 64px, with its state
 * drawn over it; Remove is always available (a chip must never trap the
 * author), Retry only where bytes are still in memory to resend.
 */
export const TeamBridgeAttachmentChip: FC<{
	chip: AttachmentChip;
	index: number;
	count: number;
	onRemove: () => void;
	onRetry: () => void;
}> = ({ chip, index, count, onRemove, onRetry }) => {
	useI18nLocale();
	const label = t("ui.teamBridge.attachments.position", {
		index: String(index + 1),
		count: String(count),
	});
	const failed = chip.status === "error" || chip.status === "expired";
	const reason =
		chip.status === "expired"
			? t("ui.teamBridge.attachments.expired_staged")
			: failed
				? failureCopy(chip.reason)
				: chip.status === "uploading" || chip.status === "preparing"
					? t("ui.teamBridge.attachments.uploading")
					: null;
	return (
		<li
			className="group/chip relative"
			data-attachment-chip={chip.status}
			aria-label={reason ? `${label}. ${reason}` : label}
		>
			<div
				className={cn(
					"relative flex size-16 items-center justify-center overflow-hidden rounded-md border bg-sunken",
					failed ? "border-danger" : "border-hairline",
				)}
			>
				{chip.previewUrl ? (
					<img
						src={chip.previewUrl}
						alt=""
						className={cn(
							"size-full object-cover",
							chip.status === "ready" || chip.status === "held"
								? "opacity-100"
								: "opacity-50",
						)}
					/>
				) : (
					<ImageOff size={18} aria-hidden="true" className="text-ink-dim" />
				)}
				{(chip.status === "uploading" || chip.status === "preparing") && (
					<span className="absolute inset-0 flex items-center justify-center bg-canvas/40">
						<Spinner
							size="sm"
							label={t("ui.teamBridge.attachments.uploading")}
						/>
					</span>
				)}
				{failed && (
					<span
						aria-hidden="true"
						className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-canvas/80 py-0.5 text-danger"
					>
						{chip.status === "expired" ? (
							<Clock size={12} />
						) : (
							<AlertCircle size={12} />
						)}
					</span>
				)}
			</div>
			<button
				type="button"
				onClick={onRemove}
				aria-label={t("ui.teamBridge.attachments.remove", { label })}
				title={t("ui.teamBridge.attachments.remove", { label })}
				className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-control bg-elevated text-ink-muted hover:text-ink"
			>
				<X size={12} aria-hidden="true" />
			</button>
			{failed && chip.prepared && (
				<button
					type="button"
					onClick={onRetry}
					aria-label={t("ui.teamBridge.attachments.retry", { label })}
					title={t("ui.teamBridge.attachments.retry", { label })}
					className="absolute -bottom-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-control bg-elevated text-ink-muted hover:text-ink"
				>
					<RotateCw size={12} aria-hidden="true" />
				</button>
			)}
		</li>
	);
};

/**
 * The strip above the composer field, plus the one-line status under it (the
 * first failure's reason, or the capability notice). Renders nothing when
 * there is nothing to say, so a text-only composer is unchanged.
 */
export const TeamBridgeAttachmentStrip: FC<{
	state: TeamBridgeAttachmentsState;
}> = ({ state }) => {
	useI18nLocale();
	const firstFailure = state.chips.find(
		(chip) => chip.status === "error" || chip.status === "expired",
	);
	const notice =
		state.notice === "unsupported"
			? t("ui.teamBridge.attachments.unsupported")
			: state.notice === "limit"
				? t("ui.teamBridge.attachments.limit", { max: state.max })
				: firstFailure
					? firstFailure.status === "expired"
						? t("ui.teamBridge.attachments.expired_staged")
						: failureCopy(firstFailure.reason)
					: null;
	if (state.chips.length === 0 && !notice) return null;
	return (
		<div className="px-3 pt-3">
			{state.chips.length > 0 && (
				<ul
					aria-label={t("ui.teamBridge.attachments.strip")}
					className="flex flex-wrap gap-2.5"
				>
					{state.chips.map((chip, index) => (
						<TeamBridgeAttachmentChip
							key={chip.key}
							chip={chip}
							index={index}
							count={state.chips.length}
							onRemove={() => state.remove(chip.key)}
							onRetry={() => state.retry(chip.key)}
						/>
					))}
				</ul>
			)}
			{notice && (
				<p
					role={state.notice ? "status" : "alert"}
					className={cn(
						"pt-1.5 text-[12px]",
						state.notice ? "text-ink-muted" : "text-danger",
					)}
				>
					{notice}
				</p>
			)}
		</div>
	);
};

/**
 * The picker button. Hidden - not disabled - when the hub has no attachment
 * capability: a control that can never work is noise (the paste path still
 * explains itself with the unsupported note).
 */
export const TeamBridgeAttachButton: FC<{
	state: TeamBridgeAttachmentsState;
	disabled?: boolean;
}> = ({ state, disabled = false }) => {
	useI18nLocale();
	const input = useRef<HTMLInputElement>(null);
	if (!state.enabled) return null;
	const full = state.count >= state.max;
	return (
		<>
			<Button
				variant="ghost"
				size="icon"
				aria-label={t("ui.teamBridge.attachments.add")}
				title={
					full
						? t("ui.teamBridge.attachments.limit", { max: state.max })
						: t("ui.teamBridge.attachments.add")
				}
				disabled={disabled || full}
				onClick={() => input.current?.click()}
			>
				<ImagePlus size={16} aria-hidden="true" />
			</Button>
			<input
				ref={input}
				type="file"
				// A hint for the OS picker only; the bytes are sniffed regardless.
				accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif"
				multiple
				hidden
				tabIndex={-1}
				onChange={(event) => {
					state.add(Array.from(event.target.files ?? []));
					// Reset so picking the same file twice still fires a change.
					event.target.value = "";
				}}
			/>
		</>
	);
};

/* ------------------------------------------------------------------------- */
/* Message                                                                    */
/* ------------------------------------------------------------------------- */

type FetchState =
	| { state: "loading" }
	| { state: "ready"; url: string }
	| { state: "failed" };

/*
 * In-flight fetches by cache key, so N mounts of one picture (the timeline
 * and the thread pane both show a root) make one request - the same
 * discipline as `use-attachment-url.ts`, keyed here by
 * tenant/conversation/message/attachment because a bridge id is only
 * meaningful inside its conversation's member gate.
 */
const inflight = new Map<
	string,
	{ promise: Promise<boolean>; holders: number }
>();

function fetchInto(
	key: string,
	input: Parameters<typeof TeamBridgeApi.attachmentBytes>[0],
): Promise<boolean> {
	const existing = inflight.get(key);
	if (existing) {
		existing.holders += 1;
		return existing.promise;
	}
	const record = { holders: 1, promise: Promise.resolve(false) };
	record.promise = (async () => {
		try {
			const { data, mimeType } = await TeamBridgeApi.attachmentBytes(input);
			const url = createBlobUrl(data as BlobPart, mimeType);
			if (record.holders <= 0) {
				revokeBlobUrl(url);
				return false;
			}
			publish(key, url);
			return true;
		} catch {
			return false;
		} finally {
			inflight.delete(key);
		}
	})();
	inflight.set(key, record);
	return record.promise;
}

function useBridgeAttachmentUrl(
	key: string,
	input: Parameters<typeof TeamBridgeApi.attachmentBytes>[0],
	enabled: boolean,
	attempt: number,
): FetchState {
	// `peek` is render-safe (the cache's rule 1); the effect owns every retain.
	const [state, setState] = useState<FetchState>(() => {
		const warm = enabled ? peek(key) : null;
		return warm ? { state: "ready", url: warm } : { state: "loading" };
	});
	// biome-ignore lint/correctness/useExhaustiveDependencies: `input` is derived from `key`; `attempt` is the retry event.
	useEffect(() => {
		if (!enabled) return;
		let live = true;
		const held = retain(key);
		if (held) {
			setState({ state: "ready", url: held });
			return () => {
				live = false;
				release(key);
			};
		}
		setState({ state: "loading" });
		let joined = true;
		void fetchInto(key, input).then((ok) => {
			joined = false;
			if (!live) return;
			const url = ok ? retain(key) : null;
			setState(url ? { state: "ready", url } : { state: "failed" });
		});
		return () => {
			live = false;
			if (joined) {
				const record = inflight.get(key);
				if (record) record.holders -= 1;
			}
			release(key);
		};
	}, [key, enabled, attempt]);
	return state;
}

const Placeholder: FC<{
	kind: "expired" | "unavailable" | "failed";
	label: string;
	onRetry?: () => void;
}> = ({ kind, label, onRetry }) => {
	const copy =
		kind === "expired"
			? t("ui.teamBridge.attachments.expired")
			: t("ui.teamBridge.attachments.unavailable");
	return (
		<div
			role="img"
			aria-label={`${label}. ${copy}`}
			data-attachment-placeholder={kind}
			className="flex h-24 w-36 flex-col items-center justify-center gap-1 rounded-sm border border-control bg-sunken px-2 text-center text-[12px] text-ink-dim"
		>
			{kind === "expired" ? (
				<Clock size={16} aria-hidden="true" />
			) : (
				<ImageOff size={16} aria-hidden="true" />
			)}
			<span>{copy}</span>
			{kind === "failed" && onRetry && (
				<button
					type="button"
					onClick={onRetry}
					className="text-accent hover:underline"
				>
					{t("ui.teamBridge.attachments.retry_load")}
				</button>
			)}
		</div>
	);
};

/*
 * Tile geometry. One picture gets room (up to 360×240, aspect kept from the
 * descriptor so the box does not reflow when the bytes land); several share
 * a row of 2:3-ish tiles. The reserved box IS the loading state.
 */
const boxFor = (attachment: TeamBridgeAttachment, single: boolean) => {
	if (!single) return { width: 156, height: 104 };
	const maxW = 360;
	const maxH = 240;
	const { width, height } = attachment;
	if (!width || !height) return { width: 240, height: 160 };
	const scale = Math.min(maxW / width, maxH / height, 1);
	return {
		width: Math.max(64, Math.round(width * scale)),
		height: Math.max(64, Math.round(height * scale)),
	};
};

const MessageImage: FC<{
	message: TeamBridgeMessage;
	tenantId: string | null;
	attachment: TeamBridgeAttachment;
	index: number;
	count: number;
	onOpen: (index: number) => void;
	register: (index: number, url: string | null) => void;
	buttonRef: (node: HTMLButtonElement | null) => void;
}> = ({
	message,
	tenantId,
	attachment,
	index,
	count,
	onOpen,
	register,
	buttonRef,
}) => {
	const view = tenantId === null ? "unavailable" : attachmentView(attachment);
	const [attempt, setAttempt] = useState(0);
	const key = `team-bridge:${tenantId}:${message.conversation_id}:${message.id}:${attachment.id}`;
	const source = useBridgeAttachmentUrl(
		key,
		{
			tenantId: tenantId ?? "",
			conversationId: message.conversation_id,
			messageId: message.id,
			attachmentId: attachment.id,
		},
		view === "fetch",
		attempt,
	);
	const label = t("ui.teamBridge.attachments.position", {
		index: String(index + 1),
		count: String(count),
	});
	const url = source.state === "ready" ? source.url : null;
	// biome-ignore lint/correctness/useExhaustiveDependencies: publish the URL to the lightbox set when it changes.
	useEffect(() => register(index, url), [url, index]);
	if (view !== "fetch")
		return (
			<Placeholder
				kind={view === "expired" ? "expired" : "unavailable"}
				label={label}
			/>
		);
	if (source.state === "failed")
		return (
			<Placeholder
				kind="failed"
				label={label}
				onRetry={() => setAttempt((value) => value + 1)}
			/>
		);
	const box = boxFor(attachment, count === 1);
	return (
		<button
			ref={buttonRef}
			type="button"
			aria-label={t("ui.teamBridge.attachments.open", {
				index: String(index + 1),
				count: String(count),
			})}
			title={t("ui.teamBridge.attachments.open", {
				index: String(index + 1),
				count: String(count),
			})}
			disabled={!url}
			onClick={() => onOpen(index)}
			className="group/tile block cursor-zoom-in rounded-sm leading-none disabled:cursor-progress"
		>
			<AttachmentFrame
				boundary="control"
				style={{ width: box.width, height: box.height }}
				data-attachment-reserved={url ? undefined : ""}
			>
				{url && (
					<img
						src={url}
						alt={label}
						draggable={false}
						className="size-full object-cover"
					/>
				)}
			</AttachmentFrame>
		</button>
	);
};

/**
 * A message's images: a row of tiles and one lightbox for the set (arrow
 * keys walk it). Mounted by `TeamBridgeMessageList` for both the timeline and
 * the thread pane, so a reply's images are the same component.
 */
export const TeamBridgeMessageAttachments: FC<{
	message: TeamBridgeMessage;
	/* `null` = the caller does not know the organization: nothing is fetched. */
	tenantId: string | null;
}> = ({ message, tenantId }) => {
	useI18nLocale();
	const attachments = message.attachments ?? [];
	const [open, setOpen] = useState<number | null>(null);
	const [urls, setUrls] = useState<(string | null)[]>([]);
	const buttons = useRef<(HTMLButtonElement | null)[]>([]);
	const restore = useRef<HTMLElement | null>(null);
	if (attachments.length === 0) return null;
	const count = attachments.length;
	const register = (index: number, url: string | null) =>
		setUrls((previous) => {
			if (previous[index] === url) return previous;
			const next = [...previous];
			next[index] = url;
			return next;
		});
	const walk = (step: number) =>
		setOpen((current) =>
			current === null ? null : (current + step + count) % count,
		);
	const label =
		open === null
			? ""
			: t("ui.teamBridge.attachments.position", {
					index: String(open + 1),
					count: String(count),
				});
	return (
		<>
			<ul
				aria-label={t("ui.teamBridge.attachments.in_message", { count })}
				className="mt-1.5 flex flex-wrap gap-2"
			>
				{attachments.map((attachment, index) => (
					<li key={attachment.id}>
						<MessageImage
							message={message}
							tenantId={tenantId}
							attachment={attachment}
							index={index}
							count={count}
							register={register}
							buttonRef={(node) => {
								buttons.current[index] = node;
							}}
							onOpen={(next) => {
								restore.current = buttons.current[next] ?? null;
								setOpen(next);
							}}
						/>
					</li>
				))}
			</ul>
			<ImageLightbox
				src={open === null ? undefined : (urls[open] ?? undefined)}
				pending={open !== null && !urls[open]}
				label={label}
				open={open !== null}
				onOpenChange={(next) => {
					if (!next) setOpen(null);
				}}
				restoreFocusTo={restore}
				fallback={<Placeholder kind="unavailable" label={label} />}
				group={
					count > 1 && open !== null
						? {
								index: open,
								count,
								onPrev: () => walk(-1),
								onNext: () => walk(1),
							}
						: undefined
				}
			/>
		</>
	);
};

/**
 * A scheduled message's images. A reserved image is not bound to a message,
 * so there is no byte route for it: the tile shows this session's own
 * in-memory original when it still has one, otherwise a sized descriptor
 * tile (the manager's v1 rule). Never a fetch.
 */
export const TeamBridgeScheduledAttachments: FC<{
	attachments: readonly TeamBridgeAttachment[];
	accountId: string | undefined;
}> = ({ attachments, accountId }) => {
	useI18nLocale();
	const [urls, setUrls] = useState<Record<string, string>>({});
	const ids = attachments.map((row) => row.id).join(",");
	// biome-ignore lint/correctness/useExhaustiveDependencies: the id list is the identity.
	useEffect(() => {
		const made: Record<string, string> = {};
		for (const row of attachments) {
			const blob = uploadPreview(accountId, row.id);
			if (blob) made[row.id] = createBlobUrl(blob, blob.type);
		}
		setUrls(made);
		return () => {
			for (const url of Object.values(made)) revokeBlobUrl(url);
		};
	}, [ids, accountId]);
	if (attachments.length === 0) return null;
	const count = attachments.length;
	return (
		<ul
			aria-label={t("ui.teamBridge.attachments.in_message", { count })}
			className="mt-1.5 flex flex-wrap gap-2"
		>
			{attachments.map((row, index) => {
				const label = t("ui.teamBridge.attachments.position", {
					index: String(index + 1),
					count: String(count),
				});
				const url = urls[row.id];
				return (
					<li key={row.id}>
						<AttachmentFrame
							className="size-16"
							role="img"
							aria-label={label}
							data-attachment-scheduled={url ? "preview" : "descriptor"}
						>
							{url ? (
								<img src={url} alt="" className="size-full object-cover" />
							) : (
								<ImageOff
									size={16}
									aria-hidden="true"
									className="text-ink-dim"
								/>
							)}
						</AttachmentFrame>
					</li>
				);
			})}
		</ul>
	);
};

/**
 * Paste and drop on the composer box. Only IMAGE files are taken; text in the
 * same paste flows into the field untouched (the default is prevented only
 * when the clipboard carried nothing but images). A paste of images on a hub
 * without the capability falls through to the hook's "unsupported" note.
 */
export function attachmentPasteHandlers(state: TeamBridgeAttachmentsState) {
	return {
		onPaste: (event: ClipboardEvent<HTMLElement>) => {
			const files = imageFiles(event.clipboardData);
			if (files.length === 0) return;
			const hasText = Array.from(event.clipboardData.types).includes(
				"text/plain",
			);
			if (!hasText) event.preventDefault();
			state.add(files);
		},
		onDragOver: (event: DragEvent<HTMLElement>) => {
			if (Array.from(event.dataTransfer.types).includes("Files"))
				event.preventDefault();
		},
		onDrop: (event: DragEvent<HTMLElement>) => {
			const files = imageFiles(event.dataTransfer);
			if (files.length === 0) return;
			event.preventDefault();
			state.add(files);
		},
	};
}
