import { type ReactNode, createContext, useContext } from "react";

const WorkspaceClearance = createContext(false);

/** Standalone pages still own their legacy clearance; framed routes do not. */
export function useWorkspaceClearance(): boolean {
	return useContext(WorkspaceClearance);
}

interface WorkspaceFrameProps {
	children: ReactNode;
	/** Chrome-owning routes mount their own frame below that chrome. */
	inset?: boolean;
	/** Split routes frame only their content pane; Chat and Browser own their chrome. */
	variant?: "full-height" | "chat" | "browser";
}

/**
 * One inset around the route body, not around the titlebar or shell rails.
 * Ordinary routes reserve clearance outside this boundary. Full-height split
 * routes keep their secondary sidebar edge-to-edge on `surface` beside this
 * evenly inset `canvas` frame, clearing chrome inside each column. Chat and
 * native Browser mount this frame after their own chrome.
 */
export function WorkspaceFrame({
	children,
	inset = true,
	variant,
}: WorkspaceFrameProps) {
	return (
		// The shell can paint the gutter without becoming the body's backing or
		// positioning ancestor. Keep both DOM slots stable so switching between
		// framed and chrome-owning routes doesn't remount the startup gate.
		<div
			className={
				inset ? "workspace-frame-shell min-h-0 min-w-0 flex-1" : "contents"
			}
			data-workspace-frame-shell={inset ? "" : undefined}
			data-workspace-frame-full-height={
				inset && variant === "full-height" ? "" : undefined
			}
		>
			<div
				className={
					inset ? "workspace-frame flex min-h-0 min-w-0 flex-col" : "contents"
				}
				data-workspace-frame={inset ? "" : undefined}
				data-workspace-inset={inset && variant === "chat" ? "" : undefined}
				data-workspace-browser={inset && variant === "browser" ? "" : undefined}
				data-workspace-split-inset={
					inset && variant === "full-height" ? "" : undefined
				}
				data-glass-region={
					inset
						? variant === "chat" || variant === "full-height"
							? "canvas-content"
							: variant === "browser"
								? "pane"
								: "canvas-backing"
						: undefined
				}
			>
				<WorkspaceClearance.Provider value={inset}>
					{children}
				</WorkspaceClearance.Provider>
			</div>
		</div>
	);
}
