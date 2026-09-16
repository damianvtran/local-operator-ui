import { RadientMark } from "@shared/components/common/radient-mark";
import { Tooltip } from "@shared/components/ui/tooltip";
import { useMediaQuery } from "@shared/hooks/use-media-query";
import { cn } from "@shared/lib/utils";
import {
	Download,
	Key,
	Paintbrush,
	Plug,
	Puzzle,
	Settings,
	SlidersHorizontal,
} from "lucide-react";
import type { ComponentType, FC } from "react";

/**
 * A section's glyph. Every entry is now a component that draws itself in
 * `currentColor` at a given size — lucide's shape, which `RadientMark` also
 * satisfies. It used to be `LucideIcon | string` with an `isImage` flag, so
 * that one section could hand over a PNG; both call sites then carried a
 * branch, and the image branch had to be sized separately to stop the list
 * jumping. One kind of glyph needs neither.
 */
/*
 * `ComponentType`, not `FC`: lucide icons are forward-ref components, which
 * are not `FC`s. The old type only ever passed because every section icon
 * happened to be a plain function component; the first forward-ref icon
 * (RadientMark) broke it.
 */
export type SectionIcon = ComponentType<{
	size?: string | number;
	className?: string;
}>;

/**
 * Type definition for settings sections
 */
export type SettingsSection = {
	id: string;
	label: string;
	icon: SectionIcon;
};

/**
 * Props for the SettingsSidebar component
 */
type SettingsSidebarProps = {
	/** The currently active settings section */
	activeSection: string;
	/** Callback function when a section is selected */
	onSelectSection: (sectionId: string) => void;
	/** List of available settings sections */
	sections: SettingsSection[];
};

/**
 * Onboarding tour anchors, keyed by section id. A section with no entry gets no
 * tag, which is what the tour expects — `features/onboarding` matches these
 * values by selector, so a renamed value breaks the tour silently.
 */
const TOUR_TAGS: Record<string, string> = {
	general: "settings-sidebar-general",
	radient: "settings-sidebar-radient-account",
	integrations: "settings-sidebar-integrations",
	appearance: "settings-sidebar-appearance",
	credentials: "settings-sidebar-api-credentials",
	updates: "settings-sidebar-application-updates",
};

/**
 * The rail's groups, in render order. Sections are matched by id rather than
 * sliced by position, so a section this file does not know about is left out of
 * every group instead of landing under the wrong heading.
 *
 * The order within a group must match the order the sections appear in
 * `settings-page`. This is a jump list over one long document, not a page
 * switcher, and the active row is chosen by whichever section is most visible
 * — so a rail that disagrees with document order makes the highlight jump
 * backwards as you scroll forwards. Account used to list credentials before
 * integrations while the page rendered them the other way round.
 */
const SECTION_GROUPS: { label: string; ids: string[] }[] = [
	{ label: "General", ids: ["general", "appearance"] },
	{
		label: "Account",
		ids: ["radient", "providers", "integrations", "credentials"],
	},
	// The backend registry section was rendered but reachable only by deep
	// link because it sat in no group; the rail filters by group membership.
	{ label: "Backend", ids: ["backend"] },
	{ label: "System", ids: ["updates"] },
];

