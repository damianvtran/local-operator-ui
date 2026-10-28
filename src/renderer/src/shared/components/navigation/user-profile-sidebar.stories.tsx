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
 *    presses through to plain settings, which is what it always did;
 *  - `account-photo` / `account-photo-collapsed`: the account carries a Radient
 *    profile photo (`/me`'s `profile.avatar`), so the plate shows it, read
 *    through the private avatar relay (`desktop.media` `team_bridge.avatar`) in
 *    place of the initials, in both rail states. The fixture is an OPAQUE
 *    portrait JPEG on purpose (design review round 1, D3): a transparent icon
 *    hides the plate's rounded-square clip, which is the thing under review;
 *  - `account-photo-transparent`: a transparent PNG upload (people do upload
 *    logos), which must sit on the plate's own `media-surface` fill rather than
 *    float on the row (D4);
 *  - `account-photo-loading`: the account has a photo but the bytes never
 *    arrive, so the initials hold the plate in its final geometry - the frame a
 *    launch shows until the photo lands (D3);
 *  - `account-signed-out`: no Radient credential, so no photo is ever requested
 *    and the row shows the generic mark on the same plate (D3).
 *    `account-ready` stays the no-photo frame: initials on the borderless plate;
 *  - `account-reconnect-menu`: the same failed read with the row's `useAuth`
 *    branch - a press opens the account menu, whose "Reconnect Radient" item
 *    is the same way back. No rail call site passes `useAuth` today, so this
 *    state exists because the public prop and its menu are part of the
 *    component's contract and a branch no one can look at is one no one can
 *    check (QA round 1, Q2).
 *
 * The row is the PRODUCT's, on a faithful slice of the rail foot (the 260px
 * `surface` column, the foot's own padding), so the frame is the row where it
 * ships. The desktop transport is stubbed the way `backend-settings.stories.tsx`
 * stubs it (`window.api.desktop.request`).
 */

import { UserProfileSidebar } from "@shared/components/navigation/user-profile-sidebar";
import type { Meta, StoryObj } from "@storybook/react";
import type { FC, ReactNode } from "react";
import { useLayoutEffect } from "react";
import portraitImage from "../../../assets/images/storybook-avatar-portrait.jpg";
import transparentImage from "../../../assets/radient-icon-1024x1024.png";
import "../../../styles/index.css";

type BridgeRequest = { op?: string; control?: { operation?: string } };
type DesktopResponse = { status: number; body: unknown };

type RowState = "account" | "photo" | "refused" | "checking" | "signed-out";
/** What the avatar relay answers in a photo story. */
type PhotoMode = "portrait" | "transparent" | "pending";
type MediaRequest = { op?: string };
type MediaResponse =
	| { status: number; kind: "bytes"; mimeType: string; data: Uint8Array }
	| { status: number; kind: "error"; detail: string };

let bridge: ((request: BridgeRequest) => Promise<DesktopResponse>) | null =
	null;
let photoMode: PhotoMode = "portrait";

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
					if (state === "signed-out") {
						// What core answers with no Radient credential stored.
						return {
							status: 409,
							body: {
								detail: {
									code: "radient_no_credential",
									message: "Sign in to Radient to access your account",
								},
							},
						};
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
									id: "acc_storybook_row",
									tenant_id: "ten_storybook_row",
									email: "account@example.test",
									name: "Radient Account",
									role: "owner",
									status: "active",
									created_at: "2026-01-02T03:04:05Z",
									updated_at: "2026-01-02T03:04:05Z",
									// Only the photo state carries one: `account-ready`
									// is the frame for an account without a photo.
									...(state === "photo"
										? {
												profile: {
													avatar: {
														source: "uploaded",
														hash: "0123456789abcdef",
													},
												},
											}
										: {}),
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
			desktop?: {
				request: (r: BridgeRequest) => Promise<DesktopResponse>;
				media?: (r: MediaRequest) => Promise<MediaResponse>;
			};
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = {
		request: (request: BridgeRequest) => {
			if (!bridge) throw new Error("no bridge installed for this story");
			return bridge(request);
		},
		// The private avatar relay: the bytes the photo state's plate shows.
		media: async (request: MediaRequest): Promise<MediaResponse> => {
			if (request?.op !== "team_bridge.avatar")
				return { status: 404, kind: "error", detail: "not in this story" };
			// Never settles: the loading frame is the state under test.
			if (photoMode === "pending") return await new Promise(() => {});
			const transparent = photoMode === "transparent";
			const bytes = await (
				await fetch(transparent ? transparentImage : portraitImage)
			).arrayBuffer();
			return {
				status: 200,
				kind: "bytes",
				mimeType: transparent ? "image/png" : "image/jpeg",
				data: new Uint8Array(bytes),
			};
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

const Row: FC<{ state: RowState; expanded?: boolean; photo?: PhotoMode }> = ({
	state,
	expanded = true,
	photo = "portrait",
}) => {
	// Installed as the story RENDERS, not from an effect: the row's read can
	// fire before a parent layout effect runs, and a delegate that throws "no
	// bridge installed" would turn that race into a transport error.
	installBridge(state);
	photoMode = photo;
	return (
		<Foot>
			<UserProfileSidebar expanded={expanded} />
		</Foot>
	);
};

/**
 * The `useAuth` branch, with its menu held open.
 *
 * Radix opens on POINTERDOWN, so a synthetic `.click()` would not open it in
 * the capture browser; the story dispatches a real `pointerdown` on the trigger
 * and keeps the shutter up (the `capturePending` convention the other pressed
 * stories use) until the menu's items are actually in the DOM - pressing again
 * only while it is still closed, because a second press on an open trigger
 * toggles it shut.
 */
const AuthMenuRow: FC<{ state: RowState }> = ({ state }) => {
	installBridge(state);
	useLayoutEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		let cancelled = false;
		let timer = 0;
		let attempts = 0;
		const menuOpen = () => document.querySelector('[role="menuitem"]') !== null;
		const step = () => {
			if (cancelled) return;
			if (menuOpen()) {
				document.documentElement.removeAttribute("data-capture-pending");
				return;
			}
			if (attempts++ < 4) {
				const trigger = document.querySelector<HTMLElement>(
					"[data-story-auth-menu] button",
				);
				trigger?.dispatchEvent(
					new PointerEvent("pointerdown", {
						bubbles: true,
						cancelable: true,
						button: 0,
						pointerType: "mouse",
					}),
				);
			}
			timer = window.setTimeout(step, 400);
		};
		timer = window.setTimeout(step, 150);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
			document.documentElement.removeAttribute("data-capture-pending");
		};
	}, []);
	return (
		<Foot>
			<span className="contents" data-story-auth-menu>
				<UserProfileSidebar expanded useAuth />
			</span>
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

/** The account's own Radient photo on the plate, in place of its initials. */
export const AccountPhoto: Story = {
	args: { state: "photo" },
	render: (args) => <Row state={args.state} />,
};

/** The collapsed rail: the photo alone. */
export const AccountPhotoCollapsed: Story = {
	args: { state: "photo" },
	render: (args) => <Row state={args.state} expanded={false} />,
};

/** A transparent upload: the plate's own fill stays behind it. */
export const AccountPhotoTransparent: Story = {
	args: { state: "photo" },
	render: (args) => <Row state={args.state} photo="transparent" />,
};

/** The photo's bytes in flight: initials hold the plate, same geometry. */
export const AccountPhotoLoading: Story = {
	args: { state: "photo" },
	render: (args) => <Row state={args.state} photo="pending" />,
};

/** No Radient credential: no photo request, the generic mark on the plate. */
export const AccountSignedOut: Story = {
	args: { state: "signed-out" },
	render: (args) => <Row state={args.state} />,
};

/** The `useAuth` branch: the account menu, open, with its reconnect item. */
export const AccountReconnectMenu: Story = {
	args: { state: "refused" },
	render: (args) => <AuthMenuRow state={args.state} />,
};
