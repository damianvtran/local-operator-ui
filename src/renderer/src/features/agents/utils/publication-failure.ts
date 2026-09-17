/**
 * @file publication-failure.ts
 * @description What the publish dialog shows for each way a publication can be refused.
 *
 * The table is contract §6.2, and it exists because the refusals are not
 * interchangeable. "Somebody else published this name" asks for a different
 * name; "the reviewer refused these instructions" is a content decision that
 * retrying will never fix; "the review could not run" published nothing at all
 * and retrying is exactly right; a document the validator refused names the field
 * that is wrong. Collapsing those into one sentence leaves the user doing
 * something that cannot work, which is what the single prose toast did.
 *
 * Two rules bind the copy here. It never echoes the submitted instruction text
 * back at the user — a rejection screen is not a place to re-render harmful
 * content, and the author already has it — and it never quotes the reviewer's raw
 * output. Only the reviewer's own summary sentence and its category are shown.
 */

import { userFacingMessage } from "@shared/api/local-operator/desktop-api";
import type {
	ModerationCategory,
	PublicationDetails,
	PublicationErrorCode,
} from "@shared/api/local-operator/publication-errors";
import {
	isModerationCategory,
	isPublicationError,
} from "@shared/api/local-operator/publication-errors";
import { PUBLICATION_INSTRUCTIONS_MAX_CHARS } from "../../../../../shared/desktop-contract";

/**
 * The refusal, narrowed to what a treatment needs.
 *
 * Not `PublicationError` itself: the dialog also describes a refusal that carried
 * NO code — an older backend's prose — and a treatment that could only be built
 * from a typed error would have no branch for the state this app still supports.
 */
export type PublicationFailure = {
	code?: PublicationErrorCode;
	/** The sentence the backend or the hub wrote. Rendered unchanged. */
	message: string;
	details?: PublicationDetails;
};

/** An action the dialog can offer. The dialog owns what each one does. */
export type PublicationAction =
	| "focus-name"
	| "update-listing"
	| "install-builtin"
	| "retry"
	| "edit-instructions"
	| "refresh-hub";

export type PublicationTreatment = {
	/** `warning` for the one refusal that is not about the agent being wrong. */
	variant: "danger" | "warning";
	headline: string;
	body: string;
	/** A further sentence, shown under `body` — the reviewer's category line. */
	note: string | null;
	/** Ordered, first is primary. */
	actions: PublicationAction[];
	/** The field to mark as refused, when the refusal is about one. */
	focus: "name" | "instructions" | null;
};

export type PublicationContext = {
	/** The name being published, as the user typed it. */
	name: string;
	/** Whether a hub listing for this local agent is known, for "Update listing". */
	hubAgentId: string | null;
};

/**
 * One sentence per review category (contract §6.2).
 *
 * Keyed by the closed taxonomy rather than free text, so a category the reviewer
 * adds without a line here is a type error rather than a blank panel. An
 * unrecognised value from the wire falls back to `other_harmful`, which is what
 * the reviewer itself does with output it cannot place.
 */
const MODERATION_CATEGORY_LINE: Record<ModerationCategory, string> = {
	malware_or_exploitation:
		"Instructions to build or spread malware, or to attack systems you do not own, cannot be published.",
	credential_theft:
		"Instructions to obtain someone else's credentials or tokens cannot be published.",
	fraud_or_deception:
		"Instructions to deceive or defraud people cannot be published.",
	harassment_or_hate:
		"Instructions to harass, threaten or target people cannot be published.",
	sexual_content_minors:
		"This agent cannot be published. If you believe this is a mistake, contact support.",
	sexual_content: "Explicit sexual content cannot be published.",
	violence_or_weapons:
		"Instructions to build weapons or to injure people cannot be published.",
	drugs_or_controlled_substances:
		"Instructions to make or traffic illegal drugs cannot be published.",
	self_harm:
		"This agent cannot be published. If you believe this is a mistake, contact support.",
	mass_surveillance_or_privacy_abuse:
		"Instructions to surveil or profile people without their consent cannot be published.",
	evasion_or_abuse_tooling:
		"Instructions to evade or defeat safety and anti-abuse systems cannot be published.",
	prompt_injection:
		"This instruction set tries to instruct the reviewer rather than describe an agent, so it cannot be published.",
	unclear_dual_use:
		"We could not tell whether this is aimed at your own systems or someone else's. Add a sentence stating the scope and target, then publish again.",
	other_harmful:
		"This agent was rejected because its instructions would cause harm.",
};

/**
 * Whether a backend sentence is worth showing at all.
 *
 * The proxy passes the hub's own text through on its `hub_unavailable` arm, and
 * MEASURED against the deployed hub — which predates this contract, so it answers
 * that route with a bare `404 {"error":"Not Found"}` — the sentence under the
 * headline would be the two words "Not Found". That names neither what broke nor
 * what to do, and it reads as a fault in the app rather than in a dependency.
 * So a message that is not a sentence is replaced by one, and the caller's real
 * refusal (a code, a field, a category) is unaffected: those codes never reach
 * this arm.
 */
