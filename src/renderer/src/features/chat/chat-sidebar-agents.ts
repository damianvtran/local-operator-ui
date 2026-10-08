/**
 * The chat sidebar's Agents roster: which agents a filter admits, in what order
 * the section draws them, and which of them the reader has pinned.
 *
 * WHY A MODULE, the reason `chat-list-sections.ts` and `chat-sidebar-view.ts`
 * beside it give: this repository's `node:test` suite cannot render the sidebar
 * (it reads the router, the canonical-sessions store and the desktop capability
 * hooks), so a rule written inline in the component is a rule no test can
 * reach. `scripts/chat-sidebar-agents.test.mjs` drives THIS file.
 *
 * WHAT IT ANSWERS (issue #663). The section used to draw `profiles.list` order,
 * one disclosure per agent, scanned by hand - which does not survive a roster
 * that grows. Three rules, and each is a decision rather than a convenience:
 *
 *   - FILTER (`filterAgentRows`): a case-insensitive substring of the name or a
 *     tag, the same discipline the list's own search applies to its labels
 *     (`chat-search.ts`'s `toLocaleLowerCase` rule). A blank query admits
 *     everything, because a filter is an answer to "which of these" and only a
 *     query that says nothing has nothing to narrow.
 *   - ORDER (`orderAgentRows`): the reader's pins first, then most-recently
 *     used, never-used last in their original order. A stable PARTITION plus a
 *     single-key merge, and the reason is the ROSTER's own: a comparator
 *     carrying "is it used" and "how recent" as its keys is free to reorder
 *     rows the partition did not intend to touch, so the merge makes the band
 *     boundary and the tie rule structural rather than dependent on the
 *     engine's sort stability. (The paragraph here used to cite
 *     `chat-sidebar-view.ts`'s `pageOrder` as the argument; on 2026-10-08
 *     `pageOrder` reversed its own stance - it sorts now, with a key that
 *     states every term including the row's POSITION - so the roster stands on
 *     its own rule instead. The two agree about what matters: no tie may be
 *     broken by a value the row does not carry.)
 *   - PIN (`togglePinnedAgent`): one press, one field on `SidebarView`.
 *
 * PIN IDENTITY, which is a finding rather than an assumption. Pin keys are row
 * IDs (the `id` on the row shape below), not display names, because a pin has
 * to outlive a rename and the module would rather carry the stable key than
 * promise a name is one. VERIFIED against the wire this head ships, and the
 * finding is that the two are currently one string: `profiles.list` publishes
 * no id field at all (`ReusableProfile` in `profile-hooks.ts` has none), the
 * registry addresses a profile BY NAME - `desktop-contract.ts`'s
 * `profiles.get`/`profiles.update` both take `name`, and `profileFields`
 * carries no name, so no op can rename one - and the one id-like field,
 * `agent_id`, is null for builtins and is the registry row's provenance rather
 * than the profile's identity, so it cannot key a stored preference. So on
 * today's wire the caller's row build
 * passes the name as the row's `id`, and the day the wire publishes a real
 * profile id only that row build changes. The distinction matters HERE because
 * RECENCY cannot work that way: it correlates by NAME - the wire's session
 * binding carries the name and nothing else (`desktop-contract.ts`'s catalogue
 * scope predicate states the same rule for the daemon: `!binding.team &&
 * binding.agent === name`) - so the module keeps both: `id` for the pin set,
 * `name` for the usage join.
 */

import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import { rowTimeMs } from "./chat-list-sections";
import { PINNED_AGENTS_MAX, type SidebarView } from "./chat-sidebar-view";

/**
 * The rows the roster draws, minimal on purpose.
 *
 * `id` is the row's stable key for the pin set (see the header for why that is
 * the name on today's profile wire); `name` is what the section prints and what
 * a session binding correlates by; `tags` are keywords a caller may have and
 * the profile wire does not (yet) publish.
 */
export type AgentRosterRow = {
	id: string;
	name: string;
	tags?: readonly string[];
};

/**
 * The rows a query admits, in the order given: a case-insensitive substring of
 * the name or any tag. A blank (or whitespace-only) query admits all rows.
 *
 * `toLocaleLowerCase` rather than `toLowerCase`, matching `chat-search.ts`:
 * the two filters sit in one column and a user spelling a Turkish dotted I must
 * not get one answer from the roster and another from the list.
 */
export function filterAgentRows<T extends AgentRosterRow>(
	rows: readonly T[],
	query: string,
): T[] {
	const needle = query.trim().toLocaleLowerCase();
	if (!needle) return [...rows];
	return rows.filter(
		(row) =>
			row.name.toLocaleLowerCase().includes(needle) ||
			(row.tags ?? []).some((tag) => tag.toLocaleLowerCase().includes(needle)),
	);
}

