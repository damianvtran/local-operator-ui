/**
 * `/usage` — the provider usage dialog, in every state it can be in.
 *
 * These render the PRODUCTION `UsageDialog`, which is the shipped dialog with
 * its query lifted out, so what is judged here is what ships rather than a
 * story-shaped imitation of it. The states below are the ones that are slow,
 * awkward or impossible to reach live: an expired OAuth grant needs a grant to
 * die, a stale block needs a provider to go idle past its cache TTL, an
 * exhausted weekly window needs a week of work.
 *
 * Every fixture is REAL-SHAPED — the exact field names and types the route
 * sends (`dataclasses.asdict(UsageReport)` plus `age_ms` and `state`), as
 * specified in `docs/evidence/chat-usage/SPEC.md`. A fixture that dropped a
 * field would make these frames evidence about a shape the backend never
 * sends.
 *
 * What to look for, since these frames are the design review:
 *
 * - The amount and countdown columns form ONE right edge across every provider
 *   block, so the blocks scan as one table rather than several stacked ones.
 * - A per-model cap is indented and dimmer than the shared rows above it, so a
 *   100% family cap never reads as a dead account.
 * - An unmeasurable window has an OUTLINED dot and an empty track. An empty
 *   filled bar would be a claim that nothing has been spent.
 * - The binding window sits on the block's first row, tinted by its own status,
 *   because "can I keep working" is the question the view answers.
 * - A degraded block's dots drop to the dim ramp while its bars keep their
 *   quota tint: the numbers still mean what they measure, only the confidence
 *   in their freshness has changed.
 */

import type { Meta, StoryObj } from "@storybook/react";
import "../../../styles/index.css";
import { UsageDialog } from "./usage-view";
import type {
	UsageAmount,
	UsageLimit,
	UsagePayload,
	UsageReport,
} from "./usage-view-model";

/* A fixed clock, so a countdown cannot move between two captures of the same
   frame — a frame that differs run to run is not evidence. */
const NOW = 1_760_000_000_000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const amount = (over: Partial<UsageAmount> = {}): UsageAmount => ({
	used: null,
	limit: null,
	remaining: null,
	used_fraction: null,
	unit: "percent",
	...over,
});

const limit = (over: Partial<UsageLimit> & { id: string }): UsageLimit => ({
	label: over.id,
	amount: amount(),
	window: over.id,
	status: null,
	resets_at: null,
	resets_at_ms: null,
	tier: "",
	shared: true,
	...over,
});

const report = (
	over: Partial<UsageReport> & { provider: string },
): UsageReport => ({
	fetched_at: NOW,
	limits: [],
	notes: null,
	identity: null,
	consecutive_failures: 0,
	usage_unavailable: false,
	next_probe_at_ms: null,
	credential_invalid: false,
	age_ms: 0,
	state: "available",
	...over,
});

const payload = (reports: UsageReport[], source = "cached"): UsagePayload => ({
	reports,
	source,
	fetched_at: NOW,
});

const noop = () => undefined;

/**
 * A subscription account: the account-wide 5-hour and 7-day umbrellas plus the
 * per-model tier caps that sit under them. This is the shape the Anthropic
 * OAuth endpoint actually returns.
 */
const anthropic = report({
	provider: "anthropic",
	identity: "damian@example.com",
	fetched_at: NOW - 30_000,
	limits: [
		limit({
			id: "five_hour",
			label: "5-hour",
			amount: amount({
				used: 62,
				limit: 100,
				remaining: 38,
				used_fraction: 0.62,
				unit: "percent",
			}),
			resets_at_ms: NOW + 3 * HOUR + 24 * MINUTE,
			shared: true,
		}),
		limit({
			id: "seven_day",
			label: "7-day",
			amount: amount({
				used: 88,
				limit: 100,
				remaining: 12,
				used_fraction: 0.88,
				unit: "percent",
			}),
			resets_at_ms: NOW + 2 * DAY + 11 * HOUR,
			shared: true,
		}),
		limit({
			id: "seven_day_opus",
			label: "7-day, Opus",
			amount: amount({
				used: 100,
				limit: 100,
				remaining: 0,
				used_fraction: 1,
				unit: "percent",
			}),
			resets_at_ms: NOW + 2 * DAY + 11 * HOUR,
			tier: "opus",
			shared: false,
		}),
		limit({
			id: "seven_day_sonnet",
			label: "7-day, Sonnet",
			amount: amount({
				used: 41,
				limit: 100,
				remaining: 59,
				used_fraction: 0.41,
				unit: "percent",
			}),
			resets_at_ms: NOW + 2 * DAY + 11 * HOUR,
			tier: "sonnet",
			shared: false,
		}),
	],
});

