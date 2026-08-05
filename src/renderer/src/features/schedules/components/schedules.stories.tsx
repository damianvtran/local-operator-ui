/**
 * The schedules surface: the list of scheduled tasks and the create/edit form.
 *
 * `fetch` is stubbed at the boundary for the two endpoints this page reads —
 * the schedule list and the agent lookup each row does for its owner name — so
 * the real page, the real query layer and the real row component all run.
 */

import type { Meta, StoryObj } from "@storybook/react";
import "../../../styles/index.css";
import { DateTimePicker } from "@shared/components/common/date-time-picker";
import { SchedulesPage } from "./schedules-page";

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

const meta: Meta = {
	title: "Schedules/Page",
	parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj;

/** The populated list. */
export const List: Story = {
	render: () => <SchedulesPage />,
};

/**
 * The date-time picker, open.
 *
 * The picker's calendar never had a frame in any round - nothing ever opened
 * it - so its one MUI surface was reviewed from the stylesheet alone. The
 * wrapper takes `initialOpen` for exactly this.
 */
export const PickerOpen: Story = {
	render: () => (
		<div className="flex h-screen items-center justify-center bg-canvas p-8">
			<div className="w-90 rounded-lg border border-hairline bg-surface p-4">
				<DateTimePicker
					label="Starts"
					value="2026-08-06T01:05:00.000Z"
					onChange={() => {}}
					initialOpen
				/>
			</div>
		</div>
	),
};
