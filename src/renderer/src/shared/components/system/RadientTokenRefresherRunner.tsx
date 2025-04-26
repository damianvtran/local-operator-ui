import { useRadientTokenRefresher } from "@shared/hooks/use-radient-token-refresher";

/**
 * @component RadientTokenRefresherRunner
 * @description
 * A component that exists solely to run the `useRadientTokenRefresher` hook.
 * It renders nothing to the DOM (`null`) and ensures the token refresh logic
 * runs independently of the main App component's render cycle.
 * This component should be placed within the main provider tree (e.g., in main.tsx).
 */
export const RadientTokenRefresherRunner = (): null => {
	useRadientTokenRefresher();
	return null;
};
