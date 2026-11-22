import { rowCurrent } from "@features/chat/components/chat-sidebar";
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
import { cn } from "@shared/lib/utils";
import { Bot, Sparkles, Users } from "lucide-react";
import { useId, useState } from "react";
import { t } from "../../../../../i18n/messages";

/**
 * Rows shown before "Show all"; the brief asked for ~3. Three rows run ~230 px,
 * more than the tab/search cluster below, so this is not what keeps the roster
 * the column's main body: the section's height cap is (see its className).
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

/**
 * Review's accessible name, per operation AND kind (PR #2026 round 1, D4/U4):
 * a create is not "a change to" a record that does not exist yet, and an
 * agent and a team may share a name, so the button must say which it opens.
 */
function reviewLabel(proposal: ProfileProposalSummary, name: string): string {
	return proposal.operation === "create"
		? t("ui.agents.pending.review_create_aria", { kind: proposal.kind, name })
		: t("ui.agents.pending.review_aria", { kind: proposal.kind, name });
}

export function PendingApprovalsSummary({
	proposals,
	currentProposalId = null,
	reviewable = () => true,
	onReview,
}: {
	/** `pendingProposals(list)`: newest first, all kinds, pending + stale. */
	proposals: readonly ProfileProposalSummary[];
	/** `?proposal=`: the proposal open in the detail pane, marked current (D6). */
	currentProposalId?: string | null;
	/**
	 * Whether the page has somewhere to review this proposal. False only for a
	 * skill proposal on a core without `skill_library` (R5/U2/D2): the row stays,
	 * because the nav badge counts it and the summary's total must match the
	 * badge, but Review gives way to a one-line "update to review" note rather
	 * than a button that goes nowhere.
	 */
	reviewable?: (proposal: ProfileProposalSummary) => boolean;
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
			/*
			 * BOUNDED (PR #2026 round 1, D1/U3): at most 30% of the column, and it
			 * shrinks first (`min-h-0`) when the column is short; the roster below
			 * keeps a floor (`min-h-32`). Only the list scrolls, so the heading and
			 * Show all/fewer stay put. Unbounded, five rows cost 307 px collapsed
			 * and 449 px expanded, and at the 600 px window minimum the roster got
			 * 0 px and "Add agent manually" fell off-screen.
			 */
			className="flex max-h-[30%] min-h-0 flex-col rounded-md border border-hairline bg-sunken p-2"
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
			{/* Keep the inset panel sunken, but give its rows the surface that
			    rowCurrent is derived from, so selection stays distinct. */}
			<ul
				data-testid="pending-approvals-list"
				className="min-h-0 space-y-1 overflow-y-auto rounded-sm bg-surface"
			>
				{shown.map((proposal) => {
					const Icon = KIND_ICON[proposal.kind];
					const name = displayName(proposal);
					const stale = proposal.stale || proposal.state === "stale";
					const current = proposal.id === currentProposalId;
					const canReview = reviewable(proposal);
					return (
						<li
							key={proposal.id}
							data-testid={`pending-approval-${proposal.id}`}
							data-proposal-kind={proposal.kind}
							// The proposal open on the right reads as selected (D6), with the
							// roster's own current-row ground rather than a new mark.
							aria-current={current ? "true" : undefined}
							/*
							 * Review shares the NAME's line only; the detail lines run under it to
							 * the panel's edge. Beside a full-height button column they had ~150 px
							 * and "Agent · Proposed change" broke after the dot.
							 */
							className={cn("rounded-sm px-1 py-0.5", current && rowCurrent)}
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
								{canReview ? (
									<Button
										variant="outline"
										size="sm"
										className="shrink-0"
										aria-label={reviewLabel(proposal, name)}
										onClick={() => onReview(proposal)}
									>
										{t("ui.agents.pending.review")}
									</Button>
								) : null}
							</div>
							{/* Indented to the name: the 14 px icon plus the 8 px gap. */}
							<div className="ps-5.5">
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
								</p>
								{/*
								 * THE STALE BADGE LEADS THE FIELDS LINE (D3) instead of ending the
								 * detail line: "Team · Proposed change" plus the 83 px badge did not
								 * fit 208 px, so it wrapped onto a line of its own (92 px rows vs
								 * 67 px). Here the badge is `shrink-0` and the field list truncates
								 * beside it, so the badge is never the part that gets clipped.
								 */}
								{stale || proposal.fields.length ? (
									<div className="flex min-w-0 items-center gap-1">
										{stale ? (
											/*
											 * The `warning` Badge, a contracted wash/border/ink triple:
											 * warning ink loose on `sunken` is a pair no contrast row
											 * covers. Stale still counts as waiting (it can be rejected).
											 */
											<Badge
												variant="warning"
												className="shrink-0"
												data-testid="pending-approval-stale"
											>
												{t("ui.agents.pending.stale")}
											</Badge>
										) : null}
										{proposal.fields.length ? (
											<p
												className="min-w-0 truncate text-meta text-ink-dim"
												title={formatList(proposal.fields)}
											>
												{/* Field ids are core's identifiers; the panel shows their labels. */}
												{t("ui.agents.proposals.fields", {
													fields: formatList(proposal.fields),
												})}
											</p>
										) : null}
									</div>
								) : null}
								{canReview ? null : (
									<p
										className="text-meta text-ink-muted"
										data-testid="pending-approval-unreviewable"
									>
										{t("ui.agents.pending.skill_needs_update")}
									</p>
								)}
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
