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

import { backendLoadErrorMessage } from "@shared/api/local-operator/backend-error";
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
import { t } from "@shared/i18n";
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
	/**
	 * WHICH SURFACE is asking, for the arms whose words name the act.
	 *
	 * The roster renders this same table for a PULL (agent review round 1's n1),
	 * and several bodies were authored for a publication — "Nothing was published",
	 * "then publish again". A table shared by two surfaces has to say which one is
	 * speaking, or the roster tells the user something that did not happen (copy
	 * review round 2, C7). Absent means `"publish"`, which is what every caller was
	 * before the roster read this table.
	 */
	surface?: "publish" | "pull";
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
	get malware_or_exploitation() {
		return t("ui.agents.publication.category.malware_or_exploitation");
	},
	get credential_theft() {
		return t("ui.agents.publication.category.credential_theft");
	},
	get fraud_or_deception() {
		return t("ui.agents.publication.category.fraud_or_deception");
	},
	get harassment_or_hate() {
		return t("ui.agents.publication.category.harassment_or_hate");
	},
	get sexual_content_minors() {
		return t("ui.agents.publication.category.sexual_content_minors");
	},
	get sexual_content() {
		return t("ui.agents.publication.category.sexual_content");
	},
	get violence_or_weapons() {
		return t("ui.agents.publication.category.violence_or_weapons");
	},
	get drugs_or_controlled_substances() {
		return t("ui.agents.publication.category.drugs_or_controlled_substances");
	},
	get self_harm() {
		return t("ui.agents.publication.category.self_harm");
	},
	get mass_surveillance_or_privacy_abuse() {
		return t(
			"ui.agents.publication.category.mass_surveillance_or_privacy_abuse",
		);
	},
	get evasion_or_abuse_tooling() {
		return t("ui.agents.publication.category.evasion_or_abuse_tooling");
	},
	get prompt_injection() {
		return t("ui.agents.publication.category.prompt_injection");
	},
	get unclear_dual_use() {
		return t("ui.agents.publication.category.unclear_dual_use");
	},
	get other_harmful() {
		return t("ui.agents.publication.category.other_harmful");
	},
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
	/*
	 * The hub's rule text is DATA and stays verbatim, but its position is not:
	 * the sentence around it is catalogue copy with `{rule}` in it, so a locale
	 * can put the rule where its own grammar wants it. Trimmed because the
	 * message supplies the separator space (ICU collapses a leading space).
	 */
	const rule = details?.rule?.trim() ?? "";
	switch (details?.field) {
		case "name":
			return {
				body: rule
					? t("ui.agents.publication.invalid.field.name_with_rule", { rule })
					: t("ui.agents.publication.invalid.field.name"),
				field: "name",
			};
		case "instructions":
			return {
				body: rule
					? t("ui.agents.publication.invalid.field.instructions_with_rule", {
							rule,
						})
					: t("ui.agents.publication.invalid.field.instructions", {
							/*
							 * A character COUNT interpolated as a literal, because an ICU
							 * number placeholder would group thousands (8,000) and change the
							 * English this line already renders.
							 */
							max: String(PUBLICATION_INSTRUCTIONS_MAX_CHARS),
						}),
				field: "instructions",
			};
		case "description":
			return {
				body: rule
					? t("ui.agents.publication.invalid.field.description_with_rule", {
							rule,
						})
					: t("ui.agents.publication.invalid.field.description"),
				field: "description",
			};
		case "tools":
			return {
				body: rule
					? t("ui.agents.publication.invalid.field.tools_with_rule", { rule })
					: t("ui.agents.publication.invalid.field.tools"),
				field: "tools",
			};
		case "when_to_use":
			return {
				body: rule
					? t("ui.agents.publication.invalid.field.when_to_use_with_rule", {
							rule,
						})
					: t("ui.agents.publication.invalid.field.when_to_use"),
				field: "when_to_use",
			};
		case "categories":
			return {
				body: rule
					? t("ui.agents.publication.invalid.field.categories_with_rule", {
							rule,
						})
					: t("ui.agents.publication.invalid.field.categories"),
				field: "categories",
			};
		case "tags":
			return {
				body: rule
					? t("ui.agents.publication.invalid.field.tags_with_rule", { rule })
					: t("ui.agents.publication.invalid.field.tags"),
				field: "tags",
			};
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
	const pulling = context.surface === "pull";
	/*
	 * The two result phrases every arm used to read (`nothingLanded`, `again`)
	 * are GONE ON PURPOSE. Stitching "Nothing was published." and "then publish
	 * again" out of fragments fixes English word order and hands a translator two
	 * clauses it cannot reorder; a whole message per surface (`body`, `body_pull`)
	 * buys a sentence each locale can write in its own order.
	 *
	 * What stays resolved once is the SUBJECT: with no name to quote, the sentence
	 * still has to say "this agent" or "this team" in the reader's language, so the
	 * fallback is a message rather than a literal, read here where the refusal
	 * renders.
	 */
	const bareName = context.name.trim();
	const name = bareName
		? bareName
		: pulling
			? t("ui.agents.publication.subject.team")
			: t("ui.agents.publication.subject.agent");
	switch (failure.code) {
		case "name_taken": {
			const owned = failure.details?.owned_by_caller === true;
			if (owned) {
				return {
					variant: "danger",
					headline: t("ui.agents.publication.name_taken.owned_headline"),
					body: t("ui.agents.publication.name_taken.owned_body", {
						name,
					}),
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
				headline: t("ui.agents.publication.name_taken.headline"),
				body: t("ui.agents.publication.name_taken.body", { name }),
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
				headline: t("ui.agents.publication.name_claim_in_flight.headline"),
				body: t("ui.agents.publication.name_claim_in_flight.body", {
					name,
				}),
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
				headline: t("ui.agents.publication.name_reserved_builtin.headline"),
				body:
					builtin && !sameName
						? t("ui.agents.publication.name_reserved_builtin.body", {
								name,
								builtin,
							})
						: t("ui.agents.publication.name_reserved_builtin.body_same_name", {
								builtin: builtin ?? name,
							}),
				note: null,
				actions: ["focus-name", "install-builtin"],
			};
		}
		case "moderation_rejected":
			return {
				variant: "danger",
				headline: t("ui.agents.publication.moderation_rejected.headline"),
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
				headline: t("ui.agents.publication.moderation_unavailable.headline"),
				body: t("ui.agents.publication.moderation_unavailable.body"),
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
				headline: t("ui.agents.publication.invalid.headline"),
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
				headline: t("ui.agents.publication.payload_too_large.headline"),
				body: limit
					? t("ui.agents.publication.payload_too_large.body_with_limit", {
							/*
							 * A byte size in KiB, interpolated as a literal for the same reason the
							 * character bound is: an ICU number would group thousands and change
							 * the English this line renders.
							 */
							size: String(Math.round(limit / 1024)),
						})
					: t("ui.agents.publication.payload_too_large.body"),
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
				headline: t("ui.agents.publication.not_owner.headline"),
				body: t("ui.agents.publication.not_owner.body"),
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
				headline: t("ui.agents.publication.agent_not_found.headline"),
				body: t("ui.agents.publication.agent_not_found.body"),
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
				headline: t("ui.agents.publication.hub_unauthorized.headline"),
				body: pulling
					? t("ui.agents.publication.hub_unauthorized.body_pull")
					: t("ui.agents.publication.hub_unauthorized.body"),
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
				headline: pulling
					? t("ui.agents.publication.hub_unavailable.headline_pull")
					: t("ui.agents.publication.hub_unavailable.headline"),
				body: isInformative(failure.message)
					? failure.message
					: pulling
						? t("ui.agents.publication.hub_unavailable.body_pull")
						: t("ui.agents.publication.hub_unavailable.body"),
				note: null,
				actions: ["retry"],
			};
		case "local_failure":
			return {
				variant: "warning",
				headline: pulling
					? t("ui.agents.publication.local_failure.headline_pull")
					: t("ui.agents.publication.local_failure.headline"),
				body: failure.message,
				note: null,
				// Safe to retry: the failure happened before the hub was asked
				// anything, so no listing can exist from this attempt.
				actions: ["retry"],
			};
		case "team_plan_required":
			/*
			 * THE PLAN HALF OF §3.2, which the picker already guards against and which
			 * a plan can still lapse into between the render and the press. `past_due`
			 * is NOT this state (§3.1 gives it full entitlements during dunning), so a
			 * user reading this headline knows the subscription genuinely stopped.
			 */
			return {
				variant: "warning",
				headline: t("ui.agents.publication.team_plan_required.headline"),
				body: pulling
					? t("ui.agents.publication.team_plan_required.body_pull")
					: t("ui.agents.publication.team_plan_required.body"),
				note: null,
				// Safe to retry, and the only step this dialog can take: the plan is
				// activated on the console, and a retry is what a user who has just
				// done that needs. Nothing was published.
				actions: ["retry"],
			};
		case "not_a_member":
			return {
				variant: "danger",
				headline: t("ui.agents.publication.not_a_member.headline"),
				body: pulling
					? t("ui.agents.publication.not_a_member.body_pull")
					: t("ui.agents.publication.not_a_member.body"),
				note: null,
				/*
				 * NO ACTION, deliberately. The remedy is somebody else's (an owner has to
				 * invite this account), so every control this dialog could offer would be
				 * one that cannot help — and a lone "Close" beside a sentence that names
				 * the person who can is honest where a "Try again" would be a loop.
				 */
				actions: [],
			};
		case "insufficient_role": {
			/*
			 * The rank the hub named (`details.required`), carried rather than
			 * restated: this app does not hold the membership matrix, and a client that
			 * wrote its own "admins and owners" sentence is a second place for §2.1 to
			 * be got wrong.
			 */
			const required = failure.details?.required;
			return {
				variant: "danger",
				headline: t("ui.agents.publication.insufficient_role.headline"),
				body: required
					? t(
							pulling
								? "ui.agents.publication.insufficient_role.body_with_role_pull"
								: "ui.agents.publication.insufficient_role.body_with_role",
							{ required },
						)
					: t(
							pulling
								? "ui.agents.publication.insufficient_role.body_pull"
								: "ui.agents.publication.insufficient_role.body",
						),
				note: null,
				actions: [],
			};
		}
		case "team_not_found":
			/*
			 * The pull's own refusal (§4.5): the document was delisted between the list
			 * and the press. "Refresh the hub" is the step that shows the roster the
			 * server now has rather than retrying a read that will answer the same.
			 */
			return {
				variant: "danger",
				headline: t("ui.agents.publication.team_not_found.headline"),
				body: t("ui.agents.publication.team_not_found.body"),
				note: null,
				actions: ["refresh-hub"],
			};
		default:
			return {
				variant: "danger",
				headline: t("ui.agents.publication.fallback.headline"),
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
		? t("ui.agents.publication.subject.name", {
				name: requestedName.trim(),
			})
		: t("ui.agents.publication.subject.unknown");
	if (isPublicationError(error)) {
		switch (error.code) {
			case "agent_not_found":
				// The one refusal where nothing is worth retrying: the listing is gone.
				return t("ui.agents.publication.pull.not_found", { subject });
			case "hub_unavailable":
				/*
				 * The typed twin of the arm above, and it serves the same TWO causes -
				 * a hub that did not answer and a hub that answered with something the
				 * transport codes as `hub_unavailable` (a 429 or a 5xx, most of all).
				 * Round 4's M4-1 found it still asserting a reach failure for a hub
				 * that had spoken, which is the defect round 2 filed on the publish
				 * side and round 3's M3 fixed on this path's prose arm. The sentence
				 * names the outcome instead, so it holds for both; the PROSE arm keeps
				 * its reach-failure wording, because a transport failure really is one.
				 */
				return t("ui.agents.publication.pull.hub_unavailable", { subject });
			default:
				return t("ui.agents.publication.pull.refused", {
					subject,
					reason: error.message,
				});
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
	if (!reason) return t("ui.agents.publication.pull.no_reason", { subject });
	const status = Number(PULL_HUB_STATUS.exec(reason)?.[1] ?? Number.NaN);
	if (PULL_GONE_STATUSES.has(status))
		return t("ui.agents.publication.pull.not_found", { subject });
	if (isPullTransportFailure(reason) || status === 408)
		return t("ui.agents.publication.pull.reach_failure", { subject });
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
	if (status === 429) return t("ui.agents.publication.pull.busy", { subject });
	if (status === 401 || status === 403)
		return t("ui.agents.publication.pull.sign_in_refused", { subject });
	if (status >= 500)
		return t("ui.agents.publication.pull.incomplete", { subject });
	if (status >= 400)
		return t("ui.agents.publication.pull.refused_download", { subject });
	// An authored sentence the hub or the backend wrote: shown as it is, which is
	// what the two arms above exist to avoid doing with machinery.
	return t("ui.agents.publication.pull.prose", { subject, reason });
};

/**
 * The lead both non-pull actions are classified under, kept here so the two
 * surfaces that show it cannot drift into two spellings of one sentence.
 *
 * It asserts no cause on its own: `backendLoadErrorMessage` appends the diagnosis
 * and the remedy for whatever the LOCAL server did.
 */
const otherActionLead = (): string =>
	t("ui.agents.publication.other_action_lead");

/**
 * The sentence for a failed action on an agent, by which action failed.
 *
 * THE PULL IS NOT A LOCAL-SERVER CALL, and it is the one action on these
 * surfaces whose refusal is authored by the hub. It has its own vocabulary
 * (`pullRefusalMessage` above, from the same refusals a publication meets), and
 * the other three have `backendLoadErrorMessage`, which classifies the failure
 * against the process that serves this app.
 *
 * Asking the local classifier about a hub refusal is what this function exists to
 * make impossible: a 404 `agent_not_found` arrived as "the Local Operator server
 * is older than this app expects" and a 503 `hub_unavailable` as "restart the app
 * so it can start its own server" - two sentences that are true about the wrong
 * process, each sending the user to a remedy that cannot work, and three more
 * refusals arrived as "The action did not complete." with no reason at all
 * (design round 3, D1).
 *
 * ONE FUNCTION RATHER THAN THE SAME LADDER TWICE. The card container and the
 * details page each render "whichever action failed", and two hand-written
 * `action === "download"` branches are how one fact becomes two - silently, and
 * in the direction that costs the user, because only one of the two surfaces
 * would keep naming the right culprit.
 *
 * @param action - Which control produced the failure
 * @param error - The failure the mutation caught
 * @param agentName - The agent the action was about, for the pull's subject
 */
export const agentActionFailureMessage = (
	action: "like" | "favourite" | "download" | "delist",
	error: unknown,
	agentName: string,
): string =>
	action === "download"
		? pullRefusalMessage(error, agentName)
		: backendLoadErrorMessage(otherActionLead(), error);

/**
 * The label one treatment action renders with.
 *
 * HERE rather than in the dialog that first needed it (agent review round 1,
 * n1): the actions are declared in THIS file, so their labels belong beside
 * them, and the roster became a second consumer the moment `team_not_found`'s
 * `refresh-hub` arm was wired to it. A second table would let one action read
 * two ways on two surfaces, which is the shape this file exists to prevent.
 */
export const PUBLICATION_ACTION_LABEL: Record<PublicationAction, string> = {
	get "focus-name"() {
		return t("ui.agents.publication.action.focus_name");
	},
	get "update-listing"() {
		return t("ui.agents.publication.action.update_listing");
	},
	get "install-builtin"() {
		return t("ui.agents.publication.action.install_builtin");
	},
	get retry() {
		return t("ui.agents.publication.action.retry");
	},
	get "edit-instructions"() {
		return t("ui.agents.publication.action.edit_instructions");
	},
	get "edit-agent"() {
		return t("ui.agents.publication.action.edit_agent");
	},
	get "publish-as-new"() {
		return t("ui.agents.publication.action.publish_as_new");
	},
	get "sign-in"() {
		return t("ui.agents.publication.action.sign_in");
	},
	get "refresh-hub"() {
		return t("ui.agents.publication.action.refresh_hub");
	},
};
