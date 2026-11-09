/**
 * A git-style unified diff of two strings: old/new line numbers in a gutter,
 * `-`/`+` markers, the exact words that changed highlighted inside a changed
 * line, unchanged context folded away, and next/previous-change navigation.
 *
 * ## Why it exists
 *
 * The operator asked for "a proper diff viewer, similar to how git diffs look,
 * where you can check and focus on the changed lines" when reviewing a proposed
 * profile change (Agents → <name>). The same need already existed in the hub
 * update preview, which drew the two sides as two `<pre>` boxes the reader had
 * to compare by eye. Both now render this one component, so the two review
 * surfaces read the same way. The model is `shared/lib/text-diff.ts` (pure,
 * unit-tested); this file only draws it.
 *
 * ## Constraints it keeps
 *
 * - Inks are the ones `trace/diff-block.tsx` already proved for contrast:
 *   `text-success` / `text-danger` on `bg-sunken`, `text-ink-dim` for context.
 *   Changed text stays in body ink on faint role washes; changed words also
 *   carry an underline, so hue alone never conveys the difference.
 * - Long lines WRAP (`whitespace-pre-wrap break-words`) rather than scroll
 *   sideways, for the reason `diff-block.tsx` records: a horizontal scroller in
 *   a narrow pane is a region the reader has to discover.
 * - Keyboard: the diff body is one tab stop. With focus anywhere inside it,
 *   `n` / `p` (or `j` / `k`) move to the next / previous change, which is
 *   focused and scrolled into view; the header buttons do the same for pointer
 *   and assistive-technology users. Each folded gap is a real `<button>`.
 * - Every word on screen comes from `t()`; the line text itself is the user's
 *   content and is never translated.
 */

import { useI18nLocale } from "@shared/i18n/use-locale";
import { type DiffLine, diffModel } from "@shared/lib/text-diff";
import { cn } from "@shared/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { t } from "../../../../../i18n/messages";

export type UnifiedDiffStats = {
	added: number;
	removed: number;
	hunks: number;
};

export type UnifiedDiffProps = {
	before: string;
	after: string;
	/** Unchanged lines kept visible around each change; git's default is 3. */
	context?: number;
	/** Highlight the changed words inside a changed line (default true). */
	wordLevel?: boolean;
	/** Names for the two sides, e.g. "Current" / "Proposed". */
	labels?: { before: string; after: string };
	/** CSS max-height of the scrolling body; unbounded when omitted. */
	maxHeight?: number | string;
	onStats?: (stats: UnifiedDiffStats) => void;
	className?: string;
	"data-testid"?: string;
};

const MARKER: Record<DiffLine["kind"], string> = {
	add: "+",
	del: "-",
	context: " ",
};

const INK: Record<DiffLine["kind"], string> = {
	add: "text-success",
	del: "text-danger",
	context: "text-ink-dim",
};

/** Row ground: a faint wash so a changed line reads as a band, git-style. */
const ROW_GROUND: Record<DiffLine["kind"], string> = {
	add: "bg-success-wash/40",
	del: "bg-danger-wash/40",
	context: "",
};

const NAV_BUTTON =
	"rounded-sm p-1 text-ink-muted hover:bg-row-hover hover:text-ink disabled:text-ink-disabled focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

const WORD_GROUND: Record<"add" | "del", string> = {
	// Ground AND an underline in the role colour: the changed words must not be
	// told apart by hue alone, and the wash is faint on the light themes.
	add: "rounded-[2px] bg-success-wash underline decoration-success decoration-2 underline-offset-2",
	del: "rounded-[2px] bg-danger-wash underline decoration-danger decoration-2 underline-offset-2",
};

