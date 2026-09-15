/*
 * EV209 — the composer's goal-arming surfaces, driven through the REAL component.
 *
 * WHAT THIS IS: the repository's own `MessageInput` (the shipped composer), its
 * shipped slash popup, the shipped planner (`planSlashSubmission` /
 * `planSlashArming`), the shipped keyboard contract (`slashKeyIntent`) and the
 * shipped dispatch contract, rendered in the repository's own Storybook preview
 * (themes, query client, `window.api` mock) with ONE stand-in: `window.api.desktop`,
 * the transport the renderer uses to reach a backend. It is mocked with the REAL
 * command catalogue dumped from the core runtime's `command_catalogue()` — the
 * same rows the desktop app receives — because a Storybook page has no backend.
 *
 * WHAT IT IS NOT: a live app run. `onSendMessage` and `onSlashCommand` are stubs
 * that record what the composer handed them, so nothing here proves the backend
 * half of `/goal` (setting the goal, starting the turn).
 *
 * WHY THE BUTTONS: the `browser` tool dispatches clicks and text but no key
 * events, so the panel dispatches real `KeyboardEvent`s into the real textarea —
 * untrusted events, shipped handlers, exactly as QA round 1 did for PR #209.
 * Drafts are written through the native value setter so React's controlled input
 * sees a real `input` event.
 *
 * The boxes are read out of the live DOM (the `box`/`note`/`sent`/`rect` rows) so
 * a frame's claim can be checked against the state that produced it rather than
 * off the still.
 */
import type { Meta, StoryObj } from "@storybook/react";
import { useCallback, useRef, useState } from "react";
import { MessageInput } from "@features/chat/components/message-input";

/* The catalogue the composer's `commands.list` op answers with (real rows). */
const COMMANDS = __EV209_CATALOGUE__;

(function installDesktopFixture() {
	const api = (window as unknown as { api?: Record<string, unknown> }).api ?? {};
	(window as unknown as { api: Record<string, unknown> }).api = api;
	/*
	 * The daemon bridge, so the health probe is a function of THIS tree rather
	 * than of whichever backend happens to be listening on the developer's
	 * machine: with no bridge the hook falls through to a real HTTP health check
	 * against `apiConfig.baseUrl`, which would make the frame depend on another
	 * process. `attached` is a connection.
	 */
	api.backend = {
		getStatus: async () => ({ state: "attached", url: "http://127.0.0.1:9/" }),
	};
	api.desktop = {
		request: async (request: { op: string }) => {
			if (request.op === "capabilities") {
				return {
					status: 200,
					body: {
						result: {
							desktop_contract: 1,
							desktop_available: true,
							desktop_auth: "bearer",
							features: {
								commands: 1,
								catalogues: 1,
								draft_selection: 1,
								sessions: 1,
							},
						},
					},
				};
			}
			if (request.op === "commands.list") {
				return { status: 200, body: { result: { commands: COMMANDS } } };
			}
			/*
			 * The two ops the composer's NEIGHBOURS read the shape of: the
			 * connectivity gate asks for the config on mount and the credential
			 * probe beside it lists keys, so a bare `{}` throws in
			 * `use-connectivity-status` (`config?.values.hosting`) before the
			 * composer ever paints.
			 */
			if (request.op === "config.get") {
				return {
					status: 200,
					body: {
						result: { version: "1", metadata: {}, values: { hosting: "" } },
					},
				};
			}
			if (request.op === "credentials.list") {
				return { status: 200, body: { result: { keys: [] } } };
			}
			return { status: 200, body: { result: {} } };
		},
	};
})();

/*
 * The desktop bridge, installed at MODULE SCOPE, exactly as this component's own
 * story installs it (`message-input.stories.tsx`): the composer reaches
 * `window.electron.ipcRenderer` from a passive effect on mount (the platform it
 * renders the send chord for), and Storybook's preview mocks `window.api` rather
 * than `window.electron`. Without it the story throws before it prepares -
 * "Cannot read properties of undefined (reading 'ipcRenderer')" out of
 * `commitHookEffectListMount` - and there is no frame to take. The stand-in
 * answers the two channels the composer reads and nothing else.
 */
window.electron = {
	...(window.electron ?? {}),
	ipcRenderer: {
		...(window.electron?.ipcRenderer ?? {}),
		on: () => () => {},
		removeListener: () => window.electron.ipcRenderer,
		send: () => {},
		invoke: async (channel: string) =>
			channel === "get-platform-info"
				? { platform: "darwin" }
				: { canceled: true, filePaths: [] },
	},
} as typeof window.electron;

