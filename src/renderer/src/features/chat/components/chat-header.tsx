import {
	Avatar,
	AvatarFallback,
	Badge,
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Skeleton,
	Tooltip,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import {
	Archive,
	ArchiveRestore,
	Bot,
	FileText,
	Globe,
	MoreHorizontal,
	Trash2,
} from "lucide-react";
import { type FC, useEffect, useRef } from "react";
import { archiveControlLabel } from "../chat-archived";
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
	 * Opens the conversation's browser pane, or absent when this header cannot
	 * (`ChatContent` passes it only where there is a pane to open).
	 *
	 * The same shape as `onOpenOptions` above, and for the same reason: the canvas
	 * button is rendered from whether a host offered the action, so the header never
	 * has to know which routes or environments have a canvas — or, here, a browser.
	 * It hides while the pane is open, exactly as the canvas button does, because the
	 * pane carries its own close and a trigger for a pane that is already up is a
	 * no-op with a tooltip. The run trigger beside it stays visible as a toggle, and
	 * that difference is deliberate: the canvas and the browser are surfaces you
	 * summon and dismiss, where the run details are a pane you flip in and out of
	 * while reading (`docs/run-sidebar.md` § 3.4).
	 */
	onOpenBrowser?: () => void;
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
	 */
	onSetArchived?: (archived: boolean) => void;
	deleteEnabled?: boolean;
	onRequestDelete?: () => void;
};

