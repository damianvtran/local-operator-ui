/**
 * The MCP servers section of the run panel (`docs/run-sidebar.md` § 7).
 *
 * It exists because there was no robust way to see which MCP servers are
 * connected and which are broken: an expired grant surfaced nowhere the operator
 * looks, and the fix (`Grant account access`) lives on a settings page they had
 * no reason to open during a run. The panel is the live view over the session, so
 * a server whose sign-in has expired belongs on it.
 *
 * **The panel is a VIEW, not a control.** There is no connect, no reload, no
 * reauth button here — those live in `settings/components/mcp-management-section.tsx`,
 * which owns the configuration, and a second place to press them is a second
 * place to get the confirmation, the scope and the error copy wrong. What this
 * section owes the reader instead is the REMEDY in words on the row that needs
 * it, because the two problem states need different actions and the word alone
 * does not say which.
 *
 * Encoding follows the other two sections: the state is said in a MARK and a
 * WORD, the mark is `aria-hidden` decoration, colour is spent on failure and on
 * nothing else (the dock band's own ink law), and the section has no cap — a cap
 * is an answer to an unbounded stream of children, not to the finite servers a
 * user configured.
 */

import { cn } from "@shared/lib/utils";
import {
	Check,
	CircleAlert,
	CircleDashed,
	CircleHelp,
	LoaderCircle,
	X,
} from "lucide-react";
import { type McpServerRow, mcpServersAreCold } from "./run-detail-model";

/**
 * One mark per state, ported by MEANING rather than by codepoint, exactly as the
 * roster's own table is, so the panel has one vocabulary rather than two. The
 * four wire states plus the cold facade's; anything else gets the unknown mark.
 */
const MCP_ICON = {
	connected: Check,
	connecting: LoaderCircle,
	"auth-required": CircleAlert,
	disconnected: X,
	cold: CircleDashed,
} as const;

/**
 * Ink per state. Failure is the only colour: `auth-required` is the state the
 * operator could not see, and `disconnected` is the other terminal one.
 *
 * The FALLBACK is the quietest ink, and that is `§ 7.3`'s refusal made visible:
 * an unrecognised word TAKES ATTENTION — it lights the dot and appears in the
 * trigger's label — while rendering quietly, because a renderer must not paint a
 * `danger` failure it cannot name. The failure this design prevents is a MISSED
 * problem rather than a spurious dot; but a red word this build cannot explain
 * reads as a crash, which is the confusion the section exists to remove.
 */
const MCP_INK: Record<string, string> = {
	connected: "text-ink-dim",
	connecting: "text-ink-muted",
	cold: "text-ink-dim",
	"auth-required": "text-danger",
	disconnected: "text-danger",
};

/** The mark for every word this build has not been taught. */
const MCP_UNKNOWN_ICON = CircleHelp;

const iconFor = (status: string) =>
	MCP_ICON[status as keyof typeof MCP_ICON] ?? MCP_UNKNOWN_ICON;

const inkFor = (status: string) => MCP_INK[status] ?? "text-ink-dim";

/**
 * The cold sentence, and why it replaces the tally rather than annotating it.
 *
 * With no runtime attached there IS no status to report, so the section shows
 * which servers are CONFIGURED — worth having on its own — and says plainly that
 * nothing was checked. It is one line for the whole section because the route's
 * cold branch stamps `status: "cold"` on EVERY row, so a per-row word would print
 * one jargon term N times and the tally would read `0 of N connected`, claiming
 * three servers are down when none was asked to be up. It lights no dot, because
 * nothing is wrong.
 */
const COLD_LINE = "No session is running — server status cannot be checked.";

/**
 * The section's trailing tally.
 *
 * Same grammar as its two neighbours (label left, quiet right-aligned tally) and
 * its own rule: the connected count against the whole list, plus the problem
 * count when there is one. Those are two different facts rather than one
 * restated — `connecting` is neither connected nor a problem, so the healthy
 * count does not imply the problem count — which is why `§ 6.2`'s
 * de-duplication argument does not apply here.
 */
const mcpTally = (rows: readonly McpServerRow[]): string => {
	if (mcpServersAreCold(rows)) return COLD_LINE;
	const connected = rows.filter((row) => row.status === "connected").length;
	const problems = rows.filter((row) => row.problem).length;
	const base = `${connected} of ${rows.length} connected`;
	return problems > 0 ? `${base} · ${problems} need attention` : base;
};