/**
 * The instant an agent was last used, in milliseconds, or null for never.
 *
 * The correlation is the sidebar's OWN, restated from `chat-sidebar.tsx`'s
 * `children()` rather than re-derived: a session row belongs to the TEAM's
 * group whenever it carries a team, never to the agent's, so `binding.team`
 * excludes the row first and only then does the agent match by name. A row
 * with no usable time contributes nothing - `rowTimeMs` is the one door for
 * both clocks (`chat-list-sections.ts` explains why zero is not "now"), and
 * the answer is the newest of what is left.
 *
 * `active` is the basis, named rather than taken from the view: this is a
 * usage signal, not a label, and switching the TIME BASIS must not silently
 * re-sort the roster under the reader (the basis changes what the numbers
 * measure, never which clock "recently used" means).
 */
export function agentRecencyMs(
	rows: readonly CanonicalSessionRow[],
	name: string,
): number | null {
	let newest: number | null = null;
	for (const row of rows) {
		if (row.binding?.team || row.binding?.agent !== name) continue;
		const at = rowTimeMs(row, "active");
		if (at === null) continue;
		if (newest === null || at > newest) newest = at;
	}
	return newest;
}

/** What the ordering reads: the pinned keys, and how recent each row is. */
export type AgentOrderInputs<T extends AgentRosterRow> = {
	pinned: readonly string[];
	recency: (row: T) => number | null;
};

/**
 * One row plus the recency the build read for it, so `recency` is called once
 * per row rather than once per comparison.
 */
type DatedRow<T> = { row: T; at: number };

/**
 * One band in draw order: used rows most-recent first, never-used last in the
 * order given.
 *
 * THE ORDERING IS A MERGE, NOT `Array.sort`, and the reason is this band's own:
 * a comparator over "is it used" and "how recent" is free to reorder rows the
 * partition did not intend to touch, so the merge makes the band boundary and
 * the tie rule (ties keep the caller's order BY CONSTRUCTION) structural rather
 * than dependent on the engine's sort stability. (This note used to cite
 * `pageOrder` as the argument and say pageOrder "refused" a comparator; on
 * 2026-10-08 pageOrder reversed its stance and sorts with a TOTAL key whose
 * last term is the row's position - see its own comment. What the two share is
 * the rule that matters: a tie is never broken by a value the row does not
 * carry.)
 */
function orderBand<T>(band: readonly { row: T; at: number | null }[]): T[] {
	const used: DatedRow<T>[] = [];
	const never: T[] = [];
	for (const entry of band) {
		if (entry.at === null) never.push(entry.row);
		else used.push({ row: entry.row, at: entry.at });
	}
	const ordered: DatedRow<T>[] = [];
	for (const entry of used) {
		let index = 0;
		while (index < ordered.length && ordered[index].at >= entry.at) index += 1;
		ordered.splice(index, 0, entry);
	}
	return [...ordered.map((entry) => entry.row), ...never];
}

/**
 * The roster in draw order: pinned rows first, then the rest by recency.
 *
 * WITHIN EACH BAND the rules are the same - most recently used first,
 * never-used last in the order given - and the pinned band keeps ALL of its
 * rows: a pin is the reader's explicit act, so a pinned agent nobody has used
 * yet still outranks every unpinned one (a pin that sank below the recency
 * order the moment its agent went quiet would be a pin the reader has to
 * re-aim at, which is the friction the pin exists to remove). The never-used
 * tail is a PARTITION rather than a zero time, so a row with no time can never
 * be compared against one and win.
 */
export function orderAgentRows<T extends AgentRosterRow>(
	rows: readonly T[],
	inputs: AgentOrderInputs<T>,
): T[] {
	const pinnedKeys = new Set(inputs.pinned);
	const pinned: { row: T; at: number | null }[] = [];
	const rest: { row: T; at: number | null }[] = [];
	// One recency read per row, on the way in: the comparator below only ever
	// reads the numbers this pass captured.
	for (const row of rows) {
		const entry = { row, at: inputs.recency(row) };
		(pinnedKeys.has(row.id) ? pinned : rest).push(entry);
	}
	return [...orderBand(pinned), ...orderBand(rest)];
}

/**
 * One pin's press: in the set when it was out, out of it when it was in.
 *
 * The array is a SET whose order is deliberately not load-bearing - the band
 * orders by recency, and the parser dedupes - so an unpin filters and a pin
 * appends, and a press that returns to the pinned state lands at the end
 * without the reader being able to tell. At the cap a new pin drops the OLDEST
 * entry rather than refusing the press: the roster that could reach 64 pins is
 * exactly the roster where refusing the last press is least explicable, and the
 * bound exists for the stored blob, not to lock the reader out of a control.
 */
export function togglePinnedAgent(
	view: SidebarView,
	agentId: string,
): SidebarView {
	const pinned = view.pinnedAgents.includes(agentId)
		? view.pinnedAgents.filter((entry) => entry !== agentId)
		: [...view.pinnedAgents, agentId].slice(-PINNED_AGENTS_MAX);
	return { ...view, pinnedAgents: pinned };
}