export const ChatHeader: FC<ChatHeaderProps> = ({
	agentName = "Local Operator",
	description = "Your on-device AI assistant",
	descriptionPending = false,
	onOpenOptions,
	runDetails = null,
	fileCount = 0,
	mcpServers = [],
	listOnScreen = false,
	readerChildId = null,
	onOpenBrowser,
	browserAttentionCount = 0,
	archived = false,
	archiveEnabled = false,
	onSetArchived,
	deleteEnabled = false,
	onRequestDelete,
}) => {
	/*
	 * What the badge SHOWS, which is not always what it counts (design round 1, D5):
	 * a badge fixed to a 16px icon cannot grow past its own corner, so from the
	 * tenth request on it reads `9+` while the tooltip and the `aria-label` keep the
	 * exact number. Only the glyph is capped - a user who needs the count reads it,
	 * and a user who needs to know it is a lot sees that too.
	 */
	const badgeText =
		browserAttentionCount > 9 ? "9+" : String(browserAttentionCount);
	const setCanvasOpen = useUiPreferencesStore((s) => s.setCanvasOpen);
	const isCanvasOpen = useUiPreferencesStore((s) => s.isCanvasOpen);
	// Read here rather than passed in: the pane is a property of the window's right
	// slot, so the control that opens it and the slot that renders it have to answer
	// from ONE field — the same reason the canvas button reads `isCanvasOpen` itself.
	const isBrowserPaneOpen = useUiPreferencesStore((s) => s.isBrowserPaneOpen);

	const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
	const shortcut = isMac ? "⌘+Shift+C" : "Ctrl+Shift+C";

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
	 * Each fact is about a CHILD rather than about the badge alone, and the two pane
	 * halves are why: while the browser pane is open the browser button is unmounted,
	 * so there is no badge on screen and no room to reserve, however many approvals
	 * are waiting; and while the canvas is open the canvas button is unmounted, so the
	 * badge has no neighbour's box to land in and the room would be spent on a control
	 * that is not rendered.
	 */
	const browserButtonShown = Boolean(onOpenBrowser) && !isBrowserPaneOpen;
	const browserBadgeDrawn = browserButtonShown && browserAttentionCount > 0;
	const canvasButtonShown = Boolean(onOpenOptions) && !isCanvasOpen;

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

	return (
		<div
			/*
			 * 56px and `shrink-0`, matching the bar band its peers occupy: 52px
			 * command palette, 48px nav rail header, 40px canvas header. The old
			 * `h-21` declared 84px - 1.6x the largest peer - and, without `shrink-0`,
			 * never drew it: the column's flex deficit came out of this box, so it
			 * rendered 46.5px at one window size and 61.4px at another. A height that
			 * moves with composer content cannot be designed against, which is why
			 * the geometry is pinned before anything here is styled.
			 *
			 * 56 rather than 52: this bar carries two lines (16px name over 13px
			 * description, about 41px of text), where the command palette carries
			 * one. It is the smallest step on the 4px ramp that holds both without
			 * crowding them.
			 *
			 * `border-control`, not `hairline`, for the bottom rule. This line is
			 * what says the title block is chrome and the transcript below it is
			 * content - branding.md's own test for a structural boundary is
			 * whether removing it loses information, and here it does. As
			 * `hairline` it measured 1.32:1 against the sidebar's own header rule
			 * 8px away at 4.18:1: two rules at the top of one window drawn 3.2x
			 * apart, with the chat one the faint one. It matters more in a
			 * packaged build than these frames suggest, because the Chat/Raw tab
			 * row beneath it is `isDevelopmentMode()`-gated - in production this
			 * rule sits directly against the transcript's first row and is the
			 * only thing separating them.
			 */
			className={cn(
				"flex h-14 shrink-0 items-center gap-3 border-control border-b px-4",
			)}
			data-tour-tag="chat-header"
		>
			{/* No `size-*` override: the Avatar primitive's own 32px is the app's
			 * control size, and the 40px override made the same agent wear two
			 * different faces on one screen against the transcript's 28px marker.
			 * The glyph is sized by class rather than lucide's numeric `size` prop
			 * so a `size-*` sweep can see it; 16px is the ramp's default step and
			 * what a 32px circle carries. */}
			<Avatar>
				<AvatarFallback>
					<Bot className={cn("size-4")} aria-hidden={true} />
				</AvatarFallback>
			</Avatar>
			{/* `flex-1` as well as `min-w-0`: the block was min-w-0 inside a row
			 * whose only other content is an `ml-auto` action, so it yielded before
			 * the empty space did - the description clipped mid-sentence at 760px
			 * while 220px of bar sat unused to its right. Growing first means the
			 * text truncates only once there is genuinely no room left. */}
			<div className={cn("flex min-w-0 flex-1 flex-col")}>
				{/* `text-heading`, not `text-title`: branding.md reserves the 20px step
				 * for section and dialog titles and states that a desktop app has no
				 * hero. 20px over 13px also skipped two ramp steps in one bar. */}
				<h2 className={cn("truncate text-heading text-ink")}>{agentName}</h2>
				{descriptionPending ? (
					/* `bg-elevated` for the same measured reason the transcript
					 * placeholder takes it: the header's ground is `canvas`, where the
					 * Skeleton default `sunken` is the system's weakest adjacent pair
					 * (deltaE00 1.89 in the dark brand palette, 1.25 in obsidian). The
					 * height matches the `text-body-sm` line it stands in, so holding
					 * the slot holds the row's height too. */
					<Skeleton className={cn("h-3 w-24 bg-elevated")} />
				) : (
					<span
						className={cn("truncate text-ink-muted text-body-sm")}
						title={description}
					>
						{description}
					</span>
				)}
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
			 * canvas and browser buttons keep their own hide-when-open rule
			 * (`onOpenOptions && !isCanvasOpen`, `onOpenBrowser && !isBrowserPaneOpen`),
			 * because a button that re-opens the pane already on screen is a no-op with a
			 * tooltip; the run trigger stays, because it is a TOGGLE with an `aria-pressed`
			 * ground and that is exactly what makes the swap reversible.
			 */}
			<div
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
				{(archiveEnabled || deleteEnabled) && (
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
				    the canvas button. */}
				{browserButtonShown && (
					<Tooltip
						content={
							browserAttentionCount > 0
								? `Open browser — ${browserAttentionCount} ${browserAttentionCount === 1 ? "approval" : "approvals"} waiting`
								: "Open browser"
						}
						side="top"
					>
						<Button
							ref={browserButtonRef}
							variant="ghost"
							size="icon"
							onClick={onOpenBrowser}
							aria-label={
								browserAttentionCount > 0
									? `Open browser, ${browserAttentionCount} waiting`
									: "Open browser"
							}
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
										className={cn(
											"h-4 min-w-4 justify-center px-1 tabular-nums ring-2 ring-canvas",
										)}
										data-tour-tag="browser-pane-badge"
									>
										{badgeText}
									</Badge>
								</span>
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
							className={cn("relative")}
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
		</div>
	);
};
