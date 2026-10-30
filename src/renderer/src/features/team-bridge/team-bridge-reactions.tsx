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
	/*
	 * WHICH pill the in-flight write is about. `pending` alone drew a spinner in
	 * EVERY pill (each one widening by the spinner's 14px) when only one emoji
	 * was being written; the chips need the emoji to put the busy mark on the
	 * pill the reader actually pressed (operator polish round, 2026-10-30).
	 */
	const [pendingEmoji, setPendingEmoji] = useState<string | null>(null);
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
		setPendingEmoji(emoji);
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
			setPendingEmoji(null);
		}
	};
	return {
		accountId,
		rows: held ? EMPTY_REACTIONS : rows,
		pending: held ? false : pending,
		pendingEmoji: held ? null : pendingEmoji,
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
	const { rows, error, pending, pendingEmoji, unavailable } = state;
	if (!rows.length && !error) return null;
	const whoReacted = (reaction: TeamBridgeReaction) =>
		reactorsLabel(reaction, locale);
	return (
		<div
			className="mt-1 flex flex-wrap items-center gap-1"
			aria-busy={pending}
			data-reaction-layout="chips"
		>
			{rows.map((reaction, index) => (
				/* The Tooltip is the ONE hover label: the native `title` this button
				 * used to carry drew a second, OS-styled tooltip over it after the
				 * native delay (operator polish round, 2026-10-30). */
				/* `text-balance` (design round 1, D4): a three-name list plus "and
				 * 9 others" wrapped at the tooltip's `max-w-64` with "9 others"
				 * orphaned on its own line. Balancing in CSS keeps the label string
				 * itself free of a no-break space a screen reader would also read. */
				<Tooltip
					key={reaction.emoji}
					content={whoReacted(reaction)}
					className="text-balance"
				>
					<button
						key={reaction.emoji}
						type="button"
						disabled={unavailable}
						aria-pressed={reaction.reacted_by_me}
						data-reaction-pill=""
						aria-label={`${EMOJI_NAMES.get(reaction.emoji) ?? reaction.emoji} ${new Intl.NumberFormat(locale).format(reaction.count)}`}
						aria-describedby={
							reaction.sample_labels.length
								? `${descriptionId}-${index}`
								: undefined
						}
						onClick={() => void state.choose(reaction.emoji)}
						/*
						 * BORDERLESS PILLS (operator polish round, 2026-10-30): "remove the
						 * border, subtly contrasted fill like the sidebar counts".
						 *
						 * OTHERS' REACTION wears the sidebar quiet count's fill, `elevated`
						 * (`badgeVariants` `attentionQuiet`, the borderless count mark), so
						 * the thread and the sidebar speak one count language. Its numeral
						 * is `ink-muted` rather than the badge's `ink-dim` because here the
						 * number is the content of a control, not metadata beside a label:
						 * 5.95:1 worst over the fifty-nine palettes (nightfox). Like that
						 * badge, the fill is a whisper, not a boundary: it merges with a
						 * HOVERED row in one palette (arcade, ΔE00 0.00 on `row-hover`), where
						 * the emoji and count carry the pill - the contract row "team bridge
						 * reaction pill" pins the ink and declares the edge away for that
						 * reason. Hover is a colour step to `sunken` (ΔE00 >= 6.07 off
						 * `elevated` on every palette) with the ink stepping to `ink`; it
						 * never lifts or scales.
						 *
						 * THE READER'S OWN REACTION is the brighter state: 20% `accent`
						 * mixed over `surface`, with an `ink` count at medium weight. NOT
						 * `accent-wash` (design review round 1, D1): that role sits at the
						 * ground's depth, so it measured ΔE00 2.04 / 1.01:1 against the
						 * others' `elevated` pill in tokyoNight - the operator's theme - and
						 * was darker than it in 54 of 59 palettes. The mix is accent-tinted
						 * AND apart from every neighbour: ΔE00 >= 5.83 off `elevated` (worst
						 * tokyoNight), >= 5.30 off a hovered row, `ink` >= 5.44:1 on it.
						 * The count is `ink` rather than `accent` because `accent` on a fill
						 * this tinted drops to 3.52:1. Hover steps the fill to 27% (D5:
						 * the same kind of fill step the others' pills take), `ink` >= 4.64:1.
						 * `surface` is the thread's ground; on the thread pane's `canvas`
						 * the same fill is asserted apart too. All of it lives in
						 * `REACTION_OWN_PILL` in `scripts/contrast-contract.mjs`, which
						 * mixes the fill per palette as the browser does.
						 *
						 * FIXED HEIGHT, NOT `min-h`: `h-6` (24px, the WCAG 2.5.8 target
						 * floor) on every pill and on the `+`, so a pill with a taller emoji
						 * glyph, a fallback name or a busy mark cannot grow its row. Emoji
						 * and count are `leading-none` so their line boxes are their glyph
						 * size and `items-center` centres the glyphs rather than a 1.5
						 * line-height box whose half-leading sat the emoji low.
						 */
						className={cn(
							"inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] leading-none transition-colors duration-fast ease-out-quart disabled:text-ink-dim",
							reaction.reacted_by_me
								? "bg-[color-mix(in_srgb,var(--color-accent)_20%,var(--color-surface))] font-medium text-ink hover:bg-[color-mix(in_srgb,var(--color-accent)_27%,var(--color-surface))]"
								: "bg-elevated text-ink-muted hover:bg-sunken hover:text-ink",
						)}
					>
						<span
							className={
								canRenderEmoji(reaction.emoji)
									? "text-[14px] leading-none"
									: "max-w-40 truncate"
							}
						>
							{canRenderEmoji(reaction.emoji)
								? reaction.emoji
								: (EMOJI_NAMES.get(reaction.emoji) ??
									`U+${reaction.emoji.codePointAt(0)?.toString(16).toUpperCase()}`)}
						</span>
						{/* THE BUSY MARK TAKES THE COUNT'S PLACE WITHOUT ITS ROOM: the
						    spinner is absolutely centred over the count (whose glyphs go
						    `invisible` but keep their box), so a press never changes the
						    pill's width or height and the row cannot reflow under the
						    pointer. Its 14px overhangs a one-digit count by ~3.5px each
						    side, which the `gap-1` and `px-2` absorb. Only the pressed
						    pill shows it. */}
						<span className="relative inline-flex items-center tabular-nums">
							<span
								className={cn(
									pending && pendingEmoji === reaction.emoji && "invisible",
								)}
							>
								{new Intl.NumberFormat(locale).format(reaction.count)}
							</span>
							{pending && pendingEmoji === reaction.emoji && (
								<span className="absolute inset-0 flex items-center justify-center">
									<Spinner size="xs" />
								</span>
							)}
						</span>
						<span id={`${descriptionId}-${index}`} className="sr-only">
							{whoReacted(reaction)}
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
						data-reaction-add=""
						/*
						 * A GHOST AT REST, REVEALED WITH THE ROW (operator polish round,
						 * 2026-10-30: "quieter and borderless"). The `media-surface` tile
						 * this used to wear (design round 1, D5) read as a fourth pill
						 * louder than the reactions themselves; now it is a transparent
						 * `ink-dim` glyph at the pills' 24px height that takes the pills'
						 * own `elevated` fill on hover - the same quiet-count ground, so a
						 * hovered `+` reads as "a pill you could add".
						 *
						 * THE REVEAL is the message toolbar's rule
						 * (`team-bridge-message-toolbar.tsx`), keyed on the row's own
						 * `group/message` (`team-bridge-message-list.tsx`) so this file
						 * needs no prop from the row, and shaped like
						 * `ACTION_ROW_REVEAL_CLASSES`: opacity only so revealing moves
						 * nothing, pointer-inert while invisible so a hidden control never
						 * takes a click, still in the tab order so `focus-within` reveals
						 * it for a keyboard reader, and always shown under `hover:none`
						 * where a hover can never arrive. While the picker is open it is
						 * pinned visible: it is the popover's anchor and the focus return
						 * target, and must not fade out from under the reader.
						 * `focus-visible` is the backstop for a host with no message row.
						 * Focus is the app's global `:where(:focus-visible)` outline.
						 */
						className={cn(
							/* `shrink-0` (design round 1, D3): a narrow column squeezed the
							   `+` to 14x24, under the 24px target floor. */
							"inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-transparent text-ink-dim",
							"transition-[opacity,color,background-color] duration-fast ease-out-quart",
							"hover:bg-elevated hover:text-ink disabled:text-ink-dim",
							open
								? "opacity-100"
								: "pointer-events-none opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
						)}
					>
						<Plus size={14} aria-hidden="true" />
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

/**
 * Who reacted, for a pill's tooltip and its screen-reader description.
 *
 * The contract caps `sample_labels` at three (`team-bridge-contract.ts`), so a
 * pill with a count above the sample would otherwise name three people and
 * imply that was everyone.
 *
 * THE JOIN IS `Intl.ListFormat`, NEVER A HARD-CODED ", ": each locale owns its
 * separator (zh-CN "、", ur "،"). A complete list uses `narrow` conjunction,
 * which reads "Damian Tran, Victor Tay" in en exactly as the operator asked.
 * The overflow is ONE MORE LIST ITEM - a translated ICU plural, "{n} others" -
 * joined by the `long` conjunction, so en reads "Ada, Bea, Cleo, and 9 others"
 * and es "Ada, Bea, Cleo y 9 más": the locale's own "and" lands once, in the
 * right place. Concatenating "and N others" onto a list some locales already
 * close with their conjunction would say "and" twice.
 */
/*
 * The renderer's TypeScript lib (`@electron-toolkit/tsconfig`'s web base) predates
 * ES2021, so `Intl.ListFormat` is untyped there although Chromium has shipped it
 * since 72. A narrow local type for the one constructor this file calls, rather
 * than widening the whole renderer's `lib` in a pill-polish change.
 */
type ListFormatCtor = new (
	locale: string,
	options: { style: "long" | "narrow"; type: "conjunction" },
) => { format: (items: readonly string[]) => string };
const ListFormat = (Intl as unknown as { ListFormat: ListFormatCtor })
	.ListFormat;

function reactorsLabel(reaction: TeamBridgeReaction, locale: string): string {
	const names = reaction.sample_labels;
	const others = reaction.count - names.length;
	/* No sampled name but a count (agent review round 1, R4): the tooltip
	 * still says how many, rather than going silent. */
	if (!names.length)
		return others > 0 ? t("ui.teamBridge.reactions.others", { others }) : "";
	if (others <= 0)
		return new ListFormat(locale, {
			style: "narrow",
			type: "conjunction",
		}).format(names);
	return new ListFormat(locale, {
		style: "long",
		type: "conjunction",
	}).format([...names, t("ui.teamBridge.reactions.others", { others })]);
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
