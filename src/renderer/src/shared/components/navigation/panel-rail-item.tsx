import { useSuppressBrowserViewWhileReaching } from "@shared/browser-view-policy";
import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	type ButtonHTMLAttributes,
	type ReactNode,
	createContext,
	forwardRef,
	useContext,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

/**
 * One trigger on the panel rail (#872), and the roving-focus contract it shares
 * with its siblings.
 *
 * WHY THE ITEM AND THE RAIL ARE SEPARATE FILES. `RunDetailsTrigger` keeps its own
 * per-instance `seen` ledger and its own dot, so it renders a rail item itself,
 * while the rail renders the run trigger: the rail imports the trigger and the
 * trigger imports the item. One file holding both would make that a cycle.
 *
 * THE ROVING STATE IS THE RAIL'S AND REACHES THE ITEM BY CONTEXT, not by a prop,
 * because the run trigger sits between them. An item mounted outside a rail (a
 * story, a harness) simply keeps the browser's default tab order.
 */
export type PanelRailRoving = {
	/** The id whose item carries `tabIndex=0`; every other item is `-1`. */
	roving: string | null;
	/** Mount/unmount registration, so the rail knows which items exist. */
	register: (id: string) => () => void;
};

export const PanelRailRovingContext = createContext<PanelRailRoving | null>(
	null,
);

export type PanelRailItemProps = Omit<
	ButtonHTMLAttributes<HTMLButtonElement>,
	"aria-label" | "aria-pressed" | "children"
> & {
	/** The item's identity in the rail's order: `run`, `browser`, `console`, `canvas`, `code`. */
	id: string;
	/** The tooltip body: the sentence a pointer reads. */
	label: ReactNode;
	/** The accessible name; the tooltip and this are two spellings of one fact. */
	ariaLabel: string;
	/** Whether this item's panel is the one DRAWN in the slot right now. */
	pressed: boolean;
	children: ReactNode;
};

/**
 * `LIT` IS A GROUND, A GLYPH INK AND A BAR - ROLES ONLY (docs/branding.md).
 *
 * `bg-row-selected text-accent` is the panel's own "you are here" pair, the
 * sidebar's selected-row ground; the 2px `accent` bar on the panel-facing edge is
 * the non-colour second signal. The sidebar dropped its bar because `font-medium`
 * carries that channel for a text row; an icon-only rail has no weight to change,
 * so the bar is what survives a theme whose `rowSelected` sits close to `surface`.
 * The bar is a `before:` pseudo-element so it costs no layout, and it sits ON
 * THE RAIL'S LEADING EDGE (design round 1, D2 and D7; re-seated when the rail's
 * hairline came out): 6px outside the 32px control - the item is centred in the
 * 44px rail, so the gutter is 6px a side - and 2px wide, so its outer column IS
 * the rail's leading-edge column; it ends 4px outside the control, clear of the
 * keyboard focus ring, which is drawn at a 1px offset on this rail
 * (`focus-visible:outline-offset-1!`, below) and so occupies 1px-3px outside the
 * control. The offset was 6.5px while the rail wore a leading `border-l
 * border-hairline`: 6.5 = the 5.5px gutter the 1px border left, plus the border,
 * and the bar covered the hairline's column. With the border gone the gutter is
 * 6px, so an untouched 6.5 would have put the bar half a pixel OUTSIDE the rail,
 * straddling the pane; the re-seat keeps the bar's measured position identical
 * (pageX = the rail's leading edge, verified against the before/after frames).
 * Before that, the bar was at 2px-4px and the default 2px-offset ring at 2px-4px:
 * the same pixels, both `accent`, so a focused lit item showed ring only and lost
 * its non-colour "lit" signal in exactly the state a keyboard user is in.
 *
 * The ghost variant's own `hover:bg-accent-wash` is overridden on both states:
 * the wash is the transient "a pointer is here" idiom and `rowSelected` must keep
 * meaning "open" under a resting pointer, the defect `RunDetailsTrigger`'s old
 * comment records (design round 2, D2-1).
 */
