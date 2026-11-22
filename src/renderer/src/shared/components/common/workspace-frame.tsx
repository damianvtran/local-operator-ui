import type { ReactNode } from "react";

interface WorkspaceFrameProps {
	children: ReactNode;
	/** Legacy routes already own the placement of their body below chrome. */
	inset?: boolean;
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
			data-glass-region={inset ? "canvas-backing" : undefined}
		>
			{children}
		</div>
	);
}
