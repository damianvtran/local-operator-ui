/**
 * The per-turn meta row: copy, speak, and the exact time.
 *
 * One hover affordance instead of two. The timestamp used to be a permanent
 * line under every turn while the buttons appeared on hover, which meant the
 * noisy half was always on and the useful half was hidden. Both now live in
 * the same strip, revealed together by the parent's `group` class.
 *
 * THE REVEAL IS THE SHARED ONE. Visibility used to be spelled here as its own
 * pair of classes (opacity plus `group-hover`), which meant the strip alone
 * lacked the two rules the other action rows now carry: a state that PINS the
 * strip visible (a press that is loading, playing or showing `Copied` must not
 * fade out from under the reader) and the touch exception (`@media
 * (hover:none)` - a touch reader can never hover, so a hover-only strip is a
 * strip that does not exist for them). Both live in
 * `ACTION_ROW_REVEAL_CLASSES` now (`../../canonical/message-actions`), beside the
 * answer and user rows that share them. The streaming state still hides the
 * strip with `invisible` from the call site - visibility wins over the hover
 * opacity rule regardless of utility order, which a second opacity class would
 * not.
 *
 * THE SPEAK CONTROL IS THE SHARED ONE (`useSpeakControl`): gate, tooltip
 * ladder, label states and the press, all read from the store rather than
 * inlined here. The strip used to carry its own copy of that ladder (including
 * `Replay speech`, which the shared control keeps) and had already drifted
 * from the other surfaces in spinner size and disabled copy.
 */

import {
	SpeakButton,
	useSpeakControl,
} from "@shared/components/common/speak-control";
import { Button, Tooltip } from "@shared/components/ui";
import { useSpeechBindingFor } from "@shared/lib/speech-target";
import { cn } from "@shared/lib/utils";
import { messageSpeechKey, useSpeechStore } from "@shared/store/speech-store";
import { Copy } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
import { actionRowVisibility } from "../../canonical/message-actions";
import { MessageTimestamp } from "./message-timestamp";

// Props for the MessageControls component
type MessageControlsProps = {
	isUser: boolean;
	content?: string;
	className?: string;
	messageId: string;
	agentId?: string;
	inline?: boolean;
	/** Rendered at the trailing end of the strip when supplied. */
	timestamp?: Date;
};

export const MessageControls: FC<MessageControlsProps> = ({
	isUser,
	content,
	className,
	messageId,
	agentId,
	inline = false,
	timestamp,
}) => {
	const [copied, setCopied] = useState(false);
	const { playSpeech } = useSpeechStore();
	/*
	 * THE TARGET IS THE CONVERSATION'S ROLE AGENT, not the identity this strip is
	 * handed (`@shared/lib/speech-target` carries the argument). What is read here
	 * is the catalogue's BINDING for that conversation - the agent's display NAME -
	 * which the press resolves to a registry id; `null` is a conversation with no
	 * binding, which speaks through the agent-less route. It is no longer a reason
	 * to disable the control.
	 *
	 * `available` is this strip's own subject, the strip's TEXT - a message with no
	 * words has nothing to speak, and the press would be a no-op (agent review
	 * round 1, MINOR-2).
	 */
	const speechBinding = useSpeechBindingFor(agentId ?? null);
	const speechControl = useSpeakControl({
		key: messageSpeechKey(messageId),
		getText: () => content ?? null,
		play: ({ text }) => playSpeech(messageId, speechBinding, text),
		available: Boolean(content),
	});

	/*
	 * A `Copied` tick or a Speak that is loading or playing is the reader's own
	 * press talking back; the strip stays up until the state is done rather than
	 * fading when the pointer leaves.
	 */
	const pinned = copied || speechControl.active;

	// Only show copy button for assistant messages
	const showCopyButton = content;

	/**
	 * Handles copying the message content to clipboard
	 */
	const handleCopy = async () => {
		try {
			// Make sure content is defined before copying
			if (content) {
				await navigator.clipboard.writeText(content);
				setCopied(true);
				setTimeout(() => setCopied(false), 2000); // Reset copied state after 2 seconds
			}
		} catch (error) {
			console.error("Failed to copy text:", error);
		}
	};

	const buttonClass = "text-ink-dim hover:bg-accent-wash hover:text-accent";

	return (
		<div
			className={cn(
				"flex items-center gap-0.5",
				inline
					? "w-auto"
					: cn(
							// Slack's and Linear's hover toolbar: a small group pinned to
							// the turn's top-right corner rather than a strip reserved
							// under every message. Nothing is reserved, so the rhythm
							// between turns stays exactly what the grouping asked for, and
							// nothing shifts when it appears. The `elevated` ground plus a
							// hairline is what makes it read as floating — § 2 keeps the
							// one shadow for objects that genuinely leave the flow.
							"message-controls absolute -top-2 right-0 z-10 h-8 rounded-md border border-hairline bg-elevated px-1",
							actionRowVisibility(pinned),
						),
				className,
			)}
		>
			{timestamp && <MessageTimestamp timestamp={timestamp} className="px-1" />}
			{showCopyButton && (
				<div className="flex items-center">
					<Tooltip content={copied ? "Copied" : "Copy message"} side="top">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={copied ? "Copied" : "Copy message"}
							className={buttonClass}
							onClick={handleCopy}
						>
							<Copy />
						</Button>
					</Tooltip>
					{!isUser && <SpeakButton control={speechControl} side="top" />}
				</div>
			)}
			{/* Additional button wrappers can be added here in the future */}
		</div>
	);
};
