/**
 * Component for the message control buttons (copy, speech) that appear on
 * hover. Visibility is driven by the parent's `group` class: the controls
 * stay at `opacity-0` until `group-hover`, and the streaming state hides them
 * with `invisible` from the call site — visibility wins over the hover
 * opacity rule regardless of utility order, which a second opacity class
 * would not.
 *
 * The `sx` prop became `className` in the Tailwind port.
 */

import { Spinner } from "@shared/components/common/spinner";
import { Button, Tooltip } from "@shared/components/ui";
import { useCredentials } from "@shared/hooks/use-credentials";
import { cn } from "@shared/lib/utils";
import { useSpeechStore } from "@shared/store/speech-store";
import { Copy, Square, Volume2 } from "lucide-react";
import type { FC } from "react";
import { useMemo, useState } from "react";

// Props for the MessageControls component
type MessageControlsProps = {
	isUser: boolean;
	content?: string;
	className?: string;
	messageId: string;
	agentId?: string;
	inline?: boolean;
};

export const MessageControls: FC<MessageControlsProps> = ({
	isUser,
	content,
	className,
	messageId,
	agentId,
	inline = false,
}) => {
	const [copied, setCopied] = useState(false);
	const { data: credentialsData, isLoading: isLoadingCredentials } =
		useCredentials();
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

	const isRadientApiKeyConfigured = useMemo(
		() => credentialsData?.keys?.includes("RADIENT_API_KEY"),
		[credentialsData?.keys],
	);

	const canEnableSpeechFeature = useMemo(
		() => isRadientApiKeyConfigured && !isLoadingCredentials,
		[isRadientApiKeyConfigured, isLoadingCredentials],
	);

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
				"flex items-center",
				inline
					? "w-auto"
					: cn(
							"message-controls absolute z-10 w-full opacity-0 transition-opacity duration-fast ease-out-quart group-hover:opacity-100",
							isUser ? "bottom-2 justify-end" : "-bottom-3 justify-start",
						),
				className,
			)}
		>
			{/* Only render the wrapper if there are buttons to show */}
			{showCopyButton && (
				<div className="flex items-start">
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
										? "Sign in to Radient in the settings page to enable text to speech"
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
