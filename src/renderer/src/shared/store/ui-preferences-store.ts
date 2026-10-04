/**
 * Store for managing UI preferences
 *
 * This store keeps track of user interface preferences such as sidebar collapse state,
 * theme selection, and provides methods to update these preferences.
 */

import { CHAT_MEASURE_OVERRIDE_VAR } from "@features/chat/chat-measure";
import { clampChatMeasureWidth } from "@features/chat/chat-measure-drag";
import {
	CANVAS_PANE_MIN_PX,
	CHAT_PANE_MIN_PX,
	SIDEBAR_DEFAULT_WIDTH,
	SIDEBAR_MAX_WIDTH,
	SIDEBAR_MIN_WIDTH,
	canvasDockWidth,
} from "@features/chat/chat-sidebar-layout";
import {
	DEFAULT_SIDEBAR_VIEW,
	type SidebarView,
} from "@features/chat/chat-sidebar-view";
import {
	DEFAULT_SIDEBAR_REGIONS,
	type SidebarOrder,
	type SidebarRegions,
} from "@features/chat/sidebar-split";
import {
	DEFAULT_TRANSCRIPT_DISPLAY_MODE,
	type TranscriptDisplayMode,
} from "@features/chat/transcript-display-mode";
import { DEFAULT_THEME } from "@shared/themes";
import type { ThemeName } from "@shared/themes";
import { measureCell } from "@shared/themes/terminal-theme";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Which menu a recents ring belongs to. The two rosters are separate lists of
 * separate things (an agent name is never a team name), so one ring would rank
 * rows the other menu cannot offer.
 */
