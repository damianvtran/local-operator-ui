/**
 * The New chat header's agent/team chip: who will answer this conversation,
 * chosen before the first send.
 *
 * WHAT IT IS FOR (operator request, 2026-11-11): "make it so that new chat also
 * allows for the selection of agent/team" - the pane's header held only the
 * device chip, so choosing an identity meant finding the sidebar's teams list
 * or knowing `/agent` `/team`. This chip is that choice where the reader is
 * already looking. The rules (when it shows, what it lists, what a pick does)
 * are `chat-header-draft-target-model.ts`; this file maps them onto pixels.
 *
 * ONE ACT, THREE DOORS. A pick re-stages the pane's draft through
 * `restageDraft` - the store action the `/agent` `/team` draft route and the
 * picker dialog's draft mode already call - so the composer's text moves across
 * the key flip, the draft title reads "New chat with …" from the same `target`,
 * and the first send's `sessions.create` carries it. Arriving from the sidebar's
 * "New chat with <team>" stages the same field, so the chip simply reads it.
 *
 * THE DEVICE CHIP'S SIBLING, BY CONSTRUCTION. Same 20px `rounded-xs` geometry,
 * same zero-width baseline carrier, same `DropdownMenu` idiom (arrow keys,
 * typeahead, Escape returns focus to the trigger) - `chat-header-device.tsx`
 * carries the measurements behind each of those choices. It sits before the
 * device chip because identity precedes placement on a live header too.
 */

import type { DesktopCapabilities } from "@shared/api/local-operator/desktop-api";
import { desktopFeatureEnabled } from "@shared/api/local-operator/desktop-hooks";
import {
	type ChatTarget,
	useProfiles,
	useTeams,
} from "@shared/api/local-operator/profile-hooks";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { Bot, Check, ChevronDown, Users } from "lucide-react";
import { type FC, type ReactNode, useMemo, useState } from "react";
import { errorText } from "../pickers/use-picker-backend";
import {
	type DraftTargetRow,
	draftTargetIsCurrent,
	draftTargetLabel,
	draftTargetPick,
	draftTargetRoster,
} from "./chat-header-draft-target-model";

export type ChatHeaderDraftTargetProps = {
	/** The draft row's staged identity; absent means the default agent. */
	target?: ChatTarget;
	/** The capabilities document, for the two catalogue gates. */
	capabilities?: DesktopCapabilities | null;
	/**
	 * A send is in flight from this draft. Re-staging now would flip the key the
	 * admission is finishing under, so the chip stands down instead.
	 */
	busy?: boolean;
};

/** One section's state rows: loading, a load failure, or an empty roster. */
const SectionState: FC<{ children: ReactNode; tone?: "danger" }> = ({
	children,
	tone,
}) => (
	<p
		className={cn(
			"px-2 py-1.5 text-meta",
			tone === "danger" ? "text-danger" : "text-ink-dim",
		)}
	>
		{children}
	</p>
);

const TargetItem: FC<{
	row: DraftTargetRow | null;
	label: string;
	current: boolean;
	onPick: () => void;
}> = ({ row, label, current, onPick }) => {
	const Glyph = row?.kind === "team" ? Users : Bot;
	return (
		<DropdownMenuItem
			data-draft-target-row={row ? `${row.kind}:${row.name}` : "default"}
			data-draft-target-current={current ? "" : undefined}
			// Typeahead matches what the row shows (a team's label, not its slug).
			textValue={label}
			onSelect={onPick}
			className="gap-2 py-1.5"
		>
			<Glyph aria-hidden="true" className="size-3.5 shrink-0 text-ink-dim" />
			<span className="min-w-0 flex-1 truncate text-body-sm">{label}</span>
			{current ? (
				<Check
					aria-hidden="true"
					className="size-3.5 shrink-0 text-ink-muted"
				/>
			) : null}
		</DropdownMenuItem>
	);
};

