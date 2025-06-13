import { useCallback, useEffect, useRef } from "react";

/**
 * Priority levels for speech-to-text handlers
 * Higher numbers have higher priority
 */
export enum SpeechToTextPriority {
	MESSAGE_INPUT = 1,
	INLINE_EDIT = 2,
}

type SpeechToTextHandler = {
	id: string;
	priority: SpeechToTextPriority;
	handler: () => void;
	isActive: () => boolean;
};

/**
 * Global registry for speech-to-text handlers
 * This ensures only one handler receives the event at a time
 */
class SpeechToTextManager {
	private handlers = new Map<string, SpeechToTextHandler>();
	private isListening = false;
	private isSpacebarListening = false;
	private spacebarTimerRef: NodeJS.Timeout | null = null;

	/**
	 * Register a speech-to-text handler
	 */
	register(
		id: string,
		priority: SpeechToTextPriority,
		handler: () => void,
		isActive: () => boolean,
	): void {
		this.handlers.set(id, { id, priority, handler, isActive });
		this.setupListener();
		this.setupSpacebarListener();
	}

	/**
	 * Unregister a speech-to-text handler
	 */
	unregister(id: string): void {
		this.handlers.delete(id);
		if (this.handlers.size === 0) {
			this.removeListener();
			this.removeSpacebarListener();
		}
	}

	/**
	 * Handle the speech-to-text event by dispatching to the highest priority active handler
	 */
	private handleSpeechToText = (): void => {
		// Get all active handlers sorted by priority (highest first)
		const activeHandlers = Array.from(this.handlers.values())
			.filter((h) => h.isActive())
			.sort((a, b) => b.priority - a.priority);

		// Execute only the highest priority handler
		if (activeHandlers.length > 0) {
			activeHandlers[0].handler();
		}
	};

	/**
	 * Handle spacebar keydown events for hold-to-talk functionality
	 */
	private handleSpacebarKeyDown = (event: KeyboardEvent): void => {
		if (event.code !== "Space" || this.spacebarTimerRef) {
			return;
		}

		// Check if an input-like element is focused
		const activeElement = document.activeElement as HTMLElement;
		if (
			activeElement &&
			(activeElement.tagName === "INPUT" ||
				activeElement.tagName === "TEXTAREA" ||
				activeElement.isContentEditable)
		) {
			return; // Don't interfere with typing
		}

		// Get the highest priority active handler
		const activeHandlers = Array.from(this.handlers.values())
			.filter((h) => h.isActive())
			.sort((a, b) => b.priority - a.priority);

		if (activeHandlers.length === 0) {
			return;
		}

		event.preventDefault();

		// Start timer for hold-to-talk (1 second delay)
		this.spacebarTimerRef = setTimeout(() => {
			activeHandlers[0].handler();
		}, 1000);
	};

	/**
	 * Handle spacebar keyup events to cancel timer or stop recording
	 */
	private handleSpacebarKeyUp = (event: KeyboardEvent): void => {
		if (event.code !== "Space") {
			return;
		}

		// Clear the timer if it exists
		if (this.spacebarTimerRef) {
			clearTimeout(this.spacebarTimerRef);
			this.spacebarTimerRef = null;
		}

		// Note: We don't handle stopping recording here as that's component-specific
		// Each component should handle their own recording state management
	};

	/**
	 * Setup the IPC listener if not already listening
	 */
	private setupListener(): void {
		if (!this.isListening) {
			window.electron.ipcRenderer.on(
				"start-speech-to-text",
				this.handleSpeechToText,
			);
			this.isListening = true;
		}
	}

	/**
	 * Setup spacebar event listeners if not already listening
	 */
	private setupSpacebarListener(): void {
		if (!this.isSpacebarListening) {
			window.addEventListener("keydown", this.handleSpacebarKeyDown);
			window.addEventListener("keyup", this.handleSpacebarKeyUp);
			this.isSpacebarListening = true;
		}
	}

	/**
	 * Remove the IPC listener
	 */
	private removeListener(): void {
		if (this.isListening) {
			window.electron.ipcRenderer.removeListener(
				"start-speech-to-text",
				this.handleSpeechToText,
			);
			this.isListening = false;
		}
	}

	/**
	 * Remove spacebar event listeners
	 */
	private removeSpacebarListener(): void {
		if (this.isSpacebarListening) {
			window.removeEventListener("keydown", this.handleSpacebarKeyDown);
			window.removeEventListener("keyup", this.handleSpacebarKeyUp);
			this.isSpacebarListening = false;
		}

		// Clean up any pending timer
		if (this.spacebarTimerRef) {
			clearTimeout(this.spacebarTimerRef);
			this.spacebarTimerRef = null;
		}
	}
}

// Global singleton instance
const speechToTextManager = new SpeechToTextManager();

/**
 * Hook for registering a speech-to-text handler with priority-based dispatch
 *
 * This hook handles both IPC events and spacebar hold functionality globally.
 * Components no longer need to implement their own spacebar handling logic.
 *
 * @param id - Unique identifier for this handler
 * @param priority - Priority level (higher numbers have higher priority)
 * @param handler - Function to call when speech-to-text is triggered
 * @param isActive - Function that returns whether this handler should be active
 *
 * @example
 * ```tsx
 * useSpeechToTextManager(
 *   'inline-edit',
 *   SpeechToTextPriority.INLINE_EDIT,
 *   handleStartRecording,
 *   () => !isLoading && !isRecording && !isTranscribing && canEnableRecordingFeature
 * );
 * ```
 */
export const useSpeechToTextManager = (
	id: string,
	priority: SpeechToTextPriority,
	handler: () => void,
	isActive: () => boolean,
): void => {
	const handlerRef = useRef(handler);
	const isActiveRef = useRef(isActive);

	// Update refs when dependencies change
	handlerRef.current = handler;
	isActiveRef.current = isActive;

	const stableHandler = useCallback(() => {
		handlerRef.current();
	}, []);

	const stableIsActive = useCallback(() => {
		return isActiveRef.current();
	}, []);

	useEffect(() => {
		speechToTextManager.register(id, priority, stableHandler, stableIsActive);

		return () => {
			speechToTextManager.unregister(id);
		};
	}, [id, priority, stableHandler, stableIsActive]);
};
