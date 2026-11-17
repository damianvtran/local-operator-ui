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
import { Fingerprint, ShieldAlert } from "lucide-react";
import { useCallback, useId, useMemo, useState } from "react";
import {
	type ApprovalDecideResult,
	type ApprovalDecisionRow,
	type ApprovalRequestRow,
	type ApprovalSelectionItem,
	type ApprovalWord,
	type AuthorizePromptNotice,
	TEAM_BRIDGE_APPROVAL_BATCH_MAX,
	allowedWords,
	buildSelection,
	notDecidableReason,
	resultLine,
	selectAllDecidable,
	selectableRows,
	senderLabel,
	toggleSelected,
} from "./team-bridge-approvals-model";
import {
	type ApprovalFlowState,
	useApprovalDecide,
	useApprovalDecisions,
	useApprovalRequests,
	useAuthorizeNotices,
} from "./use-team-bridge-approvals";

type ListState = "loading" | "error" | "ready";

function stamp(value: string | null): string | null {
	if (!value) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return formatDateTime(date, { dateStyle: "medium", timeStyle: "short" });
}

// -- the Requests view --------------------------------------------------------

export function TeamBridgeRequestsView({
	listState,
	rows,
	flow,
	coolingDown = false,
	onDecide,
	onRetry,
	onDismissFlow,
	history,
	initialTab = "waiting",
}: {
	/** Which tab opens first; stories and frames use it to show the history. */
	initialTab?: "waiting" | "history";
	listState: ListState;
	rows: readonly ApprovalRequestRow[];
	flow: ApprovalFlowState;
	coolingDown?: boolean;
	onDecide: (items: ApprovalSelectionItem[]) => void;
	onRetry?: () => void;
	onDismissFlow?: () => void;
	history: { state: ListState; rows: readonly ApprovalDecisionRow[] };
}) {
	useI18nLocale();
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	const [capped, setCapped] = useState(false);
	const [excluded, setExcluded] = useState(0);
	const selectAllId = useId();
	const inFlight = flow.phase === "authorizing" || flow.phase === "deciding";
	/*
	 * After a refusal that says batch deciding is unavailable on this host, the
	 * batch controls go away and the person is pointed at the cards; offering
	 * a button that is certain to be refused again is not calm.
	 */
	const batchUnavailable =
		flow.phase === "refused" && flow.refusal.kind === "presence_required";
	const blocked = inFlight || coolingDown || batchUnavailable;
	// Drop selections whose row is gone or no longer decidable after a refresh.
	const live = useMemo(() => {
		const ids = new Set(selectableRows(rows).map((row) => row.message_id));
		return new Set([...selected].filter((id) => ids.has(id)));
	}, [rows, selected]);
	const decidable = selectableRows(rows);
	const allSelected =
		decidable.length > 0 &&
		live.size === Math.min(decidable.length, TEAM_BRIDGE_APPROVAL_BATCH_MAX);

	const decideSelected = (word: ApprovalWord) => {
		const { items, excluded: left } = buildSelection(rows, live, word);
		setExcluded(left.length);
		if (items.length > 0) {
			onDecide(items);
			// Rows left out stay selected, so the person can send their one
			// allowed word next without hunting for them again.
			setSelected(new Set(left.map((row) => row.message_id)));
			setCapped(false);
		}
	};
	const decideOne = (row: ApprovalRequestRow, word: ApprovalWord) => {
		setExcluded(0);
		onDecide([{ message_id: row.message_id, decision: word }]);
	};
	const resultsById = new Map(
		flow.phase === "done"
			? flow.results.map((result) => [result.message_id, result])
			: [],
	);

	return (
		<section
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
					<FlowStatus flow={flow} onDismiss={onDismissFlow} />
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
								<div className="flex min-h-8 flex-wrap items-center gap-2">
									<label
										htmlFor={selectAllId}
										className="flex items-center gap-2 text-sm text-ink-muted"
									>
										<Checkbox
											id={selectAllId}
											checked={allSelected}
											disabled={blocked}
											onCheckedChange={(checked) => {
												if (checked) {
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
												disabled={blocked}
												onClick={() => decideSelected("approve")}
											>
												{t("ui.teamBridge.approvals.approve_selected")}
											</Button>
											<Button
												size="sm"
												variant="secondary"
												disabled={blocked}
												onClick={() => decideSelected("deny")}
											>
												{t("ui.teamBridge.approvals.deny_selected")}
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
										result={resultsById.get(row.message_id)}
										onToggle={() => {
											const toggled = toggleSelected(live, row.message_id);
											setSelected(toggled.next);
											setCapped(toggled.capped);
										}}
										onDecide={(word) => decideOne(row, word)}
									/>
								))}
							</ul>
						</>
					)}
				</TabsContent>
				<TabsContent value="history">
					<DecisionHistory state={history.state} rows={history.rows} />
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
	result,
	onToggle,
	onDecide,
}: {
	row: ApprovalRequestRow;
	checked: boolean;
	blocked: boolean;
	showBatch: boolean;
	result?: ApprovalDecideResult;
	onToggle: () => void;
	onDecide: (word: ApprovalWord) => void;
}) {
	const sender = senderLabel(row.sender);
	const reason = notDecidableReason(row);
	const words = allowedWords(row);
	const locked = row.unsent_decision !== null && row.decidable;
	const received = stamp(row.created_at);
	const line = result ? resultLine(result) : null;
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
				<p className="flex min-w-0 items-baseline gap-2 text-sm">
					<span className="truncate font-medium">{sender}</span>
					{received && (
						<span className="shrink-0 text-meta text-ink-dim">
							{t("ui.teamBridge.approvals.received", { time: received })}
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
				{locked && (
					<p className="text-meta text-ink-dim">
						{t("ui.teamBridge.approvals.locked_note")}
					</p>
				)}
				{line ? (
					<p
						aria-live="polite"
						className={cn(
							"text-sm",
							line.tone === "done" ? "text-ink-muted" : "text-ink",
						)}
					>
						{line.label}
					</p>
				) : (
					words.length > 0 && (
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
						</div>
					)
				)}
			</div>
		</li>
	);
}

function FlowStatus({
	flow,
	onDismiss,
}: {
	flow: ApprovalFlowState;
	onDismiss?: () => void;
}) {
	if (flow.phase === "idle" || flow.phase === "done") {
		if (flow.phase === "done" && onDismiss)
			return (
				<div className="flex items-center gap-2" aria-live="polite">
					<p className="text-sm text-ink-muted">
						{t("ui.teamBridge.approvals.results_title")}
					</p>
					<Button size="sm" variant="ghost" onClick={onDismiss}>
						{t("ui.common.actions.dismiss")}
					</Button>
				</div>
			);
		return null;
	}
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
	return (
		<output className="flex flex-wrap items-start gap-2 rounded-lg bg-elevated p-3">
			<p className="min-w-0 flex-1 text-sm text-ink">{flow.refusal.message}</p>
			{onDismiss && (
				<Button size="sm" variant="ghost" onClick={onDismiss}>
					{t("ui.common.actions.dismiss")}
				</Button>
			)}
		</output>
	);
}

function DecisionHistory({
	state,
	rows,
}: {
	state: ListState;
	rows: readonly ApprovalDecisionRow[];
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
						</p>
						<p className="text-meta text-ink-dim">
							{t("ui.teamBridge.approvals.history.decided_by", {
								name: senderLabel(row.decided_by),
							})}
							{when ? ` · ${when}` : ""}
						</p>
					</li>
				);
			})}
		</ul>
	);
}

