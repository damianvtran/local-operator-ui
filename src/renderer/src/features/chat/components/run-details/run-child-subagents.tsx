/**
 * The subagents of the child whose page is open (`docs/run-sidebar.md` § 5.2b).
 *
 * WHY THIS EXISTS. The pane has modelled the whole delegation tree since the
 * reader shipped — `parentJobId` is the edge, `RunDetails.lineage` is every node,
 * `SubagentRow.childCount` is the branching factor — but only the tree's TOP
 * level was ever a list. On a child's own page the chrome bar said `2 child
 * subagents` and offered a control that descends into the FIRST of them, so the
 * other children were reachable only by the peer stepper, one press at a time,
 * and the levels below a grandchild were not addressable at all. This is the
 * missing list: one row per DIRECT child of the page's own child, each row
 * opening that child's page through the pane's existing `openChild`, so a reader
 * walks the tree downwards with this section and upwards with the controls the
 * chrome bar already carries (back, the breadcrumb, `Escape`).
 *
 * THE ROWS ARE THE ROSTER'S ROWS, deliberately: `SubagentRowView`,
 * `SubagentRowBody` and `DetailLine` come from the roster's own files, so this
 * list, the roster and the Jobs section cannot drift in height, hover ground,
 * focus ring, accessible name or second line. §4.1's row-height ladder therefore
 * holds here by construction rather than by a second copy of `py-1.5`.
 *
 * The one mark these rows carry that the roster's do not is the count of their
 * own children — see `ChildCount`.
 */

import { cn } from "@shared/lib/utils";
import { ChevronRight } from "lucide-react";
import {
	type SubagentRow,
	childCountFitsInline,
	childCountLabel,
} from "./run-detail-model";
import { SubagentRowView } from "./run-detail-subagents";

/**
 * A row's own subagents, counted (`SubagentRow.childCount`), as a POINTER to the
 * level below rather than as another figure.
 *
 * On the page that lists a child's subagents this is the only thing that says a
 * row has ANOTHER level below it: the row opens that child's page, where the next
 * level is listed in turn, and without the mark the only way to find out is to
 * open every row. Rendered only when the count is non-zero, so absence is the
 * leaf row's state rather than a `0 children` mark on most of the list.
 *
 * The WORD is the chrome bar's (`N child(ren)`, `§ 9`) and stays it: the same
 * relation one level down reads as the same relation rather than as a second
 * vocabulary. What design round 1 (D2) found was that the word alone, in the
 * run's own ink and size at the line's tightest joint, was indistinguishable from
 * the bar's descend control (`Button variant="ghost"`, `text-meta
 * text-ink-muted`) — `40s · 3% · $0.01  1 child` parsed as a fourth value that
 * does nothing when pressed. So the mark now LEADS the word with the app's own
 * chevron (`branding.md` § 9's disclosure chevron: `ChevronRight`, 14px,
 * `text-ink-dim`), which is the one thing the bar's control does not have and the
 * thing that says "there is a level below, this way". The row it sits on opens a
 * PAGE rather than expanding in place, which is also how the app's other
 * directional chevrons read (the breadcrumb's crumbs, the peer steppers).
 *
 * `size-3.5` and not the icon ramp's "12 inline with `meta`" row, deliberately:
 * the chevron has a size rule OF ITS OWN (§ 9 fixes it at 14px), every trailing
 * chevron gutter in the app is that box (`CHEVRON_GUTTER` in
 * `backend-setting-row.tsx`, the composer's status chips), and one mark at two
 * sizes one line apart is the drift `branding.md` § 5's icon section exists to
 * stop.
 *
 * The chevron is hand-placed rather than rendered through
 * `@shared/components/ui/disclosure`, and for the structural reason § 9 gives for
 * its other exceptions: this mark lives INSIDE the row's own `<button>` — the row
 * is the control — and a button inside a button is not markup a browser resolves.
 * The primitive's `disabled` branch, which is how the to-dos section renders an
 * inert count, reserves the chevron slot and paints nothing in it, so it cannot
 * carry a depth cue at all. The signal is not reinvented here: same glyph, same
 * size, same ink as the primitive's.
 *
 * The mark's box is `self-center` and `items-center` inside, rather than the
 * line's plain `items-baseline`, because of how a nested box takes its baseline:
 * the box's own baseline is synthesised from its FIRST item, the glyph, i.e. the
 * glyph's bottom edge — so baseline-aligning it would sit this 12px word about
 * 3px above the numbers run it follows (arithmetic from the type scale: a 12px
 * `text-meta` line box is 17.4px inside the row's 20px line). Centring the box
 * puts the word within ~0.5px of the run's baseline and the glyph on the line's
 * centre, which is the joint D2 is about.
 *
 * `ml-1` on top of the line's `gap-2` is the other half of D2: the run separates
 * its own figures by ~11px around their `·` (measured in
 * `reader-descendants/localOperatorDark`: `reviewer` to `1m7s`), so a different
 * KIND of fact arriving at 8px — the line's tightest joint — was what made the
 * mark read as a fourth figure. 8 + 4 = 12px is wider than the run's internal
 * seam, and it is followed by a glyph rather than by a `·`, so the mark reads as
 * a pointer at the end of the run rather than as another figure in it.
 *
 * The mark is `shrink-0` and SHEDS WHOLE below 378px (`childCountFitsInline`):
 * the label is the segment that may lose characters (`§ 8`'s numbers rule — it
 * carries a `title` with its whole string) and the mark may not spend the label's
 * floor to stay on the line.
 */
