/**
 * Team Bridge Requests: the approval requests teammates' agents sent this
 * operator, decided one at a time or in a selected batch, plus the read-only
 * decision history; and the notice that shows what a Touch ID prompt is about
 * to confirm.
 *
 * Each component comes in two halves, the way the invitations view does: a
 * `...View` that renders props only (what the stories and frames drive) and a
 * thin container that wires the hooks. The rules - what a locked row allows,
 * the 50-item cap, how a refusal reads, which prompt is "not started by you" -
 * are in `team-bridge-approvals-model.ts`, never inline here.
 *
 * WHAT IS NEVER RENDERED: a message body or a screening rationale. A row shows
 * the sender, the ask card's already-screened `excerpt` and the time; a
 * refusal shows fixed copy, never the daemon's sentence.
 */
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
import { Checkbox } from "@shared/components/ui/checkbox";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@shared/components/ui/tabs";
import { formatDateTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useQueryClient } from "@tanstack/react-query";
import { Fingerprint, Info, ShieldAlert } from "lucide-react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
	type ApprovalDecisionRow,
	type ApprovalRefusal,
	type ApprovalRequestRow,
	type ApprovalRequestsPage,
	type ApprovalSelectionItem,
	type ApprovalWord,
	type AuthorizeNoticeItem,
	type AuthorizePromptNotice,
	type DecidedSnapshot,
	type ForeignPromptTrace,
	TEAM_BRIDGE_APPROVAL_BATCH_MAX,
	allowedWords,
	buildSelection,
	decidedSnapshot,
	dismissForeignPromptTrace,
	notDecidableReason,
	resultLine,
	resultsSummary,
	selectAllDecidable,
	selectableRows,
	selectionPreview,
	senderLabel,
	toggleSelected,
} from "./team-bridge-approvals-model";
import { teamBridgeKeys } from "./team-bridge-keys";
import {
	type ApprovalFlowState,
	useApprovalDecide,
	useApprovalDecisions,
	useApprovalRequests,
	useAuthorizeNotices,
	useDecidedStoreOwner,
	useForeignPromptTraces,
} from "./use-team-bridge-approvals";

type ListState = "loading" | "error" | "ready";

function stamp(value: string | null | number): string | null {
	if (value === null || value === "") return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return formatDateTime(date, { dateStyle: "medium", timeStyle: "short" });
}

