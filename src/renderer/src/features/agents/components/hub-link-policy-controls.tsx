import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import { useHubLinkPolicy } from "@shared/api/local-operator/hub-link-hooks";
import type {
	HubLink,
	HubLinkPolicyPatch,
} from "@shared/api/local-operator/hub-links";
import { HubMutationUpgradeRequired } from "@shared/api/local-operator/hub-mutation-safety";
import { Button } from "@shared/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { Switch } from "@shared/components/ui/switch";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useEffect, useId, useRef, useState } from "react";
import { hubReasonText } from "../hub-link-copy";
import { hubAutoPushGate, hubAutoPushLine } from "../hub-link-view";

/** Resolve at invocation so a locale refresh does not freeze imported copy. */
export function hubLinkSourceName(link: HubLink): string {
	if (link.visibility === "public") return t("ui.hub.links.source_public");
	return link.tenant_name
		? t("ui.hub.links.source_private", { organization: link.tenant_name })
		: t("ui.hub.links.source_unavailable");
}

/**
 * The destination as a noun phrase a SENTENCE can carry ("Acme private hub",
 * "Public hub"), or `null` when it cannot be named.
 *
 * WHY a second resolver beside `hubLinkSourceName`: that one is a list label
 * ("Acme · Private") and falls back to the literal "Source unavailable", which
 * the sidebar policy popover then spliced into every sentence ("Receive updates
 * from Source unavailable"). Here an unknown source is `null`, so a caller
 * picks a sentence written WITHOUT a source instead of interpolating a
 * placeholder.
 *
 * The organization's name comes from the link row's persisted `tenant_name`
 * first, then from the signed-in account's own memberships matched by
 * `tenant_id` - core only knows names it has stored (`hub.tenant_names`), so an
 * org link published before that record was written reads `null` on the wire
 * even though the account is a member. A membership is display metadata here,
 * never authority: the auto-push gate (`hubAutoPushGate`) still reads only the
 * row's own `tenant_name`, exactly as core does.
 */
export function hubLinkSourceLabel(
	link: Pick<HubLink, "visibility" | "tenant_id" | "tenant_name">,
	memberships: readonly { tenant_id: string; tenant_name: string }[] = [],
): string | null {
	if (link.visibility === "public")
		return t("ui.hub.links.source_label_public");
	const organization =
		link.tenant_name ||
		memberships.find((row) => row.tenant_id === link.tenant_id)?.tenant_name;
	return organization
		? t("ui.hub.links.source_label_org", { organization })
		: null;
}

/**
 * The auto-push refusal as one sentence that says what it means and what to do.
 *
 * `unsupported-precondition` is core's answer both when the server never
 * attested revision-safe writes and when the link has no recorded remote
 * revision to compare against (`_eligibility` in core's hub_sync service). The
 * shared reason text ("This destination has not verified revision-safe
 * publication.") names an internal guarantee and offers no next step, so in the
 * auto-push context it is replaced; every other reason keeps its shared text.
 */
export function hubAutoPushUnavailableText(reason: string | null): string {
	if (!reason || reason.split("/")[0] === "unsupported-precondition")
		return t("ui.hub.subscriptions.auto_push_unverified");
	return hubReasonText(reason);
}

/**
 * Policy is a confirmed service fact, independent in each direction. These rows
 * never optimistically flip an ON state, infer a source from the active hub view,
 * or turn a public future-write acknowledgement into declassification consent.
 * The same component is used in detail and the sidebar policy menu.
 */
