/**
 * The Backend settings section's control row: what is shown, how much of it, and
 * what is unsaved.
 *
 * It replaces an unbounded search field (896px wide, the full content column)
 * over a list every section of which shipped open. Four things were missing from
 * that surface and are the whole reason this bar exists:
 *
 * - a BOUNDED field. The registry is 102 keys in 19 sections; a search box as wide
 *   as the page says nothing about what it will find, so the field is 400px and
 *   the line under it states the scope being searched (`12 core settings, 90
 *   advanced`) or the result (`9 results in 4 sections`) — a count, never a
 *   promise.
 * - the TIER as a filter rather than a second page. `Show advanced` reveals the
 *   advanced rows IN PLACE, per section, because advanced is a cross-cutting
 *   property of a key and the sections themselves are uniform by construction
 *   (`settings_io.py:126-127`): physically merging or re-partitioning them would
 *   express a renderer's layout preference on the wire.
 * - `Modified (n)`, so the thing a reader most often wants — what have I changed
 *   on this machine — is one press rather than 102 rows.
 * - the UNSAVED count. The save model (draft + explicit Save, per kind) is
 *   unchanged and deliberately so; what changes is that it stopped being silent.
 *   A draft that survives a failed save is a promise this surface made and only
 *   kept invisibly, and a reader who cannot see `3 unsaved changes` has no way to
 *   know the page is holding edits at all.
 *
 * The chips are the page's own segmented-control idiom (`settings-page.tsx`'s
 * usage metric): a `fieldset` with an `sr-only` legend and `aria-pressed`
 * buttons on `bg-sunken`. Radix `Tabs` would point `aria-controls` at a panel
 * that does not exist.
 */

import { Badge, Button, Input } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Search, X } from "lucide-react";
import type { FC } from "react";

/** The width of the search field, and the reason it is not `w-full`. */
const FIELD_WIDTH = "w-full max-w-[400px]";

export type SettingsFilterBarProps = {
	query: string;
	onQueryChange: (query: string) => void;
	/**
	 * How many rows the current query matched, and across how many sections.
	 * `null` when no query is active.
	 */
	matchCount: number | null;
	matchSections: number;
	/** The registry's own split, for the line under the field. */
	coreCount: number;
	advancedCount: number;
	/** Rows currently off their default, and whether they are the only view. */
	modifiedCount: number;
	modifiedOnly: boolean;
	onModifiedOnlyChange: (value: boolean) => void;
	showAdvanced: boolean;
	onShowAdvancedChange: (value: boolean) => void;
	onExpandAll: () => void;
	onCollapseAll: () => void;
	/** Unsaved drafts the section is holding. */
	unsavedCount: number;
	savingAll: boolean;
	onSaveAll: () => void;
	onDiscardAll: () => void;
};

export const SettingsFilterBar: FC<SettingsFilterBarProps> = ({
	query,
	onQueryChange,
	matchCount,
	matchSections,
	coreCount,
	advancedCount,
	modifiedCount,
	modifiedOnly,
	onModifiedOnlyChange,
	showAdvanced,
	onShowAdvancedChange,
	onExpandAll,
	onCollapseAll,
	unsavedCount,
	savingAll,
	onSaveAll,
	onDiscardAll,
}) => (
	<div className="flex flex-col gap-2">
		<div className="flex flex-wrap items-center gap-3">
			<div className={cn("relative", FIELD_WIDTH)}>
				<Search
					size={16}
					className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-dim"
					aria-hidden="true"
				/>
				<Input
					value={query}
					onChange={(event) => onQueryChange(event.target.value)}
					/*
					 * Escape clears, because the field is where a reader who wants their
					 * list back is already looking: without it the only way out of a
					 * search was the ✕ (a mouse) or select-all-and-delete (UX round 1,
					 * U5). It clears only when there is something to clear, so Escape
					 * stays available to whatever else on the page may want it.
					 */
					onKeyDown={(event) => {
						if (event.key === "Escape" && query) onQueryChange("");
					}}
					placeholder="Search settings by name, description or key"
					aria-label="Search settings"
					className="pl-9"
				/>
				{query && (
					<Button
						variant="ghost"
						size="icon-sm"
						className="absolute top-1/2 right-1 -translate-y-1/2"
						onClick={() => onQueryChange("")}
						aria-label="Clear search"
					>
						<X aria-hidden="true" />
					</Button>
				)}
			</div>

			{/* Two filters, one idiom. `Modified` counts so the chip is worth
			    pressing before it is pressed; `Show advanced` is a view of the
			    same list rather than a permission, so it is a toggle beside it
			    and not a navigation. */}
			<fieldset className="m-0 border-0 p-0">
				<legend className="sr-only">Settings filters</legend>
				<div className="flex gap-0.5 rounded-md bg-sunken p-0.5">
					<Button
						variant="ghost"
						size="sm"
						aria-pressed={modifiedOnly}
						onClick={() => onModifiedOnlyChange(!modifiedOnly)}
						className={cn(
							modifiedOnly && "bg-surface text-ink hover:bg-surface",
						)}
					>
						Modified
						<Badge variant="neutral">{modifiedCount}</Badge>
					</Button>
					<Button
						variant="ghost"
						size="sm"
						aria-pressed={showAdvanced}
						onClick={() => onShowAdvancedChange(!showAdvanced)}
						className={cn(
							showAdvanced && "bg-surface text-ink hover:bg-surface",
						)}
					>
						Show advanced
					</Button>
				</div>
			</fieldset>

			<div className="ml-auto flex items-center gap-2">
				{/* The unsaved state, which is the whole of what changed about the
				    save model. Both affordances act on every draft the section
				    holds, including the ones inside a section the reader has
				    collapsed — a draft survives a collapse here rather than being
				    discarded with its row. */}
				{unsavedCount > 0 && (
					<>
						<span className="text-meta text-ink-dim">
							{unsavedCount === 1
								? "1 unsaved change"
								: `${unsavedCount} unsaved changes`}
						</span>
						<Button
							variant="primary"
							size="sm"
							disabled={savingAll}
							onClick={onSaveAll}
						>
							{savingAll ? "Saving" : "Save all"}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							disabled={savingAll}
							onClick={onDiscardAll}
						>
							Discard all
						</Button>
					</>
				)}
				<Button variant="ghost" size="sm" onClick={onExpandAll}>
					Expand all
				</Button>
				<Button variant="ghost" size="sm" onClick={onCollapseAll}>
					Collapse all
				</Button>
			</div>
		</div>

		{/* One line, and it answers the question the field raises: how much is
		    there, and what did my query find. Stated in the registry's own units
		    ("settings"), never in rows or matches the user cannot count.

		    Four states, because three of them used to read as the arrival scope:
		    a search reports its own result, `Modified` reports ITS result (it
		    changed the list while the line went on stating the whole registry —
		    UX round 1, U12), and `Show advanced` says what it just admitted
		    rather than leaving the reader to discover that the chip reveals rows
		    inside sections they have not opened (UX round 1, U3). */}
		<p className="text-meta text-ink-dim" aria-live="polite">
			{matchCount !== null
				? `${matchCount} ${matchCount === 1 ? "result" : "results"} in ${matchSections} ${
						matchSections === 1 ? "section" : "sections"
					}`
				: modifiedOnly
					? `${modifiedCount} modified ${modifiedCount === 1 ? "setting" : "settings"}`
					: showAdvanced
						? `${advancedCount} advanced settings shown — Expand all to see them`
						: `${coreCount} core settings, ${advancedCount} advanced`}
		</p>
	</div>
);
