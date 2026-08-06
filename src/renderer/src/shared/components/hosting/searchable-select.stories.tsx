import type { Meta, StoryObj } from "@storybook/react";
import { Bot } from "lucide-react";
import { useState } from "react";
import { type SearchableOption, SearchableSelect } from "./searchable-select";

const PROVIDERS = ["OpenAI", "Anthropic", "Google"];

const MODELS: SearchableOption[] = [
	{
		id: "auto",
		name: "Auto",
		description: "Radient picks the best model for the job.",
		group: "Auto (Recommended)",
	},
	{
		id: "",
		name: "Default",
		description: "Clear model selection",
		group: "General",
	},
	...Array.from({ length: 24 }, (_, index) => {
		const provider = PROVIDERS[index % PROVIDERS.length];
		const name = `${provider.toLowerCase()}-model-${Math.floor(index / PROVIDERS.length) + 1}`;
		return {
			id: `${provider.toLowerCase()}/${name}`,
			name,
			description: `A ${provider} model with markdown: [docs](https://example.com/${name}).`,
			group: provider,
		};
	}),
];

const meta = {
	title: "Hosting/SearchableSelect",
	component: SearchableSelect,
} satisfies Meta<typeof SearchableSelect>;

export default meta;

type Story = StoryObj<typeof SearchableSelect>;

const SearchableSelectHarness = (props: {
	busy?: boolean;
	disabled?: boolean;
	helperText?: string;
}) => {
	const [selected, setSelected] = useState<SearchableOption | null>(
		MODELS[3] ?? null,
	);
	return (
		<div style={{ width: 360, padding: 24 }}>
			<SearchableSelect
				label="Model"
				icon={<Bot size={16} aria-hidden="true" />}
				labelTooltip="Select the AI model that you want to use."
				placeholder="Select a model..."
				options={MODELS}
				selected={selected}
				onSelect={(option) => setSelected(option)}
				onCustomSubmit={(text) =>
					setSelected({ id: text, name: text, description: "Custom model" })
				}
				busy={props.busy}
				busyLabel="Loading models"
				disabled={props.disabled}
				helperText={props.helperText}
			/>
		</div>
	);
};

export const Default: Story = {
	render: () => <SearchableSelectHarness />,
};

export const Busy: Story = {
	render: () => <SearchableSelectHarness busy />,
};

export const WithHelperText: Story = {
	render: () => <SearchableSelectHarness helperText="No models available" />,
};

export const Disabled: Story = {
	render: () => <SearchableSelectHarness disabled />,
};
