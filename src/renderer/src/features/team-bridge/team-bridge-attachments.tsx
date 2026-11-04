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
 * Terminal descriptors share a generic unavailable card and make no request.
 * A member fetch may offer explicit retry for a transient relay error, never
 * for an authenticated refusal. Audit descriptors never enter this byte flow.
 *
 * Bytes are never logged and no element carries the attachment's id, digest
 * or filename as text (D9). Alt text is a positional label ("Image 2 of 4").
 */

import {
	TeamBridgeApi,
	TeamBridgeAttachmentError,
} from "@shared/api/local-operator/team-bridge-api";
import { ImageLightbox } from "@shared/components/common/image-lightbox";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import {
	blobAt,
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
import { downloadBlob } from "../chat/utils/image-actions";
import { toBridgeFileDescriptor } from "./attachments/attachment-model";
import {
	BridgeAttachmentGroup,
	type BridgeImageSlot,
} from "./attachments/bridge-attachment-group";
import {
	type InlineImageBox,
	InlineImageFailure,
	InlineImageTile,
} from "./attachments/inline-image-tile";
import {
	type AttachmentFailure,
	attachmentView,
	imageFiles,
	imagePasteCancelsText,
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
		/*
		 * Its own sentence, because neither neighbour is true: "signed out" is a
		 * different fact and the quota line is a different failure. The key stays
		 * in the `attachments` namespace — that is where it renders — and says
		 * "changed" rather than "mismatch" because it describes a change over
		 * time, not a comparison (design round 1 D1, code review R3-01).
		 */
		case "account_mismatch":
			return t("ui.teamBridge.attachments.error_account_changed");
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
			{failed &&
				chip.prepared &&
				chip.reason !== "signed_out" &&
				chip.reason !== "account_mismatch" && (
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
	| { state: "failed" }
	| { state: "unavailable" };

/*
 * In-flight fetches by cache key, so N mounts of one picture (the timeline
 * and the thread pane both show a root) make one request - the same
 * discipline as `use-attachment-url.ts`, keyed here by
 * tenant/conversation/message/attachment because a bridge id is only
 * meaningful inside its conversation's member gate.
 */
const inflight = new Map<
	string,
	{ promise: Promise<"ready" | "failed" | "unavailable">; holders: number }
>();

function fetchInto(
	key: string,
	input: Parameters<typeof TeamBridgeApi.attachmentBytes>[0],
): Promise<"ready" | "failed" | "unavailable"> {
	const existing = inflight.get(key);
	if (existing) {
		existing.holders += 1;
		return existing.promise;
	}
	const record: {
		holders: number;
		promise: Promise<"ready" | "failed" | "unavailable">;
	} = { holders: 1, promise: Promise.resolve("unavailable") };
	record.promise = (async () => {
		try {
			const { data, mimeType } = await TeamBridgeApi.attachmentBytes(input);
			const url = createBlobUrl(data as BlobPart, mimeType);
			if (record.holders <= 0) {
				revokeBlobUrl(url);
				return "unavailable";
			}
			publish(key, url);
			return "ready";
		} catch (error) {
			// A refusal is not a transient failure. Never turn a 401/403/404
			// into a retry action or switch to another authority's route.
			return error instanceof TeamBridgeAttachmentError &&
				(error.status === null ||
					error.status >= 500 ||
					error.status === 408 ||
					error.status === 429)
				? "failed"
				: "unavailable";
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
			const url = ok === "ready" ? retain(key) : null;
			setState(
				url
					? { state: "ready", url }
					: { state: ok === "failed" ? "failed" : "unavailable" },
			);
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
 * member's account did. Structured cards also withhold retention reasons.
 * The box is the tile's own slot, so a retry that succeeds does not move the
 * message below it (D4). The look is the shared inline failure tile.
 */
const Placeholder: FC<{
	kind: "expired" | "unavailable" | "failed";
	label: string;
	box: InlineImageBox;
	onRetry?: () => void;
}> = ({ kind, label, box, onRetry }) => (
	<InlineImageFailure
		kind={kind}
		label={label}
		box={box}
		copy={
			kind === "expired"
				? t("ui.teamBridge.attachments.expired")
				: t("ui.teamBridge.attachments.unavailable")
		}
		onRetry={onRetry}
		retryLabel={t("ui.teamBridge.attachments.retry_load")}
		attributes={{ "data-attachment-placeholder": kind }}
	/>
);

/*
 * SAVING A PICTURE THE READER CAN ALREADY SEE. The tile holds this session's
 * blob URL for bytes the member relay already authorised and delivered; the
 * save writes those same bytes through the platform's save dialog
 * (`downloadBlob`), so no new byte route, authority or path exists. Owner
 * audit tiles do not get this (no download from the audit, #1634).
 * The image contract carries no file name, so the dialog proposes a generic
 * one with the extension the mime implies. The caller offers Save only while
 * `blobAt` still has the bytes, so the control never silently does nothing
 * (agent review round 1, nit 1).
 */
function saveBridgeImage(blob: Blob, mime: string, index: number) {
	const extension = mime === "image/jpeg" ? "jpg" : "png";
	downloadBlob(blob, `image-${index + 1}.${extension}`);
}

const MessageImage: FC<{
	message: TeamBridgeMessage;
	tenantId: string | null;
	accountId?: string;
	attachment: TeamBridgeAttachment;
	index: number;
	count: number;
	slot: BridgeImageSlot;
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
	slot,
	onOpen,
	register,
	buttonRef,
}) => {
	const view =
		tenantId === null || !accountId
			? "unavailable"
			: attachmentView(attachment);
	const [attempt, setAttempt] = useState(0);
	// Member and owner-audit resources never share an authority/cache key.
	const key = JSON.stringify([
		"team-bridge-member",
		accountId,
		tenantId,
		message.conversation_id,
		message.id,
		attachment.id,
	]);
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
	const saveBlob = url ? blobAt(url) : null;
	if (view !== "fetch" || source.state === "unavailable")
		return <Placeholder kind="unavailable" label={label} box={slot.box} />;
	if (source.state === "failed")
		return (
			<Placeholder
				kind="failed"
				label={label}
				box={slot.box}
				onRetry={() => setAttempt((value) => value + 1)}
			/>
		);
	return (
		<InlineImageTile
			url={url}
			box={slot.box}
			fit={slot.fit}
			overflow={slot.overflow}
			label={label}
			openLabel={t("ui.teamBridge.attachments.open", {
				index: String(index + 1),
				count: String(count),
			})}
			buttonRef={buttonRef}
			onOpen={() => onOpen(index)}
			onDownload={
				saveBlob
					? () => saveBridgeImage(saveBlob, attachment.mime, index)
					: undefined
			}
		/>
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
	/* S3b generic files ride beside the images as metadata-only cards; they
	 * never enter this component's byte relay, cache or lightbox. */
	const files = (message.files ?? []).map(toBridgeFileDescriptor);
	const fileCount = Math.max(files.length, message.file_count ?? 0);
	const [open, setOpen] = useState<number | null>(null);
	const [urls, setUrls] = useState<(string | null)[]>([]);
	const buttons = useRef<(HTMLButtonElement | null)[]>([]);
	const restore = useRef<HTMLElement | null>(null);
	if (attachments.length === 0 && fileCount === 0) return null;
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
			<BridgeAttachmentGroup
				attachments={attachments}
				compact={density === "compact"}
				files={files}
				fileCount={fileCount}
				renderPreview={(attachment, index, slot) => (
					<MessageImage
						message={message}
						tenantId={tenantId}
						accountId={accountId}
						attachment={attachment}
						index={index}
						count={count}
						slot={slot}
						register={register}
						buttonRef={(node) => {
							buttons.current[index] = node;
						}}
						onOpen={(next) => {
							restore.current = buttons.current[next] ?? null;
							setOpen(next);
						}}
					/>
				)}
			/>
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
 * same paste flows into the field untouched, UNLESS that text is nothing but
 * the pasted files' names - the `text/plain` a Finder file copy carries, which
 * used to be typed into the reply beside its chip (issue #1573,
 * `pastedTextIsOnlyFileNames`). A paste of images on a hub without the
 * capability falls through to the hook's "unsupported" note.
 */
export function attachmentPasteHandlers(state: TeamBridgeAttachmentsState) {
	return {
		onPaste: (event: ClipboardEvent<HTMLElement>) => {
			const files = imageFiles(event.clipboardData);
			if (files.length === 0) return;
			if (imagePasteCancelsText(event.clipboardData)) event.preventDefault();
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
