/**
 * The Agents and teams page: a roster you can read, a definition you can read
 * before you edit it, and a composer that asks for a change in words.
 *
 * WHAT THE OPERATOR SAID ABOUT THIS PAGE, and what is done about each part. "It
 * is a blocky free-text form" (the page's own report) and the design consult's
 * measurements: a read-only view that painted exactly like an editable one (D1);
 * structured data — tools, effort, manager, members — accepted as free text and
 * silently wrong (D2); a list that said nothing about what it listed (D3);
 * loading, empty and error states that contradicted each other (D4); every
 * action at the same weight with the primary one below the fold (D5); two `h1`s
 * on one page (D9). The UX exploration added the flow defects: a failed save that
 * dead-locked the form until a reload (U1, the blocker), no Cancel and a silent
 * discard (U3), a save that sent every field and reverted an out-of-band write
 * (U5), a detail that never noticed an outside change (U6), and rows a keyboard
 * user had to Tab through (U12).
 *
 * WHY THE ROSTER IS THE LEADING COLUMN AND THE BROWSE BAR SITS WITH IT. The
 * Agent hub (#681) puts its Agents | Teams tabs in a bar that spans the page,
 * because its tabs change what the CONTENT column shows. Here they change what
 * the ROSTER shows, and the roster is the leading column of a master-detail
 * page — so the same `Tabs` component and the same counts live where the thing
 * they switch is, which is the one place the two surfaces deliberately differ.
 * Everything else is taken from the hub rather than invented: `TabsList` with
 * `aria-label`, the count slot, and the `Showing` + `aria-pressed` chip group
 * (design consult § 5, "build to the same contract").
 *
 * WHAT IS NOT HERE. No delete: no `profiles.*`/`teams.*` desktop op deletes
 * anything (design consult § 1), so there is no control rather than one that
 * cannot work. No rename of an existing agent or team, for the tool's own reason
 * (`agent_tool.py` cannot rename). No model picker on the run — the backend
 * chooses the configured default, and the strip names it.
 */

import {
	displayNameFor,
	useAidaDisplayName,
} from "@features/aida/use-aida-target";
import {
	CHAT_COLUMN_CONTAINER,
	CHAT_COLUMN_INSET,
	CHAT_MEASURE,
} from "@features/chat/chat-measure";
import { rowCurrent } from "@features/chat/components/chat-sidebar";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	type ReusableProfile,
	type ReusableTeam,
	useProfileDetail,
	useProfiles,
	useTeamDetail,
	useTeams,
} from "@shared/api/local-operator/profile-hooks";
import { teamDisplayName } from "@shared/api/local-operator/team-display";
import { useLaneLeadingColumn } from "@shared/components/common/chat-layout";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@shared/components/ui/alert";
import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { Skeleton } from "@shared/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@shared/components/ui/tabs";
import { cn } from "@shared/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bot, Plus, Search, Users } from "lucide-react";
import {
	Suspense,
	lazy,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
	ConfigComposer,
	askForChange,
	discardSeededConfigBox,
} from "../config-run/config-composer";
import { targetKey, useConfigRunStore } from "../config-run/config-run-store";
import { useConfigRun } from "../config-run/use-config-run";
import { CLASS_LABEL, classOf } from "../utils/agent-class";
import { AgentCreate, AgentDetail } from "./agent-detail";
import {
	DetailSkeleton,
	PaneError,
	RosterSkeleton,
	SourceChip,
} from "./detail-parts";
import { HubUpdatePanel } from "./hub-update-panel";
import { TeamDetail, memberCountLabel } from "./team-detail";

// Old UUID links remain ordinary chat-agent settings, not reusable profiles.
// Loading them explicitly preserves compatibility without contaminating the
// canonical catalogue or silently converting somebody's saved conversation.
const LegacyAgentsPage = lazy(() =>
	import("./legacy-agents-page").then((module) => ({
		default: module.LegacyAgentsPage,
	})),
);

/** The scope chips, in the hub's `Showing` register: who owns the definition. */
type Scope = "all" | "custom" | "installed" | "builtin";

/** The settings keys that name an effort tier: `subagents.models.<tier>`. */
const EFFORT_TIER_KEY = /^subagents\.models\.([^.]+)$/;

/**
 * The tiers the harness will honour, in the operator's vocabulary.
 *
 * Mirrors `CANONICAL_EFFORT_TIERS` (`harness/subagent.py`) and its companion
 * narrowing in `read_effort_tier_selectors`: the tool schema and the launch path
 * both filter to these three, so a picker that offered a fourth would be
 * offering a value the save refuses.
 */
const CANONICAL_EFFORT_TIERS: readonly string[] = ["lo", "med", "hi"];

const SCOPE_LABEL: Record<Scope, string> = {
	all: "All",
	custom: "Custom",
	installed: "Installed",
	builtin: "Built-in",
};

/**
 * A key that changes when the FETCHED definition changes, and only then.
 *
 * The detail panes below seed their draft once, on mount, so a hub update that
 * rewrote a definition under an open editor left the OLD text on screen, and
 * Edit - Save wrote it back over the merge (agent review round 1, R1). Keying the
 * pane on the content re-seeds it, while an unrelated refetch (window focus)
 * returns identical content, the same key and no remount, so an edit in progress
 * survives it. The page-level consequence of that remount is stated where the
 * notice lives, inside the component.
 *
 * The digest is length + FNV-1a over the serialised record: cheap enough to run
 * on every render of a pane, and only ever compared, never parsed.
 */
const contentKey = (value: unknown) => {
	const text = JSON.stringify(value) ?? "";
	let hash = 5381;
	for (let index = 0; index < text.length; index += 1)
		hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
	return `${text.length}.${hash.toString(36)}`;
};

