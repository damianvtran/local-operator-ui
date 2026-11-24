import { cn } from "@shared/lib/utils";
import type { ReactNode } from "react";

const labelStyle =
	"min-w-0 flex-1 truncate font-medium text-ink-dim text-meta uppercase tracking-wide";

export function SidebarSectionHeading({
	label,
	action,
	disclosure,
}: {
	label: string;
	action?: ReactNode;
	disclosure?: {
		key: string;
		open: boolean;
		toggle: () => void;
		glyph: ReactNode;
	};
}) {
	return (
		<div
			data-sidebar-section-heading=""
			className={cn(
				"flex h-6 min-w-0 items-center gap-1 px-2",
				action && "@container/chatheading",
			)}
		>
			{disclosure ? (
				<h3 className="min-w-0 flex-1">
					<button
						type="button"
						data-chat-row
						data-chat-section={disclosure.key}
						aria-expanded={disclosure.open}
						onClick={disclosure.toggle}
						className="flex h-6 w-full min-w-0 items-center gap-1 rounded-sm text-start"
					>
						<span className={labelStyle}>{label}</span>
						{disclosure.glyph}
					</button>
				</h3>
			) : (
				<h3 className={labelStyle}>{label}</h3>
			)}
			{action}
		</div>
	);
}