const NONEMPTY = [{ id: "canonical", role: "system", timestamp: new Date(0) }];

function typeDraft(el: HTMLTextAreaElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(
		HTMLTextAreaElement.prototype,
		"value",
	)?.set;
	setter?.call(el, value);
	el.selectionStart = el.selectionEnd = value.length;
	el.dispatchEvent(new Event("input", { bubbles: true }));
}

function pressKey(el: HTMLTextAreaElement, key: string) {
	el.dispatchEvent(
		new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
	);
}

const Row = ({ k, v }: { k: string; v: string }) => (
	<div className="font-mono text-mono-sm">
		<span className="text-ink-dim">{k}: </span>
		<span data-ev={k}>{v}</span>
	</div>
);

function Harness() {
	const boxRef = useRef<HTMLDivElement | null>(null);
	const [note, setNote] = useState("");
	const [sent, setSent] = useState("");
	const [dispatched, setDispatched] = useState("");
	const [draft, setDraft] = useState("");
	const [rect, setRect] = useState("");
	/*
	 * WHICH PANE SHAPE the composer is mounted as.
	 *
	 * `session` is a live canonical session: the page supplies `sessionStatus` (its
	 * frontend snapshot and the dispatcher) and `conversationId` is the session's
	 * id, so a command can address a session.
	 *
	 * `!session` is a NEW CHAT pane, and it is NOT "no `sessionStatus`": the page
	 * builds one from `preview.data.snapshot` with `draft: true` (`chat-page.tsx`),
	 * while `conversationId` is the PANE's own identity — a non-empty string — and
	 * nothing can address a session. The earlier version of this harness forced
	 * `sessionStatus={undefined}` for the draft case, which the shipping page does
	 * not produce for a pane whose preview has resolved, and that is exactly why
	 * the honest note could be rendered here and never in the app (UX round 2, U1).
	 * The two shapes below are the page's own props, including the dispatcher's
	 * answer (`paneHasSession`).
	 */
	const [session, setSession] = useState(true);

	const area = () => {
		const el = boxRef.current?.querySelector("textarea");
		if (!el) throw new Error("no composer textarea");
		return el as HTMLTextAreaElement;
	};
	/*
	 * A fresh DRAFT is a fresh state: the witness rows are a running log, so
	 * typing clears them. Without this a frame carries the previous step's note
	 * and send beside a box that no longer matches them.
	 */
	const fresh = () => {
		setNote("");
		setSent("");
		setDispatched("");
	};
	const read = useCallback(() => {
		setDraft(area().value);
		const box = boxRef.current?.getBoundingClientRect();
		setRect(
			box
				? `${Math.round(box.left)},${Math.round(box.top)},${Math.round(box.width)},${Math.round(box.height)}@${window.devicePixelRatio}`
				: "",
		);
	}, []);

	const button = (
		id: string,
		label: string,
		body: () => void,
	): React.ReactElement => (
		<button
			key={id}
			data-ev-action={id}
			type="button"
			className="rounded-control border border-control px-2 py-1"
			onClick={() => {
				body();
				setTimeout(read, 0);
			}}
		>
			{label}
		</button>
	);

	return (
		<div
			className="flex flex-col gap-3 bg-canvas p-6"
			style={{ width: 1024 }}
			data-ev-root=""
		>
			<div className="flex flex-wrap gap-2 font-mono text-mono-sm">
				{button("type-sentence", "1. type sentence + /goal", () => {
					fresh();
					typeDraft(area(), "I approve spend /goal");
				})}
				{button("type-whole", "1b. type whole-draft /goal line", () => {
					fresh();
					typeDraft(area(), "/goal I approve spend");
				})}
				{button("type-loop", "1c. type /loop sentence", () =>
					typeDraft(area(), "please run /loop on 3 tasks"),
				)}
				{button("type-loop-token", "1e. type /loop with the caret on the word", () => {
					fresh();
					typeDraft(area(), "please run /loop");
				})}
				{button("type-multiline", "1d. type multi-line + /goal", () => {
					fresh();
					typeDraft(
						area(),
						"Please fix the flaky test and\nthen run the release.\n/goal",
					);
				})}
				{button("enter", "2. Enter", () => pressKey(area(), "Enter"))}
				{button("tab", "2t. Tab", () => pressKey(area(), "Tab"))}
				{button("arrowdown", "3. ArrowDown (choose the row by hand)", () =>
					pressKey(area(), "ArrowDown"),
				)}
				{button(
					"choose-goal-by-hand",
					"3b. choose /goal by hand from the full list",
					() => {
						/*
						 * THE KEYBOARD PATH TO A HAND-MADE CHOICE, as the app really offers it.
						 * A query of `/goal` matches ONE row in the real catalogue, the marker
						 * clamps on a one-row list, and a clamped arrow is not a move — so the
						 * hand-made state is reached the way a user reaches it: a bare `/`
						 * lists the whole catalogue, and arrowing to `/goal` in it IS a move.
						 *
						 * One press per TICK, not per rAF: this harness runs in a background tab,
						 * where `requestAnimationFrame` is paused outright and timers are merely
						 * throttled - a loop awaiting a frame stalls after its first press. A tick
						 * also lets React flush, so the next read of `aria-selected` sees the
						 * marker the last press moved (reading it inside a synchronous loop reads
						 * the state the loop started in, which is how this stopped on `/help` the
						 * first time it was written).
						 */
						void (async () => {
							fresh();
							typeDraft(area(), "I approve spend /");
							for (let i = 0; i < 40; i++) {
								const goal = document.querySelector('[id$="-cmd-goal"]');
								if (goal?.getAttribute("aria-selected") === "true") break;
								pressKey(area(), "ArrowDown");
								await new Promise((resolve) => setTimeout(resolve, 0));
							}
						})();
					},
				)}
				{button("click-goal", "4. click the goal row", () => {
					area()?.focus();
					/*
					 * The row's DOM id is `${listId}-${rowId(row)}`, so the list id is
					 * not known here: match the row's own suffix, the way a reader finds
					 * it, and click the element the pointer would hit.
					 */
					const row =
						document.querySelector('[id$="-cmd-goal"]') ??
						document.querySelector('[role="option"]');
					(row as HTMLElement | null)?.click();
				})}
				{button("click-loop", "4b. click the /loop row", () => {
					area()?.focus();
					/*
					 * The control row of the whole change: a POINTER pick of a free-text
					 * command, whose own line and whose `Click …` line are the pair UX U2
					 * measured. Driven here so the frame and the witness rows come from
					 * the same gesture a reader can repeat.
					 */
					const row =
						document.querySelector('[id$="-cmd-loop"]') ??
						document.querySelector('[role="option"]');
					(row as HTMLElement | null)?.click();
				})}
				{button("escape", "5. Escape", () => pressKey(area(), "Escape"))}
				{button("toggle-session", "toggle live session", () =>
					setSession((on) => !on),
				)}
				{button("read", "read", () => {})}
			</div>
			<Row k="box" v={JSON.stringify(draft)} />
			<Row
				k="pane"
				v={
					session
						? "session: sessionStatus(snapshot) + claimable, conversationId=ev209, paneHasSession=true"
						: "new chat: sessionStatus(preview, draft) + conversationId=draft:ev209, paneHasSession=false"
				}
			/>
			<Row k="note (onSlashNote)" v={JSON.stringify(note)} />
			<Row k="sent (onSendMessage)" v={JSON.stringify(sent)} />
			<Row k="dispatched (onSlashCommand)" v={JSON.stringify(dispatched)} />
			<Row k="rect" v={rect} />
			<div ref={boxRef} data-ev="composer-frame">
				<MessageInput
					/*
					 * The page's props for each pane, not a shape chosen for the frame: a
					 * draft pane KEEPS a `sessionStatus` (from the preview, `draft: true`),
					 * keeps a non-empty `conversationId` (the pane's identity), passes the
					 * same dispatcher, and answers the arming copy's question with
					 * `paneHasSession={false}`. The snapshot's own fields are not what these
					 * frames are about, so it is the same minimal object in both shapes.
					 */
					sessionStatus={{
						frontend: {} as never,
						onCommand: session
							? async () => "consumed" as const
							: undefined,
						draft: !session,
					}}
					paneHasSession={session}
					isLoading={false}
					messages={NONEMPTY}
					conversationId={session ? "ev209" : "draft:ev209"}
					onSendMessage={async (text?: string) => {
						setSent(String(text ?? ""));
						return true;
					}}
					onSlashNote={(text: string) => setNote(text)}
					onSlashCommand={async (invocation: {
						name: string;
						args: string;
					}) => {
						setDispatched(`${invocation.name}(${invocation.args})`);
						return "consumed" as const;
					}}
				/>
			</div>
		</div>
	);
}

const meta: Meta = {
	title: "EV209/Goal arming",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

export const Composer: Story = { render: () => <Harness /> };
