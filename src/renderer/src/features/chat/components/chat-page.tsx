import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import type { ChatTarget } from "@shared/api/local-operator/profile-hooks";
import { ChatLayout } from "@shared/components/common/chat-layout";
import { useCanonicalSessionStream } from "@shared/hooks/use-canonical-session";
import { useDesktopWatchLease } from "@shared/hooks/use-desktop-watch-lease";
import { useScrollToBottom } from "@shared/hooks/use-scroll-to-bottom";
import { cn } from "@shared/lib/utils";
import {
	admitChatDraft,
	draftIdentityFor,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DESKTOP_MESSAGE_BUDGET_BYTES } from "../../../../../shared/desktop-contract";
import { PickerOutlet } from "../pickers/picker-registry";
import { type WireImage, boundImagesForBudget } from "../utils/bound-image";
import {
	messageBodyBytes,
	messageBudgetRefusal,
} from "../utils/message-budget";
import { ChatContent } from "./chat-content";
import { ChatSidebar } from "./chat-sidebar";
import type { MessageInputHandle } from "./message-input";
import { useSlashDispatch } from "./slash-dispatch";

const SESSION_ID = /^[a-f0-9]{12}$/;
const IMAGE_MIME_BY_EXT: Record<
	string,
	"image/png" | "image/jpeg" | "image/gif" | "image/webp"
> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
};

/**
 * Canonical admission carries images inline as `{data_b64, mime_type}`. The
 * composer holds attachments as paths or data URLs; only image types the
 * runtime accepts are encoded, anything else is left out rather than refused.
 *
 * The JSON transport budget for a message is 880,000 bytes - headroom under
 * the backend's real 900,000-byte control-frame limit, enforced by
 * `Prompt.nonempty` at
 * `local_operator/server/routes/desktop_sessions.py:101`. The earlier note
 * here claimed 256 KiB "see the backend contract", which the backend contract
 * contradicted: that number was an arbitrary transport literal 3.4x stricter
 * than what the server accepts, and one Retina screenshot exceeded it.
 *
 * Images are bounded CLIENT-SIDE before encoding, to the same 1024px long edge
 * the TUI applies (`bound-image.ts` cites the constants). Raising the budget
 * alone would not have been enough: unbounded screenshots are ~8.5 MB each, so
 * none of them fit at any budget this transport can offer.
 */
const IMAGE_DATA_URL = /^data:(image\/(png|jpeg|gif|webp));base64,(.+)$/;
const FILE_SCHEME = /^file:\/\//;

async function encodeImageAttachments(attachments: string[], text: string) {
	const images: WireImage[] = [];
	for (const attachment of attachments) {
		const dataUrl = IMAGE_DATA_URL.exec(attachment);
		if (dataUrl) {
			images.push({
				data_b64: dataUrl[3],
				mime_type: dataUrl[1] as (typeof IMAGE_MIME_BY_EXT)[string],
			});
			continue;
		}
		const ext = attachment.split(".").pop()?.toLowerCase() ?? "";
		const mime = IMAGE_MIME_BY_EXT[ext];
		if (!mime || !window.api?.readFile) continue;
		const read = await window.api.readFile(
			attachment.replace(FILE_SCHEME, ""),
			"base64",
		);
		if (read.success) images.push({ data_b64: read.data, mime_type: mime });
	}
	// Bound per image first, then check the TOTAL and step the whole set down
	// until the message fits. Several individually legal screenshots that do not
	// collectively fit is the common case, and it is not visible to a per-image
	// rule.
	return boundImagesForBudget(
		images.slice(0, 8),
		DESKTOP_MESSAGE_BUDGET_BYTES,
		(candidate) => messageBodyBytes(text, candidate),
	);
}

/** Each displayed identity owns its stream and composer. A candidate open is
 * prepared by the store first; changing rows never stops the outgoing runtime. */
