/**
 * `/usage` — provider quota as a table, not as JSON.
 *
 * This view answers one question: can I keep working, and if not, when does
 * that change. The TUI's `usage_panel.py` already answers it; the rules are
 * ported in `usage-view-model.ts` and this file only arranges them. Anything
 * numeric or textual that looks like a decision belongs there, so a reviewer
 * can check it against the Python without reading JSX.
 *
 * Split in two on purpose:
 *
 *   `UsageReports` is presentational — `(reports, source, fetchedAt, now)` in,
 *   pixels out, no fetching and no clock of its own. That is what the stories
 *   render, so every state (stale, unavailable, dead grant, unmeasurable) can
 *   be photographed without a backend and without waiting for one to misbehave.
 *
 *   `UsageView` is the container the picker registry mounts: it owns the
 *   `usage.get` query and the "fetch live" action, and nothing else.
 *
 * Design contract (`docs/branding.md`): roles never colours, every `className`
 * through `cn`, radius/spacing off the ramp, monospace only for machine voice.
 * The dialog ground is `elevated`, so a provider block takes `surface` (the
 * step down that reads as a card) and the bar track takes `sunken` (a third,
 * clearly recessed step).
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { Button } from "@shared/components/ui/button";
import { cn } from "@shared/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { type FC, useState } from "react";
import type { PickerContext } from "./destination-pickers";
import { PickerHost } from "./picker-host";
import {
	type EffectiveStatus,
	type LimitRow,
	type ProviderBlock,
	type UsagePayload,
	type UsageReport,
	collectStats,
	describeSource,
	describeStats,
	providerBlocks,
} from "./usage-view-model";
import { errorText } from "./use-picker-backend";

/**
 * Tint per status. Roles, never colours — the theme decides what `success` is.
 *
 * `unknown` has no fill at all: an unmeasurable window renders an outlined
 * circle and the words "not reported", because an empty filled dot is a claim
 * that nothing has been spent (SPEC rule 4).
 */
const DOT_CLASS: Record<EffectiveStatus, string> = {
	ok: "bg-success",
	warning: "bg-warning",
	exhausted: "bg-danger",
	unknown: "border border-ink-dim",
};

const TINT_CLASS: Record<EffectiveStatus, string> = {
	ok: "text-success",
	warning: "text-warning",
	exhausted: "text-danger",
	unknown: "text-ink-dim",
};

/**
 * The fill, which keeps its quota tint even on a degraded block: the number
 * still means what it measures, only the confidence in its freshness changed.
 * `unknown` is unreachable by construction — a row with no fraction renders the
 * dotted rule instead of a track — and is kept only so the record is total.
 */
const BAR_CLASS: Record<EffectiveStatus, string> = {
	ok: "bg-success",
	warning: "bg-warning",
	exhausted: "bg-danger",
	unknown: "bg-transparent",
};

/** Spoken status for a screen reader; tint is a second channel, never the only one. */
const STATUS_WORD: Record<EffectiveStatus, string> = {
	ok: "within limit",
	warning: "near limit",
	exhausted: "exhausted",
	unknown: "not reported",
};

/**
 * The column template every window row in every block shares.
 *
 * ONE table, not one per provider (SPEC rule 9): the widths are declared here
 * rather than measured per block, so the labels form one left edge and the
 * amounts and countdowns form one right edge across every report. Measured per
 * provider, two blocks would each be internally aligned and misaligned with
 * each other, which reads as two tables that happen to be stacked.
 *
 * The bar is the only flexible column, and that ordering is the layout rule:
 * an amount is exact and a countdown is words, while a bar is a redundant
 * picture of a number already on the row — so it is what a narrow frame takes
 * space from first, exactly as `_measure_columns` gives it whatever is left.
 * `11rem` fits the widest real amount (`12.40 USD / 40.00 USD`) and `7.5rem`
 * the widest real countdown (`resets in 2d11h`) without wrapping; a wrapped
 * countdown costs the row two lines and breaks the scan.
 */
const ROW_GRID =
	"grid grid-cols-[0.375rem_minmax(3rem,11rem)_minmax(1.5rem,1fr)_11rem_7.5rem] items-center gap-x-2";