/** A pay-per-token key with a real credit balance and a cap to draw it against. */
const openrouter = report({
	provider: "openrouter",
	identity: "sk-or-…f3a1",
	fetched_at: NOW - 45_000,
	limits: [
		limit({
			id: "credits",
			label: "Credits",
			amount: amount({ used: 12.4, limit: 40, unit: "usd" }),
			shared: true,
		}),
	],
});

/** A percent-only provider: utilisation, with no money anywhere in the report. */
const openai = report({
	provider: "openai",
	identity: "damian@example.com",
	fetched_at: NOW - 20_000,
	limits: [
		limit({
			id: "primary",
			label: "Weekly",
			amount: amount({
				used: 37,
				limit: 100,
				remaining: 63,
				used_fraction: 0.37,
				unit: "percent",
			}),
			resets_at_ms: NOW + 4 * DAY,
			shared: true,
		}),
		limit({
			id: "secondary",
			label: "Weekly, reasoning",
			amount: amount({
				used: 91,
				limit: 100,
				remaining: 9,
				used_fraction: 0.91,
				unit: "percent",
			}),
			resets_at_ms: NOW + 4 * DAY,
			tier: "o-series",
			shared: false,
		}),
	],
});

/**
 * A remaining-only balance — what both balance fetchers report, since neither
 * vendor publishes a limit to derive spend from. It has no measurable
 * fraction, so it must print its number and draw no fill.
 */
const deepseek = report({
	provider: "deepseek",
	identity: "sk-…9c2b",
	fetched_at: NOW - 60_000,
	limits: [
		limit({
			id: "balance",
			label: "Balance",
			amount: amount({ remaining: 519.86, unit: "usd" }),
			shared: true,
		}),
	],
});

/**
 * A percent window with its fraction stated, the way every OAuth utilisation
 * fetcher reports one (Anthropic, OpenAI, Z.AI, xAI): `used` is the PERCENT
 * against a limit of 100, and `used_fraction` says so explicitly so `2` is
 * never read as 200%.
 *
 * Mind the argument order: `window` comes BEFORE `tier`, and a tier row must
 * pass both (its window is the shared window's name, e.g. `"7 day"`) — a tier
 * string in the `window` slot silently makes the row account-wide, which both
 * un-indents it and lets it win the binding.
 */
const percentLimit = (
	id: string,
	label: string,
	percent: number,
	resetsAtMs: number | null,
	window = label,
	tier = "",
): UsageLimit =>
	limit({
		id,
		label,
		window,
		tier,
		amount: amount({
			used: percent,
			limit: 100,
			remaining: 100 - percent,
			used_fraction: percent / 100,
			unit: "percent",
		}),
		resets_at_ms: resetsAtMs,
		shared: tier === "",
	});

/**
 * One of several signed-in accounts of the SAME provider — the multi-account
 * case the real 11-report response surfaced. The identity is what tells the
 * blocks apart (the React key is `provider:identity`), so each account carries
 * a distinct redaction-shaped stand-in of the length a real email has.
 */
const anthropicAccount = (
	identity: string,
	limits: UsageLimit[],
): UsageReport =>
	report({ provider: "anthropic", identity, fetched_at: NOW - 45_000, limits });

