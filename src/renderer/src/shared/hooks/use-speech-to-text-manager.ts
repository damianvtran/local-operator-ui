import { useCallback, useEffect, useRef } from "react";

/**
 * Priority levels for speech-to-text handlers
 * Higher numbers have higher priority
 */
export enum SpeechToTextPriority {
	MESSAGE_INPUT = 1,
	INLINE_EDIT = 2,
}

/**
 * ONE RESOLUTION POINT FOR THE PUSH-TO-TALK BINDING.
 *
 * The sibling keymap work (`keymap.push_to_talk`, a desktop-scoped hotkey row)
 * will replace the body of this function; nothing else in this module reads
 * the binding, so that lands here as a one-line change rather than as a
 * second listener that has to be kept in step.
 *
 * Right-Option by default, and the choice is the prior-art brief's: a bare
 * modifier types nothing, no surveyed macOS product binds it, and Electron
 * delivers `AltRight` to the renderer's own keydown/keyup pair (a MAIN-process
 * chord cannot be driven headlessly, which is why the binding lives here).
 * `MetaRight` on the other platforms, which is the same gesture one key over
 * and is not exercised by this tree yet - stated rather than implied.
 */
/**
 * Which host this is, for the one binding whose default differs per platform.
 * A module-level constant because the check runs on every engage.
 */
const MAC_PLATFORM = /Mac|iPhone|iPad/;

export const resolvePushToTalkBinding = (): { code: string } => {
	const platform =
		typeof navigator === "undefined" ? "" : (navigator.platform ?? "");
	return MAC_PLATFORM.test(platform)
		? { code: "AltRight" }
		: { code: "MetaRight" };
};

/**
 * What a registered component does for a HOLD: a start on the binding's
 * keydown and a stop on its release.
 *
 * `stop` takes the REASON because release and abort are different outcomes for
 * the component that owns the recording: a release confirms what was said
 * (subject to the component's own minimum-clip rule), an abort means the press
 * was never a hold at all - a second key landed, or the component is going
 * away - and its capture is discarded rather than transcribed.
 */
export type HoldActionHandler = {
	/** Begin the hold action. Called on the binding's keydown, immediately. */
	start: () => void;
	/** End the hold action: the binding was released, or the hold was aborted. */
	stop: (reason?: "release" | "abort") => void;
};

type SpeechToTextHandler = {
	id: string;
	priority: SpeechToTextPriority;
	handler: HoldActionHandler;
	isActive: () => boolean;
};

/**
 * Global registry for speech-to-text handlers
 * This ensures only one handler receives the event at a time
 */
class SpeechToTextManager {
	private handlers = new Map<string, SpeechToTextHandler>();
	private isListening = false;
	/**
	 * The handler a hold is currently dispatched to, and the fact that lets the
	 * keyup reach it: the components' own `isActive` turns false the moment a
	 * recording starts, so release cannot ask the registry again - it would find
	 * the composer inactive and leave the recording orphaned.
	 */
	private engaged: { id: string; handler: HoldActionHandler } | null = null;

	/**
	 * Register a speech-to-text handler
	 */
	register(
		id: string,
		priority: SpeechToTextPriority,
		handler: HoldActionHandler,
		isActive: () => boolean,
	): void {
		this.handlers.set(id, { id, priority, handler, isActive });
		this.setupListener();
	}

	/**
	 * Unregister a speech-to-text handler
	 */
	unregister(id: string): void {
		this.handlers.delete(id);
		/*
		 * A HOLD DOES NOT OUTLIVE ITS REGISTRATION. This handler is going away
		 * with a recording possibly in flight (the composer unmounts on the
		 * New-chat identity flip), and a recording nothing can release is the
		 * orphan this whole contract exists to prevent. Aborted rather than
		 * released: the handler is unmounting, so there is no one left for a
		 * transcript to land in.
		 */
		if (this.engaged?.id === id) {
			const { handler } = this.engaged;
			this.engaged = null;
			try {
				handler.stop("abort");
			} catch {
				// The component is unmounting mid-call; nothing to salvage here.
			}
		}
		if (this.handlers.size === 0) {
			this.removeListener();
		}
	}

	/**
	 * Handle the speech-to-text event by dispatching to the highest priority active handler
	 */
	private handleSpeechToText = (): void => {
		const active = this.highestActive();
		if (active) active.handler.start();
	};

	/**
	 * Whether a bare-Space hold may engage: it may not while focus is in an
	 * input-like element, where a space is a space.
	 *
	 * THE GUARD IS KEPT FOR THE LEGACY BINDING ONLY. The modifier combo does not
	 * consult it: `AltRight` types nothing in a textarea, so suppressing it
	 * while the user is typing would be the old defect (the composer is exactly
	 * where someone dictating sits) wearing a different key.
	 */
	private spaceFocusGuardRefuses(): boolean {
		const activeElement = document.activeElement as HTMLElement | null;
		return Boolean(
			activeElement &&
				(activeElement.tagName === "INPUT" ||
					activeElement.tagName === "TEXTAREA" ||
					activeElement.isContentEditable),
		);
	}

	/**
	 * The highest-priority handler that would accept a hold right now.
	 */
	private highestActive(): SpeechToTextHandler | null {
		const activeHandlers = Array.from(this.handlers.values())
			.filter((h) => h.isActive())
			.sort((a, b) => b.priority - a.priority);
		return activeHandlers[0] ?? null;
	}

	/**
	 * Dispatch a hold. `preventDefault` so the binding never types: that is
	 * load-bearing for the modifier combo exactly as it was for Space.
	 */
	private engage(event: KeyboardEvent): void {
		const active = this.highestActive();
		if (!active) return;
		event.preventDefault();
		this.engaged = { id: active.id, handler: active.handler };
		active.handler.start();
	}

