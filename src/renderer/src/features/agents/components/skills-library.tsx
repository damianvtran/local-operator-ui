/**
 * The Agents page's Skills tab: a READ-ONLY roster of every skill this machine
 * can see, and a details pane for the one that is open.
 *
 * WHY IT IS ON THE AGENTS PAGE AND NOT A PAGE OF ITS OWN. A skill is a
 * definition like an agent or a team: something you list, open and (in later
 * slices) change. The page already has the master-detail frame, the search box
 * and the tab strip for that, so this is a third tab in the same frame - the
 * roster's row idiom, the same `Section` / `ReadBlock` / `PaneError` parts the
 * agent pane is built from - rather than a different product bolted on.
 *
 * WHAT IS NOT HERE, deliberately (U1 is the read side; core ships only reads in
 * `skill_library:1`): no create, no edit, no remove, no composer target, and no
 * hub actions. The hub mutations (pull / subscribe / unpull / publish) have
 * hooks in `agent-hub/hooks/use-hub-skills.ts` that need a remote catalogue row
 * and a sign-in this page does not hold, so wiring them verbatim is U2's job. The
 * tab SHOWS the state; it offers no button that would change it.
 *
 * WHERE EACH FACT COMES FROM. Rows and details are core's `GET /v1/desktop/skills`
 * (see `skills-library-model.ts`). Hub state is never in that response: a `hub`
 * row's `link_id` is joined to the links inventory and the updates store the Hub
 * page also reads, and the word is `hubSkillState()`'s - one owner of
 * subscribed / pulled / update-available for both surfaces.
 */

import { rowCurrent } from "@features/chat/components/chat-sidebar";
import { hubLinkContentState } from "@shared/api/local-operator/hub-links";
import { Badge } from "@shared/components/ui/badge";
import { Disclosure } from "@shared/components/ui/disclosure";
import { t } from "@shared/i18n";
import type { MessageKey } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { formatByteSize } from "@shared/lib/format-bytes";
import { cn } from "@shared/lib/utils";
import { useEffect, useRef, useState } from "react";
import type { SkillsListResult } from "../../../../../shared/desktop-contract";
import {
	SkillMarkChip,
	skillMark,
	stateSentence,
} from "../../agent-hub/components/hub-skill-mark";
import {
	type SkillCard,
	type SkillHubJoin,
	type SkillSource,
	skillBody,
	toSkillCard,
} from "../skills-library-model";
import {
	DetailSkeleton,
	PaneError,
	ReadBlock,
	RosterSkeleton,
	Section,
} from "./detail-parts";

/* ------------------------------------------------------------------ words --- */

/** The five source words, as catalogue keys (resolved at render, never frozen at import). */
const SOURCE_KEY = {
	builtin: "ui.agents.skills.source.builtin",
	hub: "ui.agents.skills.source.hub",
	local: "ui.agents.skills.source.local",
	external: "ui.agents.skills.source.external",
	project: "ui.agents.skills.source.project",
} as const satisfies Record<SkillSource, MessageKey>;

const WHERE_KEY = {
	builtin: "ui.agents.skills.where.builtin",
	hub: "ui.agents.skills.where.hub",
	local: "ui.agents.skills.where.local",
	external: "ui.agents.skills.where.external",
	project: "ui.agents.skills.where.project",
} as const satisfies Record<SkillSource, MessageKey>;

/** A source this build does not know (or none) is said plainly, never hidden or crashed on. */
export function skillSourceWord(source: SkillSource | null): string {
	return t(source ? SOURCE_KEY[source] : "ui.agents.skills.source.unknown");
}

/**
 * The one sentence a card/row states about the hub, or null when the hub has
 * nothing to say (a built-in, local, external or project skill is on disk and
 * has no hub relationship to describe).
 *
 * - `unknown`: the links inventory has not answered (loading, failed, or the
 *   capability is absent). Not a fact about the skill, so it says so.
 * - a hub row whose `link_id` finds no link row, or that has no `link_id`: the
 *   skill is hub-managed on disk but the inventory does not list it. "Not
 *   downloaded" would be false for a folder that is right there.
 * - `installed:false`: subscribed, nothing on disk - `hubSkillState` already says
 *   "Subscribed — not installed" when the link is found; when it is not, core's
 *   own `installed:false` is the fact.
 */
