/**
 * "Waiting for your approval": the Agents page's answer to the nav badge.
 *
 * ## Why it exists (operator report, 2026-11-21)
 *
 * The Agents nav row carries an attention count of pending profile proposals
 * (`totalPendingProposals`, every kind), but the page it leads to only showed a
 * proposal INSIDE an opened record's `ProfileProposalPanel`. With one pending
 * TEAM proposal and the Agents tab open, the badge said 1 and the page showed
 * nothing to do: no row, tab or header said which record was waiting. This
 * file holds the two marks that close that gap:
 *
 * - `PendingApprovalsSummary`: a compact list at the top of the page's roster
 *   column, on EVERY tab, naming each waiting proposal (kind, record, what it
 *   would do, which fields, whether it is out of date) with a Review action that
 *   opens the record's existing review panel at that proposal. It does not
 *   accept or reject by itself: the decision needs the diff, and the panel is
 *   the one place that shows it (and owns backup, audit and stale handling).
 * - `PendingProposalMark`: the per-row mark on agent, team and skill roster
 *   rows (the "tree-row dots" `profile-proposal-hooks.ts` promised).
 *
 * ## Constraints
 *
 * - Every number here derives from `pendingProposals()` in
 *   `profile-proposals.ts`, the same helper the nav badge reads, so the badge,
 *   the summary, the tab counts and the row marks cannot disagree.
 * - Presentational: the page owns the proposal read (capability-gated by
 *   `profile_proposals`) and navigation (through its dirty-edit guard). With
 *   nothing waiting, or the capability off, the caller passes an empty list and
 *   nothing renders.
 * - Attention counts use the shared `AttentionBadge` (AGENTS.md design rule),
 *   drawn `aria-hidden` with the exact number stated in words beside it.
 */
import type {
	ProfileProposalKind,
	ProfileProposalSummary,
} from "@shared/api/local-operator/profile-proposals";
import { AttentionBadge } from "@shared/components/ui/attention-badge";
import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { formatList, formatNumber } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { Bot, Sparkles, Users } from "lucide-react";
import { useId, useState } from "react";
import { t } from "../../../../../i18n/messages";

/**
 * Rows shown before "Show all". Three keeps the summary to roughly the height of
 * the tab/search cluster below it, so the roster stays the column's main body
 * even with a long queue; the brief asked for ~3.
 */
export const PENDING_SUMMARY_COLLAPSED_ROWS = 3;

const KIND_ICON = { agent: Bot, team: Users, skill: Sparkles } as const;
const KIND_WORD = {
	agent: "ui.agents.pending.kind.agent",
	team: "ui.agents.pending.kind.team",
	skill: "ui.agents.pending.kind.skill",
} as const;

/** The name a row prints: core's label when it sends one, else the record id. */
function displayName(proposal: ProfileProposalSummary): string {
	return proposal.label?.trim() || proposal.name;
}

