import type { CommunityImageInput } from "@shared/api/local-operator/community-api";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@shared/components/ui/alert";
import { Button } from "@shared/components/ui/button";
import { Textarea } from "@shared/components/ui/textarea";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import {
	ArrowUp,
	Clock,
	Copy,
	Globe,
	ImagePlus,
	Loader2,
	Lock,
	RefreshCw,
	TriangleAlert,
	User,
	X,
} from "lucide-react";
import { type FC, useEffect, useRef, useState } from "react";
/**
 * The community composer and its sender-only outcomes (RFC v2.4 §5.5, frame D7).
 *
 * EVERY OUTCOME IS THE SENDER'S ALONE. Checking, refused, limited, moderation
 * unavailable and images unavailable are drawn here, in the composer, and never
 * as a timeline row: nothing was posted, so nobody else has anything to see.
 *
 * THE DRAFT SURVIVES EVERYTHING BUT A PUBLISH. The text and images are the
 * caller's state (`draft`), cleared by the caller only when `send` reports
 * `clearDraft`. Drafts are memory-only (RFC §5.3; see `use-community.ts`).
 *
 * THE AUDIENCE IS ALWAYS STATED under the box ("Visible to all community
 * members"), and a read-only room replaces the box entirely with who posts
 * there and where to talk instead (D4).
 *
 * Split view/container: `CommunityComposerView` takes the phase and callbacks,
 * so stories render every D7 state without a transport.
 */
import {
	COMMUNITY_MAX_IMAGES,
	COMMUNITY_MAX_IMAGE_BYTES,
	COMMUNITY_MAX_TEXT_CHARS,
} from "../../../../shared/desktop-contract";
import {
	type CommunityAudience,
	type CommunityPostingState,
	type ComposerPhase,
	REFUSAL_CATEGORY_KEY,
	attachmentName,
	canSend,
	imageRejection,
	secondsLeft,
} from "./community-model";

/** One attached image: its wire form plus a local preview URL. */
export type CommunityDraftImage = CommunityImageInput & { previewUrl?: string };

export type CommunityDraft = { text: string; images: CommunityDraftImage[] };

export const EMPTY_DRAFT: CommunityDraft = { text: "", images: [] };

/** Re-render once a second while a posting limit counts down. */
function useNow(active: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [active]);
	return now;
}

const AUDIENCE_KEY = {
	all_members: "ui.community.composer.audience.all",
	all_members_staff_post: "ui.community.composer.audience.all_staff_post",
	private_channel: "ui.community.composer.audience.private",
} as const satisfies Record<CommunityAudience["kind"], string>;

/** The limit sentence for a scope; numbers are the RFC §6.3 pilot values. */
const LIMIT_KEY: Record<string, string> = {
	account_burst: "ui.community.outcome.limit.burst",
	account_daily: "ui.community.outcome.limit.daily",
	conversation: "ui.community.outcome.limit.conversation",
	probation: "ui.community.outcome.limit.probation",
};

const OnlyYou: FC = () => (
	<span className="inline-flex items-center gap-1 rounded-sm border border-hairline px-1.5 text-meta-sm text-ink-muted">
		<User size={11} aria-hidden="true" />
		{t("ui.community.outcome.only_you")}
	</span>
);

