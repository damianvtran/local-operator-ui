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
		<div
			// No layout box on routes with legacy chrome. Keeping the same DOM
			// slot preserves the startup gate through switches to and from them.
			className={
				inset
					? "workspace-frame flex min-h-0 min-w-0 flex-1 flex-col"
					: "contents"
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
	);
}
