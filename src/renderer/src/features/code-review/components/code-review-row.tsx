import { Badge } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { GitPullRequest } from "lucide-react";
import type { FC } from "react";
import { openUrlTarget } from "../../chat/utils/link-open";
import {
	type CodeRequestRow as CodeRequestRowData,
	actedTag,
	ciClause,
	commentClause,
	refreshCaption,
	relationTag,
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
	 * The link-only caption's own sentence, host-aware: the pane cannot refresh
	 * without a credential, and the two CLIs are the two credentials this app
	 * resolves. A host that is neither still gets the gh sentence - the only
	 * rung the design names - and `forgeDisplayName` is not involved because
	 * this is about a login, not a brand.
	 */
	const tool = row.forge === "gitlab" ? "glab" : "gh";
	return (
		<li data-code-request-row={row.key} className={cn("list-none")}>
			<button
				type="button"
				onClick={() => void openUrlTarget(row.url)}
				className={cn(
					"group/row flex w-full items-start gap-2 px-3 py-1 text-left cursor-pointer",
					"hover:bg-row-hover focus-visible:outline-offset-1!",
				)}
			>
				<span className={cn("pt-0.5 text-ink-dim")}>
					<GitPullRequest size-4 aria-hidden={true} />
				</span>
				<span className={cn("flex min-w-0 flex-1 flex-col gap-0.5")}>
					{/*
					 * LINE A - identity, the disambiguating tag, the state pill. The
					 * identity truncates first (it is the longest and the least load-bearing:
					 * the tooltip carries it whole), the tag and pill never truncate - a state
					 * cut mid-word is a broken claim. The pill sits at the right edge via
					 * `ml-auto` so it lands in the same column on every row, truncate or not.
					 */}
					<span className={cn("flex w-full min-w-0 items-center gap-2")}>
						<span
							className={cn(
								"min-w-0 flex-1 truncate text-meta text-ink-muted tabular-nums",
							)}
							title={`${row.project} #${row.number}`}
						>
							{row.project} #{row.number}
						</span>
						{relation && (
							<span
								className={cn("shrink-0 text-meta text-ink-dim")}
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
					{row.link_only ? (
						<span
							className={cn("text-meta text-ink-dim")}
							title={`Link only — sign in with ${tool} to track this one.`}
						>
							Link only
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
