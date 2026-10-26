/**
 * One team's detail pane — the manager and the members first, because they are
 * what a team IS (design consult § 5), then the briefs.
 *
 * The findings this answers, in order: names were free text so a typo'd member
 * saved silently and was shown as an ordinary row with no warning (U7, D2); the
 * member's "Nested team" option was the wire's `kind` leaking into the UI
 * (branding § 5); the count was a bare number input with no bounds offered; and
 * every action carried the same outline weight so nothing was primary (D5).
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not invent a `teams.*` delete: no
 * desktop op deletes a team (`desktop_profiles.py` registers get/list/create/
 * update and nothing else — design consult § 1), so there is no Delete control
 * at all rather than one that cannot work. It also does not rename an existing
 * team: chats and schedules address a team by name, and the wire's rename path
 * is unverified from this side, so the name is a read-only fact in edit mode and
 * only a create can choose one.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	type ReusableProfile,
	type ReusableTeam,
	type TeamEffectiveMember,
	type TeamMember,
	useTeamEffective,
} from "@shared/api/local-operator/profile-hooks";
import { teamDisplayName } from "@shared/api/local-operator/team-display";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@shared/components/ui/alert";
import { Badge } from "@shared/components/ui/badge";
import { Button } from "@shared/components/ui/button";
import { Disclosure } from "@shared/components/ui/disclosure";
import { Input } from "@shared/components/ui/input";
import { SearchableSelect } from "@shared/components/ui/searchable-select";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@shared/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@shared/components/ui/table";
import { Textarea } from "@shared/components/ui/textarea";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { showErrorToast, showSuccessToast } from "@shared/utils/toast-manager";
import { useQueryClient } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";
import {
	type FormEvent,
	Fragment,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { type FieldTarget, refusalCopy } from "../utils/backend-copy";
import {
	INHERIT,
	MEMBER_EFFORTS,
	MEMBER_TIERS,
	effectiveFor,
	effortSourceKey,
	memberSignature,
	overrideChoice,
	overrideEditorState,
	tierSourceKey,
	withOverride,
} from "../utils/member-overrides";
import {
	EditFooter,
	FieldLabel,
	LINK_HIT_AREA,
	ReadBlock,
	Section,
	TITLE_LINE_HEIGHT,
	consumeHeadingFocus,
	requestHeadingFocus,
	useEscapeToCancel,
} from "./detail-parts";

type MemberRow = TeamMember & { key: string };

type Draft = {
	description: string;
	manager: string;
	members: MemberRow[];
	instructions: string;
	project: string;
};

function draftOf(team?: ReusableTeam): Draft {
	return {
		description: team?.description ?? "",
		manager: team?.manager ?? "manager",
		/*
		 * THE COUNT IS NORMALISED HERE, once, for everything the edit form does with
		 * it (agent review round 2 #2): the stepper prints it, disables on it, and does
		 * +/-1 arithmetic on it, and a member the wire sent without a count rendered an
		 * empty number and NaN. `memberCountOf` is the one helper the table, the header
		 * and the roster already read, so the form takes the same view of the same row.
		 * Base and draft are both built here, so a count-less row is not "changed" by
		 * being normalised; a SAVE that touches members writes the normalised count.
		 */
		members: (team?.members ?? []).map((member) => ({
			...member,
			count: memberCountOf(member),
			key: crypto.randomUUID(),
		})),
		instructions: team?.instructions ?? "",
		project: team?.project ?? "",
	};
}

function changedFields(base: Draft, draft: Draft): Record<string, unknown> {
	const changed: Record<string, unknown> = {};
	if (draft.description !== base.description)
		changed.description = draft.description;
	if (draft.manager !== base.manager) changed.manager = draft.manager;
	if (
		JSON.stringify(draft.members.map(memberSignature)) !==
		JSON.stringify(base.members.map(memberSignature))
	) {
		changed.members = draft.members.map(({ key: _k, ...rest }) => rest);
	}
	if (draft.instructions !== base.instructions)
		changed.instructions = draft.instructions;
	if (draft.project !== base.project) changed.project = draft.project;
	return changed;
}

/**
 * Whether a member row's name resolves to something on this machine.
 *
 * THE CHECK IS THE POINT OF THE FEATURE, not decoration: `no-such-agent` used to
 * save and render as an ordinary row (U7), so the page could not tell the
 * operator about a member that will never start. The backend refuses unresolved
 * member names on WRITE (`validate_target`), which means this can only ever be
 * shown for a row that already exists on disk — a name someone else removed, or
 * one written by an older build — and that is exactly the case a warning chip is
 * for.
 */
function memberResolution(
	member: TeamMember,
	agents: readonly ReusableProfile[] | undefined,
	teams: readonly ReusableTeam[] | undefined,
): boolean {
	const pool =
		member.kind === "agent"
			? (agents ?? []).map((row) => row.name)
			: (teams ?? []).map((row) => row.name);
	return pool.includes(member.role);
}

/**
 * How many members a team has: the SUM of each row's `count`, in one place.
 *
 * The roster used to print `members.length` (rows) while the detail printed the
 * summed count under a different noun, so a team with the coder twice read "5
 * members" in one and "6 agents" in the other (design spec D9). One word and one
 * arithmetic, exported so the two surfaces cannot disagree again; `count || 1`
 * (`memberCountOf`) is the wire's own default for a row that omits it.
 */
export function memberCount(
	members: readonly TeamMember[] | undefined,
): number {
	return (members ?? []).reduce(
		(total, member) => total + memberCountOf(member),
		0,
	);
}

/**
 * ONE ROW'S COUNT, the single normalisation every surface reads (agent review
 * round 1 #4). The table printed `member.count` raw while the header summed
 * `member.count || 1`, so a row that omitted its count read "x undefined" under a
 * header that had counted it as one. Exported so the table cell and the sum
 * cannot take different views of the same row.
 */
export function memberCountOf(member: Pick<TeamMember, "count">): number {
	return member.count || 1;
}

/** "1 member" / "N members" - the phrase both surfaces print. */
export function memberCountLabel(
	members: readonly TeamMember[] | undefined,
): string {
	return t("ui.agents.teams.member_count", { count: memberCount(members) });
}

/**
 * One reading's MODEL cell: the model the slot resolves to, and - under it - the
 * tier in play with the layer that set it.
 *
 * WHY THE TIER RIDES IN THE MODEL CELL rather than a column of its own: the tier is
 * what CHOSE the model, so the two are one fact read as value-and-provenance, and a
 * fourth narrow column is what makes this table unreadable at the pane's narrowest
 * width. A null model is not a missing reading - the contract answers it for a slot
 * with no tier (the launching session's model) and for a tier that could not be
 * resolved - and each case has its own word here.
 */
function modelFacts(reading: TeamEffectiveMember): {
	value: string;
	layer: string | null;
} {
	const tier = reading.tier.value
		? t("ui.agents.models.reading.tier_layer", {
				tier: reading.tier.value,
				source: t(tierSourceKey(reading.tier.source)),
			})
		: null;
	if (reading.model.value) return { value: reading.model.value, layer: tier };
	if (!reading.available)
		return { value: t("ui.agents.models.reading.not_resolved"), layer: tier };
	return { value: t("ui.agents.models.reading.session_model"), layer: tier };
}

