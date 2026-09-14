import { Badge } from "@shared/components/ui/badge";
import { Tooltip } from "@shared/components/ui/tooltip";
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
 * A `Badge` with its border turned off, and that is a measurement rather than a
 * preference: across all twelve palettes the strongest edge this chip can draw
 * is 1.58:1 (`hairline` on `surface`), and its own fill is 1.11-1.55:1, so
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
					<span className={cn("text-body-sm text-ink-muted")}>(none)</span>
					<span className={cn("text-ink-dim text-meta")}>
						A failure here goes straight to an error
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
	const verdict = servingVerdict(data?.selected, data?.effective);
	const chains = chainRows(data?.chains ?? {});
	const selected = modelLabel(data?.selected);
	const effective = modelLabel(data?.effective);
	return (
		<PickerHost
			open
			onClose={onClose}
			shell="panel"
			title="Failovers"
			description="The model this session selected, the one actually serving it, and the configured default fallback chains."
			body={
				loading ? (
					<PanelSkeleton shape="stats" />
				) : error ? (
					<PanelNotice kind="unavailable" text={error} />
				) : (
					<PanelStack>
						<PanelSection
							title="Serving"
							meta="live · from the session's owner"
						>
							<div className={cn("grid gap-3 sm:grid-cols-2")}>
								<Tooltip content={selected}>
									<div className={cn("min-w-0")}>
										<StatCard label="Selected" value={selected} />
									</div>
								</Tooltip>
								<Tooltip content={effective}>
									<div className={cn("min-w-0")}>
										<StatCard
											label="Serving"
											value={effective}
											note={verdict.note}
											tone={verdict.tone}
										/>
									</div>
								</Tooltip>
							</div>
						</PanelSection>
						<PanelSection
							title="Fallback chains"
							meta={`${data?.scope ?? "configured defaults"} · not live routing state`}
						>
							{chains.length === 0 ? (
								<PanelNotice
									kind="empty"
									text="No fallback chains configured."
								/>
							) : (
								<div className={cn("flex flex-col")}>
									{chains.map((row) => (
										<ChainRowView key={row.key} row={row} />
									))}
								</div>
							)}
						</PanelSection>
						<PanelSection title="Scope" meta="read from your settings file">
							<p className={cn("text-body-sm text-ink-muted")}>
								Chains are configuration read from your settings file. What is
								actually serving is the live value above.
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
