/**
 * Remote compute as VALUES: the picker's row, the sheet's list, the run card's
 * sentences, and which remedy a refusal earns.
 *
 * WHY A PURE MODULE BESIDE THE COMPONENTS. Every rule in this family is a CLAIM
 * about money, time or access - "this is ready", "this one run holds $5.09", "the
 * binding is recorded but not enforced" - and a claim written inside JSX can only be
 * checked by looking at a picture. So the row states, the aggregate arithmetic, the
 * tier list and the card's sentences are functions here, and the components paint
 * what they return. The frames then photograph the same values these tests pin.
 *
 * THE THREE THINGS THIS FILE REFUSES TO SAY, and each one is load bearing:
 *
 * - A PRICE. `pricing` is `null` on the wire today, so no rate, per hour or per
 *   task, can be printed: the surfaces show the HOLD the server reports and the
 *   settled charge once it settles. A constant here would drift from the
 *   deployment's own configuration the first time it changes.
 * - THAT A BINDING IS ENFORCED. A run carries `network_id` and the sheet shows it,
 *   because the user has to see which mesh the run joins. In this version the
 *   binding is RECORDED, not enforced - so every sentence says recorded, and none
 *   offers "isolated", "segmented" or "private" as its promise.
 * - THAT A RUN WENT AWAY. `null` amounts, absent timestamps and unknown statuses
 *   are stated as gaps. A row that prints `$0.00` for a hold nobody reported is
 *   making money up.
 *
 * WHERE THE STATES COME FROM. The picker's Radient group is not a device: it has no
 * id, no presence and no sessions. Its states are the capability read's own answer
 * plus the live-run rows, and `radientRowView` decides which one wins when several
 * are true - the order is documented on the function because it is the design's
 * disagreement resolver, not an implementation detail.
 */

import { t } from "@shared/i18n";
import {
	formatDuration,
	formatNumber,
	formatUsd,
} from "../../../../i18n/format";
import type {
	RemoteComputeRead,
	RemoteNetwork,
	RemoteRun,
	RemoteRunPhase,
} from "./remote-compute-types";
import { remoteRunPhase, remoteRunStatusKnown } from "./remote-compute-types";

/* ------------------------------------------------------------ the picker row */

/**
 * One row's rendered shape.
 *
 * `label` is the trailing fact the row prints after `Radient`; `sentence` is the
 * accessible name, which is where the state's consequence lives (a dropdown row is
 * two words wide, so the remedy cannot be in `label`).
 *
 * THE STATUS SLOT IS FOR THE PRESSABLE STATES ONLY (design round 1, D2). A row that
 * cannot act says why on a REASON LINE of its own - the same shape and ink the
 * picker's ineligible device rows already use (`row.why`, `text-warning`) - rather
 * than in the right-hand slot where `ready` and the aggregate live. Two rows in one
 * column that look identical at rest but behave differently is the defect: a menu is
 * photographed the moment it opens, when hover has said nothing.
 *
 * `facts` is the aggregate as PARTS, so the row paints its middots as their own spans
 * instead of joining them into one string - the rule the run card records
 * (`remote-run-card.tsx`), because a translated separator is not a separator this
 * file may concatenate.
 *
 * `hidden` is state A and it is a VALUE rather than an absent render, because the
 * caller's spread is what makes the group disappear - a component that returned
 * `null` for one state and a node for the next is how a group survives a flag it
 * was supposed to obey.
 */
export type RadientRowView =
	| { kind: "hidden" }
	| { kind: "loading"; label: string; sentence: string }
	/** The on-ramp: selecting this row starts the sign-in (state B). */
	| { kind: "sign-in"; label: string; sentence: string }
	| { kind: "ready"; label: string; sentence: string }
	/** Live runs: the aggregate is on the row (state D). */
	| {
			kind: "runs";
			label: string;
			/** The same words `label` joins, one span each. */
			facts: string[];
			sentence: string;
			count: number;
			/** Saturated: the wire's cap is the count's own wording. */
			capped: boolean;
	  }
	/** Capacity cannot be provisioned now; selecting re-reads (state E). */
	| { kind: "capacity"; reason: string[]; sentence: string }
	/** No network to bind to; the row states the remedy and is not selectable (F). */
	| {
			kind: "network";
			reason: string[];
			/** The remedy this app can name, VISIBLE and not only in `sentence` (UX U3). */
			note: string;
			sentence: string;
	  }
	/** The deployment does not offer the family; disabled with its own sentence (G). */
	| { kind: "not-offered"; reason: string[]; sentence: string };

