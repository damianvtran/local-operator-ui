import { Separator } from "@shared/components/ui/separator";
import { cn } from "@shared/lib/utils";
import { type FC, useEffect } from "react";
import type { PickerContext } from "../destination-pickers";
import { PickerHost, type PickerResult } from "../picker-host";
import {
	type SlashOutcome,
	isNativeAction,
	useSessionCommand,
} from "../use-picker-backend";
import {
	type ContextBlock,
	contextBlockOf,
	estimateRows,
	headline,
	isBreakdownUnavailable,
	itemRows,
	ownerTotalText,
	windowShare,
} from "./context-model";
import { formatContextTokens, formatPercent, formatWindow } from "./formatters";
import { PanelSection, PanelStack } from "./panel-frame";
import { PanelNotice } from "./panel-states";
import { type Column, DataTable } from "./primitives/data-table";
import { ProportionBar } from "./primitives/proportion-bar";
import { StatCard } from "./primitives/stat-card";

/**
 * `/context` as a panel.
 *
 * Two halves, in the order of how much they can be trusted. Section 1 is the
 * measurement taken on the last request; section 2 is the owner's ESTIMATE of
 * what the next one will carry, and the `~` on every row is the whole reason
 * the two are not merged into one block of numbers.
 *
 * The estimate is drawn as rows of bars against the estimate's own total, and
 * the six rows are the owner's — same labels, same order, same strings — so
 * this panel and the terminal cannot disagree about the same breakdown.
 */

export type ContextFrontend = {
	context_tokens: number | null;
	context_window: number | null;
	context_is_estimate: boolean | null;
};

export type ContextPanelProps = {
	frontend: ContextFrontend | null;
	/** The owner's answer to the routed command, if it has arrived. */
	outcome: SlashOutcome | null;
	busy: boolean;
	/** The owner's own failure text, already mapped by the command hook. */
	result: PickerResult | null;
	onClose: () => void;
};

type EstimateTableRow = {
	key: string;
	label: string;
	value: number;
	fraction: number | null;
	text: string;
};

const ESTIMATE_COLUMNS: Column<EstimateTableRow>[] = [
	{
		key: "row",
		/* `Block`, not `Row`: the labels below are the system blocks the request
		   is built from, and a header that names the table's shape instead of its
		   content is a column nobody can read. */
		header: "Block",
		cell: (row) => row.label,
	},
	{
		key: "tokens",
		header: "Tokens",
		numeric: true,
		cell: (row) => row.text,
	},
];

/** The pre-`numbers` fallback: the owner's pairs, two columns, no bars. */
const OwnerRowsTable: FC<{ rows: [string, string][] }> = ({ rows }) => (
	<DataTable<[string, string]>
		label="Next request estimate"
		columns={[
			{ key: "row", header: "Block", cell: (row) => row[0] },
			{
				key: "tokens",
				header: "Tokens",
				numeric: true,
				cell: (row) => row[1],
			},
		]}
		rows={rows}
		rowKey={(row) => row[0]}
	/>
);

const EstimateRows: FC<{ block: ContextBlock }> = ({ block }) => {
	const numbers = block.numbers;
	const rows: EstimateTableRow[] = estimateRows(numbers).map((row) => ({
		key: row.key,
		label: row.label,
		value: row.value,
		fraction: row.fraction,
		text: `~${formatContextTokens(row.value)}`,
	}));
	const share = windowShare(numbers);
	const ownerText = ownerTotalText(block);
	const total = numbers?.total ?? 0;
	const fallbackTotal = numbers
		? `~${formatContextTokens(total)} / ${formatWindow(numbers.context_window)} (${formatPercent(share)})`
		: null;
	return (
		<>
			<DataTable<EstimateTableRow>
				label="Next request estimate by row"
				columns={ESTIMATE_COLUMNS}
				rows={rows}
				rowKey={(row) => row.key}
				leading={(row) => (
					<ProportionBar
						fraction={row.fraction}
						className="w-24"
						srLabel={`${row.label}: ${formatPercent(row.fraction)} of this estimate`}
					/>
				)}
			/>
			{/*
			 * The total is a DIFFERENT quantity from the six rows above it — it is
			 * a share of the context window, not another share of the estimate —
			 * so a `Separator` states the change of meaning rather than letting
			 * the eye read it as a seventh row.
			 */}
			<Separator className={cn("my-2")} />
			<div className={cn("flex items-center gap-3 px-2")}>
				<span className={cn("w-24 shrink-0")}>
					<ProportionBar
						fraction={share}
						className="w-24"
						srLabel={`Total: ${formatPercent(share)} of the context window`}
					/>
				</span>
				<span className={cn("min-w-0 flex-1 text-body-sm text-ink")}>
					Total
				</span>
				<span
					className={cn(
						"shrink-0 text-right font-mono text-ink text-mono-sm tabular-nums",
					)}
				>
					{ownerText ?? fallbackTotal}
				</span>
			</div>
		</>
	);
};

