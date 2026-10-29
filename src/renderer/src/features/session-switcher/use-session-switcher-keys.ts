/**
 * The Ctrl+Tab switcher's listeners: the chord, the timer that withholds the
 * overlay, and the three ways a run is abandoned.
 *
 * WHY A DEDICATED HOOK RATHER THAN THE KEYMAP REGISTRY. The assignable-shortcut
 * grammar cannot spell `tab` at all (`keymap-chord.ts`: the edit-ending keys are
 * refused), and the chord is a HELD one - it commits on the keyUp of Control,
 * which no chord in that registry can express. Extending the registry to carry
 * press/release pairings would widen a grammar every persisted binding is parsed
 * with to serve one fixed gesture. So the listeners live here, and the rules they
 * follow live beside them in `session-switcher-model.ts`.
 *
 * BUBBLE PHASE, and `defaultPrevented` as a second guard rather than the arbiter:
 * a surface that claimed the press (xterm for a shell, an editor) keeps it, and
 * the browser is decided by `browserOwnsTabChord` on both keys - see that
 * function's docstring for the rule in one sentence. Listener order never decides
 * anything: if the browser's own door runs first it preventDefaults and this
 * handler stops; if this one runs first the predicate bails.
 *
 * ESCAPE IS THE ONE CLAIM MADE IN THE CAPTURE PHASE, and it is claimed rather
 * than merely answered. A run only exists while Control is held, so every real
 * Escape during one carries `ctrlKey: true`; the app's Esc-to-interrupt
 * (`use-interrupt-on-escape.ts`) reads no modifiers, sits on `window` in the
 * BUBBLE phase, and would otherwise stop the running turn of the conversation
 * the reader is cancelling their way out of. Claiming Escape on `window` in the
 * CAPTURE phase - the first stop on the path, ahead of every Radix layer's
 * document-capture listener - with `preventDefault` and `stopPropagation` means
 * no layer below ever sees that press, while the interrupt's own deferred
 * `defaultPrevented` read agrees if it ever runs first.
 */

import { browserOwnsTabChord } from "@features/browser/hooks/use-browser-chords";
import { pressLandsOnOverlay } from "@features/chat/keyboard-scopes";
import { openConversation } from "@features/chat/open-conversation";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	panelSessionIdOfView,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import {
	parseConversationRecents,
	useUiPreferencesStore,
} from "@shared/store/ui-preferences-store";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
	SESSION_SWITCHER_REVEAL_MS,
	type SwitcherRow,
	buildSwitcherRows,
	commitSessionId,
	initialSwitcherCursor,
	stepSwitcherCursor,
	switcherPress,
} from "./session-switcher-model";

/** What the overlay draws. `visible` is false for the first 180 ms of a run. */
export type SessionSwitcherView = {
	visible: boolean;
	rows: SwitcherRow[];
	cursor: number | null;
};

/**
 * A run in progress: the rows frozen at the opening press, where the cursor is,
 * and which conversation is the one on screen (the commit's no-op comparison).
 *
 * The rows are frozen on purpose. The catalogue can change under a held chord (a
 * conversation finishing, an archive landing), and a list that re-orders while
 * the reader is stepping through it would move the row out from under the
 * selection they are about to commit.
 */
type SwitcherRun = {
	rows: SwitcherRow[];
	cursor: number | null;
	currentSessionId: string | null;
	visible: boolean;
};

const CLOSED: SessionSwitcherView = { visible: false, rows: [], cursor: null };

/**
 * Whether a run is open right now, for the surfaces that answer a key BEFORE the
 * document does.
 *
 * THAT IS THE CONSOLE, and it is the only reason this is a module-level reader
 * rather than React state: xterm's custom key handler (`console-mirror.tsx`)
 * decides whether Tab reaches the page at all, so a run that lost Control's
 * keyup has to be able to take a plain Tab there to end itself - a run the
 * terminal keeps the key from is a run nothing can close. A component cannot be
 * asked from inside a third-party terminal's DOM handler, and threading this
 * through context would make the console depend on being a child of the
 * switcher.
 */
let runOpen = false;

/** Read {@link runOpen} for a surface that consumes a key before the document. */
export function sessionSwitcherRunOpen(): boolean {
	return runOpen;
}