export const ChatHeaderDraftTarget: FC<ChatHeaderDraftTargetProps> = ({
	target,
	capabilities,
	busy = false,
}) => {
	useI18nLocale();
	const [open, setOpen] = useState(false);
	const agentsOffered = desktopFeatureEnabled(
		capabilities,
		"profile_catalogue",
	);
	const teamsOffered = desktopFeatureEnabled(capabilities, "team_catalogue");
	/*
	 * Lazy like the project start-session picker: the rosters load on the first
	 * open, except the team list a staged team needs for its label - the same
	 * query key the sidebar and the draft title already populate, so that read
	 * is a cache hit, not a request.
	 */
	const profiles = useProfiles(open && agentsOffered);
	const teams = useTeams(teamsOffered && (open || target?.kind === "team"));
	const roster = useMemo(
		() => draftTargetRoster({ profiles: profiles.data, teams: teams.data }),
		[profiles.data, teams.data],
	);
	const teamLabelFor = useMemo(() => {
		const labels = new Map(roster.teams.map((row) => [row.name, row.label]));
		return (name: string) => labels.get(name) ?? name;
	}, [roster.teams]);

	// A backend publishing neither catalogue has nothing to offer but the
	// default, and a menu of one row is a control that cannot change anything.
	if (!agentsOffered && !teamsOffered) return null;

	const label =
		draftTargetLabel(target, teamLabelFor) ??
		t("ui.chat.draft_target.default_agent");
	const sentence = t("ui.chat.draft_target.aria_label", { target: label });
	const Glyph = target?.kind === "team" ? Users : Bot;

	const pick = (row: DraftTargetRow | null) => {
		const next = draftTargetPick(target, row);
		if (!next) return;
		useCanonicalSessionsStore.getState().restageDraft(next.target);
	};

	const section = (
		kind: "agents" | "teams",
		rows: DraftTargetRow[],
		query: typeof profiles | typeof teams,
	) => (
		<>
			<DropdownMenuSeparator />
			<DropdownMenuLabel className="text-meta text-ink-dim">
				{kind === "teams"
					? t("ui.agents.pages.tab.teams")
					: t("ui.agents.pages.tab.agents")}
			</DropdownMenuLabel>
			{query.isLoading ? (
				<SectionState>
					{t("ui.chat.header_identity.loading", { kind })}
				</SectionState>
			) : query.isError ? (
				<SectionState tone="danger">{errorText(query.error)}</SectionState>
			) : rows.length === 0 ? (
				<SectionState>
					{kind === "teams"
						? t("ui.chat.pickers.destination_pickers.no_teams_are_registered")
						: t("ui.chat.pickers.destination_pickers.no_agents_are_registered")}
				</SectionState>
			) : (
				rows.map((row) => (
					<TargetItem
						key={`${row.kind}:${row.name}`}
						row={row}
						label={row.label}
						current={draftTargetIsCurrent(target, row)}
						onPick={() => pick(row)}
					/>
				))
			)}
		</>
	);

	return (
		<DropdownMenu
			modal={false}
			open={open}
			onOpenChange={(next) => setOpen(busy ? false : next)}
		>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					data-draft-target-chip={target ? target.kind : "default"}
					aria-label={sentence}
					aria-disabled={busy || undefined}
					title={sentence}
					className={cn(
						// The device chip's own contract (`chat-header-device.tsx`): `h-5`
						// and `rounded-xs` keep the title block's line height, `pe-1` pairs
						// with the zero-width carrier below.
						"inline-flex h-5 max-w-full shrink-0 cursor-pointer items-center gap-1 rounded-xs pe-1",
						"select-none whitespace-nowrap text-body-sm",
						"text-ink-muted hover:bg-row-hover hover:text-ink",
						"data-[state=open]:bg-row-hover data-[state=open]:text-ink",
						busy && "cursor-default opacity-60 hover:bg-transparent",
					)}
				>
					{/* The baseline carrier: see `ChipButton` in `chat-header-device.tsx`. */}
					<span aria-hidden="true" className="font-mono text-mono-sm">
						{"\u200b"}
					</span>
					<Glyph aria-hidden="true" className="size-3 shrink-0 text-ink-dim" />
					<span className="max-w-[24ch] truncate">{label}</span>
					<ChevronDown
						aria-hidden="true"
						className="size-3 shrink-0 text-ink-dim"
					/>
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="start"
				side="bottom"
				data-draft-target-menu=""
				className="flex max-h-[26rem] w-72 flex-col overflow-hidden"
			>
				<div className="min-h-0 flex-1 overflow-y-auto">
					<DropdownMenuLabel className="text-meta text-ink-dim">
						{t("ui.chat.draft_target.menu_heading")}
					</DropdownMenuLabel>
					<TargetItem
						row={null}
						label={t("ui.chat.draft_target.default_agent")}
						current={draftTargetIsCurrent(target, null)}
						onPick={() => pick(null)}
					/>
					{agentsOffered ? section("agents", roster.agents, profiles) : null}
					{teamsOffered ? section("teams", roster.teams, teams) : null}
				</div>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
