import type { LucideIcon } from "lucide-react";
import type { FC, ReactNode } from "react";

/**
 * Props for the PageHeader component.
 *
 * @property title - The title of the page.
 * @property icon - Lucide icon component to display next to the title.
 * @property subtitle - Optional subtitle text to display below the header.
 * @property children - Optional additional content to render below the title and subtitle.
 */
type PageHeaderProps = {
	title: string;
	icon: LucideIcon;
	subtitle?: string;
	children?: ReactNode;
};

/**
 * The title block at the top of a route, with its icon on the left and any page
 * actions on the right.
 *
 * ## Two pieces of chrome deliberately not carried over
 *
 * The header used to be a bordered, rounded panel. A border drawn around the
 * top of a page delimits the page from nothing — there is no adjacent content
 * for it to separate — so it loses no information by being deleted, which is
 * the test the branding contract sets for a boundary.
 *
 * The icon sat in a 48px circle filled with `action.hover`. That plate was a
 * fifth ground introduced for one element, and it made every page open with a
 * decorated badge rather than with its title. The icon now sits inline at
 * `ink-muted`, subordinate to the title, which is the hierarchy that was
 * intended in the first place.
 *
 * The title is `text-display` — 28px, the largest step in the app, and the only
 * place it is used. There is no step above it on purpose: a desktop app has no
 * hero.
 *
 * ## No bottom margin
 *
 * It shipped `mb-8`, which stacked with whatever gap its page already had —
 * every one of the four routes that use it lays its content out as a flex
 * column. A component does not own its outer margin; the container owns the
 * gap, and all four containers now set `gap-8` explicitly, which is the same
 * 32px said once in a place you can see it.
 */
export const PageHeader: FC<PageHeaderProps> = ({
	title,
	icon: Icon,
	subtitle,
	children,
}) => (
	<div className="flex items-start justify-between gap-4">
		<div className="flex items-start gap-4">
			<Icon
				size={24}
				aria-hidden="true"
				className="mt-1 shrink-0 text-ink-muted"
			/>
			<div className="flex flex-col gap-1">
				<h1 className="text-display text-ink">{title}</h1>
				{subtitle && (
					<p className="max-w-200 text-body text-ink-muted">{subtitle}</p>
				)}
			</div>
		</div>
		{children}
	</div>
);
