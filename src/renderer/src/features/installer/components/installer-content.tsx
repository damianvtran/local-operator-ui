import type React from "react";
import { InstallationProgress } from "./installation-progress";

/**
 * The window's own box: the ground, and the centring.
 *
 * Exported because the Storybook stories stage a panel INSIDE this wrapper
 * rather than beside a hand-rolled copy of it (design D6). A verification surface
 * that differs from the product eventually certifies a defect - the story used to
 * paint its own `bg-canvas` box with its own padding, so the one thing the frames
 * could not show was what the panel does inside the container the app gives it.
 */
export const InstallerShell: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => (
	<div className="flex size-full items-center justify-center bg-canvas px-8 py-10">
		{children}
	</div>
);

/**
 * InstallerContent component
 *
 * The whole of the setup window: one centred column on `canvas`.
 *
 * It used to be two panes told apart by their ground - `surface` against
 * `canvas`, with a hairline between them - because half the window was product
 * copy and half was the install. With the feature carousel gone there is one
 * column, and one column does not need a half. The window itself is 640x480 now
 * (it was 1380x800, where this column was a 380px island in a large dark field),
 * so the first frame a new user sees is the panel rather than the panel and
 * 700px of ground.
 *
 * `canvas` is also the colour Electron paints before the renderer exists
 * (`INSTALL_WINDOW_CANVAS`, applied as `backgroundColor` in
 * `src/main/backend/backend-installer.ts`), so the first painted frame is the
 * same ground as every frame after it. That pair is asserted rather than
 * hand-copied, in `scripts/install-progress.test.mjs`.
 */
export const InstallerContent: React.FC = () => {
	return (
		<InstallerShell>
			<InstallationProgress />
		</InstallerShell>
	);
};
