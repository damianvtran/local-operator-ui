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
	SquareTerminal,
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
	 * Opens the conversation's console pane, or absent when this header has none.
	 *
	 * The fourth occupant of the same slot and the same shape as `onOpenBrowser`:
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
	const badgeText =
		browserAttentionCount > 9 ? "9+" : String(browserAttentionCount);
	const setCanvasOpen = useUiPreferencesStore((s) => s.setCanvasOpen);
	const isCanvasOpen = useUiPreferencesStore((s) => s.isCanvasOpen);
	// Read here rather than passed in: the pane is a property of the window's right
	// slot, so the control that opens it and the slot that renders it have to answer
	// from ONE field — the same reason the canvas button reads `isCanvasOpen` itself.
	const isBrowserPaneOpen = useUiPreferencesStore((s) => s.isBrowserPaneOpen);
	// The console's own field, read for the same reason and from the same place.
	const isConsolePaneOpen = useUiPreferencesStore((s) => s.isConsolePaneOpen);

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

	return (
		<div
			/*
			 * 40px and `shrink-0`, matching the canvas header - the peer bar this one
			 * sits beside, and the smallest step on the 4px ramp that holds ONE line:
			 * a 16px `text-heading` name against a 28px avatar.
			 *
			 * THE 16px THIS GIVES BACK IS THE POINT. The bar was 56px because it
			 * carried two lines - a `flex-col` with the 16px name over the 13px
			 * description - which is exactly the stack the report reads as dated: the
			 * identity of the thing being read, told in two registers stacked above the
			 * transcript. One line with the description as minor text to its right is
			 * how the reference board's Group B all read an entity header (Linear's
			 * issue bar, Raycast's result rows, Slack's channel header), and it costs
			 * 16px, which the transcript below now has.
			 *
			 * NO BOTTOM RULE, and this is a replacement rather than a deletion.
			 * `border-control border-b` was here because in a packaged build the rule
			 * was the only thing separating the header from the transcript's first row.
			 * That reasoning is superseded: the transcript now DISSOLVES as it
			 * approaches this bar - a top-edge mask on its own scroll container, in
			 * `styles/index.css` - so the boundary is a gradient the reader crosses
			 * rather than a line drawn across the window. Keeping the rule would also
			 * draw a hard edge exactly where the fade is meant to be soft, which is the
			 * "unneeded lines and decoration" the redesign is removing.
			 */
			className={cn(
				"flex h-10 shrink-0 flex-wrap items-center gap-2 px-4",
				/*
				 * THE NARROW COLUMN, AND WHY THE BAR WRAPS (design D3).
				 *
				 * A 220px conversation column is not exotic - it is what any 1380px window
				 * gives the moment a pane is opened - and the one-line identity this bar is
				 * built on did not survive it. Measured on the head before this rule: at
				 * column 220 the name and the description both measured 0px (the name is not
				 * truncated there, it is ABSENT) and the cluster ran 8px past the header's own
				 * content box; at column 300 in an 800x600 window the name measured 24px. The
				 * flex math is why: the description has no flex base at all, so it contributes
				 * nothing to shrink and the whole of it lands on the name.
				 *
				 * So below 620px of COLUMN - the app's own narrow step, and a container query
				 * rather than a viewport one for the reason `chat-measure.ts` states - the bar
				 * takes two 40px rows instead of one. The description is not rendered, the
				 * identity row stays at 40px in the band so a pane toolbar beside it still
				 * lines up, and the cluster takes a second 40px row of its own, right-aligned
				 * against the same 16px inset. Nothing is hidden that a pane needs: the
				 * cluster's triggers all remain on screen, one row lower.
				 *
				 * At the app's practical column floor (240px) the identity row is
				 * 240 - 32 - 28 - 8 = 172px, which holds a readable name.
				 */
				"@max-[620px]/chatcol:h-auto @max-[620px]/chatcol:gap-y-0",
			)}
			data-titlebar-drag=""
			data-tour-tag="chat-header"
		>
			{/* `size-7` (28px) is the transcript's own agent marker size, so one agent
			 * wears one face on one screen. The primitive's 32px default is the app's
			 * CONTROL size, and a 32px circle read a step large beside a 16px name in a
			 * 40px bar. The glyph stays `size-4`, sized by class rather than lucide's
			 * numeric `size` prop so a `size-*` sweep can see it. */}
			<Avatar data-titlebar-no-drag="" className={cn("size-7")}>
				<AvatarFallback>
					<Bot className={cn("size-4")} aria-hidden={true} />
				</AvatarFallback>
			</Avatar>
			{/* ONE LINE: name then description, on ONE BASELINE. The wrapper keeps
			 * `min-w-0 flex-1` for the reason it always had it - the block grows before
			 * the empty space to its right does, so the text truncates only once there is
			 * genuinely no room. `items-baseline` rather than `items-center`, because
			 * centring aligns each run's LINE BOX and the two runs are different type
			 * steps (16px heading, 13px body-sm), so their baselines landed 2px apart
			 * (measured on the rendered header: name baseline 26.0, description baseline
			 * 24.0, both line-box centres on 20) and the description read as lifted
			 * against the name. The two runs now share the coordinate a reader sees them
			 * on. The OUTER row keeps `items-center`, so the avatar and the action cluster
			 * are still centred against the bar rather than dropped to its baseline. */}
			<div
				data-titlebar-no-drag=""
				className={cn(
					"flex min-w-0 flex-1 items-baseline gap-2",
					/*
					 * `h-10` only in the two-row form, and `items-center` only there: the
					 * identity row has to BE the band's 40px when the cluster is not in it,
					 * which is what keeps a pane's toolbar aligned with this bar; and with
					 * the description gone there is no second baseline left for
					 * `items-baseline` to align against, so the name centres in the row it
					 * now owns alone. Widths, measured after this change, below.
					 */
					"@max-[620px]/chatcol:h-10 @max-[620px]/chatcol:items-center",
				)}
			>
				{/* `text-heading`, not `text-title`: branding.md reserves the 20px step
				 * for section and dialog titles and states that a desktop app has no
				 * hero. */}
				<h2 className={cn("min-w-0 truncate text-heading text-ink")}>
					{agentName}
				</h2>
				{/* NO SEPARATOR GLYPH (design round 1, D3, on the spec's own licence: "if
				 * it reads as fussy in the frames, drop the glyph and let `gap` do it"). A
				 * middle dot here is the same glyph the description already uses twice
				 * inside itself, at a different size and three quarters of a pixel off their
				 * line, so the reader gets three dots and no way to tell which is structure
				 * and which is punctuation. The runs are separated by the 8px `gap` and by
				 * the type steps themselves - 16px `ink` against 13px `ink-muted`.
				 *
				 * The PRIORITY between the two runs is expressed in flex terms rather than
				 * in prose, and it is worth stating exactly what those terms buy (design D3).
				 * The description is `flex-1` with a ZERO basis, so it has no flex base size:
				 * it consumes slack and can never be the reason a pixel leaves the name, and
				 * when the row has no slack at all it is already 0 - that is the description
				 * yielding first, in the strongest form. The name is the one that then shrinks
				 * (`min-w-0 truncate`) rather than pushing the action cluster off the bar. The
				 * `max-w-[45%]` cap is the third part: at 1380 the description was eating 411.5
				 * of the row's 612px (67%), so even where there IS slack it now takes at most
				 * 45% and the primary run reads first. What the zero basis could NOT fix is a
				 * row with no slack at all - that is the two-row rule on the header above, and
				 * the widths it is measured at are recorded there. */}
				{descriptionPending ? (
					/* `bg-elevated` for the same measured reason the transcript
					 * placeholder takes it: the header's ground is `canvas`, where the
					 * Skeleton default `sunken` is the system's weakest adjacent pair
					 * (deltaE00 1.89 in the dark brand palette, 1.25 in obsidian). The
					 * height matches the `text-body-sm` line it stands in and `shrink-0`
					 * holds its width, so holding the slot holds the row's height.
					 *
					 * `hidden` in the two-row form for the same reason the text below it
					 * is: it stands for the description, and a held slot for something
					 * that is not rendered is a gap, not a placeholder. */
					<Skeleton
						className={cn(
							"h-3 w-24 shrink-0 bg-elevated",
							"@max-[620px]/chatcol:hidden",
						)}
					/>
				) : (
					<span
						className={cn(
							"min-w-0 max-w-[45%] flex-1 truncate text-body-sm text-ink-dim",
							"@max-[620px]/chatcol:hidden",
						)}
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
				data-titlebar-no-drag=""
				className={cn(
					/*
					 * THE RULE THIS APPLIES. The container pays only for ink that would
					 * otherwise land in a NEIGHBOUR'S BOX - not for every child that paints
					 * outside itself. The run trigger's own attention dot overhangs its box by
					 * 2px and earns nothing, because the ordinary 8px step still separates it
					 * from the next box. The badge earns room for that reason and only while
					 * BOTH the badge and the box it has to clear are on screen; in every other
					 * arrangement the cluster is at its 8px step.
					 *
					 * 8px is the within-a-component step of branding.md's 4px ramp, and it is
					 * the state the operator photographed: a `mr-1` on the browser button paid
					 * the badge's 12px whether or not a badge was drawn, so the badge-free
					 * cluster read 8px against 12px. The room is the CONTAINER's now
					 * (branding.md section 5), so neither state is a margin on a component.
					 *
					 * THE ROOM IS A BOX AND NOT A WIDER `gap` (design round 2, D6). The room is
					 * owed to ONE pair - the badge's control and the control whose box the badge
					 * reaches into - while `gap` is the whole row's property: widening it to the
					 * pill's widest form also opens `trigger -> browser`, where nothing overhangs
					 * and there is nothing to clear. Measured on the rendered header, a 24px gap
					 * there puts 40px of air between the two glyphs against 24px in the
					 * badge-free state, which is the asymmetry the operator reported in the
					 * first place. The box below is that room and nothing else.
					 *
					 * WHAT SIZES IT, measured: the pill's outward ink. That used to be the fixed
					 * 10px overhang plus the 2px ring, because a right-anchored pill grew
					 * LEFTWARDS over the globe; moving the anchor to the GLYPH's corner (see the
					 * badge's own comment) makes the outward ink the pill's own width, and `9+`
					 * is the widest the app can reach: 25.45px placed 2px off the glyph's box,
					 * i.e. 21.45px between the two control boxes. The container's ordinary 8px
					 * step on either side of an 8px box is 24px, which covers that with 2.55px
					 * to spare.
					 *
					 * WHAT A BADGE COSTS, this tree against itself (measured on the rendered
					 * header, 560px frame, both brand palettes): the browser button and the run
					 * trigger move 16px LEFT TOGETHER - their own 8px step is unchanged, which is
					 * the point of putting the room in a box - and the console and canvas buttons
					 * do not move at all. Cluster 152 -> 168 (+16px), run trigger 392 -> 376,
					 * browser 432 -> 416, console 472 and canvas 512 unmoved. The pill's ring
					 * ends 2.55px inside the room at `9+` and 10.27px inside it at `one-approval`,
					 * clear of the console's box in both.
					 */
					"ml-auto flex items-center gap-2",
					/*
					 * THE CLUSTER'S OWN ROW (design D3). At `w-full` its hypothetical size IS
					 * the row's width, so it cannot share the first line with the identity and
					 * wraps to the second - which is the whole of how the two-row form is forced,
					 * rather than waiting for the cluster's own content to stop fitting (that
					 * would wrap at a column width decided by how many pane triggers happen to be
					 * on screen, not at the 620px step the bar is designed to). `justify-end`
					 * keeps its right edge on the same 16px inset it has in the one-row form, and
					 * `h-10` makes the row the band's height so the wrapped bar is exactly 80.
					 */
					"@max-[620px]/chatcol:h-10 @max-[620px]/chatcol:w-full @max-[620px]/chatcol:flex-wrap @max-[620px]/chatcol:justify-end",
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
								 * THE TWO OFFSETS ARE NOW DIFFERENT, and the vertical one is the 40px bar's
								 * arithmetic rather than a second spacing step. `-2.5` was chosen against the
								 * 56px bar, where the 32px control sat 12px down and a 10px outward move still
								 * left the badge 2px inside the bar. At 40px the same control sits 4px down, and
								 * measured on the rendered header `-2.5` puts the badge's box at y -2.3 to 13.7
								 * and its ring 4.3px ABOVE the bar's first pixel row - and `ChatHeader` is the
								 * first child of a chat column that is `overflow-hidden`, so that half of the
								 * pill was clipped on every platform, and on macOS the bar IS the window's top
								 * strip with nothing above it (design round 1, D2). `-1` is the smallest step
								 * that clears it: the box lands at 3.7 to 19.7 and the ring at 1.7 to 21.7, all
								 * inside the bar. It is measured rather than derived because the badge is an
								 * inline box inside a line box, so its top sits 3.7px below the wrapper's own -
								 * which is the reason the wrapper's offset and the pill's edge are not the same
								 * number. THE HORIZONTAL OFFSET IS NO LONGER A SECOND SPACING STEP: it was
								 * `-right-2.5` and it is now `left-6.5`, which the paragraph below derives
								 * from design round 2's D6.
								 *
								 * THE ANCHOR IS THE GLYPH'S CORNER, NOT THE BUTTON'S (design round 2, D6,
								 * measured at 9d6afce20 and at this head). A right-anchored pill grows
								 * LEFTWARDS, so the width of the glyph run decided its clearance from the
								 * Globe: at `9+` its box ran 440.55..466 while the glyph's box is 432..448, so
								 * its fill and its 2px ring crossed the upper-right arc and cut the stroke the
								 * badge is supposed to sit beside - the pill and the glyph merged into one
								 * run (432.5..465.5) where `one-approval` still had 1.5px of daylight. Above
								 * the bar's top edge the same overlap had been harmless because the pill was
								 * clipped there, which is exactly the trade D2 made when it dropped the pill
								 * into the bar. Anchoring the LEFT edge instead - `left-6.5` is the 16px
								 * glyph's box right (8px inset + 16px) plus the 2px ring - makes the
								 * clearance a property of the anchor rather than of the count, and the pill
								 * grows RIGHTWARDS into room the container reserves for it (the cluster's own
								 * comment carries that arithmetic). Measured at this head, `9+`: the glyph's
								 * box is 424..440, the pill's 442..467.45 and its ring 440..469.45 - 2px of
								 * clearance at every count, against 0.27px at `one-approval` and a 7.45px
								 * intrusion at `9+` before the change. A reserve INSIDE the control (the
								 * Approvals idiom, `pr-5` on a labelled button) was the other way out and was
								 * refused on measurement: a 32px `icon` button holds a 16px glyph with 8px of
								 * slack on either side, so the glyph can move at most 8px inside it, and 9.45px
								 * is what `9+` needs - that reserve would have had to overflow the control.
								 *
								 * THE VISUAL IS CAPPED, THE LABEL IS NOT, and the cap is what lets the room be a
								 * static number rather than a measurement taken at render time. `min-w-4 px-1`
								 * grows with every digit, so a badge that could reach three digits would walk
								 * past the 24px the container reserves the moment a tenth request arrived -
								 * which is a state the operator asked for a QUEUE and will therefore reach.
								 * `9+` is the badge's own grammar and 25.45px is its widest painted form; the
								 * exact ordinal stays in the tooltip and the `aria-label`, which are read
								 * rather than glanced at (spec 5.1).
							 */}
							{browserBadgeDrawn && (
								<span
									className={cn("pointer-events-none absolute -top-1 left-6.5")}
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
				{/*
				 * The badge's room, as the CONTAINER's box rather than a wider `gap` on the
				 * cluster (the cluster's own comment carries the rule and the arithmetic).
				 * It is owed between the badge's control and its neighbour only, so it is
				 * rendered only while there is a box on the right for the badge to reach
				 * into - the console, or the canvas when the console is unmounted. An empty
				 * box rather than a `mr-1` on the button for the reason branding.md § 5
				 * gives: the room belongs to the container, and the operator's report was
				 * precisely that a component's own margin paid it in every state.
				 */}
				{browserBadgeDrawn && (consoleButtonShown || canvasButtonShown) && (
					<span aria-hidden={true} className="w-2 shrink-0" />
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
				 * terminals told apart at a glance in one 40px bar is the whole
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
							className={cn("relative")}
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
