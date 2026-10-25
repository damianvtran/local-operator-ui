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
	ImageIcon,
	ImageOff,
	ImagePlus,
	RotateCw,
	X,
} from "lucide-react";
import type { ClipboardEvent, DragEvent, FC, ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
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
		// Reuses the page gate's own signed-out sentence: same fact, same words.
		case "signed_out":
			return t("ui.teamBridge.plan.sign_in_reason");
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
	const working = chip.status === "uploading" || chip.status === "preparing";
	const reason = chipStatusCopy(chip);
	const reasonId = useId();
	return (
		<li
			className="group/chip relative"
			data-attachment-chip={chip.status}
			/*
			 * Name and status are two nodes joined by `aria-describedby`, never a
			 * `${label}. ${reason}` string: a code-side join fixes English order
			 * and punctuation for every locale (zh-CN audit, att-r1).
			 */
			aria-label={label}
			aria-describedby={reason ? reasonId : undefined}
		>
			{reason && (
				<span id={reasonId} className="sr-only">
					{reason}
				</span>
			)}
			<div
				title={
					!chip.previewUrl && chip.status === "ready"
						? t("ui.teamBridge.attachments.preview_unavailable")
						: undefined
				}
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
							working ? "opacity-70" : "opacity-100",
						)}
					/>
				) : failed ? (
					<ImageOff size={18} aria-hidden="true" className="text-ink-dim" />
				) : working ? null : (
					/*
					 * A restored descriptor with no bytes in this session is a GOOD
					 * attachment we just cannot draw: a neutral picture glyph, never
					 * the broken-image one a failure wears (design round 1, D1).
					 */
					<ImageIcon size={18} aria-hidden="true" className="text-ink-dim" />
				)}
				{working && (
					/* A solid disc so the spinner reads over any picture (D3). */
					<span className="absolute inset-0 flex items-center justify-center">
						<span className="flex size-7 items-center justify-center rounded-full bg-elevated shadow-sm">
							<Spinner
								size="sm"
								label={t("ui.teamBridge.attachments.uploading")}
							/>
						</span>
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
			<ChipAction
				position="top"
				label={t("ui.teamBridge.attachments.remove", { label })}
				onClick={onRemove}
			>
				<X size={12} aria-hidden="true" />
			</ChipAction>
			{/* No Retry for signed_out: it would 401 again until the user signs in
			    (review r7 M2), the same rule as the page's error view. */}
			{failed && chip.prepared && chip.reason !== "signed_out" && (
				<ChipAction
					position="bottom"
					label={t("ui.teamBridge.attachments.retry", { label })}
					onClick={onRetry}
				>
					<RotateCw size={12} aria-hidden="true" />
				</ChipAction>
			)}
		</li>
	);
};

/*
 * The chip's corner controls: a 24px hit target (WCAG 2.5.8) around the 20px
 * disc the design asks for, so the look is unchanged and adjacent chips' X
 * buttons are no longer 4px apart at a 20px target (design round 1, D2).
 */
const ChipAction: FC<{
	position: "top" | "bottom";
	label: string;
	onClick: () => void;
	children: ReactNode;
}> = ({ position, label, onClick, children }) => (
	<button
		type="button"
		onClick={onClick}
		aria-label={label}
		title={label}
		className={cn(
			"group/action absolute -right-2 flex size-6 items-center justify-center rounded-full",
			position === "top" ? "-top-2" : "-bottom-2",
		)}
	>
		<span className="flex size-5 items-center justify-center rounded-full border border-control bg-elevated text-ink-muted group-hover/action:text-ink group-focus-visible/action:text-ink">
			{children}
		</span>
	</button>
);