/** Seconds left until `until`, never below zero. */
function secondsLeft(until: number): number {
	return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

/*
 * One open-the-card door for every row (UX review U3): the ask card lives in a
 * chat session on this machine (`ask.session_id`), so this is the same
 * "open the session, then route to it" the project and schedule pages use.
 */
function useOpenCard(): (sessionId: string) => void {
	const navigate = useNavigate();
	return useCallback(
		(sessionId: string) => {
			void useCanonicalSessionsStore
				.getState()
				.openSession(sessionId)
				.then((opened) => {
					if (opened) navigate(`/chat/${sessionId}`);
				});
		},
		[navigate],
	);
}

// -- the Requests view --------------------------------------------------------

export function TeamBridgeRequestsView({
	listState,
	rows,
	flow,
	coolingDown = false,
	cooldownUntil = null,
	presenceRequired = false,
	onDecide,
	onRetry,
	onDismissFlow,
	onOpenCard,
	traces = [],
	onDismissTrace,
	decided = () => null,
	history,
	initialTab = "waiting",
	initialSelected,
}: {
	/** Rows ticked on first render; stories use it to frame the batch bar. */
	initialSelected?: readonly string[];
	/** Which tab opens first; stories and frames use it to show the history. */
	initialTab?: "waiting" | "history";
	listState: ListState;
	rows: readonly ApprovalRequestRow[];
	flow: ApprovalFlowState;
	coolingDown?: boolean;
	/** When the cooldown ends (epoch ms), for the live countdown. */
	cooldownUntil?: number | null;
	/** Batch deciding needs Touch ID this Mac does not have (sticky, D5). */
	presenceRequired?: boolean;
	onDecide: (items: ApprovalSelectionItem[]) => void;
	onRetry?: () => void;
	onDismissFlow?: () => void;
	/** Opens the chat session holding a request's card. */
	onOpenCard?: (sessionId: string) => void;
	/** Ended prompts this window did not start (U7). */
	traces?: readonly ForeignPromptTrace[];
	onDismissTrace?: (authorizeId: string) => void;
	/** What this machine captured when it decided a request (U2). */
	decided?: (messageId: string) => DecidedSnapshot | null;
	history: { state: ListState; rows: readonly ApprovalDecisionRow[] };
}) {
	useI18nLocale();
	const [selected, setSelected] = useState<Set<string>>(
		() => new Set(initialSelected),
	);
	const [capped, setCapped] = useState(false);
	const [excluded, setExcluded] = useState(0);
	const selectAllId = useId();
	const sectionRef = useRef<HTMLElement>(null);
	const statusRef = useRef<HTMLDivElement>(null);
	const inFlight = flow.phase === "authorizing" || flow.phase === "deciding";
	/*
	 * Once the daemon says batch deciding needs Touch ID this Mac lacks, the
	 * batch controls and the row buttons go away and every row offers its card
	 * instead; offering a button that is certain to be refused again is not
	 * calm. Sticky across Dismiss (design D5).
	 */
	const batchUnavailable =
		presenceRequired ||
		(flow.phase === "refused" && flow.refusal.kind === "presence_required");
	const blocked = inFlight || coolingDown || batchUnavailable;
	// Drop selections whose row is gone or no longer decidable after a refresh.
	const live = useMemo(() => {
		const ids = new Set(selectableRows(rows).map((row) => row.message_id));
		return new Set([...selected].filter((id) => ids.has(id)));
	}, [rows, selected]);
	const decidable = selectableRows(rows);
	const selectable = Math.min(decidable.length, TEAM_BRIDGE_APPROVAL_BATCH_MAX);
	const allSelected = decidable.length > 0 && live.size === selectable;
	const preview = selectionPreview(rows, live);

	/*
	 * THE SELECTION IS CLEARED ONLY BY A DECISION THAT HAPPENED (agent review
	 * R1-03). A dismissed Touch ID, a cooldown or an in-flight refusal decided
	 * nothing, so the person keeps their selection and presses again; only a
	 * finished decide removes what it carried.
	 */
	useEffect(() => {
		if (flow.phase !== "done") return;
		const sent = new Set(flow.results.map((result) => result.message_id));
		setSelected((current) => {
			const next = new Set([...current].filter((id) => !sent.has(id)));
			return next.size === current.size ? current : next;
		});
	}, [flow]);

	/*
	 * KEEP KEYBOARD FOCUS IN THE PANEL (UX review U4). Pressing Approve disables
	 * the pressed button and a decided row then leaves the list, and either one
	 * drops focus to <body>. The status line takes it while the flow runs and
	 * the results take it after, but only when focus was in the panel (or
	 * already lost): a person who moved elsewhere is not pulled back.
	 */
	useEffect(() => {
		if (flow.phase === "idle") return;
		const active = document.activeElement;
		const inPanel =
			!active ||
			active === document.body ||
			Boolean(sectionRef.current?.contains(active));
		if (inPanel) statusRef.current?.focus({ preventScroll: true });
	}, [flow.phase]);

	const decideSelected = (word: ApprovalWord) => {
		const { items, excluded: left } = buildSelection(rows, live, word);
		setExcluded(left.length);
		if (items.length > 0) {
			onDecide(items);
			setCapped(false);
		}
	};
	const decideOne = (row: ApprovalRequestRow, word: ApprovalWord) => {
		setExcluded(0);
		onDecide([{ message_id: row.message_id, decision: word }]);
	};
	const batchLabel = (word: ApprovalWord) => {
		const { send } = preview[word];
		if (send < live.size)
			return word === "approve"
				? t("ui.teamBridge.approvals.approve_selected_partial", {
						send,
						total: live.size,
					})
				: t("ui.teamBridge.approvals.deny_selected_partial", {
						send,
						total: live.size,
					});
		return word === "approve"
			? t("ui.teamBridge.approvals.approve_selected")
			: t("ui.teamBridge.approvals.deny_selected");
	};

	return (
		<section
			ref={sectionRef}
			className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-5"
			aria-label={t("ui.teamBridge.approvals.title")}
		>
			<h2 className="text-lg font-medium text-ink">
				{t("ui.teamBridge.approvals.title")}
			</h2>
			<p className="max-w-prose text-sm text-ink-muted">
				{t("ui.teamBridge.approvals.intro")}
			</p>
			<Tabs defaultValue={initialTab} className="flex min-h-0 flex-col">
				<TabsList>
					<TabsTrigger value="waiting">
						{t("ui.teamBridge.approvals.tab_waiting")}
					</TabsTrigger>
					<TabsTrigger value="history">
						{t("ui.teamBridge.approvals.tab_history")}
					</TabsTrigger>
				</TabsList>
				<TabsContent value="waiting" className="flex flex-col gap-3">
					{traces.map((trace) => (
						<ForeignTraceLine
							key={trace.authorizeId}
							trace={trace}
							onDismiss={onDismissTrace}
						/>
					))}
					<div ref={statusRef} tabIndex={-1} className="outline-none">
						<FlowStatus
							flow={flow}
							cooldownUntil={cooldownUntil}
							presenceRequired={batchUnavailable}
							onDismiss={onDismissFlow}
						/>
					</div>
					{listState === "loading" && rows.length === 0 ? (
						<Spinner size="sm" label={t("ui.teamBridge.approvals.loading")} />
					) : listState === "error" && rows.length === 0 ? (
						<div role="alert" className="flex flex-col items-start gap-2">
							<p className="text-sm text-ink-muted">
								{t("ui.teamBridge.approvals.load_failed")}
							</p>
							{onRetry && (
								<Button size="sm" variant="ghost" onClick={onRetry}>
									{t("ui.teamBridge.list.retry")}
								</Button>
							)}
						</div>
					) : rows.length === 0 ? (
						<p className="text-sm text-ink-muted">
							{t("ui.teamBridge.approvals.empty")}
						</p>
					) : (
						<>
							{!batchUnavailable && decidable.length > 0 && (
								/* STICKY (UX review U8): with up to 50 rows the person
								   selecting near the bottom must still see the count and
								   the buttons. `bg-surface` is the panel's own ground, so
								   rows scroll under it without showing through. */
								<div className="sticky -top-5 z-10 -mx-5 flex min-h-8 flex-wrap items-center gap-2 bg-surface px-5 py-2">
									<label
										htmlFor={selectAllId}
										className="flex items-center gap-2 text-sm text-ink-muted"
									>
										<Checkbox
											id={selectAllId}
											checked={
												allSelected
													? true
													: live.size > 0
														? "indeterminate"
														: false
											}
											disabled={blocked}
											onCheckedChange={(checked) => {
												if (checked === true) {
													const all = selectAllDecidable(rows);
													setSelected(all.next);
													setCapped(all.capped);
												} else {
													setSelected(new Set());
													setCapped(false);
												}
											}}
										/>
										{t("ui.teamBridge.approvals.select_all")}
									</label>
									{live.size > 0 && (
										<>
											<span className="text-meta text-ink-dim">
												{t("ui.teamBridge.approvals.selected_count", {
													count: live.size,
												})}
											</span>
											<Button
												size="sm"
												variant="primary"
												disabled={blocked || preview.approve.send === 0}
												onClick={() => decideSelected("approve")}
											>
												{batchLabel("approve")}
											</Button>
											<Button
												size="sm"
												variant="secondary"
												disabled={blocked || preview.deny.send === 0}
												onClick={() => decideSelected("deny")}
											>
												{batchLabel("deny")}
											</Button>
										</>
									)}
								</div>
							)}
							{capped && (
								<p className="text-sm text-ink-muted" aria-live="polite">
									{t("ui.teamBridge.approvals.cap_reached", {
										max: TEAM_BRIDGE_APPROVAL_BATCH_MAX,
									})}
								</p>
							)}
							{excluded > 0 && (
								<p className="text-sm text-ink-muted" aria-live="polite">
									{t("ui.teamBridge.approvals.excluded", { count: excluded })}
								</p>
							)}
							<ul className="flex flex-col gap-2">
								{rows.map((row) => (
									<RequestRow
										key={row.message_id}
										row={row}
										checked={live.has(row.message_id)}
										blocked={blocked}
										showBatch={!batchUnavailable}
										decideHere={!batchUnavailable}
										onOpenCard={onOpenCard}
										onToggle={() => {
											/* A functional update, so several clicks in one task
											   all register (QA observation). */
											setSelected((current) => {
												const toggled = toggleSelected(current, row.message_id);
												setCapped(toggled.capped);
												return toggled.next;
											});
										}}
										onDecide={(word) => decideOne(row, word)}
									/>
								))}
							</ul>
						</>
					)}
				</TabsContent>
				<TabsContent value="history">
					<DecisionHistory
						state={history.state}
						rows={history.rows}
						decided={decided}
						onOpenCard={onOpenCard}
					/>
				</TabsContent>
			</Tabs>
		</section>
	);
}

function RequestRow({
	row,
	checked,
	blocked,
	showBatch,
	decideHere,
	onOpenCard,
	onToggle,
	onDecide,
}: {
	row: ApprovalRequestRow;
	checked: boolean;
	blocked: boolean;
	showBatch: boolean;
	/** False on a Mac without Touch ID: the row offers its card instead. */
	decideHere: boolean;
	onOpenCard?: (sessionId: string) => void;
	onToggle: () => void;
	onDecide: (word: ApprovalWord) => void;
}) {
	const sender = senderLabel(row.sender);
	/* U5: the name AND the address, so the row and the Touch ID notice name
	   the teammate the same way (the notice resolves its sender to this row). */
	const email =
		row.sender.name && row.sender.email && row.sender.email !== row.sender.name
			? row.sender.email
			: null;
	const reason = notDecidableReason(row);
	const words = decideHere ? allowedWords(row) : [];
	const locked = row.unsent_decision !== null && row.decidable;
	const received = stamp(row.created_at);
	const expires = stamp(row.request.expires_at);
	const sessionId = row.ask?.session_id ?? null;
	return (
		/* `elevated`, one lightness step above the page: rows are grouped by
		   ground value, never by a border (docs/branding.md). */
		<li className="flex gap-3 rounded-lg bg-elevated p-3 text-ink">
			{showBatch && row.decidable ? (
				<Checkbox
					className="mt-0.5"
					checked={checked}
					disabled={blocked}
					onCheckedChange={onToggle}
					aria-label={t("ui.teamBridge.approvals.select_row", { sender })}
				/>
			) : (
				showBatch && <span className="w-4 shrink-0" aria-hidden="true" />
			)}
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
					<span className="truncate font-medium">{sender}</span>
					{email && (
						<span className="truncate text-meta text-ink-dim">{email}</span>
					)}
					{received && (
						<span className="shrink-0 text-meta text-ink-dim">
							{t("ui.teamBridge.approvals.received", { time: received })}
						</span>
					)}
					{expires && (
						<span className="shrink-0 text-meta text-ink-dim">
							{t("ui.teamBridge.approvals.expires", { time: expires })}
						</span>
					)}
				</p>
				{row.excerpt && (
					<p className="line-clamp-3 text-sm text-ink-muted">{row.excerpt}</p>
				)}
				{reason && (
					<p className="text-meta text-ink-dim">
						{reason === "no_card"
							? t("ui.teamBridge.approvals.reason_no_card")
							: t("ui.teamBridge.approvals.reason_not_open")}
					</p>
				)}
				{locked && decideHere && (
					<p className="text-meta text-ink-dim">
						{t("ui.teamBridge.approvals.locked_note")}
					</p>
				)}
				{(words.length > 0 || (sessionId && onOpenCard)) && (
					<div className="flex min-h-8 flex-wrap items-center gap-2">
						{words.includes("approve") && (
							<Button
								size="sm"
								variant="primary"
								disabled={blocked}
								onClick={() => onDecide("approve")}
							>
								{locked
									? t("ui.teamBridge.approvals.approve_locked")
									: t("ui.teamBridge.approvals.approve")}
							</Button>
						)}
						{words.includes("deny") && (
							<Button
								size="sm"
								variant="secondary"
								disabled={blocked}
								onClick={() => onDecide("deny")}
							>
								{locked
									? t("ui.teamBridge.approvals.deny_locked")
									: t("ui.teamBridge.approvals.deny")}
							</Button>
						)}
						{sessionId && onOpenCard && (
							<Button
								size="sm"
								variant={decideHere ? "ghost" : "secondary"}
								onClick={() => onOpenCard(sessionId)}
								aria-label={t("ui.teamBridge.approvals.open_card_named", {
									sender,
								})}
							>
								{t("ui.teamBridge.approvals.open_card")}
							</Button>
						)}
					</div>
				)}
			</div>
		</li>
	);
}

/** The refusal kinds that stop the person acting until something changes. */
function blocksAction(refusal: ApprovalRefusal): boolean {
	return refusal.kind === "cooldown" || refusal.kind === "presence_required";
}

/** The cooldown sentence, counting down each second (design D4, QA Q3). */
/*
 * ONE ANNOUNCEMENT, NOT ONE PER SECOND (design D9). The line sits inside the
 * refusal `<output>`, a polite atomic live region, so re-rendering its
 * sentence every second had VoiceOver read it up to eight times in a row. The
 * region therefore holds a STATIC copy - the wait as it stood when the
 * refusal arrived, the same sentence in the same words - for screen readers,
 * and the ticking copy sighted readers watch is `aria-hidden`. No new string:
 * the English is frozen for translation.
 */
function CooldownLine({ until }: { until: number }) {
	const [seconds, setSeconds] = useState(() => secondsLeft(until));
	const [announced, setAnnounced] = useState(() => secondsLeft(until));
	useEffect(() => {
		setSeconds(secondsLeft(until));
		setAnnounced(secondsLeft(until));
		const timer = setInterval(() => setSeconds(secondsLeft(until)), 1000);
		return () => clearInterval(timer);
	}, [until]);
	return (
		<>
			<span className="sr-only">
				{t("ui.teamBridge.approvals.refusal.cooldown", {
					seconds: Math.max(1, announced),
				})}
			</span>
			<span aria-hidden="true">
				{t("ui.teamBridge.approvals.refusal.cooldown", {
					seconds: Math.max(1, seconds),
				})}
			</span>
		</>
	);
}

function FlowStatus({
	flow,
	cooldownUntil,
	presenceRequired,
	onDismiss,
}: {
	flow: ApprovalFlowState;
	cooldownUntil: number | null;
	presenceRequired: boolean;
	onDismiss?: () => void;
}) {
	if (flow.phase === "done")
		return <DecideResults flow={flow} onDismiss={onDismiss} />;
	if (flow.phase === "authorizing" || flow.phase === "deciding")
		return (
			<p
				aria-live="polite"
				className="flex items-center gap-2 text-sm text-ink-muted"
			>
				<Spinner size="sm" />
				{flow.phase === "authorizing"
					? t("ui.teamBridge.approvals.authorizing")
					: t("ui.teamBridge.approvals.deciding")}
			</p>
		);
	const refusal: ApprovalRefusal | null =
		flow.phase === "refused"
			? flow.refusal
			: presenceRequired
				? {
						kind: "presence_required",
						message: t("ui.teamBridge.approvals.refusal.presence_required"),
					}
				: null;
	if (!refusal) return null;
	const blocking = blocksAction(refusal);
	/*
	 * A REFUSAL IS A STATUS LINE, NOT A FIFTH ROW (design D3): no card ground,
	 * a leading icon; a refusal that blocks action sits on the warning wash so
	 * it reads as the reason the buttons are off. Presence-required has no
	 * Dismiss: it is this Mac's state, and dismissing it would only bring back
	 * buttons that are certain to be refused (D5).
	 */
	return (
		<output
			className={cn(
				"flex flex-wrap items-start gap-2 text-sm text-ink",
				blocking && "rounded-lg bg-warning-wash px-3 py-2",
			)}
		>
			<Info
				size={16}
				aria-hidden="true"
				className={cn(
					"mt-0.5 shrink-0",
					blocking ? "text-warning" : "text-ink-dim",
				)}
			/>
			<p className="min-w-0 flex-1">
				{refusal.kind === "cooldown" && cooldownUntil !== null ? (
					<CooldownLine until={cooldownUntil} />
				) : (
					refusal.message
				)}
			</p>
			{onDismiss && refusal.kind !== "presence_required" && (
				/* `-my-1` folds the 28 px `sm` button into the 20 px text line, so
				   Dismiss sits on the sentence's first line under `items-start`
				   (design D10) and still tops a wrapped sentence. */
				<Button size="sm" variant="ghost" className="-my-1" onClick={onDismiss}>
					{t("ui.common.actions.dismiss")}
				</Button>
			)}
		</output>
	);
}

/**
 * The decide's per-item results, rendered from the decide RESPONSE with the
 * sender captured when the person pressed, not from live rows (agent review
 * R1-02, QA Q1): the refetch drops every decided row, which is how the old
 * inline result line vanished after ~60 ms. They stay until Dismiss.
 */
function DecideResults({
	flow,
	onDismiss,
}: {
	flow: Extract<ApprovalFlowState, { phase: "done" }>;
	onDismiss?: () => void;
}) {
	const { done, notSent } = resultsSummary(flow.results);
	return (
		<div className="flex flex-col gap-2" aria-live="polite">
			<div className="flex items-center gap-2">
				<p className="text-sm font-medium text-ink">
					{t("ui.teamBridge.approvals.results_title", { done, notSent })}
				</p>
				{onDismiss && (
					<Button size="sm" variant="ghost" onClick={onDismiss}>
						{t("ui.common.actions.dismiss")}
					</Button>
				)}
			</div>
			<ul className="flex flex-col gap-1">
				{flow.results.map((result) => {
					const line = resultLine(result);
					return (
						<li
							key={result.message_id}
							className={cn(
								"text-sm",
								line.tone === "done" ? "text-ink-muted" : "text-ink",
							)}
						>
							{t("ui.teamBridge.approvals.result.item", {
								sender:
									flow.labels[result.message_id] ??
									t("ui.teamBridge.approvals.unknown_sender"),
								word:
									result.decision === "approve"
										? t("ui.teamBridge.approvals.approve")
										: t("ui.teamBridge.approvals.deny"),
								outcome: line.label,
							})}
						</li>
					);
				})}
			</ul>
		</div>
	);
}

/** A prompt this window did not start, after it ended (UX review U7). */
function ForeignTraceLine({
	trace,
	onDismiss,
}: {
	trace: ForeignPromptTrace;
	onDismiss?: (authorizeId: string) => void;
}) {
	const time = stamp(trace.at) ?? "";
	const params = { count: trace.count, time };
	return (
		<div className="flex flex-wrap items-start gap-2 rounded-lg bg-warning-wash px-3 py-2 text-sm text-ink">
			<ShieldAlert
				size={16}
				aria-hidden="true"
				className="mt-0.5 shrink-0 text-warning"
			/>
			<p className="min-w-0 flex-1">
				{trace.ended === "signed"
					? t("ui.teamBridge.approvals.trace.signed", params)
					: trace.ended === "dismissed"
						? t("ui.teamBridge.approvals.trace.dismissed", params)
						: t("ui.teamBridge.approvals.trace.refused", params)}
			</p>
			{onDismiss && (
				<Button
					size="sm"
					variant="ghost"
					onClick={() => onDismiss(trace.authorizeId)}
				>
					{t("ui.common.actions.dismiss")}
				</Button>
			)}
		</div>
	);
}

function DecisionHistory({
	state,
	rows,
	decided,
	onOpenCard,
}: {
	state: ListState;
	rows: readonly ApprovalDecisionRow[];
	decided: (messageId: string) => DecidedSnapshot | null;
	onOpenCard?: (sessionId: string) => void;
}) {
	if (state === "loading" && rows.length === 0)
		return (
			<Spinner size="sm" label={t("ui.teamBridge.approvals.history.loading")} />
		);
	if (state === "error" && rows.length === 0)
		return (
			<p role="alert" className="text-sm text-ink-muted">
				{t("ui.teamBridge.approvals.history.load_failed")}
			</p>
		);
	if (rows.length === 0)
		return (
			<p className="text-sm text-ink-muted">
				{t("ui.teamBridge.approvals.history.empty")}
			</p>
		);
	return (
		<ul className="flex flex-col gap-2">
			{rows.map((row) => {
				const when = stamp(row.decided_at);
				/* U2: WHAT was decided, for decisions made on this machine. The
				   ledger holds references only, so a decision made elsewhere shows
				   who and when, nothing more. "Decided by" is gone (N2): this tab is
				   `role=made`, so it was always the reader. */
				const local = decided(row.request_id);
				return (
					<li
						key={row.request_id}
						className="flex flex-col gap-0.5 rounded-lg bg-elevated p-3 text-ink"
					>
						<p className="flex min-w-0 items-baseline gap-2 text-sm">
							<span className="shrink-0 font-medium">
								{row.decision === "approved"
									? t("ui.teamBridge.approvals.history.approved")
									: row.decision === "denied"
										? t("ui.teamBridge.approvals.history.denied")
										: t("ui.teamBridge.approvals.history.other")}
							</span>
							<span className="truncate text-ink-muted">
								{t("ui.teamBridge.approvals.history.requested_by", {
									name: senderLabel(row.requested_by),
								})}
							</span>
							{when && (
								<span className="ms-auto shrink-0 text-meta text-ink-dim">
									{when}
								</span>
							)}
						</p>
						{local?.excerpt && (
							<p className="line-clamp-2 text-sm text-ink-muted">
								{local.excerpt}
							</p>
						)}
						{local?.sessionId && onOpenCard && (
							<div>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => onOpenCard(local.sessionId as string)}
								>
									{t("ui.teamBridge.approvals.open_card")}
								</Button>
							</div>
						)}
					</li>
				);
			})}
		</ul>
	);
}

