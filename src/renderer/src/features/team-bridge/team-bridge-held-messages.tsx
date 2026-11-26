/**
 * Team Bridge "Held messages": the section of Approvals that lists what this
 * device's screening held for its owner, with the owner's Deliver / Discard.
 *
 * Two halves, as in `team-bridge-approvals.tsx`: `HeldMessagesView` renders
 * props only (what the stories and frames drive) and `TeamBridgeHeldMessages`
 * wires the hooks. The rules - which buttons a hold offers, which reason it
 * reads as, what counts toward the badge, when a body counts as seen - are in
 * `team-bridge-holds-model.ts`.
 *
 * WHAT IS RENDERED OF A HELD MESSAGE: only what the owner-audit transcript
 * already shows the owner for the same message (sender, time, the body, its
 * attachments). The hold list itself is metadata only and adds nothing to it.
 *
 * Deliver binds the hash of the entire visible body; the row never clamps or
 * hides it. The daemon still owns allowed words, the signed disposition and
 * whether that disposition applied. Discard alone may use a no-body receipt.
 */
import { Spinner } from "@shared/components/common/spinner";
import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { observedRadientAuthority } from "@shared/hooks/radient-account-authority";
import { formatDateTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useQueryClient } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { TeamBridgeDirectoryMember } from "../../../../shared/team-bridge-contract";
import type { OwnerAuditMessage } from "../../../../shared/team-bridge-owner-audit-contract";
import { toBridgeFileDescriptor } from "./attachments/attachment-model";
import {
	AuditAttachmentGroup,
	type AuditReviewState,
} from "./attachments/audit-attachment-group";
import { auditAttachmentAction } from "./attachments/audit-attachment-scope";
import type { DiscardBatchResult } from "./team-bridge-discard-batch";
import { type BatchPreview, HeldMessagesBatch } from "./team-bridge-held-batch";
import {
	heldHidePreference,
	publishHoldInboxProjection,
	useHeldHideRecoveryPending,
	useHeldHideRevisions,
} from "./team-bridge-held-hide-preference";
import { holdsKey } from "./team-bridge-holds-keys";
import {
	type HoldDecisionView,
	type HoldItem,
	type HoldProof,
	type HoldWord,
	type HoldsPage,
	canHideHoldLocally,
	holdAttachmentCounts,
	holdDecideProof,
	holdDecisionStatus,
	holdInboxRevision,
	holdReason,
	holdReasonLabel,
	holdReference,
	holdRowProofs,
	projectHeldMessages,
	sortHoldInbox,
} from "./team-bridge-holds-model";
import {
	type DiscardSnapshotEntry,
	captureDiscardSnapshot,
} from "./team-bridge-holds-model";
import {
	TeamBridgeMarkdown,
	needsLiteralHoldBody,
} from "./team-bridge-markdown";
import { memberStoredName } from "./team-bridge-model";
import { useTeamBridgeAccount } from "./team-bridge-owner";
import { TeamBridgeAvatar } from "./team-bridge-profile-card";
import { useTeamBridgeDirectory } from "./use-team-bridge";
import {
	type HeldMessageDetail,
	useHeldMessageDetails,
	useHeldMessages,
	useHoldDecide,
	useRetryHeldDetails,
} from "./use-team-bridge-holds";

type ListState = "loading" | "error" | "ready";
type Busy = { id: string; word: HoldWord } | null;
type HoldTab = "waiting" | "history";
export type HeldInbox = {
	waiting: ReactNode;
	history: ReactNode;
	count: number;
	hasHistory: boolean;
	waitingState: ListState;
};
type LocalHideControls = {
	hiddenItems: readonly HoldItem[];
	recoveryPending?: boolean;
	onChange: (item: HoldItem, hide: boolean) => boolean;
};

