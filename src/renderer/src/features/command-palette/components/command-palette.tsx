import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import {
	Button,
	Dialog,
	DialogContent,
	DialogTitle,
} from "@shared/components/ui";
import { useClearAgentConversation } from "@shared/hooks/use-clear-agent-conversation";
import { useDebouncedValue } from "@shared/hooks/use-debounced-value";
import { useAgentRouteParam } from "@shared/hooks/use-route-params";
import { cn } from "@shared/lib/utils";
import { useAgentSelectionStore } from "@shared/store/agent-selection-store";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useChatPanelRequestStore } from "@shared/store/chat-panel-request-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { Search as LucideSearch, X } from "lucide-react";
import {
	type FC,
	Fragment,
	useCallback,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { SESSION_SEARCH_MAX_CHARS } from "../../../../../shared/desktop-contract";
import {
	PALETTE_GROUP_TITLES,
	type PaletteItem,
	type PaletteMatch,
	SCOPE_LEGEND,
	searchPalette,
} from "../palette-search";
import { usePaletteItems } from "../use-palette-sources";
import { PaletteIcon } from "./palette-icons";

const INPUT_ID = "command-palette-input";
const LIST_ID = "command-palette-results";

/**
 * What Enter does, per row kind.
 *
 * The fine kinds get their own verb; an action names its own (`PaletteItem.verb`)
 * because "Run" on a row that clears a conversation says nothing about what is
 * about to happen. Shown on the ACTIVE row only — on every row it would be a
 * column of chits restating what the section heading already says.
 */
const KIND_VERBS: Record<PaletteItem["kind"], string> = {
	page: "Go",
	action: "Run",
	panel: "Open",
	chat: "Open",
	agent: "Open",
	"settings-section": "Open",
	setting: "Open",
};

/**
 * How long the query is left to settle before the palette writes it back to the
 * store.
 *
 * The store's copy is what a REMOUNT of the view reads — a route change
 * re-mounts it, the tour and the Storybook stories drive it — and the write-back
 * is what keeps that copy current while the palette is open. It is deliberately
 * NOT a value that survives the surface: `closeCommandPalette` clears it and
 * `toggleCommandPalette` clears it on the way in, so reopening always starts from
 * an empty box, which is what a palette's users expect (UX round 1, U5 — this
 * comment used to promise persistence the store does not provide, and the code
 * was right).
 */
const QUERY_WRITE_BACK_MS = 200;

/**
 * A key on the footer bar and on the active row.
 *
 * Monospace because a key legend is machine voice, and `sunken` because a key
 * is a recessed thing — no border, since the ground change already bounds it and
 * this shape repeats several times on one bar.
 */
const Key: FC<{ children: string }> = ({ children }) => (
	<kbd className="rounded-xs bg-sunken px-1 py-0.5 font-mono text-ink-dim text-mono-sm">
		{children}
	</kbd>
);

/**
 * The command palette.
 *
 * A single-control surface: focus lives in the query field for as long as the
 * dialog is open and the list is walked with `aria-activedescendant`, which is
 * what lets every keystroke keep reaching the field while Up and Down move the
 * selection. Nothing here takes focus away from that field, and the two ways out
 * — Escape, or running a row — hand focus back to wherever the user was before
 * the palette opened.
 *
 * The list itself is `searchPalette`'s: this component decides how a row is
 * drawn and what running one does, and nothing about which rows a query admits.
 */
export const CommandPalette: FC = () => {
	const navigate = useNavigate();
	const location = useLocation();

	/*
	 * Read one field at a time.
	 *
	 * This component is mounted for the whole session, so subscribing to the
	 * store as a whole made every unrelated preference write re-render it — the
	 * canvas flags, the run panel, the theme. Selectors keep the redraws to the
	 * four things a palette actually has.
	 */
	const isCommandPaletteOpen = useUiPreferencesStore(
		(state) => state.isCommandPaletteOpen,
	);
	const closeCommandPalette = useUiPreferencesStore(
		(state) => state.closeCommandPalette,
	);
	const commandPaletteQuery = useUiPreferencesStore(
		(state) => state.commandPaletteQuery,
	);
	const setCommandPaletteQuery = useUiPreferencesStore(
		(state) => state.setCommandPaletteQuery,
	);
	const isCanvasOpen = useUiPreferencesStore((state) => state.isCanvasOpen);
	const setCanvasOpen = useUiPreferencesStore((state) => state.setCanvasOpen);
	const isCreateAgentDialogOpen = useUiPreferencesStore(
		(state) => state.isCreateAgentDialogOpen,
	);
	const requestPanel = useChatPanelRequestStore((state) => state.requestPanel);

	const { agentId: currentAgentIdFromRoute } = useAgentRouteParam();
	const getLastAgentId = useAgentSelectionStore(
		(state) => state.getLastAgentId,
	);
	const clearConversationMutation = useClearAgentConversation();

	const [localQuery, setLocalQuery] = useState(commandPaletteQuery);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [isClearConfirmationOpen, setIsClearConfirmationOpen] = useState(false);

	/*
	 * The query the LIST is built from, one render behind the field.
	 *
	 * This is the whole of the typing-latency budget: the field is controlled by
	 * `localQuery`, so the character the user typed is on screen in the same
	 * frame, while the ranking (and the sources it consults) read the deferred
	 * value. React re-renders the list when it has spare time, so a keystroke
	 * stays cheap no matter how many rows a previous query produced.
	 */
	const deferredQuery = useDeferredValue(localQuery);

	// The store's copy is the persisted one, so it settles rather than
	// following every character.
	const settledQuery = useDebouncedValue(localQuery, QUERY_WRITE_BACK_MS);
	useEffect(() => {
		setCommandPaletteQuery(settledQuery);
	}, [settledQuery, setCommandPaletteQuery]);

	// Reopening seeds the field from the store, so a query is never silently
	// dropped between sessions of the palette.
	useEffect(() => {
		if (isCommandPaletteOpen) setLocalQuery(commandPaletteQuery);
	}, [isCommandPaletteOpen, commandPaletteQuery]);

	const isOnChatPage = location.pathname.startsWith("/chat");
	const effectiveAgentId = currentAgentIdFromRoute || getLastAgentId("chat");

	const { items, chats } = usePaletteItems({
		open: isCommandPaletteOpen,
		query: deferredQuery,
		isOnChatPage,
		hasConversation: Boolean(effectiveAgentId),
		isCanvasOpen,
	});

	const outcome = useMemo(
		() => searchPalette({ items, raw: deferredQuery }),
		[items, deferredQuery],
	);

	/*
	 * One flat list behind the grouped rendering. Selection is an index into
	 * this, because Up and Down have to walk the whole answer rather than one
	 * section of it — the headings are presentation, not a boundary.
	 */
	const matches = useMemo(
		() => outcome.sections.flatMap((section) => section.items),
		[outcome],
	);
	const matchCount = matches.length;

	const activeMatch = matches[selectedIndex];
	const hasTerms = outcome.terms.length > 0;
	const hasResults = matchCount > 0;

	/* ---------------------------------------------------------------- actions */

	const handleCreateAgent = useCallback(() => {
		closeCommandPalette();
		navigate("/agents?create=agent");
	}, [closeCommandPalette, navigate]);

	const handleNewChat = useCallback(() => {
		/*
		 * The sidebar's own \"New chat\": stage a fresh draft and go to the chat
		 * route. Staged through the store rather than a second implementation so
		 * the draft is the same row the sidebar would have made.
		 */
		useCanonicalSessionsStore.getState().stageDraft(undefined, true);
		closeCommandPalette();
		navigate("/chat");
	}, [closeCommandPalette, navigate]);

	const handleToggleCanvas = useCallback(() => {
		setCanvasOpen(!isCanvasOpen);
		closeCommandPalette();
	}, [isCanvasOpen, setCanvasOpen, closeCommandPalette]);

	const handleClearConversation = useCallback(() => {
		if (effectiveAgentId) setIsClearConfirmationOpen(true);
	}, [effectiveAgentId]);

	const confirmClearConversation = useCallback(() => {
		if (effectiveAgentId) {
			clearConversationMutation.mutate({ agentId: effectiveAgentId });
		}
		setIsClearConfirmationOpen(false);
		closeCommandPalette();
	}, [effectiveAgentId, clearConversationMutation, closeCommandPalette]);

	/*
	 * The commands, one level up from `runItem`.
	 *
	 * A named function rather than a switch nested inside the target switch: a
	 * nested switch that returns from every arm still reads to a linter (and to a
	 * reader) as though control could fall into the next target case, and the
	 * `clear-conversation` arm is the one that must never be reached by accident.
	 */
	const runCommand = useCallback(
		(
			command: Extract<PaletteItem["target"], { type: "command" }>["command"],
		) => {
			switch (command) {
				case "create-agent":
					handleCreateAgent();
					return;
				case "new-chat":
					handleNewChat();
					return;
				case "toggle-canvas":
					handleToggleCanvas();
					return;
				case "clear-conversation":
					// Left open: its confirmation dialog is the next thing the user
					// answers, and closing the palette under it would leave them looking
					// at a dialog that had no caller.
					handleClearConversation();
			}
		},
		[
			handleCreateAgent,
			handleNewChat,
			handleToggleCanvas,
			handleClearConversation,
		],
	);

	const runItem = useCallback(
		(item: PaletteItem) => {
			switch (item.target.type) {
				case "path":
					closeCommandPalette();
					navigate(item.target.path);
					return;
				case "session": {
					/*
					 * Committed first, then validated: the same order the sidebar's
					 * rows use, so a conversation opens over the transcript that is
					 * already on screen instead of freezing the panel until the
					 * store's read answers. A read that refuses leaves the user where
					 * they were, and the store's own navigation sentence says so.
					 */
					const { sessionId } = item.target;
					closeCommandPalette();
					useCanonicalSessionsStore
						.getState()
						.openSession(sessionId)
						.then((opened) => {
							if (opened) navigate(`/chat/${sessionId}`);
						});
					return;
				}
				case "command":
					runCommand(item.target.command);
					return;
				case "panel": {
					/*
					 * A panel is presented BY THE CHAT PANE, so the request is written
					 * first and the route is moved second: the pane consumes it as it mounts,
					 * and a request written after the navigation would race the consumer's
					 * own mount.
					 *
					 * Navigating only when we are not already there matters for the rows a
					 * session pane offers: `/chat` on its own keeps the store's active session,
					 * so re-routing an already-open conversation is a no-op the user did not
					 * ask for, while re-routing from Settings is the whole point of the row.
					 */
					const { destination } = item.target;
					requestPanel(destination);
					closeCommandPalette();
					if (!location.pathname.startsWith("/chat")) navigate("/chat");
					return;
				}
			}
		},
		[
			closeCommandPalette,
			navigate,
			location.pathname,
			requestPanel,
			runCommand,
		],
	);

	/* ------------------------------------------------------------------ focus */

	/*
	 * Where focus goes when the palette closes.
	 *
	 * Captured as the palette OPENS rather than read at close time: by then the
	 * focused element is the palette's own field. Three answers, in order, and
	 * the third is why this exists at all — Radix's modal dialog ends by
	 * focusing its trigger, and this surface has no trigger (it is opened from a
	 * keyboard gesture or the sidebar's button), so `triggerRef.current` is null
	 * and focus used to land on the document body. A user who pressed Escape had
	 * to click before the keyboard worked again.
	 *
	 * The sidebar button is the fallback rather than `body` because that is
	 * where the user's hand is: it is the palette's one visible door, it is on
	 * screen on every route, and focusing it means the next Tab or Enter
	 * continues from somewhere real.
	 */
	const returnFocusTo = useRef<HTMLElement | null>(null);
	useEffect(() => {
		if (!isCommandPaletteOpen) return;
		const active = document.activeElement;
		returnFocusTo.current = active instanceof HTMLElement ? active : null;
	}, [isCommandPaletteOpen]);

	const restoreFocus = useCallback(() => {
		const previous = returnFocusTo.current;
		/*
		 * `body` means "nothing was focused when this opened", which is not the
		 * same as "focus was on a control". Returning focus there is the
		 * strand-on-body defect wearing a captured element's clothes, and it is
		 * reachable without any trickery: `Cmd+K` with focus on the document
		 * (fresh window, after a click on empty space) captures exactly this. The
		 * rail's button is the fallback for the same reason it is the fallback
		 * when the captured element has since left the document.
		 */
		if (previous?.isConnected && previous !== document.body) {
			previous.focus();
			return;
		}
		document
			.querySelector<HTMLElement>("[data-command-palette-trigger]")
			?.focus();
	}, []);

	// Opening always puts the caret in the field, whichever door was used: the
	// keyboard gesture, the sidebar button, or the onboarding tour driving the
	// store. `onOpenAutoFocus` covers the mount; this covers a re-open while the
	// dialog is already mounted, which is a state the store can reach without a
	// close in between.
	useEffect(() => {
		if (!isCommandPaletteOpen) return;
		document.getElementById(INPUT_ID)?.focus();
	}, [isCommandPaletteOpen]);

	/*
	 * Back to the top when the query settles or the palette reopens — and only
	 * then. Keying this off the list instead made the selection jump home
	 * underneath the user whenever a background refetch produced a new array.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the deps are the triggers, not values the body reads
	useEffect(() => {
		setSelectedIndex(0);
	}, [deferredQuery, isCommandPaletteOpen]);

	/*
	 * Keep the index inside the list. The list can shrink without the query
	 * changing — a chat is deleted, a chat-only action disappears when the route
	 * changes — and an index past the end selects nothing at all.
	 */
	useEffect(() => {
		setSelectedIndex((current) =>
			current >= matchCount ? Math.max(matchCount - 1, 0) : current,
		);
	}, [matchCount]);

	/* ------------------------------------------------------------- keyboard */

	useEffect(() => {
		if (!isCommandPaletteOpen) return;
		const onKeyDown = (event: KeyboardEvent) => {
			/*
			 * Stand down while a dialog of our own is in front. Both render above
			 * the palette, and this listener is on `window`, so without it Up and
			 * Down walked a list the user could not see and Enter ran the row they
			 * landed on.
			 */
			if (isClearConfirmationOpen || isCreateAgentDialogOpen) return;
			/*
			 * ...and stand down for anything else focused inside the dialog.
			 *
			 * Tab reaches the Clear button beside the field, and from there Enter
			 * belongs to the BUTTON - running a row instead is how a focused control
			 * became unreachable by keyboard (UX round 1, U2) - while
			 * Shift/Alt+Arrow belongs to the caret or to the OS rather than to the
			 * list (U3). Only the field's own keys are this listener's business; the
			 * dialog's Escape is Radix's, not this handler's.
			 */
			if ((event.target as HTMLElement | null)?.id !== INPUT_ID) return;
			/*
			 * Modulo by zero is NaN, and a NaN index leaves every row unselected
			 * with no way back — reachable by typing a query that matches nothing
			 * and pressing Down.
			 */
			const count = matches.length;
			if (event.key === "ArrowDown") {
				/*
				 * A MODIFIED arrow is not the list's: Shift+Arrow is the caret
				 * extending a selection and Alt+Arrow is the OS's (word-jump on this
				 * platform, history elsewhere). The comment below has always said so;
				 * the branch did not check, which is how the modifier arrived with the
				 * caret frozen (UX round 2, U3).
				 */
				if (event.shiftKey || event.altKey) return;
				event.preventDefault();
				if (count > 0) setSelectedIndex((current) => (current + 1) % count);
			} else if (event.key === "ArrowUp") {
				if (event.shiftKey || event.altKey) return;
				event.preventDefault();
				if (count > 0) {
					setSelectedIndex((current) => (current - 1 + count) % count);
				}
			} else if (event.key === "Enter") {
				event.preventDefault();
				const match = matches[selectedIndex];
				if (match) runItem(match.item);
			} else if (event.key === "Escape") {
				event.preventDefault();
				closeCommandPalette();
			}
			/*
			 * Home and End are deliberately NOT intercepted. They are the field's
			 * own keys — the caret's ends — and this surface's whole premise is
			 * that the user can keep editing the query while walking the list.
			 * The list is walked with the arrows, which cost no caret position.
			 */
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [
		isCommandPaletteOpen,
		isClearConfirmationOpen,
		isCreateAgentDialogOpen,
		matches,
		selectedIndex,
		runItem,
		closeCommandPalette,
	]);

	/*
	 * Keep the active row on screen. The list scrolls and the selection is driven
	 * by `aria-activedescendant` rather than by focus, so nothing else moves the
	 * viewport: without this, holding Down walks the selection out of sight and
	 * the palette looks frozen. `nearest` rather than `center`, so the list only
	 * moves when it has to.
	 */
	useEffect(() => {
		if (!isCommandPaletteOpen) return;
		const activeId = matches[selectedIndex]?.item.id;
		if (!activeId) return;
		document
			.getElementById(activeId)
			?.scrollIntoView({ block: "nearest", behavior: "auto" });
	}, [isCommandPaletteOpen, matches, selectedIndex]);

	// The dialog is unmounted while closed: there is nothing to draw, and every
	// listener above is registered only for as long as it is open.
	if (!isCommandPaletteOpen) return null;

	const activeItem = activeMatch?.item;
	const showScopeLegend = !hasTerms || !hasResults;

	return (
		<>
			<Dialog
				open={isCommandPaletteOpen}
				onOpenChange={(open) => {
					if (!open) closeCommandPalette();
				}}
			>
				<DialogContent
					data-tour-tag="command-palette-dialog"
					showClose={false}
					/*
					 * `z-[2300]` clears the app's connection banner (`z-2200`), which is
					 * `fixed inset-x-0 top-0` and 68px tall. The dialog is centred, so at a
					 * window under ~638 CSS px tall it passed under the banner and the
					 * banner painted over the query field: the user typed into a field they
					 * could not see (UX round 1, U1). A modal owns the screen, and the
					 * banner's own remedy is waiting behind it either way.
					 *
					 * The SCRIM clears it too (`overlayClassName`), and that is the other
					 * half of the same decision: at `z-50` the scrim left the banner's strip
					 * undimmed between itself and this panel, showing the banner's sentence
					 * sliced in half by the dialog (UX round 2, U7). Dimming the banner is
					 * what "the modal owns the screen" looks like.
					 */
					className="z-[2300] w-160 max-w-[90vw] gap-0 overflow-hidden p-0"
					overlayClassName="z-[2300]"
					/*
					 * Focus goes to the query field and stays there. The rows are
					 * driven by `aria-activedescendant` rather than by moving focus,
					 * which is what lets Up and Down browse the list while every
					 * keystroke still reaches the input — the reason this surface
					 * exists.
					 */
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						document.getElementById(INPUT_ID)?.focus();
					}}
					/*
					 * Radix's modal dialog finishes by focusing its TRIGGER, and this
					 * surface has none: it is opened from a keyboard gesture or the
					 * sidebar's own button, so `triggerRef.current` is null and the
					 * gesture's last act was to strand focus on `body`. Preventing the
					 * default and putting focus back where the user was is the whole
					 * of the fix, and `event.preventDefault()` here also stops Radix
					 * from running its own (focus-nothing) handler.
					 */
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						restoreFocus();
					}}
				>
					{/* The palette announces itself; the title is not drawn, because the
					    field's placeholder already says what to do. */}
					<DialogTitle className="sr-only">Command palette</DialogTitle>

					{/*
					 * The query field is drawn from parts rather than from `Input`: a
					 * bordered control immediately inside a bordered panel is two boxes
					 * for one thing, so the panel's own edge is the field's edge — the
					 * pattern Raycast, Linear and Spotlight all use. The glyph is a flex
					 * sibling rather than an absolutely positioned overlay, which is what
					 * keeps it on the same 16px left margin as every row icon below it.
					 */}
					<div className="flex h-13 shrink-0 items-center gap-3 border-hairline border-b px-4">
						<LucideSearch
							size={16}
							aria-hidden="true"
							className="shrink-0 text-ink-dim"
						/>
						<input
							id={INPUT_ID}
							type="text"
							role="combobox"
							aria-expanded={hasResults}
							aria-controls={hasResults ? LIST_ID : undefined}
							aria-activedescendant={activeItem?.id}
							aria-autocomplete="list"
							autoComplete="off"
							placeholder="Search chats, settings, pages and actions"
							value={localQuery}
							onChange={(event) => setLocalQuery(event.target.value)}
							/*
							 * No focus ring on this one field. Focus is placed here when
							 * the palette opens and never leaves it, so the ring would be
							 * a permanent 2px rectangle drawn around a borderless input,
							 * marking the one thing on screen that could not be anywhere
							 * else. The caret and the active row carry the state instead.
							 * The Clear button beside it keeps its ring.
							 *
							 * `!` is load-bearing and not laziness: the app's ring is
							 * re-asserted by an Emotion-injected `html :focus-visible`
							 * rule from the MUI baseline, which is unlayered and so beats
							 * every Tailwind utility in `@layer utilities` regardless of
							 * specificity. An important declaration inside a layer is the
							 * only thing that outranks an unlayered normal one. See
							 * docs/branding.md § 8, "MUI wins specificity fights".
							 */
							className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none! placeholder:text-ink-dim"
						/>
						{localQuery && (
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Clear search"
								onClick={() => {
									setLocalQuery("");
									// Focus stays in the field: clearing is an edit, not a
									// navigation, and a mouse user who clears the box must
									// not have to click it to type the next query.
									document.getElementById(INPUT_ID)?.focus();
								}}
							>
								<X aria-hidden="true" />
							</Button>
						)}
					</div>

					{/*
					 * The list, and the fold.
					 *
					 * The wrapper is `relative` so the fold's fade can be an OVERLAY rather
					 * than something in the flow: `sticky` was the first cut of this, and a
					 * sticky element OCCUPIES LAYOUT, so every list that fitted its content
					 * came out 24px taller with a dead band above the footer (design round 2,
					 * D7). The overlay is painted over the scroll viewport's bottom edge
					 * instead, and both it and the end spacer inside are rendered only when
					 * rows were actually dropped — a list that fits is exactly as tall as its
					 * content, and a cut line has a cue rather than a hard edge (design round
					 * 1, D1).
					 */}
					{hasResults ? (
						<div className="relative">
							{outcome.clipped && (
								<div
									aria-hidden="true"
									className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-elevated to-transparent"
								/>
							)}
							<div
								// biome-ignore lint/a11y/useSemanticElements: `select`/`option` is a native popup control, not a listbox whose rows are browsed by aria-activedescendant while focus stays in a text field.
								role="listbox"
								id={LIST_ID}
								aria-label="Results"
								/* Focusable only programmatically: the query field keeps focus,
								   and this is here so the container can be scrolled into view. */
								tabIndex={-1}
								className="max-h-96 overflow-y-auto p-2"
							>
								{outcome.sections.map((section, sectionIndex) => (
									<Fragment key={section.group}>
										<div
											role="presentation"
											className={cn(
												"px-2 pb-1 text-ink-dim text-meta",
												sectionIndex === 0 ? "pt-1" : "pt-3",
											)}
										>
											{PALETTE_GROUP_TITLES[section.group]}
										</div>
										{section.items.map((match) => (
											<PaletteRow
												key={match.item.id}
												match={match}
												isActive={match.item.id === activeItem?.id}
												onHover={() => setSelectedIndex(matches.indexOf(match))}
												onRun={() => runItem(match.item)}
											/>
										))}
									</Fragment>
								))}
								{/*
								 * The end spacer: room to scroll the last row clear of the fade, and
								 * only when the list actually overflows.
								 */}
								{outcome.clipped && <div aria-hidden="true" className="h-6" />}
							</div>
						</div>
					) : (
						/*
						 * An empty state that says what to do next, and that does not
						 * claim to know more than it does: while the conversation
						 * search is still out, "no matches" is a statement the palette
						 * cannot yet make, so it says what it is doing instead.
						 */
						<div className="flex flex-col items-center gap-1 px-6 py-10 text-center">
							<p className="text-body-sm text-ink">
								{chats.awaiting
									? "Searching conversations…"
									: hasTerms
										? `No matches for “${outcome.terms}”`
										: "Nothing to show yet"}
							</p>
							<p className="text-ink-dim text-meta">
								{hasTerms
									? "Try another word, or narrow the search with a prefix below."
									: "Search for a chat, an agent by name, a setting, or a page such as Schedules."}
							</p>
						</div>
					)}

					{/*
					 * What the conversation search is doing, when it is not simply
					 * answering. Every one of these is a state a user would otherwise
					 * read as "the palette cannot find my chat": a request in flight, a
					 * backend without the route, and a query the store refuses are
					 * three different facts and only one of them is about the query.
					 */}
					{hasResults && hasTerms && chats.awaiting && (
						<p className="px-4 pt-2 text-ink-dim text-meta">
							Searching conversations…
						</p>
					)}
					{hasTerms && chats.overLong && (
						<p className="px-4 pt-2 text-ink-dim text-meta">
							Search terms are limited to {SESSION_SEARCH_MAX_CHARS} characters,
							so chats are matched by name.
						</p>
					)}
					{hasTerms && !chats.overLong && chats.unavailable && (
						<p className="px-4 pt-2 text-ink-dim text-meta">
							{chats.unreachable
								? "Conversation search is unavailable while the backend is unreachable, so chats are matched by name."
								: "Chats are matched by name. Update Local Operator to search inside conversations."}
						</p>
					)}

					{/*
					 * The legend bar. What it teaches swaps with the state, because the
					 * two states need different things: an empty box is where the
					 * prefixes are worth saying out loud, and a list with rows in it is
					 * where the keys are.
					 */}
					<div className="flex shrink-0 items-center gap-4 border-hairline border-t px-4 py-2 text-ink-dim text-meta">
						{showScopeLegend ? (
							<>
								{SCOPE_LEGEND.map((entry) => (
									<span key={entry.scope} className="flex items-center gap-1.5">
										<Key>{entry.glyph}</Key>
										{entry.label}
									</span>
								))}
								<span className="ml-auto flex items-center gap-1.5">
									<Key>esc</Key>
									to close
								</span>
							</>
						) : (
							<>
								<span className="flex items-center gap-1.5">
									<Key>↑</Key>
									<Key>↓</Key>
									to move
								</span>
								<span className="flex items-center gap-1.5">
									<Key>↵</Key>
									to run
								</span>
								<span className="flex items-center gap-1.5">
									{outcome.clipped && (
										<span>{`showing the best ${matchCount} of ${outcome.total} matches`}</span>
									)}
								</span>
								{/*
								 * `ml-auto` is on the escape affordance, not on the count: the count
								 * belongs beside the movement keys it qualifies, and two unrelated
								 * statements sharing one right-aligned slot read as one sentence
								 * (design round 1, D5).
								 */}
								<span className="ml-auto flex items-center gap-1.5">
									<Key>esc</Key>
									to close
								</span>
							</>
						)}
					</div>
				</DialogContent>
			</Dialog>
			<ConfirmationModal
				open={isClearConfirmationOpen}
				title="Clear this conversation?"
				message="Every message in it is deleted from this computer, and there is no undo. The agent itself is not affected."
				confirmText="Clear"
				cancelText="Cancel"
				isDangerous
				onConfirm={confirmClearConversation}
				onCancel={() => setIsClearConfirmationOpen(false)}
			/>
			{/* The create-agent dialog is rendered globally by App, driven by the same
			    store field this component reads to stand down its own keys. */}
		</>
	);
};

