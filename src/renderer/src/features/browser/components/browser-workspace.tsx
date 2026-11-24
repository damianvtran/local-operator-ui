import { WorkspaceFrame } from "@shared/components/common/workspace-frame";
import type { ReactNode, Ref } from "react";

/** Browser chrome is a sibling. The conversation's Browser is not a route. */
export function BrowserWorkspaceBody({
	isRoutePage,
	dockRowRef,
	children,
}: {
	isRoutePage: boolean;
	dockRowRef: Ref<HTMLDivElement>;
	children: ReactNode;
}) {
	const dockRow = (
		<div className="flex min-h-0 grow" ref={dockRowRef}>
			{children}
		</div>
	);
	return isRoutePage ? (
		<WorkspaceFrame variant="browser">{dockRow}</WorkspaceFrame>
	) : (
		dockRow
	);
}

export function BrowserRoutePending({ children }: { children: ReactNode }) {
	return (
		<div className="panel-flush flex min-h-0 flex-1 flex-col">
			<div
				aria-hidden="true"
				data-browser-route-pending-chrome=""
				className="shrink-0 bg-sunken"
			/>
			<WorkspaceFrame variant="browser">{children}</WorkspaceFrame>
		</div>
	);
}