/** The Requests panel, wired: one requests read, the ledger, the decide flow. */
export function TeamBridgeRequests() {
	const requests = useApprovalRequests(true);
	const decisions = useApprovalDecisions(true);
	const rows = requests.data?.items ?? [];
	const names = useCallback(
		(messageId: string) => {
			const row = rows.find((candidate) => candidate.message_id === messageId);
			return row ? senderLabel(row.sender) : null;
		},
		[rows],
	);
	const decide = useApprovalDecide(names);
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
			onDecide={(items) => void decide.run(items)}
			onRetry={() => void requests.refetch()}
			onDismissFlow={decide.reset}
			history={{ state: historyState, rows: decisions.data ?? [] }}
		/>
	);
}

// -- the Touch ID prompt notice -----------------------------------------------

/**
 * What a Touch ID prompt is about to confirm, shown while the daemon says it
 * is `prompting`. The OS sheet itself cannot say what it is for, so this is
 * how the person sees it - and a prompt this window did not start carries the
 * "Not started by you" label (security S-6). Rendered app-wide, not only on the
 * Team Bridge page, because a foreign prompt can appear while the person is
 * anywhere.
 */
export function TeamBridgeAuthorizeNoticeView({
	notices,
}: {
	notices: readonly AuthorizePromptNotice[];
}) {
	useI18nLocale();
	if (notices.length === 0) return null;
	return (
		<output
			aria-label={t("ui.teamBridge.approvals.notice.label")}
			className="pointer-events-auto flex max-h-[60vh] w-[min(28rem,calc(100vw-2rem))] flex-col gap-3 overflow-auto rounded-lg bg-elevated p-4 text-ink shadow-overlay"
		>
			{notices.map((notice) => (
				<div key={notice.authorizeId} className="flex flex-col gap-2">
					<p className="flex items-center gap-2 text-sm font-medium">
						{notice.foreign ? (
							<ShieldAlert
								size={16}
								aria-hidden="true"
								className="shrink-0 text-warning"
							/>
						) : (
							<Fingerprint
								size={16}
								aria-hidden="true"
								className="shrink-0 text-ink-dim"
							/>
						)}
						{t("ui.teamBridge.approvals.notice.title", {
							count: notice.items.length,
						})}
					</p>
					{notice.foreign && (
						<div className="flex flex-col gap-1">
							<p className="text-sm font-medium text-warning">
								{t("ui.teamBridge.approvals.notice.foreign")}
							</p>
							<p className="text-sm text-ink-muted">
								{t("ui.teamBridge.approvals.notice.foreign_help")}
							</p>
						</div>
					)}
					<ul className="flex flex-col gap-1.5">
						{notice.items.map((item) => {
							const who =
								item.sender ?? t("ui.teamBridge.approvals.notice.unknown_item");
							return (
								<li key={item.message_id} className="flex flex-col text-sm">
									<span className="font-medium">
										{item.word === "approve"
											? t("ui.teamBridge.approvals.notice.item_approve", {
													sender: who,
												})
											: t("ui.teamBridge.approvals.notice.item_deny", {
													sender: who,
												})}
									</span>
									{item.excerpt && (
										<span className="line-clamp-2 text-ink-muted">
											{item.excerpt}
										</span>
									)}
								</li>
							);
						})}
					</ul>
				</div>
			))}
		</output>
	);
}

/** App-wide host for the prompt notice; renders nothing while none is up. */
export function TeamBridgeAuthorizeNotices() {
	const notices = useAuthorizeNotices();
	if (notices.length === 0) return null;
	return (
		<div className="pointer-events-none fixed inset-x-0 top-10 z-50 flex justify-center">
			<TeamBridgeAuthorizeNoticeView notices={notices} />
		</div>
	);
}
