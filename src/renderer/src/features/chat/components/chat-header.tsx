import {
	Avatar,
	AvatarFallback,
	Badge,
	Button,
	Skeleton,
	Tooltip,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { Bot, FileText, Globe } from "lucide-react";
import { type FC, useEffect, useRef } from "react";
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
	 * Two facts about the browser button, read once because the CLUSTER's spacing
	 * and the button's own render gate are decisions from the same pair.
	 *
	 * The badge is anchored 10px past this button's corner and paints a 2px ring, so
	 * a drawn badge needs 12px before the canvas button's box begins (design round 1,
	 * D5: below that the ring is painted inside a 32px control's hover target). That
	 * room is the CONTAINER's to give - `docs/branding.md` section 5, "a component
	 * does not own its outer margin" - so the cluster widens its own gap while an
	 * overhanging badge is on screen and pays nothing when there is none. A `mr-1`
	 * on the button used to carry it and could not be conditional without being the
	 * same anti-pattern: a margin on a component's root element stacks with whatever
	 * container it is dropped into, which is exactly the silent-mis-spacing failure
	 * that rule exists to prevent.
	 *
	 * Both facts are about the BUTTON rather than about the badge, and the pane half
	 * is why: while the browser pane is open this button is unmounted, so there is
	 * no badge on screen and no room to reserve, however many approvals are waiting.
	 */
	const browserButtonShown = Boolean(onOpenBrowser) && !isBrowserPaneOpen;
	const browserBadgeDrawn = browserButtonShown && browserAttentionCount > 0;

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
					 * 8px, the within-a-component step of branding.md's 4px ramp, in every
					 * state where no child paints outside its own box - which is the state
					 * the operator reported as uneven, because a `mr-1` on the browser button
					 * was paying the badge's 12px whether or not a badge was drawn. 12px
					 * while the badge IS drawn, which is the same room the reserve always
					 * was: the gap is set on the container so the two states are one spacing
					 * each and neither is a margin on a component.
					 *
					 * `gap-3` rather than 4px more between those two controls alone: the
					 * cluster then reads at ONE tier in each state, and the ramp's own warning
					 * is that mixed spacing tiers are what make a layout look unconsidered
					 * (branding.md section 5). The cost is stated rather than hidden: when a
					 * badge appears the cluster grows 8px, which moves the run trigger 8px left
					 * and leaves the browser and canvas buttons where they were - the cluster is
					 * `ml-auto`, so the right edge is the fixed end.
					 */
					browserBadgeDrawn ? "gap-3" : "gap-2",
				)}
			>
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
				{onOpenOptions && !isCanvasOpen && (
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