/** The sender-only notice above the box, or nothing when idle/checking. */
export const CommunityOutcomeNotice: FC<{
	phase: ComposerPhase;
	now: number;
	onEdit?: () => void;
	onRetry?: () => void;
	onDismiss?: () => void;
	onRemoveImages?: () => void;
	onReviewGuidelines?: () => void;
	guidelinesUrl?: string | null;
}> = ({
	phase,
	now,
	onEdit,
	onRetry,
	onDismiss,
	onRemoveImages,
	onReviewGuidelines,
}) => {
	useI18nLocale();
	switch (phase.kind) {
		case "idle":
		case "checking":
			return null;
		case "refused":
			return (
				<Alert
					variant="warning"
					data-community-outcome="refused"
					icon={<TriangleAlert size={15} aria-hidden="true" />}
				>
					<AlertTitle className="flex flex-wrap items-center gap-2">
						{t("ui.community.outcome.refused.title")}
						<OnlyYou />
					</AlertTitle>
					<AlertDescription className="flex flex-col gap-2">
						<p>
							{t("ui.community.outcome.refused.reason", {
								category: t(REFUSAL_CATEGORY_KEY[phase.category]),
							})}
						</p>
						<p className="flex items-center gap-1.5 text-meta-sm text-ink-muted">
							<span className="font-mono">
								{t("ui.community.outcome.reference", {
									reference: phase.reference,
								})}
							</span>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("ui.community.outcome.copy_reference")}
								onClick={() =>
									void navigator.clipboard?.writeText(phase.reference)
								}
							>
								<Copy size={12} aria-hidden="true" />
							</Button>
						</p>
						<div className="flex items-center gap-2">
							{onEdit && (
								<Button variant="secondary" size="sm" onClick={onEdit}>
									{t("ui.community.outcome.edit")}
								</Button>
							)}
							{onDismiss && (
								<Button variant="ghost" size="sm" onClick={onDismiss}>
									{t("ui.community.outcome.dismiss")}
								</Button>
							)}
						</div>
					</AlertDescription>
				</Alert>
			);
		case "rate_limited": {
			const seconds = secondsLeft(phase, now);
			return (
				<Alert
					variant="neutral"
					data-community-outcome="rate-limited"
					icon={<Clock size={15} aria-hidden="true" />}
				>
					<AlertTitle>{t("ui.community.outcome.limit.title")}</AlertTitle>
					<AlertDescription className="flex flex-col gap-1">
						<p>
							{t(
								(LIMIT_KEY[phase.scope ?? ""] ??
									"ui.community.outcome.limit.generic") as "ui.community.outcome.limit.generic",
							)}{" "}
							{seconds > 0
								? t("ui.community.outcome.limit.retry", { seconds })
								: t("ui.community.outcome.limit.ready")}
						</p>
						<p className="text-meta-sm text-ink-muted">
							{t("ui.community.outcome.limit.note")}
						</p>
					</AlertDescription>
				</Alert>
			);
		}
		case "moderation_unavailable":
			return (
				<Alert variant="info" data-community-outcome="moderation-unavailable">
					<AlertTitle>{t("ui.community.outcome.unavailable.title")}</AlertTitle>
					<AlertDescription className="flex flex-col gap-2">
						<p>{t("ui.community.outcome.unavailable.body")}</p>
						{onRetry && (
							<div>
								<Button variant="secondary" size="sm" onClick={onRetry}>
									<RefreshCw size={13} aria-hidden="true" />
									{t("ui.community.outcome.retry")}
								</Button>
							</div>
						)}
					</AlertDescription>
				</Alert>
			);
		case "images_unavailable":
			return (
				<Alert variant="info" data-community-outcome="images-unavailable">
					<AlertTitle>{t("ui.community.outcome.images.title")}</AlertTitle>
					<AlertDescription className="flex flex-col gap-2">
						<p>{t("ui.community.outcome.images.body")}</p>
						{onRemoveImages && (
							<div>
								<Button variant="secondary" size="sm" onClick={onRemoveImages}>
									{t("ui.community.outcome.remove_images")}
								</Button>
							</div>
						)}
					</AlertDescription>
				</Alert>
			);
		case "guidelines_changed":
			return (
				<Alert variant="info" data-community-outcome="guidelines-changed">
					<AlertTitle>
						{t("ui.community.outcome.guidelines_changed.title")}
					</AlertTitle>
					<AlertDescription className="flex flex-col gap-2">
						<p>{t("ui.community.outcome.guidelines_changed.body")}</p>
						{onReviewGuidelines && (
							<div>
								<Button
									variant="secondary"
									size="sm"
									onClick={onReviewGuidelines}
								>
									{t("ui.community.outcome.guidelines_changed.review")}
								</Button>
							</div>
						)}
					</AlertDescription>
				</Alert>
			);
		default: {
			const key = {
				too_large: "ui.community.outcome.too_large",
				cancelled: "ui.community.outcome.cancelled",
				expired: "ui.community.outcome.expired",
				offline: "ui.community.outcome.offline",
				error: "ui.community.outcome.error",
			}[phase.kind];
			return (
				<Alert
					variant={phase.kind === "cancelled" ? "neutral" : "warning"}
					data-community-outcome={phase.kind}
				>
					<AlertDescription className="flex items-center justify-between gap-3">
						<span>{t(key as "ui.community.outcome.error")}</span>
						{onDismiss && (
							<Button variant="ghost" size="sm" onClick={onDismiss}>
								{t("ui.community.outcome.dismiss")}
							</Button>
						)}
					</AlertDescription>
				</Alert>
			);
		}
	}
};

