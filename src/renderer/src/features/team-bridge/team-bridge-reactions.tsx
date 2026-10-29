import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import { Spinner } from "@shared/components/common/spinner";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@shared/components/ui/popover";
import { Tooltip } from "@shared/components/ui/tooltip";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Plus } from "lucide-react";
import { type ReactElement, useEffect, useId, useRef, useState } from "react";
import type { TeamBridgeReaction } from "../../../../shared/team-bridge-contract";
import { EMOJI_ENTRIES, toggleReaction } from "./team-bridge-emoji-model";
import { TeamBridgeEmojiPicker } from "./team-bridge-emoji-picker";
import { canRenderEmoji } from "./team-bridge-emoji-support";
import { TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD } from "./team-bridge-reaction-gate";
import { useReactionPreferences } from "./team-bridge-reaction-preferences";

// A stable empty snapshot matters: a new [] default on every render retriggers
// synchronization after setRows and loops on messages with no reactions.
const EMOJI_NAMES = new Map(
	EMOJI_ENTRIES.map(({ emoji, name }) => [emoji, name]),
);
const EMPTY_REACTIONS: TeamBridgeReaction[] = [];

type Props = {
	conversationId: string;
	messageId: string;
	accountId: string;
	tenantId: string;
	reactions?: TeamBridgeReaction[];
	disabled?: boolean;
	defaultOpen?: boolean;
	toggle?: typeof TeamBridgeApi.react;
};

/**
 * One message's reaction state: the rows on screen, the toggle, and its
 * busy/refused flags. A hook rather than component state because two places
 * act on the same rows: the in-flow chips (and their `+`) and the message
 * toolbar's react button (`team-bridge-message-toolbar.tsx`). Both must go
 * through ONE `choose`, or a toolbar pick and a chip toggle could race on
 * separate snapshots.
 *
 * One in-flight toggle per message prevents two snapshots racing on rollback. Server summaries
 * replace optimism on success; refusal restores the exact previous row and exposes a retry cue.
 * A polling answer arriving during the write cannot overwrite the pending optimistic projection.
 */
export function useTeamBridgeReactionState({
	conversationId,
	messageId,
	accountId,
	tenantId,
	reactions = EMPTY_REACTIONS,
	disabled = false,
	toggle = TeamBridgeApi.react,
}: Omit<Props, "defaultOpen">) {
	/*
	 * THE BUILD GUARD, INSIDE THE HOOK. Hooks run unconditionally (a conditional
	 * hook would break every caller), but a build with the surface withheld
	 * returns an INERT state and `choose` is a no-op. In this shipped build the
	 * toggle carries the captured account and target tenant required by #3149.
	 */
	const held = !TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD;
	const [rows, setRows] = useState(held ? EMPTY_REACTIONS : reactions);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState(false);
	const busy = useRef(false);
	const record = useReactionPreferences((s) => s.record);
	useEffect(() => {
		if (!busy.current && !held) setRows(reactions);
	}, [reactions, held]);
	const choose = async (emoji: string) => {
		if (held || busy.current || disabled) return;
		const previous = rows;
		const active = !rows.some((r) => r.emoji === emoji && r.reacted_by_me);
		busy.current = true;
		setPending(true);
		setError(false);
		setRows(toggleReaction(rows, emoji));
		try {
			const answer = await toggle(
				conversationId,
				messageId,
				emoji,
				active,
				tenantId,
				accountId,
			);
			setRows(answer.reactions);
			if (active) record(accountId, emoji);
		} catch {
			setRows(previous);
			setError(true);
		} finally {
			busy.current = false;
			setPending(false);
		}
	};
	return {
		accountId,
		rows: held ? EMPTY_REACTIONS : rows,
		pending: held ? false : pending,
		error: held ? false : error,
		disabled: disabled || held,
		unavailable: held || disabled || pending,
		choose,
	};
}
export type TeamBridgeReactionState = ReturnType<
	typeof useTeamBridgeReactionState
>;

/**
 * The emoji picker in its popover, anchored to whatever `children` is (the
 * chips' `+`, or the message toolbar's react button). Radix returns focus to
 * that trigger on close, so the caller's control is where the reader lands.
 */
type TeamBridgeReactionPickerProps = {
	state: TeamBridgeReactionState;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: ReactElement;
};

/**
 * THE HOLD AT THE PICKER'S FRONT DOOR. The story/rig export is guarded before
 * the body renders, so a direct mount cannot reach the emoji grid.
 */
export function TeamBridgeReactionPicker(props: TeamBridgeReactionPickerProps) {
	if (!TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD) return null;
	return <TeamBridgeReactionPickerBody {...props} />;
}

