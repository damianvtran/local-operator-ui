import { TeamBridgeApi } from "@shared/api/local-operator/team-bridge-api";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@shared/components/ui/popover";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { Plus, SmilePlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TeamBridgeReaction } from "../../../../shared/team-bridge-contract";
import { toggleReaction } from "./team-bridge-emoji-model";
import { TeamBridgeEmojiPicker } from "./team-bridge-emoji-picker";
import { useReactionPreferences } from "./team-bridge-reaction-preferences";

// A stable empty snapshot matters: a new [] default on every render retriggers
// synchronization after setRows and loops on messages with no reactions.
const EMPTY_REACTIONS: TeamBridgeReaction[] = [];

type Props = {
	conversationId: string;
	messageId: string;
	accountId: string;
	tenantId?: string;
	reactions?: TeamBridgeReaction[];
	disabled?: boolean;
	toggle?: typeof TeamBridgeApi.react;
};
/** One in-flight toggle per message prevents two snapshots racing on rollback. Server summaries
 * replace optimism on success; refusal restores the exact previous row and exposes a retry cue.
 * A polling answer arriving during the write cannot overwrite the pending optimistic projection. */
export function TeamBridgeReactions({
	conversationId,
	messageId,
	accountId,
	tenantId,
	reactions = EMPTY_REACTIONS,
	disabled = false,
	toggle = TeamBridgeApi.react,
}: Props) {
	const [rows, setRows] = useState(reactions);
	const [open, setOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState(false);
	const busy = useRef(false);
	const record = useReactionPreferences((s) => s.record);
	useEffect(() => {
		if (!busy.current) setRows(reactions);
	}, [reactions]);
	const choose = async (emoji: string) => {
		if (busy.current || disabled) return;
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
	const unavailable = disabled || pending;
	return (
		<div className="mt-1 flex flex-wrap items-center gap-1" aria-busy={pending}>
			{rows.map((reaction) => (
				<button
					key={reaction.emoji}
					type="button"
					disabled={unavailable}
					aria-pressed={reaction.reacted_by_me}
					title={reaction.sample_labels.join(", ")}
					aria-label={`${reaction.emoji} ${reaction.count}`}
					onClick={() => void choose(reaction.emoji)}
					className={cn(
						"inline-flex min-h-7 items-center gap-1 rounded-full border border-control px-2 text-[12px] disabled:text-ink-dim",
						reaction.reacted_by_me
							? "bg-accent-wash text-accent"
							: "bg-sunken text-ink-muted hover:bg-row-hover",
					)}
				>
					<span className="text-[16px]">{reaction.emoji}</span>
					<span>{reaction.count}</span>
				</button>
			))}
			{!disabled && (
				<Popover open={open} onOpenChange={setOpen}>
					<PopoverTrigger asChild>
						<button
							type="button"
							disabled={unavailable}
							aria-label={t("ui.teamBridge.reactions.add")}
							className={cn(
								"inline-flex min-h-7 items-center gap-1 rounded-full px-2 text-ink-muted hover:bg-row-hover focus-visible:opacity-100",
								rows.length
									? "bg-sunken"
									: "opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100",
							)}
						>
							{rows.length ? <Plus size={14} /> : <SmilePlus size={15} />}
						</button>
					</PopoverTrigger>
					<PopoverContent className="w-auto p-3" align="start">
						<TeamBridgeEmojiPicker
							disabled={unavailable}
							accountId={accountId}
							onSelect={(emoji) => void choose(emoji)}
							onClose={() => setOpen(false)}
						/>
					</PopoverContent>
				</Popover>
			)}
			{error && (
				<span role="alert" className="text-[12px] text-danger">
					{t("ui.teamBridge.reactions.failed")}
				</span>
			)}
		</div>
	);
}
