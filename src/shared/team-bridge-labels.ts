/**
 * The chief-of-staff label composition shared by the renderer and the main
 * process.
 *
 * WHY IT LIVES HERE. The renderer's message rows, rail, mentions, member lists
 * and delivery lines compose "Agent (Owner)" / "Owner's chief of staff"
 * through `composeChiefLabel`, and the main process composes the same label
 * for a native banner title. Two copies of the rule are how one surface came
 * to repeat the owner while the others did not ("Ben Tran (Ben Tran)",
 * 2026-10-22; "Aida (Ben Tran) (Ben Tran)", 2026-11-03), so there is one, and
 * it takes no runtime dependency (the catalogue strings are injected).
 */

/**
 * The two catalogue strings a chief-of-staff label is composed from. Injected
 * because both are translatable ("{agent} ({person})" and "{person}'s chief of
 * staff" reorder and re-punctuate per locale).
 */
export type ChiefLabels = {
	/** "Aida (Ben Tran)": the agent's own name, the person as context. */
	named: (agent: string, person: string) => string;
	/** "Ben Tran's chief of staff": used when the agent has no name of its own. */
	unnamed: (person: string) => string;
};

/** Case-, space- and accent-insensitive form for "is this the same name". */
export function nameKey(name: string): string {
	return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * THE ONE PLACE a chief-of-staff label is composed (operator report,
 * 2026-10-22: "Ben Tran (Ben Tran)" on the rail, the thread header and the
 * composer placeholder, and persisted by the server verbatim as the agent
 * member's `display_label`).
 *
 * WHY IT HAPPENED. The directory's `agent.name` is the endpoint's agent name,
 * else its label, and an endpoint enrolled without an agent name was labelled
 * with its OWNER's name. Composing "{agent} ({person})" from that repeated the
 * person. So an agent name that is empty, or the same as the person's
 * (normalised), is no name at all: the label is then "{person}'s chief of
 * staff", and the person's name never appears twice.
 */
export function composeChiefLabel(
	agentName: string,
	personName: string,
	labels: ChiefLabels,
): string {
	const agent = agentName.trim();
	const person = personName.trim();
	return agent === "" || nameKey(agent) === nameKey(person)
		? labels.unnamed(person)
		: labels.named(agent, person);
}
