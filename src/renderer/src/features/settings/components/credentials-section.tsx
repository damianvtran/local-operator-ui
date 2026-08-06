import { Card } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Check, Key } from "lucide-react";
import type { FC, ReactNode } from "react";

type CredentialsSectionProps = {
	title: string;
	description: string;
	children: ReactNode;
	isEmpty?: boolean;
	emptyStateType?: "noCredentials" | "allConfigured";
};

/**
 * One group of credential cards — configured, or available to configure.
 *
 * ## Where the single boundary lives
 *
 * This was the worst nesting on the settings page: a bordered settings card
 * held a bordered group, which held a grid of bordered credential cards, and
 * the empty state added a fourth edge in a dashed border of its own. The
 * settings section above is borderless now, and `CredentialCard` is borderless
 * and unfilled, so the panel below is the *only* edge in the group — the
 * heading and the gap separate one group from the next.
 *
 * That split is deliberate rather than arbitrary: the cards hover to
 * `elevated`, which only reads as a step when they sit on `surface`. Giving the
 * ground to the panel buys the hover state and costs one border instead of
 * eight.
 *
 * The grid is `auto-fit` rather than viewport breakpoints because the settings
 * content column is narrowed by a sidebar, so `md:` would wrap on the wrong
 * measurement — the columns should follow the space the cards actually have.
 */
export const CredentialsSection: FC<CredentialsSectionProps> = ({
	title,
	description,
	children,
	isEmpty = false,
	emptyStateType = "noCredentials",
}) => {
	return (
		<section>
			<h3 className="text-body font-medium text-ink">{title}</h3>
			<p className="mt-1 max-w-2xl text-body-sm text-ink-muted">
				{description}
			</p>
			<Card variant="surface" padding="sm" className="mt-3">
				{isEmpty ? (
					<EmptyState type={emptyStateType} />
				) : (
					<div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-2">
						{children}
					</div>
				)}
			</Card>
		</section>
	);
};

type EmptyStateProps = {
	type: "noCredentials" | "allConfigured";
	className?: string;
};

/**
 * The group's message when it has nothing to list.
 *
 * Unfilled and unbordered: it already sits inside the group's panel, and a
 * dashed box inside a solid one is a boundary drawn around a boundary. Vertical
 * padding gives it the same presence the box used to.
 */
const EmptyState: FC<EmptyStateProps> = ({ type, className }) => {
	const isNoCredentials = type === "noCredentials";
	const StateIcon = isNoCredentials ? Key : Check;

	return (
		<div
			className={cn(
				"flex flex-col items-center px-4 py-8 text-center",
				className,
			)}
		>
			<StateIcon size={20} className="text-ink-dim" aria-hidden={true} />
			<p className="mt-3 text-body font-medium text-ink">
				{isNoCredentials
					? "No credentials configured"
					: "All available credentials configured"}
			</p>
			<p className="mt-1 max-w-sm text-body-sm text-ink-muted">
				{isNoCredentials
					? "You haven't set up any API credentials yet. Add credentials from the available options or add a custom one."
					: "You've configured all the common API credentials. You can still add custom credentials if needed."}
			</p>
		</div>
	);
};
