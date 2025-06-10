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
	}

	/**
	 * Unregister a speech-to-text handler
	 */
	unregister(id: string): void {
		this.handlers.delete(id);
		if (this.handlers.size === 0) {
			this.removeListener();
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
}

// Global singleton instance
const speechToTextManager = new SpeechToTextManager();

/**
 * Hook for registering a speech-to-text handler with priority-based dispatch
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
