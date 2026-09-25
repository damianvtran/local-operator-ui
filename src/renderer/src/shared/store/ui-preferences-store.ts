/**
 * Store for managing UI preferences
 *
 * This store keeps track of user interface preferences such as sidebar collapse state,
 * theme selection, and provides methods to update these preferences.
 */

import {
	SIDEBAR_DEFAULT_WIDTH,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
} from "@features/chat/chat-sidebar-layout";
import {
	DEFAULT_SIDEBAR_REGIONS,
	type SidebarOrder,
	type SidebarRegions,
} from "@features/chat/sidebar-split";
import {
	DEFAULT_SIDEBAR_VIEW,
	type SidebarView,
} from "@features/chat/chat-sidebar-view";
import { DEFAULT_THEME } from "@shared/themes";
import type { ThemeName } from "@shared/themes";
import { measureCell } from "@shared/themes/terminal-theme";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Type definition for the UI preferences store state
 */
type UiPreferencesState = {
	/**
	 * Whether the command palette is open
	 */
	isCommandPaletteOpen: boolean;

	/**
	 * The current query in the command palette
	 */
	commandPaletteQuery: string;

	/**
	 * Opens the command palette
	 */
	openCommandPalette: () => void;

	/**
	 * Closes the command palette
	 */
	closeCommandPalette: () => void;

	/**
	 * Toggles the command palette visibility
	 */
	toggleCommandPalette: () => void;

	/**
	 * Sets the command palette query
	 * @param query - The query string
	 */
	setCommandPaletteQuery: (query: string) => void;

	/**
	 * Whether the canvas is open (global, not per conversation)
	 */
	isCanvasOpen: boolean;

	/**
	 * Set the canvas open state
	 *
	 * Opening the canvas CLOSES the run panel. See `setRunPanelOpen` for why the
	 * pair is excluded by construction rather than by one union field.
	 *
	 * @param open - Whether the canvas should be open
	 */
	setCanvasOpen: (open: boolean) => void;

	/**
	 * Whether the run panel is open (global, not per conversation)
	 *
	 * Global and persisted for the same reason `isCanvasOpen` is: the pane is a
	 * property of the window's right slot rather than of one conversation, so
	 * switching conversations keeps it open on the new session's data. What is
	 * NOT global is the reader's open child, which belongs to one session's
	 * lineage and is therefore the panel component's own state.
	 */
	isRunPanelOpen: boolean;

	/**
	 * Set the run panel open state
	 *
	 * One right pane at a time: opening the run panel closes the canvas. The two
	 * states are separate booleans whose SETTERS own the exclusion, rather than
	 * one `rightPane: "canvas" | "run" | null` field, because `setCanvasOpen(true)`
	 * is called from eleven sites that mean "show me this file" and a union field
	 * would churn all of them for no behavioural gain.
	 *
	 * @param open - Whether the run panel should be open
	 */
	setRunPanelOpen: (open: boolean) => void;

	/**
	 * Whether the conversation's browser pane is open (global, not per conversation).
	 *
	 * The third occupant of the window's right slot, added by the
	 * conversation-scoped browser (`docs/design/browser-approval-ux.md` 7.3). Global
	 * and persisted for the reason `isRunPanelOpen` states — the pane is a property
	 * of the window's slot rather than of one conversation — and that is exactly why
	 * it SURVIVES a conversation switch with its content following the session: the
	 * user opened it deliberately, and a pane that closed itself because they
	 * changed conversation would be the persistence the operator asked for, undone.
	 */
	isBrowserPaneOpen: boolean;

	/**
	 * Set the browser pane open state.
	 *
	 * Opening it closes the other two occupants of the slot, by the same
	 * construction as the other two setters: one slot, one pane, and the exclusion
	 * lives in `claimRightSlot` so no call site has to remember it.
	 *
	 * @param open - Whether the browser pane should be open
	 */
	setBrowserPaneOpen: (open: boolean) => void;

	/**
	 * The width of the browser pane in pixels.
	 *
	 * 640, and the reason is a page rather than a roster: at the canvas's 800 the
	 * pane takes two thirds of a default window for something the user reads beside
	 * the conversation, and at the run pane's 420 a page is a mobile column with its
	 * own layout broken. 640 is the design's number (spec 7.3) and the divider's own
	 * floor is 480, so the range the user can drag over is 480..1200 — a floor
	 * BELOW the default, which the other two panes do not have (their floors are
	 * 320/400 against defaults of 420/800): a page narrower than ~480px stops being
	 * a page, and the floor is what stops the drag there.
	 */
	browserPanelWidth: number;

	/**
	 * Set the width of the browser pane
	 * @param width - The new width in pixels
	 */
	setBrowserPanelWidth: (width: number) => void;

	/**
	 * Restore the browser pane width to its default value
	 */
	restoreDefaultBrowserPanelWidth: () => void;

	/**
	 * Which list the browser pane's strip shows (spec 7.2).
	 *
	 * THE SLOT'S STATE, NOT THE PANE'S, and that placement is the fix rather than a
	 * preference (UX round 1, U3). The pane remounts when the conversation changes,
	 * so a `useState` inside it forgot the choice on every switch - while the pane
	 * itself stayed OPEN at the width the user had dragged, which is the same slot
	 * persisting and its lens not persisting. `isBrowserPaneOpen` and
	 * `browserPanelWidth` state the rule this joins: what belongs to the window's
	 * slot survives a conversation switch, and only what belongs to the conversation
	 * (the tabs, and the session a `"conversation"` choice resolves to) follows it.
	 */
	browserPaneScope: BrowserPaneScope;

	/**
	 * Set which list the browser pane shows
	 * @param scope - This conversation's tabs, or all of them
	 */
	setBrowserPaneScope: (scope: BrowserPaneScope) => void;

	/**
	 * Whether the console pane is open (the FOURTH occupant of the right slot).
	 *
	 * Global and persisted, for the reason `isBrowserPaneOpen` states rather than
	 * beside it: the pane belongs to the window's slot, so it survives a
	 * conversation switch with its content following the session - and it is
	 * one-at-a-time with its three siblings through `claimRightSlot`.
	 */
	isConsolePaneOpen: boolean;

	/**
	 * The conversation whose console the user has just asked to open, and which the
	 * pane has not answered yet. `null` when there is no request.
	 *
	 * A CONSUMED-ONCE REQUEST, NOT A PREFERENCE, and it is deliberately excluded
	 * from persistence below. The console pane opens for four reasons — the user's
	 * press, a completion banner's click, an agent's `reveal`, and the restored
	 * preference of an app relaunch — and only the FIRST of them means "I want to run
	 * a command now". The other three name a surface that already exists (the
	 * banner), are not the user's gesture at all (the reveal), or are the same pane
	 * the user left open (the restore, and this is the one that would be a bug:
	 * creating a surface on restore would put a shell in a conversation on every
	 * launch). So the request is an EVENT: the pane consumes it and clears it, and a
	 * launch starts with it null by construction rather than by a guard.
	 *
	 * IT NAMES THE CONVERSATION rather than being a boolean, and that closes a hole the
	 * first cut left (agent review round 1, F-6): the pane is REMOUNTED on a session
	 * switch, so a request still pending when the user switched would have been answered
	 * by the NEXT conversation's pane — a shell created in a conversation nobody asked
	 * about. An answer is only an answer for the conversation that asked.
	 *
	 * IT LIVES IN THE STORE rather than in a prop of the pane's parent for the reason
	 * `consoleActiveSurface` does: the pane is remounted on a session switch, so a flag
	 * held in the pane would either be forgotten by the remount it was set just
	 * before, or re-fire on the remount it survived into. Here the pane clears it as
	 * soon as it has acted, so a remount finds nothing to do.
	 */
	consoleOpenIntent: string | null;

	/**
	 * Ask the pane to take a user's open of the console: create the first surface if
	 * that conversation has none, or put the caret in the one it shows.
	 *
	 * ONE CALLER: the chat header's console trigger, which is offered only where there
	 * is a conversation to act on. The banner's click and main's `reveal` push
	 * deliberately do not call it — see `consoleOpenIntent`.
	 */
	requestConsoleOpen: (sessionId: string) => void;

	/** The pane has answered the request FOR THIS CONVERSATION, and only that one. Called
	 * by the pane alone, with the conversation it answered for.
	 *
	 * IT TAKES THE CONVERSATION IT ANSWERS, and the guard is the point (agent review round
	 * 3, the late-answer half of F-6): an unconditional clear would wipe a request the user
	 * made for a different conversation while the first one was still being answered — the
	 * pane would have thrown away a request nobody had served. It is the same shape as the
	 * caret token's `current === applied` acknowledgement one pane over: an answer belongs
	 * to the request it answers. */
	clearConsoleOpenIntent: (sessionId: string) => void;

	/**
	 * Set the console pane open state.
	 *
	 * Opening it closes the other three occupants, by the same construction as
	 * theirs: one slot, one pane, and the exclusion lives in `claimRightSlot` so no
	 * call site has to remember it.
	 *
	 * @param open - Whether the console pane should be open
	 */
	setConsolePaneOpen: (open: boolean) => void;

	/**
	 * The width of the console pane in pixels.
	 *
	 * DERIVED FROM A MEASURED CELL rather than chosen, because that is the one
	 * number this pane's usefulness is a function of: a terminal pane narrower than
	 * its grid's columns is a terminal that crops. The value is the measured advance
	 * of the shipped face at the pane's own font step, times the design's
	 * 100-column default grid, plus the pane's chrome - so the default width IS the
	 * default grid on every machine, and it moves with the font rather than drifting
	 * away from it.
	 *
	 * The floor a drag stops at is the divider's 480 (`chat-content.tsx`), and the
	 * grid's own 40-column floor is main's, not the divider's (design 6.1, 8.5).
	 */
	consolePanelWidth: number;

	/**
	 * Set the width of the console pane
	 * @param width - The new width in pixels
	 */
	setConsolePanelWidth: (width: number) => void;

	/**
	 * Restore the console pane width to its default value
	 */
	restoreDefaultConsolePanelWidth: () => void;

	/**
	 * Which surface the console pane is showing.
	 *
	 * THE SLOT'S STATE, NOT THE PANE'S (design 6.1), for the reason
	 * `browserPaneScope` records: the pane is remounted when the conversation
	 * changes (`chat-page.tsx`'s `key={identity}`), so a lens held inside it would
	 * forget which surface the user was reading on every switch while the pane
	 * itself stayed open. This is the fourth pane's lens, and it is a surface ID
	 * rather than a scope because a console's surfaces belong to exactly one session
	 * (design 6.3) - the pane resolves it against the current session and falls back
	 * to that session's most recent surface when the remembered one is not its own
	 * (`pickActiveSurface`).
	 */
	consoleActiveSurface: string | null;

	/**
	 * Set which surface the console pane shows
	 * @param surface - The surface handle, or null for "this session's own choice"
	 */
	setConsoleActiveSurface: (surface: string | null) => void;

	/**
	 * Surfaces that have finished something the user has not looked at yet.
	 *
	 * THE BLIP'S MARK, and it is persisted on purpose (design 12.2): an uncleared
	 * blip is "a mark on recorded history, not on a live process", so it survives a
	 * session switch AND an app relaunch. Cleared when the pane is displayed on that
	 * surface and the window is focused - the same visibility predicate the
	 * notifier's first rung uses, never "could a banner reach them".
	 *
	 * THE SESSION IS PART OF THE MARK, and that is what makes the header's dot
	 * honest: the trigger lives in ONE conversation's header, so a completion in
	 * another conversation must not light it up. A surface handle is globally unique
	 * (`con:<n>:<nonce>`), so clearing by surface alone is unambiguous; marking needs
	 * the session because that is the only thing the header can filter by.
	 */
	consoleUnseen: ConsoleUnseenMark[];

	/**
	 * Mark a surface as having something the user has not seen
	 * @param sessionId - The conversation the surface belongs to
	 * @param surface - The surface handle
	 */
	markConsoleUnseen: (sessionId: string, surface: string) => void;

	/**
	 * Clear the mark on a surface, or on every surface in an array
	 * @param surface - The surface handle, or handles, to clear
	 */
	clearConsoleUnseen: (surface: string | string[]) => void;

	/**
	 * A pending request to open the run pane AT one of its sections.
	 *
	 * A request rather than a mode, and CONSUMED ONCE: the composer's plan chip
	 * names a destination inside the pane ("open the plan"), and the pane's own
	 * view state — the reader's open child — is the pane's, not a preference
	 * (`docs/run-sidebar.md` § 3.5). So the requester states what it wants once
	 * and the pane acts on it; nothing here is a second source of truth for which
	 * view is showing, and a request nobody consumes is inert rather than sticky.
	 *
	 * `null` in every ordinary state, which is the state this store ships in.
	 */
	runPanelReveal: RunPanelReveal | null;

	/**
	 * Opens the run pane at a section, from a control outside the pane.
	 *
	 * Both halves of that in ONE update: opening the pane has to clear the canvas
	 * (the two share the window's right slot, and the exclusion lives in
	 * `setRunPanelOpen`), and a request set against a still-closed pane would be
	 * consumed by nothing — the pane is what reads it. Two `set` calls would
	 * render either a closed pane holding a request or an open one with none.
	 *
	 * @param section - Which of the pane's sections to bring into view
	 */
	revealRunPanelSection: (section: RunPanelSection) => void;

	/**
	 * Retires a request the pane has acted on.
	 *
	 * @param nonce - The request's own nonce. An effect that is finishing work for
	 * an older request must not consume a newer one that arrived while it ran.
	 */
	clearRunPanelReveal: (nonce: number) => void;

	/**
	 * The width of the run panel in pixels.
	 *
	 * 420 rather than the canvas's 800: a roster plus a prose transcript does not
	 * need a document pane's room, and 420 is wide enough for the roster's fixed
	 * segments plus the row's hover ground and the wider activity line.
	 */
	runPanelWidth: number;

	/**
	 * Set the width of the run panel
	 * @param width - The new width in pixels
	 */
	setRunPanelWidth: (width: number) => void;

	/**
	 * Restore the run panel width to its default value
	 */
	restoreDefaultRunPanelWidth: () => void;

	/**
	 * Whether the create agent dialog is open
	 */
	isCreateAgentDialogOpen: boolean;

	/**
	 * Opens the create agent dialog
	 */
	openCreateAgentDialog: () => void;

	/**
	 * Closes the create agent dialog
	 */
	closeCreateAgentDialog: () => void;

	/**
	 * Whether the navigation sidebar is collapsed
	 */
	isSidebarCollapsed: boolean;

	/**
	 * Whether agent reasoning (thinking, plan and reflection turns) is shown.
	 *
	 * Default false per docs/branding.md § 7: reasoning is the agent talking to
	 * itself, and rendering it at prose weight is what makes the app read as a
	 * developer tool. When false, reasoning turns are hidden entirely — a
	 * collapsed "Reasoning" disclosure would still be chrome on every turn,
	 * which is the weight this preference exists to remove.
	 */
	showAgentReasoning: boolean;

	/**
	 * Set whether agent reasoning is shown.
	 *
	 * Written only by the Appearance switch in `settings-page.tsx`. That is the
	 * preference's sole control, and for a while it did not exist: the flag, the
	 * grouping rule that honours it and the disclosure that renders it all
	 * shipped with nothing able to turn them on, so `AgentReasoning` returned
	 * null unconditionally and the whole feature was dead in the product while
	 * looking alive in the source. Keep a control reachable, or delete the rest.
	 *
	 * @param show - Whether reasoning turns should be visible
	 */
	setShowAgentReasoning: (show: boolean) => void;

	/**
	 * The currently selected theme
	 */
	themeName: ThemeName;

	/**
	 * The width of the canvas area in pixels
	 */
	canvasWidth: number;

	/**
	 * The width of the chat sidebar in pixels
	 */
	chatSidebarWidth: number;

	/**
	 * Which of the sidebar's two regions are visible: both, or one of them.
	 *
	 * ONE union rather than two booleans, so "neither region" is unrepresentable
	 * — a column holding a title, a search box and two restore rows is a state
	 * that can be persisted, and therefore a state somebody would reach. The
	 * rule that keeps it unreachable, and the alternative it rejects, are in
	 * `features/chat/sidebar-split.ts`'s `hideRegion`, which is the only thing
	 * that decides this value.
	 */
	chatSidebarRegions: SidebarRegions;

	/**
	 * The height of the sidebar's chats list in pixels, or `null` for the auto
	 * rule.
	 *
	 * `null` is a first-class state rather than a missing value: it means the
	 * region is drawn at its content's height, capped — the shipped layout, and
	 * therefore what every user who has never dragged the new boundary sees. A
	 * number here is a height the user chose, and it is never rewritten by a
	 * window resize: the RENDER clamps, so a window too small to honour it does
	 * not destroy it (`chat-layout.tsx` clamps `chatSidebarWidth` at its render
	 * boundary for the same reason).
	 */
	chatSidebarListHeight: number | null;

	/**
	 * Which of the sidebar's two regions is drawn first.
	 *
	 * The header row and the search field stay put; only the two regions trade
	 * places, which is what lets "agents at the bottom, chats at the top" be one
	 * press rather than a drag.
	 */
	chatSidebarOrder: SidebarOrder;

	/**
	 * How the sidebar's list is ARRANGED: which sections draw, in what order, and
	 * how the chats are grouped, ordered and paged (the view popover's state).
	 *
	 * The rules are `features/chat/chat-sidebar-view.ts`'s, and the component
	 * reads this through `parseSidebarView` for the reason `chatSidebarListHeight`
	 * is passed as it was READ: `localStorage` is not the setter's path out, so
	 * the module is the one place a tampered value is rejected.
	 *
	 * ONE OBJECT rather than five fields, and that is what keeps the popover's
	 * five controls from each writing a field the others read: the setter takes
	 * the whole next view, so "hide Today" and "move Older up" both go through
	 * the module's own `toggleSection`/`moveSection` and cannot disagree about the
	 * order they leave behind.
	 */
	chatSidebarView: SidebarView;

	/**
	 * Toggle the sidebar collapse state
	 */
	toggleSidebar: () => void;

	/**
	 * Set the sidebar collapse state
	 * @param collapsed - Whether the sidebar should be collapsed
	 */
	setSidebarCollapsed: (collapsed: boolean) => void;

	/**
	 * Set the current theme
	 * @param themeName - The name of the theme to set
	 */
	setTheme: (themeName: ThemeName) => void;

	/**
	 * Set the width of the canvas area
	 * @param width - The new width in pixels
	 */
	setCanvasWidth: (width: number) => void;

	/**
	 * Set the width of the chat sidebar
	 * @param width - The new width in pixels
	 */
	setChatSidebarWidth: (width: number) => void;

	/**
	 * Set which regions the sidebar shows.
	 *
	 * Takes the resolved union rather than the region to hide, because the
	 * control is the caller and the rule that keeps "neither" unreachable is
	 * `hideRegion`'s — a setter that computed it would be a second place that
	 * rule lives.
	 */
	setChatSidebarRegions: (regions: SidebarRegions) => void;

	/**
	 * Set the chats list's height in pixels.
	 *
	 * NOT clamped here, deliberately. The range a drag can produce is already
	 * clamped by the boundary's own live bounds, and a tampered value never
	 * reaches a setter at all — zustand's persist rehydrates PAST the setters —
	 * so the one place a stored height is validated is `parseSidebarListHeight`,
	 * on read, which is where a tampered value actually arrives.
	 */
	setChatSidebarListHeight: (height: number) => void;

	/**
	 * Restore the chats list to the auto rule: the boundary's double-click and
	 * its Enter key, which are the same gesture one panel over.
	 *
	 * There is deliberately no reset for the collapse state: its own control is
	 * its inverse and is on screen whenever a region is hidden.
	 */
	restoreDefaultChatSidebarListHeight: () => void;

	/**
	 * Set which region is drawn first.
	 * @param order - The region to draw above the other
	 */
	setChatSidebarOrder: (order: SidebarOrder) => void;

	/**
	 * Replace the sidebar's view. Takes the whole value rather than a patch: the
	 * popover's controls are built from `chat-sidebar-view.ts`'s own
	 * `toggleSection`/`moveSection`, which each return a complete next view.
	 */
	setChatSidebarView: (view: SidebarView) => void;

	/**
	 * Restore the canvas width to its default value
	 */
	restoreDefaultCanvasWidth: () => void;

	/**
	 * Restore the chat sidebar width to its default value
	 */
	restoreDefaultChatSidebarWidth: () => void;

	/**
	 * The composer's `@` mention recents: paths accepted as mentions in ONE
	 * workspace, most recent first.
	 *
	 * Per workspace and not global, because a path is only meaningful relative to
	 * the directory it was accepted in — offering `src/app.py` while the session is
	 * in another repository would rank a row the user cannot choose. The workspace
	 * is carried with the list rather than keyed as a map so the ring cannot grow
	 * with every directory the app has ever been in; a new workspace starts an empty
	 * list, which is also what a first launch looks like.
	 */
	mentionRecents: { cwd: string; paths: string[] } | null;

	/**
	 * Record an accepted mention. Bounded at `MENTION_RECENTS_LIMIT`, dropping the
	 * oldest, and moved to the front when re-accepted so the ring is ordered by
	 * recent use rather than by first use.
	 */
	rememberMention: (cwd: string, path: string) => void;
};

