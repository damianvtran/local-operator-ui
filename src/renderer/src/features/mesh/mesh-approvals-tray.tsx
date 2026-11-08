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

import { Button } from "@shared/components/ui";
import { Disclosure } from "@shared/components/ui/disclosure";
import { useTextDirection } from "@shared/i18n/use-document-direction";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { ShieldCheck } from "lucide-react";
import type { FC } from "react";
import {
	Fragment,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { t } from "../../../../i18n/messages";
import {
	type ApprovalDecision,
	type MeshApprovalRow,
	approvalAnswerWindowLabel,
	approvalHead,
	approvalHeadUsesBackendSummary,
	approvalHostKeyLabel,
	approvalRefusalPartDirection,
	approvalRequesterLabel,
	approvalScopeEntries,
	approvalStateLabel,
	approvalSummary,
	approvalWhereLabel,
	canApproveApproval,
	canDenyApproval,
	canRetryCredentialApply,
	canRetryProfileApply,
	credentialConsequences,
	credentialRecipientLabel,
	credentialVisibleConsequences,
	deliverApprovalRefusal,
	hasPermanentCredentialOutcome,
	isAttentionApproval,
	isWaitingApproval,
	namedApprovalRefusalParts,
} from "./mesh-approvals";
import { profileCardView } from "./mesh-profile-approval";
import { ProfileConsentCard } from "./profile-consent-card";

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
		/** Mutation attempt identity, stable across parent renders. */
		submittedAt?: number;
		code: string;
		sentence: string;
		/** An apply-phase refusal after which the same signed card can still succeed. */
		retryable?: boolean;
	} | null;
	onDecide: (approvalId: string, decision: ApprovalDecision) => void;
	onRetry: () => void;
	/**
	 * `features.credential_approvals >= 1`: the backend serves the typed
	 * credential routes. Absent or false, a credential card keeps its Deny-only
	 * shape - there is no route here that could carry its Approve.
	 */
	credentialApprovals?: boolean;
	/**
	 * `features.profile_approvals >= 1`: the backend serves the typed
	 * `profile_save` card and its allowlisted decision routes. Absent or false, a
	 * profile row STILL renders - the store is the authority for what was proposed,
	 * so its disclosure is not withheld - but offers no signature: the kill-switch
	 * for a backend that predates the kind's registration.
	 */
	profileApprovals?: boolean;
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
	credentialApprovals = false,
	profileApprovals = false,
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
	const [refusalAnnouncement, setRefusalAnnouncement] = useState("");
	const focusedRefusal = useRef<string | null>(null);
	// Content identity survives query refetches; pending clears it for another
	// explicit attempt that receives the same refusal again.
	const refusalKey = refusal
		? JSON.stringify([refusal.approvalId, refusal.code, refusal.sentence])
		: null;
	/*
	 * THE TWO SETS, in the store's own order (oldest first) and nothing re-sorted:
	 * the oldest record is the first to expire, and a surface that re-sorted would
	 * disagree with the CLI's listing.
	 */
	const waiting = useMemo(
		() =>
			rows.filter(
				(row) => isWaitingApproval(row.state) || isAttentionApproval(row),
			),
		[rows],
	);
	const records = useMemo(
		() =>
			rows.filter(
				(row) => !isWaitingApproval(row.state) && !isAttentionApproval(row),
			),
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
		rowAtStart: MeshApprovalRow | undefined;
		refusalSubmittedAtStart: number;
	} | null>(null);
	const decide = (id: string, decision: ApprovalDecision) => {
		if (
			waiting.some((row) => row.approvalId === id && row.kind === "credential")
		) {
			deniedFocus.current = {
				id,
				origin: document.activeElement,
				rowAtStart: rows.find((row) => row.approvalId === id),
				refusalSubmittedAtStart: refusal?.submittedAt ?? 0,
			};
		}
		onDecide(id, decision);
	};
	useLayoutEffect(() => {
		const handoff = deniedFocus.current;
		if (!handoff) return;

		const row = rows.find((entry) => entry.approvalId === handoff.id);
		// A fast decision may settle before React ever renders pending. Completion
		// is the new row/refusal, not whether an intermediate frame was observed.
		if (pending) return;
		// Mutation settlement can precede its invalidated read. Wait for the new
		// row (or the refusal) before focusing a control a refetch will remove.
		const newRefusal =
			refusal?.approvalId === handoff.id &&
			(refusal.submittedAt ?? 0) > handoff.refusalSubmittedAtStart;
		if (row === handoff.rowAtStart && !newRefusal) return;
		deniedFocus.current = null;
		// Only an outcome on the current live card takes precedence. Otherwise
		// continue to another live card, then the settled toggle. Requested
		// neighbours receive focus on their summary, NEVER Approve: repeated Enter
		// after a fast completion must not consent to an unread second request.
		// Already-approved neighbours retain their actionable control target.
		const nextLive = waiting.find((entry) => entry.approvalId !== handoff.id);
		const nextTarget = nextLive
			? trayRef.current?.querySelector<HTMLElement>(
					`[data-tour-tag="mesh-approvals-live"] [data-approval-id="${CSS.escape(nextLive.approvalId)}"] ${isWaitingApproval(nextLive.state) ? '[data-tour-tag="mesh-approval-summary"]' : '[data-tour-tag="mesh-approval-controls"] button:not(:disabled)'}`,
				)
			: null;
		const target =
			(waiting.some((entry) => entry.approvalId === handoff.id)
				? trayRef.current?.querySelector<HTMLElement>(
						`[data-approval-id="${CSS.escape(handoff.id)}"] [data-tour-tag="mesh-approval-refusal"]`,
					)
				: null) ??
			nextTarget ??
			recordsRef.current?.querySelector<HTMLButtonElement>("button");
		const refusalTarget = refusal
			? (trayRef.current?.querySelector<HTMLElement>(
					`[data-approval-refusal-id="${CSS.escape(refusal.approvalId ?? "")}"]`,
				) ?? null)
			: null;
		const delivery = deliverApprovalRefusal({
			document,
			target: target ?? null,
			refusalTarget,
			origin: handoff.origin,
			allowFocus: true,
			sentence: refusal?.sentence ?? "",
		});
		if (delivery.focused) focusedRefusal.current = refusalKey;
	}, [rows, pending, refusal, waiting, refusalKey]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: row replacement can move/unmount the refusal DOM node without changing its text
	useLayoutEffect(() => {
		if (!refusal || pending) {
			focusedRefusal.current = null;
			setRefusalAnnouncement("");
			return;
		}
		if (focusedRefusal.current === refusalKey) {
			setRefusalAnnouncement("");
			return;
		}
		// Runs AFTER the focus handoff. When focus was preserved elsewhere, a
		// refusal card vanished, or focusing failed, announce the sentence here.
		const refusalTarget =
			trayRef.current?.querySelector<HTMLElement>(
				`[data-approval-refusal-id="${CSS.escape(refusal.approvalId ?? "")}"]`,
			) ?? null;
		const delivery = deliverApprovalRefusal({
			document,
			target: null,
			refusalTarget,
			origin: null,
			allowFocus: false,
			sentence: refusal.sentence,
		});
		if (delivery.focused) focusedRefusal.current = refusalKey;
		setRefusalAnnouncement(delivery.announcement);
	}, [refusal, refusalKey, pending, rows]);
	const waitingCount = waiting.filter((row) =>
		isWaitingApproval(row.state),
	).length;
	const attentionCount = waiting.filter(isAttentionApproval).length;
	const sharedCount = records.filter(
		(row) => row.kind === "credential" && row.state === "connected",
	).length;
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
				(isWaitingApproval(row.state) ||
					isAttentionApproval(row) ||
					recordsOpen),
		);

	const refusedRow = rows.find((row) => row.approvalId === refusal?.approvalId);

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
			<output aria-live="polite" aria-atomic="true" className="sr-only">
				{t("ui.mesh.approval.result_status", {
					shared: sharedCount,
					attention: attentionCount,
				})}
			</output>
			<output
				aria-live="polite"
				aria-atomic="true"
				className="sr-only"
				data-tour-tag="mesh-approval-announcement"
			>
				<bdi dir="auto">{refusalAnnouncement}</bdi>
			</output>
			<div className="flex flex-wrap items-center gap-2">
				<ShieldCheck aria-hidden="true" className="size-4 text-ink-muted" />
				<h2 className="text-body-sm text-ink">
					{t("ui.mesh.mesh_approvals_tray.approvals")}
				</h2>
				{waitingCount > 0 && (
					<span className="text-meta text-ink-dim">
						{t("ui.mesh.mesh_approvals_tray.waiting_count", {
							count: waitingCount,
						})}
					</span>
				)}
				{attentionCount > 0 && (
					<span className="text-meta text-warning">
						{t("ui.mesh.approval.needs_attention", { count: attentionCount })}
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
				<ul
					className="flex flex-col divide-y divide-hairline"
					data-tour-tag="mesh-approvals-live"
				>
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
							credentialApprovals={credentialApprovals}
							profileApprovals={profileApprovals}
						/>
					))}
				</ul>
			)}

			{refusal && !refusalAttached && (
				<MeshDecisionRefusal
					approvalId={refusal.approvalId ?? ""}
					requestIsBackendSummary={
						refusedRow ? approvalHeadUsesBackendSummary(refusedRow) : false
					}
					refusal={refusal}
					request={
						refusedRow
							? approvalHead(refusedRow)
							: t("ui.mesh.approval.credential_title")
					}
				/>
			)}

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
				<div ref={recordsRef} data-tour-tag="mesh-approvals-settled">
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
								{sharedCount > 0 && (
									<span className="text-ink-muted">
										{t("ui.mesh.approval.shared_count", { count: sharedCount })}
									</span>
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
									credentialApprovals={credentialApprovals}
									profileApprovals={profileApprovals}
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
	refusal: { code: string; sentence: string; retryable?: boolean } | null;
	onDecide: (approvalId: string, decision: ApprovalDecision) => void;
	nowSeconds: number;
	/** Id -> name, for the summary's join clause (UX round 1, U1); absent until the mesh read lands. */
	networkNames?: ReadonlyMap<string, string>;
	/** `features.credential_approvals`: see the tray's own prop. */
	credentialApprovals: boolean;
	/** `features.profile_approvals`: see the tray's own prop. */
	profileApprovals: boolean;
}> = ({
	row,
	pending,
	busy,
	refusal,
	onDecide,
	nowSeconds,
	networkNames,
	credentialApprovals,
	profileApprovals,
}) => {
	useI18nLocale();
	const waiting = isWaitingApproval(row.state);
	const permanentOutcome = hasPermanentCredentialOutcome(
		row,
		refusal?.retryable,
	);
	const summaryId = useId();
	const criticalId = useId();
	const head = approvalHead(row);
	const summary = approvalSummary(row, networkNames);
	const entries = approvalScopeEntries(row, networkNames);
	const where = approvalWhereLabel(row);
	const hostKey = approvalHostKeyLabel(row);
	const requester = approvalRequesterLabel(row);
	const remaining = approvalAnswerWindowLabel(
		row.expiresAt,
		nowSeconds,
		isAttentionApproval(row),
	);
	const opaque =
		row.kind === "credential" ||
		row.kind === "unknown" ||
		row.kind === "profile";
	const restricted = opaque || row.canApproveHere === false;
	// Generic signing/install hints are false for opaque typed intent. The
	// server's full disclosure is the only description of what would be signed.
	const hints = restricted ? [] : stateHints(row.state);
	const capabilities = { credentialApprovals, profileApprovals };
	const canApprove = canApproveApproval(row, capabilities);
	const canDeny = canDenyApproval(row.state);
	const canRetryApply = canRetryCredentialApply(
		row,
		capabilities,
		refusal?.retryable,
	);
	/*
	 * THE PROFILE CARD states the proposal itself, so this card hands it the view
	 * derived from the row and prints nothing of its own summary: a profile record
	 * has no device to onboard and no scope chips, and the generic sentences would
	 * be claims about a decision that is not this one.
	 */
	const profile =
		row.kind === "profile"
			? profileCardView(row, {
					profileApprovals,
					canApprove: canApproveApproval(row, capabilities),
					canDeny: canDenyApproval(row.state),
					canRetryApply: canRetryProfileApply(
						row,
						capabilities,
						refusal?.retryable,
					),
				})
			: null;
	/*
	 * A TYPED CARD speaks from the structured disclosure: the head line names the
	 * credential and the device, and Details lists the consequences in words. The
	 * backend's CLI-shaped `details` lines stay the fallback for a row without one.
	 */
	const typed = credentialApprovals ? row.typed : undefined;
	const consequences = typed ? credentialConsequences(row) : [];
	const recipient = typed?.disclosure ? credentialRecipientLabel(row) : null;
	/*
	 * THE FILE-KEY DISCLOSURE (backend `typed_approval.unproven_human`, operator
	 * decision a-b492: "the UI MUST render this disclosure when true"). On a
	 * file-only operator key any program running as the operator can sign, so an
	 * approval from here cannot prove a person pressed it. This remains true on
	 * refused and settled records as well as signable requests. Shown in the card's
	 * quiet meta register - a fact to know, not an alarm, because the operator
	 * already accepted that residual.
	 */
	const fileKeyNote = row.typed?.unprovenHuman === true;
	const signed =
		row.kind === "credential" &&
		["approved", "failed", "connecting", "connected"].includes(row.state);
	const outcomeSentence =
		refusal?.sentence ||
		(typed?.applyOutcome
			? [typed.applyOutcome.reason, typed.applyOutcome.remedy]
					.filter(Boolean)
					.join(" ")
			: "");
	const refusalCode =
		refusal?.code || typed?.applyOutcome?.code || typed?.refusal;
	const visibleConsequences = credentialVisibleConsequences(row);
	/*
	 * WHY THIS CARD CANNOT BE APPROVED HERE, in the order of who knows best: the
	 * typed block's own refusal sentence, or a non-CLI safety explanation if it
	 * cannot disclose the request. The legacy remedy can contain a terminal
	 * command and is only for untyped rows. An approvable card shows neither.
	 */
	const restrictedRemedy =
		(row.typed?.refusalMessage ?? "") ||
		(row.typed
			? t("ui.mesh.approval.typed_review_unavailable")
			: row.approveRemedy || t("ui.mesh.approval.cli_review"));
	return (
		<li
			className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
			data-tour-tag="mesh-approval-card"
			data-approval-id={row.approvalId}
		>
			<div className="flex flex-wrap items-center gap-2">
				{/*
				 * THE STATE IS A LINE OF TEXT, not a chip (operator ask, 2026-10-13): a
				 * Badge here is a filled, bordered object, and a settled section's rows are
				 * records rather than six stacked calls to action. The accessible name is
				 * unchanged — this is the same `approvalStateLabel` — so nothing a screen
				 * reader hears depends on which register the words are painted in.
				 */}
				<span
					className={cn(
						"text-meta",
						isAttentionApproval(row) ? "text-warning" : stateInk(row.state),
					)}
				>
					{permanentOutcome
						? t("ui.mesh.approval.could_not_apply")
						: row.kind === "credential" && row.state === "connected"
							? t("ui.mesh.approval.shared")
							: row.kind === "credential" &&
									(row.state === "approved" || row.state === "failed")
								? t("ui.mesh.approval.approved_not_applied")
								: approvalStateLabel(row.state)}
				</span>
				<div className="grow" />
				{/* Requested cards show the answer window; approved cards show the
				    remaining apply window. A permanent outcome has no countdown:
				    waiting cannot make the same card applicable again. */}
				{!permanentOutcome &&
					(waiting || isAttentionApproval(row)) &&
					remaining && (
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
			{profile ? (
				/*
				 * A PROFILE RECORD'S OWN CARD: the family, the operation, the authored
				 * fields that change (BEFORE/AFTER), the state, and the one place a
				 * revert could be offered. The tray's Approve/Deny row below stays the
				 * one set of verbs, so a profile card cannot grow a second answer path.
				 */
				<ProfileConsentCard view={profile} />
			) : (
				<p
					className="text-body-sm text-ink [overflow-wrap:anywhere]"
					data-tour-tag="mesh-approval-summary"
					tabIndex={-1}
					id={summaryId}
				>
					{waiting ? summary : head}
				</p>
			)}
			{visibleConsequences && (
				<p
					id={criticalId}
					className="text-meta text-ink-muted"
					data-tour-tag="mesh-approval-critical-facts"
				>
					{visibleConsequences}
				</p>
			)}

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
			{waiting && restricted && !canApprove && (
				<p
					className="text-meta text-ink-muted whitespace-pre-wrap [overflow-wrap:anywhere]"
					data-tour-tag="mesh-approval-cli-remedy"
				>
					{restrictedRemedy}
				</p>
			)}
			{row.kind === "credential" && !row.typed && row.state === "approved" && (
				<p
					className="text-meta text-ink-muted"
					data-tour-tag="mesh-approval-apply-hint"
				>
					{t(
						row.details?.length
							? "ui.mesh.approval.approved_apply_hint"
							: "ui.mesh.approval.approved_details_missing",
					)}
				</p>
			)}

			{fileKeyNote && (
				<p
					className="text-meta text-ink-dim"
					data-tour-tag="mesh-approval-file-key"
				>
					{t(
						signed
							? "ui.mesh.approval.file_key_recorded"
							: "ui.mesh.approval.file_key_disclosure",
					)}
				</p>
			)}
			{outcomeSentence && (
				<MeshDecisionRefusal
					approvalId={row.approvalId}
					refusal={{ code: refusalCode ?? "", sentence: outcomeSentence }}
				/>
			)}
			{canRetryApply && (
				<p className="text-meta text-ink-muted">
					{t("ui.mesh.approval.retry_hint")}
				</p>
			)}
			{signed && canDeny && (
				<p className="text-meta text-ink-muted">
					{t("ui.mesh.approval.cancel_hint")}
				</p>
			)}

			{(canApprove || canDeny || canRetryApply) && (
				<div
					className="flex flex-wrap items-center gap-2"
					data-tour-tag="mesh-approval-controls"
				>
					{canRetryApply && (
						/* Only on a retryable outcome: a permanent refusal retried is a loop
						   a person cannot leave (backend `approval_copy`, UX U2). It sends the
						   SAME reviewed digests to `apply-credential`; nothing is signed. */
						<Button
							variant="primary"
							size="sm"
							disabled={busy}
							aria-describedby={
								visibleConsequences ? `${summaryId} ${criticalId}` : summaryId
							}
							onClick={() => onDecide(row.approvalId, "apply")}
							data-tour-tag="mesh-approval-retry-apply"
						>
							{t("ui.mesh.approval.try_again")}
						</Button>
					)}
					{canApprove && (
						<Button
							variant="primary"
							size="sm"
							disabled={busy}
							aria-describedby={
								visibleConsequences ? `${summaryId} ${criticalId}` : summaryId
							}
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
							aria-describedby={
								visibleConsequences ? `${summaryId} ${criticalId}` : summaryId
							}
							onClick={() => onDecide(row.approvalId, "deny")}
							/* The record's one remaining write, named by its consequence (see
							   `recordActionLabel`): `Deny` only while the record still WAITS. */
							data-tour-tag={
								waiting ? "mesh-approval-deny" : "mesh-approval-stop"
							}
						>
							{waiting
								? t("ui.mesh.mesh_approvals_tray.deny")
								: row.kind === "credential"
									? t("ui.mesh.approval.cancel_sharing")
									: recordActionLabel(row.state)}
						</Button>
					)}
					{pending && (
						<span className="text-meta text-ink-dim">
							{pending.decision === "approve"
								? row.typed?.unprovenHuman
									? t("ui.mesh.approval.signing_applying")
									: t(
											"ui.mesh.mesh_approvals_tray.waiting_for_the_signing_prompt",
										)
								: pending.decision === "apply"
									? t("ui.mesh.approval.applying")
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
				{consequences.length > 0 && (
					<ul
						className="flex flex-col gap-1.5 text-meta text-ink-muted [overflow-wrap:anywhere]"
						data-tour-tag="mesh-approval-credential-consequences"
					>
						{consequences.map((line) => (
							<li key={line}>{line}</li>
						))}
					</ul>
				)}
				{recipient && typed?.disclosure?.recipient.keyFingerprint && (
					<p className="text-meta text-ink-dim [overflow-wrap:anywhere]">
						{t("ui.mesh.approval.recipient_key", { device: recipient })}{" "}
						<span className="font-mono">
							{typed.disclosure.recipient.keyFingerprint}
						</span>
					</p>
				)}
				{refusalCode && (
					<p className="text-meta text-ink-dim font-mono">{refusalCode}</p>
				)}
				{typed?.disclosure && (
					<Disclosure
						summary={
							<span className="text-meta">
								{t("ui.mesh.approval.technical_request")}
							</span>
						}
					>
						<pre
							className="max-h-48 overflow-auto whitespace-pre-wrap text-meta text-ink-dim [overflow-wrap:anywhere]"
							data-tour-tag="mesh-approval-signed-evidence"
						>
							{typed.disclosure.evidence}
						</pre>
					</Disclosure>
				)}

				{opaque &&
					consequences.length === 0 &&
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
		</li>
	);
};

/** Quiet, focusable outcome; raw machine codes stay in the owning card's Details. */
const MeshDecisionRefusal: FC<{
	refusal: { code: string; sentence: string };
	request?: string;
	requestIsBackendSummary?: boolean;
	approvalId: string;
}> = ({ refusal, request, approvalId, requestIsBackendSummary = false }) => {
	useI18nLocale();
	const direction = useTextDirection();
	return (
		<p
			tabIndex={-1}
			className="text-meta text-warning [overflow-wrap:anywhere]"
			data-tour-tag="mesh-approval-refusal"
			data-approval-refusal-id={approvalId}
		>
			{request ? (
				namedApprovalRefusalParts(request, refusal.sentence).map(
					(part, index) =>
						part.kind === "literal" ? (
							// biome-ignore lint/suspicious/noArrayIndexKey: locale-authored static punctuation can repeat
							<Fragment key={`literal:${index}`}>{part.text}</Fragment>
						) : (
							<bdi
								dir={approvalRefusalPartDirection(
									part.kind,
									direction,
									requestIsBackendSummary,
								)}
								key={part.kind}
							>
								{part.text}
							</bdi>
						),
				)
			) : (
				<bdi dir="auto">{refusal.sentence}</bdi>
			)}
		</p>
	);
};