/**
 * One reading's EFFORT cell.
 *
 * `auto` IS NOT A LEVEL and is never printed as one (design round 1, D0): the
 * backend resolves it to the MODEL's own default, which for most models is a
 * different level from the tier map's, so printing the resolved level alone says
 * the operator chose that level by hand. The request is kept, with what it means,
 * beside the layer that asked for it. A request the model's ladder clamps is shown
 * as the pair, because the level a child runs at is not the level that was asked
 * for and both matter.
 */
function effortFacts(reading: TeamEffectiveMember): {
	value: string;
	layer: string | null;
} {
	const { requested, value, source } = reading.effort;
	const layer = t(effortSourceKey(source));
	if (requested === "auto") {
		/*
		 * THE REQUEST, AND WHERE THE LEVEL COMES FROM. `auto` is not a level, so the
		 * value keeps the operator's own word and the layer says the level is the
		 * model's own default - which is a different level from the tier map's for most
		 * models, and printing the resolved level alone is what made two members with
		 * different stored overrides read identically (design round 1, D0).
		 */
		return {
			value: t("ui.agents.models.reading.effort_auto"),
			layer: t("ui.agents.models.source.model_default"),
		};
	}
	if (value && requested && value !== requested) {
		return {
			value: t("ui.agents.models.reading.effort_clamped", {
				requested,
				value,
			}),
			layer,
		};
	}
	if (value) return { value, layer };
	/*
	 * No level at all: the model's own default IS the answer, so it stands as the
	 * value rather than as a second layer word under itself.
	 */
	return {
		value: t("ui.agents.models.reading.effort_default"),
		layer: source === "model_default" ? null : layer,
	};
}

/**
 * WHICH LAYER SET THIS MEMBER'S MODEL, as one word, for the form's caption.
 *
 * THE TIER'S LAYER IS THE ONE THAT ANSWERS THE FORM'S QUESTION (UX round 1, U3):
 * `from this team` is what tells the operator the value beside it is their own
 * override rather than the agent's pin, and clearing it is the act the caption sits
 * under. The read TABLE prints the whole tier clause instead (`tier hi (from this
 * team)`), which has a column to do it in. With no tier the value is already the
 * session phrase, so no word belongs beside it.
 */
function modelLayer(reading: TeamEffectiveMember): string | null {
	return reading.tier.value ? t(tierSourceKey(reading.tier.source)) : null;
}

/**
 * One member's saved cell in the edit form, with the layer when there is one.
 *
 * The form is where the operator decides whether to CLEAR an override, which is
 * exactly when the layer matters most: `Saved · Model: … (from this team)` says the
 * value is this team's own act, and the read view prints the same word (UX round 1,
 * U3). The value-only message is used when no layer word belongs beside the value -
 * a session model, or an effort nothing set.
 */
function captionCell(
	facts: { value: string; layer: string | null },
	valueKey:
		| "ui.agents.models.reading.model_cell"
		| "ui.agents.models.reading.effort_cell",
	layerKey:
		| "ui.agents.models.reading.model_cell_layer"
		| "ui.agents.models.reading.effort_cell_layer",
): string {
	return facts.layer
		? t(layerKey, { value: facts.value, layer: facts.layer })
		: t(valueKey, { value: facts.value });
}

/**
 * A reading's value over its layer - what both cells of the table print.
 *
 * BOTH LINES CARRY THEIR FULL TEXT AS A TOOLTIP (design round 2, D13): the columns
 * are fixed so the table holds at the pane's narrowest measure, which means a long
 * role (`content-designer`) and a long selector (`openrouter/anthropic/…`) truncate,
 * and a truncated fact with no way to read it is a fact the pane does not show.
 */
function readingCell(facts: { value: string; layer: string | null }) {
	return (
		<>
			<span
				className="block truncate text-body-sm text-ink"
				title={facts.value}
			>
				{facts.value}
			</span>
			{facts.layer ? (
				<span
					className="block truncate text-meta text-ink-dim"
					title={facts.layer}
				>
					{facts.layer}
				</span>
			) : null}
		</>
	);
}

/**
 * A whole draft's comparison signature: every roster row through
 * `memberSignature`, so an override cleared to null compares equal to one that was
 * never set - a slot set to `hi` and back to `Inherit` is not unsaved work (minor 2
 * of the code review). The PAYLOAD keeps the difference; only the comparison
 * normalises it.
 */
function draftSignature(draft: Draft): string {
	return JSON.stringify({
		...draft,
		members: draft.members.map(memberSignature),
	});
}

/**
 * The column widths the manager row and the members table SHARE (design spec s4).
 *
 * The two are separate tables in separate sections, and what makes the manager's
 * name sit at the members' name x is that both are `table-fixed` with these same
 * `<col>` widths inside the same measure - not a coincidence of content. The first
 * column takes what is left; "Agent"/"Team" and the count are fixed so every row
 * shares a type x and a count x whatever the names are (D7).
 */
function MemberCols() {
	return (
		<colgroup>
			<col />
			<col className="w-24" />
			<col className="w-16" />
		</colgroup>
	);
}

import { HubTeamPublication } from "./hub-team-publication";