/**
 * SettingsSidebar component
 *
 * Displays a sidebar with navigation for different settings sections.
 *
 * ## Why plain list markup
 *
 * A nav rail is a list of destinations, so it is `nav > ul > li > button` and
 * nothing more: a row must be a real control to be reachable by keyboard, and
 * the active row carries `aria-current="page"` as well as its colour, because
 * the accent wash behind it is invisible to assistive tech — colour alone is
 * not a state.
 *
 * The active row is the rail's single accent spend (wash ground, accent icon),
 * so hover is a neutral ground step to `elevated` rather than a second tint.
 * Its label stays `ink` rather than going accent: tinting the ground and the
 * mark and the text is three signals for one state, and it makes the row you
 * are already on the loudest text in the rail.
 *
 * ## Density
 *
 * 32px rows, 16px marks, 13px labels, 8px between mark and label — the same
 * numbers as the app rail, because two rails sitting side by side that
 * disagree about row height read as a mistake rather than as a hierarchy.
 *
 * ## Why there is no "Settings" title above the list
 *
 * There was, and the word then appeared three times in one viewport: on the
 * app rail's nav item, at the head of this rail, and as the page's own `h1`
 * beside it. This rail is a jump list within one page, and the page already
 * carries the title — so the groups start at the top, which is how Linear's
 * and 1Password's settings rails are built.
 *
 * ## Why no edge of its own
 *
 * The rail draws no border. `settings-page` stacks it above the content below
 * the `md` breakpoint, where the single hairline has to move from right to
 * bottom, and this component cannot know which layout it is in — a hardcoded
 * `border-r` here becomes a stray vertical line in the stacked layout. The page
 * wrapper owns that one edge and moves it.
 *
 * ## Why it drops its labels below 1040px
 *
 * This rail and the global app rail are both 220px and both on screen at once,
 * so on a 900px window the two of them plus their gaps took roughly half the
 * width before any setting was drawn. Of the two, this is the one that gives:
 * the app rail is global navigation and is reachable from every screen, while
 * this is a jump list within a page the user is already on.
 *
 * So below 1040px it becomes a 48px icon rail with tooltips, the same
 * treatment and the same width as the collapsed app rail. 1040 is where two
 * 220px rails still leave 600px of content; under it, 220px of labels is a
 * fifth of the window spent on a jump list.
 *
 * It does not narrow instead, because it cannot usefully: "Application
 * updates" measures 121px of text and needs a 186px rail to render whole, so
 * every width between 48 and 220 costs a destination its name and returns
 * almost nothing.
 */
