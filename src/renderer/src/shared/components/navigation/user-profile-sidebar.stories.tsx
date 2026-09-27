/**
 * The rail's account row, in the states the operator met.
 *
 * WHAT THESE FRAMES ARE FOR. The operator's report was a generic "User" row
 * after signing in to Radient during setup, so the row's three paths need to be
 * photographed rather than asserted over a selector:
 *
 *  - `account-reconnect`: the account read FAILED (refused / unreachable /
 *    unknown). The row states the failure and its second line names the way
 *    back - "Reconnect Radient" - whose press opens the provider surface with
 *    Radient preselected. This is the frame the report is closed on;
 *  - `account-checking`: the read has not answered yet. The row says so and
 *    offers nothing - a reconnect under a question mark would send the reader
 *    to fix an account that may be fine;
 *  - `account-ready`: the account resolved, so the row shows the account and
 *    presses through to plain settings, which is what it always did.
 *
 * The row is the PRODUCT's, on a faithful slice of the rail foot (the 260px
 * `surface` column, the foot's own padding), so the frame is the row where it
 * ships. The desktop transport is stubbed the way `backend-settings.stories.tsx`
 * stubs it (`window.api.desktop.request`).
 */

import { UserProfileSidebar } from "@shared/components/navigation/user-profile-sidebar";
import type { Meta, StoryObj } from "@storybook/react";
import type { FC, ReactNode } from "react";
import "../../../styles/index.css";

type BridgeRequest = { op?: string; control?: { operation?: string } };
type DesktopResponse = { status: number; body: unknown };

type RowState = "account" | "refused" | "checking";

let bridge: ((request: BridgeRequest) => Promise<DesktopResponse>) | null =
	null;

const installBridge = (state: RowState) => {
	const ok = (result: unknown): DesktopResponse => ({
		status: 200,
		body: { result },
	});
	bridge = async (request) => {
		switch (request?.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: { radient: 1 },
				});
			case "radient.request":
				if (request?.control?.operation === "account") {
					if (state === "checking") {
						// Never settles: the `checking` row is the state under test.
						return await new Promise(() => {});
					}
					if (state === "refused") {
						return {
							status: 401,
							body: {
								detail: {
									code: "radient_credential_refused",
									message: "Radient could not complete this operation",
									details: {},
								},
							},
						};
					}
					return ok({
						data: {
							msg: "ok",
							result: {
								account: {
									id: "acct_storybook_row",
									tenant_id: "ten_storybook_row",
									email: "account@example.test",
									name: "Radient Account",
									role: "owner",
									status: "active",
									created_at: "2026-01-02T03:04:05Z",
									updated_at: "2026-01-02T03:04:05Z",
								},
								identity: {
									email: "account@example.test",
									provider: "google",
									provider_id: "google-storybook-row",
								},
							},
						},
					});
				}
				break;
			default:
				break;
		}
		return {
			status: 404,
			body: { detail: { code: "not_implemented", message: request?.op } },
		};
	};
};

if (typeof window !== "undefined") {
	const page = window as unknown as {
		api?: {
			desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> };
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = {
		request: (request: BridgeRequest) => {
			if (!bridge) throw new Error("no bridge installed for this story");
			return bridge(request);
		},
	};
}

/**
 * The rail foot's own slice: the 260px column on `surface`, the foot's padding
 * and its 40px row, with the settings gear's slot left empty (that gear is
 * `sidebar-navigation`'s and is not what these frames are about).
 */
const Foot: FC<{ children: ReactNode }> = ({ children }) => (
	<div className="flex h-screen bg-canvas">
		<div className="flex h-full w-[260px] flex-col overflow-hidden bg-surface">
			<div className="mt-auto flex min-h-10 shrink-0 items-center gap-1 px-2 pb-2">
				{children}
			</div>
		</div>
	</div>
);

const Row: FC<{ state: RowState }> = ({ state }) => {
	// Installed as the story RENDERS, not from an effect: the row's read can
	// fire before a parent layout effect runs, and a delegate that throws "no
	// bridge installed" would turn that race into a transport error.
	installBridge(state);
	return (
		<Foot>
			<UserProfileSidebar expanded />
		</Foot>
	);
};

const meta: Meta<{ state: RowState }> = {
	title: "Navigation/User profile",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj<{ state: RowState }>;

/** A failed read: the state is named, and the row carries the way back. */
export const AccountReconnect: Story = {
	args: { state: "refused" },
	render: (args) => <Row state={args.state} />,
};

/** A read still in flight: named as such, with nothing to press. */
export const AccountChecking: Story = {
	args: { state: "checking" },
	render: (args) => <Row state={args.state} />,
};

/** The ordinary resolved account. */
export const AccountReady: Story = {
	args: { state: "account" },
	render: (args) => <Row state={args.state} />,
};
