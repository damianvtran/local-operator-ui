import { useMembershipsQuery } from "@features/agent-hub/hooks/use-memberships-query";
import {
	HubLinkPolicyControls,
	hubLinkSourceLabel,
	hubLinkSourceName,
} from "@features/agents/components/hub-link-policy-controls";
import { hubLinkView } from "@features/agents/hub-link-adapter";
import {
	hubFailureReasonText,
	hubLinkFailureText,
	hubReasonText,
} from "@features/agents/hub-link-copy";
import { hubLinkMark } from "@features/agents/hub-link-view";
import { useHubLinkActions } from "@shared/api/local-operator/hub-link-actions";
import { hubLinksKey } from "@shared/api/local-operator/hub-link-hooks";
import type { HubLink } from "@shared/api/local-operator/hub-links";
import { HubMutationUpgradeRequired } from "@shared/api/local-operator/hub-mutation-safety";
import { Button } from "@shared/components/ui/button";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "@shared/components/ui/popover";
import { Tooltip } from "@shared/components/ui/tooltip";
import { type WithoutParams, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
	Check,
	CircleAlert,
	CircleArrowDown,
	CircleHelp,
	Link2,
	LoaderCircle,
	TriangleAlert,
} from "lucide-react";
import { useId, useRef, useState } from "react";

const ICON = {
	healthy: Link2,
	review: CircleAlert,
	available: CircleArrowDown,
	failed: TriangleAlert,
	busy: LoaderCircle,
	applied: Check,
};
const INK = {
	healthy: "text-ink-dim",
	review: "text-warning",
	available: "text-accent",
	failed: "text-danger",
	busy: "text-ink-dim",
	applied: "text-success",
};

/**
 * How far the policy popover is kept from the window's edges, in px - the same
 * 8px step the sidebar's row flyout and the tag popover clamp to. Without it
 * Radix keeps the panel only flush with the viewport, and a mark near the foot
 * of the sidebar drew a panel that ran off the bottom of the window.
 */
const POPOVER_COLLISION_PADDING = 8;

/**
 * One fixed 24px slot, including healthy links. Primary update/retry behavior is
 * preserved, while right-click/Shift+F10 always exposes independent policies.
 * The policy popover is a dialog, not a fake menu: real labelled switches remain
 * keyboard reachable and destination consent uses the existing modal primitive.
 */