/** The capability read as the picker sees it. */
export type RadientRowRead =
	| { state: "loading" }
	| { state: "failed" }
	| { state: "answered"; value: RemoteComputeRead };

export type RadientRowInput = {
	read: RadientRowRead;
	/** Epoch milliseconds; the aggregate's ages are measured against it. */
	now: number;
	/** The row's own width band: below 700px the duration loses its seconds. */
	narrow?: boolean;
};

/** The count past which the row states `9+`: a truncated count must not hide. */
export const RADIENT_COUNT_CAP = 9;

/**
 * Which state the row is in.
 *
 * THE ORDER IS THE DESIGN'S RESOLVER, and it decides every case where two facts are
 * true at once:
 *
 * 0. `loading` - nobody has answered yet: the row exists and says so, because a
 *    group that appeared only once the read answered would pop in under the pointer.
 * 1. `hidden` - the read said the family is off, or the read failed before an
 *    answer. A group that appears before its switch has been read is a flicker that
 *    promises a capability.
 * 2. `not-offered` - the deployment's own switch is off. This outranks the account
 *    because signing in would not help: the sentence must not send a user to a
 *    sign-in for a service their server does not run.
 * 3. `sign-in` - the account is signed out or expired. Outranks capacity because it
 *    is the on-ramp rather than a fault, and a signed-out read has no capacity to
 *    report.
 * 4. `capacity` - no ready tier, or a read that failed (a read error has no state of
 *    its own: what the user can do about it is the same re-read). Outranks the
 *    network state because neither can be fixed by the user's next action if
 *    provisioning is down.
 * 5. `network` - nothing to bind to. A run that cannot be recorded against a network
 *    is a run this surface may not offer.
 * 6. `runs` - live runs exist, so the aggregate leads.
 * 7. `ready` - the calm state.
 */
export function radientRowView(input: RadientRowInput): RadientRowView {
	const { read, now, narrow = false } = input;
	if (read.state === "loading") {
		return {
			kind: "loading",
			label: t("ui.chat.remote_compute.row.checking"),
			sentence: t("ui.chat.remote_compute.row.sentence.checking"),
		};
	}
	if (read.state === "failed") {
		return {
			kind: "capacity",
			reason: [
				t("ui.chat.remote_compute.row.capacity"),
				t("ui.chat.remote_compute.row.retry"),
			],
			sentence: t("ui.chat.remote_compute.row.sentence.capacity"),
		};
	}
	const value = read.value;
	if (!value.enabled) return { kind: "hidden" };
	if (value.offered === false) {
		return {
			kind: "not-offered",
			reason: [t("ui.chat.remote_compute.row.not_offered")],
			sentence: t("ui.chat.remote_compute.row.sentence.not_offered"),
		};
	}
	if (!value.account || value.account.state !== "signed-in") {
		return {
			kind: "sign-in",
			label: t("ui.chat.remote_compute.row.sign_in"),
			sentence: t("ui.chat.remote_compute.row.sentence.sign_in"),
		};
	}
	if (!cloudRunReady(value)) {
		return {
			kind: "capacity",
			reason: [
				t("ui.chat.remote_compute.row.capacity"),
				t("ui.chat.remote_compute.row.retry"),
			],
			sentence: t("ui.chat.remote_compute.row.sentence.capacity"),
		};
	}
	if (value.networks.length === 0) {
		return {
			kind: "network",
			reason: [t("ui.chat.remote_compute.row.needs_network")],
			/*
			 * THE REMEDY IS SHOWN, NOT HID IN THE ACCESSIBLE NAME (UX U3, design D2). The
			 * row's own words used to end in `create one`, an imperative with nothing to
			 * press behind it: network creation is CLI-only, and the sentence naming the
			 * command was attached to enabled rows only - so the one state that needs it
			 * never showed it. `DeviceGuidance` in this same picker sets the precedent:
			 * the honest instruction is visible text.
			 */
			note: t("ui.chat.remote_compute.row.network_remedy"),
			sentence: t("ui.chat.remote_compute.row.sentence.network"),
		};
	}
	const live = liveRuns(value.active);
	if (live.length > 0) {
		const aggregate = radientAggregate(live, now, narrow);
		return {
			kind: "runs",
			label: aggregate.label,
			facts: aggregate.facts,
			sentence: aggregate.sentence,
			count: live.length,
			capped: live.length > RADIENT_COUNT_CAP,
		};
	}
	return {
		kind: "ready",
		label: t("ui.chat.remote_compute.row.ready"),
		sentence: t("ui.chat.remote_compute.row.sentence.ready"),
	};
}

