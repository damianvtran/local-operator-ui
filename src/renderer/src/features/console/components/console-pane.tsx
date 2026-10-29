import { usePaneNoticeEscape } from "@shared/components/common/slot-pane-notice";
import { Button, Tooltip } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import {
	isConsoleUnseen,
	useUiPreferencesStore,
} from "@shared/store/ui-preferences-store";
import {
	Archive,
	Bot,
	Lock,
	LockOpen,
	PanelRightClose,
	Plus,
	X,
} from "lucide-react";
import {
	type FC,
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useConsoleBlipPulse } from "../hooks/use-console-attention";
import { useConsoleSession } from "../hooks/use-console-session";
import {
	type ConsoleSurface,
	consoleOpenAction,
	pickActiveSurface,
	pickLiveSurface,
	surfaceTitle,
	surfacesForSession,
} from "../model/console-surfaces";
import { ConsoleCloseDialog } from "./console-close-dialog";
import { ConsoleMirror } from "./console-mirror";
import {
	ConsoleCreateFailed,
	ConsoleEmpty,
	ConsoleEndedBar,
	ConsoleHistoryEnd,
	ConsoleLoading,
	ConsoleNotice,
	ConsoleSecureBar,
	ConsoleUnavailable,
} from "./console-states";

/**
 * KEYS THAT ARE NOT TERMINAL INPUT (U2/m-3).
 *
 * The refusal sentence must be true, so it is announced only for keys that would
 * have gone to the program: a printable character, Enter, Backspace, Delete, a
 * paste. Navigation (Tab, Escape, the arrows, PgUp/PgDn, Home/End) and every chord
 * are somebody else's — scrolls, selection, focus movement, copy — and claiming
 * they were "not sent" is a lie a screen-reader user pays for on every press.
 */
const NON_INPUT_KEYS = new Set([
	"Tab",
	"Escape",
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"PageUp",
	"PageDown",
	"Home",
	"End",
	"Shift",
	"Control",
	"Alt",
	"Meta",
]);

/**
 * The row's close control, revealed while its row is INACTIVE.
 *
 * THE BROWSER STRIP'S OWN RULE, taken verbatim (`browser-tab-strip.tsx`'s
 * `REVEAL_ON_HOVER_OR_FOCUS`): the active row's control is always visible, and an
 * inactive row's is revealed by hover OR by focus-within - never by `display`, so
 * the reveal cannot move the layout, and never by opacity alone, because a
 * focusable-but-clickable control under the pointer is how a press meant for the
 * row lands on the close. `pointer-events-none` while hidden is the second half
 * of that: the row's own hover is what reveals the control, so the control does
 * not have to be hoverable to be found.
 */
const REVEAL_ON_HOVER_OR_FOCUS =
	"pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100";

/**
 * The console: the FOURTH occupant of the conversation's right slot.
 *
 * Design: `local-operator`'s
 * `docs/design/ui-console-tab.md` — that repository's file, not one in this tree. 6.1 (the pane, its lens and its width),
 * 6.2 (recall on a session switch), 6.4 (the pty's lifetime is the surface's, never
 * the pane's), 6.5 (provenance: the surface's own command, and the agent marker the
 * browser's strip uses), 7.3 (the ended state), 9.4 (the pane's chrome is the app's
 * and the terminal's colours stay inside the mirror), 12.2 (the blip and when it is
 * cleared).
 *
 * IT IS THE SLOT'S FOURTH MODE, NOT A ROUTE AND NOT A TOGGLE THAT LOSES THE
 * SESSION. Everything the three existing occupants do, this one does the same way:
 * one name in `claimRightSlot`'s union (so opening it closes its siblings by
 * construction), one width preference the divider drags, one `{isOpen && …}` block
 * in `chat-content.tsx`, and one trigger in the header cluster. There is no
 * `/console` route, because a route has no session — and a console whose identity
 * depended on which route was open would be a second place the "which surface am I
 * looking at" question is answered.
 *
 * THE PANE IS REMOUNTED ON A SESSION SWITCH (`chat-page.tsx` keys the session panel
 * on `identity`), so the pane must be able to re-attach with its history intact.
 * That is not a nicety and it is not free: the lens lives in the STORE
 * (`consoleActiveSurface`) rather than in this component, the mirror subscribes on
 * mount and replays the surface's retained bytes before it streams (§7.1: the log
 * and the core never stopped while the pane was away), and §6.2's three cases —
 * another session's surfaces, back to the first session's still-running ones, and
 * the surface an agent opened — are all the same mechanism: the registry is keyed
 * by session and the pane filters by it.
 *
 * WHAT THIS COMPONENT NEVER DOES: it never resizes a surface (the mirror reports
 * measurements and main decides — §8), it never signals a pty on unmount (§6.4:
 * there is no path from "pane unmounts" to "pty receives a signal", which is what
 * makes "keeps running while the tab is closed" true rather than accidental), and
 * it never reads a keystroke for the app's benefit (§11.4: human input goes from
 * the mirror to the pty master and nowhere else).
 */
export interface ConsolePaneProps {
	/** The conversation this pane is scoped to, or `null` on a draft. */
	sessionId: string | null;
	onClose: () => void;
}

