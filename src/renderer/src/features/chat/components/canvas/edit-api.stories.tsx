import { Button } from "@shared/components/ui";
import { apiConfig } from "@shared/config";
import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useRef, useState } from "react";
import type { CanvasDocument } from "../../types/canvas";
import { CodeEditor } from "./code-editor";
import { WysiwygMarkdownEditor } from "./wysiwyg-markdown-editor";

/**
 * Opt-in renderer + real API verification, not a mock of the edit contract.
 * Run a disposable backend on 127.0.0.1:18762 (see docs/edit-api-validation.md).
 * Only Electron's native save/platform bridge is replaced. Saves are visible
 * in memory and never touch a developer's files. The fixture shortcut button
 * dispatches the production handler; it is not evidence of a physical keypress.
 */
const EditApiFixture = () => {
	const [agentId, setAgentId] = useState<string>();
	const [error, setError] = useState("");
	const [kind, setKind] = useState<"code" | "markdown">("code");
	const [seed, setSeed] = useState("Unsaved editor buffer");
	const [revision, setRevision] = useState(0);
	const [compact, setCompact] = useState(false);
	const [request, setRequest] = useState("");
	const [response, setResponse] = useState("");
	const [saved, setSaved] = useState("No native save requested");
	const editor = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const originalBase = apiConfig.baseUrl;
		const originalFetch = window.fetch;
		const originalSave = window.api.saveFile;
		const originalElectron = window.electron;
		apiConfig.baseUrl = "http://127.0.0.1:18762";
		window.api.saveFile = async (path, content) => {
			setSaved(JSON.stringify({ path, content }));
		};
		window.electron = {
			...originalElectron,
			ipcRenderer: {
				...originalElectron?.ipcRenderer,
				// No native speech events exist in this browser-only fixture, but
				// the real popover still owns subscription/cleanup lifecycles.
				on: () => () => {},
				removeListener: () => window.electron.ipcRenderer,
				send: () => {},
				invoke: async (channel: string) =>
					channel === "get-platform-info" ? { platform: "darwin" } : null,
			},
		};
		window.fetch = async (input, init) => {
			const url = typeof input === "string" ? input : input.toString();
			const isEdit = url.includes("/edit") && init?.method === "POST";
			if (isEdit) setRequest(String(init.body));
			const result = await originalFetch(input, init);
			if (isEdit)
				setResponse(`${result.status} ${await result.clone().text()}`);
			return result;
		};
		// Use the actual create route, so unknown-agent and response-envelope
		// drift cannot be hidden by a hard-coded story identity.
		originalFetch(`${apiConfig.baseUrl}/v1/agents`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: `Disposable editor ${crypto.randomUUID()}`,
			}),
		})
			.then(async (result) => {
				if (!result.ok) throw new Error(await result.text());
				setAgentId((await result.json()).result.id);
			})
			.catch((reason) => setError(String(reason)));
		return () => {
			apiConfig.baseUrl = originalBase;
			window.fetch = originalFetch;
			window.api.saveFile = originalSave;
			window.electron = originalElectron;
		};
	}, []);

	const openEdit = () => {
		const surface = editor.current?.querySelector<HTMLElement>(
			'[contenteditable="true"]',
		);
		if (!surface) return;
		surface.focus();
		const range = document.createRange();
		range.selectNodeContents(surface);
		range.collapse(true);
		window.getSelection()?.removeAllRanges();
		window.getSelection()?.addRange(range);
		surface.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "k",
				// The fixture reports darwin. Ctrl+K is CodeMirror's macOS
				// kill-line binding; Cmd+K exercises the intended AI shortcut.
				metaKey: true,
				bubbles: true,
				cancelable: true,
			}),
		);
	};

	const load = (nextKind: "code" | "markdown", empty = false) => {
		setKind(nextKind);
		setSeed(empty ? "" : "Unsaved editor buffer");
		setRevision((value) => value + 1);
		setRequest("");
		setResponse("");
		setSaved("No native save requested");
	};
	const doc: CanvasDocument = {
		id: `disposable-${kind}-${revision}`,
		title: kind === "code" ? "unsaved.txt" : "unsaved.md",
		path: `/disposable-client-only/unsaved.${kind === "code" ? "txt" : "md"}`,
		content: seed,
		type: kind,
	};
	return (
		<div className="flex h-screen flex-col gap-3 bg-surface p-4 text-body text-ink">
			<p>
				Renderer + real API fixture. Native saves are recorded in memory only.
			</p>
			<p>
				Use [delay] or [error] in the prompt with the deterministic provider
				fixture.
			</p>
			<div className="flex flex-wrap gap-2">
				<Button onClick={() => load("code")}>Code buffer</Button>
				<Button onClick={() => load("markdown")}>Markdown buffer</Button>
				<Button onClick={() => load(kind, true)}>Empty buffer</Button>
				<Button onClick={() => setCompact((value) => !value)}>
					{compact ? "Full-width canvas" : "360px canvas"}
				</Button>
				<Button disabled={!agentId} onClick={openEdit}>
					Open AI edit (fixture)
				</Button>
			</div>
			{error && <p role="alert">{error}</p>}
			<div
				ref={editor}
				className={cn(
					"relative min-h-80 flex-1 border border-control",
					compact && "w-90",
				)}
			>
				{agentId &&
					(kind === "code" ? (
						<CodeEditor
							key={doc.id}
							document={doc}
							editable
							agentId={agentId}
						/>
					) : (
						<WysiwygMarkdownEditor
							key={doc.id}
							document={doc}
							agentId={agentId}
						/>
					))}
			</div>
			<details open className="max-h-48 overflow-auto text-meta">
				<summary>Actual request, API response and native save receipt</summary>
				<pre data-testid="edit-request">{request}</pre>
				<pre data-testid="edit-response">{response}</pre>
				<pre data-testid="native-save">{saved}</pre>
			</details>
		</div>
	);
};

const meta = {
	title: "Canvas/Edit API integration",
	component: EditApiFixture,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof EditApiFixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LiveBuffer: Story = {};