const McpRow = ({ row, cold }: { row: McpServerRow; cold: boolean }) => {
	const Mark = iconFor(row.status);
	/*
	 * The row's height is pinned by the design (`§ 8`): 32px healthy, 48px on a
	 * problem row. `py-1.5` around a 20px line and a 16px remedy line lands both —
	 * the roster's compact height, then the to-do blocked row's second line — and
	 * it is set here rather than derived from the content so a wrapped name cannot
	 * silently reflow the section.
	 */
	return (
		/*
		 * No hover ground, and not a control: a row that lit up under the cursor
		 * would promise an action this surface deliberately does not have. The
		 * roster's rows DO take one now (`§ 4`), because they open a page; these do
		 * not, and a list that lit up because its neighbour did would be the
		 * inheritance the design round is asked to watch for.
		 */
		<li className={cn("flex min-h-8 gap-2 px-3 py-1.5")}>
			<span className={cn("pt-0.5")}>
				{/* A cold row has no state to mark, so it renders no mark at all. */}
				{cold ? null : (
					<span
						aria-hidden={true}
						className={cn(
							"flex size-4 shrink-0 items-center justify-center",
							inkFor(row.status),
						)}
					>
						<Mark
							className={cn(
								"size-4",
								// Reduced motion: the glyph holds its frame. Shape already
								// distinguishes the states, which is why motion is a bonus.
								row.status === "connecting" && "motion-safe:animate-spin",
							)}
						/>
					</span>
				)}
			</span>
			<div className={cn("flex min-w-0 flex-1 flex-col")}>
				{/*
				 * `min-w-0` on the row so the NAME absorbs the pressure: `§ 8` makes
				 * it the only segment allowed to shrink, and the fixed three (word,
				 * count, scope) are `shrink-0` because the numbers rule forbids
				 * truncating a value mid-figure.
				 */}
				<div className={cn("flex min-w-0 items-baseline gap-2")}>
					<span
						className={cn(
							"min-w-0 flex-1 truncate text-body-sm text-ink leading-5",
						)}
						title={row.name}
					>
						{row.name}
					</span>
					{/*
					 * The status word is the WIRE'S, verbatim — including
					 * `auth-required`. A friendlier spelling in this one renderer would
					 * make the panel and the Settings page disagree about one server's
					 * state, and the backend's own docstring makes rendering the string
					 * directly the contract between them. The human meaning is carried
					 * by the hint on the second line.
					 *
					 * A COLD row has no word: one jargon word repeated N times is what
					 * the section refuses, and the cold line says it once instead.
					 */}
					{!cold && (
						<span className={cn("shrink-0 text-meta", inkFor(row.status))}>
							{row.status}
						</span>
					)}
					{row.toolCount !== null && (
						/*
						 * A connected server's reach, in the panel's numbers grammar: only
						 * ever rendered for `connected` (the model omits it otherwise), so
						 * it cannot claim tools a disconnected server is not serving.
						 */
						<span
							className={cn("shrink-0 tabular-nums text-meta text-ink-dim")}
						>
							{row.toolCount === 1 ? "1 tool" : `${row.toolCount} tools`}
						</span>
					)}
					{/*
					 * The qualifier, on line ONE: `owned_scope` (`global` / `project`) or
					 * the source file's basename. It is a qualifier rather than a
					 * subject, and giving it a line of its own makes every healthy row
					 * two lines tall for a fact the reader is not looking for — in the
					 * pane's scarcest direction.
					 */}
					{row.scope && (
						<span
							className={cn("shrink-0 text-meta text-ink-dim")}
							title={row.scope}
						>
							{row.scope}
						</span>
					)}
				</div>
				{/*
				 * The second line exists ONLY for a remedy, and only on a problem row:
				 * an indented, quiet line in the to-do section's blocked-row shape. An
				 * unrecognised word gets none — a fix for a word this build cannot name
				 * would be a guess, and a guess is worse than the quiet unknown row that
				 * does still take attention.
				 */}
				{row.hint && (
					<span
						className={cn("truncate text-ink-muted text-meta leading-4")}
						title={row.hint}
					>
						{row.hint}
					</span>
				)}
			</div>
		</li>
	);
};

export const RunDetailMcp = ({
	servers,
}: {
	servers: readonly McpServerRow[];
}) => {
	if (servers.length === 0) return null;
	const cold = mcpServersAreCold(servers);
	return (
		<section className={cn("flex flex-col pb-1.5")}>
			<div
				className={cn(
					"flex items-baseline justify-between gap-2 px-3 pt-2 pb-1",
				)}
			>
				<span className={cn("shrink-0 text-meta text-ink-muted")}>
					MCP servers
				</span>
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-right text-meta text-ink-dim",
					)}
				>
					{mcpTally(servers)}
				</span>
			</div>
			<ul className={cn("flex flex-col")}>
				{servers.map((row) => (
					<McpRow key={row.name} row={row} cold={cold} />
				))}
			</ul>
		</section>
	);
};
