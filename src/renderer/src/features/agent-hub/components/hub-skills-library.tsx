import {
	HubInitialPolicyFields,
	newHubPolicy,
} from "@features/agents/components/hub-initial-policy-fields";
import {
	HubLinkPolicyControls,
	hubLinkSourceName,
} from "@features/agents/components/hub-link-policy-controls";
import { HubUpdatePanel } from "@features/agents/components/hub-update-panel";
import { HubStateIcon } from "@features/chat/components/hub-update-mark";
import { DesktopControlError } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useHubUpdates } from "@shared/api/local-operator/hub-hooks";
import { useHubLinks } from "@shared/api/local-operator/hub-link-hooks";
import {
	type HubLink,
	hubLinkContentState,
} from "@shared/api/local-operator/hub-links";
import {
	type HubMark,
	type HubUpdateItem,
	hubItemIndex,
	hubItemKey,
	hubMarkFor,
} from "@shared/api/local-operator/hub-updates";
import {
	type HubSkillRow,
	hubSkillsSupported,
} from "@shared/api/radient/skills-api";
import { Button } from "@shared/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { Input } from "@shared/components/ui/input";
import { Textarea } from "@shared/components/ui/textarea";
import { apiConfig } from "@shared/config";
import { type WithoutParams, t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useId, useMemo, useRef, useState } from "react";
import {
	type HubSkillScope,
	usePullHubSkill,
	useRemoteSkill,
	useRemoteSkills,
	useSubscribeHubSkill,
	useUnpullHubSkill,
} from "../hooks/use-hub-skills";
import {
	type HubSkillState,
	hubSkillKey,
	hubSkillLinkIndex,
	hubSkillState,
	skillRowInScope,
} from "../hub-skill-state";
import { HubPager } from "./hub-pager";
import { HubSkillPublication } from "./hub-skill-publication";

/**
 * The chip's ink follows the SAME mark vocabulary as the sidebar and the update
 * panel: a waiting update is accent (an action to take), an applied one is
 * success (a finished fact). They must not look alike — the whole point of the
 * per-skill state line is telling "an update is waiting" from "one was applied".
 */
const MARK_INK: Record<HubMark["kind"], string> = {
	available: "text-accent",
	applied: "text-success",
	failed: "text-danger",
	review: "text-warning",
	updating: "text-ink-muted",
};

/** The mark vocabulary's own labels, reused rather than re-worded per surface. */
const MARK_KEY: Record<HubMark["kind"], WithoutParams> = {
	available: "ui.hub.links.mark_available",
	applied: "ui.hub.links.mark_applied",
	failed: "ui.hub.links.mark_failed",
	review: "ui.hub.links.mark_review",
	updating: "ui.hub.links.mark_busy",
};

/**
 * The state sentence for a skill with no mark to draw. `update` has its own
 * mark below (and never reaches this table), and `not-present` is the honest
 * "this machine has no link to it" — not an error.
 */
const STATE_KEY: Record<
	Exclude<HubSkillState["kind"], "update">,
	WithoutParams
> = {
	"not-present": "ui.hub.skills.not_downloaded",
	subscribed: "ui.hub.skills.subscribed_absent",
	pulled: "ui.hub.skills.pulled",
	manual: "ui.hub.skills.manual",
	detached: "ui.hub.skills.detached",
};

/**
 * The refusal code behind a failed write, when the failure carried one.
 *
 * Core answers an alias collision and a confirmed-origin conflict with the same
 * `origin-conflict` code, and that is the one failure with a remedy the
 * generic sentences cannot name: choose another local alias.
 */
function refusalCode(error: unknown): string | undefined {
	return error instanceof DesktopControlError ? error.code : undefined;
}

/**
 * The mark a skill row draws, from the state that already decided what is true.
 *
 * An `available` updates row exists for a skill with NO copy too (core reports
 * the remote revision with `local: null`), so the mark cannot be drawn straight
 * from the updates store: that would label a skill that is not installed
 * "update available" and hide the Download that is actually next. Only an
 * `update` state earns that mark. A FAILURE is different and is drawn in every
 * state: it is the reason a check did not land, and it rides the same channel as
 * agents and teams.
 */