export const SettingsSidebar: FC<SettingsSidebarProps> = ({
	activeSection,
	onSelectSection,
	sections,
}) => {
	/*
	 * Paired with the `min-[1040px]:` width class on the rail's wrapper in
	 * `settings-page`. The two carry the same breakpoint and have to move
	 * together: a mismatch shows labels in a 48px rail or a 220px rail of bare
	 * icons. It is a hook rather than a Tailwind variant because what changes
	 * is what is RENDERED — a tooltip is a portalled subtree, and one hidden
	 * with a `hidden` variant would still mount on every row at every width.
	 */
	const labelled = useMediaQuery("(min-width: 1040px)");

	const renderSection = (section: SettingsSection) => {
		const isActive = activeSection === section.id;

		const button = (
			<button
				type="button"
				onClick={() => onSelectSection(section.id)}
				aria-current={isActive ? "page" : undefined}
				/* Unlabelled the row is an icon and nothing else, and a tooltip
				   cannot stand in for a name: Radix's `Trigger` contributes
				   `aria-describedby`, and only while the tooltip is open, which is a
				   description of a control that still has no name. */
				aria-label={labelled ? undefined : section.label}
				data-tour-tag={TOUR_TAGS[section.id]}
				className={cn(
					"flex h-8 w-full items-center rounded-sm text-left text-body-sm",
					"transition-colors duration-fast ease-out-quart",
					labelled ? "justify-start gap-2 px-3" : "justify-center",
					/*
					 * The current destination's ground: `highlight`, the role authored for a
					 * current row, a step off the panel's `surface` in the direction the mode
					 * runs. It was authored at ΔE00 2.18-2.28 for a selection the operator had
					 * asked to be SUBTLE; he has since seen it rendered and reported the row as
					 * being lost beside a hovered neighbour, so the role now carries ΔE00
					 * 4.0-4.4 from `surface` on eleven of the twelve palettes (3.51 on
					 * `iceberg`, which its own well caps — see that palette), bought on the
					 * CHROMA axis at the surface's own hue because that axis costs no ink
					 * assertion (`docs/branding.md` § 3).
					 *
					 * It was `accentWash` before that role existed, which is ΔE00 **1.05** on
					 * this ground in tokyoNight (`#262B3F` on `#24283B`, the pair the app
					 * computes and the pair every citation of it here uses) — a row with no
					 * ground at all, marked only by its accent glyph and weight. The wash is
					 * not invisible everywhere: the app rail paints the SAME wash on
					 * `sunken`, where it measures 9.6 and does read, so the role was fine and
					 * the panel under it was the problem — which is why this is a role of its
					 * own rather than a change to the wash.
					 *
					 * It then spent a round on `sunken`, and that is what the operator
					 * reported: `sunken` is RECESSED, always a well rather than a mark, and
					 * 3.75-14.94 from `surface` — a dark box rather than a highlight.
					 * `hover:` states the ground again because a hover variant outranks a
					 * bare background, so without it the pointer would replace the mark on
					 * the row the user is already on.
					 *
					 * The 1px `outline-control` edge is the mark's second half and the half
					 * that does not spend ink headroom: the ink floors cap how far this
					 * ground can climb (`ink-dim` is drawn inside a current row), and on
					 * eight palettes the neighbouring rows' hover step is still the larger
					 * step off `surface` — a bound no palette value lifts, because `elevated`
					 * is also every menu and popover ground in the app. It clears § 3's 3:1
					 * structural floor against this ground on all twelve palettes
					 * (3.17-4.59) and draws outside the box model, so this rail's row box and
					 * its alignment against the app rail are unchanged. Same two-part mark,
					 * same roles, same reasoning as `rowCurrent`/`rowCurrentEdge` in
					 * `features/chat/components/chat-sidebar.tsx`.
					 */
					isActive
						? "bg-highlight font-medium text-ink outline-solid outline-1 -outline-offset-1 outline-control hover:bg-highlight"
						: "text-ink-muted hover:bg-elevated hover:text-ink",
				)}
			>
				{/* Decorative in both layouts: labelled, the text beside it names the
				    destination; unlabelled, the button's own `aria-label` does. */}
				<span
					aria-hidden="true"
					className={cn(
						"flex size-4 shrink-0 items-center justify-center",
						isActive ? "text-accent" : "text-ink-dim",
					)}
				>
					<section.icon size={16} />
				</span>
				{labelled && <span className="truncate">{section.label}</span>}
			</button>
		);

		/* Unlabelled, the tooltip is the only *visible* name the row has, and it
		   wraps the button so a keyboard reaches it on focus rather than only a
		   pointer on hover. The accessible name is the button's `aria-label`. */
		return labelled ? (
			<li key={section.id}>{button}</li>
		) : (
			<li key={section.id}>
				<Tooltip content={section.label} side="right">
					{button}
				</Tooltip>
			</li>
		);
	};

	return (
		<nav
			aria-label="Settings sections"
			className="flex h-full w-full flex-col overflow-hidden bg-surface"
		>
			{/* `gap-6` between groups rather than a margin on each: a stacking
			    margin needs a `last:` reset to stop it adding a phantom row of
			    space under the final group. */}
			<div className="flex flex-1 flex-col gap-6 overflow-y-auto px-2 py-4">
				{SECTION_GROUPS.map((group) => {
					const groupSections = sections.filter((s) =>
						group.ids.includes(s.id),
					);
					if (groupSections.length === 0) return null;

					return (
						<div key={group.label}>
							{/* Sentence case, dim, one step below the rows: a group label
							    is a divider that happens to have a name, not a heading
							    competing with the destinations under it. Unlabelled there
							    is no room for the name and the `gap-6` between groups is
							    left to carry the grouping on its own. */}
							{labelled && (
								<div className="px-3 pb-1 text-meta text-ink-dim">
									{group.label}
								</div>
							)}
							<ul className="flex flex-col gap-0.5">
								{groupSections.map(renderSection)}
							</ul>
						</div>
					);
				})}
			</div>
		</nav>
	);
};

/**
 * Default settings sections
 */
export const DEFAULT_SETTINGS_SECTIONS: SettingsSection[] = [
	{
		id: "general",
		label: "General settings",
		icon: Settings,
	},
	{
		id: "radient",
		label: "Radient account",
		icon: RadientMark,
	},
	{
		id: "integrations",
		label: "Integrations",
		icon: Puzzle,
	},
	{
		id: "appearance",
		label: "Appearance",
		icon: Paintbrush,
	},
	{
		id: "providers",
		label: "Providers",
		icon: Plug,
	},
	{
		id: "backend",
		label: "Backend settings",
		icon: SlidersHorizontal,
	},
	{
		id: "credentials",
		label: "API credentials",
		icon: Key,
	},
	{
		id: "updates",
		label: "Application updates",
		icon: Download,
	},
];