/**
 * Whether the tier v1 offers can be provisioned.
 *
 * AN EMPTY CAPACITY LIST IS NOT READY. The route publishes readiness per tier, and a
 * list that names none has told us nothing about provisioning - drawing `ready` off
 * an unanswered question is the one claim this row exists to avoid, and the remedy
 * it does offer (a re-read) is cheap.
 *
 * THE TIER TOKEN IS THE WIRE'S (`cloud_run`), matched literally, because it is also
 * the token `POST …/runs` accepts. A deployment that renamed its tiers would show
 * "capacity unavailable" here rather than a row that promises a tier it cannot
 * route; that bound is stated rather than guessed around.
 */
export function cloudRunReady(value: RemoteComputeRead): boolean {
	return value.capacity.some(
		(entry) => entry.tier === "cloud_run" && entry.ready,
	);
}

/** The rows that are still in flight, in the order the server sent them. */
export function liveRuns(runs: RemoteRun[]): RemoteRun[] {
	return runs.filter((run) => remoteRunPhase(run.status) === "in-flight");
}

/**
 * The aggregate a row with live runs prints.
 *
 * THE MONEY IS A SUM OF `hold_usd` AND NOTHING ELSE: a hold is the committed maximum
 * while the run is unsettled, which is the only number that is true at this moment.
 * A run that publishes no hold contributes nothing and is NOT counted as zero - if
 * no run publishes one, the money clause disappears rather than printing `$0.00`.
 *
 * THE DURATION IS THE OLDEST LIVE AGE, from `started_at` - a server fact, never a
 * client clock started when this window opened the picker. A run with no
 * `started_at` contributes no age, so a list of them prints the count and the money
 * and says nothing about time.
 *
 * THE COUNT SATURATES AND THE MONEY DOES NOT: a truncated count that hides spend is
 * the one truncation that costs money (design §2.7). The narrow band drops the
 * duration's seconds first, because a run existing is the fact and its precision is
 * the detail.
 */
export function radientAggregate(
	runs: RemoteRun[],
	now: number,
	narrow: boolean,
): { label: string; facts: string[]; sentence: string } {
	const count = runs.length;
	const capped = count > RADIENT_COUNT_CAP;
	const countText = capped
		? t("ui.chat.remote_compute.row.runs_capped", {
				count: formatNumber(RADIENT_COUNT_CAP, { maximumFractionDigits: 0 }),
			})
		: t("ui.chat.remote_compute.row.runs", { count });
	const startedAt = runs
		.map((run) => run.started_at)
		.filter((at): at is number => at !== null);
	const age =
		startedAt.length > 0
			? Math.max(0, Math.round((now - Math.min(...startedAt)) / 1000))
			: null;
	const duration =
		age === null
			? null
			: formatDuration(narrow ? Math.floor(age / 60) * 60 : age);
	const holds = runs
		.map((run) => run.hold_usd)
		.filter((amount): amount is number => amount !== null);
	const held =
		holds.length > 0
			? t("ui.chat.remote_compute.row.held", {
					amount: formatUsd(holds.reduce((total, amount) => total + amount, 0)),
				})
			: null;
	const facts = [countText, duration, held].filter(
		(part): part is string => part !== null,
	);
	return {
		/*
		 * `label` IS NOT WHAT THE ROW PAINTS any more: the row draws `facts` as spans
		 * with their own separators (agent review n5). It stays because the accessible
		 * name is one string by definition, and it is derived from the same list.
		 */
		label: facts.join(" · "),
		facts,
		sentence: t("ui.chat.remote_compute.row.sentence.runs", {
			count: countText,
			/*
			 * THE SENTENCE CARRIES EVERY FACT THE ROW PRINTS, so a screen reader hears the
			 * same claim a sighted reader does - the aggregate is the whole point of the
			 * state, and an accessible name that said only "Radient" would hide the money.
			 * The suffix arrives with its own separator so a row with no duration and no
			 * hold cannot leave a dangling conjunction in any language.
			 */
			factsSuffix: facts.length > 1 ? ` · ${facts.slice(1).join(" · ")}` : "",
		}),
	};
}

