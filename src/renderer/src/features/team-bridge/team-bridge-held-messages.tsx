/**
 * Team Bridge "Held messages": the section of Approvals that lists what this
 * device's screener held for its owner, with the owner's Deliver / Discard.
 *
 * Two halves, as in `team-bridge-approvals.tsx`: `HeldMessagesView` renders
 * props only (what the stories and frames drive) and `TeamBridgeHeldMessages`
 * wires the hooks. The rules - which buttons a hold offers, which reason it
 * reads as, what counts toward the badge - are in `team-bridge-holds-model.ts`.
 *
 * WHAT IS RENDERED OF A HELD MESSAGE: only what the owner-audit transcript
 * already shows the owner for the same message (sender, time, the same body,
 * clamped). The hold list itself is metadata only and adds nothing to it.
 * Refusals show fixed copy, never the daemon's sentence. No biometric prompt
 * is raised here (decision a-856f).
 */
import { Spinner } from "@shared/components/common/spinner";
import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { formatDateTime, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import type { OwnerAuditMessage } from "../../../../shared/team-bridge-owner-audit-contract";
import {
	type HoldItem,
	type HoldWord,
	holdAffordance,
	holdReason,
	holdReasonLabel,
} from "./team-bridge-holds-model";
import { memberStoredName } from "./team-bridge-model";
import {
	type HeldMessageDetail,
	useHeldMessageDetails,
	useHeldMessages,
	useHoldDecide,
} from "./use-team-bridge-holds";

type ListState = "loading" | "error" | "ready";

function stamp(value: string | null): string | null {
	if (!value) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return formatDateTime(date, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * "From Ana" for a person; "From Scout, Ana's agent" when the teammate's agent
 * wrote it (owner-audit `origin: "agent"` with its `agent_label`), so the owner
 * always sees both the human teammate and the agent acting for them.
 */
export function heldSenderLine(message: OwnerAuditMessage | null): string {
	if (!message) return t("ui.teamBridge.holds.unknown_sender");
	const person =
		memberStoredName({
			kind: message.sender.kind === "agent" ? "agent" : "human",
			display_label: message.sender.display_label,
		}) ?? t("ui.teamBridge.holds.unknown_sender");
	const agent = message.agent_label?.trim();
	if (message.origin === "agent" && agent)
		return t("ui.teamBridge.holds.from_agent", { agent, person });
	return t("ui.teamBridge.holds.from_person", { person });
}

export function HeldMessagesView({
	listState,
	items,
	enabled = true,
	detail,
	busy = null,
	refusals = {},
	onDecide,
	onRetry,
	now,
}: {
	listState: ListState;
	items: readonly HoldItem[];
	/** The daemon's `enabled`: false means no release path is on here. */
	enabled?: boolean;
	detail: (item: HoldItem) => HeldMessageDetail;
	/** The message id whose Deliver/Discard is in flight. */
	busy?: string | null;
	refusals?: Readonly<Record<string, string>>;
	onDecide: (item: HoldItem, word: HoldWord, bodySha256: string) => void;
	onRetry?: () => void;
	/** Fixed clock for stories and frames. */
	now?: number;
}) {
	useI18nLocale();
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
							{t("ui.teamBridge.holds.retry")}
						</Button>
					)}
				</div>
			) : items.length === 0 ? (
				<p className="text-sm text-ink-muted">
					{t("ui.teamBridge.holds.empty")}
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{items.map((item) => (
						<HeldRow
							key={item.message_id}
							item={item}
							detail={detail(item)}
							busy={busy}
							refusal={refusals[item.message_id] ?? null}
							onDecide={onDecide}
							now={now}
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
	now,
}: {
	item: HoldItem;
	detail: HeldMessageDetail;
	busy: string | null;
	refusal: string | null;
	onDecide: (item: HoldItem, word: HoldWord, bodySha256: string) => void;
	now?: number;
}) {
	const message = detail.state === "ready" ? detail.message : null;
	const sender = heldSenderLine(message);
	const affordance = holdAffordance(item, now);
	const held = stamp(item.held_at);
	const until = stamp(item.deliver_until);
	const hash = detail.state === "ready" ? detail.bodySha256 : null;
	const offers =
		affordance.state === "open" || affordance.state === "deliver_expired";
	/* Buttons need the bound body hash: without the owner-audit view the
	   person has not seen the message, and the daemon would refuse anyway. */
	const armed = offers && hash !== null;
	const disabled = busy !== null;
	return (
		/* `elevated` ground, never a border (docs/branding.md), as the request rows. */
		<li className="flex flex-col gap-1 rounded-lg bg-elevated p-3 text-ink">
			<p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
				{detail.state === "loading" ? (
					<Spinner size="sm" label={t("ui.teamBridge.holds.loading")} />
				) : (
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
				{affordance.state === "open" && affordance.deliver && until && (
					<span className="shrink-0 text-meta text-ink-dim">
						{t("ui.teamBridge.holds.deliver_until", { time: until })}
					</span>
				)}
			</p>
			<p className="text-sm text-ink">{holdReasonLabel(holdReason(item))}</p>
			{message?.body && (
				<p className="line-clamp-3 whitespace-pre-wrap text-sm text-ink-muted">
					{message.body}
				</p>
			)}
			{affordance.state === "decided" && (
				<p className="text-sm text-ink-muted">
					{affordance.outcome === "refused" || affordance.outcome === "rejected"
						? t("ui.teamBridge.holds.state.not_applied")
						: affordance.word === "discard"
							? t("ui.teamBridge.holds.state.chose_discard")
							: t("ui.teamBridge.holds.state.chose_deliver")}
				</p>
			)}
			{affordance.state === "not_releasable" && (
				<p className="text-meta text-ink-dim">
					{t("ui.teamBridge.holds.state.not_releasable")}
				</p>
			)}
			{affordance.state === "deliver_expired" && (
				<p className="text-meta text-ink-dim">
					{t("ui.teamBridge.holds.state.deliver_expired")}
				</p>
			)}
			{offers && detail.state === "unavailable" && (
				<p className="text-meta text-ink-dim">
					{t("ui.teamBridge.holds.details_unavailable")}
				</p>
			)}
			{refusal && (
				<p role="alert" className="text-sm text-ink-muted">
					{refusal}
				</p>
			)}
			{armed && (
				<div className="flex gap-2 pt-1">
					{affordance.deliver && (
						<Button
							size="sm"
							disabled={disabled}
							aria-label={t("ui.teamBridge.holds.deliver_label", { sender })}
							onClick={() => onDecide(item, "deliver", hash)}
						>
							{t("ui.teamBridge.holds.deliver")}
						</Button>
					)}
					{affordance.discard && (
						<Button
							size="sm"
							variant="ghost"
							disabled={disabled}
							aria-label={t("ui.teamBridge.holds.discard_label", { sender })}
							onClick={() => onDecide(item, "discard", hash)}
						>
							{t("ui.teamBridge.holds.discard")}
						</Button>
					)}
				</div>
			)}
		</li>
	);
}

/** The section, wired: the hold list, the owner-audit join, the decide. */
export function TeamBridgeHeldMessages() {
	const holds = useHeldMessages(true, { panel: true });
	const items = holds.data?.items ?? [];
	const detail = useHeldMessageDetails(items);
	const decide = useHoldDecide();
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
			detail={detail}
			busy={decide.busy}
			refusals={decide.refusals}
			onDecide={(item, word, hash) => void decide.run(item, word, hash)}
			onRetry={() => void holds.refetch()}
		/>
	);
}
