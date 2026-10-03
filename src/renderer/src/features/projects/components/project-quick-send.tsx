/**
 * The quick-send strip: pick a linked session, type a message, send it — from
 * the project view, without opening the conversation.
 *
 * WHY IT EXISTS: the operator's own words — "steer from the project view". A
 * project's linked sessions are the conversations doing the work, and reaching
 * one meant leaving the project, finding the chat, typing, and coming back.
 * The strip is the composer distilled to its one act; the message travels
 * through the app's real chat-send path (`admitChatDraft`, the same function
 * the composer calls), so it is delivered as a normal user message with the
 * same request-id receipts, and a busy target gets the same `steer` mode the
 * composer would send.
 *
 * WHAT IT DELIBERATELY IS NOT: a second send mechanism. Nothing here talks to
 * `sessions.message` itself; the store's admission decides modes, dedup and
 * failure classification, and this component only chooses the target, collects
 * the text and reports the outcome (toasts live with the detail screen, which
 * owns the write, `project-detail.tsx`).
 *
 * MODE VISIBILITY: when the selected session is mid-turn the strip says the
 * message will STEER the running turn. That is not decoration — it is the
 * difference between queueing behind a turn and interrupting it, and the
 * composer marks the same fact beside its own send control.
 *
 * AN IMAGE ALONE IS A MESSAGE (issue #790), and this strip used to disagree:
 * its admission test was text-only, so a pasted screenshot armed nothing and
 * Send stayed dead until words appeared. The wire's own rule is text OR
 * images OR audio (`Prompt.nonempty` in `local_operator/server/routes/
 * desktop_sessions.py` refuses only when all three are empty), so the paste
 * route here is the composer's own — a clipboard image read into a data URL
 * and held as an attachment (`message-input.tsx`'s paste path) — and the
 * predicate values it. Audio is absent rather than ignored: nothing on this
 * strip records, and no desktop send box carries a recording as a message.
 */

