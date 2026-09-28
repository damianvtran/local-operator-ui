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
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
import type { DesktopLinkedSession } from "../../../../../shared/desktop-control-contract";
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
	 */
	onSend: (
		sessionId: string,
		text: string,
		mode: "prompt" | "steer",
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
	const [sending, setSending] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (focusTick > 0) inputRef.current?.focus();
	}, [focusTick]);

	const sendable = links.filter((link) => link.exists);
	const selected = sendable.find((link) => link.session_id === target) ?? null;
	const busy = selected?.runtime?.busy === true;
	const canSend = Boolean(target) && text.trim().length > 0 && !sending;

	const send = async () => {
		if (!canSend || !target) return;
		setSending(true);
		try {
			const delivered = await onSend(
				target,
				text.trim(),
				busy ? "steer" : "prompt",
			);
			if (delivered) setText("");
		} finally {
			setSending(false);
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
			<div className="flex items-center gap-2">
				<Input
					ref={inputRef}
					aria-label="Message the selected session"
					placeholder="Message the session"
					value={text}
					onChange={(event) => setText(event.target.value)}
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
