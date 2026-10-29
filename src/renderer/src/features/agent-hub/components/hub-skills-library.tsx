import { aliasConflict } from "@features/agent-hub/hub-skill-alias";
import {
	HubLinkPolicyControls,
	hubLinkSourceName,
} from "@features/agents/components/hub-link-policy-controls";
import { HubUpdatePanel } from "@features/agents/components/hub-update-panel";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useHubUpdates } from "@shared/api/local-operator/hub-hooks";
import { useHubLinkPolicy } from "@shared/api/local-operator/hub-link-hooks";
import { useHubLinks } from "@shared/api/local-operator/hub-link-hooks";
import {
	type HubLink,
	hubLinkContentState,
} from "@shared/api/local-operator/hub-links";
import {
	hubItemIndex,
	hubItemKey,
} from "@shared/api/local-operator/hub-updates";
import {
	type HubSkillRow,
	hubSkillsSupported,
	hubSourceAddress,
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
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Search } from "lucide-react";
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
	hubSkillKey,
	hubSkillLinkIndex,
	hubSkillState,
	skillPullRequestKey,
	skillRowInScope,
	skillSubscribeAct,
} from "../hub-skill-state";
import { HubPager } from "./hub-pager";
import { SkillMarkChip, skillMark, stateSentence } from "./hub-skill-mark";
import { HubSkillPublication } from "./hub-skill-publication";

/**
 * The publisher/maintainer line, from the row's OWN facts only.
 *
 * The public skill row carries no publisher today (unlike an agent's
 * `account_metadata`), so this never invents one: it renders `publisher` when a
 * hub sends it and otherwise states the source the row actually came from — the
 * organization's name for an org skill, the public-hub label otherwise. It does
 * not repeat the scope qualifier the toolbar already shows (design D2, UX U5):
 * the row says WHO, the browse bar says WHICH scope.
 */
function skillPublisherLine(
	row: HubSkillRow,
	organization: string | null,
): string {
	const publisher = row.publisher?.trim();
	if (publisher) return t("ui.hub.skills.published_by", { publisher });
	if (row.visibility === "org")
		return organization ?? t("ui.hub.links.source_unavailable");
	return t("ui.hub.skills.public_hub");
}

