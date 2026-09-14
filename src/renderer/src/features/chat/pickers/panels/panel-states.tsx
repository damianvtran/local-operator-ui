import { Skeleton } from "@shared/components/ui/skeleton";
import { cn } from "@shared/lib/utils";

/**
 * The four ways a region can be not-a-table.
 *
 * Each kind exists because it is a different fact, and the differences are the
 * reason this is one component rather than four call sites' own JSX:
 *
 * - `loading` is a wait with something honest to say about it (a command the
 *   owner has to answer). FIRST PAINT is not this: where the shape of what is
 *   coming is known, a panel renders {@link PanelSkeleton}, because a skeleton
 *   says "here is where the content will be" and a sentence in an empty body
 *   says nothing.
 * - `unavailable` replaces a section's content AND its meta. When the read
 *   failed, the section has no qualifier to state — "Last 7 days" beside a
 *   failure is a claim about a window nothing was read from.
 * - `degraded` is a quiet line ABOVE content that is still shown: a partial
 *   read, or a caveat about a number that is nevertheless the answer.
 * - `empty` is a claim about an ANSWER, so it is only reachable once an answer
 *   exists. "No calls in this window" must not be shown for a backend that
 *   never replied; that state is `unavailable`.
 *
 * MUST NOT: show a spinner and a sentence for the same state (a spinner says
 * "wait", the sentence says what is being waited for — one of the two is
 * always redundant); use `danger` ink for a value nobody could measure. An
 * unread field is not an error — it is `ink-dim`, and the TUI's own rule is
 * "unknown must never be drawn as a warning".
 */

export type PanelNoticeProps = {
	kind: "loading" | "unavailable" | "empty" | "degraded";
	/** One sentence: what happened, what it means, what to do, in that order. */
	text: string;
	/** The backend's own detail text or a measurement caveat. Mono, one line. */
	detail?: string;
};

const TEXT_CLASS: Record<PanelNoticeProps["kind"], string> = {
	loading: "text-ink-muted",
	unavailable: "text-ink",
	empty: "text-ink-muted",
	degraded: "text-ink-muted",
};

export const PanelNotice = ({ kind, text, detail }: PanelNoticeProps) => (
	<div className={cn("flex flex-col gap-1 py-1")}>
		<p className={cn("text-body-sm", TEXT_CLASS[kind])}>{text}</p>
		{detail ? (
			<p className={cn("font-mono text-ink-dim text-mono-sm")}>{detail}</p>
		) : null}
	</div>
);

/** `empty`, named for what it is at the call site. */
export const PanelEmpty = ({
	text,
	detail,
}: {
	text: string;
	detail?: string;
}) => <PanelNotice kind="empty" text={text} detail={detail} />;

export type PanelSkeletonProps = {
	/** The shape of what is coming, so first paint does not jump. */
	shape: "stats" | "chart" | "table";
	/** Table rows to sketch. */
	rows?: number;
};

export const PanelSkeleton = ({ shape, rows = 6 }: PanelSkeletonProps) => {
	if (shape === "stats") {
		return (
			<div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4")}>
				{[0, 1, 2, 3].map((cell) => (
					<div
						key={cell}
						className={cn(
							"flex flex-col gap-2 rounded-lg border border-hairline bg-surface p-4",
						)}
					>
						<Skeleton className={cn("h-3 w-20")} />
						<Skeleton className={cn("h-6 w-24")} />
						<Skeleton className={cn("h-3 w-full")} />
					</div>
				))}
			</div>
		);
	}
	if (shape === "chart") {
		return (
			<div className={cn("flex flex-col gap-2")}>
				<Skeleton className={cn("h-4 w-32")} />
				<Skeleton className={cn("h-56 w-full")} />
			</div>
		);
	}
	return (
		<div className={cn("flex flex-col gap-2")}>
			<Skeleton className={cn("h-6 w-full")} />
			{sketchRows(rows).map((key) => (
				<Skeleton key={key} className={cn("h-4 w-full")} />
			))}
		</div>
	);
};

/**
 * Stable keys for placeholder rows.
 *
 * Not the index: the rows are decorative placeholders whose order never
 * changes, but an index key is how a list that DOES reorder keeps rendering a
 * neighbour's state — and a skeleton is the last place to want that habit
 * taught. `skeleton-row-N` is stable for the life of the skeleton and unique
 * within it.
 */
const sketchRows = (rows: number): string[] =>
	Array.from({ length: rows }, (_, index) => `skeleton-row-${index}`);
