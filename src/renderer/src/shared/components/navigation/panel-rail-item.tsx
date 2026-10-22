import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	type ButtonHTMLAttributes,
	type ReactNode,
	createContext,
	forwardRef,
	useContext,
	useLayoutEffect,
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
	/** The item's identity in the rail's order: `run`, `ask`, `browser`, `console`, `canvas`, `code`. */
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
	"bg-row-selected text-accent hover:bg-row-selected hover:text-accent active:bg-row-selected active:text-accent before:absolute before:inset-y-1 before:-start-[6px] before:w-0.5 before:rounded-full before:bg-accent";
const IDLE =
	"text-ink-muted hover:bg-row-hover hover:text-ink active:bg-row-hover active:text-ink";

export const PanelRailItem = forwardRef<HTMLButtonElement, PanelRailItemProps>(
	({ id, label, ariaLabel, pressed, children, className, ...props }, ref) => {
		const rail = useContext(PanelRailRovingContext);
		const register = rail?.register;
		useLayoutEffect(() => register?.(id), [register, id]);
		/*
		 * NO TOOLTIP ON THE RAIL (S5). The rail is a 44px column at the window's
		 * trailing edge, and the only place a label could open is LEFT — into the
		 * pane, which with the browser open is the native `WebContentsView`'s rect.
		 * Until S5 the shared tooltip hid the page while it was painted there; the
		 * kind table now says a tooltip never pauses the page, and a label that needs
		 * the page taken away to be readable is a placement defect, not a tooltip.
		 *
		 * Nothing can be repositioned inside 44px: a bottom/top placement wider than
		 * the column spills over the pane, and Radix shifts it inward rather than
		 * letting it clip. So the ruling's second option applies — the tooltip is
		 * dropped and the `aria-label` is the channel. The label is not lost to
		 * assistive tech, and the rail's icons are the five primary destinations,
		 * whose glyphs the app's own navigation does not hide behind a hint.
		 */
		return (
			<Button
				ref={ref}
				variant="ghost"
				size="icon"
				data-panel-rail-item={id}
				data-titlebar-no-drag=""
				aria-label={ariaLabel ?? label}
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
		);
	},
);
PanelRailItem.displayName = "PanelRailItem";