function LineRow({ line }: { line: DiffLine }) {
	const changed = line.kind !== "context";
	return (
		<div
			className={cn("flex min-w-0", ROW_GROUND[line.kind])}
			data-diff-line={line.kind}
		>
			<span
				aria-hidden="true"
				className="w-9 shrink-0 select-none pr-1 text-right text-ink-dim tabular-nums"
			>
				{line.oldNo ?? ""}
			</span>
			<span
				aria-hidden="true"
				className="w-9 shrink-0 select-none pr-1 text-right text-ink-dim tabular-nums"
			>
				{line.newNo ?? ""}
			</span>
			<span
				aria-hidden="true"
				className={cn("w-4 shrink-0 select-none text-center", INK[line.kind])}
			>
				{MARKER[line.kind]}
			</span>
			<span
				className={cn(
					"min-w-0 flex-1 whitespace-pre-wrap break-words",
					// The marker carries the role colour; the words stay in body ink on
					// the faint wash so a long changed paragraph is still readable.
					changed ? "text-ink" : "text-ink-muted",
				)}
			>
				{line.kind !== "context" && (
					<span className="sr-only">
						{line.kind === "add"
							? t("ui.shared.unified_diff.line_added")
							: t("ui.shared.unified_diff.line_removed")}{" "}
					</span>
				)}
				{line.segments && line.kind !== "context"
					? line.segments.map((segment, index) =>
							segment.changed ? (
								<mark
									// biome-ignore lint/suspicious/noArrayIndexKey: an immutable ordered split of one line
									key={index}
									data-diff-word={line.kind}
									className={cn("text-inherit", WORD_GROUND[line.kind])}
								>
									{segment.text}
								</mark>
							) : (
								// biome-ignore lint/suspicious/noArrayIndexKey: an immutable ordered split of one line
								<span key={index}>{segment.text}</span>
							),
						)
					: line.text || "\u00a0"}
			</span>
		</div>
	);
}