/**
 * A sibling inside the existing hub panel, not a new navigation tree. Scope is
 * explicit and keys the child mount, so private data cannot survive a public
 * scope switch.
 *
 * Shapes are the SIBLING surfaces', not a third family (design round 1, D1/D2):
 * the search is the Teams catalogue's icon field, the count line is the page's
 * own scope-aware sentence, and each card is the agent card's block — a heading
 * name, a clamped body-sm description, a provenance line, then a hairline and a
 * footer that carries the state. The whole card is one real button, so the click
 * target and the card are the same object.
 *
 * The detail is a modal, not a block under the grid (design round 1, D4): with a
 * full catalogue that block opened below the fold, so a press changed nothing
 * the person could see. The dialog also announces itself and takes focus, which
 * the inline block could not.
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
	const [confirmUnpull, setConfirmUnpull] = useState(false);
	/*
	 * Which policy act the pending/error line is about. One `policy` mutation
	 * serves both directions, so the sentence needs the attempt carried beside it
	 * (review round 2, N1) — a failed Subscribe must not read as a failed
	 * Unsubscribe.
	 */
	const [policyAct, setPolicyAct] = useState<"subscribe" | "unsubscribe">(
		"unsubscribe",
	);
	const [publishOpen, setPublishOpen] = useState(false);
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
	const policy = useHubLinkPolicy();
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
		() =>
			hubSkillLinkIndex(
				links.data?.links,
				hubSourceAddress(apiConfig.radientBaseUrl),
			),
		[links.data],
	);
	const updateIndex = useMemo(() => hubItemIndex(updates.data), [updates.data]);
	const pulledLinkId = pull.data?.link?.link_id;
	/*
	 * The inventory is a fact of its own: while it loads or after its own
	 * refusal, "no link row" is NOT "no link" (review round 1, minor 5).
	 */
	const inventoryReady = !links.isLoading && !links.error;
	const inventoryUnknown = links.error
		? t("ui.hub.skills.inventory_unknown")
		: t("ui.hub.links.loading");
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
	const scopedRows = (catalogue.data?.rows ?? []).filter((row) =>
		skillRowInScope(row, scope),
	);
	const rows = scopedRows.filter((row) =>
		`${row.name} ${row.description}`
			.toLocaleLowerCase()
			.includes(filter.toLocaleLowerCase()),
	);
	const selectedRow = scopedRows.find((row) => row.id === selected);
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
	const selectedState = hubSkillState(
		selectedLink,
		selectedUpdate,
		inventoryReady,
	);
	const hasCopy = selectedLink
		? hubLinkContentState(selectedLink) === "present"
		: false;
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
		return {
			link,
			update,
			state: hubSkillState(link, update, inventoryReady),
		};
	};
	/*
	 * One request id per (op, inputs) tuple, so a retry after a lost answer
	 * replays the same operation instead of minting a second one.
	 */
	const requestIdFor = (tuple: string) => {
		if (request.current?.tuple !== tuple)
			request.current = { tuple, id: crypto.randomUUID() };
		return request.current.id;
	};
	const runPull = (forLink?: HubLink) => {
		if (!selected || !ready || !signedIn) return;
		const localAlias = forLink?.name ?? selectedRow?.name ?? "";
		if (!localAlias) return;
		// Download does NOT subscribe, and never edits the subscription an
		// existing link already has: content and membership are separate facts.
		const subscribe = forLink ? forLink.policy.subscribe : false;
		const autoPush = forLink?.policy.auto_push ?? false;
		// Consent is an affirmative act, never re-asserted by a download.
		const consent = false;
		pull.mutate({
			requestId: requestIdFor(
				/*
				 * Every BODY-CHANGING field is in the tuple: core fingerprints the
				 * receipt's body and refuses a mismatch with 409, so an id reused
				 * with a different body blocked every retry until remount (review
				 * round 1, major 3).
				 */
				skillPullRequestKey({
					selected,
					scope,
					localAlias,
					subscribe,
					autoPush,
					consent,
				}),
			),
			remoteId: selected,
			scope,
			alias: localAlias,
			subscribe,
			autoPush,
			consent,
		});
	};
	const runSubscribe = () => {
		if (!selected || !ready || !signedIn) return;
		/*
		 * Subscribe has TWO wire forms, and the wrong one is a silent no-op:
		 * core's `hub.skillSubscribe` leaves an EXISTING link's policy untouched
		 * by design (review round 1, major 1), so a link created by Download,
		 * then Unpulled, stayed "Not installed — no updates" after a 200. A link
		 * is a policy patch; only the no-link case creates one.
		 */
		if (skillSubscribeAct(selectedLink) === "policy" && selectedLink) {
			if (selectedLink.policy.subscribe || policy.isPending) return;
			setPolicyAct("subscribe");
			policy.mutate({ link: selectedLink, patch: { subscribe: true } });
			return;
		}
		const localAlias = selectedRow?.name ?? "";
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
		unpull.mutate(
			{
				requestId: requestIdFor(
					JSON.stringify({ op: "unpull", link: selectedLink.link_id }),
				),
				linkId: selectedLink.link_id,
			},
			{
				/*
				 * A completed unpull makes the previous Download's success sentence a
				 * lie about the current state (review round 1, major 2): its mutation
				 * data outlives the cache invalidation, so reset it rather than let
				 * "Downloaded …" sit under "Subscribed — not installed".
				 */
				onSuccess: () => {
					pull.reset();
					subscribe.reset();
				},
			},
		);
	};
	const runUnsubscribe = () => {
		if (!selectedLink || selectedLink.policy.subscribe === false) return;
		/*
		 * The switch guards itself; the named button must too, or a double press
		 * sends two PATCHes at the same policy revision and the loser paints a
		 * failure over a successful unsubscribe (review round 1, minor 9).
		 */
		if (policy.isPending || !policy.canWrite) return;
		setPolicyAct("unsubscribe");
		policy.mutate({
			link: selectedLink,
			patch: { subscribe: false },
		});
	};
	const canPublish = signedIn && supported && accessible && !catalogue.error;
	/*
	 * The count line is TRANSLATED copy, not a template: a surface whose first
	 * sentence is half English (`2 skills in Hub público`) is the defect the
	 * translation audit named, and ICU owns the plural per locale.
	 */
	/*
	 * A FAILED catalogue shows its error and Retry only: a count over rows that
	 * never arrived ("0 skills · Public hub") states a fact the reader cannot
	 * trust, directly above the sentence saying the read failed (design round 2,
	 * D11).
	 *
	 * The scope is its own element for two reasons: the count string must not
	 * embed a scope noun a locale would have to decline (translation round 6),
	 * and the source line keeps the hook the driver scene reads.
	 */
	/*
	 * THE CATALOGUE'S TOTAL, not the rows this page happens to hold. The public
	 * listing is paginated and the response carries `total_records` (the hook
	 * exposes it as `total`), so counting rendered rows would print "20 skills"
	 * for a catalogue of fourteen or fourteen hundred alike - and would make this
	 * line disagree with the tab strip's count, which reads the same field. The
	 * fallback is for an unavailable/disabled read whose body never arrived; the
	 * line is already suppressed while loading or after a failure, so it is
	 * reached only by the inaccessible state, where zero rows is the honest
	 * reading.
	 *
	 * If `org_skills.list` ever grows pagination, read its `total_records` in
	 * preference to `.length`: the length would then be a page size, and this
	 * line - like the tab's - would state it as the catalogue's total, silently.
	 */
	const totalSkills = catalogue.data?.total ?? scopedRows.length;
	const countLine = catalogue.error
		? null
		: catalogue.isLoading
			? t("ui.hub.skills.loading")
			: scope.organization
				? t("ui.hub.skills.count_shared", {
						count: totalSkills,
						organization: scope.organization,
					})
				: t("ui.hub.skills.count", { count: totalSkills });

	return (
		<section className="flex min-w-0 flex-col gap-4" data-hub-skills-library>
			{scope.visibility === "org" && !signedIn ? (
				<p role="alert" className="text-body-sm text-warning">
					{t("ui.hub.status.no_credential")}
				</p>
			) : (
				<>
					<div className="flex flex-wrap items-center gap-2">
						<div
							className={cn(
								"flex min-w-56 max-w-md flex-1 items-center rounded-sm border border-control bg-surface",
								"transition-colors duration-fast ease-out-quart",
								"has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-2",
								"has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-offset-2",
							)}
						>
							<Search
								aria-hidden="true"
								className="ml-2 shrink-0 text-ink-dim"
							/>
							<Input
								id={`${id}-search`}
								type="search"
								data-testid="hub-skill-search"
								value={filter}
								placeholder={t("ui.hub.skills.search")}
								aria-label={t("ui.hub.skills.search")}
								onChange={(event) => setFilter(event.target.value)}
								className="h-8 min-w-0 flex-1 border-0 bg-transparent outline-none"
							/>
						</div>
						{/*
						 * Authoring is a write surface, so it is one press away and only
						 * offered when it can work (design round 1, D3/D7): a signed-out or
						 * failed-catalogue reader never sees a normal-looking disabled form
						 * consuming the catalogue's viewport.
						 */}
						{canPublish && (
							<Button
								variant="secondary"
								data-testid="hub-skill-publish-open"
								onClick={() => setPublishOpen(true)}
							>
								{t("ui.hub.skills.publish_title")}
							</Button>
						)}
					</div>
					{countLine !== null && (
						<p
							aria-live="polite"
							className="text-meta text-ink-dim"
							data-testid="hub-skill-status"
						>
							{scope.organization || catalogue.isLoading ? (
								<span data-testid="hub-skill-source">{countLine}</span>
							) : (
								<>
									<span>{countLine}</span>
									{" · "}
									<span data-testid="hub-skill-source">
										{t("ui.hub.skills.public_hub")}
									</span>
								</>
							)}
						</p>
					)}
					{catalogue.error && (
						<div
							role="alert"
							className="flex flex-col items-start gap-2 text-body-sm text-warning"
						>
							<p>{t("ui.hub.skills.catalogue_failed", { source })}</p>
							<Button
								variant="outline"
								className="self-start"
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
							<ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(17.5rem,1fr))] gap-6 p-0">
								{rows.map((row) => {
									const joined = linkStateFor(row);
									const mark = skillMark(
										joined.state,
										joined.update,
										joined.link
											? hubLinkContentState(joined.link) === "present"
											: false,
									);
									return (
										<li key={row.id} className="min-w-0">
											<button
												type="button"
												aria-haspopup="dialog"
												aria-expanded={selected === row.id}
												aria-label={t("ui.hub.skills.open_detail", {
													item: row.name,
												})}
												data-testid="hub-skill-open"
												data-skill-id={row.id}
												data-skill-state={joined.state.kind}
												onClick={() => {
													setSelected(row.id);
													pull.reset();
													subscribe.reset();
													unpull.reset();
													policy.reset();
												}}
												className={cn(
													"flex h-full w-full flex-col overflow-hidden rounded-md bg-surface text-left",
													"transition-colors duration-fast ease-out-quart hover:bg-elevated",
													"focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1",
												)}
											>
												<span className="flex min-h-0 flex-1 flex-col gap-2 p-4">
													<span className="truncate font-medium text-heading text-ink">
														{row.name}
													</span>
													{row.description ? (
														<span className="line-clamp-3 text-body-sm text-ink-muted">
															{row.description}
														</span>
													) : null}
													<span className="mt-auto truncate text-ink-dim text-meta">
														{skillPublisherLine(row, scope.organization)}
													</span>
												</span>
												{/*
												 * The footer states the skill's fact in words and, beside
												 * it, the update mark. The line keeps the downloaded /
												 * subscribed fact even while an update waits, so a waiting
												 * card and an applied one differ by the WORD in this row
												 * (and by the glyph), not only by two close hues.
												 */}
												<span className="flex items-center justify-between gap-2 border-t border-hairline px-4 py-2 text-meta">
													<span className="truncate text-ink-muted">
														{stateSentence(joined.state, inventoryUnknown)}
													</span>
													<SkillMarkChip mark={mark} />
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
			{!accessible && (
				<p role="alert" className="text-body-sm text-warning">
					{t("ui.hub.status.access_lost")}
				</p>
			)}
			{/*
			 * THE DETAIL, IN A MODAL. It is mounted only while a row is selected, so
			 * the card's `aria-expanded` describes a region that exists exactly when
			 * it says it does; the dialog itself announces the open and takes focus.
			 */}
			<Dialog
				open={!!selected && supported}
				onOpenChange={(open) => {
					if (!open) setSelected(null);
				}}
			>
				<DialogContent
					data-hub-skill-detail=""
					className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
				>
					<DialogHeader>
						<DialogTitle data-testid="hub-skill-detail-name">
							{detail.data?.name ??
								selectedRow?.name ??
								t("ui.hub.skills.title")}
						</DialogTitle>
						<DialogDescription>
							{detail.data && scopeMatches
								? skillPublisherLine(detail.data, scope.organization)
								: source}
						</DialogDescription>
					</DialogHeader>
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
							<div className="flex flex-wrap items-center justify-between gap-2">
								<p className="text-body-sm text-ink-muted">
									{stateSentence(selectedState, inventoryUnknown)}
									<span aria-hidden="true" className="mx-1.5">
										·
									</span>
									{t("ui.hub.skills.revision", {
										revision: String(detail.data.content_revision),
									})}
								</p>
								<SkillMarkChip
									mark={skillMark(selectedState, selectedUpdate, hasCopy)}
								/>
							</div>
							<p
								data-testid="hub-skill-description"
								className="max-w-3xl select-text whitespace-pre-wrap break-words text-body-sm text-ink-muted"
							>
								{detail.data.description}
							</p>
							{selectedLink && hasCopy && selectedLink.local_path && (
								<p
									data-testid="hub-skill-local-path"
									className="break-words font-mono text-meta text-ink-dim"
								>
									{t("ui.hub.skills.local_path", {
										/*
										 * FSI/PDI AT THE CALL SITE, not in the message: the repo's
										 * Urdu gate refuses a manual bidi control in a catalogue
										 * value, and `scripts/i18n/ur-activation.test.mjs` failed on
										 * exactly that when the isolate lived in the string. Under
										 * `dir="rtl"` a leading `/` otherwise resolves as RTL
										 * punctuation and moves to the far end of the sentence
										 * (measured with fribidi); isolation here fixes every locale
										 * that renders this line without touching translated bytes.
										 */
										path: `⁨${selectedLink.local_path}⁩`,
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
							 * Membership and content are independent, and both controls say so.
							 * The switch is the stateful Subscribe control (turning it off is
							 * a policy write, never a file delete); the named button beside it
							 * is how the word "Unsubscribe" is findable without hunting a
							 * switch's OFF position.
							 */}
							{selectedLink && (
								<div className="flex flex-col gap-2 border-t border-hairline pt-3">
									<HubLinkPolicyControls link={selectedLink} />
									{selectedLink.policy.subscribe && (
										<div className="flex flex-wrap items-center gap-2">
											<Button
												variant="outline"
												size="sm"
												data-testid="hub-skill-unsubscribe"
												disabled={policy.isPending || !policy.canWrite}
												onClick={runUnsubscribe}
											>
												{t("ui.hub.skills.unsubscribe")}
											</Button>
											<span className="text-meta text-ink-muted">
												{t("ui.hub.skills.unsubscribe_help")}
											</span>
										</div>
									)}
									{policy.error && (
										<p role="alert" className="text-meta text-danger">
											{t("ui.hub.subscriptions.save_failed", {
												setting:
													policyAct === "subscribe"
														? t("ui.hub.subscriptions.subscribe")
														: t("ui.hub.skills.unsubscribe"),
												source,
											})}
										</p>
									)}
								</div>
							)}
							{/*
							 * The updates channel, not a parallel status story. It is NOT
							 * mounted without a copy: core reports an absent link's remote
							 * revision as `available` with `local: null`, so a Retry there
							 * would re-check and never install — the remedy for an absent
							 * skill is Download, which this dialog already offers (QA
							 * Q-R2-1).
							 */}
							{selectedLink && hasCopy && (
								<HubUpdatePanel
									kind="skill"
									name={selectedLink.name}
									enabled={updatesEnabled}
								/>
							)}
							{pull.error && (
								<p
									role="alert"
									className="text-body-sm text-danger"
									data-testid="hub-skill-pull-failed"
								>
									{t(
										aliasConflict(pull.error)
											? "ui.hub.skills.local_exists"
											: "ui.hub.skills.pull_failed",
									)}
								</p>
							)}
							{pull.data &&
								!pull.data.reports?.some(
									(report) => report.applied || report.outcome === "unchanged",
								) && (
									<p
										role="alert"
										className="text-body-sm text-danger"
										data-testid="hub-skill-pull-failed"
									>
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
									<output
										data-testid="hub-skill-installed"
										className="text-body-sm text-ink"
									>
										{t("ui.hub.skills.installed_alias", {
											item: pull.data.link.name,
											source: hubLinkSourceName(pull.data.link),
										})}
									</output>
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
										aliasConflict(subscribe.error)
											? "ui.hub.skills.local_exists"
											: "ui.hub.skills.subscribe_failed",
									)}
								</p>
							)}
							{!signedIn && (
								<p className="text-meta text-ink-muted">
									{t("ui.hub.status.no_credential")}
								</p>
							)}
							{/*
							 * ONE PRIMARY, ONE SECONDARY. Download is the copy act (with
							 * Subscribe beside it only when there is no subscription yet);
							 * Remove local copy is the only secondary and is plainly distinct
							 * from Unsubscribe above. There is no third copy-creating path and
							 * no policy checkbox applying to one of two buttons (design D4,
							 * UX U1).
							 */}
							{/*
							 * ONE UPDATE ACTION (design round 2, D4). The update panel
							 * owns "Update from the hub" — it carries the state, the
							 * retry and the preview — so the footer no longer offers a
							 * second "Update now" for the same intent. Download appears
							 * only when there is nothing to update: an unlinked skill or
							 * one whose copy is absent.
							 */}
							{(!selectedLink || !hasCopy) && (
								<DialogFooter className="flex-row flex-wrap justify-start gap-2">
									<Button
										data-testid="hub-skill-download"
										disabled={
											!signedIn || !ready || pull.isPending || !inventoryReady
										}
										aria-label={t("ui.hub.skills.pull_title", {
											item: detail.data.name,
											source,
										})}
										onClick={() => runPull(selectedLink)}
									>
										{t("ui.hub.skills.download")}
									</Button>
									{!selectedLink?.policy.subscribe && (
										<Button
											variant="outline"
											data-testid="hub-skill-subscribe"
											disabled={
												!signedIn ||
												!ready ||
												!inventoryReady ||
												subscribe.isPending ||
												policy.isPending ||
												// A link makes this a policy write, so it needs the
												// core's policy-write minimum; creation does not.
												(selectedLink ? !policy.canWrite : false)
											}
											onClick={runSubscribe}
										>
											{t("ui.hub.subscriptions.subscribe")}
										</Button>
									)}
								</DialogFooter>
							)}
							{selectedLink && hasCopy && (
								<DialogFooter className="flex-row flex-wrap justify-start gap-2">
									<Button
										variant="outline"
										data-testid="hub-skill-unpull"
										disabled={unpull.isPending}
										onClick={() => {
											unpull.reset();
											setConfirmUnpull(true);
										}}
									>
										{t("ui.hub.skills.unpull")}
									</Button>
								</DialogFooter>
							)}
							{/*
							 * The support sentence describes the DOWNLOAD control above it, so it
							 * follows the same condition — an update state has no Download and the
							 * update panel owns that action (design round 3, D12).
							 */}
							{(!selectedLink || !hasCopy) && (
								<p className="text-meta text-ink-muted">
									{selectedLink?.policy.subscribe
										? t("ui.hub.skills.download_help")
										: t("ui.hub.skills.subscribe_help")}
								</p>
							)}
						</>
					)}
				</DialogContent>
			</Dialog>
			<Dialog
				open={confirmUnpull}
				onOpenChange={(open) => {
					if (!open) setConfirmUnpull(false);
				}}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>
							{t("ui.hub.skills.unpull_title", {
								item: detail.data?.name ?? selectedLink?.name ?? "",
							})}
						</DialogTitle>
						<DialogDescription>
							{t("ui.hub.skills.unpull_body")}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirmUnpull(false)}>
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
			<Dialog open={publishOpen} onOpenChange={setPublishOpen}>
				<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>{t("ui.hub.skills.publish_title")}</DialogTitle>
						<DialogDescription>{source}</DialogDescription>
					</DialogHeader>
					<HubSkillPublication
						scope={scope}
						source={source}
						verifiedCas={supported && accessible && signedIn}
						enabled={supported && accessible && signedIn}
						heading={false}
					/>
				</DialogContent>
			</Dialog>
		</section>
	);
}
