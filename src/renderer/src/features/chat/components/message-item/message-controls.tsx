/**
 * The per-turn meta row: copy, speak, and the exact time.
 *
 * One hover affordance instead of two. The timestamp used to be a permanent
 * line under every turn while the buttons appeared on hover, which meant the
 * noisy half was always on and the useful half was hidden. Both now live in
 * the same strip, revealed together by the parent's `group` class.
 *
 * Visibility is driven by the parent's `group`: the strip stays at
 * `opacity-0` until `group-hover`, and the streaming state hides it with
 * `invisible` from the call site — visibility wins over the hover opacity
 * rule regardless of utility order, which a second opacity class would not.
 */

import { Spinner } from "@shared/components/common/spinner";
import { Button, Tooltip } from "@shared/components/ui";
import { useRadientCredentialProbe } from "@shared/hooks/use-credentials";
import { cn } from "@shared/lib/utils";
import { useSpeechStore } from "@shared/store/speech-store";
import { Copy, Square, Volume2 } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";
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
	const { hasRadientApiKey, isUnavailable } = useRadientCredentialProbe();
	const {
		playSpeech,
		stopSpeech,
		replaySpeech,
		loadingMessageId,
		playingMessageId,
		audioCache,
	} = useSpeechStore();

	const isPlaying = playingMessageId === messageId;
	const isLoading = loadingMessageId === messageId;
	const hasAudio = audioCache.has(messageId);

	const canEnableSpeechFeature = hasRadientApiKey && !isUnavailable;

	// "Not signed in" and "could not reach the server to find out" look
	// identical from the probe, and sending someone to the settings page to fix
	// an account that is fine is the worse of the two mistakes.
	const speechTooltip = isUnavailable
		? "Text to speech is unavailable while Local Operator is offline"
		: "Sign in to Radient in the settings page to enable text to speech";

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

	const handlePlay = () => {
		if (agentId && content) {
			playSpeech(messageId, agentId, content);
		}
	};

	const handleReplay = () => {
		replaySpeech(messageId);
	};

	const handleStop = () => {
		stopSpeech();
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
							"pointer-events-none opacity-0 transition-opacity duration-fast ease-out-quart",
							"group-hover:pointer-events-auto group-hover:opacity-100",
						),
				className,
			)}
		>
			{timestamp && <MessageTimestamp timestamp={timestamp} className="px-1" />}
			{showCopyButton && (
				<div className="flex items-center">
					<Tooltip content={copied ? "Copied!" : "Copy message"} side="top">
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
					{!isUser &&
						(isPlaying ? (
							<Tooltip content="Stop" side="top">
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="Stop speech"
									className={buttonClass}
									onClick={handleStop}
								>
									<Square />
								</Button>
							</Tooltip>
						) : (
							<Tooltip
								content={
									!canEnableSpeechFeature
										? speechTooltip
										: isLoading
											? "Loading"
											: hasAudio
												? "Replay speech"
												: "Speak aloud"
								}
								side="top"
							>
								{/* The span wrapper keeps the tooltip alive on the disabled
								 * button, which swallows its own pointer events. */}
								<span>
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={hasAudio ? "Replay speech" : "Speak aloud"}
										className={buttonClass}
										onClick={hasAudio ? handleReplay : handlePlay}
										disabled={isLoading || !canEnableSpeechFeature}
									>
										{isLoading ? <Spinner size="sm" /> : <Volume2 />}
									</Button>
								</span>
							</Tooltip>
						))}
				</div>
			)}
			{/* Additional button wrappers can be added here in the future */}
		</div>
	);
};
