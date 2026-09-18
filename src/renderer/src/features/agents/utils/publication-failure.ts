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
import {
	PUBLICATION_INSTRUCTIONS_MAX_CHARS,
	publicationNameKey,
} from "../../../../../shared/desktop-contract";
import { isTransientTransportFailure } from "../../../../../shared/transport-failure";

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
	| "edit-agent"
	| "publish-as-new"
	| "sign-in"
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
): { body: string; field: string | null } {
	const rule = details?.rule ? ` ${details.rule}` : "";
	switch (details?.field) {
		case "name":
			return {
				body: `Name${rule || " is not acceptable"}.`,
				field: "name",
			};
		case "instructions":
			return {
				body: rule
					? `The instruction body${rule}.`
					: `The instruction body must be between 1 and ${PUBLICATION_INSTRUCTIONS_MAX_CHARS} characters.`,
				field: "instructions",
			};
		case "description":
			return { body: `Description${rule}.`, field: "description" };
		case "tools":
			return { body: `Tools${rule}.`, field: "tools" };
		case "when_to_use":
			return { body: `When to use${rule}.`, field: "when_to_use" };
		case "categories":
			return { body: `Categories${rule}.`, field: "categories" };
		case "tags":
			return { body: `Tags${rule}.`, field: "tags" };
		default:
			// Dialog-level, with the backend's own sentence: the field is one this
			// dialog has no control for (kind, version, document_type), so pointing at
			// a control would be pointing at nothing.
			return { body: message, field: null };
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
					// "Update the existing listing" needs a hub id. The REFUSAL'S OWN id is
					// preferred, because it names the row the hub just told us it holds;
					// the remembered one is the fallback. Gating the offer on the store
					// alone (as this did) printed "update that listing instead" beside a
					// single "Choose another name" — the copy naming a remedy the action
					// set did not contain — for exactly the reader who has no remembered
					// listing, which is every fresh profile and every agent published
					// before this app kept the link.
					actions:
						failure.details?.existing_agent_id || context.hubAgentId
							? ["update-listing", "focus-name"]
							: ["focus-name"],
				};
			}
			return {
				variant: "danger",
				headline: "That name is taken",
				body: `"${name}" is already published on the hub by another account. Agent names are unique across the hub.`,
				note: null,
				actions: ["focus-name"],
			};
		}
		case "name_claim_in_flight":
			/*
			 * A DIFFERENT FACT FROM `name_taken`, which is why it has its own
			 * sentence and its own single action: another publication holds the
			 * seconds-long reservation for this name, nothing is published under it,
			 * and retrying is usually all it takes. Rendering it as "that name is
			 * taken" would push an author to abandon a name that is free a moment
			 * later, and its single action is a retry rather than a route to the name
			 * field for the same reason — there is nothing to change there.
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
			};
		case "name_reserved_builtin": {
			/*
			 * THE SUBJECT IS THE NAME BEING PUBLISHED, and the built-in appears as the
			 * agent that reserves it — which is the shape the backend's own sentence
			 * has (`The name "<submitted>" is reserved by the built-in agent
			 * "<builtin>".`) and what `details.builtin_name` means: WHICH built-in
			 * reserved it, not which of the author's names was refused. The previous
			 * sentence made the built-in its subject, so a refusal of
			 * `adverse-media-screener` read `"reviewer" is the name of a built-in
			 * agent` — telling the reader to stop using a name that was not on their
			 * screen and never naming the one that was.
			 *
			 * The ``when the two names coincide`` arm is the common case: the
			 * reservation is keyed the way the local pre-check keys it, so a
			 * submitted name that IS the built-in's names the same string twice, and
			 * one clause says it once. The built-in's canonical SPELLING is still what
			 * is shown, which is the part the author has to type.
			 *
			 * Its source URL is not shown: a link to where the hub's definition came
			 * from answers a question nobody asked here.
			 */
			const builtin = failure.details?.builtin_name;
			const sameName = builtin
				? publicationNameKey(builtin) === publicationNameKey(name)
				: false;
			return {
				variant: "danger",
				headline: "That name is reserved",
				body:
					builtin && !sameName
						? `"${name}" is reserved by the built-in agent "${builtin}". Built-in names cannot be published to the hub.`
						: `"${builtin ?? name}" is the name of a built-in agent. Built-in names cannot be published to the hub.`,
				note: null,
				actions: ["focus-name", "install-builtin"],
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
			};
		case "invalid_instruction_set": {
			const { body, field } = invalidDocumentBody(
				failure.message,
				failure.details,
			);
			return {
				variant: "danger",
				headline: "The agent document is not valid",
				body,
				note: null,
				/*
				 * EVERY field this refusal can name gets a route, because the sentence
				 * names it and a body that says "the instruction body must be at most
				 * 8000 characters" beside a lone "Close" leaves the author with nothing
				 * to do. Two actions rather than one because they are two destinations
				 * in the reader's terms: the name is a control in THIS dialog, and the
				 * rest of the document is edited on the agent's own page — where the
				 * description and the instruction body both live, which is why they
				 * share one action rather than having one apiece.
				 */
				actions:
					field === "name"
						? ["focus-name"]
						: field === "instructions"
							? ["edit-instructions"]
							: ["edit-agent"],
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
				// The same route as `moderation_rejected`: the body says "shorten the
				// instructions", and this is where the instructions are. An empty
				// action set here made the one sentence and the one control disagree.
				actions: ["edit-instructions"],
			};
		}
		case "not_owner":
			/*
			 * The remembered listing is not addressable BY THIS ACCOUNT, and it is
			 * only this app's memory of the publication that made the app try to
			 * update it at all: a refusal here leaves the agent permanently
			 * unpublishable from the UI otherwise, because `submit` sends the
			 * remembered id on every later attempt. So the offer is the way out of
			 * the memory — publish this agent as a NEW listing — and it is explicit,
			 * so no publication happens that the user did not ask for.
			 */
			return {
				variant: "danger",
				headline: "You cannot update this listing",
				body: "This listing belongs to another account.",
				note: null,
				actions: ["publish-as-new"],
			};
		case "agent_not_found":
			// The other half of the same memory problem: the listing the app
			// remembers has been delisted, so every later attempt addresses a row
			// that is not there. Publishing as a new listing is the recovery;
			// "Refresh the hub" stays as the second step, for the reader who wants
			// to see for themselves that it is gone.
			return {
				variant: "danger",
				headline: "That listing no longer exists",
				body: "It may have been delisted.",
				note: null,
				actions: ["publish-as-new", "refresh-hub"],
			};
		case "hub_unauthorized":
			/*
			 * A REFUSED CREDENTIAL, WHICH IS NOT THE SAME FACT AS `isAuthenticated` —
			 * the local backend can hold a session the hub itself refuses, which is
			 * exactly when the backend emits this code. The remedy is re-running the
			 * Radient sign-in, and it is a control this dialog already owns, so the
			 * refusal offers it instead of rendering as the generic panel whose fix
			 * was two screens away.
			 */
			return {
				variant: "danger",
				headline: "The hub refused this machine's sign-in",
				body: "Nothing was published. Sign in to Radient again to replace the credential the hub refused, then publish again.",
				note: null,
				actions: ["sign-in"],
			};
		case "hub_unavailable":
			/*
			 * ONE TREATMENT, TWO CAUSES, so the headline asserts neither of them. This
			 * arm serves a hub that did not answer AND a hub that answered with
			 * something the transport routes here (a 429, most of all), and round 2's
			 * review named the consequence: "The hub could not be reached" is a lie for a
			 * hub that answered, at the one moment the user reads the headline rather
			 * than the body. The body carries the hub's own words when the transport
			 * handed any through, and the fallback no longer claims a reach failure
			 * either. Splitting the two would need a code the backend does not emit.
			 */
			return {
				variant: "warning",
				headline: "The publication did not go through",
				body: isInformative(failure.message)
					? failure.message
					: "Nothing was published. Try again in a moment, or update the backend if the hub has moved.",
				note: null,
				actions: ["retry"],
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
			};
		default:
			return {
				variant: "danger",
				headline: "The agent could not be published",
				body: failure.message,
				note: null,
				/*
				 * An untyped refusal — an older backend's single sentence, or a code this
				 * build does not know — has no field and no hub detail to build a remedy
				 * from, and the copy beside a lone "Close" left the author with nothing
				 * to do. `retry` is the one step that is honest at this level: nothing in
				 * this arm establishes that a second attempt is unsafe, and an attempt
				 * that fails again comes back with whatever the transport can author,
				 * which is either this panel once more or a code that has a real next
				 * step. It is NOT offered for a code with a known-bad retry — the state
				 * this arm exists beside says `local_failure` is safe and
				 * `moderation_rejected` is not, and guessing for an unknown code would
				 * undo that distinction.
				 */
				actions: ["retry"],
			};
	}
}