/* ------------------------------------------------------------- the tier list */

/** The two tiers the sheet draws. `dedicated` is disabled in v1 and says so. */
export type RemoteTier = "cloud_run" | "dedicated";

export type RemoteTierRow = {
	tier: RemoteTier;
	title: string;
	/** One fact about the tier's shape, never a price. */
	note: string;
	disabled: boolean;
	/**
	 * Why the row stands down, in the words the state came in.
	 *
	 * Only a TIER fact lives here (`capacity unavailable`). The network's stand-down
	 * is stated once, beside the disabled primary, where the press would happen
	 * (design round 1, D7): three phrasings of one decision in one column read as
	 * three separate things to fix.
	 */
	why: string | null;
	/**
	 * The opt-in nested UNDER this tier, when the product has one.
	 *
	 * Only `Dedicated` carries one, and it is drawn rather than hidden for the same
	 * reason the disabled tier is: "cheaper, interruptible" is a product fact a user
	 * will ask about, and a version that cannot sell it yet says so in one line
	 * instead of leaving them to conclude the app does not know.
	 *
	 * NO REASON OF ITS OWN (design round 1, D4): Spot is an opt-in inside an already
	 * unavailable tier, so its own unavailability adds nothing - and printing
	 * `coming soon` twice, forty pixels apart, made the reason the loudest thing in
	 * the group.
	 */
	spot: { title: string; note: string } | null;
};

/* --------------------------------------------------------------- the sheet */

export type RemoteSheetInput = {
	value: RemoteComputeRead;
	/** The conversation's own composer text, as typed. */
	prompt: string;
	/** The directory the run will start in, as this pane knows it. */
	directory: string;
	/** A network the user picked in this sheet, or `null` for "nobody chose". */
	chosenNetworkId: string | null;
};

export type RemoteSheetModel = {
	heading: string;
	network: {
		/** The row that is pre-selected: only ever an unambiguous one. */
		chosen: RemoteNetwork | null;
		/** `devmesh · admin`, or the chooser's own prompt. */
		label: string;
		/** More than one network and nobody has chosen: the tier rows stand down. */
		ambiguous: boolean;
		options: RemoteNetwork[];
		/** What the binding means, in the version that ships. */
		note: string;
	};
	tiers: RemoteTierRow[];
	/**
	 * The one buyable tier, stated instead of marked.
	 *
	 * A CHECK AND A SELECTED GROUND ASSERT A CHOICE NOBODY MADE (design round 1, D10):
	 * the row is not a control and, while `Dedicated` cannot be bought, it is the only
	 * option. The group says which tier a run will use in words, and spends no
	 * selection ground on a decision that does not exist. `null` when nothing is
	 * buyable - the sentence must not promise a tier that is standing down.
	 */
	tierNotice: string | null;
	prompt: {
		label: string;
		/** The composer's text, summarised to one line; `""` when it is empty. */
		summary: string;
		/** What the slot says when there is no prompt, or `null` when there is one. */
		empty: string | null;
	};
	directory: { label: string; path: string };
	submit: { label: string; enabled: boolean; why: string | null };
};

/**
 * The second-level sheet: the network, the two tiers, the prompt, the directory.
 *
 * THE NETWORK IS PRE-SELECTED ONLY WHEN IT IS UNAMBIGUOUS, and "unambiguous" means
 * exactly one. Two networks with no default is the state where the picking has to be
 * the user's: the tier rows then render disabled with `choose a network` on them,
 * because the one thing this surface must never do is hide which mesh a run joins.
 *
 * THE TIER LIST IS THE DECISION, NOT A PARAGRAPH (design §2.4): each row carries one
 * shape fact and no price, and `Dedicated` is drawn disabled with its reason rather
 * than omitted - a capability that exists in the product but not in this version is
 * worth one line saying when.
 */
