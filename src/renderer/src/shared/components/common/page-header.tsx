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
	children?: ReactNode;
} & (
	| { variant: "compact"; icon?: never; subtitle?: never }
	| { variant?: "display"; icon: LucideIcon; subtitle?: string }
);

/**
 * Use `compact` when navigation already names the route: keep its h1 for
 * heading navigation, without an icon, exposition or a flex item that leaves a
 * gap. The caller owns any toolbar. Display headers are for meaningful content
 * identity, such as a selected item's name.
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
 * The visible title uses `text-display`, the largest step in the app. There
 * is no step above it on purpose: a desktop app has no hero.
 *
 * ## No bottom margin
 *
 * It shipped `mb-8`, which stacked with whatever gap its page already had —
 * routes set their own flex rhythm. A component does not own its outer margin;
 * the container owns the gap.
 *
 * ## Why it wraps, and why it is a container
 *
 * The row used to be `justify-between` with no `flex-wrap`. A flex line does
 * not overflow politely: once the title block and the action group could not
 * both fit, the actions were squeezed past their labels and then past the
 * page's `overflow-hidden` edge, so at 800px "Export" read as "Exp" and two
 * buttons were not merely off-screen but unreachable. `flex-wrap` makes the
 * action group drop to its own full-width line instead, and `min-w-0` on the
 * title block lets a long title give way before that happens.
 *
 * `@container` is here so pages can collapse their own actions against the
 * width the header actually has rather than against the viewport. The two
 * things between this header and the window edge — the app rail and a list
 * pane — are both independently collapsible, so the viewport does not know
 * how much room is left. The saved agent detail needs it.
 */
export const PageHeader: FC<PageHeaderProps> = (props) => {
	const { title, children } = props;
	if (props.variant === "compact") {
		return (
			<>
				<h1 className="sr-only">{title}</h1>
				{children}
			</>
		);
	}
	const { icon: Icon, subtitle } = props;
	return (
		<div className="@container flex flex-wrap items-start justify-between gap-4">
			<div className="flex min-w-0 items-start gap-4">
				<Icon
					size={24}
					aria-hidden="true"
					className="mt-1 shrink-0 text-ink-muted"
				/>
				<div className="flex min-w-0 flex-col gap-1">
					<h1 className="wrap-anywhere text-display text-ink">{title}</h1>
					{subtitle && (
						<p className="max-w-200 text-body text-ink-muted">{subtitle}</p>
					)}
				</div>
			</div>
			{children}
		</div>
	);
};
