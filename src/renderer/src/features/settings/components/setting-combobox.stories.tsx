/**
 * `Settings/Model combobox` — the searchable single-select the settings
 * provider and model rows are built on, in the variants those rows use.
 *
 * WHY THIS FILE EXISTS. The control this component was promoted from has been
 * in the app since the hosting pickers shipped and had never been photographed
 * in any theme, in any state (its own story, `Hosting/SearchableSelect`, is in
 * no `STORIES` row of `scripts/capture-evidence.mjs`). The settings rows made it
 * the app's one searchable single-select, so the frames it never had are the
 * first thing this change owes: the list OPEN — which is the whole feature and
 * which no committed frame has ever shown — plus the chrome-less variant the
 * registry rows render and the two degenerate states (nothing matches, a stored
 * value no listing contains).
 *
 * The option lists here are hand-built, because a frame of a component is about
 * the component: the payload-shaped ones, and what they mean, live in
 * `backend-settings.stories.tsx` and in the driver's own `settings-model` scene.
 *
 * HOW THE OPEN FRAMES ARE TAKEN. Storybook's `play` cannot hold a capture — the
 * harness photographs as soon as the story has elements and the webfonts have
 * loaded, usually before a play has finished driving anything. So the driven
 * states use this repo's own shutter contract
 * (`backend-settings.stories.tsx`, `app-updates-section.stories.tsx`): the
 * component sets `documentElement.dataset.capturePending` in a LAYOUT effect,
 * runs the script, waits for the state it claims to show to be on screen, and
 * only then clears it. A script whose state never arrives leaves the shutter
 * closed and fails the sweep rather than committing a picture of an untouched
 * field.
 */

import {
	type SearchableOption,
	SearchableSelect,
} from "@shared/components/ui/searchable-select";
import type { Meta, StoryObj } from "@storybook/react";
import { Bot } from "lucide-react";
import type { FC, ReactNode } from "react";
import { useLayoutEffect, useState } from "react";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () =>
	new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

const waitFor = async (done: () => boolean, attempts = 300) => {
	for (let i = 0; i < attempts; i++) {
		if (done()) return true;
		await sleep(20);
	}
	return false;
};

/**
 * Type into a field the way a person does.
 *
 * React reads a controlled input's value from its own tracker, so assigning
 * `input.value` alone leaves the product's `onChange` looking at the old value.
 * Going through the prototype's setter and then dispatching `input` is the same
 * library-free approach the other rigs here use.
 */
const setFieldValue = (input: HTMLInputElement, value: string) => {
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	)?.set;
	setter?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
};

const combobox = () =>
	document.querySelector<HTMLInputElement>('input[role="combobox"]');

const listbox = () => document.querySelector<HTMLElement>('ul[role="listbox"]');

/* --------------------------------------------------------------- fixtures */

const OPTIONS: SearchableOption[] = [
	{
		id: "anthropic",
		name: "Anthropic (Claude Pro/Max)",
		description: "Needs sign-in",
		group: "Needs sign-in",
	},
	{
		id: "openai",
		name: "OpenAI (ChatGPT Plus/Pro)",
		description: "Needs sign-in",
		group: "Needs sign-in",
	},
	{
		id: "ollama",
		name: "Ollama",
		description: "No key needed",
		group: "Needs a running server",
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		description: "Signed in",
		group: "Ready to use",
	},
];

const MODELS: SearchableOption[] = [
	{
		id: "claude-opus-5",
		name: "anthropic/claude-opus-5",
		description: "anthropic",
		group: "Signed in",
	},
	{
		id: "gpt-5.6-sol",
		name: "openai/gpt-5.6-sol",
		description: "openai",
		group: "Signed in",
	},
	{
		id: "anthropic/claude-haiku-4-5",
		name: "openrouter/anthropic/claude-haiku-4-5",
		description: "openrouter, aggregated, no credential",
		group: "Needs sign-in",
	},
];

