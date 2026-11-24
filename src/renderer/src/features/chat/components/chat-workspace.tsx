import { WorkspaceFrame } from "@shared/components/common/workspace-frame";
import type { ReactNode } from "react";

/**
 * Chat's titlebar tabs stay outside the body. Pending and unavailable views
 * reserve that same row, so swapping in tabs doesn't move the frame or make
 * the bounding plane switch from matte canvas to the shell.
 */
export function ChatWorkspace({
	tabs,
	children,
}: {
	tabs?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div data-chat-workspace="" className="flex h-full min-h-0 flex-col">
			{tabs ?? <div data-workspace-tabs="" aria-hidden="true" />}
			<WorkspaceFrame variant="chat">{children}</WorkspaceFrame>
		</div>
	);
}
