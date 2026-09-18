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
 * One category row. Selected rows read as `accent-wash` with accent ink —
 * the same highlight language as every other selected row in the app — and
 * hover is a colour step to `elevated`, never a lift.
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
			selected
				? "bg-accent-wash font-semibold text-accent"
				: "text-ink hover:bg-elevated",
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
		/* A rail, not a card. The grid beside it is already eight bordered
			   panels; a ninth box around the filter list added a boundary that
			   carried no information. */
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
