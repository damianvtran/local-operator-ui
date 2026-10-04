/**
 * The approvals tray: the prompts first, the records behind one disclosure.
 *
 * THE SPLIT IS THE OPERATOR'S (round, 2026-10-03), stated as requirements:
 * "A settled request leaves the live panel and collapses into an approvals
 * section that opens/closes from a tab or button — a spent approval is a record,
 * not a prompt. Nothing settled keeps occupying the live panel." So the tray
 * renders exactly two sets:
 *
 *   - WAITING (`isWaitingApproval`): the records still asking the operator for a
 *     decision. They render first and in full, above every state block on the
 *     tab — a pending approval is the most important fact here, and a prompt
 *     hidden behind any control is the failure this surface exists to remove.
 *   - RECORDS: everything the read carries besides them — decided, running,
 *     stopped, terminal — behind a `Disclosure` that starts closed. The closure
 *     is the archive-dump guard the old tray argued for, kept: a record nobody
 *     opened costs one line of chrome, not a wall. It opens ITSELF while a
 *     `failed` record is inside — the store's own words, "the state a person
 *     should not miss"; the FIRST press of its toggle takes ownership from
 *     then on, and until that press the default keeps following the data, so
 *     the section folds away again once the last `failed` resolves (QA round
 *     1, O2 — stated rather than special-cased).
 *     HOW FAR BACK IT DRAWS IS THE STORE'S BOUND, NOT THIS FILE'S (agent review
 *     round 1, R1-2): the section is the read's own fold — everything besides
 *     the waiting set, oldest first — and the read's retention is the store's
 *     (`local_operator/network/approvals.py`): terminals pruned after 30 days,
 *     open records until they settle. That is deliberate: a spent approval is a
 *     record the operator asked to keep, so no record is hidden for being old —
 *     and the count beside the toggle is exactly this section's size.
 *
 * WHAT A CARD SAYS, AND IN WHAT ORDER. One line of plain language first
 * (`approvalSummary`, the record's own scopes in the CLI's order), then the
 * decision controls, then a "Details" disclosure carrying the per-scope
 * consequences as a list (not a wall of chips), the provenance lines and the
 * state's own gloss. The reader used to assemble the ask from six chips and
 * three definition rows; now the card states it, and the definitions are
 * reference material one click away. The waiting card's line is the full
 * sentence; a record's is the ask's TITLE alone (`approvalHead` — UX round 1,
 * U2: the archive read as a stack of repeated six-clause asks), and the
 * countdown prints only while the record still waits for the operator (design
 * round 1, D3 / UX round 1, U3). A `failed` record additionally states on the
 * card what happened and what can be done (UX round 1, U1 — see the card's own
 * note).
 *
 * WHO DECIDES WHAT: the card renders what the record carries and offers only the
 * moves the store's own transition matrix allows (`mesh-approvals.ts` owns the
 * predicates — `approve` on `requested` alone, `deny` on every open state, which
 * is the matrix's own shape and not a simplification). On a record whose
 * decision is already made, the one remaining write (`deny`) wears the label of
 * its consequence — "Stop" in flight, "Abandon" once stopped — because an
 * `Approved` chip beside a `Deny` button was the contradiction the operator
 * reported; the write is the same one, the label says what it does. The
 * approval's signing gesture is presence-gated on the backend, so the pending
 * state says a prompt is expected rather than pretending the click completed
 * anything.
 */

import { Alert, Badge, Button } from "@shared/components/ui";
import { Disclosure } from "@shared/components/ui/disclosure";
import { ShieldCheck } from "lucide-react";
import type { FC } from "react";
import { Fragment, useMemo, useState } from "react";
import {
	type ApprovalDecision,
	type MeshApprovalRow,
	approvalHead,
	approvalHostKeyLabel,
	approvalRemainingLabel,
	approvalRequesterLabel,
	approvalScopeEntries,
	approvalStateLabel,
	approvalSummary,
	approvalWhereLabel,
	canApproveApproval,
	canDenyApproval,
	isWaitingApproval,
} from "./mesh-approvals";

