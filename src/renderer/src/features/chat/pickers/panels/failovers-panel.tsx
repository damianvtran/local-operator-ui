import { Badge } from "@shared/components/ui/badge";
import { Tooltip } from "@shared/components/ui/tooltip";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import type { FC } from "react";
import type { PickerContext } from "../destination-pickers";
import { PickerHost } from "../picker-host";
import { errorText } from "../use-picker-backend";
import {
	type ChainRow,
	type FailoverModel,
	chainRows,
	modelLabel,
	servingVerdict,
} from "./failovers-model";
import { PanelSection, PanelStack } from "./panel-frame";
import { failoversQueryOptions } from "./panel-queries";
import { PanelNotice, PanelSkeleton } from "./panel-states";
import { StatCard } from "./primitives/stat-card";

/**
 * `/failovers` as a panel.
 *
 * No chart, because a cascade is not a quantity: what a user opens this for is
 * one question — is the model serving me the one I selected — and the answer is
 * a pair of labels, not a mark. There is deliberately no separate "effective
 * model" section: the two cards side by side ARE the comparison.
 */

export type FailoversData = {
	selected: FailoverModel | null;
	effective: FailoverModel | null;
	chains: Record<string, string[]>;
	scope: string;
	live_model_source: string;
};

export type FailoversPanelProps = {
	data: FailoversData | null;
	loading: boolean;
	/** The backend's own detail. Never synthesised here. */
	error: string | null;
	onClose: () => void;
};

/**
 * One hop in a chain.
 *
 * A `Badge` with its border turned off, and that is a measurement rather than
 * a preference: across the twelve palettes the port started from the strongest
 * edge this chip can draw is 1.58:1 (`hairline` on `surface`), and its own
 * fill is
 * 1.11-1.55:1, so
 * neither clears the 3:1 floor the contrast contract requires of a control's
 * boundary. A chip with no perceivable boundary is not a control, so it does
 * not get `border-control` (the contract's own rule: a rule that carries no
 * information comes off rather than being promoted). What is left — the
 * `sunken` depth step every card in this app already groups with — is a chip
 * that reads as one hop without claiming to be something the user operates.
 */
const ChainChip: FC<{ hop: string }> = ({ hop }) => (
	<Badge
		variant="neutral"
		className={cn("border-transparent font-mono text-ink text-mono-sm")}
	>
		{hop}
	</Badge>
);

const ChainRowView: FC<{ row: ChainRow }> = ({ row }) => {
	/*
	 * Hops are keyed by their own label plus how many times that label has
	 * already appeared in this chain — never by position. A chain may
	 * legitimately name the same model twice (a provider falling over onto a
	 * second account of it), so the label alone is not unique, and a positional
	 * key is the one that keeps rendering a neighbour's state when a list
	 * reorders.
	 */

	useI18nLocale();
	const seen = new Map<string, number>();
	const hops = row.hops.map((hop) => {
		const occurrence = (seen.get(hop) ?? 0) + 1;
		seen.set(hop, occurrence);
		return { key: `${hop}#${occurrence}`, hop };
	});
	return (
		<div className={cn("flex flex-wrap items-center gap-2 py-1")}>
			<span
				className={cn(
					"w-40 shrink-0 truncate font-mono text-ink-muted text-mono-sm",
				)}
			>
				{row.key}
			</span>
			{hops.length === 0 ? (
				<>
					<span className={cn("text-body-sm text-ink-muted")}>
						{t("ui.chat.pickers.failovers_panel.none")}
					</span>
					<span className={cn("text-ink-dim text-meta")}>
						{t(
							"ui.chat.pickers.failovers_panel.a_failure_here_goes_straight_to_an_error",
						)}
					</span>
				</>
			) : (
				hops.map((entry, position) => (
					<span key={entry.key} className={cn("flex items-center gap-2")}>
						{position > 0 ? (
							<ArrowRight
								className={cn("shrink-0 text-ink-dim")}
								size={14}
								aria-hidden="true"
							/>
						) : null}
						<ChainChip hop={entry.hop} />
					</span>
				))
			)}
		</div>
	);
};

