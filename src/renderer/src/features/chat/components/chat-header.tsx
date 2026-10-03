import { Spinner } from "@shared/components/common/spinner";
import {
	Badge,
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
	Skeleton,
	Tooltip,
	countLabel,
} from "@shared/components/ui";
import { useHomeDirectory } from "@shared/hooks";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { formatDirectory, middleTruncatePath } from "@shared/utils/path-utils";
import { showErrorToast, showWarningToast } from "@shared/utils/toast-manager";
import {
	Archive,
	ArchiveRestore,
	Check,
	FileText,
	Globe,
	Info,
	MoreHorizontal,
	Pencil,
	Rows3,
	SquareTerminal,
	Trash2,
	X,
} from "lucide-react";
import { type FC, type ReactNode, useEffect, useRef, useState } from "react";
import { canvasToggleCap, isCanvasTogglePress } from "../canvas-shortcut";
import { archiveControlLabel } from "../chat-archived";
import { useSessionCommand } from "../pickers/use-picker-backend";
import {
	TRANSCRIPT_DISPLAY_MODE_OPTIONS,
	parseTranscriptDisplayMode,
	transcriptDisplayModeLabel,
} from "../transcript-display-mode";
import {
	ChatHeaderIdentity,
	type HeaderIdentityData,
} from "./chat-header-identity";
import type { McpServerRow, RunDetails } from "./run-details";
import { RunDetailsTrigger } from "./run-details";

/**
 * ChatHeaderProps
 * @property agentName - The name of the agent to display.
 * @property description - The description of the agent.
 * @property onOpenOptions - Optional callback for opening options/canvas.
 * @property runDetails - The session's derived subagent and to-do view model, or
 * `null`/absent when the session has none.
 * @property fileCount - How many files the conversation has been seen to mention.
 *
 * `runDetails` is passed by `chat-page.tsx`, which owns the canonical stream and
 * derives the model per wire frame (`run-details.md` § 8); stories pass a fixture
 * instead. It stays OPTIONAL because its absence is a real state: `ChatContent`
 * also renders this header for a session with no canonical stream, where there
 * is nothing to derive from and the trigger must not appear. The trigger's own
 * visibility rule (has work, and the canvas closed) lives inside
 * `RunDetailsTrigger`, because both halves are facts about that surface rather
 * than about where the header puts it.
 */
type ChatHeaderProps = {
	agentName?: string;
	description?: string;
	/**
	 * The panel is mounted on a target whose identity is not known yet, and the
	 * catalogue names no agent or team for it either.
	 *
	 * Then the slot is HELD rather than filled. The fallback chain below used to
	 * render its last-resort sentence ("Canonical chat") in the frame after a
	 * click and replace it with the real agent name once the stream arrived, so
	 * the panel's only text in the wait was a placeholder wearing the clothes of
	 * a fact (design D3). A skeleton says "not known yet" and is not a claim;
	 * the identity replaces it the moment anybody knows it.
	 */
	descriptionPending?: boolean;
	/**
	 * The live session's identity, when the identity slot should offer the two
	 * switchers (a team menu and an agent menu) instead of the plain description
	 * string.
	 *
	 * `chat-page.tsx` computes it through `headerIdentityControlsShown` - the
	 * model's own gate - so this component never re-answers questions about
	 * capabilities or stream state it cannot see. Absent (a draft, a pending
	 * identity, a backend without `team_catalogue`) the slot renders the
	 * description exactly as it always did: that degradation is the feature's
	 * absent state, not a dead control.
	 */
	identity?: HeaderIdentityData | null;
	/**
	 * The device control: where this conversation runs, as one chip beside the
	 * identity slots.
	 *
	 * A NODE RATHER THAN A STATE OBJECT, deliberately. The control's facts live in
	 * three different stores (the draft row's own destination, this pane's move
	 * outcome, the mesh's peer reads) and its picker issues a transfer - none of
	 * which are this header's business, and each of which would put a network read
	 * and a mutation behind a component whose whole job is chrome. The page that
	 * owns the session and the draft composes it (`features/chat/device`), exactly
	 * as it composes `identity` from its own capability gate; withdrawn (no
	 * `features.peers`, no session and no draft) the title block renders as it did
	 * before the control existed.
	 *
	 * IT IS NOT IN THE ACTION CLUSTER. That cluster is icon-only - it cannot name a
	 * device, the globe in it already means "open the browser pane", and its shed
	 * ladder is a five-rung sequence a placement fact has no business joining.
	 */
	deviceSlot?: ReactNode;
	/**
	 * The session the inline rename writes to, when this header offers rename.
	 *
	 * A session id rather than a callback, because the write path lives HERE now:
	 * the pencil opens an inline editor whose save runs `sessions.command`
	 * `rename` through `useSessionCommand` - the same hook and the same command
	 * `RenamePicker` submits (`destination-pickers.tsx`), so the two surfaces
	 * cannot disagree about what a rename is, and `/rename` from the composer or
	 * the options row keeps the picker it always had. Threaded from
	 * `chat-page.tsx` under the page's own `commands` capability gate, so a
	 * backend that cannot run commands withholds the whole affordance (and, on a
	 * draft, the session it would need) instead of rendering a dead pencil.
	 */
	renameSessionId?: string;
	onOpenOptions?: () => void;
	runDetails?: RunDetails | null;
	/**
	 * How many files the conversation has been seen to mention.
	 *
	 * The header carries it because it is the only surface visible before the
	 * canvas is ever opened: with 32 files on screen-worth of conversation the
	 * feature used to announce itself nowhere, so a user had to already know the
	 * canvas existed to find them. Not "unseen" - there is no read receipt here -
	 * just "this conversation has files".
	 */
	fileCount?: number;
	/**
	 * The session's configured MCP servers, for the trigger's attention dot.
	 *
	 * Threaded through the header rather than fetched inside the trigger for the
	 * reason `docs/run-sidebar.md` § 3.4 gives: the dot's rule is "while the panel
	 * is open, what the panel RENDERS is acknowledged", so the trigger and the
	 * panel have to answer from ONE list. An empty list is what a caller passes
	 * when the MCP section is not on screen, which is what makes an unrendered
	 * section acknowledge nothing.
	 */
	mcpServers?: readonly McpServerRow[];
	/**
	 * Whether the pane is showing its list, and which child's reader is open.
	 *
	 * Both are the pane's own view state, reported up by `chat-content.tsx` because
	 * the dot's rule is about what is ON SCREEN (`§ 3.4`) and this is the only place
	 * that renders both the trigger and the pane.
	 */
	listOnScreen?: boolean;
	readerChildId?: string | null;
	/**
	 * Whether THIS header is the element the OS's caption buttons sit over, and so
	 * must reserve their width at its trailing end.
	 *
	 * Passed by `chat-content.tsx`, which is the one component that knows: the right
	 * slot is EXCLUSIVE in the store (`claimRightSlot`), so either this header or an
	 * open pane's toolbar reaches the window's right edge and never both. A second
	 * mechanism - a hook measuring "am I at the right edge" - was considered and
	 * rejected: the store already holds the fact, and a measurement adds a
	 * `ResizeObserver` per row and a frame of lag before the buttons are clear.
	 *
	 * The reservation is a SPACER at the end of the row rather than padding, so it
	 * moves the action cluster left of the controls without taking width from the
	 * title: padding on the row would reserve the same pixels at both ends of the
	 * flex distribution.
	 */
	reserveTrailingChrome?: boolean;
	/**
	 * Opens the conversation's browser pane, or absent when this header cannot
	 * (`ChatContent` passes it only where there is a pane to open).
	 *
	 * The same shape as `onOpenOptions` above, and for the same reason: the canvas
	 * button is rendered from whether a host offered the action, so the header never
	 * has to know which routes or environments have a canvas — or, here, a browser.
	 *
	 * IT DOES NOT HIDE WHILE ITS PANE IS OPEN, and that is the fix for the operator's
	 * report (2026-09-23). The badge on this control is the only chrome that reports
	 * THIS conversation's waiting approvals, so a trigger that unmounted with the pane
	 * took the count off screen with it — the repo's own live evidence reads
	 * `badge: null` beside three live requests (`docs/evidence/browser-pane-live/`,
	 * where the pane is open), and "the badge is sometimes missing when a request IS
	 * outstanding" is that state. Its two neighbours still hide, and the difference is
	 * what each control CARRIES: the canvas and console buttons hold a mark that says
	 * "there is something in there", which the open pane already says, while this one
	 * holds a COUNT the pane does not put in the header. So it is a real toggle rather
	 * than the "no-op with a tooltip" the old rule hid — that objection was about a
	 * control that re-OPENED a pane already on screen, and this one closes it.
	 *
	 * It reads `isBrowserPaneOpen` for the same reason the canvas button reads
	 * `isCanvasOpen`: the pane is a property of the window's right slot, so the control
	 * that opens it and the slot that renders it have to answer from ONE field.
	 */
	onToggleBrowser?: () => void;
	/**
	 * Opens the conversation's console pane, or absent when this header has none.
	 *
	 * The fourth occupant of the same slot and the same shape as `onToggleBrowser`:
	 * the header renders the trigger from whether a host offered the action, hides it
	 * while the pane is up (the pane carries its own close), and never decides itself
	 * which pane is showing.
	 */
	onOpenConsole?: () => void;
	/**
	 * How many completions THIS conversation's console has produced that the user has
	 * not looked at (design 12.2), and whether any of them is still fresh enough to
	 * pulse.
	 *
	 * A COUNT IS PASSED AND A DOT IS DRAWN, which is the one place this trigger
	 * agrees with the canvas button rather than the browser one: "here the only job is
	 * to say 'there is something' before the user has opened it". The count is not
	 * rendered — it is what the tooltip and the `aria-label` read, which is where an
	 * exact number belongs for a control this size.
	 */
	consoleUnseenCount?: number;
	/** Whether those marks are still pulsing, i.e. whether the dot is `accent` or has
	 * come to rest in `inkMuted` (design 12.2's two states). */
	consoleUnseenPulsing?: boolean;
	/**
	 * How many approvals THIS conversation is waiting on, for the trigger's badge.
	 *
	 * The count and not a dot, which is the one place this header differs from the
	 * canvas button beside it: a canvas dot says "there is something in there", and a
	 * pending approval is an ASK — an agent is stopped until the user answers — so
	 * the number is the whole information the badge carries (spec 5.1, 7.3).
	 */
	browserAttentionCount?: number;
	/**
	 * Whether THIS conversation is archived, as the pane knows it, and whether the
	 * backend can hold archived conversations at all.
	 *
	 * `archived` is a plain boolean rather than a lookup here for the reason the
	 * header takes `fileCount`: the pane owns the canonical stream and the session
	 * store, and this component is rendered by stories with fixtures and by the
	 * legacy path with nothing. `archiveEnabled` is the capability, passed down
	 * rather than re-read, so the pill and the sidebar's control cannot gate on two
	 * different answers.
	 */
	archived?: boolean;
	archiveEnabled?: boolean;
	/**
	 * The session's own actions: archive/unarchive it, and delete it permanently.
	 *
	 * Absent when the host cannot offer them (no capability, or a pane with no
	 * session), which is what keeps the menu out of the DOM entirely rather than
	 * rendering a set of items that do nothing - the same fail-closed rule the
	 * archive slot in the sidebar follows.
	 *
	 * `onRequestDelete` OPENS a confirmation and deletes nothing: the wire requires
	 * a confirmed delete, so this component's job ends at asking.
	 *
	 * `onSetArchived` ends the same way for ONE of its two directions since
	 * 2026-09-30: `true` (archive) opens the archive confirmation and writes nothing,
	 * while `false` (restore) writes straight through - the restore is one press on
	 * every surface that offers it. Both halves are the HOST's (`chat-content.tsx`),
	 * which is where the store's one archive path lives.
	 */
	onSetArchived?: (archived: boolean) => void;
	deleteEnabled?: boolean;
	onRequestDelete?: () => void;
};