const LIT =
	"bg-row-selected text-accent hover:bg-row-selected hover:text-accent active:bg-row-selected active:text-accent before:absolute before:inset-y-1 before:-left-[6px] before:w-0.5 before:rounded-full before:bg-accent";
const IDLE =
	"text-ink-muted hover:bg-row-hover hover:text-ink active:bg-row-hover active:text-ink";

export const PanelRailItem = forwardRef<HTMLButtonElement, PanelRailItemProps>(
	({ id, label, ariaLabel, pressed, children, className, ...props }, ref) => {
		const rail = useContext(PanelRailRovingContext);
		const register = rail?.register;
		useLayoutEffect(() => register?.(id), [register, id]);
		/*
		 * A RAIL TOOLTIP IS PAINTED OVER THE NATIVE BROWSER VIEW (design D1). The
		 * tooltips open `left`, into the pane, and with the Browser pane open that is
		 * the `WebContentsView`'s rect: a native view paints above ALL DOM, so the
		 * only visible label of three icon-only controls would vanish in the most-used
		 * state. The repo's own answer is the policy registry (`browser-view-policy`,
		 * the same call the pickers and the tab strip's menu make for a popover opened
		 * inside the pane area): hide the view for the span the tooltip is open.
		 * Scoped to that span and to this item (`useId`-suffixed, ref-counted), so a
		 * stray hover blanks the page for the tooltip's lifetime only and nothing is
		 * ever left suppressed - the registration is released by the effect cleanup
		 * on close, on unmount, and when the item goes absent. The cost is the page
		 * flash the policy header names as unmeasured (probe P11).
		 *
		 * AND ONLY WHEN IT REACHES THE VIEW (design round 2, D11). At 1280x900 only the
		 * Canvas item's tooltip overlaps the view's rect; the other three end above it,
		 * and on a draft none does, so registering for all four blanked the page for a
		 * hint that never touched it. `useSuppressBrowserViewWhileReaching` measures the
		 * open tooltip's painted box against the rect the browser surface reports to
		 * main, and ends the registration on pointer-leave / window blur as well as on
		 * close (a tooltip left open by an exit through the window edge would otherwise
		 * hold the page blank until the pointer returned).
		 *
		 * The tooltip's element is found through the trigger's own `aria-describedby`,
		 * which Radix points at the open panel: the wrapper exposes no content ref, and
		 * a document query for "the tooltip" would pick up another one.
		 */
		const [tooltipOpen, setTooltipOpen] = useState(false);
		const triggerRef = useRef<HTMLButtonElement | null>(null);
		useSuppressBrowserViewWhileReaching(
			tooltipOpen,
			"panel-rail-tooltip",
			() => {
				const id = triggerRef.current?.getAttribute("aria-describedby");
				return id ? document.getElementById(id) : null;
			},
		);
		return (
			/* Tooltips open TOWARD the pane (`left`): the rail is at the window's edge, so
			   the other three sides either leave the window or cover a sibling item. */
			<Tooltip content={label} side="left" onOpenChange={setTooltipOpen}>
				<Button
					ref={(node) => {
						triggerRef.current = node;
						if (typeof ref === "function") ref(node);
						else if (ref) ref.current = node;
					}}
					variant="ghost"
					size="icon"
					data-panel-rail-item={id}
					data-titlebar-no-drag=""
					aria-label={ariaLabel}
					aria-pressed={pressed}
					tabIndex={rail ? (rail.roving === id ? 0 : -1) : undefined}
					className={cn(
						"relative focus-visible:outline-offset-1!",
						pressed ? LIT : IDLE,
						className,
					)}
					{...props}
				>
					{children}
				</Button>
			</Tooltip>
		);
	},
);
PanelRailItem.displayName = "PanelRailItem";
