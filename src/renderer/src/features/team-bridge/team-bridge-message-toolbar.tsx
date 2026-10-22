import { Button } from "@shared/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { MessageSquare, MoreHorizontal, SmilePlus } from "lucide-react";
import {
	type ComponentProps,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	forwardRef,
	useRef,
	useState,
} from "react";
import {
	TeamBridgeReactionPicker,
	type TeamBridgeReactionState,
} from "./team-bridge-reactions";

/**
 * The ONE hover toolbar on a Team Bridge message row: react, reply in thread,
 * and more — Slack's and Discord's message toolbar.
 *
 * WHY ONE TOOLBAR (stack-integration finding, #1304 x #1308). Threads (#1304)
 * added a hover-revealed reply button at the row's top-right, and reactions
 * (#1308) added a hover-revealed add-reaction pill at the row's top-right.
 * Each was right alone; together they painted on top of each other. Two
 * features each owning a corner of the same row will collide again with the
 * next feature, so the row owns ONE action surface and features contribute
 * buttons to it. The old affordances are gone: `TeamBridgeReactionChips` draws
 * nothing for a message without reactions, and the row no longer renders its
 * own reply button.
 *
 * WHERE IT SITS, AND WHY IT CANNOT OVERLAP. The toolbar is a FLOAT at the end
 * of the message's content column, one line tall (`1lh`), placed before
 * the header and body. Text, the name/time line, reaction chips, the thread
 * summary and attachment thumbnails therefore flow AROUND it: the browser's
 * own float layout guarantees no overlap at every width (1280, 800, the
 * 26rem thread pane), with no measuring and no breakpoints. The slot is
 * reserved at rest and only its opacity changes, so the row never reflows when
 * the pointer arrives — nothing moves on hover (docs/branding.md).
 * A Slack-style overlay that straddles the previous row was rejected for that
 * reason: it covers the previous message's last line.
 *
 * CHROME (docs/branding.md, "Elevation is a lightness step, not a shadow").
 * Borderless; its ground is `elevated`, one lightness step above the row's
 * `surface`/`row-hover`. NO shadow: the one shadow is reserved for objects that
 * leave the flow (menu, dialog, drawer, popover, tooltip, select), and this
 * toolbar is in the flow — it is a float in the content column. The menu and
 * the picker it opens DO leave the flow and carry the shadow through their
 * primitives. The buttons are the shared `ghost` `icon-sm` control: 28x28 hit
 * targets (the floor is 24x24), the ghost hover step, and the app-wide
 * `:focus-visible` outline (never a box-shadow ring).
 *
 * KEYBOARD. One tab stop, the repo's roving-toolbar pattern (`panel-rail.tsx`,
 * horizontal here): Tab reaches the toolbar's roving button, ArrowLeft/Right
 * walk the buttons (mirrored in RTL), Home/End take the ends. It is revealed by
 * `:focus-within` on the row as well as hover, and stays visible while its
 * menu or picker is open, so a keyboard user never operates an invisible
 * control. Radix returns focus to the pressing button when the menu or picker
 * closes.
 *
 * ONE-LEVEL THREADS. Reply-in-thread is offered only on a timeline root
 * (`canReply`): replies inside the thread pane get react and more, because a
 * reply to a reply would need nested threads, which the hub does not have.
 *
 * "MORE". There is no per-message menu elsewhere in Team Bridge yet, so More
 * holds the actions already on the row — reply in thread and add reaction —
 * and nothing else. It exists so the toolbar's shape does not change when
 * actions without a button of their own arrive (copy link, edit, delete).
 *
 * ADDING AN ACTION. Add a `<ToolbarButton>` here if it deserves a permanent
 * button (keep the toolbar at three or four; each button narrows the first
 * line of every message by 32px), or a `<DropdownMenuItem>` under More if it
 * does not. Label it through `t()`, gate it on a capability prop the row
 * passes in, and never give it its own position on the row.
 */