/**
 * The sections of the run pane that a control outside it can point at.
 *
 * A union rather than a bare string, and it is the place a second control's
 * destination has to be added: the composer's status row names one of these in a
 * `revealRunPanelSection` call, and whoever consumes the request reads the same
 * union, so a section spelled at a call site and nowhere here would be a request
 * nothing could resolve.
 *
 * The four are the pane's four LIVE lists — the plan, the roster, the tool jobs
 * and the session's armed wake schedules — and they are named for their sections
 * rather than for their controls: `jobs` is the section that draws `bash` rows,
 * which the roster deliberately does not hold (`run-detail-model.ts`'s
 * partition), and `wakes` is the section that draws the schedules, which no other
 * section holds at all.
 */
export type RunPanelSection = "todos" | "subagents" | "jobs" | "wakes";

/**
 * Which list the browser pane's strip shows: this conversation's tabs, or all of
 * them (`docs/design/browser-approval-ux.md` 7.2).
 *
 * It is the pane's own vocabulary rather than a `SurfaceScope`, because it is a
 * CHOICE rather than a scope: `"conversation"` resolves to `{ sessionId }` for
 * whichever conversation the pane is showing, and only the pane (which knows that
 * session) can resolve it. The store holds the choice; the scope is derived.
 */
export type BrowserPaneScope = "conversation" | "all";