export function useSessionSwitcherKeys(): SessionSwitcherView & {
	/** Commit a row the pointer chose; `null` is a no-op close. */
	commitAt: (index: number | null) => void;
	/** Move the selection to a row the pointer is over; the release then commits it. */
	hoverAt: (index: number) => void;
} {
	const navigate = useNavigate();
	const navigateRef = useRef(navigate);
	navigateRef.current = navigate;

	/*
	 * THE ROUTE, read at press time through a ref for the reason `navigateRef`
	 * exists: the listener that opens a run is registered once, and a value it
	 * closed over would answer with the render it was born in.
	 */
	const { pathname } = useLocation();
	const pathnameRef = useRef(pathname);
	pathnameRef.current = pathname;

	const capabilities = useDesktopCapabilities();
	const archiveEnabled = desktopFeatureEnabled(
		capabilities.data,
		"session_archive",
	);
	const archiveEnabledRef = useRef(archiveEnabled);
	archiveEnabledRef.current = archiveEnabled;

	const [view, setView] = useState<SessionSwitcherView>(CLOSED);
	const run = useRef<SwitcherRun | null>(null);
	const revealTimer = useRef<number | null>(null);

	const publish = useCallback(() => {
		const current = run.current;
		setView(
			current === null
				? CLOSED
				: {
						visible: current.visible,
						rows: current.rows,
						cursor: current.cursor,
					},
		);
	}, []);

	const close = useCallback(() => {
		if (revealTimer.current !== null) {
			window.clearTimeout(revealTimer.current);
			revealTimer.current = null;
		}
		run.current = null;
		runOpen = false;
		setView(CLOSED);
	}, []);

	const commitAt = useCallback(
		(index: number | null) => {
			const current = run.current;
			if (current === null) return;
			const id = commitSessionId(current.rows, index, current.currentSessionId);
			close();
			if (id !== null) void openConversation(navigateRef.current, id);
		},
		[close],
	);

	useEffect(() => {
		/**
		 * Build the run from the stores AS THEY ARE AT THE PRESS (`getState`), the
		 * palette hook's own idiom: a listener that closed over the rows would answer
		 * with the render it was born in after a navigation or a catalogue refresh.
		 */
		const openRun = (delta: 1 | -1): boolean => {
			const sessions = useCanonicalSessionsStore.getState();
			/*
			 * ONLY A CHAT ROUTE HAS A CONVERSATION ON SCREEN. `activeSessionId` survives
			 * a navigation away from the chat (Settings reads it on purpose, and nothing
			 * clears it), so reading it unconditionally made the conversation the reader
			 * had just left row 0 and "current" on Settings and on the browser route:
			 * the first press stepped past it, and stepping back to it was a no-op that
			 * could never take them back. The gate is the app's own
			 * (`app.tsx`: `pathname.startsWith("/chat") ? displayedSessionId : null`).
			 */
			const onChatRoute = pathnameRef.current.startsWith("/chat");
			const displayed = onChatRoute
				? panelSessionIdOfView(
						sessions.activeDraftKey,
						sessions.activeDraftKey
							? sessions.drafts[sessions.activeDraftKey]?.sessionId
							: undefined,
						sessions.activeSessionId,
					) || null
				: null;
			const rows = buildSwitcherRows({
				sessions: sessions.sessions,
				recents: parseConversationRecents(
					useUiPreferencesStore.getState().conversationRecents,
				),
				displayedSessionId: displayed,
				archiveEnabled: archiveEnabledRef.current,
				archiveFacts: sessions.archiveFacts,
			});
			/*
			 * FEWER THAN TWO ROWS IS NOT A SWITCHER. The press is still swallowed (the
			 * caller did that before asking), because leaving it to the browser would
			 * move focus out of the composer for a gesture that does nothing else.
			 */
			if (rows.length < 2) return false;
			runOpen = true;
			run.current = {
				rows,
				cursor: stepSwitcherCursor(
					initialSwitcherCursor(displayed !== null),
					delta,
					rows.length,
				),
				currentSessionId: displayed,
				visible: false,
			};
			/* The overlay is withheld so a tap-and-release paints nothing. The timer
			 * starts HERE, on the chord's own keydown, rather than on the Control
			 * keydown: Control alone is held for 180 ms every time somebody types
			 * Ctrl+C. */
			revealTimer.current = window.setTimeout(() => {
				revealTimer.current = null;
				if (run.current === null) return;
				run.current.visible = true;
				publish();
			}, SESSION_SWITCHER_REVEAL_MS);
			publish();
			return true;
		};

		const onKeyDown = (event: KeyboardEvent) => {
			/*
			 * A RUN THAT LOST CONTROL'S KEYUP ENDS ON THE NEXT KEY THAT SAYS CONTROL IS
			 * UP. The run is ended by Control's release, and a release can go missing (an
			 * OS shortcut taken mid-hold, a keyup delivered while a native view held
			 * focus); without this the overlay stayed up and owned the keyboard, and the
			 * next stray release somewhere else committed a row nobody chose. It cancels
			 * rather than commits: a press with Control up is not a choice of row. Asked
			 * BEFORE the `defaultPrevented` guard, because a surface claiming this press
			 * (a dialog's Escape, a list's Tab) is still evidence that Control is up.
			 */
			if (run.current !== null && !event.ctrlKey) {
				/*
				 * A TAB HERE IS CLAIMED, so focus stays where the run began. The console
				 * hands a plain Tab back to the page while a run is open (console-mirror),
				 * precisely so this listener can end the lost run - and an unclaimed Tab
				 * would then move focus out of the terminal that produced it. Claimed on
				 * this branch only: every other key that reports Control up is the reader
				 * typing into whatever they moved on to, and swallowing those would be
				 * their keystrokes gone.
				 */
				if (event.key === "Tab") event.preventDefault();
				close();
				return;
			}
			if (event.defaultPrevented) return;
			/* THE FOCUS RULE, asked once for every key this surface answers. True means
			 * the keyboard is the browser panel's and Ctrl+Tab/Shift+Tab are its own tab
			 * chords - including Ctrl+`, so a press from inside the panel never paints
			 * this overlay over a page the browser is driving. */
			if (
				browserOwnsTabChord(
					document,
					event.target instanceof Node ? event.target : null,
				)
			) {
				return;
			}
			const press = switcherPress(event);
			if (press === null) return;
			const current = run.current;
			/* An open overlay owns its keys (the app's own dispatch rule 4,
			 * `keyboard-scopes.ts`): a press made from inside a dialog, menu or select
			 * starts no run, and the dialog keeps its press untouched. */
			if (current === null && pressLandsOnOverlay(event.target)) return;
			/* Swallowed in EVERY case - a repeat, a one-row run, the opening press -
			 * so the key never moves focus and a held Tab cannot strobe the overlay. */
			event.preventDefault();
			if (press.repeat) return;
			if (current === null) {
				openRun(press.delta);
				return;
			}
			current.cursor = stepSwitcherCursor(
				current.cursor,
				press.delta,
				current.rows.length,
			);
			publish();
		};

		/*
		 * ESCAPE CANCELS, WHATEVER CONTROL IS DOING, AND IT IS CLAIMED FIRST.
		 *
		 * A run only exists while Control is held - the release is the commit - so a
		 * real Escape during one always carries `ctrlKey: true`, which is exactly what
		 * the old bubble-phase branch refused. The press then fell through to chat's
		 * Esc-to-interrupt on `window` (bubble, no modifier test) and STOPPED THE
		 * RUNNING TURN of the conversation the reader was cancelling their way out of,
		 * before committing the switch anyway.
		 *
		 * So it is answered here, on `window` in the CAPTURE phase - the first stop on
		 * the path, ahead of the document-capture listeners every Radix layer uses -
		 * and CLAIMED: `preventDefault` so the interrupt's deferred read of
		 * `defaultPrevented` refuses it too, `stopPropagation` so nothing beneath sees
		 * the press at all. Ctrl and Shift are allowed (Control is held by definition
		 * here); Cmd and Alt are somebody else's gesture and are left alone, as is an
		 * Escape that is cancelling an IME's candidate string.
		 */
		const onEscapeKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || run.current === null) return;
			if (event.metaKey || event.altKey || event.isComposing) return;
			event.preventDefault();
			event.stopPropagation();
			close();
		};

		/*
		 * COMMIT ON RELEASE. Control's own keyUp, not Tab's: the gesture is "hold
		 * Control, tap Tab as far as you want, let go", which is the muscle memory the
		 * OS switchers taught. Focus never moves into this overlay, so the keyUp lands
		 * on the document whatever had the caret.
		 */
		const onKeyUp = (event: KeyboardEvent) => {
			if (run.current === null) return;
			if (event.key === "Control") {
				commitAt(run.current.cursor);
				return;
			}
			/* The same lost-release rule as the keydown above, on the other half of a
			 * press: a key released with Control up ends the run instead of leaving it
			 * holding the keyboard. */
			if (!event.ctrlKey) close();
		};

		/*
		 * AND ON THE POINTER, for the case the keyboard listeners cannot see: Control
		 * let go while the window was in the background, then a press inside the app.
		 * A press ON A ROW is excluded - that is the pointer choosing that row, and the
		 * row's own handler commits it - so only a press somewhere else, with Control
		 * reported up, cancels.
		 */
		const onPointerDown = (event: PointerEvent) => {
			if (run.current === null || event.ctrlKey) return;
			if (
				event.target instanceof Element &&
				event.target.closest("[data-session-id]")
			)
				return;
			close();
		};

		/* An abandoned run never commits: losing the window or hiding the document is
		 * not a choice of row. */
		const onBlur = () => {
			if (run.current !== null) close();
		};
		const onVisibilityChange = () => {
			if (document.visibilityState !== "visible") onBlur();
		};

		window.addEventListener("keydown", onEscapeKeyDown, { capture: true });
		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("keyup", onKeyUp);
		document.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("blur", onBlur);
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			window.removeEventListener("keydown", onEscapeKeyDown, { capture: true });
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("keyup", onKeyUp);
			document.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("blur", onBlur);
			document.removeEventListener("visibilitychange", onVisibilityChange);
			/* A run left behind by an unmount must not keep a timer alive. */
			if (revealTimer.current !== null) {
				window.clearTimeout(revealTimer.current);
				revealTimer.current = null;
			}
			run.current = null;
			runOpen = false;
		};
	}, [close, commitAt, publish]);

	/*
	 * THE POINTER MOVES THE SELECTION, the palette's own treatment: a row that a
	 * press commits must show what that press would commit, and hovering is how the
	 * other list in this app says so.
	 */
	const hoverAt = useCallback(
		(index: number) => {
			const current = run.current;
			if (current === null || current.cursor === index) return;
			current.cursor = index;
			publish();
		},
		[publish],
	);

	return { ...view, commitAt, hoverAt };
}