export function remoteSheetModel(input: RemoteSheetInput): RemoteSheetModel {
	const { value, prompt, directory, chosenNetworkId } = input;
	const options = value.networks;
	const chosen =
		chosenNetworkId !== null
			? (options.find((row) => row.network_id === chosenNetworkId) ?? null)
			: options.length === 1
				? options[0]
				: null;
	const ambiguous = chosen === null && options.length > 1;
	const ready = cloudRunReady(value);
	const trimmed = prompt.trim();
	const promptWhy =
		trimmed.length === 0
			? t("ui.chat.remote_compute.sheet.prompt.empty")
			: null;
	/*
	 * THE STAND-DOWN ORDER IS THE ORDER A USER CAN FIX THEM: a network first (the
	 * decision this screen exists for), then the directory - a run with no directory
	 * has nowhere to start, and the conversation's own row may not have answered yet -
	 * then the prompt, then capacity, which is the only one nobody here can fix.
	 *
	 * EACH ONE IS SAID ONCE, at the point of action (design round 1, D7). The prompt
	 * block used to repeat its own reason above the actions as well, and the tier row
	 * repeated the network's: one decision, three instructions, in one column.
	 */
	const submitWhy =
		chosen === null
			? t("ui.chat.remote_compute.sheet.submit.why_network")
			: directory.trim().length === 0
				? t("ui.chat.remote_compute.sheet.submit.why_directory")
				: promptWhy
					? t("ui.chat.remote_compute.sheet.submit.why_prompt")
					: !ready
						? t("ui.chat.remote_compute.sheet.submit.why_capacity")
						: null;
	return {
		heading: t("ui.chat.remote_compute.sheet.heading"),
		network: {
			chosen,
			label: chosen
				? `${chosen.name || chosen.network_id} · ${chosen.role}`
				: t("ui.chat.remote_compute.sheet.network.choose"),
			ambiguous,
			options,
			/*
			 * THE BINDING NAMES THE NETWORK IT BINDS, OR DOES NOT CLAIM ONE (design round
			 * 1, D3). A placeholder for a choice nobody has made would be a sentence about
			 * a network that does not exist yet; the qualification - the clause that stops
			 * a reader believing in isolation - is the part that is always true, so it is
			 * the part that stays.
			 */
			note: chosen
				? t("ui.chat.remote_compute.sheet.network.recorded", {
						network: chosen.name || chosen.network_id,
					})
				: t("ui.chat.remote_compute.sheet.network.not_enforced"),
		},
		tiers: [
			{
				tier: "cloud_run",
				title: t("ui.chat.remote_compute.sheet.tier.cloud_run.title"),
				note: t("ui.chat.remote_compute.sheet.tier.cloud_run.note"),
				disabled: !ready,
				why: !ready
					? t("ui.chat.remote_compute.sheet.tier.capacity_why")
					: null,
				spot: null,
			},
			{
				tier: "dedicated",
				title: t("ui.chat.remote_compute.sheet.tier.dedicated.title"),
				note: t("ui.chat.remote_compute.sheet.tier.dedicated.note"),
				// v1 does not offer it, and the route refuses the token: the row is drawn
				// so the capability is visible, disabled so nothing can be sent, and the
				// reason is the release's own sentence rather than a test's.
				disabled: true,
				why: t("ui.chat.remote_compute.sheet.tier.dedicated.why"),
				spot: {
					title: t("ui.chat.remote_compute.sheet.tier.dedicated.spot.title"),
					note: t("ui.chat.remote_compute.sheet.tier.dedicated.spot.note"),
				},
			},
		],
		tierNotice: ready
			? t("ui.chat.remote_compute.sheet.tier.cloud_run.selected")
			: null,
		prompt: {
			label: t("ui.chat.remote_compute.sheet.prompt.label"),
			summary: summarisePrompt(trimmed),
			/*
			 * THE EMPTY SLOT'S OWN SENTENCE (design round 2, D3). With a label and no value
			 * the block collapsed to zero height and nothing said whether the prompt was
			 * missing or still loading; this is the same string the stand-down list already
			 * used, printed where the value would be.
			 */
			empty: promptWhy,
		},
		directory: {
			label: t("ui.chat.remote_compute.sheet.directory.label"),
			path: directory,
		},
		submit: {
			label: t("ui.chat.remote_compute.sheet.submit"),
			enabled: submitWhy === null,
			why: submitWhy,
		},
	};
}

