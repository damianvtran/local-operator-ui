/**
 * The asset composer: start a conversation about the selected asset, or
 * continue the one already linked to it.
 *
 * THE FIRST MESSAGE IS THE CALLER'S, as the design contract requires: the
 * renderer creates the session through the app's one create path, sends the
 * prompt through the ordinary message route, and only then records the link on
 * the asset. That ordering means a failed send never leaves an asset pointing
 * at an empty conversation.
 *
 * MEDIA IS ATTACHED WHERE THE WIRE CAN CARRY IT. `sessions.message`'s `images`
 * field takes base64 bytes, so an image asset rides inside the first prompt
 * (bounded by the contract's own size ceiling). There is NO audio field on that
 * op today: an audio asset is named by its display path/digest in the prompt
 * text instead, and that contract gap is recorded in the feature's report
 * rather than faked by sending audio through `images`.
 *
 * THE LINKED-CHAT ROW IS THE ASSOCIATION'S ONLY VISIBLE STATE: once the asset
 * has a chat, the composer becomes a continue box, and the row offers Open
 * chat. It sits inside the same borderless block, with no divider above the
 * composer - the design's own rule for this surface.
 */

import { openConversation } from "@features/chat/open-conversation";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { Button, Textarea } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { showErrorToast } from "@shared/utils/toast-manager";
import { ArrowUp, Link2, LoaderCircle, X } from "lucide-react";
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { DesktopRequest } from "../../../../../shared/desktop-contract";
import type { DesktopLibraryAsset } from "../../../../../shared/desktop-control-contract";
import {
	useLibraryBytes,
	useLinkAssetChat,
	useUnlinkAssetChat,
} from "../hooks/use-library-queries";
import { assetDisplayName } from "../library-model";

type LibraryComposerProps = {
	asset: DesktopLibraryAsset;
	/** A counter the page bumps when the menu's "Ask about this asset" fires. */
	focusSignal: number;
	/** Short previews reserve the 152px footer, not 176px (design spec §5). */
	compact?: boolean;
};

/** The MIME types `sessionImage` admits. */
type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

const IMAGE_MIME = new Set<ImageMime>([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
]);

/** The base64 string limit in the `sessionImage` contract. */
const MAX_INLINE_IMAGE_BASE64 = 1_000_000;

/** Encode bytes without spreading a megabyte onto the call stack. */
function toBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunk) {
		binary += String.fromCharCode(
			...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)),
		);
	}
	return btoa(binary);
}

/** The reference the first prompt carries, whichever store the asset lives in. */
function assetReference(asset: DesktopLibraryAsset): string {
	const location =
		asset.ref.display_path ||
		asset.ref.path ||
		(asset.ref.digest ? `attachment digest ${asset.ref.digest}` : asset.id);
	return `${assetDisplayName(asset)} (${location})`;
}