export const FailoversPanel: FC<FailoversPanelProps> = ({
	data,
	loading,
	error,
	onClose,
}) => {
	useI18nLocale();
	const verdict = servingVerdict(data?.selected, data?.effective);
	const chains = chainRows(data?.chains ?? {});
	const selected = modelLabel(data?.selected);
	const effective = modelLabel(data?.effective);
	return (
		<PickerHost
			open
			onClose={onClose}
			shell="panel"
			bodyLabel={t("ui.chat.pickers.failovers_panel.failover_chains_region")}
			title={t("ui.chat.pickers.failovers_panel.failovers")}
			description={t(
				"ui.chat.pickers.failovers_panel.the_model_this_session_selected_the_one_actually_serving_it_and_the_conf",
			)}
			body={
				loading ? (
					<PanelSkeleton shape="stats" />
				) : error ? (
					<PanelNotice kind="unavailable" text={error} />
				) : (
					<PanelStack>
						<PanelSection
							title={t("ui.chat.pickers.failovers_panel.serving")}
							meta={t(
								"ui.chat.pickers.failovers_panel.live_from_the_session_s_owner",
							)}
						>
							<div className={cn("grid gap-3 sm:grid-cols-2")}>
								<Tooltip content={selected}>
									<div className={cn("min-w-0")}>
										<StatCard
											label={t("ui.chat.pickers.failovers_panel.selected")}
											value={selected}
										/>
									</div>
								</Tooltip>
								<Tooltip content={effective}>
									<div className={cn("min-w-0")}>
										<StatCard
											label={t("ui.chat.pickers.failovers_panel.serving")}
											value={effective}
											note={verdict.note}
											tone={verdict.tone}
										/>
									</div>
								</Tooltip>
							</div>
						</PanelSection>
						<PanelSection
							title={t("ui.chat.pickers.failovers_panel.fallback_chains")}
							meta={t(
								"ui.chat.pickers.failovers_panel.not_live_routing_state",
								{
									value:
										data?.scope === "configured_defaults" || !data?.scope
											? t("ui.chat.pickers.failovers_panel.configured_defaults")
											: // Unknown backend scope identifiers stay technical rather than
												// masquerading as reviewed product terminology.
												data.scope
													.split("_")
													.join(" "),
								},
							)}
						>
							{chains.length === 0 ? (
								<PanelNotice
									kind="empty"
									text={t(
										"ui.chat.pickers.failovers_panel.no_fallback_chains_configured",
									)}
								/>
							) : (
								<div className={cn("flex flex-col")}>
									{chains.map((row) => (
										<ChainRowView key={row.key} row={row} />
									))}
								</div>
							)}
						</PanelSection>
						<PanelSection title={t("ui.chat.pickers.failovers_panel.scope")}>
							{/*
							 * No meta. § 6.5 and `panel-frame.tsx`'s own rule reserve the slot for
							 * something the section does not already say; "read from your settings
							 * file" restated the body's first clause twenty pixels below it, on a
							 * three-line section (design round 1, D12).
							 */}
							<p className={cn("text-body-sm text-ink-muted")}>
								{t(
									"ui.chat.pickers.failovers_panel.chains_are_configuration_read_from_your_settings_file_what_is_actually_s",
								)}
							</p>
						</PanelSection>
					</PanelStack>
				)
			}
		/>
	);
};

/** The adapter the registry mounts: owns the read, decides nothing. */
export const FailoversView: FC<PickerContext> = ({ sessionId, onClose }) => {
	const query = useQuery(failoversQueryOptions(sessionId));
	return (
		<FailoversPanel
			data={query.data?.data ?? null}
			loading={query.isLoading}
			error={query.isError ? errorText(query.error) : null}
			onClose={onClose}
		/>
	);
};
