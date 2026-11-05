/** Isolated renderer fixtures: every bridge op fails closed except the synthetic
 * instruction/config operations below. Never opens the operator's prompt. */
import { Alert, Button, Textarea } from "@shared/components/ui";
import { t } from "@shared/i18n";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLayoutEffect, useState } from "react";
import { SettingsSection } from "./settings-section";
import { SystemPrompt } from "./system-prompt";
import {
	extendedInstructionShape,
	fictionalInstructionShape,
} from "./system-prompt-fidelity.fixtures";

const fictionalPrompt =
	'# Working together\n\nUse **clear explanations**, preserve `literal` values, and read [the guide](https://example.invalid/guide).\n\n## Before acting\n\n- Inspect the relevant file.\n  - Keep nested instructions intact.\n- Explain the result.\n\n```python\nprint("fictional fixture")\n```\n';
const taggedPrompt = `${fictionalPrompt}\n<policy priority="high">\nPreserve this unknown instruction block verbatim.\n</policy>\n`;
type Props = {
	before?: boolean;
	kind?:
		| "normal"
		| "fidelity"
		| "extended"
		| "dangerous"
		| "empty"
		| "tags"
		| "long"
		| "loading"
		| "error"
		| "save-error"
		| "saving";
	narrow?: boolean;
};