function SessionPanel({
	identity,
	draftKey,
	sessionId,
	pendingNavigation,
}: {
	identity: string;
	draftKey: string | null;
	sessionId?: string;
	pendingNavigation: boolean;
}) {
	const canonical = useCanonicalSessionStream(sessionId, Boolean(sessionId));
	useDesktopWatchLease(sessionId, canonical.subscriptionId);
	const input = useRef<MessageInputHandle>(null);
	const container = useRef<HTMLDivElement>(null);
	const end = useRef<HTMLDivElement>(null);
	const draftIdentity = draftIdentityFor(draftKey, sessionId);
	const draft = useCanonicalSessionsStore((state) =>
		draftIdentity ? state.drafts[draftIdentity] : undefined,
	);
	const cwd = useCanonicalSessionsStore((state) => state.cwd);
	const setCwd = useCanonicalSessionsStore((state) => state.setCwd);
	const [admitting, setAdmitting] = useState(false);
	const sendLock = useRef(false);
	const lastCatalogueState = useRef("");
	const [sendError, setSendError] = useState<string | null>(null);
	const [sendErrorCode, setSendErrorCode] = useState<string | undefined>();
	const [options, setOptions] = useState(false);
	const [tab, setTab] = useState<"chat" | "raw">("chat");
	const { isFarFromBottom, scrollToBottom } = useScrollToBottom(
		50,
		container,
		canonical.transcript.records.length,
	);
	const busy = canonical.frontend?.streaming === true;
	const navigate = useNavigate();
	const rebind = (id: string) => {
		void useCanonicalSessionsStore
			.getState()
			.openSession(id)
			.then((ok) => {
				if (ok) navigate(`/chat/${id}`);
			});
	};
	const { dispatch, picker } = useSlashDispatch({
		sessionId,
		canonical,
		rebind,
		addMessage: (message) => canonical.addNote(message.message ?? ""),
	});
	useEffect(() => {
		if (draftKey) input.current?.focusInput();
	}, [draftKey]);
	useEffect(() => {
		if (!sessionId || !canonical.frontend) return;
		// Only metadata comes from the stream. Membership/order remain list-owned,
		// and attention merges by the durable revision rather than arrival time.
		const store = useCanonicalSessionsStore.getState();
		if (!store.sessions.some((row) => row.session_id === sessionId)) return;
		store.upsertSession({
			session_id: sessionId,
			title: canonical.frontend.conversation_title,
			attention: canonical.frontend.attention,
		});
	}, [sessionId, canonical.frontend]);
	useEffect(() => {
		const marker = JSON.stringify([
			sessionId,
			canonical.frontend?.streaming,
			canonical.frontend?.attention?.unseen,
			canonical.frontend?.active_agent,
			canonical.frontend?.active_team,
		]);
		if (!sessionId || marker === lastCatalogueState.current) return;
		lastCatalogueState.current = marker;
		void useCanonicalSessionsStore.getState().fetchSessions();
	}, [
		sessionId,
		canonical.frontend?.streaming,
		canonical.frontend?.attention?.unseen,
		canonical.frontend?.active_agent,
		canonical.frontend?.active_team,
	]);
	const send = async (
		content: string,
		attachments: string[],
	): Promise<boolean> => {
		const store = useCanonicalSessionsStore.getState();
		// Same identity the view reads, so a send can never address a different
		// draft than the one whose retained text and Discard control are shown.
		const key = draftIdentityFor(draftKey, sessionId);
		if (!key) return false;
		const previous = store.drafts[key];
		if (pendingNavigation || sendLock.current || previous?.pending)
			return false;
		sendLock.current = true;
		setAdmitting(true);
		setSendError(null);
		setSendErrorCode(undefined);
		try {
			if (await dispatch(content)) return true;
			if (!draftKey && !sessionId) return false;
			const gate = canonical.frontend?.pending_gate;
			if (gate && canonical.ownerEpoch && sessionId) {
				if (gate.kind === "approval") {
					const value = content.trim().toLowerCase();
					const yes = ["y", "yes", "approve", "ok", "allow"].includes(value);
					if (!yes && !["n", "no", "deny", "reject", "cancel"].includes(value))
						throw new Error("Reply yes or no to answer the approval request.");
					await desktopResult({
						op: "sessions.answer",
						sessionId,
						epoch: canonical.ownerEpoch,
						requestId: gate.request_id,
						approved: yes,
					});
				} else
					await desktopResult({
						op: "sessions.answer",
						sessionId,
						epoch: canonical.ownerEpoch,
						requestId: gate.request_id,
						value: content,
						questionIndex: gate.question_index,
					});
				return true;
			}
			const images = await encodeImageAttachments(attachments, content);
			// Refuse BEFORE admission, where the sizes are still known and the
			// composer is still editable. A refusal from the transport arrives after
			// the draft has latched, so its "send it again" advice is then refused by
			// the unchanged-payload guard and the user cannot drop an image to fit.
			const refusal = messageBudgetRefusal(content, images);
			if (refusal) {
				setSendError(refusal);
				return false;
			}
			const id = await admitChatDraft(
				key,
				{
					text: content,
					attachments,
					images,
					mode: busy ? "steer" : "prompt",
					cwd,
				},
				sessionId,
			);
			if (!id) return false;
			if (
				draftKey &&
				useCanonicalSessionsStore.getState().activeSessionId === id
			)
				navigate(`/chat/${id}`, { replace: true });
			void store.fetchSessions();
			return true;
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "The send could not be confirmed. Retry this draft.";
			setSendError(message);
			setSendErrorCode(
				error instanceof Error &&
					"code" in error &&
					typeof error.code === "string"
					? error.code
					: undefined,
			);
			return false;
		} finally {
			sendLock.current = false;
			setAdmitting(false);
		}
	};
	const stop = () => {
		if (sessionId)
			void desktopResult({
				op: "sessions.command",
				sessionId,
				requestId: crypto.randomUUID(),
				command: "stop",
			}).catch((error) =>
				setSendError(
					error instanceof Error
						? error.message
						: "Stop could not be confirmed.",
				),
			);
	};
	const loadedTarget =
		canonical.frontend?.active_team ||
		canonical.frontend?.active_agent ||
		draft?.target?.name;
	const title = draftKey
		? loadedTarget
			? `New chat with ${loadedTarget}`
			: "New chat"
		: canonical.frontend?.conversation_title || "Untitled chat";
	// active_agent/active_team come from the LIVE stream, so a cold session (no
	// running owner) reports nulls and the header fell back to the cwd, naming
	// nothing. The catalogue row's binding is the durable answer and is already
	// what the sidebar groups by, so it is the fallback rather than a second
	// source of truth: live values still win while an owner is attached.
	const boundRow = useCanonicalSessionsStore((state) =>
		sessionId
			? state.sessions.find((row) => row.session_id === sessionId)
			: undefined,
	);
	const loaded =
		[canonical.frontend?.active_agent, canonical.frontend?.active_team]
			.filter(Boolean)
			.join(" · ") ||
		[boundRow?.binding?.agent, boundRow?.binding?.team]
			.filter(Boolean)
			.join(" · ");
	const view = !sessionId
		? { ...canonical, status: "live" as const, error: null }
		: canonical;
	return (
		<div className="flex h-full min-h-0 flex-col">
			{draftKey && (
				<label
					className={cn(
						"flex items-center gap-2 border-b border-hairline px-4 py-2 text-meta text-ink-muted",
					)}
				>
					Working directory
					<input
						aria-label="New chat working directory"
						className={cn(
							"min-w-0 flex-1 rounded-md border border-control bg-surface px-2 py-1 text-ink",
						)}
						value={cwd}
						disabled={Boolean(draft?.sessionId) || admitting}
						onChange={(event) => setCwd(event.target.value)}
					/>
				</label>
			)}
			{(sendError || draft?.error) && (
				<div role="alert" className={cn("px-4 py-2 text-body-sm text-danger")}>
					<p>
						{sendError || draft?.error}{" "}
						{draft?.submittedText
							? "Your message is kept below \u2014 send it again, or discard it to write something else."
							: "Your draft is retained."}
					</p>
					{draft?.submittedText && (
						<div className="mt-2 space-y-2">
							<p
								className={cn(
									"whitespace-pre-wrap rounded-md border border-control bg-surface px-2 py-1 text-body-sm text-ink",
								)}
							>
								{draft.submittedText}
							</p>
							<button
								type="button"
								className="underline"
								onClick={() => {
									if (draftIdentity)
										useCanonicalSessionsStore
											.getState()
											.discardDraft(draftIdentity);
									setSendError(null);
									setSendErrorCode(undefined);
								}}
							>
								Discard unsent message
							</button>
						</div>
					)}
				</div>
			)}
			{(sendErrorCode ?? draft?.errorCode) === "unresolved_attachment" && (
				<div className="flex gap-2 px-4 pb-2 text-body-sm">
					<button
						type="button"
						className="underline"
						onClick={() => void dispatch("/agent")}
					>
						Choose agent
					</button>
					<button
						type="button"
						className="underline"
						onClick={() => void dispatch("/team")}
					>
						Choose team
					</button>
				</div>
			)}
			{(sendErrorCode ?? draft?.errorCode) ===
				"profile_registry_unavailable" && (
				<button
					type="button"
					className="self-start px-4 pb-2 text-body-sm underline"
					onClick={() => navigate("/agents")}
				>
					Manage agents
				</button>
			)}
			{options && (
				<div className="flex flex-wrap gap-2 border-b border-hairline px-4 py-2 text-body-sm">
					{[
						"model",
						"agent",
						"team",
						"rename",
						"resume",
						"fork",
						"new",
						"settings",
					].map((command) => (
						<button
							key={command}
							type="button"
							className="rounded-md px-2 py-1 hover:bg-elevated"
							onClick={() => {
								setOptions(false);
								void dispatch(`/${command}`);
							}}
						>
							{command === "agent"
								? "Choose agent"
								: command === "team"
									? "Choose team"
									: command.charAt(0).toUpperCase() + command.slice(1)}
						</button>
					))}
				</div>
			)}
			<div className="min-h-0 flex-1">
				<ChatContent
					activeTab={tab}
					onTabChange={setTab}
					agentName={title}
					description={
						// `loaded` names the agent/team actually answering; without it an
						// opened chat showed only a cwd and the user could not tell which
						// profile was in force.
						loaded ||
						(draftKey
							? "The session starts when you send your first message."
							: canonical.frontend?.cwd || "Canonical chat")
					}
					onOpenOptions={() => setOptions((value) => !value)}
					isOptionsSidebarOpen={false}
					onCloseOptions={() => setOptions(false)}
					agentId={identity}
					messages={[]}
					isLoading={false}
					isLoadingMessages={false}
					isFetchingMore={canonical.loadingOlder}
					isFarFromBottom={isFarFromBottom}
					messagesContainerRef={container}
					messagesEndRef={end}
					scrollToBottom={scrollToBottom}
					rawInfoContent={JSON.stringify(canonical.frontend, null, 2)}
					onSendMessage={send}
					currentJobId={null}
					onCancelJob={stop}
					messageInputRef={input}
					canonical={{
						view,
						busy,
						admitting: admitting || pendingNavigation,
						onStop: stop,
					}}
				/>
			</div>
			<PickerOutlet context={picker} />
		</div>
	);
}