export function hubSentence(
	card: SkillCard,
	join: SkillHubJoin | null,
): string | null {
	if (!join) return null;
	if (join.state.kind === "unknown")
		return stateSentence(join.state, t("ui.hub.skills.inventory_unknown"));
	if (join.state.kind === "not-present")
		return t(
			card.installed
				? "ui.agents.skills.hub.unlinked"
				: "ui.agents.skills.detail.installed_not",
		);
	return stateSentence(join.state, "");
}

function joinMark(join: SkillHubJoin | null) {
	if (!join) return null;
	return skillMark(
		join.state,
		join.update,
		join.link ? hubLinkContentState(join.link) === "present" : false,
	);
}

/* ----------------------------------------------------------------- roster --- */

/**
 * The roster. Same row as the Agents/Teams roster (`Roster` in `agents-page.tsx`):
 * a list of buttons with one Tab stop and arrow-key movement, name and a quiet
 * right-edge fact on line one, one fixed-height line two.
 *
 * LINE ONE'S RIGHT EDGE is the source word, as it is for an agent. LINE TWO leads
 * with the hub sentence for a hub row - the way the agent roster leads line two
 * with "Proactive ·" - so the state a card must show ("Downloaded — subscribed",
 * "Subscribed — not installed", ...) costs no extra line and every row stays one
 * height. A waiting update, an applied one and a failed one are the mark chip
 * after the name: the WORD differs ("Update available" / "Update applied"), not
 * only a hue.
 */
export function SkillsRoster({
	cards,
	selected,
	join,
	onOpen,
}: {
	cards: readonly SkillCard[];
	selected: string | null;
	join: (card: SkillCard) => SkillHubJoin | null;
	onOpen: (name: string) => void;
}) {
	useI18nLocale();
	const refs = useRef(new Map<string, HTMLButtonElement>());
	const [focused, setFocused] = useState<string | null>(selected);

	const move = (from: string, delta: number) => {
		const index = cards.findIndex((card) => card.name === from);
		if (index < 0) return;
		const next = cards[Math.min(cards.length - 1, Math.max(0, index + delta))];
		if (!next) return;
		setFocused(next.name);
		refs.current.get(next.name)?.focus();
	};

	return (
		<ul
			aria-label={t("ui.agents.skills.list_aria")}
			className="space-y-0.5"
			data-skills-roster
		>
			{cards.map((card) => {
				const joined = join(card);
				const sentence = hubSentence(card, joined);
				const mark = joinMark(joined);
				return (
					<li key={card.name}>
						<button
							ref={(node) => {
								if (node) refs.current.set(card.name, node);
								else refs.current.delete(card.name);
							}}
							type="button"
							aria-current={card.name === selected ? "true" : undefined}
							tabIndex={card.name === (focused ?? cards[0]?.name) ? 0 : -1}
							data-testid={`skill-row-${card.name}`}
							data-skill-source={card.source ?? "unknown"}
							data-skill-state={joined?.state.kind}
							data-skill-installed={card.installed ? "true" : "false"}
							title={
								card.description
									? `${card.name} - ${card.description}`
									: card.name
							}
							className={cn(
								"flex min-h-12 w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-start hover:bg-row-hover",
								card.name === selected && rowCurrent,
							)}
							onFocus={() => setFocused(card.name)}
							onClick={() => onOpen(card.name)}
							onKeyDown={(event) => {
								if (event.key === "ArrowDown") {
									event.preventDefault();
									move(card.name, 1);
								} else if (event.key === "ArrowUp") {
									event.preventDefault();
									move(card.name, -1);
								} else if (event.key === "Home") {
									event.preventDefault();
									move(card.name, -cards.length);
								} else if (event.key === "End") {
									event.preventDefault();
									move(card.name, cards.length);
								}
							}}
						>
							{/*
							 * LINE ONE IS THE NAME AND THE SOURCE WORD, exactly as in the Agents
							 * roster, and nothing else (design D1 / UX U1). The update mark used
							 * to sit here between them: it and the source word are `shrink-0`, so
							 * a 30-character mark left the name 0 px wide - the one row a reader
							 * most needs to identify was the one that lost its name.
							 */}
							<span className="flex w-full items-center gap-2">
								<span className="min-w-0 truncate text-body-sm text-ink">
									{card.name}
								</span>
								<span
									className="ms-auto max-w-[45%] shrink-0 truncate text-meta text-ink-dim"
									data-testid="skill-row-source"
								>
									{skillSourceWord(card.source)}
								</span>
							</span>
							{/*
							 * LINE TWO LEADS WITH THE MARK, then the hub sentence, then the
							 * description - the way "Proactive ·" leads an agent's second line.
							 * The mark is NOT `shrink-0` here: the whole line is one flex run that
							 * truncates at its end, so nothing on it can push past the row.
							 */}
							<span
								className="block min-h-lh w-full min-w-0 truncate text-meta text-ink-muted"
								data-testid="skill-row-line2"
							>
								{mark ? (
									<span data-testid="skill-row-mark">
										<SkillMarkChip
											mark={mark}
											labels={SKILL_MARK_LABELS}
											className="inline-flex align-middle"
										/>
										<span className="text-ink-dim"> · </span>
									</span>
								) : null}
								{sentence ? (
									<span data-testid="skill-row-hub-state">
										<span className="text-ink">{sentence}</span>
										<span className="text-ink-dim"> · </span>
									</span>
								) : null}
								{card.description ? (
									card.description
								) : (
									<span className="text-ink-dim">
										{t("ui.agents.detail.no_description")}
									</span>
								)}
							</span>
						</button>
					</li>
				);
			})}
		</ul>
	);
}