function TeamBridgeReactionPickerBody({
	state,
	open,
	onOpenChange,
	children,
}: TeamBridgeReactionPickerProps) {
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger asChild>{children}</PopoverTrigger>
			<PopoverContent
				className="max-h-[var(--radix-popover-content-available-height)] w-auto overflow-y-auto p-3"
				align="start"
				side="top"
				collisionPadding={8}
				avoidCollisions
			>
				<TeamBridgeEmojiPicker
					disabled={state.unavailable}
					accountId={state.accountId}
					onSelect={(emoji) => void state.choose(emoji)}
					onClose={() => onOpenChange(false)}
				/>
			</PopoverContent>
		</Popover>
	);
}

/**
 * The in-flow reaction chips under a message body, plus the `+` that sits
 * beside them once a message HAS reactions (Slack's placement).
 *
 * A message with no reactions renders NOTHING here: its add-reaction entry is
 * the message toolbar's react button. This component used to draw its own
 * hover-revealed toolbar in that case, which sat top-right on the row exactly
 * where the thread reply tool sat; the two overlapped once #1304 and #1308
 * met (the stack-integration finding), so the row now has one toolbar.
 */
type TeamBridgeReactionChipsProps = {
	state: TeamBridgeReactionState;
	defaultOpen?: boolean;
};

/**
 * THE HOLD AT THE CHIPS' FRONT DOOR: no hook runs while the constant is false,
 * so even a direct mount (a story, a rig, a future call site) renders nothing.
 */
export function TeamBridgeReactionChips(props: TeamBridgeReactionChipsProps) {
	if (!TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD) return null;
	return <TeamBridgeReactionChipsBody {...props} />;
}

function TeamBridgeReactionChipsBody({
	state,
	defaultOpen = false,
}: TeamBridgeReactionChipsProps) {
	const descriptionId = useId();
	const locale = useI18nLocale();
	const [open, setOpen] = useState(defaultOpen);
	const { rows, error, pending, unavailable } = state;
	if (!rows.length && !error) return null;
	return (
		<div
			className="mt-1 flex flex-wrap items-center gap-1"
			aria-busy={pending}
			data-reaction-layout="chips"
		>
			{rows.map((reaction, index) => (
				<Tooltip
					key={reaction.emoji}
					content={reaction.sample_labels.join(", ")}
				>
					<button
						key={reaction.emoji}
						type="button"
						disabled={unavailable}
						aria-pressed={reaction.reacted_by_me}
						title={reaction.sample_labels.join(", ")}
						aria-label={`${EMOJI_NAMES.get(reaction.emoji) ?? reaction.emoji} ${new Intl.NumberFormat(locale).format(reaction.count)}`}
						aria-describedby={
							reaction.sample_labels.length
								? `${descriptionId}-${index}`
								: undefined
						}
						onClick={() => void state.choose(reaction.emoji)}
						className={cn(
							"inline-flex min-h-7 items-center gap-1 rounded-full border border-control px-2 text-[12px] disabled:text-ink-dim",
							reaction.reacted_by_me
								? "bg-accent-wash text-accent"
								: "bg-sunken text-ink-muted hover:bg-row-hover",
						)}
					>
						<span
							className={
								canRenderEmoji(reaction.emoji)
									? "text-[16px]"
									: "max-w-40 truncate"
							}
						>
							{canRenderEmoji(reaction.emoji)
								? reaction.emoji
								: (EMOJI_NAMES.get(reaction.emoji) ??
									`U+${reaction.emoji.codePointAt(0)?.toString(16).toUpperCase()}`)}
						</span>
						{pending && <Spinner size="xs" />}
						<span>{reaction.count}</span>
						<span id={`${descriptionId}-${index}`} className="sr-only">
							{reaction.sample_labels.join(", ")}
						</span>
					</button>
				</Tooltip>
			))}
			{!state.disabled && rows.length > 0 && (
				<TeamBridgeReactionPicker
					state={state}
					open={open}
					onOpenChange={setOpen}
				>
					<button
						type="button"
						disabled={unavailable}
						aria-label={t("ui.teamBridge.reactions.add")}
						className="inline-flex min-h-7 items-center gap-1 rounded-full bg-sunken px-2 text-ink-muted hover:bg-row-hover"
					>
						<Plus size={14} />
					</button>
				</TeamBridgeReactionPicker>
			)}
			{error && (
				<span role="alert" className="text-[12px] text-danger">
					{t("ui.teamBridge.reactions.failed")}
				</span>
			)}
		</div>
	);
}

/** Standalone chips for one message (stories and component tests): the state
 * hook and the chips, without a message row or its toolbar. */
export function TeamBridgeReactions(props: Props) {
	if (!TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD) return null;
	return <TeamBridgeReactionsBody {...props} />;
}

function TeamBridgeReactionsBody({ defaultOpen = false, ...props }: Props) {
	const state = useTeamBridgeReactionState(props);
	return <TeamBridgeReactionChips state={state} defaultOpen={defaultOpen} />;
}
