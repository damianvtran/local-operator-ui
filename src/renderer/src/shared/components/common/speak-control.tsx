/**
 * @file speak-control.tsx
 * @description
 * The one Speak control: the hook that owns its states, and the button those
 * states render through.
 *
 * WHY THIS MODULE EXISTS (branding § 9: a second implementation is a defect).
 * The answer row (`message-actions-row.tsx`), the legacy message strip
 * (`message-controls.tsx`) and the selection toolbars each used to inline
 * this control, and they had already drifted: two spinner sizes, two tooltip
 * ladders and two spellings of the disabled reason, for one press whose states
 * are a fact about the STORE rather than about the surface. Every surface now
 * renders what this hook reads.
 *
 * WHAT THE HOOK OWNS, and what stays the surface's:
 *
 *   - the store key, supplied by the surface (`msg:<id>` from the message
 *     surfaces, `sel:<scope>:<hash>` from the selection toolbars - the hash is
 *     over the CLIPPED text, so the key, the cache entry and the request all
 *     describe the same characters);
 *   - the credential gate and the disabled reason (`speech-gate.ts`, the same
 *     table the composer's mic reads);
 *   - the press: stop when playing, otherwise read `getText()` AT PRESS TIME,
 *     clip it for the service's cap, disclose the clip, and hand the text to
 *     the surface's `play` callback.
 *
 * WHY THE PRESS READS THE TEXT INSTEAD OF RENDERING FROM IT: a selection
 * toolbar is raised by a highlight and can outlive one drag - the reader can
 * re-drag before pressing - so the words that are read must be the words lit
 * at the moment of the press. The surface's `getText` is that read.
 *
 * WHY THE CLIP DISCLOSES: a press that silently reads a prefix of what the
 * reader pointed at makes the transcript disagree with the audio. The info
 * toast ("Reading the first N characters") is the one channel the app already
 * speaks through, and it is raised HERE so no surface can forget it.
 *
 * `active` is the hook's half of the action rows' hover reveal: a row fades
 * at rest, but a press that is loading or playing owes the reader a visible
 * Stop, so the surface PINS the row visible while `active` holds.
 */

import { Spinner } from "@shared/components/common/spinner";
import { Button, Tooltip } from "@shared/components/ui";
import { useRadientCredentialProbe } from "@shared/hooks/use-credentials";
import { clipForSpeech } from "@shared/lib/speech-clip";
import { speechUnavailableReason } from "@shared/lib/speech-gate";
import { cn } from "@shared/lib/utils";
import { useSpeechStore } from "@shared/store/speech-store";
import { showInfoToast } from "@shared/utils/toast-manager";
import { Square, Volume2 } from "lucide-react";

/** What a press hands its surface: the text as it will be sent. */
export type SpeakRequest = {
	/** The text to synthesise - clipped, and read at press time. */
	text: string;
};

export type SpeakControlOptions = {
	/**
	 * The store key this control renders state for - `null` until the surface
	 * knows one (a selection toolbar with no highlight). A null key cannot show
	 * a busy state; it still renders the resting control.
	 */
	key: string | null;
	/**
	 * The text to speak, read AT PRESS TIME. `null` (or blank) is a no-op press.
	 */
	getText: () => string | null;
	/**
	 * Starts playback. The surface builds the key (and the request) it knows how
	 * to build: the message surfaces call `playSpeech`, the selection surfaces
	 * call `speak` with a `selectionSpeechKey` over this text.
	 */
	play: (request: SpeakRequest) => void;
	/**
	 * Whether this surface has a target to synthesise against at all (an agent
	 * id, a highlight). `false` renders the control disabled without changing
	 * the tooltip: there is no reason to give, only nothing to act on.
	 */
	available?: boolean;
};

export type SpeakControl = {
	/** The button's accessible name, including the state (`Stop`, `Loading speech`). */
	label: string;
	/** The tooltip sentence: state first, then the gate's reason. */
	tooltip: string;
	isPlaying: boolean;
	isLoading: boolean;
	disabled: boolean;
	/** Loading or playing: an action row must stay visible while this holds. */
	active: boolean;
	press: () => void;
};

export function useSpeakControl({
	key,
	getText,
	play,
	available = true,
}: SpeakControlOptions): SpeakControl {
	const { stopSpeech, loadingKey, playingKey, audioCache } = useSpeechStore();
	const { canUseRadientSpeech, speechBlock } = useRadientCredentialProbe();

	const isPlaying = key !== null && playingKey === key;
	const isLoading = key !== null && loadingKey === key;
	const hasAudio = key !== null && audioCache.has(key);
	const disabled = isLoading || !canUseRadientSpeech || !available;

	/*
	 * The ladder from `message-controls.tsx`, kept whole: playing answers
	 * first (the button is the Stop control), then loading, then the configured
	 * answer - `Replay speech` for words this session has already fetched, so a
	 * second press reads as the replay it is.
	 */
	const label = isPlaying
		? "Stop"
		: isLoading
			? "Loading speech"
			: hasAudio
				? "Replay speech"
				: "Speak aloud";
	const tooltip = isPlaying
		? "Stop"
		: isLoading
			? "Loading"
			: !canUseRadientSpeech
				? speechUnavailableReason("speaking-aloud", speechBlock)
				: hasAudio
					? "Replay speech"
					: "Speak aloud";

	const press = () => {
		if (isPlaying) {
			stopSpeech();
			return;
		}
		if (disabled) return;
		const raw = getText();
		if (raw === null || raw.trim().length === 0) return;
		const { text, clipped } = clipForSpeech(raw);
		if (clipped) {
			showInfoToast(`Reading the first ${text.length} characters`);
		}
		play({ text });
	};

	return {
		label,
		tooltip,
		isPlaying,
		isLoading,
		disabled,
		active: isPlaying || isLoading,
		press,
	};
}

export type SpeakButtonProps = {
	control: SpeakControl;
	/** Tooltip side, for a strip placed below its subject. */
	side?: "top" | "bottom";
};

/**
 * The button every Speak surface renders.
 *
 * ONE ELEMENT FOR BOTH OF THE SPEAK STATES, deliberately: a playing row used
 * to render `<Button>` where the resting one renders `<span><Button/></span>`,
 * so the swap replaced the DOM subtree and a reader who had tabbed to Speak
 * lost focus at the moment the button became the stop control. The branches
 * differ only in what they paint.
 *
 * The wrapper span is what makes the DISABLED tooltip reachable: a disabled
 * button fires no pointer events, so the reason needs a parent that does.
 */
export const SpeakButton = ({ control, side = "top" }: SpeakButtonProps) => (
	<Tooltip content={control.tooltip} side={side}>
		<span className={cn("flex")}>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={control.label}
				className={cn("text-ink-dim hover:bg-accent-wash hover:text-accent")}
				onClick={control.press}
				disabled={control.disabled}
			>
				{control.isPlaying ? (
					<Square aria-hidden="true" />
				) : control.isLoading ? (
					/*
					 * The spinner is hidden from the accessibility tree, so the button's
					 * own name is what says the app is busy.
					 */
					<Spinner size="xs" />
				) : (
					<Volume2 aria-hidden="true" />
				)}
			</Button>
		</span>
	</Tooltip>
);
