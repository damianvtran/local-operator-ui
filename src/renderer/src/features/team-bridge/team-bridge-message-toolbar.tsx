import { Button } from "@shared/components/ui/button";
import { Tooltip } from "@shared/components/ui/tooltip";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { MessageSquare, SmilePlus } from "lucide-react";
import {
	type ComponentProps,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	forwardRef,
	useEffect,
	useRef,
	useState,
} from "react";
import { TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD } from "./team-bridge-reaction-gate";
import {
	TeamBridgeReactionPicker,
	type TeamBridgeReactionState,
} from "./team-bridge-reactions";
import { TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD } from "./team-bridge-thread-gate";

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
 * WHERE IT SITS (visual refresh, 2026-11-04). An OVERLAY on the row's top
 * end edge, straddling the row above by 16px - Slack's and Discord's toolbar.
 * It used to be a one-line float in the content column, reserved at rest so
 * nothing reflowed; the cost was a ragged first line on every message (text
 * wrapped around an invisible 60px slot) and a toolbar that sat inside the
 * text rather than on the row. As an overlay it takes no layout at all, so
 * nothing moves when the pointer arrives - which is the rule the float was
 * protecting. It covers at most the previous message's last line, and only
 * while this row is hovered or focused.
 *
 * CHROME (docs/branding.md, "Elevation is a lightness step, not a shadow").
 * Borderless on `elevated`, and it carries the ONE shadow: it now leaves the
 * flow, which is exactly the class the shadow is reserved for (menu, dialog,
 * popover, tooltip - and this). The buttons are the shared `ghost` `icon-sm`
 * control: 28x28 hit targets (the floor is 24x24), the ghost hover step, and
 * the app-wide `:focus-visible` outline (never a box-shadow ring).
 *
 * KEYBOARD. One tab stop, the repo's roving-toolbar pattern (`panel-rail.tsx`,
 * horizontal here): Tab reaches the toolbar's roving button, ArrowLeft/Right
 * walk the buttons (mirrored in RTL), Home/End take the ends. It is revealed by
 * `:focus-within` on the row as well as hover, and stays visible while its
 * picker is open, so a keyboard user never operates an invisible
 * control. Radix returns focus to the react button when the picker closes.
 *
 * ONE-LEVEL THREADS. Reply-in-thread is offered only on a timeline root
 * (`canReply`): replies inside the thread pane get react and more, because a
 * reply to a reply would need nested threads, which the hub does not have.
 *
 * NO "MORE" MENU (agent review round 3 M4/F1, design round 3 D12). Team Bridge
 * has no per-message action beyond react and reply, so a More menu could only
 * repeat the two buttons beside it: a control and a tab stop with no
 * capability, 28px off every first line. It was also where a real defect
 * lived (choosing "Reply in thread" from the menu left focus on the More
 * button, because Radix returns focus to the trigger AFTER the thread pane
 * focused its close button). Removed until an action exists that has no
 * button of its own.
 *
 * ADDING AN ACTION. Add a `<ToolbarButton>` here (keep the toolbar at two to
 * four buttons; each one narrows the first line of every message by 30px).
 * Label it through `t()` (that is its `aria-label` AND its tooltip), gate it on
 * a capability prop the row passes in, spread `{...item()}` so it joins the
 * roving tab stop, and never give it its own position on the row. If an action
 * deserves no permanent button, reintroduce a "More" `DropdownMenu` whose
 * trigger is the LAST item, and when an item opens something that takes focus
 * (a pane, the picker) set a ref in its `onSelect` and `preventDefault()` in
 * the content's `onCloseAutoFocus`, or focus lands back on the trigger.
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
	const [roving, setRoving] = useState(0);
	const root = useRef<HTMLDivElement>(null);
	/* A callback-ref STATE, not a ref: the wrapper mounts only while the
	   toolbar renders, and the listeners below must follow it. */
	const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
	/*
	 * TUCKED INSIDE THE ROW WHEN THE ROW IS AT THE PANE'S TOP (UX round 1, U2).
	 * The overlay sits 16px above its row, so a row that starts within 16px of
	 * the scroll viewport's top edge had the toolbar's top cut off by the pane.
	 * On the row's hover or focus (when it is about to show), the row's top is
	 * measured against its scroll container, and the toolbar is placed 4px
	 * below that edge instead - inside the row, or lower still when the row's
	 * own top is already scrolled out (a `top-1` alone would still clip there).
	 * Measured on demand, not on scroll: it only matters at the moment it
	 * appears. `null` is the resting overlay (`-top-4`).
	 */
	const [tuck, setTuck] = useState<number | null>(null);
	useEffect(() => {
		const row = anchor?.closest<HTMLElement>("[data-message-id]");
		if (!row) return;
		const measure = () => {
			/* The clipping edge is the nearest SCROLL container (the page's and
			   the thread pane's Radix viewports), else the window - never the
			   row's own list: a day group's `<ol>` starts just above its first
			   row, and measuring against it tucked every day's first toolbar. */
			let clip: HTMLElement | null = row.parentElement;
			while (clip) {
				if (clip.hasAttribute("data-radix-scroll-area-viewport")) break;
				const { overflowY } = getComputedStyle(clip);
				if (overflowY === "auto" || overflowY === "scroll") break;
				clip = clip.parentElement;
			}
			const edge = clip ? clip.getBoundingClientRect().top : 0;
			const rowTop = row.getBoundingClientRect().top;
			setTuck(rowTop - edge < 16 ? Math.max(4, edge - rowTop + 4) : null);
		};
		row.addEventListener("pointerenter", measure);
		row.addEventListener("focusin", measure);
		return () => {
			row.removeEventListener("pointerenter", measure);
			row.removeEventListener("focusin", measure);
		};
	}, [anchor]);
	/* THE REACTIONS HOLD COVERS THE TOOLBAR CONTROL TOO. The picker is guarded
	   itself, but a counted-but-absent button would leave the roving tab stop
	   pointing at nothing, so the control is dropped here as well. */
	const canReact =
		TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD &&
		reactions !== undefined &&
		!reactions.disabled;
	/* THE HOLD COVERS THIS ROUTE TOO. `onReply` is the only way into the thread
	   pane from a row (button, keyboard, or a rig that passes the prop directly),
	   so it is dropped here rather than trusting every caller to omit it: the
	   button must not render, not render inert. */
	const reply = TEAM_BRIDGE_THREADS_SHIPPED_IN_THIS_BUILD ? onReply : undefined;
	const count = (canReact ? 1 : 0) + (reply ? 1 : 0);
	/* The tab stop is CLAMPED to the buttons that exist now: `roving` is the
	   index focus last rested on, and the list shrinks when the reader loses
	   an ability (react drops out when the conversation closes). An index past
	   the end would give no button `tabIndex=0` and Tab would skip the toolbar
	   (review round 3, M3). */
	let tabStop = Math.min(roving, Math.max(0, count - 1));
	/* A busy react button is `disabled` and cannot take focus, so the tab stop
	   must not sit on it, or the toolbar would have none while a toggle runs. */
	if (tabStop === 0 && canReact && reactions.unavailable && count > 1)
		tabStop = 1;

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

	if (!canReact && !reply) return null;
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
			ref={setAnchor}
			data-message-toolbar=""
			data-tucked={tuck !== null || undefined}
			style={tuck !== null ? { top: tuck } : undefined}
			/* Positioned against the row (`relative` on the `<li>`), 16px above its
			   top and 16px in from its end edge. `z-10` lifts it over the row above,
			   whose own inset hover box is `-z-10` inside its own stacking context.
			   `pointer-events-none` HERE, not only on the inner toolbar (agent review
			   round 1, M2): a `none` child passes its hit to a hit-testable parent,
			   so the wrapper's box swallowed clicks and selection on the row above
			   and made the pointer on message N count as hovering N+1. The inner
			   toolbar re-enables itself while it is visible. */
			className={cn(
				"pointer-events-none absolute end-4 z-10 flex",
				tuck === null && "-top-4",
			)}
		>
			<div
				ref={root}
				role="toolbar"
				data-glass-plane="floating"
				aria-label={t("ui.teamBridge.actions.label")}
				aria-orientation="horizontal"
				onKeyDown={onKeyDown}
				data-lo-floating=""
				className={cn(
					/* `shadow-overlay`: the contract's one shadow, for what leaves the
					   flow (design round 1, D5). */
					"flex h-8 items-center gap-0.5 rounded-sm bg-floating p-0.5 shadow-overlay",
					"transition-opacity duration-fast ease-out-quart",
					forceVisible || pickerOpen
						? "pointer-events-auto opacity-100"
						: /* Hidden means unhittable too: the overlay sits over the row
						     ABOVE, and an invisible toolbar must not eat its clicks. */
							"pointer-events-none opacity-0 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100",
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
				{reply && (
					<ToolbarButton
						{...item()}
						label={t("ui.teamBridge.replies.action")}
						onClick={reply}
					>
						<MessageSquare aria-hidden="true" />
					</ToolbarButton>
				)}
			</div>
		</div>
	);
}

/** A toolbar button: the shared ghost icon control, named through `t()`.
 * `label` is both the accessible name and the tooltip, which is the shared
 * `Tooltip` the chips in this feature already use, not the native `title`
 * (delayed and unthemed; design round 3, D13). Radix's `asChild` triggers (the
 * picker) inject a ref, handlers and aria-expanded, and position their content
 * against the ref, so it forwards the ref and everything else to the
 * `<Button>`; the tooltip's own trigger props merge onto the same element. */
const ToolbarButton = forwardRef<
	HTMLButtonElement,
	{ label: string; children: ReactNode } & Omit<
		ComponentProps<typeof Button>,
		"children"
	>
>(function ToolbarButton({ label, children, ...props }, ref) {
	return (
		<Tooltip content={label}>
			<Button
				ref={ref}
				type="button"
				variant="ghost"
				size="icon-sm"
				aria-label={label}
				{...props}
			>
				{children}
			</Button>
		</Tooltip>
	);
});
