/**
 * Store for managing UI preferences
 *
 * This store keeps track of user interface preferences such as sidebar collapse state,
 * theme selection, and provides methods to update these preferences.
 */

import type { AskScope } from "@features/chat/ask-queue";
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
import {
	MEMORY_PANES,
	type MemoryPane,
	type RightSlotMemory,
	isDraftMemoryKey,
	isMemoryPane,
	memoryCarry,
	memoryPaneFlag,
	memoryProject,
	memoryPut,
	memoryRead,
	memoryRemove,
	memorySanitize,
} from "./right-slot-memory";

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
	 * Whether the canvas is open FOR THE ACTIVE CONVERSATION (issue #894).
	 *
	 * The flag is the live PROJECTION of one conversation's memory
	 * (`rightSlotMemory`, read through `memoryProject`), not a global preference:
	 * each conversation remembers its own occupant, `bindRightSlotKey` writes these
	 * four flags from the memory when the active conversation moves, and a read here
	 * is therefore "what this conversation had open" — which is what arrives on the
	 * same frame as the transcript it belongs to. A conversation with no memory
	 * projects to all four false, so a switch shows no panel rather than the
	 * previous conversation's. UNBOUND (`rightSlotKey === undefined`) the flag
	 * behaves exactly as the global boolean it always was — see `rightSlotKey`.
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
	 * Whether the run panel is open FOR THE ACTIVE CONVERSATION.
	 *
	 * Per conversation for the same reason `isCanvasOpen` is (issue #894): the pane
	 * holds one conversation's roster, prose and jobs, so returning to a
	 * conversation restores it and a conversation that never opened it shows none.
	 * What was ALREADY per conversation is the reader's open child, which belongs to
	 * one session's lineage and is therefore the panel component's own state.
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
	 * Whether the conversation's browser pane is open (per conversation).
	 *
	 * The third occupant of the window's right slot, added by the
	 * conversation-scoped browser (`docs/design/browser-approval-ux.md` 7.3).
	 * Per conversation since issue #894, and that is a CORRECTION of the rule this
	 * comment used to state: the pane's TABS were the conversation's while the pane
	 * being open was the window's, so a session with no browser of its own was
	 * handed one it had never opened. A session with no entry now opens with no
	 * panel — the browser included, since opening one is a rail press or a header
	 * trigger.
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
	 * THE CONVERSATION THE SLOT IS BOUND TO (issue #894), and the tri-state that
	 * decides whether the memory applies at all.
	 *
	 * - `undefined` — UNBOUND. Nothing binds the slot, so every setter behaves
	 *   exactly as the global boolean it always was: stories, the desktop rigs that
	 *   drive the store directly, and the mini window (which mounts the composer but
	 *   not the chat surface) are the states that ship this way. `rightSlotMemory`
	 *   is inert and no conversation is remembered.
	 * - `null` — BOUND, NO CONVERSATION. The chat surface is up on a route with
	 *   neither a session nor a draft, so nothing is projected and nothing is
	 *   written: the slot is empty and stays empty rather than holding some other
	 *   conversation's pane.
	 * - a string — the conversation identity the memory is read and written under,
	 *   which is the identity the chat surface keys these panes on
	 *   (`panelIdentityOfView`).
	 *
	 * NOT PERSISTED: the bind is a launch's own act, redone by the follower before
	 * the first render, and a persisted key would name a conversation from the
	 * previous process.
	 */
	rightSlotKey: string | null | undefined;

	/**
	 * WHAT EACH CONVERSATION REMEMBERS — newest last, at most one entry per
	 * conversation (`right-slot-memory.ts` states the shape and its rules).
	 *
	 * The four durable flags above are its PROJECTION for the bound conversation: a
	 * claim writes the entry and the flag in one `set()`, a close deletes the entry
	 * it owns, and `bindRightSlotKey` writes all four flags from the memory when the
	 * active conversation moves. PERSISTED (minus the `draft:` entries, which are a
	 * launch's own rows), so returning to a conversation after a relaunch restores
	 * its panel without a frame of the wrong one.
	 */
	rightSlotMemory: RightSlotMemory;

	/**
	 * THE ONE-SHOT HANDOVER from the four GLOBAL flags this store used to persist
	 * (issue #894's migration).
	 *
	 * A profile upgrading from a blob that carried (say) `isCanvasOpen: true` was
	 * looking at a canvas, and the memory that replaces it has no conversation to
	 * attach to yet - the active one is only known once the conversations store has
	 * hydrated. So the migration lifts the flag into this field and the FIRST bind
	 * plants it: on a session id with no entry, because a session outlives the
	 * launch; never on a `draft:` key, because a fresh draft is a new conversation
	 * whose own panel state is "none"; and HELD across a bind to `null`, which is a
	 * route with no conversation rather than a decision about one. Consumed once,
	 * then null for the rest of the profile's life.
	 */
	rightSlotLegacySeed: MemoryPane | null;

	/**
	 * Bind the slot to a conversation, and project that conversation's memory onto
	 * the four flags. Called by `right-slot-follower.ts` alone, and by the suites.
	 *
	 * ONE `set()`, always: the slot's readers are the rail, the header, the lane and
	 * the slot's own width resolver, and a bind that moved the flags in two steps
	 * would paint one of them a frame of the wrong pane on every conversation
	 * switch.
	 *
	 * @param key - The conversation identity, or `null` for a bound route with no
	 *   conversation
	 * @param options.admittedFrom - The draft key this bind is an ADMISSION of, so
	 *   the draft's entry moves to the session id in the same step as the identity
	 *   flip (see `right-slot-follower.ts`)
	 */
	bindRightSlotKey: (
		key: string | null,
		options?: { admittedFrom?: string },
	) => void;

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
	 * WHAT THE CURRENT ROUTE CAN DRAW INTO THE SLOT - the half of the slot's truth
	 * the flags cannot answer alone (#868).
	 *
	 * THE FLAGS ARE PREFERENCES; AN OCCUPIED SLOT IS SOMETHING ON SCREEN. The four
	 * durable flags survive a relaunch as the bound conversation's memory (see
	 * `rightSlotMemory`), and the asks flag is a launch's own event (see
	 * `isAskDrawerOpen`), so a true flag is not a promise
	 * that a pane is mounted: the run panel only mounts with `runDetails` (a draft
	 * has none), the session-scoped asks drawer only mounts with a conversation to
	 * show, and a route that mounts no chat surface at all (settings, agents)
	 * draws none of the five. The slot's readers used to trust the bare flag and
	 * so answered a width and a reservation for panes nothing could mount - the
	 * empty band and the reserved column #868 reports.
	 *
	 * ONE PUBLISHER, and it is the component that OWNS the mount gates
	 * (`chat-content`, which mounts every one of the five): it publishes these
	 * facts from the same values its own render conditions read, so the derivation
	 * and the mounts cannot disagree about what the route can draw. A second
	 * publisher would be a second answer to that question.
	 *
	 * NOT PERSISTED, deliberately (see `persistedUiPreferences`): a route fact
	 * describes the route the app is on NOW, and a relaunch that restored one would
	 * answer for a route it is not on until the next publish.
	 */
	rightSlotRoute: RightSlotRouteFacts;

	/**
	 * Publish what the current route can draw into the slot.
	 *
	 * Called by the one component that mounts the slot's panes; see
	 * `rightSlotRoute` for the whole argument. The write is a no-op when nothing
	 * moved, so a caller re-rendering for its own reasons does not wake the slot's
	 * readers.
	 * @param route - The route's facts
	 */
	setRightSlotRoute: (route: RightSlotRouteFacts) => void;

	/**
	 * Which list the browser pane's strip shows (spec 7.2).
	 *
	 * THE SLOT'S STATE, NOT THE PANE'S, and that placement is the fix rather than a
	 * preference (UX round 1, U3). The pane remounts when the conversation changes,
	 * so a `useState` inside it forgot the choice on every switch - while the pane
	 * itself stayed OPEN at the width the user had dragged, which is the same slot
	 * persisting and its lens not persisting. `isBrowserPaneOpen` and
	 * `rightSlotWidth` is the rule this joins: the shared width is the window's and
	 * survives a conversation switch, while the pane's OCCUPANT — and, within a
	 * conversation, the tabs and the session a `"conversation"` choice resolves to
	 * — is the conversation's (issue #894 moved the occupant to the conversation;
	 * the width deliberately did not move, #677).
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
	 * Per conversation, for the reason `isBrowserPaneOpen` states: a console's
	 * surfaces belong to exactly one session (design 6.3), so remembering the pane
	 * per conversation is the same rule its content already followed — and it is
	 * one-at-a-time with its three siblings through `claimRightSlot`.
	 */
	isConsolePaneOpen: boolean;

	/**
	 * Whether the ASKS drawer is open (the FIFTH occupant of the right slot).
	 *
	 * IT IS THE ASK LANE'S ONE FLAG, and that is why it lives here rather than in
	 * `chat-page`: the readers have to agree about it or the surface contradicts
	 * itself - the status-row chip that opens it (`composer-status-row.tsx`), the
	 * header door, the Escape claim and the drawer itself. A second copy is exactly
	 * how the chip and the surface it opens end up disagreeing. It does NOT put the
	 * composer into any mode: the routing that once did (`ask-nonblocking.md` §5.0,
	 * R7) was retired on 2026-10-07.
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
	 * AND IT SURVIVES A CONVERSATION SWITCH (agent review round 1, M2).
	 * `SessionPanel` is keyed by the conversation, so the old in-component `useState`
	 * reset to closed on every switch; a store flag does not. So switching A -> B with
	 * the drawer open shows B's queue in a surface that was opened for A. (That used
	 * to ALSO put B's composer into answer mode for a question nobody opened, which
	 * was the sharp edge of keeping it; with the routing retired the composer is
	 * unaffected and what remains is a drawer the user can see and close.)
	 *
	 * IT IS KEPT, deliberately, and since issue #894 the drawer is the ONLY one of the
	 * five that follows the user across conversations: the four durable panes are
	 * per-conversation memory now, while a DRAWER is a reading of the queue you have
	 * right now rather than a document you keep open (the same distinction that keeps
	 * this flag out of persistence). The design note's §4.4 sentence ("opening from
	 * inside a session can never present another session's questions") is about the
	 * ENTRY POINT rather than the flag: what the chip opens is always this
	 * conversation's queue.
	 *
	 * AND IT BORROWS THE SLOT RATHER THAN TAKING IT (UX round 1, U6). The exclusivity
	 * above means opening the drawer writes `isCanvasOpen: false`, so the pane it
	 * displaced has to be GIVEN BACK rather than lost to a transient surface. HOW it
	 * is given back is the one thing issue #894 split in two:
	 *
	 * - BOUND (`rightSlotKey` is a string) the memory already holds the displaced
	 *   pane, so no record is written and a close restores `memoryProject` - which
	 *   also fixes the case the per-run record could not: a fleet drawer opened over
	 *   A's canvas and closed over B used to put A's canvas onto B, because the drawer
	 *   is the one occupant that travels;
	 * - UNBOUND (stories, the desktop rigs, the mini window) `askDrawerEvictedPane`
	 *   is written and read back exactly as it was, because there is no memory to hold
	 *   the answer and a behaviour change there would touch surfaces this feature does
	 *   not.
	 *
	 * In both modes an explicit choice made while the drawer is up (any of the four
	 * claiming the slot) forfeits the borrow: the user replaced the pane on purpose,
	 * and returning it later would be the surface resurrecting itself.
	 */
	isAskDrawerOpen: boolean;

	/**
	 * WHICH QUEUE THE OPEN DRAWER IS SHOWING — `session` or `fleet`.
	 *
	 * THE SCOPE IS CARRIED BY THE ENTRY POINT AND NOT CHOSEN BY THE SURFACE (design
	 * note §4.4): the composer's status-row item opens `session` and a top-level
	 * affordance opens `fleet`, and the drawer never picks for itself. It lives here,
	 * beside the flag it qualifies, for the same reason that flag does — the two are
	 * ONE fact ("the drawer is open, on this queue") and a second copy would let the
	 * entry point and the surface it opened disagree about which queue is on screen.
	 *
	 * IT IS NOT A SETTING, deliberately. A switcher inside the drawer would make the
	 * scope a mode the user can be in without having asked for it, which is exactly
	 * the "a global badge above a session-scoped view" confusion this feature exists
	 * to remove: from inside a conversation the surface can only be that
	 * conversation's queue.
	 *
	 * IT IS EXCLUDED FROM PERSISTENCE with `isAskDrawerOpen`, for the same reason:
	 * the scope means nothing while no drawer is open.
	 */
	askDrawerScope: AskScope;

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
	 * Set the asks drawer open state, and WHICH QUEUE it is showing.
	 *
	 * Opening it closes the other four occupants, by the same construction as
	 * theirs: one slot, one pane, and the exclusion lives in `claimRightSlot` so no
	 * call site has to remember it. Whatever pane it displaced is REMEMBERED rather
	 * than merely cleared, so closing the drawer puts it back (see
	 * `askDrawerEvictedPane`).
	 *
	 * THE SCOPE IS A REQUIRED ARGUMENT, not defaulted, because it is the entry
	 * point's whole contribution: a caller that does not know which queue it is
	 * opening has no business opening this surface, and a default would silently
	 * pick the wrong queue for one of the two doors.
	 *
	 * @param open - Whether the asks drawer should be open
	 * @param scope - Which queue the drawer shows
	 */
	setAskDrawerOpen: (open: boolean, scope: AskScope) => void;

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
 * Whether the current route can actually DRAW the pane that holds the slot.
 *
 * The claims above say which pane WANTS the slot; this is the half a claim cannot
 * answer - see `rightSlotRoute`. It is a separate function rather than folded
 * into `activeRightSlotPane` because the drawer's borrow (`evictedFlag` below)
 * records the CLAIM the drawer displaced: a claim survives routes, and a record
 * that disappeared with the route would lose the flag the drawer must give back.
 */
const rightSlotPaneDrawable = (
	pane: RightSlotPane,
	state: {
		askDrawerScope: AskScope;
		rightSlotRoute: RightSlotRouteFacts;
	},
): boolean => {
	if (pane === "ask") {
		/*
		 * THE TWO ASKS HOMES, one fact each: the fleet drawer's home is the shell
		 * (`chat-layout`), mounted on every route, so it always draws; the session
		 * drawer's home is the conversation's own mount, which a draft and a
		 * non-chat route do not have.
		 */
		return (
			state.askDrawerScope === "fleet" ||
			(state.rightSlotRoute.mounted && state.rightSlotRoute.session)
		);
	}
	if (!state.rightSlotRoute.mounted) return false;
	/*
	 * The run panel's mount gate is `runDetails`; the canvas, browser and console
	 * mount whenever their flags are set on a chat route, so `mounted` is the
	 * whole of their condition.
	 */
	return pane !== "run" || state.rightSlotRoute.runDetails;
};

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

/**
 * THE MEMORY SIDE OF A CLAIM, in bound mode.
 *
 * `claimRightSlot` answers "which flag wins"; this answers the other half of the
 * same act — "and what does the bound conversation remember now?". They are
 * written together in one `set()` at every durable call site. Both are no-ops in
 * unbound mode, which is what keeps stories, the desktop rigs and the mini window
 * on the global-flag behaviour byte for byte.
 */
const claimedMemory = (
	state: Pick<UiPreferencesState, "rightSlotKey" | "rightSlotMemory">,
	pane: MemoryPane,
): Partial<Pick<UiPreferencesState, "rightSlotMemory">> => {
	const key = state.rightSlotKey;
	if (typeof key !== "string") return {};
	return { rightSlotMemory: memoryPut(state.rightSlotMemory, key, pane) };
};

/**
 * THE MEMORY SIDE OF A CLOSE: the entry goes ONLY when it is this pane's.
 *
 * The guard is the rule rather than a tidy-up. A close is reached by the pane's
 * own control AND by effects that run on a mount, a route change or a remount, so
 * a conversation switch can deliver a close for the conversation the user has
 * LEFT — and deleting unconditionally would then delete the entry the
 * destination's own bind is entitled to restore, which is the #894 defect in
 * reverse. "This conversation has X open" is the only thing a close may retract,
 * so it is the only thing checked.
 */
const releasedMemory = (
	state: Pick<UiPreferencesState, "rightSlotKey" | "rightSlotMemory">,
	pane: MemoryPane,
): Partial<Pick<UiPreferencesState, "rightSlotMemory">> => {
	const key = state.rightSlotKey;
	if (typeof key !== "string") return {};
	const memory = memoryRemove(state.rightSlotMemory, key, pane);
	// The same array back means nothing was retracted: say nothing rather than
	// hand `persist` a write that changes no byte.
	return memory === state.rightSlotMemory ? {} : { rightSlotMemory: memory };
};

export type RightSlotPane = "canvas" | "run" | "browser" | "console" | "ask";

/**
 * WHAT THE CURRENT ROUTE CAN RENDER, in the slot's own terms (#868).
 *
 * Three facts a claim cannot answer, each mirrored from ONE mount gate in
 * `chat-content` (see `rightSlotRoute` for why the split is exactly these):
 *
 * - `mounted` - the chat surface that hosts the slot is on screen at all; false
 *   on settings/agents routes, where none of the five panes can draw.
 * - `runDetails` - the route has run details, the run panel's own mount gate; a
 *   draft (or a conversation whose canonical frame has not arrived) has none.
 * - `session` - the route shows a conversation, the session-scoped asks
 *   drawer's home; the fleet scope's home is the shell and needs no fact.
 */
export type RightSlotRouteFacts = {
	mounted: boolean;
	runDetails: boolean;
	session: boolean;
};

/**
 * The empty route: nothing drawable. Shared so the store's initial state and the
 * chat surface's unmount reset are one value rather than two spellings.
 */
export const EMPTY_RIGHT_SLOT_ROUTE: RightSlotRouteFacts = Object.freeze({
	mounted: false,
	runDetails: false,
	session: false,
});

/**
 * The empty memory: a launch knows no conversation's history yet. Shared so the
 * store's initial state and a suite's reset are one value rather than a fresh
 * array each — and FROZEN, because the list is read by every projection while
 * only the pure writers below ever replace it.
 */
export const EMPTY_RIGHT_SLOT_MEMORY: RightSlotMemory = Object.freeze([]);

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
 *
 * AND A CLAIMED PANE IS NOT YET A DRAWN ONE (#868): the flags persist across
 * routes by design, so before answering a width this reads the route's own facts
 * (`rightSlotPaneDrawable` over `rightSlotRoute`) - a run panel on a draft and a
 * session-scoped drawer on a route with no conversation are claims with nothing
 * to mount, and they answer 0.
 */
export function resolveRightSlotWidth(
	rowWidth: number,
	state: UiPreferencesState,
): number {
	const pane: RightSlotPane | null = activeRightSlotPane(state);
	/*
	 * A CLAIMED PANE THE ROUTE CANNOT DRAW IS NOT AN OCCUPIED SLOT (#868): this
	 * answer is the lane's stop and the column's deficit, and a width for a pane
	 * nothing will mount is the empty band and the reserved column the issue
	 * reports. See `rightSlotPaneDrawable` / `rightSlotRoute`.
	 */
	if (pane === null || !rightSlotPaneDrawable(pane, state)) return 0;

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
 * Whether anything is DRAWN in the right slot - the boolean the header's
 * OS-corner reservation reads (chat redesign §J4).
 *
 * The width resolver's sibling: same claim, same drawable check
 * (`rightSlotPaneDrawable`), so the lane's stop, the column's deficit and the
 * header's reservation are three reads of ONE answer rather than three copies of
 * a disjunction - which is exactly the disagreement #868 caught.
 */
export function resolveRightSlotOccupied(state: UiPreferencesState): boolean {
	const pane = activeRightSlotPane(state);
	return pane !== null && rightSlotPaneDrawable(pane, state);
}

/**
 * WHICH pane is drawn in the right slot, or null - the question the panel rail's
 * lit state asks (#872).
 *
 * The sibling of `resolveRightSlotOccupied` that answers WHICH rather than
 * WHETHER, built from the same two inputs (`activeRightSlotPane` and
 * `rightSlotPaneDrawable`) and not from a copy of their disjunction - a copy is
 * what #868 caught disagreeing with the width resolver. A pane that is CLAIMED
 * but that the route cannot draw (the run panel on a draft, any pane on a
 * settings route) answers null here, so the rail lights nothing for it: a lit
 * item is a statement that this is what is on screen, and a claim that outlived
 * its route is not on screen.
 *
 * It returns the short name, a primitive, so a `useUiPreferencesStore(selector)`
 * subscriber re-renders only when the answer changes. `"ask"` is a legitimate
 * answer: the rail reads it as "the slot is held by the drawer", lights none of
 * its four items, and leaves the borrowed pane's own flag (`askDrawerEvictedPane`)
 * out of it - lighting the covered pane would say something false.
 */
export function resolveDrawnRightSlotPane(
	state: UiPreferencesState,
): RightSlotPane | null {
	const pane = activeRightSlotPane(state);
	return pane !== null && rightSlotPaneDrawable(pane, state) ? pane : null;
}

/**
 * Whether the pane DRAWN in the right slot is one of the two that size
 * themselves like the canvas - the canvas itself and the asks drawer - which is
 * the question the sidebar's yield is asking (agent review round 1, R2).
 *
 * `resolveSidebarLayout`'s last argument is §I's first yielding step: a docked
 * sidebar steps down to the strip so a DOCKING canvas keeps its 400px floor. It
 * used to be fed the bare `isCanvasOpen || isAskDrawerOpen`, which is the same
 * claim-only reading #868 removed from the width and the header: a flag that
 * outlived its route (a session-scoped drawer on a draft, the canvas on a
 * settings route) still collapsed the sidebar at 1024-1139px for a pane nobody
 * could see. The run panel, the browser and the console are deliberately not in
 * this answer - they never yielded the sidebar before, and the row's own width
 * arithmetic (`resolveRightSlotWidth`) is what keeps their floors.
 *
 * It is a third reader of the SAME two inputs (`activeRightSlotPane` and
 * `rightSlotPaneDrawable`), not a third copy of the disjunction: the shell reads
 * it because the sidebar belongs to the shell, above the component that
 * publishes the route facts.
 */
export function resolveRightSlotYieldsSidebar(
	state: UiPreferencesState,
): boolean {
	const pane = activeRightSlotPane(state);
	return (
		(pane === "canvas" || pane === "ask") && rightSlotPaneDrawable(pane, state)
	);
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
 * The persisted blob's schema version, which `migrateUiPreferences` walks a stored
 * blob up to.
 *
 * v1 is the one-slot pane width (#677). v2 (#895) DROPS `chatMeasureWidth`: the
 * conversation column's two drag handles and the width they persisted were
 * removed, so the column is the stylesheet's one 810px everywhere. A reader who
 * had dragged it to 520 or to 1100 silently gets 810 - no toast, because a toast
 * would describe a feature that no longer exists. Without this step the stale key
 * would survive: zustand's default merge copies every persisted key onto the
 * state, and the rest-spread in `persistedUiPreferences` would write it back to
 * disk on every save, so it would sit in the profile forever, read by nothing.
 *
 * No DOM cleanup rides with it. The inline `--lo-chat-measure-override` the old
 * `onRehydrateStorage` published lived on the live renderer document only, and a
 * relaunch starts from a document that never had it.
 *
 * THE COLLISION RULE FOR THE NEXT EDITOR. Other lanes may also bump this number
 * (a future one-width-range change is the likely one), and two branches that
 * each take "2" merge cleanly and then disagree about what v2 means. Whoever
 * merges second renumbers, and decides after measuring rather than remembering:
 * `git show origin/main:src/renderer/src/shared/store/ui-preferences-store.ts |
 * grep 'version:'` for the value on main now, and whether that value shipped in a
 * tag (a shipped number is spent - a profile stored at it will never run its step
 * again, so a new step needs a new number). Then add the new step under its own
 * `if (version < N)` in `migrateUiPreferences`; never edit a shipped step.
 *
 * THE RULE WAS EXERCISED ONCE, BY THE #894 FOLD: this branch first carried the
 * right slot's memory as v2 beside a duplicate of #895's step; the fold onto
 * `main` keeps #895's v2 (the copy that shipped) and renumbers the memory step
 * to v3, dropping the duplicate.
 *
 * v3 (#894) IS THE RIGHT SLOT'S MEMORY: the four global pane flags stop being
 * persisted and become the bound conversation's projection, so the step lifts
 * whichever flag was true into `rightSlotLegacySeed` - the one-shot seed the
 * first bind plants - and deletes the four keys.
 */
export const UI_PREFERENCES_VERSION = 3;

/**
 * The keys v2 removes from a stored blob. A list rather than a `delete
 * blob.chatMeasureWidth` so the retired name is stated once, with the step that
 * drops it, and the computed `delete` is the shape the lint accepts (the v1 fold
 * below does the same).
 */
const RETIRED_IN_V2: readonly string[] = ["chatMeasureWidth"];

export const useUiPreferencesStore = create<UiPreferencesState>()(
	persist(
		(set, get) => ({
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
			chatSidebarOrder: "entities-first",
			dismissedBuiltinOfferSignature: "",
			isCanvasOpen: false,
			isRunPanelOpen: false,
			isBrowserPaneOpen: false,
			isConsolePaneOpen: false,
			/*
			 * The memory the four flags above are the projection of (issue #894):
			 * nothing bound, nothing remembered, no handed-over seed. See
			 * `rightSlotKey` for what each of the three means.
			 */
			rightSlotKey: undefined,
			rightSlotMemory: EMPTY_RIGHT_SLOT_MEMORY,
			rightSlotLegacySeed: null,
			isAskDrawerOpen: false,
			askDrawerScope: "session",
			askDrawerEvictedPane: null,
			rightSlotRoute: EMPTY_RIGHT_SLOT_ROUTE,
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
				set((state) =>
					open
						? {
								...claimRightSlot("isCanvasOpen"),
								...claimedMemory(state, "canvas"),
							}
						: { isCanvasOpen: false, ...releasedMemory(state, "canvas") },
				);
			},

			setRunPanelOpen: (open: boolean) => {
				set((state) =>
					open
						? {
								...claimRightSlot("isRunPanelOpen"),
								...claimedMemory(state, "run"),
							}
						: { isRunPanelOpen: false, ...releasedMemory(state, "run") },
				);
			},

			setBrowserPaneOpen: (open: boolean) => {
				set((state) =>
					open
						? {
								...claimRightSlot("isBrowserPaneOpen"),
								...claimedMemory(state, "browser"),
							}
						: {
								isBrowserPaneOpen: false,
								...releasedMemory(state, "browser"),
							},
				);
			},

			setConsolePaneOpen: (open: boolean) => {
				set((state) =>
					open
						? {
								...claimRightSlot("isConsolePaneOpen"),
								...claimedMemory(state, "console"),
							}
						: {
								isConsolePaneOpen: false,
								...releasedMemory(state, "console"),
							},
				);
			},

			setAskDrawerOpen: (open: boolean, scope: AskScope) => {
				set((state) => {
					const bound = typeof state.rightSlotKey === "string";
					if (open) {
						return {
							...claimRightSlot("isAskDrawerOpen"),
							/*
							 * WHICH QUEUE, written with the flag so the two are one update: a
							 * surface reading `isAskDrawerOpen` between the two writes would
							 * paint the previous scope's rows for a frame.
							 */
							askDrawerScope: scope,
							/*
							 * WHAT IT DISPLACED, and ONLY in unbound mode. Bound, the memory already
							 * holds the displaced pane for this conversation, so a second record would
							 * be a second answer to give back — and the wrong one the moment the
							 * drawer outlives a switch (see `isAskDrawerOpen`).
							 */
							askDrawerEvictedPane: bound ? null : evictedFlag(state),
						};
					}
					const closed = {
						isAskDrawerOpen: false,
						askDrawerEvictedPane: null,
					} as const;
					if (bound) {
						/*
						 * BOUND: the close restores the BOUND conversation's own memory, which is
						 * the fix for a fleet drawer opened over A's canvas and closed over B —
						 * the per-run record could only ever name A's pane.
						 */
						return {
							...closed,
							...memoryProject(
								state.rightSlotMemory,
								state.rightSlotKey,
								false,
							),
						};
					}
					if (state.rightSlotKey === null) {
						/*
						 * BOUND, NO CONVERSATION: nothing was displaced (the open wrote no
						 * record) and there is no memory to restore, so the close only clears the
						 * flag.
						 */
						return closed;
					}
					return {
						...closed,
						...(state.askDrawerEvictedPane === null
							? null
							: { [state.askDrawerEvictedPane]: true }),
					};
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

			bindRightSlotKey: (key, options) => {
				set((state) => {
					let memory = state.rightSlotMemory;
					let seed = state.rightSlotLegacySeed;
					const admittedFrom = options?.admittedFrom;
					if (typeof admittedFrom === "string" && typeof key === "string") {
						/*
						 * THE ADMISSION CARRY, and it is what keeps the remount invisible: the
						 * draft's entry moves to the session id so the panel is still open in the
						 * first frame after the identity flip, rather than closing and reopening.
						 */
						memory = memoryCarry(memory, admittedFrom, key);
					}
					if (key === null) {
						/*
						 * A ROUTE WITH NO CONVERSATION IS NOT A DECISION ABOUT ONE, so the seed
						 * is HELD rather than planted on nothing or dropped: the session it was
						 * meant for is the one the app is about to open.
						 */
					} else if (isDraftMemoryKey(key)) {
						/*
						 * A DRAFT IS A LAUNCH'S OWN ROW — the canonical store mints a fresh key
						 * per launch — so the seed does not land here: the panel would come back
						 * hanging off a conversation nothing can reach. Dropped, deliberately
						 * (the decision record's "a first launch on a draft drops it").
						 */
						seed = null;
					} else if (seed !== null && memoryRead(memory, key) === undefined) {
						/*
						 * THE HANDOVER, once: the legacy flag becomes this session's entry and the
						 * seed is spent. A session that already has an entry keeps its own answer
						 * — the user's choice in THIS profile outranks a flag from a launch that
						 * predates the memory.
						 */
						memory = memoryPut(memory, key, seed);
						seed = null;
					}
					return {
						rightSlotKey: key,
						rightSlotMemory: memory,
						rightSlotLegacySeed: seed,
						...memoryProject(memory, key, state.isAskDrawerOpen),
					};
				});
			},

			setRightSlotRoute: (route: RightSlotRouteFacts) => {
				/*
				 * THE EQUALITY GUARD SITS BEFORE `set`, not inside its updater (agent review
				 * round 1, R1). Two layers each re-act to a `set` whose result is unchanged,
				 * and an updater can only silence one of them:
				 *
				 * - an updater returning `{}` builds a fresh state object, so zustand
				 *   replaces the store and wakes every listener (it short-circuits only on
				 *   `Object.is(next, state)`);
				 * - an updater returning `state` stops that, but `persist` wraps `set` and
				 *   calls `setItem()` after EVERY call regardless of the result, so the
				 *   whole preferences blob was still serialised to localStorage.
				 *
				 * Not calling `set` at all is the one spelling that is a no-op in both.
				 * The publisher re-runs for its own reasons, so this has to be cheap.
				 */
				const current = get().rightSlotRoute;
				if (
					current.mounted === route.mounted &&
					current.runDetails === route.runDetails &&
					current.session === route.session
				) {
					return;
				}
				set({ rightSlotRoute: { ...route } });
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
					...claimedMemory(state, "run"),
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
			 * THREE STEPS, each its own guard, and each one written to be IDEMPOTENT so
			 * the chain survives a rebase onto a sibling lane's step (the reason this is
			 * a chain of `if (version < n)` guards rather than one early return per
			 * version).
			 *
			 * - v1 IS THE ONE-SLOT WIDTH (#677): a v0 blob carries the four
			 *   per-surface widths, v1 carries `rightSlotWidth`, and
			 *   `migrateUiPreferences` below seeds the shared value from whichever
			 *   legacy width the user had actually dragged. A blob that never carried
			 *   any of the four keys seeds to 0, which is "every pane opens at its own
			 *   seed".
			 * - v2 IS `chatMeasureWidth`'S REMOVAL (#895), kept exactly as `main` wrote
			 *   it: this branch carried a duplicate of that step while it had to land
			 *   before that lane, and the duplicate is dropped here rather than
			 *   re-spelled - the chain keeps the copy that shipped.
			 * - v3 IS THE RIGHT SLOT'S MEMORY (issue #894): the four global pane flags
			 *   stop being persisted and become the bound conversation's projection, so
			 *   the migration lifts whichever flag was true into `rightSlotLegacySeed`
			 *   and deletes all four keys. See `migrateUiPreferences`.
			 */
			version: UI_PREFERENCES_VERSION,
			migrate: migrateUiPreferences,
			/*
			 * WHAT A HYDRATED BLOB MAY SAY, and this is where the memory is sanitised
			 * rather than trusted (see `mergePersistedUiPreferences`): the field is read
			 * back through `memorySanitize`, so a hand edit, a downgrade or a
			 * half-written blob cannot put a conversation nobody can reach or a pane the
			 * store does not have into the memory.
			 *
			 * `runPanelReveal` is deliberately NOT persisted, and the FILTER is where
			 * that lives — every other field keeps the default "persist it" behaviour
			 * this store has always had, apart from the four flags and the bind key
			 * (see `persistedUiPreferences`).
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

			merge: mergePersistedUiPreferences,
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
 * The part of the preferences that is written to disk: all of it, minus the
 * values that only mean something inside the run - or the route - that produced
 * them (the two requests, the asks drawer's flag/scope/record, and the route
 * facts).
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
 *
 * THE FOUR DURABLE FLAGS LEAVE THE BLOB ENTIRELY (issue #894). They used to be the
 * preference — "the window had a canvas open" — and they are now the bound
 * conversation's PROJECTION, which `rightSlotMemory` is the record of. Persisting
 * both would be two answers to "what was open", and the one that survived a relaunch
 * cannot say WHICH conversation it belonged to. So the flags and the bind key are
 * omitted, `rightSlotMemory` and `rightSlotLegacySeed` are what go to disk, and the
 * `draft:` entries are filtered out of the memory on the way (a draft is a launch's
 * own row — see `right-slot-memory.ts`).
 *
 * AND THAT RETIRES THE DRAWER'S WRITE-BACK. It used to add the displaced pane's flag
 * back into the blob when the drawer was open, because the drawer's claim had zeroed a
 * PERSISTED flag. The displaced pane now lives in the bound conversation's memory
 * (which is persisted, and correctly per conversation), and in unbound mode the write
 * never reaches disk at all — so re-adding a flag key here would be the only way a flag
 * could come back, and it would come back without a conversation to belong to.
 */
export function persistedUiPreferences<
	T extends {
		runPanelReveal: unknown;
		consoleOpenIntent: unknown;
		isAskDrawerOpen: unknown;
		askDrawerScope: unknown;
		askDrawerEvictedPane: unknown;
		rightSlotRoute: unknown;
		isCanvasOpen: unknown;
		isRunPanelOpen: unknown;
		isBrowserPaneOpen: unknown;
		isConsolePaneOpen: unknown;
		rightSlotKey: unknown;
		rightSlotMemory: RightSlotMemory;
	},
>(
	state: T,
): Omit<
	T,
	| "runPanelReveal"
	| "consoleOpenIntent"
	| "isAskDrawerOpen"
	| "askDrawerScope"
	| "askDrawerEvictedPane"
	| "rightSlotRoute"
	| "isCanvasOpen"
	| "isRunPanelOpen"
	| "isBrowserPaneOpen"
	| "isConsolePaneOpen"
	| "rightSlotKey"
> {
	const {
		runPanelReveal: _pending,
		consoleOpenIntent: _intent,
		/*
		 * THE ASKS DRAWER IS NOT PERSISTED, and it is excluded here rather than in the
		 * flag's own note because this is where the decision is executed (see
		 * `isAskDrawerOpen` for the argument): a relaunch must not reopen a surface nobody
		 * opened this launch. The four durable panes are restored from the memory, which
		 * is per conversation; the drawer holds a queue, which the session republishes on
		 * its own.
		 */
		isAskDrawerOpen: _drawerOpen,
		askDrawerScope: _scope,
		askDrawerEvictedPane: _evicted,
		/*
		 * THE ROUTE FACTS JOIN THE REQUESTS RATHER THAN THE PREFERENCES: they
		 * describe where the app IS, not what the user chose, and the next launch
		 * publishes its own (see `rightSlotRoute`).
		 */
		rightSlotRoute: _route,
		/*
		 * THE FLAGS AND THE BIND, excluded together because they are one fact: the flags
		 * are `rightSlotMemory`'s projection for `rightSlotKey`, and a persisted key
		 * would name a conversation from the previous process (see `rightSlotKey`).
		 */
		isCanvasOpen: _canvas,
		isRunPanelOpen: _run,
		isBrowserPaneOpen: _browser,
		isConsolePaneOpen: _console,
		rightSlotKey: _key,
		...persisted
	} = state;
	/*
	 * The memory is read off the state rather than destructured out of it: `persisted`
	 * then keeps the field's own type, so the filtered value below is an OVERRIDE of a
	 * present field rather than a property the omit-type says cannot exist.
	 */
	return {
		...persisted,
		rightSlotMemory: persistableRightSlotMemory(state.rightSlotMemory),
	};
}

/**
 * The memory entries that go to disk: everything but the `draft:` ones.
 *
 * A draft key is a LAUNCH's row — the canonical store mints a fresh `draft:<uuid>`
 * per launch — so a persisted entry under one would restore a panel onto a
 * conversation that no longer exists. Filtered here, at the write, because that is
 * the only boundary a draft entry crosses; `memorySanitize` drops them again on the
 * way back for symmetry, so neither direction depends on the other having run.
 */
function persistableRightSlotMemory(memory: RightSlotMemory): RightSlotMemory {
	return memory.filter(([key]) => !isDraftMemoryKey(key));
}

/**
 * What a hydrated blob is allowed to say about the slot (issue #894).
 *
 * `merge` rather than the default shallow spread, for what disk is allowed to say:
 *
 * - `rightSlotMemory` is read back through `memorySanitize`, because `localStorage`
 *   is not a trusted input — a hand edit, a downgrade or a half-written blob must not
 *   put a key nothing can reach or a pane the store does not have into the memory;
 * - `rightSlotLegacySeed` is read through `isMemoryPane` for the same reason (agent
 *   review round 1, F2): `...rest` used to carry any value a hand-edited blob held
 *   straight to the first bind, which planted it as an entry the projection can
 *   never draw. The seed is a pane name or nothing;
 * - the four flag keys are dropped if a blob still carries one. The migration
 *   deletes them, so this only fires for a blob that never went through it (a hand
 *   edit, or a build-order accident), and what it prevents is the one thing the
 *   inversion cannot allow: a flag set on screen with no conversation holding it.
 *
 * `rightSlotKey` is taken from the CURRENT state rather than the blob, which is
 * `undefined`: the bind is a launch's own act, redone by the follower before the first
 * render, and a restored key would name a conversation this process has not read.
 */
export function mergePersistedUiPreferences(
	persisted: unknown,
	current: UiPreferencesState,
): UiPreferencesState {
	const blob = (persisted ?? {}) as Partial<UiPreferencesState>;
	const {
		isCanvasOpen: _canvas,
		isRunPanelOpen: _run,
		isBrowserPaneOpen: _browser,
		isConsolePaneOpen: _console,
		...rest
	} = blob;
	return {
		...current,
		...rest,
		rightSlotKey: current.rightSlotKey,
		rightSlotMemory: memorySanitize(blob.rightSlotMemory),
		rightSlotLegacySeed: isMemoryPane(blob.rightSlotLegacySeed)
			? blob.rightSlotLegacySeed
			: null,
	};
}

/**
 * Walk a stored blob up to `UI_PREFERENCES_VERSION`, one step per version.
 *
 * Pure and exported so `scripts/right-slot-width.test.mjs` drives it directly:
 * the steps are decisions about what a user's saved profile becomes, and they
 * run once per profile, so a wrong one is not found by trying the app twice.
 *
 * ONE GUARD PER VERSION, IN ORDER, EACH WRITTEN TO BE IDEMPOTENT. The chain (rather
 * than an early return per version) is deliberate: these steps land from two lanes
 * against the same file, and a step that is a `delete` of a key the later blob cannot
 * carry is a trivial conflict to reconcile. See the `version` field for what each one
 * is.
 */
export function migrateUiPreferences(
	persisted: unknown,
	version: number,
): Record<string, unknown> {
	const blob: Record<string, unknown> = {
		...((persisted ?? {}) as Record<string, unknown>),
	};
	/*
	 * SEQUENTIAL STEPS, never an early return: zustand calls this once with the
	 * STORED version, so a v0 blob has to pass through every step on its way to
	 * the current one. Each step is guarded by the version that introduced it, so
	 * a blob already past a step skips it untouched.
	 */
	if (version < 1) foldLegacyPaneWidths(blob);
	if (version < 2) for (const key of RETIRED_IN_V2) delete blob[key];
	if (version < 3) {
		/*
		 * v3 LIFTS THE FOUR GLOBAL FLAGS INTO THE ONE-SHOT SEED, and deletes them
		 * UNCONDITIONALLY - the second half is what makes the step idempotent and what
		 * stops a flag from being persisted again by the fresh blob's first write.
		 *
		 * WHICH FLAG WINS, when a hand-edited or oddly-written blob carries more than
		 * one: the slot's own precedence order (canvas -> run -> browser -> console),
		 * read from `MEMORY_PANES`, which is the same order `activeRightSlotPane`
		 * answers with. Two orders would be two answers to "which pane was up?".
		 *
		 * The seed is what the FIRST BIND plants on the session it lands on (see
		 * `rightSlotLegacySeed`): the migrated profile was looking at that pane, so
		 * opening onto a conversation with nothing is the honest reading, and a first
		 * launch onto a draft drops it.
		 */
		let seed: MemoryPane | null = null;
		for (const pane of MEMORY_PANES) {
			if (blob[memoryPaneFlag(pane)] === true) {
				seed = pane;
				break;
			}
		}
		if (seed !== null) blob.rightSlotLegacySeed = seed;
		for (const pane of MEMORY_PANES) delete blob[memoryPaneFlag(pane)];
	}
	return blob;
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
function foldLegacyPaneWidths(blob: Record<string, unknown>): void {
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
}