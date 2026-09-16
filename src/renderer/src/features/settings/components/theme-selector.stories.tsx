import type { Meta, StoryObj } from "@storybook/react";
import { Contrast } from "lucide-react";
import { SettingsSection } from "./settings-section";
import { ThemeSelector } from "./theme-selector";

/**
 * The appearance picker, in the column the settings page gives it.
 *
 * ## Why this story exists
 *
 * The picker had no story, and that was a hole in the evidence set rather than
 * a gap in the coverage: `scripts/capture-evidence.mjs` captures one frame per
 * story per theme, so a surface with no story is a surface no frame can show —
 * the picker's tiles, their density, the selected signals and the group
 * headings had never been photographed in ANY theme, let alone in the
 * fifty-nine a palette port adds. `settings-*` sections had stories; the one
 * component a palette change is actually judged on did not.
 *
 * ## Why it renders the shipped section rather than the picker alone
 *
 * The picker's column is `max-w-4xl` (896px) inside a settings page that owns
 * the padding and the section heading, and the tile grid's `auto-fill` minimum
 * resolves its column count from that width — five across, the number every
 * geometry note on this component quotes. Photographing `ThemeSelector` on its
 * own would measure a column this app never renders, and the claim that all
 * fifty-nine tiles fit in less height than the old twelve is a claim about THIS
 * column. So the frame renders `SettingsSection` + `ThemeSelector`, which is
 * the shipped subtree, with the same title, icon and description the page
 * passes.
 *
 * ## What it does not stub
 *
 * Nothing. The picker reads the live theme registry and the preferences store,
 * and the store is exactly what the theme frame in `.storybook/preview.tsx`
 * drives from the `theme` arg — so each frame shows that theme selected, with
 * its own wash, accent frame and check, and a frame is a picture of the picker
 * a user in that theme would be looking at. There is no fixture here to drift
 * from the product.
 *
 * ## What a reader checks in a frame
 *
 * The tile count is the registry's and the group headings are each palette's
 * own `mode`, so the two groups' tiles must account for every theme in
 * `shared/themes/index.ts` — fifty-nine, forty-one under `Dark` and eighteen
 * under `Light`. The selected tile is the frame's own theme, because the
 * preview's theme arg drives the preferences store the picker reads.
 */
const AppearanceFrame = () => (
	<div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-6">
		<SettingsSection
			title="Appearance"
			icon={Contrast}
			description="Customize the look and feel of Local Operator"
			dataTourTag="settings-appearance-section"
		>
			<div className="flex flex-col gap-4">
				<ThemeSelector />
			</div>
		</SettingsSection>
	</div>
);

const meta = {
	title: "Settings/Appearance",
	component: ThemeSelector,
	parameters: { layout: "fullscreen" },
	render: () => <AppearanceFrame />,
} satisfies Meta<typeof ThemeSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The picker as it ships: every theme in the registry, grouped by mode.
 *
 * Captured at 1000x1420 because the frame IS the picker: at the 900px default
 * the light group is cut off, and a frame that hides the bottom third of the
 * grid cannot answer the question the frames exist for — whether fifty-nine
 * palettes read as a set you can take in at a glance. The width is the
 * 896px column plus the page's own padding.
 */
export const Gallery: Story = {};