/** The Requests panel, wired: one requests read, the ledger, the decide flow. */
export function TeamBridgeRequests() {
	const requests = useApprovalRequests(true, { panel: true });
	const decisions = useApprovalDecisions(true);
	const traces = useForeignPromptTraces();
	const openCard = useOpenCard();
	const rows = requests.data?.items ?? [];
	const lookup = useCallback(
		(messageId: string): DecidedSnapshot | null => {
			const row = rows.find((candidate) => candidate.message_id === messageId);
			return row
				? {
						sender: senderLabel(row.sender),
						excerpt: row.excerpt,
						sessionId: row.ask?.session_id ?? null,
					}
				: null;
		},
		[rows],
	);
	const decide = useApprovalDecide(lookup);
	const listState: ListState = requests.isError
		? "error"
		: requests.isPending
			? "loading"
			: "ready";
	const historyState: ListState = decisions.isError
		? "error"
		: decisions.isPending
			? "loading"
			: "ready";
	return (
		<TeamBridgeRequestsView
			listState={listState}
			rows={rows}
			flow={decide.state}
			coolingDown={decide.coolingDown}
			cooldownUntil={decide.cooldownUntil}
			presenceRequired={decide.presenceRequired}
			onDecide={(items) => void decide.run(items)}
			onRetry={() => void requests.refetch()}
			onDismissFlow={decide.reset}
			onOpenCard={openCard}
			traces={traces}
			onDismissTrace={dismissForeignPromptTrace}
			decided={decidedSnapshot}
			history={{ state: historyState, rows: decisions.data ?? [] }}
		/>
	);
}