export function AgentsPage() {
	const laneLeadingColumn = useLaneLeadingColumn("surface");
	const { agentId } = useParams<{ agentId?: string }>();
	const [params, setParams] = useSearchParams();

	const teamMode =
		params.get("kind") === "team" || params.get("create") === "team";
	const creating = params.has("create");
	const name = params.get("name");
	const duplicateOf = params.get("duplicate");

	const capabilities = useDesktopCapabilities();
	const catalogueEnabled = desktopFeatureEnabled(
		capabilities.data,
		teamMode ? "team_catalogue" : "profile_catalogue",
	);

	/*
	 * BOTH LISTS ARE READ ON BOTH TABS, and that is a deliberate change. The old
	 * page enabled one and not the other, which is why an agent's "Used by" was
	 * unanswerable, why a team's member names could not be resolved against the
	 * agent list (U7), and why a run's diff had only half a catalogue to compare.
	 * Two cheap list reads are the price of the page being able to say what it
	 * means.
	 */
	const profiles = useProfiles(catalogueEnabled);
	const teams = useTeams(catalogueEnabled);
	const detailEnabled = catalogueEnabled && Boolean(name) && !creating;

	const profileDetail = useProfileDetail(teamMode ? null : name, detailEnabled);
	const teamDetail = useTeamDetail(teamMode ? name : null, detailEnabled);
	/*
	 * THE RECORD BEING DUPLICATED, FETCHED RATHER THAN LOOKED UP IN THE LIST.
	 * The form used to be seeded from the roster row, and a roster row carries no
	 * `instructions` (`profile_catalogue` builds with `detail=False`) — so
	 * Duplicate opened a form that had the name and an EMPTY instructions box,
	 * and pressing Create refused with the field-level copy for input the user
	 * never had (QA round 1, Q3). This is the same detail read the pane uses.
	 */
	const duplicateDetail = useProfileDetail(
		teamMode ? null : duplicateOf,
		Boolean(duplicateOf),
	);

	const [search, setSearch] = useState("");
	const [scope, setScope] = useState<Scope>("all");
	/*
	 * WHICH PANE SAID IT WAS DIRTY, rather than a bare boolean.
	 *
	 * A lone `editDirty` could only ever be as fresh as the last report, and the
	 * last report of an unmounted pane is a stale `true`: cancelling a dirty
	 * create, duplicating from a dirty edit or switching to a tab with nothing
	 * selected left the docked composer blocked on "Finish or cancel your edit
	 * first" with no editor open, until a reload (review round 1, M1 / D1).
	 *
	 * The pane's identity is the record it is about (`agent:name`, `team:create`),
	 * so a report from a pane that is no longer the one on screen simply stops
	 * counting — the flag cannot outlive the record, by construction rather than
	 * by an effect that remembers to clear it. The panes also withdraw their
	 * report on unmount, which covers the same window from the other side.
	 */
	/**
	 * A navigation the operator has asked for while an edit is dirty.
	 *
	 * THE PANES ARE KEYED BY RECORD, so opening another row remounts the detail
	 * and the draft goes with the unmount — which is correct and is also why it
	 * must not happen silently. Both review rounds found the opposite failure
	 * (the draft FOLLOWED the click and Save wrote it onto the next row); the
	 * fix is the key, and this is the question that goes with it (D1/U1/Q1).
	 */
	const [pendingNav, setPendingNav] = useState<NavIntent | null>(null);
	const [dirtyIdentity, setDirtyIdentity] = useState<string | null>(null);
	const run = useConfigRun();
	const marks = useConfigRunStore((state) => state.marks);
	const clearMark = useConfigRunStore((state) => state.clearMark);

	/*
	 * The effort tiers a profile may name, read from the backend's own settings:
	 * `subagents.models.*` is what `agent_tool.py` validates an effort against, so
	 * only the values a save will accept — a free text field
	 * here is how `turbo-9000` got typed and refused later (U2).
	 *
	 * ONLY THE TIERS THAT ARE ACTUALLY CONFIGURED, AND ONLY THE CANONICAL THREE
	 * (review round 1, m5). The backend validates against
	 * `configured_effort_tiers()`: a tier whose selector is empty is refused on
	 * save ("no tiers are configured under subagents.models"), and a key outside
	 * `lo|med|hi` is never offered to the tool at all. Listing a key the harness
	 * would reject is the picker steering the operator into a guaranteed failure,
	 * which is the same defect class as the free-text field it replaced.
	 */
	const settings = useQuery({
		queryKey: ["desktop", "settings", "effort-tiers"],
		enabled: catalogueEnabled,
		queryFn: () =>
			desktopResult<{ settings: { key: string; value: unknown }[] }>({
				op: "settings.list",
			}),
		staleTime: 60_000,
	});
	const effortTiers = useMemo(
		() =>
			(settings.data?.settings ?? [])
				.filter((row) => {
					const tier = row.key.match(EFFORT_TIER_KEY)?.[1];
					if (!tier || !CANONICAL_EFFORT_TIERS.includes(tier)) return false;
					return typeof row.value === "string" && row.value.trim().length > 0;
				})
				.map((row) => row.key.match(EFFORT_TIER_KEY)?.[1])
				.filter((tier): tier is string => Boolean(tier)),
		[settings.data],
	);

	/*
	 * HER NAME IS A READ, NOT A STRING (UX round 2, U3). The roster lists the
	 * seat like any other role, under the registry name it is addressed by - and
	 * the seat's row in the rail, the pane's heading and the receipt a switch
	 * shows must print the name the operator gave her, or the same agent wears
	 * two names in one window. `useAidaDisplayName` is the one reader of that
	 * field (`aida.status` -> `DesktopAidaState.name`), and it answers the
	 * shipped default when the backend is older or the read is in flight.
	 */
	const aidaName = useAidaDisplayName();
	const printName = useCallback(
		(name: string) => displayNameFor(name, aidaName),
		[aidaName],
	);

	const agentRows = useMemo(
		() => propsFilter(profiles.data, search, scope, printName),
		[profiles.data, search, scope, printName],
	);
	const teamRows = useMemo(
		() => teamsFilter(teams.data, search),
		[teams.data, search],
	);
	const rows = teamMode ? teamRows : agentRows;
	const selected = name ?? null;
	/*
	 * THE CLASS SWITCH'S FAILURE SENTENCE LIVES HERE, at the level that survives
	 * its own refresh (UX round 2, U1). The control re-reads on every failure and
	 * the record change remounts `AgentDetail` - so a sentence held inside the
	 * control would be erased by the re-read that corrects the switch, and the
	 * ambiguous case it exists for would flash and vanish. It is dropped when the
	 * reader moves to another definition, and it is keyed by name so a late
	 * arrival for the previous one cannot land on the next.
	 */
	const [classNotice, setClassNotice] = useState<{
		name: string;
		copy: string;
	} | null>(null);
	/*
	 * CLEARED DURING RENDER, not in an effect, and React's own answer to "state
	 * that must not follow a changed selection": the setter is stable, so an
	 * effect whose only dependency is `selected` is a dependency list Biome
	 * rejects, and the reset is one comparison here anyway. A sentence from the
	 * previous definition must not greet the next one.
	 */
	if (classNotice !== null && classNotice.name !== selected)
		setClassNotice(null);
	const go = useCallback(
		(next: NavIntent) => {
			const search = new URLSearchParams();
			const kind = next.kind ?? (teamMode ? "team" : "agent");
			if (kind === "team") search.set("kind", "team");
			if (next.name) search.set("name", next.name);
			if (next.create !== null && next.create !== undefined)
				search.set("create", next.create);
			if (next.duplicate) search.set("duplicate", next.duplicate);
			// Any real navigation resolves a pending question, whichever route asked
			// for it (the guard's own button, a browser Back, a deep link).
			setPendingNav(null);
			setParams(search);
		},
		[teamMode, setParams],
	);

	/*
	 * WHICH PANE SAID IT WAS DIRTY, rather than a bare boolean.
	 *
	 * A lone `editDirty` could only ever be as fresh as the last report, and the
	 * last report of an unmounted pane is a stale `true`: cancelling a dirty
	 * create, duplicating from a dirty edit or switching to a tab with nothing
	 * selected left the docked composer blocked on "Finish or cancel your edit
	 * first" with no editor open, until a reload (review round 1, M1 / D1).
	 *
	 * The pane's identity is the record it is about (`agent:name`, `team:create`),
	 * so a report from a pane that is no longer the one on screen stops counting —
	 * the flag cannot outlive the record, by construction rather than by an effect
	 * that remembers to clear it. The panes withdraw their report on unmount too,
	 * which covers the same window from the other side.
	 */
	const paneIdentity = `${teamMode ? "team" : "agent"}:${creating ?? ""}:${selected ?? ""}`;
	const reportDirty = useCallback(
		(dirty: boolean) => setDirtyIdentity(dirty ? paneIdentity : null),
		[paneIdentity],
	);
	const editDirty = dirtyIdentity !== null && dirtyIdentity === paneIdentity;

	/*
	 * A HUB UPDATE THAT LANDS UNDER AN OPEN EDITOR (agent review round 2, R2-5; the
	 * keying half is R1 above). A remount discards whatever the person had typed,
	 * and the hub is the one thing that changes a definition with no action taken in
	 * this pane, so the page SAYS so instead of replacing an in-flight edit
	 * silently.
	 *
	 * `editDirty` is the right flag and needs no ref: it is the value from THIS
	 * render, and the pane that withdraws its own report on unmount only moves it in
	 * the next one, so the content change under a dirty editor is never missed and a
	 * clean editor never raises the notice. The comparison is scoped by identity the
	 * same way `editDirty` is - a change of record adopts it as seeded and clears the
	 * notice rather than comparing across two definitions (agent review round 3, N1).
	 */
	const [lostEdits, setLostEdits] = useState(false);
	const openIdentity = `${teamMode ? "team" : "agent"}:${selected ?? ""}`;
	const openContent = teamMode
		? teamDetail.data
			? contentKey(teamDetail.data)
			: null
		: profileDetail.data
			? contentKey(profileDetail.data)
			: null;
	const seededPane = useRef<{ identity: string; content: string | null }>({
		identity: openIdentity,
		content: openContent,
	});
	useEffect(() => {
		if (seededPane.current.identity !== openIdentity) {
			seededPane.current = { identity: openIdentity, content: openContent };
			setLostEdits(false);
			return;
		}
		if (openContent === null || seededPane.current.content === null) {
			/*
			 * NOTHING TO COMPARE AGAINST: the pane is unmounted, or its read has not
			 * landed yet. Seed silently - announcing the first real content as a
			 * change would put the notice over a pane that was merely empty a moment
			 * ago (agent review round 4, R4-N2).
			 */
			seededPane.current = { identity: openIdentity, content: openContent };
			return;
		}
		if (seededPane.current.content === openContent) return;
		seededPane.current.content = openContent;
		if (editDirty) setLostEdits(true);
	}, [openIdentity, openContent, editDirty]);

	/** The panel and the replaced-edit notice, above whichever pane is open. */
	const hubPane = (kind: "agent" | "team", itemName: string) => (
		<>
			{/* Renders nothing unless the hub lists THIS item as not up to date. */}
			<HubUpdatePanel
				kind={kind}
				name={itemName}
				enabled={desktopFeatureEnabled(capabilities.data, "hub_updates")}
			/>
			{lostEdits && (
				/*
				 * `output` carries the `status` role, which is what this is.
				 *
				 * IT WEARS ITS NEIGHBOURS' MEASUREMENTS. The panel above it and the pane
				 * below it all sit in the page's one measure wrapper now (they used to
				 * be `max-w-3xl` each, which a notice outside that cap stretched past),
				 * so it takes the wrapper's width and the panel's own `mb-8` - the
				 * section tier - for the same reason (design review round 4, R4-M1).
				 */
				<output className="mb-8 block rounded-md border border-warning-border px-3 py-2 text-meta text-ink-muted">
					The hub updated this definition while you were editing, and the form
					below now shows the merged version. Edits you had not saved were
					replaced.
				</output>
			)}
		</>
	);

	/**
	 * Navigation that ASKS when an edit is unsaved, and does not when it is not.
	 *
	 * Every roster click, tab switch, "Add manually" and link between a team and
	 * its agents goes through here. A dirty draft used to be discarded with no
	 * question (U9) or — worse, after the key was missing — carried onto the next
	 * record (D1/U1/Q1). Neither is acceptable, so the question is asked once, in
	 * the pane the operator is looking at.
	 */
	const requestGo = useCallback(
		(next: NavIntent) => {
			if (editDirty) {
				setPendingNav(next);
				return;
			}
			go(next);
		},
		[editDirty, go],
	);

	/*
	 * ESCAPE LEAVES A DEFINITION AT NARROW WIDTHS, where the roster is hidden and
	 * there was no way back at all (review round 1, U5/D6). The panes' own Escape
	 * (cancel the edit) runs first and marks the key handled, so this never
	 * discards an edit without the question. Above 1000 px the roster is visible
	 * and Escape stays what it was.
	 */
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (!window.matchMedia("(max-width: 999px)").matches) return;
			if (!selected && !creating) return;
			event.preventDefault();
			requestGo({ name: null });
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [requestGo, selected, creating]);

	/*
	 * THE TARGET FOLLOWS THE SELECTION (review round 1, U6 / D2).
	 *
	 * `about` lives in a module-scope store, so it outlived the row it named: open
	 * `reviewer`, press "Ask for a change", click `scout` (or switch to Teams) and
	 * the composer still said "About agent reviewer" with the placeholder
	 * `Change reviewer…` — a run pointed at an agent that is not on screen, which is
	 * the same wrong-record failure as the carried draft, one layer down.
	 *
	 * The SEEDED draft goes with the target, and only the seeded one: text the
	 * operator typed is theirs, and deleting it because they clicked a row would be
	 * a worse bug than the stale chip. That sentence is now the box's text in the
	 * conversation-input store (`discardSeededConfigBox`), which is the store the box
	 * renders — the run store's own `draft` copy this used to clear was rendered by
	 * nothing and was removed in QA round 2 (Q1).
	 */
	useEffect(() => {
		const state = useConfigRunStore.getState();
		const about = state.about;
		if (!about) return;
		const kind = teamMode ? "team" : "agent";
		if (selected && about.kind === kind && about.name === selected) return;
		run.setAbout(null);
		discardSeededConfigBox(about);
	}, [selected, teamMode, run]);

	/*
	 * A ROW THAT WAS MARKED IS UNMARKED BY BEING OPENED — the one-time mark the
	 * design asks for, cleared where the operator has actually read it rather than
	 * on a timer.
	 */
	useEffect(() => {
		if (!selected) return;
		clearMark({ kind: teamMode ? "team" : "agent", name: selected });
	}, [selected, teamMode, clearMark]);

	const refreshAll = () => {
		void profiles.refetch();
		void teams.refetch();
		void profileDetail.refetch();
		void teamDetail.refetch();
	};

	if (agentId)
		return (
			<Suspense
				fallback={<p className="p-6 text-body">Loading saved agent…</p>}
			>
				<LegacyAgentsPage />
			</Suspense>
		);

	const detailError = teamMode ? teamDetail.error : profileDetail.error;
	const listError = teamMode ? teams.error : profiles.error;

	/*
	 * Whether the main column is showing the nothing-selected pane — which leads
	 * with its OWN composer (design § 5). Rendering the docked one beside it too
	 * put two composers, two strips and two of every id on screen (M3/D3/U2/Q8).
	 */
	const showsEmptyPane =
		catalogueEnabled && !listError && !creating && !selected;

	const detailLoading = teamMode
		? teamDetail.isLoading
		: profileDetail.isLoading;

	return (
		<div className="flex h-full min-h-0 bg-canvas text-ink">
			{/*
			 * The leading column keeps the shell's own ground rule (`chat-layout`).
			 *
			 * IT IS HIDDEN WHILE A ROW IS OPEN AT NARROW WIDTHS, which is the design
			 * brief's narrow rule: below ~1000px the roster IS the page and the detail
			 * pushes in over it with a back control, rather than both panes shrinking
			 * until neither is readable. Above that width the two sit side by side as
			 * before.
			 */}
			<aside
				ref={laneLeadingColumn}
				// The narrow-width rule rides a data attribute rather than a `cn`
				// expression so this element keeps a plain class literal: it is the
				// ground the roster's row states are painted on, and the row-surface
				// guard reads that literal (`data-open` is true only while a definition
				// is open, which is exactly when the roster steps aside for the detail).
				data-open={selected ? "true" : undefined}
				className="flex w-72 shrink-0 flex-col gap-3 bg-surface p-4 max-[999px]:data-[open=true]:hidden"
			>
				{/* The page's ONLY h1 (design D9): a definition's name is an h2. */}
				<h1 className="text-heading">Agents and teams</h1>

				{/*
				 * ONE CLUSTER, 8 px INSIDE AND 12 px BETWEEN COMPONENTS (design spec s3):
				 * tabs, search and scope are one control stack, so they sit closer to each
				 * other than to the list below and the button beneath it. Each is
				 * full-width, so their right edges are one line.
				 */}
				<div className="space-y-2">
					<Tabs
						value={teamMode ? "team" : "agent"}
						onValueChange={(next) =>
							requestGo({ kind: next as "agent" | "team", name: null })
						}
					>
						<TabsList
							aria-label="Browse definitions by type"
							className="w-full"
						>
							<TabsTrigger
								value="agent"
								className="flex-1"
								data-testid="agents-tab"
							>
								<Bot className="size-3.5" />
								Agents
								{profiles.data ? (
									<span className="min-w-[2ch] font-normal text-ink-dim tabular-nums">
										{profiles.data.length}
									</span>
								) : null}
							</TabsTrigger>
							<TabsTrigger
								value="team"
								className="flex-1"
								data-testid="teams-tab"
							>
								<Users className="size-3.5" />
								Teams
								{teams.data ? (
									<span className="min-w-[2ch] font-normal text-ink-dim tabular-nums">
										{teams.data.length}
									</span>
								) : null}
							</TabsTrigger>
						</TabsList>
					</Tabs>

					<div className="relative">
						<Search
							aria-hidden="true"
							className="pointer-events-none absolute top-2 left-2 size-4 text-ink-dim"
						/>
						<Input
							className="pl-8"
							type="search"
							aria-label="Search agents and teams"
							placeholder={teamMode ? "Search teams" : "Search agents"}
							value={search}
							onChange={(event) => setSearch(event.target.value)}
						/>
					</div>

					{/*
					 * The scope axis for this page is WHO OWNS the definition — on-device
					 * versus shipped — where the hub's is where it lives. Same register, same
					 * meaning of "showing", which is what makes the two read as one system.
					 * Teams have no `source` on the wire, so the control is the agents' alone
					 * rather than a chip row that does nothing.
					 */}
					{!teamMode && profiles.data ? (
						<fieldset className="m-0 min-w-0 border-0 p-0">
							<legend className="sr-only">Show definitions owned by</legend>
							{/*
							 * NO VISIBLE "Showing" LABEL (design spec D10): it cost 24 px of height
							 * and pushed the segments' right edge in from the tabs' and the search's.
							 * The legend keeps the group's accessible name, and `aria-pressed` on
							 * each segment keeps its state, so nothing a screen reader had is lost;
							 * the segments are the visible words. `flex-1` makes the group span the
							 * column like its two siblings.
							 */}
							<div className="flex gap-0.5 rounded-md bg-sunken p-0.5">
								{(Object.keys(SCOPE_LABEL) as Scope[]).map((value) => (
									<Button
										key={value}
										variant="ghost"
										size="sm"
										aria-pressed={scope === value}
										onClick={() => setScope(value)}
										className={cn("flex-1", scope === value && rowCurrent)}
									>
										{SCOPE_LABEL[value]}
									</Button>
								))}
							</div>
						</fieldset>
					) : null}
				</div>

				{/* The roster: a listbox, so arrow keys move between rows (U12). */}
				<div
					/*
					 * The roster scroller takes the pane's 24 px edge mask (design spec s3),
					 * so rows dissolve into the footer instead of being sliced at it.
					 */
					data-lo-pane-edge-cues
					className="min-h-0 flex-1 overflow-y-auto"
				>
					{listError ? null : !profiles.data && !teams.data ? (
						<RosterSkeleton />
					) : rows.length === 0 ? (
						<p className="px-1 py-2 text-body-sm text-ink-muted">
							{search
								? `Nothing matches “${search}”.`
								: teamMode
									? "No teams yet. Ask for one below, or add one by hand."
									: scope === "all"
										? "No agents yet. Ask for one below, or add one by hand."
										: `No ${SCOPE_LABEL[scope].toLowerCase()} agents.`}
						</p>
					) : (
						<Roster
							rows={rows}
							name={creating ? null : selected}
							teamMode={teamMode}
							printName={printName}
							marked={
								new Map(marks.map((mark) => [targetKey(mark), mark.created]))
							}
							/*
							 * THROUGH THE GUARD, never straight to the route: a dirty draft on the
							 * row being left has to be asked about (D1/U1/Q1), and the pane is
							 * keyed by record, so the navigation IS the discard.
							 */
							onOpen={(rowName) => requestGo({ name: rowName })}
						/>
					)}
				</div>

				{/*
				 * GHOST, FULL-WIDTH, LEFT-ALIGNED (design spec D15): it is the list's last
				 * affordance, not a boxed button - a bordered secondary was the heaviest
				 * object in the column for a secondary job.
				 */}
				<Button
					variant="ghost"
					className="w-full justify-start"
					disabled={!catalogueEnabled}
					onClick={() => requestGo({ create: teamMode ? "team" : "agent" })}
				>
					<Plus className="size-4" />
					{teamMode ? "Add team manually" : "Add agent manually"}
				</Button>
			</aside>

			{/*
			 * The detail column, with the composer docked at its foot. The composer is
			 * OUTSIDE the scroller so the page can be read without it moving, and its
			 * slot exists in every state (design § 4.3: a strip that pushes the detail
			 * pane when it appears is the jank the design calls out).
			 */}
			<main className="flex min-w-0 flex-1 flex-col">
				{/*
				 * `pb-0`, not `p-6`: the detail's own pinned footer sticks to the BOTTOM
				 * of this scroller, and a bottom padding under it left a 24px band where
				 * the sections kept scrolling through beneath the bar (measured in the
				 * edit-mode frames). The footer supplies the spacing instead.
				 */}
				{/*
				 * THE WAY BACK AT NARROW WIDTHS (design review round 1, D6 / UX U5).
				 * Below 1000 px the roster is `display:none` while a definition is open,
				 * and the pane's only controls were New chat / Edit / Duplicate / Ask —
				 * there was no Back at all, so the sole exit was the rail's icon, which
				 * lands on the empty pane rather than the list. Escape does the same thing
				 * for the keyboard (see the page's own handler).
				 */}
				{selected || creating ? (
					<div className="flex shrink-0 items-center border-hairline border-b px-4 py-2 min-[1000px]:hidden">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => requestGo({ name: null })}
						>
							<ArrowLeft className="size-4" />
							Back to the list
						</Button>
					</div>
				) : null}
				<div
					/*
					 * THE PANE'S SCROLLER, NAMED FOR THE EVIDENCE RIG. The class control
					 * sits below the fold at the narrow widths the design round asked for, and
					 * a frame has to park this element at its end to contain the section it is
					 * captioned with - a `scrollTo` cannot reach it, because the pane is too
					 * short to bring the section to the top. A class selector would have been
					 * a second way to name the region the rig reads, which is what the other
					 * `data-*` hooks exist to avoid.
					 */
					data-agents-pane
					/*
					 * THE FADE AT THE DOCK'S EDGE (design spec s6.3). The scroller used to end
					 * in a hard cut against the composer, slicing a heading in half. The
					 * sidebar's 24 px scroll-driven mask answers the same problem and is
					 * element-agnostic (`index.css`), so the pane takes the same attribute
					 * rather than growing a second fade.
					 */
					data-lo-pane-edge-cues
					className={cn(
						"min-h-0 flex-1 overflow-auto",
						/*
						 * THE 24 PX EDGE, BY ARITHMETIC. The hero is un-padded: it is its own
						 * column, and the band inside `MessageInput` is the only inset on its
						 * box. Every other state is a scroller with a classic 8 px scrollbar, so
						 * `px-4` (16) plus the 8 px gutter reserved on BOTH edges is 24 - the
						 * transcript's own sum (`chat-measure.ts`) - and the detail column and
						 * the docked box then have the same content width, so `CHAT_MEASURE`'s
						 * 750 px gate and 810 cap resolve identically in both. Do not "fix" the
						 * 16: with an overlay scrollbar (the capture rig's) the gutter is 0 and
						 * the edge reads 16, which is the rig, not the page.
						 *
						 * NO BOTTOM PADDING: the edit footer sticks to the scroller's foot, and a
						 * padding under it left a band where sections scrolled through beneath
						 * the bar. The status row above the box is the breathing room.
						 */
						showsEmptyPane
							? undefined
							: "px-4 pt-6 [scrollbar-gutter:stable_both-edges]",
					)}
				>
					{showsEmptyPane ? (
						<EmptyPane
							teamMode={teamMode}
							run={run}
							onAddManually={() =>
								requestGo({ create: teamMode ? "team" : "agent" })
							}
						/>
					) : (
						/*
						 * ONE WRAPPER FOR EVERY NON-HERO STATE: the capability alert, a failed
						 * read, the skeleton, the hub panel and the detail all sit in the same
						 * `CHAT_COLUMN_CONTAINER` > `CHAT_MEASURE` chain as the docked box, so
						 * their left and right edges ARE the box's (design spec D2/D3). Nothing
						 * below this line sets horizontal padding, margin or a max-width.
						 */
						<div className={CHAT_COLUMN_CONTAINER}>
							<div className={CHAT_MEASURE}>
								{!catalogueEnabled ? (
									/*
									 * THREE STATES, THREE TITLES. While the capabilities read is in flight
									 * the page used to shout "needs a newer backend" over a body that said
									 * "Connecting…" — a fault the body denied (design review round 1, D7).
									 * Connecting is neutral; only an ANSWERED `false` is a version claim.
									 */
									<Alert
										variant={capabilities.isLoading ? "neutral" : "warning"}
										className="max-w-xl"
									>
										<AlertTitle>
											{capabilities.isLoading
												? "Connecting to the backend"
												: capabilities.error
													? "The backend could not be reached"
													: "Reusable agents need a newer backend"}
										</AlertTitle>
										<AlertDescription>
											{capabilities.isLoading
												? "Loading what this backend can do…"
												: capabilities.error
													? capabilities.error.message
													: "Update the backend to manage reusable agents and teams. Saved chats are unchanged."}
										</AlertDescription>
									</Alert>
								) : listError ? (
									<PaneError
										title={
											teamMode
												? "Teams could not be read"
												: "Agents could not be read"
										}
										what={
											listError instanceof Error
												? listError.message
												: "The request did not complete."
										}
										meaning="Nothing is lost. This is a read that failed — the backend answered an error, which is different from the backend being out of date."
										onRetry={refreshAll}
										retrying={profiles.isFetching || teams.isFetching}
									/>
								) : selected && detailLoading ? (
									/* A skeleton shaped like the pane, never a blanket "Select a
						   definition" while something is on its way (D4). */
									<DetailSkeleton />
								) : selected && detailError ? (
									<PaneError
										title={
											teamMode
												? `“${selected}” could not be read`
												: `“${selected}” could not be read`
										}
										what={
											detailError instanceof Error
												? detailError.message
												: "The request did not complete."
										}
										meaning="The definition may have been removed, or the backend refused the read."
										onRetry={() => {
											void profileDetail.refetch();
											void teamDetail.refetch();
										}}
										retrying={profileDetail.isFetching || teamDetail.isFetching}
									/>
								) : creating && teamMode ? (
									/*
									 * KEYED BY WHAT IT IS, never by position in the branch ladder. These
									 * two panes share a component with the read/edit panes below, so React
									 * reconciled one INTO the other and a "New team" form opened holding
									 * the last team that was merely VIEWED — name, manager and members —
									 * while the same reuse let a dirty draft ride a roster click onto the
									 * next record (D2, and D1/U1/Q1 across all four streams). A key makes
									 * each record its own instance.
									 */
									<TeamDetail
										key="team:create"
										agents={profiles.data}
										teams={teams.data}
										askEnabled={run.enabled}
										onDirtyChange={reportDirty}
										onSaved={(savedName) => {
											void refreshAll();
											go({ name: savedName });
										}}
										onCancelCreate={() => go({ name: null })}
										onOpenAgent={(agentName) =>
											requestGo({ kind: "agent", name: agentName })
										}
										onAskAgent={(prompt) => {
											askForChange(
												run,
												{ kind: "team", name: name ?? "" },
												prompt,
											);
										}}
									/>
								) : creating && duplicateOf && duplicateDetail.isLoading ? (
									/*
									 * WAIT FOR THE RECORD BEFORE MOUNTING THE FORM. `AgentCreate` seeds its
									 * draft once, on mount, so a form mounted before the duplicate's own read
									 * landed would keep the empty instructions it was born with.
									 */
									<DetailSkeleton />
								) : creating ? (
									<AgentCreate
										key="agent:create"
										initial={duplicateDetail.data ?? null}
										takenNames={(profiles.data ?? []).map((row) => row.name)}
										effortTiers={effortTiers}
										onDirtyChange={reportDirty}
										onSaved={(savedName) => {
											void refreshAll();
											go({ name: savedName });
										}}
										onCancel={() => go({ name: null })}
									/>
								) : teamMode && teamDetail.data ? (
									<>
										{hubPane("team", teamDetail.data.name)}
										<TeamDetail
											key={`team:${teamDetail.data.name}:${contentKey(teamDetail.data)}`}
											team={teamDetail.data}
											agents={profiles.data}
											teams={teams.data}
											askEnabled={run.enabled}
											onDirtyChange={reportDirty}
											onSaved={(savedName) => {
												void refreshAll();
												go({ name: savedName });
											}}
											onOpenAgent={(agentName) =>
												requestGo({ kind: "agent", name: agentName })
											}
											onAskAgent={(prompt) => {
												askForChange(
													run,
													{ kind: "team", name: teamDetail.data?.name ?? "" },
													prompt,
												);
											}}
										/>
									</>
								) : !teamMode && profileDetail.data ? (
									<>
										{hubPane("agent", profileDetail.data.name)}
										<AgentDetail
											key={`agent:${profileDetail.data.name}:${profileDetail.data.source}:${contentKey(profileDetail.data)}`}
											profile={profileDetail.data}
											displayedName={printName(profileDetail.data.name)}
											classNotice={
												classNotice?.name === profileDetail.data.name
													? classNotice.copy
													: null
											}
											onClassNotice={(copy) =>
												setClassNotice(
													copy ? { name: profileDetail.data.name, copy } : null,
												)
											}
											teams={teams.data}
											effortTiers={effortTiers}
											askEnabled={run.enabled}
											onDirtyChange={reportDirty}
											onSaved={(savedName) => {
												void refreshAll();
												go({ name: savedName });
											}}
											onDuplicate={(profile) =>
												requestGo({ create: "agent", duplicate: profile.name })
											}
											onOpenTeam={(teamName) =>
												requestGo({ kind: "team", name: teamName })
											}
											onAskAgent={(prompt) => {
												askForChange(
													run,
													{
														kind: "agent",
														name: profileDetail.data?.name ?? "",
													},
													prompt,
												);
											}}
										/>
									</>
								) : selected ? (
									<Skeleton className="h-6 w-40" />
								) : null}
							</div>
						</div>
					)}
				</div>
				{/*
				 * THE QUESTION A DIRTY DRAFT EARNS, asked in the pane that owns it:
				 * every roster click, tab switch and "Add manually" lands here first when
				 * an edit is unsaved (D1/U1/Q1), with the same words the edit footer uses.
				 */}
				{pendingNav ? (
					<div
						className="flex flex-wrap items-center gap-2 border-hairline border-t bg-surface px-4 py-3"
						role="alertdialog"
						aria-label="Discard your unsaved changes?"
					>
						<span className="text-body-sm text-ink">
							{teamMode
								? "Discard your unsaved changes to this team?"
								: "Discard your unsaved changes to this agent?"}
						</span>
						<Button
							variant="danger"
							onClick={() => {
								// The pane unmounts on navigation, so its report goes with it;
								// clearing it here would be a second way to say the same thing.
								setDirtyIdentity(null);
								go(pendingNav);
							}}
						>
							Discard changes
						</Button>
						<Button variant="ghost" onClick={() => setPendingNav(null)}>
							Keep editing
						</Button>
					</div>
				) : null}
				{/*
				 * THE DOCKED COMPOSER, ONLY WHERE THE HERO IS NOT (D3/U2/Q8). The empty
				 * pane already leads with one, and rendering both put two textareas, two
				 * `aria-live` strips and two Stop buttons on screen with DUPLICATE ids —
				 * so `<label for>` bound to the first only and a screen reader read every
				 * state change twice. One composer, one placement.
				 */}
				{showsEmptyPane ? null : (
					/*
					 * THE DOCK ADDS NOTHING: no rule, no padding, no frame. The band inside
					 * `MessageInput` already carries the 24 px side inset and the 8 / 16 px
					 * vertical padding, and the box's step of lightness on `canvas` is the
					 * separation a `border-t` used to draw (design spec D1: this wrapper was
					 * the first of three nested frames). The status row sits in flow above
					 * the box at a fixed 28 px, so there is no overlay to reserve room for -
					 * which is what the old `stripHeight` padding on the scroller did.
					 */
					<div className="shrink-0 bg-canvas">
						<ConfigComposer
							run={run}
							about={run.about}
							onClearAbout={() => run.setAbout(null)}
							blockedReason={
								editDirty ? "Finish or cancel your edit first." : null
							}
						/>
					</div>
				)}
			</main>
		</div>
	);
}

