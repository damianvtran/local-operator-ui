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
 * backend older than the batched op answers 404 and the hub degrades to "no
 * viewer state" (the `SignedOut` story is the frame for that rendering, not for
 * that backend). The fixtures are the wire's SHAPE, verified against the live
 * public endpoint; the values in them are invented.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { screen, userEvent } from "@storybook/test";
import type { DesktopResponse } from "../../../../shared/desktop-contract";
import "../../styles/index.css";
import { AgentHubPage } from "./agent-hub-page";

/* --------------------------------------------------------------- the bridge */

type BridgeRequest = {
	op: string;
	control?: {
		operation?: string;
		query?: Record<string, string | number>;
	};
};

/** Every request the page made, oldest first, as `op` or `control.operation`. */
const ledger: string[] = [];

const publishLedger = () => {
	(window as unknown as { __hubLedger?: () => string[] }).__hubLedger = () => [
		...ledger,
	];
};

/** The fixture records, in `GET /v1/agents`'s own field names. */
const buildAgents = (count: number) =>
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
		like_count: 12 + index * 7,
		favourite_count: 4 + index * 3,
		download_count: 120 + index * 143,
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
	/** Records for a list request that carries a `categories` filter. */
	filteredRecords?: number;
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
	/** Viewer state to report for the ids the page asks about. */
	liked?: string[];
	favourited?: string[];
};

const installBridge = (behaviour: BridgeBehaviour = {}) => {
	const {
		records = 12,
		filteredRecords = 0,
		failList = false,
		holdList = false,
		holdAfterFirst = false,
		signedIn = false,
		liked = [],
		favourited = [],
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
				features: { radient: 1, profile_catalogue: 1, team_catalogue: 1 },
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
					const filtered = Boolean(request.control?.query?.categories);
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
							records: buildAgents(shown),
						},
					});
				}
				case "agents.statuses": {
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
