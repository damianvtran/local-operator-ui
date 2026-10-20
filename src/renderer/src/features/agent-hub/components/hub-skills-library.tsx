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
import { useHubLinkPolicy } from "@shared/api/local-operator/hub-link-hooks";
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
import { type WithoutParams, t } from "@shared/i18n";
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
 * success (a finished fact). Hue alone does not separate them at this size — the
 * two roles measure ΔE00 2.22 apart in the light palettes — so the WORD carries
 * the distinction and the colour only reinforces it.
 */
const MARK_INK: Record<HubMark["kind"], string> = {
	available: "text-accent",
	applied: "text-success",
	failed: "text-danger",
	review: "text-warning",
	updating: "text-ink-muted",
};

/**
 * The mark vocabulary's labels, in this surface's sentence case. `available`,
 * `applied` and `failed` are skill-specific sentences ("Update available"), not
 * the lowercase aggregate words the sidebar uses for a rolled-up count.
 */
const MARK_KEY: Record<HubMark["kind"], WithoutParams> = {
	available: "ui.hub.skills.update_available",
	applied: "ui.hub.skills.update_applied",
	failed: "ui.hub.skills.update_failed",
	review: "ui.hub.links.mark_review",
	updating: "ui.hub.links.mark_busy",
};

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
 * The mark a skill row draws, from the state that already decided what is true.
 *
 * An `available` updates row exists for a skill with NO copy too (core reports
 * the remote revision with `local: null`), so the mark cannot be drawn straight
 * from the updates store: that would label a skill that is not installed
 * "update available" and hide the Download that is actually next. Only an
 * `update` state earns the waiting mark. `applied` and a FAILURE draw in every
 * state — they are the outcome and the reason a check did not land, and an
 * applied update that left no mark made the card identical to one that never
 * needed one.
 */
function skillMark(
	state: HubSkillState,
	update: HubUpdateItem | undefined,
): HubMark | null {
	const mark = update ? hubMarkFor(update) : null;
	if (
		mark &&
		(state.kind === "update" ||
			update?.state === "applied" ||
			update?.state === "failed" ||
			update?.error_class)
	)
		return mark;
	if (state.kind === "update")
		return { kind: "available", auto: state.automatic };
	return null;
}

/** The fact a row states in words. An update keeps the copy/subscription fact. */
function stateSentence(state: HubSkillState): string {
	if (state.kind !== "update") return t(STATE_KEY[state.kind]);
	return t(
		state.link.policy.subscribe
			? "ui.hub.skills.pulled"
			: "ui.hub.skills.manual",
	);
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
 * The refusal code behind a failed write, when the failure carried one.
 *
 * Core answers an alias collision and a confirmed-origin conflict with the same
 * `origin-conflict` code, and that is the one failure with a remedy the generic
 * sentences cannot name: choose another local alias.
 */
function refusalCode(error: unknown): string | undefined {
	return error instanceof DesktopControlError ? error.code : undefined;
}

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
		return { link, update, state: hubSkillState(link, update) };
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
		pull.mutate({
			requestId: requestIdFor(
				JSON.stringify({ op: "pull", selected, scope, localAlias }),
			),
			remoteId: selected,
			scope,
			alias: localAlias,
			// Download does NOT subscribe, and never edits the subscription an
			// existing link already has: content and membership are separate facts.
			subscribe: forLink ? forLink.policy.subscribe : false,
			autoPush: forLink?.policy.auto_push ?? false,
			// Consent is an affirmative act, never re-asserted by a download.
			consent: false,
		});
	};
	const runSubscribe = () => {
		if (!selected || !ready || !signedIn) return;
		const localAlias = selectedLink?.name ?? selectedRow?.name ?? "";
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
	const runUnsubscribe = () => {
		if (!selectedLink || selectedLink.policy.subscribe === false) return;
		policy.mutate({
			link: selectedLink,
			patch: { subscribe: false },
		});
	};
	const canPublish = signedIn && supported && accessible && !catalogue.error;
	const scopePhrase = scope.organization
		? `shared with ${scope.organization}`
		: `in ${t("ui.hub.skills.public_hub")}`;
	const statusLine = catalogue.isLoading
		? t("ui.hub.skills.loading")
		: `${scopedRows.length} ${scopedRows.length === 1 ? "skill" : "skills"} ${scopePhrase}`;

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
					<p
						aria-live="polite"
						className="text-meta text-ink-dim"
						data-testid="hub-skill-status"
					>
						{statusLine}
					</p>
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
									const mark = skillMark(joined.state, joined.update);
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
														{stateSentence(joined.state)}
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
				<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>
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
									{stateSentence(selectedState)}
									<span aria-hidden="true" className="mx-1.5">
										·
									</span>
									{t("ui.hub.skills.revision", {
										revision: String(detail.data.content_revision),
									})}
								</p>
								<SkillMarkChip
									mark={skillMark(selectedState, selectedUpdate)}
								/>
							</div>
							<p className="max-w-3xl select-text whitespace-pre-wrap break-words text-body-sm text-ink-muted">
								{detail.data.description}
							</p>
							{selectedLink && hasCopy && selectedLink.local_path && (
								<p className="break-all font-mono text-meta text-ink-dim">
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
												aria-disabled={policy.isPending || undefined}
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
												setting: t("ui.hub.skills.unsubscribe"),
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
							{selectedLink && !hasCopy && (
								<p className="text-meta text-ink-muted">
									{t("ui.hub.skills.download_help")}
								</p>
							)}
							{pull.error &&
								(refusalCode(pull.error) === "origin-conflict" ? (
									<p role="alert" className="text-body-sm text-danger">
										{t("ui.hub.skills.local_exists")}
									</p>
								) : null)}
							{((pull.error && refusalCode(pull.error) !== "origin-conflict") ||
								(pull.data &&
									!pull.data.reports?.some(
										(report) =>
											report.applied || report.outcome === "unchanged",
									))) && (
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
									<output className="text-body-sm text-ink">
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
										refusalCode(subscribe.error) === "origin-conflict"
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
							{(!selectedLink ||
								!hasCopy ||
								selectedState.kind === "update") && (
								<DialogFooter className="flex-row flex-wrap justify-start gap-2">
									<Button
										data-testid="hub-skill-download"
										disabled={!signedIn || !ready || pull.isPending}
										aria-label={t("ui.hub.skills.pull_title", {
											item: detail.data.name,
											source,
										})}
										onClick={() => runPull(selectedLink)}
									>
										{selectedState.kind === "update"
											? t("ui.hub.skills.update_now")
											: t("ui.hub.skills.download")}
									</Button>
									{!selectedLink?.policy.subscribe && (
										<Button
											variant="outline"
											data-testid="hub-skill-subscribe"
											disabled={!signedIn || !ready || subscribe.isPending}
											onClick={runSubscribe}
										>
											{t("ui.hub.subscriptions.subscribe")}
										</Button>
									)}
									{hasCopy && (
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
									)}
								</DialogFooter>
							)}
							{selectedLink && hasCopy && selectedState.kind !== "update" && (
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
							{(!selectedLink ||
								!hasCopy ||
								selectedState.kind === "update") && (
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
					/>
				</DialogContent>
			</Dialog>
		</section>
	);
}
