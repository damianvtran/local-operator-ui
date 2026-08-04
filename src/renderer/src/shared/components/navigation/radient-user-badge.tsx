import { Badge, Tooltip } from "@shared/components/ui";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import type { FC } from "react";

/**
 * Props for the RadientUserBadge component
 */
type RadientUserBadgeProps = {
	/**
	 * Whether to show detailed user information
	 */
	showDetails?: boolean;
};

/**
 * The user's Radient authentication status, with optional account detail.
 *
 * The account id is machine voice — an identifier nobody reads as prose — so it
 * is `text-mono-sm`, which is what lets it sit under the email without a box
 * drawn around it.
 */
export const RadientUserBadge: FC<RadientUserBadgeProps> = ({
	showDetails = false,
}) => {
	const { isAuthenticated, isLoading, user, error } = useRadientAuth();

	/* Loading only matters before the first success; a refresh behind an already
	   authenticated session must not flicker the badge back to "Checking". */
	if (isLoading && !isAuthenticated) {
		return (
			<div className="flex items-center gap-2 p-2">
				<Badge variant="neutral">Checking</Badge>
			</div>
		);
	}

	if (error && !isAuthenticated) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return (
			<Tooltip content={errorMessage}>
				<div className="flex items-center gap-2 p-2">
					<Badge variant="danger">Sign-in error</Badge>
				</div>
			</Tooltip>
		);
	}

	if (!isAuthenticated) {
		return (
			<div className="flex items-center gap-2 p-2">
				<Badge variant="neutral">Not signed in</Badge>
			</div>
		);
	}

	return (
		<div className="flex items-center gap-2 p-2">
			<Badge variant="success">Signed in</Badge>

			{showDetails && user && (
				<div className="flex flex-col gap-1">
					<span className="text-body text-ink">{user.name}</span>
					<span className="text-meta text-ink-dim">{user.email}</span>
					{user.radientUser && (
						<span className="text-ink-dim text-mono-sm">
							Account {user.radientUser.account.id}
						</span>
					)}
				</div>
			)}
		</div>
	);
};
