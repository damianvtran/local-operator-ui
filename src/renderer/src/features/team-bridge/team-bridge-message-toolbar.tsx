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
			data-message-toolbar=""
			/* The reserved slot: one LINE tall (`1lh`, 21.7px at the body's 14/1.55),
			   so a one-line message keeps its height and the timeline's rhythm does
			   not change. The 28px toolbar is centred on it and overhangs 3px above
			   and 3px below. Below, that is inside the next line's 3.9px
			   half-leading, above its glyphs. Above, a header row has 6px of
			   padding (`pt-1.5`) to take it; a CONTINUATION row has only 2px
			   (`py-0.5`), so there the lighter ground reaches 1px into the row
			   above (design round 3, D15, deferred: 1px of an `elevated` ground
			   on hover only). The ground has no padding for that reason: a
			   padded 32px ground would reach the next line's glyphs. */
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
					forceVisible || pickerOpen
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
