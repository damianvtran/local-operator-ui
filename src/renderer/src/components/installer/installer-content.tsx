import type React from "react";
import {
	BackgroundPattern,
	FeatureSection,
	InstallerLayout,
	ProgressSection,
} from "./installer-styled";
import { FeatureCarousel } from "./feature-carousel";
import { LogoSection } from "./logo-section";
import { InstallationProgress } from "./installation-progress";

/**
 * InstallerContent component
 *
 * Displays the installation progress UI with a spinner, progress bar, and cancel button
 * alongside a feature carousel in a modern, full-screen layout
 */
export const InstallerContent: React.FC = () => {
	return (
		<InstallerLayout>
			{/* Left section with feature carousel */}
			<FeatureSection>
				<BackgroundPattern />
				<LogoSection />
				<FeatureCarousel />
			</FeatureSection>

			{/* Right section with installation progress */}
			<ProgressSection>
				<InstallationProgress />
			</ProgressSection>
		</InstallerLayout>
	);
};
