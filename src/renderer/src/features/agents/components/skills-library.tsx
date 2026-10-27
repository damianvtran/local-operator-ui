/**
 * The Agents page's Skills tab: a roster of every skill this machine can see,
 * and a details pane for the one that is open.
 *
 * WHY IT IS ON THE AGENTS PAGE AND NOT A PAGE OF ITS OWN. A skill is a
 * definition like an agent or a team: something you list, open and change. The
 * page already has the master-detail frame, the search box, the tab strip and
 * the docked "ask for a change" composer for that, so this is a third tab in the
 * same frame - the roster's row idiom, the same `Section` / `ReadBlock` /
 * `PaneError` / `EditSection` / `EditFooter` / `HubLinksPanel` parts the agent
 * pane is built from - rather than a different product bolted on.
 *
 * WHAT THE PANE READS LIKE (design spec `skills-tab-design.md` §2-§3, operator
 * request 2026-10-27): the agent pane's header (title, one plain meta line, the
 * Edit / Ask for a change / More cluster on the title line), then "When to use
 * it" (the description, ONCE), the instructions with the YAML front matter
 * stripped and rendered as markdown, the reference files, and a collapsed
 * Details disclosure for the machine facts (location, form, fingerprint). Hub
 * skills get the agents' own hub panel under the header.
 *
 * WHO DECIDES WHAT MAY CHANGE. Core: `editable` on the row is core's answer, and
 * the inline Edit is narrowed further by the detail read (no reference files,
 * body not truncated) because `PUT /v1/desktop/skills/{name}` replaces the whole
 * file set (`skillEditability`). The writes need `skill_write`; the composer
 * needs `agents_config_skills` (`configSkillRunEnabled`). Without them the pane is
 * the read-only surface it was, plus the new layout.
 *
 * WHERE EACH FACT COMES FROM. Rows and details are core's `GET /v1/desktop/skills`
 * (see `skills-library-model.ts`). Hub state is never in that response: a `hub`
 * row's `link_id` is joined to the links inventory and the updates store the Hub
 * page also reads, and the state is `hubSkillState()`'s - one owner of
 * subscribed / pulled / update-available for both surfaces.
 */