/** Where the page can navigate to: one view of the same route. */
type NavIntent = {
	kind?: "agent" | "team";
	name?: string | null;
	create?: "agent" | "team" | null;
	/** The name a "Duplicate as new agent" form starts from. */
	duplicate?: string;
};

/**
 * The nothing-selected pane.
 *
 * IT LEADS WITH THE COMPOSER (design § 5), because saying what you want is the
 * recommended path and the half-empty pane "Select a definition to view or edit
 * it" was an invitation to nothing. `Add manually` is the second step down, and
 * the sentence says what an agent IS, which is the question a first-time reader
 * has and the page never answered.
 */
function EmptyPane({
	teamMode,
	run,
	onAddManually,
}: {
	teamMode: boolean;
	run: ReturnType<typeof useConfigRun>;
	onAddManually: () => void;
}) {
	/*
	 * THE ASK PANE IS THE CHAT COMPOSER'S COLUMN (operator report, 2026-10-05).
	 *
	 * IT WAS `max-w-xl space-y-4` - 576px, pinned to the pane's LEFT edge, with the
	 * composer inside a second bordered card - and beside a new chat (whose box is
	 * centred on the 810px measure, §"Why 810" in `chat-measure.ts`) it read as a
	 * different, unfinished composer. The numbers here are the chat column's own,
	 * taken from the chat mount rather than chosen.
	 *
	 * ONE INSET AND ONE MEASURE, THE BAND'S (design spec s4, D13). The composer's
	 * band is already `CHAT_COLUMN_CONTAINER` + `CHAT_COLUMN_INSET` + `CHAT_MEASURE`
	 * around its own box, so it must NOT be wrapped in a measure of its own: the first
	 * version of this pane did exactly that and the hero box came out 762 px at 1440
	 * against the dock's 810 (the band measured the already-measured column, losing
	 * its 24 px inset a second time on each side). So the box is a direct child of
	 * the pane, and the heading and the hand-add button get the SAME three-class chain
	 * the band has, as siblings of it. Heading, description, box, chip text and
	 * hand-add then start at one x at every width (L312 at 1024, L459 at 1440).
	 *
	 * VERTICALLY CENTRED, with `pb-12` of optical lift, so the block sits near the
	 * middle of the pane the way the new-chat splash does rather than hanging from
	 * the top with a void beneath it.
	 *
	 * NOT CENTRED TEXT: a new chat's splash centres a greeting over the box, but
	 * this pane's prose is a description of what an agent is, and centring a
	 * paragraph to match a one-line greeting would trade the chat's alignment for
	 * its mood. The column is centred; the prose keeps the column's left edge.
	 */
	const column = cn(CHAT_COLUMN_CONTAINER, CHAT_COLUMN_INSET);
	return (
		<div className="flex min-h-full flex-col justify-center space-y-4 pb-12">
			<div className={column}>
				<div className={cn(CHAT_MEASURE, "space-y-2")}>
					<h2 className="text-title">
						{teamMode ? "Ask for a team" : "Ask for an agent"}
					</h2>
					<p className="text-body text-ink-muted">
						{teamMode
							? "A team has one agent that leads the chat and members it can hand work to. Describe what you want and a configuration run sets it up."
							: "An agent is a reusable set of instructions you can start a chat with, or let other agents call on. Describe what you want and a configuration run sets it up."}
					</p>
				</div>
			</div>
			<ConfigComposer
				run={run}
				hero
				about={run.about}
				onClearAbout={() => run.setAbout(null)}
			/>
			<div className={column}>
				<div className={CHAT_MEASURE}>
					{/* `-ml-3` cancels this `md` button's own `px-3` (the chips are `sm`, `px-2`, hence their `-ml-2`), so its TEXT is at the box's edge. */}
					<Button variant="ghost" className="-ml-3" onClick={onAddManually}>
						{teamMode ? "Or add a team by hand" : "Or add an agent by hand"}
					</Button>
				</div>
			</div>
		</div>
	);
}

