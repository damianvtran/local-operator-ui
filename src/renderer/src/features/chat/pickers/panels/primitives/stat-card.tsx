import { Card } from "@shared/components/ui/card";
import { cn } from "@shared/lib/utils";
import type { ReactNode } from "react";
import { formatPercent } from "../formatters";
import { ProportionBar } from "./proportion-bar";

/**
 * One scalar with its context.
 *
 * A card rather than a bar, because a bar implies a shared denominator and
 * these numbers mostly do not have one — "four unrelated scalars" is the
 * reading the TUI settled on for the same block. Where a denominator does
 * exist the caller passes `fraction`, and the bar is drawn against it.
 *
 * MUST NOT, all three of which are review checks rather than advice:
 *
 * - **Format its own numbers.** `value` arrives already formatted by
 *   `formatters.ts`; a card that knows how to abbreviate tokens is a second
 *   spelling of a quantity the next panel will spell differently.
 * - **Infer a tone from a magnitude.** `tone` states a measured condition
 *   (failover is in force, nothing in scope is priceable) and never "this
 *   number is big". Red on a large number is a judgement, not a measurement.
 * - **Render `0` for an unmeasured quantity.** The caller passes the unknown
 *   spelling; a zero here would be a measurement nobody took.
 */

export type Stat = {
	label: string;
	/** Display text, formatted by the caller through `formatters.ts`. */
	value: string;
	/** Unit suffix rendered beside the value, e.g. "tokens". */
	unit?: string;
	/** One clause of context (a denominator, a coverage, a measurement caveat). */
	note?: string;
	/** A share with a denominator, or null when unmeasurable (dotted). */
	fraction?: number | null;
	tone?: "neutral" | "accent" | "warning" | "danger";
};

export type StatCardProps = Stat;

const TONE_CLASS: Record<NonNullable<Stat["tone"]>, string> = {
	neutral: "text-ink",
	accent: "text-accent",
	warning: "text-warning",
	danger: "text-danger",
};

/** Four ~236px cells at 1024px: `$128.40` plus a note fits without wrapping. */
export const StatGrid = ({ children }: { children: ReactNode }) => (
	<div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4")}>
		{children}
	</div>
);

export const StatCard = ({
	label,
	value,
	unit,
	note,
	fraction,
	tone = "neutral",
}: StatCardProps) => (
	<Card variant="surface" padding="md">
		<p className={cn("text-ink-dim text-meta")}>{label}</p>
		<p className={cn("font-mono text-title tabular-nums", TONE_CLASS[tone])}>
			{value}
			{unit ? (
				<span className={cn("ml-1.5 text-ink-muted text-meta")}>{unit}</span>
			) : null}
		</p>
		{fraction !== undefined ? (
			<ProportionBar
				fraction={fraction}
				className="w-full"
				tone={tone === "neutral" ? "accent" : undefined}
				// The bar is the same fact as the number above it, so the text
				// alternative names the quantity rather than reading the fill back.
				srLabel={`${label}: ${formatPercent(fraction)}`}
			/>
		) : null}
		{note ? (
			<p className={cn("text-balance text-ink-dim text-meta")}>{note}</p>
		) : null}
	</Card>
);
