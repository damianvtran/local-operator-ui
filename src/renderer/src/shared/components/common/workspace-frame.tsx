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
	/** Chrome-owning bodies keep their own paint roles without changing geometry. */
	variant?: "chat" | "browser";
}

/**
 * One inset around the route body, not around the titlebar or shell rails.
 * The outlet reserves the platform chrome band before this boundary. A page
 * with its own toolbar (Chat, native Browser) can instead use it below that
 * toolbar, without taking the outlet frame as well.
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
		>
			<div
				className={
					inset ? "workspace-frame flex min-h-0 min-w-0 flex-col" : "contents"
				}
				data-workspace-frame={inset ? "" : undefined}
				data-workspace-inset={inset && variant === "chat" ? "" : undefined}
				data-workspace-browser={inset && variant === "browser" ? "" : undefined}
				data-glass-region={
					inset
						? variant === "chat"
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
