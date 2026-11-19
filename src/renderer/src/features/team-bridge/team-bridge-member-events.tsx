import { Tooltip } from "@shared/components/ui/tooltip";
import { formatDate, formatTime, t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { UserMinus, UserPlus, Users } from "lucide-react";
import type { FC } from "react";
import type {
	TeamBridgeEvent,
	TeamBridgeEventParty,
} from "../../../../shared/team-bridge-contract";
import {
	TEAM_BRIDGE_EVENT_NAMES_SHOWN,
	type TeamBridgeEventLine,
	teamBridgeEventLines,
} from "./team-bridge-member-events-model";

/**
 * A membership change in the timeline: ONE quiet line (docs/branding.md § 7 -
 * a completed action is one quiet line, not a card).
 *
 * DELIBERATELY NOT A MESSAGE ROW: no avatar, no hover toolbar, no reactions,
 * no reply, and no `data-message-id` (the read observers select on it, so an
 * event can never be "seen" as a message). Joins, leaves and removals all
 * render through this one component; only the sentence and the icon change.
 *
 * SENTENCES ARE WHOLE ICU MESSAGES. The verb, the actor and the targets sit in
 * one catalogue string per kind; the target names are joined by
 * `Intl.ListFormat` (the locale's own "and" and commas) and, past
 * `TEAM_BRIDGE_EVENT_NAMES_SHOWN`, the tail becomes an ICU-plural "N others"
 * item of that same list. Nothing concatenates translated fragments.
 *
 * A SHORTENED LIST IS STILL READABLE IN FULL: the line becomes focusable, its
 * accessible name is the full sentence with every name, and the Tooltip shows
 * the full list on hover or keyboard focus.
 */

type ListFormatter = { format: (items: string[]) => string };
/* ES2021 type this project's ES2020 `lib` does not declare (see
   `team-bridge-owner-audit.tsx`); Chromium has shipped it since 72. */
const ListFormat = (
	Intl as unknown as {
		ListFormat?: new (
			locale: string,
			options: { style: "long"; type: "conjunction" },
		) => ListFormatter;
	}
).ListFormat;

function joinNames(names: string[], locale: string): string {
	if (ListFormat)
		return new ListFormat(locale, {
			style: "long",
			type: "conjunction",
		}).format(names);
	return names.join(", ");
}

export type TeamBridgeEventLabel = (party: TeamBridgeEventParty) => string;

function sentence(
	line: TeamBridgeEventLine,
	targets: string,
	actor: string,
): string {
	if (line.ownerAddedAgent)
		return t("ui.teamBridge.events.owner_added_agent", { actor, targets });
	switch (line.kind) {
		case "invited":
			return t("ui.teamBridge.events.invited", { actor, targets });
		case "joined":
			return t("ui.teamBridge.events.joined", { targets });
		case "left":
			return t("ui.teamBridge.events.left", { targets });
		case "removed":
			return t("ui.teamBridge.events.removed", { actor, targets });
		case "consented":
			return t("ui.teamBridge.events.consented", { actor, targets });
		case "declined":
			return line.selfOnly
				? t("ui.teamBridge.events.declined_self", { actor })
				: t("ui.teamBridge.events.declined", { actor, targets });
		case "withdrawn":
			return t("ui.teamBridge.events.withdrawn", { actor, targets });
		default:
			return t("ui.teamBridge.events.unknown");
	}
}

/** The shown and full sentences for one line (exported for the node tests). */
export function teamBridgeEventSentences(
	line: TeamBridgeEventLine,
	labelFor: TeamBridgeEventLabel,
	locale: string,
): { shown: string; full: string; truncated: boolean } {
	const names = line.targets.map(labelFor);
	const actor = labelFor(line.actor);
	const truncated = names.length > TEAM_BRIDGE_EVENT_NAMES_SHOWN;
	const full = sentence(line, joinNames(names, locale), actor);
	if (!truncated) return { shown: full, full, truncated };
	/* "Ben, Sana and 2 others": the first names in full, then the plural item
	   as the list's LAST element, so the locale's own conjunction joins it. */
	const head = names.slice(0, TEAM_BRIDGE_EVENT_NAMES_SHOWN);
	const others = t("ui.teamBridge.events.others", {
		count: names.length - head.length,
	});
	const shown = sentence(line, joinNames([...head, others], locale), actor);
	return { shown, full, truncated };
}

const ICON = {
	invited: UserPlus,
	joined: UserPlus,
	consented: UserPlus,
	left: UserMinus,
	removed: UserMinus,
	declined: UserMinus,
	withdrawn: UserMinus,
} as const;

export const TeamBridgeMemberEventLine: FC<{
	line: TeamBridgeEventLine;
	labelFor: TeamBridgeEventLabel;
	locale: string;
}> = ({ line, labelFor, locale }) => {
	const { shown, full, truncated } = teamBridgeEventSentences(
		line,
		labelFor,
		locale,
	);
	const Icon = line.kind ? ICON[line.kind] : Users;
	const at = new Date(line.at);
	const valid = !Number.isNaN(at.getTime());
	const clock = valid
		? formatTime(at, { hour: "numeric", minute: "2-digit" }, locale)
		: "";
	const stamp = valid
		? formatDate(at, { dateStyle: "full", timeStyle: "short" }, locale)
		: "";
	const text = (
		<span
			/* Focusable only when names are hidden: then the full list is something
			   to reach, and its accessible name carries every name. */
			tabIndex={truncated ? 0 : undefined}
			aria-label={truncated ? full : undefined}
			className={cn(
				"min-w-0 truncate",
				/*
				 * THE UNDERLINE IS THE SENTENCE'S OWN INK (design round 1, D2). At
				 * `decoration-hairline` the dotted rule measured 1.25:1 (light), 1.46:1
				 * (dark), 1.53:1 (tokyo) - effectively invisible, so the one cue that
				 * "and N others" expands rested on the words alone. Leaving the
				 * decoration at `currentColor` (`text-ink-dim`, the sentence's role)
				 * puts it at 5.36 / 6.24 / 6.86:1, which is also the shipped precedent
				 * for this affordance (`integration-row.tsx`: quiet meta text +
				 * Tooltip). One colour step, no new token.
				 * No `outline-focus` utility: there is no `--color-focus` token, so the
				 * class emitted nothing and the ring came from the global
				 * `html :focus-visible` rule (design round 1, D5). The width and offset
				 * below are what this line owns; the ring's COLOUR is the app's.
				 */
				truncated &&
					"cursor-default rounded-sm underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2",
			)}
		>
			{shown}
		</span>
	);
	return (
		<li
			data-team-bridge-event={line.key}
			/* The message row's grid: 36px gutter (icon, end-aligned where the
			   avatar sits) and the body column, so the sentence starts on the
			   same edge as every message body. */
			className="group/event flex w-full min-w-0 items-center gap-3 px-5 py-1 text-ink-dim text-meta"
		>
			<span aria-hidden="true" className="flex w-9 shrink-0 justify-end">
				<Icon className="size-3.5" />
			</span>
			{truncated ? (
				<Tooltip
					/* One name per line: the panel collapses newlines, so each name is
					   its own block (names are server data, never joined by us). */
					content={
						<ul>
							{line.targets.map((target) => (
								<li
									key={`${target.kind}:${target.account_id}:${target.endpoint_id ?? ""}`}
								>
									{labelFor(target)}
								</li>
							))}
						</ul>
					}
					side="top"
					align="start"
				>
					{text}
				</Tooltip>
			) : (
				text
			)}
			{valid && (
				<time
					dateTime={line.at}
					title={stamp}
					className="shrink-0 text-meta-sm opacity-0 group-focus-within/event:opacity-100 group-hover/event:opacity-100"
				>
					{clock}
				</time>
			)}
		</li>
	);
};

/** Every line at one anchor, rolled up. Renders nothing for no events. */
export const TeamBridgeMemberEvents: FC<{
	events: readonly TeamBridgeEvent[] | undefined;
	labelFor: TeamBridgeEventLabel;
	locale: string;
}> = ({ events, labelFor, locale }) => {
	if (!events || events.length === 0) return null;
	return (
		<>
			{teamBridgeEventLines(events).map((line) => (
				<TeamBridgeMemberEventLine
					key={line.key}
					line={line}
					labelFor={labelFor}
					locale={locale}
				/>
			))}
		</>
	);
};
