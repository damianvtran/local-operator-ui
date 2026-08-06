/**
 * The schedules surface: the list of scheduled tasks and the create/edit form.
 *
 * `fetch` is stubbed at the boundary for the two endpoints this page reads —
 * the schedule list and the agent lookup each row does for its owner name — so
 * the real page, the real query layer and the real row component all run.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useEffect } from "react";
import "../../../styles/index.css";
import { DateTimePicker } from "@shared/components/common/date-time-picker";
import { apiConfig } from "@shared/config/api-config";
import { SchedulesPage } from "./schedules-page";

const AGENTS = [
	{ id: "3f21c0aa-1d55-4a8b-9a1e-27a4f0d9b111", name: "Inbox triage" },
	{ id: "8c04b7e2-93f1-4c0d-8d2a-11f4e6c7a222", name: "Weekly finance digest" },
	{ id: "b1d9e5f4-7a22-4f3e-93c8-5d0b2a8f3333", name: "Site uptime watch" },
	{ id: "d7e2a913-0c48-4b6f-81a5-96c3f1e84444", name: "Competitor news" },
];

/**
 * A fixed local wall-clock time on a fixed day, as UTC.
 *
 * Every timestamp in this fixture is pinned to one week in March 2026, and
 * that is the whole point. Two rows used to take `hoursFromNow`, so their
 * rendered minute-past and their date moved with the capture clock: 39 of the
 * 41 schedules frames changed on a recapture where no schedules code had
 * changed at all, and a recapture diff that churns cannot be read as "here is
 * what moved". A commit of mine claimed one surface had moved when the diff
 * carried thirteen.
 *
 * Pinned dates also make the awkward cases stable rather than accidental: the
 * overnight row below genuinely crosses midnight in every frame instead of
 * whenever the capture happens to run late. The set re-renders once at a year
 * boundary, when the recurrence sentences start naming the year - that is a
 * known, once-a-year churn rather than a daily one.
 */
const at = (day: number, hour: number, minute = 0) =>
	new Date(2026, 2, day, hour, minute, 0, 0).toISOString();

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
		start_time_utc: at(15, 20, 16),
		end_time_utc: null,
		created_at: at(12, 9, 0),
		updated_at: at(15, 8, 30),
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
		start_time_utc: at(16, 3, 59),
		end_time_utc: null,
		created_at: at(1, 14, 0),
		updated_at: at(14, 7, 15),
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
		created_at: at(2, 11, 0),
		updated_at: at(10, 16, 45),
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
		/* 10:15 AM to 11:15 AM tomorrow: the same-day counterpart to the
		   overnight row below, and pinned for the same reason - as
		   a clock-relative offset this flipped to a cross-midnight window in a
		   late-evening capture, and it is the only frame the same-day branch
		   has. */
		start_time_utc: at(16, 10, 15),
		end_time_utc: at(16, 11, 15),
		created_at: at(15, 6, 0),
		updated_at: at(15, 6, 0),
	},
	{
		/* A recurring schedule with BOTH ends - the shape no fixture covered, and
		   the one where the sub-day offset clause and the end clause meet. It
		   rendered "at 16 minutes past to 11:30 PM" until round 9. */
		id: "6f708192-2c3d-4e5f-9a0b-c1d2e3f4a5b6",
		agent_id: AGENTS[1].id,
		agent_name: "Market open watch",
		prompt:
			"Check the pre-market movers and tell me only about the ones on my watchlist.",
		interval: 1,
		unit: "hours",
		is_active: true,
		one_time: false,
		start_time_utc: at(15, 9, 16),
		end_time_utc: at(15, 16, 30),
		created_at: at(13, 18, 0),
		updated_at: at(13, 18, 0),
	},
	{
		/* A one-time window that crosses midnight: the sentence has to name both
		   days, because "between 11 PM and 1 AM on Thursday" is a day out on the
		   start. */
		id: "5e5f6a70-1b2c-4d3e-8f90-a1b2c3d4e5f6",
		agent_id: AGENTS[0].id,
		agent_name: "Overnight backup check",
		prompt:
			"After the nightly backup finishes, check it restored cleanly and tell me only if it did not.",
		interval: 1,
		unit: "days",
		is_active: true,
		one_time: true,
		/* 11:20 PM tonight to 6:40 AM tomorrow: a window that always crosses
		   midnight, whatever hour the capture runs at. */
		start_time_utc: at(15, 23, 20),
		end_time_utc: at(16, 6, 40),
		created_at: at(15, 6, 0),
		updated_at: at(15, 6, 0),
	},
];

