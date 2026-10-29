import { t } from "@shared/i18n";
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
 * toast (`Reading the first 10,000 characters. The rest is not read aloud.`)
 * is the one channel the app already speaks through, and it is raised HERE so
 * no surface can forget it - and it names no object noun, because this same
 * press serves the selection toolbars, where the clipped thing is a highlight
 * rather than a message (copy review round 3, C-r3-1).
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
import {
	type RadientSpeechBlock,
	speechUnavailableReason,
} from "@shared/lib/speech-gate";
import { cn } from "@shared/lib/utils";
import { useSpeechStore } from "@shared/store/speech-store";
import { showInfoToast } from "@shared/utils/toast-manager";
import { Square, Volume2 } from "lucide-react";
import {
	type ReactNode,
	createContext,
	useContext,
	useEffect,
	useId,
} from "react";

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
	/** The button's accessible name, including the state (`Stop`, `Loading speech. Press again to cancel.`). */
	label: string;
	/** The tooltip sentence: state first, then the gate's reason. */
	tooltip: string;
	isPlaying: boolean;
	isLoading: boolean;
	disabled: boolean;
	/** Loading or playing: an action row must stay visible while this holds. */
	active: boolean;
	/**
	 * The gate's disabled REASON when there is one to state - the shared
	 * table's sentence, never the affordance label. `null` on the arms whose
	 * tooltip is not a reason (the `available === false` state says `Speak
	 * aloud` about a button that has nothing to act on, and repeating the
	 * button's own name as its description helps no one; agent review round 2,
	 * NIT-2). The button binds its description node off exactly this field.
	 */
	reason: string | null;
	press: () => void;
};

/** The two facts a Speak control reads from the credential probe. */
export type SpeechGate = {
	canUseRadientSpeech: boolean;
	speechBlock: RadientSpeechBlock;
};

/*
 * ONE CREDENTIAL PROBE PER SCOPE, NOT PER CONTROL.
 *
 * `useRadientCredentialProbe` is four shared reads (the credentials file, the
 * Radient account, the connectivity gate, the capabilities negotiation), and
 * each read mounts its own TanStack `QueryObserver` per caller. Every answer row
 * in the transcript carries a Speak control, so a pane that mounted 61 rows
 * mounted 61 copies of that observer set inside its one mount task - 18-34% of
 * the task's CPU when the shared queries were stale (renderer profile §4 L2-b).
 * The answer is the same for all of them: it is a fact about the account and
 * the local server, not about a row.
 *
 * So a surface that owns many controls (the transcript pane) wraps them in
 * `SpeechGateScope`, which runs the probe ONCE and hands the two values down;
 * every `useSpeakControl` under it reads them from here and subscribes to no
 * query. When credentials change, the scope's probe re-renders, the memoised
 * value moves, and every consumer re-renders with the new gate and reason - the
 * same propagation the per-row subscriptions gave, from one subscription.
 *
 * `null` means "no scope above this control": a lone control (the legacy
 * message strip, a canvas editor's selection toolbar, a story) keeps running
 * its own probe, so nothing outside a scope changes behaviour.
 */
const SpeechGateContext = createContext<SpeechGate | null>(null);

/**
 * Runs the credential probe once for every Speak control rendered beneath it.
 *
 * The provided value is NEVER `null` - that is the invariant `useSpeechGate`
 * relies on (see there). The probe already returns one object per answer
 * (`use-credentials.ts`, C1), so the value is stable across renders that do
 * not change the answer and a memoised row is not re-rendered by it.
 */
export const SpeechGateScope = ({ children }: { children: ReactNode }) => {
	const probe = useRadientCredentialProbe();
	return (
		<SpeechGateContext.Provider value={probe}>
			{children}
		</SpeechGateContext.Provider>
	);
};

/**
 * The gate for one control: the enclosing scope's answer, or this control's
 * own probe when there is no scope.
 *
 * THE CONDITIONAL HOOK CALL IS STABLE PER COMPONENT INSTANCE, which is the
 * property the rules of hooks protect. Whether a `SpeechGateScope` sits above a
 * fiber is a fact about the tree's shape: adding or removing a provider changes
 * the element type at that position, which unmounts and remounts everything
 * beneath it, so a mounted control never sees the context go from a value to
 * `null` or back. And the scope never provides `null`. A given instance
 * therefore either always calls the probe or never does - the same hook order
 * on every render.
 */
function useSpeechGate(): SpeechGate {
	const scoped = useContext(SpeechGateContext);
	return scoped ?? useRadientCredentialProbe();
}

