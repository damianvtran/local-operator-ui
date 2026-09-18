/**
 * The subagents of the child whose page is open (`docs/run-sidebar.md` § 5).
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
import { type SubagentRow, childCountLabel } from "./run-detail-model";
import { SubagentRowView } from "./run-detail-subagents";

/**
 * A row's own subagents, counted (`SubagentRow.childCount`), or nothing.
 *
 * On the page that lists a child's subagents this is the only thing that says a
 * row has ANOTHER level below it: the row opens that child's page, where the next
 * level is listed in turn, and without the count the only way to find out is to
 * open every row. Rendered only when the count is non-zero, so absence is the
 * leaf row's state rather than a `0 children` mark on most of the list.
 *
 * `text-meta` / `ink-muted` are the row's own secondary roles (the same pair the
 * numbers run takes), and it is `shrink-0` for the numbers run's reason: the
 * label absorbs the squeeze, because the label is the one segment that can lose
 * characters without losing its meaning (it carries a `title` with the whole
 * string).
 */
const ChildCount = ({ row }: { row: SubagentRow }) => {
	const label = childCountLabel(row);
	if (!label) return null;
	return (
		<span className={cn("shrink-0 text-meta text-ink-muted")}>{label}</span>
	);
};

export const ChildSubagents = ({
	ownerLabel,
	rows,
	interactive,
	onOpenChild,
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
			 * The section's ACCESSIBLE NAME states whose children these are, which
			 * the visible label cannot: the pane keeps its title in the breadcrumb
			 * (`§ 5.2`) and a reader's page carries no visible heading of its own, so
			 * a section named `Subagents` on its own would be the one list in the
			 * pane whose owner is nowhere on screen.
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
				<span className={cn("shrink-0 text-meta text-ink-muted")}>
					Subagents
				</span>
			</div>
			<ul className={cn("flex flex-col")}>
				{rows.map((row) => (
					<SubagentRowView
						key={row.id}
						row={row}
						interactive={interactive}
						onOpen={onOpenChild}
						trailing={<ChildCount row={row} />}
						rowHook="data-run-panel-child-row"
					/>
				))}
			</ul>
		</section>
	);
};