/**
 * Claiming the right slot for one of the FOUR panes that can live in it.
 *
 * The rule, stated once because three of the four panes' docs point at it: the
 * right slot holds one pane at a time, so opening one closes the others by
 * construction, and no call site has to remember which ones to clear. The console
 * is the fourth (design 6.1), and it cost exactly what the third one's arrival
 * predicted it would: one more name in this union and one more `===` below.
 *
 * The slot holds ONE pane, so every claim is "this side wins and the other two are
 * cleared" - a rule that was written out at each of the three call sites until
 * agent review round 1 (M4) counted them. Three copies is not redundant, it is
 * drift waiting for a reason to happen: the next person to add a term to the rule
 * (a third pane, telemetry, a width reset on the losing side) would update the two
 * toggles and miss `revealRunPanelSection`, whose body cannot simply call one of
 * them because a request and the pane it targets have to land in ONE update - the
 * request must never exist against a closed pane.
 *
 * The third pane arrived exactly as that comment predicted, and this is the whole
 * of what it cost: one more name in the union and one more `===` below. The
 * browser pane (`docs/design/browser-approval-ux.md` 7.3) is the window's, not the
 * conversation's, so it belongs in this rule rather than beside it.
 *
 * So the rule lives here, the caller names only what it is claiming, and the
 * losing side is not something any call site has to remember.
 */
