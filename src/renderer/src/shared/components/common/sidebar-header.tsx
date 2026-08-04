import { Button, Input, Tooltip } from "@shared/components/ui";
import { Import, Plus, Search } from "lucide-react";
import type { FC } from "react";

/**
 * Props for the SidebarHeader component
 */
type SidebarHeaderProps = {
	/** Title to display in the header */
	title: string;
	/** Current search query */
	searchQuery: string;
	/** Callback for when search query changes */
	onSearchChange: (query: string) => void;
	/** Callback for when the new agent button is clicked */
	onNewAgentClick: () => void;
	/** Placeholder text for the search field */
	searchPlaceholder?: string;
	/** Tooltip text for the new agent button */
	newAgentTooltip?: string;
	/** Callback for when the import agent button is clicked */
	onImportAgentClick?: () => void;
	/** Tooltip text for the import agent button */
	importAgentTooltip?: string;
};

/**
 * The title, actions and search field at the top of a list sidebar.
 *
 * ## What the action buttons lost
 *
 * They were the most decorated controls in the app: a mode-switched
 * `alpha(primary, 0.1|0.15)` fill, a light-mode-only 1px accent border, a
 * `translateY(-2px)` hover with an accent-tinted `0 4px 8px` shadow, and a
 * matching `translateY(0)` plus smaller shadow on `:active`. Every one of those
 * is disallowed: nothing lifts on hover, elevation is a ground step rather than
 * a shadow, and a control must not paint itself differently per mode when the
 * roles already resolve per theme.
 *
 * `Plus` is the primary action here, so it takes the one accent fill on this
 * surface and `Import` stays `ghost`. That is the hierarchy the two matching
 * accent-tinted buttons could not express.
 *
 * ## What the search field lost
 *
 * A `0 0 0 3px` accent `box-shadow` on focus. Focus is an `outline`, defined
 * once globally — a box-shadow ring is clipped by the nearest
 * `overflow: hidden`, and a sidebar is a scroll container, so the ring
 * disappeared in exactly the place a keyboard user needed it.
 */
export const SidebarHeader: FC<SidebarHeaderProps> = ({
	title,
	searchQuery,
	onSearchChange,
	onNewAgentClick,
	searchPlaceholder = "Search agents",
	newAgentTooltip = "Create a new agent",
	onImportAgentClick,
	importAgentTooltip = "Import an agent from a ZIP file",
}) => (
	<div className="p-4">
		<div className="mb-3 flex items-center justify-between gap-2">
			<h2 className="truncate text-heading text-ink">{title}</h2>
			<div className="flex shrink-0 gap-1">
				{onImportAgentClick && (
					<Tooltip content={importAgentTooltip}>
						<Button
							variant="ghost"
							size="icon"
							onClick={onImportAgentClick}
							aria-label="Import agent"
						>
							<Import size={18} strokeWidth={2} aria-hidden="true" />
						</Button>
					</Tooltip>
				)}
				<Tooltip content={newAgentTooltip}>
					{/* The tour clicks `button[data-tour-tag="create-new-agent-button"]`,
					    so this tag must stay on the button element itself. */}
					<Button
						variant="primary"
						size="icon"
						onClick={onNewAgentClick}
						aria-label="New agent"
						data-tour-tag="create-new-agent-button"
					>
						<Plus size={18} strokeWidth={2} aria-hidden="true" />
					</Button>
				</Tooltip>
			</div>
		</div>

		<div className="relative">
			<Search
				size={16}
				strokeWidth={2}
				aria-hidden="true"
				className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-dim"
			/>
			<Input
				type="search"
				inputSize="lg"
				placeholder={searchPlaceholder}
				value={searchQuery}
				onChange={(e) => onSearchChange(e.target.value)}
				aria-label={searchPlaceholder}
				className="pl-9"
			/>
		</div>
	</div>
);
