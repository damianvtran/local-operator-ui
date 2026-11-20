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
 * DELIVER NEEDS THE WHOLE MESSAGE SEEN (security S-1/S-2, UX U3). A long body
 * is clamped and a message with attachments shows neither in full until the
 * owner expands it; Deliver arms only once it has been seen whole, and never
 * for a body the audit withheld. Both decisions take an in-app second step
 * that states the consequence (UX U2) - never an OS or biometric prompt
 * (decision a-856f); whatever presence policy the daemon's key carries is the
 * daemon's. Refusals show fixed copy, never the daemon's sentence.
 */
import { Spinner } from "@shared/components/common/spinner";
import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { formatDateTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useEffect, useRef, useState } from "react";
import type { OwnerAuditMessage } from "../../../../shared/team-bridge-owner-audit-contract";
import { toBridgeFileDescriptor } from "./attachments/attachment-model";
import { AuditAttachmentGroup } from "./attachments/audit-attachment-group";
import {
	type HoldItem,
	type HoldProof,
	type HoldWord,
	armedWords,
	decisionNotApplied,
	hasHiddenCharacters,
	holdAffordance,
	holdDecideProof,
	holdReason,
	holdReasonLabel,
	holdReference,
	needsExpand,
	receiptDiscardArmed,
	sortHolds,
} from "./team-bridge-holds-model";
import { memberStoredName } from "./team-bridge-model";
import { useTeamBridgeAccount } from "./team-bridge-owner";
import {
	type HeldMessageDetail,
	useHeldMessageDetails,
	useHeldMessages,
	useHoldDecide,
	useRetryHeldDetails,
} from "./use-team-bridge-holds";

type ListState = "loading" | "error" | "ready";
type Busy = { id: string; word: HoldWord } | null;

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

function attachmentCount(message: OwnerAuditMessage | null): number {
	if (!message) return 0;
	const images = message.attachments?.length || message.attachment_count || 0;
	const files = Math.max(message.files?.length ?? 0, message.file_count ?? 0);
	return images + files;
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
	hideWhenEmpty = false,
	now,
	initialExpanded,
	initialConfirm,
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
	/** Inside Approvals with no requests either: one empty state, not two (D1). */
	hideWhenEmpty?: boolean;
	/** Fixed clock for stories and frames. */
	now?: number;
	/** Stories: rows opened in full / showing their confirm step. */
	initialExpanded?: readonly string[];
	initialConfirm?: Readonly<Record<string, HoldWord>>;
}) {
	useI18nLocale();
	if (hideWhenEmpty && listState === "ready" && items.length === 0) return null;
	const ordered = sortHolds(items, now);
	return (
		<section
			className="flex flex-col gap-3"
			aria-label={t("ui.teamBridge.holds.title")}
		>
			<h3 className="text-base font-medium text-ink">
				{t("ui.teamBridge.holds.title")}
			</h3>
			<p className="max-w-prose text-sm text-ink-muted">
				{t("ui.teamBridge.holds.intro")}
			</p>
			{keyProtection === "file_only" && items.length > 0 && (
				/* Security S-3: core's D3 disclosure. A file-only key can be read
				   by any process running as this user, which could then record a
				   decision too; this section is now the only card that says so. */
				<p className="max-w-prose text-meta text-ink-dim">
					{t("ui.teamBridge.holds.key_file_only")}
				</p>
			)}
			{!enabled && items.length > 0 && (
				<p className="text-sm text-ink-muted">
					{t("ui.teamBridge.holds.release_off")}
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
				<p className="text-sm text-ink-muted">
					{t("ui.teamBridge.holds.empty")}
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{ordered.map((item) => (
						<HeldRow
							key={item.message_id}
							item={item}
							detail={detail(item)}
							busy={busy}
							refusal={refusals[item.message_id] ?? null}
							onDecide={onDecide}
							onRetryDetails={onRetryDetails}
							accountId={accountId}
							now={now}
							initialExpanded={initialExpanded?.includes(item.message_id)}
							initialConfirm={initialConfirm?.[item.message_id] ?? null}
						/>
					))}
				</ul>
			)}
		</section>
	);
}

