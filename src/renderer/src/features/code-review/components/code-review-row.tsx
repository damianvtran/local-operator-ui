import { Badge } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { ArrowUpRight, GitPullRequest } from "lucide-react";
import type { FC } from "react";
import { openUrlTarget } from "../../chat/utils/link-open";
import {
	type CodeRequestRow as CodeRequestRowData,
	actedTag,
	ciClause,
	commentClause,
	forgeSigil,
	linkOnlyRemedy,
	refreshCaption,
	relationTag,
	rowAriaLabel,
	statePill,
	updatedClause,
} from "../code-review-model";
import { CodeReviewRounds } from "./code-review-rounds";

/**
 * One row of the Code review list (§1 of the build spec).
 *
 * ONE `<button>` IS THE WHOLE ROW and there are no nested controls (§13's
 * conflict 5 settled it: a refresh control inside a row would be a button
 * inside a button, and refresh is host-scoped anyway - one quota covers every
 * row). The row's press opens the forge URL through `openUrlTarget`, the system
 * browser, where the operator's forge login lives - the same path every other
 * link in the app takes.
 *
 * THE MARK COLUMN IS THE RUN PANEL'S ROW GRAMMAR (16px glyph, `pt-0.5`), so a
 * list of requests reads as a sibling of the lists one pane over. The glyph is
 * the PANE'S OWN (`GitPullRequest`, the rail item's), one glyph one meaning.
 *
 * WHAT IS DELIBERATELY NOT HERE: no per-row retry (§13.5), no hover lift
 * ("nothing lifts on hover" - `hover:bg-row-hover` is a colour step), and no
 * dimming for a failed refresh: "a caption, not a treatment" (§3) - the row's
 * data stays at full ink under the `Couldn't refresh` line.
 */
export type CodeReviewRowProps = {
	row: CodeRequestRowData;
	/** The pane's clock, milliseconds; pinned by stories for reproducible text. */
	nowMs: number;
};

const CI_TONE_CLASS = {
	plain: "text-ink-muted",
	danger: "text-danger",
	muted: "text-ink-dim",
} as const;

/** The `·` between two meta figures: decoration in `ink-dim`. */
const MetaSeam: FC = () => (
	<span aria-hidden="true" className={cn("text-ink-dim")}>
		·
	</span>
);