function stamp(value: string | null): string | null {
	if (!value) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return formatDateTime(date, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * "From Ana" for a person; "From Scout, Ana's agent" when the teammate's agent
 * wrote it (owner-audit `origin: "agent"` with its `agent_label`), so the owner
 * always sees both the human teammate and the agent acting for them. An agent
 * message with no label still says it came from an agent (UX N2): it must
 * never read as the person's own words.
 */
export function heldSenderLine(message: OwnerAuditMessage | null): string {
	if (!message) return t("ui.teamBridge.holds.unknown_sender");
	const person =
		memberStoredName({
			kind: message.sender.kind === "agent" ? "agent" : "human",
			display_label: message.sender.display_label,
		}) ?? t("ui.teamBridge.holds.unknown_sender");
	if (message.origin === "agent") {
		const agent = message.agent_label?.trim();
		return agent
			? t("ui.teamBridge.holds.from_agent", { agent, person })
			: t("ui.teamBridge.holds.from_agent_unnamed", { person });
	}
	return t("ui.teamBridge.holds.from_person", { person });
}

export function HeldMessagesView({
	listState,
	items,
	enabled = true,
	keyProtection = null,
	detail,
	busy = null,
	refusals = {},
	onDecide,
	onRetry,
	onRetryDetails,
	accountId = null,
	authorityEpoch = 0,
	hideWhenEmpty = false,
	now,
	tab = "waiting",
	recorded,
	onBatchDecide,
	initialBatch,
	localHide,
}: {
	listState: ListState;
	items: readonly HoldItem[];
	/** The daemon's `enabled`: false means no release path is on here. */
	enabled?: boolean;
	/** The daemon's `key_protection` (D3 disclosure); `file_only` is said. */
	keyProtection?: string | null;
	detail: (item: HoldItem) => HeldMessageDetail;
	/** The hold whose Deliver/Discard is in flight, and which word. */
	busy?: Busy;
	refusals?: Readonly<Record<string, string>>;
	onDecide: (item: HoldItem, word: HoldWord, proof: HoldProof) => void;
	onRetry?: () => void;
	onRetryDetails?: () => void;
	/** For the attachment group's owner-audit scope. */
	accountId?: string | null;
	authorityEpoch?: number;
	/** Inside Approvals with no requests either: one empty state, not two (D1). */
	hideWhenEmpty?: boolean;
	/** Fixed clock for stories and frames. */
	now?: number;
	/** History retains receipts and local recovery, never decision buttons. */
	tab?: HoldTab;
	/** Only an actual signed POST receipt (reconciled with the list) is feedback. */
	recorded?: readonly HoldItem[];
	onBatchDecide?: (
		entries: readonly DiscardSnapshotEntry[],
		onResult: (result: DiscardBatchResult) => void,
	) => Promise<void>;
	initialBatch?: BatchPreview;
	localHide?: LocalHideControls;
}) {
	useI18nLocale();
	const [batchBlocking, setBatchBlocking] = useState(Boolean(initialBatch));
	const [batchStarted, setBatchStarted] = useState(Boolean(initialBatch));
	const hiddenItems = localHide?.hiddenItems ?? [];
	const [hideFailed, setHideFailed] = useState(false);
	const [pressed, setPressed] = useState<string | null>(null);
	const recordedDecision = recorded?.find(
		(row) => row.message_id === pressed,
	)?.decision;
	const receiptLabel = recordedDecision ? decisionCopy(recordedDecision) : null;
	const receiptRef = useRef<HTMLOutputElement>(null);
	const titleRef = useRef<HTMLHeadingElement>(null);
	const hiddenTitleRef = useRef<HTMLHeadingElement>(null);
	const moveFocus = useRef<"hidden" | "queue" | "decision" | null>(null);
	const origin = useRef<{
		control: Element | null;
		tabId: string | null;
	} | null>(null);
	const captureFocus = () => {
		origin.current = {
			control: document.activeElement,
			tabId:
				titleRef.current
					?.closest('[role="tabpanel"]')
					?.getAttribute("aria-labelledby") ?? null,
		};
	};
	useEffect(() => {
		if (!moveFocus.current) return;
		if (
			moveFocus.current === "decision" &&
			!receiptLabel &&
			!refusals[pressed ?? ""]
		)
			return;
		const from = origin.current;
		const active = document.activeElement;
		// Do not steal focus if the reader moved to another row/tab while the
		// signature was in flight. An emptied Waiting pane returns to its tab.
		if (active === document.body || active === from?.control) {
			const destination =
				moveFocus.current === "hidden"
					? hiddenTitleRef.current
					: moveFocus.current === "decision"
						? receiptRef.current
						: null;
			(
				destination ??
				titleRef.current ??
				(from?.tabId ? document.getElementById(from.tabId) : null)
			)?.focus({ preventScroll: true });
		}
		moveFocus.current = null;
	});
	const changeVisibility = (item: HoldItem, hide: boolean) => {
		// Both actions remove their own button. Move focus only for a user-initiated
		// change, not when a background read recovers the details.
		captureFocus();
		moveFocus.current = hide ? "hidden" : "queue";
		const changed = localHide?.onChange(item, hide) ?? false;
		if (!changed) moveFocus.current = null;
		setHideFailed(!changed);
	};
	// Keep result accounting mounted after the last held row disappears, but
	// preserve Approvals' single empty state when no batch has been started.
	if (
		hideWhenEmpty &&
		!batchBlocking &&
		!batchStarted &&
		!receiptLabel &&
		!localHide?.recoveryPending &&
		listState === "ready" &&
		items.length === 0 &&
		hiddenItems.length === 0
	)
		return null;
	const historical = tab === "history";
	const ordered = sortHoldInbox(items, tab);
	return (
		<section
			className="flex flex-col gap-3"
			aria-label={t("ui.teamBridge.holds.title")}
		>
			<h3
				ref={titleRef}
				tabIndex={-1}
				className="text-base font-medium text-ink"
			>
				{t("ui.teamBridge.holds.title")}
			</h3>
			{!historical && (!receiptLabel || items.length > 0) && (
				<p className="max-w-prose text-sm text-ink-muted">
					{t("ui.teamBridge.holds.intro")}
				</p>
			)}
			{!historical && keyProtection === "file_only" && items.length > 0 && (
				/* Security S-3: core's D3 disclosure. A file-only key can be read
				   by any process running as this user, which could then record a
				   decision too; this section is now the only card that says so. */
				<p className="max-w-prose text-meta text-ink-dim">
					{t("ui.teamBridge.holds.key_file_only")}
				</p>
			)}
			{!historical && !enabled && items.length > 0 && (
				<p className="text-sm text-ink-muted">
					{t("ui.teamBridge.holds.release_off")}
				</p>
			)}
			{/* Keep key/policy disclosures before every decision control, including
			    a long batch confirmation that could push them offscreen. */}
			{onBatchDecide && (
				<HeldMessagesBatch
					candidates={
						listState === "ready" && enabled
							? captureDiscardSnapshot(items, detail, now)
							: []
					}
					disabled={busy !== null || !enabled || listState !== "ready"}
					onDecide={async (entries, onResult) => {
						setBatchStarted(true);
						await onBatchDecide(entries, onResult);
					}}
					onBlockingChange={setBatchBlocking}
					initialPreview={initialBatch}
				/>
			)}
			{onBatchDecide && listState === "error" && items.length > 0 && (
				// A failed refresh must leave a way to recover a disabled batch,
				// even when cached rows already exist and hide the list error state.
				<div role="alert" className="flex flex-wrap items-baseline gap-2">
					<p className="text-sm text-ink-muted">
						{t("ui.teamBridge.list.error_stale")}
					</p>
					{onRetry && (
						<Button size="sm" variant="link" onClick={onRetry}>
							{t("ui.teamBridge.list.retry")}
						</Button>
					)}
				</div>
			)}
			{receiptLabel && (
				<output
					ref={receiptRef}
					tabIndex={-1}
					className="text-sm text-ink-muted"
				>
					<DecisionLine copy={receiptLabel} />
				</output>
			)}
			{(hideFailed || localHide?.recoveryPending) && (
				<p role="alert" className="text-sm text-ink-muted">
					{t("ui.teamBridge.holds.hide_failed")}
				</p>
			)}
			{listState === "loading" && items.length === 0 ? (
				<Spinner size="sm" label={t("ui.teamBridge.holds.loading")} />
			) : listState === "error" && items.length === 0 ? (
				<div role="alert" className="flex flex-col items-start gap-2">
					<p className="text-sm text-ink-muted">
						{t("ui.teamBridge.holds.load_failed")}
					</p>
					{onRetry && (
						<Button size="sm" variant="ghost" onClick={onRetry}>
							{t("ui.teamBridge.list.retry")}
						</Button>
					)}
				</div>
			) : items.length === 0 ? (
				!receiptLabel &&
				hiddenItems.length === 0 && (
					<p className="text-sm text-ink-muted">
						{t("ui.teamBridge.holds.empty")}
					</p>
				)
			) : (
				<ul className="flex flex-col divide-y divide-hairline">
					{ordered.map((item) => (
						<HeldRow
							key={item.message_id}
							item={item}
							detail={detail(item)}
							busy={
								busy ??
								(batchBlocking ? { id: "batch", word: "discard" } : null)
							}
							refusal={refusals[item.message_id] ?? null}
							onDecide={
								!historical && enabled && listState === "ready"
									? (item, word, proof) => {
											captureFocus();
											moveFocus.current = "decision";
											setPressed(item.message_id);
											onDecide(item, word, proof);
										}
									: undefined
							}
							onRetryDetails={onRetryDetails}
							onHideLocal={
								localHide && listState === "ready" && item.localHideRevision
									? () => changeVisibility(item, true)
									: undefined
							}
							accountId={accountId}
							authorityEpoch={authorityEpoch}
							historical={historical}
							now={now}
						/>
					))}
				</ul>
			)}
			{hiddenItems.length > 0 && (
				<div className="flex flex-col gap-2 border-t border-hairline pt-3">
					<h4
						ref={hiddenTitleRef}
						tabIndex={-1}
						className="text-sm font-medium text-ink"
					>
						{t("ui.teamBridge.holds.hidden_local", {
							count: hiddenItems.length,
						})}
					</h4>
					<ul className="flex flex-col gap-1">
						{sortHoldInbox(hiddenItems, "history").map((item) => {
							const reference = holdReference(item.message_id);
							return (
								<li
									key={item.localHideRevision}
									className="flex flex-wrap items-center justify-between gap-x-2"
								>
									<span className="text-meta text-ink-muted">
										{t("ui.teamBridge.holds.reference", { reference })}
									</span>
									<Button
										size="sm"
										variant="ghost"
										aria-label={t("ui.teamBridge.holds.restore_local_label", {
											reference,
										})}
										onClick={() => changeVisibility(item, false)}
									>
										{t("ui.teamBridge.holds.restore_local")}
									</Button>
								</li>
							);
						})}
					</ul>
				</div>
			)}
		</section>
	);
}

function decisionCopy(decision: HoldDecisionView) {
	const word =
		decision.word === "deliver" || decision.word === "discard"
			? decision.word
			: null;
	const status = holdDecisionStatus(word, decision.outcome);
	return {
		status,
		decidedAt: decision.decided_at,
		label:
			status === "not_applied"
				? t("ui.teamBridge.holds.state.not_applied")
				: status === "local"
					? t("ui.teamBridge.holdsBatch.local_unconfirmed")
					: status === "applied"
						? t(
								word === "discard"
									? "ui.teamBridge.holds.state.confirmed_discarded"
									: "ui.teamBridge.holds.state.confirmed_delivered",
							)
						: t(
								word === "discard"
									? "ui.teamBridge.holds.state.chose_discard"
									: "ui.teamBridge.holds.state.chose_deliver",
							),
	};
}

function DecisionLine({ copy }: { copy: ReturnType<typeof decisionCopy> }) {
	const time = stamp(copy.decidedAt);
	return (
		<span className="inline-flex flex-wrap items-baseline gap-2">
			{copy.status === "pending" ? (
				<>
					<span>{copy.label}</span>
					<Badge variant="neutral" className="max-w-full whitespace-normal">
						{t("ui.teamBridge.holds.state.confirmation_pending")}
					</Badge>
				</>
			) : (
				<span
					className={
						copy.status === "applied"
							? "font-medium text-ink"
							: "font-medium text-warning"
					}
				>
					{copy.label}
				</span>
			)}
			{time && (
				<time className="text-ink-dim" dateTime={copy.decidedAt ?? undefined}>
					{time}
				</time>
			)}
		</span>
	);
}

/** A conversation plate without a profile/action popover in the decision inbox. */
export function ApprovalSenderAvatar({
	member,
	label,
	agent = false,
	unknown = false,
}: {
	member?: TeamBridgeDirectoryMember;
	label: string;
	agent?: boolean;
	unknown?: boolean;
}) {
	return (
		<TeamBridgeAvatar
			member={member}
			kind={agent ? "agent" : "human"}
			label={label}
			className="mt-0.5"
			fallback={unknown ? <UserRound size={18} /> : undefined}
		/>
	);
}

function HeldSenderAvatar({
	message,
	accountId,
	tenantId,
	label,
	agent,
	unknown,
}: {
	message: OwnerAuditMessage;
	accountId: string;
	tenantId: string;
	label: string;
	agent: boolean;
	unknown: boolean;
}) {
	const directory = useTeamBridgeDirectory(tenantId, true, accountId);
	const member = directory.data?.members.find(
		(candidate) => candidate.account_id === message.sender.account_id,
	);
	return (
		<ApprovalSenderAvatar
			member={member}
			label={label}
			agent={agent}
			unknown={unknown}
		/>
	);
}

function HeldRow({
	item,
	detail,
	busy,
	refusal,
	onDecide,
	onRetryDetails,
	onHideLocal,
	accountId,
	authorityEpoch,
	historical,
	now,
}: {
	item: HoldItem;
	detail: HeldMessageDetail;
	busy: Busy;
	refusal: string | null;
	onDecide?: (item: HoldItem, word: HoldWord, proof: HoldProof) => void;
	onRetryDetails?: () => void;
	onHideLocal?: () => void;
	accountId: string | null;
	authorityEpoch: number;
	historical: boolean;
	now?: number;
}) {
	const message = detail.state === "ready" ? detail.message : null;
	const tenantId = detail.state === "ready" ? detail.tenantId : null;
	const {
		affordance,
		binding,
		hidden,
		unread,
		armed: bodyArmed,
		receipt,
	} = holdRowProofs(item, detail, now);
	const sender = heldSenderLine(message);
	const storedName = message
		? memberStoredName({
				kind: message.sender.kind === "agent" ? "agent" : "human",
				display_label: message.sender.display_label,
			})
		: null;
	const isAgent =
		message?.origin === "agent" || message?.sender.kind === "agent";
	const name = isAgent ? sender : (storedName ?? sender);
	const senderHasProfile =
		message?.sender.kind === "human" || message?.sender.kind === "agent";
	const rowTime = message?.created_at ?? item.held_at;
	const timeLabel = stamp(rowTime);
	const until = stamp(item.deliver_until);
	const { images, files } = holdAttachmentCounts(message);
	const reference = holdReference(item.message_id);
	const canHide = onHideLocal && canHideHoldLocally(item, detail, now);
	const mine = busy?.id === item.message_id;
	const offers =
		affordance.state === "open" || affordance.state === "deliver_expired";
	const attachmentScope =
		message && tenantId && accountId
			? {
					accountId,
					tenantId,
					conversationId: message.conversation_id,
					messageId: message.id,
				}
			: null;
	const attachments = message?.attachments ?? [];
	const canReviewImages =
		Boolean(attachmentScope) &&
		files === 0 &&
		images === attachments.length &&
		new Set(attachments.map(({ id }) => id)).size === images &&
		attachments.every(
			(attachment) => auditAttachmentAction(attachment) === "preview",
		);
	const reviewRevision = JSON.stringify([
		accountId,
		authorityEpoch,
		tenantId,
		holdInboxRevision(item),
		message?.body_hash,
		attachments,
	]);
	const [media, setMedia] = useState<{
		revision: string;
		states: Record<string, AuditReviewState>;
	} | null>(null);
	const registerReview = useCallback(
		(id: string, state: AuditReviewState) => {
			setMedia((old) => {
				const states = old?.revision === reviewRevision ? old.states : {};
				return states[id] === state
					? old
					: { revision: reviewRevision, states: { ...states, [id]: state } };
			});
		},
		[reviewRevision],
	);
	const reviewed =
		images + files === 0 ||
		(canReviewImages &&
			media?.revision === reviewRevision &&
			attachments.every(({ id }) => media.states[id] === "ready"));
	const mediaUnavailable =
		!canReviewImages ||
		(media?.revision === reviewRevision &&
			Object.values(media.states).includes("unavailable"));
	const armed = { ...bodyArmed, deliver: bodyArmed.deliver && reviewed };
	// Keep the two one-click decisions in distinct, stable slots while the
	// same image resolves. Visibility reserves the slot; only readiness arms it.
	const showDeliver = bodyArmed.deliver && (reviewed || canReviewImages);
	const previewUnavailable = bodyArmed.deliver && !reviewed && mediaUnavailable;
	const previewStatusId = useId();
	const proofBody = onDecide && bodyArmed.deliver ? message?.body : null;
	const literal = useMemo(
		() => Boolean(proofBody && needsLiteralHoldBody(proofBody)),
		[proofBody],
	);
	const decision = item.decision ? decisionCopy(item.decision) : null;
	const press = (word: HoldWord) => {
		// This handler, the rendered body, and the selected item come from the
		// same committed render; core compares this exact proof to the current
		// record before signing. A refresh never substitutes another proof here.
		const proof = holdDecideProof(word, { armed, binding, receipt });
		if (proof && !busy) onDecide?.(item, word, proof);
	};

	return (
		<li
			className="flex min-w-0 gap-3 py-4 text-ink"
			data-hold-id={item.message_id}
		>
			{senderHasProfile && message && accountId && tenantId ? (
				<HeldSenderAvatar
					message={message}
					accountId={accountId}
					tenantId={tenantId}
					label={name}
					agent={isAgent}
					unknown={!storedName}
				/>
			) : (
				<ApprovalSenderAvatar
					label={name}
					agent={isAgent}
					unknown={!storedName}
				/>
			)}
			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
					{detail.state === "loading" ? (
						<Spinner size="sm" label={t("ui.teamBridge.holds.loading")} />
					) : (
						<span className="min-w-0 break-words font-medium" dir="auto">
							{name}
						</span>
					)}
					{timeLabel && (
						<time
							className="text-meta text-ink-dim"
							dateTime={rowTime ?? undefined}
						>
							{timeLabel}
						</time>
					)}
					{item.unscreened === true && (
						<Badge variant="warning">
							{t("ui.teamBridge.holds.unscreened")}
						</Badge>
					)}
				</div>
				{typeof message?.body === "string" && message.body.trim() !== "" && (
					<div dir="auto" className="min-w-0">
						<TeamBridgeMarkdown
							showDestinations={Boolean(proofBody)}
							className="team-bridge-message-body text-[14px]"
						>
							{message.body}
						</TeamBridgeMarkdown>
						{/* Link targets, Markdown definitions and raw HTML can be
						    absent from formatted prose. Keep the complete proof
						    visible and inert before the Deliver control. */}
						{literal && (
							<div className="mt-2 border-s border-hairline ps-3">
								<p className="text-meta text-ink-muted">
									{t("ui.chat.canonical.raw_information")}
								</p>
								<pre className="whitespace-pre-wrap break-anywhere text-mono-sm text-ink-muted">
									{message.body}
								</pre>
							</div>
						)}
					</div>
				)}
				{images + files > 0 && message && (
					<AuditAttachmentGroup
						key={reviewRevision}
						scope={attachmentScope}
						attachments={attachments}
						review={
							onDecide && bodyArmed.deliver && canReviewImages
								? { revision: reviewRevision, onState: registerReview }
								: undefined
						}
						count={images}
						files={(message.files ?? []).map(toBridgeFileDescriptor)}
						fileCount={files}
					/>
				)}
				<div className="flex flex-col gap-1 text-meta text-ink-muted">
					{decision ? (
						<DecisionLine copy={decision} />
					) : (
						!historical && !unread && <p>{holdReasonLabel(holdReason(item))}</p>
					)}
					{onDecide && showDeliver && until && (
						<p>{t("ui.teamBridge.holds.deliver_until", { time: until })}</p>
					)}
					{!decision &&
						(affordance.state === "not_releasable" ||
							(historical &&
								detail.state === "ready" &&
								binding?.state !== "mismatch")) &&
						!canHide && <p>{t("ui.teamBridge.holds.state.not_releasable")}</p>}
					{onDecide &&
						affordance.state === "deliver_expired" &&
						!unread &&
						armed.discard && (
							<p>{t("ui.teamBridge.holds.state.deliver_expired")}</p>
						)}
					{unread && (
						<p>
							{affordance.state === "open" && affordance.deliver
								? t("ui.teamBridge.holds.body_withheld")
								: t("ui.teamBridge.holds.receipt_only")}
						</p>
					)}
					{!message && detail.state !== "loading" && (
						<p>{t("ui.teamBridge.holds.reference", { reference })}</p>
					)}
					{!item.decision && detail.state === "unavailable" && (
						<div className="flex flex-wrap items-baseline gap-x-2">
							{!unread && (
								<p>
									{t(
										canHide
											? "ui.teamBridge.holds.details_unavailable_hide"
											: "ui.teamBridge.holds.details_unavailable",
									)}
								</p>
							)}
							{onRetryDetails && item.conversation_id && (
								<Button size="sm" variant="link" onClick={onRetryDetails}>
									{t("ui.teamBridge.list.retry")}
								</Button>
							)}
						</div>
					)}
					{offers && binding?.state === "mismatch" && (
						<p>{t("ui.teamBridge.holds.cannot_verify")}</p>
					)}
					{offers && !unread && binding?.state === "none" && (
						<p>
							{t(
								canHide
									? "ui.teamBridge.holds.details_unavailable_hide"
									: "ui.teamBridge.holds.details_unavailable",
							)}
						</p>
					)}
					{offers &&
						affordance.deliver &&
						armed.discard &&
						binding?.state === "withheld" && (
							<p>{t("ui.teamBridge.holds.body_withheld")}</p>
						)}
					{offers && affordance.deliver && hidden && armed.discard && (
						<p>{t("ui.teamBridge.holds.hidden_characters")}</p>
					)}
					{refusal && <p role="alert">{refusal}</p>}
					{mine && (
						<output>
							{t(
								busy.word === "deliver"
									? "ui.teamBridge.holds.delivering"
									: "ui.teamBridge.holds.discarding",
							)}
						</output>
					)}
				</div>
				{((onDecide && (showDeliver || armed.discard)) || canHide) && (
					<div className="flex flex-wrap gap-2">
						{onDecide && showDeliver && (
							<Button
								size="sm"
								variant="primary"
								disabled={!armed.deliver || busy !== null}
								aria-busy={!reviewed && !mediaUnavailable ? true : undefined}
								aria-describedby={
									previewUnavailable ? previewStatusId : undefined
								}
								aria-label={t("ui.teamBridge.holds.deliver_label", { sender })}
								onClick={() => press("deliver")}
							>
								{t("ui.teamBridge.holds.deliver")}
							</Button>
						)}
						{onDecide && armed.discard && (
							<Button
								size="sm"
								variant="secondary"
								disabled={busy !== null}
								onClick={() => press("discard")}
								aria-label={
									unread
										? t("ui.teamBridge.holds.discard_unread_label", {
												reference,
											})
										: t("ui.teamBridge.holds.discard_label", { sender })
								}
							>
								{t("ui.teamBridge.holds.discard")}
							</Button>
						)}
						{canHide && (
							<Button
								size="sm"
								variant="ghost"
								disabled={busy !== null}
								onClick={onHideLocal}
								aria-label={t("ui.teamBridge.holds.hide_local_label", {
									reference,
								})}
							>
								{t("ui.teamBridge.holds.hide_local")}
							</Button>
						)}
					</div>
				)}
				{/* Failure copy below the controls cannot move either click target. */}
				{onDecide && previewUnavailable && (
					<p id={previewStatusId} className="text-meta text-ink-muted">
						{t("ui.teamBridge.attachmentCard.metadata_only")}
					</p>
				)}
			</div>
		</li>
	);
}

/** The section, wired: the hold list, the owner-audit join, the decide. */
export function TeamBridgeHeldMessages({
	hideWhenEmpty = false,
	supported = true,
	children,
}: {
	hideWhenEmpty?: boolean;
	supported?: boolean;
	children?: (inbox?: HeldInbox) => ReactNode;
}) {
	const holds = useHeldMessages(supported, { panel: true });
	const items = supported ? (holds.data?.items ?? []) : [];
	const archived = supported ? (holds.data?.history ?? []) : [];
	const decide = useHoldDecide();
	// Do not crawl a conversation's newest page for old receipts whose signed
	// record cannot locate the message. A sequence or root makes a join bounded
	// to the right page/thread; active rows retain their existing lookup rules.
	const lookupItems = new Map(items.map((item) => [item.message_id, item]));
	for (const item of [...decide.recorded, ...archived]) {
		if (
			!lookupItems.has(item.message_id) &&
			(item.seq !== null || item.thread_root_id)
		)
			lookupItems.set(item.message_id, item);
	}
	const lookup = useHeldMessageDetails([...lookupItems.values()]);
	const detail = (item: HoldItem): HeldMessageDetail => {
		const target = lookupItems.get(item.message_id);
		return target && target.conversation_id === item.conversation_id
			? lookup(target)
			: { state: "unavailable" };
	};
	const retryDetails = useRetryHeldDetails();
	const { accountId, epoch } = useTeamBridgeAccount();
	const client = useQueryClient();
	const hiddenRevisions = useHeldHideRevisions();
	const recoveryPending = useHeldHideRecoveryPending();
	const { waiting, history, hidden, recovered } = projectHeldMessages(
		items,
		hiddenRevisions,
		detail,
		decide.recorded,
		archived,
	);
	const isCurrentAccount = () => {
		const current = observedRadientAuthority(client);
		return (
			Boolean(accountId) &&
			current.accountId === accountId &&
			current.epoch === epoch
		);
	};
	useLayoutEffect(() => {
		// The original join sees every row, including hidden rows. Leave a row
		// restored once a normal detail read actually shows content again.
		if (!isCurrentAccount()) return;
		if (recovered.length > 0) heldHidePreference.revealRecovered(recovered);
		if (!accountId || !supported || !holds.data || holds.isError) return;
		const historyIds = new Set(history.map((item) => item.message_id));
		publishHoldInboxProjection(client, accountId, epoch, (before) => {
			const excludes = new Set<string>();
			for (const item of items) {
				const revision = holdInboxRevision(item);
				if (
					historyIds.has(item.message_id) ||
					(before.has(revision) && detail(item).state === "loading")
				)
					excludes.add(revision);
			}
			return excludes;
		});
	});
	const listState: ListState = holds.isError
		? "error"
		: holds.isPending
			? "loading"
			: "ready";
	const view = (tab: HoldTab) => (
		<HeldMessagesView
			key={`${accountId ?? "signed-out"}:${epoch}:${tab}`}
			tab={tab}
			listState={listState}
			items={tab === "waiting" ? waiting : history}
			localHide={{
				hiddenItems: tab === "history" ? hidden : [],
				recoveryPending,
				onChange: (item, hide) => {
					const revision = item.localHideRevision;
					if (!revision || !isCurrentAccount()) return false;
					const current = client
						.getQueryData<HoldsPage>(holdsKey(accountId))
						?.items.find((row) => row.localHideRevision === revision);
					if (
						!current ||
						(hide && !canHideHoldLocally(current, detail(current)))
					)
						return false;
					return hide
						? heldHidePreference.hide(revision)
						: heldHidePreference.restore(revision);
				},
			}}
			enabled={holds.data?.enabled ?? true}
			keyProtection={holds.data?.key_protection ?? null}
			detail={detail}
			busy={decide.busy}
			refusals={decide.refusals}
			recorded={tab === "waiting" ? history : undefined}
			onDecide={(item, word, proof) => void decide.run(item, word, proof)}
			onBatchDecide={tab === "waiting" ? decide.runBatch : undefined}
			onRetry={() => void holds.refetch()}
			onRetryDetails={() => void retryDetails()}
			accountId={accountId ?? null}
			authorityEpoch={epoch}
			hideWhenEmpty={tab === "history" || hideWhenEmpty}
		/>
	);
	if (!supported) return children?.() ?? null;
	return children
		? children({
				waiting: view("waiting"),
				history: view("history"),
				count: waiting.length,
				hasHistory: history.length > 0 || hidden.length > 0,
				waitingState: listState,
			})
		: view("waiting");
}