const ChildCount = ({
	row,
	paneWidth,
}: {
	row: SubagentRow;
	/** The pane's own width, which is what the shed above is measured against. */
	paneWidth: number;
}) => {
	const label = childCountLabel(row);
	if (!label || !childCountFitsInline(paneWidth)) return null;
	return (
		<span
			className={cn(
				"ml-1 flex shrink-0 items-center gap-1 self-center text-meta text-ink-muted",
			)}
		>
			<ChevronRight
				aria-hidden={true}
				className={cn("size-3.5 shrink-0 text-ink-dim")}
			/>
			{label}
		</span>
	);
};

export const ChildSubagents = ({
	ownerLabel,
	rows,
	interactive,
	onOpenChild,
	paneWidth,
}: {
	/** The label of the child whose page this is, for the section's own name. */
	ownerLabel: string;
	/** This child's direct children, in the wire's order (`childrenOf`). */
	rows: readonly SubagentRow[];
	/**
	 * Whether a row can be opened at all — the `subagent_transcript` capability
	 * (`§ 10.2`), passed rather than re-derived here so the roster, the chrome
	 * bar's descend control and this list answer it from one place. A row the wire
	 * gives no session id is unlit for its own reason, inside `SubagentRowView`.
	 */
	interactive: boolean;
	/** The pane's own open: the reader walks DOWN the tree through it. */
	onOpenChild: (id: string) => void;
	/**
	 * The pane's own width, which is what the row mark's shed rule is measured
	 * against (`childCountFitsInline`).
	 *
	 * Past the pane rather than read from the preference store HERE, for the reason
	 * the roster's `tallyBudget` is (`run-detail-subagents.tsx`): the width the pane
	 * is actually drawn at is the caller's, and a section that read the store could
	 * disagree with the pane it sits in at the window floor.
	 */
	paneWidth: number;
}) => {
	/*
	 * Nothing at all when the open child has no children — not an empty section
	 * and not a `0 subagents` line: most children delegate to nobody, and a section
	 * that renders to say so would put a heading and a rule on every leaf page in
	 * exchange for no fact. The model's own absence rule, applied to a section
	 * rather than to a figure: something a row does not have is omitted, never
	 * zeroed (`run-detail-row-parts.tsx`, the numbers run).
	 */
	if (rows.length === 0) return null;
	return (
		<section
			/*
			 * The section's name states whose children these are, and now the VISIBLE
			 * label does too (design round 1, D3): the pane's own roster uses the bare
			 * word `Subagents` for the pane's list, and one word cannot cover both sets.
			 * The accessible name is kept beside it rather than dropped now that the two
			 * agree, because it is the only spelling that keeps the WHOLE owner: the
			 * visible one truncates (below).
			 */
			aria-label={`Subagents of ${ownerLabel}`}
			/*
			 * The list's own hook, distinct from the roster's `data-run-panel-row`
			 * on purpose (see `SubagentRowView.rowHook`): this is the READER's page
			 * content, and the pane's "the reader replaces the roster" reading —
			 * which `scripts/run-panel-navigation.test.mjs` asserts and the reveal
			 * rig measures — counts the roster's rows alone.
			 */
			data-run-panel-child-subagents=""
			className={cn("flex shrink-0 flex-col border-hairline border-b pb-1.5")}
		>
			{/*
			 * No cap, and that is a decision rather than an omission. The roster's cap
			 * exists because `frontend.jobs` is the session's whole ledger and the
			 * roster is the pane's default view of it; the population here is ONE
			 * child's own delegations — the rows the chrome bar's `N child subagents`
			 * control already counts — and a cap would put a child back behind a
			 * control that does not exist, i.e. the unreachable-node defect this
			 * section is here to fix. What bounds the band is what bounds any head
			 * block: the transcript below is `flex-1 min-h-0` and gives up its height
			 * first.
			 */}
			{/*
			 * The pane's section-label grammar (`run-detail-jobs.tsx`): label left,
			 * `text-meta`/`ink-muted`, on the panel's own `px-3 pt-2 pb-1` ramp. No
			 * tally on the right, unlike the roster's sections: the count is per ROW
			 * here (a child's own children differ row by row), and a section total
			 * would be a second number saying the same thing as the rows it sits
			 * over.
			 */}
			<div
				className={cn(
					"flex items-baseline justify-between gap-2 px-3 pt-2 pb-1",
				)}
			>
				{/*
				 * `Subagents of <owner>`, in the pane's section-label grammar
				 * (`run-detail-jobs.tsx`), and the owner is why: a bare `Subagents` here is
				 * the same word the ROSTER's heading uses for the pane's list, and this is a
				 * different set — the open child's own children (design round 1, D3; `§ 5.2b`).
				 * `§ 5.2`'s "the breadcrumb is the title" is at its weakest at depth: the
				 * `reader-childless` frame's bar reads `Run details / Re-che… / V… / Re-t… /
				 * Check the A…`, so no legible text on the page names the owner. The owner
				 * is MODEL-authored, so it truncates rather than governing the line: the
				 * `Subagents of` prefix is `shrink-0` and the name is `min-w-0 truncate`
				 * with its whole string in a `title`, so a long label shortens the heading
				 * instead of pushing it past the pane (the reading `§ 8` gives every
				 * label).
				 */}
				<span
					className={cn(
						"flex min-w-0 items-baseline gap-1 text-meta text-ink-muted",
					)}
				>
					<span className={cn("shrink-0")}>Subagents of</span>
					<span className={cn("min-w-0 truncate")} title={ownerLabel}>
						{ownerLabel}
					</span>
				</span>
			</div>
			<ul className={cn("flex flex-col")}>
				{rows.map((row) => (
					<SubagentRowView
						key={row.id}
						row={row}
						interactive={interactive}
						onOpen={onOpenChild}
						trailing={<ChildCount row={row} paneWidth={paneWidth} />}
						rowHook="data-run-panel-child-row"
					/>
				))}
			</ul>
		</section>
	);
};
