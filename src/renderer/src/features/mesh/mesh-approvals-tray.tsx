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
 *     stopped, terminal — behind a `Disclosure` labelled "Settled approvals"
 *     that starts closed and is opened only by the reader. The closure is the
 *     archive-dump guard the old tray argued for, kept: a record nobody opened
 *     costs one line of chrome, not a wall. A `failed` record inside does NOT
 *     expand the section (operator ask, 2026-10-13: a settled record must not
 *     greet the reader expanded), and the store's own concern — `failed` is
 *     "the state a person should not miss" — is carried by the words `N failed`
 *     (in `text-danger`) in the closed summary (design round 1, D2 added the
 *     text to the dot), so the signal survives the collapse without spending
 *     the reader's layout on it. The section also draws a `border-t` hairline
 *     when a waiting card sits above it (D1), so it reads as a section rather
 *     than as that card's next disclosure.
 *
 * THE REGISTER IS THE APP'S QUIET ONE, and this surface used to be the odd one
 * out (operator ask, 2026-10-13: the tray was a bordered, padded card whose
 * every row led with a chip). The tray now matches the app's borderless list
 * sections — `project-todos.tsx` and `project-updates.tsx` state the pattern in
 * their own words, "borderless entries, the chat page's chrome: hairlines, no
 * box" — so the sets are `divide-y divide-hairline` groups on the page's ground
 * with no panel around them, and a record's state is a line of text rather than
 * a Badge, in the register `IntegrationRow`'s status column already keeps: only
 * the state that needs the reader is coloured, and a settled row states itself
 * more quietly than a waiting one.
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

import { Alert, Button } from "@shared/components/ui";
import { Disclosure } from "@shared/components/ui/disclosure";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { ShieldCheck } from "lucide-react";
import type { FC } from "react";
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import { t } from "../../../../i18n/messages";
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

/**
 * The INK a row's state line wears, in the app's own status register.
 *
 * `IntegrationRow`'s status column states the rule this follows: "only states
 * that ask for attention are coloured; a healthy or idle row reads in muted ink
 * so the page's colour points at work". So `failed` — the store's own "the state
 * a person should not miss" — is the only coloured one, and `requested` is
 * `ink-muted` rather than `ink` because it is the card's state line and not the
 * ask itself, which the summary sentence below states at full `ink`.
 *
 * The state used to be a `Badge` chip. A chip is a filled, bordered object, and
 * six of them stacked down a settled section read as six calls to action; the
 * operator's register complaint was about exactly that, so the state is text now
 * and carries no fill at all.
 */