const claimRightSlot = (
	pane:
		| "isRunPanelOpen"
		| "isCanvasOpen"
		| "isBrowserPaneOpen"
		| "isConsolePaneOpen",
): Pick<
	UiPreferencesState,
	"isRunPanelOpen" | "isCanvasOpen" | "isBrowserPaneOpen" | "isConsolePaneOpen"
> => ({
	isRunPanelOpen: pane === "isRunPanelOpen",
	isCanvasOpen: pane === "isCanvasOpen",
	isBrowserPaneOpen: pane === "isBrowserPaneOpen",
	isConsolePaneOpen: pane === "isConsolePaneOpen",
});

/**
 * A one-shot request to bring one of the pane's sections into view.
 */
export type RunPanelReveal = {
	section: RunPanelSection;
	/**
	 * Bumped on every request, so two presses of the same section are two
	 * requests. Anything reacting to the request can then compare the pair rather
	 * than rely on the object identity of a fresh `set`, which is the property a
	 * future refactor would silently take away.
	 */
	nonce: number;
};

/**
 * Store for managing UI preferences
 *
 * Uses zustand's persist middleware to save the state to localStorage
 */
/**
 * Default values for canvas and chat sidebar widths
 *
 * The chat sidebar's default is the ONE sidebar's: 260px, user-resizable
 * 220-320, and those three numbers live in
 * `features/chat/chat-sidebar-layout.ts` so the component, the store's clamp and
 * the desktop suite all read one table rather than three copies of it. It was
 * 280 (clamped 240-360) when this was the chat route's SECOND column, beside a
 * 220px rail: the pair is now one column, and 260 is what the merged contents
 * need.
 */