/** One window: dot, label, bar, amount, countdown. */
const LimitRowView: FC<{ row: LimitRow; degraded: boolean }> = ({
	row,
	degraded,
}) => (
	<li className={cn(ROW_GRID, "py-0.5")}>
		<span
			className={cn(
				"size-1.5 shrink-0 rounded-full",
				// A healthy-green dot on a two-hour-old meter is the highest-contrast
				// element in the block saying "fine" while the note says otherwise, so
				// a degraded block's marks drop to the dim ramp. The BAR keeps its
				// quota tint: the fill still means what it measures.
				degraded && row.status !== "unknown"
					? "bg-ink-dim"
					: DOT_CLASS[row.status],
			)}
		/>
		<span
			className={cn(
				"min-w-0 truncate text-body-sm",
				// A per-model cap is subordinate: indented and dimmer, so a 100%
				// family cap never reads as a dead account (SPEC rule 8).
				row.subordinate ? "pl-3 text-ink-dim" : "text-ink-muted",
			)}
		>
			{row.limit.label}
		</span>
		{row.fraction === null ? (
			// An unmeasurable window gets a DOTTED rule, not an empty track: an
			// empty track is pixel-identical to a bar at zero, which is a claim
			// that nothing has been spent (SPEC rule 4). The TUI draws dots here
			// for the same reason (`usage_bar`'s `BAR_UNKNOWN` branch).
			<span
				className="border-ink-disabled border-t border-dotted"
				aria-hidden="true"
			/>
		) : (
			<span
				className="h-1 overflow-hidden rounded-xs bg-sunken"
				aria-hidden="true"
			>
				<span
					className={cn("block h-full rounded-xs", BAR_CLASS[row.status])}
					// A non-zero fraction always fills at least a sliver: a bar that
					// rounds 1% away draws empty for an account that HAS started
					// spending, which is the one reading the bar exists to prevent.
					style={{
						width: `${Math.max(row.fraction * 100, row.fraction > 0 ? 1 : 0)}%`,
					}}
				/>
			</span>
		)}
		<span
			className={cn(
				"truncate text-right font-mono text-mono-sm tabular-nums",
				row.fraction === null ? "text-ink-dim" : "text-ink-muted",
			)}
		>
			{row.amount}
			<span className="sr-only">, {STATUS_WORD[row.status]}</span>
		</span>
		{/* A window with no countdown still occupies its cell, so the rows that do
		    have one stay in a column rather than starting wherever their numbers
		    happened to end. */}
		<span className="truncate text-right font-mono text-ink-dim text-mono-sm tabular-nums">
			{row.countdown ? `resets in ${row.countdown}` : ""}
		</span>
	</li>
);

/** One provider: heading, the window that binds, any note, then every window. */
const ProviderBlockView: FC<{ block: ProviderBlock }> = ({ block }) => (
	<section className="rounded-md border border-hairline bg-surface px-3 py-2.5">
		<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
			<h3 className="font-medium text-body-sm text-ink">
				{block.report.provider}
			</h3>
			{block.report.identity && (
				<span className="truncate text-ink-muted text-meta">
					{block.report.identity}
				</span>
			)}
			{/* The binding window is stated on the block's FIRST row because "can I
			    keep working" is the question the view is opened to answer; leaving
			    it to be found among equals is what the TUI's header fixed. */}
			{block.binding && (
				<span className="ml-auto flex items-baseline gap-1.5">
					<span className={cn("text-meta", TINT_CLASS[block.binding.status])}>
						{block.binding.text}
					</span>
					{block.binding.countdown && (
						<span className="font-mono text-ink-dim text-mono-sm tabular-nums">
							resets in {block.binding.countdown}
						</span>
					)}
				</span>
			)}
			{/* With no meters at all there is no binding window to protect, so the
			    heading may carry the probe failure itself. */}
			{!block.binding &&
				block.report.usage_unavailable &&
				!block.report.credential_invalid && (
					<span className="ml-auto text-ink-dim text-meta">
						Usage unavailable
					</span>
				)}
		</div>
		{block.note && (
			<p
				className={cn(
					"pt-1 text-meta",
					// A dead grant names a remedy the user can act on, so it is the one
					// note that earns the danger role; staleness is a fact, not a fault.
					block.report.credential_invalid ? "text-danger" : "text-ink-dim",
				)}
			>
				{block.note}
			</p>
		)}
		{block.rows.length > 0 && (
			<ul className="pt-1.5">
				{block.rows.map((row) => (
					<LimitRowView
						key={row.limit.id}
						row={row}
						degraded={block.degraded}
					/>
				))}
			</ul>
		)}
	</section>
);

export type UsageReportsProps = {
	reports: UsageReport[];
	/** `cached` or `live`, as the response labelled itself. */
	source: string;
	/** The response's own server clock, epoch ms — the stamp blocks are aged against. */
	fetchedAt: number;
	/** The clock countdowns are measured from. Pinned by stories and tests. */
	now: number;
};

/**
 * The report table. Pure: no query, no clock, no state.
 *
 * One table rather than one per provider (SPEC rule 9): the amount and
 * countdown columns are fixed-width and right-aligned across every block, so
 * the blocks scan as one table instead of several that happen to be stacked.
 */
export const UsageReports: FC<UsageReportsProps> = ({
	reports,
	fetchedAt,
	now,
}) => {
	const blocks = providerBlocks(reports, now, fetchedAt);
	return (
		<div className="flex flex-col gap-2">
			{blocks.map((block, index) => (
				<ProviderBlockView
					// Provider is NOT unique: one provider can hold several logged-in
					// accounts, and a real cached response on this machine carried five
					// `anthropic` reports at once. Keying by provider alone collapsed
					// them into one React child. Identity disambiguates them where the
					// vendor supplies one, and the index is the backstop for the
					// providers that report none (openrouter sends `identity: null`).
					key={`${block.report.provider}:${block.report.identity ?? index}`}
					block={block}
				/>
			))}
		</div>
	);
};