import { rowCurrent } from "@features/chat/components/chat-sidebar";
import { userFacingMessage } from "@shared/api/local-operator/desktop-api";
import { hubLinkContentState } from "@shared/api/local-operator/hub-links";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@shared/components/ui/alert";
import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { Disclosure } from "@shared/components/ui/disclosure";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import { t } from "@shared/i18n";
import type { MessageKey, WithoutParams } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { formatByteSize } from "@shared/lib/format-bytes";
import { cn } from "@shared/lib/utils";
import { showSuccessToast } from "@shared/utils/toast-manager";
import { MoreHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { SkillsListResult } from "../../../../../shared/desktop-contract";
import {
	SkillMarkChip,
	skillMark,
} from "../../agent-hub/components/hub-skill-mark";
import { useSkillWrites } from "../hooks/use-skills-library";
import {
	type SkillCard,
	type SkillHeaderState,
	type SkillHubJoin,
	type SkillRowState,
	type SkillScope,
	type SkillSource,
	otherFrontMatter,
	rebuildSkillMd,
	skillBody,
	skillEditability,
	skillHeaderState,
	skillLocallyModified,
	skillRowState,
	splitFrontMatter,
	toSkillCard,
} from "../skills-library-model";
import { EditSection } from "./agent-detail";
import {
	DetailSkeleton,
	EditFooter,
	PaneError,
	ReadBlock,
	RosterSkeleton,
	Section,
	TITLE_LINE_HEIGHT,
	useEscapeToCancel,
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
 * The ONE state word a roster row's line two leads with (design spec §2), as a
 * key and an ink. `failed` / `available` / `applied` are the hub mark's own
 * words; `modified` is the agents' word for the same fact; the rest are new.
 */
const ROW_STATE: Record<SkillRowState, { key: WithoutParams; ink: string }> = {
	failed: { key: "ui.agents.skills.hub.update_failed", ink: "text-danger" },
	available: { key: "ui.hub.skills.update_available", ink: "text-accent" },
	applied: { key: "ui.hub.skills.update_applied", ink: "text-success" },
	modified: { key: "ui.agents.detail.badge.modified", ink: "text-warning" },
	"not-installed": {
		key: "ui.agents.skills.state.not_installed",
		ink: "text-ink",
	},
	"updates-off": { key: "ui.agents.skills.state.updates_off", ink: "text-ink" },
	unlinked: { key: "ui.agents.skills.hub.unlinked", ink: "text-ink" },
};

/** The row states the hub's own mark chip draws (its words, glyph and ink). */
const MARK_STATES: ReadonlySet<SkillRowState> = new Set([
	"failed",
	"available",
	"applied",
]);

/** The header meta line's plain state after the source word (design spec §3.1). */
const HEADER_STATE_KEY = {
	following: "ui.agents.skills.state.following",
	"updates-off": "ui.agents.skills.state.updates_off",
	"not-installed": "ui.agents.skills.state.not_installed",
	"hub-unknown": "ui.agents.skills.state.hub_unknown",
	unlinked: "ui.agents.skills.hub.unlinked",
	"read-only": "ui.agents.skills.state.read_only",
} as const satisfies Record<SkillHeaderState, MessageKey>;

/** The scope segments' labels: the row's own source words, so the two match. */
export const SKILL_SCOPE_LABEL = {
	all: "ui.agents.pages.scope.all",
	local: "ui.agents.skills.source.local",
	hub: "ui.agents.skills.source.hub",
	builtin: "ui.agents.skills.source.builtin",
} as const satisfies Record<SkillScope, MessageKey>;

const SCOPE_EMPTY_KEY = {
	local: "ui.agents.skills.empty.local",
	hub: "ui.agents.skills.empty.hub",
	builtin: "ui.agents.skills.empty.builtin",
} as const satisfies Record<Exclude<SkillScope, "all">, MessageKey>;

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
 * LINE ONE is the name, the run's "Updated" / "New" attention badge when a
 * configuration run changed the skill (the agents' badge, cleared on open), and
 * the source word on the right edge.
 *
 * LINE TWO says AT MOST ONE state word, then the description (design spec §2).
 * The long hub sentences ("Downloaded — subscribed") are gone from here: 23
 * characters of state in front of 9 of description made every hub row's second
 * line unreadable, and the source word already says "Agent Hub". The default
 * state says nothing; `skillRowState` owns the priority.
 */
export function SkillsRoster({
	cards,
	selected,
	join,
	marked,
	onOpen,
}: {
	cards: readonly SkillCard[];
	selected: string | null;
	join: (card: SkillCard) => SkillHubJoin | null;
	/** `skill:<name>` -> created, for the rows a configuration run changed. */
	marked?: ReadonlyMap<string, boolean>;
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
				const mark = joinMark(joined);
				const state = skillRowState(card, joined, mark?.kind ?? null);
				const runMark = marked?.get(`skill:${card.name}`);
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
							data-skill-state={state ?? undefined}
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
							 * LINE ONE IS THE NAME, THE RUN'S BADGE AND THE SOURCE WORD, as in the
							 * Agents roster. The hub mark does not sit here: it and the source word
							 * are `shrink-0`, so a 30-character mark left the name 0 px wide (#1443
							 * design D1). The run badge is short ("Updated") and is the agents' own.
							 */}
							<span className="flex w-full items-center gap-2">
								<span className="min-w-0 truncate text-body-sm text-ink">
									{card.name}
								</span>
								{runMark !== undefined ? (
									<Badge variant="attention" data-testid="skill-row-updated">
										{t(
											runMark
												? "ui.agents.skills.badge.new"
												: "ui.agents.skills.badge.updated",
										)}
									</Badge>
								) : null}
								<span
									className="ms-auto max-w-[45%] shrink-0 truncate text-meta text-ink-dim"
									data-testid="skill-row-source"
								>
									{skillSourceWord(card.source)}
								</span>
							</span>
							{/*
							 * LINE TWO: one state word in its own ink, then the description. The
							 * whole line is one flex-free run that truncates at its end, so the
							 * state word can never push past the row.
							 */}
							<span
								className="block min-h-lh w-full min-w-0 truncate text-meta text-ink-muted"
								data-testid="skill-row-line2"
							>
								{state ? (
									<span data-testid="skill-row-state">
										{/*
										 * THE HUB'S OWN CHIP FOR THE HUB'S OWN MARKS (failed / available /
										 * applied): its glyph and ink are the Hub page's, so the two
										 * surfaces say a waiting update the same way. Inline, so the run
										 * still truncates as one line. The other states are plain words.
										 */}
										{mark && MARK_STATES.has(state) ? (
											<SkillMarkChip
												mark={mark}
												labels={SKILL_MARK_LABELS}
												className="inline-flex align-middle"
											/>
										) : (
											<span className={ROW_STATE[state].ink}>
												{t(ROW_STATE[state].key)}
											</span>
										)}
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
	scope = "all",
	selected,
	join,
	marked,
	onOpen,
}: {
	loading: boolean;
	failed: boolean;
	cards: readonly SkillCard[];
	/** Rows before the text filter: tells "nothing exists" from "nothing matches". */
	total: number;
	search: string;
	/** The scope segment; a narrowed scope with nothing in it says so in its own words. */
	scope?: SkillScope;
	selected: string | null;
	join: (card: SkillCard) => SkillHubJoin | null;
	marked?: ReadonlyMap<string, boolean>;
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
				data-skills-empty={
					total === 0 ? "none" : search.trim() ? "no-match" : "scope"
				}
			>
				{total === 0
					? t("ui.agents.skills.empty.none")
					: search.trim()
						? t("ui.agents.skills.empty.search", { query: search })
						: scope !== "all"
							? t(SCOPE_EMPTY_KEY[scope])
							: t("ui.agents.skills.empty.none")}
			</p>
		);
	return (
		<SkillsRoster
			cards={cards}
			selected={selected}
			join={join}
			marked={marked}
			onOpen={onOpen}
		/>
	);
}

/**
 * THE FAILED-UPDATE MARK ON THIS SURFACE SAYS ONLY THAT IT FAILED. The Hub's own
 * string is "Update failed - open to retry", true on the Hub page where the detail
 * has a retry, and false here: neither the row nor the details pane offers one
 * of its own (UX U1; lead decision on #1443). The hub panel under the header
 * carries its own Retry with its own words, so the row and the header keep the
 * short fact.
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
 * The read-only Alert per reason: the title says what it is, the body why and
 * the way out - the `Alert variant="info"` the built-in agent uses.
 */
const READ_ONLY_ALERT = {
	builtin: [
		"ui.agents.skills.alert.builtin_title",
		"ui.agents.skills.alert.builtin_body",
	],
	external: [
		"ui.agents.skills.alert.external_title",
		"ui.agents.skills.alert.external_body",
	],
	project: [
		"ui.agents.skills.alert.project_title",
		"ui.agents.skills.alert.project_body",
	],
	bundle: [
		"ui.agents.skills.alert.bundle_title",
		"ui.agents.skills.alert.bundle_body",
	],
} as const satisfies Record<string, readonly [MessageKey, MessageKey]>;

/** The draft an inline edit holds: the two fields the pane shows. */
type SkillDraft = { description: string; instructions: string };

/** A refusal's machine code, read off the transport's error (never its prose). */
function refusalCode(caught: unknown): string | null {
	const code = (caught as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : null;
}

/**
 * The open skill.
 *
 * THE HEADER IS THE AGENT PANE'S FRAME (design spec §3.1-§3.2): the title and one
 * plain meta line on the left, the action cluster centred on the TITLE line on
 * the right, the read-only Alert or a write's refusal under it, then the hub
 * panel slot. No primary button: a skill has no chat to start, and the accent is
 * spent on Send and focus. When Edit is not offered, "Ask for a change" takes the
 * bordered variant so the cluster still has exactly one bordered control.
 *
 * THE CLUSTER WAITS FOR THE DETAIL READ. Whether Edit is offered depends on the
 * reference files and truncation, which only the detail read knows; painting
 * Edit from the list row and then removing it would be a button that appears and
 * vanishes under the pointer.
 */
export function SkillDetail({
	name,
	card: listed,
	join,
	detail,
	onRetry,
	writesEnabled = false,
	askEnabled = false,
	onAsk,
	belowHeader,
	onDirtyChange,
	onRemoved,
}: {
	name: string;
	/** The list row, when the list has loaded and still holds the skill. */
	card: SkillCard | null;
	join: (card: SkillCard) => SkillHubJoin | null;
	detail: DetailQuery;
	onRetry: () => void;
	/** Core advertises `skill_write`: Edit, Copy to my skills and Remove. */
	writesEnabled?: boolean;
	/** The skill run is available: "Ask for a change" points the composer here. */
	askEnabled?: boolean;
	onAsk?: (name: string) => void;
	/** The hub links panel for a hub skill, the slot the agent pane has. */
	belowHeader?: ReactNode;
	/** Reports an unsaved inline edit, so the page can guard navigation. */
	onDirtyChange?: (dirty: boolean) => void;
	/** The skill left the library; the page closes it and moves focus on. */
	onRemoved?: (name: string) => void;
}) {
	useI18nLocale();
	const headingRef = useRef<HTMLHeadingElement>(null);
	const retryFocus = useRetryFocus(Boolean(detail.error), detail.isFetching);
	const writes = useSkillWrites();
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
	const body = skillBody(detail.data?.detail, wire);
	/*
	 * STRIPPED AFTER `skillBody`, never before: the slice there is in the raw
	 * body's UTF-16 units. A truncated body whose closing fence was cut is left
	 * whole by `splitFrontMatter`, so nothing is shown half-stripped.
	 */
	const parts = body === null ? null : splitFrontMatter(body);

	/* ---- inline edit: the agent pane's machine, for SKILL.md-only skills ---- */
	const seed = (): SkillDraft => ({
		description: card?.description ?? "",
		instructions: parts?.text ?? "",
	});
	const [editing, setEditing] = useState(false);
	const [base, setBase] = useState<SkillDraft>(seed);
	const [draft, setDraft] = useState<SkillDraft>(seed);
	const [confirmDiscard, setConfirmDiscard] = useState(false);
	const [conflict, setConflict] = useState(false);
	/** The fingerprint this edit was opened against: the save's compare-and-set. */
	const editBase = useRef<string | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const [removing, setRemoving] = useState<"ask" | "unpublished" | null>(null);
	const dirty =
		draft.description !== base.description ||
		draft.instructions !== base.instructions;
	const seedKey = `${card?.description ?? ""}\u0000${parts?.text ?? ""}`;
	/*
	 * A RE-SEED HAPPENS ONLY WHEN THE DRAFT IS CLEAN (the agent pane's rule): a run
	 * that changed this skill must not swap text under a draft being typed. A
	 * dirty draft keeps its text, and the save's fingerprint compare then refuses
	 * with `skill_stale` - the conflict Alert, with the draft intact (spec §5).
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `seedKey` is the content the seed reads; `seed` is a fresh closure every render.
	useEffect(() => {
		if (editing && dirty) return;
		const next = seed();
		setBase(next);
		setDraft(next);
	}, [seedKey, editing, dirty]);
	useEffect(() => {
		onDirtyChange?.(editing && dirty);
		// Withdrawn on the way out, so a closed pane cannot leave the page blocked.
		return () => onDirtyChange?.(false);
	}, [onDirtyChange, editing, dirty]);
	const cancel = () => {
		setEditing(false);
		setConfirmDiscard(false);
		setConflict(false);
		setFailure(null);
		const next = seed();
		setBase(next);
		setDraft(next);
	};
	const requestCancel = () => {
		if (confirmDiscard) {
			setConfirmDiscard(false);
			return;
		}
		if (dirty) setConfirmDiscard(true);
		else cancel();
	};
	useEscapeToCancel(requestCancel, editing);

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
	const mark = joinMark(joined);
	const modified = skillLocallyModified(joined);
	const headerState = skillHeaderState(card, joined);
	const files = wire?.files ?? [];
	const filesTotal = wire?.files_total ?? files.length;
	const localPath = joined?.link?.local_path ?? null;
	const known = Boolean(wire) && !detail.isLoading;
	const editability = skillEditability(card, wire);
	const canEdit = writesEnabled && editability.kind === "edit" && body !== null;
	const canAsk =
		askEnabled &&
		(editability.kind === "edit" || editability.kind === "ask") &&
		Boolean(onAsk);
	const canCopy =
		writesEnabled && editability.kind === "read-only" && editability.copy;
	const canRemove =
		writesEnabled &&
		card.installed &&
		(card.source === "local" || card.source === "hub") &&
		editability.kind !== "not-installed";
	const linked = card.source === "hub";
	const otherMeta = otherFrontMatter(parts?.meta ?? null);
	const readOnlyAlert =
		editability.kind === "read-only" && editability.reason !== "unknown"
			? READ_ONLY_ALERT[editability.reason]
			: null;

	const save = async () => {
		if (writes.update.isPending || body === null) return;
		if (!dirty) {
			cancel();
			return;
		}
		const fingerprint = editBase.current ?? card.fingerprint;
		if (!fingerprint) return;
		setFailure(null);
		try {
			await writes.update.mutateAsync({
				name: card.name,
				expectedFingerprint: fingerprint,
				/*
				 * The ORIGINAL file with only what changed: the description line when the
				 * description moved (every other front-matter key byte for byte), and
				 * the instructions after the fences. An unchanged description keeps its
				 * own bytes, folded or quoted, rather than being re-serialised.
				 */
				skillMd: rebuildSkillMd(
					body,
					card.name,
					draft.description === base.description ? null : draft.description,
					draft.instructions,
				),
			});
			setEditing(false);
			setConfirmDiscard(false);
			setBase(draft);
			showSuccessToast(t("ui.agents.skills.notice.saved", { name: card.name }));
			requestAnimationFrame(() => headingRef.current?.focus());
		} catch (caught) {
			if (refusalCode(caught) === "skill_stale") {
				setConflict(true);
				return;
			}
			setFailure(
				userFacingMessage(caught, t("ui.agents.skills.error.write_fallback")),
			);
		}
	};
	const copy = async () => {
		setFailure(null);
		try {
			await writes.copy.mutateAsync(card.name);
			showSuccessToast(
				t("ui.agents.skills.notice.copied", { name: card.name }),
			);
		} catch (caught) {
			setFailure(
				userFacingMessage(caught, t("ui.agents.skills.error.write_fallback")),
			);
		}
	};
	const remove = async (discardLocalChanges: boolean) => {
		setFailure(null);
		try {
			await writes.remove.mutateAsync({
				name: card.name,
				discardLocalChanges,
			});
			setRemoving(null);
			onRemoved?.(card.name);
		} catch (caught) {
			/*
			 * A LINKED COPY WITH UNPUBLISHED EDITS IS REFUSED UNTIL THE READER SAYS SO
			 * (core `remove_linked`): the second question names what would be lost,
			 * and only its confirm sends `discard_local_changes`.
			 */
			if (
				!discardLocalChanges &&
				refusalCode(caught) === "skill_local_changes_unpublished"
			) {
				setRemoving("unpublished");
				return;
			}
			setRemoving(null);
			setFailure(
				userFacingMessage(caught, t("ui.agents.skills.error.write_fallback")),
			);
		}
	};

	return (
		<div
			className="space-y-8"
			data-testid="skill-detail"
			data-skill={card.name}
			data-skill-editability={known ? editability.kind : undefined}
		>
			<header className="space-y-3">
				<div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
					<div className="min-w-0 flex-[1_1_16rem] space-y-1">
						<h2
							ref={headingRef}
							tabIndex={-1}
							className="truncate text-title focus:outline-none"
							title={card.name}
						>
							{card.name}
						</h2>
						<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
							<p
								className="text-body-sm text-ink-muted"
								data-testid="skill-meta"
							>
								{[
									skillSourceWord(card.source),
									headerState ? t(HEADER_STATE_KEY[headerState]) : null,
								]
									.filter(Boolean)
									.join(" · ")}
							</p>
							<SkillMarkChip mark={mark} labels={SKILL_MARK_LABELS} />
							{modified ? (
								<Badge variant="warning" data-testid="skill-modified">
									{t("ui.agents.detail.badge.modified")}
								</Badge>
							) : null}
						</div>
						{/* THE HONEST HALF OF "ANOTHER PUBLISHER'S SKILL" (spec C3): core keeps a
						    hub skill's edits on this machine and merges updates with them, and
						    the wire cannot say who publishes it, so the pane says what happens
						    rather than guessing who owns it. */}
						{linked && (canEdit || canAsk) ? (
							<p
								className="text-meta text-ink-muted"
								data-testid="skill-hub-local-note"
							>
								{t("ui.agents.skills.detail.hub_local_note")}
							</p>
						) : null}
					</div>
					{editing || !known ? null : (
						<SkillActions
							canEdit={canEdit}
							canAsk={canAsk}
							canCopy={canCopy}
							canRemove={canRemove}
							linked={linked}
							copying={writes.copy.isPending}
							onEdit={() => {
								setEditing(true);
								setFailure(null);
								setConflict(false);
								// The CAS base is the fingerprint at Edit, held across refetches.
								editBase.current = card.fingerprint;
							}}
							onAsk={() => onAsk?.(card.name)}
							onCopy={() => void copy()}
							onRemove={() => setRemoving("ask")}
						/>
					)}
				</div>
				{readOnlyAlert && known ? (
					<Alert variant="info" data-testid="skill-read-only">
						<AlertTitle>{t(readOnlyAlert[0])}</AlertTitle>
						<AlertDescription>{t(readOnlyAlert[1])}</AlertDescription>
					</Alert>
				) : null}
				{conflict ? (
					<Alert variant="warning" data-testid="skill-conflict">
						<AlertTitle>
							{t("ui.agents.detail.alert.conflict_title")}
						</AlertTitle>
						<AlertDescription>
							<span className="block">
								{t("ui.agents.skills.alert.conflict_body")}
							</span>
							<Button
								variant="secondary"
								size="sm"
								className="mt-2"
								onClick={cancel}
							>
								{t("ui.agents.detail.alert.conflict_reload")}
							</Button>
						</AlertDescription>
					</Alert>
				) : null}
				{failure ? (
					<Alert variant="danger" role="alert" data-testid="skill-write-error">
						<AlertTitle>
							{t("ui.agents.detail.alert.save_failed_title")}
						</AlertTitle>
						<AlertDescription>{failure}</AlertDescription>
					</Alert>
				) : null}
			</header>

			{belowHeader}

			{editing ? (
				<form
					noValidate
					className="space-y-8"
					onSubmit={(event) => {
						event.preventDefault();
						void save();
					}}
				>
					<EditSection
						title={t("ui.agents.detail.section.when_to_use")}
						description={t("ui.agents.skills.edit.description_help")}
						label={t("ui.agents.detail.section.when_to_use")}
						value={draft.description}
						onChange={(value) =>
							setDraft((current) => ({ ...current, description: value }))
						}
					/>
					<EditSection
						title={t("ui.agents.detail.section.instructions")}
						description={t("ui.agents.skills.edit.instructions_help")}
						label={t("ui.agents.detail.section.instructions")}
						value={draft.instructions}
						rows={12}
						onChange={(value) =>
							setDraft((current) => ({ ...current, instructions: value }))
						}
					/>
					<EditFooter
						submit
						confirming={confirmDiscard}
						onConfirmingChange={setConfirmDiscard}
						dirty={dirty}
						pending={writes.update.isPending}
						onSave={() => void save()}
						onCancel={cancel}
						dirtyHint={t("ui.agents.detail.action.discard_question")}
					/>
				</form>
			) : (
				<>
					<Section title={t("ui.agents.detail.section.when_to_use")}>
						<ReadBlock
							text={card.description}
							empty={t("ui.agents.detail.no_description")}
							showAllLabel={t("ui.agents.skills.detail.show_all")}
							showLessLabel={t("ui.agents.skills.detail.show_less")}
							breakLongTokens
						/>
					</Section>

					<Section
						title={t("ui.agents.detail.section.instructions")}
						description={
							known && editability.kind === "ask" && canAsk
								? t(
										editability.reason === "files"
											? "ui.agents.skills.detail.edit_by_asking"
											: "ui.agents.skills.detail.edit_by_asking_truncated",
									)
								: undefined
						}
					>
						{detail.isLoading ? (
							<div aria-hidden="true">
								<DetailSkeleton />
							</div>
						) : parts !== null ? (
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
								{/*
								 * MARKDOWN, AT READING WEIGHT, IN THE SAME CLAMP (operator brief:
								 * "markdown via ProjectMarkdown with the clamp"). A SKILL.md is
								 * markdown written for a model, and a monospace dump of it read as
								 * a file listing, not as instructions.
								 */}
								<div data-testid="skill-instructions">
									<ReadBlock
										text={parts.text}
										markdown
										showAllLabel={t("ui.agents.skills.detail.show_all")}
										showLessLabel={t("ui.agents.skills.detail.show_less")}
										breakLongTokens
									/>
								</div>
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
														aria-label={t(
															"ui.agents.skills.detail.preview_aria",
															{ path: file.path },
														)}
													>
														{/* The same clamp-and-expand block the body uses, so an
														    opened preview cannot push the rest of the pane below
														    the fold (design D6). File bytes are machine voice. */}
														{file.preview_truncated ? (
															<p className="text-meta text-ink-muted">
																{t("ui.agents.skills.detail.preview_truncated")}
															</p>
														) : null}
														<ReadBlock
															text={file.preview}
															mono
															showAllLabel={t(
																"ui.agents.skills.detail.show_all",
															)}
															showLessLabel={t(
																"ui.agents.skills.detail.show_less",
															)}
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

					{/*
					 * THE MACHINE FACTS, DEMOTED, NOT REMOVED (design spec §3.3 item 4): a
					 * 64-hex fingerprint at ink weight led the old pane. Collapsed by
					 * default, so nothing a reader needs first is behind it, and nothing in
					 * the file becomes unreachable (the other front-matter keys are here).
					 */}
					<div data-testid="skill-details">
						<Disclosure
							summary={
								<span className="text-heading">
									{t("ui.agents.skills.detail.section.details")}
								</span>
							}
						>
							<dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-body-sm">
								<dt className="text-ink-muted">
									{t("ui.agents.skills.detail.location_label")}
								</dt>
								<dd className="min-w-0 space-y-1 text-ink">
									<p>
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
									{linked && joined?.state.kind === "not-present" ? (
										<p className="text-meta text-ink-muted">
											{t("ui.agents.skills.hub.unlinked_help")}
										</p>
									) : null}
								</dd>
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
									className="min-w-0 break-all font-mono text-meta text-ink-muted"
									data-testid="skill-fingerprint"
								>
									{card.fingerprint ??
										t("ui.agents.skills.detail.fingerprint_none")}
								</dd>
								{otherMeta ? (
									<>
										<dt className="text-ink-muted">
											{t("ui.agents.skills.detail.front_matter_label")}
										</dt>
										<dd
											className="min-w-0 whitespace-pre-wrap break-all font-mono text-meta text-ink-muted"
											data-testid="skill-front-matter"
										>
											{otherMeta}
										</dd>
									</>
								) : null}
							</dl>
						</Disclosure>
					</div>
				</>
			)}

			{/*
			 * REMOVE ASKS FIRST, IN THE HUB PAGE'S DIALOG (spec §3.2). A linked skill's
			 * removal IS an unpull (core's DELETE), so it asks in the unpull's words;
			 * a local one names the backup it is kept in.
			 */}
			<Dialog
				open={removing !== null}
				onOpenChange={(open) => {
					if (!open) setRemoving(null);
				}}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>
							{removing === "unpublished"
								? t("ui.agents.skills.remove.unpublished_title")
								: linked
									? t("ui.hub.skills.unpull_title", { item: card.name })
									: t("ui.agents.skills.remove.title", { name: card.name })}
						</DialogTitle>
						<DialogDescription>
							{removing === "unpublished"
								? t("ui.agents.skills.remove.unpublished_body")
								: linked
									? t("ui.hub.skills.unpull_body")
									: t("ui.agents.skills.remove.body")}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setRemoving(null)}>
							{t("ui.hub.subscriptions.cancel")}
						</Button>
						<Button
							variant="danger"
							data-testid="skill-remove-confirm"
							disabled={writes.remove.isPending}
							onClick={() => void remove(removing === "unpublished")}
						>
							{removing === "unpublished"
								? t("ui.agents.skills.remove.discard_confirm")
								: t("ui.agents.skills.action.remove_confirm")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

/**
 * The header's action cluster, in the agent pane's order: secondary, then
 * ghost, then More. Exactly one bordered control whenever any is offered.
 */
function SkillActions({
	canEdit,
	canAsk,
	canCopy,
	canRemove,
	linked,
	copying,
	onEdit,
	onAsk,
	onCopy,
	onRemove,
}: {
	canEdit: boolean;
	canAsk: boolean;
	canCopy: boolean;
	canRemove: boolean;
	linked: boolean;
	copying: boolean;
	onEdit: () => void;
	onAsk: () => void;
	onCopy: () => void;
	onRemove: () => void;
}) {
	if (!canEdit && !canAsk && !canCopy && !canRemove) return null;
	return (
		<div
			className={cn("flex shrink-0 items-center gap-2", TITLE_LINE_HEIGHT)}
			data-testid="skill-actions"
		>
			{canEdit ? (
				<Button variant="secondary" onClick={onEdit} data-testid="skill-edit">
					{t("ui.agents.detail.action.edit")}
				</Button>
			) : null}
			{canCopy ? (
				<Button
					variant="secondary"
					onClick={onCopy}
					disabled={copying}
					data-testid="skill-copy"
				>
					{copying
						? t("ui.agents.skills.action.copying")
						: t("ui.agents.skills.action.copy")}
				</Button>
			) : null}
			{canAsk ? (
				<Button
					variant={canEdit ? "ghost" : "secondary"}
					onClick={onAsk}
					data-testid="skill-ask"
				>
					{t("ui.agents.detail.action.ask_change")}
				</Button>
			) : null}
			{canRemove ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							aria-label={t("ui.agents.detail.action.more_actions")}
							className="-mr-2"
							data-testid="skill-more"
						>
							<MoreHorizontal aria-hidden="true" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onSelect={onRemove}>
							{linked
								? t("ui.hub.skills.unpull")
								: t("ui.agents.skills.action.remove")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
		</div>
	);
}
