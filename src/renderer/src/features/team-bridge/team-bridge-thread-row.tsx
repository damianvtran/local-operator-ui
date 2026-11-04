import { AttentionBadge } from "@shared/components/ui/attention-badge";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { ChevronRight } from "lucide-react";
import { formatDate, formatTime } from "../../../../i18n/format";
import type {
	TeamBridgeDirectoryMember,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import { personInitial } from "./team-bridge-model";
import { TeamBridgeAvatar } from "./team-bridge-profile-card";
import {
	type ThreadParticipant,
	lastReplyWhen,
	threadSummary,
} from "./team-bridge-threads-model";

/** Facepile plate size. 20px is the smallest plate `TeamBridgeAvatar` sizes its glyph and agent mark for. */
const FACE_PX = 20;

/**
 * The "N replies" row under a thread root — Slack's thread summary bar
 * (operator, 2026-11-04: "threads take a wider row space so you can click
 * anywhere on that row to open the thread … also highlight unread at a glance").
 *
 * ONE <button>, FULL WIDTH of the message's content column. The old pill was
 * content-width, so most of the row's apparent extent was dead to the pointer.
 * A single native button gives Enter/Space for free and one accessible name
 * that states the whole row (count, unread, last reply); the facepile, badge
 * and chevron inside are `aria-hidden` decoration of that name, never their own
 * controls — a control inside this control would be a nested interactive.
 *
 * NO LAYOUT SHIFT BETWEEN READ AND UNREAD. The row's height is pinned (`h-8`)
 * and the badge is the shared `AttentionBadge`, whose `size="count"` geometry is
 * a fixed `h-4`, shorter than the row's line box, so it never grows the line.
 * Unread ALSO sets the text semibold; that widens glyphs, which is why the
 * relative-time clause truncates (`min-w-0 truncate`) instead of wrapping, and
 * the chevron is `ml-auto` so it never moves. `data-thread-row-height` names
 * the height class so a test asserts it is the same class in both states.
 *
 * CHROME IS A LIGHTNESS STEP, NOT A BORDER (docs/branding.md: elevation is a
 * lightness step; hover is a colour step; focus is `outline`). Rest is
 * `bg-surface` one ground up from the timeline's `canvas`, hover steps to
 * `bg-elevated`. Not `row-hover`: the enclosing message row already paints
 * `row-hover` while the pointer is over it, so a `row-hover` row would vanish
 * into its own parent exactly when it is being aimed at. Focus is the global
 * `:focus-visible` outline; nothing here sets a box-shadow.
 *
 * UNREAD IS FEATURE-DETECTED. `thread_unread_count` is absent on hubs before
 * slice TR1, and absent means "cannot tell", so the row draws no badge and no
 * emphasis — never a confident "read".
 */
export function TeamBridgeThreadRow({
	message,
	onOpen,
	profileFor,
	locale,
	now,
	className,
}: {
	message: TeamBridgeMessage;
	onOpen: () => void;
	/** The directory row behind a replier; `undefined` draws the initial. */
	profileFor?: (
		sender: TeamBridgeMessage["sender"],
	) => TeamBridgeDirectoryMember | undefined;
	locale: string;
	/** Injected for stories/tests only; production reads the clock. */
	now?: Date;
	className?: string;
}) {
	const summary = threadSummary(message);
	if (summary.count <= 0) return null;
	const unread = summary.unread ?? 0;
	const last = summary.lastReply
		? lastReplyLabel(summary.lastReply, locale, now)
		: null;
	const count = t("ui.teamBridge.replies.count", { count: summary.count });
	const name = t("ui.teamBridge.thread_row.label", {
		count: summary.count,
		unread,
		last: last ?? "",
		hasLast: last ? "yes" : "no",
	});
	return (
		<button
			type="button"
			onClick={onOpen}
			aria-label={name}
			data-thread-row=""
			data-thread-row-height="h-8"
			data-unread={unread > 0 ? String(unread) : undefined}
			className={cn(
				"group/thread-row mt-1 flex h-8 w-full min-w-0 items-center gap-2 rounded-md bg-surface px-1.5 text-start text-[13px] transition-colors duration-fast ease-out-quart hover:bg-elevated",
				unread > 0 && "font-semibold",
				className,
			)}
		>
			<Facepile participants={summary.participants} profileFor={profileFor} />
			<span aria-hidden="true" className="shrink-0 text-accent">
				{count}
			</span>
			{last && (
				<span aria-hidden="true" className="min-w-0 truncate text-ink-muted">
					{last}
				</span>
			)}
			<AttentionBadge
				aria-hidden="true"
				count={unread}
				format={(label) =>
					t("ui.teamBridge.thread_row.unread_badge", { count: unread, label })
				}
				className="shrink-0"
			/>
			<ChevronRight
				aria-hidden="true"
				size={16}
				className="ml-auto shrink-0 text-ink-dim transition-colors duration-fast group-hover/thread-row:text-ink rtl:rotate-180"
			/>
		</button>
	);
}

/**
 * "Last reply today at 10:39 AM" / "… yesterday at …" / "… Mar 4", by calendar
 * day. ONE keyed sentence with a `when` select, not a clock spliced into a
 * second string: word order around "today"/"yesterday" differs by locale, so
 * the translator owns the whole clause. Older replies show a date only (year
 * outside the current one) — a clock on a weeks-old reply is noise.
 */
export function lastReplyLabel(at: Date, locale: string, now = new Date()) {
	const when = lastReplyWhen(at, now);
	const time =
		when === "older"
			? formatDate(
					at,
					at.getFullYear() === now.getFullYear()
						? { month: "short", day: "numeric" }
						: { month: "short", day: "numeric", year: "numeric" },
					locale,
				)
			: formatTime(at, { hour: "numeric", minute: "2-digit" }, locale);
	return t("ui.teamBridge.thread_row.last", { when, time });
}

/**
 * Up to three overlapping plates. A replier with an id resolves through the
 * same `profileFor` the message list uses, so the picture and the agent mark
 * match the sender avatar above; one without (a pre-TR1 hub sends labels
 * only) draws its initial on the plate's own placeholder.
 */
function Facepile({
	participants,
	profileFor,
}: {
	participants: ThreadParticipant[];
	profileFor?: (
		sender: TeamBridgeMessage["sender"],
	) => TeamBridgeDirectoryMember | undefined;
}) {
	if (participants.length === 0) return null;
	return (
		<span aria-hidden="true" className="flex shrink-0 -space-x-1.5">
			{participants.map((participant, index) => {
				const kind = participant.kind ?? "human";
				const resolved =
					(participant.accountId &&
						profileFor?.({
							account_id: participant.accountId,
							kind,
							display_label: participant.label,
						})) ||
					undefined;
				/* An AGENT the directory does not list still wears the Bot glyph and
				   the agent mark: kind is a fact the hub stated, and an initial would
				   pass the agent off as a person. A bare identity (no picture fields,
				   no endpoint) means the plate fetches nothing. */
				const member =
					resolved ??
					(kind === "agent" && participant.accountId
						? {
								account_id: participant.accountId,
								display_label: participant.label,
								role: "member",
								bridge_enabled: false,
								bridge_state: "none" as const,
							}
						: undefined);
				/* The ring is the row's own fill, so overlapping plates read as
				   separate discs without a border role. */
				const plate =
					"rounded-full text-[10px] ring-2 ring-surface group-hover/thread-row:ring-elevated";
				const key = `${index}:${participant.accountId ?? participant.label}`;
				return member ? (
					<TeamBridgeAvatar
						key={key}
						member={member}
						kind={kind}
						label={participant.label}
						size={FACE_PX}
						fallback={personInitial(participant.label)}
						className={plate}
					/>
				) : (
					/* No directory row (a pre-TR1 hub sends labels only, or the replier
					   left the directory): the initial on the plate's own placeholder
					   ground, with no avatar fetch behind it. */
					<span
						key={key}
						data-thread-face="initial"
						className={cn(
							"inline-flex size-5 shrink-0 items-center justify-center bg-media-surface font-medium text-ink-muted",
							plate,
						)}
					>
						{personInitial(participant.label)}
					</span>
				);
			})}
		</span>
	);
}
