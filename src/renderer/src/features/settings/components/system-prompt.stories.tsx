/** Isolated renderer fixtures: every bridge op fails closed except the synthetic
 * instruction/config operations below. Never opens the operator's prompt. */
import { Button, Textarea } from "@shared/components/ui";
import { t } from "@shared/i18n";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLayoutEffect, useState } from "react";
import { SettingsSection } from "./settings-section";
import { SystemPrompt } from "./system-prompt";

const fictionalPrompt =
	'# Working together\n\nUse **clear explanations**, preserve `literal` values, and read [the guide](https://example.invalid/guide).\n\n## Before acting\n\n- Inspect the relevant file.\n  - Keep nested instructions intact.\n- Explain the result.\n\n```python\nprint("fictional fixture")\n```\n';
const taggedPrompt = `${fictionalPrompt}\n<policy priority="high">\nPreserve this unknown instruction block verbatim.\n</policy>\n`;
type Props = {
	before?: boolean;
	kind?:
		| "normal"
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
		kind === "empty"
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
				...desktopDescriptor,
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
			className="min-h-screen bg-surface p-4 text-ink"
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
		await waitFor(() =>
			expect(canvasElement.querySelector("textarea")).not.toBeNull(),
		);
		const editor = canvas.getByRole("textbox") as HTMLTextAreaElement;
		await expect(editor.value).toBe(taggedPrompt);
		await userEvent.click(canvas.getByRole("button", { name: "Rich text" }));
		await expect(
			(canvas.getByRole("textbox") as HTMLTextAreaElement).value,
		).toBe(taggedPrompt);
		await userEvent.type(editor, "\nAdditional fictional rule.");
		await userEvent.click(canvas.getByRole("button", { name: "Save changes" }));
		await waitFor(() =>
			expect(
				canvas.getByRole("button", { name: "Save changes" }),
			).toBeDisabled(),
		);
		await expect(
			(canvas.getByRole("textbox") as HTMLTextAreaElement).value,
		).toBe(`${taggedPrompt}\nAdditional fictional rule.`);
	},
};