export const CodeReviewRow: FC<CodeReviewRowProps> = ({ row, nowMs }) => {
	const pill = statePill(row);
	const relation = [relationTag(row), actedTag(row)]
		.filter((tag): tag is string => tag !== null)
		.join(" · ");
	const ci = row.summary ? ciClause(row.summary.ci) : null;
	const comments = row.summary ? commentClause(row.summary.comments) : null;
	const updated = row.summary
		? updatedClause(row.summary.updated_at, nowMs)
		: null;
	const caption = refreshCaption(row);
	const canShowMeta = !row.link_only && Boolean(row.summary);
	/*
	 * The link-only row's one visible line: the BACKEND'S OWN remedy sentence,
	 * rendered verbatim (agent review F8 / design D8 / UX U5). The old
	 * `forge === "gitlab" ? glab : gh` derivation named a CLI that does not
	 * exist for a detect-and-link host; the sentence already leads with `Link
	 * only`, so the caption and the remedy are one line, and the `title`
	 * carries the whole of it where the line truncates.
	 */
	const remedy = row.link_only ? linkOnlyRemedy(row) : null;
	return (
		<li data-code-request-row={row.key} className={cn("list-none")}>
			<button
				type="button"
				aria-label={rowAriaLabel(row)}
				onClick={() => void openUrlTarget(row.url)}
				className={cn(
					"group/row flex w-full items-start gap-2 px-3 py-1 text-left cursor-pointer",
					/*
					 * THE ROW'S HOVER IS THE RUN-DETAIL ROW'S TOKEN: a step DOWN to
					 * `bg-surface`, never up to `elevated` (UX round 1, U4 measured
					 * `bg-row-hover` at a 1.001:1 step - imperceptible). `duration-fast`
					 * matches the sibling list's transition.
					 */
					"transition-colors duration-fast hover:bg-surface",
					/*
					 * AN INSET RING: the app's default 2px outline sits outside the box and
					 * the list's `overflow-y-auto` clips its left and right edges at the
					 * pane's padding, which read as a divider rather than a focus ring (U4).
					 * `outline-offset-[-2px]` is the house inset spelling
					 * (`mesh-canvas.tsx`, `canvas-file-viewer.tsx`).
					 */
					"focus-visible:outline-offset-[-2px]!",
				)}
			>
				<span className={cn("pt-0.5 text-ink-dim")}>
					{/*
					 * `size-4` AS A CLASS, not the `size-4` JSX attribute (agent review
					 * F4 / design D1): the attribute spelling rendered a 24px glyph and
					 * React's `non-boolean attribute` warning; 16px matches the sibling
					 * lists' marks.
					 */}
					<GitPullRequest className={cn("size-4")} aria-hidden={true} />
				</span>
				<span className={cn("flex min-w-0 flex-1 flex-col gap-0.5")}>
					{/*
					 * LINE A - identity, the disambiguating tag, the state pill.
					 *
					 * THE NUMBER NEVER TRUNCATES (design D3 / UX U8): at the 320px floor
					 * the merged rows all read `damianvtran/local-operator #2…` and were
					 * indistinguishable. The project truncates; the `#N` (`!N` on GitLab,
					 * D6) is `shrink-0`; the relation tag yields before either.
					 */}
					<span className={cn("flex w-full min-w-0 items-center gap-2")}>
						<span className={cn("flex min-w-0 flex-1 items-baseline gap-1")}>
							<span
								className={cn(
									"min-w-0 truncate text-meta text-ink-muted tabular-nums",
								)}
								title={`${row.project} ${forgeSigil(row)}${row.number}`}
							>
								{row.project}
							</span>
							<span
								className={cn("shrink-0 text-meta text-ink-muted tabular-nums")}
							>
								{forgeSigil(row)}
								{row.number}
							</span>
						</span>
						{relation && (
							<span
								className={cn("min-w-0 truncate text-meta text-ink-dim")}
								title={
									row.relation === "unknown"
										? "Possibly opened by this session; the evidence did not prove it was."
										: undefined
								}
							>
								{relation}
							</span>
						)}
						{pill && (
							<Badge
								variant={pill.variant}
								shape="rounded"
								className={cn("ml-auto shrink-0")}
							>
								{pill.label}
							</Badge>
						)}
						{/*
						 * THE PRESS'S AFFORDANCE (UX round 1, U4): a trailing arrow the
						 * row's hover or keyboard focus reveals, `aria-hidden` because the
						 * accessible name already says where the press goes. `ExternalLink`
						 * is the family's "leaves this surface" glyph (the chip register
						 * keeps one glyph one meaning), and `ArrowUpRight` is that meaning
						 * in a row's compact register (`wake-conversation-row.tsx`).
						 */}
						<ArrowUpRight
							aria-hidden={true}
							className={cn(
								"size-3.5 shrink-0 text-ink-dim opacity-0 transition-opacity duration-fast",
								"group-hover/row:opacity-100 group-focus-visible/row:opacity-100",
							)}
						/>
					</span>
					{/* LINE B - the title, in `ink` (the row's loudest run). */}
					<span
						className={cn("truncate text-body-sm text-ink")}
						title={row.summary?.title ?? undefined}
					>
						{row.summary?.title ?? row.url}
					</span>
					{/* LINE C - the lane strip, while it has anything to say. */}
					{!row.link_only && <CodeReviewRounds row={row} />}
					{/* LINE D - the meta figures, `·`-seamed. */}
					{canShowMeta && (ci || comments || updated) && (
						<span
							className={cn(
								"flex flex-wrap items-baseline gap-1 text-meta text-ink-muted",
							)}
						>
							{ci && (
								<span className={cn(CI_TONE_CLASS[ci.tone])}>{ci.text}</span>
							)}
							{ci && comments && <MetaSeam />}
							{comments && <span>{comments}</span>}
							{(ci || comments) && updated && <MetaSeam />}
							{updated && <span>{updated}</span>}
						</span>
					)}
					{/* LINE E - the captions, one line, conditional. */}
					{remedy ? (
						<span
							className={cn("truncate text-meta text-ink-dim")}
							title={
								row.reason && row.reason !== remedy
									? `${remedy} ${row.reason}`
									: remedy
							}
						>
							{remedy}
						</span>
					) : (
						caption && (
							<span className={cn("text-meta text-ink-dim")}>{caption}</span>
						)
					)}
				</span>
			</button>
		</li>
	);
};
