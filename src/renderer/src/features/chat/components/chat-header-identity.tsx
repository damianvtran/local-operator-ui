/**
 * The chat header's identity controls: the team and the agent answering this
 * conversation, as two menus you can switch (or assign, when none is bound).
 *
 * WHAT THIS REPLACES. The header's description slot carried the joined identity
 * as a plain string ("manager · lopdev"), which said who but offered nothing:
 * changing it meant reconciling a slash command against the picker the command
 * palette opens. The operator asked for the string itself to be the control
 * (2026-09-26). The two menus run the SAME backend surface the modal pickers
 * run (`sessions.command` with `team`/`agent` and the picked name, through the
 * same `useSessionCommand` and the same `useEntities` list), so the header and
 * the dialog cannot disagree about what a switch does or what may be picked.
 *
 * WHERE IT SITS, AND THE GEOMETRY CONTRACT THAT DECIDES IT. Both controls live
 * inside the header's one-line text block (`chat-header.tsx`'s wrap-and-clip
 * row), in the slot the description string occupied, so the header's fixed-part
 * arithmetic - the floor the title keeps at the app's 800px minimum - is not
 * moved by this change. What the block does NOT do is wrap while these controls
 * are what the slot holds (UX round 1, U2): a wrapped control lands on the
 * clipped second line, which is a control that is not painted and cannot be
 * pressed - and no tooltip or keyboard note can stand in for one - so the line
 * does not wrap and the TITLE yields instead (it truncates, bounded by the
 * block's own floor). The wrap-and-clip is kept for the path and skeleton
 * halves, where the second line is decoration being dropped. A control that had
 * to live as a row-level sibling would have to join the cluster's shed order or
 * break that floor; keeping it in the block, on the painted line, is the
 * conservative trade.
 *
 * WHY PLAIN `<button>`s, NOT the `Button` primitive. `Button`'s size ramp is
 * 28/32/36px (its own docblock says off-ramp heights propagate), and this row
 * is a 20px text line whose content clips at exactly its line height - a stock
 * size would either overflow the block or move the block's geometry. The
 * repository styles plain buttons directly where the ramp does not fit (the
 * sidebar's rows, the read-only directory chip); this is that case. The ONE
 * thing borrowed from the control vocabulary is the hover/step behaviour, in
 * role names: colour-only transitions, no lift, no scale (branding.md § 5).
 *
 * WHAT THE LABELS SAY is `chat-header-identity-model.ts`'s ladder, in one
 * place so the component only maps answers onto pixels: live stream values
 * first, the catalogue row's durable binding second, and the runtime's team
 * manager for the "team bound, no /agent" case the operator named - never an
 * invented name. "No team"/"No agent" are assign affordances in the subdued
 * ink, and they are only shown where the stream or the catalogue actually says
 * so (the gate lives in the model too).
 *
 * WHAT THE PANEL IS the operator's second report asked for (2026-09-26, after
 * the first): the menus opened one flat list of the whole roster, taller than
 * the window, with no way to reach a named profile except by reading. So each
 * control opens a BOUNDED, FILTERABLE panel instead - the bound, the search
 * field and the recents band all live in `chat-header-identity-menu.tsx`, and
 * the rules behind them (which band a row lands in, what the footer says, what
 * the ceiling is) are values in `chat-header-identity-menu-model.ts`. The two
 * controls render ONE panel, because the operator asked the two pickers to agree
 * rather than to be fixed one at a time.
 *
 * A SWITCH IS NOT OPTIMISTIC. Picking a row sends the command and nothing
 * else; the labels repaint when the canonical stream publishes the new
 * `active_team`/`active_agent`, so the header never claims a switch the owner
 * has not made. A refusal or a transport failure goes to the app's toast
 * channel with the owner's own text (`toResult`/`errorText`), which is where
 * this app's controls without a result strip report failures
 * (`composer-status-row.tsx`'s dismiss controls, the same pattern).
 */