export const LibraryComposer: FC<LibraryComposerProps> = ({
	asset,
	focusSignal,
	compact = false,
}) => {
	useI18nLocale();
	const navigate = useNavigate();
	const inputRef = useRef<HTMLTextAreaElement>(null);

	/**
	 * One-to-three visible lines: 24px line height, 72px ceiling, then the
	 * textarea scrolls internally. The footer's own height is fixed, so typing
	 * never reflows the viewer (design spec §5).
	 */
	const grow = () => {
		const node = inputRef.current;
		if (!node) return;
		node.style.height = "24px";
		node.style.height = `${Math.min(72, Math.max(24, node.scrollHeight))}px`;
	};
	const [value, setValue] = useState("");
	const [sending, setSending] = useState(false);
	/*
	 * THE ACCEPTED SEND IS THE COMMIT POINT. A created session whose link write
	 * failed must not be forgotten: the message is already in the transcript,
	 * and the next Send creating a second session would submit the same prompt
	 * again and split the conversation. `pendingSessionId` survives that failure
	 * (and a dock/full-view remount of this component is not promised, so it is
	 * deliberately local state rather than a store entry), while `linkFailed`
	 * asks for the retry row.
	 */
	const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
	const [linkFailed, setLinkFailed] = useState(false);
	const link = useLinkAssetChat();
	const unlink = useUnlinkAssetChat();
	/*
	 * Only an image needs bytes at send time. The hook stays disabled for every
	 * other kind, so selecting a document does not download it twice (the
	 * viewer already has the bytes).
	 */
	const image = useLibraryBytes(asset.id, "content", asset.kind === "image");

	useEffect(() => {
		if (focusSignal === 0) return;
		inputRef.current?.focus();
	}, [focusSignal]);

	const send = async () => {
		const text = value.trim();
		if (!text || sending) return;
		setSending(true);
		try {
			const store = useCanonicalSessionsStore.getState();
			let sessionId = asset.chat?.session_id ?? pendingSessionId ?? null;
			if (!sessionId) {
				sessionId = await store.createSession(store.cwd || "~");
				if (!sessionId) {
					throw new Error(
						store.error ?? t("ui.library.composer.could_not_start"),
					);
				}
			}
			const body: Extract<DesktopRequest, { op: "sessions.message" }> = {
				op: "sessions.message",
				sessionId,
				requestId: crypto.randomUUID(),
				text: `${text}\n\n${assetReference(asset)}`,
			};
			const mime = (asset.ref.content_type || image.mimeType) as ImageMime;
			if (asset.kind === "image" && image.bytes && IMAGE_MIME.has(mime)) {
				const data = toBase64(image.bytes);
				if (data.length <= MAX_INLINE_IMAGE_BASE64) {
					body.images = [{ data_b64: data, mime_type: mime }];
				}
			}
			await desktopResult(body);
			/*
			 * The backend accepted the turn: the draft is committed and clears
			 * HERE, before the association write. A later link refusal must not
			 * leave the accepted message's words in the composer for a second
			 * submit.
			 */
			setValue("");
			/*
			 * Only a NEW association is written. Continuing the linked chat must
			 * not re-record the link: the route verifies the session and would
			 * accept the same id, but a second write is a needless round trip and
			 * makes a link failure look like a send failure.
			 */
			if (!asset.chat && !pendingSessionId) {
				try {
					await link.mutateAsync({ id: asset.id, sessionId });
				} catch (error) {
					/*
					 * Partial success: say what actually happened, keep the session
					 * id for the next Send, and do not navigate away from the
					 * asset whose link is still missing.
					 */
					setPendingSessionId(sessionId);
					setLinkFailed(true);
					showErrorToast(
						error instanceof Error && error.message
							? t("ui.library.composer.link_failed", {
									message: error.message,
								})
							: t("ui.library.composer.link_failed_short"),
					);
					return;
				}
			}
			if (pendingSessionId) {
				try {
					await link.mutateAsync({ id: asset.id, sessionId });
					setPendingSessionId(null);
					setLinkFailed(false);
				} catch {
					setLinkFailed(true);
					showErrorToast(t("ui.library.composer.link_failed_short"));
					return;
				}
			}
			await openConversation(navigate, sessionId);
		} catch (error) {
			showErrorToast(
				error instanceof Error && error.message
					? error.message
					: t("ui.library.composer.not_sent"),
			);
		} finally {
			setSending(false);
		}
	};

	const linked = asset.chat;
	const retryLink = async () => {
		const sessionId = pendingSessionId ?? asset.chat?.session_id;
		if (!sessionId) return;
		try {
			await link.mutateAsync({ id: asset.id, sessionId });
			setPendingSessionId(null);
			setLinkFailed(false);
		} catch {
			showErrorToast(t("ui.library.composer.link_failed_short"));
		}
	};

	return (
		<div
			className={cn(
				"mx-auto flex w-[min(calc(100%-24px),720px)] flex-col justify-end gap-2 pb-4",
				compact ? "h-38" : "h-44",
			)}
			data-library-composer=""
		>
			{linkFailed && pendingSessionId && (
				<div
					className="flex flex-wrap items-center gap-2 rounded-md bg-sunken px-2 py-1 text-meta text-ink"
					data-library-link-failed=""
				>
					<span className="min-w-0 flex-1">
						{t("ui.library.composer.message_sent_link_failed")}
					</span>
					<Button variant="ghost" size="sm" onClick={() => void retryLink()}>
						{t("ui.library.composer.retry_link")}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => void openConversation(navigate, pendingSessionId)}
					>
						{t("ui.library.composer.open_chat")}
					</Button>
				</div>
			)}
			{linked && (
				<div className="flex items-center gap-2 text-meta text-ink-muted">
					<Link2 size={13} aria-hidden="true" />
					<span className="min-w-0 flex-1 truncate">
						{t("ui.library.composer.chat_about", {
							title: linked.title || linked.session_id,
						})}
					</span>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => void openConversation(navigate, linked.session_id)}
					>
						{t("ui.library.composer.open_chat")}
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("ui.library.composer.unlink")}
						onClick={() => unlink.mutate({ id: asset.id })}
					>
						<X aria-hidden="true" />
					</Button>
				</div>
			)}
			<div
				data-glass-region="composer"
				className={cn(
					"flex items-end gap-2 rounded-lg bg-elevated p-2",
					"focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
				)}
			>
				<Textarea
					ref={inputRef}
					rows={1}
					value={value}
					onChange={(event) => {
						setValue(event.target.value);
						grow();
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							void send();
						}
					}}
					placeholder={
						linked
							? t("ui.library.composer.continue_placeholder")
							: t("ui.library.composer.ask_placeholder")
					}
					aria-label={t("ui.library.composer.label")}
					className="h-6 min-h-6 max-h-18 resize-none overflow-y-auto border-0 bg-transparent px-0 py-0 text-body leading-6 shadow-none focus-visible:outline-none"
				/>
				<Button
					variant="primary"
					size="icon-sm"
					disabled={!value.trim() || sending}
					aria-label={t("ui.library.composer.send")}
					onClick={() => void send()}
				>
					{sending ? (
						<LoaderCircle
							aria-hidden="true"
							className="motion-safe:animate-spin"
						/>
					) : (
						<ArrowUp aria-hidden="true" />
					)}
				</Button>
			</div>
		</div>
	);
};