	/**
	 * End the engaged hold, if any.
	 */
	private releaseHold(reason: "release" | "abort"): void {
		const engaged = this.engaged;
		if (!engaged) return;
		this.engaged = null;
		engaged.handler.stop(reason);
	}

	/**
	 * The window keydown listener, in the CAPTURE phase so it sees the press
	 * before any focused component can act on it (and before a textarea's own
	 * keydown). No timer anywhere: engagement happens on this event.
	 */
	private handleKeyDown = (event: KeyboardEvent): void => {
		/*
		 * An IME composition owns its keys; a hold is never part of one.
		 */
		if (event.isComposing) return;
		const ptt = resolvePushToTalkBinding();
		const isPttKey = event.code === ptt.code;
		const isSpace = event.code === "Space";
		if (event.repeat) {
			/*
			 * Auto-repeat is the key still being held, not a second press, and
			 * not a second key: ignore it entirely.
			 */
			if (isPttKey || isSpace) return;
		}
		if (isPttKey) {
			/*
			 * THE RELEASE SEMANTICS OF THIS KEY ARE `engaged`'s: a keydown while
			 * a hold is already engaged is the same physical press repeating -
			 * there is nothing to start.
			 */
			if (!this.engaged) this.engage(event);
			return;
		}
		if (this.engaged) {
			/*
			 * A SECOND KEY LANDS: the bare modifier has grown into a
			 * combination (the user is typing Alt-something, not talking), and a
			 * hold that is part of a combination was never a hold. Aborted, so
			 * whatever the press captured is discarded rather than transcribed.
			 */
			this.releaseHold("abort");
			return;
		}
		if (isSpace) {
			if (this.spaceFocusGuardRefuses()) return;
			this.engage(event);
		}
	};

	/**
	 * The matching keyup ends the hold. Both ends of the binding call
	 * `preventDefault` so the combo never types anywhere in the window.
	 */
	private handleKeyUp = (event: KeyboardEvent): void => {
		if (!this.engaged) return;
		const ptt = resolvePushToTalkBinding();
		if (event.code === ptt.code || event.code === "Space") {
			event.preventDefault();
			this.releaseHold("release");
		}
	};

	/**
	 * The window losing focus means the keyup will arrive somewhere else (a
	 * Cmd-Tab, another app). Released rather than left engaged: a recording
	 * nothing can end is the orphan case, and a release keeps the words.
	 */
	private handleWindowBlur = (): void => {
		this.releaseHold("release");
	};

	/**
	 * Setup the IPC listener and the window's hold listeners if not already
	 * listening
	 */
	private setupListener(): void {
		if (!this.isListening) {
			window.electron.ipcRenderer.on(
				"start-speech-to-text",
				this.handleSpeechToText,
			);
			/*
			 * CAPTURE for keydown: the hold must start on the press itself
			 * (there is no timer to wait for a release anymore), and a focused
			 * control that handles the key first must not swallow it. The keyup
			 * listener is on the bubble phase, where nothing else listens.
			 */
			window.addEventListener("keydown", this.handleKeyDown, true);
			window.addEventListener("keyup", this.handleKeyUp);
			window.addEventListener("blur", this.handleWindowBlur);
			this.isListening = true;
		}
	}

	/**
	 * Remove the IPC listener and the window's hold listeners
	 */
	private removeListener(): void {
		if (this.isListening) {
			window.electron.ipcRenderer.removeListener(
				"start-speech-to-text",
				this.handleSpeechToText,
			);
			window.removeEventListener("keydown", this.handleKeyDown, true);
			window.removeEventListener("keyup", this.handleKeyUp);
			window.removeEventListener("blur", this.handleWindowBlur);
			this.isListening = false;
		}
		// A hold cannot outlive the listeners that would release it.
		if (this.engaged) {
			const { handler } = this.engaged;
			this.engaged = null;
			try {
				handler.stop("abort");
			} catch {
				// See `unregister`.
			}
		}
	}
}

// Global singleton instance
const speechToTextManager = new SpeechToTextManager();

/**
 * Hook for registering a speech-to-text handler with priority-based dispatch
 *
 * This hook handles both IPC events (the Cmd/Ctrl+Shift+S toggle) and the
 * window's hold bindings globally. Components no longer need to implement
 * their own hold handling logic; they own what a hold DOES:
 *
 * @param id - Unique identifier for this handler
 * @param priority - Priority level (higher numbers have higher priority)
 * @param handler - The hold action pair (`{ start, stop }`)
 * @param isActive - Function that returns whether this handler should accept a hold
 *
 * @example
 * ```tsx
 * useSpeechToTextManager(
 *   'inline-edit',
 *   SpeechToTextPriority.INLINE_EDIT,
 *   { start: handleStartRecording, stop: handleStopRecording },
 *   () => !isRecording && !isTranscribing && canEnableRecordingFeature
 * );
 * ```
 */
export const useSpeechToTextManager = (
	id: string,
	priority: SpeechToTextPriority,
	handler: HoldActionHandler,
	isActive: () => boolean,
): void => {
	const handlerRef = useRef(handler);
	const isActiveRef = useRef(isActive);

	// Update refs when dependencies change
	handlerRef.current = handler;
	isActiveRef.current = isActive;

	const stableHandler = useRef<HoldActionHandler>({
		start: () => handlerRef.current.start(),
		stop: (reason) => handlerRef.current.stop(reason),
	});
	const stableIsActive = useCallback(() => {
		return isActiveRef.current();
	}, []);

	useEffect(() => {
		speechToTextManager.register(
			id,
			priority,
			stableHandler.current,
			stableIsActive,
		);

		return () => {
			speechToTextManager.unregister(id);
		};
	}, [id, priority, stableIsActive]);
};