const isInformative = (message: string): boolean => {
	const trimmed = message.trim();
	return (
		trimmed.length > 12 &&
		/\s/.test(trimmed) &&
		!/^(not found|bad request|unauthorized|error|internal server error)\.?$/i.test(
			trimmed,
		)
	);
};

/** The line for the first category the reviewer cited, or the fallback. */
function moderationCategoryLine(details?: PublicationDetails): string {
	const first = details?.categories?.[0];
	return first && isModerationCategory(first)
		? MODERATION_CATEGORY_LINE[first]
		: MODERATION_CATEGORY_LINE.other_harmful;
}

/**
 * The body for a validator refusal, from the field and rule it names.
 *
 * The field-specific half of §6.2. `details.rule` is the hub's own rule text, so
 * the sentence is assembled rather than restated — a client that wrote its own
 * version of "between 1 and 8000 characters" is a second place for that bound to
 * live. When the rule is absent the field still gets the sentence that names it.
 */
function invalidDocumentBody(
	message: string,
	details?: PublicationDetails,
): { body: string; focus: "name" | "instructions" | null } {
	const rule = details?.rule ? ` ${details.rule}` : "";
	switch (details?.field) {
		case "name":
			return {
				body: `Name${rule || " is not acceptable"}.`,
				focus: "name",
			};
		case "instructions":
			return {
				body: rule
					? `The instruction body${rule}.`
					: `The instruction body must be between 1 and ${PUBLICATION_INSTRUCTIONS_MAX_CHARS} characters.`,
				focus: "instructions",
			};
		case "description":
			return { body: `Description${rule}.`, focus: null };
		case "tools":
			return { body: `Tools${rule}.`, focus: null };
		case "when_to_use":
			return { body: `When to use${rule}.`, focus: null };
		case "categories":
			return { body: `Categories${rule}.`, focus: null };
		case "tags":
			return { body: `Tags${rule}.`, focus: null };
		default:
			// Dialog-level, with the backend's own sentence: the field is one this
			// dialog has no control for (kind, version, document_type), so pointing at
			// a control would be pointing at nothing.
			return { body: message, focus: null };
	}
}

/**
 * How the dialog presents one refusal.
 *
 * The code switch is exhaustive over `PublicationErrorCode` and the default arm
 * is the PROSE fallback, which is a required state rather than a defensive one:
 * an older backend answers with a single `detail` string, and a 404 for an
 * unknown op means the backend predates this app entirely.
 */