/** The roster's body in every state the list can be in (not the error, which the pane owns). */
export function SkillsRosterBody({
	loading,
	failed,
	cards,
	total,
	search,
	selected,
	join,
	onOpen,
}: {
	loading: boolean;
	failed: boolean;
	cards: readonly SkillCard[];
	/** Rows before the text filter: tells "nothing exists" from "nothing matches". */
	total: number;
	search: string;
	selected: string | null;
	join: (card: SkillCard) => SkillHubJoin | null;
	onOpen: (name: string) => void;
}) {
	useI18nLocale();
	if (failed) return null;
	if (loading) return <RosterSkeleton />;
	if (cards.length === 0)
		return (
			<p
				className="px-1 py-2 text-body-sm text-ink-muted"
				data-testid="skills-empty"
				data-skills-empty={total === 0 ? "none" : "no-match"}
			>
				{total === 0 || !search.trim()
					? t("ui.agents.skills.empty.none")
					: t("ui.agents.skills.empty.search", { query: search })}
			</p>
		);
	return (
		<SkillsRoster
			cards={cards}
			selected={selected}
			join={join}
			onOpen={onOpen}
		/>
	);
}

/**
 * THE FAILED-UPDATE MARK ON THIS SURFACE SAYS ONLY THAT IT FAILED. The Hub's own
 * string is "Update failed - open to retry", true on the Hub page where the detail
 * has a retry, and false here: U1 is read-only and neither the row nor the details
 * can retry (UX U1; lead decision on #1443). WHEN THE ACTIONS LAND (U2), THE
 * LONGER HUB STRING CAN COME BACK - drop this override and the key
 * `ui.agents.skills.hub.update_failed` together.
 */
const SKILL_MARK_LABELS = {
	failed: "ui.agents.skills.hub.update_failed",
} as const;