export function TeamBridgeMessageToolbar({
	reactions,
	onReply,
	forceVisible = false,
}: {
	/** The row's reaction state, when this reader may react here. */
	reactions?: TeamBridgeReactionState;
	/** Open this message's thread; omitted on replies (one-level threads). */
	onReply?: () => void;
	/** Story/capture seed only: show the toolbar without hover or focus. */
	forceVisible?: boolean;
}) {
	const [pickerOpen, setPickerOpen] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	// Set when "Add reaction" is chosen from More: the menu's close must hand
	// focus to the picker instead of back to the More button.
	const openPickerAfterMenu = useRef(false);
	const [roving, setRoving] = useState(0);
	const root = useRef<HTMLDivElement>(null);
	const canReact = reactions !== undefined && !reactions.disabled;
	/* A busy react button is `disabled` and cannot take focus, so the tab stop
	   must not sit on it, or the toolbar would have none while a toggle runs. */
	const tabStop =
		roving === 0 && canReact && reactions.unavailable ? 1 : roving;

	const buttons = () =>
		Array.from(
			root.current?.querySelectorAll<HTMLElement>("[data-toolbar-item]") ?? [],
		);
	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
		if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
			return;
		const list = buttons();
		const at = list.indexOf(document.activeElement as HTMLElement);
		if (at < 0) return;
		const rtl =
			root.current !== null &&
			getComputedStyle(root.current).direction === "rtl";
		const forward = (event.key === "ArrowRight") !== rtl;
		const next =
			event.key === "Home"
				? 0
				: event.key === "End"
					? list.length - 1
					: Math.max(0, Math.min(list.length - 1, at + (forward ? 1 : -1)));
		event.preventDefault();
		list[next]?.focus();
	};

	if (!canReact && !onReply) return null;
	let index = 0;
	const item = () => {
		const mine = index++;
		return {
			"data-toolbar-item": "",
			tabIndex: mine === tabStop ? 0 : -1,
			onFocus: () => setRoving(mine),
		};
	};

	return (
		<div
			data-message-toolbar=""
			/* The reserved slot: one LINE tall (`1lh`, 21.7px at the body's 14/1.55),
			   so a one-line message keeps its height and the timeline's rhythm does
			   not change. The 28px toolbar is centred on it and overhangs 3px above
			   (into the row's own top padding) and 3px below (inside the next line's
			   3.9px half-leading, above its glyphs). That is why the ground has no
			   padding: a padded 32px ground would reach the next line's glyphs. */
			className="float-end ms-2 flex h-[1lh] items-center"
		>
			<div
				ref={root}
				role="toolbar"
				aria-label={t("ui.teamBridge.actions.label")}
				aria-orientation="horizontal"
				onKeyDown={onKeyDown}
				className={cn(
					"flex items-center gap-0.5 rounded-md bg-elevated",
					"transition-opacity duration-fast ease-out-quart",
					forceVisible || pickerOpen || menuOpen
						? "opacity-100"
						: "opacity-0 group-focus-within/message:opacity-100 group-hover/message:opacity-100",
				)}
			>
				{canReact && reactions && (
					<TeamBridgeReactionPicker
						state={reactions}
						open={pickerOpen}
						onOpenChange={setPickerOpen}
					>
						<ToolbarButton
							{...item()}
							label={t("ui.teamBridge.reactions.add")}
							disabled={reactions.unavailable}
						>
							<SmilePlus aria-hidden="true" />
						</ToolbarButton>
					</TeamBridgeReactionPicker>
				)}
				{onReply && (
					<ToolbarButton
						{...item()}
						label={t("ui.teamBridge.replies.action")}
						onClick={onReply}
					>
						<MessageSquare aria-hidden="true" />
					</ToolbarButton>
				)}
				<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
					<DropdownMenuTrigger asChild>
						<ToolbarButton {...item()} label={t("ui.teamBridge.actions.more")}>
							<MoreHorizontal aria-hidden="true" />
						</ToolbarButton>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="end"
						onCloseAutoFocus={(event) => {
							if (!openPickerAfterMenu.current) return;
							openPickerAfterMenu.current = false;
							event.preventDefault();
							setPickerOpen(true);
						}}
					>
						{onReply && (
							<DropdownMenuItem onSelect={onReply}>
								<MessageSquare aria-hidden="true" />
								<span>{t("ui.teamBridge.replies.action")}</span>
							</DropdownMenuItem>
						)}
						{canReact && reactions && (
							<DropdownMenuItem
								disabled={reactions.unavailable}
								onSelect={() => {
									openPickerAfterMenu.current = true;
								}}
							>
								<SmilePlus aria-hidden="true" />
								<span>{t("ui.teamBridge.reactions.add")}</span>
							</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}

/** A toolbar button: the shared ghost icon control, named through `t()`.
 * Radix's `asChild` triggers (the menu, the picker) inject a ref, handlers and
 * aria-expanded, and position their content against the ref, so it forwards
 * the ref and everything else to the `<Button>`. */
const ToolbarButton = forwardRef<
	HTMLButtonElement,
	{ label: string; children: ReactNode } & Omit<
		ComponentProps<typeof Button>,
		"children"
	>
>(function ToolbarButton({ label, children, ...props }, ref) {
	return (
		<Button
			ref={ref}
			type="button"
			variant="ghost"
			size="icon-sm"
			aria-label={label}
			title={label}
			{...props}
		>
			{children}
		</Button>
	);
});
