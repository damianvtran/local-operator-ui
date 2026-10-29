import { Button } from "@shared/components/ui/button";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";

/** Admission for both pane Stop and its Escape accelerator, before any RPC. */
export function useSoundStopGate({
	sessionId,
	runningSound,
	available,
	onInterrupt,
	onRestoreFocus,
}: {
	sessionId: string | null | undefined;
	runningSound: boolean;
	available: boolean;
	onInterrupt: () => void;
	onRestoreFocus: () => void;
}) {
	const [confirming, setConfirming] = useState(false);
	const paneRef = useRef<HTMLDivElement>(null);
	const previousSession = useRef(sessionId);
	useEffect(() => {
		const sessionChanged = previousSession.current !== sessionId;
		previousSession.current = sessionId;
		if (!sessionChanged && runningSound) return;
		if (!confirming) return;
		setConfirming(false);
		/*
		 * THE QUESTION HAS LOST ITS SUBJECT. A sound call that settles while the
		 * question is open - or a switch to another session - unmounts the safe
		 * choice that currently holds focus, which drops the keyboard to `<body>`:
		 * the next keystroke goes nowhere. The card's own gate restores to its
		 * Stop; this gate's restore is the composer that raised it, so the same
		 * explicit dismissal path runs here.
		 */
		onRestoreFocus();
	}, [sessionId, runningSound, confirming, onRestoreFocus]);
	const keepWaiting = useCallback(() => {
		setConfirming(false);
		onRestoreFocus();
	}, [onRestoreFocus]);
	const stop = useCallback(() => {
		if (!sessionId || !available) return;
		// A card may already own the question. A second entrance only focuses
		// its safe choice, never opens a second question or admits an interrupt.
		const existing = paneRef.current?.querySelector<HTMLButtonElement>(
			"[data-sound-stop-confirmation] button",
		);
		if (existing) {
			existing.focus();
			return;
		}
		if (runningSound) {
			setConfirming(true);
			return;
		}
		onInterrupt();
	}, [sessionId, available, runningSound, onInterrupt]);
	const requestStop = useCallback(() => {
		setConfirming(false);
		onRestoreFocus();
		onInterrupt();
	}, [onInterrupt, onRestoreFocus]);
	/*
	 * MEMOISED, because this element now crosses the composer's `memo` boundary:
	 * an inline element would be a fresh prop on every page render (once per
	 * stream flush) and re-render the whole box. Frozen on the facts it reads.
	 */
	const confirmation = useMemo(
		() =>
			confirming && runningSound ? (
				<SoundStopConfirmation
					onKeepWaiting={keepWaiting}
					onRequestStop={requestStop}
				/>
			) : null,
		[confirming, runningSound, keepWaiting, requestStop],
	);
	return { paneRef, stop, confirmation };
}

/** Shared by the card and pane so every entry point names the same consequence. */
export function SoundStopConfirmation({
	onKeepWaiting,
	onRequestStop,
}: {
	onKeepWaiting: () => void;
	onRequestStop: () => void;
}) {
	useI18nLocale();
	const safeChoice = useRef<HTMLButtonElement>(null);
	const warningId = useId();
	useEffect(() => {
		safeChoice.current?.focus();
		// Document bubble precedes the pane's window listener, but follows
		// Radix's capture-phase dialogs. Backing out must never fall through to
		// the charged interrupt, even when focus left this group.
		const dismiss = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.isComposing || event.defaultPrevented)
				return;
			event.preventDefault();
			event.stopPropagation();
			onKeepWaiting();
		};
		document.addEventListener("keydown", dismiss);
		return () => document.removeEventListener("keydown", dismiss);
	}, [onKeepWaiting]);
	return (
		<fieldset
			data-sound-stop-confirmation=""
			aria-label={t("ui.chat.canonical.sound.stop.confirm_label")}
			className="flex flex-col items-start gap-2"
		>
			<p className="text-meta text-ink" aria-live="polite">
				{t("ui.chat.canonical.sound.stop.question")}
			</p>
			<p id={warningId} className="text-body-sm text-ink-dim">
				{t("ui.chat.canonical.sound.stop.warning")}
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					ref={safeChoice}
					aria-describedby={warningId}
					variant="ghost"
					size="sm"
					onClick={onKeepWaiting}
				>
					{t("ui.chat.canonical.sound.stop.keep_waiting")}
				</Button>
				<Button variant="secondary" size="sm" onClick={onRequestStop}>
					{t("ui.chat.canonical.sound.stop.request_stop")}
				</Button>
			</div>
		</fieldset>
	);
}
