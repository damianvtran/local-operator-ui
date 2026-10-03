/**
 * The approvals tray: the whole pending queue, in one block on the Mesh tab.
 *
 * Modelled on the browser-approval tray (`features/browser/components/browser-approvals-tray.tsx`),
 * with the two differences the host forces rather than choose:
 *
 *   - THERE IS NO NATIVE VIEW HERE, so there is no band/dock split. The tray
 *     lives in the page's own flow, above whatever state the canvas is in — a
 *     pending approval is the most important fact on the tab, so it renders
 *     first and in full. The browser pattern's one-card-plus-chips selection
 *     exists because its band has a 1280px row and a dock has 384px; this block
 *     has the tab's whole width, so every waiting record draws as its own card
 *     and nothing needs selecting.
 *   - THE RESOLVED LINES ARE MEMORY, NOT A READ. The list route keeps terminal
 *     records for thirty days (§2.4), and a tray that rendered them would be an
 *     archive dump over a page whose job is "what is happening now". What a
 *     reader needs instead is the answer to "why did the count change", and that
 *     is the browser tray's own solved problem: remember what was live, and when
 *     a record leaves the live set for a terminal state, say so in one quiet
 *     line until the tab is left. A record that was ALREADY terminal when the
 *     tab opened (a denial from three days ago) is not news and draws nothing.
 *
 * WHO DECIDES WHAT: the card renders what the record carries and offers only the
 * moves the store's own transition matrix allows (`mesh-approvals.ts` owns the
 * predicates — `approve` on `requested` alone, `deny` on every open state, which
 * is the matrix's own shape and not a simplification). The approval's signing
 * gesture is presence-gated on the backend, so the pending state says a prompt
 * is expected rather than pretending the click completed anything.
 */

import { Alert, Badge, Button } from "@shared/components/ui";
import { ShieldCheck } from "lucide-react";
import type { FC } from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
	type ApprovalDecision,
	type MeshApprovalRow,
	approvalHostKeyLabel,
	approvalRemainingLabel,
	approvalRequesterLabel,
	approvalScopeGlosses,
	approvalScopeLabels,
	approvalScopeTone,
	approvalStateLabel,
	approvalSubject,
	approvalTitle,
	approvalWhereLabel,
	canApproveApproval,
	canDenyApproval,
	isOpenApproval,
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
 * One state's hint line, or `null` where there is nothing to add to the chip.
 *
 * These exist because two of the states are not self-explanatory from a word:
 * `approved` is a record the OPERATOR already answered and is waiting on a
 * runner that lives elsewhere, and a deny while `connecting` is a mid-run stop
 * rather than an ordinary refusal (the write lands, the runner observes it at
 * its next step check). Stating them here is cheaper than a user learning them
 * by pressing.
 */
function stateHint(state: string): string | null {
	switch (state) {
		case "requested":
			return "Approving signs with this machine's operator key; the system may ask for it.";
		case "approved":
			return "An agent runs the install and connect (lop network approvals run).";
		case "connecting":
			return "Denying now stops it at its next step.";
		case "failed":
			return "The runner stopped. Denying abandons it; an agent can retry it.";
		default:
			return null;
	}
}

/**
 * The `dt` a state's hint hangs from (design round 1, D2).
 *
 * WHY THE HINT IS NO LONGER A TRAILING CLAUSE. It used to ride the provenance
 * line - "asked by cli · session 6789ef · Approving signs with this machine's
 * operator key" - one 946px `text-ink-dim` paragraph at one register, so the
 * sentence that says what the decision DOES read as another piece of metadata.
 * The repo's own reference for a consent surface gives each consequential
 * statement its own labelled gloss in a `dl` (`browser-consent-request.tsx`,
 * the allow-scopes block), and this is that shape: the term names the moment the
 * gloss is about, because "what this means" differs per state - approving hands
 * over a signature, denying mid-run stops a runner, a failure leaves an
 * abandoned record.
 */
function stateHintTerm(state: string): string {
	switch (state) {
		case "requested":
			return "Signing";
		case "approved":
			/** No gloss opening repeats its own term (design round 2, D11). */
			return "Next";
		case "connecting":
			return "Stop";
		case "failed":
			return "After a stop";
		default:
			return "What this means";
	}
}

/** The one word a resolved line uses for a terminal state. */
function resolvedWord(state: string): string {
	if (state === "connected") return "connected";
	if (state === "denied") return "denied";
	return "expired";
}

