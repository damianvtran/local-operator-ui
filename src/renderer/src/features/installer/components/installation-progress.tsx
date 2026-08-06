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
 *
 * ## Rhythm
 *
 * Three groups, not five evenly spaced paragraphs. What is happening and why
 * sit together at 8px; the live status is its own block; the way out is 32px
 * away from everything, because a destructive-adjacent control that shares
 * spacing with body copy is a control you can hit by accident. Even 24px gaps
 * between all five was the thing that made this screen read as a list.
 *
 * ## Heading level
 *
 * `text-title`, not `text-display`. The left half's "Local Operator" is the
 * page's one display-sized line; two 28px headings side by side in a split
 * window read as two competing screens rather than as a product and its
 * status.
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
		<div className="flex w-full max-w-110 flex-col items-center text-center">
			<h2 className="text-title text-ink">Setting up your environment</h2>
			<p className="mt-2 text-body text-ink-muted">
				A one-time install of Python and the AI dependencies your assistants
				need, all kept on this computer.
			</p>

			{/* The one live region on this screen: the label is what a screen reader
			    gets in place of a spinning ring. */}
			<div className="mt-8 flex flex-col items-center gap-3">
				<Spinner size="lg" label="Installing dependencies" />
				<p className="text-body-sm text-ink-muted">
					This takes a few minutes. You can minimize this window and keep
					working — you will get a notification when it is done.
				</p>
			</div>

			{/*
			 * `secondary`, not `danger`. Cancelling an install is reversible — the
			 * installer runs again — and the danger role is for actions that
			 * destroy something. Painting the only control on a first-run screen
			 * red makes stopping look like the obvious move on the one screen
			 * where the obvious move is to wait.
			 */}
			<Button variant="secondary" className="mt-8" onClick={handleCancel}>
				Cancel setup
			</Button>
		</div>
	);
};
