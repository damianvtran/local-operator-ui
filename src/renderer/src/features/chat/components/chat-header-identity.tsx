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
 * row), in the slot the description string occupied. That is deliberate: the
 * block's overflow behaviour (the chip wraps onto a clipped second line when
 * the row cannot hold it) is inherited unchanged, so the header's fixed-part
 * arithmetic - the floor the title keeps at the app's 800px minimum - is not
 * moved by this change. A control that had to live as a row-level sibling
 * would have to join the cluster's shed order or break that floor; clipping
 * like the chip did is the conservative trade.
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
 * A SWITCH IS NOT OPTIMISTIC. Picking a row sends the command and nothing
 * else; the labels repaint when the canonical stream publishes the new
 * `active_team`/`active_agent`, so the header never claims a switch the owner
 * has not made. A refusal or a transport failure goes to the app's toast
 * channel with the owner's own text (`toResult`/`errorText`), which is where
 * this app's controls without a result strip report failures
 * (`composer-status-row.tsx`'s dismiss controls, the same pattern).
 */

import { useTeams } from "@shared/api/local-operator/profile-hooks";
import { Spinner } from "@shared/components/common/spinner";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import { cn } from "@shared/lib/utils";
import { showErrorToast, showWarningToast } from "@shared/utils/toast-manager";
import { ChevronDown } from "lucide-react";
import { type FC, type ReactNode, useCallback, useState } from "react";
import { useEntities } from "../pickers/destination-pickers";
import { errorText, useSessionCommand } from "../pickers/use-picker-backend";
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
 * `name`, `kind`, `description`); re-declared here as the subset this surface
 * uses rather than importing the picker's wider type, because a menu row and a
 * picker row genuinely read different fields and widening this one would
 * invite the copy of a rule the picker already owns.
 */
type HeaderEntityRow = {
	value: string;
	name?: string;
	kind?: string;
	description?: string;
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
	/** Loads the menu's rows, lazily on first open. */
	enabled: boolean;
	triggerLabel: string;
};

/**
 * One control: the trigger plus its menu.
 *
 * Kept as an inner component rather than inlined twice, because the two
 * controls differ only in their noun - the mechanism (lazy row fetch, radio
 * group, busy glyph, honest loading/empty/error rows) is one thing and should
 * not exist twice.
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
	 * The three non-list states, as rows of the menu's own register: a label
	 * row is what the primitive already uses for a caption, and a disabled
	 * ITEM would read as an action the user cannot take rather than a status.
	 * The error keeps the picker's own wording (`errorText`), so the menu and
	 * the modal name one cause one way.
	 */
	const fallback: ReactNode = rows.isLoading ? (
		<DropdownMenuLabel>
			Loading {kind === "team" ? "teams" : "agents"}…
		</DropdownMenuLabel>
	) : rows.isError ? (
		<DropdownMenuLabel className={cn("text-danger")}>
			{errorText(rows.error)}
		</DropdownMenuLabel>
	) : items.length === 0 ? (
		<DropdownMenuLabel>
			{kind === "team" ? "No teams are registered." : "No profiles found."}
		</DropdownMenuLabel>
	) : null;

	return (
		<DropdownMenu open={open} onOpenChange={onOpenChange}>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					data-header-identity={kind}
					className={cn(TRIGGER_BOX, !assigned && "text-ink-dim")}
					aria-busy={busy || undefined}
					/*
					 * The accessible name states the role and the action and still
					 * CONTAINS the visible label (`lopdev`, `No team`), so voice
					 * control keeps working and the ellipsised glyph never stands
					 * alone. The visible strings stay sentence-case and quiet.
					 */
					aria-label={`${triggerLabel}: ${label}. ${
						assigned
							? `Switch ${kind === "team" ? "team" : "agent"}`
							: `Assign a ${kind === "team" ? "team" : "agent"}`
					}`}
					title={
						assigned
							? `Switch ${kind === "team" ? "team" : "agent"}`
							: `Assign a ${kind === "team" ? "team" : "agent"}`
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
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				className={cn("min-w-45")}
				/* Inert hook for the sweep's shutter: the rig waits for the menu
				 * to be PRESENT rather than for a clock, so a frame filed under
				 * an open-menu name cannot photograph the closed control. */
				data-header-identity-menu={kind}
			>
				{fallback ?? (
					<DropdownMenuRadioGroup
						value={menuValue(current)}
						onValueChange={(value) => onPick(value)}
					>
						{items.map((row) => (
							<DropdownMenuRadioItem
								key={row.value}
								value={row.value}
								disabled={busy}
							>
								<span className={cn("min-w-0 truncate")}>
									{row.name ?? row.value}
								</span>
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
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
	const teamCommand = useSessionCommand(sessionId);
	const agentCommand = useSessionCommand(sessionId);

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
		},
		[],
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
				open={open === "agent"}
				onOpenChange={(next) => setOpen(next ? "agent" : null)}
				onPick={(name) => void runSwitch("agent", name, agentCommand)}
				sessionId={sessionId}
				enabled={open === "agent"}
			/>
			<IdentityControl
				kind="team"
				triggerLabel="Team"
				label={view.teamLabel}
				current={view.teamValue}
				busy={teamCommand.busy}
				open={open === "team"}
				onOpenChange={(next) => setOpen(next ? "team" : null)}
				onPick={(name) => void runSwitch("team", name, teamCommand)}
				sessionId={sessionId}
				enabled={open === "team"}
			/>
		</span>
	);
};