const DEFAULT_CANVAS_WIDTH = 800;
const DEFAULT_CHAT_SIDEBAR_WIDTH = SIDEBAR_DEFAULT_WIDTH;
/**
 * Exported because the pane's reset path needs the NUMBER, not the write: a
 * double-click on the divider stores this width directly, and the divider's own
 * contract is that the value it stores is one the pane will render. Read here so
 * the reset can be routed through the same clamped write a drag goes through,
 * instead of around it (`chat-content.tsx`).
 */
export const DEFAULT_RUN_PANEL_WIDTH = 420;

/**
 * How many accepted mentions one workspace remembers.
 *
 * A ring of about 20, which is the design direction's number and a bounded amount
 * of `localStorage`: the pool exists to make `@` fast in a repository you have
 * been working in, and twenty paths is more than any single session's working set.
 */
export const MENTION_RECENTS_LIMIT = 20;
/** The browser pane's default, and the design's number rather than a fit: see
 * `browserPanelWidth` for why a page wants 640 where a roster wants 420. */
const DEFAULT_BROWSER_PANEL_WIDTH = 640;

/**
 * The console pane's default width: the design's default grid, measured.
 *
 * Design 6.1 fixes the grid at 100x30 and asks the PR to print the px-per-column
 * it used. This computes the width from the SHIPPED face instead of printing a
 * number nobody can check, and it is deliberately arithmetic over the same
 * `measureCell` the pane reports to main: change the font, the font step or the
 * default grid and this follows, while a literal 843 would silently become "a pane
 * that crops 3 columns".
 *
 * The chrome allowance is the pane's own horizontal padding plus the terminal's
 * inset - the box the 100 columns have to fit inside - and it is one number rather
 * than a sum of class names so that a change to either is a change here.
 *
 * A STALE PERSISTED VALUE IS NOT A PROBLEM: a width the user dragged is theirs and
 * is kept; `restoreDefaultConsolePanelWidth` recomputes the default from the face
 * that is shipping now.
 */
