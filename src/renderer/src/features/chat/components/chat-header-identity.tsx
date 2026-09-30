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
import { ChevronDown } from "lucide-react";
import {
	type FC,
	type MutableRefObject,
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react";
import { useEntities } from "../pickers/destination-pickers";
import type { PickerOption } from "../pickers/picker-host";
import { errorText, useSessionCommand } from "../pickers/use-picker-backend";
import { IdentityMenu } from "./chat-header-identity-menu";
import { identityMenuShowsList } from "./chat-header-identity-menu-model";
import { resolveHeaderIdentity } from "./chat-header-identity-model";

/** The identity fields the header passes through; all optional but the session. */
export type HeaderIdentityData = {
	sessionId: string;
	/** Live stream values, which win while an owner is attached. */
	activeAgent?: string | null;
	activeTeam?: string | null;
	/** The catalogue row's durable binding - the cold session's answer. */
	boundAgent?: string | null;
	boundTeam?: string | null;
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
	recents,
	swapRef,
	markSwap,
}) => {
	const rows = useEntities<HeaderEntityRow>(
		sessionId,
		kind,
		undefined,
		enabled,
	);
	const items = rows.data?.entities ?? [];
	const assigned = current !== null;
	/*
	 * A stable id for the listbox, from the noun rather than `useId()`: only one
	 * panel per noun can exist, the row ids are built from it, and a reader (or a
	 * capture rig) can name a row without first reading the DOM. `useId()`'s
	 * `:r1:` spelling is also not a legal CSS selector, which is why the panel
	 * scrolls its active row by `getElementById`.
	 */
	const listId = `header-identity-${kind}-list`;
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
			items.map((row) => ({
				value: row.value,
				/*
				 * The row's READABLE name: a labelled team shows its label; every
				 * other row (agents, and teams without one) shows what it always
				 * did. `value` beside it stays the slug the switch sends.
				 */
				label: teamDisplayName({
					name: row.name ?? row.value,
					label: row.label,
				}),
				description: row.description,
				meta: row.kind,
				current: row.value === menuValue(current),
				/* While a switch is in flight every row is inert: a second switch would
				 * be a second command against a session already answering one. */
				disabled: busy,
			})),
		[items, current, busy],
	);

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
					aria-haspopup="listbox"
					aria-controls={listMounted ? listId : undefined}
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
					 */
					aria-label={`${triggerLabel}: ${label}. ${
						assigned
							? `Switch ${kind === "team" ? "team" : "agent"}`
							: kind === "team"
								? "Assign a team"
								: "Assign an agent"
					}`}
					title={
						assigned
							? `Switch ${kind === "team" ? "team" : "agent"}`
							: kind === "team"
								? "Assign a team"
								: "Assign an agent"
					}
				>
					<span className={cn("min-w-0 truncate")}>{label}</span>
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
				busy={busy}
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
	});
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
