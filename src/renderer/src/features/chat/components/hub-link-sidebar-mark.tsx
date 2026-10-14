import {
	HubLinkPolicyControls,
	hubLinkSourceName,
} from "@features/agents/components/hub-link-policy-controls";
import { hubLinkView } from "@features/agents/hub-link-adapter";
import { hubReasonText } from "@features/agents/hub-link-copy";
import { hubLinkMark } from "@features/agents/hub-link-view";
import { useHubLinkActions } from "@shared/api/local-operator/hub-link-actions";
import type { HubLink } from "@shared/api/local-operator/hub-links";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "@shared/components/ui/popover";
import { Tooltip } from "@shared/components/ui/tooltip";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import {
	Check,
	CircleAlert,
	CircleArrowDown,
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
 * One fixed 24px slot, including healthy links. Primary update/retry behavior is
 * preserved, while right-click/Shift+F10 always exposes independent policies.
 * The policy popover is a dialog, not a fake menu: real labelled switches remain
 * keyboard reachable and destination consent uses the existing modal primitive.
 */
export function HubLinkSidebarMark({
	link,
	staged,
	onDetail,
}: { link: HubLink; staged: boolean; onDetail: () => void }) {
	useI18nLocale();
	const actions = useHubLinkActions(link.link_id);
	const [open, setOpen] = useState(false);
	const [consentOpen, setConsentOpen] = useState(false);
	const button = useRef<HTMLButtonElement>(null);
	const titleId = useId();
	const descriptionId = useId();
	const source = hubLinkSourceName(link);
	const mark = hubLinkMark(hubLinkView(link));
	const Glyph = actions.isPending ? LoaderCircle : ICON[mark.kind];
	const direction = t(
		mark.direction === "pull"
			? "ui.hub.links.direction_pull"
			: "ui.hub.links.direction_push",
	);
	const policies = t("ui.hub.links.healthy", {
		item: link.name,
		source,
		subscribe: t(
			link.policy.subscribe
				? "ui.hub.subscriptions.configured_on"
				: "ui.hub.subscriptions.configured_off",
		),
		autoPush: t(
			link.policy.auto_push
				? "ui.hub.subscriptions.configured_on"
				: "ui.hub.subscriptions.configured_off",
		),
	});
	const actionLabel =
		mark.kind === "available"
			? t("ui.hub.links.available", { item: link.name, source })
			: mark.kind === "failed"
				? t("ui.hub.links.failed", { direction, item: link.name, source })
				: mark.kind === "busy"
					? t("ui.hub.links.busy", { direction, item: link.name, source })
					: mark.kind === "applied"
						? t(
								mark.direction === "pull"
									? "ui.hub.links.updated"
									: "ui.hub.links.published",
								{ item: link.name, source },
							)
						: policies;
	const description = `${actionLabel} ${policies}${link.policy.auto_push && link.eligibility.reason ? ` ${t("ui.hub.subscriptions.effective_paused", { reason: hubReasonText(link.eligibility.reason) })}` : ""}`;
	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				if (next || !consentOpen) setOpen(next);
			}}
		>
			<Tooltip content={description} side="right" disableHoverableContent>
				<PopoverAnchor asChild>
					<button
						ref={button}
						type="button"
						data-hub-mark={actions.isPending ? "busy" : mark.kind}
						data-testid={`hub-mark-${link.kind}-${link.name}`}
						aria-label={actionLabel}
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
							if (actions.isPending || mark.action === "policy") {
								setOpen(true);
								return;
							}
							if (mark.action === "detail") {
								onDetail();
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
			<PopoverContent
				side="right"
				align="start"
				aria-labelledby={titleId}
				className="max-w-[calc(100vw-2rem)]"
				onInteractOutside={(event) => {
					if (consentOpen) event.preventDefault();
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					button.current?.focus();
				}}
			>
				<h4 id={titleId} className="mb-3 break-words text-body-sm text-ink">
					{t("ui.hub.subscriptions.policy_menu", { item: link.name, source })}
				</h4>
				<HubLinkPolicyControls
					key={link.link_id}
					link={link}
					onConsentChange={setConsentOpen}
				/>
				{actions.error && (
					<p role="alert" className="mt-3 text-meta text-danger">
						{t("ui.hub.links.action_failed", {
							direction,
							item: link.name,
							source,
						})}
					</p>
				)}
			</PopoverContent>
		</Popover>
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
	const label = t("ui.hub.links.title");
	return (
		<Tooltip content={label} side="right" disableHoverableContent>
			<button
				type="button"
				data-hub-mark="aggregate"
				data-testid="hub-mark-aggregate"
				data-hub-mark-count={links.length}
				aria-label={label}
				className={cn(
					"flex size-6 shrink-0 items-center justify-center rounded-md text-ink-dim",
					!staged && "hover:bg-row-hover",
					"focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1",
				)}
				onClick={(event) => {
					event.stopPropagation();
					onDetail();
				}}
			>
				<Link2 aria-hidden="true" className="size-3.5" />
			</button>
		</Tooltip>
	);
}