/* --------------------------------------------------------------- harness */

const Ground: FC<{ children: ReactNode }> = ({ children }) => (
	<div className="min-h-screen bg-canvas p-6">
		<div className="w-96">{children}</div>
	</div>
);

/** The harness every story renders: a real controlled instance. */
const Harness: FC<{
	options: SearchableOption[];
	initial: SearchableOption | null;
	chromeLess?: boolean;
	placeholder?: string;
	emptyText?: string;
	clearable?: boolean;
	busy?: boolean;
	busyLabel?: string;
	disabled?: boolean;
	listNotice?: string;
}> = ({
	options,
	initial,
	chromeLess = false,
	placeholder = "Search providers",
	emptyText,
	clearable = false,
	busy = false,
	busyLabel = "Loading providers",
	disabled = false,
	listNotice,
}) => {
	const [selected, setSelected] = useState<SearchableOption | null>(initial);
	const [value, setValue] = useState(initial?.id ?? "");
	return (
		<div>
			<SearchableSelect
				/* The chrome-less variant is what the registry rows render: they
				   draw their own label, warning and help, so the control must not
				   draw a second one — and it names itself for assistive tech. */
				showLabel={!chromeLess}
				label="Provider"
				icon={<Bot size={16} aria-hidden="true" />}
				labelTooltip="The provider your agents boot on."
				ariaLabel={chromeLess ? "Default provider" : undefined}
				ariaDescribedBy={chromeLess ? "story-combobox-help" : undefined}
				placeholder={placeholder}
				emptyText={emptyText}
				options={options}
				selected={selected}
				busy={busy}
				busyLabel={busyLabel}
				disabled={disabled}
				listNotice={listNotice}
				onSelect={(option) => {
					setSelected(option);
					setValue(option.id);
				}}
				onCustomSubmit={(text) => {
					setSelected({ id: text, name: text });
					setValue(text);
				}}
				/* The shipped wrapper's own copy, so a frame shows the row a user
				   would meet rather than a story-only variant of it. */
				customRowLabel={(text) => `Use "${text}"`}
				onClear={clearable ? () => setValue("") : undefined}
			/>
			{chromeLess ? (
				<p id="story-combobox-help" className="mt-1 text-meta text-ink-dim">
					Default provider. The value stored is {value || "empty"}.
				</p>
			) : null}
		</div>
	);
};

/**
 * Run a script with the shutter held.
 *
 * `capturePending` is set in a LAYOUT effect so it is on the document before
 * the harness's readiness probe can see a rendered field.
 */
const Driven: FC<{
	options: SearchableOption[];
	initial: SearchableOption | null;
	chromeLess?: boolean;
	placeholder?: string;
	emptyText?: string;
	clearable?: boolean;
	busy?: boolean;
	busyLabel?: string;
	listNotice?: string;
	run: () => Promise<boolean>;
}> = ({ run, ...rest }) => {
	useLayoutEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		let cancelled = false;
		const script = async () => {
			/*
			 * Two frames before the script touches anything, and this is not
			 * padding: the field's own effect sets the text to the current
			 * selection when that selection changes, and it is a PASSIVE effect —
			 * so a script that typed in the LAYOUT phase had its keystrokes
			 * overwritten a moment later, leaving a frame of the untouched field
			 * under a story that claims the opposite. The settings harness makes
			 * the same wait for the same reason (`dispatchReadiness`).
			 */
			await nextFrame();
			await nextFrame();
			const settled = await run();
			await nextFrame();
			await nextFrame();
			if (!cancelled && settled) {
				delete document.documentElement.dataset.capturePending;
			}
		};
		void script();
		return () => {
			cancelled = true;
			delete document.documentElement.dataset.capturePending;
		};
	}, [run]);
	return (
		<Ground>
			<Harness {...rest} />
		</Ground>
	);
};