export function HubLinkSidebarMark({
	link,
	staged,
	onDetail,
	itemName,
	displayName,
	itemsById = false,
}: {
	link: HubLink;
	staged: boolean;
	onDetail: () => void;
	/**
	 * The item's REGISTRY name (an agent's or team's `name`), the address core's
	 * released item routes match. Not the label: a team drawn as "Radient
	 * Development" is addressed as `radientdev`.
	 */
	itemName?: string;
	/**
	 * What the row is CALLED (a team's label, else its name). Required for a
	 * readable sentence: core falls back to the item's local id for an agent or
	 * team link row's `name`, so `link.name` reads as a UUID.
	 */
	displayName?: string;
	/** `desktopFeatureEnabled(capabilities, "hub_items_by_id")`. */
	itemsById?: boolean;
}) {
	useI18nLocale();
	const client = useQueryClient();
	const actions = useHubLinkActions(link.link_id);
	const [open, setOpen] = useState(false);
	const [consentOpen, setConsentOpen] = useState(false);
	const button = useRef<HTMLButtonElement>(null);
	const titleId = useId();
	const descriptionId = useId();
	const item = displayName?.trim() ? displayName : link.name;
	/*
	 * An org link's row carries the organization's name only when core recorded
	 * one; otherwise the signed-in account's own memberships name it. The read is
	 * the shared, cached memberships query, issued only for a row that needs it.
	 */
	const needsOrganization = link.visibility === "org" && !link.tenant_name;
	const memberships = useMembershipsQuery({ enabled: needsOrganization });
	const source = hubLinkSourceLabel(link, memberships.memberships);
	const mark = hubLinkMark(hubLinkView(link));
	const Glyph = actions.isPending ? LoaderCircle : ICON[mark.kind];
	const direction = t(
		mark.direction === "pull"
			? "ui.hub.links.direction_pull"
			: "ui.hub.links.direction_push",
	);
	const onOff = (value: boolean) =>
		t(
			value
				? "ui.hub.subscriptions.configured_on"
				: "ui.hub.subscriptions.configured_off",
		);
	/*
	 * Every sentence has a twin written WITHOUT a destination. An unknown source
	 * used to be the literal "Source unavailable" interpolated into each one
	 * ("Retry Incoming update for <id> at Source unavailable"); the source line in
	 * the popover says once, plainly, that it could not be identified.
	 */
	const policies = source
		? t("ui.hub.links.healthy", {
				item,
				source,
				subscribe: onOff(link.policy.subscribe),
				autoPush: onOff(link.policy.auto_push),
			})
		: t("ui.hub.links.healthy_unsourced", {
				item,
				subscribe: onOff(link.policy.subscribe),
				autoPush: onOff(link.policy.auto_push),
			});
	const actionLabel =
		mark.kind === "available"
			? source
				? t("ui.hub.links.available", { item, source })
				: t("ui.hub.links.available_unsourced", { item })
			: mark.kind === "failed"
				? source
					? t("ui.hub.links.failed", { direction, item, source })
					: t("ui.hub.links.failed_unsourced", { direction, item })
				: mark.kind === "busy"
					? source
						? t("ui.hub.links.busy", { direction, item, source })
						: t("ui.hub.links.busy_unsourced", { direction, item })
					: mark.kind === "applied"
						? mark.direction === "pull"
							? source
								? t("ui.hub.links.updated", { item, source })
								: t("ui.hub.links.updated_unsourced", { item })
							: source
								? t("ui.hub.links.published", { item, source })
								: t("ui.hub.links.published_unsourced", { item })
						: policies;
	/*
	 * A FAILED INCOMING UPDATE is retried through the item route core serves:
	 * `/v1/desktop/hub/updates/retry` takes `kind` + one item address. The old
	 * `{link_id, direction}` body is not a member of that route (core answered
	 * 422 "invalid fields"), which is why the popover only ever said the update
	 * "did not complete". `local_id` is exact and needs `hub_items_by_id`; an
	 * older core gets the registry name, the address it has always taken.
	 */
	const pullFailed =
		link.pull.state === "failed" ||
		(link.pull.state === "retry-wait" && link.pull.error_class !== null);
	const retryIncoming = () =>
		actions.mutate(
			{
				action: "retryItem",
				linkId: link.link_id,
				kind: link.kind,
				address: itemsById
					? { localId: link.local_id }
					: { name: itemName?.trim() ? itemName : link.name },
			},
			{ onError: () => setOpen(true) },
		);
	const retryFailed =
		actions.error !== null && actions.variables?.action === "retryItem";
	const refetchSource = () => {
		void memberships.refetch();
		void client.invalidateQueries({ queryKey: hubLinksKey });
	};
	const description = `${actionLabel} ${policies}${link.policy.auto_push && link.eligibility.reason ? ` ${t("ui.hub.subscriptions.effective_paused", { reason: hubReasonText(link.eligibility.reason) })}` : ""}`;
	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				if (next || !consentOpen) setOpen(next);
			}}
		>
			<Tooltip content={description} side="top" disableHoverableContent>
				<PopoverAnchor asChild>
					<button
						ref={button}
						type="button"
						data-hub-mark={actions.isPending ? "busy" : mark.kind}
						data-testid={`hub-mark-${link.kind}-${link.name}`}
						aria-label={actionLabel}
						aria-disabled={
							(!actions.canWrite &&
								(mark.action === "apply" || mark.action === "retry")) ||
							undefined
						}
						aria-describedby={descriptionId}
						aria-haspopup="dialog"
						aria-expanded={open}
						className={cn(
							"flex size-6 shrink-0 items-center justify-center rounded-md",
							INK[mark.kind],
							!staged && "hover:bg-row-hover",
							"focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1",
						)}
						onContextMenu={(event) => {
							event.preventDefault();
							event.stopPropagation();
							setOpen(true);
						}}
						onKeyDown={(event) => {
							if (
								event.key === "ContextMenu" ||
								(event.shiftKey && event.key === "F10")
							) {
								event.preventDefault();
								event.stopPropagation();
								setOpen(true);
							}
						}}
						onClick={(event) => {
							event.stopPropagation();
							if (
								actions.isPending ||
								mark.action === "policy" ||
								(!actions.canWrite &&
									(mark.action === "apply" || mark.action === "retry"))
							) {
								setOpen(true);
								return;
							}
							if (mark.action === "detail") {
								onDetail();
								return;
							}
							if (mark.action === "retry" && mark.direction === "pull") {
								retryIncoming();
								return;
							}
							actions.mutate(
								mark.action === "apply"
									? { action: "apply", linkId: link.link_id }
									: {
											action: "retry",
											linkId: link.link_id,
											direction: mark.direction,
										},
								{ onError: () => setOpen(true) },
							);
						}}
					>
						<span id={descriptionId} className="sr-only">
							{description}
						</span>
						<Glyph
							aria-hidden="true"
							className={cn(
								"size-3.5",
								(actions.isPending || mark.kind === "busy") &&
									"motion-safe:animate-spin",
							)}
						/>
					</button>
				</PopoverAnchor>
			</Tooltip>
			{/*
			 * Kept inside the window: Radix flips the side and shifts along it when
			 * the panel would cross an edge (8px clear), and the available-size
			 * variables Radix measures cap the box so a long body scrolls inside the
			 * panel instead of running off the bottom of the screen.
			 */}
			<PopoverContent
				side="right"
				align="start"
				avoidCollisions
				collisionPadding={POPOVER_COLLISION_PADDING}
				aria-labelledby={titleId}
				data-hub-link-popover={link.link_id}
				className="max-h-[var(--radix-popover-content-available-height)] max-w-[min(20rem,var(--radix-popover-content-available-width))] overflow-y-auto"
				onInteractOutside={(event) => {
					if (consentOpen) event.preventDefault();
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					button.current?.focus();
				}}
			>
				<h4 id={titleId} className="break-words text-body-sm text-ink">
					{t("ui.hub.links.policy_title", { item })}
				</h4>
				{source ? (
					<p
						className="mb-3 break-words text-meta text-ink-muted"
						data-hub-link-source=""
					>
						{source}
					</p>
				) : (
					<div
						className="mb-3 flex items-start justify-between gap-3"
						data-hub-link-source-unresolved=""
					>
						<p className="min-w-0 text-meta text-ink-muted">
							{t("ui.hub.links.source_unresolved")}
						</p>
						<Button
							variant="outline"
							size="sm"
							disabled={memberships.isFetching}
							onClick={refetchSource}
						>
							{t("ui.hub.links.retry")}
						</Button>
					</div>
				)}
				{pullFailed && (
					<div
						className="mb-3 flex flex-col gap-2 rounded-md border border-hairline p-3"
						data-hub-link-incoming-failed=""
					>
						<p className="text-body-sm text-ink">
							{t("ui.hub.links.incoming_failed")}
						</p>
						<p className="text-meta text-ink-muted">
							{hubFailureReasonText(link.pull)}
						</p>
						{retryFailed && (
							<p role="alert" className="text-meta text-danger">
								{hubLinkFailureText(
									actions.error,
									t("ui.hub.links.retry_failed"),
									HubMutationUpgradeRequired,
								)}
							</p>
						)}
						<div>
							<Button
								variant="outline"
								size="sm"
								disabled={actions.isPending || !actions.canWrite}
								onClick={retryIncoming}
							>
								{t(
									actions.isPending
										? "ui.hub.links.retrying"
										: "ui.hub.links.retry",
								)}
							</Button>
						</div>
					</div>
				)}
				<HubLinkPolicyControls
					key={link.link_id}
					link={link}
					item={item}
					source={source}
					onConsentChange={setConsentOpen}
				/>
				{actions.error && !retryFailed && (
					<p role="alert" className="mt-3 text-meta text-danger">
						{hubLinkFailureText(
							actions.error,
							source
								? t("ui.hub.links.action_failed", { direction, item, source })
								: t("ui.hub.links.action_failed_unsourced", {
										direction,
										item,
									}),
							HubMutationUpgradeRequired,
						)}
					</p>
				)}
			</PopoverContent>
		</Popover>
	);
}

