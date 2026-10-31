import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Bot } from "lucide-react";
import type { CSSProperties, FC } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { personInitial } from "../team-bridge-model";
import { TeamBridgeAvatar } from "../team-bridge-profile-card";
import type { MentionCandidateRow } from "./candidates";
import type { MentionSection, MentionSectionId } from "./matcher";

/**
 * The @-mention popover: a listbox of people and agents, Slack's shape.
 *
 * WHY NOT THE RADIX POPOVER. Radix's popover owns focus (it moves it into the
 * content and traps it), and here focus must STAY in the textarea: the reader
 * keeps typing to filter, and ↑/↓/Enter are routed by the composer's key
 * handler. So this is a plain portal with the WAI-ARIA combobox wiring
 * (`aria-activedescendant` on the field, `role=option` rows), positioned at
 * the caret by the caller. Row presses use `onMouseDown` + `preventDefault`
 * so a click never blurs the field before it inserts.
 *
 * ~8 rows show (measured cap, below), then the list scrolls, and the active row is
 * kept in view on every move.
 */
/*
 * THE 8-ROW CAP IS MEASURED, NOT ASSUMED (design D8). A two-line row renders
 * 46.74px and a section header 25.05px (design round 1, `browser styles`), so
 * the old 44px constant capped the list at ~6 rows once all four headers were
 * present. The cap is now taken from the first rendered row and header, with
 * these as the first-frame fallback. ONE header is reserved, not one per
 * section: headers scroll with their rows, so a per-section allowance turned
 * the cap into ~10 rows once the list scrolled past them.
 */
/*
 * Every row is `min-h-12` (48px), above the 46.74px a two-line row needs, so
 * one- and two-line rows are the SAME height and "8 rows" means 8 whichever
 * mix is on screen (a single-line row used to be shorter, and the cap then
 * showed ~11).
 */
const ROW_FALLBACK_PX = 48;
const HEADER_FALLBACK_PX = 26;
const VISIBLE_ROWS = 8;

const SECTION_COPY: Record<
	MentionSectionId,
	| "ui.teamBridge.mentions.section.member_human"
	| "ui.teamBridge.mentions.section.member_agent"
	| "ui.teamBridge.mentions.section.org_human"
	| "ui.teamBridge.mentions.section.org_agent"
> = {
	"member-human": "ui.teamBridge.mentions.section.member_human",
	"member-agent": "ui.teamBridge.mentions.section.member_agent",
	"org-human": "ui.teamBridge.mentions.section.org_human",
	"org-agent": "ui.teamBridge.mentions.section.org_agent",
};

export function mentionOptionId(listboxId: string, index: number): string {
	return `${listboxId}-option-${index}`;
}

export const MentionRowAvatar: FC<{ row: MentionCandidateRow }> = ({ row }) => {
	const fallback =
		row.kind === "agent" ? (
			<Bot size={14} aria-hidden="true" />
		) : (
			personInitial(row.label)
		);
	if (row.profile)
		return (
			<TeamBridgeAvatar
				member={row.profile}
				label={row.label}
				/* The plate needs the KIND, not a name, to know whether it may draw
				   a picture at all: an agent's directory row is its owner's, so
				   resolving by account would show the owner's photo (the 2026-10-30
				   defect). `row.kind` is the row's own identity. */
				kind={row.kind}
				size={28}
				className="size-7 rounded-md text-meta"
				fallback={row.kind === "agent" ? fallback : undefined}
			/>
		);
	return (
		<span
			aria-hidden="true"
			className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-media-surface font-medium text-meta text-ink-muted"
		>
			{fallback}
		</span>
	);
};

export type MentionPopoverProps = {
	listboxId: string;
	sections: readonly MentionSection[];
	active: number;
	query: string;
	onActive: (index: number) => void;
	onPick: (row: MentionCandidateRow) => void;
	/**
	 * Viewport position, already clamped to both edges by the caller: the
	 * popover's bottom edge and its LEFT edge (in LTR the `@` side; in RTL the
	 * caller has already subtracted the width so the right edge meets the `@`).
	 */
	position: { left: number; bottom: number } | null;
	/** Story/test: render in place instead of a fixed portal. */
	inline?: boolean;
};