/** How much of a prompt the sheet prints before it elides the rest. */
export const PROMPT_SUMMARY_CHARS = 140;

/** The break between a prompt's first line and the rest of it. */
const FIRST_LINE = /\r?\n/;

/**
 * The sheet's one-line prompt summary.
 *
 * FIRST LINE, THEN LENGTH: a prompt is a paragraph and the sheet's job is to let the
 * reader recognise WHICH prompt is about to run, not to re-read it. The summary is
 * never the thing sent - `remoteRunStart` reads the composer's text directly - so
 * truncation here cannot change what runs.
 */
export function summarisePrompt(prompt: string): string {
	if (!prompt) return "";
	const line = prompt.split(FIRST_LINE, 1)[0] ?? "";
	return line.length > PROMPT_SUMMARY_CHARS
		? `${line.slice(0, PROMPT_SUMMARY_CHARS).trimEnd()}…`
		: line;
}

/* ------------------------------------------------------------- the run card */

export type RemoteRunCardModel = {
	title: string;
	/** `Running`, `Queued`, `Failed`, or the server's own token when unknown. */
	status: string;
	statusKnown: boolean;
	phase: RemoteRunPhase;
	/** `4m12s`, from the server's `started_at`; `null` before it starts. */
	elapsed: string | null;
	/** The hold while unsettled, the charge once settled, or nothing at all. */
	amount: { kind: "held" | "charged"; text: string } | null;
	/** The network this run is recorded against, in the version's own words. */
	binding: string;
	actions: { cancel: boolean; delete: boolean };
};

/**
 * The card's sentences, for one run.
 *
 * THE ELAPSED CLOCK IS THE SERVER'S START, NOT THIS WINDOW'S. `started_at` is the
 * fact and `now` is only the reading; a clock started when the card mounted would
 * restart on every re-render of the picker it came from.
 */
export function remoteRunCardModel(
	run: RemoteRun,
	input: { now: number; networkName: string | null },
): RemoteRunCardModel {
	const phase = remoteRunPhase(run.status);
	const known = remoteRunStatusKnown(run.status);
	const elapsed =
		phase === "in-flight" && run.started_at !== null
			? formatDuration(
					Math.max(0, Math.round((input.now - run.started_at) / 1000)),
				)
			: null;
	const amount =
		run.charged_usd !== null && phase !== "in-flight"
			? {
					kind: "charged" as const,
					text: t("ui.chat.remote_compute.card.charged", {
						amount: formatUsd(run.charged_usd),
					}),
				}
			: run.hold_usd !== null && phase === "in-flight"
				? {
						kind: "held" as const,
						text: t("ui.chat.remote_compute.card.held", {
							amount: formatUsd(run.hold_usd),
						}),
					}
				: null;
	return {
		title: run.name || t("ui.chat.remote_compute.card.untitled"),
		status: known ? statusLabel(run.status, phase) : run.status,
		statusKnown: known,
		phase,
		elapsed,
		amount,
		/*
		 * THE BINDING SAYS WHAT IT IS. A run carries the network it was recorded
		 * against; in this version nothing enforces it, so the sentence says
		 * "recorded" and stops. A run with no network says so instead of borrowing
		 * the picker's current choice - the picker's choice is about the NEXT run.
		 */
		binding: input.networkName
			? t("ui.chat.remote_compute.card.binding", { network: input.networkName })
			: t("ui.chat.remote_compute.card.binding_none"),
		actions: {
			// Cancel while it can still spend; delete once it cannot. The two are not
			// both offered: a live run's row is not something to tidy away.
			cancel: phase === "in-flight",
			delete: phase !== "in-flight",
		},
	};
}

