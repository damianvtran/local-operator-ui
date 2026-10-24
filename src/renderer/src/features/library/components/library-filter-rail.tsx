/**
 * The Library's filter rail: categories, status, source and tags.
 *
 * THE COUNTS ARE THE SERVER'S, NOT THE PAGE'S. `library.list` answers a census
 * over the whole catalog (`counts.category` / `counts.origin_group`), and this
 * rail prints those numbers. Deriving counts from the currently loaded cursor
 * page would make "Images 12" mean "twelve images in this page", which is a
 * different and untrue sentence.
 *
 * ONE ROW IS ONE CONTROL. Categories and sources are single-select (pressing the
 * active row clears it); status rows are three independent toggles because they
 * compose with a category and with each other's absence. The selected row wears
 * the shared `rowCurrent` role and states `aria-pressed`, so the visual and the
 * announced selection cannot disagree - the sidebar's own rule, imported rather
 * than copied.
 */

import { rowCurrent } from "@features/chat/components/chat-sidebar";
import { Badge, Button } from "@shared/components/ui";
import { t } from "@shared/i18n";
import type { WithoutParams } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { Heart, Star, Tag, X } from "lucide-react";
import type { FC } from "react";
import type { DesktopLibraryList } from "../../../../../shared/desktop-control-contract";
import {
	LIBRARY_CATEGORIES,
	type LibraryListFilters,
	type LibraryStatusFilter,
	ORIGIN_GROUPS,
	groupTagsByCategory,
	isStatusActive,
	originGroupLabelKey,
} from "../library-model";
import { KindGlyph } from "./library-glyph";

export type LibraryFilterRailProps = {
	filters: LibraryListFilters;
	onChange: (filters: LibraryListFilters) => void;
	counts: DesktopLibraryList["counts"] | undefined;
	tags: DesktopLibraryList["tags"];
	/** The catalog total, for the category All row. */
	total: number;
	/**
	 * The catalog-wide total from the Librarian status route, for the scope
	 * section's "All inclusions" row. The listing's own `total` is scoped, so
	 * a final answer cannot supply the all-scope number.
	 */
	scopeTotal: number | null;
};

const STATUS_ROWS: Array<{
	key: LibraryStatusFilter;
	labelKey: WithoutParams;
}> = [
	{ key: "highlighted", labelKey: "ui.library.status.highlighted" },
	{ key: "unorganized", labelKey: "ui.library.status.unorganized" },
	{ key: "favorite", labelKey: "ui.library.status.favorites" },
];

const RailRow: FC<{
	label: string;
	count?: number;
	active: boolean;
	onPress: () => void;
	icon?: React.ReactNode;
	indent?: boolean;
}> = ({ label, count, active, onPress, icon, indent = false }) => (
	<button
		type="button"
		onClick={onPress}
		aria-pressed={active}
		className={cn(
			"flex h-7 w-full items-center gap-2 rounded-md px-2 text-start text-body-sm",
			indent && "ps-6",
			active ? rowCurrent : "text-ink-muted hover:bg-row-hover hover:text-ink",
		)}
	>
		{icon}
		<span className="min-w-0 flex-1 truncate">{label}</span>
		{count !== undefined && (
			<span className="text-meta tabular-nums text-ink-dim">{count}</span>
		)}
	</button>
);

const Section: FC<{ label: string; children: React.ReactNode }> = ({
	label,
	children,
}) => (
	<section className="flex flex-col gap-1">
		<h3 className="px-2 text-meta font-medium tracking-wide text-ink-dim">
			{label}
		</h3>
		<div className="flex flex-col gap-0.5">{children}</div>
	</section>
);

