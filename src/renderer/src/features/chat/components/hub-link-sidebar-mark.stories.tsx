/**
 * The sidebar's per-link hub mark, in the states whose COLLAPSED tooltip the
 * operator reads (report 2026-11-11: every failure said only "Retry Incoming
 * update for <team> at <source>", with no cause and no age).
 *
 * ## What is stubbed, and what is not
 *
 * The real `HubLinkSidebarMark`, its real view/adapter/copy and the app's real
 * providers (Storybook's preview). `window.api.desktop.request` answers every
 * op with an empty 200, so nothing here writes: a frame proves the tooltip's
 * wording, not the retry route (core's tests and QA own that).
 *
 * The link rows are written from core's `GET /v1/desktop/hub/links` shapes as
 * a real serve answered them in core PR #3807's reproduction (a 401'd startup
 * check, then a hub-error); the sentences in `safe_message` are core's.
 */

import type {
	HubDirectionStatus,
	HubLink,
} from "@shared/api/local-operator/hub-links";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { useLayoutEffect, useState } from "react";
import { HubLinkSidebarMark } from "./hub-link-sidebar-mark";

const CHECKED = "2026-11-11T15:55:16Z";

const direction = (
	over: Partial<HubDirectionStatus> = {},
): HubDirectionStatus => ({
	state: "idle",
	classification: null,
	enabled: true,
	last_checked_at: CHECKED,
	last_success_at: null,
	attempts: 0,
	next_retry_at: null,
	error_class: null,
	error_subclass: null,
	safe_message: null,
	operation_id: null,
	model_used: null,
	summary: null,
	backup_receipt: null,
	...over,
});

const link = (pull: Partial<HubDirectionStatus>): HubLink => ({
	link_id: "lnk-radientdev",
	kind: "team",
	local_id: "f7e09a4e-a98f-4729-8117-dc93dc4ece45",
	name: "radientdev",
	hub_id: "ht-radientdev",
	hub_source: "https://api.radienthq.com/v1",
	visibility: "public",
	tenant_id: null,
	tenant_name: null,
	policy: { subscribe: true, auto_push: false, revision: "rev-1" },
	eligibility: { can_auto_push: false, reason: null },
	baseline_state: "pull",
	remote_revision: '"rev-1"',
	auto_will_apply: false,
	auto_will_push: false,
	pull: direction(pull),
	push: direction(),
});

function Frame({ row }: { row: HubLink }) {
	const [ready, setReady] = useState(false);
	useLayoutEffect(() => {
		const previous = window.api.desktop;
		window.api.desktop = {
			...previous,
			request: async () => ({ status: 200, body: { result: {} } }),
		} as typeof previous;
		setReady(true);
		return () => {
			window.api.desktop = previous;
		};
	}, []);
	if (!ready) return null;
	return (
		<div className="flex h-40 w-80 items-end justify-center bg-surface p-4">
			<HubLinkSidebarMark
				link={row}
				staged={false}
				onDetail={() => {}}
				itemName="radientdev"
				displayName="Radient Dev"
				itemsById
				nameAmbiguous={false}
			/>
		</div>
	);
}

const meta: Meta<typeof Frame> = {
	title: "Chat/Sidebar/Hub link mark",
	component: Frame,
	parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj<typeof Frame>;

const hoverShows =
	(text: RegExp) =>
	async ({ canvasElement }: { canvasElement: HTMLElement }) => {
		const mark = await within(canvasElement).findByRole("button");
		await userEvent.hover(mark);
		await waitFor(() => expect(document.body.textContent ?? "").toMatch(text));
	};

/** A counted hub failure: the tooltip names the stored reason and its age. */
export const FailedWithReason: Story = {
	args: {
		row: link({
			state: "failed",
			attempts: 2,
			error_class: "hub-error",
			safe_message: "the hub returned an error (HTTP 502: Team lookup failed.)",
		}),
	},
	play: hoverShows(/Reason: the hub returned an error \(HTTP 502/),
};

/** A 401 the hub answered (core PR #3807): a sign-in fact, not a retry. */
export const RejectedSignIn: Story = {
	args: {
		row: link({
			state: "failed",
			error_class: "no-credential",
			error_subclass: "rejected",
			safe_message:
				"the hub did not accept the sign-in (HTTP 401: invalid API key format)",
		}),
	},
	play: hoverShows(/the hub did not accept the sign-in/),
};

/** Healthy: no failure tail at all. */
export const Healthy: Story = {
	args: { row: link({}) },
};