/** The chip's semantic register per state; each is the Badge primitive's own triple. */
function chipVariant(
	state: string,
): "attention" | "danger" | "success" | "neutral" {
	if (state === "requested") return "attention";
	if (state === "failed") return "danger";
	if (state === "connected") return "success";
	return "neutral";
}

/**
 * What a record's one remaining write is called: "Stop" while the run is in
 * flight (`approved`/`connecting`), "Abandon" once the runner stopped (`failed`).
 *
 * The store's op is `deny` for all three — the predicate that gates it is
 * `canDenyApproval`, unchanged. The LABEL is the consequence rather than the op
 * because "Deny" beside an `Approved` chip was the exact contradiction the
 * operator reported: the decision is already made, and what remains is stopping
 * an in-flight run or abandoning a stopped one — which is what the state's own
 * gloss says the write does.
 */
function recordActionLabel(state: string): string {
	return state === "failed" ? "Abandon" : "Stop";
}

/**
 * A state's detail rows — the terms and glosses the Details disclosure renders.
 *
 * These used to sit in the card's flow; they are reference material for "what
 * does this state mean / what does this click do", so they moved behind the
 * disclosure with the consequences (operator round, 2026-10-03). The terms keep
 * design round 1 D2's vocabulary ("Signing", "Next", "Stop", "After a stop") —
 * they name the moment their gloss is about — which is also why `Stop` matches
 * the button it now explains.
 */
function stateHints(state: string): { term: string; text: string }[] {
	switch (state) {
		case "requested":
			return [
				{
					term: "Signing",
					text: "Approving signs with this machine's operator key; the system may ask for it.",
				},
			];
		case "approved":
			return [
				{
					term: "Next",
					text: "An agent runs the install and connect (lop network approvals run).",
				},
				{
					term: "Stop",
					text: "Stopping now denies the request; nothing has run yet.",
				},
			];
		case "connecting":
			return [
				{
					term: "Stop",
					text: "Stopping now denies the request; the runner stops at its next step.",
				},
			];
		case "failed":
			return [
				{
					term: "After a stop",
					text: "The runner stopped before it finished. Abandoning denies the request; a retry re-enters the same record instead.",
				},
			];
		default:
			return [];
	}
}

export interface MeshApprovalsTrayProps {
	/** Every row the badge read returned — live and terminal alike; the tray splits them. */
	rows: readonly MeshApprovalRow[];
	/** The read's own failure sentence, when it has one; the list stays painted beside it. */
	error: string | null;
	/** The decision in flight, from the mutation's own variables. */
	pending: { approvalId: string; decision: ApprovalDecision } | null;
	/**
	 * The last decision's refusal, when it had one (agent review round 1,
	 * finding 1): the code and the authored sentence, attached to the record it
	 * was about WHEN THAT RECORD IS DRAWN — the card while it waits, a records
	 * row while the section is open — and rendered under the list otherwise. The
	 * sentence may not go missing either way, because it is the only thing that
	 * tells a refusal from a dead click, and a refusal about a record inside the
	 * closed records section is exactly the case a naive attach would swallow.
	 */
	refusal: {
		approvalId: string | null;
		code: string;
		sentence: string;
	} | null;
	onDecide: (approvalId: string, decision: ApprovalDecision) => void;
	onRetry: () => void;
	/** The read's own stamp, for the expiry lines (the page owns the clock reading). */
	nowSeconds: number;
	/**
	 * Network id -> the name the page already shows for it (UX round 1, U1). The
	 * approvals read and the mesh read are independent queries, so this is
	 * OPTIONAL: a summary that painted before the canvas falls back to the id,
	 * and the join clause never renders a blank.
	 */
	networkNames?: ReadonlyMap<string, string>;
}

