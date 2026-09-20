import { CheckForUpdatesButton } from "@shared/components/common/check-for-updates-button";
import type { FC } from "react"; // Import FC type

/**
 * Renders the button to check for application updates.
 * The surrounding card, title, and description are handled by AppUpdatesSection.
 *
 * The version is passed THROUGH rather than read here: `AppUpdatesSection` already
 * reads it for its own "Application version" row, and the sentence below the button
 * has to name the same reading that row prints (design D1) - a second read here
 * could answer differently for a frame and put two versions on one card.
 */
export const AppUpdates: FC<{ appVersion: string | null }> = ({
	appVersion,
}) => {
	// Simply render the button component
	return <CheckForUpdatesButton appVersion={appVersion} />;
};
