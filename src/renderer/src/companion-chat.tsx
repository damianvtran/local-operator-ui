import { Button } from "@shared/components/ui/button";
import { Textarea } from "@shared/components/ui/textarea";
import { cn } from "@shared/lib/utils";
import {
	ArrowUp,
	ArrowUpRight,
	ChevronDown,
	MessageCircle,
	Plus,
} from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CompanionChatSnapshot } from "../../shared/companion-chat";
import { COMPANION_CHAT_MAX_CHARS } from "../../shared/companion-chat";

export interface CompanionChatProps {
	snapshot: CompanionChatSnapshot;
	onSend: (text: string) => Promise<boolean>;
	onShowConversations: (position: { x: number; y: number }) => Promise<boolean>;
	onCollapse: () => void;
	onExpand: () => void;
	open: boolean;
}

export function CompanionChat({
	snapshot,
	onSend,
	onShowConversations,
	onCollapse,
	onExpand,
	open,
}: CompanionChatProps) {
	const [draft, setDraft] = useState("");
	const [sending, setSending] = useState(false);
	const [sendError, setSendError] = useState<string | null>(null);
	const [showQuestion, setShowQuestion] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const composer = useRef<HTMLTextAreaElement>(null);
	const conversationButton = useRef<HTMLButtonElement>(null);
	const transcript = useRef<HTMLElement>(null);
	const sendButton = useRef<HTMLButtonElement>(null);
	const retryButton = useRef<HTMLButtonElement>(null);
	const composing = useRef(false);
	const inFlight = useRef(false);
	const menuPending = useRef(false);
	const openRef = useRef(open);
	openRef.current = open;
	const hintId = useId();
	const errorId = useId();
	const questionId = useId();
	const error =
		snapshot.status === "attention" ? null : (snapshot.error ?? sendError);
	const canSend = snapshot.canSend && !sending;
	const pendingText = snapshot.pendingText;
	const chiefOfStaff = snapshot.destination === "chief-of-staff";
	const draftCanSend =
		canSend && (pendingText === undefined || draft.trim() === pendingText);
	const busy =
		sending || snapshot.status === "working" || snapshot.status === "loading";
	const destination = chiefOfStaff ? "Chief of staff" : snapshot.title;
	const conversationLabel = `Choose conversation. Current: ${destination}`;
	const canChangeConversation =
		!busy && pendingText === undefined && !snapshot.activeQuestion;
	const roles = snapshot.messages.map((message) => message.role);
	const replyIndex = roles.lastIndexOf("assistant");
	const reply = snapshot.messages[replyIndex];
	const questionIndex = roles.lastIndexOf("user");
	const question = snapshot.activeQuestion ?? snapshot.messages[questionIndex];
	const previousReply =
		!!reply &&
		(sending ||
			questionIndex > replyIndex ||
			(!!snapshot.activeQuestion &&
				!snapshot.messages.some(
					(message) => message.id === snapshot.activeQuestion?.id,
				)));
	const status = sending
		? "Sending…"
		: snapshot.status === "loading"
			? "Loading…"
			: snapshot.status === "working"
				? "Working…"
				: "";

	useEffect(() => {
		if (open) composer.current?.focus({ preventScroll: true });
	}, [open]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: Reset only for a new answer; keep keyboard focus on the existing region.
	useLayoutEffect(() => {
		if (transcript.current) transcript.current.scrollTop = 0;
	}, [snapshot.sessionId, reply?.id]);

	useLayoutEffect(() => {
		if (showQuestion && transcript.current) transcript.current.scrollTop = 0;
	}, [showQuestion]);

	useLayoutEffect(() => {
		const input = composer.current;
		if (!open || !input) return;
		input.style.height = "32px";
		input.style.height = `${Math.max(32, Math.min(64, input.scrollHeight))}px`;
	});

	async function submit(retryOriginal = false) {
		const submittedDraft = draft;
		const text = retryOriginal ? pendingText : submittedDraft.trim();
		if (
			!text ||
			!canSend ||
			(!retryOriginal && !draftCanSend) ||
			menuPending.current ||
			inFlight.current
		)
			return;
		inFlight.current = true;
		if (
			document.activeElement === sendButton.current ||
			document.activeElement === retryButton.current
		) {
			composer.current?.focus({ preventScroll: true });
		}
		setSending(true);
		setSendError(null);
		try {
			if (await onSend(text)) {
				if (!retryOriginal || submittedDraft.trim() === text) {
					setDraft((current) => (current === submittedDraft ? "" : current));
				}
			} else {
				setSendError("Send could not be confirmed. Your draft is saved.");
			}
		} catch {
			setSendError("Send could not be confirmed. Your draft is saved.");
		} finally {
			inFlight.current = false;
			setSending(false);
		}
	}

	async function showConversations() {
		if (!canChangeConversation || menuPending.current) return;
		const bounds = conversationButton.current?.getBoundingClientRect();
		if (!bounds) return;
		menuPending.current = true;
		setMenuOpen(true);
		try {
			if (await onShowConversations({ x: bounds.left, y: bounds.bottom })) {
				setSendError(null);
				setShowQuestion(false);
			}
		} catch {
			setSendError("Could not open the conversation menu. Try again.");
		} finally {
			menuPending.current = false;
			setMenuOpen(false);
			if (
				openRef.current &&
				(document.activeElement === conversationButton.current ||
					document.activeElement === document.body)
			)
				composer.current?.focus({ preventScroll: true });
		}
	}

	return (
		<section
			className={cn(
				"companion-chat flex max-h-[200px] w-[300px] max-w-full flex-none flex-col gap-1.5 overflow-hidden rounded-[14px] border border-control bg-surface p-2 text-left text-body-sm text-ink select-text",
			)}
			aria-label="Companion chat"
			hidden={!open}
			onKeyDown={(event) => {
				if (
					event.key === "Escape" &&
					!event.nativeEvent.isComposing &&
					!composing.current
				) {
					event.stopPropagation();
					if (!menuPending.current) onCollapse();
				}
			}}
		>
			<section
				ref={transcript}
				className={cn(
					reply || (showQuestion && question)
						? "companion-chat-reply min-h-0 max-h-[120px] overflow-auto overscroll-contain px-1 py-0.5 [scrollbar-width:thin]"
						: "sr-only",
				)}
				aria-label={previousReply ? "Previous reply" : "Latest reply"}
				tabIndex={reply || (showQuestion && question) ? 0 : undefined}
			>
				{showQuestion && question && (
					<p
						id={questionId}
						className={cn(
							"mb-1.5 whitespace-pre-wrap text-meta text-ink-muted [overflow-wrap:anywhere]",
						)}
					>
						Your last question: {question.text}
					</p>
				)}
				{previousReply && (
					<span className={cn("block text-meta text-ink-muted")}>
						Previous reply
					</span>
				)}
				<p
					className={cn("whitespace-pre-wrap [overflow-wrap:anywhere]")}
					aria-live="polite"
					aria-atomic="true"
					aria-busy={busy}
				>
					{reply?.text}
				</p>
			</section>

			<div className={cn("flex shrink-0 flex-col gap-1.5")}>
				{snapshot.status === "attention" && (
					<div
						className={cn(
							"flex shrink-0 items-center justify-between gap-2 px-1",
						)}
					>
						<output className={cn("font-medium")}>Needs your input</output>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							className={cn("companion-chat-open")}
							disabled={!snapshot.sessionId}
							onClick={onExpand}
						>
							Open app
						</Button>
					</div>
				)}
				{error && (
					<p
						id={errorId}
						role="alert"
						className={cn(
							"max-h-12 shrink-0 overflow-auto px-1 text-meta text-danger [overflow-wrap:anywhere]",
						)}
					>
						{error}
					</p>
				)}
				{pendingText !== undefined && snapshot.status !== "attention" && (
					<Button
						ref={retryButton}
						type="button"
						variant="secondary"
						size="sm"
						className={cn("self-start")}
						aria-label="Retry original message"
						title="Retry the original message; keep any edited draft"
						disabled={!canSend}
						onClick={() => void submit(true)}
					>
						Retry original
					</Button>
				)}
				{status && !error && snapshot.status !== "attention" && (
					<output
						className={cn("shrink-0 px-1 text-meta text-ink-muted")}
						aria-live="polite"
					>
						{status}
					</output>
				)}
				<form
					className={cn("flex shrink-0 items-end gap-1")}
					onSubmit={(event) => {
						event.preventDefault();
						void submit();
					}}
				>
					<Textarea
						ref={composer}
						className={cn(
							"min-h-8 max-h-16 min-w-0 flex-1 resize-none border-0 px-1 py-1.5 text-body leading-5",
						)}
						rows={1}
						maxLength={COMPANION_CHAT_MAX_CHARS}
						readOnly={sending}
						value={draft}
						aria-label={
							chiefOfStaff
								? "Message your chief of staff"
								: "Message Local Operator"
						}
						aria-describedby={error ? `${hintId} ${errorId}` : hintId}
						placeholder={
							chiefOfStaff ? "Message chief of staff…" : "Ask anything…"
						}
						onChange={(event) => {
							if (!inFlight.current) setDraft(event.target.value);
						}}
						onCompositionStart={() => {
							composing.current = true;
						}}
						onCompositionEnd={() => {
							composing.current = false;
						}}
						onKeyDown={(event) => {
							if (
								event.key === "Enter" &&
								!event.shiftKey &&
								!event.nativeEvent.isComposing &&
								!composing.current &&
								event.nativeEvent.keyCode !== 229
							) {
								event.preventDefault();
								void submit();
							}
						}}
					/>
					<div className={cn("flex min-h-8 shrink-0 items-center gap-0.5")}>
						{question && (
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className={cn("h-7 w-6")}
								aria-label={
									showQuestion ? "Hide last question" : "Show last question"
								}
								title={
									showQuestion ? "Hide last question" : "Show last question"
								}
								aria-expanded={showQuestion}
								aria-controls={showQuestion ? questionId : undefined}
								onClick={() => setShowQuestion((shown) => !shown)}
							>
								<MessageCircle size={14} aria-hidden="true" />
							</Button>
						)}
						<Button
							ref={conversationButton}
							type="button"
							variant="ghost"
							size="icon-sm"
							className={cn("h-7 w-6")}
							aria-label={conversationLabel}
							aria-haspopup="menu"
							aria-expanded={menuOpen}
							title={
								pendingText === undefined
									? conversationLabel
									: `${conversationLabel}. Retry original or open the app before switching.`
							}
							disabled={!canChangeConversation}
							onClick={() => void showConversations()}
						>
							<Plus size={14} aria-hidden="true" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className={cn("h-7 w-6")}
							aria-label="Open chat in the full app"
							title="Open in the full app"
							onClick={onExpand}
						>
							<ArrowUpRight size={14} aria-hidden="true" />
						</Button>
						<Button
							ref={sendButton}
							type="submit"
							size="icon"
							variant="primary"
							className={cn("size-7")}
							aria-label="Send message"
							title="Send message"
							disabled={!draftCanSend || !draft.trim()}
						>
							<ArrowUp size={16} aria-hidden="true" />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className={cn("h-7 w-6")}
							aria-label="Collapse chat"
							title="Collapse chat"
							onClick={onCollapse}
						>
							<ChevronDown size={14} aria-hidden="true" />
						</Button>
					</div>
				</form>
				<span id={hintId} className={cn("sr-only")}>
					Enter to send. Shift+Enter for a new line.
				</span>
				{draft.length >= COMPANION_CHAT_MAX_CHARS - 1000 && (
					<output className={cn("shrink-0 px-1 text-meta text-ink-muted")}>
						{draft.length.toLocaleString()} /{" "}
						{COMPANION_CHAT_MAX_CHARS.toLocaleString()}
					</output>
				)}
			</div>
		</section>
	);
}