const meta: Meta<typeof UsageDialog> = {
	title: "chat-usage",
	component: UsageDialog,
	parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj<typeof UsageDialog>;

const base = {
	onClose: noop,
	onFetchLive: noop,
	now: NOW,
};

/**
 * The main case: four providers, eight windows, every status present.
 *
 * This is the frame the column alignment and the shared/tier hierarchy are
 * judged on. Anthropic's Opus cap is at 100% while its binding window — the
 * account-wide 7-day — is at 88%, which is exactly the distinction the
 * binding rule exists to make: the account is near its limit, not dead.
 */
export const MultiProvider: Story = {
	args: {
		...base,
		payload: payload([anthropic, openai, openrouter, deepseek]),
	},
};

/** A percent-only provider on its own, where no row carries a currency. */
export const PercentOnly: Story = {
	args: { ...base, payload: payload([openai]) },
};

/** A remaining-only balance: a number, no fill, and the words "not reported". */
export const RemainingBalance: Story = {
	args: { ...base, payload: payload([deepseek]) },
};

/**
 * The first paint, before the cached report has come back.
 *
 * `fetching` is TRUE here, and that is not a detail. On a first load react-query
 * reports `isLoading` and `isFetching` together, so the shipped container always
 * passes both — an earlier version of this story left `fetching` at its `false`
 * default and photographed `Ask providers now`, ENABLED, which is a toolbar
 * state the container cannot produce at first paint. An unreachable frame is
 * worse than no frame, because loading is precisely the state a reviewer cannot
 * check any other way.
 */
export const Loading: Story = {
	args: { ...base, payload: null, loading: true, fetching: true },
};

/** No provider publishes quota, or none is signed in. */
export const Empty: Story = {
	args: { ...base, payload: payload([]) },
};

/** The backend refused or could not be reached; the message is the backend's. */
export const QueryError: Story = {
	args: {
		...base,
		payload: null,
		error:
			"This backend does not support the requested desktop control. Update the backend and try again.",
	},
};

/**
 * Live numbers have been asked for and the request is still out.
 *
 * The cached numbers stay on screen throughout, which the container now really
 * produces: `live` is part of the query key, so asking starts a query with no
 * cached entry, and `placeholderData: keepPreviousData` is what keeps the
 * previous payload rendering while it loads. Before that this frame was a
 * picture of a state the shipped wiring could not reach — the real behaviour
 * replaced the whole table with the word `Loading` for the duration of the
 * probe. `loading` is left at `false` deliberately: with placeholder data in
 * hand react-query reports `isLoading: false`, which is the combination the
 * container passes here.
 */
export const Fetching: Story = {
	args: {
		...base,
		payload: payload([anthropic, openrouter]),
		fetching: true,
		asked: true,
	},
};

/**
 * A block the description's age does not speak for.
 *
 * The background warmer only refreshes the ACTIVE provider, so an idle one is
 * supposed to be minutes old — this block is 40 minutes behind the response
 * stamp, which is past the cache's own freshness contract, so it says so and
 * its dots drop to the dim ramp. The fresh block beside it is unmarked.
 */
export const StaleReport: Story = {
	args: {
		...base,
		payload: payload([
			report({
				...anthropic,
				fetched_at: NOW - 40 * MINUTE,
				age_ms: 40 * MINUTE,
			}),
			openrouter,
		]),
	},
};

/**
 * The probe is failing, and the last-known numbers keep rendering under the
 * note. A view that dropped them would answer "how much is left?" with
 * nothing, when it knows the answer as of two hours ago.
 */
export const UnavailableWithLastKnown: Story = {
	args: {
		...base,
		payload: payload([
			report({
				provider: "kimi",
				identity: "damian@example.com",
				fetched_at: NOW - 2 * HOUR,
				age_ms: 2 * HOUR,
				usage_unavailable: true,
				consecutive_failures: 4,
				next_probe_at_ms: NOW + 15 * MINUTE,
				state: "unavailable",
				limits: [
					limit({
						id: "coding_plan",
						label: "Coding plan",
						amount: amount({
							used: 94,
							limit: 100,
							remaining: 6,
							used_fraction: 0.94,
							unit: "percent",
						}),
						resets_at_ms: NOW + 6 * HOUR,
						shared: true,
					}),
				],
			}),
			openrouter,
		]),
	},
};

/**
 * A dead OAuth grant — the one state here with a remedy the user can act on,
 * so the note names the command instead of an age. `/login xai` is runnable
 * exactly as printed.
 */
export const ReauthRequired: Story = {
	args: {
		...base,
		payload: payload([
			report({
				provider: "xai",
				identity: "damian@example.com",
				fetched_at: NOW - 2 * DAY,
				age_ms: 2 * DAY,
				credential_invalid: true,
				usage_unavailable: true,
				consecutive_failures: 9,
				state: "reauth_required",
				limits: [
					limit({
						id: "credits",
						label: "Credits",
						amount: amount({
							used: 100,
							limit: 100,
							remaining: 0,
							used_fraction: 1,
							unit: "percent",
						}),
						shared: true,
					}),
				],
			}),
			openrouter,
		]),
	},
};

/**
 * A provider that answered with no numbers at all, beside one that has some.
 *
 * The unmeasurable rows draw an outlined dot and a DOTTED rule — not a track at
 * zero, which would be a claim that nothing has been spent — and the toolbar
 * tally counts them as "not reported" rather than folding them into a healthy
 * count. The rule is on the `ink-dim` ramp: it is the entire distinction
 * between "reports nothing" and "at zero", which makes it structural and puts
 * it on the 3:1 floor that `ink-disabled` is exempt from.
 */
export const NotReported: Story = {
	args: {
		...base,
		payload: payload([
			report({
				provider: "mistral",
				identity: "sk-…7d14",
				limits: [
					limit({
						id: "monthly",
						label: "Monthly",
						amount: amount({ unit: "unknown" }),
					}),
					limit({
						id: "requests",
						label: "Requests",
						amount: amount({ limit: 100000, unit: "requests" }),
					}),
				],
			}),
			openrouter,
		]),
	},
};

/**
 * Real-account density: the one state where the body overflows its scroll box.
 *
 * The committed `real-data/` frames are the only other evidence at this
 * density and they cannot be re-derived on demand — they need the local
 * backend to return its cached reports, which it only does while its
 * credentials can reach every provider's quota endpoint. This story is the
 * same density built from fixtures, so the sweep can always re-take it: eleven
 * reports and twenty-eight windows, which is the shape the machine's live
 * response actually had (five of the eleven are `anthropic`, because one
 * provider can hold several signed-in accounts — the multi-account case the
 * React key `provider:identity` exists for).
 *
 * Every label, unit and window name is a real fetcher's own (`usage.py`), and
 * the identities are the shape-preserving stand-ins the real-data capture
 * redacts to, so the row heights are the heights the real frame photographs.
 * The status mix is a working machine's, not a demo of every colour: mostly
 * ok, four near limit, one dead weekly window, two remaining-only balances.
 *
 * This is the frame the scroll fold is judged on. Captured at 1100x1000 —
 * `real-data`'s own viewport — where the body cap `min(60vh,520px)` bottoms
 * out at 520px against roughly 1300px of content, so the fold is deep and
 * unambiguous rather than a row or two of overhang. What must hold, per the
 * design finding it answers (D4): the cut at the bottom is a 20px FADE, not a
 * hard clip through a row's glyphs; a `border-control` rule closes the body
 * while it scrolls; and — the half of the finding the non-overflowing stories
 * prove — nothing of the sort is drawn by the states whose content fits.
 */
export const Dense: Story = {
	args: {
		...base,
		payload: payload([
			anthropicAccount("team@example.com", [
				percentLimit("five_hour", "5 hour", 62, NOW + 3 * HOUR + 24 * MINUTE),
				percentLimit("seven_day", "7 day", 88, NOW + 2 * DAY + 11 * HOUR),
				percentLimit(
					"seven_day_opus",
					"7 day (Opus)",
					100,
					NOW + 2 * DAY + 11 * HOUR,
					"7 day",
					"opus",
				),
			]),
			anthropicAccount("damian@example.com", [
				percentLimit("five_hour", "5 hour", 12, NOW + 4 * HOUR),
				percentLimit("seven_day", "7 day", 34, NOW + 5 * DAY + 3 * HOUR),
				percentLimit(
					"seven_day_opus",
					"7 day (Opus)",
					3,
					NOW + 5 * DAY + 3 * HOUR,
					"7 day",
					"opus",
				),
				percentLimit(
					"seven_day_sonnet",
					"7 day (Sonnet)",
					9,
					NOW + 5 * DAY + 3 * HOUR,
					"7 day",
					"sonnet",
				),
			]),
			anthropicAccount("ops@example.com", [
				percentLimit("five_hour", "5 hour", 95, NOW + 41 * MINUTE),
				percentLimit("seven_day", "7 day", 100, NOW + DAY + 6 * HOUR),
				percentLimit(
					"seven_day_sonnet",
					"7 day (Sonnet)",
					41,
					NOW + DAY + 6 * HOUR,
					"7 day",
					"sonnet",
				),
				// The pay-as-you-go meter that tops up an exhausted plan; the
				// real fetcher reports it only when the account has it enabled.
				limit({
					id: "extra_usage",
					label: "Extra usage",
					amount: amount({
						used: 3.2,
						limit: 40,
						remaining: 36.8,
						unit: "usd",
					}),
					window: "1 month",
					resets_at_ms: NOW + 19 * DAY,
					shared: true,
				}),
			]),
			anthropicAccount("build@example.com", [
				percentLimit("five_hour", "5 hour", 8, NOW + 2 * HOUR + 10 * MINUTE),
				percentLimit("seven_day", "7 day", 21, NOW + 3 * DAY + 18 * HOUR),
				percentLimit(
					"seven_day_opus",
					"7 day (Opus)",
					73,
					NOW + 3 * DAY + 18 * HOUR,
					"7 day",
					"opus",
				),
			]),
			anthropicAccount("lab@example.com", [
				percentLimit("five_hour", "5 hour", 44, NOW + 80 * MINUTE),
				percentLimit("seven_day", "7 day", 57, NOW + 6 * DAY + 2 * HOUR),
				percentLimit(
					"seven_day_opus",
					"7 day (Opus)",
					66,
					NOW + 6 * DAY + 2 * HOUR,
					"7 day",
					"opus",
				),
			]),
			openai,
			report({
				provider: "zai",
				identity: "sk-…4417",
				fetched_at: NOW - 90_000,
				limits: [
					percentLimit(
						"tokens_7d",
						"Token quota (7 day)",
						54,
						NOW + 4 * DAY,
						"7 day",
					),
					percentLimit(
						"requests_30d",
						"Request quota (30 day)",
						7,
						NOW + 12 * DAY,
						"30 day",
					),
					limit({
						id: "zread_30d",
						label: "Zread quota (30 day)",
						amount: amount({
							used: 12,
							limit: 100,
							remaining: 88,
							used_fraction: 0.12,
							unit: "percent",
						}),
						window: "30 day",
						resets_at_ms: NOW + 12 * DAY,
						tier: "zread",
					}),
				],
			}),
			report({
				provider: "kimi",
				identity: "damian@example.com",
				fetched_at: NOW - 2 * MINUTE,
				limits: [
					percentLimit("coding_5h", "Coding plan (5 hour)", 71, NOW + 2 * HOUR),
					percentLimit(
						"coding_7d",
						"Coding plan (7 day)",
						94,
						NOW + DAY + 9 * HOUR,
					),
					limit({
						id: "balance",
						label: "Balance (USD)",
						amount: amount({ remaining: 63.5, unit: "usd" }),
						window: "lifetime",
						shared: true,
					}),
				],
			}),
			report({
				provider: "xai",
				identity: "xai-…8e02",
				fetched_at: NOW - 3 * MINUTE,
				limits: [percentLimit("credits", "Credits", 26, NOW + 9 * DAY)],
			}),
			openrouter,
			deepseek,
		]),
	},
};

/**
 * The dialog in a narrow frame.
 *
 * Captured at a 720px viewport (`scripts/capture-evidence.mjs`) rather than
 * wrapped in a narrow div: the dialog is portal-rendered and viewport-fixed,
 * so a wrapper constrains nothing and the frame would be a picture of the wide
 * layout under a false name. The bar is a redundant picture of a number
 * already on the row, so it is what a narrow frame takes space from first;
 * the label truncates rather than pushing the numbers off the row, because it
 * is the one column a reader can still identify from a prefix.
 */
export const Narrow: Story = {
	args: { ...base, payload: payload([anthropic, deepseek]) },
};
