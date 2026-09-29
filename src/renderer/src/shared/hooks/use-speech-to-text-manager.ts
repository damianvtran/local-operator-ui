import {
	type BackendSettings,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
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
 * ONE RESOLUTION POINT FOR THE PUSH-TO-TALK BINDING, consuming the registry
 * row (`keymap.push_to_talk`, local-operator's bare-modifier hold family) - the
 * seam this module reserved when the binding was a hard-coded platform pair.
 *
 * The row stores one of six tokens (`alt|meta|ctrl` x `left|right`, `-hold`);
 * the renderer READS the persisted value once per handler registration through
 * the desktop transport and maps token -> `{code, label}` here. Nothing else
 * in this module reads the binding, so the keydown path asks this one
 * synchronous function at key time and a second listener never has to be kept
 * in step.
 *
 * CODES. `alt` is the command-position modifier - Alt on macOS, Meta elsewhere
 * - which is why the registry's default token (`alt-right-hold`) keeps
 * today's binding on every platform: `AltRight`/"Right-Option" on macOS,
 * `MetaRight`/"Right-Command" elsewhere. `meta` and `ctrl` map to their own
 * codes everywhere; on non-mac platforms `alt` and `meta` therefore name the
 * same physical modifier (the registry keeps them distinct tokens, and this
 * seam reports the aliasing rather than inventing a third key).
 *
 * LABELS follow the token, one source: the registry's own per-platform scheme
 * (`alt` -> Option/Command, `meta` -> Command/Win/Super, `ctrl` -> Control),
 * so whoever changes the stored value changes what both tooltips teach. The
 * label here is the key NAME because both tooltips compose "or hold ${label}"
 * - the registry's settings surface is what appends " (hold)".
 *
 * A MAIN-PROCESS CHORD COULD NOT CARRY THIS BINDING ANYWAY: a bare modifier
 * held down is not expressible as an Electron accelerator, and a
 * `before-input-event` chord cannot be driven headlessly - which is why the
 * binding lives here, in the renderer's own keydown/keyup pair.
 */
const MAC_PLATFORM = /Mac|iPhone|iPad/;
type PlatformFamily = "darwin" | "win32" | "other";
type PushToTalkBinding = { code: string; label: string };

/**
 * The registry's modifier names, per platform - the same table its own
 * `display_key` renders from (one scheme, two surfaces).
 */
const MODIFIER_LABELS: Record<PlatformFamily, Record<string, string>> = {
	darwin: { alt: "Option", meta: "Command", ctrl: "Control" },
	win32: { alt: "Command", meta: "Win", ctrl: "Control" },
	other: { alt: "Command", meta: "Super", ctrl: "Control" },
};

/** Read per call, never cached: the tests drive every family from one process. */
const platformFamily = (): PlatformFamily => {
	const platform =
		typeof navigator === "undefined" ? "" : (navigator.platform ?? "");
	if (MAC_PLATFORM.test(platform)) return "darwin";
	return /Win/i.test(platform) ? "win32" : "other";
};

const codeForToken = (
	modifier: string,
	side: string,
	family: PlatformFamily,
): string => {
	const base =
		modifier === "alt"
			? family === "darwin"
				? "Alt"
				: "Meta"
			: modifier === "meta"
				? "Meta"
				: "Control";
	return `${base}${side === "left" ? "Left" : "Right"}`;
};

/**
 * One stored value -> this surface's binding, or `null` when it is not one of
 * the six tokens (`null` = "no resolution", the caller falls back). Case and
 * whitespace are normalised the way the registry normalises on write; an
 * unknown or invalid value is a FALLBACK, never an error - both tooltips call
 * this on the render path, so it cannot throw.
 *
 * Exported for the resolution test; production reads go through
 * `resolvePushToTalkBinding`.
 */
export const pushToTalkBindingForToken = (
	raw: unknown,
): PushToTalkBinding | null => {
	if (typeof raw !== "string") return null;
	const parts = /^(alt|meta|ctrl)-(left|right)-hold$/.exec(
		raw.trim().toLowerCase(),
	);
	if (!parts) return null;
	const family = platformFamily();
	const [, modifier, side] = parts;
	return {
		code: codeForToken(modifier, side, family),
		label: `${side === "left" ? "Left" : "Right"}-${MODIFIER_LABELS[family][modifier]}`,
	};
};

const platformDefaultBinding = (): PushToTalkBinding =>
	pushToTalkBindingForToken("alt-right-hold") as PushToTalkBinding;

let resolvedPushToTalkBinding: PushToTalkBinding | null = null;

/** The live binding: the last resolved row, or the platform default. */
export const resolvePushToTalkBinding = (): PushToTalkBinding =>
	resolvedPushToTalkBinding ?? platformDefaultBinding();

let pushToTalkRefresh: Promise<void> | null = null;

/**
 * Read the persisted `keymap.push_to_talk` row and re-resolve.
 *
 * Single-flight (concurrent asks share one transport call) and called from
 * `register()` - the moment a surface that will use the binding comes up. A
 * refresh that FAILS leaves the last resolution in place: an unreachable
 * settings plane tells us nothing new, and silently reverting a user's custom
 * binding because one read missed is worse than serving the last known value.
 * There is deliberately no settings listener here (no new listener on any
 * settings channel); a caller that changes the row can call this directly.
 */
export const refreshPushToTalkBinding = async (): Promise<void> => {
	if (pushToTalkRefresh) return pushToTalkRefresh;
	pushToTalkRefresh = (async () => {
		try {
			const settings = await desktopResult<BackendSettings>({
				op: "settings.list",
			});
			const row = settings.settings.find(
				(setting) => setting.key === "keymap.push_to_talk",
			);
			resolvedPushToTalkBinding = pushToTalkBindingForToken(row?.value);
		} catch {
			/* Keep the last resolution (see the doc above). */
		} finally {
			pushToTalkRefresh = null;
		}
	})();
	return pushToTalkRefresh;
};

/*
 * WHICH COMPONENTS CURRENTLY OWN A RECORDING, as a plain module fact.
 *
 * The Escape ladder's rung 4 ("Esc during a recording cancels the recording and
 * never the turn") has to be answerable by the interrupt hook, which lives in
 * the page ABOVE the surfaces that record and cannot see their state. Reading
 * it from `defaultPrevented` was the first shape and it is order-dependent: the
 * interrupt's listener is registered before the composer's, so on the trusted
 * key path it reads the flag BEFORE the composer's own claim runs, queues its
 * microtask, and the turn dies with the recording (UX round 1, U1 - reproduced
 * 7/7). A presence the predicate can read directly removes the race instead of
 * tightening it.
 *
 * Deliberately a Set of ids rather than a flag: two recorders cannot outlive
 * their unmounts, each id's cleanup drops only its own seat, and the reader is
 * a function called at KEY TIME (not a value captured at subscribe time), so no
 * re-render is needed for the answer to be current.
 */
const activeDictation = new Set<string>();

export const setDictationActive = (id: string, active: boolean): void => {
	if (active) activeDictation.add(id);
	else activeDictation.delete(id);
};

export const isDictationActive = (): boolean => activeDictation.size > 0;

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
 *
 * Exported so a node-level test can drive the capture-phase contract without
 * mounting React (`scripts/hold-escape-claim.test.mjs`): the registration hook
 * below is the only production entry point, and it still owns the one
 * singleton this module installs.
 */
export class SpeechToTextManager {
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
		/*
		 * RE-READ THE ROW WHENEVER A SURFACE THAT USES THE BINDING COMES UP. The
		 * stored value can change between mounts (the settings page, `lop config
		 * edit`), and registration is the one moment this module hears about; a
		 * refresh is single-flight and a failed one keeps the last resolution
		 * (see `refreshPushToTalkBinding`). Not awaited: the binding this
		 * surface uses is the synchronous resolver, which serves the platform
		 * default until the read lands.
		 */
		void refreshPushToTalkBinding();
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
			 *
			 * AND WHEN THAT KEY IS ESCAPE, THE HOLD CLAIMS THE PRESS (QA round 1,
			 * Q-1). Rung 4's promise - "Esc during a recording cancels the
			 * recording and never the turn" - must hold on the PTT door too, and
			 * on that door this branch runs in the CAPTURE phase, AHEAD of the
			 * turn interrupt's own guard. Settling here re-renders, and the
			 * re-render's passive effects detach the composer's own Escape
			 * listener and clear the live recording presence before any bubble
			 * listener runs - so the guard, whose read comes later in the same
			 * dispatch, found "no recording" and killed the turn (measured 3/3 on
			 * this door while the mic-button door passed, whose settle happens
			 * after the guard's read). `preventDefault` is a property of the
			 * EVENT and is set NOW, ahead of all of that churn: the guard's
			 * predicate and its microtask both read it, whenever they run.
			 *
			 * Other second keys keep their defaults: only Escape is the rung-4
			 * key, and swallowing an arbitrary combination here would claim keys
			 * this module has no business claiming.
			 */
			if (event.key === "Escape") event.preventDefault();
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
