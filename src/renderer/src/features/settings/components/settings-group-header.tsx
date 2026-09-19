/**
 * A registry section's heading, as the app's one disclosure.
 *
 * The surface this replaces was a hand-rolled `<button>` with no chevron, a
 * scope PILL inside it (so it toggled the section on click and joined its
 * accessible name) and a second description line under the title — which is how
 * a section that ships expanded gave no sign it could be collapsed at all, and
 * how the scope fact came to be stated twice per section (badge, then a
 * "Changed from the default; takes effect …" sentence on every off-default row).
 *
 * What it is now, per `docs/branding.md` § Disclosure: the canonical
 * `@shared/components/ui/disclosure`, imported directly (it is deliberately NOT
 * in the shared barrel), filled with a row of MARKS and nothing else — chevron,
 * title, row count, the scope stated exactly once, and a changed dot. Plain text
 * rather than a filled badge, because the fact is metadata and a pill made it
 * look like a control.
 *
 * The disclosure is UNCONTROLLED on purpose and this component does not add an
 * `open` prop to it: a forced-open (search, or a deep link into a key inside a
 * closed section) is a `key` change at the call site, which `onOpenChange` is
 * how the caller learns the state it must force FROM.
 */

import { Disclosure } from "@shared/components/ui/disclosure";
import { cn } from "@shared/lib/utils";
import type { FC } from "react";

/**
 * The marker for "this row is off its default".
 *
 * A state, not a sentence: the surface this replaces wrote
 * `Changed from the default; Takes effect immediately` under every off-default
 * row — 29 such sentences on a configured install, saying the same two things 29
 * times. The dot carries it, `title`/`aria-label` spell it out for a reader who
 * cannot see the dot, and the scope it used to repeat now lives in this header.
 */
export const ChangedDot: FC<{ className?: string }> = ({ className }) => (
	<span
		role="img"
		aria-label="Changed from the default"
		title="Changed from the default"
		className={cn("size-1.5 shrink-0 rounded-full bg-accent", className)}
	/>
);

export type SettingsGroupHeaderProps = {
	title: string;
	/** Rows this section shows right now, with the tier filter applied. */
	rowCount: number;
	/** Advanced rows the tier filter is holding back; 0 when revealed. */
	advancedCount: number;
	/** The registry's scope for this section, already mapped to words. */
	scope?: string;
	/** Whether any row in this section is off its default. */
	modified: boolean;
	/** Reported, one-way: the caller forces an open state by remounting. */
	onOpenChange: (open: boolean) => void;
	/** Initial open state, for the arrival layout. */
	defaultOpen?: boolean;
};

export const SettingsGroupHeader = ({
	title,
	rowCount,
	advancedCount,
	scope,
	modified,
	onOpenChange,
	defaultOpen = false,
}: SettingsGroupHeaderProps) => (
	/*
	 * A stable handle for the things that have to find a SECTION HEADER in the
	 * DOM — the capture rigs, the stories' own plays — because the trigger's
	 * accessible name is a row of marks and its text is the registry's copy, and
	 * neither is a selector. It also keeps a header's disclosure distinguishable
	 * from a row's own help reveal, which repeats the same `aria-expanded`.
	 */
	<div data-section-header={title} className="flex w-full flex-col">
		<Disclosure
			defaultOpen={defaultOpen}
			onOpenChange={onOpenChange}
			/*
			 * Two overrides, and both are corrections rather than preferences.
			 *
			 * INK. The trigger's own resting ink is `ink-dim` for a trace chip; a
			 * section heading is a heading, so the resting ink steps up to `ink`.
			 *
			 * THE HOVER STEP. The override used to be `text-ink hover:text-ink`,
			 * which cancels the primitive's only hover step (`disclosure.tsx`'s
			 * `hover:text-ink-muted`) without putting anything in its place — so
			 * hovering a 40px header changed nothing at all and the surface's
			 * primary interaction had cursor-only feedback (design round 1, D1b).
			 * The ground is the app's own list-row hover (`settings-sidebar`,
			 * `credential-card`), not a new treatment, and `hover:text-ink` stays
			 * because the primitive would otherwise step a heading DOWN in ink on
			 * hover.
			 */
			triggerClassName="text-ink hover:bg-row-hover hover:text-ink"
			/*
			 * The chevron is this surface's only affordance, so it is the one mark
			 * that must clear the 3:1 non-text floor: the primitive paints the slot
			 * `ink-disabled` (2.70:1 dark / 2.80:1 light measured), which is the
			 * role reserved for controls that are NOT operable. `ink-dim` measures
			 * 5.81:1 / 5.31:1 beside the title it belongs to, and taking it here
			 * rather than changing the primitive's line leaves the trace
			 * hierarchy's chrome exactly as designed.
			 */
			chevronClassName="text-ink-dim"
			/* One shape for all 19 headers, which is what makes the arrival index
			   scan as a list rather than as 19 differently-sized things.

			   The empty disclosed-content box this header used to grow is gone from
			   the primitive itself (`children != null` now gates it), which removes the
			   `[&>div:empty]:hidden` workaround that was here: with no children there is
			   no box, so the 8px, the `aria-controls` at a `display: none` target and
			   the workaround all went with it. */
			rowClassName="min-h-10 py-0"
			className="w-full"
			summary={
				/* Marks, and only marks. The section's own description is NOT here:
			   it renders inside the section when it is open, because a second
			   line under every title is what turned the index into 18 blocks
			   and made the region 12 screens tall.

					 `w-full` on this span and `ml-auto` on the dot are one decision: the
					 changed dot is an INDEX. Trailing variable-width copy put it at ten
						   distinct x positions across ten dotted headers (214px of spread,
					    measured in `changed-rows`), so the one question the mark answers -
					 which sections have I changed? - could not be swept down a column
						(design round 1, D4). Pinned to the trigger's right edge it can, and
							the title keeps its rail because the cluster beside it still hugs
						the left. */
				<span className="flex w-full min-w-0 items-center gap-2">
					<span className="flex min-w-0 items-center gap-2">
						<span className="truncate text-heading text-ink">{title}</span>
						{/* The count is stated only when there is one to state: a section whose
							   rows the tier filter is holding back reads `14 advanced`, not
						    `0 settings, 14 advanced`. */}
						{rowCount > 0 && (
							<span className="shrink-0 text-meta text-ink-dim">
								{rowCount === 1 ? "1 setting" : `${rowCount} settings`}
							</span>
						)}
						{scope && (
							<span className="shrink-0 text-meta text-ink-dim">{scope}</span>
						)}
						{advancedCount > 0 && (
							<span className="shrink-0 text-meta text-ink-dim">
								{advancedCount} advanced
							</span>
						)}
					</span>
					{modified && <ChangedDot className="ml-auto" />}
				</span>
			}
		/>
	</div>
);
