import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui";
import type React from "react";

/**
 * InstallationProgress component
 *
 * The right half of the installer: what is happening, how long it takes, and
 * the one way out. There is no progress bar because the backend reports no
 * progress — a bar that cannot move is a lie, so the spinner carries the
 * "still working" signal and the copy carries the expectation.
 */
export const InstallationProgress: React.FC = () => {
	/**
	 * Handle cancel button click
	 * Sends a message to the main process to cancel the installation
	 */
	const handleCancel = () => {
		// Use IPC to communicate with main process
		window.api.ipcRenderer.send("cancel-installation");
	};

	return (
		<div className="flex w-full max-w-130 flex-col items-center gap-6 text-center">
			<h2 className="text-display text-ink">Setting up your environment</h2>

			<p className="text-body text-ink-muted">
				This one-time setup installs Python and the AI dependencies that Local
				Operator's assistants run on, on your device.
			</p>

			{/* The one live region on this screen: the label is what a screen reader
			    gets in place of a spinning ring. */}
			<Spinner size="lg" label="Installing dependencies" />

			<p className="text-body-sm text-ink-muted">
				This takes a few minutes. You can minimize this window and keep using
				your computer — you will get a notification when it is done.
			</p>

			<Button variant="danger" onClick={handleCancel}>
				Cancel setup
			</Button>
		</div>
	);
};
