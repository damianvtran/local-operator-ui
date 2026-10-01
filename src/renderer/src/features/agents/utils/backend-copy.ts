/**
 * The backend's refusals, said in the operator's words.
 *
 * WHY THIS EXISTS. The writable fields on this page are validated twice — by the
 * app, for the mistakes it can see locally (a name that already exists, a
 * missing instruction), and by the backend, which owns the rules that need the
 * registry (name collisions `NameTakenError` raises, an effort tier that is not
 * configured, the team cycle check) and answers with `str(exc)`. That last half
 * reached the screen verbatim, and the UX exploration (U2) measured what it
 * looks like:
 *
 *    1 validation error for AgentParams effort Value error, effort tier
 *    'turbo-9000' is unavailable: no tiers are configured under
 *    subagents.models; omit 'effort' to inherit ... [type=value_error,
 *    input_value='turbo-9000', input_type=str] For further information visit
 *    https://errors.pydantic.dev/2.13/v/value_error
 *
 * That is a stack of three facts — a pydantic envelope, a domain sentence, and a
 * URL — wrapped around the ONE sentence the operator can act on, and it was
 * rendered at the top of a 966px form rather than beside the field it was about.
 * The domain sentence is good and is authored by the backend; the rest is
 * machine register.
 *
 * THE RULE HERE IS NARROW ON PURPOSE: translation is opt-in per known shape, and
 * anything unrecognised is passed through with only the pydantic envelope and
 * the tool's own vocabulary removed. Rewriting a sentence this file does not
 * recognise would be guessing at a refusal nobody has read, which is a worse
 * failure than showing a developer sentence — it would tell the operator
 * something the backend never said.
 *
 * The sentences are deliberately concrete about the remedy: "which field" and
 * "what to do" are the two halves the branding contract asks a failure to carry.
 */

/*
 * EVERY PATTERN IS A MODULE CONSTANT, which is this repo's lint rule and also the
 * right shape here: these are read on the refusal path, which can run many times
 * in a session, and a literal recompiled per call is work nobody asked for. They
 * are named for the shape they match rather than for a field, because one shape
 * can serve two fields.
 */
/** `Value error, <sentence> [type=...]` — the pydantic envelope's useful half. */
const VALUE_ERROR = /Value error,\s*([\s\S]*?)\s*\[type=/;
/** `1 validation error for X` and everything before the real sentence. */
const ENVELOPE_HEAD = /^\d+ validation errors? for \S+[\s\S]*?\n\s*/i;
/** The machine tail: `[type=value_error, input_value=..., ...]` to end of line. */
const ENVELOPE_TAIL = /\s*\[type=[^\]]*\][\s\S]*$/m;
/** The URL pydantic appends. */
const ENVELOPE_URL = /\s*For further information visit \S+/g;
/** `NameTakenError`'s sentence, with the name in quotes. */
const NAME_TAKEN = /'([^']+)' already exists/;
/** The name grammar refusal. */
const NAME_GRAMMAR = /cannot contain spaces or path separators/i;
/** An unavailable effort tier, with the tier in quotes. */
const EFFORT_TIER = /effort tier '([^']+)' is unavailable/i;
/** A team name outside the wire's bound. */
const TEAM_NAME_BOUND = /team name must be/i;
/** An unresolved manager, with the name in quotes. */
const MANAGER_MISSING = /manager '([^']+)'/i;
/** An unresolved member, with the name in quotes. */
const MEMBER_MISSING = /(?:member|role) '([^']+)' (?:is not|does not)/i;
/** A nesting failure of any of the three shapes the registry can raise. */
const NESTING_FAILURE = /depth|cycle|circular/i;
const INSTRUCTIONS_FIELD = /instructions/i;
const DESCRIPTION_FIELD = /description/i;

/** The field a refusal is about, or `null` when it is about the record. */
export type FieldTarget =
	| "name"
	| "description"
	| "instructions"
	| "tools"
	| "effort"
	| "manager"
	| "members"
	| null;

export type RefusalCopy = {
	/** The sentence to show, in user vocabulary. */
	message: string;
	/** The field it belongs beside, when it is about one. */
	field: FieldTarget;
};

