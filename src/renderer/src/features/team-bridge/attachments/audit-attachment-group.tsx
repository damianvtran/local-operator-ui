import {
	type OwnerAuditScope,
	TeamBridgeOwnerAuditApi,
} from "@shared/api/local-operator/team-bridge-owner-audit-api";
import { ImageLightbox } from "@shared/components/common/image-lightbox";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
	BridgeAttachmentDescriptor,
	BridgeFileDescriptor,
} from "./attachment-model";
import {
	type AuditAttachmentScope,
	auditAttachmentAction,
	auditAttachmentKey,
} from "./audit-attachment-scope";
import {
	BridgeAttachmentGroup,
	type BridgeImageSlot,
} from "./bridge-attachment-group";
import { InlineImageFailure, InlineImageTile } from "./inline-image-tile";
import {
	type AuditImageState,
	useAuditAttachment,
} from "./use-audit-attachment";

export type AuditReviewState = "loading" | "unavailable" | "ready";

function AuditImage({
	scope,
	attachment,
	slot,
	index,
	count,
	register,
	onReviewState,
	onOpen,
	openerRef,
}: {
	scope: AuditAttachmentScope;
	attachment: BridgeAttachmentDescriptor;
	slot: BridgeImageSlot;
	index: number;
	count: number;
	register: (id: string, value: AuditImageState) => void;
	onReviewState?: (id: string, state: AuditReviewState) => void;
	onOpen: () => void;
	openerRef: (node: HTMLButtonElement | null) => void;
}) {
	const [attempt, setAttempt] = useState(0);
	const source = useAuditAttachment(
		scope,
		auditAttachmentAction(attachment) === "preview",
		attempt,
	);
	const url = source.state === "ready" ? source.url : null;
	const [decoded, setDecoded] = useState<{
		url: string;
		ready: boolean;
	} | null>(null);
	const failedDecode = decoded?.url === url && !decoded.ready;
	const reviewState =
		source.state === "failed" || source.state === "unavailable" || failedDecode
			? "unavailable"
			: url && decoded?.url === url && decoded.ready
				? "ready"
				: "loading";
	// Revoke readiness in the same commit as a changed URL, before the row can
	// accept another click. The network result alone does not prove the image
	// is usable by the renderer.
	useLayoutEffect(() => {
		onReviewState?.(attachment.id, reviewState);
	}, [attachment.id, onReviewState, reviewState]);
	const opener = useRef<HTMLButtonElement | null>(null);
	const retryFocus = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: publish only resource changes, not callback identity.
	useEffect(() => {
		register(attachment.id, source);
	}, [attachment.id, source.state, url]);
	useEffect(() => {
		if (source.state === "ready" && retryFocus.current) {
			retryFocus.current = false;
			if (document.activeElement === document.body)
				opener.current?.focus({ preventScroll: true });
		}
	}, [source.state]);
	const label = t("ui.teamBridge.attachments.position", {
		index: String(index + 1),
		count: String(count),
	});
	/* The member transcript's tile and failure, so an owner reading the audit
	 * sees the same picture a member does. No Save on an audit PICTURE (#1634):
	 * decision a-fdf0 added a download for generic files only. */
	if (
		source.state === "failed" ||
		source.state === "unavailable" ||
		failedDecode
	)
		return (
			<InlineImageFailure
				box={slot.box}
				label={label}
				copy={t("ui.teamBridge.attachmentCard.unavailable")}
				kind={source.state === "failed" ? "failed" : "unavailable"}
				retryLabel={t("ui.teamBridge.attachments.retry_load")}
				onRetry={
					source.state === "failed"
						? () => {
								retryFocus.current = true;
								setAttempt((value) => value + 1);
							}
						: undefined
				}
			/>
		);
	return (
		<InlineImageTile
			url={url}
			box={slot.box}
			fit={slot.fit}
			overflow={slot.overflow}
			label={label}
			busy={!url}
			onImageReadiness={
				onReviewState && url ? (ready) => setDecoded({ url, ready }) : undefined
			}
			openLabel={t("ui.teamBridge.attachments.open", {
				index: String(index + 1),
				count: String(count),
			})}
			buttonRef={(node) => {
				opener.current = node;
				openerRef(node);
			}}
			onOpen={onOpen}
		/>
	);
}

/** Audit owner scope is captured by the transcript, never inferred from the
 * sender/agent or replaced with membership authority. Without it, retain the
 * older metadata-only presentation; no adapter or route fallback is selected. */