function skillMark(
	state: HubSkillState,
	update: HubUpdateItem | undefined,
): HubMark | null {
	if (state.kind === "update")
		return (
			(update ? hubMarkFor(update) : null) ?? {
				kind: "available",
				auto: state.automatic,
			}
		);
	if (update && (update.state === "failed" || update.error_class))
		return hubMarkFor(update);
	return null;
}

function SkillMarkChip({ mark }: { mark: HubMark | null }) {
	useI18nLocale();
	if (!mark) return null;
	return (
		<span
			data-hub-mark-state={mark.kind}
			className={cn(
				"flex shrink-0 items-center gap-1 text-meta",
				MARK_INK[mark.kind],
			)}
		>
			<HubStateIcon mark={mark} />
			<span>{t(MARK_KEY[mark.kind])}</span>
		</span>
	);
}

/**
 * The publisher/maintainer line, from the row's OWN facts only.
 *
 * The public skill row carries no publisher today (unlike an agent's
 * `account_metadata`), so this never invents one: it renders `publisher` when a
 * hub sends it and otherwise states the source the row actually came from —
 * the organization for an org skill, the public-hub label otherwise. An empty
 * "Published by" sentence would be worse than the honest scope line.
 */
function skillPublisherLine(
	row: HubSkillRow,
	organization: string | null,
): string {
	const publisher = row.publisher?.trim();
	if (publisher) return t("ui.hub.skills.published_by", { publisher });
	if (row.visibility === "org")
		return organization
			? t("ui.hub.links.source_private", { organization })
			: t("ui.hub.links.source_unavailable");
	return t("ui.hub.links.source_public");
}

