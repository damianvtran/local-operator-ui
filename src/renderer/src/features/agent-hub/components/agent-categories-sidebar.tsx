import { rowCurrent } from "@features/chat/components/chat-sidebar";
import { cn } from "@shared/lib/utils";
import { CircleEllipsis, Layers } from "lucide-react";
import type { FC } from "react";
import { CATEGORY_ICON_MAP, categoryEntry } from "./agent-tags-and-categories";

type AgentCategoriesSidebarProps = {
	selectedCategory: string | null;
	onSelectCategory: (category: string | null) => void;
	/**
	 * The categories to offer, from the records the hub has actually returned.
	 *
	 * This rail used to be `Object.keys(CATEGORY_ICON_MAP)` — the sixteen keys of
	 * the server's enum — so it offered sixteen filters whether or not the hub
	 * held a single agent in one, and clicking most of them emptied the grid
	 * with no way to tell "no agents here" from "that filter is a placeholder".
	 * A rail built from the results cannot offer a category nothing carries.
	 *
	 * There are no counts beside these rows, and that is the API's limit rather
	 * than a choice: `GET /v1/agents` has no facet or group-by, so the only
	 * number this surface could print is how many of the twelve records on
	 * screen carry the category — a page count wearing a filter's clothes.
	 */
	categories: readonly string[];
};

/**
 * One category row.
 *
 * The selected row is the SAME role every other selected row in the app takes —
 * `rowCurrent`, imported rather than restated, so this sidebar cannot drift from
 * it. Its docstring used to claim that while painting `bg-accent-wash` with
 * accent ink, which was neither: the chat panel and the settings rail had already
 * moved off the wash, and on 6 of the 41 dark themes the wash is a weaker mark
 * than the hover beside it. The hover takes the other row role, `rowHover`; it is
 * a colour step, never a lift.
 *
 * THE GROUND IS CARRIED BY THE COLUMN, not by this row: it is
 * `agent-hub-page.tsx`'s `[data-tour-tag="agent-hub-sidebar-container"]` div, and
 * it wears `bg-surface` because both row roles are authored as steps of the
 * palette's own `surface` (docs/design/row-states-refinement.md § 4). Painted on
 * the page's `canvas` — which is what these rows were painted on until the
 * refinement round — the current row's fill measured ΔE00 0.83 off its own
 * backdrop on `kanagawaLotus`. `scripts/chat-sidebar-selection.test.mjs` asserts
 * that ancestor for every call site in the tree that paints a row state.
 */
const CategoryItem: FC<{
	selected: boolean;
	onClick: () => void;
	"data-testid"?: string;
	children: React.ReactNode;
}> = ({ selected, onClick, children, ...rest }) => (
	<button
		type="button"
		onClick={onClick}
		aria-pressed={selected}
		className={cn(
			"flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-3 py-1.5 text-left",
			"text-body-sm transition-colors duration-fast ease-out-quart",
			selected ? rowCurrent : "text-ink hover:bg-row-hover",
		)}
		{...rest}
	>
		{children}
	</button>
);

/**
 * The enum's own order, for the rows the enum knows.
 *
 * A rail whose order follows the results would reshuffle as pages change, which
 * makes a filter harder to find the second time; unknown keys sort after the
 * known ones rather than interrupting them.
 */
const ENUM_ORDER = Object.keys(CATEGORY_ICON_MAP);

const inRailOrder = (categories: readonly string[]) =>
	[...categories].sort((left, right) => {
		const a = ENUM_ORDER.indexOf(left);
		const b = ENUM_ORDER.indexOf(right);
		if (a !== -1 && b !== -1) return a - b;
		if (a !== -1) return -1;
		if (b !== -1) return 1;
		return left.localeCompare(right);
	});

/**
 * Sidebar for selecting agent categories.
 */
export const AgentCategoriesSidebar: FC<AgentCategoriesSidebarProps> = ({
	selectedCategory,
	onSelectCategory,
	categories,
}) => {
	/*
	 * The selected category is kept on the rail even when the filtered result
	 * no longer carries it, because the one thing a user needs after selecting
	 * a filter is the control that clears it.
	 */
	const offered = inRailOrder(
		selectedCategory && !categories.includes(selectedCategory)
			? [...categories, selectedCategory]
			: categories,
	);

	return (
		/* A rail, not a card — and it is a PANEL now, because it paints row states.
			   The reasoning this element used to carry (the grid beside it is already
			   eight bordered panels, so a ninth box around the filter list added a
			   boundary that carried no information) is superseded rather than deleted:
			   the `bg-surface` belongs to the COLUMN in `agent-hub-page.tsx`, which is
			   a ground rather than a border, and it is the ground the two row roles are
			   authored against. See the `CategoryItem` docstring above for the
			   measurement that moved it. */
		<div className="flex h-full flex-col overflow-y-auto">
			<h2 className="mb-2 px-3 font-medium text-ink-dim text-meta">
				Categories
			</h2>
			<div className="flex flex-col gap-0.5">
				<CategoryItem
					selected={selectedCategory === null}
					onClick={() => onSelectCategory(null)}
					data-testid="category-all"
				>
					<span className="flex size-4 shrink-0 items-center justify-center">
						<Layers size={16} aria-hidden="true" />
					</span>
					All categories
				</CategoryItem>
				{offered.map((cat) => {
					const entry = categoryEntry(cat);
					// Use a special icon for "other"
					const icon =
						cat === "other" ? <CircleEllipsis size={16} /> : entry.icon;
					return (
						<CategoryItem
							key={cat}
							selected={selectedCategory === cat}
							onClick={() => onSelectCategory(cat)}
							data-testid={`category-${cat}`}
						>
							<span className="flex size-4 shrink-0 items-center justify-center">
								{icon}
							</span>
							{entry.label}
						</CategoryItem>
					);
				})}
			</div>
		</div>
	);
};
