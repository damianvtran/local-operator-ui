/**
 * Evidence harness: the shipped `McpAuthDialog` at a settled MCP grant.
 *
 * WHY A HARNESS RATHER THAN A STORY. This dialog only reaches a settled footer
 * through a REAL grant operation: it asks `mcp.control {action:"probe"}` on
 * mount, and the operation its body and footer are built from comes out of the
 * `mcp.list` document its own poll reads. Storybook's preview mocks `window.api`
 * without a `desktop` branch, so a story would have to install this bridge
 * per-story anyway; the bridge seam is what this page installs instead, and it is
 * the same seam `scripts/mcp-auth-surface.test.mjs` pins.
 *
 * The subject is the FOOTER at `Sign-in complete.`, so the case is driven through
 * the dialog's own controls rather than by forcing a phase into React state: the
 * probe answers "OAuth", `Continue in browser` is pressed as a real DOM click,
 * and the poll answers the operation status the case names. `?case=` picks the
 * status, `?theme=` the brand palette.
 *
 * `window.__mcpAuthEvidence` publishes what the page is showing, read from the
 * DOM, so the capture asserts the state it photographed instead of trusting the
 * pixels to be the state somebody meant.
 *
 * See `../README.md` for the command that boots this page and what the frames it
 * produces do and do not prove.
 */

import { McpAuthDialog } from "@features/chat/components/run-details/mcp-auth-dialog";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "@renderer/styles/index.css";

/** The wire status the `mcp.list` document reports for this frame's case. */
type Case = "complete" | "failed" | "cancelled";

const params = new URLSearchParams(window.location.search);
const CASE = (params.get("case") ?? "complete") as Case;
const THEME = params.get("theme") ?? "localOperatorDark";
const SESSION = "evidence-session";

document.documentElement.dataset.theme = THEME;

/** The row the dialog is opened for: an HTTP server whose probe answers "OAuth". */
const ROW = {
	name: "hubspot",
	status: "auth-required",
	problem: true,
	toolCount: null,
	scope: "global",
	transport: "http",
};

const requests: string[] = [];

/*
 * The bridge, standing exactly where the preload's `desktop.request` stands.
 * Every answer is the envelope the backend sends on that route: `capabilities`
 * and `mcp.control`'s probe ride `{data}` inside `result`, `mcp.list` is the
 * session's `{servers, operations}` document.
 */
(window as unknown as { api: unknown }).api = {
	desktop: {
		request: async (request: { op: string; name?: string }) => {
			requests.push(request.op);
			if (request.op === "capabilities")
				return {
					status: 200,
					body: {
						result: {
							desktop_contract: 1,
							desktop_available: true,
							desktop_auth: "bearer",
							features: { mcp_auth: 1 },
						},
					},
				};
			if (request.op === "mcp.control")
				return {
					status: 200,
					body: {
						result: {
							data: {
								name: "hubspot",
								transport_oauth_supported: true,
								secret_refs: [
									{
										id: "HUBSPOT_TOKEN",
										bindings: [{ field: "headers", key: "Authorization" }],
									},
								],
								key_submission_supported: true,
							},
						},
					},
				};
			if (request.op === "mcp.list")
				return {
					status: 200,
					body: {
						result: {
							data: {
								servers: [ROW],
								operations: [
									{
										id: `op-${CASE}`,
										name: "hubspot",
										action: "login",
										status: CASE,
										created_at: 1_760_000_000,
										credential_removed: false,
									},
								],
							},
						},
					},
				};
			throw new Error(`this harness answers no \`${request.op}\` op`);
		},
	},
};

/*
 * React Query pauses refetching in a background tab, which would leave this page
 * on the poll's first answer in some capture conditions. Reporting the document
 * visible keeps the frame the one a focused reader gets.
 */
Object.defineProperty(document, "visibilityState", {
	configurable: true,
	get: () => "visible",
});
Object.defineProperty(document, "hidden", {
	configurable: true,
	get: () => false,
});

const client = new QueryClient({
	defaultOptions: {
		queries: { retry: false, refetchOnWindowFocus: false },
	},
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const buttons = (label: string) =>
	[...document.querySelectorAll("button")].filter(
		(button) => button.textContent?.trim() === label,
	);
const dialog = () => document.querySelector('[role="dialog"]');

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<QueryClientProvider client={client}>
			<MemoryRouter>
				<McpAuthDialog
					row={ROW}
					onClose={() => {}}
					/*
					 * The transition owner the dialog shares with the run panel,
					 * stubbed at its own interface. Nothing here is about what a press
					 * does — only about the state its result is rendered in.
					 */
					remedy={{
						sessionId: SESSION,
						press: () => {},
						pressKey: async () => false,
						cancel: () => {},
						reload: async () => false,
						pendingName: null,
						failureFor: () => null,
						clearFailure: () => {},
					}}
				/>
			</MemoryRouter>
		</QueryClientProvider>
	</StrictMode>,
);

/** What the page is showing, read from the DOM rather than assumed. */
const readState = () => {
	const pane = dialog();
	const close = buttons("Close")[0] ?? null;
	const footer = close?.parentElement ?? null;
	const box = pane?.getBoundingClientRect() ?? null;
	const text = pane?.textContent ?? "";
	return {
		case: CASE,
		theme: THEME,
		// The sentence under test, read whole so a frame cannot be labelled with a
		// state its own body does not state.
		sentence: /Sign-in [a-z-]+\./.exec(text)?.[0] ?? null,
		footer: footer
			? [...footer.querySelectorAll("button")].map((button) =>
					(button.textContent ?? "").trim(),
				)
			: null,
		tryAgain: buttons("Try again").length,
		body: pane?.textContent ?? null,
		rect: box
			? [
					Math.round(box.x),
					Math.round(box.y),
					Math.round(box.width),
					Math.round(box.height),
				]
			: null,
		size: [window.innerWidth, window.innerHeight],
		requests: [...requests],
	};
};

const main = async () => {
	// The dialog's own primary: the press that starts the grant, clicked rather
	// than simulated, and only once the probe has put it on screen.
	for (let attempt = 0; attempt < 200 && buttons("Continue in browser").length === 0; attempt++)
		await sleep(25);
	const grant = buttons("Continue in browser")[0];
	if (!grant) throw new Error("the probe never offered the grant control");
	grant.click();

	// The poll's own answer, and the render it causes.
	for (let attempt = 0; attempt < 200; attempt++) {
		if (dialog()?.textContent?.includes(`Sign-in ${CASE}.`)) break;
		await sleep(25);
	}
	if (!dialog()?.textContent?.includes(`Sign-in ${CASE}.`))
		throw new Error(`the dialog never settled on \`Sign-in ${CASE}.\``);
	// Two frames past the settle, so the captured frame is the painted one.
	await new Promise((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(resolve)),
	);
	await sleep(250);

	(window as unknown as { __mcpAuthEvidence: unknown }).__mcpAuthEvidence =
		readState();
};

void main();