// -- the Touch ID prompt notice -----------------------------------------------

function NoticeItemLine({
	item,
	sender,
}: {
	item: AuthorizeNoticeItem;
	sender: string | null;
}) {
	if (item.word === null)
		return <>{t("ui.teamBridge.approvals.notice.item_unrecognised")}</>;
	if (sender === null)
		return (
			<>
				{item.word === "approve"
					? t("ui.teamBridge.approvals.notice.item_approve_unlisted")
					: t("ui.teamBridge.approvals.notice.item_deny_unlisted")}
			</>
		);
	return (
		<>
			{item.word === "approve"
				? t("ui.teamBridge.approvals.notice.item_approve", { sender })
				: t("ui.teamBridge.approvals.notice.item_deny", { sender })}
		</>
	);
}

/**
 * What a Touch ID prompt is about to confirm, shown while the daemon says it
 * is `prompting`. The OS sheet itself cannot say what it is for, so this is
 * how the person sees it - and a prompt this window did not start carries the
 * "Not started in this window" label (security S-6). Rendered app-wide, not
 * only on the Team Bridge page, because a foreign prompt can appear while the
 * person is anywhere.
 *
 * THE FOREIGN VARIANT LEADS WITH THE WARNING (design D2). Every legitimate
 * batch shows the own variant, so people learn its shape; a foreign prompt in
 * the same shape with a second-line label is the habituation pattern that
 * defeats security warnings. It opens on a warning-wash strip with the shield,
 * the count moves to line two, and it is an `alert` so a screen reader speaks
 * it before the person answers the sheet (D6). Still calm: no danger colour.
 *
 * `senderOf` names each item's teammate the way their row in the Requests
 * list does (U5); the frame's own sender is the fallback.
 */
