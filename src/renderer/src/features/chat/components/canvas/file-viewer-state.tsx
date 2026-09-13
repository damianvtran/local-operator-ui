import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import type { FC, ReactNode } from "react";

/**
 * What a file viewer shows when it has no picture to show.
 *
 * One component rather than four copies, because the four viewers differ only
 * in how they paint a file and agree entirely on how they fail: a quiet centred
 * line, and — where an action would resolve the state — the action that does.
 * The states it exists for are the ones a viewer gets wrong by improvising:
 *
 * - **too large** is not an error to apologise for. The file is fine; the
 *   preview is what cannot hold it, so the state offers the app that can (the
 *   OS), which is the documented downgrade for anything we cannot render.
 * - **not found** is a fact the user may already know (they deleted it) and may
 *   not (the agent wrote into a temp directory). It names the path either way.
 * - **loading** is silent rather than a spinner wherever the wait is a local
 *   blob, which resolves in a frame or two — a spinner that appears for 30ms is
 *   a flash, not information.
 */

type FileViewerStateProps = {
	/** One sentence at heading weight: what is true, not what is missing. */
	title: string;
	/** The path or the reason, monospace because it is machine voice. */
	detail?: string | null;
	/** A spinner-free loading line. */
	quiet?: boolean;
	children?: ReactNode;
};

export const FileViewerState: FC<FileViewerStateProps> = ({
	title,
	detail,
	quiet = false,
	children,
}) => (
	<div
		className={cn(
			"flex h-full flex-col items-center justify-center gap-2 bg-canvas p-6 text-center",
		)}
	>
		<p
			className={cn(quiet ? "text-body-sm text-ink-dim" : "text-body text-ink")}
		>
			{title}
		</p>
		{detail ? (
			<p className={cn("max-w-96 break-all text-mono-sm text-ink-dim")}>
				{detail}
			</p>
		) : null}
		{children ? (
			<div className={cn("mt-2 flex items-center gap-2")}>{children}</div>
		) : null}
	</div>
);

/**
 * The action every viewer's dead end offers: hand the file to the OS.
 *
 * `window.api.openFile` is the same call the Files grid's fallback uses, so a
 * file that cannot be previewed is opened the same way wherever it is clicked.
 */
export const OpenInOsButton: FC<{ path: string; label?: string }> = ({
	path,
	label = "Open in default app",
}) => (
	<Button
		variant="secondary"
		size="sm"
		onClick={() => window.api.openFile(path)}
	>
		{label}
	</Button>
);