import { useTeams } from "@shared/api/local-operator/profile-hooks";
import { teamDisplayName } from "@shared/api/local-operator/team-display";
import { Spinner } from "@shared/components/common/spinner";
import { Popover, PopoverTrigger } from "@shared/components/ui/popover";
import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { showErrorToast, showWarningToast } from "@shared/utils/toast-manager";
import { ChevronDown, Lock, TriangleAlert } from "lucide-react";
import {
	type FC,
	type MutableRefObject,
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react";
import type { CanonicalEffectiveIdentity } from "../../../../../shared/desktop-session-contract";
import { useEntities } from "../pickers/destination-pickers";
import type { PickerOption } from "../pickers/picker-host";
import { errorText, useSessionCommand } from "../pickers/use-picker-backend";
import { IdentityMenu } from "./chat-header-identity-menu";
import {
	IDENTITY_AGENT_NOT_SETTABLE_REASON,
	type IdentityAgentConstraint,
	identityAgentConstraint,
	identityAgentSettable,
	identityMenuShowsList,
} from "./chat-header-identity-menu-model";
import {
	headerIdentityAgentFlagged,
	resolveHeaderIdentity,
} from "./chat-header-identity-model";
import { TeamAvatarBubble } from "./team-avatar-bubble";

/** The identity fields the header passes through; all optional but the session. */
export type HeaderIdentityData = {
	sessionId: string;
	/** Live stream values, which win while an owner is attached. */
	activeAgent?: string | null;
	activeTeam?: string | null;
	/** The catalogue row's durable binding - the cold session's answer. */
	boundAgent?: string | null;
	boundTeam?: string | null;
	/**
	 * The host's `effective_identity` statement (`canonical.frontend`). Absent or
	 * `{}` from a host that predates it - which keeps the #866 behaviour; see
	 * `effectiveIdentityPublished`.
	 */
	effectiveIdentity?: CanonicalEffectiveIdentity | null;
};

/**
 * One `commands.entities` row, in the fields both menus render.
 *
 * The same shape `destination-pickers.tsx`'s `ProfileRow` reads (`value`,
 * `name`, `kind`, `description`, and the team-only `label`); re-declared here
 * as the subset this surface uses rather than importing the picker's wider
 * type, because a menu row and a picker row genuinely read different fields
 * and widening this one would invite the copy of a rule the picker already
 * owns.
 */
type HeaderEntityRow = {
	value: string;
	name?: string;
	kind?: string;
	description?: string;
	/** A team's free-text display name, when the row carries one. */
	label?: string;
	/**
	 * An agent profile's `delegate` flag - whether it may coordinate further
	 * work - exactly as the profile catalogue publishes it (the shipped
	 * runtime's own `profile_detail`; `may_delegate` in `agent_profiles.py`).
	 * The agent slot's constraint (issue #861) reads THIS field and nothing
	 * else to decide whether a profile can hold the seat of a team-led chat:
	 * absent reads as "not delegating" for the slot's marks (the predicate is
	 * `=== true`), while the header's cue refuses to reason about an absent
	 * field at all (see `headerIdentityAgentFlagged`).
	 */
	delegate?: boolean | null;
};

/**
 * The trigger box, shared by both controls.
 *
 * `h-5` is the text block's own line height - the height at which the block's
 * clip falls exactly between lines - so a control can sit in that line without
 * half-clipping. `rounded-xs` (2px) rather than the control-step 6px: on a
 * 20px box 6px is proportionally the lozenge the ramp's own note refuses
 * ("a third of its height"), and 2px is the ramp's step for boxes too small
 * to carry 6.
 *
 * The ink steps are the SUBTLE part the operator asked for: rest keeps the
 * register the string had (`ink-muted` assigned, `ink-dim` for the assign
 * affordance), hover steps ink and takes the row's neutral ground step
 * (`bg-elevated`, the same hover the cluster's icon buttons use - the run
 * trigger's docblock records why the cluster does not use `accent-wash` for
 * hover), and an OPEN menu holds that ground so "this menu is up" and "a
 * pointer is here" are not the same pixels.
 */
const TRIGGER_BOX = cn(
	"inline-flex h-5 min-w-0 shrink-0 cursor-pointer items-center gap-1 rounded-xs px-1",
	"font-mono whitespace-nowrap text-mono-sm",
	"transition-colors duration-fast ease-out-quart",
	"text-ink-muted hover:bg-elevated hover:text-ink",
	"data-[state=open]:bg-elevated data-[state=open]:text-ink",
);

/** The fixed 14px slot the chevron and the busy spinner share, so a switch never moves the box. */
const GLYPH_SLOT = cn(
	"inline-flex size-3.5 shrink-0 items-center justify-center",
);

/**
 * The current-marking rule, stated once: the marked row is the one the label
 * reports.
 *
 * NOT `active_team`/`active_agent` directly, and the difference is the case
 * the operator named: with a team bound and no `/agent`, the label says
 * `manager` (the team's manager governs the session), so `manager` is the
 * current profile in force and the menu marks it. Marking nothing there would
 * leave the label and the menu disagreeing about what "current" means on one
 * screen.
 */
function menuValue(current: string | null): string {
	return current ?? "";
}

type IdentityControlProps = {
	/** Which command this control runs and which list it reads. */
	kind: "team" | "agent";
	label: string;
	/** `null` renders the assign affordance copy and the subdued ink. */
	current: string | null;
	busy: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Runs the switch; resolves when the backend has answered. */
	onPick: (name: string) => void;
	sessionId: string;
	/** Loads the panel's rows, lazily on first open. */
	enabled: boolean;
	triggerLabel: string;
	/**
	 * The bound team's acceptance rule for THIS control's slot, or `null` when
	 * there is none (always, for the team control; for the agent control until a
	 * team's manager is known). While present, rows the rule does not accept
	 * are `disabled` with the reason in their description - still listed, never
	 * hidden - and the panel states the rule in a caption above the list.
	 */
	constraint: IdentityAgentConstraint | null;
	/**
	 * The bound pair needs resolving: the chip carries the cue (issue #861).
	 * Only the agent control can be flagged - a team is never outside its own
	 * rule.
	 */
	flagged: boolean;
	/**
	 * Names this app has switched to before, most recent first - the panel's
	 * `Recent` band. Read from the store by `ChatHeaderIdentity` and passed
	 * down, because both controls read their own ring and neither owns it.
	 */
	recents: readonly string[];
	/**
	 * The pair's swap guard, shared by both controls: set when either trigger
	 * is PRESSED, cleared on the next task. See `chat-header-identity`'s own
	 * note for what it protects (`onCloseAutoFocus` skips the focus-return
	 * while it is set).
	 */
	swapRef: MutableRefObject<boolean>;
	markSwap: () => void;
};

/**
 * One control: the chip plus its panel.
 *
 * Kept as an inner component rather than inlined twice, because the two
 * controls differ only in their noun - the mechanism (lazy row fetch, current
 * marking, busy glyph, the panel's bound/search/bands and its honest
 * loading/empty/error sentences) is one thing and must not exist twice.
 */
const IdentityControl: FC<IdentityControlProps> = ({
	kind,
	label,
	current,
	busy,
	open,
	onOpenChange,
	onPick,
	sessionId,
	enabled,
	triggerLabel,
	constraint,
	flagged,
	recents,
	swapRef,
	markSwap,
}) => {
	/*
	 * A CLOSED SEAT LISTS NOTHING (the runtime's strict rule): no row can be
	 * picked, so the roster is not fetched for a panel that will not show it.
	 */
	const closedReason = constraint?.closed ?? null;
	const rows = useEntities<HeaderEntityRow>(
		sessionId,
		kind,
		undefined,
		enabled && closedReason === null,
	);
	const items = rows.data?.entities ?? [];
	const assigned = current !== null;
	/*
	 * Whether the visible name is a LABEL rather than the identity's own value
	 * (design round 1, D1/D2/D3). `label` and `current` are the same string for
	 * every row except a labelled team — whose `current` stays the slug the
	 * switch sends — so this one comparison is what the chip's cap, tooltip and
	 * face are all built from.
	 */
	const labelWon = assigned && label !== current;
	/*
	 * A stable id for the listbox, from the noun rather than `useId()`: only one
	 * panel per noun can exist, the row ids are built from it, and a reader (or a
	 * capture rig) can name a row without first reading the DOM. `useId()`'s
	 * `:r1:` spelling is also not a legal CSS selector, which is why the panel
	 * scrolls its active row by `getElementById`.
	 */
	const listId = `header-identity-${kind}-list`;
	/*
	 * The closed seat's note (see `IdentityMenu`'s `closedReason`): a disclosure
	 * rather than a listbox, so the trigger names it with `aria-controls` while
	 * it is up and claims `aria-haspopup="dialog"` (Radix's own default) rather
	 * than `listbox` for a list that does not exist.
	 */
	const closedNoteId = `header-identity-${kind}-closed`;
	/*
	 * The chip element itself: the Tab contract's other half (UX round 1, U1)
	 * needs to put focus back on it the moment the field asks to dismiss, and
	 * the close guard below uses it to suppress the focus-return for that same
	 * closure.
	 */
	const triggerRef = useRef<HTMLButtonElement>(null);
	/*
	 * The Tab path's mark (UX round 1, U1), consumed by `onCloseAutoFocus`
	 * below exactly as the pair's swap mark is: the close the field's Tab
	 * starts has ALREADY handed focus to this chip, and Radix's close-autofocus
	 * - which fires from a passive cleanup a few ms after the commit (the
	 * timing the pair's note records) - would pull focus back out of the
	 * advance the Tab began.
	 */
	const skipReturnRef = useRef(false);
	/*
	 * Whether the listbox is mounted, for the trigger's `aria-controls` (UX
	 * round 1, U4): the reference may name the list only while it exists, and
	 * the loading, refused and empty states render no list to point at. The
	 * same rule the panel itself gates on, from one function, so the two cannot
	 * drift.
	 */
	const listMounted =
		open &&
		identityMenuShowsList({
			loading: rows.isLoading,
			loadError: rows.isError ? errorText(rows.error) : null,
			rowCount: items.length,
		});

	/*
	 * The rows the panel lists, in the shape the app's one option row reads
	 * (`PickerOption`) - the same shape the modal `/agent` and `/team` pickers
	 * pass, so the two surfaces cannot render one roster two ways.
	 *
	 * `current` comes from `menuValue(current)` and not from the raw
	 * `active_team`/`active_agent`: the rule the old radio group carried is the
	 * one that had to survive, because with a team bound and no `/agent` the
	 * LABEL reads the team's manager, and a panel that marked nothing there would
	 * disagree with the chip about which profile is in force.
	 *
	 * `meta` is the catalogue's own `kind` (role / specialist) - the field the
	 * modal pickers print in the same slot. Descriptions are printed for the same
	 * reason: the roster is the same roster, and the reader who needs one needs it
	 * on both surfaces.
	 */
	const options = useMemo<PickerOption[]>(
		() =>
			items.map((row) => {
				const shown = teamDisplayName({
					name: row.name ?? row.value,
					label: row.label,
				});
				/*
				 * THE TEAM'S RULE, per row (issue #861): one predicate
				 * (`identityAgentSettable` - the runtime's own acceptance rule), so a
				 * profile this panel marks settable is exactly one the backend will
				 * accept. `constraint` is null on the team control and while no manager
				 * is known, and a null constraint blocks nothing - an unknown manager
				 * must not constrain (see `identityAgentConstraint`).
				 */
				const blocked =
					constraint !== null &&
					!identityAgentSettable({
						name: row.value,
						manager: constraint.manager,
						delegate: row.delegate,
						teamOwnsSeat: constraint.closed !== undefined,
					});
				return {
					value: row.value,
					/*
					 * The row's READABLE name: a labelled team shows its label; every
					 * other row (agents, and teams without one) shows what it always
					 * did. `value` beside it stays the slug the switch sends.
					 */
					label: shown,
					/*
					 * A BLOCKED ROW SPENDS ITS DESCRIPTION SLOT ON THE REASON, so the
					 * disable is self-explaining and never silent. The row's own prose
					 * would answer a question nobody can act on while the reason is the
					 * one fact a blocked row has to give.
					 *
					 * Not blocked, the slug rides the DESCRIPTION line when the label took
					 * the name slot (design round 1, D2): the menu is where a switch is
					 * CHOSEN, and the string every other surface addresses the team by
					 * (`/team <slug>`) must be readable at the moment of choosing rather
					 * than discovered after the composer fills.
					 */
					description: blocked
						? IDENTITY_AGENT_NOT_SETTABLE_REASON
						: shown !== row.value
							? row.description
								? `${row.value} · ${row.description}`
								: row.value
							: row.description,
					meta: row.kind,
					current: row.value === menuValue(current),
					/* While a switch is in flight every row is inert: a second switch would
					 * be a second command against a session already answering one. A row the
					 * team's rule refuses is inert for the same reason - picking it would be
					 * a command the runtime refuses. */
					disabled: busy || blocked,
					/* BUSY IS NOT REFUSED (review round 2, MINOR-2): `disabled` folds the
					 * in-flight switch and the team's rule together, and the panel's
					 * refusal messages must only describe the LATTER - a chip re-opened
					 * while a switch settles must not be told a row "cannot take the
					 * seat". `blocked` carries the rule's half alone; the busy half is
					 * the switch already running. */
					blocked,
				};
			}),
		[items, current, busy, constraint],
	);

	/*
	 * The cue sentence a flagged chip carries (issue #861): the SAME sentence
	 * the panel states above its list (`constraint.caption`), so the chip and
	 * the panel explain the bound pair in one voice rather than two
	 * paraphrases. `null` unless a constraint is in force, which a flagged chip
	 * always implies - the flag itself requires a known manager.
	 */
	const cueSentence = constraint?.caption ?? null;

	return (
		/*
		 * `modal={false}` is UX round 1's U4, kept across the move to a popover for
		 * the same measured reason: two controls share one row, and a modal layer
		 * makes the sibling's click only DISMISS the open panel, so swapping panels
		 * costs two clicks. Non-modal lets the sibling's press dismiss this panel and
		 * open its own in the same gesture - the pointer event reaches the sibling
		 * because no modal layer is holding it - which is what "one click swaps"
		 * means. Radix's own dismiss-on-outside-press and Escape/focus-return are the
		 * same in both families; what differs is the layer, not the contract.
		 */
		<Popover open={open} onOpenChange={onOpenChange} modal={false}>
			<PopoverTrigger asChild>
				<button
					ref={triggerRef}
					type="button"
					data-header-identity={kind}
					/* The capture rig's claim anchor for a CLOSED seat (the runtime's
					 * strict rule), beside the cue's own hook. */
					data-header-identity-closed={closedReason !== null ? "" : undefined}
					className={cn(TRIGGER_BOX, !assigned && "text-ink-dim")}
					aria-busy={busy || undefined}
					/*
					 * `listbox`, not the `dialog` a Radix popover trigger announces by
					 * default: what the press opens is a filterable list of profiles, and
					 * the field inside it declares `aria-controls` on this same id. The
					 * override wins because a Slot's own child props are spread last -
					 * and it is named only while the listbox is mounted (`listMounted`),
					 * so a loading, refused or empty panel does not point at a list that
					 * is not there (UX round 1, U4).
					 */
					aria-haspopup={closedReason === null ? "listbox" : "dialog"}
					aria-controls={
						closedReason !== null
							? open
								? closedNoteId
								: undefined
							: listMounted
								? listId
								: undefined
					}
					/* The swap guard's mark: every press on either trigger records
					 * that the closure about to run is a SWAP, not a dismissal - see
					 * `onCloseAutoFocus` on the menu below, and the pair's own note
					 * under `ChatHeaderIdentity` for the measured failure it fixes. */
					onPointerDown={markSwap}
					/*
					 * The accessible name states the role and the action and still
					 * CONTAINS the visible label (the team's name or label, `No team`),
					 * so voice control keeps working and the ellipsised glyph never
					 * stands alone. The visible strings stay sentence-case and quiet.
					 * The cue's sentence is a SEPARATE CLAUSE after a period (review
					 * round 1, D6/NIT-1): read aloud, "Switch agent Local Operator Dev
					 * is led by..." ran the action into the rule as one noun phrase.
					 */
					aria-label={
						closedReason !== null
							? /* A closed control offers no "Switch": the name states the
								 * role and the speaker, and the reason is its own clause. */
								`${triggerLabel}: ${label}. ${closedReason}`
							: `${triggerLabel}: ${label}. ${
									assigned
										? `Switch ${kind === "team" ? "team" : "agent"}`
										: kind === "team"
											? "Assign a team"
											: "Assign an agent"
								}${flagged && cueSentence ? `. ${cueSentence}` : ""}`
					}
					title={
						closedReason !== null
							? /*
								 * The closed chip's tooltip: the label leads (which profile this
								 * is about), then the runtime's own closure sentence - the SAME
								 * string the panel states, as the flagged chip does for its rule.
								 */
								`${label} — ${closedReason}`
							: flagged && cueSentence
								? /*
									 * The flagged chip's tooltip states the rule the pair breaks
									 * (issue #861) - the label leads so the hover still says which
									 * profile it is about, and the sentence is the panel's own
									 * (`constraint.caption`), not a second paraphrase. The em dash
									 * makes the two clauses read as two (review round 1, D6).
									 */
									`${label} — ${cueSentence}`
								: assigned
									? /*
										 * The identity in the tooltip, `Label (slug)` when the two differ
										 * (design round 1, D2) — the one plain-text home for the slug
										 * beside the sidebar row's tooltip, and the full label for a
										 * capped chip too (D1). The ACTION words stay in the
										 * `aria-label` above rather than repeating here.
										 */
										`${label}${labelWon ? ` (${current})` : ""}`
									: kind === "team"
										? "Assign a team"
										: "Assign an agent"
					}
				>
					{kind === "team" && assigned && (
						/*
						 * THE BUBBLE LEADS THE LABEL (operator ask, 2026-10-01): the chat
						 * header and the sidebar name the same team, so they draw the same
						 * mark rather than one surface inventing a second compact form.
						 *
						 * RENDERED ONLY FOR A TEAM (`kind`) AND ONLY WHEN ONE IS BOUND
						 * (`assigned`): `No team` has no name to compress, and an agent is
						 * not a team - the roadmap's compact mark is a team one, and an
						 * agent's name stays text in the chips beside this one.
						 *
						 * NO TOOLTIP HERE, and that is the one place the bubble's own contract
						 * is turned off: the chip draws the label IN FULL one gap to the
						 * right of the mark, so a tooltip would say nothing a reader cannot
						 * already see - and the chip is a `title`-carrying control, so a
						 * second pointer surface inside it is exactly the native-tooltip /
						 * app-tooltip doubling the row's flyout was built to remove (D7).
						 * One pointer surface, and it is the chip's own. The mark keeps its
						 * `aria-label`, so the team's name is still in the control's
						 * accessible content.
						 */
						<TeamAvatarBubble
							name={label}
							slug={current ?? undefined}
							showTooltip={false}
						/>
					)}
					{/*
					 * THE CUE (issue #861). A team-bound chat's agent slot accepts the
					 * team's manager or a profile that can delegate; when an EXPLICIT
					 * agent the rule refuses is in the seat, the persona stays VISIBLE -
					 * it is in the prompt, and the header never hides what the runtime is
					 * running - and this mark says the pair needs resolving. Hue + glyph +
					 * copy (the alert grammar, § 3): the warning ink and the warning
					 * triangle are the visible half, the title and `aria-label` above
					 * carry the sentence, and the panel the chip opens is where the
					 * one-pick resolution lives.
					 *
					 * `aria-hidden` because the words already ride the chip's own
					 * `aria-label`; the `data-` hook is the capture rig's claim anchor
					 * (the conflict frames assert its presence, and its absence while
					 * the roster is still answering).
					 */}
					{flagged && (
						<TriangleAlert
							data-header-identity-cue=""
							aria-hidden="true"
							className="size-3 shrink-0 text-warning"
						/>
					)}
					<span
						className={cn(
							/*
							 * `max-w` so the chip is BOUNDED (design round 1, D1): the box is
							 * `shrink-0` and a label can be up to 80 characters, which beside
							 * an agent chip and inside a one-line block pushed the identity
							 * past the block's clip — a control present but not painted. A
							 * label longer than the cap truncates here and reads whole in the
							 * title above.
							 */
							"min-w-0 max-w-[24ch] truncate",
							/* The human face for a label (D3); a slug keeps the machine face. */
							labelWon && "font-sans",
						)}
					>
						{label}
					</span>
					{/*
					 * A glyph, not a rotating switch: the chevron is the app's
					 * at-rest idiom for "this opens a menu" (the composer's directory
					 * chip took it for exactly that reason, design review D8), and the
					 * spinner takes its slot while the switch is in flight so the
					 * control states that it is working rather than looking inert.
					 */}
					<span className={cn(GLYPH_SLOT)}>
						{busy ? (
							<Spinner size="xs" />
						) : closedReason !== null ? (
							/* A lock where the chevron was: the chevron promises a list to
							 * choose from, and a closed seat has none. The press still
							 * opens a panel, but it only states why. */
							<Lock className={cn("size-3 text-ink-dim")} aria-hidden="true" />
						) : (
							<ChevronDown
								className={cn("size-3 text-ink-dim")}
								aria-hidden="true"
							/>
						)}
					</span>
				</button>
			</PopoverTrigger>
			{/*
			 * The panel: the bound, the filter and the bands all live in
			 * `IdentityMenu`, so the two controls render one panel and the rules are
			 * pinned as values (`chat-header-identity-menu-model.ts`). What stays
			 * HERE is the pair's own half - the swap guard below, which is about two
			 * controls sharing a row rather than about a list.
			 */}
			<IdentityMenu
				kind={kind}
				open={open}
				listId={listId}
				options={options}
				recents={recents}
				loading={rows.isLoading}
				loadError={rows.isError ? errorText(rows.error) : null}
				emptyText={
					kind === "team"
						? "No teams are registered."
						: "No agents are registered."
				}
				/*
				 * The rule the rows were marked by, stated once above the list (issue
				 * #861) - the reason a near-miss row is disabled is visible on the row
				 * itself, and the rule it belongs to is visible before the reading
				 * starts. `null` for the team control and while no manager is known.
				 */
				caption={constraint?.caption ?? null}
				closedReason={closedReason}
				closedNoteId={closedNoteId}
				onPick={(value) => {
					/* A pick is a decision, so the panel closes on it - the chip's own
					 * busy spinner is what says the switch is in flight, and the label
					 * does not move until the owner reports the new profile. */
					onOpenChange(false);
					onPick(value);
				}}
				/*
				 * The TAB path (UX round 1, U1). The field claims Tab (Radix's
				 * non-modal focus scope would otherwise loop it back into the field,
				 * whose only tabbable it is) and asks this control to dismiss: focus
				 * lands on the chip BEFORE the panel unmounts, so the browser's own
				 * default Tab advance continues from the chip; and the close is marked
				 * so Radix's focus-return skips it - that return would fire a few ms
				 * later and pull focus back out of the same advance.
				 */
				onClose={() => {
					triggerRef.current?.focus();
					skipReturnRef.current = true;
					onOpenChange(false);
				}}
				/*
				 * THE SWAP GUARD (UX round 1, U4 - see the note under
				 * `ChatHeaderIdentity` for the measured sequence this answers).
				 * A close caused by a press on the SIBLING control must not run
				 * Radix's focus-return: that refocus lands on this control's own
				 * trigger and the just-opened sibling panel reads it as
				 * focus-outside and dismisses itself 4ms later (measured with the
				 * menu: agent aria-expanded true at t, false at t+4). Outside
				 * clicks, Escape and same-trigger toggles leave `swapRef` false and
				 * keep the return; the Tab path has its own mark beside it
				 * (`skipReturnRef`), which suppresses the return because it has
				 * ALREADY handed focus to the chip rather than to stop a sibling.
				 */
				onCloseAutoFocus={(event) => {
					if (swapRef.current || skipReturnRef.current) {
						/* Consume on use: the close-autofocus runs from a passive
						 * cleanup, so clearing on a zero timeout raced it (see the
						 * pair's note under `ChatHeaderIdentity`). */
						swapRef.current = false;
						skipReturnRef.current = false;
						event.preventDefault();
					}
				}}
			/>
		</Popover>
	);
};

/**
 * The header's identity slot: the agent control, then the team control.
 *
 * The order matches the string it replaces ("manager · lopdev" read agent
 * first), so the common case repaints into the same reading order the header
 * already had.
 */
export const ChatHeaderIdentity: FC<HeaderIdentityData> = ({
	sessionId,
	activeAgent,
	activeTeam,
	boundAgent,
	boundTeam,
	effectiveIdentity,
}) => {
	const rawTeam = activeTeam || boundTeam || null;
	/*
	 * The manager label's source, loaded only when a team is actually bound and
	 * never gating the control: while it loads, `resolveHeaderIdentity` answers
	 * with the runtime's own default, which is what that field is documented
	 * to be - so the label cannot flicker through a placeholder.
	 */
	const teams = useTeams(Boolean(rawTeam));
	const view = resolveHeaderIdentity({
		activeAgent,
		activeTeam,
		boundAgent,
		boundTeam,
		teams: teams.data,
		effectiveIdentity,
	});
	/*
	 * THE STRICT RULE, decided once in the model (`view.seat`): the host
	 * publishes `effective_identity` and a team owns the session. Every
	 * consumer below reads this one value - the roster watch, the cue, the
	 * constraint the chip and the panel share - so they cannot disagree.
	 */
	const teamOwnsSeat = view.seat !== null;
	/*
	 * THE EXPLICIT SEAT (issue #861): the agent the session was actually told
	 * to run (`/agent`, live or bound) - never the manager the label falls back
	 * to, because that implicit seat is the manager's own and the rule accepts
	 * it by definition.
	 */
	const explicitAgent = activeAgent || boundAgent || null;
	/*
	 * The roster query that answers "may this profile coordinate?" for the
	 * chip's cue. GATED TO THE AMBIGUOUS CASE ONLY - a team leads AND an
	 * explicit agent sits in the seat - because that is the only state whose
	 * claim needs the flag: no team means the rule does not apply, and no
	 * explicit agent means the seat holds the manager and the question cannot
	 * be asked. The agent PANEL opens the same query from its own control
	 * (`useEntities` keys it by session, command and name), so an open menu and
	 * this watch are one request rather than two.
	 */
	const watchedRows = useEntities<HeaderEntityRow>(
		sessionId,
		"agent",
		undefined,
		Boolean(rawTeam && explicitAgent) && !teamOwnsSeat,
	);
	const watchedDelegate = useMemo(() => {
		if (!explicitAgent) return null;
		const row = watchedRows.data?.entities.find(
			(entry) => entry.value === explicitAgent,
		);
		/*
		 * `?? null`: a row the roster does not carry, or one that did not carry
		 * the field, answers "not known" rather than "cannot delegate" - the cue
		 * must not reason from a row that is not there (see
		 * `headerIdentityAgentFlagged`, which holds the same line about absent
		 * facts).
		 */
		return row?.delegate ?? null;
	}, [explicitAgent, watchedRows.data]);
	/*
	 * The pair's cue and the agent slot's rule, both from the view's own facts:
	 * `flagged` needs the manager AND the delegate datum; `constraint` needs
	 * the manager alone - and carries the caption the panel and a flagged
	 * chip's tooltip share (see `IdentityControl`'s `cueSentence`).
	 */
	const flagged = headerIdentityAgentFlagged({
		explicitAgent,
		manager: view.teamManager,
		delegate: watchedDelegate,
		teamOwnsSeat,
	});
	/*
	 * The constraint is MEMOIZED (review round 1, MINOR-1): built inline it was a
	 * fresh object every render, and it is a dep of the panel's options memo -
	 * so every header render (a busy flip, a store tick, the cue's own query
	 * landing) rebuilt all 150 options and re-rendered every mounted row, the
	 * stability the panel was built around lost to one object identity.
	 */
	const constraint = useMemo(
		() =>
			identityAgentConstraint({
				teamLabel: view.teamLabel,
				manager: view.teamManager,
				closure: view.seat,
			}),
		[view.teamLabel, view.teamManager, view.seat],
	);
	/*
	 * One open menu at a time, by hand: two independent Radix roots cannot see
	 * each other, and two menus up from one row is a state with no meaning.
	 * The state is also the lists' lazy gate - a closed menu costs no query.
	 */
	const [open, setOpen] = useState<"agent" | "team" | null>(null);
	/*
	 * THE SWAP GUARD, and why modal={false} alone was not enough (UX round 1,
	 * U4; measured on Radix 2.1.24 through this header rather than reasoned
	 * about). With `modal={false}` the sibling press DOES reach the idle trigger
	 * and its menu DOES open - aria-expanded flips true in the same commit the
	 * dismissing menu closes - but the dismissing menu's own close then runs
	 * Radix's focus-return onto its trigger, and the just-opened sibling reads
	 * that focus as `focus-outside` and dismisses itself 4ms later (verbatim
	 * from the probe: agent true at t=4363, team false at t=4363, agent false
	 * at t=4367; the two-click behaviour the review measured, reproduced and
	 * traced). Radix's own guard for this - `hasInteractedOutsideRef` skipping
	 * the focus-return when the closure was an outside interaction - does not
	 * engage for a same-tick sibling swap, because the outside event is
	 * dispatched to the layer that just mounted (the sibling's) rather than the
	 * one that received it.
	 *
	 * So the pair carries the flag itself: every press on either trigger marks
	 * `swapRef`, and a menu whose close-autofocus runs while it is set skips the
	 * focus-return and CONSUMES the flag (`onCloseAutoFocus` in
	 * `IdentityControl`). Two details are load-bearing, both measured: the flag
	 * is consumed on use rather than cleared on a zero timeout, because the
	 * close-autofocus runs from a PASSIVE effect cleanup a few ms after the
	 * commit and a `setTimeout(0)` clear raced it (the first attempt still
	 * focused the trigger at t+4); and the timeout that remains is a ceiling
	 * for the case where a press produces no close at all, long enough to
	 * outlive any passive flush and short enough that a genuine dismissal right
	 * after an opening press is the only thing it could ever affect. Escape,
	 * outside clicks and same-trigger toggles keep the focus-return.
	 */
	const swapRef = useRef(false);
	const markSwap = useCallback(() => {
		swapRef.current = true;
		window.setTimeout(() => {
			swapRef.current = false;
		}, 300);
	}, []);
	const teamCommand = useSessionCommand(sessionId);
	const agentCommand = useSessionCommand(sessionId);
	/*
	 * The recents rings, read from the persisted store rather than held here: a
	 * switch made in one conversation is a recent in the next one, which is the
	 * whole point of the band (see the store's `profileRecents` for why the ring
	 * is app-wide rather than per conversation). Both rings are read in one
	 * subscription so the two controls cannot render different generations of the
	 * same store.
	 */
	const recents = useUiPreferencesStore((state) => state.profileRecents);
	const rememberProfile = useUiPreferencesStore(
		(state) => state.rememberProfile,
	);

	const runSwitch = useCallback(
		async (
			kind: "team" | "agent",
			name: string,
			channel: ReturnType<typeof useSessionCommand>,
		) => {
			// A second pick while the first is in flight would send two
			// commands for one intent; the menu is closed by then, so this is
			// the re-open-while-busy path.
			if (channel.busy) return;
			const { result } = await channel.run(
				kind,
				name,
				kind === "team"
					? "Could not switch the team"
					: "Could not switch the agent",
			);
			/*
			 * The stream is the success path: the label repaints from the new
			 * `active_team`/`active_agent` when the owner publishes it, and a
			 * toast for that would be the control speaking over the stream it
			 * just moved (the composer-status-row rule). A failure has no wire
			 * to speak for it. The text is the hook's own - the owner's wording
			 * when it gave one - so the toast cannot paraphrase the backend.
			 */
			if (result.tone === "error") showErrorToast(result.text);
			else if (result.tone === "warning") showWarningToast(result.text);
			/*
			 * A RECENT is a switch the owner CONFIRMED, and `success` is the only tone
			 * that claims that: it is what `toResult` maps the owner's own `notice`
			 * onto. A warning, an informational block or a transport failure is not
			 * evidence the profile is in force, so none of them earns a row in the
			 * band - a "recent" that names a profile the session is not on would be
			 * the label lying in a smaller font.
			 */ else if (result.tone === "success") rememberProfile(kind, name);
		},
		[rememberProfile],
	);

	return (
		<span
			data-header-identity-controls=""
			/*
			 * `shrink-0`, like the string it replaces: the identity is dropped by
			 * WRAPPING (the block clips the second line) and never squished into
			 * an ellipsis of its own - a half-said team name is worse than the
			 * chip's absent state, which the block's own overflow already covers.
			 */
			className={cn("flex shrink-0 items-center gap-1")}
		>
			<IdentityControl
				kind="agent"
				triggerLabel="Agent"
				label={view.agentLabel}
				current={view.agentValue}
				busy={agentCommand.busy}
				constraint={constraint}
				flagged={flagged}
				swapRef={swapRef}
				markSwap={markSwap}
				open={open === "agent"}
				onOpenChange={(next) => setOpen(next ? "agent" : null)}
				onPick={(name) => void runSwitch("agent", name, agentCommand)}
				sessionId={sessionId}
				enabled={open === "agent"}
				recents={recents.agent}
			/>
			<IdentityControl
				kind="team"
				triggerLabel="Team"
				label={view.teamLabel}
				current={view.teamValue}
				busy={teamCommand.busy}
				/*
				 * The constraint is the AGENT slot's rule: a team is never outside
				 * its own acceptance, so this control carries none - and can never
				 * be flagged.
				 */
				constraint={null}
				flagged={false}
				swapRef={swapRef}
				markSwap={markSwap}
				open={open === "team"}
				onOpenChange={(next) => setOpen(next ? "team" : null)}
				onPick={(name) => void runSwitch("team", name, teamCommand)}
				sessionId={sessionId}
				enabled={open === "team"}
				recents={recents.team}
			/>
		</span>
	);
};
