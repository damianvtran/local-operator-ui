/**
 * The agent hub: a category rail beside a grid of downloadable community
 * agents, in the states its reads can put it in.
 *
 * ## What is stubbed, and what is not
 *
 * `window.api.desktop.request` is the preload bridge `desktop-api.desktopRequest`
 * prefers — the transport every Radient call in this app goes through since the
 * renderer stopped holding a token. Everything above it is real: the real
 * `AgentHubPage`, its real list query and key, the real batched status query,
 * the real cards, the real category rail, the real search and sort controls.
 * The payloads are fixtures shaped like `GET /v1/agents` and `agents.statuses`,
 * so `like_count`, `categories` and the paging fields are the wire's.
 *
 * This file REPLACES a `window.fetch` stub, which is why the frames it produces
 * are the first ones of this surface that show the hub at all: the hub has gone
 * through the desktop transport since, so a `fetch` stub answered nothing and
 * the old story photographed its own load error.
 *
 * ## The ledger
 *
 * Every request the page issues is appended to a module-level ledger and
 * published on `window.__hubLedger`. That is not decoration: the number of
 * requests a twelve-card page costs is the property this surface was changed
 * for, and a frame cannot show it. `scripts/hub-round-trips.mjs` reads the
 * ledger off the rendered page and reports it per operation, from this file's
 * own bridge — so the reading is taken from the same page the frames are, not
 * from a parallel harness that could agree with itself.
 *
 * ## What a frame here does NOT prove
 *
 * That Radient answers these payloads, that a real account's likes are what the
 * fixtures say, or that the real backend serves `agents.statuses` at all: a
 * backend older than the batched op answers **422** (an unknown `operation`
 * fails `RadientRequest`'s `Literal`, and `local_operator/server/app.py`
 * flattens every `/v1/desktop/*` validation failure to 422), so the hub
 * reports the viewer state as UNKNOWN rather than claiming it — `SignedOut` and
 * `ViewerStateUnknown` are the frames for that rendering, not for that backend.
 * The fixtures are the wire's SHAPE, verified against the live public endpoint;
 * the values in them are invented.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, waitFor } from "@storybook/test";
import type { DesktopResponse } from "../../../../shared/desktop-contract";
import "../../styles/index.css";
import { AgentHubPage } from "./agent-hub-page";

/* --------------------------------------------------------------- the bridge */

type BridgeRequest = {
	op: string;
	control?: {
		operation?: string;
		query?: Record<string, string | number>;
		/** The org an `org_agents.list` read names, which rides the path server-side. */
		tenant_id?: string;
	};
};

/** Every request the page made, oldest first, as `op` or `control.operation`. */
const ledger: string[] = [];

const publishLedger = () => {
	(window as unknown as { __hubLedger?: () => string[] }).__hubLedger = () => [
		...ledger,
	];
};

/**
 * The fixture records, in `GET /v1/agents`'s own field names.
 *
 * `longCounts` lifts every count into the six- and seven-character range a
 * popular agent actually reaches, which is the width the card's footer has to
 * survive: the widest count any frame carried before this was five characters
 * (`1,693`), while the card's own comment justifies its 17.5rem minimum width
 * with the claim that the footer "holds three counters and a labelled action on
 * one line" — a claim nothing had photographed (design round 1, D5).
 */
const buildAgents = (count: number, longCounts = false) =>
	Array.from({ length: count }, (_, index) => ({
		id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
		account_id: "acct-1",
		tenant_id: "tenant-1",
		account_metadata: {
			name: ["Dana Whitfield", "Priya Raman", "Sam Okonkwo"][index % 3],
			email: "author@example.com",
		},
		name: AGENT_NAMES[index % AGENT_NAMES.length],
		description:
			"Reads the sources you name, keeps the parts that change a decision, and writes one short summary with the source of each claim beside it.",
		version: "1.4.0",
		created_at: new Date(Date.now() - (index + 3) * 86_400_000).toISOString(),
		updated_at: new Date(Date.now() - (index + 1) * 86_400_000).toISOString(),
		tags: ["research", "weekly"],
		// Four categories, which is the rail's own claim: the rail lists what the
		// records carry, so a frame with sixteen rows would be a frame of the
		// hardcoded list this change removes.
		categories: [AGENT_CATEGORIES[index % AGENT_CATEGORIES.length]],
		like_count: longCounts ? 121_408 + index * 7 : 12 + index * 7,
		favourite_count: longCounts ? 84_903 + index * 3 : 4 + index * 3,
		download_count: longCounts ? 1_204_583 + index * 143 : 120 + index * 143,
	}));

