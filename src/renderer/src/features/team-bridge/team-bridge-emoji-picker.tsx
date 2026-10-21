import { t } from "@shared/i18n";
import { useId, useMemo, useRef, useState } from "react";
import {
	EMOJI_ENTRIES,
	EMOJI_GROUPS,
	frequentEmoji,
	searchEmoji,
	tonedEmoji,
} from "./team-bridge-emoji-model";
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

/** Offline Unicode/CLDR data, 53 KB gzip. A virtual table renders at most 10 rows for the whole
 * 3963-sequence corpus. Search retains mixed-tone variants; preference changes selection only. */
export function TeamBridgeEmojiPicker({
	accountId,
	onSelect,
	onClose,
}: {
	accountId: string;
	onSelect: (emoji: string) => void;
	onClose: () => void;
}) {
	const id = useId();
	const preferences = useReactionPreferences((s) => s.accounts[accountId]);
	const setTone = useReactionPreferences((s) => s.setTone);
	const [query, setQuery] = useState("");
	const [group, setGroup] = useState<number | null>(null);
	const [active, setActive] = useState(0);
	const [top, setTop] = useState(0);
	const scroll = useRef<HTMLDivElement>(null);
	const grid = useRef<HTMLTableElement>(null);
	const entries = useMemo(() => searchEmoji(query, group), [query, group]);
	const frequent = frequentEmoji(preferences?.usage ?? {}, Date.now());
	const tone = preferences?.tone ?? 0;
	const select = (emoji: string) => {
		onSelect(query ? emoji : tonedEmoji(emoji, tone));
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
		<div className="w-80 max-w-[calc(100vw-32px)] space-y-2">
			<input
				aria-label={t("ui.teamBridge.reactions.search")}
				placeholder={t("ui.teamBridge.reactions.search")}
				className="h-9 w-full rounded-md border border-control bg-surface px-3 text-ink"
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
			<div
				className="flex items-center justify-between gap-1"
				role="tablist"
				aria-label={t("ui.teamBridge.reactions.categories")}
			>
				<button
					type="button"
					role="tab"
					aria-selected={group === null}
					aria-label={t("ui.teamBridge.reactions.all")}
					className="rounded px-1.5 py-1 hover:bg-row-hover aria-selected:bg-accent-wash"
					onClick={() => {
						setGroup(null);
						reset();
					}}
				>
					∗
				</button>
				{EMOJI_GROUPS.map((name, index) => (
					<button
						key={name}
						type="button"
						role="tab"
						aria-selected={group === index}
						title={t(CATEGORY_KEYS[index])}
						aria-label={t(CATEGORY_KEYS[index])}
						className="rounded px-1 py-1 hover:bg-row-hover aria-selected:bg-accent-wash"
						onClick={() => {
							setGroup(index);
							reset();
						}}
					>
						{GROUP_ICONS[index]}
					</button>
				))}
			</div>
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
						onClick={() => select(emoji)}
					>
						{tonedEmoji(emoji, tone)}
					</button>
				))}
			</div>
			<div
				ref={scroll}
				className="overflow-y-auto rounded bg-surface"
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
																onClick={() => select(entry.emoji)}
															>
																{entry.emoji}
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
			<p className="truncate text-[12px] text-ink-muted" aria-live="polite">
				{entries[active]?.name ?? "\u00a0"}
			</p>
		</div>
	);
}
