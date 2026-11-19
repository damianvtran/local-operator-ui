/**
 * The composer's Radient sign-in callout, one story per state it can stand in.
 *
 * WHY THIS EXISTS. The callout had no frame of its own: its states were judged
 * only through `scripts/radient-session-issue.test.mjs`, which reads text and
 * attributes, never pixels. The 2026-11-06 change removed its last line - a
 * hard-coded English "run `lop login radient` in a terminal" - and added the
 * `not-cleared` state for a sign-in that completed without healing the login.
 * Both are visual claims (what the block says, and what it no longer says), so
 * each state is drawn here where a design round can look at it.
 *
 * WHAT IS REAL: the shipped `RadientSessionIssueCallout`, its copy through
 * `t()`, and the backend's response shape (`tunnel_remedy {command, url}`) as the
 * `remedy` the hook passes through - including the `command` the callout must
 * NOT render. WHAT IS NOT: the hook. The flow that reaches each state (and the
 * bounded re-read that decides `not-cleared`) is driven end to end by the test
 * file above; a story that faked the poll would be a second, weaker copy of it.
 *
 * The frame is the composer column's measure (and the narrow window's, for the
 * new state, whose sentence is the longest the block carries).
 */

import type { Meta, StoryObj } from "@storybook/react";
import "../../../styles/index.css";
import type { RadientSessionIssue } from "@shared/hooks/use-radient-session-issue";
import { RadientSessionIssueCallout } from "./radient-session-issue";

const meta: Meta = { title: "chat/radient-session-issue" };
export default meta;

type Story = StoryObj;

/** The backend's remedy exactly as `GET /v1/auth/status` sends it today. */
const REMEDY = {
	command: "lop login radient",
	url: "https://console.radienthq.com",
};

const noop = () => {};

const Frame = ({
	issue,
	width,
	isSmallView = false,
}: {
	issue: RadientSessionIssue;
	width: number;
	isSmallView?: boolean;
}) => (
	<div className="bg-canvas p-6" style={{ width }}>
		<RadientSessionIssueCallout
			issue={issue}
			onSignIn={noop}
			onCancel={noop}
			onDismiss={noop}
			isSmallView={isSmallView}
		/>
	</div>
);

/** The login is dead: one action, and (since 2026-11-06) no terminal line under it. */
export const NeedsSignIn: Story = {
	render: () => (
		<Frame issue={{ kind: "needs-sign-in", remedy: REMEDY }} width={720} />
	),
};

/** A sign-in from this callout is in flight (also what the bounded re-read shows). */
export const SigningIn: Story = {
	render: () => <Frame issue={{ kind: "signing-in" }} width={720} />,
};

/**
 * The new state: the sign-in completed, and the verdict still said
 * `login_required` after the one bounded re-read. In-app next steps only.
 */
export const NotCleared: Story = {
	render: () => (
		<Frame issue={{ kind: "not-cleared", remedy: REMEDY }} width={720} />
	),
};

/** The same state at the narrow window's measure, where its sentence wraps most. */
export const NotClearedNarrow: Story = {
	render: () => (
		<Frame
			issue={{ kind: "not-cleared", remedy: REMEDY }}
			width={440}
			isSmallView
		/>
	),
};

/** A failed attempt: the backend's own sentence, and the retry. */
export const Failed: Story = {
	render: () => (
		<Frame
			issue={{
				kind: "settled",
				message: "Sign-in failed: the browser step was not completed.",
				canRetry: true,
			}}
			width={720}
		/>
	),
};