export function TeamBridgeAuthorizeNoticeView({
	notices,
	senderOf = () => null,
}: {
	notices: readonly AuthorizePromptNotice[];
	senderOf?: (messageId: string) => string | null;
}) {
	useI18nLocale();
	if (notices.length === 0) return null;
	return (
		<div
			aria-label={t("ui.teamBridge.approvals.notice.label")}
			className="pointer-events-auto flex max-h-[60vh] w-[min(28rem,calc(100vw-2rem))] flex-col gap-3 overflow-auto rounded-lg bg-elevated p-4 text-ink shadow-overlay"
		>
			{notices.map((notice) => {
				const title = t("ui.teamBridge.approvals.notice.title", {
					count: notice.items.length,
				});
				const list = (
					<ul className="flex flex-col gap-1.5">
						{notice.items.map((item, index) => (
							<li
								key={`${item.message_id}:${index}`}
								className="flex flex-col text-sm"
							>
								<span className="font-medium">
									<NoticeItemLine
										item={item}
										sender={senderOf(item.message_id) ?? item.sender}
									/>
								</span>
								{item.excerpt && (
									<span className="line-clamp-2 text-ink-muted">
										{item.excerpt}
									</span>
								)}
							</li>
						))}
					</ul>
				);
				if (!notice.foreign)
					return (
						<output key={notice.authorizeId} className="flex flex-col gap-2">
							<p className="flex items-center gap-2 text-sm font-medium">
								<Fingerprint
									size={16}
									aria-hidden="true"
									className="shrink-0 text-ink-dim"
								/>
								{title}
							</p>
							{list}
						</output>
					);
				return (
					<div
						key={notice.authorizeId}
						role="alert"
						className="flex flex-col gap-2"
					>
						<p className="-mx-1 flex items-center gap-2 rounded-md bg-warning-wash px-2 py-1.5 text-sm font-medium text-warning">
							<ShieldAlert size={16} aria-hidden="true" className="shrink-0" />
							{t("ui.teamBridge.approvals.notice.foreign")}
						</p>
						<p className="text-sm font-medium">{title}</p>
						<p className="text-sm text-ink-muted">
							{t("ui.teamBridge.approvals.notice.foreign_help")}
						</p>
						{list}
					</div>
				);
			})}
		</div>
	);
}