/** The status word, from the token's phase - and the token's own word when it can. */
function statusLabel(status: string, phase: RemoteRunPhase): string {
	const token = status.toLowerCase();
	if (token === "queued" || token === "pending") {
		return t("ui.chat.remote_compute.card.status.queued");
	}
	if (token === "provisioning" || token === "starting" || token === "running") {
		return t("ui.chat.remote_compute.card.status.running");
	}
	switch (phase) {
		case "succeeded":
			return t("ui.chat.remote_compute.card.status.succeeded");
		case "failed":
			return t("ui.chat.remote_compute.card.status.failed");
		case "cancelled":
			return t("ui.chat.remote_compute.card.status.cancelled");
		default:
			return t("ui.chat.remote_compute.card.status.running");
	}
}

/* ------------------------------------------------------------- the refusals */

/**
 * What a refusal's code lets this surface OFFER.
 *
 * THE MESSAGE IS THE SERVER'S and is always rendered verbatim: it is already
 * translated where it was written, and a client that re-worded it would be a second
 * author of a sentence the route owns. The code is read for exactly one thing - which
 * affordance is worth drawing beside it:
 *
 * - `sign-in` - the account is the problem: `signed_out` (401, the account's own
 *   `LoginRequired`) and `radient_no_credential` (409, this device holds no
 *   credential to hand the provider). Both mean the same thing to a user, and the
 *   app names the second one elsewhere already (`quota-notice.ts`).
 * - `add-credits` - the account exists and cannot pay.
 * - `retry` - a capacity or busy answer, which is time-shaped: the route's own
 *   `Retry-After` is what the countdown reads.
 * - `push-branch` - the run would start on a commit that is not on any remote.
 * - `refresh` - the row is gone or already finished; the honest remedy is a re-read.
 * - `none` - the sentence is the whole answer: a bad request, a refused preview, a
 *   tier this deployment does not offer, or `not_configured`. THAT LAST ONE IS NOT
 *   AN AUTH CODE, which is why it is here: the start route answers it for the
 *   family's own off-switch (403) and for a host with no platform configured
 *   (409), and neither is fixed by signing in - the one button this surface used
 *   to offer for it could not have helped (agent review M1).
 *
 * THE UNKNOWN CODE IS `none` AND NOT `retry`: an unrecognised refusal gets the
 * server's sentence and no button, because a retry button that re-spends money is
 * the wrong default for a code this client has never seen.
 */
export type RemoteRemedy =
	| "sign-in"
	| "add-credits"
	| "retry"
	| "push-branch"
	| "refresh"
	| "none";

export function remoteRemedy(code: string): RemoteRemedy {
	switch (code) {
		case "signed_out":
		case "radient_no_credential":
			return "sign-in";
		case "insufficient_credits":
			return "add-credits";
		case "run_limit":
		case "run_busy":
		case "capacity_unavailable":
		case "admission_unavailable":
			return "retry";
		case "unpushed_commit":
			return "push-branch";
		case "not_found":
		case "run_finished":
			return "refresh";
		default:
			return "none";
	}
}

/**
 * The seconds a retry remedy waits, from the route's own `Retry-After`.
 *
 * `null` when the route stated none, and then the affordance is a plain retry: a
 * countdown invented here would be a number the server never asked for, and the
 * press would be refused again at the end of it.
 */
export function remoteRetrySeconds(input: {
	retryAfterMs: number | null | undefined;
}): number | null {
	const ms = input.retryAfterMs;
	if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
	return Math.ceil(ms / 1000);
}

/** The sentence a refusal's remedy button carries. */
export function remoteRemedyLabel(
	remedy: RemoteRemedy,
	seconds: number | null,
): string {
	switch (remedy) {
		case "sign-in":
			return t("ui.chat.remote_compute.remedy.sign_in");
		case "add-credits":
			return t("ui.chat.remote_compute.remedy.add_credits");
		case "retry":
			return seconds === null
				? t("ui.chat.remote_compute.remedy.retry")
				: t("ui.chat.remote_compute.remedy.retry_in", { seconds });
		case "push-branch":
			return t("ui.chat.remote_compute.remedy.push_branch");
		case "refresh":
			return t("ui.chat.remote_compute.remedy.refresh");
		default:
			return "";
	}
}