const CONSOLE_GRID_COLUMNS = 100;
/*
 * THE PANE'S HORIZONTAL GUTTERS, and the round-2 design finding (D12) is why this
 * is 16 rather than the 24 it was: the allowance was being spent as a right-hand
 * gutter rather than as chrome, because the terminal painted from the pane's own
 * edge (`column 0 at x=1` while the header's title sits at x=9 and the strip's pill
 * at x=8) and the remaining 24 px showed as uniform ground to the right of the last
 * column. Measured, not inferred: 780 px of grid inside an 804 px pane.
 *
 * The decision is INSET rather than bleed - the terminal takes the same two 8 px
 * gutters the pane's header and its strip already use, so the pane has one gutter at
 * one width instead of a chrome bar at 8 px sitting over a grid at 0 - and the
 * allowance is therefore exactly those two gutters. `console-pane.tsx` carries the
 * matching `px-2` on the terminal's box; if either moves, this moves with it.
 */
const CONSOLE_PANE_CHROME_PX = 16;
const measureConsoleDefaultWidth = (): number =>
	Math.ceil(CONSOLE_GRID_COLUMNS * measureCell().cellWidth) +
	CONSOLE_PANE_CHROME_PX;
/**
 * The console pane's default width, exported.
 *
 * Exported because the slot's own render (`chat-content.tsx`) needs the NUMBER
 * rather than the write, exactly as the browser pane's 640 is spelled there: an
 * unset preference has to land on the same width the reset path stores, or a pane
 * that has never been dragged and one that has been double-clicked would differ.
 */
export const DEFAULT_CONSOLE_PANEL_WIDTH = measureConsoleDefaultWidth();

/**
 * One blip mark: which conversation's console finished something, on which
 * surface, and when.
 *
 * `at` is what separates the mark's two painted states (§12.2): a fresh mark
 * PULSES in the accent, because something is unread and the accent is earned, and
 * a mark that has had its pulse rests in `inkMuted` — the canvas button's own dot
 * colour, which is what "nothing more is happening right now" looks like in this
 * header. See `CONSOLE_BLIP_PULSE_MS`.
 *
 * The session is part of the mark rather than derived from the handle because the
 * header can only filter by session: a surface handle is globally unique
 * (`con:<n>:<nonce>`), so clearing by surface alone is unambiguous, while "does
 * THIS conversation's console have anything unread" is the header's question.
 */
export interface ConsoleUnseenMark {
	sessionId: string;
	surface: string;
	/** `Date.now()` at the completion. Persisted with the mark, so a relaunch
	 * restores a RESTING dot rather than a pulse for something that happened before
	 * the app started. */
	at: number;
}

/**
 * How long a completion pulses before its dot rests.
 *
 * Five seconds is two and a half cycles of the app's own `pulse-visible` step
 * (2 s), which is long enough to be seen by someone returning to the window and
 * short enough not to be a permanent animation - the point of the resting state is
 * that an unread mark must not animate for ever.
 */
export const CONSOLE_BLIP_PULSE_MS = 5_000;

/** Whether one surface is carrying an uncleared mark. */
export const isConsoleUnseen = (
	marks: readonly ConsoleUnseenMark[],
	surface: string,
): boolean => marks.some((mark) => mark.surface === surface);

/** Whether any of these marks is still fresh enough to pulse. */
export const consoleBlipPulsing = (
	marks: readonly ConsoleUnseenMark[],
	now: number = Date.now(),
): boolean => marks.some((mark) => now - mark.at < CONSOLE_BLIP_PULSE_MS);

/** Whether ONE conversation's console has anything unread, which is the header's
 * dot (§12.2's "a dot, not a count"). */
export const consoleUnseenForSession = (
	marks: readonly ConsoleUnseenMark[],
	sessionId: string | null,
): number =>
	sessionId === null
		? 0
		: marks.filter((mark) => mark.sessionId === sessionId).length;

/**
 * A shared empty array for the blip's initial state, so a store that has never
 * marked anything does not hand out a new `[]` on every read (which would make
 * every subscriber re-render on every unrelated commit).
 */
const EMPTY_CONSOLE_UNSEEN: ConsoleUnseenMark[] = [];