/**
 * The pydantic envelope, removed.
 *
 * `1 validation error for X\n<field>\n  Value error, <sentence> [type=..., ...]
 * For further information visit <url>` becomes `<sentence>`. The `[type=...]`
 * tail is matched from its opening bracket to the end of the line because it is
 * a single unbroken run in the real output; any prose AFTER it (the URL) is
 * dropped by the same match.
 */
function stripValidationEnvelope(message: string): string {
	const valueError = message.match(VALUE_ERROR);
	if (valueError?.[1]) return valueError[1].trim();
	return message
		.replace(ENVELOPE_HEAD, "")
		.replace(ENVELOPE_TAIL, "")
		.replace(ENVELOPE_URL, "")
		.trim();
}

/**
 * One refusal, as the sentence to show and the field it belongs beside.
 *
 * Ordered most-specific-first, and every pattern is one the backend actually
 * emits (each was read from the source named in the comment, not invented):
 */
export function refusalCopy(raw: string): RefusalCopy {
	const message = stripValidationEnvelope(raw);

	// `agent_tool.py` (NameTakenError: "role 'coder' already exists; use
	// op='update' to change it."). The second clause is the tool's own
	// vocabulary — an operator editing a form is not choosing an `op` — so it
	// goes, and the useful half (the name is taken) keeps its remedy.
	const taken = message.match(NAME_TAKEN);
	if (taken) {
		return {
			message: `An agent called “${taken[1]}” already exists. Choose another name, or open the existing one to change it.`,
			field: "name",
		};
	}

	// `agent_profiles.py`: "Profile names cannot contain spaces or path
	// separators" — already user vocabulary; attached to the field it is about.
	if (NAME_GRAMMAR.test(message)) {
		return {
			message: "Names cannot contain spaces or slashes.",
			field: "name",
		};
	}

	// `agent_tool.py`'s effort validation: "effort tier 'x' is unavailable: no
	// tiers are configured under subagents.models; omit 'effort' to inherit".
	const effort = message.match(EFFORT_TIER);
	if (effort) {
		return {
			message: `“${effort[1]}” is not a configured effort tier. Use inherit, or add the tier in Settings.`,
			field: "effort",
		};
	}

	// `teams.py`'s name bound, and the member/manager resolution the registry
	// refuses ("team manager 'x' is not an agent or team").
	const teamName = message.match(TEAM_NAME_BOUND);
	if (teamName) {
		return {
			message: "A team name is 1-64 characters.",
			field: "name",
		};
	}
	const manager = message.match(MANAGER_MISSING);
	if (manager) {
		return {
			message: `“${manager[1]}” is not an agent or a team on this machine.`,
			field: "manager",
		};
	}
	const member = message.match(MEMBER_MISSING);
	if (member) {
		return {
			message: `“${member[1]}” is not an agent or a team on this machine.`,
			field: "members",
		};
	}

	// A team that would nest too deeply (`MAX_ORG_DEPTH`) or loop.
	if (NESTING_FAILURE.test(message)) {
		return {
			message:
				"That team would nest too deeply, or would contain itself. Check its members.",
			field: "members",
		};
	}

	// Field bounds the form cannot check locally: attach to the field the bound
	// names, so the sentence lands where the editing happened.
	if (INSTRUCTIONS_FIELD.test(message)) {
		return { message, field: "instructions" };
	}
	if (DESCRIPTION_FIELD.test(message)) {
		return { message, field: "description" };
	}

	// UNRECOGNISED: the sentence is passed through (minus the envelope) and
	// attached to nothing. Guessing a field here would point at the wrong one.
	return { message, field: null };
}

/**
 * A name that is free to use as a duplicate, given the names already taken.
 *
 * WHY A SUGGESTION RATHER THAN A REFUSAL. UX exploration U10: Extend carried the
 * built-in's own name, the save succeeded as a custom SHADOW copy under a
 * built-in's name, and the operator's "built-in available" affordance silently
 * disappeared — one press quietly replaced a packaged definition with a local
 * one. The remedy is a name that cannot collide, offered up front, so the
 * destructive reading is unreachable rather than merely refused afterwards.
 */
export function duplicateNameCandidates(
	name: string,
	taken: readonly string[],
): string {
	const occupied = new Set(taken);
	const base = `${name}-copy`;
	if (!occupied.has(base)) return base;
	for (let index = 2; index < 100; index += 1) {
		const candidate = `${base}-${index}`;
		if (!occupied.has(candidate)) return candidate;
	}
	return base;
}
