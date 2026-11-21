import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { formatTime, t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { type FC, type ReactNode, createContext, useContext } from "react";
import {
	type TeamBridgeAlertCardView,
	type TeamBridgeAlertClaimView,
	type TeamBridgeAlertTone,
	shortFingerprint,
} from "./team-bridge-alert-model";

/**
 * What the PAGE lends every alert card in a conversation: the two actions a
 * card can start but does not own. A row deep in the virtualized list has no
 * route to the page's dialog state or the router, and threading two callbacks
 * through every list/row prop would touch every Team Bridge story; a context
 * with absent-means-no-button keeps stories and the owner audit inert.
 */
export type TeamBridgeAlertActions = {
	/** Opens the Responder dialog for this conversation, when the reader may. */
	onResponders?: () => void;
	/** Opens the owner's pending ask (U1): the session that is waiting. */
	onReviewAsk?: (ask: { askId: string; sessionId: string }) => void;
};
export const TeamBridgeAlertActionsContext =
	createContext<TeamBridgeAlertActions>({});

/**
 * The card as a message row draws it. The hub currently reports only a
 * `waiting_approval` boolean and lease expiry, not an ask/session identity.
 * No supported local alert-to-fleet-ask correlation exists yet, so the live
 * container MUST NOT guess from the presence of an unrelated fleet ask or
 * trust a speculative server ask id. The presentational card keeps its `ask`
 * seam for a future locally verified correlation; until then no review CTA
 * appears on the live path. The synthetic owner story is not a served contract.
 */
export const TeamBridgeAlertCardContainer: FC<{
	card: TeamBridgeAlertCardView;
	body: ReactNode;
	locale?: string;
}> = ({ card, body, locale }) => {
	const actions = useContext(TeamBridgeAlertActionsContext);
	return (
		<TeamBridgeAlertCard
			card={card}
			body={body}
			locale={locale}
			onReviewAsk={actions.onReviewAsk}
			onResponders={actions.onResponders}
		/>
	);
};

/**
 * THE ALERT CARD (Team Integrations RFC §10 item 4; design D1, D2, D5; U1).
 *
 * An integration alert root renders as one card inside its message row: the
 * row keeps the app's plate, name, APP badge and clock, and the card replaces
 * the bare body. Anatomy, top to bottom:
 *   A  severity, status, fire count / group count, last fired   (one line)
 *   B  the hub's deterministic body (title + summary), passed in as `body`
 *   D  label chips with a +N overflow, and the incident fingerprint (one line)
 *   E  the claim strip                                          (min 36px)
 *   F  verified host links and the responder entry              (28px)
 *
 * ZERO REFLOW ON CLAIM CHANGES (D1). A claim is the field that moves while a
 * reader is looking at the card - a responder takes it, waits on an ask, is
 * escalated - so the one line whose content depends on it has a FIXED box: E is
 * `min-h-9` with one truncated line in every state (unreported included), and
 * its CTA is `shrink-0` inside that line. The story `ClaimStatesShareOneHeight`
 * measures this.
 *
 * WIDTH MAY WRAP, CLAIMS MAY NOT (design D2). Lines A, D and F WRAP rather than
 * truncate: at a 320px thread a nowrap line clipped every label chip to one
 * glyph, the vendor links to three letters and the last-fired clock to "last
 * 2:…" - the values those lines exist to show. Wrapping depends only on width
 * and on fields the hub fixes at post time (labels, links, fingerprint), never
 * on the claim, so it costs D1 nothing. For the same reason F is drawn only
 * when it has something to hold (design D3): whether it exists is fixed per
 * card and per reader, not by a claim moving.
 *
 * COLOUR IS ROLE, NOT HUE (D2). The 3px rail and the SEV badge carry the
 * severity; FIRING is an `outline` badge so the hue stays on SEV and the rail.
 * A resolved card's rail turns `success` while its SEV badge keeps the history.
 * The card is an IN-FLOW block, so it may carry a `hairline` (a floating
 * surface may not), on an opaque `surface` ground (D5: no glass veil, so the
 * strip's `sunken`/wash grounds keep their measured contrast).
 */

const RAIL: Record<TeamBridgeAlertTone, string> = {
	danger: "bg-danger",
	warning: "bg-warning",
	info: "bg-info",
	dim: "bg-ink-dim",
	success: "bg-success",
};
const SEVERITY_BADGE = {
	sev1: "danger",
	sev2: "warning",
	sev3: "info",
	sev4: "neutral",
	unknown: "neutral",
} as const;

/** Line D shows this many label chips, then `+N`: deterministic, not measured. */
export const ALERT_CARD_VISIBLE_LABELS = 3;

export type TeamBridgeAlertCardProps = {
	card: TeamBridgeAlertCardView;
	/** The message body, already rendered by the row's prose renderer. */
	body: ReactNode;
	locale?: string;
	/** The owner's pending ask on THIS device (`alertAskOnThisDevice`), or null. */
	ask?: { askId: string; sessionId: string } | null;
	onReviewAsk?: (ask: { askId: string; sessionId: string }) => void;
	/** Opens the Responder dialog for this channel; absent draws no button. */
	onResponders?: () => void;
};

export const TeamBridgeAlertCard: FC<TeamBridgeAlertCardProps> = ({
	card,
	body,
	locale,
	ask = null,
	onReviewAsk,
	onResponders,
}) => {
	const last = card.lastFiredAt ? new Date(card.lastFiredAt) : null;
	const lastClock =
		last && !Number.isNaN(last.getTime())
			? formatTime(last, { hour: "numeric", minute: "2-digit" }, locale)
			: null;
	const resolved = card.resolvedAt ? new Date(card.resolvedAt) : null;
	const resolvedClock =
		resolved && !Number.isNaN(resolved.getTime())
			? formatTime(resolved, { hour: "numeric", minute: "2-digit" }, locale)
			: null;
	/* A resolved card ends on WHEN it resolved (design D1); that replaces the
	   last-fired clock, which the fire count and thread already carry. */
	const clockText = resolvedClock
		? t("ui.teamBridge.alerts.resolved_at", { time: resolvedClock })
		: lastClock
			? t("ui.teamBridge.alerts.last_fired", { time: lastClock })
			: null;
	const countText = card.group
		? t("ui.teamBridge.alerts.group_count", {
				total: card.group.total,
				resolved: card.group.resolved,
			})
		: card.fireCount > 1
			? t("ui.teamBridge.alerts.fire_count", { count: card.fireCount })
			: null;
	const hasActions = card.links.length > 0 || Boolean(onResponders);
	const severityLabel =
		card.severity === "unknown"
			? t("ui.teamBridge.alerts.severity_unknown")
			: t("ui.teamBridge.alerts.severity", {
					level: card.severity.slice(3),
					worst: card.group ? "yes" : "no",
				});
	const visible = card.labels.slice(0, ALERT_CARD_VISIBLE_LABELS);
	const hidden = card.labels.length - visible.length;
	return (
		<div
			data-alert-card=""
			data-alert-severity={card.severity}
			data-alert-status={card.status}
			data-alert-claim={card.claim.kind}
			data-alert-group={card.group ? "" : undefined}
			className="relative mt-1 flex min-w-0 max-w-[640px] overflow-hidden rounded-md border border-hairline bg-surface"
		>
			<span
				aria-hidden="true"
				data-alert-rail={card.tone}
				className={cn("w-[3px] shrink-0", RAIL[card.tone])}
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 py-2">
				{/* Line A */}
				<div
					data-alert-line="A"
					className="flex min-h-5 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-meta text-ink-muted"
				>
					{/* Resolved: the SEV badge drops to neutral (design D4) - its text
					    keeps the history, the rail and Resolved badge carry the state,
					    and a column of recovered SEV1s stops reading as live ones. */}
					<Badge
						variant={
							card.status === "resolved"
								? "neutral"
								: SEVERITY_BADGE[card.severity]
						}
						className="py-0 leading-4"
					>
						{severityLabel}
					</Badge>
					<Badge
						variant={card.status === "resolved" ? "success" : "outline"}
						className="py-0 leading-4"
					>
						{t("ui.teamBridge.alerts.status", { status: card.status })}
					</Badge>
					{card.isTest && (
						<Badge variant="neutral" className="py-0 leading-4">
							{t("ui.teamBridge.alerts.test_badge")}
						</Badge>
					)}
					{countText && (
						<span data-alert-count="" className="tabular-nums">
							{countText}
							{clockText ? " ·" : null}
						</span>
					)}
					{/* The clock never truncates: the time is the on-call value. */}
					{clockText && (
						<span
							data-alert-clock={resolvedClock ? "resolved" : "last"}
							className="shrink-0 whitespace-nowrap tabular-nums"
						>
							{clockText}
						</span>
					)}
				</div>
				{/* Line B: the hub's body. Clamped so a long summary cannot push
				    the claim strip; the thread holds the rest. */}
				<div className="line-clamp-5 min-w-0">{body}</div>
				{/* Line D */}
				{(visible.length > 0 || card.fingerprint) && (
					<div
						data-alert-line="D"
						className="flex min-h-5 min-w-0 flex-wrap items-center gap-1"
					>
						{/* A chip keeps its natural width up to 12rem and wraps instead
						    of shrinking (D2); only a value longer than 12rem truncates. */}
						{visible.map((label) => (
							<Badge
								key={`${label.key}=${label.value}`}
								variant="neutral"
								className="min-w-0 max-w-[min(12rem,100%)] py-0 leading-4"
								title={`${label.key}: ${label.value}`}
							>
								<span className="truncate">
									{label.key} {label.value}
								</span>
							</Badge>
						))}
						{hidden > 0 && (
							<Badge
								variant="neutral"
								className="py-0 leading-4"
								title={card.labels
									.slice(ALERT_CARD_VISIBLE_LABELS)
									.map((label) => `${label.key}: ${label.value}`)
									.join("\n")}
							>
								{t("ui.teamBridge.alerts.more_labels", { count: hidden })}
							</Badge>
						)}
						{/* The bare monospace id, named by its tooltip and accessible
						    name rather than a visible "id" prefix: the prefix was an
						    untranslatable English stub in every locale (review R2) and
						    cost width at 320px (design D2). */}
						{card.fingerprint && (
							<span
								data-alert-fingerprint=""
								className="ms-auto shrink-0 whitespace-nowrap font-mono text-meta-sm text-ink-dim"
								title={t("ui.teamBridge.alerts.fingerprint_title", {
									id: card.fingerprint,
								})}
							>
								<span aria-hidden="true">
									{shortFingerprint(card.fingerprint)}
								</span>
								<span className="sr-only">
									{t("ui.teamBridge.alerts.fingerprint_title", {
										id: card.fingerprint,
									})}
								</span>
							</span>
						)}
					</div>
				)}
				{/* Line E */}
				<ClaimStrip
					claim={card.claim}
					status={card.status}
					ask={ask}
					onReviewAsk={onReviewAsk}
				/>
				{/* Line F: only when it holds something (D3); wraps by width (D2). */}
				{hasActions && (
					<div
						data-alert-actions=""
						className="flex min-h-7 min-w-0 flex-wrap items-center gap-1"
					>
						{card.links.map((link) => (
							<Button
								key={link.url}
								asChild
								variant="ghost"
								size="sm"
								className="min-w-0 max-w-full"
							>
								<a
									href={link.url}
									target="_blank"
									rel="noreferrer noopener"
									title={link.url}
								>
									<span className="truncate">
										{link.label
											? t("ui.teamBridge.alerts.open_labelled", {
													label: link.label,
													host: link.host,
												})
											: t("ui.teamBridge.alerts.open_on", { host: link.host })}
									</span>
									<ExternalLink aria-hidden="true" />
								</a>
							</Button>
						))}
						{onResponders && (
							<Button
								variant="ghost"
								size="sm"
								className="ms-auto shrink-0"
								onClick={onResponders}
							>
								<ShieldCheck aria-hidden="true" />
								{t("ui.teamBridge.alerts.responders")}
							</Button>
						)}
					</div>
				)}
			</div>
		</div>
	);
};

const WIRE_TIER = {
	"T0-passive": "watch",
	T0: "triage",
	T1: "prepare",
} as const;

const CLAIM_GROUND = {
	unreported: "bg-sunken",
	unclaimed: "bg-sunken",
	claimed: "bg-sunken",
	waiting: "bg-warning-wash",
	escalated: "bg-danger-wash",
} as const;
const CLAIM_DOT = {
	unreported: "bg-ink-dim",
	unclaimed: "bg-ink-dim",
	claimed: "bg-success",
	waiting: "bg-warning",
	escalated: "bg-danger",
} as const;

const ClaimStrip: FC<{
	claim: TeamBridgeAlertClaimView;
	status: TeamBridgeAlertCardView["status"];
	ask: { askId: string; sessionId: string } | null;
	onReviewAsk?: (ask: { askId: string; sessionId: string }) => void;
}> = ({ claim, status, ask, onReviewAsk }) => {
	let text: string;
	if (claim.kind === "unreported") {
		text =
			status === "resolved"
				? t("ui.teamBridge.alerts.claim.resolved_unreported")
				: t("ui.teamBridge.alerts.claim.unreported");
	} else if (claim.kind === "unclaimed") {
		text =
			status === "resolved"
				? t("ui.teamBridge.alerts.claim.resolved_unclaimed")
				: t("ui.teamBridge.alerts.claim.unclaimed");
	} else {
		const who = claim.holder
			? claim.owner
				? t("ui.teamBridge.alerts.claim.holder_for_owner", {
						holder: claim.holder,
						owner: claim.owner,
					})
				: claim.holder
			: t("ui.teamBridge.alerts.claim.holder_unknown");
		const headline = t("ui.teamBridge.alerts.claim.taken_by", {
			state: claim.kind,
			who,
		});
		/* ICU select keys cannot carry `-`, so the wire tier maps to the
		   dialog's own option names; one label per tier in both places. */
		const tier = claim.tier
			? t("ui.teamBridge.alerts.responder.tier_name", {
					tier: WIRE_TIER[claim.tier],
				})
			: null;
		text = [headline, tier, claim.statusLine].filter(Boolean).join(" · ");
	}
	return (
		<div
			data-alert-claim-strip={claim.kind}
			className={cn(
				"flex min-h-9 min-w-0 flex-nowrap items-center gap-2 rounded-sm px-2.5 text-meta text-ink",
				CLAIM_GROUND[claim.kind],
			)}
		>
			<span
				aria-hidden="true"
				className={cn("size-2 shrink-0 rounded-full", CLAIM_DOT[claim.kind])}
			/>
			<span className="min-w-0 flex-1 truncate" title={text}>
				{text}
			</span>
			{ask && onReviewAsk && (
				<Button
					variant="primary"
					size="sm"
					className="shrink-0"
					onClick={() => onReviewAsk(ask)}
				>
					{t("ui.teamBridge.alerts.review_ask")}
				</Button>
			)}
		</div>
	);
};