/**
 * The UNRESOLVED affordance (CODE MAJOR-B, design §Sidebar): an item present in
 * `inventory.unresolved` but ABSENT from `inventory.links` drew NOTHING - the one
 * indicator the operator asked for was missing exactly when the item has
 * something to act on (the source-confirmation act). It is deliberately DISTINCT
 * from every healthy/aggregate mark: a different glyph (a question, not a link)
 * and its own aria label, and it opens the resolve flow rather than a policy menu
 * (there is no policy to edit on a row with no confirmed origin).
 */
export function HubUnresolvedMark({
	item,
	staged,
	onResolve,
}: { item: string; staged: boolean; onResolve: () => void }) {
	useI18nLocale();
	/*
	 * D25: the label NAMES the row. Two unresolved items both truncate to "legac…"
	 * in the roster, so a mark that did not name its item left the reader unable to
	 * tell which one it belongs to.
	 */
	const label = t("ui.hub.links.unresolved_mark", { item });
	return (
		<Tooltip content={label} side="top" disableHoverableContent>
			<button
				type="button"
				data-hub-mark="unresolved"
				data-testid="hub-mark-unresolved"
				aria-label={label}
				className={cn(
					"flex size-6 shrink-0 items-center justify-center rounded-md text-warning",
					!staged && "hover:bg-row-hover",
					"focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1",
				)}
				onClick={(event) => {
					event.stopPropagation();
					onResolve();
				}}
			>
				<CircleHelp aria-hidden="true" className="size-3.5" />
			</button>
		</Tooltip>
	);
}

