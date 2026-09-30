/**
 * The agent's action CLASS — `reactive` or `proactive` — as this app reads it,
 * says it, and writes it.
 *
 * WHY ONE MODULE FOR A TWO-VALUE FIELD. Three things about a class are easy to
 * get subtly wrong and expensive to get wrong quietly, and all three are
 * properties of the field rather than of any one screen:
 *
 *  1. WHAT AN ABSENT FIELD MEANS. `reactive` is the ABSENT value on the wire —
 *     the backend encodes the class as a `class:proactive` tag and leaves the
 *     tag off for reactive, so a row written before the class existed reads
 *     reactive, and a value this build does not recognise has to read reactive
 *     too (the backend's own `action_class.normalize` answers reactive for
 *     anything unrecognised, deliberately: an unknown class must never be the
 *     reason an agent starts messaging somebody). So absence is not a fallback
 *     this file invents; it is the field's own definition, and it is spelled
 *     once, here, rather than as a `?? "reactive"` at every read site.
 *  2. WHAT THE CLASS DOES. "Proactive" is not a mood: it arms hidden patience
 *     waits — after a sent message the agent waits a few minutes for a reply,
 *     nudges again with growing gaps up to a bounded number of tries, then falls
 *     back to waiting for the user's attention. A control that flips this without
 *     saying so is a control that makes the app nag on the operator's behalf,
 *     which is why the copy below is a fixed part of the module rather than
 *     something each surface writes for itself.
 *  3. WHERE THE SWITCH CAN LAND. A packaged starter that has never been
 *     installed has no registry row to carry the tag, and the profile write
 *     route updates a row rather than creating one — so the switch installs the
 *     starter first, the same thing the backend's own `set_registered_action_class`
 *     does for a seeded role. That ordering is a fact about the write, so it
 *     lives beside the write rather than being re-derived by the caller.
 *
 * The words agree with the TUI's `/agent class` receipts ("agent X is now
 * proactive — it may send proactive messages" / "proactive behaviour stopped")
 * because the two surfaces set the same field, and a user who reads one should
 * not have to learn a second vocabulary for the other.
 */

import type { ReusableProfile } from "@shared/api/local-operator/profile-hooks";
import { refusalCopy } from "./backend-copy";

/** The two classes, spelled as the wire spells them. */
export type ActionClass = "reactive" | "proactive";

/**
 * The class a profile is in.
 *
 * A profile whose payload carries no `action_class` — a backend older than the
 * field, or the `null` an uninstalled starter's write half answers with — is
 * REACTIVE, and so is any spelling this build does not know. That is the
 * backend's own reading (`local_operator/action_class.py`'s `normalize`), and it
 * is the safe direction: the failure mode of guessing wrong here is an agent
 * that starts messaging the operator unprompted.
 */
export function classOf(profile: { action_class?: unknown }): ActionClass {
	return profile.action_class === "proactive" ? "proactive" : "reactive";
}

/** The class as a reader meets it, in the app's sentence case. */
export const CLASS_LABEL: Record<ActionClass, string> = {
	proactive: "Proactive",
	reactive: "Reactive",
};

/**
 * What the current class means, for a reader who has never met the word.
 *
 * The proactive sentence is deliberately concrete about the behaviour it
 * unlocks, because it is the half a user cannot see: a patience wait is hidden
 * by design, so "it may message you" is the only place the operator can learn
 * that an unanswered message produces a nudge — and that the nudging is bounded
 * and then gives up rather than continuing forever.
 */
export const CLASS_MEANING: Record<ActionClass, string> = {
	proactive:
		"Proactive — it may message you on its own. After it sends a message it waits a few minutes for your reply, then nudges again with growing gaps, for a fixed number of tries, and then waits for you.",
	reactive:
		"Reactive — it answers when you ask, and never messages you on its own.",
};

/**
 * What the switch is about to do, said BEFORE it is pressed.
 *
 * Both sentences name the outcome rather than the mechanism, and both name the
 * direction that costs the operator something (a switch on is an agent that may
 * message them; a switch off is messaging that stops), which is the half a label
 * alone cannot carry.
 */
export const CLASS_SWITCH_EFFECT: Record<ActionClass, string> = {
	proactive:
		"Turning this off stops its proactive messaging. Ordinary chat is unchanged.",
	reactive:
		"Turning this on lets it message you first. Ordinary chat is unchanged.",
};

/**
 * What pressing the switch on a packaged starter does FIRST.
 *
 * A built-in has no registry row, and the profile write updates a row — so the
 * switch installs one first, exactly as the backend does for a seeded role.
 * That is a write the operator did not ask for by name, so it is disclosed in
 * the control's own copy before the press rather than discovered in the list
 * afterwards ("why does Aida say Installed now?").
 */