export type ProfileRecencyKind = "agent" | "team";

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
	 * Toggles the command palette visibility.
	 *
	 * `initialQuery` seeds the query when this call OPENS the palette, which is
	 * how the Cmd/Ctrl+P door opens it as the conversation switcher (issue
	 * #659); every other door passes nothing and gets the empty box it always
	 * did. A call that CLOSES keeps the query as it is, and the close path is
	 * what clears it.
	 */
	toggleCommandPalette: (initialQuery?: string) => void;

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
	 * The width of the right slot in pixels, shared by every pane that can
	 * occupy it (#677): the browser, the console, the run panel and the canvas.
	 *
	 * ONE WIDTH, BECAUSE THE SLOT IS ONE PANEL. Each pane used to persist its
	 * own width, so switching surfaces snapped the panel to that surface's own
	 * stored number and back — every switch a resize event for the whole
	 * workspace, which is the reporter's observation. Drag once, it holds
	 * everywhere: the four panes are lenses on one physical column.
	 *
	 * 0 IS "UNSET", the same reading the four slots always had, and unset now
	 * means "open at this pane's own seed": the browser a page's 640, the run
	 * panel a roster's 420, the canvas its fresh-profile 800, the console its
	 * measured 100-column grid (see each `DEFAULT_*_WIDTH` below for why those
	 * four numbers are what they are). A pane the user has never dragged still
	 * opens at the number designed for it; the SHARED value only exists once
	 * someone drags, and from then on it is what every pane renders.
	 *
	 * THE FLOORS STAY PER PANE, at the divider that drags them: a page stops
	 * being a page below ~480 and the canvas below its 400, and those minimums
	 * are properties of what each pane holds, not of the slot.
	 */
	rightSlotWidth: number;

	/**
	 * Set the right slot's width, for whichever pane is on screen.
	 * @param width - The new width in pixels
	 */
	setRightSlotWidth: (width: number) => void;

	/**
	 * Forget the shared width: every pane goes back to opening at its own seed.
	 *
	 * The reset affordance is each divider's double-click, and with one shared
	 * value "this pane back to how it opens" can only mean unset — writing any
	 * pane's number here would hand that pane's default to its three siblings.
	 */
	restoreDefaultRightSlotWidth: () => void;

	/**
	 * Which list the browser pane's strip shows (spec 7.2).
	 *
	 * THE SLOT'S STATE, NOT THE PANE'S, and that placement is the fix rather than a
	 * preference (UX round 1, U3). The pane remounts when the conversation changes,
	 * so a `useState` inside it forgot the choice on every switch - while the pane
	 * itself stayed OPEN at the width the user had dragged, which is the same slot
	 * persisting and its lens not persisting. `isBrowserPaneOpen` and
	 * `rightSlotWidth` state the rule this joins: what belongs to the window's
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
	 * Whether the ASKS drawer is open (the FIFTH occupant of the right slot).
	 *
	 * IT IS THE ASK LANE'S ONE FLAG, and that is why it lives here rather than in
	 * `chat-page`: three readers have to agree about it or the surface contradicts
	 * itself - the composer chip that opens it (`composer-status-row.tsx`), the
	 * composer's routing rule ("while the answer surface is expanded the box
	 * answers the ask", `ask-nonblocking.md` §5.0), and the drawer itself. A second
	 * copy is exactly how the chip and the surface it opens end up disagreeing.
	 *
	 * ONE AT A TIME WITH ITS FOUR SIBLINGS, through `claimRightSlot`: opening the
	 * asks drawer closes the canvas, the run panel, the browser and the console, and
	 * opening any of them closes the drawer. That rule is the design note's own
	 * (`~/workspace/ask-panel-design-1004/ask-panel-design-note.md` §2C: "two right
	 * panes cannot both dock"), and the store's exclusion is what makes it a
	 * construction rather than a promise each call site has to keep.
	 *
	 * IT IS THE ONE SLOT FLAG DELIBERATELY NOT PERSISTED (see
	 * `persistedUiPreferences`). A drawer is a reading of the queue you have right
	 * now; the canvas is a document you keep open across launches, and this is not
	 * one - relaunching into a drawer nobody opened, over the asks of a session that
	 * has not loaded yet, is a surface the user has to dismiss.
	 *
	 * AND IT SURVIVES A CONVERSATION SWITCH, WITH THE COMPOSER'S ANSWER MODE RIDING IT
	 * (agent review round 1, M2). `SessionPanel` is keyed by the conversation, so the
	 * old in-component `useState` reset to closed on every switch; a store flag does
	 * not, and neither do the four siblings. So switching A -> B with the drawer open
	 * shows B's queue in a surface that was opened for A, and if B's head ask is
	 * answerable the composer comes up in answer mode for a question nobody opened.
	 *
	 * IT IS KEPT, deliberately, because the four siblings behave the same way (a
	 * canvas opened for one conversation stays open over the next) and a second rule
	 * for one pane is how the five drift apart. The mount-time swap stashes rather
	 * than loses B's chat draft, the chip and the drawer both show the mode on screen,
	 * and the ask buffer is per conversation - so the hazard is visible rather than
	 * silent. The design note's §4.4 sentence ("opening from inside a session can never
	 * present another session's questions") is about the ENTRY POINT rather than the
	 * flag: what the chip opens is always this conversation's queue.
	 *
	 * AND IT BORROWS THE SLOT RATHER THAN TAKING IT (UX round 1, U6). The exclusivity
	 * above means opening the drawer writes `isCanvasOpen: false` - and that flag IS
	 * persisted, so a peek at a queue used to survive as a preference the user never
	 * expressed: a relaunch restored a window with the canvas gone. The pane the
	 * drawer displaced is recorded in `askDrawerEvictedPane` and written back when the
	 * drawer closes, so the durable pane is never actually lost to a transient
	 * surface. An explicit choice made while the drawer is up (any of the four
	 * claiming the slot) forfeits the record: the user replaced the pane on purpose,
	 * and returning it later would be the surface resurrecting itself.
	 */
	isAskDrawerOpen: boolean;

	/**
	 * The DURABLE pane whose slot the asks drawer is currently borrowing, or `null`.
	 *
	 * A RECORD OF A BORROW, NOT A PREFERENCE, and it exists because the exclusivity
	 * rule and the persistence rule pull in opposite directions: the drawer must clear
	 * the other four flags to hold the slot (`claimRightSlot`), while those flags are
	 * exactly what a relaunch restores - so without this the drawer's clearance would
	 * be written to disk as the user's own choice to close the canvas.
	 *
	 * It is excluded from persistence itself (it only means something within the run
	 * that recorded it, like `runPanelReveal`), and `claimRightSlot` clears it whenever
	 * a durable pane claims the slot, so a deliberate choice always outranks a return.
	 */
	askDrawerEvictedPane: DurableRightSlotPane | null;

	/**
	 * Set the asks drawer open state.
	 *
	 * Opening it closes the other four occupants, by the same construction as
	 * theirs: one slot, one pane, and the exclusion lives in `claimRightSlot` so no
	 * call site has to remember it. Whatever pane it displaced is REMEMBERED rather
	 * than merely cleared, so closing the drawer puts it back (see
	 * `askDrawerEvictedPane`).
	 *
	 * @param open - Whether the asks drawer should be open
	 */
	setAskDrawerOpen: (open: boolean) => void;

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
	 * How the transcript draws a settled turn: `by-turn` (the shipped
	 * condensation, where a turn keeps the rows its visibility invariant
	 * requires) or `by-response` (every settled text-bearing row stays on
	 * screen, with the turn's elected answer still carrying the caption).
	 *
	 * Default `by-turn` per `transcript-display-mode.ts`, which owns the tokens
	 * and the judgement: this store keeps the value, and every reader parses it
	 * through `parseTranscriptDisplayMode` because `localStorage` is not the
	 * setter's path out — zustand rehydrates PAST the setters, so a token written
	 * by an older build arrives here unvalidated (the same read-side rule
	 * `chatSidebarView` follows with `parseSidebarView`).
	 */
	transcriptDisplayMode: TranscriptDisplayMode;

	/**
	 * Set how the transcript draws a settled turn.
	 *
	 * Takes the resolved union rather than a token, so an unknown mode cannot be
	 * written at all; the stored value is judged again on every read for the
	 * rehydration path above.
	 *
	 * @param mode - How settled turns should be drawn
	 */
	setTranscriptDisplayMode: (mode: TranscriptDisplayMode) => void;

	/**
	 * The currently selected theme
	 */
	themeName: ThemeName;

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
	 * The reader's own width for the conversation column, in px, or `null` for
	 * the shipped one.
	 *
	 * `null` is a first-class state rather than a missing value, exactly as
	 * `chatSidebarListHeight`'s `null` is: it means "the shipped measure", which
	 * is what every reader who has never dragged the handle sees, and it is what
	 * the reset restores. The width itself belongs to the stylesheet
	 * (`--lo-chat-measure-shipped` in `styles/index.css`) and this field is the
	 * OVERRIDE of it, so this file never needs to know the shipped number.
	 *
	 * Like the list height, a number here is never rewritten by a window resize:
	 * the RENDER clamps (the column cannot be wider than its pane), so a window
	 * too small to honour the reader's choice does not destroy it.
	 */
	chatMeasureWidth: number | null;

	/**
	 * Set the conversation column's width, clamped to the draggable range.
	 *
	 * The clamp is `clampChatMeasureWidth`'s rather than this store's, and it is
	 * applied HERE as well as at the drag: `localStorage` is not the setter's
	 * path out, so a value written by an older build or by hand reaches the
	 * document through this method, and the bounds have to hold on that path too.
	 */
	setChatMeasureWidth: (width: number) => void;

	/**
	 * Forget the reader's own width and go back to the shipped measure.
	 *
	 * Deliberately not "store the shipped width": storing a number would make
	 * the reader's column stop following the product's when the shipped value
	 * changes, which is the opposite of what a reset means.
	 */
	restoreDefaultChatMeasureWidth: () => void;

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
	 * The built-ins offer the reader dismissed, as the SIGNATURE of the offer
	 * they dismissed — `features/agents/builtin-offer.ts` derives the value from
	 * the names on offer and holds the read-side guard. `""` means nothing has
	 * been dismissed.
	 *
	 * A SIGNATURE RATHER THAN A BOOLEAN, because dismissing is a statement about
	 * the CURRENT state — the precedent `chat-status.ts` sets for the connection
	 * strip's dismissal ("keyed on the state the reader dismissed rather than on
	 * a boolean they set once"): a catalogue that gains a built-in is a new
	 * offer and comes back, while the same catalogue stays dismissed across
	 * restarts, which is exactly what this persists.
	 */
	dismissedBuiltinOfferSignature: string;

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
	 * Record the built-ins offer's signature as dismissed. Takes the resolved
	 * signature rather than the names, because the derivation is the module's
	 * (`builtinOfferSignature`) and the control that presses this holds it.
	 */
	dismissBuiltinOffer: (signature: string) => void;

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

	/**
	 * The chat header's identity-menu recents: the profiles this app has
	 * SWITCHED TO, most recent first, one ring per menu.
	 *
	 * WHY GLOBAL RATHER THAN PER CONVERSATION. A recents band exists to make a
	 * long roster cheap to reach, and the roster is the same in every
	 * conversation: what a session's own history would describe is the ONE
	 * profile it is bound to, which the menu already reports as the current row.
	 * So the ring is app-wide (`localStorage`, via this store's persistence) and
	 * a fresh install starts with both rings empty.
	 *
	 * NAMES, NOT ROWS. The row a name describes is read from the live catalogue
	 * every open, so a name that no longer resolves is dropped at render rather
	 * than resurrecting a profile the app can no longer switch to.
	 */
	profileRecents: Record<ProfileRecencyKind, string[]>;

	/**
	 * Record a profile the owner accepted. Bounded at `PROFILE_RECENTS_LIMIT`,
	 * dropping the oldest, and moved to the front when re-used so the ring is
	 * ordered by recent use rather than by first use — the same rule
	 * `rememberMention` states one list over.
	 */
	rememberProfile: (kind: ProfileRecencyKind, name: string) => void;
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
 * The five are the pane's five LIVE lists — the plan, the roster, the tool jobs,
 * the session's armed wake schedules and its armed monitors — and they are
 * named for their sections rather than for their controls: `jobs` is the section
 * that draws `bash` rows, which the roster deliberately does not hold
 * (`run-detail-model.ts`'s partition), `wakes` is the section that draws the
 * schedules, and `monitors` the section that draws the watches — neither of
 * the last two held anywhere else in the pane.
 */
export type RunPanelSection =
	| "todos"
	| "subagents"
	| "jobs"
	| "wakes"
	| "monitors";

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
 * The four DURABLE occupants of the right slot, named by the FLAG that owns each.
 *
 * The asks drawer is the slot's fifth pane and the only TRANSIENT one (see
 * `isAskDrawerOpen`): opening it takes the slot from one of these, and this union is
 * what lets that borrow be RECORDED and given back (UX round 1, U6). Naming the flag
 * rather than the pane (`RightSlotPane`'s names are the short ones) is deliberate:
 * giving the slot back is one write to one field, so the record and the write have to
 * agree on the field's own name.
 */
export type DurableRightSlotPane =
	| "isCanvasOpen"
	| "isRunPanelOpen"
	| "isBrowserPaneOpen"
	| "isConsolePaneOpen";

/**
 * The flag that owns each durable pane, keyed by the SHORT name the slot's own
 * resolver uses (`RightSlotPane`'s spelling, minus the transient `ask`).
 *
 * Two spellings of one pane exist because they answer two questions - "which pane is
 * up?" (the resolver) and "which field do I write?" (a claim or a restore) - and this
 * map is the single place they are held against each other. A restore that wrote the
 * short name would set a field nothing reads, which is how a borrowed slot would
 * come back as an empty one.
 */
const DURABLE_PANE_FLAG: Record<
	Exclude<RightSlotPane, "ask">,
	DurableRightSlotPane
> = {
	canvas: "isCanvasOpen",
	run: "isRunPanelOpen",
	browser: "isBrowserPaneOpen",
	console: "isConsolePaneOpen",
};

/**
 * Which pane holds the window's right slot, or null when the slot is empty.
 *
 * THE ONE DERIVATION, read by `resolveRightSlotWidth` and by the drawer's borrow
 * below from the same flags in the same order: `claimRightSlot` keeps at most one of
 * them true, and this is the reading that says which. A second copy of the order
 * would be a second answer to "which pane is up?", which is exactly what a reader
 * of the width and a reader of the borrow must not have.
 */
const activeRightSlotPane = (state: {
	isCanvasOpen: boolean;
	isRunPanelOpen: boolean;
	isBrowserPaneOpen: boolean;
	isConsolePaneOpen: boolean;
	isAskDrawerOpen: boolean;
}): RightSlotPane | null =>
	state.isCanvasOpen
		? "canvas"
		: state.isRunPanelOpen
			? "run"
			: state.isBrowserPaneOpen
				? "browser"
				: state.isConsolePaneOpen
					? "console"
					: state.isAskDrawerOpen
						? "ask"
						: null;

/**
 * The DURABLE flag the drawer is about to borrow the slot from, or null.
 *
 * `ask` is excluded: a second open of the drawer is not a borrow from itself, and
 * recording it would be a restore that no-ops. The null is the honest answer for an
 * empty slot - there is nothing to give back.
 */
const evictedFlag = (state: {
	isCanvasOpen: boolean;
	isRunPanelOpen: boolean;
	isBrowserPaneOpen: boolean;
	isConsolePaneOpen: boolean;
	isAskDrawerOpen: boolean;
}): DurableRightSlotPane | null => {
	const pane = activeRightSlotPane(state);
	return pane === null || pane === "ask" ? null : DURABLE_PANE_FLAG[pane];
};

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
		| "isConsolePaneOpen"
		| "isAskDrawerOpen",
): Pick<
	UiPreferencesState,
	| "isRunPanelOpen"
	| "isCanvasOpen"
	| "isBrowserPaneOpen"
	| "isConsolePaneOpen"
	| "isAskDrawerOpen"
	/*
	 * AND ANY RECORDED BORROW IS FORFEIT. A durable pane claiming the slot is the user
	 * choosing what they want there, so the pane the drawer had been covering is not
	 * owed back any more - restoring it later would reopen a surface the user replaced
	 * on purpose (UX round 1, U6).
	 */
	| "askDrawerEvictedPane"
> => ({
	isRunPanelOpen: pane === "isRunPanelOpen",
	isCanvasOpen: pane === "isCanvasOpen",
	isBrowserPaneOpen: pane === "isBrowserPaneOpen",
	isConsolePaneOpen: pane === "isConsolePaneOpen",
	isAskDrawerOpen: pane === "isAskDrawerOpen",
	askDrawerEvictedPane: null,
});

export type RightSlotPane = "canvas" | "run" | "browser" | "console" | "ask";

/**
 * The width the right slot gives the open pane, for the row it shares with the
 * conversation — ONE implementation, TWO callers, which are exactly the two that
 * can disagree about where the slot's leading edge is:
 *
 * - `chat-layout.tsx` paints the 32px chrome lane above the row, and its last
 *   stop has to land on the pane's leading edge;
 * - `chat-content.tsx` renders the panes, and this is what the canvas's own
 *   width is now decided by rather than by a formula beside it.
 *
 * WHY A SHARED NUMBER RATHER THAN TWO DERIVATIONS, in one sentence: the lane and
 * the pane disagreeing by even the transition's width is a horizontal band of the
 * wrong ground across the pane at y32, which is the operator's original top-edge
 * report with a different cause — so the two callers are made to read the same
 * measurement rather than to agree by convention.
 *
 * WHY IT IS A NUMBER AND NOT "WHICH PANE IS OPEN": the four panes are not
 * widths-scaled versions of one another — the canvas holds documents (default
 * 800, capped at 560 docked), the run panel prose and rosters (420), the browser
 * a page (640) and the console a measured 100-column grid — and any union of pane
 * ids would carry their four widths with it, i.e. a second place deciding which
 * width belongs to an open pane. The caller asks "how wide is the slot" and gets
 * the one answer that is true for the pane actually open.
 *
 * THE ARITHMETIC IS THE ROW'S OWN FLEX, restated once: the row is the work area
 * beside the sidebar, the conversation's floor is CHAT_PANE_MIN_PX of it, and the
 * pane takes what is left. That is why the canvas resolves through
 * `canvasDockWidth` — §I's `min(560, row - 480)`, which IS the same leftover
 * capped at the pane's dock maximum — and why the other three are
 * `min(preference, leftover)`. A preference of 0 is the store's "unset" and
 * resolves to that pane's own SEED first (four panes, four numbers, stated where
 * each `DEFAULT_*_WIDTH` is declared); since #677 a non-zero preference is the
 * ONE shared `rightSlotWidth`, so the four seeds are first-open values rather
 * than four competing memories of one panel. And since the #677 review (D2)
 * every branch holds the pane's own floor as well: a shared width below it
 * lifts to it here, where all three writers of the value are covered at once —
 * see the floor constants below.
 *
 * THE CANVAS'S `overlay` MODE IS THE CASE TO STATE EXPLICITLY, because it is the
 * one where the mode and the arithmetic are easiest to get out of step: when the
 * row cannot host the pane beside the conversation, chat-content stops drawing
 * the divider and the pane COVERS the conversation — but the width it covers it
 * at is still the leftover, because the conversation keeps its floor under the
 * pane exactly as it does beside it. So there is no branch here for the mode: at
 * every row where the pane overlays, `row - 480` is both the width the pane is
 * drawn at and the whole region right of the sidebar's stop, and at the rows
 * where a naive reading would disagree (a preference smaller than the overlay's
 * room), the pane draws at its preference and this function says so.
 *
 * UNMEASURED IS NOT ZERO. `rowWidth` is 0 for the frame before the row's first
 * measurement, and answering 0 there would tell the lane the slot has no pixels —
 * a full-width elevated band for one frame, then animated away — while the panes
 * draw at their preferences in that same frame (the rule `chat-content.tsx`
 * records for the canvas). The preference is the honest answer, and the measured
 * row corrects it in the same commit.
 *
 * Precedence is the reading order of the four and it only matters if the store's
 * own invariant ever breaks: `claimRightSlot` above makes the four flags mutually
 * exclusive by construction, so at most one of them is ever true.
 */
export function resolveRightSlotWidth(
	rowWidth: number,
	state: UiPreferencesState,
): number {
	const pane: RightSlotPane | null = activeRightSlotPane(state);
	if (pane === null) return 0;

	// THE SHARED WIDTH OR THIS PANE'S SEED, HELD UP TO THIS PANE'S FLOOR: one
	// read, four seeds + four floors, which is the whole of #677 at the
	// resolving end (see `rightSlotWidth` and the floor constants).
	let preferred: number;
	switch (pane) {
		/*
		 * THE ASKS DRAWER WEARS THE CANVAS'S GEOMETRY, deliberately and not by
		 * oversight (design note §2: the drawer "must be a member of the existing canvas
		 * family", 400-560px by the family's arithmetic). Reusing the seed, the floor and
		 * the dock cap is what makes the card "never again the widest thing on the
		 * screen": its width is the family's, so it needs no rule of its own - which is
		 * the mistake the note names ("do not patch the width separately").
		 */
		case "canvas":
		case "ask":
			preferred = Math.max(
				CANVAS_PANE_MIN_PX,
				state.rightSlotWidth || DEFAULT_CANVAS_WIDTH,
			);
			break;
		case "run":
			preferred = Math.max(
				RUN_PANEL_MIN_PX,
				state.rightSlotWidth || DEFAULT_RUN_PANEL_WIDTH,
			);
			break;
		case "browser":
			preferred = Math.max(
				BROWSER_PANEL_MIN_PX,
				state.rightSlotWidth || DEFAULT_BROWSER_PANEL_WIDTH,
			);
			break;
		case "console":
			preferred = Math.max(
				CONSOLE_PANEL_MIN_PX,
				state.rightSlotWidth || DEFAULT_CONSOLE_PANEL_WIDTH,
			);
			break;
	}
	if (rowWidth <= 0) return preferred;

	if (pane === "canvas" || pane === "ask") {
		return Math.min(preferred, canvasDockWidth(rowWidth));
	}
	return Math.min(preferred, Math.max(0, rowWidth - CHAT_PANE_MIN_PX));
}

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
/**
 * The width a fresh profile gives the canvas: since #677 it is also the SEED
 * an unset `rightSlotWidth` opens the canvas at (the old 450 zero-read is
 * retired with the four per-surface slots — see the note where it lived).
 * Exported because the shell story that mounts the dock reads the app's own
 * default rather than restating it.
 */
export const DEFAULT_CANVAS_WIDTH = 800;
/*
 * THE CANVAS'S 450 ZERO-READ IS RETIRED WITH THE FOUR SLOTS (#677). An unset
 * preference used to read as 450 for the canvas alone — a number nothing
 * persisted, since the canvas divider's own floor keeps every drag above it —
 * while a fresh profile opened at `DEFAULT_CANVAS_WIDTH`. One unset meaning
 * one thing (open at the pane's seed) makes 450 unreachable: an unset canvas
 * opens at its fresh-profile 800, and every other pane's unset opens at its
 * own default.
 */
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

/**
 * How many profiles one identity menu remembers.
 *
 * Four, and the number is a bound on the BAND rather than on the list: the band is
 * a shortcut above a roster that is still complete underneath it. It is also what
 * fits: four of the app's two-line rows plus a band heading (4 x 48 + 28 = 220px,
 * against the ~247px of rows the panel's ceiling leaves - see
 * `IDENTITY_MENU_MAX_HEIGHT`), so opening the menu shows the recent band AND the
 * heading of the full roster below it. A longer ring would scroll the "all" band
 * out of sight on open, which is a band hiding a list rather than a shortcut to
 * one.
 */
export const PROFILE_RECENTS_LIMIT = 4;
/** The browser pane's default, and the design's number rather than a fit: see
 * `DEFAULT_BROWSER_PANEL_WIDTH`'s own note for why a page wants 640 where a
 * roster wants 420. */
export const DEFAULT_BROWSER_PANEL_WIDTH = 640;
/**
 * Exported for the same reason `DEFAULT_RUN_PANEL_WIDTH` is: the shell's own
 * fallback for an unset preference reads this number instead of restating it
 * (`chat-content.tsx`), and `resolveRightSlotWidth` above is the third reader.
 */

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
 * is kept (it is the shared `rightSlotWidth` now, #677); forgetting it — the
 * divider's double-click — puts the pane back on this seed, which is recomputed
 * from the face that is shipping now.
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
 * The floor each pane's own control stops a drag at — and, since the #677
 * round-1 review (D2), the floor the RESOLVER holds the shared width to.
 *
 * ONE COLUMN, FOUR MINIMUMS, and they are properties of what each pane holds
 * rather than of the slot: a page stops being a page under ~480 (the browser
 * default's own note above), a document under 400 (`CANVAS_PANE_MIN_PX`,
 * `chat-sidebar-layout.ts`), a terminal grid under its measured 480, and the
 * run pane's roster is the one that fits at 320. A shared width BELOW a pane's
 * floor lifts to that floor THERE — the one-width rule holds exactly over
 * [480, ∞), where every pane can honour it, and below that each pane draws its
 * own floor, which is the width its own separator announces (`aria-valuemin`).
 *
 * WHY THE RESOLVER AND NOT THE WRITE: `rightSlotWidth` arrives from three
 * directions — a drag on this pane's divider, a drag on ANOTHER pane's, and
 * the persisted blob of an older build — and only the first is inside any
 * writer's reach; clamping where the width is READ makes all three hold, and
 * `chat-content.tsx`'s per-pane `effective*` computations (the values the
 * dividers and `PaneSlot`s are handed) clamp on the same constants, so a
 * separator's range and its pane's drawn width cannot disagree.
 */
export const RUN_PANEL_MIN_PX = 320;
export const BROWSER_PANEL_MIN_PX = 480;
export const CONSOLE_PANEL_MIN_PX = 480;

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

/**
 * Publish the reader's own column width to the document, or clear it.
 *
 * `null` REMOVES the property rather than writing the shipped number: the
 * stylesheet's chain already falls back to `--lo-chat-measure-shipped`, and
 * writing a number here would be a second copy of it in JavaScript, which is the
 * drift the one-home rule for this value exists to prevent.
 *
 * `document` is guarded so this module can be bundled where there is no DOM
 * (`scripts/*.test.mjs` bundles shipped TypeScript in memory). In that case
 * there is nothing to publish to and the store is still a correct store.
 */
const applyChatMeasureOverride = (width: number | null): void => {
	if (typeof document === "undefined") return;
	const root = document.documentElement;
	if (width === null) {
		root.style.removeProperty(CHAT_MEASURE_OVERRIDE_VAR);
		return;
	}
	root.style.setProperty(CHAT_MEASURE_OVERRIDE_VAR, `${width}px`);
};

export const useUiPreferencesStore = create<UiPreferencesState>()(
	persist(
		(set) => ({
			isCommandPaletteOpen: false,
			commandPaletteQuery: "",
			isSidebarCollapsed: false,
			showAgentReasoning: false,
			transcriptDisplayMode: DEFAULT_TRANSCRIPT_DISPLAY_MODE,
			themeName: DEFAULT_THEME,
			rightSlotWidth: 0,
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
			chatMeasureWidth: null,
			chatSidebarOrder: "entities-first",
			dismissedBuiltinOfferSignature: "",
			isCanvasOpen: false,
			isRunPanelOpen: false,
			isBrowserPaneOpen: false,
			isConsolePaneOpen: false,
			isAskDrawerOpen: false,
			askDrawerEvictedPane: null,
			consoleOpenIntent: null,
			runPanelReveal: null,
			browserPaneScope: "conversation",
			consoleActiveSurface: null,
			consoleUnseen: EMPTY_CONSOLE_UNSEEN,
			isCreateAgentDialogOpen: false,
			mentionRecents: null,
			/* Empty on a fresh install, and the menu renders NO recents band (and no
			 * heading) in that state rather than an empty one - see the menu model. */
			profileRecents: { agent: [], team: [] },

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

			toggleCommandPalette: (initialQuery = "") => {
				set((state) => ({
					isCommandPaletteOpen: !state.isCommandPaletteOpen,
					commandPaletteQuery: !state.isCommandPaletteOpen
						? initialQuery
						: state.commandPaletteQuery, // Retain when closing (though it's cleared by closeCommandPalette)
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

			setTranscriptDisplayMode: (mode: TranscriptDisplayMode) => {
				set({
					transcriptDisplayMode: mode,
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

			setAskDrawerOpen: (open: boolean) => {
				set((state) =>
					open
						? {
								...claimRightSlot("isAskDrawerOpen"),
								/*
								 * WHAT IT DISPLACED, not just that it won: the pane that held the slot a
								 * moment ago is the one a close owes back, and only this call site knows it
								 * (the claim itself sees only its own name).
								 */
								askDrawerEvictedPane: evictedFlag(state),
							}
						: {
								isAskDrawerOpen: false,
								...(state.askDrawerEvictedPane === null
									? null
									: { [state.askDrawerEvictedPane]: true }),
								askDrawerEvictedPane: null,
							},
				);
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

			setRightSlotWidth: (width: number) => {
				set({
					rightSlotWidth: width,
				});
			},

			restoreDefaultRightSlotWidth: () => {
				set({
					rightSlotWidth: 0,
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

			setChatMeasureWidth: (width: number) => {
				const clamped = clampChatMeasureWidth(width);
				applyChatMeasureOverride(clamped);
				set({
					chatMeasureWidth: clamped,
				});
			},

			restoreDefaultChatMeasureWidth: () => {
				applyChatMeasureOverride(null);
				set({
					chatMeasureWidth: null,
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

			dismissBuiltinOffer: (signature: string) => {
				set({
					dismissedBuiltinOfferSignature: signature,
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

			rememberProfile: (kind, name) => {
				set((state) => ({
					profileRecents: {
						...state.profileRecents,
						[kind]: pushProfileRecent(state.profileRecents[kind] ?? [], name),
					},
				}));
			},
		}),
		{
			name: "ui-preferences-storage",
			/*
			 * v1 IS THE ONE-SLOT WIDTH (#677): a v0 blob carries the four
			 * per-surface widths, v1 carries `rightSlotWidth`, and
			 * `migrateUiPreferences` below seeds the shared value from whichever
			 * legacy width the user had actually dragged. Version 0 is also every
			 * existing blob's version, so the migration runs exactly once per
			 * profile — and a blob that never carried any of the four keys seeds
			 * to 0, which is "every pane opens at its own seed".
			 */
			version: 1,
			migrate: migrateUiPreferences,
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
			/*
			 * PUBLISH THE STORED WIDTH BEFORE THE FIRST PAINT.
			 *
			 * `localStorage` is synchronous, so zustand runs this during store
			 * creation - which is module evaluation, before React renders anything.
			 * A component effect instead would paint one frame at the shipped
			 * width and then jump to the reader's, and the whole point of
			 * remembering the width is that the column comes back where the reader
			 * left it. `theme-provider.tsx` makes the same argument for
			 * `useLayoutEffect` over `useEffect`; this is one step earlier still,
			 * because there is no component to hook.
			 */
			onRehydrateStorage: () => (state) => {
				applyChatMeasureOverride(state?.chatMeasureWidth ?? null);
			},
		},
	),
);

/**
 * One profile's move to the front of a recents ring: most recent first, no
 * duplicates, bounded at `PROFILE_RECENTS_LIMIT`.
 *
 * A NAMED FUNCTION RATHER THAN AN INLINE EXPRESSION IN THE ACTION, for the reason
 * `persistedUiPreferences` below is one: the rule is what the band's order means
 * ("the profile you switched to a moment ago is the first row"), and a rule that
 * lives inside a `set()` callback can only be exercised by mounting the store. As
 * a value it is pinned by `scripts/header-identity-menu.test.mjs` - including the
 * two cases an inline version gets wrong quietly: a name re-used moves rather
 * than duplicates, and the ring DROPS the oldest rather than growing.
 */
export function pushProfileRecent(
	ring: readonly string[],
	name: string,
): string[] {
	return [name, ...ring.filter((entry) => entry !== name)].slice(
		0,
		PROFILE_RECENTS_LIMIT,
	);
}

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
	T extends {
		runPanelReveal: unknown;
		consoleOpenIntent: unknown;
		isAskDrawerOpen: unknown;
		askDrawerEvictedPane: unknown;
	},
>(
	state: T,
): Omit<
	T,
	| "runPanelReveal"
	| "consoleOpenIntent"
	| "isAskDrawerOpen"
	| "askDrawerEvictedPane"
> {
	const {
		runPanelReveal: _pending,
		consoleOpenIntent: _intent,
		/*
		 * THE ASKS DRAWER IS THE ONE SLOT FLAG NOT PERSISTED, and it is excluded here
		 * rather than in the flag's own note because this is where the decision is
		 * executed (see `isAskDrawerOpen` for the argument): a relaunch must not reopen
		 * a surface nobody opened this launch. The other four stay persisted because
		 * they hold documents and viewers the user was reading; the drawer holds a
		 * queue, which the session republishes on its own.
		 */
		isAskDrawerOpen: drawerOpen,
		askDrawerEvictedPane: evicted,
		...persisted
	} = state;
	/*
	 * AND THE PANE IT WAS BORROWING FROM COMES BACK (UX round 1, U6). The drawer's
	 * claim wrote `isCanvasOpen: false` (or the run/browser/console equivalent) to hold
	 * the slot, and that flag is persisted - so quitting while the drawer happened to
	 * be open would restore a window missing a document the user had open. The live
	 * flags are the truth when the drawer is closed; while it is open, the record says
	 * what the flags were before the borrow, and that is what goes to disk.
	 *
	 * The record itself is dropped (`askDrawerEvictedPane` is not persisted): it means
	 * something only within the run that made it, exactly as `runPanelReveal`'s
	 * request does.
	 */
	if (drawerOpen !== true || typeof evicted !== "string") return persisted;
	return { ...persisted, [evicted]: true } as typeof persisted;
}

/**
 * v0's four per-surface widths, folded into v1's one `rightSlotWidth` (#677).
 *
 * WHICH LEGACY WIDTH WINS, and why it is a rule rather than a judgement: the
 * four are read in the slot's own precedence order (canvas, run, browser,
 * console — the order `resolveRightSlotWidth` reads), and the FIRST value that
 * is neither absent nor its own default becomes the shared width. The others
 * are dropped. A profile where the user never dragged anything has all four at
 * their defaults, seeds 0, and therefore keeps opening each pane at its own
 * seed — the migration reproduces the fresh-profile experience rather than
 * freezing some default onto every pane.
 *
 * TWO HONEST CAVEATS, stated rather than discovered later:
 *
 * - A width dragged to exactly its default is indistinguishable from an
 *   untouched one and does not seed. Nothing is lost: the default IS the value
 *   that pane would open at.
 * - The console's default is measured from the shipping face, so a face or
 *   font step that changed since a value was stored reads as "dragged". A
 *   profile that never touched the console can therefore seed with a number
 *   that used to BE the console's default — a number that user was actually
 *   seeing, and a double-click away from being forgotten.
 */
export function migrateUiPreferences(
	persisted: unknown,
	version: number,
): Record<string, unknown> {
	const blob: Record<string, unknown> = {
		...((persisted ?? {}) as Record<string, unknown>),
	};
	if (version >= 1) return blob;
	const seeds: Array<[string, number]> = [
		["canvasWidth", DEFAULT_CANVAS_WIDTH],
		["runPanelWidth", DEFAULT_RUN_PANEL_WIDTH],
		["browserPanelWidth", DEFAULT_BROWSER_PANEL_WIDTH],
		["consolePanelWidth", DEFAULT_CONSOLE_PANEL_WIDTH],
	];
	let shared = 0;
	for (const [key, seed] of seeds) {
		const value = blob[key];
		if (typeof value === "number" && value > 0 && value !== seed) {
			shared = value;
			break;
		}
	}
	for (const [key] of seeds) delete blob[key];
	blob.rightSlotWidth = shared;
	return blob;
}
