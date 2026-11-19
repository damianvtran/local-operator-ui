/**
 * The asset composer: start a conversation about the selected asset, or
 * continue the one already linked to it — in place, beside the asset.
 *
 * THE FIRST MESSAGE IS THE CALLER'S, as the design contract requires: the
 * renderer creates the session through the app's one create path, sends the
 * prompt through the ordinary message route, and only then records the link on
 * the asset. That ordering means a failed send never leaves an asset pointing
 * at an empty conversation.
 *
 * IT NO LONGER NAVIGATES. The send used to end in
 * `openConversation(navigate, sessionId)`, which threw the reader out of the
 * Library and into `/chat` at the exact moment they asked about the asset on
 * screen. The conversation is now shown BELOW the asset (`library-trajectory`),
 * so the send stays put and `onSessionChange` hands the id to the preview in the
 * same commit, which mounts the trajectory without waiting for the asset query
 * to re-read the row. The explicit Open-chat controls stay: those are presses
 * the user makes, not an automatic jump.
 *
 * IT IS THE SHARED COMPOSER (operator, 2026-10-05: one composer for every
 * send). The hand-rolled `Textarea` + `Button` pair is gone; the box is the
 * app's own `MessageInput`, mounted the way `project-quick-send.tsx` mounts it on
 * a non-chat surface — `ownGutter` (the 24px inset exists to align a box with a
 * transcript's scrollbar gutter, and this panel's own padding is the edge),
 * `transcriptless` (the canonical trajectory above is not the legacy `Message[]`
 * this prop takes), a draft key that is one draft per conversation, and a
 * `sessionStatus` strip fed by the same one-shot `sessions.get` read the
 * project strip uses.
 *
 * SEND PATH, AND WHAT IT DELIBERATELY DOES NOT DO (v1). The send is the
 * EXISTING flow: `sessions.create` when the asset has no chat yet, then
 * `sessions.message` with the asset reference appended and any image encoded by
 * the shared `attachment-encode` helper, then the link write for a NEW
 * association only. A message typed while the linked conversation is streaming
 * is sent with `mode: "steer"`, so it joins the running turn instead of
 * queueing behind it (the chat page's own rule).
 *
 * What it does NOT do is go through the canonical store's `admitChatDraft`: there
 * is no renderer-side optimistic echo and no store-held claim on a failed send,
 * so the user's own row reaches the trajectory when the backend's stream
 * delivers it. That is the gap the store path closes (echo at the press, the
 * retry/discard controls), and wiring it here would duplicate the chat page's
 * admission machinery on a surface that has no draft pane to hold the claim.
 *
 * MEDIA IS ATTACHED WHERE THE WIRE CAN CARRY IT. `sessions.message`'s `images`
 * field takes base64 bytes, so an image asset rides inside the prompt through
 * `encodeAttachments` — the same encoder every other send uses, rather
 * than a second base64 pipeline here. There is NO audio field on that op today:
 * an audio asset is named by its display path/digest in the prompt text
 * instead, and that contract gap is recorded rather than faked by sending audio
 * through `images`.
 */

import { encodeAttachments } from "@features/chat/utils/attachment-encode";
import {
	fileOverflowRefusal,
	imageOverflowRefusal,
	unreadableAttachmentRefusal,
} from "@features/chat/utils/attachment-read";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	MessageInput,
	type MessageInputHandle,
	type MessageInputProps,
} from "@shared/components/composer";
import { Button } from "@shared/components/ui";
import { useSessionSnapshot } from "@shared/hooks/use-session-snapshot";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { showErrorToast } from "@shared/utils/toast-manager";
import { Link2, X } from "lucide-react";
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
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
	/**
	 * The session this send resolved, reported the moment it exists.
	 *
	 * KEYED BY ASSET because the preview does not remount on an asset switch (the
	 * composer's own recovery map carries the same reason): a send for A that
	 * settles after the reader moved to B must not mount A's conversation under
	 * B. The preview holds these per asset id and stops mounting it once the
	 * linked row arrives from the query.
	 */
	onSessionChange: (assetId: string, sessionId: string) => void;
	/**
	 * Leave for `/chat`. The link-failed row's control is the page's own
	 * `openConversationFor`: `onSessionChange` only writes the preview's lifted
	 * id, so a press that used it navigated nowhere.
	 */
	onOpenChat: (sessionId: string) => void;
	/**
	 * Whether the linked-chat row renders. The preview passes false while the
	 * trajectory is mounted: its header already names the conversation and carries
	 * the unlink control, and two titles with two X controls for one link is the
	 * duplication this surface is being collapsed out of.
	 */
	showLinkedRow: boolean;
	/**
	 * Bumped by the preview when a turn settles, so the one-shot snapshot above is
	 * re-read and the status strip describes the conversation as it is now.
	 */
	refreshSignal?: number;
	/**
	 * The trajectory's live turn reading, when one is mounted. `undefined` means
	 * there is no live subscription here and the snapshot's own `streaming` is the
	 * only answer; a boolean is the live one and outranks it.
	 */
	streaming?: boolean;
};

