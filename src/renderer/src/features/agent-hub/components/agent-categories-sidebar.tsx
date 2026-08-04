import { cn } from "@shared/lib/utils";
import { CircleEllipsis, Layers } from "lucide-react";
import type { FC } from "react";
import { CATEGORY_ICON_MAP } from "./agent-tags-and-categories";

type AgentCategoriesSidebarProps = {
	selectedCategory: string | null;
	onSelectCategory: (category: string | null) => void;
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
			"flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left",
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
 * Sidebar for selecting agent categories.
 */
export const AgentCategoriesSidebar: FC<AgentCategoriesSidebarProps> = ({
	selectedCategory,
	onSelectCategory,
}) => {
	const categories = Object.keys(CATEGORY_ICON_MAP);

	return (
		<div className="flex h-full flex-col overflow-y-auto rounded-lg border border-hairline bg-surface py-2">
			<h2 className="mb-1 px-3 font-semibold text-heading text-ink">
				Categories
			</h2>
			<div className="flex flex-col gap-0.5 px-1">
				<CategoryItem
					selected={selectedCategory === null}
					onClick={() => onSelectCategory(null)}
					data-testid="category-all"
				>
					<span className="flex size-5.5 shrink-0 items-center justify-center opacity-70">
						<Layers size={18} aria-hidden="true" />
					</span>
					All Categories
				</CategoryItem>
				{categories.map((cat) => {
					const entry = CATEGORY_ICON_MAP[cat];
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
							<span className="flex size-5.5 shrink-0 items-center justify-center">
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