import { Spinner } from "@shared/components/common/spinner";
import {
	Button,
	Input,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@shared/components/ui";
import { SendHorizontal } from "lucide-react";
import type { ClipboardEvent, FC } from "react";
import { useEffect, useRef, useState } from "react";
import type { DesktopLinkedSession } from "../../../../../shared/desktop-control-contract";
import { AttachmentsPreview } from "../../chat/components/attachments-preview";
import { sessionLabel } from "../project-model";

export type ProjectQuickSendProps = {
	links: DesktopLinkedSession[];
	/** The session a message goes to; the section owns this so a row action can set it. */
	target: string | null;
	onTargetChange: (sessionId: string) => void;
	/**
	 * Sends one message through the chat's own admission path; resolves `true`
	 * when the message is on its way (including a provable replay), `false`
	 * when nothing was admitted — the detail screen owns the words either way.
	 *
	 * `attachments` is the strip's own list — pasted images as data URLs, the
	 * composer's attachment form. The admission seam encodes it into the
	 * wire's images, admits the pair, and keeps the list as the payload
	 * identity the one-row-per-conversation dedup compares.
	 */
	onSend: (
		sessionId: string,
		text: string,
		mode: "prompt" | "steer",
		attachments: string[],
	) => Promise<boolean>;
	/**
	 * Bumped by a row's "message" action. Focusing is an EFFECT rather than a
	 * command because the input may have just mounted with the strip; the tick
	 * is what tells a strip that is already up to take the keyboard.
	 */
	focusTick: number;
};

export const ProjectQuickSend: FC<ProjectQuickSendProps> = ({
	links,
	target,
	onTargetChange,
	onSend,
	focusTick,
}) => {
	const [text, setText] = useState("");
	/*
	 * THE STRIP'S ATTACHMENTS, in the composer's own form: a pasted image is
	 * read off the clipboard into a data URL (`message-input.tsx`'s paste
	 * route) and held here. The paste is the only attachment route this strip
	 * has — no file dialog and no drop target — which is why the list is plain
	 * local state rather than a store-backed draft.
	 */
	const [attachments, setAttachments] = useState<string[]>([]);
	const [sending, setSending] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (focusTick > 0) inputRef.current?.focus();
	}, [focusTick]);

	const sendable = links.filter((link) => link.exists);
	const selected = sendable.find((link) => link.session_id === target) ?? null;
	const busy = selected?.runtime?.busy === true;
	/*
	 * THE WIRE'S OWN ADMISSION TEST (issue #790): a send may not be empty of
	 * text AND images — `Prompt.nonempty` refuses only when all three of text,
	 * images and audio are absent, so a pasted screenshot alone is a message.
	 * The predicate used to be text-only, which is what left the screenshot's
	 * send dead; audio has no term here because nothing on this strip records.
	 */
	const canSend =
		Boolean(target) &&
		(text.trim().length > 0 || attachments.length > 0) &&
		!sending;

	/*
	 * THE COMPOSER'S CLIPBOARD ROUTE, mirrored: each pasted image item is read
	 * into a data URL and appended as an attachment. Images only, where the
	 * composer's clause also takes `kind === "file"`: this strip has no file
	 * dialog and no Files-panel record beside it, and the encoder leaves
	 * non-image paths out of the body by design — staging one here would arm
	 * Send for a message that cannot carry it.
	 */
	const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
		const items = event.clipboardData?.items;
		if (!items) return;
		for (let index = 0; index < items.length; index += 1) {
			const item = items[index];
			if (item.type.indexOf("image") === -1) continue;
			const file = item.getAsFile();
			if (!file) continue;
			const reader = new FileReader();
			reader.onload = (loadEvent) => {
				const result = loadEvent.target?.result;
				if (typeof result !== "string") return;
				setAttachments((current) => [...current, result]);
			};
			reader.readAsDataURL(file);
		}
	};

	const send = async () => {
		if (!canSend || !target) return;
		setSending(true);
		try {
			const delivered = await onSend(
				target,
				text.trim(),
				busy ? "steer" : "prompt",
				attachments,
			);
			if (delivered) {
				setText("");
				setAttachments([]);
			}
		} finally {
			setSending(false);
			/*
			 * THE PRESS HANDS THE KEYBOARD BACK TO THE BOX (UX round 1, U2). A
			 * pointer press focuses the Send button, and the button then disables
			 * while the send is in flight (`sending` true, the text gone), so the
			 * browser drops focus to `<body>` - measured: a second message needed a
			 * fresh click, while the Enter path kept the box focused. Refocusing
			 * here makes both paths behave the same, and on a refusal the text is
			 * already back in the box, so the caret belongs there too.
			 */
			inputRef.current?.focus();
		}
	};

	return (
		<div className="flex flex-col gap-2 rounded-md bg-elevated p-3">
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-meta text-ink-muted">Send to</span>
				<Select
					value={target ?? undefined}
					onValueChange={(value) => onTargetChange(value)}
				>
					<SelectTrigger
						aria-label="Select the session to message"
						className="max-w-72"
					>
						<SelectValue placeholder="No session selected" />
					</SelectTrigger>
					<SelectContent>
						{sendable.map((link) => (
							<SelectItem key={link.session_id} value={link.session_id}>
								{sessionLabel(link)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{busy && (
					<span className="text-meta text-ink-muted">
						The session is working — this message steers the running turn.
					</span>
				)}
			</div>
			{attachments.length > 0 && (
				/*
				 * Bounded the way the composer bounds the same previews (`max-h` plus
				 * its own scroller): an unbounded tile row would push the input and
				 * Send out of the strip, which is the band that has to stay reachable.
				 * Removal is disabled while a send is in flight, with the payload it
				 * wrote.
				 */
				<div className="max-h-[240px] shrink-0 overflow-y-auto">
					<AttachmentsPreview
						attachments={attachments}
						onRemoveAttachment={(index) =>
							setAttachments((current) =>
								current.filter((_, position) => position !== index),
							)
						}
						disabled={sending}
					/>
				</div>
			)}
			<div className="flex items-center gap-2">
				{/*
				 * THE PLACEHOLDER IS THE STRIP'S ONLY AFFORDANCE FOR ITS IMAGE ROUTE.
				 * The route is the clipboard (see `handlePaste` below): there is no
				 * attach control and no drop target to teach, so the capability has to
				 * be named where an empty box is looking at it - discoverable only by
				 * someone who happens to try pasting is exactly the silence the surface
				 * was fixed for (design round 1 on issue #790, D3).
				 */}
				<Input
					ref={inputRef}
					aria-label="Message the selected session"
					placeholder="Message the session — paste an image to attach it"
					value={text}
					onChange={(event) => setText(event.target.value)}
					onPaste={handlePaste}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							void send();
						}
					}}
				/>
				<Button
					variant="secondary"
					disabled={!canSend}
					onClick={() => void send()}
					data-tour-tag="project-quick-send"
				>
					{sending ? <Spinner size="xs" /> : <SendHorizontal />}
					Send
				</Button>
			</div>
		</div>
	);
};