/** The replacement for the box in a room the reader cannot post in (D4). */
const ReadOnlyBar: FC<{
	posting: Exclude<CommunityPostingState, "open">;
	onGoGeneral?: () => void;
}> = ({ posting, onGoGeneral }) => (
	<div
		data-community-composer="read-only"
		className="flex items-center gap-3 rounded-lg border border-hairline bg-surface px-3 py-2.5"
	>
		<Lock size={14} aria-hidden="true" className="shrink-0 text-ink-dim" />
		<p className="min-w-0 flex-1 text-[13px] text-ink-muted">
			{posting === "locked"
				? t("ui.community.composer.locked")
				: posting === "archived"
					? t("ui.community.composer.archived")
					: t("ui.community.composer.community_read_only")}
		</p>
		{posting === "locked" && onGoGeneral && (
			<Button variant="secondary" size="sm" onClick={onGoGeneral}>
				{t("ui.community.composer.go_general")}
			</Button>
		)}
	</div>
);

export const CommunityComposerView: FC<{
	channelName: string;
	posting: CommunityPostingState;
	audience: CommunityAudience;
	phase: ComposerPhase;
	draft: CommunityDraft;
	onDraftChange: (draft: CommunityDraft) => void;
	onSend: () => void;
	onCancel: () => void;
	onRetry: () => void;
	onDismiss: () => void;
	onReviewGuidelines?: () => void;
	onGoGeneral?: () => void;
	offline?: boolean;
	/** A thread reply composer: no audience line, a shorter placeholder. */
	variant?: "channel" | "thread";
	/** Images are not offered in threads in this lane. */
	allowImages?: boolean;
}> = ({
	channelName,
	posting,
	audience,
	phase,
	draft,
	onDraftChange,
	onSend,
	onCancel,
	onRetry,
	onDismiss,
	onReviewGuidelines,
	onGoGeneral,
	offline = false,
	variant = "channel",
	allowImages = true,
}) => {
	useI18nLocale();
	const now = useNow(phase.kind === "rate_limited");
	const textRef = useRef<HTMLTextAreaElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const [imageError, setImageError] = useState<
		"type" | "size" | "count" | null
	>(null);
	const checking = phase.kind === "checking";
	const sendable =
		!offline &&
		canSend(phase, now, draft.text) &&
		draft.text.length <= COMMUNITY_MAX_TEXT_CHARS;

	if (posting !== "open")
		return (
			<div className="flex flex-col gap-1.5">
				<ReadOnlyBar posting={posting} onGoGeneral={onGoGeneral} />
				{variant === "channel" && (
					<AudienceLine audience={audience} offline={false} />
				)}
			</div>
		);

	const addFiles = async (files: FileList | null) => {
		if (!files) return;
		setImageError(null);
		const next = [...draft.images];
		for (const file of Array.from(files)) {
			const rejection = imageRejection(file, next.length, {
				maxBytes: COMMUNITY_MAX_IMAGE_BYTES,
				maxImages: COMMUNITY_MAX_IMAGES,
			});
			if (rejection) {
				setImageError(rejection);
				break;
			}
			const buffer = new Uint8Array(await file.arrayBuffer());
			let binary = "";
			for (let i = 0; i < buffer.length; i += 0x8000)
				binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
			next.push({
				content_type: file.type as CommunityImageInput["content_type"],
				data_base64: btoa(binary),
				previewUrl: URL.createObjectURL(file),
			});
		}
		onDraftChange({ ...draft, images: next });
	};

	return (
		<div className="flex flex-col gap-1.5" data-community-composer={variant}>
			<CommunityOutcomeNotice
				phase={phase}
				now={now}
				onEdit={() => {
					onDismiss();
					textRef.current?.focus();
				}}
				onRetry={onRetry}
				onDismiss={onDismiss}
				onRemoveImages={() => {
					onDraftChange({ ...draft, images: [] });
					onDismiss();
				}}
				onReviewGuidelines={onReviewGuidelines}
			/>
			<div
				className={cn(
					"flex flex-col gap-2 rounded-lg border border-control bg-surface px-3 py-2",
					checking && "bg-sunken",
				)}
			>
				{draft.images.length > 0 && (
					<ul className="flex flex-wrap gap-2">
						{draft.images.map((image, index) => {
							const name = attachmentName(index, image.content_type);
							return (
								<li
									// biome-ignore lint/suspicious/noArrayIndexKey: names are positional by design (image-1.png).
									key={index}
									className="flex items-center gap-1.5 rounded-md border border-hairline bg-elevated py-1 ps-1.5 pe-1 text-meta-sm text-ink"
								>
									{image.previewUrl && (
										<img
											src={image.previewUrl}
											alt=""
											className="size-6 rounded-xs object-cover"
										/>
									)}
									<span className="font-mono">{name}</span>
									<Button
										variant="ghost"
										size="icon-sm"
										disabled={checking}
										aria-label={t("ui.community.composer.remove_image", {
											name,
										})}
										onClick={() =>
											onDraftChange({
												...draft,
												images: draft.images.filter((_, i) => i !== index),
											})
										}
									>
										<X size={12} aria-hidden="true" />
									</Button>
								</li>
							);
						})}
					</ul>
				)}
				<Textarea
					ref={textRef}
					value={draft.text}
					readOnly={checking}
					rows={2}
					maxLength={COMMUNITY_MAX_TEXT_CHARS}
					placeholder={
						variant === "thread"
							? t("ui.community.thread.reply_placeholder")
							: t("ui.community.composer.placeholder", { channel: channelName })
					}
					aria-label={
						variant === "thread"
							? t("ui.community.thread.reply_placeholder")
							: t("ui.community.composer.placeholder", { channel: channelName })
					}
					className="min-h-[44px] resize-none border-0 bg-transparent px-0 py-0 shadow-none focus-visible:outline-none"
					onChange={(event) =>
						onDraftChange({ ...draft, text: event.target.value })
					}
					onKeyDown={(event) => {
						if (event.key === "Escape" && checking) {
							event.preventDefault();
							onCancel();
							return;
						}
						if (
							event.key === "Enter" &&
							!event.shiftKey &&
							!event.nativeEvent.isComposing
						) {
							event.preventDefault();
							if (sendable) onSend();
						}
					}}
				/>
				<div className="flex items-center gap-2">
					{allowImages && (
						<>
							<input
								ref={fileRef}
								type="file"
								accept="image/png,image/jpeg,image/webp"
								multiple
								hidden
								onChange={(event) => {
									void addFiles(event.target.files);
									event.target.value = "";
								}}
							/>
							<Button
								variant="ghost"
								size="icon-sm"
								disabled={
									checking || draft.images.length >= COMMUNITY_MAX_IMAGES
								}
								aria-label={t("ui.community.composer.attach")}
								onClick={() => fileRef.current?.click()}
							>
								<ImagePlus size={15} aria-hidden="true" />
							</Button>
						</>
					)}
					{checking && (
						<span
							data-community-outcome="checking"
							className="flex items-center gap-2 text-meta-sm text-ink-muted"
						>
							<Loader2 size={13} aria-hidden="true" className="animate-spin" />
							<output>
								{phase.cancelling
									? t("ui.community.composer.cancelling")
									: t("ui.community.composer.checking")}
							</output>
							{!phase.cancelling && (
								<Button variant="ghost" size="sm" onClick={onCancel}>
									{t("ui.community.composer.cancel")}
								</Button>
							)}
						</span>
					)}
					{imageError && (
						<span role="alert" className="text-meta-sm text-danger">
							{t(
								(
									{
										type: "ui.community.composer.image_rejected.type",
										size: "ui.community.composer.image_rejected.size",
										count: "ui.community.composer.image_rejected.count",
									} as const
								)[imageError],
							)}
						</span>
					)}
					<Button
						variant="primary"
						size="icon-sm"
						className="ms-auto rounded-full"
						disabled={!sendable}
						aria-label={t("ui.community.composer.send")}
						onClick={onSend}
					>
						<ArrowUp size={14} aria-hidden="true" />
					</Button>
				</div>
			</div>
			{variant === "channel" && (
				<AudienceLine audience={audience} offline={offline} />
			)}
		</div>
	);
};

const AudienceLine: FC<{ audience: CommunityAudience; offline: boolean }> = ({
	audience,
	offline,
}) => (
	<p
		data-community-audience={audience.kind}
		className="flex items-center gap-1.5 text-meta-sm text-ink-muted"
	>
		{audience.kind === "private_channel" ? (
			<Lock size={12} aria-hidden="true" />
		) : (
			<Globe size={12} aria-hidden="true" />
		)}
		{t(AUDIENCE_KEY[audience.kind])}
		{offline && (
			<span>
				{" · "}
				{t("ui.community.composer.audience.offline_suffix")}
			</span>
		)}
	</p>
);
