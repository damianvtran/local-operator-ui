import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import { useHubLinkPolicy } from "@shared/api/local-operator/hub-link-hooks";
import type {
	HubLink,
	HubLinkPolicyPatch,
} from "@shared/api/local-operator/hub-links";
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

/** Resolve at invocation so a locale refresh does not freeze imported copy. */
export function hubLinkSourceName(link: HubLink): string {
	if (link.visibility === "public") return t("ui.hub.links.source_public");
	return link.tenant_name
		? t("ui.hub.links.source_private", { organization: link.tenant_name })
		: t("ui.hub.links.source_unavailable");
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
}: { link: HubLink; onConsentChange?: (open: boolean) => void }) {
	useI18nLocale();
	const write = useHubLinkPolicy();
	const id = useId();
	const cancelRef = useRef<HTMLButtonElement>(null);
	const source = hubLinkSourceName(link);
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
	const unavailable =
		!link.eligibility.can_auto_push ||
		!link.remote_revision ||
		(link.visibility === "org" && !link.tenant_name);
	const unavailableReason = link.eligibility.reason
		? hubReasonText(link.eligibility.reason)
		: t("ui.hub.subscriptions.unsupported");
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
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<label htmlFor={`${id}-subscribe`} className="text-body-sm text-ink">
						{t("ui.hub.subscriptions.subscribe")}
					</label>
					<p className="text-meta text-ink-muted">
						{t("ui.hub.subscriptions.subscribe_description", { source })}
					</p>
				</div>
				<Switch
					id={`${id}-subscribe`}
					checked={link.policy.subscribe}
					disabled={write.isPending}
					aria-label={`${t("ui.hub.subscriptions.subscribe")}: ${source}`}
					onCheckedChange={(value) => save({ subscribe: value }, "subscribe")}
				/>
			</div>
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0">
					<label htmlFor={`${id}-push`} className="text-body-sm text-ink">
						{t("ui.hub.subscriptions.auto_push")}
					</label>
					<p className="text-meta text-ink-muted">
						{t("ui.hub.subscriptions.auto_push_description", { source })}
					</p>
				</div>
				<Switch
					id={`${id}-push`}
					checked={link.policy.auto_push}
					disabled={write.isPending || (!link.policy.auto_push && unavailable)}
					aria-label={`${t("ui.hub.subscriptions.auto_push")}: ${source}`}
					onCheckedChange={(value) => {
						if (!value) save({ auto_push: false }, "auto_push");
						else if (!unavailable) {
							onConsentChange?.(true);
							setConsent({
								linkId: link.link_id,
								revision: link.policy.revision,
								source,
							});
						}
					}}
				/>
			</div>
			{unavailable && (
				<p className="text-meta text-warning">
					{link.policy.auto_push
						? t("ui.hub.subscriptions.effective_paused", {
								reason: unavailableReason,
							})
						: unavailableReason}
				</p>
			)}
			{!link.policy.subscribe && (
				<p className="text-meta text-ink-muted">
					{t("ui.hub.subscriptions.manual_available")}
				</p>
			)}
			{write.isPending && (
				<output className="text-meta text-ink-muted">
					{t("ui.hub.subscriptions.saving", { setting: label, source })}
				</output>
			)}
			{write.error && (
				<p role="alert" className="text-meta text-danger">
					{write.error instanceof DesktopControlError &&
					write.error.code === "policy-revision-changed"
						? t("ui.hub.subscriptions.policy_changed")
						: t("ui.hub.subscriptions.save_failed", { setting: label, source })}
				</p>
			)}
			<Dialog
				open={consent !== null}
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
							{t("ui.hub.subscriptions.enable_title", { source })}
						</DialogTitle>
						<DialogDescription>
							{link.visibility === "public"
								? t("ui.hub.subscriptions.enable_public", { item: link.name })
								: t("ui.hub.subscriptions.enable_private", {
										item: link.name,
										organization: link.tenant_name ?? source,
									})}
						</DialogDescription>
					</DialogHeader>
					<p className="text-body-sm text-ink-muted">
						{t("ui.hub.subscriptions.enable_safety")}
					</p>
					{write.error && (
						<p role="alert" className="text-body-sm text-danger">
							{t("ui.hub.subscriptions.save_failed", {
								setting: label,
								source,
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