/**
 * One row.
 *
 * `onMouseMove` rather than `onMouseEnter`: the pointer only counts as a
 * selection when it actually MOVES, because the list scrolls underneath a
 * stationary pointer as the user walks it with the arrows — and a row that
 * selected itself on the way past would fight the keyboard.
 */
const PaletteRow: FC<{
	match: PaletteMatch;
	isActive: boolean;
	onHover: () => void;
	onRun: () => void;
}> = ({ match, isActive, onHover, onRun }) => {
	const { item, soft } = match;
	const verb = item.verb ?? KIND_VERBS[item.kind];
	return (
		<button
			id={item.id}
			type="button"
			// biome-ignore lint/a11y/useSemanticElements: an `option` element is only valid inside `select`/`datalist`; these rows carry an icon, a name, a hint and a key legend.
			role="option"
			aria-selected={isActive}
			/* Out of the tab order on purpose: focus belongs to the query field, and
			   Up and Down walk the list. */
			tabIndex={-1}
			onClick={onRun}
			onMouseMove={onHover}
			className={cn(
				"flex h-9 w-full items-center gap-3 rounded-sm px-2 text-left",
				"transition-colors duration-fast ease-out-quart",
				isActive ? "bg-accent-wash" : "bg-transparent",
			)}
		>
			<span
				className={cn(
					"flex size-4 shrink-0 items-center justify-center",
					/* The only colour in the list. Red on the one row that destroys
					   something is information; a hue per group taught the eye nothing. */
					item.destructive ? "text-danger" : "text-ink-dim",
				)}
			>
				<PaletteIcon name={item.icon} />
			</span>
			<span
				className={cn(
					"shrink-0 truncate text-body-sm",
					item.destructive
						? "text-danger"
						: /* A loose match is dimmed rather than hidden: the row is a guess
						     and says so, which is what keeps a subsequence hit from reading
						     as a wrong answer. */
							soft && !isActive
							? "text-ink-muted"
							: "text-ink",
				)}
			>
				{item.name}
			</span>
			{item.hint && (
				<span className="min-w-0 flex-1 truncate text-ink-dim text-meta">
					{item.hint}
				</span>
			)}
			{!item.hint && <span className="flex-1" />}
			{/* What Enter does, on the active row only. */}
			{isActive && (
				<span className="flex shrink-0 items-center gap-1.5 text-ink-dim text-meta">
					{verb}
					<Key>↵</Key>
				</span>
			)}
		</button>
	);
};
