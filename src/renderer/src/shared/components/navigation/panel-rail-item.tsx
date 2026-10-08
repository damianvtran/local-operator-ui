import { Button, Tooltip } from "@shared/components/ui";
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
	/** The item's identity in the rail's order: `run`, `browser`, `console`, `canvas`. */
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
 * The bar is a `before:` pseudo-element so it costs no layout, and it sits 4px
 * outside the 32px control, i.e. inside the 44px rail's own 5.5px gutter and clear
 * of the rail's leading hairline, so it reads as the panel-facing edge of the item
 * rather than as a second border.
 *
 * The ghost variant's own `hover:bg-accent-wash` is overridden on both states:
 * the wash is the transient "a pointer is here" idiom and `rowSelected` must keep
 * meaning "open" under a resting pointer, the defect `RunDetailsTrigger`'s old
 * comment records (design round 2, D2-1).
 */
const LIT =
	"bg-row-selected text-accent hover:bg-row-selected hover:text-accent active:bg-row-selected active:text-accent before:absolute before:inset-y-1 before:-left-1 before:w-0.5 before:rounded-full before:bg-accent";
const IDLE =
	"text-ink-muted hover:bg-row-hover hover:text-ink active:bg-row-hover active:text-ink";

export const PanelRailItem = forwardRef<HTMLButtonElement, PanelRailItemProps>(
	({ id, label, ariaLabel, pressed, children, className, ...props }, ref) => {
		const rail = useContext(PanelRailRovingContext);
		const register = rail?.register;
		useLayoutEffect(() => register?.(id), [register, id]);
		return (
			/* Tooltips open TOWARD the pane (`left`): the rail is at the window's edge, so
			   the other three sides either leave the window or cover a sibling item. */
			<Tooltip content={label} side="left">
				<Button
					ref={ref}
					variant="ghost"
					size="icon"
					data-panel-rail-item={id}
					data-titlebar-no-drag=""
					aria-label={ariaLabel}
					aria-pressed={pressed}
					tabIndex={rail ? (rail.roving === id ? 0 : -1) : undefined}
					className={cn("relative", pressed ? LIT : IDLE, className)}
					{...props}
				>
					{children}
				</Button>
			</Tooltip>
		);
	},
);
PanelRailItem.displayName = "PanelRailItem";