const AGENT_NAMES = [
	"Inbox triage",
	"Finance digest",
	"Repo janitor",
	"Competitor watch",
	"Meeting notes",
	"Spreadsheet cleaner",
	"Travel planner",
	"Release notes",
	"Contract reader",
	"Incident scribe",
	"Sourced answers",
	"Weekly brief",
];

const AGENT_CATEGORIES = [
	"personal_assistance",
	"accounting",
	"software",
	"research",
];

type BridgeBehaviour = {
	/** Records the list answers with. Zero is the empty hub. */
	records?: number;
	/** Records for a list request that carries a filter. */
	filteredRecords?: number;
	/** Lift the counts into the six- and seven-character range (D5). */
	longCounts?: boolean;
	/**
	 * Fail the list read at the TRANSPORT rather than with a status.
	 *
	 * A refused read carrying an HTTP status is retried once (`retryDesktopQuery`),
	 * so the error state arrives a second after the skeleton — and a frame taken
	 * on the story's first paint photographs the skeleton instead. A transport
	 * that never answers is not retried (there is nothing to retry towards), which
	 * is both the more common "the hub could not be loaded" case and the one whose
	 * state is on screen from the first paint.
	 */
	failList?: boolean;
	/** Never settle the list read, so the page stays in its loading state. */
	holdList?: boolean;
	/** Hold every list read after the first, for the paging state. */
	holdAfterFirst?: boolean;
	/** Answer the account read, which is what makes the viewer signed in. */
	signedIn?: boolean;
	/**
	 * Refuse the batched viewer read while the list answers — the state that used
	 * to render as "you have liked nothing" for every card (R1).
	 */
	failStatuses?: boolean;
	/** Viewer state to report for the ids the page asks about. */
	liked?: string[];
	favourited?: string[];
	/**
	 * The viewer's organizations (§4.1), in the membership-summary shape.
	 *
	 * Empty by default, which is the public-hub-only state every story before this
	 * change was in: no memberships means no scope selector at all, because a
	 * control holding one option cannot change anything.
	 */
	orgs?: {
		tenant_id: string;
		tenant_name: string;
		role: string;
		status: "active" | "pending" | "disabled";
		is_home: boolean;
		plan: {
			status: "none" | "active" | "past_due" | "canceled";
			seats: number | null;
		};
	}[];
	/** Records the ORG list answers with, and any filters it carries. */
	orgAgents?: number;
	/**
	 * Refuse the org list with one of the two frozen membership codes (§2.2).
	 *
	 * "plan" is `team_plan_required` — a lapsed plan, which the hub answers with a
	 * 403 rather than an empty list — and "no_access" is `not_a_member`, the same
	 * 403 a stranger gets. The page must render neither as an outage.
	 */
	orgRefusal?: "plan" | "no_access";
	/** Teams for `org_teams.list`. */
	teams?: {
		id: string;
		name: string;
		project: string;
		version: string;
		members: { role: string; kind: string; count: number }[];
	}[];
	/** Never settle the teams read, so the Teams view stays in its loading state. */
	holdTeams?: boolean;
	/** Fail the memberships read, so the picker's "could not be read" line shows. */
	failMemberships?: boolean;
	/**
	 * The backend advertises `radient_org` (agent review round 1, M2).
	 *
	 * True by default, because every org story above needs the four operations the
	 * key gates; false is a backend that predates them, whose unknown ops answer a
	 * masked 422 — the state that must say "update the backend" rather than offer a
	 * retry that cannot work.
	 */
	orgCapability?: boolean;
};