/**
 * The machine-voice wrappers the pull path puts in front of every failure
 * sentence.
 *
 * THREE layers, and the third is the one this app used to leave on screen. The
 * local route wraps the client's exception (`Error downloading agent from
 * Radient: ...`) and this client used to wrap the route's own detail; deeper
 * again the hub proxy composes `Failed to download agent <hub id> from Radient
 * Agent Hub due to a requests error: <repr>`, and the Python client's own
 * exception renders as `HTTPSConnectionPool(host='api.radienthq.com',
 * port=443): Read timed out.`
 *
 * MEASURED, both against the committed `refused-prose` frames and against a real
 * backend: stripping the outer two left the reader with an internal listing id, a
 * connection-pool class, a hostname, a port, a URL and the name of a Python
 * library — every one of them machinery, and the listing id the most misleading
 * of them, because it looks like a handle the reader could act on.
 *
 * Applied in order and each anchored at the START, because an anchored strip
 * cannot cut a word out of the middle of an authored sentence, which a global
 * replace would.
 */
const PULL_PROSE_WRAPPERS = [
	/^(?:Download agent from Radient failed: )?(?:Error downloading agent from Radient: )?\s*/,
	/^Failed to download agent(?: [^\s]+)? from Radient Agent Hub(?: due to a requests error)?:\s*/,
	// The exception repr: `HTTPSConnectionPool(host='…', port=443): ` and its
	// shorter siblings. Anchored on a NAME followed by a parenthesised argument
	// list, so an authored sentence that merely contains a bracket is left alone.
	/^[A-Za-z_][\w.]*\([^)]*\):\s*/,
];

