import {
	HubInitialPolicyFields,
	newHubPolicy,
} from "@features/agents/components/hub-initial-policy-fields";
import { hubLinkSourceName } from "@features/agents/components/hub-link-policy-controls";
import { hubSkillsSupported } from "@shared/api/radient/skills-api";
import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { Textarea } from "@shared/components/ui/textarea";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useId, useRef, useState } from "react";
import {
	type HubSkillScope,
	usePullHubSkill,
	useRemoteSkill,
	useRemoteSkills,
} from "../hooks/use-hub-skills";
import { HubPager } from "./hub-pager";
import { HubSkillPublication } from "./hub-skill-publication";

/**
 * A sibling inside the existing hub panel, not a new navigation tree. Scope
 * is explicit and keys the child mount, so private data cannot survive a public
 * scope switch. Inventory refetches do not re-key the publication draft/editor.
 */
export function HubSkillsLibrary({
	scope,
	signedIn,
	accessible = true,
}: { scope: HubSkillScope; signedIn: boolean; accessible?: boolean }) {
	useI18nLocale();
	const id = useId();
	const [page, setPage] = useState(1);
	const [filter, setFilter] = useState("");
	const [selected, setSelected] = useState<string | null>(null);
	const [alias, setAlias] = useState("");
	const [policy, setPolicy] = useState(newHubPolicy);
	const request = useRef<{ tuple: string; id: string } | null>(null);
	const source =
		scope.visibility === "public"
			? t("ui.hub.links.source_public")
			: scope.organization
				? t("ui.hub.links.source_private", { organization: scope.organization })
				: t("ui.hub.links.source_unavailable");
	const catalogue = useRemoteSkills(
		scope,
		page,
		accessible && (scope.visibility === "public" || signedIn),
	);
	const supported = hubSkillsSupported(catalogue.data?.contract);
	const detail = useRemoteSkill(scope, selected, supported && accessible);
	const pull = usePullHubSkill();
	const pulledLinkId = pull.data?.link?.link_id;
	const scopeMatches =
		detail.data?.visibility === scope.visibility &&
		(scope.visibility === "public"
			? !detail.data.tenant_id
			: detail.data.tenant_id === scope.tenantId);
	const ready =
		accessible &&
		!detail.error &&
		!catalogue.error &&
		scopeMatches &&
		hubSkillsSupported(detail.data?.sync_contract) &&
		!!detail.data?.revision;
	const rows = (catalogue.data?.rows ?? []).filter((row) =>
		`${row.name} ${row.description}`
			.toLocaleLowerCase()
			.includes(filter.toLocaleLowerCase()),
	);
	const install = () => {
		if (!selected || !ready || !alias || pull.isPending || !signedIn) return;
		const tuple = JSON.stringify({ selected, scope, alias, policy });
		if (request.current?.tuple !== tuple)
			request.current = { tuple, id: crypto.randomUUID() };
		pull.mutate({
			requestId: request.current.id,
			remoteId: selected,
			scope,
			alias,
			subscribe: policy.subscribe,
			autoPush: policy.autoPush,
			consent: policy.confirmPublicEgress,
		});
	};
	return (
		<section className="flex min-w-0 flex-col gap-5" data-hub-skills-library>
			<header className="flex flex-wrap items-center justify-between gap-3">
				<h2 className="text-heading text-ink">{t("ui.hub.skills.title")}</h2>
				<span className="text-meta text-ink-muted">{source}</span>
			</header>
			{scope.visibility === "org" && !signedIn ? (
				<p role="alert" className="text-body-sm text-warning">
					{t("ui.hub.status.no_credential")}
				</p>
			) : (
				<>
					<label className="sr-only" htmlFor={`${id}-search`}>
						{t("ui.hub.skills.search")}
					</label>
					<Input
						id={`${id}-search`}
						value={filter}
						placeholder={t("ui.hub.skills.search")}
						onChange={(event) => setFilter(event.target.value)}
					/>
					<p className="text-meta text-ink-muted">
						{t("ui.hub.skills.search_loaded")}
					</p>
					{catalogue.isLoading && (
						<output className="min-h-20 text-body-sm text-ink-muted">
							{t("ui.hub.skills.loading")}
						</output>
					)}
					{catalogue.error && (
						<div
							role="alert"
							className="flex flex-col gap-2 text-body-sm text-warning"
						>
							<p>{t("ui.hub.skills.catalogue_failed", { source })}</p>
							<Button
								variant="outline"
								disabled={catalogue.isFetching}
								onClick={() => void catalogue.refetch()}
							>
								{t("ui.hub.links.retry")}
							</Button>
						</div>
					)}
					{catalogue.isSuccess && !supported && (
						<p className="text-body-sm text-warning">
							{t("ui.hub.skills.unavailable")}
						</p>
					)}
					{supported && (
						<>
							{rows.length === 0 && (
								<p className="text-body-sm text-ink-muted">
									{t(
										filter
											? "ui.hub.skills.search_empty"
											: "ui.hub.skills.remote_empty",
									)}
								</p>
							)}
							<div className="grid min-w-0 gap-3 sm:grid-cols-2">
								{rows.map((row) => (
									<div
										key={row.id}
										className="flex min-w-0 flex-col gap-3 rounded-md border border-hairline p-4"
									>
										<h3 className="break-words text-body-sm font-medium text-ink">
											{row.name}
										</h3>
										<p className="break-words text-meta text-ink-muted">
											{row.description}
										</p>
										<Button
											variant="outline"
											aria-pressed={selected === row.id}
											disabled={pull.isPending}
											onClick={() => {
												setSelected(row.id);
												setAlias(row.name);
												setPolicy(newHubPolicy());
												pull.reset();
											}}
										>
											{t("ui.hub.skills.open_detail", { item: row.name })}
										</Button>
									</div>
								))}
							</div>
							<HubPager
								page={page}
								count={catalogue.data?.pages ?? 1}
								onChange={setPage}
								ariaLabel={t("ui.hub.skills.title")}
							/>
						</>
					)}
				</>
			)}
			{selected && supported && (
				<section
					className="flex min-w-0 flex-col gap-3 border-t border-hairline pt-4"
					data-hub-skill-detail
				>
					{detail.isLoading && (
						<output className="text-meta text-ink-muted">
							{t("ui.hub.skills.loading")}
						</output>
					)}
					{detail.error && (
						<p role="alert" className="text-body-sm text-warning">
							{t("ui.hub.status.other_error")}
						</p>
					)}
					{detail.data && scopeMatches && (
						<>
							<h3 className="break-words text-heading text-ink">
								{detail.data.name}
							</h3>
							<p className="text-meta text-ink-muted">
								{t("ui.hub.skills.file_count", {
									count: detail.data.files.length,
								})}
							</p>
							{detail.data.files.map((file) => (
								<details key={file.path} className="min-w-0">
									<summary className="break-words text-mono-sm text-ink">
										{file.path}
									</summary>
									<Textarea
										readOnly
										rows={12}
										aria-label={file.path}
										value={file.content}
										className="max-h-96 bg-sunken text-mono-sm"
									/>
								</details>
							))}
							<label htmlFor={`${id}-alias`} className="text-body-sm text-ink">
								{t("ui.hub.subscriptions.alias")}
							</label>
							<Input
								id={`${id}-alias`}
								value={alias}
								disabled={pull.isPending}
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
								{t("ui.hub.skills.pull_help")}
							</p>
							<HubInitialPolicyFields
								value={policy}
								onChange={setPolicy}
								source={source}
								item={alias}
								visibility={scope.visibility}
								organization={scope.organization}
								destinationKey={`${scope.visibility}:${scope.tenantId ?? ""}:${selected}`}
								canEnableAutoPush={!!ready}
								disabled={pull.isPending}
							/>
							<Button
								disabled={!signedIn || !ready || !alias || pull.isPending}
								onClick={install}
							>
								{t("ui.hub.subscriptions.create_copy")}
							</Button>
						</>
					)}
					{!signedIn && (
						<p className="text-meta text-ink-muted">
							{t("ui.hub.status.no_credential")}
						</p>
					)}
					{(pull.error ||
						(pull.data &&
							!pull.data.reports?.some(
								(report) => report.applied || report.outcome === "unchanged",
							))) && (
						<p role="alert" className="text-body-sm text-danger">
							{t("ui.hub.skills.pull_failed")}
						</p>
					)}
					{pull.data?.link &&
						pull.data.reports?.some(
							(report) =>
								report.link_id === pulledLinkId &&
								report.direction === "pull" &&
								report.applied,
						) && (
							<output className="text-body-sm text-ink">
								{t("ui.hub.skills.installed_alias", {
									item: pull.data.link.name,
									source: hubLinkSourceName(pull.data.link),
								})}
							</output>
						)}
					{pull.data?.link && (
						<p className="text-meta text-ink-muted">
							{t("ui.hub.skills.session_selection")}
						</p>
					)}
				</section>
			)}
			{!accessible && (
				<p role="alert" className="text-body-sm text-warning">
					{t("ui.hub.status.access_lost")}
				</p>
			)}
			<div className="border-t border-hairline pt-5">
				<HubSkillPublication
					scope={scope}
					source={source}
					verifiedCas={supported && accessible && signedIn}
					enabled={supported && accessible && signedIn}
				/>
			</div>
		</section>
	);
}