/**
 * A sibling inside the existing hub panel, not a new navigation tree. Scope
 * is explicit and keys the child mount, so private data cannot survive a public
 * scope switch. Inventory refetches do not re-key the publication draft/editor.
 *
 * The card is the click target: the whole row is one real button, keyboard
 * reachable, because a button inside a non-interactive div reads as a card and
 * behaves as a form control — the wrong promise for a grid a person scans.
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
	const [confirmUnpull, setConfirmUnpull] = useState(false);
	const request = useRef<{ tuple: string; id: string } | null>(null);
	const source =
		scope.visibility === "public"
			? t("ui.hub.links.source_public")
			: scope.organization
				? t("ui.hub.links.source_private", { organization: scope.organization })
				: t("ui.hub.links.source_unavailable");
	const capabilities = useDesktopCapabilities();
	const updatesEnabled =
		accessible && desktopFeatureEnabled(capabilities.data, "hub_updates");
	const catalogue = useRemoteSkills(
		scope,
		page,
		accessible && (scope.visibility === "public" || signedIn),
	);
	const supported = hubSkillsSupported(catalogue.data?.contract);
	const detail = useRemoteSkill(scope, selected, supported && accessible);
	const pull = usePullHubSkill();
	const subscribe = useSubscribeHubSkill();
	const unpull = useUnpullHubSkill();
	// The local inventory is a desktop read, not a hub read: it answers for the
	// public scope without a credential, and a signed-out person still sees which
	// skills this machine already holds.
	const links = useHubLinks(
		accessible && desktopFeatureEnabled(capabilities.data, "hub_links"),
	);
	// One updates read for the whole grid: the store is already the hub's single
	// status channel, and a per-card query would be a second one in disguise.
	const updates = useHubUpdates(updatesEnabled);
	const linkIndex = useMemo(
		() => hubSkillLinkIndex(links.data?.links, apiConfig.radientBaseUrl),
		[links.data],
	);
	const updateIndex = useMemo(() => hubItemIndex(updates.data), [updates.data]);
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
	/*
	 * Defence in depth, not the admission rule: the server already refuses to
	 * serve a private row outside its tenant. A cached page, a retained callback
	 * or a future proxy bug must not draw one here, so the renderer re-checks the
	 * row's own scope before it renders anything.
	 */
	const rows = (catalogue.data?.rows ?? [])
		.filter((row) => skillRowInScope(row, scope))
		.filter((row) =>
			`${row.name} ${row.description}`
				.toLocaleLowerCase()
				.includes(filter.toLocaleLowerCase()),
		);
	const selectedRow = rows.find((row) => row.id === selected);
	const selectedLink = selectedRow
		? linkIndex.get(
				hubSkillKey({
					id: selectedRow.id,
					visibility: selectedRow.visibility,
					tenantId: selectedRow.tenant_id ?? null,
				}),
			)
		: undefined;
	const selectedUpdate = selectedLink
		? updateIndex.get(hubItemKey("skill", selectedLink.name))
		: undefined;
	const selectedState = hubSkillState(selectedLink, selectedUpdate);
	const linkStateFor = (row: HubSkillRow) => {
		const link = linkIndex.get(
			hubSkillKey({
				id: row.id,
				visibility: row.visibility,
				tenantId: row.tenant_id ?? null,
			}),
		);
		const update = link
			? updateIndex.get(hubItemKey("skill", link.name))
			: undefined;
		return { link, update, state: hubSkillState(link, update) };
	};
	/** One request id per (op, inputs) tuple, so a retry after a lost answer replays. */
	const requestIdFor = (tuple: string) => {
		if (request.current?.tuple !== tuple)
			request.current = { tuple, id: crypto.randomUUID() };
		return request.current.id;
	};
	const runPull = (forLink?: HubLink) => {
		if (!selected || !ready || !signedIn) return;
		const localAlias = forLink?.name ?? alias;
		if (!localAlias) return;
		pull.mutate({
			requestId: requestIdFor(
				JSON.stringify({ op: "pull", selected, scope, localAlias }),
			),
			remoteId: selected,
			scope,
			alias: localAlias,
			// A plain download does NOT subscribe; an existing link keeps the
			// subscription it already has, because a download is not a policy edit.
			subscribe: forLink ? forLink.policy.subscribe : false,
			autoPush: forLink?.policy.auto_push ?? false,
			// Consent is an affirmative act, never re-asserted by a pull: an existing
			// link already holds (or deliberately lacks) its egress grant.
			consent: false,
		});
	};
	const runSubscribe = () => {
		if (!selected || !ready || !signedIn) return;
		const localAlias = selectedLink?.name ?? alias;
		if (!localAlias) return;
		subscribe.mutate({
			requestId: requestIdFor(
				JSON.stringify({ op: "subscribe", selected, scope, localAlias }),
			),
			remoteId: selected,
			scope,
			alias: localAlias,
		});
	};
	const runUnpull = () => {
		if (!selectedLink) return;
		unpull.mutate({
			requestId: requestIdFor(
				JSON.stringify({ op: "unpull", link: selectedLink.link_id }),
			),
			linkId: selectedLink.link_id,
		});
	};
	const install = () => {
		if (!selected || !ready || !alias || pull.isPending || !signedIn) return;
		pull.mutate({
			requestId: requestIdFor(
				JSON.stringify({ op: "install", selected, scope, alias, policy }),
			),
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
				<span
					className="text-meta text-ink-muted"
					data-testid="hub-skill-source"
				>
					{source}
				</span>
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
						data-testid="hub-skill-search"
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
							<ul className="grid min-w-0 list-none gap-3 p-0 sm:grid-cols-2">
								{rows.map((row) => {
									const joined = linkStateFor(row);
									const mark = skillMark(joined.state, joined.update);
									return (
										<li key={row.id} className="min-w-0">
											<button
												type="button"
												aria-pressed={selected === row.id}
												data-testid="hub-skill-open"
												data-skill-id={row.id}
												data-skill-state={joined.state.kind}
												disabled={pull.isPending}
												onClick={() => {
													setSelected(row.id);
													setAlias(row.name);
													setPolicy(newHubPolicy());
													pull.reset();
													subscribe.reset();
													unpull.reset();
												}}
												/*
												 * The Agents/Teams card shape: a surface-filled block with a
												 * name, a clamped description and one meta line. Full-bleed inside
												 * the cell so the whole card is the target, and `text-left`
												 * because a button centres its text by default.
												 */
												className="flex h-full w-full min-w-0 flex-col gap-2 rounded-md bg-surface p-4 text-left hover:bg-row-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1 disabled:text-ink-dim"
											>
												<span className="flex items-start justify-between gap-3">
													<span className="break-words font-medium text-body-sm text-ink">
														{row.name}
													</span>
													<SkillMarkChip mark={mark} />
												</span>
												{row.description ? (
													<span className="line-clamp-3 max-w-3xl break-words text-meta text-ink-muted">
														{row.description}
													</span>
												) : null}
												<span className="flex flex-wrap items-baseline gap-x-2 text-meta">
													<span className="text-ink-muted">
														{skillPublisherLine(row, scope.organization)}
													</span>
													{joined.state.kind !== "update" ? (
														<span className="text-ink-dim">
															{t(STATE_KEY[joined.state.kind])}
														</span>
													) : null}
												</span>
											</button>
										</li>
									);
								})}
							</ul>
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
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="min-w-0">
									<h3 className="break-words text-heading text-ink">
										{detail.data.name}
									</h3>
									<p className="text-meta text-ink-muted">
										{skillPublisherLine(
											selectedRow ?? detail.data,
											scope.organization,
										)}
									</p>
								</div>
								<SkillMarkChip
									mark={skillMark(selectedState, selectedUpdate)}
								/>
							</div>
							<p
								className="max-w-3xl select-text whitespace-pre-wrap break-words text-body-sm text-ink-muted"
								data-testid="hub-skill-description"
							>
								{detail.data.description}
							</p>
							<p className="text-meta text-ink-muted">
								{t(
									STATE_KEY[
										selectedState.kind === "update"
											? "pulled"
											: selectedState.kind
									],
								)}{" "}
								·{" "}
								{t("ui.hub.skills.revision", {
									revision: `${detail.data.content_revision} · ${detail.data.revision}`,
								})}
							</p>
							{selectedLink?.local_path &&
								selectedState.kind !== "subscribed" &&
								selectedState.kind !== "detached" && (
									<p
										className="break-all font-mono text-meta text-ink-dim"
										data-testid="hub-skill-local-path"
									>
										{t("ui.hub.skills.local_path", {
											path: selectedLink.local_path,
										})}
									</p>
								)}
							<h4 className="text-body-sm text-ink">
								{t("ui.hub.skills.files")}
							</h4>
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
							{/*
							 * Subscribe is the INBOUND switch and the same control the
							 * sidebar uses, so a policy edited here and one edited there
							 * cannot disagree. Unsubscribing never deletes the copy.
							 */}
							{selectedLink && (
								<div className="border-t border-hairline pt-3">
									<HubLinkPolicyControls link={selectedLink} />
								</div>
							)}
							{/*
							 * The updates channel, not a parallel status story: the same
							 * panel the Agents and Teams detail mounts, which carries the
							 * per-row state, the merge preview and Retry.
							 */}
							{selectedLink && (
								<HubUpdatePanel
									kind="skill"
									name={selectedLink.name}
									enabled={updatesEnabled}
								/>
							)}
							<label htmlFor={`${id}-alias`} className="text-body-sm text-ink">
								{t("ui.hub.subscriptions.alias")}
							</label>
							<Input
								id={`${id}-alias`}
								data-testid="hub-skill-alias"
								value={selectedLink?.name ?? alias}
								disabled={pull.isPending || !!selectedLink}
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
							{/*
							 * TWO ACTS, NOT ONE WITH A FLAG.
							 *
							 * Download writes the copy once and leaves the subscription
							 * alone; Subscribe records the destination and future revisions
							 * and writes no files. Both are offered for an unlinked skill,
							 * and an already-linked one keeps whichever state it has.
							 */}
							<div className="flex flex-wrap gap-2">
								{/*
								 * Download is offered whenever there is no copy to read: an
								 * unlinked skill, a subscribed-but-absent one (its PRIMARY act), and
								 * a waiting update (where it is a manual pull, so it takes the
								 * existing pull vocabulary rather than the download label).
								 */}
								{(!selectedLink ||
									hubLinkContentState(selectedLink) === "absent" ||
									selectedState.kind === "update") && (
									<Button
										data-testid="hub-skill-download"
										variant={selectedLink ? "primary" : "outline"}
										disabled={!signedIn || !ready || pull.isPending}
										aria-label={t("ui.hub.skills.pull_title", {
											item: detail.data.name,
											source,
										})}
										onClick={() => runPull(selectedLink)}
									>
										{selectedState.kind === "update"
											? t("ui.hub.subscriptions.pull")
											: t("ui.hub.skills.download")}
									</Button>
								)}
								{/*
								 * ONLY for a skill with no link. Core leaves an existing link's
								 * subscription untouched by a subscribe (it is not a policy edit),
								 * so for a linked skill the Subscribe switch above is the one act
								 * that can turn it back on.
								 */}
								{!selectedLink && (
									<Button
										data-testid="hub-skill-subscribe"
										variant="outline"
										disabled={
											!signedIn || !ready || subscribe.isPending || !alias
										}
										onClick={runSubscribe}
									>
										{t("ui.hub.subscriptions.subscribe")}
									</Button>
								)}
								{/* The SUBSCRIBE switch in the policy block above is the unsubscribe act:
								 * one control, so a second button cannot disagree with it, and turning it
								 * off never deletes the local copy (core keeps the files). */}
								{selectedLink &&
									selectedState.kind !== "subscribed" &&
									selectedState.kind !== "detached" && (
										<Button
											data-testid="hub-skill-unpull"
											variant="outline"
											disabled={unpull.isPending}
											onClick={() => {
												unpull.reset();
												setConfirmUnpull(true);
											}}
										>
											{t("ui.hub.skills.unpull")}
										</Button>
									)}
							</div>
							<Dialog
								open={confirmUnpull}
								onOpenChange={(open) => {
									if (!open) setConfirmUnpull(false);
								}}
							>
								<DialogContent>
									<DialogHeader>
										<DialogTitle>
											{t("ui.hub.skills.unpull_title", {
												item: detail.data.name,
											})}
										</DialogTitle>
										<DialogDescription>
											{t("ui.hub.skills.unpull_body")}
										</DialogDescription>
									</DialogHeader>
									<DialogFooter>
										<Button
											variant="outline"
											onClick={() => setConfirmUnpull(false)}
										>
											{t("ui.hub.subscriptions.cancel")}
										</Button>
										<Button
											data-testid="hub-skill-unpull-confirm"
											disabled={unpull.isPending}
											onClick={() => {
												runUnpull();
												setConfirmUnpull(false);
											}}
										>
											{t("ui.hub.skills.unpull")}
										</Button>
									</DialogFooter>
								</DialogContent>
							</Dialog>
							{!selectedLink && (
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
							)}
							{!selectedLink && (
								<Button
									data-testid="hub-skill-create"
									disabled={!signedIn || !ready || !alias || pull.isPending}
									onClick={install}
								>
									{t("ui.hub.subscriptions.create_copy")}
								</Button>
							)}
							{unpull.error && (
								<p
									role="alert"
									className="text-body-sm text-danger"
									data-testid="hub-skill-unpull-failed"
								>
									{t("ui.hub.skills.unpull_failed")}
								</p>
							)}
							{subscribe.error && (
								<p
									role="alert"
									className="text-body-sm text-danger"
									data-testid="hub-skill-subscribe-failed"
								>
									{t(
										refusalCode(subscribe.error) === "origin-conflict"
											? "ui.hub.skills.local_exists"
											: "ui.hub.skills.subscribe_failed",
									)}
								</p>
							)}
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
						<p
							role="alert"
							className="text-body-sm text-danger"
							data-testid="hub-skill-pull-failed"
						>
							{t(
								refusalCode(pull.error) === "origin-conflict"
									? "ui.hub.skills.local_exists"
									: "ui.hub.skills.pull_failed",
							)}
						</p>
					)}
					{pull.data?.link &&
						pull.data.reports?.some(
							(report) =>
								report.link_id === pulledLinkId &&
								report.direction === "pull" &&
								report.applied,
						) && (
							<output
								className="text-body-sm text-ink"
								data-testid="hub-skill-installed"
							>
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
