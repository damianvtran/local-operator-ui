import { cn } from "@shared/lib/utils";
import type { ReactNode } from "react";

/**
 * The two region primitives every panel is built from.
 *
 * A panel is a stack of sections, and a section is a titled region — not a
 * card. That distinction is the whole of this file: eight bordered boxes on one
 * screen is the busy-panel failure the design contract names, and a panel with
 * a chart, two tables and a stat grid reaches eight regions easily. Regions
 * separate by rhythm (the stack's 32px gap) and by their own headings; only the
 * things that group *content* — stat cards, the chart's plot area — carry a
 * ground.
 *
 * MUST NOT, on `PanelSection`: own an outer margin (the stack owns the gap, so
 * a section that added one would double it on every panel at once); use a
 * card/surface for its own frame; render a `meta` that restates its title.
 */

export type PanelStackProps = { children: ReactNode };

export const PanelStack = ({ children }: PanelStackProps) => (
	<div className={cn("flex flex-col gap-8")}>{children}</div>
);

export type PanelSectionProps = {
	/** Sentence case. Names the scope when the section has one ("Sessions on this machine"). */
	title: string;
	/** Qualifier line: the span, the source, or the caveat. One clause. */
	meta?: string;
	/** A control that affects THIS section only. Panel-wide controls go in the host toolbar. */
	action?: ReactNode;
	children: ReactNode;
};

/**
 * The header row: title on the baseline, the qualifier to its right.
 *
 * Exported because one section (`/session`'s identity block) is a heading pair
 * with no body of its own, and giving it a second spelling of the same row is
 * how two headings on one panel start drifting apart.
 */
export const PanelHeader = ({
	title,
	meta,
	action,
}: {
	title: string;
	meta?: string;
	action?: ReactNode;
}) => (
	<div className={cn("flex items-baseline justify-between gap-3 pb-2")}>
		<h3 className={cn("text-heading text-ink")}>{title}</h3>
		<div className={cn("flex items-baseline gap-3")}>
			{meta ? <p className={cn("text-ink-dim text-meta")}>{meta}</p> : null}
			{action}
		</div>
	</div>
);

export const PanelSection = ({
	title,
	meta,
	action,
	children,
}: PanelSectionProps) => (
	<section>
		<PanelHeader title={title} meta={meta} action={action} />
		{children}
	</section>
);
