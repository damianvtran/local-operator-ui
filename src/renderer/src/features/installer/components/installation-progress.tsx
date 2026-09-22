import type React from "react";
import { useInstallProgress } from "../use-install-progress";
import { InstallPanel } from "./installer-panel";

/**
 * The installer window's live panel: the IPC subscription, wired to the pure
 * panel.
 *
 * The split is deliberate, and it is what makes the states photographable: this
 * file owns the only impure thing on the screen (the preload bridge), and
 * `InstallPanel` is a plain function of the view - so the evidence capture can
 * render the indeterminate, mid-install and failure states from a story without
 * a main process to talk to.
 */
export const InstallationProgress: React.FC = () => {
	const { view, cancel, retry } = useInstallProgress();
	return (
		<InstallPanel
			phase={view.phase}
			installed={view.installed}
			failure={view.failure}
			onCancel={cancel}
			onRetry={retry}
		/>
	);
};