export const MentionPopover: FC<MentionPopoverProps> = ({
	listboxId,
	sections,
	active,
	query,
	onActive,
	onPick,
	position,
	inline = false,
}) => {
	useI18nLocale();
	const list = useRef<HTMLDivElement>(null);

	const empty = sections.length === 0;
	const [metrics, setMetrics] = useState({
		row: ROW_FALLBACK_PX,
		header: HEADER_FALLBACK_PX,
	});
	useLayoutEffect(() => {
		const node = list.current;
		const row = node?.querySelector<HTMLElement>('[role="option"]');
		const header = node?.querySelector<HTMLElement>("[data-mention-header]");
		const next = {
			row: row?.offsetHeight || ROW_FALLBACK_PX,
			header: header?.offsetHeight || HEADER_FALLBACK_PX,
		};
		if (next.row !== metrics.row || next.header !== metrics.header)
			setMetrics(next);
	});
	const maxHeight = metrics.row * VISIBLE_ROWS + metrics.header + 8;
	// Re-run when the measured cap changes too: the first frame scrolls
	// against the fallback height and would leave the active row clipped.
	// biome-ignore lint/correctness/useExhaustiveDependencies: maxHeight is a re-scroll trigger.
	useEffect(() => {
		const node = list.current?.querySelector<HTMLElement>(
			`#${CSS.escape(mentionOptionId(listboxId, active))}`,
		);
		// jsdom has no layout and no scrollIntoView; a browser has both.
		node?.scrollIntoView?.({ block: "nearest" });
	}, [active, listboxId, maxHeight]);
	let index = -1;
	const style: CSSProperties | undefined =
		inline || !position
			? undefined
			: {
					position: "fixed",
					left: position.left,
					bottom: position.bottom,
				};
	const panel = (
		<div
			data-mention-popover=""
			style={style}
			className={cn(
				"z-50 w-[min(22rem,calc(100vw-16px))] overflow-hidden rounded-md border border-hairline bg-elevated shadow-lg",
			)}
		>
			<div
				ref={list}
				id={listboxId}
				/* biome-ignore lint/a11y/useSemanticElements: the combobox's own popup; a native `<select>` cannot express `aria-activedescendant` or headed groups (same as settings-search). */
				role="listbox"
				tabIndex={-1}
				aria-label={t("ui.teamBridge.mentions.listbox_label")}
				style={{ maxHeight }}
				className="overflow-y-auto py-1"
			>
				{empty ? (
					<div className="px-3 py-2 text-body-sm text-ink-muted">
						{t("ui.teamBridge.mentions.empty", { query })}
					</div>
				) : (
					sections.map((section) => (
						<div
							key={section.id}
							/* biome-ignore lint/a11y/useSemanticElements: a `<fieldset>` is a form construct; this is a labelled group of options inside a listbox. */
							role="group"
							aria-label={t(SECTION_COPY[section.id])}
						>
							<div
								aria-hidden="true"
								data-mention-header=""
								/* Sentence case, like the rail's own section headers (N1). */
								className="px-3 pt-1.5 pb-0.5 font-medium text-meta text-ink-dim"
							>
								{t(SECTION_COPY[section.id])}
							</div>
							{section.rows.map((raw) => {
								const row = raw as MentionCandidateRow;
								index += 1;
								const at = index;
								const selected = at === active;
								const tag = row.bridgeOff
									? t("ui.teamBridge.mentions.tag.bridge_off")
									: row.invited
										? t("ui.teamBridge.members.state.invited_short")
										: !row.member
											? t("ui.teamBridge.mentions.tag.not_member")
											: null;
								return (
									/* biome-ignore lint/a11y/useFocusableInteractive lint/a11y/useKeyWithClickEvents: options are never DOM-focused (the field keeps focus and names this id via aria-activedescendant), and every key path is the field's handler, so the click is pointer-only. */
									<div
										key={`${row.kind}:${row.accountId}`}
										id={mentionOptionId(listboxId, at)}
										/* biome-ignore lint/a11y/useSemanticElements: `<option>` cannot hold an avatar and a two-line row. */
										role="option"
										aria-selected={selected}
										data-mention-option={`${row.kind}:${row.accountId}`}
										onMouseMove={() => {
											if (!selected) onActive(at);
										}}
										onMouseDown={(event) => {
											// Keep focus (and the caret) in the field.
											event.preventDefault();
										}}
										onClick={() => onPick(row)}
										className={cn(
											"relative mx-1 flex min-h-12 cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1",
											selected
												? cn(
														"bg-accent-wash",
														/*
														 * The wash alone measures 1.13-1.14:1 against the
														 * popover (design D1), so the row Enter inserts also
														 * carries the app's 2px accent bar (at-picker,
														 * slash-commands). LOGICAL inset: the bar sits on the
														 * leading edge, the right one in Urdu.
														 */
														"before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:rounded-full before:bg-accent",
													)
												: "",
										)}
									>
										<MentionRowAvatar row={row} />
										<span className="flex min-w-0 flex-1 flex-col">
											<span className="truncate text-body-sm text-ink">
												{row.label}
											</span>
											{row.secondary && (
												<span className="truncate text-meta text-ink-muted">
													{row.secondary}
												</span>
											)}
										</span>
										{tag && (
											<span className="shrink-0 text-meta-sm text-ink-dim">
												{tag}
											</span>
										)}
									</div>
								);
							})}
						</div>
					))
				)}
			</div>
		</div>
	);
	if (inline || typeof document === "undefined") return panel;
	return createPortal(panel, document.body);
};