export const useUiPreferencesStore = create<UiPreferencesState>()(
	persist(
		(set) => ({
			isCommandPaletteOpen: false,
			commandPaletteQuery: "",
			isSidebarCollapsed: false,
			showAgentReasoning: false,
			themeName: DEFAULT_THEME,
			canvasWidth: DEFAULT_CANVAS_WIDTH,
			chatSidebarWidth: DEFAULT_CHAT_SIDEBAR_WIDTH,
			/*
			 * Both defaults are the SHIPPED panel: no stored height means the list
			 * region is drawn at its content's height under the same cap it always
			 * had, and "both" means neither region is hidden. An upgrading user's
			 * stored blob has no keys for these, and with `zustand ^5` a persisted
			 * blob that lacks a key rehydrates to the initial state's value for it
			 * — so there is nothing to migrate and nothing is written until the
			 * user drags or collapses something.
			 */
			chatSidebarRegions: DEFAULT_SIDEBAR_REGIONS,
			chatSidebarView: DEFAULT_SIDEBAR_VIEW,
			chatSidebarListHeight: null,
			chatSidebarOrder: "entities-first",
			isCanvasOpen: false,
			isRunPanelOpen: false,
			isBrowserPaneOpen: false,
			isConsolePaneOpen: false,
			consoleOpenIntent: null,
			runPanelReveal: null,
			runPanelWidth: DEFAULT_RUN_PANEL_WIDTH,
			browserPanelWidth: DEFAULT_BROWSER_PANEL_WIDTH,
			browserPaneScope: "conversation",
			consolePanelWidth: DEFAULT_CONSOLE_PANEL_WIDTH,
			consoleActiveSurface: null,
			consoleUnseen: EMPTY_CONSOLE_UNSEEN,
			isCreateAgentDialogOpen: false,
			mentionRecents: null,

			openCreateAgentDialog: () => {
				set({ isCreateAgentDialogOpen: true });
			},

			closeCreateAgentDialog: () => {
				set({ isCreateAgentDialogOpen: false });
			},

			openCommandPalette: () => {
				set({ isCommandPaletteOpen: true });
			},

			closeCommandPalette: () => {
				set({ isCommandPaletteOpen: false, commandPaletteQuery: "" });
			},

			toggleCommandPalette: () => {
				set((state) => ({
					isCommandPaletteOpen: !state.isCommandPaletteOpen,
					commandPaletteQuery: !state.isCommandPaletteOpen
						? ""
						: state.commandPaletteQuery, // Clear query if opening, retain if closing (though it's cleared by closeCommandPalette)
				}));
			},

			setCommandPaletteQuery: (query: string) => {
				set({ commandPaletteQuery: query });
			},

			toggleSidebar: () => {
				set((state) => ({
					isSidebarCollapsed: !state.isSidebarCollapsed,
				}));
			},

			setSidebarCollapsed: (collapsed: boolean) => {
				set({
					isSidebarCollapsed: collapsed,
				});
			},

			setShowAgentReasoning: (show: boolean) => {
				set({
					showAgentReasoning: show,
				});
			},

			setTheme: (themeName: ThemeName) => {
				set({
					themeName,
				});
			},

			setCanvasOpen: (open: boolean) => {
				set(open ? claimRightSlot("isCanvasOpen") : { isCanvasOpen: false });
			},

			setRunPanelOpen: (open: boolean) => {
				set(
					open ? claimRightSlot("isRunPanelOpen") : { isRunPanelOpen: false },
				);
			},

			setBrowserPaneOpen: (open: boolean) => {
				set(
					open
						? claimRightSlot("isBrowserPaneOpen")
						: { isBrowserPaneOpen: false },
				);
			},

			setConsolePaneOpen: (open: boolean) => {
				set(
					open
						? claimRightSlot("isConsolePaneOpen")
						: { isConsolePaneOpen: false },
				);
			},

			setConsolePanelWidth: (width: number) => {
				set({
					consolePanelWidth: width,
				});
			},

			restoreDefaultConsolePanelWidth: () => {
				set({
					consolePanelWidth: DEFAULT_CONSOLE_PANEL_WIDTH,
				});
			},

			setConsoleActiveSurface: (surface: string | null) => {
				set({
					consoleActiveSurface: surface,
				});
			},

			requestConsoleOpen: (sessionId: string) => {
				set({ consoleOpenIntent: sessionId });
			},

			clearConsoleOpenIntent: (sessionId: string) => {
				// Guarded so a pane with nothing to answer does not write a new state object
				// on every pass of its effect — and so a pane answering ITS conversation
				// cannot clear a request raised for another one in the meantime.
				set((state) =>
					state.consoleOpenIntent === sessionId
						? { consoleOpenIntent: null }
						: {},
				);
			},

			markConsoleUnseen: (sessionId: string, surface: string) => {
				set((state) =>
					state.consoleUnseen.some((mark) => mark.surface === surface)
						? {}
						: {
								consoleUnseen: [
									...state.consoleUnseen,
									{ sessionId, surface, at: Date.now() },
								],
							},
				);
			},

			clearConsoleUnseen: (surface: string | string[]) => {
				const clear = Array.isArray(surface) ? surface : [surface];
				set((state) => {
					const next = state.consoleUnseen.filter(
						(mark) => !clear.includes(mark.surface),
					);
					// The identity is kept when nothing was marked, so a pane that clears
					// on every focus change does not re-render the header for nothing.
					return next.length === state.consoleUnseen.length
						? {}
						: { consoleUnseen: next };
				});
			},

			setBrowserPanelWidth: (width: number) => {
				set({
					browserPanelWidth: width,
				});
			},

			restoreDefaultBrowserPanelWidth: () => {
				set({
					browserPanelWidth: DEFAULT_BROWSER_PANEL_WIDTH,
				});
			},

			setBrowserPaneScope: (scope: BrowserPaneScope) => {
				set({
					browserPaneScope: scope,
				});
			},

			revealRunPanelSection: (section: RunPanelSection) => {
				set((state) => ({
					// The claim is spread rather than restated: see `claimRightSlot`.
					...claimRightSlot("isRunPanelOpen"),
					runPanelReveal: {
						section,
						nonce: (state.runPanelReveal?.nonce ?? 0) + 1,
					},
				}));
			},

			clearRunPanelReveal: (nonce: number) => {
				set((state) =>
					state.runPanelReveal?.nonce === nonce ? { runPanelReveal: null } : {},
				);
			},

			setRunPanelWidth: (width: number) => {
				set({
					runPanelWidth: width,
				});
			},

			restoreDefaultRunPanelWidth: () => {
				set({
					runPanelWidth: DEFAULT_RUN_PANEL_WIDTH,
				});
			},

			setCanvasWidth: (width: number) => {
				set({
					canvasWidth: width,
				});
			},

			setChatSidebarWidth: (width: number) => {
				set({
					chatSidebarWidth: Math.min(
						SIDEBAR_MAX_WIDTH,
						Math.max(SIDEBAR_MIN_WIDTH, width),
					),
				});
			},

			setChatSidebarRegions: (regions: SidebarRegions) => {
				set({
					chatSidebarRegions: regions,
				});
			},

			setChatSidebarListHeight: (height: number) => {
				set({
					chatSidebarListHeight: height,
				});
			},

			restoreDefaultChatSidebarListHeight: () => {
				set({
					chatSidebarListHeight: null,
				});
			},

			setChatSidebarOrder: (order: SidebarOrder) => {
				set({
					chatSidebarOrder: order,
				});
			},

			setChatSidebarView: (view: SidebarView) => {
				set({
					chatSidebarView: view,
				});
			},

			restoreDefaultCanvasWidth: () => {
				set({
					canvasWidth: DEFAULT_CANVAS_WIDTH,
				});
			},

			restoreDefaultChatSidebarWidth: () => {
				set({
					chatSidebarWidth: DEFAULT_CHAT_SIDEBAR_WIDTH,
				});
			},

			rememberMention: (cwd, path) => {
				set((state) => {
					const current = state.mentionRecents;
					// A different workspace is a different list: carrying this one's paths
					// across would rank rows that do not exist relative to the new cwd.
					const paths = current?.cwd === cwd ? current.paths : [];
					const next = [path, ...paths.filter((entry) => entry !== path)].slice(
						0,
						MENTION_RECENTS_LIMIT,
					);
					return { mentionRecents: { cwd, paths: next } };
				});
			},
		}),
		{
			name: "ui-preferences-storage",
			/*
			 * `runPanelReveal` is deliberately NOT persisted, and this is the only
			 * field the filter touches — every other field keeps the default "persist
			 * it" behaviour this store has always had.
			 *
			 * Persisting it would outlive the event it describes: a request that was
			 * still pending when the app closed would be restored on the next launch
			 * and would open the run pane at a section on a session the user never
			 * asked about. That is the same defect `docs/run-sidebar.md` § 3.5 refuses
			 * for the reader's open child — "a mode of a pane is not a preference" —
			 * and a consumed-once request is more transient than a mode, not less.
			 *
			 * `consoleOpenIntent` is the second field, excluded for the same reason one
			 * pane over: it is a request, it is answered within a frame of being made,
			 * and a launch that restored it would run a shell in a conversation every
			 * time the app started — which is exactly the difference between the pane
			 * being restored and the user opening it.
			 */
			partialize: persistedUiPreferences,
		},
	),
);