export function publicationTreatment(
	failure: PublicationFailure,
	context: PublicationContext,
): PublicationTreatment {
	const name = context.name.trim() || "this agent";
	switch (failure.code) {
		case "name_taken": {
			const owned = failure.details?.owned_by_caller === true;
			if (owned) {
				return {
					variant: "danger",
					headline: "You already published this agent",
					body: `You published "${name}" already. Update that listing instead of publishing a second one.`,
					note: null,
					// "Update the existing listing" needs the listing id; without one
					// (a hub row this app never published, or an older app version) the
					// only honest offer is a different name.
					actions: context.hubAgentId
						? ["update-listing", "focus-name"]
						: ["focus-name"],
					focus: "name",
				};
			}
			return {
				variant: "danger",
				headline: "That name is taken",
				body: `"${name}" is already published on the hub by another account. Agent names are unique across the hub.`,
				note: null,
				actions: ["focus-name"],
				focus: "name",
			};
		}
		case "name_claim_in_flight":
			/*
			 * A DIFFERENT FACT FROM `name_taken`, which is why it has its own
			 * sentence and its own single action: another publication holds the
			 * seconds-long reservation for this name, nothing is published under it,
			 * and retrying is usually all it takes. Rendering it as "that name is
			 * taken" would push an author to abandon a name that is free a moment
			 * later, and the name field is NOT focused here for the same reason —
			 * there is nothing to change.
			 *
			 * `GET /v1/agent-name-availability` deliberately does not consult the
			 * reservation collection, so the live check can say "free" and the submit
			 * can still answer this. That is the expected shape of the two answers,
			 * not a contradiction: the check is a courtesy and the submit is what
			 * decides.
			 */
			return {
				variant: "warning",
				headline: "That name is being published right now",
				body: `Someone is publishing an agent called "${name}" at this moment. It is not claimed — try again in a moment.`,
				note: null,
				actions: ["retry"],
				focus: null,
			};
		case "name_reserved_builtin": {
			// The built-in's NAME is shown and its source URL is not: the name is what
			// the author has to stop using, and a link to where the hub's own
			// definition came from answers a question nobody asked here.
			const builtin = failure.details?.builtin_name;
			return {
				variant: "danger",
				headline: "That name is reserved",
				body: builtin
					? `"${builtin}" is the name of a built-in agent. Built-in names cannot be published to the hub.`
					: `"${name}" is the name of a built-in agent. Built-in names cannot be published to the hub.`,
				note: null,
				actions: ["focus-name", "install-builtin"],
				focus: "name",
			};
		}
		case "moderation_rejected":
			return {
				variant: "danger",
				headline: "This agent was not accepted",
				// The reviewer's own sentence, unchanged. `reason` when the backend
				// sent the bare reason, otherwise the composed message - both are the
				// reviewer's words, and neither is the instruction text.
				body: failure.details?.reason?.trim() || failure.message,
				note: moderationCategoryLine(failure.details),
				actions: ["edit-instructions"],
				focus: "instructions",
			};
		case "moderation_unavailable":
			return {
				// Warning, not danger: nothing about this agent is wrong, and the
				// danger register would tell the author their work was rejected.
				variant: "warning",
				headline: "Review is temporarily unavailable",
				body: "We could not review this agent just now. Nothing was published. Try again in a minute.",
				note: null,
				actions: ["retry"],
				focus: null,
			};
		case "invalid_instruction_set": {
			const { body, focus } = invalidDocumentBody(
				failure.message,
				failure.details,
			);
			return {
				variant: "danger",
				headline: "The agent document is not valid",
				body,
				note: null,
				actions: focus === "name" ? ["focus-name"] : [],
				focus,
			};
		}
		case "payload_too_large": {
			const limit = failure.details?.limit_bytes;
			return {
				variant: "danger",
				headline: "This agent is too large to publish",
				body: limit
					? `The instruction set is larger than ${Math.round(limit / 1024)} KiB. Shorten the instructions.`
					: "The instruction set is larger than the hub accepts. Shorten the instructions.",
				note: null,
				actions: [],
				focus: null,
			};
		}
		case "not_owner":
			return {
				variant: "danger",
				headline: "You cannot update this listing",
				body: "This listing belongs to another account.",
				note: null,
				actions: [],
				focus: null,
			};
		case "agent_not_found":
			return {
				variant: "danger",
				headline: "That listing no longer exists",
				body: "It may have been delisted.",
				note: null,
				actions: ["refresh-hub"],
				focus: null,
			};
		case "hub_unavailable":
			return {
				variant: "warning",
				headline: "The hub could not be reached",
				body: isInformative(failure.message)
					? failure.message
					: "The hub did not answer the way this app expects, so nothing was published. Try again, or update the backend if the hub has moved.",
				note: null,
				actions: ["retry"],
				focus: null,
			};
		case "local_failure":
			return {
				variant: "warning",
				headline: "The agent could not be published from this machine",
				body: failure.message,
				note: null,
				// Safe to retry: the failure happened before the hub was asked
				// anything, so no listing can exist from this attempt.
				actions: ["retry"],
				focus: null,
			};
		default:
			return {
				variant: "danger",
				headline: "The agent could not be published",
				body: failure.message,
				note: null,
				actions: [],
				focus: null,
			};
	}
}

/**
 * The prefix the pull path puts in front of every failure sentence.
 *
 * Two layers of it: the local route wraps the client's exception
 * (`Error downloading agent from Radient: ...`) and this client used to wrap the
 * route's own detail. Both are machine voice — they name the transport, not the
 * problem — so they are stripped before the sentence reaches a toast, and the
 * remainder is what the reader can act on.
 */
const PULL_PROSE_PREFIX =
	/^(?:Download agent from Radient failed: )?(?:Error downloading agent from Radient: )?\s*/;

/**
 * The sentence a refused pull shows, from the refusal's code when there is one.
 *
 * The pull's failures arrive through the same vocabulary as a publication's —
 * a hub row that is gone, a hub that cannot be reached, this machine failing to
 * write the row — so they are described here rather than in the hook, and tested
 * with them. The two codes with a genuinely different next step get their own
 * sentence; everything else keeps the backend's own words, because a pull has no
 * field to point at and no remedy this layer can invent.
 *
 * Deliberately no retry action: retrying is the user's to decide, and the hub's
 * 404 for a delisted agent is not something a retry can change.
 *
 * @param error - The failure the mutation caught
 * @param requestedName - The name the user asked for, for the message
 */
export const pullRefusalMessage = (
	error: unknown,
	requestedName: string,
): string => {
	const subject = requestedName.trim()
		? `"${requestedName.trim()}"`
		: "That agent";
	if (isPublicationError(error)) {
		switch (error.code) {
			case "agent_not_found":
				// The one refusal where nothing is worth retrying: the listing is gone.
				return `${subject} is no longer on the hub, so nothing was downloaded.`;
			case "hub_unavailable":
				return `The hub could not be reached, so ${subject} was not downloaded.`;
			default:
				return `${subject} was not downloaded: ${error.message}`;
		}
	}
	// No code: an older backend's prose, with the transport's machine-voice
	// prefixes stripped so what is left is the reason and not the route it came
	// from.
	const reason = userFacingMessage(error, "")
		.replace(PULL_PROSE_PREFIX, "")
		.trim();
	return reason
		? `${subject} was not downloaded: ${reason}`
		: `${subject} could not be downloaded.`;
};