export function UnifiedDiff({
	before,
	after,
	context = 3,
	wordLevel = true,
	labels,
	maxHeight,
	onStats,
	className,
	"data-testid": testId = "unified-diff",
}: UnifiedDiffProps) {
	// Refresh translated copy when the language changes.
	useI18nLocale();
	const model = useMemo(
		() => diffModel(before, after, { context, wordLevel }),
		[before, after, context, wordLevel],
	);
	const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
	const [current, setCurrent] = useState(-1);
	const changeRefs = useRef<(HTMLFieldSetElement | null)[]>([]);

	// A new pair of texts is a new diff: folds and position start over.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on input change only
	useEffect(() => {
		setExpanded(new Set());
		setCurrent(-1);
	}, [before, after]);

	useEffect(() => {
		onStats?.({
			added: model.added,
			removed: model.removed,
			hunks: model.changes,
		});
	}, [model, onStats]);

	const goTo = useCallback(
		(index: number) => {
			if (model.changes === 0) return;
			const bounded = Math.max(0, Math.min(model.changes - 1, index));
			setCurrent(bounded);
			const target = changeRefs.current[bounded];
			if (target) {
				target.focus({ preventScroll: true });
				target.scrollIntoView?.({ block: "nearest" });
			}
		},
		[model.changes],
	);
	const next = () => goTo(current < 0 ? 0 : current + 1);
	const previous = () => goTo(current < 0 ? model.changes - 1 : current - 1);

	const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const key = event.key.toLowerCase();
		if (key === "n" || key === "j") {
			event.preventDefault();
			next();
		} else if (key === "p" || key === "k") {
			event.preventDefault();
			previous();
		}
	};

	if (model.identical)
		return (
			<p
				data-testid={testId}
				data-diff-identical="true"
				className={cn(
					"rounded-md border border-hairline bg-sunken p-3 text-meta text-ink-muted",
					className,
				)}
			>
				{t("ui.shared.unified_diff.no_changes")}
			</p>
		);

	return (
		<div
			data-testid={testId}
			className={cn(
				"overflow-hidden rounded-md border border-hairline bg-sunken",
				className,
			)}
		>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-hairline border-b px-3 py-1.5 text-meta">
				<span
					data-diff-stats
					aria-hidden="true"
					className="font-mono tabular-nums"
				>
					<span className="text-success">+{model.added}</span>{" "}
					<span className="text-danger">
						{"\u2212"}
						{model.removed}
					</span>
					<span className="text-ink-muted">
						{" \u00b7 "}
						{t("ui.shared.unified_diff.changes", { count: model.changes })}
					</span>
				</span>
				<span className="sr-only">
					{t("ui.shared.unified_diff.stats_accessible", {
						added: model.added,
						removed: model.removed,
					})}
				</span>
				{labels && (
					<span className="min-w-0 truncate text-ink-muted">
						<span className="text-danger">-</span> {labels.before}{" "}
						<span className="text-success">+</span> {labels.after}
					</span>
				)}
				<span className="ml-auto flex items-center gap-1">
					{current >= 0 && (
						<span className="text-ink-muted tabular-nums" aria-live="polite">
							{t("ui.shared.unified_diff.position", {
								index: current + 1,
								total: model.changes,
							})}
						</span>
					)}
					<button
						type="button"
						onClick={previous}
						disabled={model.changes === 0}
						aria-label={t("ui.shared.unified_diff.previous")}
						title={t("ui.shared.unified_diff.previous_hint")}
						className={NAV_BUTTON}
					>
						<ChevronUp aria-hidden="true" className="h-4 w-4" />
					</button>
					<button
						type="button"
						onClick={next}
						disabled={model.changes === 0}
						aria-label={t("ui.shared.unified_diff.next")}
						title={t("ui.shared.unified_diff.next_hint")}
						className={NAV_BUTTON}
					>
						<ChevronDown aria-hidden="true" className="h-4 w-4" />
					</button>
				</span>
			</div>
			<section
				// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable diff owns keyboard navigation
				tabIndex={0}
				aria-label={t("ui.shared.unified_diff.accessible")}
				aria-keyshortcuts="n p"
				onKeyDown={onKeyDown}
				className="overflow-y-auto py-1 font-mono text-mono-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
				style={maxHeight !== undefined ? { maxHeight } : undefined}
			>
				{model.blocks.map((block) => {
					if (block.kind === "change")
						return (
							<fieldset
								key={block.id}
								ref={(node) => {
									changeRefs.current[block.index] = node;
								}}
								tabIndex={-1}
								data-diff-change={block.index}
								data-current={current === block.index || undefined}
								aria-label={t("ui.shared.unified_diff.position", {
									index: block.index + 1,
									total: model.changes,
								})}
								className={cn(
									"scroll-my-6 border-l-2 border-transparent outline-none",
									current === block.index && "border-l-accent",
								)}
							>
								{block.lines.map((line) => (
									<LineRow
										key={`${line.kind}:${line.oldNo}:${line.newNo}`}
										line={line}
									/>
								))}
							</fieldset>
						);
					if (block.kind === "gap")
						return (
							<div key={block.id} tabIndex={-1} className="outline-none">
								{expanded.has(block.id) ? (
									block.lines.map((line) => (
										<LineRow
											key={`c:${line.oldNo}:${line.newNo}`}
											line={line}
										/>
									))
								) : (
									<button
										type="button"
										data-diff-gap={block.lines.length}
										onClick={(event) => {
											// The button is about to disappear; preserve the keyboard
											// reader's place in its stable expanded-context container.
											event.currentTarget.parentElement?.focus({
												preventScroll: true,
											});
											setExpanded((open) => new Set(open).add(block.id));
										}}
										className="my-0.5 block w-full bg-surface py-0.5 text-center font-sans text-ink-muted text-meta hover:bg-row-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2"
									>
										{t("ui.shared.unified_diff.show_unchanged", {
											count: block.lines.length,
										})}
									</button>
								)}
							</div>
						);
					return (
						<div key={block.id} className="border-l-2 border-transparent">
							{block.lines.map((line) => (
								<LineRow key={`c:${line.oldNo}:${line.newNo}`} line={line} />
							))}
						</div>
					);
				})}
			</section>
		</div>
	);
}