export function AuditAttachmentGroup({
	attachments,
	count,
	scope,
	compact = false,
	files = [],
	fileCount = files.length,
	review,
}: {
	attachments: readonly BridgeAttachmentDescriptor[];
	count: number;
	/* S3b files: cards with one action, Save (decision a-fdf0 replaced the
	 * metadata-only rule of #1634 for files). The audit grants the human owner
	 * file bytes server-side; a card reads them through the owner-audit relay in
	 * file mode, only when pressed and only under this row's captured `scope`.
	 * Without a scope the cards offer nothing, and nothing is ever previewed. */
	files?: readonly BridgeFileDescriptor[];
	fileCount?: number;
	scope:
		| (OwnerAuditScope & { conversationId: string; messageId: string })
		| null;
	compact?: boolean;
	review?: {
		revision: string;
		onState: (id: string, state: AuditReviewState) => void;
	};
}) {
	useI18nLocale();
	const authorityKey = JSON.stringify(
		scope
			? [scope.accountId, scope.tenantId, scope.conversationId, scope.messageId]
			: null,
	);
	const currentAuthority = useRef(authorityKey);
	currentAuthority.current = authorityKey;
	const [opened, setOpened] = useState<{ key: string; id: string | null }>({
		key: authorityKey,
		id: null,
	});
	const openId = opened.key === authorityKey ? opened.id : null;
	const setOpenId = (id: string | null) => {
		if (currentAuthority.current === authorityKey)
			setOpened({ key: authorityKey, id });
	};
	const [resourceEntry, setResourceEntry] = useState<{
		key: string;
		values: Record<string, AuditImageState>;
	}>({ key: authorityKey, values: {} });
	// Reject the pre-effect account-switch render too, including an open viewer.
	// Caller remounts are an extra cleanup boundary, not the authority guard.
	const resources =
		resourceEntry.key === authorityKey ? resourceEntry.values : {};
	const restore = useRef<HTMLElement | null>(null);
	const openers = useRef<Record<string, HTMLButtonElement | null>>({});
	const images = attachments.filter(
		(item) => auditAttachmentAction(item) === "preview",
	);
	const activeIndex = images.findIndex((item) => item.id === openId);
	const active = activeIndex >= 0 ? images[activeIndex] : undefined;
	const activeSource = active ? resources[active.id] : undefined;
	useEffect(() => {
		if (openId && !active) setOpened({ key: authorityKey, id: null });
	}, [openId, active, authorityKey]);
	const register = (id: string, value: AuditImageState) => {
		if (currentAuthority.current !== authorityKey) return;
		setResourceEntry((old) => {
			const values = old.key === authorityKey ? old.values : {};
			const previous = values[id];
			if (
				old.key === authorityKey &&
				previous?.state === value.state &&
				(value.state !== "ready" ||
					(previous.state === "ready" && previous.url === value.url))
			)
				return old;
			return { key: authorityKey, values: { ...values, [id]: value } };
		});
	};
	const label = active
		? t("ui.teamBridge.attachments.position", {
				index: String(activeIndex + 1),
				count: String(images.length),
			})
		: "";
	return (
		<>
			<BridgeAttachmentGroup
				attachments={attachments.map((item) => ({
					...item,
					state: item.state ?? "unknown",
				}))}
				count={count}
				compact={compact}
				files={files}
				fileCount={fileCount}
				inlineReview={Boolean(review)}
				readFile={
					scope
						? (file) =>
								TeamBridgeOwnerAuditApi.fileBytes({
									...scope,
									attachmentId: file.id,
								})
						: undefined
				}
				renderPreview={
					scope
						? (attachment, _index, slot) =>
								auditAttachmentAction(attachment) === "preview" ? (
									<AuditImage
										key={auditAttachmentKey({
											...scope,
											attachmentId: attachment.id,
											reviewRevision: review?.revision,
										})}
										scope={{
											...scope,
											attachmentId: attachment.id,
											reviewRevision: review?.revision,
										}}
										attachment={attachment}
										slot={slot}
										index={images.findIndex(
											(item) => item.id === attachment.id,
										)}
										count={images.length}
										register={register}
										onReviewState={review?.onState}
										openerRef={(node) => {
											openers.current[attachment.id] = node;
										}}
										onOpen={() => {
											restore.current = openers.current[attachment.id];
											setOpenId(attachment.id);
										}}
									/>
								) : null
						: undefined
				}
			/>
			<ImageLightbox
				open={Boolean(scope && active)}
				src={activeSource?.state === "ready" ? activeSource.url : undefined}
				pending={Boolean(
					active && (!activeSource || activeSource.state === "loading"),
				)}
				label={label}
				restoreFocusTo={restore}
				onOpenChange={(open) => {
					if (!open) setOpenId(null);
				}}
				fallback={<p>{t("ui.teamBridge.attachmentCard.unavailable")}</p>}
				group={
					images.length > 1 && active
						? {
								index: activeIndex,
								count: images.length,
								onPrev: () =>
									setOpenId(
										images[(activeIndex - 1 + images.length) % images.length]
											.id,
									),
								onNext: () =>
									setOpenId(images[(activeIndex + 1) % images.length].id),
							}
						: undefined
				}
			/>
		</>
	);
}