/**
 * The roster, as a list with roving focus.
 *
 * WHY NOT A TREE OF TABS (U12). Every row used to be its own Tab stop and arrow
 * keys did nothing, so reaching the ninth agent was nine presses and a keyboard
 * user could not tell which row was which without reading each name aloud. A
 * listbox with `aria-activedescendant`-style roving `tabIndex` is one Tab stop
 * for the whole list and arrow keys inside it, which is the standard the design
 * brief asks for.
 *
 * A ROW SAYS WHAT IT IS: name, description, source, and for teams the member
 * count. That is the answer to "what does this list list" (D3), where the old
 * row carried a name and nothing else.
 */
function Roster({
	rows,
	name,
	teamMode,
	marked,
	printName,
	onOpen,
}: {
	rows: readonly (ReusableProfile | ReusableTeam)[];
	/** The definition the page is showing, or null. */
	name: string | null;
	teamMode: boolean;
	marked: Map<string, boolean>;
	/** The name a row PRINTS; every id, route and mark still keys on `row.name`. */
	printName: (name: string) => string;
	onOpen: (name: string) => void;
}) {
	const refs = useRef(new Map<string, HTMLButtonElement>());
	const [focused, setFocused] = useState<string | null>(name);

	const move = (from: string, delta: number) => {
		const index = rows.findIndex((row) => row.name === from);
		if (index < 0) return;
		const next = rows[Math.min(rows.length - 1, Math.max(0, index + delta))];
		if (!next) return;
		setFocused(next.name);
		refs.current.get(next.name)?.focus();
	};

	/*
	 * A LIST OF BUTTONS, with arrow keys moving between them and ONE Tab stop for
	 * the whole roster.
	 *
	 * IT WAS A `role="listbox"` WITH `role="option"` ROWS and is not any more: the
	 * roles promised a composite widget this markup did not implement (the options
	 * held the focus, not the list), and the repo's a11y lint is right that a
	 * listbox must own its focus. What the operator actually needs is U12 — Tab
	 * once to the roster, then arrows, instead of one Tab stop per row — and a list
	 * of buttons with roving `tabIndex` is exactly that.
	 */
	return (
		<ul aria-label={teamMode ? "Teams" : "Agents"} className="space-y-0.5">
			{rows.map((row) => {
				const isProfile = "source" in row;
				const mark = marked.get(`${teamMode ? "team" : "agent"}:${row.name}`);
				return (
					<li key={row.name}>
						<button
							ref={(node) => {
								if (node) refs.current.set(row.name, node);
								else refs.current.delete(row.name);
							}}
							type="button"
							aria-current={row.name === name ? "true" : undefined}
							tabIndex={row.name === (focused ?? rows[0]?.name) ? 0 : -1}
							data-testid={`roster-row-${row.name}`}
							className={cn(
								"flex min-h-12 w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-row-hover",
								/*
								 * The selected row names the SHARED role rather than painting a
								 * state of its own: the roster is one of the app's row surfaces, and
								 * a second "which one is open" idiom here is how the sidebar and this
								 * list come to disagree. Hover and selection are colour steps; nothing
								 * lifts, scales or translates.
								 */
								row.name === name && rowCurrent,
							)}
							onFocus={() => setFocused(row.name)}
							onClick={() => onOpen(row.name)}
							onKeyDown={(event) => {
								if (event.key === "ArrowDown") {
									event.preventDefault();
									move(row.name, 1);
								} else if (event.key === "ArrowUp") {
									event.preventDefault();
									move(row.name, -1);
								} else if (event.key === "Home") {
									event.preventDefault();
									move(row.name, -rows.length);
								} else if (event.key === "End") {
									event.preventDefault();
									move(row.name, rows.length);
								}
							}}
						>
							{/*
							 * LINE 1: the name, the transient mark, and ONE quiet fact pinned to
							 * the right edge (design spec s3). Teams print their member count and
							 * agents their source word in the same slot, so the column has one
							 * right edge and no row carries a bordered chip - which is also what
							 * made row heights ragged (44 / 51 / 57 px) when a Badge wrapped.
							 */}
							<span className="flex w-full items-center gap-2">
								<span className="min-w-0 truncate text-body-sm text-ink">
									{/* The READABLE name for a row: a team's label, or her configured
									    name for the seat; every other agent row renders its own name
									    unchanged. Identity stays `row.name` - the testid, the
									    selection and the URL all read it. */}
									{"members" in row
										? teamDisplayName(row)
										: printName(row.name)}
								</span>
								{mark !== undefined ? (
									<Badge variant="attention" data-testid="roster-row-updated">
										{/*
										 * A CREATED ROW IS NEW, not Updated (design review round 1, D8):
										 * the badge followed "this row was marked", and the strip next to it
										 * said Created, so the two disagreed about the same fact.
										 */}
										{mark ? "New" : "Updated"}
									</Badge>
								) : null}
								{/*
								 * `ink-dim` is the palette's own floor for secondary text; it
								 * measures 5.05 (dark) / 5.04 (light) on the selected row, the
								 * lowest ground it meets here. The count is the SUMMED member count
								 * (`memberCountLabel`), the number the detail pane prints, so the
								 * two surfaces cannot disagree for a team with a member twice.
								 */}
								<span className="ml-auto shrink-0 text-meta text-ink-dim tabular-nums">
									{"members" in row ? (
										memberCountLabel(row.members)
									) : (
										<SourceChip source={row.source} appearance="text" />
									)}
								</span>
							</span>
							{/*
							 * LINE 2: always mounted and exactly one line tall (`min-h-lh`), so a
							 * row with no description is the same height as one with a long
							 * description. The CLASS leads the line for a proactive agent as a
							 * word, not a Badge: reactive is the absent value on the wire and the
							 * state an agent is in unless somebody chose otherwise, so only the
							 * exception is said, and in the backend's own word (`CLASS_LABEL`) so
							 * the list and the detail control cannot drift into two names.
							 */}
							<span className="flex min-h-lh w-full items-baseline text-meta text-ink-muted">
								{isProfile && classOf(row) === "proactive" ? (
									<span
										// `mr-1` and not a trailing space: a flex item's trailing
										// whitespace collapses, which glued the dot to the description.
										className="mr-1 shrink-0"
										data-testid="roster-row-proactive"
									>
										<span className="text-ink">{CLASS_LABEL.proactive}</span>
										{row.description ? (
											<span className="text-ink-dim"> ·</span>
										) : null}
									</span>
								) : null}
								{row.description ? (
									<span className="min-w-0 flex-1 truncate">
										{row.description}
									</span>
								) : null}
							</span>
						</button>
					</li>
				);
			})}
		</ul>
	);
}