const installBridge = (behaviour: BridgeBehaviour = {}) => {
	const {
		records = 12,
		filteredRecords = 0,
		longCounts = false,
		failList = false,
		holdList = false,
		holdAfterFirst = false,
		signedIn = false,
		failStatuses = false,
		liked = [],
		favourited = [],
		orgs = [],
		orgAgents = 0,
		orgRefusal,
		teams = [],
		holdTeams = false,
		failMemberships = false,
		orgCapability = true,
	} = behaviour;
	ledger.length = 0;

	let listCalls = 0;
	const ok = <T,>(result: T): DesktopResponse => ({
		status: 200,
		body: { result },
	});
	/*
	 * A Radient answer rides two envelopes, and the story has to reproduce both
	 * or the page reads `undefined` as the query's data. The route answers
	 * `reply({"data": <upstream body>})`, so the CRUDResponse's result is
	 * `{data: {msg, result}}` — which is what `radientProxyEnvelope` unwraps. The
	 * first draft of this file returned the upstream body in the inner slot and
	 * photographed a React Query error instead of the hub.
	 */
	const proxy = <T,>(envelope: T): DesktopResponse => ok({ data: envelope });

	const bridge = async (request: BridgeRequest): Promise<DesktopResponse> => {
		const operation = request.control?.operation;
		ledger.push(operation ?? request.op);

		if (request.op === "capabilities") {
			return ok({
				desktop_contract: 1,
				desktop_available: true,
				desktop_auth: "bearer",
				features: {
					radient: 1,
					profile_catalogue: 1,
					team_catalogue: 1,
					// Absent means a backend that predates the org operations (M2): the
					// unknown ops answer a masked 422, so the surfaces must not attempt
					// them and must say "update the backend" instead.
					...(orgCapability ? { radient_org: 1 } : {}),
				},
			});
		}
		if (request.op === "team.pull") {
			/*
			 * The pull's own op, on the local server's transport rather than the
			 * Radient proxy's: it reconstructs a local team from the published
			 * document, and this fixture reports the rename the way the local registry
			 * does — a story that pulls the same team twice is the state the warning is
			 * for.
			 */
			return ok({
				status: 200,
				message: "Team pulled from Radient successfully",
				result: {
					id: "local-team-1",
					name: String(teams[0]?.name ?? "Team"),
				},
			});
		}
		if (request.op === "sessions.list") {
			return ok({ sessions: [], truncated: false });
		}
		if (request.op === "profiles.list") {
			return ok({ profiles: [] });
		}
		if (request.op === "radient.request") {
			switch (operation) {
				case "memberships.list":
					/*
					 * The memberships the scope selector is built from. A failure here is a
					 * REAL state rather than a defensive one — an older backend answers 422
					 * for the unknown op — and the page degrades to the public hub, which is
					 * the point of the arm.
					 */
					if (failMemberships) {
						return { status: 500, body: { detail: "Memberships failed." } };
					}
					return proxy({
						msg: "Memberships listed successfully",
						result: { memberships: orgs },
					});
				case "org_agents.list": {
					/*
					 * The org workspace. Its REFUSALS are the subject of two of these stories:
					 * the frozen membership codes (§2.2) arrive as `detail.code` on a 403, the
					 * shape the desktop transport preserves, and the page must render them as
					 * a state of the surface rather than as an outage.
					 */
					if (orgRefusal === "plan") {
						return {
							status: 403,
							body: {
								detail: {
									code: "team_plan_required",
									message: "This organization needs an active team plan",
								},
							},
						};
					}
					if (orgRefusal === "no_access") {
						return {
							status: 403,
							body: {
								detail: {
									code: "not_a_member",
									message: "You are not a member of this organization",
								},
							},
						};
					}
					/*
					 * Every record carries `visibility: "org"`, which is what the hub sends
					 * ONLY for an org row (`json:"visibility,omitempty"`) — the card's badge and
					 * its absent heart both hang off that one field, so a fixture that
					 * omitted it would photograph the public card in an org scope.
					 *
					 * The tenant id is the one the page ASKED about, not a literal: the badge
					 * resolves the organization's name through `tenant_id`, so a record whose
					 * tenant did not match the scope's would render the badge's fallback
					 * ("Organization") and quietly prove less than the frame claims.
					 */
					const orgTenant = String(
						request.control?.tenant_id ?? "tenant-minerva",
					);
					return proxy({
						msg: "Agents listed successfully",
						result: {
							page: 1,
							per_page: 12,
							total_pages: 1,
							total_records: orgAgents,
							records: buildAgents(orgAgents, longCounts).map((record) => ({
								...record,
								tenant_id: orgTenant,
								visibility: "org" as const,
							})),
						},
					});
				}
				case "org_teams.list": {
					// Like `holdList`: a read that never settles is how the loading
					// state is photographed without a timer.
					if (holdTeams) return await new Promise(() => {});
					/*
					 * The roster is refused with the SAME code the workspace was, because the
					 * server gates both on the same membership and plan (§4.5) — a fixture that
					 * answered this read successfully while the other was refused would
					 * photograph an organization that had lost its plan and could still list
					 * its teams, which is a state the backend does not have.
					 */
					if (orgRefusal === "plan") {
						return {
							status: 403,
							body: {
								detail: {
									code: "team_plan_required",
									message: "This organization needs an active team plan",
								},
							},
						};
					}
					if (orgRefusal === "no_access") {
						return {
							status: 403,
							body: {
								detail: {
									code: "not_a_member",
									message: "You are not a member of this organization",
								},
							},
						};
					}
					return proxy({
						msg: "Teams listed successfully",
						result: { teams },
					});
				}
				case "account":
					// The signed-out shape: the proxy answers 409 with this sentence
					// when no Radient credential is stored, which `use-radient-auth`
					// reads as the ordinary unauthenticated state.
					if (!signedIn) {
						return {
							status: 409,
							body: { detail: "Sign in to Radient to access your account" },
						};
					}
					return proxy({
						account: { id: "acct-1", name: "Dana", email: "d@example.com" },
					});
				case "agents.list": {
					listCalls += 1;
					if (holdList || (holdAfterFirst && listCalls > 1)) {
						// A read that never settles is how the two loading states are
						// photographed without a timer: the page's own isLoading and its
						// keep-previous-page state are the subject.
						return await new Promise(() => {});
					}
					if (failList) {
						throw new Error("The desktop backend did not answer.");
					}
					/*
					 * A FILTERED read is any read the page sent a filter to, which is what
					 * makes the search-miss and category-miss states photographable: the
					 * box sends `name` or `description` (whichever the scope selects) and
					 * the rail sends `categories`.
					 */
					const filtered = Boolean(
						request.control?.query?.categories ??
							request.control?.query?.name ??
							request.control?.query?.description,
					);
					const shown = filtered ? filteredRecords : records;
					return proxy({
						msg: "Agents listed successfully",
						result: {
							page: 1,
							per_page: 12,
							// The counts follow the records: a page that shows nothing
							// while its own line reads "30 agents" is a fixture bug, and
							// it photographed as one.
							total_pages: shown === 0 ? 1 : 3,
							total_records: shown === 0 ? 0 : 30,
							records: buildAgents(shown, longCounts),
						},
					});
				}
				case "agents.statuses": {
					/*
					 * The refusal R1 is about: the page asks for a whole page of ids and
					 * the read fails, so every card's viewer state is unknown at once.
					 * A 500 rather than a transport failure, because a refused read is
					 * retried once and then settles into the state the frame shows.
					 */
					if (failStatuses) {
						return {
							status: 500,
							body: { detail: "The status read failed." },
						};
					}
					const ids = String(request.control?.query?.agent_ids ?? "")
						.split(",")
						.filter(Boolean);
					return proxy({
						msg: "Agent statuses read",
						result: {
							statuses: Object.fromEntries(
								ids.map((id) => [
									id,
									{
										liked: liked.includes(id),
										favourited: favourited.includes(id),
									},
								]),
							),
						},
					});
				}
				default:
					// A story that starts issuing a fourth read fails loudly here
					// rather than hanging on a promise nothing resolves.
					throw new Error(
						`unexpected Radient operation in this story: ${operation}`,
					);
			}
		}
		throw new Error(`unexpected desktop op in this story: ${request.op}`);
	};

	const page = window as unknown as {
		api?: {
			desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> };
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: bridge };
	publishLedger();
};