function stateInk(state: string): string {
	if (state === "failed") return "text-danger";
	if (isWaitingApproval(state)) return "text-ink-muted";
	return "text-ink-dim";
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
	return state === "failed"
		? t("ui.mesh.mesh_approvals_tray.abandon")
		: t("ui.mesh.mesh_approvals_tray.stop");
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
					term: t("ui.mesh.mesh_approvals_tray.signing"),
					text: t(
						"ui.mesh.mesh_approvals_tray.approving_signs_with_this_machine_s_operator",
					),
				},
			];
		case "approved":
			return [
				{
					term: t("ui.mesh.mesh_approvals_tray.next"),
					text: t(
						"ui.mesh.mesh_approvals_tray.an_agent_runs_the_install_and_connect",
					),
				},
				{
					term: t("ui.mesh.mesh_approvals_tray.stop"),
					text: t(
						"ui.mesh.mesh_approvals_tray.stopping_now_denies_the_request_nothing_has",
					),
				},
			];
		case "connecting":
			return [
				{
					term: t("ui.mesh.mesh_approvals_tray.stop"),
					text: t(
						"ui.mesh.mesh_approvals_tray.stopping_now_denies_the_request_the_runner",
					),
				},
			];
		case "failed":
			return [
				{
					term: t("ui.mesh.mesh_approvals_tray.after_a_stop"),
					text: t(
						"ui.mesh.mesh_approvals_tray.the_runner_stopped_before_it_finished_abandoning",
					),
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
	useI18nLocale();
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
	 * THE SECTION IS THE READER'S, AND ONLY THE READER'S (operator ask,
	 * 2026-10-13). It used to open ITSELF while a `failed` record was inside —
	 * the store's `failed` being "the state a person should not miss" — but a
	 * settled record must not greet the reader expanded, so the section starts
	 * closed in every state and the failure is signalled INSIDE the collapsed
	 * summary (the dot below) instead of by spending the reader's layout on it.
	 *
	 * STILL CONTROLLED, deliberately: the open state is read HERE rather than
	 * left inside the primitive because `refusalAttached` below needs it — a
	 * decision refused on a record inside the section has to render under the
	 * list once the section is shut, and an uncontrolled disclosure would leave
	 * the tray unable to tell. What changed is only the DEFAULT: `false`, with no
	 * third term following the data, so a poll that keeps delivering the same
	 * failed record cannot re-open a section the reader closed.
	 */
	const [recordsOpen, setRecordsOpen] = useState(false);
	const trayRef = useRef<HTMLElement>(null);
	const recordsRef = useRef<HTMLDivElement>(null);
	const deniedFocus = useRef<{
		id: string;
		origin: Element | null;
		sawPending: boolean;
	} | null>(null);
	const decide = (id: string, decision: ApprovalDecision) => {
		if (
			decision === "deny" &&
			waiting.some((row) => row.approvalId === id && row.kind === "credential")
		) {
			deniedFocus.current = {
				id,
				origin: document.activeElement,
				sawPending: false,
			};
		}
		onDecide(id, decision);
	};
	useLayoutEffect(() => {
		const handoff = deniedFocus.current;
		if (!handoff) return;
		if (pending?.approvalId === handoff.id) handoff.sawPending = true;
		if (refusal?.approvalId === handoff.id) {
			deniedFocus.current = null;
			return;
		}
		const row = rows.find((entry) => entry.approvalId === handoff.id);
		if (row?.state === "requested") {
			if (!pending && handoff.sawPending) deniedFocus.current = null;
			return;
		}
		if (row?.state === "denied" && pending) return;
		deniedFocus.current = null;
		// The successful Deny removes its focused control. Hand it to the next
		// live request, or to CLOSED history, without opening records or taking
		// focus back from a person who moved elsewhere while the RPC was pending.
		if (
			row?.state !== "denied" ||
			(document.activeElement !== document.body &&
				document.activeElement !== handoff.origin)
		)
			return;
		const target = waiting.length
			? trayRef.current?.querySelector<HTMLButtonElement>(
					'[data-tour-tag="mesh-approval-controls"] button:not(:disabled)',
				)
			: recordsRef.current?.querySelector<HTMLButtonElement>("button");
		target?.focus({ preventScroll: true });
	}, [rows, pending, refusal, waiting.length]);
	const recordsSignalled = records.some((row) => row.state === "failed");
	/** How many settled records carry the state the store says not to miss. */
	const failedCount = records.filter((row) => row.state === "failed").length;

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
		/*
		 * BORDERLESS, ON THE PAGE'S OWN GROUND (operator ask, 2026-10-13). This was a
		 * bordered, padded card - a `rounded-lg` box on `surface` inside a `p-3` - matched
		 * to the mesh tab's own empty-state panel. The empty-state panel KEEPS its
		 * border: it is a stand-in for the canvas region and a box is what says so. A
		 * list of approvals is not a region, and the app draws its borderless lists
		 * the other way — `project-todos.tsx` and `project-updates.tsx`, "borderless
		 * entries, the chat page's chrome: hairlines, no box" — so the tray now follows
		 * the list register and no longer paints a second bordered panel beside the
		 * canvas's.
		 *
		 * The padding goes with the box: the page's `p-6` is already this block's
		 * gutter, and a leftover `p-3` would inset the rows from rules the panel around
		 * them has stopped drawing.
		 */
		<section
			ref={trayRef}
			aria-label={t("ui.mesh.mesh_approvals_tray.approvals")}
			data-tour-tag="mesh-approvals-tray"
			className="flex flex-col gap-3"
		>
			<div className="flex flex-wrap items-center gap-2">
				<ShieldCheck aria-hidden="true" className="size-4 text-ink-muted" />
				<h2 className="text-body-sm text-ink">
					{t("ui.mesh.mesh_approvals_tray.approvals")}
				</h2>
				{waiting.length > 0 && (
					<span className="text-meta text-ink-dim">
						{t("ui.mesh.mesh_approvals_tray.waiting_count", {
							count: waiting.length,
						})}
					</span>
				)}
			</div>

			{error && (
				<div className="flex flex-wrap items-center gap-2">
					<p className="min-w-0 flex-1 text-meta text-ink-muted">{error}</p>
					<Button variant="secondary" size="sm" onClick={onRetry}>
						{t("ui.mesh.mesh_approvals_tray.ask_again")}
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
							onDecide={decide}
							nowSeconds={nowSeconds}
							networkNames={networkNames}
						/>
					))}
				</ul>
			)}

			{refusal && !refusalAttached && <MeshDecisionRefusal refusal={refusal} />}

			{/*
			 * THE SETTLED SECTION IS NAMED FOR WHAT IT HOLDS. It read `Records (N)`
			 * nested inside the same bordered panel as the prompts, which is what made
			 * it not recognisable as an approvals section of its own (operator ask,
			 * 2026-10-13) — the label says what the section is, the count says how many,
			 * and the chevron is the primitive's own open/close affordance.
			 */}
			{/*
			 * THE FAILED SIGNAL RIDES THE SUMMARY, NOT THE DEFAULT (operator ask,
			 * 2026-10-13; wording corrected by QA round 1, Q2). `bg-danger` is the app's
			 * one "needs the reader" fill (`integration-row.tsx`'s status dot,
			 * `chat-status-strip.tsx`'s). The 4.23:1 QA round 1 derives is the sweep's
			 * worst over the four row grounds; the dot itself paints only on the PAGE
			 * ground, where the worst is 4.69:1 — so the figure is the conservative one,
			 * and either clears the 3:1 non-text floor in every palette.
			 *
			 * THE WORDS CARRY IT TOO (design round 1, D2): the header's own signal is
			 * words (`2 waiting`), so a bare dot left a sighted reader with colour as the
			 * only channel. `N failed` beside the label states it in the same idiom and
			 * the same ink the row's own state line wears (`stateInk`), which is also why
			 * the separate `sr-only` sentence is gone — the visible words are what a
			 * screen reader reads, and saying it twice was redundancy rather than
			 * accessibility. The dot stays beside them: it is the app's own "needs the
			 * reader" mark and costs the summary nothing.
			 */}
			{records.length > 0 && (
				<div ref={recordsRef}>
					<Disclosure
						open={recordsOpen}
						onOpenChange={setRecordsOpen}
						chevronClassName="text-ink-dim"
						/*
						 * THE HAIRLINE CARRIES INTO THE SECTION WHEN A PROMPT SITS ABOVE IT
						 * (design round 1, D1). The waiting list's `divide-y` stops at its last
						 * card, so in the mixed state the toggle shared that card's own rhythm
						 * (`Approve` -> `Details` ~26px, card -> toggle ~27px, same left edge and
						 * chevron) and read as one more disclosure of the card rather than a
						 * section of its own. The rule and the `pt-3` are what the lists already
						 * use to separate unlike blocks; a settled-only panel has no card above
						 * it and draws neither.
						 */
						className={cn(
							waiting.length > 0 && "border-hairline border-t pt-3",
						)}
						summary={
							<span className="flex items-center gap-1.5 text-meta text-ink-muted">
								{t("ui.mesh.mesh_approvals_tray.settled_approvals")}
								<span className="text-ink-dim">({records.length})</span>
								{recordsSignalled && (
									<span
										aria-hidden="true"
										className="size-1.5 rounded-full bg-danger"
									/>
								)}
								{failedCount > 0 && (
									<span className="text-danger">
										{t("ui.mesh.mesh_approvals_tray.failed_count", {
											count: failedCount,
										})}
									</span>
								)}
							</span>
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
									onDecide={decide}
									nowSeconds={nowSeconds}
									networkNames={networkNames}
								/>
							))}
						</ul>
					</Disclosure>
				</div>
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
	useI18nLocale();
	const waiting = isWaitingApproval(row.state);
	const head = approvalHead(row);
	const summary = approvalSummary(row, networkNames);
	const entries = approvalScopeEntries(row, networkNames);
	const where = approvalWhereLabel(row);
	const hostKey = approvalHostKeyLabel(row);
	const requester = approvalRequesterLabel(row);
	const remaining = approvalRemainingLabel(row.expiresAt, nowSeconds);
	const opaque = row.kind === "credential" || row.kind === "unknown";
	const restricted = opaque || row.canApproveHere === false;
	// Generic signing/install hints are false for opaque typed intent. The
	// server's full disclosure is the only description of what would be signed.
	const hints = restricted ? [] : stateHints(row.state);
	const canApprove = canApproveApproval(row);
	const canDeny = canDenyApproval(row.state);
	return (
		<li
			className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
			data-tour-tag="mesh-approval-card"
		>
			<div className="flex flex-wrap items-center gap-2">
				{/*
				 * THE STATE IS A LINE OF TEXT, not a chip (operator ask, 2026-10-13): a
				 * Badge here is a filled, bordered object, and a settled section's rows are
				 * records rather than six stacked calls to action. The accessible name is
				 * unchanged — this is the same `approvalStateLabel` — so nothing a screen
				 * reader hears depends on which register the words are painted in.
				 */}
				<span className={cn("text-meta", stateInk(row.state))}>
					{row.kind === "credential" && row.state === "approved"
						? t("ui.mesh.approval.approved_pending_apply")
						: approvalStateLabel(row.state)}
				</span>
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
					<span className="text-meta text-ink-dim">
						{row.kind === "credential"
							? t("ui.mesh.approval.request_window", { remaining })
							: remaining}
					</span>
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
				className="text-body-sm text-ink [overflow-wrap:anywhere]"
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
			 * forecloses that.
			 *
			 * THE COPY NAMES NO TERMINAL ROUTE (UX round 2, U9, and the house rule that
			 * a command never rides in record copy). A command printed to a reader has
			 * to run as shown - the runner's own spelling carries a required argument
			 * (`lop network approvals run` exits 2 without it) - and the fact a reader
			 * needs is the record's hold, not the runner's invocation. The retry
			 * belongs to the runner side; this surface states the state and the one
			 * write it owns.
			 */}
			{!restricted && row.state === "failed" && (
				<p
					className="text-meta text-ink-muted"
					data-tour-tag="mesh-approval-stopped-note"
				>
					{t(
						"ui.mesh.mesh_approvals_tray.the_runner_stopped_before_it_finished_it",
					)}
				</p>
			)}

			{/* Optional false is a generic restriction, not just an inheritance
			    special case. Commands are authenticated backend TEXT, never actions.
			    Only pending cards repeat the approval remedy: approved is not applied. */}
			{waiting && restricted && (
				<p
					className="text-meta text-ink-muted whitespace-pre-wrap [overflow-wrap:anywhere]"
					data-tour-tag="mesh-approval-cli-remedy"
				>
					{row.approveRemedy || t("ui.mesh.approval.cli_review")}
				</p>
			)}
			{row.kind === "credential" && row.state === "approved" && (
				<p
					className="text-meta text-ink-muted"
					data-tour-tag="mesh-approval-apply-hint"
				>
					{row.details?.length
						? t("ui.mesh.approval.approved_apply_hint")
						: t("ui.mesh.approval.approved_details_missing")}
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
							{t("ui.mesh.mesh_approvals_tray.approve")}
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
							{waiting
								? t("ui.mesh.mesh_approvals_tray.deny")
								: recordActionLabel(row.state)}
						</Button>
					)}
					{pending && (
						<span className="text-meta text-ink-dim">
							{pending.decision === "approve"
								? t(
										"ui.mesh.mesh_approvals_tray.waiting_for_the_signing_prompt",
									)
								: t("ui.mesh.mesh_approvals_tray.writing_the_decision")}
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
				summary={
					<span className="text-meta">
						{t("ui.mesh.mesh_approvals_tray.details")}
					</span>
				}
			>
				{opaque &&
					(row.details?.length ? (
						<ul
							className="flex flex-col gap-1.5 text-meta text-ink-muted [overflow-wrap:anywhere]"
							data-tour-tag="mesh-approval-server-details"
						>
							{row.details.map((line, index) => (
								<li key={`${index}:${line}`} className="whitespace-pre-wrap">
									{line}
								</li>
							))}
						</ul>
					) : (
						<p className="text-meta text-ink-muted">
							{t("ui.mesh.approval.details_unavailable")}
						</p>
					))}
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
}> = ({ refusal }) => {
	useI18nLocale();
	return (
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
};
