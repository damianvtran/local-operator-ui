import type React from "react";
import { FeatureCarousel } from "./feature-carousel";
import { InstallationProgress } from "./installation-progress";
import { LogoSection } from "./logo-section";

/**
 * InstallerContent component
 *
 * The installer window: what the product is on the left, what is happening on
 * the right. The two halves are told apart by their ground — `surface` against
 * `canvas` — with a single hairline where they meet. The window is wide, so
 * the split stacks below `lg` and the hairline moves with it.
 */
export const InstallerContent: React.FC = () => {
	return (
		<div className="flex size-full flex-col lg:flex-row">
			<section className="flex flex-1 flex-col items-center justify-center overflow-hidden border-hairline border-b bg-surface px-6 py-8 lg:border-r lg:border-b-0 lg:p-12">
				<LogoSection />
				<FeatureCarousel />
			</section>

			<section className="flex flex-1 flex-col items-center justify-center bg-canvas px-6 py-8 lg:p-12">
				<InstallationProgress />
			</section>
		</div>
	);
};
