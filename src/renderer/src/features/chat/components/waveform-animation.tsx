import type { FC } from "react";

/*
 * Keyframes live with the only component that uses them — `styles/**` is
 * shared infrastructure, and this animation is chat-composer chrome, not a
 * token.
 */
const WAVEFORM_KEYFRAMES = `
@keyframes waveform-bar {
  0%, 100% { height: 2px; }
  50% { height: 16px; }
}`;

/**
 * The three-bar "processing" waveform shown in the composer while a voice
 * note is transcribed. Bars are plain divs tinted with the accent role.
 */
export const WaveformAnimation: FC = () => {
	return (
		<div
			className="flex h-6 items-center gap-0.5 [&>span]:animate-[waveform-bar_1.2s_infinite_ease-in-out]"
			aria-hidden="true"
		>
			<style>{WAVEFORM_KEYFRAMES}</style>
			<span className="size-[3px] rounded-[1px] bg-accent" />
			<span
				className="h-2 size-[3px] rounded-[1px] bg-accent"
				style={{ animationDelay: "0.2s" }}
			/>
			<span
				className="size-[3px] rounded-[1px] bg-accent"
				style={{ animationDelay: "0.4s" }}
			/>
			<span
				className="h-3 size-[3px] rounded-[1px] bg-accent"
				style={{ animationDelay: "0.6s" }}
			/>
			<span
				className="size-[3px] rounded-[1px] bg-accent"
				style={{ animationDelay: "0.8s" }}
			/>
		</div>
	);
};

WaveformAnimation.displayName = "WaveformAnimation";
