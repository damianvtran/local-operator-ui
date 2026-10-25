import { Spinner } from "@shared/components/common/spinner";
import { t } from "@shared/i18n";
import { Grid2X2 } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import {
	EMOJI_ENTRIES,
	EMOJI_GROUPS,
	frequentEmoji,
	searchEmoji,
	tonedEmoji,
} from "./team-bridge-emoji-model";
import { canRenderEmoji } from "./team-bridge-emoji-support";
import { TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD } from "./team-bridge-reaction-gate";
import { useReactionPreferences } from "./team-bridge-reaction-preferences";

const COLUMNS = 8;
const CELL = 36;
const HEIGHT = 252;
const GROUP_ICONS = ["😀", "👋", "🐻", "🍎", "🌍", "⚽", "💡", "🔣", "🏳️"];
const CATEGORY_KEYS = [
	"ui.teamBridge.reactions.category0",
	"ui.teamBridge.reactions.category1",
	"ui.teamBridge.reactions.category2",
	"ui.teamBridge.reactions.category3",
	"ui.teamBridge.reactions.category4",
	"ui.teamBridge.reactions.category5",
	"ui.teamBridge.reactions.category6",
	"ui.teamBridge.reactions.category7",
	"ui.teamBridge.reactions.category8",
] as const;

// A supported base does not guarantee its tone variant is joined on an older font.
function supportedTone(emoji: string, tone: number): string {
	const variant = tonedEmoji(emoji, tone);
	return canRenderEmoji(variant) ? variant : emoji;
}

/** Offline Unicode/CLDR data, 53 KB gzip. A virtual table renders at most 10 rows for the whole
 * 3963-sequence corpus. Search retains mixed-tone variants; preference changes selection only. */
type TeamBridgeEmojiPickerProps = {
	accountId: string;
	onSelect: (emoji: string) => void;
	onClose: () => void;
	disabled?: boolean;
	initialQuery?: string;
};

/**
 * THE HOLD AT THE GRID'S FRONT DOOR. No hook runs while the constant is false,
 * so the picker is unreachable even from a direct mount or a future call site
 * that bypasses the reaction views.
 */
export function TeamBridgeEmojiPicker(props: TeamBridgeEmojiPickerProps) {
	if (!TEAM_BRIDGE_REACTIONS_SHIPPED_IN_THIS_BUILD) return null;
	return <TeamBridgeEmojiPickerBody {...props} />;
}