export const MeshApprovalsTray: FC<MeshApprovalsTrayProps> = ({
	rows,
	error,
	pending,
	refusal,
	onDecide,
	onRetry,
	nowSeconds,
	networkNames,
}) => {
	/*
	 * THE BUSY GATE IS THE SURFACE'S, not the row's (agent review round 1,
	 * finding 3): the browser tray this surface models disables every control
	 * while one decision is in flight, because the mutation is a single
	 * observer - with a second decision in flight the cue moves and the older
	 * card's buttons re-enable, so a per-row gate can lie about which card is
	 * busy and lets a duplicate answer race the store's own refusal. One human
	 * gesture at a time, on the whole tray.
	 */
	const busy = pending !== null;
	/*
	 * THE TWO SETS, in the store's own order (oldest first) and nothing re-sorted:
	 * the oldest record is the first to expire, and a surface that re-sorted would
	 * disagree with the CLI's listing.
	 */
	const waiting = useMemo(
		() => rows.filter((row) => isWaitingApproval(row.state)),
		[rows],
	);
	const records = useMemo(
		() => rows.filter((row) => !isWaitingApproval(row.state)),
		[rows],
	);

	/*
	 * THE RECORDS SECTION'S OPEN STATE, in three parts: the reader's toggle wins;
	 * absent a choice it follows the data — open while a `failed` record is inside
	 * (the store's state "a person should not miss"), closed otherwise. The
	 * override belongs to the visit rather than to a render, so a poll that keeps
	 * delivering the same failed record cannot re-open a section the reader closed.
	 */
	const [recordsChoice, setRecordsChoice] = useState<boolean | null>(null);
	const recordsOpen =
		recordsChoice ?? records.some((row) => row.state === "failed");

	/*
	 * A REFUSAL ATTACHES TO ITS RECORD only while that record is DRAWN — the card
	 * while it waits, a records row while the section is open. Unattached it
	 * renders under the list (below), which is also where a conflict or an expiry
	 * that carried the record out of the read entirely leaves it.
	 */
	const refusalAttached =
		refusal !== null &&
		rows.some(
			(row) =>
				row.approvalId === refusal.approvalId &&
				(isWaitingApproval(row.state) || recordsOpen),
		);

	// Nothing to say, say nothing: no prompt, no record, no failure, no refusal.
	if (waiting.length === 0 && records.length === 0 && !error && !refusal)
		return null;

	return (
		<section
			aria-label="Approvals"
			data-tour-tag="mesh-approvals-tray"
			className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-3"
		>
			<div className="flex flex-wrap items-center gap-2">
				<ShieldCheck aria-hidden="true" className="size-4 text-ink-muted" />
				<h2 className="text-body-sm text-ink">Approvals</h2>
				{waiting.length > 0 && (
					<span className="text-meta text-ink-dim">
						{waiting.length === 1 ? "1 waiting" : `${waiting.length} waiting`}
					</span>
				)}
			</div>

			{error && (
				<div className="flex flex-wrap items-center gap-2">
					<p className="min-w-0 flex-1 text-meta text-ink-muted">{error}</p>
					<Button variant="secondary" size="sm" onClick={onRetry}>
						Ask again
					</Button>
				</div>
			)}

			{waiting.length > 0 && (
				<ul className="flex flex-col divide-y divide-hairline">
					{waiting.map((row) => (
						<MeshApprovalCard
							key={row.approvalId}
							row={row}
							pending={pending?.approvalId === row.approvalId ? pending : null}
							busy={busy}
							refusal={refusal?.approvalId === row.approvalId ? refusal : null}
							onDecide={onDecide}
							nowSeconds={nowSeconds}
							networkNames={networkNames}
						/>
					))}
				</ul>
			)}

			{refusal && !refusalAttached && <MeshDecisionRefusal refusal={refusal} />}

			{/*
			 * THE RECORDS SECTION. `Disclosure` is the app's one disclosure idiom
			 * (branding § Disclosure), so the toggle, the chevron swap and the
			 * `aria-expanded` state are the primitive's — and its controlled form is
			 * what lets the failure default above coexist with the reader's own choice.
			 */}
			{records.length > 0 && (
				<Disclosure
					open={recordsOpen}
					onOpenChange={setRecordsChoice}
					chevronClassName="text-ink-dim"
					summary={
						<span className="text-meta">Records ({records.length})</span>
					}
				>
					<ul
						className="flex flex-col divide-y divide-hairline"
						data-tour-tag="mesh-approvals-records"
					>
						{records.map((row) => (
							<MeshApprovalCard
								key={row.approvalId}
								row={row}
								pending={
									pending?.approvalId === row.approvalId ? pending : null
								}
								busy={busy}
								refusal={
									refusal?.approvalId === row.approvalId ? refusal : null
								}
								onDecide={onDecide}
								nowSeconds={nowSeconds}
								networkNames={networkNames}
							/>
						))}
					</ul>
				</Disclosure>
			)}
		</section>
	);
};