export const ConsolePane: FC<ConsolePaneProps> = ({ sessionId, onClose }) => {
	/*
	 * THE DRAFT STATE CLOSES ON ESCAPE, like its siblings (UX round 1, U2): the Run
	 * details and Code review notices a draft's doors open close on an unclaimed
	 * Escape, and this state reads as one of them. Armed ONLY on a draft: a live
	 * console is a terminal, and Escape is a key the program in it owns (an
	 * editor's mode switch, a TUI's back) - closing the pane on it would take that
	 * key from every program run here.
	 */
	usePaneNoticeEscape(onClose, sessionId === null);
	/** The slot's lens. See the header comment for why this is not `useState`. */
	const stored = useUiPreferencesStore((state) => state.consoleActiveSurface);
	const setStored = useUiPreferencesStore(
		(state) => state.setConsoleActiveSurface,
	);
	const unseen = useUiPreferencesStore((state) => state.consoleUnseen);
	const clearUnseen = useUiPreferencesStore(
		(state) => state.clearConsoleUnseen,
	);
	/* The user's own open of this pane, waiting to be answered (see the store's
	 * `consoleOpenIntent` for why a request is not carried in a prop). */
	const openIntent = useUiPreferencesStore((state) => state.consoleOpenIntent);
	const clearOpenIntent = useUiPreferencesStore(
		(state) => state.clearConsoleOpenIntent,
	);
	/**
	 * A ONE-SHOT request for the terminal to take the caret, handed to the mirror and
	 * CONSUMED by the mirror that applies it.
	 *
	 * ONE-SHOT IS THE PROPERTY THAT MATTERS, and it is the second one this token has
	 * had (agent review round 1, F-1; UX round 1, U1). It was a monotonic counter for
	 * the life of the mount, and the mirror is KEYED ON THE SURFACE — so a lens change
	 * inside one pane instance (an agent's `console_create` in the conversation on
	 * screen, a completion banner's click for another surface, the fallback when the
	 * shown surface leaves the listing) re-keyed the mirror, it mounted carrying the
	 * stale token, and it pulled the caret out of the composer of whatever the user was
	 * typing in. Cleared as soon as a mirror has applied it, a later mount inside the
	 * same pane finds nothing to apply. Gating on "the token changed since mount"
	 * instead would break the create case, whose mirror mounts AFTER the request.
	 *
	 * LOCAL STATE ON PURPOSE, and the reset a remount performs is the second belt: the
	 * pane is remounted on a session switch (`chat-page.tsx` keys it on `identity`),
	 * so a caret request cannot outlive the open that asked for it either.
	 */
	const [focusRequest, setFocusRequest] = useState(0);
	/**
	 * Whether the open this pane is answering is still waiting for main to make a
	 * surface — the window `createSurface`'s promise exists to cover, and one the
	 * loading state above is the honest thing to show: the pane HAS been asked for a
	 * terminal and does not have one yet, so "no console in this session" and its `+`
	 * would be an answer to a question nobody is asking, with a second press in it
	 * making a second surface.
	 */
	/*
	 * A COUNT, NOT A FLAG (agent review round 2, m-1): the `+` press and the
	 * open-from-outside path can both have a create in flight, and with one boolean
	 * whichever answered first re-enabled the `+` while the other was still running.
	 * `creating` is true while ANY create runs.
	 */
	const [createsInFlight, setCreatesInFlight] = useState(0);
	const creating = createsInFlight > 0;
	const beginCreate = useCallback(
		() => setCreatesInFlight((count) => count + 1),
		[],
	);
	const endCreate = useCallback(
		() => setCreatesInFlight((count) => Math.max(0, count - 1)),
		[],
	);
	/* One answer for the whole list: whether a completion is still fresh enough to
	   pulse (§12.2's two states), asked once rather than per row. */
	const blipPulsing = useConsoleBlipPulse(unseen);

	const session = useConsoleSession(sessionId);
	const surfaces = useMemo(
		() => surfacesForSession(session.snapshot, sessionId),
		[session.snapshot, sessionId],
	);
	const surface = useMemo(
		() => pickActiveSurface(session.snapshot, sessionId, stored),
		[session.snapshot, sessionId, stored],
	);
	/** The surface an explicit open may focus instead of the one the lens remembers
	 * (see `consoleOpenAction`): the most recently active RUNNING surface. */
	const liveSurface = useMemo(
		() => pickLiveSurface(session.snapshot, sessionId),
		[session.snapshot, sessionId],
	);
	const setConsoleLiveSurface = useUiPreferencesStore(
		(state) => state.setConsoleLiveSurface,
	);
	/**
	 * THE RAIL'S LIVENESS FACT, published rather than re-read.
	 *
	 * The rail needs "does this conversation have a running terminal" to decide
	 * whether its console item is the lit one, and the pane is the only component
	 * with that listing. Publishing a projection keeps one reader of the projection
	 * (the pane's `useConsoleSession`) instead of mounting a second one in
	 * `chat-content` or polling for it. `running`, not `live`: a restored surface is
	 * `live: false` AND `running: false`, and only a process makes a console active.
	 */
	useEffect(() => {
		setConsoleLiveSurface(
			sessionId,
			session.loading ? 0 : surfaces.filter((row) => row.running).length,
		);
	}, [sessionId, session.loading, surfaces, setConsoleLiveSurface]);
	// The fact dies with the pane: a stale count from a closed pane would light (or
	// unlight) the rail for a conversation nobody is looking at. It is a transient
	// projection, not the persisted preferences it sits beside (`persistedUiPreferences`
	// excludes it for the same reason it excludes the open intent).
	useEffect(
		() => () => setConsoleLiveSurface(null, 0),
		[setConsoleLiveSurface],
	);
	/**
	 * Which surface's ended terminal last swallowed a key, if any.
	 *
	 * THE ID RATHER THAN A BOOLEAN, so switching surfaces clears the announcement by
	 * construction: the sentence is shown only while the surface it was said for is
	 * still the one on screen, and a new surface cannot inherit it. An effect that
	 * reset a flag on a surface change would be the same rule spelled with an extra
	 * render and a dependency the body never reads.
	 */
	const [historyAnnounce, setHistoryAnnounce] = useState<{
		surface: string;
		tick: number;
	} | null>(null);
	const [historyAnnouncement, setHistoryAnnouncement] = useState("");
	const historyInputBlocked =
		surface !== null && historyAnnounce?.surface === surface.surface;
	const announceTick = historyAnnounce?.tick ?? 0;
	/*
	 * A LIVE REGION ONLY ANNOUNCES A CHANGE, so a second key on the same ended
	 * surface must change the text. Clearing it and setting the same sentence one
	 * frame later is the smallest honest way to re-announce; the visible band never
	 * flickers because the clear and the set are one animation frame apart and the
	 * output reserves its line (D3).
	 */
	useEffect(() => {
		if (!historyInputBlocked) {
			setHistoryAnnouncement("");
			return;
		}
		setHistoryAnnouncement("");
		const timer = setTimeout(
			() =>
				setHistoryAnnouncement(
					// The alternating zero-width space is a second reason the text differs:
					// some screen readers ignore a clear-and-set inside one frame, and an
					// identical string is never re-announced.
					t("ui.console.ended.input_blocked") +
						(announceTick % 2 === 1 ? "\u200B" : ""),
				),
			40,
		);
		return () => clearTimeout(timer);
	}, [announceTick, historyInputBlocked]);
	/**
	 * A KEY PRESSED ON ENDED HISTORY: SWALLOWED, AND SAID SO.
	 *
	 * The mirror's `disableStdin` already stops xterm from sending the key, so the
	 * moment a person types into a finished terminal produces nothing anywhere. That
	 * silence is the defect this function exists to refuse: it is the same lie as the
	 * painted caret, one layer down. The choice made here — rather than starting a
	 * fresh console from a keystroke — is deliberate: a key on history is most often
	 * a scroll, a copy, or a reflex, and silently spawning a shell from it would
	 * replace the recording the user was reading. The explicit open is the action
	 * that creates a terminal (`consoleOpenAction`), and the sentence below tells the
	 * user that door exists.
	 *
	 * It listens over the mirror's OWN subtree rather than the whole pane so the +,
	 * the tabs and the close control keep their ordinary keys, and it exempts the
	 * copy chord: xterm's selection copy runs before the key would be encoded, and
	 * "that key was not sent" would be false about a copy that worked.
	 */
	const announceEndedInput = useCallback(
		(event: ReactKeyboardEvent<HTMLDivElement>) => {
			if (!surface || surface.running) return;
			// A chord (copy, select-all, the app's own accelerators) can succeed, so it
			// is not "not sent"; navigation keys are the page's (U2/m-3).
			if (event.metaKey || event.ctrlKey || event.altKey) return;
			if (NON_INPUT_KEYS.has(event.key)) return;
			const target = event.target as HTMLElement | null;
			if (!target?.closest("[data-console-mirror]")) return;
			setHistoryAnnounce((previous) => ({
				surface: surface.surface,
				tick: (previous?.surface === surface.surface ? previous.tick : 0) + 1,
			}));
		},
		[surface],
	);

	/* Whether main says a console can exist at all (§15). Read once and used in two
	   places — the body's state choice and the header's `+` — because a `+` that is
	   offered where none can be created is the pane's own "a control with nothing to
	   act on lies". */
	const available = session.snapshot.available;
	/**
	 * The surface whose Close question is open, and whether the close it confirmed is
	 * still in flight (issue #754).
	 *
	 * THE QUESTION IS STORED AS THE ID, not as the row object: a listing refresh while
	 * the dialog stands replaces every row, and a stored object would ask about a
	 * terminal described by bytes nobody will call `close` about.
	 */
	const [pendingClose, setPendingClose] = useState<string | null>(null);
	/*
	 * THE QUESTION OWED BY A DISMISSAL (design round 1, D6). A retained exit's X
	 * used to delete its output in one click with no confirmation, while the
	 * running-close path already asked. It is the SAME modal with different copy,
	 * so a second dialog is not added — only a second reason to open this one.
	 */
	const [pendingDismiss, setPendingDismiss] = useState<string | null>(null);
	const [closing, setClosing] = useState(false);
	/**
	 * The refusal of the last confirmed press, in main's own words, and the counter
	 * that moves the keyboard back to the safe answer (UX round 1, U3): a refused
	 * close must not read as a press that did nothing. A COUNTER rather than a
	 * boolean because `ConfirmationModal` takes its `focusCancelSignal` as a change —
	 * a second refusal must move the keyboard again. Cleared when a question opens
	 * afresh and on cancel.
	 */
	const [closeRefusal, setCloseRefusal] = useState<string | null>(null);
	const [closeRefusalSeq, setCloseRefusalSeq] = useState(0);
	/**
	 * The row the question is about, read fresh from the listing: `retain` is
	 * published per row (§7.2) and the copy says the output is kept ONLY where that
	 * flag says the history persists (UX round 1, U6) — a sentence the agent-owned
	 * case would falsify.
	 */
	const pendingRow =
		pendingClose === null
			? null
			: (surfaces.find((row) => row.surface === pendingClose) ?? null);
	/**
	 * WHERE THE KEYBOARD GOES WHEN THE ROW IT WAS IN LEAVES (UX round 1, U1).
	 *
	 * A close or a dismissal removes the control the keyboard was in — the row's X,
	 * or the row a question came from — and the browser drops the focus it cannot
	 * keep to `<body>`, so the reader's next Tab restarts at the top of the
	 * document. This is the class the repo fixed for the delete dialog (`base-dialog`
	 * restores an opener that still CONTAINS itself; a removed one is exactly the
	 * arm it cannot answer), so the pane hands the keyboard over itself. It holds a
	 * SURFACE ID rather than a boolean because it must survive until the listing
	 * says the row is gone — the removal is asynchronous with the press.
	 */
	const focusAfterRemoval = useRef<string | null>(null);
	/**
	 * The refusal as a sentence for a person.
	 *
	 * THE IPC REJECTION WRAPS THE HANDLER'S ERROR in the channel's own prefix
	 * (`Error invoking remote method 'console-close-surface': Error: …`), which is
	 * not something to show anybody; the last `Error: ` clause is the handler's own
	 * sentence and the one worth rendering — the monitor cancel's "the backend's own
	 * sentence" rule, applied to a bridge that prefixes its own.
	 */
	const refusalCopy = (failure: unknown) => {
		const raw =
			failure instanceof Error ? failure.message : String(failure ?? "");
		const at = raw.lastIndexOf("Error: ");
		const detail = (at === -1 ? raw : raw.slice(at + "Error: ".length)).trim();
		return detail === "" ? t("ui.console.pane.close_refusal") : detail;
	};

	/**
	 * The row's own close: a RUNNING surface asks first, an ENDED one is dismissed
	 * outright, and the two flags that difference produces are what main's `close`
	 * takes (design 6.7, 7.3; the reading issue #754 settled).
	 *
	 * WHY A RUNNING CLOSE ASKS AND AN ENDED ONE DOES NOT. A running surface has a
	 * live process behind it, and `host.close` refuses a kill-less close of one
	 * rather than orphaning a pty — so the honest control is "end it, behind a
	 * question", and the question defaults to the safe answer (Cancel holds the
	 * keyboard; `ConsoleCloseDialog` carries the rest). An ended surface has nothing
	 * left to end: the press dismisses it with `retain: false`, which is the flag
	 * that removes it from the retained registry. That flag is not decoration — the
	 * `retain` default for a user's surface is ON, so a dismissal that did not say
	 * this would be restored at the next launch, which is exactly the friction
	 * #754's repro reports ("restart the app: the ended tab is still in the strip").
	 *
	 * Automatic release is now the host's completed-only lifecycle policy, not
	 * a pane timer. The explicit X remains a user choice to discard this history.
	 */
	const requestSurfaceClose = (row: ConsoleSurface) => {
		setCloseRefusal(null);
		if (row.running) {
			focusAfterRemoval.current = row.surface;
			setPendingClose(row.surface);
			return;
		}
		/*
		 * A RETAINED EXIT ASKS FIRST (design round 1, D6): its X deletes output from
		 * disk, which is not a one-click act. An exit that was NOT retained has
		 * nothing on disk to lose, so it still dismisses outright.
		 */
		if (row.retain) {
			focusAfterRemoval.current = row.surface;
			setPendingDismiss(row.surface);
			return;
		}
		dismissEndedSurface(row);
	};

	/**
	 * The dismissal itself, in ONE place because it now has TWO triggers (the row's X
	 * and #929's beat): `retain: false` is what removes the surface from the retained
	 * registry, and a second call site spelling it itself is how the two would drift.
	 *
	 * The handoff bookkeeping is set before the call for the same reason the press
	 * path always set it: if the row IS removed, the keyboard it may have been inside
	 * is owed a home (the effect below reads it back off the listing). A REFUSED close
	 * clears nothing — the catch below carries the why — so whether anything is owed is
	 * decided by the effect, off the real listing, once the row has actually left.
	 */
	const dismissEndedSurface = (row: ConsoleSurface) => {
		focusAfterRemoval.current = row.surface;
		void session.closeSurface(row.surface, { retain: false }).catch(() => {
			/*
			 * A REFUSAL DOES NOT CANCEL A HANDOFF (agent review round 1, F-2), so this catch
			 * deliberately clears nothing. The two refusals this path meets want opposite
			 * outcomes: a racer that removed the surface first owes the handoff (the row IS
			 * gone), while a refusal that left the row standing owes nothing — and nothing
			 * readable HERE can tell them apart. The pane's own listing cannot: the winning
			 * close's removal may not have rendered yet when this catch runs, which is exactly
			 * the interleave of a press inside the beat's expiry (measured while fixing F-2:
			 * the listing-guarded variant of this catch still cleared in that order and left
			 * the keyboard on `<body>`; the render suite pins the order). So the handoff effect
			 * below — the one reader of the REAL listing — decides, and it refuses to act while
			 * the row is still listed: a refusal that left the row standing hands nothing off,
			 * and a dismissal that did remove the row keeps the handoff it owed.
			 */
		});
	};

	/**
	 * The dialog's confirm, and the ONE place a running surface is killed.
	 *
	 * `kill: true` rather than nothing, deliberately: the flag says what the user
	 * confirmed — end the process — and a close that left it implicit would become a
	 * silent detach the day main's own default changed, which is a promise this
	 * button cannot keep.
	 */
	/**
	 * The dismissal's confirm (design round 1, D6): the retained exit's output is
	 * deleted from disk. There is no `kill` — the process is already gone — and no
	 * refusal state is kept, because the only refusal this path can meet is the
	 * racing removal, which the withdraw effect above closes on the listing it just
	 * re-read.
	 */
	const confirmSurfaceDismiss = () => {
		if (pendingDismiss === null) return;
		const row = surfaces.find((item) => item.surface === pendingDismiss);
		setPendingDismiss(null);
		if (row) dismissEndedSurface(row);
	};

	const confirmSurfaceClose = () => {
		if (pendingClose === null) return;
		setClosing(true);
		setCloseRefusal(null);
		void session
			.closeSurface(pendingClose, { kill: true })
			.then(() => setPendingClose(null))
			.catch((failure: unknown) => {
				/*
				 * KEPT OPEN AND SAID OUT LOUD (UX round 1, U3): a refused confirm used to
				 * clear the dialog as if it had succeeded, which reads as "I pressed Close
				 * and nothing happened". The dialog stays, states the refusal in the danger
				 * ink, and hands the keyboard back to Cancel (`closeRefusalSeq` is the
				 * modal's `focusCancelSignal`). A refusal whose surface DID leave — the
				 * racing case — needs none of this: the withdraw effect below closes the
				 * question on the listing it just re-read.
				 */
				setCloseRefusal(refusalCopy(failure));
				setCloseRefusalSeq((seq) => seq + 1);
			})
			.finally(() => setClosing(false));
	};

	/*
	 * THE QUESTION WITHDRAWS WHEN ITS SUBJECT STOPS BEING CLOSEABLE: the row left the
	 * listing (an agent's `console_close`, or a racer between the press and the
	 * confirm) OR its process exited while the question stood (UX round 1, U2 — an
	 * ended row STAYS listed, so the old listing-only test never fired for it and
	 * the question would sit there claiming to end something that had already
	 * ended).
	 */
	useEffect(() => {
		if (pendingClose === null && pendingDismiss === null) return;
		const entry = surfaces.find(
			(row) => row.surface === (pendingClose ?? pendingDismiss),
		);
		if (pendingClose !== null) {
			if (entry?.running) return;
			setPendingClose(null);
			/*
			 * The keyboard is owed a handoff only when the ROW is gone; a row that stayed
			 * (it exited) keeps its own control, and the dialog's own restore lands on it.
			 */
			if (entry) focusAfterRemoval.current = null;
			return;
		}
		/*
		 * A DISMISSAL'S QUESTION WITHDRAWS on the same rule: while the row is still a
		 * retained exit the act it names is the act on offer, so the question stands;
		 * once the row left the listing, or is no longer retained (something already
		 * dismissed or restored it), the question is withdrawn.
		 */
		if (entry?.retain) return;
		setPendingDismiss(null);
		if (entry) focusAfterRemoval.current = null;
	}, [pendingClose, pendingDismiss, surfaces]);

	// Automatic completion release belongs to the host's acknowledged-exit
	// lifecycle. A renderer timer must never discard retained/user/secure output.

	/*
	 * THE HANDOFF (UX round 1, U1). The target is the row that now holds the lens —
	 * `pickActiveSurface`'s fallback, so the closed surface's neighbour — or the
	 * empty state's own New console when the strip has nothing left.
	 *
	 * WHY A BOUNDED RE-CHECK rather than a single pass, measured while writing its
	 * test: the commit that removes the row can still carry the DIALOG on screen
	 * with the keyboard inside it, and the dialog's own exit releases it a beat
	 * later (Radix's presence unmounts on a later commit than the state change that
	 * closed it; a detached opener is exactly the arm the primitive cannot restore).
	 * The platform emits no event for "the focused element went away", so the retry
	 * waits on the CONDITION — focus stranded on `<body>`, `null`, or a disconnected
	 * node — and the bound only stops it when the keyboard has a real home elsewhere
	 * (a pointer press on macOS never moved it into the control at all).
	 */
	useEffect(() => {
		const removed = focusAfterRemoval.current;
		if (removed === null) return;
		/*
		 * While a question stands the dialog holds the keyboard, so its own exit is
		 * the moment this effect is waiting for — and the write must not happen
		 * under an open modal.
		 */
		if (pendingClose !== null || pendingDismiss !== null) return;
		if (surfaces.some((row) => row.surface === removed)) return;
		let timer: ReturnType<typeof setTimeout> | null = null;
		let attempts = 0;
		const handoff = () => {
			timer = null;
			const active = document.activeElement;
			const stranded =
				active === null || active === document.body || !active.isConnected;
			if (!stranded) {
				attempts += 1;
				if (attempts <= 20) timer = setTimeout(handoff, 25);
				return;
			}
			focusAfterRemoval.current = null;
			const target =
				surface === null
					? document.querySelector<HTMLElement>(
							'[data-tour-tag="console-new-surface"]',
						)
					: document.querySelector<HTMLElement>(
							`[data-surface="${surface.surface}"] [role="tab"]`,
						);
			target?.focus();
		};
		handoff();
		return () => {
			if (timer !== null) clearTimeout(timer);
		};
	}, [surfaces, surface, pendingClose, pendingDismiss]);

	/*
	 * THE USER'S OWN CREATE SHOWS WHAT IT MADE (#1084). An explicit `+` (or the empty
	 * state's create, or its retry) is a request for a new terminal to work in, so the
	 * lens moves to the created surface and the caret is armed for it. Without this the
	 * stored lens won `pickActiveSurface` and the pane kept showing the old surface,
	 * with the new one only a list row. Armed by the ANSWER, as the open-from-outside
	 * path is (agent review round 3, M1): a refused or empty create arms nothing.
	 *
	 * THE LENS IS MOVED BY AN EFFECT, NOT IN THE `.then`. The store update is sync-lane
	 * and the listing that holds the new surface is React state queued in the same tick,
	 * so writing the lens directly rendered once with the new id and the OLD listing:
	 * `pickActiveSurface` fell back to the old surface and the lens-sync effect below
	 * wrote it straight back. Held as state, the id commits together with the listing.
	 * The lens is set before the caret is armed because the token is consumed by the
	 * mirror that mounts with it, and that has to be the new surface's mirror.
	 */
	const [showCreated, setShowCreated] = useState<{
		id: string;
		from: string | null;
	} | null>(null);
	/*
	 * ONE CREATE PER PRESS IN FLIGHT (agent review round 1, F-2). The press holds
	 * `creating` for the round trip, exactly as the open-from-outside path does, so the
	 * header `+` is disabled while it runs. The ref is the guard and the state is the
	 * render: two clicks dispatched before React commits the disabled button would
	 * both read `creating` as false.
	 */
	const pressInFlight = useRef(false);
	const createFromPress = useCallback(() => {
		if (pressInFlight.current) return;
		pressInFlight.current = true;
		beginCreate();
		// The lens at press time: a row the user picks while the create is in flight is
		// a later, explicit choice, and the landing create must not override it (F-3).
		const from = stored;
		void session
			.createSurface()
			.then((created) => {
				if (created !== null) setShowCreated({ id: created, from });
			})
			.finally(() => {
				pressInFlight.current = false;
				endCreate();
			});
	}, [session.createSurface, stored, beginCreate, endCreate]);
	useEffect(() => {
		if (showCreated === null) return;
		/*
		 * `stored === showCreated.id` is not a later pick (agent review round 2, M-1):
		 * main broadcasts the state change BEFORE the create's reply, so the hook's
		 * re-read can commit the new listing first and the lens-sync effect below
		 * already moved the lens to the created surface (an empty-state create or retry,
		 * where `from` is null). Dropping here lost the caret.
		 */
		if (stored !== showCreated.from && stored !== showCreated.id) {
			setShowCreated(null);
			return;
		}
		if (!surfaces.some((row) => row.surface === showCreated.id)) return;
		setShowCreated(null);
		setStored(showCreated.id);
		setFocusRequest((value) => value + 1);
	}, [showCreated, surfaces, stored, setStored]);

	/*
	 * The lens follows what is actually shown, and that write is what makes the
	 * recall survive a switch: the pane is unmounted while the user is in another
	 * conversation, so the only thing that can remember "this session was reading
	 * that surface" is the store.
	 */
	useEffect(() => {
		if (surface && surface.surface !== stored) setStored(surface.surface);
	}, [surface, stored, setStored]);

	/*
	 * Main is told which surface a pane is showing. It never resizes anything from
	 * this (§10.2's pane ops are a fact, not a lever): what it buys is the honest
	 * `rendered: "displayed"` value on a capture and the answer to "is anybody
	 * looking at this surface", which is the blip's clearing rule.
	 */
	useEffect(() => {
		session.showSurface(surface?.surface ?? null);
		return () => session.showSurface(null);
	}, [session.showSurface, surface?.surface]);

	/*
	 * THE BLIP'S CLEARING RULE (§12.2): cleared when the pane is displayed AND
	 * focused on that surface, which is the same visibility predicate the notifier's
	 * first rung uses — never "could a banner reach them". `document.hasFocus()` is
	 * the renderer's own answer to the window half of it, and the `focus` listener is
	 * what clears a mark when the user comes back to a window that was showing the
	 * surface all along.
	 */
	const [awaitingSurface, setAwaitingSurface] = useState(false);
	useEffect(() => {
		if (!surface) return;
		const surfaceId = surface.surface;
		const clear = () => {
			/*
			 * Q-2: NOT WHILE A CREATE OR THE OPEN REQUEST IS IN FLIGHT. The pane's
			 * fallback display is the old ended row for the commits between the request
			 * and the created surface; clearing on that transient painting consumed the
			 * mark before the user could see which surface finished. The mark belongs to
			 * a look at the REAL displayed surface, so the gate waits for both the
			 * request to clear and every create to answer.
			 */
			/*
			 * Q-2, SECOND CUT (round 2). The first gate still let the mark die in the
			 * post-create commit where the lens had moved to the new live surface: the
			 * ended row had been the fallback display, main had acknowledged it, and
			 * `creating`/the request had both cleared. Three gates now hold:
			 *
			 *  - the pane must be past every create and every open request, including
			 *    the listing catch-up (`awaitingSurface`);
			 *  - MAIN must say this surface is the displayed one (`displayedSurface`),
			 *    not the renderer's fallback opinion;
			 *  - it must have stayed that way for 350 ms, so a transient fallback frame
			 *    cannot consume a mark the user has not looked at.
			 */
			if (
				creating ||
				openIntent === sessionId ||
				awaitingSurface ||
				session.snapshot.displayedSurface !== surfaceId
			)
				return;
			if (document.hasFocus() && isConsoleUnseen(unseen, surfaceId))
				clearUnseen(surfaceId);
		};
		const timer = setTimeout(clear, 350);
		window.addEventListener("focus", clear);
		return () => {
			clearTimeout(timer);
			window.removeEventListener("focus", clear);
		};
		/*
		 * `unseen` IS A DEPENDENCY, AND THE BUG IT CLOSES IS THE OPERATOR'S (2026-10-21):
		 * the watch that writes a mark (`useConsoleAttention`) and this pane both read
		 * the SAME push, and when the completion is the push - a shell exiting while
		 * the user is typing into it - the mark was written AFTER this effect's last
		 * pass and nothing re-ran it. The mark then survived the console's death and an
		 * open look at its history, which is what the rail carried. Re-running on the
		 * store's own update clears it on the commit that paints the mark.
		 */
	}, [
		awaitingSurface,
		clearUnseen,
		creating,
		openIntent,
		session.snapshot.displayedSurface,
		sessionId,
		surface,
		unseen,
	]);

	/*
	 * THE USER'S OPEN, ANSWERED (design 6.1; the operator's report that the pane
	 * "should not greet you with an empty state and a New console button").
	 *
	 * WHAT "OPEN" MEANS: the conversation gets a console if it has none, and the
	 * caret goes into the terminal either way, because a user who opens a console is
	 * about to type at it. `consoleOpenAction` holds the decision and its four
	 * inputs; this effect is the dispatcher and the bookkeeping.
	 *
	 * A REQUEST NAMES THE CONVERSATION IT WAS MADE FOR, and only that conversation's pane
	 * answers it (agent review round 1, F-6): this pane is remounted on a session switch,
	 * so a request still pending when the user switched would otherwise be answered here
	 * — a shell created in a conversation nobody asked about.
	 *
	 * THE REQUEST IS CLEARED ONLY WHEN IT HAS BEEN ANSWERED. "Still loading" is not an
	 * answer — the read is what says whether this conversation already has a surface —
	 * so the request waits there rather than being consumed into a second surface. The
	 * body masks its own empty state on the same flag while it waits: this effect runs
	 * after paint, so the commit in between (the read has settled, `creating` is not yet
	 * set) would otherwise paint "No console in this session" with a live `+` for one
	 * frame (design round 1, D1).
	 */
	const unansweredForThisSession =
		openIntent !== null && openIntent === sessionId;
	/**
	 * A create has answered WITH a surface, and this pane's own listing has not caught up
	 * yet. It exists because the answer and the listing are two different commits: the
	 * promise resolves in the microtask that follows the read's `setSnapshot`, so its
	 * continuation can commit before the listing does, and a mask held by a flag that the
	 * continuation clears is a mask with a gap in it. Under load that gap painted exactly
	 * one commit of the greeting this flow exists to remove — caught once by
	 * `console-pane-render.test.mjs`, which is why this is a STATE the listing settles
	 * rather than a timer: the effect below clears it on the commit that shows the surface.
	 */
	useEffect(() => {
		if (surface !== null) setAwaitingSurface(false);
	}, [surface]);
	useEffect(() => {
		if (!unansweredForThisSession) return;
		/*
		 * A CREATE ALREADY IN FLIGHT ANSWERS THIS REQUEST. The effect re-runs when the
		 * lens or the listing commits (and the listing does commit before a create's
		 * reply), so without this the same open could ask for a second shell. The
		 * request stays filed, and the effect runs again the moment the count returns
		 * to zero - by which time the created surface is either live (focus branch) or
		 * not (a retry is the user's, not this effect's).
		 */
		if (creating) return;
		const action = consoleOpenAction({
			requested: true,
			loading: session.loading,
			available,
			hasLiveSurface: liveSurface !== null,
		});
		if (action === "none") {
			// `available: false` with the read settled is main's own "no console can
			// exist here" (§15): the pane renders that state, and the request is done.
			if (!session.loading) clearOpenIntent(sessionId);
			return;
		}
		/*
		 * The surface a request creates is born with main's own defaults — the login
		 * shell, the 100x30 grid, `reveal: "none"` — exactly as the pane's `+` makes
		 * one, because two ways for a user's surface to come into being is the defect.
		 * Its working directory is main's answer for this session rather than a path
		 * guessed here: the renderer cannot see the conversation's own directory, and a
		 * second opinion about it is how a user's shell ends up somewhere they did not
		 * choose.
		 */
		if (action === "create") {
			// The lens at request time, so a row the user picks while the create is in
			// flight is a later, explicit choice the landing surface must not override
			// (the `+` path's F-3 rule, applied to the open's own create).
			const from = stored;
			beginCreate();
			/*
			 * THE REQUEST IS CLEARED WHEN THE CREATE ANSWERS, not when it is made — the same
			 * rule the comment above states, applied one step further than the first cut did.
			 * Clearing it here, beside `beginCreate()`, still painted the empty state for
			 * one commit, and the reason is the instrument's: a write to the preferences store
			 * inside this effect flushes a render of its own (the store is read through
			 * `useSyncExternalStore`, whose update is sync-lane) BEFORE the `creating` update
			 * queued in the same tick is applied — so that commit had no surface, no
			 * `creating`, no loading and no request, which is the empty state the operator's
			 * report is about. `console-pane-render.test.mjs` asserts per COMMIT and caught it;
			 * a state sampled after the round trip never could.
			 *
			 * THE CARET IS ARMED BY THE ANSWER, NOT BY THE PRESS (agent review round 3, M1).
			 * It used to be armed on the way IN, beside `beginCreate()`, and the created
			 * surface's own mirror then spent it on mount — which works for a create that
			 * succeeds and leaves the request armed for a create that FAILS, with nothing
			 * that will ever spend it: the next surface to appear in this conversation by ANY
			 * route other than the press (main's `onStateChanged` is what an agent's
			 * `console_create` fires) mounted a mirror that inherited the armed token and
			 * pulled the caret out of the composer, which is the case UX's U1 named. So the
			 * invariant is now "the caret is armed by the ANSWER, and only when there is a
			 * surface to put it in": `createSurface` resolves the created id when the listing
			 * after the create holds it, or `null`, and a `null` answer arms nothing.
			 */
			void session
				.createSurface()
				.then((created) => {
					if (created === null) return;
					// THE CREATED SURFACE MUST BE THE ONE SHOWN, which is the half of the
					// operator's report the first cut missed: creating a shell behind a
					// pane still painting the old history leaves the user looking at the
					// dead one and typing at nothing. `showCreated` moves the lens and
					// arms the caret in the same commit as the listing that holds it
					// (#1084's mechanism, reused rather than given a second spelling).
					setAwaitingSurface(true);
					setShowCreated({ id: created, from });
				})
				.finally(() => {
					endCreate();
					clearOpenIntent(sessionId);
				});
		} else {
			/*
			 * A LIVE SIBLING TAKES THE LENS (the operator's report): with one running
			 * surface and one ended one, `pickActiveSurface` may have been showing the
			 * ended row — the remembered lens, or the most recent row. The user's open is
			 * a request to TYPE, so the pane shows the surface that can take keys and
			 * leaves the ended one where it belongs: a row they can click to read. The
			 * branch above is unchanged for a conversation with no live surface, where
			 * the open makes a fresh one rather than focusing the history.
			 */
			if (liveSurface && liveSurface.surface !== surface?.surface) {
				setStored(liveSurface.surface);
			}
			// The surface the request was for is already in the pane, so its mirror is mounted
			// (or mounts with the token) and the caret is armed at once.
			clearOpenIntent(sessionId);
			setFocusRequest((value) => value + 1);
		}
	}, [
		unansweredForThisSession,
		sessionId,
		session.loading,
		session.createSurface,
		available,
		surface,
		liveSurface,
		stored,
		creating,
		setStored,
		clearOpenIntent,
		beginCreate,
		endCreate,
	]);

	if (sessionId === null) {
		return (
			<div
				data-glass-region="pane"
				className={cn("panel-top-pad flex h-full flex-col bg-elevated")}
			>
				{/* The slot's bar at the slot's height and with no ground of its own, so
				    the pane reads as one surface and the bar does not move between a
				    draft and a conversation — and the CLOSE control is in it for
				    the same reason every other occupant of this slot has one: a pane the
				    user cannot close from inside is a pane they have to find the trigger
				    for, and a draft carries the control even though a draft has no session
				    for its `+` to act on. */}
				<div
					className={cn(
						"flex h-10 shrink-0 items-center justify-between gap-2 px-2",
						/*
						 * THE CONTROLS' CORNER, RESERVED (chat redesign §J4). On Windows and Linux
						 * Electron draws the caption buttons into the client area's top-right 40px,
						 * and a pane's toolbar is the row that reaches the window's right edge while
						 * that pane is open - so its trailing control has to end before them.
						 *
						 * PADDING here where the chat header uses a spacer, and the difference is the
						 * row rather than the rule: this row is a single `justify-between` line whose
						 * last child IS the control that must clear the buttons, so reserving the
						 * width at the end is the same thing as moving it left. The header cannot use
						 * padding because its action cluster is `ml-auto` inside a row that can wrap,
						 * and padding there would spend the buttons' width on the wrapped line too.
						 * `max(0.5rem, ...)` keeps the row's own 8px at rest, which is where
						 * `--chrome-inset-end` is 0 (macOS, and every native-frame launch). The inset
						 * is the shell's `--chrome-inset-end-pane` - the OS buttons' width LESS the 44px
						 * panel rail that now stands under their trailing part (#872) - with the full
						 * inset as the fallback for a pane rendered outside the shell.
						 */
						"[padding-inline-end:max(0.5rem,var(--chrome-inset-end-pane,var(--chrome-inset-end)))]",
					)}
					data-tour-tag="console-pane-header"
				>
					<span className={cn("shrink-0 text-meta text-ink-dim")}>
						{t("ui.console.pane.label")}
					</span>
					<Tooltip content={t("ui.console.pane.close")}>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t("ui.console.pane.close")}
							onClick={onClose}
							data-tour-tag="console-pane-close"
						>
							<PanelRightClose aria-hidden="true" />
						</Button>
					</Tooltip>
				</div>
				<ConsoleNotice
					title={t("ui.console.pane.needs_conversation.title")}
					detail={t("ui.console.pane.needs_conversation.detail")}
				/>
			</div>
		);
	}

	const body = () => {
		/*
		 * LOADING FIRST, THEN UNAVAILABLE, THEN EMPTY — and the order is load-bearing
		 * now that main ANSWERS an unavailable state rather than throwing: `available`
		 * is false in the snapshot a pane starts with, so a check on it before the
		 * loading branch would flash "the console is not available" for one frame on
		 * every mount.
		 *
		 * AND A PENDING OPEN IS PART OF "LOADING" (design round 1, D1; agent review round
		 * 1, F-3). There are two windows where the pane has been asked for a terminal and
		 * does not have one yet: the commit where the read has settled and this pane's own
		 * dispatcher has not run, and the create's round trip — which now includes the read
		 * that follows it, so the new listing is in hand before `creating` is cleared. Both
		 * used to be able to paint the empty state with a live `+`, which is the state this
		 * flow exists to remove.
		 */
		if (
			(session.loading ||
				creating ||
				unansweredForThisSession ||
				awaitingSurface) &&
			surfaces.length === 0
		)
			return <ConsoleLoading creating={creating} />;
		/*
		 * THEN THE TWO FAILURES, IN THE ORDER OF WHAT THEY ARE ABOUT. `available: false` is
		 * the host saying no console can exist in this app at all (§15) and carries main's
		 * own reason; a transport error is the other direction — there is no listing to
		 * paint and no reason to quote. A FAILED CREATE IS NEITHER, and is deliberately not
		 * here: it is a state of the BODY below, because the console is available and the
		 * thing to offer is another attempt (design round 1, U2).
		 */
		if (!session.snapshot.available) {
			return (
				<ConsoleUnavailable
					reason={session.snapshot.reason}
					detail={session.snapshot.detail}
					message={null}
				/>
			);
		}
		if (session.error) {
			return (
				<ConsoleUnavailable
					reason={null}
					detail={null}
					message={session.error}
				/>
			);
		}
		if (!surface) {
			/*
			 * A CREATE THAT WAS REFUSED gets its own state rather than the unavailable one,
			 * and the reason is what the first cut got wrong (design round 1, U2): with the
			 * host answering and the CREATE failing, the pane said "the console is not
			 * available in this app" and advised updating the app — for a transient pty
			 * failure — directly above the machine line that named the real cause. The
			 * header `+` stays enabled here, which is the correct half: the action to offer
			 * is another attempt, and the body now offers the same one.
			 */
			if (session.createError) {
				return (
					<ConsoleCreateFailed
						message={session.createError}
						onRetry={createFromPress}
					/>
				);
			}
			return (
				<ConsoleEmpty
					onCreate={createFromPress}
					disabled={sessionId === null}
				/>
			);
		}
		return (
			<div className={cn("flex min-h-0 grow flex-col")}>
				{/* The ended banner is ABOVE the history rather than instead of it (§7.3):
				    a replayed surface shows what it printed and says that nothing is
				    running. `live: false` is the relaunch case and gets its own sentence. */}
				{!surface.running ? (
					<ConsoleEndedBar
						exitCode={surface.exitCode}
						exitSignal={surface.exitSignal}
						live={surface.live}
						endReason={surface.endReason}
					/>
				) : null}
				{/*
				 * `relative` FOR THE SECURE MARKER ONLY: it is an overlay so that
				 * flipping the toggle cannot move the mirror's content box and send the
				 * running program a `SIGWINCH` (§8.2's box is the pane's content box,
				 * and a marker the user flips is not allowed to resize their program).
				 */}
				{/*
				 * `px-2` IS THE PANE'S GUTTER, ON THE TERMINAL TOO (design round 2,
				 * D12). The header's title and the strip's pills are inset by 8 px and
				 * the terminal used to start at the pane's own edge, so the width
				 * allowance was spent as a right-hand gutter of ground rather than as
				 * chrome: measured, 780 px of grid inside an 804 px pane, with column 0
				 * at x=1 against the title's x=9. One gutter, one width, and the 16 px
				 * of chrome in the slot's default (`DEFAULT_RIGHT_SLOT_WIDTH` is 80
				 * columns plus those 16, pinned by `scripts/console-pane.test.mjs`) is
				 * now exactly these two.
				 *
				 * AMENDED (#929, 2026-10-10): "a gutter of ground" then described
				 * RUN-OFF — pane background at the terminal's edge — and a band of it
				 * still framed the terminal wherever this box had no ground of its own:
				 * the padding left and right, and the cell-height main's floor division
				 * leaves unconsumed at the box's foot. The box now paints the terminal's
				 * OWN ground (`bg-sunken`, §9's ground for the mirror) across its whole
				 * box, so the 8 px still inset the GRID — the 16 px above is still
				 * exactly these two — and the gutter is the terminal's ground rather
				 * than the pane's. The ground is painted HERE rather than on the
				 * mirror's own root because the padding sits OUTSIDE the mirror's box:
				 * a ground on the mirror could never reach the gutter, and the
				 * mirror's own stated ground (§9) is this box's background showing
				 * wherever the grid does not paint. `scripts/console-pane.test.mjs`
				 * pins the class string; the frames pin the pixels.
				 */}
				<div
					className={cn("relative flex min-h-0 grow flex-col px-2 bg-sunken")}
					data-console-box=""
					onKeyDownCapture={announceEndedInput}
				>
					{/*
					 * `key` ON THE SURFACE, and it is the re-attach rule rather than a
					 * micro-optimisation: one mirror holds one subscription and one terminal,
					 * so switching surfaces in this pane must dispose the old one — which is
					 * also what drops the old subscription in main (`unsubscribeAll` is
					 * addressed by surface) instead of leaving a stream nobody reads.
					 */}
					<ConsoleMirror
						key={surface.surface}
						surface={surface.surface}
						/*
						 * THE ENDED SURFACE IS HISTORY, NOT A TERMINAL. `history` switches stdin
						 * off, hides the caret in both focus states, and moves the default ink
						 * down one role step (see `readTerminalTheme`). Selection and copy stay
						 * on, because a finished build log is the most likely thing in this pane
						 * to be copied out of.
						 */
						mode={surface.running ? "interactive" : "history"}
						/* The caret, on the user's own open and never on a mount (see
						   `focusRequest` above) — and the token is CONSUMED by the mirror that
						   applies it, so a mirror mounted later for a surface the user never asked
						   for finds a zero and leaves the keyboard where it is.

						   THE CLEAR IS DEFERRED ONE MICROTASK, AND THE DEFERRAL IS NOT WHAT PUTS
						   THE CARET IN THE DEV LOOP — measured, and worth spelling out because
						   this comment used to claim the opposite. What lands the caret is the
						   mirror's own half: it takes neither the keyboard nor the
						   acknowledgement from a terminal it no longer holds (the caret effect
						   in `console-mirror.tsx`), so the request is still standing when the
						   surviving terminal is in state — the StrictMode case in
						   `scripts/console-mirror.test.mjs` is the reading. THAT HALF IS ALSO
						   THE LIMIT OF THE CLAIM: on a mirror WITHOUT it, no ordering of this
						   `setFocusRequest` could give the survivor a token to apply, because
						   the acknowledgement is then emitted from the discarded mount's caret
						   effect before React renders the survivor into state. So the account
						   above is about the unfixed mirror, and it is why the clear was never
						   the thing to change.

						   THE DEFERRAL STAYS, AND IT IS UNOBSERVED RATHER THAN PROVEN INERT:
						   nothing measures that it is needed — the F-1 case above clears
						   synchronously and passes either way — and nothing measures that it is
						   not. Its original rationale (a clear that lands before any LATER mount
						   can inherit the token, since a lens change is a different task) is
						   reasoning this lane did not test either way, so the line is left as it
						   is rather than changed on an unmeasured claim. */
						focusRequest={focusRequest}
						onFocusTaken={(applied) =>
							queueMicrotask(() =>
								setFocusRequest((current) =>
									current === applied ? 0 : current,
								),
							)
						}
						/* The pane is open and this is the surface it is showing, so this
					   mirror is on screen: `visible: true` is what lets main derive a grid
					   from its report at all (§8.2/8.3). A pane that is mounted but
					   hidden — a slot being animated, a window behind another app — is not
					   a case this component can observe, and the design's answer is that
					   only a DISPLAYED pane reports, which is the mount itself. */
						visible={true}
						cols={surface.cols}
						rows={surface.rows}
						onReport={(report) =>
							session.reportContent(surface.surface, report)
						}
						onExit={() => session.refresh()}
					/>
					{/* The marker sits AFTER the mirror, where a live prompt would be, and it
					    is chrome rather than bytes: see `ConsoleHistoryEnd`. */}
					{!surface.running ? (
						<ConsoleHistoryEnd
							announcement={historyAnnouncement}
							announcementSeq={announceTick}
						/>
					) : null}
					{surface.secure ? <ConsoleSecureBar /> : null}
				</div>
			</div>
		);
	};

	const capacity = session.snapshot.capacity;
	// One unabridged name for the ellipsized trigger and its focus/hover tooltip.
	const capacityDescription = capacity
		? t("ui.console.capacity.summary", capacity) +
			(capacity.archived > 0
				? t("ui.console.capacity.archived", capacity)
				: "") +
			(capacity.live >= capacity.limit ? t("ui.console.capacity.full") : "")
		: "";

	return (
		<div
			/*
			 * THE SLOT'S GROUND IS THE DRAWER'S RUNG, and the canvas states the rule
			 * (`canvas/index.tsx`): this slot is a drawer over the work plane, so it
			 * stands on `elevated` — one rung above the chrome — rather than on the
			 * conversation's `canvas`, which made these panes' bodies and the transcript
			 * one plane. The lane's stop above the slot moves with it
			 * (`chat-layout.tsx`), because a pane-only change leaves this tone meeting
			 * the lane at y32 (§6.1, §9.4).
			 */
			className={cn(
				/*
				 * A CONTAINER for the header's narrow form (design round 2, D7): the
				 * right cluster must adapt to the PANE's own width, not the window's,
				 * and 320px (the slot's documented floor) is a width the pane really
				 * meets. Container queries are how the rest of the app asks this
				 * question (`older-history-slot`, `session-status-strip`), so the
				 * summary switches to a compact spelling and the title yields below
				 * 420px rather than overprinting or spilling the Close control.
				 */
				"panel-top-pad relative flex h-full flex-col bg-elevated @container/consolepane",
			)}
			data-glass-region="pane"
			data-tour-tag="console-pane"
		>
			{/*
			 * The pane's header: 40px, the slot's own height, so the bar does not move
			 * when the user switches mode. NO GROUND OF ITS OWN (`bg-sunken` until the
			 * canvas chrome pass): the bar is transparent so the pane reads as one
			 * surface, and the terminal below is what bounds it.
			 */}
			<div
				className={cn(
					"flex h-10 shrink-0 items-center justify-between gap-2 px-2",
					/*
					 * THE CONTROLS' CORNER, RESERVED (chat redesign §J4). On Windows and Linux
					 * Electron draws the caption buttons into the client area's top-right 40px,
					 * and a pane's toolbar is the row that reaches the window's right edge while
					 * that pane is open - so its trailing control has to end before them.
					 *
					 * PADDING here where the chat header uses a spacer, and the difference is the
					 * row rather than the rule: this row is a single `justify-between` line whose
					 * last child IS the control that must clear the buttons, so reserving the
					 * width at the end is the same thing as moving it left. The header cannot use
					 * padding because its action cluster is `ml-auto` inside a row that can wrap,
					 * and padding there would spend the buttons' width on the wrapped line too.
					 * `max(0.5rem, ...)` keeps the row's own 8px at rest, which is where
					 * `--chrome-inset-end` is 0 (macOS, and every native-frame launch). The inset
					 * is the shell's `--chrome-inset-end-pane` - the OS buttons' width LESS the 44px
					 * panel rail that now stands under their trailing part (#872) - with the full
					 * inset as the fallback for a pane rendered outside the shell.
					 */
					"[padding-inline-end:max(0.5rem,var(--chrome-inset-end-pane,var(--chrome-inset-end)))]",
				)}
				data-tour-tag="console-pane-header"
			>
				{/* Reserve three monospace cells for the command, not the summary's
				 * translated intrinsic width. The controls take the remaining bounded
				 * lane; only their text may ellipsize, never the action buttons. The
				 * title and long commands yield within the left lane's 40% ceiling. */}
				<div
					className={cn(
						"flex min-w-[3ch] max-w-[40%] shrink-0 items-center gap-2 font-mono",
					)}
				>
					{/* The pane's title at the slot's own title step, not louder: the pane's
					    contents name it, which is the browser pane's measured D4. It yields to
					    the surface's command at narrow widths (D7); the command already
					    truncates. */}
					<span
						className={cn(
							"min-w-0 truncate font-sans text-meta text-ink-dim @max-[460px]/consolepane:hidden",
						)}
					>
						{t("ui.console.pane.label")}
					</span>
					{/* The surface's own command, which §6.5 makes load-bearing: a person
					    looking at this bar and an agent reading `console_list` describe the
					    same object. Truncated rather than wrapped in a 40px bar. */}
					{surface ? (
						<span
							className={cn("min-w-[3ch] truncate text-ink-muted text-mono-sm")}
							title={`${surfaceTitle(surface)}${surface.argvTail ? ` ${surface.argvTail}` : ""}`}
							data-tour-tag="console-surface-command"
						>
							{surfaceTitle(surface)}
						</span>
					) : null}
				</div>
				<div
					className={cn("flex min-w-0 flex-1 items-center justify-end gap-1")}
				>
					{session.snapshot.capacity ? (
						<>
							{/*
							 * D1 originally removed truncation to reveal retained history. The FR
							 * sweep (D7/Q2) showed that intrinsic width instead erased the command
							 * at 276/320px. Bound the text, not the buttons: its complete live,
							 * archived and full state remains in the accessible name AND tooltip.
							 *
							 * THE TRIGGER IS FOCUSABLE (D1): the explanation was hover-only on a plain
							 * span, so a keyboard user could not reach it. A ghost button with a
							 * focus ring opens the same panel on focus (Radix opens a tooltip on
							 * focus), and the summary itself is its visible label.
							 */}
							<Tooltip
								content={
									session.snapshot.resources
										? `${capacityDescription}. ${t("ui.console.capacity.help")} ${t("ui.console.capacity.resources", { memory: Math.ceil(session.snapshot.resources.modeledBytes / 1048576), logs: Math.ceil(session.snapshot.resources.logBytes / 1048576), pending: Math.ceil(session.snapshot.resources.pendingBytes / 1048576), cells: session.snapshot.resources.cells, protected: session.snapshot.resources.protected })}`
										: `${capacityDescription}. ${t("ui.console.capacity.help")}`
								}
							>
								<Button
									variant="ghost"
									size="sm"
									className={cn(
										"min-w-0 shrink whitespace-nowrap px-1 text-xs",
										/* THE AT-LIMIT STATE IS VISIBLE (design round 2, D10): at
										 * live >= limit a new terminal will be refused, so the ink
										 * steps up to `warning` (a design role, not a hex) and the
										 * text carries "· full". The quiet state stays muted. */
										session.snapshot.capacity.live >=
											session.snapshot.capacity.limit
											? "text-warning"
											: "text-ink-muted",
									)}
									aria-label={capacityDescription}
									data-tour-tag="console-capacity"
								>
									{/* THE COMPACT SPELLING BELOW 420px (design round 2, D7): the full
									 * sentence is 199px and would overflow the header cluster. The same
									 * two numbers, one line, whole sentence still in the tooltip.
									 *
									 * The pair is COMPLEMENTARY, not overlapped (design round 3, the breakpoint
									 * dispute): Tailwind v4 compiles `@min-[X]` to `(width >= X)` and
									 * `@max-[X]` to `(width < X)`, so a matched pair has no gap at exactly X
									 * and no width shows BOTH. An earlier commit here moved the compact bound
									 * to `@min-[421px]`, believing 420/420 left a gap — wrong: it would show
									 * both spans at 420. The matched pair is correct and stays matched.
									 *
									 * 510px, not 460 (design round 1 on the French build, D7): the breakpoint
									 * was 460 (and 420 before it, D18) because below ~446 the surface's command
									 * name (the §6.5 load-bearing `zsh`) was clipped to 0-6px beside the full
									 * 228px English summary. The French full line now keeps the app-wide scope
									 * ("... actifs dans l'app", 273px, +45px over English) and at 460 it
									 * measured `zsh` at 0-2px of 20, so the full spelling takes over 50px later.
									 * THIS MOVES ENGLISH TOO: between 460 and 509 the compact spelling now shows
									 * for English as well (measured: `zsh` intact at 460, 480 and 510).
									 *
									 * The compact spelling is deliberately scope-neutral, as English's is
									 * ("128/128 · 4 kept"): it is the width-critical form, and the full line and
									 * the tooltip carry the scope.
									 */}
									<span className="min-w-0 truncate">
										<span className="@min-[510px]/consolepane:hidden">
											{session.snapshot.capacity.archived > 0
												? t(
														"ui.console.capacity.summary_compact",
														session.snapshot.capacity,
													)
												: t(
														"ui.console.capacity.summary_compact_bare",
														session.snapshot.capacity,
													)}
										</span>
										<span className="@max-[510px]/consolepane:hidden">
											{t(
												"ui.console.capacity.summary",
												session.snapshot.capacity,
											)}
											{session.snapshot.capacity.archived > 0
												? t(
														"ui.console.capacity.archived",
														session.snapshot.capacity,
													)
												: null}
										</span>
										{session.snapshot.capacity.live >=
										session.snapshot.capacity.limit
											? t("ui.console.capacity.full")
											: null}
									</span>
								</Button>
							</Tooltip>
							<Tooltip content={t("ui.console.cleanup.help")}>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={t("ui.console.cleanup.label")}
									onClick={() => void session.cleanupOwner()}
									disabled={
										!surfaces.some(
											(item) =>
												/*
												 * MIRRORS THE HOST'S PROTECTIONS (design round 1, D6): the host
												 * skips running, secure, non-live, displayed and adopted
												 * surfaces, so enabling the button on one the host will skip
												 * would be a press that does nothing. `displayed` is the
												 * renderer's own view of adoption-by-attention; the remaining
												 * host-side protections are covered by `live`.
												 */
												item.agentOwned &&
												!item.running &&
												!item.secure &&
												item.live &&
												!item.displayed,
										)
									}
								>
									<Archive aria-hidden="true" />
								</Button>
							</Tooltip>
						</>
					) : null}
					{/* The `+` in the pane's own chrome, beside the surface list (§6.1). It
					    is present in the empty state too, where it is the control a
					    first-run user actually uses. */}
					<Tooltip
						content={
							available
								? t("ui.console.new")
								: t("ui.console.unavailable.title")
						}
					>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t("ui.console.new")}
							onClick={createFromPress}
							/* DISABLED WHEN THERE IS NOTHING TO ACT ON, which is the pane's
							   own stated principle ("a control with nothing to act on lies"):
							   in the unavailable state the `+` rendered identically to the
							   empty state's and did nothing when pressed. It is ALSO disabled
							   while a create is in flight, which is the same principle's other
							   half: a second press in that window would make a second surface,
							   and the body's retry would then be racing this control for the
							   same action. It stays ENABLED after a create has FAILED, because
							   trying again is the action that failure calls for. */
							disabled={!available || creating}
							data-tour-tag="console-new-surface"
						>
							<Plus aria-hidden="true" />
						</Button>
					</Tooltip>
					{/* The secure-input toggle, offered only when there is a surface to make
					    secure: a control with nothing to act on is a control that lies. */}
					{surface ? (
						<Tooltip
							content={
								surface.secure
									? t("ui.console.secure_toggle.stop")
									: t("ui.console.secure_toggle.start_tooltip")
							}
						>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={
									surface.secure
										? t("ui.console.secure_toggle.stop")
										: t("ui.console.secure_toggle.start")
								}
								aria-pressed={surface.secure}
								className={cn(surface.secure && "text-accent")}
								onClick={() =>
									session.setSecure(surface.surface, !surface.secure)
								}
								data-tour-tag="console-secure-toggle"
							>
								{surface.secure ? (
									<Lock aria-hidden="true" />
								) : (
									<LockOpen aria-hidden="true" />
								)}
							</Button>
						</Tooltip>
					) : null}
					{/* THE SAME EXIT AS THE SLOT'S OTHER THREE PANES: the same glyph, size
					    and tooltip in the same corner, because an icon-only control whose
					    siblings all carry a label is the one that gets mistaken for
					    something else. */}
					<Tooltip content={t("ui.console.pane.close")}>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t("ui.console.pane.close")}
							onClick={onClose}
							data-tour-tag="console-pane-close"
						>
							<PanelRightClose aria-hidden="true" />
						</Button>
					</Tooltip>
				</div>
			</div>
			{/*
			 * STARTING A CONSOLE BESIDE HISTORY (U5): with an ended surface on screen
			 * the empty state cannot show, so the create's round trip had no visible
			 * answer and the `+` was disabled with nothing saying why. A polite status
			 * line names the work; it sits below the header like the release result, so
			 * the header's height does not move.
			 */}
			{/* ALWAYS MOUNTED (U7): a live region inserted with its text already in it
			    is not reliably announced - assistive tech has to see the region first.
			    The element is in the DOM from the pane's first commit; only its text
			    and its visible styling change while a create runs. */}
			<output
				aria-live="polite"
				className={cn(
					creating && surfaces.length > 0
						? "shrink-0 border-hairline border-b bg-surface px-3 py-1 text-ink-muted text-meta"
						: "sr-only",
				)}
				data-tour-tag="console-starting"
			>
				{creating && surfaces.length > 0 ? t("ui.console.loading.create") : ""}
			</output>
			{/*
			 * THE RELEASE RESULT (design round 1, D2). The button used to give no answer,
			 * so a user could not tell released-from-kept-from-deleted; that outcome now
			 * lands here. It is a polite `<output>` region (the implicit status role) so a
			 * screen reader hears it without an interruption, and it sits below the header
			 * so it does not reflow the 40px bar. It is replaced by the next release's own
			 * result and cleared when the pane unmounts, rather than kept as a stale
			 * sentence after the counters have moved on.
			 */}
			{session.cleanupNotice !== null ? (
				<output
					className={cn(
						/*
						 * POINTER-TRANSPARENT (design round 3, D15): the notice is status text, not a
						 * control, so it must never intercept a click on the tab strip underneath —
						 * the whole point of Clear is that the user is about to look at that list.
						 *
						 * IT WRAPS RATHER THAN TRUNCATES (D16): at the 320px floor `truncate` cut the
						 * "left open" half off mid-sentence, and that half is the part telling the
						 * user some surfaces were NOT cleared. The overlay is out of flow, so it can
						 * grow to a second line; `title` carries the whole sentence for the one
						 * narrow case that still clips.
						 */
						"pointer-events-none absolute top-10 right-2 left-2 z-10 rounded-sm border border-control bg-elevated px-2 py-1 text-meta text-ink-muted shadow-md",
					)}
					data-tour-tag="console-cleanup-result"
					title={session.cleanupNotice}
				>
					{session.cleanupNotice}
				</output>
			) : null}
			{surfaces.length > 0 ? (
				/* THE PANE'S OWN LIST, which is also its lens (§6.1's "one more control
				   in the header cluster" is the slot's trigger; this is the pane's). A row
				   per surface, the active one on `elevated`, and the two marks the design
				   fixes: the agent marker the browser's strip already uses for an
				   agent-opened tab, and the blip's dot.

				   THE LIST OWNS A `surface` PLANE, AND IT IS THE SAME RESOLUTION THE FILES
				   LIST MADE (`canvas/index.tsx`): its rows paint `hover:bg-row-hover` and
				   its active row paints `bg-elevated`, and neither mark survives an
				   `elevated` pane — a row-hover step authored against `surface` rides off
				   that plane, and an `elevated` fill on an `elevated` ground measures ΔE00
				   0. So the scroller is `surface` and every mark inside it is unchanged;
				   the rows are the reason, and the plane is theirs.

				   EVERY ROW NOW CARRIES ITS OWN CLOSE CONTROL (#754), because the strip used
				   to only grow: a tab was select-only and the pane's single "Close console"
				   closes the PANE rather than a surface, so an ended surface had no way out
				   and a running one had no way to be ended from here. The control is a
				   sibling of the tab button (a button inside a button is not HTML), and the
				   two states it serves are named on the row itself. */
				<div
					/* A tab strip is chrome, not a track: clear on glass, with the
					 * selected surface's pill taking the selected ink overlay
					 * (styles/index.css, window glass round 3). */
					data-glass-plane="clear"
					className={cn(
						"flex shrink-0 items-center gap-1 overflow-x-auto border-hairline border-b bg-surface px-2 py-1",
					)}
					role="tablist"
					aria-label={t("ui.console.pane.surfaces")}
					data-tour-tag="console-surface-list"
				>
					{surfaces.map((row, index) => {
						const isActive = row.surface === surface?.surface;
						return (
							/*
							 * THE ROW IS A WRAPPER AROUND THE TAB, not the tab button itself, and the
							 * reason is the close control: its X has to be a SIBLING of the tab
							 * button — a `<button>` inside a `<button>` is not HTML — which is the
							 * shape the browser strip's own tabs already use for the same act
							 * (`browser-tab-strip.tsx`), taken rather than invented. The pill's FILL
							 * moves to the wrapper with it: the row is what a pointer hovers, and the
							 * tab button stays transparent inside it so select-on-click is exactly
							 * what it was. `data-surface` names the row for the rigs, the convention
							 * the browser strip's `data-tab-id` set.
							 */
							<div
								key={row.surface}
								className={cn(
									"group flex h-7 shrink-0 items-center rounded-md",
									isActive
										? "bg-elevated text-ink"
										: "text-ink-muted hover:bg-row-hover",
								)}
								data-surface={row.surface}
							>
								<button
									type="button"
									role="tab"
									aria-selected={isActive}
									onClick={() => setStored(row.surface)}
									className={cn(
										"flex h-full min-w-0 items-center gap-1.5 pl-2 pr-1 text-meta",
									)}
									data-tour-tag="console-surface-row"
								>
									{/* The agent marker says who ELSE is using this surface, exactly
								    as the browser strip's does (§6.5's "the pane's visible marker"
								    is the human half of the provenance the listing carries) — and
								    §13.4's co-pilot cell is the second reason it can appear: an
								    agent typing into a surface the USER opened left this row
								    unchanged, because `origin` is fixed at create and never moves.
								    `lastActor` is the fact that does move, so the mark follows it
								    and the title says which of the two happened. `size-4` is the
								    browser strip's own size, taken so the same glyph in two panes
								    of one slot is one size. */}
									{row.agentOwned || row.lastActor === "agent" ? (
										/* The `title` rides a wrapper: a lucide icon is a `<svg>`, and
									   the attribute is a tooltip for a reader who wants to know
									   WHICH of the two facts this mark is reporting. */
										<span
											className={cn("flex shrink-0 items-center")}
											title={
												row.agentOwned
													? t("ui.console.tab.agent_opened")
													: t("ui.console.tab.agent_typed")
											}
										>
											<Bot
												aria-hidden="true"
												className={cn("size-4 shrink-0 text-accent")}
											/>
										</span>
									) : null}
									<span className={cn("max-w-[12rem] truncate")}>
										{surfaceTitle(row)}
									</span>
									{row.secure ? (
										<Lock
											aria-hidden="true"
											className={cn("size-3 shrink-0 text-ink-dim")}
										/>
									) : null}
									{!row.running ? (
										/* A LABELLED END (D5): the bare code read as a count or an
										   unread badge beside a live tab. `exit 1` / the signal's own
										   machine token is unambiguous and keeps its mono register. */
										<span
											className={cn("text-ink-dim text-mono-sm")}
											title={
												row.exitSignal
													? t("ui.console.ended.exit_signal", {
															signal: row.exitSignal,
														})
													: undefined
											}
										>
											{row.exitSignal
												? row.exitSignal
												: row.exitCode === null
													? t("ui.console.tab.ended")
													: t("ui.console.tab.exit_code", {
															code: String(row.exitCode),
														})}
										</span>
									) : null}
									{isConsoleUnseen(unseen, row.surface) ? (
										/* The blip, on the surface's own row. TWO STATES, and the difference is
									   what the mark means: `accent` and a pulse while the completion is
									   fresh, then the resting `ink-muted` dot — the canvas button's own dot
									   colour — because an unread mark must not animate for ever (§12.2).
									   The pulse is the same 2 s opacity step the skeleton uses, and the
									   app's stylesheet caps it under `prefers-reduced-motion`, so a frozen
									   dot is the reduced-motion state rather than a missing one. */
										<span
											aria-label={t("ui.console.pane.blip")}
											className={cn(
												"size-2 shrink-0 rounded-full",
												blipPulsing
													? "bg-accent animate-pulse-visible"
													: "bg-ink-muted",
											)}
											data-tour-tag="console-surface-blip"
										/>
									) : null}
								</button>
								{/*
								 * THE CLOSE CONTROL, a SIBLING of the tab (see the row's own note), whose
								 * LABEL FOLLOWS THE STATE because the acts differ: a running surface is
								 * closed (behind the question `ConsoleCloseDialog` asks), an ended one is
								 * dismissed. `aria-label` names the terminal (`Close zsh`) — the browser
								 * strip's own convention — so a reader with two rows open can tell which
								 * one this control acts on; the tooltip keeps the shorter sentence.
								 *
								 * REACHABLE BY MOUSE AND KEYBOARD: a pointer reaches it through the
								 * row's hover (or `focus-within`), and a keyboard reaches it by
								 * tabbing — the reveal never gates reachability, only sight.
								 */}
								<Tooltip
									content={
										row.running
											? t("ui.console.close.confirm")
											: row.retain
												? t("ui.console.dismiss_history")
												: t("ui.console.dismiss.confirm")
									}
								>
									<Button
										variant="ghost"
										size="icon-sm"
										/*
										 * LABEL NAMES THE STATE, THE TERMINAL, AND THE POSITION (UX round 1, U4):
										 * `Close ${title}` alone collided on the ordinary strip — two shells made
										 * two "Close sh" — so the tablist's own position ("tab 2 of 4") is the
										 * disambiguator, always present so the name is a property of the row
										 * rather than of a collision. The tooltip keeps the shorter sentence:
										 * a pointer is already on the row it would act on.
										 */
										/*
										 * THE NAME IS NOT DOUBLED (design round 1, D6): the prefix
										 * already says Dismiss, so the suffix states only what
										 * the act does to the output rather than repeating the verb
										 * (it used to read "Dismiss … — Dismiss terminal and …").
										 */
										aria-label={t(
											row.running
												? "ui.console.tab.close_label"
												: row.retain
													? "ui.console.tab.clear_label_retained"
													: "ui.console.tab.clear_label",
											{
												title: surfaceTitle(row),
												index: index + 1,
												total: surfaces.length,
											},
										)}
										onClick={() => requestSurfaceClose(row)}
										className={cn(
											"me-0.5 transition-opacity",
											isActive ? "opacity-100" : REVEAL_ON_HOVER_OR_FOCUS,
										)}
										data-tour-tag="console-surface-close"
									>
										<X aria-hidden="true" />
									</Button>
								</Tooltip>
							</div>
						);
					})}
				</div>
			) : null}
			<div className={cn("flex min-h-0 grow flex-col")}>{body()}</div>
			{/*
			 * THE QUESTION, when one is owed (a running surface's close). Outside the
			 * body on purpose: it is not a state of the pane, it is a modal over it,
			 * and its `open` is the pending id rather than a boolean so the row it was
			 * asked about is itself the record of what the answer would close.
			 */}
			<ConsoleCloseDialog
				open={pendingClose !== null || pendingDismiss !== null}
				busy={closing}
				/*
				 * A RETAINED DISMISSAL KEEPS NOTHING, so `keepsOutput` is false on that
				 * path (the dialog then says what deleting means); a running close keeps
				 * output only when the row is retained.
				 */
				keepsOutput={pendingDismiss === null && (pendingRow?.retain ?? false)}
				kind={pendingDismiss !== null ? "dismiss" : "close"}
				refusal={closeRefusal}
				refusalSeq={closeRefusalSeq}
				onConfirm={
					pendingDismiss !== null ? confirmSurfaceDismiss : confirmSurfaceClose
				}
				onCancel={() => {
					focusAfterRemoval.current = null;
					setCloseRefusal(null);
					setPendingClose(null);
					setPendingDismiss(null);
				}}
			/>
		</div>
	);
};
