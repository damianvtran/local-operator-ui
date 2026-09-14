import { cn } from "@shared/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { FC, ReactNode, RefObject } from "react";

/**
 * A grouping on the settings page.
 *
 * ## Why this is not a card any more
 *
 * It used to be `Card > CardContent > Typography`, drawing a `divider` border
 * and 24px of padding around every group — and because the groups themselves
 * contain bordered rows and bordered info tiles, the page rendered a boundary
 * inside a boundary inside a boundary. Three nested edges say nothing that one
 * says, and the fix for a busy panel is removing a border rather than
 * tightening the spacing (branding § 5).
 *
 * So the boundary is gone and the heading does its job: a group is a heading, a
 * one-line description, and its fields, separated from the next group by a
 * section-tier gap that the page owns. Anything that genuinely needs a panel —
 * a nested list of credentials, a callout — reaches for `Card` explicitly, and
 * that panel is then the only edge in view.
 *
 * Rendered as a `div` rather than a `section` on purpose: the onboarding tour
 * matches `div[data-tour-tag="settings-general-section"]` with the element name
 * in the selector, and `sectionRefs` in the page are `RefObject<HTMLDivElement>`.
 * Changing the tag breaks the tour silently, which is the worst way for it to
 * break.
 */
type SettingsSectionProps = {
	title: string;
	description?: string;
	icon?: LucideIcon;
	children: ReactNode;
	/**
	 * Replaces the whole default heading row. For a section whose title needs
	 * to carry something beside it — a brand mark, a connection state — rather
	 * than for restyling the title.
	 */
	titleComponent?: ReactNode;
	/** Scroll target for the settings sidebar. */
	sectionRef?: RefObject<HTMLDivElement>;
	dataTourTag?: string;
	className?: string;
};

export const SettingsSection: FC<SettingsSectionProps> = ({
	title,
	description,
	icon: Icon,
	children,
	titleComponent,
	sectionRef,
	dataTourTag,
	className,
}) => (
	<div
		ref={sectionRef}
		data-tour-tag={dataTourTag}
		className={cn("w-full", className)}
	>
		{titleComponent ?? (
			<h2 className="flex items-center gap-2 text-heading text-ink">
				{Icon && <Icon size={16} className="shrink-0 text-ink-dim" />}
				{title}
			</h2>
		)}
		{description && (
			<p className="mt-1 max-w-2xl text-body-sm text-ink-muted">
				{description}
			</p>
		)}
		<div className="mt-4">{children}</div>
	</div>
);

/**
 * A read-only label/value pair.
 *
 * Was a filled, bordered tile — `action.hover` ground plus a `divider` edge —
 * repeated four to six times per group. A grid of six such tiles is six boxes
 * of chrome carrying no information the label above the value does not already
 * carry, so both the fill and the edge are gone and the type scale separates
 * them instead: `meta` dim for the label, `body-sm` ink for the value.
 */
type InfoItemProps = {
	label: ReactNode;
	value: ReactNode;
	className?: string;
};

export const InfoItem: FC<InfoItemProps> = ({ label, value, className }) => (
	<div className={cn("min-w-0", className)}>
		<div className="flex items-center gap-1.5 text-meta text-ink-dim">
			{label}
		</div>
		<div className="mt-0.5 break-words text-body-sm text-ink">{value}</div>
	</div>
);

/**
 * The grid `InfoItem`s sit in. `auto-fit` rather than a fixed column count so
 * the same grid works in the page's wide content column and in a narrow window.
 */
export const InfoGrid: FC<{ children: ReactNode; className?: string }> = ({
	children,
	className,
}) => (
	<div
		className={cn(
			"grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-x-6 gap-y-4",
			className,
		)}
	>
		{children}
	</div>
);