/** One record, as the card that asks or reports. */
const MeshApprovalCard: FC<{
	row: MeshApprovalRow;
	/** The in-flight decision when it is THIS record's, for the waiting cue. */
	pending: { approvalId: string; decision: ApprovalDecision } | null;
	/** Whether ANY decision is in flight: the gate the surface owns (see the tray). */
	busy: boolean;
	/** This record's refusal, or `null` when the last one was about another record. */
	refusal: { code: string; sentence: string } | null;
	onDecide: (approvalId: string, decision: ApprovalDecision) => void;
	nowSeconds: number;
	/** Id -> name, for the summary's join clause (UX round 1, U1); absent until the mesh read lands. */
	networkNames?: ReadonlyMap<string, string>;
}> = ({ row, pending, busy, refusal, onDecide, nowSeconds, networkNames }) => {
	const waiting = isWaitingApproval(row.state);
	const head = approvalHead(row);
	const summary = approvalSummary(row, networkNames);
	const entries = approvalScopeEntries(row, networkNames);
	const where = approvalWhereLabel(row);
	const hostKey = approvalHostKeyLabel(row);
	const requester = approvalRequesterLabel(row);
	const remaining = approvalRemainingLabel(row.expiresAt, nowSeconds);
	const hints = stateHints(row.state);
	const canApprove = canApproveApproval(row.state);
	const canDeny = canDenyApproval(row.state);
	return (
		<li
			className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
			data-tour-tag="mesh-approval-card"
		>
			<div className="flex flex-wrap items-center gap-2">
				<Badge variant={chipVariant(row.state)}>
					{approvalStateLabel(row.state)}
				</Badge>
				<div className="grow" />
				{/*
				 * THE WINDOW PRINTS ONLY WHILE IT IS THE READER'S TO ACT ON (design
				 * round 1, D3; UX round 1, U3): a countdown is a prompt, and a settled
				 * record wears none — on `approved`/`connecting` the decision is made,
				 * and on `failed` the runner has stopped. The store keeps `expires_at`
				 * on the record whatever its state (`badge_row` passes it raw; only
				 * `presented()` reads it), so the gate is the SURFACE's, by state.
				 */}
				{waiting && remaining && (
					<span className="text-meta text-ink-dim">{remaining}</span>
				)}
			</div>

			{/*
			 * THE ONE LINE OF PLAIN LANGUAGE (operator round, 2026-10-03). Everything
			 * below it is a control or the Details disclosure; the ask itself is this
			 * sentence, and it is built from the record's own scopes so the summary
			 * cannot promise less than the consequences show. It is ONE SENTENCE,
			 * which the longest shape wraps to two rendered lines (design round 1,
			 * D6). A RECORD row leads with the ask's title alone instead (UX round 1,
			 * U2): the decision-time sentence belongs to the moment of decision, and
			 * repeating it per settled row is the wall the operator reported.
			 */}
			<p
				className="text-body-sm text-ink"
				data-tour-tag="mesh-approval-summary"
			>
				{waiting ? summary : head}
			</p>

			{/*
			 * A STOPPED RUNNER SAYS WHAT HAPPENED AND WHAT CAN BE DONE (UX round 1,
			 * U1). The wire's frozen list shape carries no failure detail (§3.5 —
			 * `badge_row` has no step or receipt), so the CAUSE the card can state is
			 * that the runner stopped before finishing; what it must not leave
			 * unsaid is that nothing needs to be destroyed — the record stays
			 * retryable until its window closes, and `Abandon` is the one write that
			 * forecloses that. The retry verb is the same one `stateHints("approved")`
			 * already names.
			 */}
			{row.state === "failed" && (
				<p
					className="text-meta text-ink-muted"
					data-tour-tag="mesh-approval-stopped-note"
				>
					The runner stopped before it finished. It stays retryable until its
					window closes (lop network approvals run); Abandon denies the request.
				</p>
			)}

			{(canApprove || canDeny) && (
				<div className="flex flex-wrap items-center gap-2">
					{canApprove && (
						<Button
							variant="primary"
							size="sm"
							disabled={busy}
							onClick={() => onDecide(row.approvalId, "approve")}
							data-tour-tag="mesh-approval-approve"
						>
							Approve
						</Button>
					)}
					{canDeny && (
						<Button
							variant="ghost"
							size="sm"
							disabled={busy}
							onClick={() => onDecide(row.approvalId, "deny")}
							/* The record's one remaining write, named by its consequence (see
							   `recordActionLabel`): `Deny` only while the record still WAITS. */
							data-tour-tag={
								waiting ? "mesh-approval-deny" : "mesh-approval-stop"
							}
						>
							{waiting ? "Deny" : recordActionLabel(row.state)}
						</Button>
					)}
					{pending && (
						<span className="text-meta text-ink-dim">
							{pending.decision === "approve"
								? "Waiting for the signing prompt…"
								: "Writing the decision…"}
						</span>
					)}
				</div>
			)}

			{/*
			 * DETAIL BEHIND A DISCLOSURE (operator round, 2026-10-03). The consequence
			 * list, the provenance lines and the state glosses used to be the card's
			 * always-visible body; they are the reference for the sentence above, one
			 * click away, and their order keeps the CLI's "what / where / who"
			 * (`network/cli.py::_approval_lines`).
			 */}
			<Disclosure
				chevronClassName="text-ink-dim"
				summary={<span className="text-meta">Details</span>}
			>
				{entries.length > 0 && (
					<dl
						className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 text-meta text-ink-dim"
						data-tour-tag="mesh-approval-consequences"
					>
						{entries.map((entry) => (
							<Fragment key={entry.term}>
								<dt className="text-ink-muted">{entry.term}</dt>
								<dd>{entry.consequence}</dd>
							</Fragment>
						))}
					</dl>
				)}

				{(where || hostKey) && (
					<p className="text-meta text-ink-muted">
						{where && <span>{where}</span>}
						{where && hostKey && <span> · </span>}
						{hostKey && <span className="font-mono">{hostKey}</span>}
					</p>
				)}

				{requester && <p className="text-meta text-ink-dim">{requester}</p>}

				{hints.length > 0 && (
					<dl
						className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 text-meta"
						data-tour-tag="mesh-approval-consequence"
					>
						{hints.map((entry) => (
							<Fragment key={entry.term}>
								<dt className="text-ink-muted">{entry.term}</dt>
								{/* The gloss shares the term's register (design round 2, D13): at
								    `ink-dim` the row read as one more line of metadata rather than
								    as the consequence it is. */}
								<dd className="text-ink-muted">{entry.text}</dd>
							</Fragment>
						))}
					</dl>
				)}
			</Disclosure>

			{refusal && <MeshDecisionRefusal refusal={refusal} />}
		</li>
	);
};

/**
 * One refused decision, rendered where the record it was about stands (or, for a
 * refusal whose record sits inside the CLOSED records section, under the list —
 * the case a naive attach would swallow; `refusalAttached` above decides which).
 *
 * The warning register is the house's for a write refusal (`RemoveMemberDialog`'s
 * own), and the code travels BESIDE the sentence, the way the move refusals
 * carry theirs (`MoveNotice`): one wrapped row, the sentence first, the code
 * trailing on the same line where it fits. The Alert's body is a flex COLUMN,
 * so the two spans stack unless they arrive as one row — design round 1 (D7)
 * measured that the old markup did not carry the parity its comment claimed.
 * No `role="alert"` - the tray is already in the reader's flow; this is a
 * state, not an interruption.
 */
const MeshDecisionRefusal: FC<{
	refusal: { code: string; sentence: string };
}> = ({ refusal }) => (
	<Alert
		variant="warning"
		className="text-meta"
		data-tour-tag="mesh-approval-refusal"
	>
		<span className="flex min-w-0 flex-wrap items-center gap-2">
			<span className="min-w-0 flex-1">{refusal.sentence}</span>
			<span className="shrink-0 font-mono text-ink-dim">{refusal.code}</span>
		</span>
	</Alert>
);