export function TeamDetail({
	team,
	agents,
	teams,
	askEnabled,
	onSaved,
	onCancelCreate,
	onOpenAgent,
	onAskAgent,
	onDirtyChange,
	belowHeader,
}: {
	/** Absent = creating a new team. */
	team?: ReusableTeam;
	agents: readonly ReusableProfile[] | undefined;
	teams: readonly ReusableTeam[] | undefined;
	askEnabled: boolean;
	onSaved: (name: string) => void;
	onCancelCreate?: () => void;
	onOpenAgent: (name: string) => void;
	onAskAgent: (prompt: string) => void;
	/** Reports an open edit with unsaved typing, so the page can hold the composer. */
	onDirtyChange?: (dirty: boolean) => void;
	/**
	 * THE SLOT BELOW THE RECORD'S TITLE, for a notice that is ABOUT this record.
	 *
	 * It renders here, inside the pane, rather than in the page above it: a
	 * banner drawn before the title describes a record from outside it, and a
	 * second one would have had a measure of its own. The slot inherits the
	 * pane's measure and the pane's ground, so whatever the page passes keeps
	 * the record's left and right edges.
	 */
	belowHeader?: ReactNode;
}) {
	useI18nLocale();
	const creating = !team;
	const [editing, setEditing] = useState(creating);
	const [name, setName] = useState(team?.name ?? "");
	const [base, setBase] = useState<Draft>(() => draftOf(team));
	const [draft, setDraft] = useState<Draft>(() => draftOf(team));
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [errorField, setErrorField] = useState<FieldTarget>(null);
	const [confirmDiscard, setConfirmDiscard] = useState(false);
	/*
	 * WHETHER THE RECORD MOVED UNDER AN OPEN DRAFT (CAS conflict). The agent pane
	 * has carried a `conflict` banner for a while; the team pane had NO such state,
	 * so a background configuration run or another window that rewrote this team
	 * left the closed form showing the new values with no signal, and a save from
	 * stale text would silently revert the concurrent write. This is the minimal
	 * team half of the same contract (draft-safety finding), NOT a team
	 * revamp: the state drives one banner and the CAS echo below.
	 */
	const [conflict, setConflict] = useState(false);
	/* The edit-open base revision, held stable while dirty - see the agent pane's
	 * `baseRevisionRef` note for why a refetch must not rebase it. */
	const baseRevisionRef = useRef<string | undefined>(team?.definition_revision);
	const headingRef = useRef<HTMLHeadingElement>(null);
	/** The collaboration field, so a refused create puts the caret in it (D14). */
	const teamInstructionsRef = useRef<HTMLTextAreaElement>(null);
	/**
	 * The create form's name field, so a refusal can put the caret in it (U3).
	 *
	 * WHY A REF WHEN THE INPUT IS ALREADY `autoFocus`. `autoFocus` only fires
	 * when the form MOUNTS; every refusal below happens with focus already on the
	 * Create button, so the field the sentence is about was left behind the
	 * operator's eye and hand.
	 */
	const teamNameRef = useRef<HTMLInputElement>(null);
	/**
	 * "Add member" and the flag that a press just added a row, so the button is kept
	 * on screen afterwards (UX review round 2, U1b). Pressing it inserts a row ABOVE
	 * it, which moves the button down by a row's height; the browser scrolls a
	 * focused control into view when focus MOVES, not when the focused control is
	 * pushed, so the 4th press at 1024x725 left it wholly under the sticky footer with
	 * `scrollTop` unchanged - the operator kept adding rows they could not see, with
	 * the focus ring off screen.
	 */
	const addMemberRef = useRef<HTMLButtonElement>(null);
	const justAddedMember = useRef(false);

	/* A pane opened by a Create takes the caret itself (QA Q7) — see the note on
	 * the handoff in `detail-parts`.
	 */
	useEffect(() => {
		if (!consumeHeadingFocus()) return;
		requestAnimationFrame(() => headingRef.current?.focus());
	}, []);
	const navigate = useNavigate();
	// Subscribes this pane to locale; the conflict copy re-translates on switch.
	useI18nLocale();
	const queryClient = useQueryClient();
	/*
	 * THE PROBE, and the name it needs when there is no team yet.
	 *
	 * Everything about overrides is gated on this one read: what each slot resolves
	 * to, and whether the running backend has the route at all. Two consequences
	 * that are easy to get wrong, and the reason for a tri-state below rather than
	 * a boolean:
	 *
	 *  - "no error yet" is NOT "supported". A create form has no team to read, and
	 *    an in-flight request has no answer; both used to render the controls and
	 *    then take them back when the 404 landed (code review round 1, M1).
	 *  - a create form can still PROBE, with any team the catalogue has: the route
	 *    is what is in question, not this particular team. With no team in the
	 *    catalogue there is nothing to ask, and the controls wait for a save.
	 */
	const probeName = team?.name ?? teams?.[0]?.name ?? null;
	const effective = useTeamEffective(probeName, Boolean(probeName));
	const overrideState = overrideEditorState(effective);
	const overridesAvailable = overrideState === "available";
	/*
	 * ONLY THIS TEAM'S OWN READING IS RENDERED. In create mode the probe answered
	 * for another team, and printing that resolution on a new team's pane would be a
	 * claim about a roster that does not exist yet.
	 */
	const teamReading =
		effective.data && effective.data.team === team?.name
			? effective.data
			: null;

	const dirty = creating
		? Boolean(name.trim() || draft.description || draft.members.length)
		: draftSignature(draft) !== draftSignature(base);

	// The same upward report as the agent pane's: an open unsaved edit holds the
	// composer, so a configuration run cannot write over typing.
	useEffect(() => {
		onDirtyChange?.((creating || editing) && dirty);
		/*
		 * AND WITHDRAWN ON THE WAY OUT — see the agent pane's note (review round 1,
		 * M1): a stale `true` locks the composer with no editor open.
		 */
		return () => onDirtyChange?.(false);
	}, [onDirtyChange, creating, editing, dirty]);

	useEffect(() => {
		if (editing && dirty) return;
		const next = draftOf(team);
		setBase(next);
		setDraft(next);
	}, [team, editing, dirty]);

	useEffect(() => {
		if (!justAddedMember.current) return;
		justAddedMember.current = false;
		/*
		 * `nearest` moves the scroller only if the button is outside it, and the pane's
		 * `scroll-padding-bottom` (the footer's published height) counts the sticky
		 * footer as outside - which is the whole point: the button lands just above the
		 * bar, not under it. It does not need focus, so a pointer press is covered too.
		 *
		 * The pane's `scroll-padding-bottom` also counts the footer's 24 px cue band
		 * (`--lo-pane-footer-cue-h`), so `nearest` stops ABOVE the fade rather than
		 * flush on the bar, where the fade took the focus ring to 1.2:1 (QA round 3 Q2).
		 *
		 * `typeof` because jsdom has no layout and no `scrollIntoView`: a test that
		 * presses Add member must not throw inside this effect (agent review round 3, N5).
		 */
		const button = addMemberRef.current;
		if (typeof button?.scrollIntoView === "function")
			button.scrollIntoView({ block: "nearest" });
		// No dependency array: the flag, not a value, says a row was just added, and the
		// effect runs after the commit that made the button move.
	});

	const cancel = () => {
		if (creating) {
			onCancelCreate?.();
			return;
		}
		setEditing(false);
		setError(null);
		setErrorField(null);
		setConfirmDiscard(false);
		// A reopen/reload establishes a NEW base revision from the fetched team.
		baseRevisionRef.current = team?.definition_revision;
		const next = draftOf(team);
		setBase(next);
		setDraft(next);
	};

	// Escape asks what Cancel asks - see the agent pane's note (UX U3).
	const requestCancel = () => {
		if (confirmDiscard) {
			setConfirmDiscard(false);
			return;
		}
		if (dirty) setConfirmDiscard(true);
		else cancel();
	};
	useEscapeToCancel(requestCancel, editing);

	const save = async (event?: FormEvent) => {
		event?.preventDefault();
		if (pending) return;
		/*
		 * THE REFUSALS THE FORM CAN ANSWER ITSELF (QA round 1, Q3; design D5).
		 * A bare "New team" with nothing filled reached the wire and came back as
		 * the contract's own "Invalid desktop operation." — the same class of
		 * developer-voiced refusal the agent form used to answer, and the most
		 * likely first failure here.
		 */
		if (creating && !name.trim()) {
			setError("Give the team a name.");
			setErrorField("name");
			teamNameRef.current?.focus();
			return;
		}
		if (creating && /[\\/\s]/.test(name.trim())) {
			setError("Names cannot contain spaces or slashes.");
			setErrorField("name");
			teamNameRef.current?.focus();
			return;
		}
		if (creating && (teams ?? []).some((row) => row.name === name.trim())) {
			setError(
				`A team called “${name.trim()}” already exists. Open it to change it, or choose another name.`,
			);
			setErrorField("name");
			teamNameRef.current?.focus();
			return;
		}
		if (creating && !draft.instructions.trim()) {
			setError("Give the team instructions.");
			setErrorField("instructions");
			teamInstructionsRef.current?.focus();
			return;
		}
		setPending(true);
		setError(null);
		setErrorField(null);
		try {
			const result = team
				? await desktopResult<ReusableTeam>({
						op: "teams.update",
						name: team.name,
						requestId: crypto.randomUUID(),
						fields: changedFields(base, draft),
						expectedDefinitionRevision: baseRevisionRef.current,
					})
				: await desktopResult<ReusableTeam>({
						op: "teams.create",
						requestId: crypto.randomUUID(),
						fields: {
							name,
							description: draft.description,
							manager: draft.manager,
							members: draft.members.map(({ key: _k, ...rest }) => rest),
							instructions: draft.instructions,
							project: draft.project,
						},
					});
			const next = draftOf(result);
			setBase(next);
			setDraft(next);
			setConflict(false);
			// Adopt the write's own new revision as the base for a later save.
			baseRevisionRef.current = result.definition_revision;
			setEditing(false);
			onSaved(result.name);
			/*
			 * THE READING IS RE-DERIVED FROM THE BACKEND, never patched locally.
			 *
			 * A saved override changes what the next launch resolves, and only the
			 * backend knows the answer: the tier map may still have no entry for the
			 * tier just named, and `available`/`reason` are the two fields that say so.
			 * Keeping the pre-save reading on screen would show the operator the model
			 * they were on before the change they just made - the "didn't save"
			 * confusion this section exists to end.
			 */
			void effective.refetch();
			/*
			 * AND THE AUTHORING CACHE, one layer out: the roster this pane is drawn
			 * from has just changed on disk, and every other surface reading it (the
			 * teams list, a second window) is keyed by prefix on this one.
			 */
			void queryClient.invalidateQueries({ queryKey: ["desktop", "team"] });
			/*
			 * "CREATED" FOR A CREATE, "SAVED" FOR AN EDIT (review round 1, UX nit):
			 * the agent form already said Created, so the same act had two names.
			 */
			showSuccessToast(
				creating
					? t("ui.notices.agents.created_named", { name: result.name })
					: t("ui.notices.agents.saved", { name: result.name }),
			);
			if (creating) requestHeadingFocus();
			requestAnimationFrame(() => headingRef.current?.focus());
		} catch (caught) {
			/*
			 * A CONCURRENT-EDIT REFUSAL: the record moved since this edit opened, so the
			 * write was rejected before touching anything. Show the conflict banner and
			 * KEEP the draft; do not re-read the base token here (a deliberate reload
			 * reconciles). Keyed on the backend's machine code, not status alone.
			 */
			const code = (caught as { code?: unknown })?.code;
			if (code === "local-concurrent-edit") {
				setConflict(true);
				setError(null);
				setErrorField(null);
				return;
			}
			const copy = refusalCopy(
				caught instanceof Error
					? caught.message
					: "The team could not be saved.",
			);
			setError(copy.message);
			setErrorField(copy.field);
			showErrorToast(copy.message);
		} finally {
			setPending(false);
		}
	};

	const updateMember = (index: number, patch: Partial<TeamMember>) =>
		setDraft((current) => ({
			...current,
			members: current.members.map((row, position) =>
				position === index ? { ...row, ...patch } : row,
			),
		}));

	/**
	 * One slot's model override, from a select's own choice.
	 *
	 * THROUGH `withOverride` RATHER THAN A SPREAD, because "inherit" is not a
	 * value the wire has: it writes `null`, which the backend accepts as the same
	 * thing an omitted key means. A spread of the raw choice would send the word
	 * `inherit` and be refused, and dropping the key instead would leave a cleared
	 * override indistinguishable from one never mentioned - on a roster that
	 * `members` replaces wholesale.
	 */
	const updateMemberOverride = (
		index: number,
		patch: { tier?: string; effort?: string },
	) =>
		setDraft((current) => ({
			...current,
			members: current.members.map((row, position) =>
				position === index ? withOverride(row, patch) : row,
			),
		}));

	// The edit form's draft is what the operator is looking at while editing, so
	// the count follows it; otherwise it is the saved team's.
	const shownMembers = draft.members.length ? draft.members : team?.members;

	const displayName = team ? teamDisplayName(team) : "New team";
	const includesTeam = draft.members.some((member) => member.kind === "team");

	return (
		/*
		 * NO WIDTH OR PADDING HERE: the page wraps every pane in the chat column's
		 * container and measure, so this pane's edges ARE the docked box's. `space-y-8`
		 * is the section tier (32 px) between the header, the form and its blocks.
		 */
		<div className="space-y-8">
			<header className="space-y-3">
				<div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
					<div className="min-w-0 flex-[1_1_16rem] space-y-1">
						<h2
							ref={headingRef}
							tabIndex={-1}
							// A long name truncates rather than wrapping under the actions; the
							// full name stays reachable as the tooltip.
							title={displayName}
							className="truncate text-title focus:outline-none"
						>
							{/*
							 * The heading reads the team the way every other human-read
							 * surface does (round 1, R1-3a): the roster row that opens this
							 * pane shows the label, so the pane it opens must not rename the
							 * team back to its slug. The `name` field below stays the slug -
							 * it is the key a rename edits, not prose.
							 */}
							{displayName}
						</h2>
						{/*
						 * ONE META LINE, NOT CHIPS (design spec s4, D8/D14). A bordered badge
						 * for a plain count made the header read as three controls, and
						 * "0 agents" under "New team" said nothing, so a create has no count
						 * line at all. Badges survive for states that need attention.
						 */}
						{team ? (
							<p className="text-body-sm text-ink-muted">
								{memberCountLabel(shownMembers)}
								{includesTeam ? " · Includes a team" : ""}
							</p>
						) : null}
					</div>
					{/*
					 * ACTIONS: one primary, one secondary, one quiet - and NONE while the
					 * form is open. In edit mode the primary is Save changes in the footer,
					 * and a second accent fill in the same frame (New team chat) split the
					 * decision (design spec D8). `TITLE_LINE_HEIGHT` is the title's own line box,
					 * derived from the type token, so the 32 px buttons centre on the TITLE
					 * line and not on the title-plus-meta block.
					 *
					 * THE TRAILING GHOST BUTTON IS PULLED OUT BY ITS OWN PADDING (design
					 * review round 1 D1). A ghost button has no edge, so its box was flush
					 * with the column but its LABEL ended 12 px inside it; `-mr-3` (the
					 * `md` button's `px-3`) puts the label's last glyph on the column edge
					 * that the box and the count are on. It moves into the 24 px scroller
					 * gutter, where nothing is clipped (the hover ground is the only thing
					 * there). Without "Ask for a change" the last button is the bordered
					 * Edit, whose edge IS its box, so nothing is pulled.
					 */}
					{team && !editing ? (
						<div
							className={cn(
								"flex shrink-0 items-center gap-2",
								TITLE_LINE_HEIGHT,
								askEnabled && "-mr-3",
							)}
						>
							<Button
								variant="primary"
								onClick={() => {
									useCanonicalSessionsStore
										.getState()
										.stageDraft({ kind: "team", name: team.name });
									navigate("/chat");
								}}
							>
								{t("ui.agents.teams.action.new_chat")}
							</Button>
							<HubTeamPublication team={team} />
							<Button
								variant="secondary"
								onClick={() => {
									// Capture the edit-open base revision (held stable while dirty).
									baseRevisionRef.current = team.definition_revision;
									setEditing(true);
								}}
							>
								{t("ui.agents.detail.action.edit")}
							</Button>
							{askEnabled ? (
								<Button
									variant="ghost"
									onClick={() => onAskAgent(`Change the team ${team.name}: `)}
								>
									{t("ui.agents.detail.action.ask_change")}
								</Button>
							) : null}
						</div>
					) : null}
				</div>
				{/*
				 * THE BANNER IS FOR ERRORS THAT HAVE NO FIELD (design review round 3,
				 * D16; UX U3). A missing required field is answered beside that field,
				 * where the operator is already looking — and the banner made one
				 * mistake read twice, titled "That did not save", which is a
				 * save/transport framing for what was a blank box. The agent form in
				 * this same delta already splits it this way; this is that shape.
				 */}
				{error && !errorField ? (
					<Alert variant="danger" role="alert" data-testid="team-save-error">
						<AlertTitle>
							{t("ui.agents.detail.alert.save_failed_title")}
						</AlertTitle>
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				) : null}
			</header>

			{/*
			 * THE RECORD'S OWN NOTICE, directly under its title and above the
			 * form. It is a child of the pane, so it is measured exactly like the
			 * form is: one column, one pair of edges, no second measure of its
			 * own.
			 */}
			{belowHeader}

			{/*
			 * THE CONFLICT BANNER, the team half of the agent pane's.
			 *
			 * It says the RECORD moved under a draft that is still being typed - a
			 * configuration run or another window wrote to this team after the edit
			 * opened, so this edit's base is no longer what the backend holds. Saving
			 * from it would either revert somebody else's write (silently, once, before
			 * the CAS field existed) or, now, be refused on a stale revision. Shown only
			 * while editing AND only after a real refusal, never for a harmless refetch
			 * that returned identical values. Wording mirrors the agent pane's banner so
			 * the two editors describe the same event the same way.
			 */}
			{editing && conflict ? (
				<Alert variant="warning" data-testid="team-conflict">
					<AlertTitle>{t("ui.hub.conflict.title")}</AlertTitle>
					<AlertDescription>
						<span className="block">{t("ui.hub.conflict.body")}</span>
						<Button
							variant="secondary"
							size="sm"
							className="mt-2"
							onClick={cancel}
						>
							{t("ui.hub.conflict.reload")}
						</Button>
					</AlertDescription>
				</Alert>
			) : null}

			{/* noValidate — the team form validates in `save()` (D14). */}
			<form
				noValidate
				onSubmit={(event) => {
					event.preventDefault();
					void save(event);
				}}
				className="space-y-8"
			>
				{creating || editing ? (
					<>
						{creating ? (
							<Section
								title={t("ui.agents.detail.field.name")}
								description="How you and your chats will refer to this team."
							>
								<FieldLabel
									label="Team name"
									htmlFor="team-name"
									error={errorField === "name" ? error : null}
								/>
								<Input
									ref={teamNameRef}
									id="team-name"
									data-testid="team-name-input"
									value={name}
									required
									maxLength={64}
									autoFocus
									aria-invalid={errorField === "name"}
									onChange={(event) => setName(event.target.value)}
								/>
							</Section>
						) : null}
						<Section
							title={t("ui.agents.teams.section.manager")}
							description="The agent that leads the chat and decides who works on what."
						>
							<div className="space-y-2">
								<FieldLabel
									label="Manager agent"
									htmlFor="team-manager"
									error={errorField === "manager" ? error : null}
								/>
								<SearchableSelect
									ariaLabel="Manager agent"
									showLabel={false}
									placeholder={t("ui.agents.teams.field.manager_placeholder")}
									busyLabel="Loading agents"
									options={managerOptions(agents, teams)}
									selected={
										managerOptions(agents, teams).find(
											(option) => option.id === draft.manager,
										) ?? null
									}
									onSelect={(option) =>
										setDraft((current) => ({ ...current, manager: option.id }))
									}
									onCustomSubmit={(text) =>
										setDraft((current) => ({ ...current, manager: text }))
									}
									listNotice="Agents and teams on this machine"
								/>
								{!managerOptions(agents, teams).some(
									(option) => option.id === draft.manager,
								) ? (
									<Badge variant="warning" data-testid="team-manager-missing">
										{t("ui.agents.teams.empty.not_found_name", {
											name: draft.manager,
										})}
									</Badge>
								) : null}
							</div>
						</Section>
						<Section
							title={t("ui.agents.teams.section.members")}
							description="Who the manager can delegate to, how many of each, and the model each runs on."
						>
							{/*
							 * THE SCOPE AND THE PRECEDENCE, at the point of choice (UX round 1,
							 * U1). The operator's own question was whether an override here reaches
							 * the agent or another team; nothing on this form said it did not, and
							 * the only clue was the parenthetical on a SAVED reading. The same
							 * sentence is under the reading heading, so the two panes cannot drift.
							 */}
							<p
								data-testid="team-override-scope"
								className="text-meta text-ink-muted"
							>
								{t("ui.agents.models.override.scope_hint")}
							</p>
							{/*
							 * AND WHY THERE ARE NO CONTROLS YET WHEN THERE IS NOTHING TO PROBE
							 * WITH (QA round 1, Q3): a machine with no teams cannot say whether
							 * this backend has the route, so the create form offers nothing - which
							 * is correct and otherwise looks like a missing feature.
							 */}
							{creating && !probeName ? (
								<p
									data-testid="team-override-no-probe"
									className="text-meta text-ink-muted"
								>
									{t("ui.agents.models.reading.no_probe_hint")}
								</p>
							) : null}
							{/*
							 * THE FAILED PROBE, SAID IN THE FORM AS WELL AS THE READ VIEW, WITH A
							 * WAY OUT (UX round 1, U5; QA round 1, Q2): the operator who pressed
							 * Edit to set an override found no controls and no word about why.
							 * `refetch` re-runs the same probe the controls are gated on.
							 */}
							{overrideState === "unavailable" ? (
								<div className="flex flex-wrap items-baseline gap-2">
									<p className="text-meta text-danger">
										{t("ui.agents.models.reading.read_failed")}
									</p>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => void effective.refetch()}
									>
										{t("ui.agents.models.reading.try_again")}
									</Button>
								</div>
							) : null}
							{/*
							 * 16 PX BETWEEN MEMBERS, 4 PX INSIDE ONE (design round 1, D2). The
							 * override pair used to sit 8 px under its member row and 8 px above the
							 * next member, so the pair belonged to neither and the first label the eye
							 * landed on read as the NEXT group's head. The gap between members is now
							 * four times the gap inside one.
							 */}
							<div className="space-y-4">
								{draft.members.map((member, index) => {
									const missing = !memberResolution(member, agents, teams);
									/*
									 * THE SAVED READING FOR THIS SLOT, never the draft's. It is what the next
									 * launch resolves right now and it moves only by a save, so a select
									 * beside it may legitimately disagree with it - which is exactly what an
									 * unsaved change is. `null` means the route did not name this slot, and
									 * that renders as no reading rather than as an error.
									 */
									const savedReading = effectiveFor(
										teamReading ?? undefined,
										member,
									);
									return (
										<div
											key={member.key}
											/*
											 * A GRID, NOT A WRAP (design spec D12). The name flexes,
											 * the kind is 128 px, the stepper and Remove take their own
											 * width, so the last column ends on the column's right edge
											 * in every row instead of wherever the previous control
											 * stopped. Below the measure the grid keeps its tracks and
											 * the name column is what gives.
											 */
											className="grid grid-cols-[minmax(0,1fr)_8rem_auto_auto] items-center gap-x-2 gap-y-1"
										>
											<div className="min-w-0">
												<SearchableSelect
													ariaLabel={`Member ${index + 1}`}
													showLabel={false}
													placeholder={t(
														"ui.agents.teams.field.member_placeholder",
													)}
													busyLabel="Loading agents"
													options={[
														...managerOptions(agents, teams).filter((option) =>
															member.kind === "team"
																? option.group === "Teams"
																: option.group === "Agents",
														),
													]}
													selected={
														managerOptions(agents, teams).find(
															(option) => option.id === member.role,
														) ?? null
													}
													onSelect={(option) =>
														updateMember(index, {
															role: option.id,
															kind: option.group === "Teams" ? "team" : "agent",
														})
													}
													onCustomSubmit={(text) =>
														updateMember(index, { role: text })
													}
												/>
											</div>
											<Select
												value={member.kind}
												onValueChange={(value) =>
													updateMember(index, {
														kind: value as "agent" | "team",
													})
												}
											>
												<SelectTrigger
													aria-label={`Member ${index + 1} kind`}
													className="w-full"
												>
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="agent">
														{t("ui.agents.teams.kind.agent")}
													</SelectItem>
													<SelectItem value="team">
														{t("ui.agents.teams.kind.team")}
													</SelectItem>
												</SelectContent>
											</Select>
											{/*
											 * A stepper rather than a bare number input: the wire bounds
											 * the count at 1..16 and the old control offered no bound at
											 * all, so the only way to learn one was to be refused.
											 */}
											<div className="flex items-center gap-1">
												<Button
													variant="secondary"
													size="icon-sm"
													aria-label={`One fewer ${member.role}`}
													disabled={member.count <= 1}
													onClick={() =>
														updateMember(index, { count: member.count - 1 })
													}
												>
													<Minus aria-hidden="true" />
												</Button>
												<span
													className="min-w-6 text-center text-body-sm tabular-nums"
													aria-label={`${member.count} of ${member.role}`}
												>
													{member.count}
												</span>
												<Button
													variant="secondary"
													size="icon-sm"
													aria-label={`One more ${member.role}`}
													disabled={member.count >= 16}
													onClick={() =>
														updateMember(index, { count: member.count + 1 })
													}
												>
													<Plus aria-hidden="true" />
												</Button>
											</div>
											<Button
												variant="ghost"
												onClick={() =>
													setDraft((current) => ({
														...current,
														members: current.members.filter(
															(_, position) => position !== index,
														),
													}))
												}
											>
												{t("ui.agents.teams.action.remove")}
											</Button>
											{missing ? (
												// Own grid row, so the warning never pushes a column.
												<Badge
													variant="warning"
													className="col-span-full w-fit"
												>
													{t("ui.agents.teams.empty.not_found_name", {
														name: member.role,
													})}
												</Badge>
											) : null}
											{/*
											 * THE OVERRIDE CONTROLS, as a row INSIDE this member's grid
											 * (`col-span-full`) rather than as more tracks in it: the name flexes and
											 * the last column ends on the pane's right edge (D12 above), and two
											 * selects beside a stepper and a Remove would leave the name column
											 * unusably narrow at the pane's own measure.
											 *
											 * RENDERED ONLY WHEN THE BACKEND HAS THE ROUTE. An older server ignores
											 * these keys on a write (`TeamMember` keeps pydantic's default
											 * `extra="ignore"`), so an editor there would be a control whose value is
											 * discarded in silence.
											 */}
											{overridesAvailable ? (
												/*
												 * TWO LABELLED FIELDS, not two bare selects: a tier word and an effort word
												 * sit side by side here and neither says which is which, so the field is named
												 * on screen and the accessible name names the member as well.
												 */
												<div className="col-span-full grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-end gap-2">
													<div className="flex min-w-0 flex-col gap-1">
														<span className="text-meta text-ink-dim">
															{t("ui.agents.models.override.tier_field")}
														</span>
														<Select
															value={overrideChoice(member.tier)}
															onValueChange={(value) =>
																updateMemberOverride(index, { tier: value })
															}
														>
															<SelectTrigger
																aria-label={t(
																	"ui.agents.models.override.tier_label",
																	{
																		member:
																			member.role || `Member ${index + 1}`,
																	},
																)}
																className="w-full"
															>
																<SelectValue />
															</SelectTrigger>
															<SelectContent>
																<SelectItem value={INHERIT}>
																	{t("ui.agents.models.override.inherit_tier")}
																</SelectItem>
																{MEMBER_TIERS.map((value) => (
																	<SelectItem key={value} value={value}>
																		{value}
																	</SelectItem>
																))}
															</SelectContent>
														</Select>
													</div>
													<div className="flex min-w-0 flex-col gap-1">
														<span className="text-meta text-ink-dim">
															{t("ui.agents.models.override.effort_field")}
														</span>
														<Select
															value={overrideChoice(member.effort)}
															onValueChange={(value) =>
																updateMemberOverride(index, { effort: value })
															}
														>
															<SelectTrigger
																aria-label={t(
																	"ui.agents.models.override.effort_label",
																	{
																		member:
																			member.role || `Member ${index + 1}`,
																	},
																)}
																className="w-full"
															>
																<SelectValue />
															</SelectTrigger>
															<SelectContent>
																<SelectItem value={INHERIT}>
																	{t(
																		"ui.agents.models.override.inherit_effort",
																	)}
																</SelectItem>
																{MEMBER_EFFORTS.map((value) => (
																	/*
																	 * `auto` CARRIES ITS MEANING (design round 1, D4):
																	 * it sits beside `Inherit` in this list, and the two
																	 * are different acts - auto overrides to the model's
																	 * own default, inherit asks the layer below. A bare
																	 * `auto` beside a capitalised `Inherit` reads as two
																	 * spellings of one option.
																	 */
																	<SelectItem key={value} value={value}>
																		{value === "auto"
																			? t("ui.agents.models.override.auto")
																			: value}
																	</SelectItem>
																))}
															</SelectContent>
														</Select>
													</div>
												</div>
											) : null}
											{/*
											 * WHAT `Inherit` MEANS RIGHT NOW (design round 1, D3). The read
											 * view is one Cancel away, so the form says the saved resolution
											 * where the choice is made - and says SAVED, because that is what
											 * it is: it moves by a save, and a select may legitimately disagree
											 * with it until then.
											 */}
											{savedReading ? (
												<div className="col-span-full flex flex-wrap items-baseline gap-x-3 gap-y-1 text-meta">
													<span className="text-ink-dim">
														{t("ui.agents.models.reading.saved_label")}
													</span>
													<span className="text-ink-muted">
														{captionCell(
															{
																value: modelFacts(savedReading).value,
																layer: modelLayer(savedReading),
															},
															"ui.agents.models.reading.model_cell",
															"ui.agents.models.reading.model_cell_layer",
														)}
													</span>
													<span className="text-ink-muted">
														{captionCell(
															effortFacts(savedReading),
															"ui.agents.models.reading.effort_cell",
															"ui.agents.models.reading.effort_cell_layer",
														)}
													</span>
												</div>
											) : null}
											{savedReading && !savedReading.available ? (
												/*
												 * THE WRITE-TIME WARNING the design note asks for: the operator
												 * sees a tier that is not configured BEFORE a launch fails on it,
												 * rather than as a `SubagentModelUnavailable` at the launch. The
												 * reason is the backend's own sentence, and the sentence says
												 * SAVED because that is what it describes - changing the select
												 * does not change it, and without the word it read as though it
												 * were about the choice in hand.
												 */
												<div className="col-span-full">
													<p
														data-testid="team-member-unavailable"
														className="text-meta text-danger"
													>
														{t("ui.agents.models.reading.unavailable_editor", {
															member:
																savedReading.role || `Member ${index + 1}`,
															reason: savedReading.reason,
														})}
													</p>
													{/*
													 * AND WHERE TO FIX IT, the same line the read view prints
													 * (UX round 1, U4): the backend's sentence names a config
													 * path, and the form is where the operator came to act.
													 */}
													<p className="text-meta text-ink-muted">
														{t("ui.agents.models.reading.unavailable_hint")}
													</p>
												</div>
											) : null}
										</div>
									);
								})}
								<Button
									ref={addMemberRef}
									variant="secondary"
									onClick={() => {
										justAddedMember.current = true;
										setDraft((current) => ({
											...current,
											members: [
												...current.members,
												{
													role: "",
													count: 1,
													kind: "agent",
													key: crypto.randomUUID(),
												},
											],
										}));
									}}
								>
									{t("ui.agents.teams.action.add_member")}
								</Button>
							</div>
						</Section>
						<Section title={t("ui.agents.teams.section.description")}>
							<FieldLabel
								label="What this team is for"
								htmlFor="team-description"
								error={errorField === "description" ? error : null}
							/>
							<Input
								id="team-description"
								value={draft.description}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										description: event.target.value,
									}))
								}
							/>
						</Section>
						<Section title={t("ui.agents.teams.section.collaboration")}>
							{/*
							 * THE REFUSAL LANDS ON THE FIELD (design review round 3, D16).
							 * The sentence used to live only in the top banner, 300-plus px
							 * ABOVE this textarea, measured off-screen at the moment of the
							 * refusal — so the operator saw a focused empty box and no
							 * explanation. Same register as `FieldLabel`'s own error line.
							 */}
							{errorField === "instructions" ? (
								<p
									className="text-meta text-danger"
									role="alert"
									data-testid="team-instructions-error"
								>
									{error}
								</p>
							) : null}
							<Textarea
								ref={teamInstructionsRef}
								aria-label={t("ui.agents.teams.action.collaboration_aria")}
								aria-invalid={errorField === "instructions"}
								className="min-h-36"
								maxLength={8000}
								value={draft.instructions}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										instructions: event.target.value,
									}))
								}
							/>
						</Section>
						<Section title={t("ui.agents.teams.section.project_brief")}>
							<Textarea
								aria-label={t("ui.agents.teams.action.project_brief_aria")}
								className="min-h-36"
								maxLength={8000}
								value={draft.project}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										project: event.target.value,
									}))
								}
							/>
						</Section>
						<EditFooter
							submit
							confirming={confirmDiscard}
							onConfirmingChange={setConfirmDiscard}
							dirty={dirty}
							pending={pending}
							saveLabel={creating ? "Create team" : "Save changes"}
							pendingLabel={creating ? "Creating…" : "Saving…"}
							dirtyHint="Discard this team?"
							onSave={() => void save()}
							onCancel={cancel}
						/>
					</>
				) : (
					<>
						<Section title={t("ui.agents.teams.section.manager")}>
							{/*
							 * THE MANAGER ROW IS THE MEMBERS' ROW (design spec s4; design review
							 * round 1 D5). Same `<colgroup>`, same `py-2` cells, same sr-only head:
							 * the manager's name sits at the members' name x, the row is the same
							 * 36 px, and the heading-to-row distance is the Members section's.
							 *
							 * THE SECTION'S SENTENCE WENT INTO THE TABLE'S NAME. "The agent that
							 * leads the chat." was a visible line that made this section 21 px
							 * taller than Members for the one fact a reader of a one-row table
							 * already has; the table's accessible name keeps it for assistive tech
							 * (agent review round 1 #3 asked for a name anyway) and the edit form,
							 * where the field needs explaining, still prints it.
							 */}
							<Table
								className="table-fixed"
								aria-label={t("ui.agents.teams.field.manager_aria")}
							>
								<MemberCols />
								<TableHeader className="sr-only">
									<TableRow>
										<TableHead>{t("ui.agents.teams.col.member")}</TableHead>
										<TableHead>{t("ui.agents.teams.col.type")}</TableHead>
										<TableHead>{t("ui.agents.teams.col.count")}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									<TableRow className="border-0">
										<TableCell className="px-0 py-2">
											<div className="flex min-w-0 items-center gap-2">
												<Button
													variant="link"
													// 24 px target inside the 20 px line: the surplus 2 px each side
													// is handed back so the row stays the Members' 36 px.
													className={cn(
														"-my-0.5 min-w-0 justify-start truncate",
														LINK_HIT_AREA,
													)}
													onClick={() => onOpenAgent(draft.manager)}
												>
													{draft.manager}
												</Button>
												{/*
												 * THE MANAGER GETS THE SAME "Not found" CHIP THE MEMBERS DO
												 * (QA round 1, Q6). The edit view already marked a dangling
												 * manager, so the read view was the one place a missing
												 * manager still read as a working link that navigates
												 * nowhere.
												 */}
												{!managerOptions(agents, teams).some(
													(option) => option.id === draft.manager,
												) ? (
													<Badge
														variant="warning"
														data-testid="team-manager-missing"
													>
														{t("ui.agents.teams.empty.not_found")}
													</Badge>
												) : null}
											</div>
										</TableCell>
										<TableCell className="px-2 py-2 text-ink-dim text-meta">
											{/* The type is a fact about the row; the manager is an agent. */}
											{t("ui.agents.teams.kind.agent")}
										</TableCell>
										<TableCell />
									</TableRow>
								</TableBody>
							</Table>
						</Section>
						<Section title={t("ui.agents.teams.section.members")}>
							{/*
							 * A REAL TABLE (design spec D7): the three columns are the same on
							 * every row, so the type word and the count share an x whatever the
							 * name's length is, where the old flex-wrap line put each wherever the
							 * name before it ended. The head is announced and not painted - the
							 * columns are self-evident and a visible head would be chrome on a
							 * five-row list. Rows are separated by the hairline, which is the
							 * token's stated job; the last row drops it.
							 */}
							<Table
								className="table-fixed"
								aria-label={t("ui.agents.teams.section.members_aria")}
							>
								<MemberCols />
								<TableHeader className="sr-only">
									<TableRow>
										<TableHead>{t("ui.agents.teams.col.member")}</TableHead>
										<TableHead>{t("ui.agents.teams.col.type")}</TableHead>
										<TableHead>{t("ui.agents.teams.col.count")}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{(team?.members ?? []).map((member) => (
										<TableRow
											key={`${member.kind}:${member.role}`}
											className="last:border-0"
										>
											<TableCell className="px-0 py-2 text-ink">
												<div className="flex min-w-0 items-center gap-2">
													<span className="min-w-0 truncate">
														{member.role}
													</span>
													{!memberResolution(member, agents, teams) ? (
														<Badge
															variant="warning"
															data-testid="team-member-missing"
														>
															{t("ui.agents.teams.empty.not_found")}
														</Badge>
													) : null}
												</div>
											</TableCell>
											<TableCell className="px-2 py-2 text-ink-dim text-meta">
												{member.kind === "team" ? "Team" : "Agent"}
											</TableCell>
											{/* Right-aligned so every count shares an x; the glyph is kept. */}
											<TableCell className="px-0 py-2 text-right text-ink-muted tabular-nums">
												{`×${memberCountOf(member)}`}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
							{/*
							 * WHY THERE IS NO READING: the probe failed for a reason that is not
							 * the route's absence (a backend that predates it shows nothing here
							 * at all, and no override controls either). Stated rather than left
							 * blank, because a surface that silently shows nothing where a reading
							 * belongs is indistinguishable from one whose reading came back empty.
							 *
							 * DANGER TONE, not muted (design round 1, D10): the sentence is the
							 * only thing on screen where the reading should be, and `ink-muted`
							 * beside a table made it read as a footnote.
							 */}
							{overrideState === "unavailable" ? (
								<div className="flex flex-wrap items-baseline gap-2">
									{/*
									 * AND A WAY OUT (UX round 1, U5): the probe decides both the
									 * reading and whether the override controls are offered, so a
									 * failing read is worth one press to re-take.
									 */}
									<p className="text-meta text-danger">
										{t("ui.agents.models.reading.read_failed")}
									</p>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => void effective.refetch()}
									>
										{t("ui.agents.models.reading.try_again")}
									</Button>
								</div>
							) : null}
						</Section>
						{/*
						 * THE EFFECTIVE READING, the design note's "single most important UX
						 * piece" (§4): without it, which layer decided a member's model is
						 * guesswork, and a save that fell through a layer looks exactly like one
						 * that wrote nothing.
						 *
						 * A TABLE, NOT A LINE PER MEMBER (design round 1, D1). The run-on line
						 * put each value and its layer in the same 12 px grey, began at a
						 * different x on every row, and changed its own layout rule at narrow
						 * widths - so the column an operator scans ("which members are on the
						 * tier map") did not exist. Values are `ink` over `ink-dim` layers, every
						 * row shares the columns, and the widths hold at the pane's narrowest
						 * measure because the value truncates rather than reflowing.
						 *
						 * IT PRINTS THE BACKEND'S OWN ROWS rather than re-joining the reading to
						 * `team.members`: these are the slots a launch resolves, and a row the
						 * team record does not carry (one added since the read) would otherwise
						 * be dropped from the very list that exists to explain a launch.
						 */}
						{overridesAvailable && teamReading?.members.length ? (
							<Section
								title={t("ui.agents.models.reading.title")}
								description={t("ui.agents.models.reading.description")}
							>
								{/*
								 * THE SAME SCOPE AND PRECEDENCE SENTENCE AS THE FORM'S, from the same
								 * key (UX round 1, U1): the read view is where the operator asks what
								 * a member runs on, and the answer is only actionable if it says what
								 * the override layers under it do not do.
								 */}
								<p className="text-meta text-ink-muted">
									{t("ui.agents.models.override.scope_hint")}
								</p>
								{/*
								 * WHILE THE POST-SAVE RE-READ IS IN FLIGHT, THE TABLE IS MARKED, NOT
								 * STALE AND SILENT (UX round 1, U6): the saved toast lands before the
								 * new reading does, and a table of pre-save values under a `Saved`
								 * toast is the "didn't save" confusion this section exists to end.
								 */}
								{effective.isFetching ? (
									<p
										data-testid="team-effective-refreshing"
										className="text-meta text-ink-dim"
									>
										{t("ui.agents.models.reading.refreshing")}
									</p>
								) : null}
								<Table
									className={cn(
										"table-fixed",
										effective.isFetching && "opacity-60",
									)}
									aria-label={t("ui.agents.models.reading.title")}
								>
									<colgroup>
										<col className="w-24" />
										<col />
										{/*
										 * WIDE ENOUGH FOR THE LONGEST PHRASE THE EFFORT CELL PRINTS
										 * ("model default (auto)"): a column that truncates the answer
										 * is a column that makes the reader open the editor to find it.
										 */}
										<col className="w-32" />
									</colgroup>
									{/*
									 * THE HEADERS SHARE THEIR CELLS' OWN PADDING (design round 2,
									 * D12): the body cells of the first and last columns are `px-0`, so
									 * a default header inset put `Member` and `Effort` 8 px in from the
									 * values they head, and a column header that does not sit over its
									 * column is the arrow the reading exists to draw.
									 */}
									<TableHeader>
										<TableRow>
											<TableHead className="px-0">
												{t("ui.agents.models.reading.member_col")}
											</TableHead>
											<TableHead className="px-2">
												{t("ui.agents.models.reading.model_col")}
											</TableHead>
											<TableHead className="px-0">
												{t("ui.agents.models.reading.effort_col")}
											</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{teamReading.members.map((memberReading) => (
											<Fragment
												key={`${memberReading.kind}:${memberReading.role}`}
											>
												<TableRow
													/*
													 * THE REASON IS THIS MEMBER'S OWN SECOND ROW (D6), so the
													 * hairline must not fall between the reading and the sentence
													 * that explains it.
													 */
													className={
														memberReading.available
															? "last:border-0"
															: "border-0"
													}
												>
													<TableCell className="px-0 py-2">
														{/* D13: the full role is readable even when it clips. */}
														<span
															className="block truncate text-body-sm text-ink"
															title={memberReading.role}
														>
															{memberReading.role}
														</span>
													</TableCell>
													<TableCell className="px-2 py-2">
														{readingCell(modelFacts(memberReading))}
													</TableCell>
													<TableCell className="px-0 py-2">
														{readingCell(effortFacts(memberReading))}
													</TableCell>
												</TableRow>
												{memberReading.available ? null : (
													/*
													 * THE REASON ROW CARRIES THE RULE UNDER IT (design round 2,
													 * D11). Round 1 removed the line between a member and its own
													 * reason but left none after it either, so the sentence floated
													 * equidistant between two members: now the reason row keeps its
													 * bottom border and repeats the member's name.
													 */
													<TableRow className="last:border-0">
														<TableCell colSpan={3} className="px-0 pb-2">
															<span
																data-testid="team-effective-unavailable"
																className="block text-meta text-danger"
															>
																{t("ui.agents.models.reading.unavailable", {
																	member: memberReading.role,
																	reason: memberReading.reason,
																})}
															</span>
															{/*
															 * WHERE TO FIX IT (design round 1, D7): the backend's
															 * reason names a config path, which is precise and not
															 * actionable for someone looking at a team.
															 */}
															<span className="block text-meta text-ink-muted">
																{t("ui.agents.models.reading.unavailable_hint")}
															</span>
														</TableCell>
													</TableRow>
												)}
											</Fragment>
										))}
									</TableBody>
								</Table>
							</Section>
						) : null}
						<Section title={t("ui.agents.teams.section.what_for")}>
							<ReadBlock
								text={team?.description ?? ""}
								empty="No description yet."
							/>
						</Section>
						{team?.instructions ? (
							<Section title={t("ui.agents.teams.section.collaboration")}>
								<ReadBlock text={team.instructions} />
							</Section>
						) : null}
						{team?.project ? (
							<Disclosure summary="Project brief">
								<ReadBlock text={team.project} />
							</Disclosure>
						) : null}
					</>
				)}
			</form>
		</div>
	);
}

/** Agents and teams on this machine, grouped, as `SearchableOption`s. */
function managerOptions(
	agents: readonly ReusableProfile[] | undefined,
	teams: readonly ReusableTeam[] | undefined,
) {
	return [
		...(agents ?? []).map((agent) => ({
			id: agent.name,
			name: agent.name,
			description: agent.description,
			group: "Agents",
		})),
		...(teams ?? []).map((row) => ({
			id: row.name,
			name: row.name,
			description: row.description,
			group: "Teams",
		})),
	];
}