/**
 * The path chip's character budget. 40 characters of 12px Geist Mono is about
 * 290px: enough for `~/…/workspace/local-operator-ui`-sized paths whole, and
 * little enough that at 1024 with the sidebar docked the title keeps its line
 * (the D6 frames: a 330px path beside a truncated title).
 */
const PATH_CHIP_CHARS = 40;

export const ChatHeader: FC<ChatHeaderProps> = ({
	agentName = "Local Operator",
	description = "Your on-device AI assistant",
	descriptionPending = false,
	identity,
	deviceSlot,
	renameSessionId,
	onOpenOptions,
	runDetails = null,
	fileCount = 0,
	mcpServers = [],
	listOnScreen = false,
	readerChildId = null,
	reserveTrailingChrome = false,
	onToggleBrowser,
	browserAttentionCount = 0,
	archived = false,
	archiveEnabled = false,
	onSetArchived,
	deleteEnabled = false,
	onRequestDelete,
	onOpenConsole,
	consoleUnseenCount = 0,
	consoleUnseenPulsing = false,
}) => {
	/*
	 * What the badge SHOWS, which is not always what it counts (design round 1, D5):
	 * a badge fixed to a 16px icon cannot grow past its own corner, so from the
	 * tenth request on it reads `9+` while the tooltip and the `aria-label` keep the
	 * exact number. Only the glyph is capped - a user who needs the count reads it,
	 * and a user who needs to know it is a lot sees that too.
	 */
	const badgeText = countLabel(browserAttentionCount, 9);
	const setCanvasOpen = useUiPreferencesStore((s) => s.setCanvasOpen);
	const isCanvasOpen = useUiPreferencesStore((s) => s.isCanvasOpen);
	/*
	 * The transcript display mode (issue #756), read here for the OVERFLOW MENU so
	 * the choice is reachable from the conversation the reader is looking at rather
	 * than only from the Settings page. Read raw and parsed on the way in, the rule
	 * every reader of a persisted union follows (see `parseTranscriptDisplayMode`).
	 */
	const transcriptDisplayMode = useUiPreferencesStore(
		(s) => s.transcriptDisplayMode,
	);
	/*
	 * The active mode, judged once for every reader in this file (agent review
	 * round 1, m3): the submenu trigger NAMES it so the control describes its own
	 * state, and the radio group marks it - one parse, so the two cannot disagree
	 * about which mode the menu is stating.
	 */
	const activeTranscriptDisplayMode = parseTranscriptDisplayMode(
		transcriptDisplayMode,
	);
	const setTranscriptDisplayMode = useUiPreferencesStore(
		(s) => s.setTranscriptDisplayMode,
	);
	/*
	 * The run panel's setter, read here for the OVERFLOW MENU rather than for the
	 * cluster's own trigger (`RunDetailsTrigger` owns that button and its
	 * focus-return). The menu is the row's escape hatch at the widths where the
	 * cluster sheds the trigger, and both paths write the same store field, so they
	 * cannot disagree about whether the pane is up.
	 */
	const setRunPanelOpen = useUiPreferencesStore((s) => s.setRunPanelOpen);
	/*
	 * The account's home directory, for the quiet path in the title row. Shared with
	 * the composer's directory chip (`useHomeDirectory`), so one IPC round trip
	 * answers both and the two surfaces cannot abbreviate the same path differently.
	 */
	const homeDirectory = useHomeDirectory();
	/*
	 * THE QUIET PATH, RESOLVED ONCE, AND NOTHING WHEN THERE IS NOTHING TO SAY (UX round 1,
	 * U11).
	 *
	 * `formatDirectory` shortens a path under the home directory to its `~` form, and for a
	 * directory that IS the home directory the answer is the bare string `~`. A new chat's
	 * default working directory is exactly that, so the title row read `New chat  ~` - a
	 * lone tilde with nothing after it, which reads as a string something truncated rather
	 * than as a place (§C2/U18: "either the resolved path or nothing"). Measured on the live
	 * app at 1024, 1380 and 800 in the empty state, which is the state a new chat opens in.
	 *
	 * Suppressing it is the spec's second option and the honest one: the value IS the home
	 * directory, and a chip whose whole content is the abbreviation of "where you already
	 * are" identifies no directory. The composer's chip three inches below still names the
	 * project, so nothing is lost. `description` also carries prose (a draft's sentence, a
	 * starting run's target name) and those are not paths: `formatDirectory` returns them
	 * unchanged, so they are only ever suppressed by being genuinely empty.
	 */
	const shownDescription = formatDirectory(description, homeDirectory);
	const showDescription = shownDescription !== "~" && shownDescription !== "";
	// Read here rather than passed in: the pane is a property of the window's right
	// slot, so the control that opens it and the slot that renders it have to answer
	// from ONE field — the same reason the canvas button reads `isCanvasOpen` itself.
	const isBrowserPaneOpen = useUiPreferencesStore((s) => s.isBrowserPaneOpen);
	// The console's own field, read for the same reason and from the same place.
	const isConsolePaneOpen = useUiPreferencesStore((s) => s.isConsolePaneOpen);

	const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
	// The cap and the predicate share one module, so the promise this string prints
	// and the press that answers it cannot drift (UX round 2, U14).
	const shortcut = canvasToggleCap(isMac);

	/*
	 * THE CHORD THIS CONTROL PRINTS IS BOUND HERE (UX round 2, U14).
	 *
	 * The name advertised `⌘⇧C` and nothing answered it: four recorded presses left
	 * the pane closed while `⌘B`, `⌘N` and `⌘K` all acted. The listener lives with
	 * the control rather than in the shell because the control is what makes the
	 * promise, and it is bound wherever the control's own gate (`onOpenOptions`, the
	 * prop that decides whether this pane can offer the canvas at all) is answered -
	 * the same condition the button renders under, so the chord cannot outlive the
	 * cap it is printed from. It TOGGLES: while the canvas is open the button is
	 * unmounted, and the reader who opened it with the chord must be able to close
	 * it with the chord.
	 *
	 * The state is read through `getState()` at press time, the shape the shell's own
	 * chord uses: a listener that closes over `isCanvasOpen` would be re-registered
	 * on every toggle and could still answer with the render it was born in.
	 */
	useEffect(() => {
		if (!onOpenOptions) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (!isCanvasTogglePress(event)) return;
			event.preventDefault();
			setCanvasOpen(!useUiPreferencesStore.getState().isCanvasOpen);
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [onOpenOptions, setCanvasOpen]);

	/*
	 * Three facts about the cluster's children, read once because the CLUSTER's
	 * spacing and each child's own render gate are decisions from the same set.
	 *
	 * The badge is anchored 10px past the browser button's corner and paints a 2px
	 * ring, so a drawn badge needs 12px before the CANVAS BUTTON's box begins
	 * (design round 1, D5: below that the ring is painted inside a 32px control's
	 * hover target). That room is the CONTAINER's to give - `docs/branding.md`
	 * section 5, "a component does not own its outer margin" - so the cluster widens
	 * its own gap while an overhanging badge is on screen and pays nothing when there
	 * is none. A `mr-1` on the button used to carry it and could not be conditional
	 * without being the same anti-pattern: a margin on a component's root element
	 * stacks with whatever container it is dropped into, which is exactly the
	 * silent-mis-spacing failure that rule exists to prevent.
	 *
	 * Each fact is about a CHILD rather than about the badge alone, and the canvas
	 * half is why: while the canvas is open the canvas button is unmounted, so the
	 * badge has no neighbour's box to land in and the room would be spent on a
	 * control that is not rendered. (THE BROWSER HALF OF THIS PARAGRAPH IS HISTORY:
	 * the browser button used to unmount with its pane, which is the state the
	 * operator reported as a missing badge - see `onToggleBrowser`. It stays mounted
	 * now, so the room its badge earned is never paid for nothing.)
	 */
	const browserButtonShown = Boolean(onToggleBrowser);
	/* THE BADGE IS DRAWN WHENEVER THIS CONVERSATION IS WAITING ON SOMETHING. It used
	 * to be gated on the button's own visibility (`browserButtonShown &&
	 * browserAttentionCount > 0`), which was inert only while the button never hid
	 * with its pane. With the trigger staying mounted that gate would be the second
	 * way to lose the count, so it is gone rather than left as a remainder. */
	const browserBadgeDrawn = browserAttentionCount > 0;
	const canvasButtonShown = Boolean(onOpenOptions) && !isCanvasOpen;
	const consoleButtonShown = Boolean(onOpenConsole) && !isConsolePaneOpen;

	/*
	 * Closing the canvas put focus back on `<body>`, which is the top of the
	 * document: a keyboard user who left the panel lost their place entirely. The
	 * control they came from is this button, and it only exists while the canvas
	 * is closed - so the focus move has to happen on the true->false transition,
	 * after the button is back in the DOM, and never on the first mount (which
	 * would pull focus out of whatever the user was doing when the app opened).
	 */
	const canvasButtonRef = useRef<HTMLButtonElement | null>(null);
	const previouslyOpen = useRef(isCanvasOpen);
	useEffect(() => {
		if (
			previouslyOpen.current &&
			!isCanvasOpen &&
			// Only when focus was actually LOST. Closing the canvas from inside it
			// unmounts the control that had focus and leaves `body` active; closing
			// it from the command palette while the composer has focus must not pull
			// the caret out of the message being typed.
			document.activeElement === document.body
		)
			canvasButtonRef.current?.focus();
		previouslyOpen.current = isCanvasOpen;
	}, [isCanvasOpen]);

	/*
	 * The same four lines for the browser pane, which had none of them (UX round 1,
	 * U2): its two neighbours put the caret back on their own trigger when they
	 * close, and the third occupant of the slot left it on `<body>` - so `Enter` on
	 * the Globe was a one-way trip to the top of the document's tab order for a
	 * keyboard user. `run-details-trigger.tsx` carries the identical refocus for the
	 * identical reason, and the guard is the same one: only when focus was actually
	 * lost, and never on first mount.
	 */
	const browserButtonRef = useRef<HTMLButtonElement | null>(null);
	const browserPaneWasOpen = useRef(isBrowserPaneOpen);
	useEffect(() => {
		if (
			browserPaneWasOpen.current &&
			!isBrowserPaneOpen &&
			document.activeElement === document.body
		)
			browserButtonRef.current?.focus();
		browserPaneWasOpen.current = isBrowserPaneOpen;
	}, [isBrowserPaneOpen]);

	/*
	 * And the same again for the console, which is the fourth occupant of the same
	 * slot (design 6.1) and would otherwise be the second one to drop a keyboard
	 * user at the top of the document's tab order - the exact defect UX round 1 (U2)
	 * found on the browser trigger. Same guard: only when focus was actually lost,
	 * and never on first mount.
	 */
	const consoleButtonRef = useRef<HTMLButtonElement | null>(null);
	const consolePaneWasOpen = useRef(isConsolePaneOpen);
	useEffect(() => {
		if (
			consolePaneWasOpen.current &&
			!isConsolePaneOpen &&
			document.activeElement === document.body
		)
			consoleButtonRef.current?.focus();
		consolePaneWasOpen.current = isConsolePaneOpen;
	}, [isConsolePaneOpen]);

	/*
	 * THE INLINE RENAME (the operator's report, 2026-09-26): "the rename
	 * interaction ... only happens when you hover to the right of the
	 * conversation title but not on the title itself ... double clicking also
	 * allows for edit ... inline edit with enter or unfocus to save, esc or
	 * click x to cancel (pencil turns into an X)".
	 *
	 * ONE WRITE PATH, TWO SURFACES. The pencil used to open `RenamePicker`
	 * through the page's dispatcher; that door is still `/rename`'s (the
	 * composer and the options row) and this surface stops using it. The editor
	 * submits `sessions.command` `rename` through the SAME hook and the same
	 * command the picker runs (`useSessionCommand`, `destination-pickers.tsx`),
	 * so the two surfaces cannot diverge, and the page still gates the whole
	 * affordance on `commands` (`renameSessionId` is absent without it) - no
	 * dead pencil on a backend that cannot run commands.
	 *
	 * NO OPTIMISTIC LABEL: a save closes the editor and nothing else - the
	 * title repaints from the canonical stream when the owner publishes the new
	 * name, the same rule the identity controls state for a switch. The ONE
	 * case the editor stays open for is a FAILED save, with the typed value
	 * kept: the owner's own text goes to the app's toast channel (the identity
	 * pattern), and discarding the user's typing because the backend refused it
	 * would make them type it twice - the convention the composer's returned
	 * payload already ships for a failed submit.
	 *
	 * THE BLUR RACE, AND WHICH LATCH CLOSES IT. Three exits want the same
	 * moment: Enter saves, blur saves, the X cancels. A blur arriving after a
	 * cancel - or after a save already ran - must not re-run anything, so all
	 * three go through one phase latch (`edit` -> `saving` -> `closed`) and a
	 * blur that finds the latch past `edit` no-ops. The X press also consumes
	 * its own `mousedown` (`preventDefault`) so the input never even blurs on
	 * that path, and a multi-click's second press is let go (`event.detail >
	 * 1`), so double-clicking the PENCIL cannot open-then-cancel in one
	 * gesture.
	 *
	 * THE BOX IS MEASURED BEFORE IT IS REPLACED. The input takes the title's
	 * own width, read off the box it is replacing, because the identity
	 * controls sit on the same line right after it: letting the field size
	 * itself would move them (and the clipped wrap) mid-gesture, and the
	 * contract this header's rounds fixed is that the row does not reflow under
	 * the pointer. The ramp is the h2's own (`font-medium text-body text-ink`),
	 * so the swap is a box carrying the same ink in the same place.
	 *
	 * FOCUS RETURNS TO THE CONTROL when an explicit gesture closes the editor
	 * (Enter, Escape, the X); a blur-close leaves focus wherever the user put
	 * it. Without the return, Escape on a keyboard walk dropped focus onto
	 * `<body>` - the defect UX round 1 (U2) found on the pane triggers.
	 */
	const renameCommand = useSessionCommand(renameSessionId ?? "");
	/* The in-flight span of the save, read from the hook's own `busy` rather than
	 * tracked a second time here: it is true from the `run` call to its settle,
	 * which is exactly the span in which a submitted save is committed - the field
	 * freezes and the slot shows the spinner (see the U1/U3 notes at both). */
	const renameSaving = renameCommand.busy;
	const [renaming, setRenaming] = useState(false);
	const [renameDraft, setRenameDraft] = useState("");
	const [renameWidth, setRenameWidth] = useState<number | null>(null);
	const renamePhaseRef = useRef<"edit" | "saving" | "closed">("closed");
	const renameInputRef = useRef<HTMLInputElement | null>(null);
	const renameTitleRef = useRef<HTMLHeadingElement | null>(null);
	const renameControlRef = useRef<HTMLButtonElement | null>(null);

	const startRename = () => {
		if (!renameSessionId || renaming) return;
		const box = renameTitleRef.current?.getBoundingClientRect();
		/*
		 * CEIL, not the exact fraction, and the difference is measured rather than
		 * argued: the input's text engine lays the same string a hair wider than
		 * the h2 laid it (217.0 against 216.86 at this ramp), so an exact pin
		 * would leave the field ~0.14px short of its own text - scrollWidth past
		 * clientWidth, a clipped glyph tail - while the ceil costs the cluster
		 * +0.14px of sub-pixel growth. Two reads of ONE unchanged box already
		 * span 0.17px on this host, so neither is visible; keep the side that
		 * cannot clip text.
		 */
		setRenameWidth(box ? Math.ceil(box.width) : null);
		setRenameDraft(agentName);
		renamePhaseRef.current = "edit";
		setRenaming(true);
	};

	const closeRename = (restoreFocus: boolean) => {
		/* The latch closes BEFORE the focus move: focusing the control blurs the
		 * input, and that blur must find the latch past `edit` so it cannot run a
		 * save on the way out (the race this sequence exists for). */
		renamePhaseRef.current = "closed";
		if (restoreFocus) renameControlRef.current?.focus();
		setRenaming(false);
	};

	const commitRename = async (restoreFocus: boolean) => {
		if (renamePhaseRef.current !== "edit") return;
		const next = renameDraft.trim();
		if (!next || next === agentName) {
			/* Empty or unchanged: exit, no command - the picker's
			 * disabled-submit rule, stated as an outcome. */
			closeRename(restoreFocus);
			return;
		}
		renamePhaseRef.current = "saving";
		const { result } = await renameCommand.run(
			"rename",
			next,
			"Could not rename the conversation",
		);
		if (result.tone === "error") {
			showErrorToast(result.text);
			/* Re-open only if the editor was still the user's current move: a
			 * cancel during the flight keeps its outcome (the toast still
			 * reports the failed command). */
			if (renamePhaseRef.current === "saving") {
				renamePhaseRef.current = "edit";
				/* THE RETRY STARTS WHERE THE VALUE IS (UX round 1's U4): a failed
				 * save leaves the editor open with the typed value, so the field
				 * gets its focus back - the Enter path never lost it, and the blur
				 * path used to leave the editor open but unfocused on `body`. */
				renameInputRef.current?.focus();
			}
			return;
		}
		if (result.tone === "warning") showWarningToast(result.text);
		/* ONLY THIS SAVE MAY CLOSE THE EDITOR (agent review round 1's MINOR-1):
		 * the latch is read back before acting, so a stale resolution can never
		 * close an editor that came after it - the error branch above guards the
		 * same case, and this closes the latch's completeness. */
		if (renamePhaseRef.current === "saving") closeRename(restoreFocus);
	};

	/*
	 * The editor opens FOCUSED AND SELECTED: the gesture's point is to type a
	 * replacement, and the selection makes the first keystroke replace the name
	 * rather than append to it (the picker cannot offer this - its field opens
	 * empty). An effect rather than `autoFocus` so the selection lands after the
	 * node is committed, which is the order the double-click path needs.
	 */
	useEffect(() => {
		if (!renaming) return;
		const input = renameInputRef.current;
		if (!input) return;
		input.focus();
		input.select();
	}, [renaming]);

	return (
		<header
			/*
			 * THE TOP ROW IS THE WALK'S SECOND REGION (§C4), and it is a real `<header>`
			 * landmark rather than a `div` with a role because that is what it is: one row
			 * heading the conversation pane, carrying the title, the working directory and
			 * the action cluster. `tabIndex={-1}` is the door - `F6` entering this region
			 * lands on the row itself, which is the only sane target for a row whose
			 * controls are its own children and whose first control would otherwise depend
			 * on which of them happened to be drawn at this width (`⋯` absorbs whatever the
			 * row drops).
			 *
			 * NO `aria-label`: a landmark that is not `banner` is named by the section it
			 * heads, and this one heads the pane the reader is looking at. §C4 names the
			 * three regions that needed a name (`Chats`, `Conversation`, `Message
			 * composer`) and this is not one of them.
			 */
			data-chat-region="header"
			data-region-entry
			tabIndex={-1}
			/*
			 * ONE ROW, 40px, and no rule under it.
			 *
			 * IT WAS 56px WITH TWO LINES (`text-heading` name over a `text-body-sm`
			 * description). Three things end here:
			 *
			 *  - THE SECOND LINE. The description slot carried the working directory as a
			 *    RAW ABSOLUTE PATH (`/Users/damian/.local-operator/sessions/…`), truncated
			 *    from the right, so the segment that identifies the directory was the part
			 *    that got cut - while the composer's chip three inches below abbreviated the
			 *    same path to `~/.local…` (D7). It is now one row with the title, `~`-formed
			 *    by the chip's own rule (`formatDirectory`), and the raw value stays in the
			 *    tooltip so nothing becomes un-recoverable.
			 *  - THE 16px STEP. `text-heading` on the conversation's name made the bar's
			 *    loudest text the name of the thing the reader is already inside; the title
			 *    is `text-body` (14) now, one step above the rows it heads, which is what the
			 *    reference products do.
			 *  - THE BOUNDARY. `border-control border-b` drew a 1px line the transcript was
			 *    cut off against, with no fade (D6). The separation is the transcript's own
			 *    top edge dissolving instead - a 24px mask, in `styles/index.css`, keyed on
			 *    `data-lo-canonical-transcript` - and a boundary that is a fade does not also
			 *    need a rule.
			 *
			 * 40 is the app's existing toolbar step (`h-10`: every pane toolbar, the
			 * sidebar's brand row, the chrome lane's neighbour), and it is what lets the
			 * sidebar's brand row and this row share one line once the macOS lane is
			 * shell-level. The row is a DRAG REGION and every control in it opts out
			 * (`data-titlebar-no-drag` on the cluster, on the archived pair and on the
			 * title block), which is
			 * the vocabulary `styles/index.css` gates on `data-chrome-mode` +
			 * `data-chrome-platform` (agent review round 1's R9: this sentence still named
			 * `data-titlebar-platform`, the gate THIS PR REMOVED - and
			 * `scripts/titlebar-options.test.mjs` asserts the old name cannot survive in
			 * the CSS, so this comment was the one place it did).
			 *
			 * `@container/chathdr` is the row's own width, which is what the title's
			 * floor needs to ask about. It is NOT the viewport: this header narrows
			 * when a right-slot pane opens, and the pane is exactly the state where an
			 * unfloored title disappeared (design round 1, D1 - measured: the title's
			 * box held no ink at all while the pane was up, because `flex-1 min-w-0`
			 * lets it yield before any control does).
			 */
			className={cn(
				"@container/chathdr flex h-10 shrink-0 items-center gap-3 px-4",
			)}
			data-tour-tag="chat-header"
			data-titlebar-drag=""
		>
			{/*
			 * NO LEADING GLYPH (§C2; design round 1, D6). A robot in a filled 32px tile
			 * led this row, which brought the deleted transcript avatar back into the
			 * header; the row starts with the conversation's title.
			 */}
			{/* `flex-1` as well as `min-w-0`: the block was min-w-0 inside a row
			 * whose only other content is an `ml-auto` action, so it yielded before
			 * the empty space did - the description clipped mid-sentence at 760px
			 * while 220px of bar sat unused to its right. Growing first means the
			 * text truncates only once there is genuinely no room left. */}
			{/* THE FLOOR IS THE POINT, AND IT IS CONDITIONAL ON THE ROOM THAT PAYS FOR IT
			 * (design round 1, D1; agent review round 2, Q-1).
			 *
			 * `flex-1 min-w-0` grows into spare room but yields ALL of it, so one more
			 * control in the cluster could take the conversation's name off the bar
			 * entirely - which is what the browser trigger's own fix did, on the pane-open
			 * screen the operator reported from. `min-w-10` (40px, two or three characters
			 * and the ellipsis) is the floor the NARROWEST real row can pay, measured
			 * rather than picked: with the browser pane up at 1380px the header is 240px
			 * wide, its fixed parts (avatar 32, two 12px gaps, the `...` menu, the trigger,
			 * the console, px-4) come to 200, and what is left for the title is 40.
			 *
			 * AND THE ROW'S OVERFLOW IS VISIBLE, so the floor has to be one the row can pay
			 * for: QA's round-2 Q-1 measured the pane-open header at a 900px window with the
			 * controls not yielding - the last one ended 4px past the row and painted UNDER
			 * the pane, invisible and unpressable, rather than being clipped. What fixes
			 * that is the SHED ORDER below, and the gate here is its insurance rather than
			 * its mechanism: at the app's own minimum window (`WINDOW_MIN_WIDTH = 800`)
			 * the pane-open header measures 220px, its remaining fixed parts 164 and the
			 * floor 40, which fits with 16px to spare - so at every width a person can
			 * reach the floor is applied, and the gate only stops it from being the thing
			 * that breaks a row nothing else is left to shed
			 * (`@[13.5rem]` = 216px, beneath every width a person can reach) and the title
			 * yields freely below that. The controls shed FIRST - the run trigger, then the canvas
			 * button, then the console - so on the widths a person can reach the floor is
			 * almost always applied; the gated-off case is the last resort beneath them
			 * rather than the mechanism. */}
			{/*
			 * THE TITLE OUTRANKS THE PATH, BY CONSTRUCTION (design round 1, D6).
			 *
			 * The two used to share one flex line and both shrink, so at 1024 the row
			 * read `Explain the transcript w…` beside 330px of path - the quiet chip
			 * winning the contest with the primary text. Flex shrink factors cannot fix
			 * that: a weighted shrink still leaks a fraction of a pixel to the title,
			 * and a fraction is enough for the ellipsis. So this box WRAPS and clips to
			 * one line: the title is on line one at its natural width (it truncates
			 * only when it alone is wider than the row), and the path chip - bounded to
			 * `PATH_CHIP_CHARS` by `middleTruncatePath` - sits beside it when it fits
			 * WHOLE and wraps onto the clipped second line when it does not. The path
			 * is dropped before the title loses a word, and it never renders cut.
			 *
			 * AND IT CLIPS WITHOUT SCROLLING (`overflow-clip`, UX round 1's U1). The
			 * controls this PR adds are the first focusables ever to live INSIDE this
			 * block, and `overflow-hidden` is a scroll container: focusing either
			 * control scrolled it (scrollTop 0 -> 3 at rest; 22px at the 560 band,
			 * where the identity sits on the clipped second line - the title's top
			 * half scrolled out of the clip) and blur never restored it. `clip`
			 * clips exactly the same pixels but creates no scrollport, so focus has
			 * nothing to move; the reserved slot and the geometry are unchanged.
			 *
			 * AND IT DOES NOT WRAP WHILE THE IDENTITY CONTROLS ARE HERE (UX round 1,
			 * U2). `flex-wrap` collects lines from each item's HYPOTHETICAL size, so
			 * a title that alone fits pushed the controls onto the clipped second
			 * line however much shrink room the title had - measured at the operator's
			 * own 49-character title, every chip is off the paint at the 560 band and
			 * below (the topmost element at the chip's own centre is the band, and a
			 * press opens nothing), and a 30-character title loses them at 480 and
			 * below. A control that is not painted cannot be pressed, and no tooltip
			 * can stand in for one - so while `identity` is what this slot holds, the
			 * line does not wrap: the title yields instead (it truncates, and at the
			 * narrowest widths it can yield entirely - the controls keep their own
			 * room). The PATH and skeleton cases
			 * keep the wrap-and-clip unchanged - the path is decoration dropped before
			 * the title loses a word, the chip is a control and keeps its room.
			 */}
			<div
				className={cn(
					"flex h-5 min-w-0 flex-1 items-baseline gap-x-2 overflow-clip @[13.5rem]/chathdr:min-w-10",
					!identity && "flex-wrap",
					/*
					 * THE CLIP EARNS FOUR PIXELS OF MARGIN WHILE A DEVICE CONTROL IS INSIDE IT
					 * (design review round 2, D1). The device chip finished this round sitting
					 * 2.2px LOWER than the band it lives in: the baseline join the alignment fix
					 * restores puts its 20px box at y 44.2 against this row's y 42, so the box's
					 * last two pixels - and with them the bottom stroke of its own inset focus
					 * ring and the bottom edge of its hover fill - fell under `overflow-clip`
					 * (measured in `docs/evidence/chat-device-persist/`: the ring's top and side
					 * strokes present, the bottom stroke absent; the scan lives in the set's
					 * `harness/drive.mjs`). `overflow-clip` is the right mechanism here (see
					 * above - it was chosen because `hidden` is a scrollport that scrolled under
					 * focus); `overflow-clip-margin` is the spec's own knob for keeping it while
					 * granting an edge a little ink room.
					 *
					 * GATED ON WHAT IS ACTUALLY INSIDE THE ROW (`has-[...]`), not on the prop and
					 * not unconditionally. The margin's reason is the device chip's own box, and
					 * the chip is rendered by `deviceSlot` INSIDE the flex line rather than as a
					 * prop (`chat-header.tsx`'s own device-slot comment says so) - so `identity`
					 * would have missed exactly the draft state this round is fixing (measured:
					 * the first attempt gated on `identity` and the after arm still read an open
					 * ring). The `:has()` form keeps the margin off every other composition -
					 * the plain-title case and any row without a device control keep today's
					 * exact clip, which is what the wrapped second line needs.
					 */
					"has-[[data-device-chip]]:[overflow-clip-margin:4px]",
				)}
			>
				{/* `text-body` (14), not `text-heading` (16) and not `text-title` (20):
				 * branding.md reserves the 20px step for section and dialog titles and states
				 * that a desktop app has no hero, and on the name of the conversation the
				 * reader is already inside the 16px step made the bar's loudest text the
				 * thing they were looking at anyway. 14 is one step above the rows the bar
				 * heads, which is what the reference products use. */}
				{/*
				 * THE RENAME CONTROL LANDS WHERE THE ACTION IS: on the conversation's own
				 * name, not on the identity chip beside it (the operator wrote "on the
				 * team name" and the manager's clarification, 2026-09-26, pinned that
				 * the title block is the rename's subject; the design round sees this
				 * note). It OPENS AN INLINE EDITOR rather than the picker - the
				 * operator's report asks for "inline edit with enter or unfocus to
				 * save, esc or click x to cancel (pencil turns into an X)", and the
				 * editor's one write path is the state block above this return.
				 *
				 * The slot is RESERVED rather than inserted: opacity is the only thing
				 * that changes on hover (/motion), so nothing reflows under the pointer,
				 * and `group-focus-within/title` is what makes it keyboard-reachable -
				 * tabbing to the pencil makes it visible. `text-ink-dim` and a 12px glyph
				 * inside a 20px slot: the ramp's rule for anything smaller than a 28px
				 * control.
				 *
				 * THE 20px SLOT IS A RECORDED TRADE (design round 1, D5), not an
				 * oversight: the slot sits inside the block above, whose one-line clip
				 * band is 20px, so nothing in it can present a 24x24 target - a hit area
				 * cannot extend past the ancestor that clips it, and growing the band
				 * exposes a sliver of the wrapped second line (measured on the fold
				 * state; see the PR's Judgement calls). The pencil and the two triggers
				 * are 20px in a 40px desktop toolbar, kept because the alternative
				 * re-pins the toolbar step this header's rounds fixed - and the
				 * measurement is what makes it a decision rather than an accident.
				 */}
				<span
					className={cn(
						"group/title inline-flex min-w-0 max-w-full items-center gap-1",
					)}
					/*
					 * THE TITLE IS A CLIENT-AREA SURFACE, AND THIS IS THE LINE THAT MAKES
					 * IT ONE (operator's report, 2026-09-26: "the rename interaction ...
					 * only happens when you hover to the right of the conversation title
					 * but not on the title itself").
					 *
					 * WHY IT WAS NOT: the header row is a drag region (`data-titlebar-drag`
					 * above) and a point inside a drag region belongs to the OS's
					 * window-move hit test - the renderer never sees the pointer there (the
					 * mechanism is written down in `styles/index.css`'s drag vocabulary,
					 * and `scripts/overlay-drag-zones.test.mjs` F-5 pins this marker so a
					 * refactor cannot quietly remove it). The pencil beside the title
					 * worked because it is a `<button>` and the descendant rule opts
					 * controls out; the title text had no opt-out, so hovering IT was a
					 * window drag - `group-hover` never fired, the pencil never revealed,
					 * and a double-click never reached the title at all. The marker
					 * subtracts the whole block's rect, which is what makes hovering
					 * anywhere over the title text reveal the pencil and stand the editor's
					 * entry gestures on client-area ground.
					 *
					 * THE TRADE, stated where the marker is (and flagged for the design/UX
					 * rounds): the title is no longer a window-drag HANDLE. Dragging must
					 * start beside it - the row's own empty lane, the padding, or the
					 * strip above - and the `stillDrags` point in the `hit-zones` scene
					 * measures that lane to prove it.
					 */
					data-titlebar-no-drag=""
				>
					{renaming ? (
						<input
							ref={renameInputRef}
							data-header-rename-input=""
							/*
							 * `outline-none` is deliberate, the second exemption the focus-ring
							 * rule in `styles/index.css` names: focus moved here
							 * programmatically as the edit OPENED, and the block's one-line
							 * clip would cut a ring anyway. What says "editing" is the X in
							 * the slot, the caret, and the selected text.
							 */
							className={cn(
								"min-w-0 max-w-full border-0 bg-transparent p-0 outline-none",
								"font-medium text-body text-ink",
							)}
							style={renameWidth === null ? undefined : { width: renameWidth }}
							value={renameDraft}
							/*
							 * FROZEN WHILE SAVING, visibly (UX round 1's U3): the command
							 * already carries the value that was on screen when Enter or the
							 * blur submitted it, so edits accepted after that point could only
							 * be text the write silently ignores. `readOnly` rather than
							 * `disabled`: it blocks edits while keeping focus, caret and
							 * selection, and the busy spinner in the slot states why nothing
							 * types rather than the keystrokes simply vanishing.
							 */
							readOnly={renameSaving}
							aria-label="Conversation name"
							onChange={(event) => setRenameDraft(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									void commitRename(true);
								} else if (event.key === "Escape") {
									/* Claimed with `preventDefault`, the way every layer that
									 * must win claims Escape (the ladder in
									 * `use-interrupt-on-escape.ts`): the field owns the key,
									 * so a cancel cannot also reach the turn's interrupt. */
									event.preventDefault();
									/* A SUBMITTED SAVE IS COMMITTED (UX round 1's U1): once
									 * the write is in flight its outcome is the backend's, and
									 * an exit that only closed the editor would promise an
									 * abort it cannot make. The no-op is visible - the slot
									 * shows the busy spinner and the field is read-only - and
									 * the escape claim above still runs, so the key cannot
									 * fall through to the turn's interrupt either. */
									if (renamePhaseRef.current === "saving") return;
									closeRename(true);
								}
							}}
							onBlur={() => void commitRename(false)}
							spellCheck={false}
						/>
					) : (
						<h2
							ref={renameTitleRef}
							data-header-title=""
							onDoubleClick={renameSessionId ? startRename : undefined}
							className={cn(
								"min-w-0 max-w-full truncate font-medium text-body text-ink",
								/*
								 * Client-area now, so the two things such a text needs: no
								 * native selection (a drag across a window title that
								 * highlights like a document reads as broken, and a
								 * double-click's word-select would race the select-all the
								 * editor opens with), and the arrow cursor - a pointer
								 * cursor would promise a single click the text does not act
								 * on (the double-click and the pencil are the affordances).
								 * `user-select: none` does not stop `dblclick`, which is the
								 * event the editor opens on.
								 */
								"cursor-default select-none",
							)}
						>
							{agentName}
						</h2>
					)}
					{renameSessionId && (
						<button
							ref={renameControlRef}
							type="button"
							data-header-rename=""
							/*
							 * THE LABEL STATES THE TRUE AFFORDANCE OF EACH PHASE: the
							 * pencil's name, the X's cancel, and - while the write is in
							 * flight - the busy state itself, because a "Cancel rename"
							 * label over a no-op would be the same lie the U1 rule exists
							 * to avoid.
							 */
							aria-label={
								renameSaving
									? "Saving the conversation name"
									: renaming
										? "Cancel rename"
										: "Rename conversation"
							}
							title={
								renameSaving
									? "Saving the conversation name"
									: renaming
										? "Cancel rename"
										: "Rename conversation"
							}
							/*
							 * THE BUSY CUE, in the identity trigger's pattern: `aria-busy`
							 * plus the spinner taking the icon's slot, the 20px box fixed so
							 * geometry never moves. `aria-disabled`, not `disabled`: the
							 * button keeps its place and never steals focus back from the
							 * field; the press guard below is what actually no-ops.
							 */
							aria-busy={renameSaving || undefined}
							aria-disabled={renameSaving || undefined}
							/*
							 * The X half of the blur race: consume the press's own
							 * `mousedown` so the input never blurs on the way to this
							 * handler (a blur would save first), and let go of a
							 * multi-click's second press so NOTHING toggles twice in one
							 * gesture - the guard is symmetric (agent review round 1's
							 * NIT-1): without it a double-click on the X cancels on the
							 * first press and RE-OPENS on the second.
							 */
							onMouseDown={(event) => {
								if (renaming) event.preventDefault();
							}}
							onClick={(event) => {
								if (event.detail > 1) return;
								/* A submitted save is committed (U1): while it is in
								 * flight this control is the busy indicator, never the
								 * cancel exit. */
								if (renamePhaseRef.current === "saving") return;
								if (!renaming) {
									startRename();
									return;
								}
								closeRename(true);
							}}
							className={cn(
								"inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-xs",
								"text-ink-dim",
								// The duration governs the transition INTO the current state, so
								// the resting value is the fade-OUT and the hovered value the
								// fade-IN: quick to appear, gentler to leave (the reveal pattern
								// `chat-sidebar.tsx`'s entity rows ship). While editing the
								// reveal gates are dropped: the X is the mode's own control
								// and must be visible without a pointer.
								"transition-opacity duration-base ease-out-quart",
								!renaming &&
									"opacity-0 group-hover/title:opacity-100 group-hover/title:duration-fast",
								!renaming &&
									"group-focus-within/title:opacity-100 group-focus-within/title:duration-fast",
								"hover:text-ink-muted",
							)}
						>
							{renameSaving ? (
								/* The spinner takes the X's slot while the write is in
								 * flight - the identity trigger's busy glyph, one scale
								 * step up from the 12px icons to match it. */
								<Spinner size="xs" />
							) : renaming ? (
								<X className={cn("size-3")} aria-hidden="true" />
							) : (
								<Pencil className={cn("size-3")} aria-hidden="true" />
							)}
						</button>
					)}
				</span>
				{/*
				 * THE QUIET PATH, and the `~` form is the point of it.
				 *
				 * This slot used to be the second line of a 56px bar and printed `description`
				 * RAW - for a live conversation that is the absolute working directory, so
				 * the row read `/Users/damian/.local-operator/sessions/d81d04d3…` truncated
				 * from the right, i.e. with the one segment that identifies the directory cut
				 * off, while the composer's chip abbreviated the same value to `~/.local…`
				 * (D7). It goes through the chip's own rule now (`formatDirectory`, hoisted to
				 * `shared/utils/path-utils.ts` so there is one implementation and two
				 * surfaces), which is safe because that rule returns anything that is not a
				 * path unchanged - and this slot is not only a path: it holds the draft's
				 * sentence and a starting run's target name too.
				 *
				 * `shrink-[2]` YIELDS BEFORE THE TITLE. Both strings truncate, and which one
				 * gives first is the whole ordering question in a 40px row: the title is what
				 * the reader came for, and the directory is a fact they can also read in the
				 * composer's chip one line below. So the path takes the larger shrink factor
				 * and disappears into its ellipsis first.
				 *
				 * THE TOOLTIP KEEPS THE RAW VALUE, so the fully-resolved path is one hover
				 * away and nothing about the shortening is lossy.
				 */}
				{descriptionPending ? (
					/* `bg-elevated` for the same measured reason the transcript
					 * placeholder takes it: the header's ground is `canvas`, where the Skeleton
					 * default `sunken` is the system's weakest adjacent pair (deltaE00 1.89 in the
					 * dark brand palette, 1.25 in obsidian). The height matches the `text-mono-sm`
					 * line it stands in, so holding the slot holds the row's height too. */
					<Skeleton className={cn("h-3 w-24 shrink-0 bg-elevated")} />
				) : identity ? (
					/*
					 * THE IDENTITY SLOT, WHEN THERE IS SOMETHING TO SWITCH. The two menus
					 * replace the joined string ("manager · lopdev") in the same slot, so
					 * the row's wrap-and-clip behaviour is unchanged: at widths the text
					 * block cannot hold, the control wraps onto the clipped line exactly
					 * as the chip did. Everything about drawing, gating and the labels
					 * lives in `chat-header-identity.tsx`; this component only decides
					 * WHICH content the slot holds.
					 */
					<ChatHeaderIdentity {...identity} />
				) : showDescription ? (
					<span
						data-header-path=""
						className={cn(
							// `font-mono` as well as the step: `text-mono-sm` is a SIZE, and
							// without the family the chip rendered in the sans face (D6).
							"shrink-0 whitespace-nowrap font-mono text-ink-dim text-mono-sm",
						)}
						title={description}
					>
						{/*
						 * MIDDLE-TRUNCATED, so both informative ends survive: the head says
						 * where the path is rooted and the tail says which directory it is
						 * (§B4). It replaced a `dir="rtl"` left-cut, which kept the tail but
						 * lost the root, and had no bound, so it took the title's room.
						 * `formatDirectory` returns anything that is not a path unchanged, and
						 * so does `middleTruncatePath` for a short string - this slot also
						 * holds a draft's sentence and a starting run's target name.
						 */}
						{middleTruncatePath(shownDescription, PATH_CHIP_CHARS)}
					</span>
				) : null}
				{/*
				 * THE DEVICE CONTROL SITS LAST IN THE TITLE BLOCK, which is where the design
				 * put it: the block already hosts controls of exactly this shape (the team
				 * and agent chips, 20px `rounded-xs` buttons with a popover), so the chip
				 * inherits that geometry instead of inventing one. The block clips its own
				 * second line, so at widths under the app's 800px minimum this chip is the
				 * first thing to fold - the design's own note, and the reason to move this
				 * one line above the identity slot if a docked pane's header ever has to
				 * keep the placement fact and shed the identity pair instead.
				 */}
				{deviceSlot}
			</div>
			{/*
			 * The header's action cluster: the run-panel trigger, the browser pane's trigger,
			 * then the canvas button, as one group at the end of the bar. The cluster carries
			 * the `ml-auto` the canvas button used to carry, so the actions sit 8px apart
			 * instead of being pinned to opposite ends of whatever else the bar happens to
			 * hold.
			 *
			 * THESE ARE THE RIGHT PANE'S THREE CHOICES, and they are mutually exclusive in
			 * the STORE rather than here: each setter clears the other two
			 * (`claimRightSlot`), so this cluster never has to know which pane is up. The
			 * canvas and browser buttons keep their own render gates
			 * (`onOpenOptions && !isCanvasOpen`, `onToggleBrowser`), because a button that
			 * re-opens the pane already on screen is a no-op with a tooltip; the run trigger
			 * and the browser trigger stay, because each is a TOGGLE whose own ground or
			 * badge says which way it goes, and that is exactly what makes the swap
			 * reversible. THE BROWSER TRIGGER'S OWN STAY is the operator's fix (2026-09-23),
			 * and the asymmetry with the canvas button is deliberate rather than an
			 * oversight: its badge is a count this header is the only chrome to carry, and
			 * hiding it with the pane is how the count disappeared.
			 */}
			<div
				data-titlebar-no-drag=""
				className={cn(
					"ml-auto flex items-center",
					/*
					 * THE RULE THIS APPLIES. The container pays only for ink that would
					 * otherwise land in a NEIGHBOUR'S BOX - not for every child that paints
					 * outside itself. The badge earns 12px because without it its ring is
					 * painted inside the canvas button's hover target (design round 1, D5);
					 * the run trigger's own attention dot overhangs its box by 2px and earns
					 * nothing, because 6px of the ordinary 8px gap still separates it from the
					 * next box. So 12px is owed only while BOTH the badge and the box it has to
					 * clear are on screen; this is 8px in every other arrangement.
					 *
					 * 8px is the within-a-component step of branding.md's 4px ramp, and it is
					 * the state the operator photographed: a `mr-1` on the browser button paid
					 * the badge's 12px whether or not a badge was drawn, so the badge-free
					 * cluster read 8px against 12px. The room is the CONTAINER's now
					 * (branding.md section 5), so neither state is a margin on a component.
					 *
					 * WHAT A BADGE COSTS, in the two comparisons that are easy to conflate:
					 *
					 *  - THE BADGE APPEARING, this tree against itself. `gap` resolves from 8
					 *    to 12, and both of the cluster's gaps ARE that one property, so each
					 *    widens by 4px: cluster width 112 -> 120 (+8px), the run trigger's left
					 *    edge 432 -> 424 (-8px), the browser button 472 -> 468 (-4px), and the
					 *    canvas button pinned at 512 by the `ml-auto` right edge (0px). The
					 *    browser's -4px is the MECHANISM that keeps D5 rather than a detail:
					 *    its right edge moves 504 -> 500, so the badge's painted ring ends
					 *    exactly on the canvas box's left edge, at 0px clearance. "The browser
					 *    and canvas buttons do not move" is NOT what happens here.
					 *  - THIS BRANCH AGAINST `main`, in a FIXED state. Badge drawn: the run
					 *    trigger moves -4px and the browser and canvas buttons do not move at
					 *    all. Badge-free: the run trigger and the browser button both move
					 *    +4px, and the canvas does not move. The 4px figures this change is
					 *    otherwise tempted to quote belong to THIS comparison, not the one
					 *    above.
					 */
					browserBadgeDrawn && canvasButtonShown ? "gap-3" : "gap-2",
				)}
			>
				{/*
				 * THE ARCHIVED STATE, and its restore control, as a PAIR.
				 *
				 * The state is a `Badge shape="pill"` and the action is a ghost icon
				 * button beside it - two elements rather than one pill-shaped button, and
				 * the contract is what decides it: `badge.tsx` states that a badge is not a
				 * control ("if it can be clicked or dismissed it is a button or a chip"),
				 * and `branding.md` § 598 reserves `rounded-full` for avatars, status dots
				 * and pill badges, so a Button cannot be the pill. The pair is also the
				 * arrangement the badge idiom already uses in this cluster: a count badge on
				 * a control states the fact, and the control is what acts.
				 *
				 * Archiving the OPEN conversation leaves it open and merely adds this
				 * ("archive hides from lists; it does not close"), which is why the marker
				 * lives in the header at all rather than being implied by the row having
				 * left the sidebar.
				 *
				 * The action's own name states the ACTION and the badge states the STATE,
				 * the rule the pin control is written under: a control whose name is a state
				 * makes a screen reader ask what pressing it would do.
				 */}
				{archiveEnabled && archived && (
					<>
						<Badge
							shape="pill"
							data-session-archived-pill
							title="This conversation is archived. It is hidden from your chats until you restore it."
						>
							<Archive aria-hidden="true" />
							Archived
						</Badge>
						{onSetArchived && (
							<Button
								variant="ghost"
								size="icon"
								onClick={() => onSetArchived(false)}
								aria-label={archiveControlLabel(agentName, true)}
								title={archiveControlLabel(agentName, true)}
							>
								<ArchiveRestore aria-hidden="true" />
							</Button>
						)}
					</>
				)}
				{/*
				 * THE CONVERSATION'S OWN MENU: the one surface that acts on the session as
				 * a whole rather than on what is inside it.
				 *
				 * It exists because the alternative the brief names - the chat options
				 * sheet (`chat-options-sidebar.tsx`, which hosts the existing destructive
				 * "Clear conversation") - is UNREACHABLE on the canonical path this header
				 * is the top of: `chat-content.tsx` renders that sheet only for `!canonical`
				 * and `chat-page.tsx` passes `isOptionsSidebarOpen={false}` unconditionally,
				 * so a delete control there would be dead UI. The header is the session's
				 * options surface in the shipped app, and `DropdownMenu` is this
				 * repository's established shape for a small set of row-level actions.
				 *
				 * FAIL-CLOSED AND WHOLE: with neither capability this renders nothing at
				 * all - no trigger, no reserved box - so the withdrawn header is the header
				 * that never knew about archiving. A trigger whose only item is disabled is
				 * a menu that advertises a feature the backend does not have.
				 */}
				{(archiveEnabled ||
					deleteEnabled ||
					runDetails ||
					onToggleBrowser ||
					onOpenConsole ||
					onOpenOptions) && (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								/*
								 * The hook the delete dialog hands focus back to (UX round 1, U9): the menu
								 * ITEM that opened the dialog is unmounted with the menu, so the trigger is
								 * the successor control of the same act — the one a keyboard reader returns
								 * to - and a name only this file could spell is not a hook a dialog should
								 * reach for.
								 */
								data-conversation-actions
								aria-label="Conversation actions"
							>
								<MoreHorizontal aria-hidden="true" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="min-w-45">
							{/*
							 * THE TRANSCRIPT DISPLAY MODE (issue #756). The reader asked for the choice
							 * to be surfaced where they read the conversation rather than only in
							 * Settings, and this menu is the session's options surface (see the note
							 * below) - so the mode lives here, first, because it changes how
							 * everything under this row is drawn.
							 *
							 * A RADIO SUBMENU rather than one toggling item: the trigger is a stable
							 * name, and the radio dot states the ACTIVE mode, where an item whose label
							 * flipped with the state would make a screen reader ask what pressing it
							 * does. It writes the SAME store field the Settings row writes, so the two
							 * paths cannot disagree about the mode.
							 */}
							<DropdownMenuSub>
								<DropdownMenuSubTrigger>
									<Rows3 aria-hidden="true" />
									<span>Transcript display</span>
									{/*
									 * THE ACTIVE MODE, named beside the stable name (agent review round 1,
									 * m3). The trigger's own words stay fixed, so a reader who learned the
									 * control still knows it; the state rides next to it, muted, rather than
									 * being folded into the label an item or a screen reader would read as the
									 * control's name. `transcriptDisplayModeLabel` is the one place a mode's
									 * words are spelled (`transcript-display-mode.ts`), so this surface and
									 * the Settings row cannot name the same mode differently.
									 */}
									<span className="text-body-sm text-ink-dim">
										{transcriptDisplayModeLabel(activeTranscriptDisplayMode)}
									</span>
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent>
									<DropdownMenuRadioGroup
										value={activeTranscriptDisplayMode}
										onValueChange={(next) =>
											setTranscriptDisplayMode(parseTranscriptDisplayMode(next))
										}
									>
										{TRANSCRIPT_DISPLAY_MODE_OPTIONS.map((option) => (
											<DropdownMenuRadioItem
												key={option.value}
												value={option.value}
											>
												<span>{option.label}</span>
												{/*
												 * THE CHECK ON THE CHOSEN ROW (design review round 1, D3). The
												 * primitive's own mark for a checked radio row is the small status
												 * dot at the leading edge, and the frame measured the trap: on
												 * open, Radix roving-focuses the FIRST row, so the unchecked row
												 * wears the accent WASH while the checked one wears a plain ground
												 * and a dot - read together, "By turn is highlighted, By response
												 * is dotted", for a stored value of `by-response`.
												 *
												 * The wash is FOCUS and cannot be dropped without taking the focus
												 * affordance away from a keyboard reader, so the checked row gains
												 * a mark the wash cannot imitate: a check glyph at the TRAILING
												 * edge, which no focus state draws. The dot stays where the
												 * primitive puts it, so the chosen row reads as chosen whichever
												 * row holds focus, and checked / unchecked / focused stay three
												 * distinguishable states.
												 *
												 * `ml-auto` rather than a spacer, because the panel hugs its
												 * content: the mark sits at the row's end and the panel's own
												 * `min-w-32` still owns its floor.
												 */}
												{activeTranscriptDisplayMode === option.value && (
													<Check
														aria-hidden="true"
														className="ml-auto text-accent"
													/>
												)}
											</DropdownMenuRadioItem>
										))}
									</DropdownMenuRadioGroup>
								</DropdownMenuSubContent>
							</DropdownMenuSub>
							<DropdownMenuSeparator />
							{archiveEnabled && (
								<DropdownMenuItem
									/*
									 * The anchor a driver scene presses to archive from the header: the item's
									 * own label is a sentence that flips with the state, and a scene that
									 * selected it by text would break on a copy edit that changed nothing else.
									 */
									data-session-archive-action
									onSelect={() => onSetArchived?.(!archived)}
									disabled={!onSetArchived}
								>
									{archived ? (
										<ArchiveRestore aria-hidden="true" />
									) : (
										<Archive aria-hidden="true" />
									)}
									<span>
										{archived ? "Restore conversation" : "Archive conversation"}
									</span>
								</DropdownMenuItem>
							)}
							{archiveEnabled && deleteEnabled && <DropdownMenuSeparator />}
							{deleteEnabled && (
								<DropdownMenuItem
									/*
									 * The anchor a driver scene presses to ASK for the delete: the
									 * item's own label is a sentence, and a scene that selected it by
									 * text would break on a copy edit that changed nothing else.
									 */
									data-session-delete
									/*
									 * `text-danger`, the ink the app paints a destructive row in (the
									 * command palette's own destructive items use it). The action does
									 * NOT delete: it opens the confirmation, because the wire requires a
									 * confirmed delete and a menu pick is not a confirmation.
									 */
									className="text-danger"
									onSelect={() => onRequestDelete?.()}
									disabled={!onRequestDelete}
								>
									<Trash2 aria-hidden="true" />
									<span>Delete conversation…</span>
								</DropdownMenuItem>
							)}
							{/*
							 * THE RIGHT-SLOT ACTIONS, SO NOTHING IS UNREACHABLE AT 800.
							 *
							 * The cluster beside this menu SHEDS its controls as the row
							 * narrows - the run trigger first, then the canvas button, then
							 * the console - because a header with the right pane up is 220px
							 * wide at the app's own 800px window minimum and cannot hold four
							 * icon buttons, a title and a path. What the shed must not do is
							 * make an action disappear: this menu holds EVERY one of the four
							 * in EVERY state, which is what makes the row's overflow truthful
							 * rather than merely tidy. The items are not duplicates of the
							 * buttons - a duplicate would be a second way to do what the row
							 * already does; these are the same door for the widths where the
							 * row cannot carry a button for it.
							 *
							 * They open through the SAME store fields the buttons write
							 * (`claimRightSlot` clears the other panes), so the two paths
							 * cannot disagree about which pane is up. The labels state the
							 * ACTION in the pane's own direction: a toggle that said only
							 * "Browser" would make a screen reader ask what pressing it does.
							 */}
							{(runDetails ||
								onToggleBrowser ||
								onOpenConsole ||
								onOpenOptions) && <DropdownMenuSeparator />}
							{runDetails && (
								<DropdownMenuItem onSelect={() => setRunPanelOpen(true)}>
									<Info aria-hidden="true" />
									<span>Run details</span>
								</DropdownMenuItem>
							)}
							{onToggleBrowser && (
								<DropdownMenuItem onSelect={() => onToggleBrowser()}>
									<Globe aria-hidden="true" />
									<span>
										{isBrowserPaneOpen ? "Close browser" : "Open browser"}
									</span>
								</DropdownMenuItem>
							)}
							{onOpenConsole && (
								<DropdownMenuItem onSelect={() => onOpenConsole()}>
									<SquareTerminal aria-hidden="true" />
									<span>
										{isConsolePaneOpen ? "Close console" : "Open console"}
									</span>
								</DropdownMenuItem>
							)}
							{onOpenOptions && (
								<DropdownMenuItem onSelect={() => onOpenOptions()}>
									<FileText aria-hidden="true" />
									<span>{isCanvasOpen ? "Close canvas" : "Open canvas"}</span>
								</DropdownMenuItem>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				)}
				<RunDetailsTrigger
					details={runDetails}
					mcpServers={mcpServers}
					listOnScreen={listOnScreen}
					readerChildId={readerChildId}
				/>
				{/* The conversation's browser, third in the cluster. `ghost`/`icon` like its
				    neighbours, and it carries the count when this conversation has a request
				    outstanding — see `browserAttentionCount` for why a count here and a dot on
				    the canvas button. It TOGGLES and stays mounted while its pane is open:
				    `onToggleBrowser` is where that rule and its reason live. */}
				{browserButtonShown && (
					<Tooltip
						content={
							isBrowserPaneOpen
								? browserAttentionCount > 0
									? `Close browser — ${browserAttentionCount} ${browserAttentionCount === 1 ? "approval" : "approvals"} waiting`
									: "Close browser"
								: browserAttentionCount > 0
									? `Open browser — ${browserAttentionCount} ${browserAttentionCount === 1 ? "approval" : "approvals"} waiting`
									: "Open browser"
						}
						side="top"
					>
						<Button
							ref={browserButtonRef}
							variant="ghost"
							size="icon"
							onClick={onToggleBrowser}
							/* The count rides the NAME in both directions, so a screen reader hears
							   the number whether the pane is open or closed (spec 5.1) — and the verb
							   matches what the press does, which is the whole change. */
							aria-label={
								isBrowserPaneOpen
									? browserAttentionCount > 0
										? `Close browser, ${browserAttentionCount} waiting`
										: "Close browser"
									: browserAttentionCount > 0
										? `Open browser, ${browserAttentionCount} waiting`
										: "Open browser"
							}
							aria-expanded={isBrowserPaneOpen}
							data-tour-tag="browser-pane-trigger"
							/*
							 * `relative` for the badge only; the SPACING that makes room for it is the
							 * cluster's, which is where branding.md section 5 puts it. The reservation
							 * used to be a `mr-1` here and was paid in every state, badge or not, which
							 * is the 12px-against-8px asymmetry the operator saw; see the cluster's own
							 * comment for the two numbers and the reasoning.
							 */
							className={cn("relative")}
						>
							<Globe aria-hidden={true} />
							{/*
							 * The same badge the URL bar carries, offset for an ICON control rather than
							 * for a labelled one. The Approvals control reserves `pr-5` for its badge and
							 * keeps it at the corner; a 32px `icon` button has no such reserve, and at that
							 * offset a 16px badge sat across the Globe's own corner — two glyphs on top of
							 * each other, which is the one thing a badge must not be (measured in the first
							 * capture of `docs/evidence/browser-pane/trigger-*`). So the offset is OUTWARD,
							 * far enough for the badge's box to clear the 16px glyph's box, and
							 * `ring-canvas` still names the ground behind it so it reads as an object
							 * sitting on the corner rather than a notch cut out of the control.

								 *
								 * `-2.5` RATHER THAN `-2`, because the BOX clearing the glyph was not the whole
								 * claim (design round 1, D5): the ring paints 2px further out on every side, and
								 * measured at `-2` the ring's inner edge landed at x=210 while the glyph's
								 * top-right arc still had ink at 209-210, so the badge cut the stroke it was
								 * supposed to sit beside. One spacing step buys those two pixels back, and the
								 * cluster widens its own gap so the badge's outward move is paid for on the
								 * other side (the cluster's own comment carries that half).
								 *
								 * THE VISUAL IS CAPPED, THE LABEL IS NOT. `min-w-4 px-1` grows with every digit
								 * and the badge is right-anchored, so three digits reach ~23px against the 12px
								 * of room the offset above leaves - it would have walked back over the glyph the
								 * moment a tenth request arrived, which is a state the operator asked for a
								 * QUEUE and will therefore reach. `9+` is the badge's own grammar; the exact
								 * ordinal stays in the tooltip and the `aria-label`, which are read rather than
								 * glanced at (spec 5.1).
							 */}
							{browserBadgeDrawn && (
								<span
									className={cn(
										"pointer-events-none absolute -top-2.5 -right-2.5",
									)}
								>
									<Badge
										variant="attention"
										shape="pill"
										size="count"
										className="ring-2 ring-canvas"
										data-tour-tag="browser-pane-badge"
									>
										{badgeText}
									</Badge>
								</span>
							)}
						</Button>
					</Tooltip>
				)}
				{/*
				 * The conversation's console, the fourth pane in the cluster (design
				 * 6.1). `ghost`/`icon` like its neighbours, and it hides while the pane
				 * is up for the same reason the browser button does — the pane carries its
				 * own close, and a trigger for a pane already on screen is a no-op with a
				 * tooltip.
				 *
				 * THE BLIP IS A DOT, NOT A COUNT (§12.2), and its two colours are the
				 * whole of what it says: `accent` while the completion is fresh, because
				 * something IS unread and the accent is earned (the canvas button's
				 * `ink-muted` dot is the opposite case), and the resting `ink-muted` step
				 * once the pulse has had its moment, so an unread mark never becomes a
				 * permanent animation.
				 *
				 * `SquareTerminal` RATHER THAN `Terminal`, and the distinction is
				 * load-bearing at 16px: `bash`'s bare `Terminal` is the shell the agent
				 * ran, and this is the app's own framed surface (§6.1, §14.4). Two
				 * terminals told apart at a glance in one 56px bar is the whole
				 * requirement.
				 */}
				{consoleButtonShown && (
					<Tooltip
						content={
							consoleUnseenCount > 0
								? `Open console — ${consoleUnseenCount} finished since you looked`
								: "Open console"
						}
						side="top"
					>
						<Button
							ref={consoleButtonRef}
							variant="ghost"
							size="icon"
							onClick={onOpenConsole}
							aria-label={
								consoleUnseenCount > 0
									? `Open console, ${consoleUnseenCount} finished since you looked`
									: "Open console"
							}
							data-tour-tag="console-pane-trigger"
							/* THE THIRD CONTROL THE ROW SHEDS, BELOW THE CANVAS (agent review
							 * round 2, Q-1). At 220px - the pane-open header at a 900px window -
							 * the row cannot hold the menu, both pane triggers and a title, and
							 * the console is the younger of the two pane doors: the browser's
							 * trigger carries the attention badge and is what the operator
							 * reported about, so it does not yield. Hiding this one costs
							 * reachability of the console ONLY while the row is that narrow, and
							 * the pane it opens is still named in the transcript's own rows.
							 *
							 * 17.5rem (280px) is the middle rung of the ladder the canvas's own
							 * comment states: a control here costs 32px plus `gap-3` (12), so the
							 * measured step is 44px, and this threshold is one 40px rung below the
							 * canvas's. The query is read against the header's CONTENT box - its
							 * `px-4` sits outside the container's inline size - which is why the
							 * window that photographs this band is 1460 and not 1420. The widths
							 * each rung was measured at are in ONE place, the width table in
							 * `docs/evidence/browser-approval-badges/README.md`; this comment
							 * states the rule rather than restating numbers a gap change would
							 * invalidate. */
							className={cn("relative hidden @[17.5rem]/chathdr:inline-flex")}
						>
							<SquareTerminal aria-hidden={true} />
							{consoleUnseenCount > 0 && (
								<span
									aria-hidden="true"
									className={cn(
										"absolute top-1 right-1 size-1.5 rounded-full",
										consoleUnseenPulsing
											? "bg-accent animate-pulse-visible"
											: "bg-ink-muted",
									)}
									data-tour-tag="console-pane-blip"
								/>
							)}
						</Button>
					</Tooltip>
				)}
				{canvasButtonShown && (
					<Tooltip
						content={
							fileCount > 0
								? `Open canvas (${shortcut}) — ${fileCount} ${fileCount === 1 ? "file" : "files"}`
								: `Open canvas (${shortcut})`
						}
						side="top"
					>
						<Button
							ref={canvasButtonRef}
							variant="ghost"
							/* 32px `icon`, the size every other header action in the app
							 * uses. `icon-lg` (36px) made this one button the outlier. */
							size="icon"
							onClick={() => setCanvasOpen(true)}
							aria-label={
								fileCount > 0
									? `Open canvas (${shortcut}), ${fileCount} ${fileCount === 1 ? "file" : "files"}`
									: `Open canvas (${shortcut})`
							}
							data-tour-tag="open-canvas-button"
							/* THE SECOND CONTROL TO YIELD, and the order it yields in is the
							 * row's (agent review round 2, Q-1; design round 2, D8).
							 *
							 * The canvas is the one of the cluster's controls the app can lose
							 * without losing a capability: it is also reachable from the
							 * transcript's own file tiles and the `shortcut` this control
							 * prints. `hidden`/`inline-flex` rather than a second render gate
							 * because the question is the ROW's width, not the pane's state -
							 * `chat-header-cluster`'s stories pin the same arrangement at a wide
							 * viewport, where nothing sheds.
							 *
							 * THE RULE: a control in this cluster costs 32px plus the gap beside
							 * it, and the gap that resolves while the badge and the canvas are
							 * drawn is `gap-3` - measured on the frames at 1600 as 44px per step
							 * (cluster 164 = 4x32 + 3x12, and every box gap reads 12: `...`
							 * 780..812, globe 824..856, console 868..900, canvas 912..944). The
							 * class below is one step of that ladder (320 = the console's 280 +
							 * 40), which is 4px tighter than the measured 44: the difference is
							 * taken out of the TITLE's fragment, never out of the row, and the
							 * margin above where a control strictly fits is what keeps that
							 * fragment readable rather than the two-character floor. The
							 * measurements themselves live in ONE place - the width table in
							 * `docs/evidence/browser-approval-badges/README.md` - so a change to
							 * the gap cannot leave a number stale here: this comment states the
							 * rule and points at that table. (The comment it replaces carried a
							 * 15rem rule beside a 23rem class - design round 2's D8 - and a 96px
							 * floor beside a 40px one, F10.) */
							className={cn("relative hidden @[20rem]/chathdr:inline-flex")}
						>
							<FileText aria-hidden={true} />
							{/*
							 * A dot, not a count. The number belongs on the Files segment, where
							 * there is room to read it; here the only job is to say "there is
							 * something in the canvas" before the user has opened it. `ink-muted`
							 * rather than an accent: nothing is unread, and the accent is spent on
							 * actions the app is asking for.
							 */}
							{fileCount > 0 && (
								<span
									aria-hidden="true"
									className={cn(
										"absolute top-1 right-1 size-1.5 rounded-full bg-ink-muted",
									)}
								/>
							)}
						</Button>
					</Tooltip>
				)}
			</div>
			{/*
			 * THE CONTROLS' CORNER, RESERVED (chat redesign §J4). On Windows and Linux the
			 * caption buttons are drawn by Electron INTO the client area's top-right 40px,
			 * so whichever 40px row reaches the window's right edge has to end before them
			 * - and on this surface that is this header whenever no pane is open. The
			 * spacer is empty and `--chrome-inset-end` wide, which is 0 on macOS and 0 in
			 * the native frame, so it costs nothing anywhere the OS is not drawing over
			 * the app.
			 */}
			{reserveTrailingChrome ? (
				<div className="chrome-reserve-trailing" />
			) : null}
		</header>
	);
};