/** One remembered departure: a record the reader watched leave the live set. */
type ResolvedEntry = { key: string; text: string };

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
	 * was about when the request named one. Rendered beside that record's card,
	 * or under the list when the refusal's own refetch settled the record out of
	 * the live set - the sentence may not go missing either way, because it is
	 * the only thing that tells a refusal from a dead click.
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
	 * OPTIONAL: a tray that painted before the canvas falls back to the id, and
	 * the chip never renders a blank.
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
	 * LIVE IS THE STORE'S NON-TERMINAL SET, in the store's own order (oldest
	 * first): the oldest record is the first to expire, and a surface that
	 * re-sorted would disagree with the CLI's listing about which comes first.
	 */
	const live = useMemo(
		() => rows.filter((row) => isOpenApproval(row.state)),
		[rows],
	);

	const [resolved, setResolved] = useState<ResolvedEntry[]>([]);
	const previousLive = useRef<Map<string, string>>(new Map());
	useEffect(() => {
		const liveNow = new Map<string, string>();
		for (const row of live) liveNow.set(row.approvalId, approvalSubject(row));
		const additions: ResolvedEntry[] = [];
		for (const [id, subject] of previousLive.current) {
			if (liveNow.has(id)) continue;
			const row = rows.find((candidate) => candidate.approvalId === id);
			const state = row?.state ?? "";
			// Only a TERMINAL reading is a reason: a row that vanished from the
			// answer without one (pruned mid-view) says nothing, because inventing a
			// reason would be a claim this read did not make.
			if (state === "connected" || state === "denied" || state === "expired") {
				additions.push({
					key: `${id}:${state}`,
					text: `${subject} — ${resolvedWord(state)}`,
				});
			}
		}
		if (additions.length) {
			setResolved((held) => [...held, ...additions].slice(-3));
		}
		previousLive.current = liveNow;
	}, [live, rows]);

	/*
	 * A REFUSAL ATTACHES TO ITS RECORD when the record is still live; otherwise
	 * it renders under the list, because the refusal's own settle refetch is
	 * exactly what can carry a record out of the live set (a conflict or an
	 * expiry), and the sentence is then the only trace of the attempted answer.
	 */
	const refusalAttached =
		refusal !== null &&
		live.some((row) => row.approvalId === refusal.approvalId);

	// Nothing to say, say nothing: no records, no memory, no failure, no refusal.
	if (live.length === 0 && resolved.length === 0 && !error && !refusal)
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
				{live.length > 0 && (
					<span className="text-meta text-ink-dim">
						{live.length === 1 ? "1 waiting" : `${live.length} waiting`}
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

			{live.length > 0 && (
				<ul className="flex flex-col divide-y divide-hairline">
					{live.map((row) => (
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

			{resolved.length > 0 && (
				<ul
					className="flex flex-col gap-0.5 text-meta text-ink-dim"
					data-tour-tag="mesh-approvals-resolved"
				>
					{resolved.map((entry) => (
						<li key={entry.key}>{entry.text}</li>
					))}
				</ul>
			)}
		</section>
	);
};

/** One open record, as the card that asks or reports. */
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
	/** Id -> name, for the join chip (UX round 1, U1); absent until the mesh read lands. */
	networkNames?: ReadonlyMap<string, string>;
}> = ({ row, pending, busy, refusal, onDecide, nowSeconds, networkNames }) => {
	const where = approvalWhereLabel(row);
	const hostKey = approvalHostKeyLabel(row);
	const requester = approvalRequesterLabel(row);
	const scopes = approvalScopeLabels(row, networkNames);
	const glosses = approvalScopeGlosses(row);
	const remaining = approvalRemainingLabel(row.expiresAt, nowSeconds);
	const hint = stateHint(row.state);
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
				<span className="text-body-sm text-ink">{approvalTitle(row)}</span>
				<div className="grow" />
				{remaining && (
					<span className="text-meta text-ink-dim">{remaining}</span>
				)}
			</div>

			{(where || hostKey) && (
				<p className="text-meta text-ink-muted">
					{where && <span>{where}</span>}
					{where && hostKey && <span> · </span>}
					{hostKey && <span className="font-mono">{hostKey}</span>}
				</p>
			)}

			{scopes.length > 0 && (
				<ul className="flex flex-wrap gap-1">
					{scopes.map((scope) => (
						<li key={scope}>
							{/* The consequence-bearing scopes wear `attention` so they are not
							    read as ordinary scopes (design round 1, D1). */}
							<Badge variant={approvalScopeTone(scope)}>{scope}</Badge>
						</li>
					))}
				</ul>
			)}

			{requester && <p className="text-meta text-ink-dim">{requester}</p>}

			{/*
			 * WHAT EACH TRUST-BEARING SCOPE MEANS (UX round 1, U2). The card's single
			 * sentence explains the GESTURE; nothing explained the scopes, and the two
			 * the design made salient are exactly the two a non-expert cannot read.
			 */}
			{glosses.length > 0 && (
				<dl
					className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 text-meta text-ink-dim"
					data-tour-tag="mesh-approval-scope-glosses"
				>
					{glosses.map((entry) => (
						<Fragment key={entry.term}>
							<dt className="text-ink-muted">{entry.term}</dt>
							<dd>{entry.gloss}</dd>
						</Fragment>
					))}
				</dl>
			)}

			{/* Provenance above, consequence here, as its own labelled gloss - the
			    house shape for a consent surface (design round 1, D2). */}
			{hint && (
				<dl
					className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 text-meta"
					data-tour-tag="mesh-approval-consequence"
				>
					<dt className="text-ink-muted">{stateHintTerm(row.state)}</dt>
					{/* The gloss shares the term's register (design round 2, D13): at
					    `ink-dim` the row read as one more line of metadata rather than
					    as the consequence it is. */}
					<dd className="text-ink-muted">{hint}</dd>
				</dl>
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
							variant={canApprove ? "ghost" : "secondary"}
							size="sm"
							disabled={busy}
							onClick={() => onDecide(row.approvalId, "deny")}
							data-tour-tag="mesh-approval-deny"
						>
							Deny
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

			{refusal && <MeshDecisionRefusal refusal={refusal} />}
		</li>
	);
};

/**
 * One refused decision, rendered where the record it was about stands (or, for a
 * refusal whose record left the live set, under the list).
 *
 * The warning register is the house's for a write refusal (`RemoveMemberDialog`'s
 * own), and the code is carried the way the move refusals carry theirs: the
 * sentence is for the reader, the code for the support conversation. No
 * `role="alert"` - the tray is already in the reader's flow; this is a state,
 * not an interruption.
 */
const MeshDecisionRefusal: FC<{
	refusal: { code: string; sentence: string };
}> = ({ refusal }) => (
	<Alert variant="warning" className="text-meta">
		<span className="min-w-0 flex-1">{refusal.sentence}</span>
		<span className="shrink-0 font-mono text-ink-dim">{refusal.code}</span>
	</Alert>
);