/** Nothing above this box is the legacy `Message[]`; see `transcriptless`. */
const EMPTY_MESSAGES: MessageInputProps["messages"] = [];

/** The reference the first prompt carries, whichever store the asset lives in. */
function assetReference(asset: DesktopLibraryAsset): string {
	const location =
		asset.ref.display_path ||
		asset.ref.path ||
		(asset.ref.digest ? `attachment digest ${asset.ref.digest}` : asset.id);
	return `${assetDisplayName(asset)} (${location})`;
}

/**
 * An image asset as a composer attachment.
 *
 * A DATA URL rather than the path: the viewer's bytes are already in hand, and
 * `encodeAttachments` accepts both forms. Digest-only assets have no path
 * at all, so the data URL is the only form that works for every image row.
 */
function imageAttachment(
	asset: DesktopLibraryAsset,
	bytes: Uint8Array | null,
	mimeType: string,
): string | null {
	if (asset.kind !== "image" || !bytes || bytes.length === 0) return null;
	let binary = "";
	const chunk = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunk) {
		binary += String.fromCharCode(
			...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)),
		);
	}
	const mime = (asset.ref.content_type || mimeType) as string;
	return `data:${mime};base64,${btoa(binary)}`;
}

export const LibraryComposer: FC<LibraryComposerProps> = ({
	asset,
	focusSignal,
	onSessionChange,
	showLinkedRow,
	onOpenChat,
	refreshSignal = 0,
	streaming: liveStreaming,
}) => {
	useI18nLocale();
	const inputRef = useRef<MessageInputHandle | null>(null);
	const capabilities = useDesktopCapabilities();
	/*
	 * The linked chat's readings, read one-shot when the session changes and
	 * handed to the composer's own status strip. The project strip's shape, not a
	 * copy of its code: `useSessionSnapshot` is that read, shared.
	 */
	const { frontend, refresh } = useSessionSnapshot();
	/*
	 * THE RE-ENTRY GUARD IS A REF, and it is set BEFORE the first await. React
	 * state is a render behind, so a second Enter in the same tick read
	 * `sending === false` and ran the whole send again - a second
	 * `sessions.create` when the asset had no chat yet, which split one question
	 * into two conversations. The ref is synchronous; `sending` stays for the
	 * paint.
	 */
	const sendingRef = useRef(false);
	const [sending, setSending] = useState(false);
	/*
	 * THE ACCEPTED SEND IS THE COMMIT POINT. A created session whose link write
	 * failed must not be forgotten: the message is already in the transcript, and
	 * the next Send creating a second session would submit the same prompt again
	 * and split the conversation. `recoveries` survives that failure and is keyed
	 * by ASSET, because one composer instance serves every selection (the preview
	 * does not remount on an asset change), so a single pending id would show A's
	 * partial-success row on B and Retry would link B to A's session.
	 */
	const [recoveries, setRecoveries] = useState<Record<string, string>>({});
	const [linkFailedFor, setLinkFailedFor] = useState<string | null>(null);
	const sessionId = asset.chat?.session_id ?? recoveries[asset.id] ?? null;
	const pendingSessionId = recoveries[asset.id] ?? null;
	const linkFailed = linkFailedFor === asset.id;
	const link = useLinkAssetChat();
	const unlink = useUnlinkAssetChat();
	/*
	 * Only an image needs bytes at send time. The hook stays disabled for every
	 * other kind, so selecting a document does not download it twice (the viewer
	 * already has the bytes).
	 */
	const image = useLibraryBytes(asset.id, "content", asset.kind === "image");

	/*
	 * ONE KEY IS ONE DRAFT. Before a session exists the key is the asset's own
	 * `library:<id>`, which cannot collide with a minted session id; afterwards it
	 * is the session id, so this box holds the same draft the chat pane for that
	 * conversation holds. `MessageInput` re-seeds from the key whenever it
	 * changes, which is what makes the hand-over on the first send a no-op for
	 * text the user is still typing.
	 */
	const draftKey = sessionId ?? `library:${asset.id}`;

	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshSignal is the signal, not a value the body reads.
	useEffect(() => {
		if (sessionId) void refresh(sessionId);
	}, [sessionId, refresh, refreshSignal]);

	useEffect(() => {
		if (focusSignal === 0) return;
		inputRef.current?.focusInput();
	}, [focusSignal]);

	const retryLink = async () => {
		const target = pendingSessionId ?? asset.chat?.session_id;
		if (!target) return;
		try {
			await link.mutateAsync({ id: asset.id, sessionId: target });
			setRecoveries((previous) => {
				const next = { ...previous };
				delete next[asset.id];
				return next;
			});
			setLinkFailedFor(null);
		} catch {
			showErrorToast(t("ui.library.composer.link_failed_short"));
		}
	};

	const send: MessageInputProps["onSendMessage"] = async (
		content,
		attachments,
		onEchoPainted,
	) => {
		const text = content.trim();
		if (!text || sendingRef.current) return false;
		sendingRef.current = true;
		setSending(true);
		const streaming = liveStreaming ?? frontend?.streaming === true;
		let target: string | null = sessionId;
		try {
			const extra = imageAttachment(asset, image.bytes, image.mimeType);
			const { images, files, failures, overflow, fileOverflow } =
				await encodeAttachments(
					extra ? [...attachments, extra] : attachments,
					content,
				);
			/*
			 * The encoder's two refusals are this surface's own "put the text back"
			 * answer (`false`), reported with the same authored sentences the chat
			 * and the mini use rather than a second vocabulary: a message whose
			 * attachment could not be read, or did not fit the transport, must not
			 * leave as a different message than the one the user assembled.
			 */
			const unreadableRefusal = unreadableAttachmentRefusal(failures);
			if (unreadableRefusal) {
				showErrorToast(unreadableRefusal);
				return false;
			}
			const overflowRefusal = imageOverflowRefusal(overflow);
			if (overflowRefusal) {
				showErrorToast(overflowRefusal);
				return false;
			}
			const fileOverflowMessage = fileOverflowRefusal(fileOverflow);
			if (fileOverflowMessage) {
				showErrorToast(fileOverflowMessage);
				return false;
			}
			if (!target) {
				const store = useCanonicalSessionsStore.getState();
				target = await store.createSession(store.cwd || "~");
				if (!target) {
					throw new Error(
						store.error ?? t("ui.library.composer.could_not_start"),
					);
				}
			}
			/*
			 * A constant after the create hop, so the link write below and the
			 * `onSessionChange` hand-over close over a value TypeScript can prove
			 * non-null (`let target` would widen back to `string | null` inside a
			 * callback).
			 */
			const targetSession = target;
			const body: Extract<DesktopRequest, { op: "sessions.message" }> = {
				op: "sessions.message",
				sessionId: targetSession,
				requestId: crypto.randomUUID(),
				text: `${text}\n\n${assetReference(asset)}`,
			};
			if (images.length > 0) body.images = images;
			if (files.length > 0) body.files = files;
			/*
			 * A MESSAGE TYPED MID-TURN STEERS IT. The wire op takes a `mode`, and the
			 * chat page's rule is the one this follows: a turn that is running is
			 * joined rather than queued behind, so a reader who asks a follow-up while
			 * the agent is still working does not wait for a second turn to start.
			 * `streaming` is the trajectory's live reading when one is mounted (the
			 * composer's own snapshot cannot know a turn started after this panel
			 * mounted), falling back to the snapshot's `streaming` on a surface with
			 * no live subscription.
			 */
			if (streaming) body.mode = "steer";
			await desktopResult(body);
			onEchoPainted?.();
			/*
			 * THE SESSION FIXES THE TRAJECTORY IN THE SAME COMMIT. Set before the
			 * link write so a link refusal still leaves the conversation on screen:
			 * the message landed, and hiding it would say otherwise.
			 */
			setRecoveries((previous) => ({
				...previous,
				[asset.id]: targetSession,
			}));
			onSessionChange(asset.id, targetSession);
			/*
			 * Only a NEW association is written. Continuing the linked chat must
			 * not re-record the link.
			 */
			if (!asset.chat) {
				try {
					await link.mutateAsync({
						id: asset.id,
						sessionId: targetSession,
					});
					setRecoveries((previous) => {
						const next = { ...previous };
						delete next[asset.id];
						return next;
					});
					setLinkFailedFor(null);
				} catch (error) {
					/*
					 * Partial success: say what actually happened, keep the session
					 * id for the next Send and for Retry, and do not navigate away
					 * from the asset whose link is still missing.
					 */
					setLinkFailedFor(asset.id);
					showErrorToast(
						error instanceof Error && error.message
							? t("ui.library.composer.link_failed", {
									message: error.message,
								})
							: t("ui.library.composer.link_failed_short"),
					);
				}
			}
			return true;
		} catch (error) {
			showErrorToast(
				error instanceof Error && error.message
					? error.message
					: t("ui.library.composer.not_sent"),
			);
			return false;
		} finally {
			sendingRef.current = false;
			setSending(false);
		}
	};

	const linked = asset.chat;
	return (
		<div
			/* MessageInput contributes pt-2/pb-4: these outer tracks leave the
			 * visible form with 20px above and below, not 20px/28px. */
			className="flex flex-col gap-2 bg-sunken px-4 pt-3 pb-1"
			data-library-composer=""
			data-sending={sending ? "" : undefined}
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
						onClick={() => onOpenChat(pendingSessionId)}
					>
						{t("ui.library.composer.open_chat")}
					</Button>
				</div>
			)}
			{/*
			 * THE LINKED ROW NO LONGER DRIVES THE SEND, IT DESCRIBES IT. With the
			 * trajectory in the panel this line would duplicate its header, so it
			 * only appears while the trajectory is NOT the thing being shown: a
			 * link that exists on the asset but whose panel is not mounted (a
			 * missing session id, or the row arriving before the preview's own
			 * state). Otherwise the unlink control lives in the trajectory header,
			 * where the conversation it acts on is on screen.
			 */}
			{linked && showLinkedRow && (
				<div className="flex items-center gap-2 text-meta text-ink-muted">
					<Link2 size={13} aria-hidden="true" />
					<span className="min-w-0 flex-1 truncate">
						{t("ui.library.composer.chat_about", {
							title: linked.title || linked.session_id,
						})}
					</span>
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
			{/*
			 * NO HOST-SIDE DIMMING. `sending` used to dim and disable this whole
			 * block with `opacity-60` — the "disabled changes colour, never opacity"
			 * rule broken on a surface that also has a real affordance: the
			 * composer's own send lock owns the disabled colour and the pending
			 * sentence. The wrapper carries layout only; the ref guard above is what
			 * refuses a second press.
			 */}
			<div className="min-w-0" data-sending={sending ? "" : undefined}>
				<MessageInput
					ref={inputRef}
					conversationId={draftKey}
					messages={EMPTY_MESSAGES}
					isLoading={false}
					ownGutter
					transcriptless
					/*
					 * A SECONDARY INTERACTION IN A PANEL, SO IT DOES NOT CLAIM THE
					 * CARET: opening an asset must not put the keyboard in this box and
					 * scroll the panel to it. The doors the user opens themselves still
					 * focus — a click into the box, the menu's "Ask about this asset"
					 * (`focusSignal`), and the composer's own post-send hand-back.
					 */
					autoFocus={false}
					placeholderOverride={
						linked || sessionId
							? t("ui.library.composer.continue_placeholder")
							: t("ui.library.composer.ask_placeholder")
					}
					cwd={frontend?.cwd}
					cwdReadOnlyReason={t(
						"ui.projects.project_quick_send.quick_send_follows_the_conversation_s_directory",
					)}
					sessionStatus={
						frontend && sessionId
							? {
									frontend,
									costChannels: desktopFeatureEnabled(
										capabilities.data,
										"cost_channels",
									),
								}
							: undefined
					}
					onSendMessage={send}
				/>
			</div>
		</div>
	);
};
