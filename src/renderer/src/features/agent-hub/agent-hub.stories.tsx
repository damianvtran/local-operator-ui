/**
 * The agent hub: a category rail beside a grid of downloadable community
 * agents.
 *
 * The Radient endpoints the page reads — the agent list plus the three
 * per-card counts — are stubbed at `fetch`, so the real page, cards and
 * category rail render.
 */

import type { Meta, StoryObj } from "@storybook/react";
import "../../styles/index.css";
import { AgentHubPage } from "./agent-hub-page";

const daysAgo = (days: number) =>
	new Date(Date.now() - days * 86_400_000).toISOString();

type Fixture = {
	name: string;
	description: string;
	tags: string[];
	categories: string[];
	created: number;
	updated: number;
	likes: number;
	favourites: number;
	downloads: number;
};

const FIXTURES: Fixture[] = [
	{
		name: "Inbox triage",
		description:
			"Reads your unread email each morning, groups it by whether it needs a reply today, and sends you one summary instead of forty notifications.",
		tags: ["email", "morning"],
		categories: ["productivity"],
		created: 214,
		updated: 3,
		likes: 128,
		favourites: 64,
		downloads: 1840,
	},
	{
		name: "Finance digest",
		description:
			"Pulls last week's revenue and refunds out of your finance sheet and writes a short digest naming the three biggest movers.",
		tags: ["finance", "reporting", "weekly"],
		categories: ["finance"],
		created: 96,
		updated: 12,
		likes: 42,
		favourites: 19,
		downloads: 610,
	},
	{
		name: "Repo janitor",
		description:
			"Opens a branch, runs the formatter and the linter across a repository you point it at, and shows you the diff before anything is committed.",
		tags: ["code", "cleanup"],
		categories: ["software_development"],
		created: 33,
		updated: 1,
		likes: 305,
		favourites: 142,
		downloads: 4210,
	},
	{
		name: "Competitor watch",
		description:
			"Searches the news for the companies you name and forwards only the stories that mention pricing or a launch.",
		tags: ["research", "news"],
		categories: ["research"],
		created: 410,
		updated: 40,
		likes: 17,
		favourites: 8,
		downloads: 233,
	},
	{
		name: "Meeting notes",
		description:
			"Turns a transcript into notes with the decisions at the top and the actions underneath, each with a name against it.",
		tags: ["meetings", "writing"],
		categories: ["productivity"],
		created: 61,
		updated: 6,
		likes: 88,
		favourites: 51,
		downloads: 1290,
	},
	{
		name: "Spreadsheet cleaner",
		description:
			"Finds the duplicate rows, the dates stored as text and the numbers stored as strings, then fixes them and tells you what it changed.",
		tags: ["data"],
		categories: ["data_analysis"],
		created: 150,
		updated: 21,
		likes: 74,
		favourites: 30,
		downloads: 980,
	},
	{
		name: "Travel planner",
		description: "Books nothing. Plans everything, and shows its sources.",
		tags: ["travel"],
		categories: ["personal_assistance"],
		created: 8,
		updated: 8,
		likes: 5,
		favourites: 2,
		downloads: 61,
	},
	{
		name: "Release notes",
		description:
			"Reads the commits between two tags and writes release notes a customer can read, grouped by what changed for them.",
		tags: ["release", "writing", "changelog", "git"],
		categories: ["software_development"],
		created: 77,
		updated: 2,
		likes: 156,
		favourites: 97,
		downloads: 2470,
	},
];

const AGENTS = FIXTURES.map((fixture, index) => ({
	id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
	account_id: "acct-1",
	tenant_id: "tenant-1",
	account_metadata: {
		id: "acct-1",
		name: ["Dana Whitfield", "Priya Raman", "Sam Okonkwo"][index % 3],
		email: ["dana@example.com", "priya@example.com", "sam@example.com"][
			index % 3
		],
	},
	name: fixture.name,
	description: fixture.description,
	version: "1.4.0",
	created_at: daysAgo(fixture.created),
	updated_at: daysAgo(fixture.updated),
	tags: fixture.tags,
	categories: fixture.categories,
}));

const COUNTS: Record<
	string,
	{ like: number; favourite: number; download: number }
> = Object.fromEntries(
	AGENTS.map((agent, index) => [
		agent.id,
		{
			like: FIXTURES[index].likes,
			favourite: FIXTURES[index].favourites,
			download: FIXTURES[index].downloads,
		},
	]),
);

/** Lifted to module scope: a regex literal inside `fetch` recompiles per call. */
const COUNT_ENDPOINT =
	/\/v1\/agents\/([^/]+)\/(like|favourite|download)\/count/;

const json = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});

const installFetchStub = () => {
	const original = window.fetch;
	window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		const countMatch = COUNT_ENDPOINT.exec(url);
		if (countMatch) {
			const counts = COUNTS[countMatch[1]];
			const key = countMatch[2] as "like" | "favourite" | "download";
			return json({ msg: "ok", result: { count: counts?.[key] ?? 0 } });
		}
		if (url.includes("/v1/agents?")) {
			return json({
				msg: "ok",
				result: {
					page: 1,
					per_page: 12,
					records: AGENTS,
					total_pages: 3,
					total_records: 30,
				},
			});
		}
		return original(input, init);
	}) as typeof window.fetch;
};

installFetchStub();

const meta: Meta = {
	title: "Agent hub/Page",
	parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj;

/** The populated grid beside the category rail. */
export const Grid: Story = {
	render: () => <AgentHubPage />,
};
