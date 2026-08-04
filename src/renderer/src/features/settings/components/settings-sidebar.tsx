import radientIcon from "@assets/radient-icon-1024x1024.png";
import { cn } from "@shared/lib/utils";
import type { LucideIcon } from "lucide-react";
import { Download, Key, Paintbrush, Puzzle, Settings } from "lucide-react";
import type { FC } from "react";

/**
 * Type definition for settings sections
 */
export type SettingsSection = {
	id: string;
	label: string;
	icon: LucideIcon | string;
	isImage?: boolean;
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
	{ label: "Account", ids: ["radient", "integrations", "credentials"] },
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
 */
export const SettingsSidebar: FC<SettingsSidebarProps> = ({
	activeSection,
	onSelectSection,
	sections,
}) => {
	const renderSection = (section: SettingsSection) => {
		const isActive = activeSection === section.id;

		return (
			<li key={section.id}>
				<button
					type="button"
					onClick={() => onSelectSection(section.id)}
					aria-current={isActive ? "page" : undefined}
					data-tour-tag={TOUR_TAGS[section.id]}
					className={cn(
						"flex h-8 w-full items-center gap-2 rounded-sm px-3 text-left text-body-sm",
						"transition-colors duration-fast ease-out-quart",
						isActive
							? "bg-accent-wash font-medium text-ink"
							: "text-ink-muted hover:bg-elevated hover:text-ink",
					)}
				>
					{/* The label beside it already names the destination, so the mark is
					    decorative and must not be announced a second time. */}
					<span
						aria-hidden="true"
						className={cn(
							"flex size-4 shrink-0 items-center justify-center",
							isActive ? "text-accent" : "text-ink-dim",
						)}
					>
						{section.isImage ? (
							<img
								src={section.icon as string}
								alt=""
								className="size-4 object-contain"
							/>
						) : (
							(() => {
								const IconComponent = section.icon as LucideIcon;
								return <IconComponent size={16} strokeWidth={1.75} />;
							})()
						)}
					</span>
					<span className="truncate">{section.label}</span>
				</button>
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
							    competing with the destinations under it. */}
							<div className="px-3 pb-1 text-meta text-ink-dim">
								{group.label}
							</div>
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
		icon: radientIcon,
		isImage: true,
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