export function useSpeakControl({
	key,
	getText,
	play,
	available = true,
}: SpeakControlOptions): SpeakControl {
	const { dismiss, stopSpeech, loadingKey, playingKey, audioCache, heardKeys } =
		useSpeechStore();
	const { canUseRadientSpeech, speechBlock } = useSpeechGate();

	const isPlaying = key !== null && playingKey === key;
	const isLoading = key !== null && loadingKey === key;
	const hasAudio = key !== null && audioCache.has(key);
	/*
	 * `Replay speech` is a claim about the reader's experience, and the claim is
	 * only true for audio this session actually played (UX round 2, U-r2-3): a
	 * response that landed for a press the reader cancelled is cached but was
	 * never heard, so its resting control still offers `Speak aloud` - pressing
	 * it is a cache hit, not a second billed call either way.
	 */
	const canReplay = hasAudio && key !== null && heardKeys.has(key);
	const reason = canUseRadientSpeech
		? null
		: speechUnavailableReason("speaking-aloud", speechBlock);
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
	 * answer - `Replay speech` for words this session has already HEARD, so a
	 * second press reads as the replay it is.
	 */
	const label = isPlaying
		? t("ui.common.speech.speak_control.stop")
		: isLoading
			? t("ui.common.speech.speak_control.loading_speech_press_again_to_cancel")
			: canReplay
				? t("ui.common.speech.speak_control.replay_speech")
				: t("ui.common.speech.speak_control.speak_aloud");
	const tooltip = isPlaying
		? t("ui.common.speech.speak_control.stop")
		: isLoading
			? /*
				 * THE SAME sentence as the button's accessible name (copy review round
				 * 1, C3): the two ladders drifted on exactly this rung, and the name is
				 * the string a screen-reader or speech-input user has to say on its
				 * own. The clause names the cancel because U2 made this rung the one
				 * place the reader can take a slow read back (copy review round 2, C2) -
				 * the spinner beside it is `aria-hidden`, so the name is also the only
				 * place a screen-reader user learns the app is busy.
				 */
				t("ui.common.speech.speak_control.loading_speech_press_again_to_cancel")
			: (reason ??
				(canReplay
					? t("ui.common.speech.speak_control.replay_speech")
					: t("ui.common.speech.speak_control.speak_aloud")));

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
			 * character count in the app is (C2), and the remainder clause STATES the
			 * fact rather than a reason (copy review round 2, C1): "too long" read as
			 * a claim about the tail - false whenever the tail is one character long,
			 * which is exactly the message that trips the cap - while the cap is a
			 * property of the PRESS, and one sentence has to be true of every
			 * remainder. The clause names NO object (copy review round 3, C-r3-1):
			 * this press renders on the selection toolbars too, and "this message"
			 * was the wrong object on half of them.
			 */
			showInfoToast(
				t(
					"ui.common.speech.speak_control.reading_the_first_characters_the_rest_is_not_read_aloud",
					{ tolocalestring: text.length.toLocaleString("en-US") },
				),
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
		reason,
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
	/**
	 * Extra classes for the button, merged over the shared ink step.
	 *
	 * WHY THIS EXISTS: the transcript's action row is a BARE icon line
	 * (`message-actions-row.tsx`'s no-container rule), and the shared default's
	 * `hover:bg-accent-wash` would paint a background surface under one of its
	 * icons - the operator's reported regression. The selection toolbars keep
	 * the wash because they float over a selection and need a readable ground;
	 * the transcript row passes `hover:bg-transparent`, and this seam keeps the
	 * exception at the caller rather than making every surface bare.
	 */
	className?: string;
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
export const SpeakButton = ({
	control,
	side = "top",
	className,
}: SpeakButtonProps) => {
	/*
	 * The disabled state's reason needs a non-pointer path (design review round
	 * 1, D2; design round 2, D7): the tooltip is the only place the sentence
	 * lives, and a disabled button takes no focus. The wrapper carries the
	 * description and a visually-hidden twin of the reason - and, because a
	 * description bound to a node nobody can focus reaches only a browse-mode
	 * reader, the wrapper also TAKES FOCUS on the arm where the sentence is a
	 * reason, so a keyboard reader tabbing through meets it too. On the arm
	 * whose tooltip is not a reason (nothing to act on) there is no description
	 * and no tab stop: a focusable wrapper around a control with nothing to say
	 * is furniture (agent review round 2, NIT-2).
	 */
	const reasonId = useId();
	const described = control.disabled && control.reason !== null;
	return (
		<Tooltip content={control.tooltip} side={side}>
			<span
				className={cn("flex")}
				tabIndex={described ? 0 : undefined}
				aria-describedby={described ? reasonId : undefined}
			>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={control.label}
					className={cn(
						"text-ink-dim hover:bg-accent-wash hover:text-accent",
						className,
					)}
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
				{described && (
					<span id={reasonId} className="sr-only">
						{control.reason}
					</span>
				)}
			</span>
		</Tooltip>
	);
};