export const LibraryFilterRail: FC<LibraryFilterRailProps> = ({
	filters,
	onChange,
	counts,
	tags,
	total,
	scopeTotal,
}) => {
	const tagGroups = groupTagsByCategory(tags);
	const categoryCounts = counts?.category ?? {};
	const patch = (next: Partial<LibraryListFilters>) =>
		onChange({ ...filters, ...next });
	const active = Boolean(
		filters.category ||
			filters.originGroup ||
			filters.status ||
			filters.tag ||
			filters.session ||
			filters.highlighted,
	);

	return (
		<div
			data-lo-sidebar-edge-cues
			className="flex h-full flex-col gap-5 overflow-y-auto px-2 py-4"
			data-library-filter-rail=""
		>
			{active && (
				<Button
					variant="ghost"
					size="sm"
					className="justify-start"
					onClick={() =>
						onChange({
							...filters,
							category: undefined,
							originGroup: undefined,
							status: undefined,
							tag: undefined,
							session: undefined,
							highlighted: false,
						})
					}
				>
					<X aria-hidden="true" />
					{t("ui.library.filter.clear_filters")}
				</Button>
			)}
			{filters.session && (
				<div className="flex items-center gap-2 rounded-md bg-sunken px-2 py-1.5 text-meta text-ink-muted">
					<span className="min-w-0 flex-1 truncate">
						{t("ui.library.filter.one_conversation")}
					</span>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={t("ui.library.filter.clear_conversation")}
						onClick={() => patch({ session: undefined })}
					>
						<X aria-hidden="true" />
					</Button>
				</div>
			)}

			{/*
			 * SCOPE IS NOT A FILTER: it is the population the other rows count
			 * over. `final` is the desktop default; `all` is the whole catalog,
			 * including files merely mentioned or created in a conversation.
			 */}
			<Section label={t("ui.library.filter.scope")}>
				<RailRow
					label={t("ui.library.filter.scope_final")}
					active={filters.scope === "final"}
					onPress={() => patch({ scope: "final" })}
				/>
				<RailRow
					label={t("ui.library.filter.scope_all")}
					count={scopeTotal ?? undefined}
					active={filters.scope === "all"}
					onPress={() => patch({ scope: "all" })}
				/>
			</Section>

			<Section label={t("ui.library.filter.categories")}>
				<RailRow
					label={t("ui.library.category.all")}
					count={total}
					active={!filters.category}
					onPress={() => patch({ category: undefined })}
				/>
				{LIBRARY_CATEGORIES.map((category) => (
					<RailRow
						key={category.key}
						label={t(category.labelKey)}
						count={categoryCounts[category.key] ?? 0}
						active={filters.category === category.key}
						onPress={() =>
							patch({
								category:
									filters.category === category.key ? undefined : category.key,
							})
						}
						icon={
							<KindGlyph
								kind={category.iconKind}
								size={14}
								className="text-ink-dim"
							/>
						}
					/>
				))}
				{/* A category a newer backend adds still gets a row, last and
				    under its raw key - the extensibility rule the model states. */}
				{Object.keys(categoryCounts)
					.filter(
						(key) =>
							!LIBRARY_CATEGORIES.some((category) => category.key === key),
					)
					.sort()
					.map((key) => (
						<RailRow
							key={key}
							label={key}
							count={categoryCounts[key]}
							active={filters.category === key}
							onPress={() =>
								patch({
									category: filters.category === key ? undefined : key,
								})
							}
							icon={<Tag size={14} aria-hidden="true" />}
						/>
					))}
			</Section>

			<Section label={t("ui.library.filter.status")}>
				{STATUS_ROWS.map((row) => (
					<RailRow
						key={row.key}
						label={t(row.labelKey)}
						active={isStatusActive(filters, row.key)}
						onPress={() =>
							patch({
								status: isStatusActive(filters, row.key) ? undefined : row.key,
							})
						}
						icon={
							row.key === "favorite" ? (
								/*
								 * THE USER'S FAVOURITE IS A HEART; THE STAR IS THE
								 * LIBRARIAN'S `highlighted`. Both status rows used to wear
								 * the star, which is the one-mark-two-meanings defect the
								 * operator reported on the cards - fixed in the rail too so
								 * the filter reads like the mark it filters for.
								 */
								<Heart size={14} aria-hidden="true" />
							) : row.key === "highlighted" ? (
								<Star size={14} aria-hidden="true" />
							) : undefined
						}
					/>
				))}
			</Section>

			<Section label={t("ui.library.filter.source")}>
				{/*
				 * A zero-count origin row is noise under the final scope: the
				 * mentioned population is empty by definition, and printing
				 * "Mentioned 0" beside a 3,293-catalog row invites the reader to
				 * think the filter is broken. The all scope still shows every row,
				 * and an ACTIVE origin always stays: switching scope preserves the
				 * filter, so hiding its row would leave the empty grid with no
				 * visible cause.
				 */}
				{ORIGIN_GROUPS.filter(
					(group) =>
						filters.originGroup === group ||
						filters.scope === "all" ||
						(counts?.origin_group?.[group] ?? 0) > 0,
				).map((group) => (
					<RailRow
						key={group}
						label={t(originGroupLabelKey(group))}
						count={counts?.origin_group?.[group] ?? 0}
						active={filters.originGroup === group}
						onPress={() =>
							patch({
								originGroup: filters.originGroup === group ? undefined : group,
							})
						}
					/>
				))}
			</Section>

			{tagGroups.length > 0 && (
				<Section label={t("ui.library.filter.tags")}>
					{tagGroups.map((group) => (
						<div key={group.category} className="flex flex-col gap-0.5">
							<span className="px-2 pt-1 text-meta text-ink-dim">
								{group.category}
							</span>
							{group.tags.map((tag) => (
								<RailRow
									key={tag.id}
									label={tag.name}
									count={tag.count ?? 0}
									active={filters.tag === tag.id}
									onPress={() =>
										patch({ tag: filters.tag === tag.id ? undefined : tag.id })
									}
									icon={<Tag size={13} aria-hidden="true" />}
									indent
								/>
							))}
						</div>
					))}
				</Section>
			)}

			{filters.tag && (
				<Badge variant="neutral">
					{t("ui.library.filter.tag_mode", {
						mode: filters.tagMode.toUpperCase(),
					})}
				</Badge>
			)}
		</div>
	);
};
