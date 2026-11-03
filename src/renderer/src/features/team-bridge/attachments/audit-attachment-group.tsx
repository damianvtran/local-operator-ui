import {
	type OwnerAuditScope,
	TeamBridgeOwnerAuditApi,
} from "@shared/api/local-operator/team-bridge-owner-audit-api";
import { ImageLightbox } from "@shared/components/common/image-lightbox";
import { Spinner } from "@shared/components/common/spinner";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { ImageOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AttachmentFrame } from "../../chat/components/message-item/attachment-frame";
import {
	type BridgeAttachmentDescriptor,
	attachmentBox,
} from "./attachment-model";
import {
	type AuditAttachmentScope,
	auditAttachmentAction,
	auditAttachmentKey,
} from "./audit-attachment-scope";
import { BridgeAttachmentGroup } from "./bridge-attachment-group";
import {
	type AuditImageState,
	auditFailure,
	useAuditAttachment,
} from "./use-audit-attachment";

function AuditImage({
	scope,
	attachment,
	box,
	index,
	count,
	register,
	onOpen,
	openerRef,
}: {
	scope: AuditAttachmentScope;
	attachment: BridgeAttachmentDescriptor;
	box: { width: number; height: number };
	index: number;
	count: number;
	register: (id: string, value: AuditImageState) => void;
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
	if (source.state === "failed" || source.state === "unavailable")
		return (
			<div
				style={{ width: box.width, height: box.height, maxWidth: "100%" }}
				className="flex flex-col items-center justify-center gap-1 break-words bg-sunken p-1 text-center text-[12px] text-ink-muted"
			>
				{box.width < 128 || box.height < 96 ? (
					<span
						role="img"
						aria-label={t("ui.teamBridge.attachmentCard.unavailable")}
					>
						<ImageOff size={16} aria-hidden="true" />
					</span>
				) : (
					<span>{t("ui.teamBridge.attachmentCard.unavailable")}</span>
				)}
				{source.state === "failed" && (
					<button
						type="button"
						className="min-h-6 rounded-sm px-2 text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
						onClick={() => {
							retryFocus.current = true;
							setAttempt((value) => value + 1);
						}}
					>
						{t("ui.teamBridge.attachments.retry_load")}
					</button>
				)}
			</div>
		);
	return (
		<button
			type="button"
			disabled={!url}
			aria-busy={!url}
			aria-label={t("ui.teamBridge.attachments.open", {
				index: String(index + 1),
				count: String(count),
			})}
			ref={(node) => {
				opener.current = node;
				openerRef(node);
			}}
			onClick={onOpen}
			className="group/tile block max-w-full cursor-zoom-in rounded-sm leading-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus disabled:cursor-progress"
		>
			<AttachmentFrame
				boundary="control"
				style={{ ...box, maxWidth: "100%" }}
				data-attachment-reserved={url ? undefined : ""}
			>
				{url && (
					<img
						src={url}
						draggable={false}
						className="size-full object-cover"
						alt={t("ui.teamBridge.attachments.position", {
							index: String(index + 1),
							count: String(count),
						})}
					/>
				)}
			</AttachmentFrame>
		</button>
	);
}

function AuditFileSave({ scope }: { scope: AuditAttachmentScope }) {
	const [state, setState] = useState<
		"idle" | "pending" | "saved" | "failed" | "unavailable"
	>("idle");
	const epoch = useRef(0);
	useEffect(
		() => () => {
			epoch.current += 1;
		},
		[],
	);
	const save = async () => {
		const issued = epoch.current;
		setState("pending");
		try {
			const saved = await TeamBridgeOwnerAuditApi.saveAttachment(scope);
			if (issued === epoch.current) setState(saved ? "saved" : "idle");
		} catch (error) {
			if (issued === epoch.current) setState(auditFailure(error));
		}
	};
	if (state === "unavailable")
		return (
			<div className="min-h-16">
				<p>{t("ui.teamBridge.attachmentCard.unavailable")}</p>
			</div>
		);
	return (
		<div className="min-h-16 space-y-1">
			<button
				type="button"
				disabled={state === "pending"}
				aria-busy={state === "pending"}
				onClick={() => void save()}
				className="inline-flex min-h-6 items-center gap-1 rounded-sm px-2 text-accent hover:bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:text-ink-muted"
			>
				{state === "pending" && <Spinner size="xs" />}
				{t(
					state === "failed"
						? "ui.teamBridge.attachments.retry_load"
						: "ui.teamBridge.attachmentCard.download",
				)}
			</button>
			<p aria-live="polite" className="min-h-8">
				{state === "saved"
					? t("ui.teamBridge.attachmentCard.saved")
					: state === "failed"
						? t("ui.teamBridge.attachmentCard.unavailable")
						: null}
			</p>
		</div>
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
}: {
	attachments: readonly BridgeAttachmentDescriptor[];
	count: number;
	scope:
		| (OwnerAuditScope & { conversationId: string; messageId: string })
		| null;
	compact?: boolean;
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
				renderPreview={
					scope
						? (attachment) =>
								auditAttachmentAction(attachment) === "preview" ? (
									<AuditImage
										key={auditAttachmentKey({
											...scope,
											attachmentId: attachment.id,
										})}
										scope={{ ...scope, attachmentId: attachment.id }}
										attachment={attachment}
										box={attachmentBox(
											attachment,
											attachments.length === 1,
											compact,
										)}
										index={images.findIndex(
											(item) => item.id === attachment.id,
										)}
										count={images.length}
										register={register}
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
				renderAction={
					scope && TeamBridgeOwnerAuditApi.canSaveAttachment()
						? (attachment) =>
								auditAttachmentAction(attachment) === "download" ? (
									<AuditFileSave
										key={auditAttachmentKey({
											...scope,
											attachmentId: attachment.id,
										})}
										scope={{ ...scope, attachmentId: attachment.id }}
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