/** The hub's own answer, as the Python client renders it: the status leads. */
const PULL_HUB_STATUS = /^(\d{3})\b/;

/** The statuses that mean the listing is gone rather than that the hub failed. */
const PULL_GONE_STATUSES = new Set([404, 410]);

/**
 * The transport families a PYTHON client reports, in the reader's vocabulary.
 *
 * The counterpart of `shared/transport-failure.ts`'s tables, which are built from
 * the Chromium `net::ERR_*` and Node errno families and deliberately do not list
 * these: the failure here is authored by a DIFFERENT process's HTTP client, so
 * extending that module's lists would change what MAIN retries for a failure main
 * will never see. Matched by clause rather than by exception class because the
 * class is stripped as machine voice above; the clause is what is left.
 */
const PULL_TRANSPORT_CLAUSES = [
	"read timed out",
	"connection timed out",
	"connection refused",
	"connection aborted",
	"connection reset",
	"connectionerror",
	"connecttimeout",
	"remote end closed connection",
	"max retries exceeded",
	"temporary failure in name resolution",
	"name or service not known",
	"no route to host",
];

/** Whether a residue is a transport failure rather than something the hub said. */
const isPullTransportFailure = (reason: string): boolean => {
	const lower = reason.toLowerCase();
	return (
		PULL_TRANSPORT_CLAUSES.some((clause) => lower.includes(clause)) ||
		// The families main already classifies, for the same reason: this app's own
		// transport can be the one that failed, and one table answering for both is
		// what keeps the two from drifting apart.
		isTransientTransportFailure(reason)
	);
};

/**
 * The sentence a refused pull shows, from the refusal's code when there is one.
 *
 * The pull's failures arrive through the same vocabulary as a publication's —
 * a hub row that is gone, a hub that cannot be reached, this machine failing to
 * write the row — so they are described here rather than in the hook, and tested
 * with them. The refusals whose transport the hub or the backend reports get the
 * sentence that fact deserves; anything else keeps the backend's own words,
 * because a pull has no field to point at and no remedy this layer can invent.
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
	/*
	 * No code: an older backend's prose. The wrappers come off first and what is
	 * left is CLASSIFIED, because a residue that is itself machine voice is not a
	 * reason — the two sentences below are the same ones the typed arms above use
	 * for the same two facts, so a hub that is unreachable reads the same whether
	 * the backend that tried to reach it could say so in a code or not.
	 */
	const reason = PULL_PROSE_WRAPPERS.reduce(
		(text, wrapper) => text.replace(wrapper, ""),
		userFacingMessage(error, "").trim(),
	).trim();
	if (!reason) return `${subject} could not be downloaded.`;
	const status = Number(PULL_HUB_STATUS.exec(reason)?.[1] ?? Number.NaN);
	if (PULL_GONE_STATUSES.has(status))
		return `${subject} is no longer on the hub, so nothing was downloaded.`;
	if (isPullTransportFailure(reason) || status === 408)
		return `The hub could not be reached, so ${subject} was not downloaded.`;
	/*
	 * THE STATUSES THAT MEAN THE HUB ANSWERED, said as themselves. Round 2's
	 * R16/R21 named this defect on the publish side and round 3's M3 found the same
	 * weld here: a 429, a 401/403 and a 5xx all arrived at "could not be reached",
	 * which is a reach failure — asserted at the one moment the user reads the
	 * sentence rather than the machinery behind it. A 429 is the retryable one and
	 * says so; a 401/403 is a credential refusal, which is the same fact the typed
	 * `hub_unauthorized` arm words for the publish path; a 5xx is the hub failing
	 * its own work, not silence. Only a transport failure (or a 408, which is the
	 * request timing out with no answer at all) is a reach failure.
	 */
	if (status === 429)
		return `The hub is busy, so ${subject} was not downloaded. Try again in a moment.`;
	if (status === 401 || status === 403)
		return `The hub refused this machine's sign-in, so ${subject} was not downloaded.`;
	if (status >= 500)
		return `The hub could not complete the download, so ${subject} was not downloaded. Try again in a moment.`;
	if (status >= 400)
		return `The hub refused the download, so ${subject} is not here.`;
	// An authored sentence the hub or the backend wrote: shown as it is, which is
	// what the two arms above exist to avoid doing with machinery.
	return `${subject} was not downloaded: ${reason}`;
};
