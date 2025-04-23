// Removed unused imports: faDownload, FontAwesomeIcon, Card, CardContent, Typography, styled
import { CheckForUpdatesButton } from "@shared/components/common/check-for-updates-button";
import type { FC } from "react"; // Import FC type

/**
 * Renders the button to check for application updates.
 * The surrounding card, title, and description are handled by AppUpdatesSection.
 */
export const AppUpdates: FC = () => {
	// Simply render the button component
	return <CheckForUpdatesButton />;
};