export const BUILTIN_SWITCH_DISCLOSURE =
	"This one ships with the app and has no copy of its own yet, so switching installs it first — the same agent and the same instructions, now editable — and then sets its class.";

/** The class a switch is moving TO, from the one a profile is in. */
export function oppositeClass(current: ActionClass): ActionClass {
	return current === "proactive" ? "reactive" : "proactive";
}

/**
 * One request a switch makes, in the order it makes them.
 *
 * `profiles.update` carries ONLY the class: an omitted field means "leave it
 * alone" on this wire (`agent_tool.py`'s merge rule), so a switch cannot revert
 * a description or an instruction set somebody else edited while this pane was
 * open. That is the same discipline the detail pane's own save follows.
 */
export type ClassSwitchStep = {
	op: "profiles.install" | "profiles.update";
	name: string;
	/** Present on the update step only — an install takes no fields. */
	fields?: { action_class: ActionClass };
};

/**
 * The ops a switch runs, in order: install a starter that has no row, then set
 * the class.
 *
 * Split out from the call so the sequence — and in particular the case where it
 * is ONE step rather than two — is assertable without a transport.
 */
export function classSwitchSteps(
	profile: { name: string; source?: unknown; action_class?: unknown },
	next: ActionClass,
): ClassSwitchStep[] {
	const steps: ClassSwitchStep[] = [];
	/*
	 * ONLY a built-in needs the install. An installed starter or a custom agent
	 * already has the row the update writes, and installing again would be an
	 * idempotent no-op dressed up as work.
	 */
	if (profile.source === "builtin") {
		steps.push({ op: "profiles.install", name: profile.name });
	}
	steps.push({
		op: "profiles.update",
		name: profile.name,
		fields: { action_class: next },
	});
	return steps;
}

/** How one step reaches the wire, injected so the sequence is testable. */
export type ClassSwitchInvoke = (
	step: ClassSwitchStep,
	requestId: string,
) => Promise<ReusableProfile>;

/**
 * Run a switch, in order, and answer the profile the LAST step returned.
 *
 * A no-op (the profile is already in the class asked for) makes no request at
 * all, so a double press cannot write twice.
 *
 * A FAILED INSTALL IS NOT A FAILED SWITCH, and the caller has to be able to tell
 * the difference: the install either happened or it did not, and if it happened
 * the built-in is now an installed starter whether or not the class was set. The
 * error is therefore re-thrown with the steps that had already succeeded, so the
 * surface can refresh and say what actually changed rather than implying
 * nothing did.
 */
export async function switchAgentClass(
	profile: { name: string; source?: unknown; action_class?: unknown },
	next: ActionClass,
	invoke: ClassSwitchInvoke,
	newId: () => string = () => crypto.randomUUID(),
): Promise<ReusableProfile | null> {
	if (classOf(profile) === next) return null;
	let result: ReusableProfile | null = null;
	const steps = classSwitchSteps(profile, next);
	for (let index = 0; index < steps.length; index += 1) {
		const step = steps[index];
		try {
			result = await invoke(step, newId());
		} catch (cause) {
			throw new ClassSwitchError(cause, steps.slice(0, index));
		}
	}
	return result;
}

/** A switch that failed, carrying what had already landed. */
export class ClassSwitchError extends Error {
	/** The steps that completed before the failure; empty when none did. */
	readonly completed: readonly ClassSwitchStep[];

	constructor(cause: unknown, completed: readonly ClassSwitchStep[]) {
		super(cause instanceof Error ? cause.message : String(cause));
		this.name = "ClassSwitchError";
		this.completed = completed;
	}
}

/**
 * What a failed switch says, given what the failure left behind.
 *
 * The sentence goes through the page's own `refusalCopy` for the same reason
 * every other failure on this pane does: the backend answers a refusal with
 * `str(exc)`, which for a validation error is a pydantic envelope around the one
 * sentence the operator can act on. A raw envelope beside the switch would be a
 * second refusal vocabulary on a page that already has one.
 *
 * The install-first case is the one that needs a second sentence: a failed CLASS
 * WRITE after a successful install has changed the record (the starter now has a
 * row and is editable) while leaving the class exactly as it was, and a reader
 * who is told only "that did not work" will not know why the agent's source chip
 * moved.
 */
export function classSwitchFailure(
	cause: unknown,
	completed: readonly ClassSwitchStep[],
): string {
	const raw =
		cause instanceof Error && cause.message
			? cause.message
			: "The class could not be changed.";
	const sentence = refusalCopy(raw).message;
	if (completed.some((step) => step.op === "profiles.install")) {
		return `${sentence} The agent was installed, so its class is unchanged but it is now editable.`;
	}
	return sentence;
}
