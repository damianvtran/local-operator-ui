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
 *
 * TWO PRESSES THE FIRST LADDER BLOCKED. A press while LOADING cancels the
 * fetch and returns the control to rest (UX review round 1, U2): the store's
 * generation counter already made a superseding press safe, and a slow read
 * the reader regrets must be takeable-back from the same control that started
 * it. A press while PLAYING still stops. And a surface that DISMISSES its
 * subject - a selection toolbar whose highlight is cleared - calls
 * `useSpeakDismissal` below, so its audio cannot outlive its only Stop (UX
 * round 1, U1).
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
import { useEffect, useId } from "react";

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
	const { dismiss, stopSpeech, loadingKey, playingKey, audioCache } =
		useSpeechStore();
	const { canUseRadientSpeech, speechBlock } = useRadientCredentialProbe();

	const isPlaying = key !== null && playingKey === key;
	const isLoading = key !== null && loadingKey === key;
	const hasAudio = key !== null && audioCache.has(key);
	/*
	 * The gate blocks only the IDLE press. Loading is cancellable (a press
	 * during it cancels, below) and playing is the Stop control, so neither may
	 * be disabled into un-pressability - the old ladder disabled the loading
	 * state, which made a slow read impossible to take back (UX round 1, U2).
	 */
	const disabled =
		!isPlaying && !isLoading && (!canUseRadientSpeech || !available);

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
			? /*
				 * The SAME sentence as the button's accessible name (copy review round
				 * 1, C3): the two ladders drifted on exactly this rung, and the name is
				 * the string a screen-reader or speech-input user has to say on its
				 * own, so the shorter "Loading" - which reads as the app being busy
				 * rather than this button - is the wrong end to align from.
				 */
				"Loading speech"
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
		if (isLoading) {
			/*
			 * U2's cancel: the same control that started the fetch takes it back.
			 * `dismiss` bumps the store's generation, so the response can never
			 * start playing, and returns to rest now rather than at the response's
			 * leisure.
			 */
			if (key !== null) dismiss(key);
			return;
		}
		if (disabled) return;
		const raw = getText();
		if (raw === null || raw.trim().length === 0) return;
		const { text, clipped } = clipForSpeech(raw);
		if (clipped && !hasAudio) {
			/*
			 * The disclosure, once per press THAT SHORTENS THE READ, and only for
			 * the press that first shortens it (copy review round 1, C7): a replay
			 * has already been told. The count is localised the way every other
			 * character count in the app is (C2), and the sentence names what the
			 * reader is NOT getting, because the toast is the only disclosure that
			 * a truncation happened at all.
			 */
			showInfoToast(
				`Reading the first ${text.length.toLocaleString("en-US")} characters. The rest is too long to read aloud.`,
			);
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

/**
 * A selection surface's dismissal contract: when the KEY this control speaks
 * for goes away - the highlight is cleared, the highlight moves, the subject
 * stops being the subject - the audio that key owns goes with it.
 *
 * WHY THIS LIVES BESIDE THE CONTROL RATHER THAN IN EACH TOOLBAR (branding § 9):
 * both selection toolbars need exactly this rule, and a second copy of it is
 * how the two drifted before. The rule is KEY-SCOPED and that scoping is the
 * safety: only the dismissed key's playback is stopped and only its in-flight
 * fetch is cancelled, so a selection dismissal can never take down a message
 * row's audible read.
 *
 * Called at the TOP of the toolbar's render path with the CURRENT highlight's
 * key or `null`. The effect's cleanup runs when that value changes (the
 * highlight moved) and when the toolbar unmounts (the highlight cleared, the
 * row windowed away), which are exactly the moments the reader's dismissal
 * becomes true; the hook renders nothing and subscribes to nothing.
 */
export function useSpeakDismissal(key: string | null): void {
	useEffect(() => {
		if (key === null) return;
		return () => {
			/*
			 * Via `getState()` so the cleanup cannot hold a stale closure over
			 * anything but the key it was registered for.
			 */
			useSpeechStore.getState().dismiss(key);
		};
	}, [key]);
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
export const SpeakButton = ({ control, side = "top" }: SpeakButtonProps) => {
	/*
	 * The disabled state's reason needs a non-pointer path (design review round
	 * 1, D2): the tooltip is the only place the sentence lives, and a disabled
	 * button takes no focus, so a keyboard or screen-reader reader met a control
	 * that was off with no stated reason. The wrapper carries the description
	 * and a visually-hidden twin of the tooltip sentence; safe on every surface
	 * because they all render this one component.
	 */
	const reasonId = useId();
	return (
		<Tooltip content={control.tooltip} side={side}>
			<span
				className={cn("flex")}
				aria-describedby={control.disabled ? reasonId : undefined}
			>
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
				{control.disabled && (
					<span id={reasonId} className="sr-only">
						{control.tooltip}
					</span>
				)}
			</span>
		</Tooltip>
	);
};
