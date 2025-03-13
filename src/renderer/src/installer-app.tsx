import type React from "react";
import { AppContainer } from "./components/installer/installer-styled";
import { InstallerContent } from "./components/installer/installer-content";

/**
 * InstallerApp component
 *
 * Container component that wraps the installer content
 */
export const InstallerApp: React.FC = () => {
	return (
		<AppContainer>
			<InstallerContent />
		</AppContainer>
	);
};