/** Lifted to module scope: a regex literal inside `fetch` recompiles per call. */
const AGENT_BY_ID = /\/v1\/agents\/([0-9a-f-]{36})(?:\?|$)/;

const json = (body: unknown) =>
	new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});

/*
 * The origin the page actually calls, read from the same config the app reads
 * rather than written out here - the copy in `shell.stories.tsx` had drifted
 * from the schema default exactly that way.
 */
const BACKEND_ORIGIN = new URL(apiConfig.baseUrl).origin;

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
		/*
		 * Unrouted backend paths fail here rather than reaching the network,
		 * for the reason set out in `shell.stories.tsx`: falling through is
		 * invisible while the port is dead and photographs a real server's
		 * replies the moment it is not. This surface was measured leaking four
		 * requests - `/health` and `/v1/config` - against a live backend.
		 *
		 * It rejects rather than returning `Response.error()`, because that
		 * resolves with status 0 and renders as a third state belonging to
		 * neither a live server nor an absent one.
		 */
		if (url.startsWith(BACKEND_ORIGIN)) {
			throw new TypeError("Load failed");
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

/**
 * The row's actions, revealed.
 *
 * `:hover` cannot be forced from markup, so the edit and delete buttons - and
 * the tooltips and aria-labels they carry - existed in no captured frame.
 * That is the gap four corrupted user-facing strings passed through in round
 * 8, one of them the entire accessible name of an icon-only button. This
 * story writes the revealed state statically, the way the primitives sheet
 * fakes focus and pressed.
 */
export const RowActionsRevealed: Story = {
	render: () => (
		<div className="[&_.pointer-events-none.opacity-0]:pointer-events-auto [&_.pointer-events-none.opacity-0]:opacity-100">
			<SchedulesPage />
		</div>
	),
};

/**
 * Opens the first row's edit tooltip, and holds the capture until it is up.
 *
 * The label is one of 65 tooltip strings that had never appeared in any
 * frame - which is how a rename put "SquarePen schedule" on both a tooltip
 * and an icon-only button's accessible name and survived a design round. A
 * tooltip is also a positioned surface, so whether it collides with the
 * delete button beside it, covers the row below, or clears the hairline are
 * only answerable against the row it actually opens on.
 *
 * Opened by focusing the button rather than by forcing state: Radix opens on
 * focus, so this is the path a keyboard user takes and the frame shows what
 * they see. `side` stays unset for the same reason - every call site takes
 * the default, so pinning it would photograph a placement the app never
 * renders.
 */
const OpenFirstRowTooltip = () => {
	useEffect(() => {
		/* The rows arrive from a stubbed query, so the button does not exist on
		   the first tick and a screenshot taken when the story "finished
		   rendering" would catch the page before the tooltip.
		   `data-capture-pending` is the capture's opt-in wait. */
		document.documentElement.dataset.capturePending = "1";
		const clear = () =>
			document.documentElement.removeAttribute("data-capture-pending");
		let tries = 0;
		let settle: number | undefined;
		const id = setInterval(() => {
			const button = document.querySelector<HTMLElement>(
				'button[aria-label="Edit schedule"]',
			);
			if (button) {
				button.focus();
				clearInterval(id);
				/* One more beat for Radix to mount the tooltip it opens on focus. */
				settle = window.setTimeout(clear, 300);
			} else if (++tries > 100) {
				/* Deliberately does NOT clear the flag. The probe looks for the
				   exact accessible name this story exists to prove is present,
				   so the one regression it guards against is also the thing that
				   makes the probe fail. Clearing here would let a tooltip-less
				   frame be written and pass every guard, since none of them can
				   see a missing tooltip. Leaving it set makes the capture time
				   out and name this story instead. */
				clearInterval(id);
			}
		}, 50);
		return () => {
			clearInterval(id);
			clearTimeout(settle);
			clear();
		};
	}, []);
	return null;
};

export const RowActionLabel: Story = {
	render: () => (
		<div className="[&_.pointer-events-none.opacity-0]:pointer-events-auto [&_.pointer-events-none.opacity-0]:opacity-100">
			<SchedulesPage />
			<OpenFirstRowTooltip />
		</div>
	),
};