function Fixture({ before = false, kind = "normal", narrow = false }: Props) {
	const [client] = useState(
		() =>
			new QueryClient({
				defaultOptions: {
					queries: { retry: false },
					mutations: { retry: false },
				},
			}),
	);
	const [ready, setReady] = useState(false);
	const initial =
		kind === "fidelity"
			? fictionalInstructionShape
			: kind === "extended"
				? extendedInstructionShape
				: kind === "dangerous"
					? '# Fictional unsafe syntax\n\n<script>window.fictionalExecuted = true</script>\n\n<img src="https://example.invalid/remote" onerror="window.fictionalExecuted=true">\n\n[Unsafe](javascript:alert(1))\n\n![Remote](https://example.invalid/image)\n\nSafe instructions with **emphasis**.\n'
					: kind === "empty"
						? ""
						: kind === "tags"
							? taggedPrompt
							: kind === "long"
								? fictionalPrompt.repeat(100)
								: fictionalPrompt;
	useLayoutEffect(() => {
		let content = initial;
		const previousDesktop = window.api.desktop;
		const desktopDescriptor = Object.getOwnPropertyDescriptor(
			window.api,
			"desktop",
		);
		let nextDesktop = previousDesktop;
		const previousBackend = window.api.backend;
		const requests: string[] = [];
		// A visible test port owns only this fixture's query/cache and recorded ops.
		// QA can induce a remote refetch without any live transport or preferences.
		const fixture = {
			requests,
			externalRefetch: () => {
				content = `${initial}\nExternal fictional change.\n`;
				return client.refetchQueries({ queryKey: ["system-prompt"] });
			},
			content: () => content,
		};
		Object.assign(window, { systemPromptFixture: fixture });
		const syntheticDesktop: typeof window.api.desktop = {
			...previousDesktop,
			request: async (request) => {
				requests.push(request.op);
				const ok = (result: unknown) => ({
					status: 200,
					body: { status: 200, message: "ok", result },
				});
				switch (request.op) {
					case "instructions.get":
						if (kind === "loading") return new Promise(() => {});
						if (kind === "error")
							return {
								status: 503,
								body: { detail: "Synthetic fixture read failure" },
							};
						return ok({ content, last_modified: "2026-11-04T12:00:00Z" });
					case "instructions.update":
						if (kind === "saving") return new Promise(() => {});
						if (kind === "save-error")
							return {
								status: 409,
								body: { detail: "Synthetic fixture write conflict" },
							};
						content = request.content;
						return ok({ content, last_modified: "2026-11-04T12:01:00Z" });
					case "config.get":
						return ok({
							version: "fixture",
							metadata: {},
							values: { hosting: "ollama" },
						});
					default:
						throw new Error(`Unconfigured fixture operation: ${request.op}`);
				}
			},
		};
		// Storybook lazy/HMR imports run other stories' module-level bridge
		// setters after mount. The mounted fixture owns its transport until
		// cleanup; retain a deferred setter for the next story rather than
		// letting an unrelated facade route an explicit Save elsewhere.
		Object.defineProperty(window.api, "desktop", {
			configurable: true,
			get: () => syntheticDesktop,
			set: (value) => {
				nextDesktop = value;
			},
		});

		client.setQueryData(["server-health"], { online: true, snapshot: null });
		// Health never probes a real server after the seeded cache expires.
		window.api.backend = {
			...previousBackend,
			getStatus: async () => ({
				state: "attached",
				reconnecting: false,
				owned: false,
				instanceId: "synthetic-prompt-fixture",
				version: null,
				prefix: null,
				installKind: null,
				desktopAvailable: true,
				pairing: { available: true, cause: null },
				failures: 0,
				capabilityStatus: null,
				unanswered: 0,
				lastTransportAt: null,
				detail: "Synthetic fixture",
				addressSubstitution: null,
				updatedAt: 0,
				url: "http://127.0.0.1:1",
				pid: null,
			}),
		};
		setReady(true);
		return () => {
			Object.defineProperty(window.api, "desktop", {
				enumerable: desktopDescriptor?.enumerable ?? true,
				configurable: true,
				writable: true,
				value: nextDesktop,
			});
			window.api.backend = previousBackend;
			client.clear();
			Reflect.deleteProperty(window, "systemPromptFixture");
		};
	}, [client, initial, kind]);
	return (
		<div
			className="h-screen overflow-y-auto bg-surface p-4 text-ink"
			style={{ maxWidth: narrow ? 390 : 920 }}
		>
			{before ? (
				<SettingsSection
					title={t("ui.settings.model.system_prompt.system_prompt")}
					description={t(
						"ui.settings.model.system_prompt.every_local_operator_agent_receives_this_prompt_in_addition_to_it",
					)}
				>
					<div className="flex flex-col gap-4">
						{(kind === "fidelity" || kind === "extended") && (
							<Alert>
								{t("ui.settings.model.system_prompt.source_required")}
							</Alert>
						)}
						<label htmlFor="before-prompt">
							{t("ui.settings.model.system_prompt.instructions")}
						</label>
						<Textarea
							id="before-prompt"
							defaultValue={initial}
							className="min-h-50"
						/>
						<div className="flex gap-3">
							<Button disabled>
								{t("ui.settings.model.system_prompt.save_changes")}
							</Button>
							<Button disabled>
								{t("ui.settings.model.system_prompt.cancel")}
							</Button>
						</div>
					</div>
				</SettingsSection>
			) : (
				ready && (
					<QueryClientProvider client={client}>
						<SystemPrompt />
					</QueryClientProvider>
				)
			)}
		</div>
	);
}
const meta = {
	title: "Settings/System prompt",
	component: Fixture,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Fixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const RichText: Story = {};
export const Before: Story = { args: { before: true } };
export const Narrow: Story = { args: { narrow: true } };
export const UnsupportedTags: Story = { args: { kind: "tags" } };
export const LongDocument: Story = { args: { kind: "long" } };
export const Empty: Story = { args: { kind: "empty" } };
export const Loading: Story = { args: { kind: "loading" } };
export const LoadError: Story = { args: { kind: "error" } };
export const SaveError: Story = { args: { kind: "save-error" } };
export const Saving: Story = { args: { kind: "saving" } };

/** Runs in the real browser against production components and the fail-closed
 * bridge above; these assertions are not a replacement editor or a live file. */
export const EditedRoundTrip: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByRole("heading", { name: "Working together" });
		await userEvent.click(
			canvas.getByRole("button", { name: "Markdown source" }),
		);
		await waitFor(() =>
			expect(canvasElement.querySelector("textarea")).not.toBeNull(),
		);
		const original = canvas.getByRole("textbox") as HTMLTextAreaElement;
		await expect(original.value).toBe(fictionalPrompt);
		await userEvent.click(canvas.getByRole("button", { name: "Rich text" }));
		await waitFor(() =>
			expect(
				canvasElement.querySelector("[contenteditable=true]"),
			).not.toBeNull(),
		);
		const editor = canvas.getByRole("textbox");
		editor.innerHTML = editor.innerHTML.replace(
			"clear explanations",
			"precise explanations",
		);
		editor.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "insertText",
				data: "precise",
			}),
		);
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "Save changes" }),
			).toBeEnabled(),
		);
		const fixture = (
			window as unknown as {
				systemPromptFixture: {
					requests: string[];
					externalRefetch: () => Promise<void>;
					content: () => string;
				};
			}
		).systemPromptFixture;
		await fixture.externalRefetch();
		await userEvent.click(
			canvas.getByRole("button", { name: "Markdown source" }),
		);
		await waitFor(() =>
			expect(canvasElement.querySelector("textarea")).not.toBeNull(),
		);
		const source = (canvas.getByRole("textbox") as HTMLTextAreaElement).value;
		await expect(source).toContain("**precise explanations**");
		await expect(source).toContain("`literal`");
		await expect(source).toContain("https://example.invalid/guide");
		await expect(source).toContain(
			'```python\nprint("fictional fixture")\n```',
		);
		await expect(source).not.toContain("External fictional change");
		await expect(
			fixture.requests.filter((op) => op === "instructions.update"),
		).toHaveLength(0);
		await userEvent.click(canvas.getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "Save changes" }),
			).toBeDisabled(),
		);
		await expect(fixture.content()).toBe(source);
		await expect(
			fixture.requests.filter((op) => op === "instructions.update"),
		).toHaveLength(1);
	},
};
export const EditedUnsupportedTags: Story = {
	args: { kind: "tags" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByRole("heading", { name: "Working together" });
		await expect(
			canvasElement.querySelectorAll("[data-prompt-opaque]").length,
		).toBeGreaterThan(0);
		await userEvent.click(
			canvas.getByRole("button", { name: "Markdown source" }),
		);
		await waitFor(() =>
			expect(canvasElement.querySelector("textarea")).not.toBeNull(),
		);
		const editor = canvas.getByRole("textbox") as HTMLTextAreaElement;
		await expect(editor.value).toBe(taggedPrompt);
		await userEvent.type(editor, "\nAdditional fictional rule.");
		await userEvent.click(canvas.getByRole("button", { name: "Rich text" }));
		await canvas.findByRole("heading", { name: "Working together" });
		await userEvent.click(canvas.getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "Save changes" }),
			).toBeDisabled(),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "Markdown source" }),
		);
		await waitFor(() =>
			expect(canvasElement.querySelector("textarea")).not.toBeNull(),
		);
		await expect(
			(canvas.getByRole("textbox") as HTMLTextAreaElement).value,
		).toBe(`${taggedPrompt}\nAdditional fictional rule.`);
	},
};
export const Fidelity: Story = { args: { kind: "fidelity" } };
export const ExtendedFormatting: Story = { args: { kind: "extended" } };
export const BeforeFidelity: Story = {
	args: { kind: "fidelity", before: true },
};
export const DangerousSyntax: Story = { args: { kind: "dangerous" } };
export const NodeSourceEdit: Story = {
	args: { kind: "fidelity" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		await canvas.findByRole("heading", { name: "Working agreements" });
		await expect(
			canvas.getByRole("button", { name: "Save changes" }),
		).toBeDisabled();
		await userEvent.click(
			canvas.getAllByRole("button", { name: "Edit source" })[0],
		);
		const dialog = within(
			await page.findByRole("dialog", { name: "Edit source" }),
		);
		const source = dialog.getByRole("textbox") as HTMLTextAreaElement;
		await expect(source.value).toBe("<policy>");
		await userEvent.clear(source);
		await userEvent.type(source, '<policy data-fictional="updated">');
		await userEvent.click(dialog.getByRole("button", { name: "Apply" }));
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "Save changes" }),
			).toBeEnabled(),
		);
		await userEvent.click(canvas.getByRole("button", { name: "Undo" }));
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "Save changes" }),
			).toBeDisabled(),
		);
		await userEvent.click(canvas.getByRole("button", { name: "Redo" }));
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "Save changes" }),
			).toBeEnabled(),
		);
		const editor = canvas.getByRole("textbox");
		editor.focus();
		await userEvent.keyboard("{Control>}z{/Control}");
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "Save changes" }),
			).toBeDisabled(),
		);
		await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "Save changes" }),
			).toBeEnabled(),
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "Markdown source" }),
		);
		await waitFor(() =>
			expect(canvasElement.querySelector("textarea")).not.toBeNull(),
		);
		await expect(
			(canvas.getByRole("textbox") as HTMLTextAreaElement).value,
		).toBe(
			fictionalInstructionShape.replace(
				"<policy>",
				'<policy data-fictional="updated">',
			),
		);
		await userEvent.click(canvas.getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "Save changes" }),
			).toBeDisabled(),
		);
	},
};
export const StaleNodeSource: Story = {
	args: { kind: "fidelity" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const page = within(canvasElement.ownerDocument.body);
		await canvas.findByRole("heading", { name: "Working agreements" });
		const root = canvas.getByRole("textbox");
		await userEvent.click(
			canvas.getAllByRole("button", { name: "Edit source" })[0],
		);
		const dialog = within(
			await page.findByRole("dialog", { name: "Edit source" }),
		);
		const text = root.querySelector("h1 span");
		if (!text) throw new Error("Missing fictional heading");
		text.textContent = "A newer fictional heading";
		root.dispatchEvent(
			new InputEvent("input", {
				bubbles: true,
				inputType: "insertText",
				data: "newer",
			}),
		);
		await userEvent.click(dialog.getByRole("button", { name: "Apply" }));
		await dialog.findByText(
			"This part changed while you were editing it. Cancel and open it again to keep the latest instructions.",
		);
		await expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();
		await userEvent.click(dialog.getByRole("button", { name: "Cancel" }));
		await expect(root.textContent).toContain("A newer fictional heading");
	},
};
export const InertMarkupAndPaste: Story = {
	args: { kind: "dangerous" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByRole("heading", { name: "Fictional unsafe syntax" });
		const root = canvas.getByRole("textbox");
		await expect(
			root.querySelector("script,img,iframe,svg,math,[src],[onerror]"),
		).toBeNull();
		root.focus();
		const selection = window.getSelection();
		const range = document.createRange();
		range.selectNodeContents(root);
		range.collapse(false);
		selection?.removeAllRanges();
		selection?.addRange(range);
		const data = new DataTransfer();
		data.setData(
			"text/html",
			'<img src="https://example.invalid/pasted" onerror="window.fictionalExecuted=true"><span data-prompt-node="forged">Forged</span>',
		);
		data.setData("text/plain", " Fictional pasted text <literal>");
		root.dispatchEvent(
			new ClipboardEvent("paste", {
				bubbles: true,
				cancelable: true,
				clipboardData: data,
			}),
		);
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "Save changes" }),
			).toBeEnabled(),
		);
		await expect(
			root.querySelector(
				"script,img,iframe,svg,math,[src],[onerror],[data-prompt-node=forged]",
			),
		).toBeNull();
		await expect(
			(window as unknown as { fictionalExecuted?: boolean }).fictionalExecuted,
		).toBeUndefined();
		await expect(
			performance
				.getEntriesByType("resource")
				.filter((entry) => entry.name.includes("example.invalid")),
		).toHaveLength(0);
	},
};