/** Expansion is the user's act; a poll never inserts flags into a collapsed name. */
export function HubLinkExpandedPolicy({ link }: { link: HubLink }) {
	useI18nLocale();
	return (
		<div
			className="flex min-w-0 flex-col gap-2 px-3 py-2"
			data-hub-expanded-policy={link.link_id}
		>
			<p className="break-words text-meta text-ink-muted">
				{hubLinkSourceName(link)}
			</p>
			<HubLinkPolicyControls link={link} />
		</div>
	);
}

/**
 * The AGGREGATE mark (design §Sidebar line 48, CODE MAJOR-2): an item linked to
 * MORE THAN ONE origin draws one mark that opens the Hub links detail rather than
 * drawing nothing. It is deliberately not a policy popover — with several
 * destinations to choose between there is no single policy to edit here, so the
 * press only opens detail, where the per-link controls live.
 */
export function HubLinkAggregateMark({
	links,
	staged,
	onDetail,
}: { links: HubLink[]; staged: boolean; onDetail: () => void }) {
	useI18nLocale();
	/*
	 * UX U10 (design D14): the aggregate used to be pixel-identical to a single
	 * healthy mark, so a row with three origins looked exactly like a row with one
	 * and rolled up nothing. It now takes the WORST origin state through the same
	 * `hubLinkMark` ladder the single mark uses - a failure at one origin is not
	 * hidden behind a healthy one - and shows the origin COUNT as a badge.
	 */
	const RANK: Record<string, number> = {
		healthy: 0,
		applied: 1,
		available: 2,
		busy: 3,
		failed: 4,
		review: 5,
	};
	const marks = links.map((link) => hubLinkMark(hubLinkView(link)));
	const worst = marks.reduce(
		(acc, mark) => (RANK[mark.kind] > RANK[acc] ? mark.kind : acc),
		"healthy",
	);
	const Glyph = ICON[worst as keyof typeof ICON] ?? Link2;
	/*
	 * D23: the count and the rolled-up state were aria-hidden visual-only, so a
	 * screen reader heard "Hub links" and nothing about either. Both are folded
	 * INTO the label, which is the only thing announced.
	 */
	const MARK_STATE_KEY: Record<string, WithoutParams> = {
		healthy: "ui.hub.links.mark_healthy",
		review: "ui.hub.links.mark_review",
		failed: "ui.hub.links.mark_failed",
		available: "ui.hub.links.mark_available",
		busy: "ui.hub.links.mark_busy",
		applied: "ui.hub.links.mark_applied",
	};
	const label = t("ui.hub.links.aggregate_mark", {
		count: links.length,
		state: t(MARK_STATE_KEY[worst] ?? "ui.hub.links.mark_healthy"),
	});
	return (
		<Tooltip content={label} side="top" disableHoverableContent>
			<button
				type="button"
				data-hub-mark="aggregate"
				data-testid="hub-mark-aggregate"
				data-hub-mark-count={links.length}
				data-hub-mark-state={worst}
				aria-label={label}
				className={cn(
					"relative flex size-6 shrink-0 items-center justify-center rounded-md",
					INK[worst as keyof typeof INK] ?? "text-ink-dim",
					!staged && "hover:bg-row-hover",
					"focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1",
				)}
				onClick={(event) => {
					event.stopPropagation();
					onDetail();
				}}
			>
				<Glyph aria-hidden="true" className="size-3.5" />
				<span
					aria-hidden="true"
					className="absolute -right-0.5 -bottom-0.5 flex h-3 min-w-3 items-center justify-center rounded-full border border-control bg-surface px-0.5 text-meta-sm leading-none text-ink-muted"
				>
					{links.length}
				</span>
			</button>
		</Tooltip>
	);
}