/**
 * The toolbar's left half: the window tally.
 *
 * Renders nothing at all when there are no windows to count — `describeStats`
 * returns `""` for an empty set, and an empty element still occupies a line
 * box, which leaves the loading and empty states with a blank strip above the
 * body that reads as a missing element rather than an absent one.
 */
export const UsageTally: FC<{ reports: UsageReport[] }> = ({ reports }) => {
	const text = describeStats(collectStats(reports));
	if (!text) return null;
	return (
		<span className="font-mono text-ink-dim text-mono-sm tabular-nums">
			{text}
		</span>
	);
};

export type UsageDialogProps = {
	onClose: () => void;
	/** The payload, or null while it is loading or has failed. */
	payload: UsagePayload | null;
	loading?: boolean;
	/** The query's own message; rendered in place of the table. */
	error?: string | null;
	/** A live fetch is in flight: the action says so instead of spinning. */
	fetching?: boolean;
	/** Whether live numbers have been asked for at least once. */
	asked?: boolean;
	onFetchLive: () => void;
	/** The clock ages and countdowns are measured from. Pinned by stories. */
	now: number;
};

/**
 * The whole `/usage` dialog, with no data fetching in it.
 *
 * This is the component the stories render, and it is the SHIPPED dialog
 * rather than a story-only imitation of one — `UsageView` below adds a query
 * and nothing else. A story that rebuilt the chrome would be evidence about
 * the story, so every state a reviewer has to judge (loading, empty, error,
 * stale, unavailable, a dead grant) is reachable here from fixtures alone.
 */
export const UsageDialog: FC<UsageDialogProps> = ({
	onClose,
	payload,
	loading = false,
	error = null,
	fetching = false,
	asked = false,
	onFetchLive,
	now,
}) => {
	const reports = payload?.reports ?? [];
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Provider usage"
			wide
			description={
				payload
					? describeSource(payload.source, payload.fetched_at, now)
					: "Quota and usage as the providers report it."
			}
			toolbar={
				// `ml-auto` on the action rather than `justify-between` on the row:
				// the tally renders nothing when there are no windows, and with
				// `justify-between` its absence left the button sitting at the left
				// edge of the toolbar instead of staying where it always is.
				<div className="flex items-center gap-3">
					<UsageTally reports={reports} />
					{/* Named for what it does to the world, not for the widget: the
					    button reaches every signed-in provider's usage endpoint, which
					    is slow and rate-limited, so "ask" is the honest verb. In-flight
					    state is the label, not a spinner — there is nothing to watch. */}
					<Button
						className="ml-auto"
						variant="ghost"
						size="sm"
						type="button"
						onClick={onFetchLive}
						disabled={fetching}
					>
						{fetching
							? "Asking providers"
							: asked
								? "Ask providers again"
								: "Ask providers now"}
					</Button>
				</div>
			}
			body={
				loading ? (
					<p className="text-ink-dim text-meta">Loading</p>
				) : error ? (
					<p className="text-body-sm text-danger">{error}</p>
				) : reports.length === 0 ? (
					<p className="text-body-sm text-ink-muted">
						No usage reports. Sign in to a provider that publishes quota, then
						ask providers for live numbers.
					</p>
				) : (
					<UsageReports
						reports={reports}
						source={payload?.source ?? "cached"}
						fetchedAt={payload?.fetched_at ?? now}
						now={now}
					/>
				)
			}
		/>
	);
};

/**
 * `/usage` as the registry mounts it.
 *
 * Query semantics are unchanged from the JSON view this replaces: the cached
 * report is what opens (no network round trip to read numbers the backend
 * already holds), and asking for live numbers flips both `live` and `refresh`,
 * which is what forces the backend past its own cache. `live` is part of the
 * cache key so the two answers never overwrite each other in react-query's
 * store, and the provider scope comes from the slash line's argument.
 */
export const UsageView: FC<PickerContext> = ({ onClose, action }) => {
	const [live, setLive] = useState(false);
	const provider = action.args.trim() || undefined;
	const usage = useQuery({
		queryKey: ["desktop", "usage", provider ?? "", live],
		queryFn: () =>
			desktopResult<UsagePayload>({
				op: "usage.get",
				provider,
				live,
				refresh: live,
			}),
	});
	return (
		<UsageDialog
			onClose={onClose}
			payload={usage.data ?? null}
			loading={usage.isLoading}
			error={usage.isError ? errorText(usage.error) : null}
			// react-query dedupes a second click, but the label has to say so too.
			fetching={usage.isFetching}
			asked={live}
			onFetchLive={() => setLive(true)}
			// One clock reading per render, shared by every countdown and age on
			// screen, so two rows in the same frame cannot disagree about the time.
			now={Date.now()}
		/>
	);
};
