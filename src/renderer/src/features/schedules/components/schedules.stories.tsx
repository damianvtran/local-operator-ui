/**
 * The schedules surface: the list of scheduled tasks and the create/edit form.
 *
 * `fetch` is stubbed at the boundary for the two endpoints this page reads —
 * the schedule list and the agent lookup each row does for its owner name — so
 * the real page, the real query layer and the real row component all run.
 */

import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { ThemeName } from "@shared/themes";
import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useLayoutEffect } from "react";
import "../../../styles/index.css";
import { SchedulesPage } from "./schedules-page";

const THEME_IDS = [
	"localOperatorDark",
	"localOperatorLight",
	"dracula",
	"dune",
	"sage",
	"monokai",
	"tokyoNight",
	"iceberg",
	"radient",
	"neon",
	"obsidian",
	"synth",
] as const;

type StoryArgs = { theme: (typeof THEME_IDS)[number] };

const ThemeFrame = ({
	theme,
	children,
}: {
	theme: ThemeName;
	children: ReactNode;
}) => {
	useLayoutEffect(() => {
		const previousAttr = document.documentElement.dataset.theme;
		const previousName = useUiPreferencesStore.getState().themeName;
		document.documentElement.dataset.theme = theme;
		useUiPreferencesStore.setState({ themeName: theme });
		return () => {
			if (previousAttr === undefined) {
				document.documentElement.removeAttribute("data-theme");
			} else {
				document.documentElement.dataset.theme = previousAttr;
			}
			useUiPreferencesStore.setState({ themeName: previousName });
		};
	}, [theme]);

	return (
		<div
			data-theme={theme}
			className="h-screen bg-canvas font-sans text-body text-ink"
		>
			{children}
		</div>
	);
};

const AGENTS = [
	{ id: "3f21c0aa-1d55-4a8b-9a1e-27a4f0d9b111", name: "Inbox triage" },
	{ id: "8c04b7e2-93f1-4c0d-8d2a-11f4e6c7a222", name: "Weekly finance digest" },
	{ id: "b1d9e5f4-7a22-4f3e-93c8-5d0b2a8f3333", name: "Site uptime watch" },
	{ id: "d7e2a913-0c48-4b6f-81a5-96c3f1e84444", name: "Competitor news" },
];

const hoursFromNow = (hours: number) =>
	new Date(Date.now() + hours * 3600_000).toISOString();

const SCHEDULES = [
	{
		id: "9b2f4c11-63ea-4c7f-9d18-4f60a2c7d001",
		agent_id: AGENTS[0].id,
		prompt:
			"Read my unread email, group it by whether it needs a reply today, and send me one summary message.",
		interval: 1,
		unit: "hours",
		is_active: true,
		one_time: false,
		start_time_utc: hoursFromNow(1),
		end_time_utc: null,
		created_at: hoursFromNow(-72),
		updated_at: hoursFromNow(-2),
	},
	{
		id: "1a7c8e33-2b41-4de9-8a05-73c9f4b1d002",
		agent_id: AGENTS[1].id,
		prompt:
			"Pull last week's revenue and refunds from the finance sheet and write a short digest with the three biggest movers.",
		interval: 1,
		unit: "days",
		is_active: true,
		one_time: false,
		start_time_utc: hoursFromNow(9),
		end_time_utc: null,
		created_at: hoursFromNow(-400),
		updated_at: hoursFromNow(-30),
	},
	{
		id: "5d3b9f07-84c2-41a6-b7e3-08d5c2f6e003",
		agent_id: AGENTS[2].id,
		prompt: "Check that the status page is up and tell me only if it is not.",
		interval: 15,
		unit: "minutes",
		is_active: false,
		one_time: false,
		start_time_utc: null,
		end_time_utc: null,
		created_at: hoursFromNow(-900),
		updated_at: hoursFromNow(-120),
	},
	{
		id: "c8e1a462-fd39-4b52-9c74-6a2b8e0f5004",
		agent_id: AGENTS[3].id,
		prompt:
			"Search for news about our three closest competitors and send me anything that mentions pricing.",
		interval: 1,
		unit: "days",
		is_active: true,
		one_time: true,
		start_time_utc: hoursFromNow(26),
		end_time_utc: hoursFromNow(27),
		created_at: hoursFromNow(-10),
		updated_at: hoursFromNow(-10),
	},
];

/** Lifted to module scope: a regex literal inside `fetch` recompiles per call. */
const AGENT_BY_ID = /\/v1\/agents\/([0-9a-f-]{36})(?:\?|$)/;

const json = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});

const installFetchStub = () => {
	const original = window.fetch;
	window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		if (url.includes("/v1/schedules")) {
			return json({
				status: 200,
				message: "ok",
				result: {
					schedules: SCHEDULES,
					total: SCHEDULES.length,
					page: 1,
					per_page: 50,
				},
			});
		}
		const agentMatch = AGENT_BY_ID.exec(url);
		if (agentMatch) {
			const agent = AGENTS.find((candidate) => candidate.id === agentMatch[1]);
			return json({ status: 200, message: "ok", result: agent ?? AGENTS[0] });
		}
		if (url.includes("/v1/agents")) {
			return json({
				status: 200,
				message: "ok",
				result: {
					agents: AGENTS,
					total: AGENTS.length,
					page: 1,
					per_page: 50,
				},
			});
		}
		return original(input, init);
	}) as typeof window.fetch;
};

installFetchStub();

const meta: Meta<StoryArgs> = {
	title: "Schedules/Page",
	parameters: { layout: "fullscreen" },
	argTypes: {
		theme: { control: { type: "select" }, options: THEME_IDS },
	},
	args: { theme: "localOperatorDark" },
};

export default meta;

type Story = StoryObj<StoryArgs>;

/** The populated list. */
export const List: Story = {
	render: ({ theme }) => (
		<ThemeFrame theme={theme}>
			<SchedulesPage />
		</ThemeFrame>
	),
};
