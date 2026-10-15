import { useMembershipsQuery } from "@features/agent-hub/hooks/use-memberships-query";
import { usableOrgs } from "@features/agent-hub/org-access";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	hubLinksKey,
	useHubLinks,
} from "@shared/api/local-operator/hub-link-hooks";
import type { HubLink } from "@shared/api/local-operator/hub-links";
import {
	type LocalLinkReceipt,
	publicationPolicyAcknowledged,
} from "@shared/api/local-operator/hub-publication";
import type { ReusableTeam } from "@shared/api/local-operator/profile-hooks";
import { Button } from "@shared/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import {
	HubInitialPolicyFields,
	newHubPolicy,
} from "./hub-initial-policy-fields";
import {
	HubLinkPolicyControls,
	hubLinkSourceName,
} from "./hub-link-policy-controls";

/**
 * Existing local team route, explicit Public or verified named org. This panel
 * configures publication of the persisted definition; it does not claim a
 * server-projected preview or publish an unsaved editor
 * buffer or transplant private text into a public alias. Another origin blocks
 * publication, retaining the original link and draft instead of relinking.
 */
export function HubTeamPublication({ team }: { team: ReusableTeam }) {
	useI18nLocale();
	const id = useId();
	const capabilities = useDesktopCapabilities();
	const { isAuthenticated } = useRadientAuth();
	const enabled = desktopFeatureEnabled(capabilities.data, "hub_links");
	const [open, setOpen] = useState(false);
	const [target, setTarget] = useState<string | null>(null);
	const [policy, setPolicy] = useState(newHubPolicy);
	const request = useRef<{ tuple: string; id: string } | null>(null);
	const cancel = useRef<HTMLButtonElement>(null);
	const links = useHubLinks(enabled);
	const memberships = useMembershipsQuery({
		enabled:
			open &&
			isAuthenticated &&
			desktopFeatureEnabled(capabilities.data, "radient_org"),
	});
	const organizations = usableOrgs(memberships.memberships);
	const org = target
		? organizations.find((candidate) => candidate.tenant_id === target)
		: null;
	const source = target
		? org?.tenant_name
			? t("ui.hub.links.source_private", { organization: org.tenant_name })
			: t("ui.hub.links.source_unavailable")
		: t("ui.hub.links.source_public");
	const origins = (links.data?.links ?? []).filter(
		(link) => link.kind === "team" && link.local_id === team.id,
	);
	const existing = origins.find(
		(link) =>
			link.visibility === (target ? "org" : "public") &&
			link.tenant_id === target,
	);
	const other = origins.find((link) => link.link_id !== existing?.link_id);
	const unresolved = links.data?.unresolved.some(
		(row) => row.kind === "team" && row.local_id === team.id,
	);
	const client = useQueryClient();
	const publication = useMutation({
		mutationFn: async () => {
			if (
				!isAuthenticated ||
				existing ||
				!enabled ||
				!links.isSuccess ||
				other ||
				unresolved ||
				(target && !org)
			)
				throw new Error("hub-team-destination-not-ready");
			const tuple = JSON.stringify({
				id: team.id,
				target,
				policy: existing ? null : policy,
			});
			const operation =
				request.current?.tuple === tuple
					? request.current
					: { tuple, id: crypto.randomUUID() };
			request.current = operation;
			return desktopResult<{
				link: HubLink | null;
				local_link_receipt: LocalLinkReceipt;
			}>({
				op: "team.publish",
				teamId: team.id,
				requestId: operation.id,
				...(target ? { visibility: "org", tenantId: target } : {}),
				...(existing ? {} : policy),
			});
		},
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: hubLinksKey });
		},
	});
	// Established origins already publish through the bound Hub links preview;
	// this initial route must not guess that POST is a conditional republish.
	if (!enabled || (!open && (origins.length > 0 || unresolved))) return null;
	const blocked =
		!isAuthenticated ||
		!links.isSuccess ||
		!!existing ||
		!!other ||
		!!unresolved ||
		(!!target && !org);
	return (
		<>
			<Button
				variant="outline"
				disabled={!isAuthenticated || !links.isSuccess}
				onClick={() => {
					setOpen(true);
					setTarget(null);
					setPolicy(newHubPolicy());
					request.current = null;
					publication.reset();
				}}
			>
				{t("ui.hub.subscriptions.preview_publish")}
			</Button>
			<Dialog
				open={open}
				onOpenChange={(value) => {
					if (!publication.isPending) setOpen(value);
				}}
			>
				<DialogContent
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						cancel.current?.focus();
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{t("ui.hub.subscriptions.preview_publish")}
						</DialogTitle>
						<DialogDescription>
							{t("ui.hub.skills.initial_policy_description")}
						</DialogDescription>
					</DialogHeader>
					<label htmlFor={`${id}-target`} className="text-body-sm text-ink">
						{source}
					</label>
					<select
						id={`${id}-target`}
						disabled={publication.isPending || publication.isSuccess}
						value={target ?? ""}
						className="rounded-md border border-control bg-surface px-3 py-2 text-body-sm text-ink"
						onChange={(event) => {
							setTarget(event.target.value || null);
							setPolicy(newHubPolicy());
							request.current = null;
						}}
					>
						<option value="">{t("ui.hub.links.source_public")}</option>
						{organizations.map((row) => (
							<option key={row.tenant_id} value={row.tenant_id}>
								{row.tenant_name}
							</option>
						))}
					</select>
					{other ? (
						<p className="text-body-sm text-warning">
							{t("ui.hub.subscriptions.source_separation", {
								currentSource: hubLinkSourceName(other),
								newSource: source,
							})}
						</p>
					) : unresolved ? (
						<p className="text-body-sm text-warning">
							{t("ui.hub.links.source_unavailable")}
						</p>
					) : existing ? (
						<HubLinkPolicyControls link={existing} />
					) : (
						<HubInitialPolicyFields
							value={policy}
							onChange={setPolicy}
							source={source}
							item={team.name}
							visibility={target ? "org" : "public"}
							organization={org?.tenant_name ?? null}
							destinationKey={`${team.id}:${target ?? "public"}`}
							canEnableAutoPush={false}
							disabled={
								blocked || publication.isPending || publication.isSuccess
							}
						/>
					)}
					{links.error && (
						<p role="alert" className="text-body-sm text-warning">
							{t("ui.hub.links.load_failed")}
						</p>
					)}
					{publication.error && (
						<p role="alert" className="text-body-sm text-danger">
							{t("ui.hub.links.action_failed", {
								direction: t("ui.hub.links.direction_push"),
								item: team.name,
								source,
							})}
						</p>
					)}
					{publication.isSuccess && (
						<output className="text-body-sm text-ink">
							{publicationPolicyAcknowledged(publication.data)
								? t("ui.hub.links.published", { item: team.name, source })
								: t("ui.hub.skills.policy_pending")}
						</output>
					)}
					<DialogFooter>
						<Button
							ref={cancel}
							variant="outline"
							disabled={publication.isPending}
							onClick={() => setOpen(false)}
						>
							{t("ui.hub.subscriptions.cancel")}
						</Button>
						<Button
							disabled={
								blocked || publication.isPending || publication.isSuccess
							}
							onClick={() => publication.mutate()}
						>
							{t("ui.hub.links.confirm_publish")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