function TeamBridgeEmojiPickerBody({
	accountId,
	onSelect,
	onClose,
	disabled = false,
	initialQuery = "",
}: TeamBridgeEmojiPickerProps) {
	const id = useId();
	const preferences = useReactionPreferences((s) => s.accounts[accountId]);
	const setTone = useReactionPreferences((s) => s.setTone);
	const [query, setQuery] = useState(initialQuery);
	const [group, setGroup] = useState<number | null>(null);
	const [active, setActive] = useState(0);
	const [top, setTop] = useState(0);
	const scroll = useRef<HTMLDivElement>(null);
	const grid = useRef<HTMLTableElement>(null);
	// Keep the full wire corpus, but only offer glyphs this renderer actually paints. The
	// per-glyph probe caches across popover mounts; filtering never changes the server allowlist.
	const entries = useMemo(
		() =>
			searchEmoji(query, group).filter((entry) => canRenderEmoji(entry.emoji)),
		[query, group],
	);
	const frequent = frequentEmoji(preferences?.usage ?? {}, Date.now()).filter(
		canRenderEmoji,
	);
	const tone = preferences?.tone ?? 0;
	const select = (emoji: string) => {
		if (disabled) return;
		onSelect(supportedTone(emoji, tone));
		onClose();
	};
	const reset = () => {
		setActive(0);
		setTop(0);
		if (scroll.current) scroll.current.scrollTop = 0;
	};
	const startRow = Math.max(0, Math.floor(top / CELL) - 1);
	const endRow = Math.min(
		Math.ceil(entries.length / COLUMNS),
		startRow + Math.ceil(HEIGHT / CELL) + 3,
	);
	return (
		<div
			className="flex min-h-0 w-80 max-w-[calc(100vw-32px)] flex-col gap-2"
			style={{
				maxHeight:
					"calc(var(--radix-popover-content-available-height, 560px) - 24px)",
			}}
			aria-busy={disabled}
		>
			<input
				aria-label={t("ui.teamBridge.reactions.search")}
				placeholder={t("ui.teamBridge.reactions.search")}
				className="h-9 w-full rounded-md border border-control bg-surface px-3 text-ink outline-offset-0 shrink-0"
				value={query}
				onChange={(event) => {
					setQuery(event.target.value);
					setGroup(null);
					reset();
				}}
				onKeyDown={(event) => {
					if (event.key === "ArrowDown") {
						event.preventDefault();
						grid.current
							?.querySelector<HTMLButtonElement>(
								`button[data-index="${active}"]`,
							)
							?.focus();
					}
				}}
			/>
			<fieldset className="flex shrink-0 items-center justify-between gap-1">
				<legend className="sr-only">
					{t("ui.teamBridge.reactions.categories")}
				</legend>
				<button
					type="button"
					aria-pressed={group === null}
					aria-label={t("ui.teamBridge.reactions.all")}
					className="flex min-h-8 min-w-6 items-center justify-center rounded px-1.5 py-1 hover:bg-row-hover aria-pressed:bg-accent-wash"
					onClick={() => {
						setGroup(null);
						reset();
					}}
				>
					<Grid2X2 size={16} />
				</button>
				{EMOJI_GROUPS.map((name, index) => (
					<button
						key={name}
						type="button"
						aria-pressed={group === index}
						title={t(CATEGORY_KEYS[index])}
						aria-label={t(CATEGORY_KEYS[index])}
						className="min-h-8 min-w-6 rounded px-1 py-1 hover:bg-row-hover aria-pressed:bg-accent-wash"
						onClick={() => {
							setGroup(index);
							reset();
						}}
					>
						{GROUP_ICONS[index]}
					</button>
				))}
			</fieldset>
			<div className="flex items-center justify-between gap-2">
				<span className="text-[12px] text-ink-muted">
					{t("ui.teamBridge.reactions.frequent")}
				</span>
				<select
					aria-label={t("ui.teamBridge.reactions.tone")}
					value={tone}
					onChange={(event) => setTone(accountId, Number(event.target.value))}
					className="h-7 rounded border border-control bg-surface text-[12px] text-ink"
				>
					<option value={0}>{t("ui.teamBridge.reactions.toneDefault")}</option>
					{[1, 2, 3, 4, 5].map((n) => (
						<option key={n} value={n}>
							{String.fromCodePoint(0x1f44d, 0x1f3fa + n)}
						</option>
					))}
				</select>
			</div>
			<div
				className="grid grid-cols-8"
				aria-label={t("ui.teamBridge.reactions.frequent")}
			>
				{frequent.map((emoji) => (
					<button
						key={emoji}
						type="button"
						title={EMOJI_ENTRIES.find((e) => e.emoji === emoji)?.name ?? emoji}
						className="h-9 rounded text-[22px] hover:bg-row-hover"
						disabled={disabled}
						onClick={() => select(emoji)}
					>
						{supportedTone(emoji, tone)}
					</button>
				))}
			</div>
			<div
				ref={scroll}
				className="min-h-0 flex-shrink overflow-y-auto rounded bg-surface"
				style={{ height: HEIGHT }}
				onScroll={(event) => setTop(event.currentTarget.scrollTop)}
			>
				{!entries.length ? (
					<p className="p-4 text-ink-muted">
						{t("ui.teamBridge.reactions.noResults")}
					</p>
				) : (
					<table
						ref={grid}
						aria-label={t("ui.teamBridge.reactions.choose")}
						aria-rowcount={Math.ceil(entries.length / COLUMNS)}
						aria-colcount={COLUMNS}
						className="relative block w-full"
						style={{ height: Math.ceil(entries.length / COLUMNS) * CELL }}
						onKeyDown={(event) => {
							const delta = {
								ArrowRight: 1,
								ArrowLeft: -1,
								ArrowDown: COLUMNS,
								ArrowUp: -COLUMNS,
							}[event.key];
							if (delta !== undefined) {
								event.preventDefault();
								const next = Math.max(
									0,
									Math.min(entries.length - 1, active + delta),
								);
								setActive(next);
								requestAnimationFrame(() =>
									grid.current
										?.querySelector<HTMLButtonElement>(
											`button[data-index="${next}"]`,
										)
										?.focus(),
								);
								const rowTop = Math.floor(next / COLUMNS) * CELL;
								if (scroll.current && (rowTop < top || rowTop >= top + HEIGHT))
									scroll.current.scrollTop = Math.max(0, rowTop - HEIGHT / 2);
							} else if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								select(entries[active].emoji);
							}
						}}
					>
						<tbody className="block">
							{Array.from(
								{ length: Math.max(0, endRow - startRow) },
								(_, offset) => {
									const row = startRow + offset;
									return (
										<tr
											key={row}
											aria-rowindex={row + 1}
											className="absolute inset-x-0 grid grid-cols-8"
											style={{ top: row * CELL, height: CELL }}
										>
											{entries
												.slice(row * COLUMNS, (row + 1) * COLUMNS)
												.map((entry, column) => {
													const index = row * COLUMNS + column;
													return (
														<td
															key={entry.emoji}
															id={`${id}-${index}`}
															data-active={active === index}
															aria-colindex={column + 1}
														>
															<button
																tabIndex={active === index ? 0 : -1}
																data-index={index}
																type="button"
																aria-label={entry.name}
																title={entry.name}
																className={
																	active === index
																		? "h-9 w-full rounded bg-accent-wash text-[22px]"
																		: "h-9 w-full rounded text-[22px] hover:bg-row-hover"
																}
																onMouseEnter={() => setActive(index)}
																disabled={disabled}
																onClick={() => select(entry.emoji)}
															>
																{supportedTone(entry.emoji, tone)}
															</button>
														</td>
													);
												})}
										</tr>
									);
								},
							)}
						</tbody>
					</table>
				)}
			</div>
			<p
				className="flex min-h-5 shrink-0 items-center gap-2 truncate text-[12px] text-ink-muted"
				aria-live="polite"
			>
				{disabled && <Spinner size="xs" />}
				{entries[active]?.name ?? "\u00a0"}
			</p>
		</div>
	);
}
