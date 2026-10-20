import {
	HubInitialPolicyFields,
	newHubPolicy,
} from "@features/agents/components/hub-initial-policy-fields";
import { hubLinkSourceName } from "@features/agents/components/hub-link-policy-controls";
import { hubReasonText } from "@features/agents/hub-link-copy";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	type InitialSkillPublicationPreview,
	type SkillPublicationDraft,
	initialSkillPreviewMatches,
	publicationPolicyAcknowledged,
} from "@shared/api/local-operator/hub-publication";
import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { Textarea } from "@shared/components/ui/textarea";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import {
	type HubSkillScope,
	useInitialSkillPublication,
} from "../hooks/use-hub-skills";

/**
 * Selected discovery source stays read-only; managed alias is explicit. Draft
 * state is independent of inventory so policy/pull refresh cannot erase typing.
 * The exact server-projected manifest is confirmed via the core-bound receipt,
 * never reconstructed from summary data, a private copy, or a fake link ID.
 */
export function HubSkillPublication({
	scope,
	source,
	verifiedCas,
	enabled = true,
	heading = true,
}: {
	scope: HubSkillScope;
	source: string;
	verifiedCas: boolean;
	enabled?: boolean;
	/** False when a dialog already names the surface (design round 2, D10). */
	heading?: boolean;
}) {
	useI18nLocale();
	const id = useId();
	const [sourceSkill, setSourceSkill] = useState("");
	const [alias, setAlias] = useState("");
	const [policy, setPolicy] = useState(newHubPolicy);
	const [preview, setPreview] = useState<InitialSkillPublicationPreview | null>(
		null,
	);
	const [changed, setChanged] = useState(false);
	const action = useInitialSkillPublication();
	const request = useRef<{ tuple: string; id: string } | null>(null);
	const installed = useQuery({
		queryKey: ["desktop", "skills", "hub-publication"],
		queryFn: () =>
			desktopResult<{
				data: { skills: { name: string; description?: string }[] };
			}>({ op: "skills.list" }),
		staleTime: 30_000,
		retry: false,
	});
	const destination = `${scope.visibility}:${scope.tenantId ?? ""}`;
	const destinationRef = useRef(destination);
	useEffect(() => {
		if (destinationRef.current === destination) return;
		destinationRef.current = destination;
		setPolicy((value) => ({
			...value,
			autoPush: false,
			confirmPublicEgress: false,
		}));
		setPreview(null);
		setChanged(true);
	}, [destination]);
	const draft: SkillPublicationDraft = {
		sourceSkill,
		localAlias: alias,
		visibility: scope.visibility,
		tenantId: scope.tenantId,
		...policy,
	};
	// Compare the actual draft tuple, not list object identity. Query refreshes
	// change options only; a changed draft cannot confirm the old payload.
	const current = preview ? initialSkillPreviewMatches(preview, draft) : false;
	useEffect(() => {
		if (!preview) return;
		const timer = setTimeout(
			() => {
				setPreview(null);
				setChanged(true);
			},
			Math.max(
				0,
				Math.min(Date.parse(preview.expires_at) - Date.now(), 2_147_483_647),
			),
		);
		return () => clearTimeout(timer);
	}, [preview]);
	const run = (confirm: boolean) => {
		if (
			!enabled ||
			action.isPending ||
			!sourceSkill ||
			!alias ||
			(confirm && !current)
		)
			return;
		const tuple = JSON.stringify({
			draft,
			receipt: confirm ? preview?.preview_receipt : null,
		});
		// Lost-response replay keeps the original operation; a successful fresh
		// preview is a new review, not re-use of a possibly expired proposal.
		const operation =
			request.current &&
			request.current.tuple === tuple &&
			(confirm || action.error)
				? request.current
				: { tuple, id: crypto.randomUUID() };
		request.current = operation;
		if (!confirm) {
			setPreview(null);
			setChanged(false);
		}
		action.mutate(
			{
				requestId: operation.id,
				draft,
				...(confirm && preview
					? { previewReceipt: preview.preview_receipt }
					: {}),
			},
			{
				onSuccess: (result) => {
					if (result.preview) {
						setPreview(result.preview);
						setChanged(false);
					} else if (publicationPolicyAcknowledged(result)) setPreview(null);
					// Pending local reconciliation retains the originally viewed receipt;
					// remote success is not replaced by optimistic policy acknowledgement.
				},
			},
		);
	};
	return (
		<section className="flex min-w-0 flex-col gap-4" data-hub-skill-publication>
			{heading && (
				<h3 className="text-heading text-ink">
					{t("ui.hub.skills.publish_title")}
				</h3>
			)}
			<label htmlFor={`${id}-source`} className="text-body-sm text-ink">
				{t("ui.hub.skills.select_authored")}
			</label>
			<select
				id={`${id}-source`}
				data-testid="hub-skill-publish-source"
				value={sourceSkill}
				disabled={action.isPending || !enabled}
				className="rounded-md border border-control bg-surface px-3 py-2 text-body-sm text-ink"
				onChange={(event) => {
					setSourceSkill(event.target.value);
					setAlias(event.target.value);
					setPreview(null);
					setPolicy((value) => ({
						...value,
						autoPush: false,
						confirmPublicEgress: false,
					}));
				}}
			>
				<option value="">{t("ui.hub.skills.select_authored")}</option>
				{installed.data?.data.skills.map((skill) => (
					<option key={skill.name} value={skill.name}>
						{skill.name}
					</option>
				))}
			</select>
			<label htmlFor={`${id}-alias`} className="text-body-sm text-ink">
				{t("ui.hub.subscriptions.alias")}
			</label>
			<Input
				id={`${id}-alias`}
				data-testid="hub-skill-publish-alias"
				value={alias}
				disabled={action.isPending || !enabled}
				onChange={(event) => {
					setAlias(event.target.value);
					setPolicy((value) => ({
						...value,
						autoPush: false,
						confirmPublicEgress: false,
					}));
				}}
			/>
			<p className="text-meta text-ink-muted">
				{t("ui.hub.skills.text_limits")}
			</p>
			<HubInitialPolicyFields
				value={policy}
				onChange={setPolicy}
				source={source}
				item={sourceSkill || alias}
				visibility={scope.visibility}
				organization={scope.organization}
				destinationKey={`${destination}:${sourceSkill}`}
				canEnableAutoPush={verifiedCas}
				disabled={action.isPending || !enabled}
			/>
			{installed.isLoading && (
				<output className="text-meta text-ink-muted">
					{t("ui.hub.skills.loading")}
				</output>
			)}
			{installed.error && (
				<p role="alert" className="text-body-sm text-danger">
					{t("ui.hub.status.other_error")}
				</p>
			)}
			{action.error && (
				<p role="alert" className="text-body-sm text-danger">
					{t("ui.hub.links.action_failed", {
						direction: t("ui.hub.links.direction_push"),
						item: sourceSkill || alias,
						source,
					})}
				</p>
			)}
			{(changed || (preview && !current && preview.can_confirm)) && (
				<p role="alert" className="text-body-sm text-warning">
					{t("ui.hub.links.preview_changed")}
				</p>
			)}
			{preview &&
				preview.visibility === scope.visibility &&
				preview.tenant_id === scope.tenantId && (
					<div className="flex min-w-0 flex-col gap-3">
						<h4 className="text-body-sm text-ink">
							{t("ui.hub.links.preview_payload", { source })}
						</h4>
						<Textarea
							readOnly
							rows={12}
							aria-label={t("ui.hub.links.preview_payload", { source })}
							value={JSON.stringify(preview.proposal.fields, null, 2)}
							className="max-h-96 bg-sunken text-mono-sm"
						/>
						{preview.warnings.map((warning, index) => (
							<p
								key={`${index}-${warning}`}
								className="break-words text-body-sm text-warning"
							>
								{warning}
							</p>
						))}
						{preview.reason && (
							<p className="text-body-sm text-warning">
								{hubReasonText(preview.reason)}
							</p>
						)}
					</div>
				)}
			{/* An explicit202/null outcome is not remote success or safe re-create.
			 * Same-operation replay and timeout handling follow the frozen engine
			 * contract; this status must never reuse "Publication succeeded". */}
			{action.data?.publication === null &&
				action.data.local_link_receipt?.state === "pending-reconciliation" && (
					<output
						className="text-body-sm text-warning"
						data-testid="hub-skill-pending-reconcile"
					>
						{t("ui.hub.links.publication_pending")}
					</output>
				)}
			{action.data?.publication && (
				<output
					className="text-body-sm text-ink"
					data-testid="hub-skill-published"
				>
					{publicationPolicyAcknowledged(action.data)
						? t("ui.hub.links.published", {
								item: action.data.link?.name ?? alias,
								source: action.data.link
									? hubLinkSourceName(action.data.link)
									: source,
							})
						: t("ui.hub.skills.policy_pending")}
				</output>
			)}
			<div className="flex flex-wrap gap-2">
				<Button
					variant="outline"
					data-testid="hub-skill-publish-preview"
					disabled={!enabled || action.isPending || !sourceSkill || !alias}
					onClick={() => run(false)}
				>
					{t("ui.hub.subscriptions.preview_publish")}
				</Button>
				<Button
					data-testid="hub-skill-publish-confirm"
					disabled={!enabled || action.isPending || !current}
					onClick={() => run(true)}
				>
					{t("ui.hub.links.confirm_publish")}
				</Button>
			</div>
		</section>
	);
}