const meta = {
	title: "Settings/Model combobox",
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

type Story = StoryObj;

/** The labelled variant, as the hosting and model pickers render it. */
export const Labelled: Story = {
	render: () => (
		<Ground>
			<Harness
				options={OPTIONS}
				initial={null}
				placeholder="Search providers"
			/>
		</Ground>
	),
};

/**
 * The registry row's variant: no label block, an accessible name, the row's
 * help wired through `aria-describedby`, and an empty field — which is what an
 * unset `hosting` looks like now that it has a placeholder and an affordance.
 */
export const ChromeLess: Story = {
	render: () => (
		<Ground>
			<Harness options={OPTIONS} initial={null} chromeLess />
		</Ground>
	),
};

/** The list open and nothing typed: the whole login registry, grouped. */
export const OpenGrouped: Story = {
	render: () => (
		<Driven
			options={OPTIONS}
			initial={null}
			placeholder="Search providers"
			run={async () => {
				combobox()?.focus();
				await waitFor(() => Boolean(listbox()));
				return Boolean(listbox());
			}}
		/>
	),
};

/** The list open over a query: the filter narrowing model rows by selector. */
export const OpenFiltered: Story = {
	render: () => (
		<Driven
			options={MODELS}
			initial={
				{
					id: "claude-opus-5",
					name: "anthropic/claude-opus-5",
					description: "anthropic",
					group: "Signed in",
				} satisfies SearchableOption
			}
			placeholder="Search models"
			run={async () => {
				const input = combobox();
				if (!input) return false;
				input.focus();
				setFieldValue(input, "anthro");
				/*
				 * `:not([data-combobox-row="typed"])` is the typed-value row, which is
				 * offered BESIDE the filter's result rather than being part of it — an
				 * assertion about "the rows this query produced" has to exclude it.
				 */
				const matches = () =>
					listbox()?.querySelectorAll(
						'[role="option"]:not([data-combobox-row="typed"])',
					).length ?? 0;
				await waitFor(() => matches() === 2);
				return matches() === 2;
			}}
		/>
	),
};

/**
 * A query that matches nothing. The row under the field is a message, not an
 * option that cannot be chosen, and it is the state that must not read as an
 * error: Enter here commits the typed text verbatim.
 */
export const NoMatches: Story = {
	render: () => (
		<Driven
			options={OPTIONS}
			initial={null}
			placeholder="Search providers"
			emptyText="No providers"
			run={async () => {
				const input = combobox();
				if (!input) return false;
				input.focus();
				setFieldValue(input, "zzz");
				await waitFor(() =>
					(listbox()?.textContent ?? "").includes("No providers"),
				);
				return (listbox()?.textContent ?? "").includes("No providers");
			}}
		/>
	),
};

/**
 * A stored value no listing contains.
 *
 * This is the state this repository's own configured fixture is in
 * (`model_name: "deepseek/deepseek-chat"`), and the requirement is that it
 * renders rather than blanking: a blank field for a set key is a lie the user
 * cannot debug. The clear affordance beside the chevron is visible here too,
 * because a field that is set is the only state in which it exists.
 */
export const UnknownValue: Story = {
	render: () => (
		<Ground>
			<Harness
				options={MODELS}
				initial={{
					id: "deepseek/deepseek-chat",
					name: "deepseek/deepseek-chat",
				}}
				placeholder="Search models"
				clearable
			/>
		</Ground>
	),
};

/*
 * ---------------------------------------------------------------- *
 * The three states design round 1 asked for, and why each was new  *
 * ---------------------------------------------------------------- *
 */

/**
 * The active row's mark, and the row that carries the typed text.
 *
 * Two states at once, because they are one gesture: a query narrows the list,
 * the FIRST row it admits carries the mark, and the typed text sits at the
 * bottom as a row of its own. That is what makes "type three characters, press
 * Enter" commit the row on screen rather than the three characters — the mark
 * says which row that is, and the last row is how the typed value stays
 * committable (UX round 1, U1; design round 1, D5.1).
 *
 * The mark itself is two roles, not one: a wash, which is invisible in four of
 * the fifty-nine palettes on the popover's own ground, and a 1px structural
 * edge, which carries it in all of them. A frame is the only thing that can
 * show that the pair reads as a mark.
 */
export const ActiveRow: Story = {
	render: () => (
		<Driven
			options={MODELS}
			initial={{
				id: "claude-opus-5",
				name: "anthropic/claude-opus-5",
			}}
			placeholder="Search models"
			run={async () => {
				const input = combobox();
				if (!input) return false;
				input.focus();
				setFieldValue(input, "anthro");
				const marked = () =>
					Boolean(listbox()?.querySelector(".outline-control"));
				await waitFor(marked);
				return marked();
			}}
		/>
	),
};

/**
 * The list while the catalogue is still on its way, which is every first open.
 *
 * Four of the five rows this PR adds are in this state for a moment each time
 * they are opened for the first time, and the sentence they must NOT say is
 * "Nothing matches that model": nothing has matched nothing, the query has not
 * answered. The field keeps its placeholder and stays typeable throughout
 * (design round 1, D1).
 */
export const Loading: Story = {
	render: () => (
		<Driven
			options={[]}
			initial={null}
			placeholder="Search models"
			busy
			busyLabel="Loading models"
			run={async () => {
				combobox()?.focus();
				await waitFor(() =>
					(listbox()?.textContent ?? "").includes("Loading models"),
				);
				return (listbox()?.textContent ?? "").includes("Loading models");
			}}
		/>
	),
};

/**
 * A list that is scoped, saying so.
 *
 * The model list is narrowed to the provider the row above it will boot on,
 * and until this line existed nothing on screen said that — so "Nothing matches
 * that model" read as "this app does not have that model" when the real reason
 * was a scope the user was never told about (UX round 1, U2).
 */
export const ScopedNotice: Story = {
	render: () => (
		<Driven
			options={MODELS}
			initial={null}
			placeholder="Search models"
			listNotice="Models for Anthropic"
			run={async () => {
				combobox()?.focus();
				await waitFor(() =>
					(listbox()?.textContent ?? "").includes("Models for Anthropic"),
				);
				return (listbox()?.textContent ?? "").includes("Models for Anthropic");
			}}
		/>
	),
};

/**
 * A scope that could not be resolved, saying that too.
 *
 * When the chosen provider has no rows in the catalogue — seven of the
 * seventeen providers in the reviewed registry, including OpenRouter, did not —
 * the list widens to the whole catalogue so that it is never empty. That is the
 * right fallback and a surprising one: without this line the row above says
 * "OpenRouter" and the list offers OpenAI, and nothing explains the
 * relationship (UX round 1, U3).
 */
export const UnresolvedScope: Story = {
	render: () => (
		<Driven
			options={MODELS}
			initial={null}
			placeholder="Search models"
			listNotice="No models listed for OpenRouter. Showing all models."
			run={async () => {
				combobox()?.focus();
				await waitFor(() =>
					(listbox()?.textContent ?? "").includes("Showing all models"),
				);
				return (listbox()?.textContent ?? "").includes("Showing all models");
			}}
		/>
	),
};

/**
 * A disabled field, which is what a row looks like while its Save is in flight.
 *
 * The chevron steps to `ink-disabled` with the field, the way the `Select` in
 * the same rows already does. Without this frame the state is unphotographable:
 * the `saving` story in the section's own file is the cascade textarea's row,
 * and no fixture can put these rows in it (design round 1, D2).
 */
export const Disabled: Story = {
	render: () => (
		<Ground>
			<Harness
				options={MODELS}
				initial={{
					id: "claude-opus-5",
					name: "anthropic/claude-opus-5",
				}}
				placeholder="Search models"
				clearable
				disabled
			/>
		</Ground>
	),
};