/**
 * KEEP KEYBOARD FOCUS ON RETRY (UX U5, focus part only), ACTING ON THE SETTLE.
 *
 * Pressing Retry starts a fetch, and what happens to the error pane depends on the
 * cache. With NO cached data react-query clears `error`, so the pane (and the
 * focused button in it) unmounts and focus fell to <body>. With CACHED data the
 * `error` survives the fetch: the pane stays mounted with its button DISABLED
 * ("Retrying..."), and a disabled button cannot take focus (QA r5 Q1). Both end the
 * same way - the fetch settles - so this waits for that edge (`fetching` true ->
 * false) instead of the first moment `failed` is true:
 *   - settled WITH an error: focus the Retry button, which is enabled again;
 *   - settled WITHOUT one: forget the press, so a later background failure cannot
 *     pull focus off wherever the reader is (UX U9).
 * The press is spent either way. A further Retry is a further press, which re-arms
 * it; staying armed across settles would let a LATER background failure steal
 * focus from the reader's search box, the defect U9 closed. And even at a failed
 * settle focus moves only if the reader is homeless or still inside the pane.
 */
export function useRetryFocus(failed: boolean, fetching: boolean) {
	const pressed = useRef(false);
	const sawFetch = useRef(false);
	const holder = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!pressed.current) return;
		if (fetching) {
			sawFetch.current = true;
			return;
		}
		// Not settled yet: the press has not produced a fetch to wait for. This also
		// carries the press across a render where `failed` clears a beat before
		// `fetching` flips, which must not be mistaken for a success.
		if (!sawFetch.current) return;
		sawFetch.current = false;
		pressed.current = false;
		if (!failed) return;
		requestAnimationFrame(() => {
			// ONLY IF THE READER IS STILL WHERE THEY PRESSED (QA r5 Q1 / review R5-1).
			// The settle can land seconds later, and in between they may have tabbed
			// into the search box; yanking the caret to Retry is the focus theft U9
			// closed, on the failure branch. Homeless (<body>: the browser drops focus
			// when the pressed button is disabled or unmounted) or still inside this
			// pane means "give it back"; anywhere else means leave it alone.
			const active = document.activeElement;
			const stillHere =
				!active ||
				active === document.body ||
				Boolean(holder.current?.contains(active));
			if (!stillHere) return;
			const retry = holder.current?.querySelector<HTMLButtonElement>("button");
			if (retry && !retry.disabled) retry.focus();
		});
	}, [failed, fetching]);
	return {
		holder,
		onPress: () => {
			pressed.current = true;
		},
	};
}

/* ---------------------------------------------------------------- details --- */

/** A byte count: exact words under a kilobyte, the shared formatter above. */
function sizeWords(bytes: number): string {
	return bytes < 1000
		? t("ui.agents.skills.detail.file_bytes", { count: bytes })
		: formatByteSize(bytes);
}

type DetailQuery = {
	data: SkillsListResult | undefined;
	isLoading: boolean;
	isFetching: boolean;
	error: Error | null;
};

/**
 * The open skill: description, SKILL.md body, reference files, identity, where
 * it lives, and the hub state. Everything is a statement of fact; nothing here
 * is a control that writes.
 */