/** Agents narrowed by the search box and the scope chips. */
function propsFilter(
	rows: readonly ReusableProfile[] | undefined,
	search: string,
	scope: Scope,
	printName: (name: string) => string,
): ReusableProfile[] {
	const needle = search.trim().toLowerCase();
	return (rows ?? []).filter((row) => {
		if (scope === "builtin" && row.source !== "builtin") return false;
		if (scope === "installed" && row.source !== "installed") return false;
		if (scope === "custom" && row.source !== "custom") return false;
		if (!needle) return true;
		/*
		 * BOTH NAMES MATCH, and that is not belt-and-braces: a reader who renamed
		 * her searches for the name they see, while a reader who knows the registry
		 * key (it is what the receipts and the terminal address her by) searches
		 * for that. Either way the row they mean is the row that survives the
		 * filter.
		 */
		return (
			printName(row.name).toLowerCase().includes(needle) ||
			row.name.toLowerCase().includes(needle) ||
			(row.description ?? "").toLowerCase().includes(needle)
		);
	});
}

function teamsFilter(
	rows: readonly ReusableTeam[] | undefined,
	search: string,
): ReusableTeam[] {
	const needle = search.trim().toLowerCase();
	return (rows ?? []).filter(
		(row) =>
			!needle ||
			row.name.toLowerCase().includes(needle) ||
			(row.label ?? "").toLowerCase().includes(needle) ||
			(row.description ?? "").toLowerCase().includes(needle),
	);
}
