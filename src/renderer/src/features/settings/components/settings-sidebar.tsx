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
 */
const SECTION_GROUPS: { label: string; ids: string[] }[] = [
	{ label: "General", ids: ["general", "appearance"] },
	{ label: "Account", ids: ["radient", "credentials", "integrations"] },
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
						"flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left text-body-sm",
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
							"flex size-5 shrink-0 items-center justify-center",
							isActive ? "text-accent" : "text-ink-dim",
						)}
					>
						{section.isImage ? (
							<img
								src={section.icon as string}
								alt=""
								className="size-[18px] object-contain"
							/>
						) : (
							(() => {
								const IconComponent = section.icon as LucideIcon;
								return <IconComponent size={18} strokeWidth={1.5} />;
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
			{/* No rule under the title: the page's single hairline bounds this
			    region, and the group labels below separate the lists. */}
			<div className="px-4 pt-6 pb-4">
				<h2 className="text-heading text-ink">Settings</h2>
			</div>

			<div className="flex-1 overflow-y-auto px-2 pb-4">
				{SECTION_GROUPS.map((group) => {
					const groupSections = sections.filter((s) =>
						group.ids.includes(s.id),
					);
					if (groupSections.length === 0) return null;

					return (
						<div key={group.label} className="mb-6 last:mb-0">
							<div className="px-3 pb-1 text-meta tracking-wide text-ink-dim">
								{group.label}
							</div>
							<ul className="flex flex-col gap-1">
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