/* --------------------------------------------------------------- stories */

const meta: Meta = {
	title: "Agent hub/Page",
	parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj;

const CARD_DETAILS_NAME = /^View details for /;

/**
 * Switch the scope the way a person does: press the organization's chip.
 *
 * The scope used to be a select (trigger, then option); it is a row of visible
 * chips now, so one press. The chip is found by role and name rather than by
 * test id so the play reads as the reader's own action.
 */
const chooseScope = async (name: string) => {
	await screen.findByTestId("agent-hub-status");
	await userEvent.click(await screen.findByRole("button", { name }));
	releaseFocus();
};

/**
 * Drop the focus ring the play's own press left behind.
 *
 * A programmatic click focuses the control and Chromium draws `:focus-visible`
 * on it, so every frame that pressed a chip or a tab photographed a ring the
 * reader never asked for (and the ring is not the claim of any of these frames -
 * `FocusedSearch` owns that). Blurring makes the frame the resting state.
 */
const releaseFocus = () => {
	if (document.activeElement instanceof HTMLElement) {
		document.activeElement.blur();
	}
};

/** Press the Teams tab, and wait until it is the selected one. */
const openTeamsTab = async () => {
	await userEvent.click(await screen.findByTestId("agent-hub-view-teams"));
	await waitFor(() =>
		expect(screen.getByTestId("agent-hub-view-teams")).toHaveAttribute(
			"aria-selected",
			"true",
		),
	);
	releaseFocus();
};

/** The populated grid beside the category rail, signed out. */
export const Grid: Story = {
	render: () => {
		installBridge({ records: 12 });
		return <AgentHubPage />;
	},
};

/**
 * The same grid with a Radient account, so the batched status read runs: the
 * hearts and stars are filled from ONE `agents.statuses` call for the page.
 */
export const SignedIn: Story = {
	render: () => {
		const agents = buildAgents(12);
		installBridge({
			records: 12,
			signedIn: true,
			liked: [agents[0].id, agents[3].id],
			favourited: [agents[1].id, agents[4].id, agents[7].id],
		});
		return <AgentHubPage />;
	},
};

/** The first paint, before the list has answered: placeholder cards, no spinner. */
export const Loading: Story = {
	render: () => {
		installBridge({ holdList: true });
		return <AgentHubPage />;
	},
};

/** The hub with nothing published: a sentence and the action that changes it. */
export const Empty: Story = {
	render: () => {
		installBridge({ records: 0 });
		return <AgentHubPage />;
	},
};

/**
 * The list read failed: the sentence and the control that retries it, in the
 * surface.
 *
 * The play WAITS for the failure, and it has to: the read retries once before it
 * reports, so a frame taken the moment the story mounts photographs the skeleton
 * this state passes through, not the state itself. (The first capture of this
 * story did exactly that.)
 */
export const LoadFailed: Story = {
	render: () => {
		installBridge({ records: 12, failList: true });
		return <AgentHubPage />;
	},
	play: async () => {
		/*
		 * The FIRST error is not the state, and a frame taken on it is a frame of
		 * the skeleton the read falls back to: the read retries once, so the alert
		 * appears, the query goes pending again, and the alert comes back a second
		 * later. Waiting for the SETTLED error — the one still there after the
		 * retry window — is what makes this frame the state a user sees. (The first
		 * capture of this story photographed the skeleton, which is how the
		 * distinction was found.)
		 */
		await screen.findByTestId("agent-hub-error");
		await new Promise((resolve) => setTimeout(resolve, 3_000));
		await screen.findByTestId("agent-hub-error");
	},
};

/**
 * A category that holds nothing, reached the way a user reaches it — by clicking
 * the rail — so the frame shows the real filter state and the way out of it.
 */
export const EmptyCategory: Story = {
	render: () => {
		installBridge({ records: 12, filteredRecords: 0 });
		return <AgentHubPage />;
	},
	play: async () => {
		const rail = await screen.findByTestId("category-research");
		await userEvent.click(rail);
		await screen.findByTestId("agent-hub-empty");
	},
};

/**
 * A page change while the next page is in flight: the records already on screen
 * stay there, with the loading line above them. Before this change the grid
 * emptied to a spinner and the whole surface reflowed on every page of the hub.
 */
export const PageChangeKeepsTheGrid: Story = {
	render: () => {
		installBridge({ records: 12, holdAfterFirst: true });
		return <AgentHubPage />;
	},
	play: async () => {
		await screen.findByTestId("agent-hub-status");
		await userEvent.click(
			await screen.findByRole("button", { name: "Next page" }),
		);
		await screen.findByText("Updating…");
	},
};

/**
 * The viewer's own state failed to read, which is the state that used to render
 * as "you have liked nothing" on every card.
 *
 * The `agents.statuses` read is refused with a 500 while the list answers, and
 * the frame shows the two things that make the failure visible instead of
 * silent: the line above the grid that says the read failed and offers the
 * retry the hook deliberately does not run on its own, and cards whose heartbeat
 * and star are UNAVAILABLE (`data-viewer-state="unknown"`) rather than unfilled
 * (agent review round 1, R1).
 */
export const ViewerStateUnknown: Story = {
	render: () => {
		installBridge({ records: 12, signedIn: true, failStatuses: true });
		return <AgentHubPage />;
	},
	play: async () => {
		await screen.findByTestId("agent-hub-status-unknown");
	},
};

/**
 * A search that matches nothing. The code has had its own headline for this
 * state all along and no frame had ever rendered it, so its panel, its count
 * line and its action were unreviewed — and its body sentence was the one
 * written for a category, which reads wrong for a query the user typed (design
 * round 1, D8a).
 */
export const SearchMiss: Story = {
	render: () => {
		installBridge({ records: 12, filteredRecords: 0 });
		return <AgentHubPage />;
	},
	play: async () => {
		await userEvent.type(
			await screen.findByTestId("agent-hub-search"),
			"quarterly ledger",
		);
		await screen.findByText("No agents match that search.");
	},
};

/**
 * The scope switched to description: the half of the control row whose only
 * photographed value was the default, and the value whose label ("Search name")
 * used to restate the search box's own placeholder beside it (D4, D8b).
 */
export const ScopeSwitched: Story = {
	render: () => {
		installBridge({ records: 12 });
		return <AgentHubPage />;
	},
	play: async () => {
		await screen.findByTestId("agent-hub-status");
		await userEvent.click(await screen.findByTestId("agent-hub-search-scope"));
		await userEvent.click(
			await screen.findByRole("option", { name: "Description" }),
		);
		await waitFor(() =>
			expect(screen.getByTestId("agent-hub-search-scope")).toHaveTextContent(
				"Description",
			),
		);
	},
};

/**
 * A non-default sort, which is the other half of D8b: "Most downloaded" was the
 * only sort value anyone had looked at, and it is also the only value whose
 * label reads unambiguously.
 */
export const SortedByName: Story = {
	render: () => {
		installBridge({ records: 12 });
		return <AgentHubPage />;
	},
	play: async () => {
		await screen.findByTestId("agent-hub-status");
		await userEvent.click(await screen.findByTestId("agent-hub-sort"));
		await userEvent.click(
			await screen.findByRole("option", { name: "Name (A to Z)" }),
		);
		await waitFor(() =>
			expect(screen.getByTestId("agent-hub-sort")).toHaveTextContent(
				"Name (A to Z)",
			),
		);
	},
};

/**
 * The search box focused, so the frame carries the one state of this row that
 * only exists while a keyboard user is in it: the group draws the ring for the
 * box it frames and the `focus-within` boundary that binds the scope to the
 * box is visible (D4, D8b).
 */
export const FocusedSearch: Story = {
	render: () => {
		installBridge({ records: 12 });
		return <AgentHubPage />;
	},
	play: async () => {
		const box = await screen.findByTestId("agent-hub-search");
		await userEvent.click(box);
		await waitFor(() => expect(box).toHaveFocus());
	},
};

/**
 * The card at its narrowest supported column, with counts in the six- and
 * seven-character range.
 *
 * `minmax(17.5rem,1fr)` is justified in the page by the claim that a card footer
 * at that width "holds three counters and a labelled action on one line", and no
 * frame had ever rendered a card narrower than 306px or a count longer than five
 * characters (design round 1, D5). The viewport for this story is the one in
 * `scripts/capture-evidence.mjs`'s `STORIES` — 920px, which is where the grid's
 * own auto-fill lands on two 17.5rem columns beside the rail.
 */
export const NarrowColumns: Story = {
	render: () => {
		installBridge({ records: 12, longCounts: true });
		return <AgentHubPage />;
	},
};

/**
 * The pager footer, photographed where a captured viewport can hold it.
 *
 * Four records keep the grid to one row, so the footer lands inside 900px
 * (twelve cards push it below the fold of the capture, and the page's scroll is
 * an INNER column the rig's document scroll does not reach). The list still
 * reports three pages, so this is page 1 of 3: "Previous" disabled, "Next" live.
 * It is the frame for the operator's pager report (2026-09-29): the footer runs
 * the column's width under a hairline, with the position at the start and the two
 * steps grouped at the end.
 */
export const PagerFooter: Story = {
	render: () => {
		installBridge({ records: 4 });
		return <AgentHubPage />;
	},
	play: async () => {
		await screen.findByTestId("agent-hub-pager");
	},
};

/** The same footer at the narrowest supported width, where it used to sit off-centre. */
export const PagerFooterNarrow: Story = {
	render: () => {
		installBridge({ records: 4, longCounts: true });
		return <AgentHubPage />;
	},
	play: async () => {
		await screen.findByTestId("agent-hub-pager");
	},
};

/* ------------------------------------------------- organizations (§8.4) */

/**
 * The two organizations these stories switch between, in the §4.1 shape.
 *
 * `Minerva` is the account's HOME tenant and a plan-ACTIVE one, which is the
 * positive case agent review round 1's M1 settled: a home tenant is an
 * organization, so it is offered on the same terms as any other. It is not
 * carried by an owner exemption — this fixture is `plan: "active"` precisely so
 * that the frame proves the PLAN is what offers it. `Northwind Analytics` is the
 * plan-blocked case, and it is a member's row so that the blocked list is
 * exercised on the arm §8.4 describes.
 */
const ORGS = [
	{
		tenant_id: "tenant-minerva",
		tenant_name: "Minerva",
		role: "owner",
		status: "active" as const,
		is_home: true,
		plan: { status: "active" as const, seats: 8 },
	},
	{
		tenant_id: "tenant-northwind",
		tenant_name: "Northwind Analytics",
		role: "member",
		status: "active" as const,
		is_home: false,
		// No plan at all: the blocked arm, and the state §8.4's picker renders
		// disabled with its upgrade hint.
		plan: { status: "none" as const, seats: null },
	},
];

const TEAMS = [
	{
		id: "team-hub-1",
		name: "Adverse media desk",
		project: "Onboarding",
		version: "1.2.0",
		members: [
			{ role: "manager", kind: "role", count: 1 },
			{ role: "screener", kind: "role", count: 3 },
		],
	},
	{
		id: "team-hub-2",
		name: "Quarterly close",
		project: "Finance",
		version: "0.4.0",
		members: [{ role: "analyst", kind: "specialist", count: 1 }],
	},
];

/**
 * The org scope, selected — the whole desktop surface this change adds, in the
 * state a member actually works in.
 *
 * The frame carries four claims at once, and each is a thing a reader would
 * otherwise have to take on trust from the source: the scope selector with the
 * two organizations it may use, the grid listing the ORG route's records, a card
 * whose origin badge names the organization and whose footer has NO heart and NO
 * star (they are public-only interactions, §4.4), and the roster below the grid
 * with its pull action.
 *
 * The scope is switched the way a person switches it — the trigger, then the
 * option — and the shutter is released only once an org badge is on screen, so
 * the frame cannot be of the public hub with an org label pasted on it.
 */
const ORG_AGENT_COUNT = 6;

export const OrgScopeSelected: Story = {
	render: () => {
		installBridge({
			records: 12,
			signedIn: true,
			orgs: ORGS,
			orgAgents: ORG_AGENT_COUNT,
			teams: TEAMS,
		});
		return <AgentHubPage />;
	},
	play: async () => {
		await chooseScope("Minerva");
		/*
		 * `findAll`, not `find`: every org card carries a badge and the six cards
		 * mount in ONE React commit (probe-verified: 0 -> 6 inside a single poll
		 * step, no window with exactly one), so `findByTestId` threw "Found multiple
		 * elements" and aborted the capture sweep's console play-gate. The claim is
		 * unchanged - the org-scoped grid is on screen and EVERY card in it names its
		 * organization - and it is stated as an equality against the rendered cards
		 * (the fixture's `orgAgents`) rather than as "at least one", so a grid that
		 * mixed public cards into an org scope fails here.
		 */
		const badges = await screen.findAllByTestId("agent-org-badge");
		await waitFor(() =>
			expect(screen.getAllByTestId("agent-org-badge")).toHaveLength(
				badges.length,
			),
		);
		expect(badges).toHaveLength(ORG_AGENT_COUNT);
		expect(
			screen.getAllByRole("button", { name: CARD_DETAILS_NAME }),
		).toHaveLength(ORG_AGENT_COUNT);
		/* The Teams tab already carries its count: the split is legible unopened. */
		await waitFor(() =>
			expect(screen.getByTestId("agent-hub-view-teams")).toHaveTextContent(
				`Teams${TEAMS.length}`,
			),
		);
	},
};

/**
 * An organization that has shared nothing yet: the empty panel, which must not
 * invite a PUBLIC publication on a surface whose rows only one organization can
 * see (§8.4 keeps the two namespaces distinct), and which offers "Publish an
 * agent" only to a role the hub would accept one from.
 *
 * The owner's arm, so the action is present: the member's arm is the same panel
 * without the button, and the difference is the rank the membership carries.
 */
export const OrgEmpty: Story = {
	render: () => {
		installBridge({ records: 12, signedIn: true, orgs: ORGS, orgAgents: 0 });
		return <AgentHubPage />;
	},
	play: async () => {
		await chooseScope("Minerva");
		await screen.findByText("This organization has no shared agents yet.");
	},
};

/**
 * The org list refused with `team_plan_required` — a plan that lapsed between the
 * memberships read and the read of the workspace, which is the state the code
 * exists for.
 *
 * It must render as a STATE of the surface and not as the outage panel: the
 * sentence names the remedy (an owner activates the plan) and there is no "the
 * hub could not be loaded" anywhere in the frame, because retrying an organization
 * whose subscription stopped answers the same thing forever.
 */
export const OrgPlanLapsed: Story = {
	render: () => {
		installBridge({
			records: 12,
			signedIn: true,
			orgs: ORGS,
			orgRefusal: "plan",
		});
		return <AgentHubPage />;
	},
	play: async () => {
		await chooseScope("Minerva");
		await screen.findByTestId("agent-hub-org-no-access");
	},
};

/**
 * The revoked half: a membership that is no longer active answers `not_a_member`,
 * which is the SAME 403 a stranger gets (§2.2 refuses to say which of the three
 * it was).
 *
 * Its copy deliberately offers no retry — nothing this user can press changes it,
 * and an owner has to invite them again — so the frame is also the evidence that
 * the two refusal arms do not share one treatment.
 */
export const OrgAccessRevoked: Story = {
	render: () => {
		installBridge({
			records: 12,
			signedIn: true,
			orgs: ORGS,
			orgRefusal: "no_access",
		});
		return <AgentHubPage />;
	},
	play: async () => {
		await chooseScope("Minerva");
		await screen.findByTestId("agent-hub-org-no-access");
	},
};

/**
 * The Teams view in an organization: the roster the hub used to bury under the
 * agent grid and its pager, promoted to a tab that is on screen from the first
 * paint.
 *
 * The grid behind it is POPULATED (six org agents), which the old story could not
 * afford: the roster sat below the fold of a captured viewport and neither the
 * capture rig nor a `scrollIntoView` reached the page's inner scroll column, so
 * that frame had to empty the grid to photograph the roster at all. The tab makes
 * the fixture honest - the agents exist, the reader chose Teams - and the Agents
 * tab still carries its own count beside it.
 */
export const OrgTeams: Story = {
	render: () => {
		installBridge({
			records: 12,
			signedIn: true,
			orgs: ORGS,
			orgAgents: ORG_AGENT_COUNT,
			teams: TEAMS,
		});
		return <AgentHubPage />;
	},
	play: async () => {
		await chooseScope("Minerva");
		await openTeamsTab();
		await screen.findByTestId("org-teams");
		await waitFor(() =>
			expect(screen.getByTestId("agent-hub-status")).toHaveTextContent(
				"2 teams shared with Minerva",
			),
		);
	},
};

/** An organization that has shared no teams: the Teams view's empty sentence. */
export const OrgTeamsEmpty: Story = {
	render: () => {
		installBridge({
			records: 12,
			signedIn: true,
			orgs: ORGS,
			orgAgents: ORG_AGENT_COUNT,
			teams: [],
		});
		return <AgentHubPage />;
	},
	play: async () => {
		await chooseScope("Minerva");
		await openTeamsTab();
		await screen.findByTestId("org-teams-empty");
		await waitFor(() =>
			expect(screen.getByTestId("agent-hub-status")).toHaveTextContent(
				"0 teams shared with Minerva",
			),
		);
	},
};

/** The Teams view while `org_teams.list` is in flight: skeleton, sr-only sentence, no count on the tab. */
export const OrgTeamsLoading: Story = {
	render: () => {
		installBridge({
			records: 12,
			signedIn: true,
			orgs: ORGS,
			orgAgents: ORG_AGENT_COUNT,
			holdTeams: true,
		});
		return <AgentHubPage />;
	},
	play: async () => {
		await chooseScope("Minerva");
		await openTeamsTab();
		await screen.findByTestId("org-teams-loading");
	},
};

/**
 * The plan lapsed, read from the Teams view: the roster's own refusal (a warning
 * with the remedy), beside the Agents tab whose read was refused the same way.
 */
export const OrgTeamsPlanLapsed: Story = {
	render: () => {
		installBridge({
			records: 12,
			signedIn: true,
			orgs: ORGS,
			orgRefusal: "plan",
		});
		return <AgentHubPage />;
	},
	play: async () => {
		await chooseScope("Minerva");
		await openTeamsTab();
		await screen.findByTestId("org-teams-error");
	},
};

/**
 * Teams in the PUBLIC scope: there is no public team read (teams are shared
 * inside organizations, §11 O-7), so the view explains that and hands the reader
 * the organizations they can look inside. No list, and no invented "0 teams".
 */
export const TeamsPublicScope: Story = {
	render: () => {
		installBridge({
			records: 12,
			signedIn: true,
			orgs: ORGS,
			orgAgents: ORG_AGENT_COUNT,
			teams: TEAMS,
		});
		return <AgentHubPage />;
	},
	play: async () => {
		await screen.findByTestId("agent-hub-status");
		await openTeamsTab();
		await screen.findByTestId("agent-hub-teams-public");
	},
};

/** Teams while signed out: the sentence, and the settings page where the sign-in lives. */
export const TeamsSignedOut: Story = {
	render: () => {
		installBridge({ records: 12 });
		return <AgentHubPage />;
	},
	play: async () => {
		await screen.findByTestId("agent-hub-status");
		await openTeamsTab();
		await screen.findByRole("button", { name: "Open settings" });
	},
};

/**
 * A backend that predates the organization operations (agent review round 1,
 * M2): `radient_org` is absent, so the page asks for nothing and says why.
 *
 * The distinction this frame has to carry is the remedy. Without the capability
 * the operations answer a masked 422 — "The request has invalid fields." — which
 * a surface can neither classify nor retry into success, so "try again in a
 * moment" would send the reader to the one action that cannot work. The absence
 * of the scope row alone would read as "you have no organizations".
 */
export const OrgUnavailable: Story = {
	render: () => {
		installBridge({ records: 6, signedIn: true, orgCapability: false });
		return <AgentHubPage />;
	},
	play: async () => {
		await screen.findByTestId("agent-hub-status");
		await screen.findByTestId("agent-hub-org-unavailable");
	},
};