/**
 * The part of the preferences that is written to disk: all of it, minus the two
 * requests that only mean something inside the run that made them.
 *
 * A NAMED FUNCTION RATHER THAN AN INLINE CLOSURE, and the reason is a test that went
 * red in CI rather than here: the pin over this filter used to reach the closure
 * through `useUiPreferencesStore.persist.getOptions()`, which is zustand's own API
 * and is not the same shape on every runtime (`Cannot read properties of undefined
 * (reading 'getOptions')` on CI's node against this one), so the filter is exported
 * and the test asserts the shipped function itself instead of a runtime handle on it.
 *
 * `runPanelReveal` is a request to open the run pane at a section; `consoleOpenIntent`
 * names the conversation a request to give a terminal and the keyboard was made for.
 * Both are consumed by the pane that answers them, so persisting either would outlive the event it describes
 * — a launch would restore a request nobody made and act on it, which for the console
 * means running a shell in a conversation every time the app started.
 */
export function persistedUiPreferences<
	T extends { runPanelReveal: unknown; consoleOpenIntent: unknown },
>(state: T): Omit<T, "runPanelReveal" | "consoleOpenIntent"> {
	const {
		runPanelReveal: _pending,
		consoleOpenIntent: _intent,
		...persisted
	} = state;
	return persisted;
}
