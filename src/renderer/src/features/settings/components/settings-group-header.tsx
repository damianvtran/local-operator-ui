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
			 * The trigger's own ink is `ink-dim` for a trace chip; a section heading
			 * is a heading, so the resting ink steps up to `ink` and the hover step
			 * disappears with it — there is nothing for it to step up TO. The
			 * override is passed here rather than styled around the component
			 * because the primitive owns the button.
			 */
			triggerClassName="text-ink hover:text-ink"
			/* One shape for all 18 headers, which is what makes the arrival index
		   scan as a list rather than as 18 differently-sized things.

			   `[&>div:empty]:hidden` is not decoration: the primitive renders its
			   disclosed-content box whenever it is open, and this header discloses
			   nothing - the rows are the SECTION's, one level out, which is what keeps
			   them mounted across a collapse. Left alone, that empty box (`mt-1 pb-1`)
			   made every OPEN header 48px and every closed one 40px, so the index grew
			   8px per open section and "the same 40px shape" was false in the one way
			   nobody would notice. */
			rowClassName="min-h-10 py-0"
			className="w-full [&>div:empty]:hidden"
			summary={
				/* Marks, and only marks. The section's own description is NOT here:
			   it renders inside the section when it is open, because a second
			   line under every title is what turned the index into 18 blocks
			   and made the region 12 screens tall. */
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
					{modified && <ChangedDot />}
				</span>
			}
		/>
	</div>
);