export function SkillDetail({
	name,
	card: listed,
	join,
	detail,
	onRetry,
}: {
	name: string;
	/** The list row, when the list has loaded and still holds the skill. */
	card: SkillCard | null;
	join: (card: SkillCard) => SkillHubJoin | null;
	detail: DetailQuery;
	onRetry: () => void;
}) {
	useI18nLocale();
	const headingRef = useRef<HTMLHeadingElement>(null);
	const retryFocus = useRetryFocus(Boolean(detail.error), detail.isFetching);
	/*
	 * FOCUS FOLLOWS THE OPEN (QA round 1 Q3 / review R6). Below 1000 px the roster
	 * is `display:none` while a skill is open, so the row that was pressed LEAVES
	 * the layout and the browser drops focus to <body>; a keyboard user then
	 * starts again from the top of the page. The heading is the pane's landmark
	 * (`tabIndex -1`, as the agent and team panes make theirs).
	 *
	 * ONLY WHEN FOCUS IS HOMELESS OR WAS IN THE ROSTER, i.e. the open came from
	 * the user: a deep link or a refetch must not pull focus out of whatever the
	 * reader is typing in (the search box keeps it while they filter).
	 */
	useEffect(() => {
		const active = document.activeElement;
		const homeless = !active || active === document.body;
		// AT WIDE WIDTHS THE ROW STAYS ON SCREEN, so focus stays on it: the reader's
		// next act is ArrowDown to the next skill (master-detail: the list keeps
		// focus, the detail follows), and grabbing the heading made every skill cost
		// a Shift+Tab (UX U3 / QA Q7). Below 1000 px the row has left the layout and
		// focus would fall to <body>, so the heading takes it - the same width the
		// page's narrow rule uses. Escape is a no-op at wide widths, as on Agents.
		// Accepted on #1443 (lead decision): an agent row's composer grabbing focus on
		// open is the very behaviour U2 removed from the tab strip, so it is not the model.
		const rowGone = window.matchMedia("(max-width: 999px)").matches;
		if (homeless || (rowGone && active?.closest("[data-skills-roster]")))
			requestAnimationFrame(() => headingRef.current?.focus());
	}, []);
	const wire = detail.data?.skill_detail ?? null;
	// The list row paints the header at once; a deep link falls back to the
	// details read's own copy of the row fields.
	const card = listed ?? (wire ? toSkillCard(wire) : null);

	if (detail.error)
		return (
			<div ref={retryFocus.holder}>
				<PaneError
					title={t("ui.agents.skills.error.detail_title", { name })}
					what={detail.error.message}
					meaning={t("ui.agents.skills.error.detail_meaning")}
					onRetry={() => {
						retryFocus.onPress();
						onRetry();
					}}
					retrying={detail.isFetching}
					retryLabel={t("ui.common.actions.retry")}
					retryingLabel={t("ui.agents.skills.retrying")}
				/>
			</div>
		);
	if (!card) return detail.isLoading ? <DetailSkeleton /> : null;

	const joined = join(card);
	const sentence = hubSentence(card, joined);
	const mark = joinMark(joined);
	const body = skillBody(detail.data?.detail, wire);
	const files = wire?.files ?? [];
	const filesTotal = wire?.files_total ?? files.length;
	const localPath = joined?.link?.local_path ?? null;

	return (
		<div
			className="space-y-8"
			data-testid="skill-detail"
			data-skill={card.name}
		>
			<header className="space-y-1">
				<h2
					ref={headingRef}
					tabIndex={-1}
					className="truncate text-title focus:outline-none"
					title={card.name}
				>
					{card.name}
				</h2>
				<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<p className="text-body-sm text-ink-muted">
						{[skillSourceWord(card.source), sentence]
							.filter(Boolean)
							.join(" · ")}
					</p>
					<SkillMarkChip mark={mark} labels={SKILL_MARK_LABELS} />
					{/* The hub sentence in the line above already says "Subscribed - not
					    installed" for a hub row (design D5); the badge is for the not-installed
					    row that has no hub sentence to say it. */}
					{!card.installed && !sentence ? (
						<Badge variant="neutral" data-testid="skill-not-installed">
							{t("ui.agents.skills.detail.installed_not")}
						</Badge>
					) : null}
				</div>
			</header>

			<Section title={t("ui.agents.skills.detail.section.description")}>
				<ReadBlock
					text={card.description}
					empty={t("ui.agents.detail.no_description")}
					showAllLabel={t("ui.agents.skills.detail.show_all")}
					showLessLabel={t("ui.agents.skills.detail.show_less")}
					breakLongTokens
				/>
			</Section>

			<Section title={t("ui.agents.skills.detail.section.body")}>
				{detail.isLoading ? (
					<div aria-hidden="true">
						<DetailSkeleton />
					</div>
				) : body !== null ? (
					<>
						{wire?.body_truncated ? (
							<p
								className="text-meta text-warning"
								data-testid="skill-body-truncated"
							>
								{t("ui.agents.skills.detail.body_truncated", {
									size: sizeWords(wire.body_bytes ?? 0),
								})}
							</p>
						) : null}
						<ReadBlock
							text={body}
							mono
							showAllLabel={t("ui.agents.skills.detail.show_all")}
							showLessLabel={t("ui.agents.skills.detail.show_less")}
							breakLongTokens
						/>
					</>
				) : (
					<p
						className="text-body-sm text-ink-muted"
						data-testid="skill-no-body"
					>
						{t(
							card.installed
								? "ui.agents.skills.detail.body_unavailable"
								: "ui.agents.skills.detail.body_not_installed",
						)}
					</p>
				)}
			</Section>

			{detail.isLoading ? null : (
				<Section
					title={t("ui.agents.skills.detail.section.files")}
					description={
						files.length > 0
							? t("ui.agents.skills.detail.files_count", {
									count: filesTotal,
								})
							: undefined
					}
				>
					{files.length === 0 ? (
						<p className="text-body-sm text-ink-muted">
							{t("ui.agents.skills.detail.files_none")}
						</p>
					) : (
						<ul className="space-y-1" data-testid="skill-files">
							{files.map((file) => (
								<li key={file.path}>
									<Disclosure
										summary={
											<span className="flex min-w-0 items-baseline gap-2">
												<span className="min-w-0 truncate font-mono text-meta text-ink">
													{file.path}
												</span>
												<span className="shrink-0 text-meta text-ink-dim">
													{sizeWords(file.size ?? 0)}
												</span>
											</span>
										}
									>
										{file.preview ? (
											<section
												aria-label={t("ui.agents.skills.detail.preview_aria", {
													path: file.path,
												})}
											>
												{/* The same clamp-and-expand block the SKILL.md body uses, so an
												    opened preview cannot push the rest of the pane below the fold
												    (design D6). */}
												{file.preview_truncated ? (
													<p className="text-meta text-ink-muted">
														{t("ui.agents.skills.detail.preview_truncated")}
													</p>
												) : null}
												<ReadBlock
													text={file.preview}
													mono
													showAllLabel={t("ui.agents.skills.detail.show_all")}
													showLessLabel={t("ui.agents.skills.detail.show_less")}
													breakLongTokens
												/>
											</section>
										) : (
											<p className="text-meta text-ink-muted">
												{t("ui.agents.skills.detail.preview_none")}
											</p>
										)}
									</Disclosure>
								</li>
							))}
						</ul>
					)}
					{wire?.files_truncated ? (
						<p
							className="text-meta text-warning"
							data-testid="skill-files-truncated"
						>
							{t("ui.agents.skills.detail.files_truncated_of", {
								shown: files.length,
								total: filesTotal,
							})}
						</p>
					) : null}
				</Section>
			)}

			<Section title={t("ui.agents.skills.detail.section.identity")}>
				<dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-body-sm">
					<dt className="text-ink-muted">
						{t("ui.agents.skills.detail.form_label")}
					</dt>
					<dd className="text-ink" data-testid="skill-form">
						{card.form
							? t(
									card.form === "bundle"
										? "ui.agents.skills.detail.form.bundle"
										: "ui.agents.skills.detail.form.document",
								)
							: t("ui.agents.skills.detail.form.unknown")}
					</dd>
					<dt className="text-ink-muted">
						{t("ui.agents.skills.detail.fingerprint")}
					</dt>
					<dd
						className="min-w-0 break-all font-mono text-meta text-ink"
						data-testid="skill-fingerprint"
					>
						{card.fingerprint ?? t("ui.agents.skills.detail.fingerprint_none")}
					</dd>
				</dl>
			</Section>

			<Section title={t("ui.agents.skills.detail.section.where")}>
				<p className="text-body-sm text-ink">
					{t(
						card.source
							? WHERE_KEY[card.source]
							: "ui.agents.skills.where.unknown",
					)}
				</p>
				{localPath ? (
					<p
						className="break-all font-mono text-meta text-ink-muted"
						data-testid="skill-local-path"
					>
						{t("ui.hub.skills.local_path", { path: localPath })}
					</p>
				) : null}
			</Section>

			{joined ? (
				<Section title={t("ui.agents.skills.detail.section.hub")}>
					<p className="text-body-sm text-ink" data-testid="skill-hub-state">
						{sentence}
					</p>
					{card.source === "hub" && joined.state.kind === "not-present" ? (
						<p className="text-meta text-ink-muted">
							{t("ui.agents.skills.hub.unlinked_help")}
						</p>
					) : null}
				</Section>
			) : null}
		</div>
	);
}