export const ContextPanel: FC<ContextPanelProps> = ({
	frontend,
	outcome,
	busy,
	result,
	onClose,
}) => {
	const block = contextBlockOf(outcome);
	const unavailable = isBreakdownUnavailable(outcome);
	const measured = headline(frontend);
	const numbers = block?.numbers;
	const cacheRead = numbers?.cache_read ?? 0;
	const errorText = result?.tone === "error" ? result.text : null;
	return (
		<PickerHost
			open
			onClose={onClose}
			shell="panel"
			title="Context"
			description={block?.title ?? "What the next request will carry."}
			body={
				busy ? (
					<PanelNotice kind="loading" text="Asking the owner." />
				) : errorText ? (
					<PanelNotice kind="unavailable" text={errorText} />
				) : (
					<PanelStack>
						<PanelSection
							title="This conversation"
							meta="live · measured on the last request"
						>
							{/*
							 * The bar and its number are the same fact, so the bar is
							 * hidden from the tree and the number IS the alternative. An
							 * unmeasured value gets the dotted rule and the words, never an
							 * empty track — which is pixel-identical to zero.
							 */}
							<div className={cn("flex items-center gap-4")}>
								<ProportionBar
									fraction={measured.fraction}
									size="gauge"
									className={cn("w-full max-w-96")}
									srLabel={`Context window: ${measured.value}`}
								/>
								<p
									className={cn(
										"shrink-0 font-mono text-body-sm tabular-nums",
										measured.fraction === null ? "text-ink-dim" : "text-ink",
									)}
								>
									{measured.value}
									{measured.estimated ? (
										<span className={cn("text-ink-muted")}> estimate</span>
									) : null}
								</p>
							</div>
						</PanelSection>
						{unavailable ? (
							<PanelSection title="Next request">
								<PanelNotice
									kind="empty"
									text="The breakdown is not available for this session yet. Send a turn and open it again."
								/>
							</PanelSection>
						) : !block ? (
							<PanelSection title="Next request">
								<PanelNotice
									kind="empty"
									text="The owner returned no breakdown."
								/>
							</PanelSection>
						) : (
							<PanelSection
								title="Next request"
								meta="≈ estimated · tokenized when this panel opened"
							>
								{numbers ? (
									<EstimateRows block={block} />
								) : (
									/*
									 * An older backend sends the formatted pairs and no
									 * numbers. The rows are rendered as the owner spelled them,
									 * with no bars: the panel MUST NOT parse `items` to recover a
									 * magnitude, because a formatter change would then silently
									 * move a chart.
									 */
									<OwnerRowsTable rows={itemRows(block)} />
								)}
							</PanelSection>
						)}
						{cacheRead > 0 ? (
							<PanelSection
								title="Last cache read"
								meta="exact, from the last provider reply"
							>
								<StatCard
									label="Tokens read"
									value={formatContextTokens(cacheRead)}
								/>
							</PanelSection>
						) : null}
					</PanelStack>
				)
			}
		/>
	);
};

/** The adapter the registry mounts: runs the command once, then decides nothing. */
export const ContextView: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
}) => {
	const command = useSessionCommand(sessionId);
	// biome-ignore lint/correctness/useExhaustiveDependencies: fetch once on open
	useEffect(() => {
		void command.run("context", "");
	}, []);
	return (
		<ContextPanel
			frontend={canonical.frontend ?? null}
			outcome={
				command.outcome && !isNativeAction(command.outcome)
					? command.outcome
					: null
			}
			busy={command.busy}
			result={command.result}
			onClose={onClose}
		/>
	);
};