/** What a chip says about itself, or null when it is simply ready. */
function chipStatusCopy(chip: AttachmentChip): string | null {
	if (chip.status === "expired")
		// Name the action that is really there: Retry exists only while this
		// session still holds the bytes (design round 1, D1).
		return chip.prepared
			? t("ui.teamBridge.attachments.expired_staged_retry")
			: t("ui.teamBridge.attachments.expired_staged");
	if (chip.status === "error") return failureCopy(chip.reason);
	if (chip.status === "uploading" || chip.status === "preparing")
		return t("ui.teamBridge.attachments.uploading");
	return null;
}

/**
 * The strip above the composer field, plus the one-line status under it (the
 * first failure's reason, or the capability notice). Renders nothing when
 * there is nothing to say, so a text-only composer is unchanged.
 */
export const TeamBridgeAttachmentStrip: FC<{
	state: TeamBridgeAttachmentsState;
}> = ({ state }) => {
	useI18nLocale();
	const failureIndex = state.chips.findIndex(
		(chip) => chip.status === "error" || chip.status === "expired",
	);
	const failure = failureIndex >= 0 ? state.chips[failureIndex] : null;
	const failures = state.chips.filter(
		(chip) => chip.status === "error" || chip.status === "expired",
	);
	const working = state.chips.some(
		(chip) => chip.status === "uploading" || chip.status === "preparing",
	);
	/*
	 * One line, most actionable first. A failure NAMES its chip ("Image 2 of 3:
	 * …") so the sentence is tied to the red-edged tile it describes (design
	 * round 1, D10); progress gets visible text, not only a spinner (D3).
	 */
	const notice =
		state.notice === "unsupported" || state.unsupported
			? t("ui.teamBridge.attachments.unsupported")
			: state.notice === "limit"
				? t("ui.teamBridge.attachments.limit", { max: state.max })
				: failure
					? (chipStatusCopy(failure) ?? "")
					: working
						? t("ui.teamBridge.attachments.uploading")
						: null;
	const tone: "danger" | "muted" =
		failure && !state.notice && !state.unsupported ? "danger" : "muted";
	if (state.chips.length === 0 && !notice) return null;
	return (
		/* `px-3.5` is the field's own inset, so chips and the note share the
		   text's left edge (design round 1, D9). */
		<div className="px-3.5 pt-3">
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
					role={tone === "danger" ? "alert" : "status"}
					className={cn(
						"pt-1.5 text-[12px]",
						tone === "danger" ? "text-danger" : "text-ink-muted",
					)}
				>
					{failure && tone === "danger" && (
						/*
						 * Which chip(s) the sentence is about, as its own node (D10). One
						 * failure names its position; several say how many cannot be sent,
						 * then the first reason follows (D13). Two nodes, never a code-side
						 * string join, so each locale keeps its own word order.
						 */
						<span className="me-1.5 font-medium">
							{failures.length > 1
								? t("ui.teamBridge.attachments.failed_count", {
										count: failures.length,
									})
								: t("ui.teamBridge.attachments.position", {
										index: String(failureIndex + 1),
										count: String(state.chips.length),
									})}
						</span>
					)}
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

/*
 * DELETED AND WITHHELD LOOK THE SAME ON PURPOSE (design round 1, D7): the
 * reader is told the picture is not available to them, never why - "withheld"
 * vs "deleted" would tell a member what an agent's screening or another
 * member's account did. Only retention ("expired") is a fact about time that
 * is safe to state. The box is the tile's own `boxFor` size, so a retry that
 * succeeds does not move the message below it (D4).
 */
const Placeholder: FC<{
	kind: "expired" | "unavailable" | "failed";
	label: string;
	box: { width: number; height: number };
	onRetry?: () => void;
}> = ({ kind, label, box, onRetry }) => {
	const copy =
		kind === "expired"
			? t("ui.teamBridge.attachments.expired")
			: t("ui.teamBridge.attachments.unavailable");
	const copyId = useId();
	return (
		<div
			role="img"
			aria-label={label}
			aria-describedby={copyId}
			data-attachment-placeholder={kind}
			style={{ width: box.width, height: box.height }}
			className="flex flex-col items-center justify-center gap-1 rounded-sm border border-control bg-sunken px-2 text-center text-[12px] text-ink-dim"
		>
			{kind === "expired" ? (
				<Clock size={16} aria-hidden="true" />
			) : (
				<ImageOff size={16} aria-hidden="true" />
			)}
			<span id={copyId}>{copy}</span>
			{kind === "failed" && onRetry && (
				<button
					type="button"
					onClick={onRetry}
					/* 24px tall hit area for a text control (D5). */
					className="min-h-6 rounded-sm px-1.5 text-accent hover:underline"
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
 *
 * `compact` is the thread pane: at an 800px window it is ~360px wide with
 * ~272px of content, so 156px tiles stacked four in one column and pushed
 * half the set below the composer (design round 2, D12). 128×88 lets two sit
 * side by side (2 × 128 + 8 gap = 264), so four images are a 2×2 grid.
 */
const boxFor = (
	attachment: TeamBridgeAttachment,
	single: boolean,
	compact = false,
) => {
	if (!single)
		return compact ? { width: 128, height: 88 } : { width: 156, height: 104 };
	const maxW = compact ? 264 : 360;
	const maxH = compact ? 176 : 240;
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
	accountId?: string;
	attachment: TeamBridgeAttachment;
	index: number;
	count: number;
	density: "regular" | "compact";
	onOpen: (index: number) => void;
	register: (index: number, url: string | null) => void;
	buttonRef: (node: HTMLButtonElement | null) => void;
}> = ({
	message,
	tenantId,
	accountId,
	attachment,
	index,
	count,
	density,
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
			// The receipt, not a lookup: the account this tile was rendered under.
			expectedAccountId: accountId ?? "",
		},
		view === "fetch" && Boolean(accountId),
		attempt,
	);
	const label = t("ui.teamBridge.attachments.position", {
		index: String(index + 1),
		count: String(count),
	});
	const url = source.state === "ready" ? source.url : null;
	// biome-ignore lint/correctness/useExhaustiveDependencies: publish the URL to the lightbox set when it changes.
	useEffect(() => register(index, url), [url, index]);
	const box = boxFor(attachment, count === 1, density === "compact");
	if (view !== "fetch")
		return (
			<Placeholder
				kind={view === "expired" ? "expired" : "unavailable"}
				label={label}
				box={box}
			/>
		);
	if (source.state === "failed")
		return (
			<Placeholder
				kind="failed"
				label={label}
				box={box}
				onRetry={() => setAttempt((value) => value + 1)}
			/>
		);
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
	/* The captured owner this subtree was rendered under; the byte route needs it. */
	accountId?: string;
	density?: "regular" | "compact";
}> = ({ message, tenantId, density = "regular", accountId }) => {
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
							accountId={accountId}
							attachment={attachment}
							index={index}
							count={count}
							density={density}
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
				fallback={
					<Placeholder
						kind="unavailable"
						label={label}
						box={{ width: 240, height: 160 }}
					/>
				}
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
	const listId = useId();
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
		<>
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
								aria-describedby={url ? undefined : `${listId}-none`}
								title={
									url
										? undefined
										: t("ui.teamBridge.attachments.preview_unavailable")
								}
								data-attachment-scheduled={url ? "preview" : "descriptor"}
							>
								{url ? (
									<img src={url} alt="" className="size-full object-cover" />
								) : (
									/* Attached and reserved, just not drawable here: a neutral
								   picture glyph, never the broken one (design round 1, D6). */
									<ImageIcon
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
			{/* One shared description for every tile that cannot be drawn (D6);
		    `hidden` still resolves through aria-describedby, and keeps the
		    list's item count honest. */}
			<span hidden id={`${listId}-none`}>
				{t("ui.teamBridge.attachments.preview_unavailable")}
			</span>
		</>
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
