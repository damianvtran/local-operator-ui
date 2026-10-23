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
import { useNavigate } from "react-router-dom";
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

export function useSessionSwitcherKeys(): SessionSwitcherView & {
	/** Commit a row the pointer chose; `null` is a no-op close. */
	commitAt: (index: number | null) => void;
} {
	const navigate = useNavigate();
	const navigateRef = useRef(navigate);
	navigateRef.current = navigate;

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
			const displayed =
				panelSessionIdOfView(
					sessions.activeDraftKey,
					sessions.activeDraftKey
						? sessions.drafts[sessions.activeDraftKey]?.sessionId
						: undefined,
					sessions.activeSessionId,
				) || null;
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
			if (event.defaultPrevented) return;
			if (
				run.current !== null &&
				event.key === "Escape" &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey
			) {
				/* Escape cancels and never commits. It is swallowed so the surface
				 * beneath (a chat pane, the drawer) does not also act on it. */
				event.preventDefault();
				close();
				return;
			}
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
		 * COMMIT ON RELEASE. Control's own keyUp, not Tab's: the gesture is "hold
		 * Control, tap Tab as far as you want, let go", which is the muscle memory the
		 * OS switchers taught. Focus never moves into this overlay, so the keyUp lands
		 * on the document whatever had the caret.
		 */
		const onKeyUp = (event: KeyboardEvent) => {
			if (event.key !== "Control") return;
			if (run.current === null) return;
			commitAt(run.current.cursor);
		};

		/* An abandoned run never commits: losing the window or hiding the document is
		 * not a choice of row. */
		const onBlur = () => {
			if (run.current !== null) close();
		};
		const onVisibilityChange = () => {
			if (document.visibilityState !== "visible") onBlur();
		};

		document.addEventListener("keydown", onKeyDown);
		document.addEventListener("keyup", onKeyUp);
		window.addEventListener("blur", onBlur);
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			document.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("blur", onBlur);
			document.removeEventListener("visibilitychange", onVisibilityChange);
			/* A run left behind by an unmount must not keep a timer alive. */
			if (revealTimer.current !== null) {
				window.clearTimeout(revealTimer.current);
				revealTimer.current = null;
			}
			run.current = null;
		};
	}, [close, commitAt, publish]);

	return { ...view, commitAt };
}