export function PendingApprovalsSummary({
	proposals,
	onReview,
}: {
	/** `pendingProposals(list)`: newest first, all kinds, pending + stale. */
	proposals: readonly ProfileProposalSummary[];
	onReview: (proposal: ProfileProposalSummary) => void;
}) {
	useI18nLocale();
	const headingId = useId();
	const [expanded, setExpanded] = useState(false);
	if (!proposals.length) return null;
	const overflow = proposals.length > PENDING_SUMMARY_COLLAPSED_ROWS;
	const shown =
		overflow && !expanded
			? proposals.slice(0, PENDING_SUMMARY_COLLAPSED_ROWS)
			: proposals;
	return (
		<section
			data-testid="pending-approvals"
			aria-labelledby={headingId}
			/*
			 * In-flow, so a hairline and the sunken ground (the Alert `neutral`
			 * treatment), not a floating surface's shadow. The count carries the
			 * accent; the panel itself stays quiet so it reads as part of the column.
			 */
			className="rounded-md border border-hairline bg-sunken p-2"
		>
			<h2
				id={headingId}
				className="flex items-center gap-2 px-1 pb-1 font-medium text-body-sm text-ink"
			>
				<span className="min-w-0 truncate">
					{t("ui.agents.pending.heading")}
				</span>
				<AttentionBadge aria-hidden="true" count={proposals.length} />
				<span className="sr-only">
					{t("ui.agents.pending.count_aria", { count: proposals.length })}
				</span>
			</h2>
			<ul className="space-y-1">
				{shown.map((proposal) => {
					const Icon = KIND_ICON[proposal.kind];
					const name = displayName(proposal);
					const stale = proposal.stale || proposal.state === "stale";
					return (
						<li
							key={proposal.id}
							data-testid={`pending-approval-${proposal.id}`}
							data-proposal-kind={proposal.kind}
							/*
							 * Review shares the NAME's line only; the detail lines run under it to
							 * the panel's edge. Beside a full-height button column they had ~150 px
							 * and "Agent · Proposed change" broke after the dot.
							 */
							className="px-1 py-0.5"
						>
							<div className="flex items-center gap-2">
								<Icon
									aria-hidden="true"
									className="size-3.5 shrink-0 text-ink-muted"
								/>
								<p
									dir="auto"
									className="min-w-0 flex-1 truncate text-body-sm text-ink"
									title={name}
								>
									{name}
								</p>
								<Button
									variant="outline"
									size="sm"
									className="shrink-0"
									aria-label={t("ui.agents.pending.review_aria", { name })}
									onClick={() => onReview(proposal)}
								>
									{t("ui.agents.pending.review")}
								</Button>
							</div>
							{/* Indented to the name: the 14 px icon plus the 8 px gap. */}
							<div className="ps-5.5">
								{/*
								 * WRAPS RATHER THAN TRUNCATES: the stale badge sits at the end of
								 * this line, and a truncating line clipped it away in exactly the
								 * row that most needs it (first render, "Proposed chan…").
								 */}
								<p className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-meta text-ink-muted">
									<span>{t(KIND_WORD[proposal.kind])}</span>
									<span aria-hidden="true" className="text-ink-dim">
										·
									</span>
									<span>
										{proposal.operation === "create"
											? t("ui.agents.pending.operation.create")
											: t("ui.agents.pending.operation.update")}
									</span>
									{stale ? (
										/*
										 * The `warning` Badge, a contracted wash/border/ink triple:
										 * warning ink loose on `sunken` is a pair no contrast row
										 * covers. Stale still counts as waiting (it can be rejected).
										 */
										<Badge
											variant="warning"
											data-testid="pending-approval-stale"
										>
											{t("ui.agents.pending.stale")}
										</Badge>
									) : null}
								</p>
								{proposal.fields.length ? (
									<p
										className="truncate text-meta text-ink-dim"
										title={formatList(proposal.fields)}
									>
										{/* Field ids are core's identifiers; the panel shows their labels. */}
										{t("ui.agents.proposals.fields", {
											fields: formatList(proposal.fields),
										})}
									</p>
								) : null}
							</div>
						</li>
					);
				})}
			</ul>
			{overflow ? (
				<Button
					variant="ghost"
					size="sm"
					className="mt-1 w-full justify-start"
					aria-expanded={expanded}
					onClick={() => setExpanded((open) => !open)}
				>
					{expanded
						? t("ui.agents.pending.show_fewer")
						: t("ui.agents.pending.show_all", {
								count: formatNumber(proposals.length),
							})}
				</Button>
			) : null}
		</section>
	);
}

/**
 * The roster row's mark for a record with proposals waiting. The badge is
 * decorative (`aria-hidden`); the sentence beside it is what a screen reader
 * hears as part of the row button's name, so the row says "minervadev, 1 change
 * waiting for your approval" rather than a bare "1".
 */
export function PendingProposalMark({
	count,
	kind,
}: {
	count: number;
	kind: ProfileProposalKind;
}) {
	if (!(count > 0)) return null;
	return (
		<span
			className="inline-flex shrink-0 items-center"
			data-testid="roster-row-pending"
			data-proposal-kind={kind}
		>
			<AttentionBadge aria-hidden="true" count={count} />
			<span className="sr-only">
				{t("ui.agents.pending.count_aria", { count })}
			</span>
		</span>
	);
}
