import { Separator } from "@shared/components/ui/separator";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
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

const ESTIMATE_COLUMNS = (): Column<EstimateTableRow>[] => [
	{
		key: "row",
		/* `Block`, not `Row`: the labels below are the system blocks the request
		   is built from, and a header that names the table's shape instead of its
		   content is a column nobody can read. */
		header: t("ui.chat.pickers.context_panel.block"),
		cell: (row) => row.label,
	},
	{
		key: "tokens",
		header: t("ui.chat.pickers.context_panel.tokens"),
		numeric: true,
		cell: (row) => row.text,
	},
];

/** The pre-`numbers` fallback: the owner's pairs, two columns, no bars. */
export const OwnerRowsTable: FC<{ rows: [string, string][] }> = ({ rows }) => {
	useI18nLocale();
	return (
		<DataTable<[string, string]>
			label={t("ui.chat.pickers.context_panel.next_request_estimate")}
			columns={[
				{
					key: "row",
					header: t("ui.chat.pickers.context_panel.block"),
					cell: (row) => row[0],
				},
				{
					key: "tokens",
					header: t("ui.chat.pickers.context_panel.tokens"),
					numeric: true,
					cell: (row) => row[1],
				},
			]}
			rows={rows}
			rowKey={(row) => row[0]}
		/>
	);
};

const EstimateRows: FC<{ block: ContextBlock }> = ({ block }) => {
	useI18nLocale();
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
				label={t("ui.chat.pickers.context_panel.next_request_estimate_by_row")}
				columns={ESTIMATE_COLUMNS()}
				rows={rows}
				rowKey={(row) => row.key}
				leading={(row) => (
					<ProportionBar
						fraction={row.fraction}
						className="w-24"
						srLabel={t("ui.chat.pickers.context_panel.of_this_estimate", {
							label: row.label,
							formatpercent: formatPercent(row.fraction),
						})}
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
						srLabel={t(
							"ui.chat.pickers.context_panel.total_of_the_context_window",
							{ formatpercent: formatPercent(share) },
						)}
					/>
				</span>
				<span className={cn("min-w-0 flex-1 text-body-sm text-ink")}>
					{t("ui.chat.pickers.context_panel.total")}
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
	useI18nLocale();
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
			bodyLabel={t("ui.chat.pickers.context_panel.context_estimate_region")}
			title={t("ui.chat.pickers.context_panel.context")}
			description={
				block?.title ??
				t("ui.chat.pickers.context_panel.what_the_next_request_will_carry")
			}
			body={
				busy ? (
					<PanelNotice
						kind="loading"
						text={t("ui.chat.pickers.context_panel.asking_the_owner")}
					/>
				) : errorText ? (
					<PanelNotice kind="unavailable" text={errorText} />
				) : (
					<PanelStack>
						<PanelSection
							title={t("ui.chat.pickers.context_panel.this_conversation")}
							meta={
								/*
								 * The meta follows the value, like `/info`'s context note: over an
								 * unmeasured gauge "measured on the last request" is a claim about a
								 * measurement nobody took (QA round 1, Q3).
								 */
								measured.fraction === null
									? t("ui.chat.pickers.context_panel.live_not_measured_yet")
									: t(
											"ui.chat.pickers.context_panel.live_measured_on_the_last_request",
										)
							}
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
									/*
									 * Capped width, number on the number edge — the same correction as
									 * `/session`'s gauge, because the two panels render the same fact
									 * and a reader moves between them (design round 1, D9).
									 */
									className={cn("min-w-0 max-w-96 flex-1")}
									srLabel={t("ui.chat.pickers.context_panel.context_window", {
										value: measured.value,
									})}
								/>
								<p
									className={cn(
										"ms-auto shrink-0 font-mono text-body-sm tabular-nums",
										measured.fraction === null ? "text-ink-dim" : "text-ink",
									)}
								>
									{measured.value}
									{measured.estimated ? (
										<span className={cn("text-ink-muted")}>
											{" "}
											{t("ui.chat.pickers.context_panel.estimate")}
										</span>
									) : null}
								</p>
							</div>
						</PanelSection>
						{unavailable ? (
							<PanelSection
								title={t("ui.chat.pickers.context_panel.next_request")}
							>
								<PanelNotice
									kind="empty"
									text={t(
										"ui.chat.pickers.context_panel.the_breakdown_is_not_available_for_this_session_yet_send_a_turn_and_open",
									)}
								/>
							</PanelSection>
						) : !block ? (
							<PanelSection
								title={t("ui.chat.pickers.context_panel.next_request")}
							>
								<PanelNotice
									kind="empty"
									text={t(
										"ui.chat.pickers.context_panel.the_owner_returned_no_breakdown",
									)}
								/>
							</PanelSection>
						) : (
							<PanelSection
								title={t("ui.chat.pickers.context_panel.next_request")}
								meta={t(
									"ui.chat.pickers.context_panel.estimated_tokenized_when_this_panel_opened",
								)}
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
								title={t("ui.chat.pickers.context_panel.last_cache_read")}
								meta={t(
									"ui.chat.pickers.context_panel.exact_from_the_last_provider_reply",
								)}
							>
								<StatCard
									label={t("ui.chat.pickers.context_panel.tokens_read")}
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