export function ChatPage() {
	const { agentId: routeIdentity } = useParams<{ agentId?: string }>();
	const navigate = useNavigate();
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(
		capabilities.data,
		"session_catalogue",
		2,
	);
	const active = useCanonicalSessionsStore((state) => state.activeSessionId);
	const draftKey = useCanonicalSessionsStore((state) => state.activeDraftKey);
	const draft = useCanonicalSessionsStore((state) =>
		draftKey ? state.drafts[draftKey] : undefined,
	);
	const pending = useCanonicalSessionsStore((state) => state.pendingSessionId);
	const error = useCanonicalSessionsStore((state) => state.error);
	const [routeError, setRouteError] = useState<string | null>(null);
	useEffect(() => {
		if (!enabled || !routeIdentity) return;
		const store = useCanonicalSessionsStore.getState();
		const id = SESSION_ID.test(routeIdentity)
			? routeIdentity
			: store.sessionByAgent[routeIdentity];
		if (!id) {
			setRouteError(
				"This legacy link has no canonical chat. Its saved history is unchanged.",
			);
			return;
		}
		setRouteError(null);
		if (store.activeSessionId !== id || store.activeDraftKey)
			void store.openSession(id);
	}, [enabled, routeIdentity]);
	useEffect(() => {
		const keydown = (event: KeyboardEvent) => {
			if (
				event.key === "Escape" &&
				useCanonicalSessionsStore.getState().pendingSessionId
			) {
				event.preventDefault();
				useCanonicalSessionsStore.getState().cancelOpen();
			}
		};
		window.addEventListener("keydown", keydown);
		return () => window.removeEventListener("keydown", keydown);
	}, []);
	const stage = (target?: ChatTarget, fresh?: boolean) => {
		useCanonicalSessionsStore.getState().stageDraft(target, fresh);
		setRouteError(null);
		navigate("/chat");
	};
	const select = (id: string) => {
		void useCanonicalSessionsStore
			.getState()
			.openSession(id)
			.then((ok) => {
				if (ok) {
					setRouteError(null);
					navigate(`/chat/${id}`);
				}
			});
	};
	const id = draftKey ? draft?.sessionId : (active ?? undefined);
	const identity = draftKey ?? id;
	return (
		<ChatLayout
			sidebar={
				<ChatSidebar
					selectedConversation={active ?? undefined}
					onSelectConversation={select}
					onStageDraft={stage}
				/>
			}
			content={
				<div className="flex h-full min-h-0 flex-col">
					{pending && (
						<p aria-live="polite" className="px-4 py-2 text-body-sm text-info">
							Opening chat…{" "}
							<button
								type="button"
								onClick={() =>
									useCanonicalSessionsStore.getState().cancelOpen()
								}
							>
								Cancel
							</button>
						</p>
					)}
					{(routeError || error) && (
						<p role="alert" className="px-4 py-2 text-body-sm text-danger">
							{routeError || error}
						</p>
					)}
					{!enabled ? (
						<div className="p-6 text-body text-ink-muted">
							{capabilities.isLoading
								? "Connecting to the backend…"
								: capabilities.error
									? capabilities.error.message
									: "Update the backend to use canonical chats. Your existing histories are unchanged."}
							<button
								type="button"
								className="ml-2 underline"
								onClick={() => void capabilities.refetch()}
							>
								Retry
							</button>
						</div>
					) : identity ? (
						<div className="min-h-0 flex-1">
							<SessionPanel
								key={identity}
								identity={identity}
								draftKey={draftKey}
								sessionId={id}
								pendingNavigation={Boolean(pending)}
							/>
						</div>
					) : (
						<div className="p-6">
							<h1 className="text-title">Start a chat</h1>
							<p className="mt-2 text-body text-ink-muted">
								Choose an agent or team, or start a new chat. Nothing starts
								until you send.
							</p>
							<button
								type="button"
								className="mt-4 rounded-md border border-control px-3 py-2"
								onClick={() => stage(undefined, true)}
							>
								New chat
							</button>
						</div>
					)}
				</div>
			}
		/>
	);
}