/**
 * The teammate names the Requests list shows, read from the cached requests
 * page rather than fetched: the notice must not trigger a read of its own, and
 * a prompt for a request not in the list keeps the frame's sender.
 */
function useCachedSenders(): (messageId: string) => string | null {
	const client = useQueryClient();
	return useCallback(
		(messageId: string) => {
			const pages = client.getQueriesData<ApprovalRequestsPage>({
				queryKey: [...teamBridgeKeys.all, "approvals", "requests"],
			});
			for (const [, page] of pages) {
				const row = page?.items.find((item) => item.message_id === messageId);
				if (row) return senderLabel(row.sender);
			}
			return null;
		},
		[client],
	);
}

/**
 * App-wide host for the prompt notice; renders nothing while none is up.
 *
 * PORTALLED TO <body>, ABOVE THE MODAL LAYER (security S-3). Radix dialogs and
 * sheets portal to the end of <body> with a `z-50` scrim, so a host inside the
 * app root at `z-50` painted UNDER any open dialog - and Radix's modal mode
 * marks everything outside the dialog `aria-hidden`. Here the host is its own
 * <body> child at `z-[60]`, and it carries `aria-live`, which the `aria-hidden`
 * sweep Radix uses deliberately leaves alone (aria-hidden issue #10), so the
 * notice stays both visible and announced over a dialog.
 */
export function TeamBridgeAuthorizeNotices() {
	// App-wide like this host, so the decided excerpts go with the account
	// whichever page is open when it changes (review R2-02).
	useDecidedStoreOwner();
	const notices = useAuthorizeNotices();
	const senderOf = useCachedSenders();
	if (notices.length === 0 || typeof document === "undefined") return null;
	return createPortal(
		<div
			aria-live="polite"
			className="pointer-events-none fixed inset-x-0 top-10 z-[60] flex justify-center"
		>
			<TeamBridgeAuthorizeNoticeView notices={notices} senderOf={senderOf} />
		</div>,
		document.body,
	);
}