function HeldRow({
	item,
	detail,
	busy,
	refusal,
	onDecide,
	onRetryDetails,
	accountId,
	now,
	initialExpanded = false,
	initialConfirm = null,
}: {
	item: HoldItem;
	detail: HeldMessageDetail;
	busy: Busy;
	refusal: string | null;
	onDecide: (item: HoldItem, word: HoldWord, proof: HoldProof) => void;
	onRetryDetails?: () => void;
	accountId: string | null;
	now?: number;
	initialExpanded?: boolean;
	initialConfirm?: HoldWord | null;
}) {
	const [expanded, setExpanded] = useState(initialExpanded);
	/* Latched: once the whole message was on screen it counts as seen, so
	   collapsing it again does not take the Deliver away. */
	const [seen, setSeen] = useState(initialExpanded);
	const statusRef = useRef<HTMLDivElement>(null);
	const message = detail.state === "ready" ? detail.message : null;
	const binding = detail.state === "ready" ? detail.binding : null;
	const sender = heldSenderLine(message);
	const affordance = holdAffordance(item, now);
	const held = stamp(item.held_at);
	const until = stamp(item.deliver_until);
	const attachments = attachmentCount(message);
	const clampable = needsExpand(message?.body, attachments);
	const seenInFull = !clampable || seen;
	const hidden = hasHiddenCharacters(message?.body);
	/* #4358: a hold whose body cannot be shown may still be discarded by its
	   receipt (Discard only; see `receiptDiscardArmed`). */
	/* `unread` implies no hash is on hand (nothing shown, or no usable hash),
	   so the Discard it arms binds the receipt and nothing else. */
	const unread = receiptDiscardArmed(item, affordance, detail.state, binding);
	const bodyArmed = binding
		? armedWords(affordance, binding, seenInFull, hidden)
		: { deliver: false, discard: false };
	const armed = {
		deliver: bodyArmed.deliver,
		discard: bodyArmed.discard || unread,
	};
	const proofFor = (word: HoldWord) =>
		holdDecideProof(word, {
			armed,
			binding,
			receipt: unread ? (item.discard_receipt ?? null) : null,
		});
	const proofKey = (proof: HoldProof | null) =>
		proof ? JSON.stringify(proof) : null;
	/* The confirm step is for ONE word AND the proof it would send, latched
	   when it opened. S-7: a background refresh that disarms the word (body now
	   withheld, affordance changed) closes it. #4358: so does one that changes
	   the proof (a new receipt after a re-screen, a body that now loads), so a
	   confirmation can never be spent on a different record than the one the
	   person confirmed. */
	const [confirm, setConfirm] = useState<{
		word: HoldWord;
		key: string | null;
	} | null>(() =>
		initialConfirm
			? { word: initialConfirm, key: proofKey(proofFor(initialConfirm)) }
			: null,
	);
	const confirming =
		confirm !== null &&
		armed[confirm.word] &&
		confirm.key !== null &&
		proofKey(proofFor(confirm.word)) === confirm.key
			? confirm.word
			: null;
	const reference = holdReference(item.message_id);
	const confirmRef = useRef<HTMLButtonElement>(null);
	const offers =
		affordance.state === "open" || affordance.state === "deliver_expired";
	const mine = busy?.id === item.message_id;
	const disabled = busy !== null;

	/* UX U4: when this row's decision settles, the buttons unmount; move focus
	   to the row's status line rather than dropping it to <body>. */
	const wasMine = useRef(false);
	useEffect(() => {
		if (wasMine.current && !mine) {
			setConfirm(null);
			statusRef.current?.focus({ preventScroll: true });
		}
		wasMine.current = mine;
	}, [mine]);

	useEffect(() => {
		if (confirm !== null && confirming === null) setConfirm(null);
	}, [confirm, confirming]);
	/* U10: the confirm step takes focus when it opens. */
	useEffect(() => {
		if (confirming) confirmRef.current?.focus({ preventScroll: true });
	}, [confirming]);

	const open = (word: HoldWord) =>
		setConfirm({ word, key: proofKey(proofFor(word)) });
	const press = (word: HoldWord) => {
		const proof = proofFor(word);
		// Only the proof that was confirmed; anything else re-asks.
		if (proof && confirm?.key === proofKey(proof)) onDecide(item, word, proof);
	};
	const attachmentScope =
		message && detail.state === "ready" && accountId
			? {
					accountId,
					tenantId: detail.tenantId,
					conversationId: message.conversation_id,
					messageId: message.id,
				}
			: null;

	return (
		/* `elevated` ground, never a border (docs/branding.md), as the request rows. */
		<li className="flex flex-col gap-1 rounded-lg bg-elevated p-3 text-ink">
			<p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
				{detail.state === "loading" ? (
					<Spinner size="sm" label={t("ui.teamBridge.holds.loading")} />
				) : (
					/* D6: no `dir="auto"` here: the line is translated copy around
					   the name ("From {person}"), so it takes the page direction;
					   only the teammate's own words (the body) carry `dir="auto"`. */
					<span className="truncate font-medium">{sender}</span>
				)}
				{item.unscreened === true && (
					<Badge variant="warning">{t("ui.teamBridge.holds.unscreened")}</Badge>
				)}
				{held && (
					<span className="shrink-0 text-meta text-ink-dim">
						{t("ui.teamBridge.holds.held_at", { time: held })}
					</span>
				)}
				{/* D5/Q2/N4/Q4: a deadline only beside a Deliver that can be
				    pressed now (seen in full, nothing hidden). */}
				{armed.deliver && until && (
					<span className="shrink-0 text-meta text-ink-dim">
						{t("ui.teamBridge.holds.deliver_until", { time: until })}
					</span>
				)}
			</p>
			{/* N1: a decided row says what was decided, not why it was held. */}
			{affordance.state !== "decided" && (
				<p className="text-sm text-ink">{holdReasonLabel(holdReason(item))}</p>
			)}
			{typeof message?.body === "string" && message.body !== "" && (
				/* D4: `dir="auto"`: another person's text, direction unknown. */
				<p
					dir="auto"
					className={
						clampable && !expanded
							? "line-clamp-3 whitespace-pre-wrap text-sm text-ink-muted"
							: "whitespace-pre-wrap text-sm text-ink-muted"
					}
				>
					{message.body}
				</p>
			)}
			{expanded && attachments > 0 && message && (
				<AuditAttachmentGroup
					scope={attachmentScope}
					attachments={message.attachments ?? []}
					count={message.attachments?.length || message.attachment_count || 0}
					files={(message.files ?? []).map(toBridgeFileDescriptor)}
					fileCount={Math.max(
						message.files?.length ?? 0,
						message.file_count ?? 0,
					)}
				/>
			)}
			{message && clampable && (
				<div>
					<Button
						size="sm"
						variant="link"
						aria-expanded={expanded}
						onClick={() => {
							setExpanded((open) => !open);
							setSeen(true);
						}}
					>
						{expanded
							? t("ui.teamBridge.holds.show_less")
							: attachments > 0
								? t("ui.teamBridge.holds.show_full_attachments", {
										count: attachments,
									})
								: t("ui.teamBridge.holds.show_full")}
					</Button>
				</div>
			)}
			<div
				ref={statusRef}
				tabIndex={-1}
				className="flex flex-col gap-1 outline-none"
			>
				{affordance.state === "decided" && (
					/* D3/U7: system notes use the meta style, never the body's. */
					<p className="text-meta text-ink-dim">
						{decisionNotApplied(affordance.outcome)
							? t("ui.teamBridge.holds.state.not_applied")
							: affordance.word === "discard"
								? /* Recorded here but not yet applied: say so, never
									   that the sender was told (#4358 brief). */
									affordance.outcome === "pending"
									? t("ui.teamBridge.holds.state.discard_recorded")
									: t("ui.teamBridge.holds.state.chose_discard")
								: t("ui.teamBridge.holds.state.chose_deliver")}
					</p>
				)}
				{affordance.state === "not_releasable" && (
					<p className="text-meta text-ink-dim">
						{t("ui.teamBridge.holds.state.not_releasable")}
					</p>
				)}
				{/* A receipt row says why below; this line's "the sender sees it"
				    is not something an unloadable message can promise. */}
				{affordance.state === "deliver_expired" && !unread && (
					<p className="text-meta text-ink-dim">
						{t("ui.teamBridge.holds.state.deliver_expired")}
					</p>
				)}
				{unread && (
					/* #4358: what the person can still do, and the reference that
					   names this row in the confirm step. */
					<>
						<p className="text-meta text-ink-dim">
							{t("ui.teamBridge.holds.receipt_only")}
						</p>
						<p className="text-meta text-ink-dim">
							{t("ui.teamBridge.holds.reference", { reference })}
						</p>
					</>
				)}
				{offers && detail.state === "unavailable" && !unread && (
					<div className="flex flex-wrap items-baseline gap-x-2">
						<p className="text-meta text-ink-dim">
							{t("ui.teamBridge.holds.details_unavailable")}
						</p>
						{onRetryDetails && item.conversation_id && (
							<Button size="sm" variant="link" onClick={onRetryDetails}>
								{t("ui.teamBridge.list.retry")}
							</Button>
						)}
					</div>
				)}
				{offers && binding?.state === "mismatch" && (
					<p className="text-meta text-ink-dim">
						{t("ui.teamBridge.holds.cannot_verify")}
					</p>
				)}
				{/* C11/Q3: "you can still discard it" only where Discard IS armed
				    (withheld); with no usable hash at all, nothing is. */}
				{offers &&
					affordance.deliver &&
					binding?.state === "withheld" &&
					armed.discard && (
						<p className="text-meta text-ink-dim">
							{t("ui.teamBridge.holds.body_withheld")}
						</p>
					)}
				{offers && binding?.state === "none" && !unread && (
					<p className="text-meta text-ink-dim">
						{t("ui.teamBridge.holds.details_unavailable")}
					</p>
				)}
				{offers && affordance.deliver && hidden && armed.discard && (
					/* S-6: Discard only, and the owner is told why. C16: the line
					   says "you can still discard it", so only where Discard is
					   armed (a mismatched hash arms nothing). */
					<p className="text-meta text-ink-dim">
						{t("ui.teamBridge.holds.hidden_characters")}
					</p>
				)}
				{offers &&
					affordance.deliver &&
					binding?.state === "shown" &&
					!hidden &&
					!seenInFull && (
						<p className="text-meta text-ink-dim">
							{t("ui.teamBridge.holds.read_first")}
						</p>
					)}
				{refusal && (
					<p role="alert" className="text-meta text-ink-dim">
						{refusal}
					</p>
				)}
			</div>
			{confirming ? (
				/* UX U2: the in-app second step. It names the consequence before
				   an irreversible write; no OS or biometric prompt (a-856f).
				   U10: Escape cancels it. */
				<div
					className="flex flex-col gap-2 pt-1"
					onKeyDown={(event) => {
						if (event.key === "Escape" && !mine) {
							event.stopPropagation();
							setConfirm(null);
						}
					}}
				>
					<p className="text-sm text-ink">
						{confirming === "deliver"
							? t("ui.teamBridge.holds.confirm.deliver")
							: /* #4358: a receipt Discard names the ONE message by its
								   reference and says the text was never shown; it
								   promises nothing about the sender, whom an expired
								   hub copy may never reach. */
								unread
								? t("ui.teamBridge.holds.confirm.discard_unread", {
										reference,
									})
								: t("ui.teamBridge.holds.confirm.discard")}
					</p>
					<div className="flex gap-2">
						<Button
							ref={confirmRef}
							size="sm"
							variant={confirming === "deliver" ? "primary" : "secondary"}
							disabled={disabled}
							onClick={() => press(confirming)}
						>
							{mine
								? busy?.word === "deliver"
									? t("ui.teamBridge.holds.delivering")
									: t("ui.teamBridge.holds.discarding")
								: confirming === "deliver"
									? t("ui.teamBridge.holds.confirm.deliver_action")
									: t("ui.teamBridge.holds.confirm.discard_action")}
						</Button>
						<Button
							size="sm"
							variant="ghost"
							disabled={mine}
							onClick={() => setConfirm(null)}
						>
							{t("ui.teamBridge.holds.confirm.cancel")}
						</Button>
					</div>
				</div>
			) : (
				(armed.deliver || armed.discard) && (
					<div className="flex gap-2 pt-1">
						{armed.deliver && (
							/* D2: Deliver mirrors Approve (primary); Discard mirrors Deny
							   (secondary), so both always read as buttons. */
							<Button
								size="sm"
								variant="primary"
								disabled={disabled}
								aria-label={t("ui.teamBridge.holds.deliver_label", { sender })}
								onClick={() => open("deliver")}
							>
								{t("ui.teamBridge.holds.deliver")}
							</Button>
						)}
						{armed.discard && (
							<Button
								size="sm"
								variant="secondary"
								disabled={disabled}
								aria-label={
									unread
										? t("ui.teamBridge.holds.discard_unread_label", {
												reference,
											})
										: t("ui.teamBridge.holds.discard_label", { sender })
								}
								onClick={() => open("discard")}
							>
								{t("ui.teamBridge.holds.discard")}
							</Button>
						)}
					</div>
				)
			)}
		</li>
	);
}

/** The section, wired: the hold list, the owner-audit join, the decide. */
export function TeamBridgeHeldMessages({
	hideWhenEmpty = false,
}: {
	hideWhenEmpty?: boolean;
}) {
	const holds = useHeldMessages(true, { panel: true });
	const items = holds.data?.items ?? [];
	const detail = useHeldMessageDetails(items);
	const decide = useHoldDecide();
	const retryDetails = useRetryHeldDetails();
	const { accountId } = useTeamBridgeAccount();
	const listState: ListState = holds.isError
		? "error"
		: holds.isPending
			? "loading"
			: "ready";
	return (
		<HeldMessagesView
			listState={listState}
			items={items}
			enabled={holds.data?.enabled ?? true}
			keyProtection={holds.data?.key_protection ?? null}
			detail={detail}
			busy={decide.busy}
			refusals={decide.refusals}
			onDecide={(item, word, proof) => void decide.run(item, word, proof)}
			onRetry={() => void holds.refetch()}
			onRetryDetails={() => void retryDetails()}
			accountId={accountId ?? null}
			hideWhenEmpty={hideWhenEmpty}
		/>
	);
}