export function HubLinkPolicyControls({
	link,
	onConsentChange,
	item,
	source: resolvedSource,
}: {
	link: HubLink;
	onConsentChange?: (open: boolean) => void;
	/**
	 * The item's DISPLAY name. An agent/team link row's `name` is its local id
	 * (core falls back to it when no alias is recorded), so a caller that knows
	 * the label passes it; otherwise the row's name is all there is.
	 */
	item?: string;
	/**
	 * The caller's resolved destination phrase (`hubLinkSourceLabel`), `null`
	 * when it could not be named. Omitted, it is resolved from the row alone.
	 */
	source?: string | null;
}) {
	useI18nLocale();
	const write = useHubLinkPolicy();
	const id = useId();
	const cancelRef = useRef<HTMLButtonElement>(null);
	const source =
		resolvedSource !== undefined ? resolvedSource : hubLinkSourceLabel(link);
	const itemName = item?.trim() ? item : link.name;
	const [changedSetting, setChangedSetting] = useState<
		"subscribe" | "auto_push"
	>("subscribe");
	const [consent, setConsent] = useState<{
		linkId: string;
		revision: string;
		source: string;
	} | null>(null);
	// A stale dialog cannot authorize an edited policy or another destination.
	// Cancellation preserves the confirmed OFF state and requires a fresh act.
	useEffect(() => {
		if (
			consent &&
			(consent.linkId !== link.link_id ||
				consent.revision !== link.policy.revision ||
				consent.source !== source)
		) {
			onConsentChange?.(false);
			setConsent(null);
		}
	}, [link.link_id, link.policy.revision, source, consent, onConsentChange]);
	const closeConsent = () => {
		onConsentChange?.(false);
		setConsent(null);
	};

	const save = (
		patch: HubLinkPolicyPatch,
		setting: "subscribe" | "auto_push",
	) => {
		if (write.isPending) return;
		setChangedSetting(setting);
		write.mutate({ link, patch }, { onSuccess: closeConsent });
	};
	// Core's own rule, shared with the guard test: a public no-grant link is
	// "requires consent", not "unavailable" (see hubAutoPushGate).
	const { unavailable } = hubAutoPushGate(link);
	// The line follows EFFECTIVE state, not the carve-out: a configured-ON link the
	// service cannot run stays "paused" even though its OFF->ON path is reachable.
	const line = hubAutoPushLine(link);
	const unavailableReason = hubAutoPushUnavailableText(link.eligibility.reason);
	const label = t(
		changedSetting === "subscribe"
			? "ui.hub.subscriptions.subscribe"
			: "ui.hub.subscriptions.auto_push",
	);
	return (
		<div
			className="flex min-w-0 flex-col gap-3"
			data-hub-link-policy={link.link_id}
		>
			{write.upgradeMessage && (
				<output className="block text-meta text-warning" data-hub-core-upgrade>
					{write.upgradeMessage}
				</output>
			)}
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<label htmlFor={`${id}-subscribe`} className="text-body-sm text-ink">
						{t("ui.hub.subscriptions.subscribe")}
					</label>
					<p className="text-meta text-ink-muted">
						{source
							? t(
									write.canWrite
										? "ui.hub.subscriptions.subscribe_description"
										: "ui.hub.subscriptions.subscribe_description_blocked",
									{ source },
								)
							: t(
									write.canWrite
										? "ui.hub.subscriptions.subscribe_description_unsourced"
										: "ui.hub.subscriptions.subscribe_description_blocked_unsourced",
								)}
					</p>
				</div>
				<Switch
					id={`${id}-subscribe`}
					checked={link.policy.subscribe}
					disabled={write.isPending || !write.canWrite}
					aria-label={
						source
							? `${t("ui.hub.subscriptions.subscribe")}: ${source}`
							: t("ui.hub.subscriptions.subscribe")
					}
					onCheckedChange={(value) => save({ subscribe: value }, "subscribe")}
				/>
			</div>
			{/*
			 * Item 9 (UX U7 / D7): the pause sentence is caused by SUBSCRIBE being
			 * off, so it belongs with the Subscribe row, not under Auto-push where it
			 * read as an outbound statement. It is a concern of the INBOUND direction.
			 */}
			{!link.policy.subscribe && write.canWrite && (
				<p className="text-meta text-ink-muted">
					{t("ui.hub.subscriptions.manual_available")}
				</p>
			)}
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<label htmlFor={`${id}-push`} className="text-body-sm text-ink">
						{t("ui.hub.subscriptions.auto_push")}
					</label>
					<p className="text-meta text-ink-muted">
						{source
							? t("ui.hub.subscriptions.auto_push_description", { source })
							: t("ui.hub.subscriptions.auto_push_description_unsourced")}
					</p>
				</div>
				{/*
				 * A disabled switch takes no pointer events, so the reason rides a
				 * wrapper's native tooltip as well as the visible line below it
				 * (`aria-describedby`): the person who hovers the dead control learns
				 * why without having to find the sentence underneath.
				 */}
				<span
					className="inline-flex shrink-0"
					data-hub-auto-push-reason={line !== "none" ? "" : undefined}
					title={line === "unavailable" ? unavailableReason : undefined}
				>
					<Switch
						id={`${id}-push`}
						// Point at the line only while it renders; a dangling idref is worse
						// than none. The aria-label stays the name; this adds the reason.
						aria-describedby={line !== "none" ? `${id}-push-line` : undefined}
						checked={link.policy.auto_push}
						disabled={
							write.isPending ||
							!write.canWrite ||
							(!link.policy.auto_push && unavailable)
						}
						aria-label={
							source
								? `${t("ui.hub.subscriptions.auto_push")}: ${source}`
								: t("ui.hub.subscriptions.auto_push")
						}
						onCheckedChange={(value) => {
							if (!value) save({ auto_push: false }, "auto_push");
							// No named destination, no consent: the dialog states WHERE
							// future changes go, so it cannot open on an unnamed source.
							else if (!unavailable && source) {
								onConsentChange?.(true);
								setConsent({
									linkId: link.link_id,
									revision: link.policy.revision,
									source,
								});
							}
						}}
					/>
				</span>
			</div>
			{line !== "none" && (
				<p id={`${id}-push-line`} className="text-meta text-warning">
					{line === "paused"
						? t("ui.hub.subscriptions.effective_paused", {
								reason: unavailableReason,
							})
						: unavailableReason}
				</p>
			)}
			{write.isPending && (
				<output className="text-meta text-ink-muted">
					{source
						? t("ui.hub.subscriptions.saving", { setting: label, source })
						: t("ui.hub.subscriptions.saving_unsourced", { setting: label })}
				</output>
			)}
			{write.error && (
				<p role="alert" className="text-meta text-danger">
					{write.error instanceof HubMutationUpgradeRequired
						? write.error.message
						: write.error instanceof DesktopControlError &&
								write.error.code === "policy-revision-changed"
							? t("ui.hub.subscriptions.policy_changed")
							: source
								? t("ui.hub.subscriptions.save_failed", {
										setting: label,
										source,
									})
								: t("ui.hub.subscriptions.save_failed_unsourced", {
										setting: label,
									})}
				</p>
			)}
			<Dialog
				open={consent !== null && source !== null}
				onOpenChange={(open) => {
					if (!open && !write.isPending) closeConsent();
				}}
			>
				<DialogContent
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						cancelRef.current?.focus();
					}}
					closeDisabled={write.isPending}
					onEscapeKeyDown={(event) => {
						if (write.isPending) event.preventDefault();
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{t("ui.hub.subscriptions.enable_title", { source: source ?? "" })}
						</DialogTitle>
						<DialogDescription>
							{link.visibility === "public"
								? t("ui.hub.subscriptions.enable_public", { item: itemName })
								: t("ui.hub.subscriptions.enable_private", {
										item: itemName,
										organization: link.tenant_name ?? source ?? "",
									})}
						</DialogDescription>
					</DialogHeader>
					<p className="text-body-sm text-ink-muted">
						{t("ui.hub.subscriptions.enable_safety")}
					</p>
					{/* The row is behind an overlay: a blocked confirmation must
					 * explain itself here, not only in the obscured policy panel. */}
					{write.upgradeMessage && (
						<p
							role="alert"
							className="text-body-sm text-warning"
							data-hub-core-upgrade
						>
							{write.upgradeMessage}
						</p>
					)}
					{write.error && (
						<p role="alert" className="text-body-sm text-danger">
							{t("ui.hub.subscriptions.save_failed", {
								setting: label,
								source: source ?? "",
							})}
						</p>
					)}
					<DialogFooter>
						<Button
							ref={cancelRef}
							variant="outline"
							disabled={write.isPending}
							onClick={closeConsent}
						>
							{t("ui.hub.subscriptions.cancel")}
						</Button>
						<Button
							disabled={
								write.isPending ||
								!write.canWrite ||
								unavailable ||
								consent?.linkId !== link.link_id ||
								consent?.revision !== link.policy.revision ||
								consent?.source !== source
							}
							onClick={() =>
								save(
									{
										auto_push: true,
										...(link.visibility === "public"
											? { confirm_public_egress: true }
											: {}),
									},
									"auto_push",
								)
							}
						>
							{t("ui.hub.subscriptions.enable")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
