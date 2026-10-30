import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Bot } from "lucide-react";
import type { CSSProperties, FC } from "react";
import { useEffect, useRef } from "react";
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
 * ~8 rows show (`MAX_HEIGHT`), then the list scrolls, and the active row is
 * kept in view on every move.
 */
const ROW_PX = 44;
const HEADER_PX = 26;
const MAX_HEIGHT = ROW_PX * 8 + HEADER_PX * 2;

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
				size={28}
				className="size-7 rounded-md text-[12px]"
				fallback={row.kind === "agent" ? fallback : undefined}
			/>
		);
	return (
		<span
			aria-hidden="true"
			className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-media-surface font-medium text-[12px] text-ink-muted"
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
	/** Viewport position: the popover's bottom-left sits at this point. */
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
	useEffect(() => {
		const node = list.current?.querySelector<HTMLElement>(
			`#${CSS.escape(mentionOptionId(listboxId, active))}`,
		);
		// jsdom has no layout and no scrollIntoView; a browser has both.
		node?.scrollIntoView?.({ block: "nearest" });
	}, [active, listboxId]);

	const empty = sections.length === 0;
	let index = -1;
	const style: CSSProperties | undefined =
		inline || !position
			? undefined
			: {
					position: "fixed",
					left: Math.max(8, position.left),
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
				style={{ maxHeight: MAX_HEIGHT }}
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
								className="px-3 pt-1.5 pb-0.5 font-medium text-[11px] text-ink-dim uppercase tracking-wide"
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
										style={{ minHeight: ROW_PX }}
										className={cn(
											"mx-1 flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1",
											selected ? "bg-accent-wash" : "",
										)}
									>
										<MentionRowAvatar row={row} />
										<span className="flex min-w-0 flex-1 flex-col">
											<span className="truncate text-[13px] text-ink">
												{row.label}
											</span>
											{row.secondary && (
												<span className="truncate text-[12px] text-ink-muted">
													{row.secondary}
												</span>
											)}
										</span>
										{tag && (
											<span className="shrink-0 text-[11px] text-ink-dim">
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