export const ImmediateFlush: Story = {
	args: { kind: "fidelity" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await canvas.findByRole("heading", { name: "Working agreements" });
		for (let round = 0; round < 3; round++) {
			await userEvent.click(
				canvas.getByRole("button", { name: "Markdown source" }),
			);
			await waitFor(() =>
				expect(canvasElement.querySelector("textarea")).not.toBeNull(),
			);
			await expect(
				(canvas.getByRole("textbox") as HTMLTextAreaElement).value,
			).toBe(fictionalInstructionShape);
			await userEvent.click(canvas.getByRole("button", { name: "Rich text" }));
			await canvas.findByRole("heading", { name: "Working agreements" });
			await expect(
				canvas.getByRole("button", { name: "Save changes" }),
			).toBeDisabled();
		}
		const edit = (value: string) => {
			const root = canvas.getByRole("textbox");
			const text = root.querySelector("h1 span");
			if (!text) throw new Error("Missing fictional heading");
			text.textContent = value;
			root.dispatchEvent(
				new InputEvent("input", {
					bubbles: true,
					inputType: "insertText",
					data: value,
				}),
			);
		};
		edit("Fictional immediate source");
		// No dirty-state/effect wait before the mode boundary.
		await userEvent.click(
			canvas.getByRole("button", { name: "Markdown source" }),
		);
		await waitFor(() =>
			expect(canvasElement.querySelector("textarea")).not.toBeNull(),
		);
		await expect(
			(canvas.getByRole("textbox") as HTMLTextAreaElement).value,
		).toBe(
			fictionalInstructionShape.replace(
				"Working agreements",
				"Fictional immediate source",
			),
		);
		await userEvent.click(canvas.getByRole("button", { name: "Rich text" }));
		await canvas.findByRole("heading", { name: "Fictional immediate source" });
		edit("Fictional immediate save");
		// Likewise Save is the next user action, without waiting for an effect.
		await userEvent.click(canvas.getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "Save changes" }),
			).toBeDisabled(),
		);
		const fixture = (
			window as unknown as {
				systemPromptFixture: { content: () => string; requests: string[] };
			}
		).systemPromptFixture;
		await expect(fixture.content()).toBe(
			fictionalInstructionShape.replace(
				"Working agreements",
				"Fictional immediate save",
			),
		);
		await expect(
			fixture.requests.filter((op) => op === "instructions.update"),
		).toHaveLength(1);
	},
};
