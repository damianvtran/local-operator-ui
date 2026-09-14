import type React from "react";
import { InstallerContent } from "./features/installer/components/installer-content";

/**
 * InstallerApp component
 *
 * Root of the installer window. No theme provider: `installer.tsx` publishes
 * `data-theme` on the document, which is all the role utilities need.
 */
export const InstallerApp: React.FC = () => {
	return (
		<div className="flex h-screen w-screen overflow-hidden bg-canvas">
			<InstallerContent />
		</div>
	);
};
