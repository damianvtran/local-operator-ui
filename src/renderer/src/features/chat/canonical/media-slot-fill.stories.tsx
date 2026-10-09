/**
 * The media tile's fill, on the sheet the strip is read on.
 *
 * WHY THIS SET EXISTS: the condensed strip's tile is BORDERLESS AT REST (the
 * operator asked for the ring to go), so the tile's own extent is its fill -
 * and the shared `sunken` well could not carry that. The two worst cases are
 * both here: a picture whose own canvas is the page's tone (the `lightCanvas`
 * and `darkCanvas` fixtures; ~1.0:1 against the page, 1.001:1 measured in
 * `localOperatorDark`) and the letterboxed portrait (`tall`; the well's mats
 * measure ~1.05-1.06:1), with `one` as the ordinary control beside them. The
 * set is the AFTER half of the pair whose BEFORE is
 * `docs/evidence/chat-media-slot-fill-before/` - a frame of the repaired fill
 * alone cannot show that the tile used to sit at a step a reader cannot find.
 *
 * THEMES, from the audit's extremes rather than taste: `iceberg` and
 * `neonNoir` carry the fleet's smallest shared-well steps (2.00 ΔE00 each, the
 * two worst of the 59), `localOperatorLight`/`localOperatorDark` are the brand
 * pair and the palettes the loss was measured on, and `ayuMirage` already
 * clears the floor at rest, so the change does NOT move it - the pair's
 * control, expected byte-identical across the halves.
 *
 * The strip is the real `FoldMedia` on the same sheet the trace-fold strip
 * frames use, at the same 1280 wide, so a reviewer can hold these against
 * `chat-trace-fold/image-tones` and `images-many` - the pre-change frames
 * those sets own.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { FoldMedia } from "./fold-media";
import type { TranscriptImage } from "./transcript-reducer";

/* 360x240 PNGs and one 200x360 portrait - the same bytes the trace-fold strip
   stories carry, inlined so a frame needs no backend, port or store. */
const FOLD_SHOT_ONE =
	"iVBORw0KGgoAAAANSUhEUgAAAWgAAADwCAIAAACixWkYAAAC/0lEQVR42u3UsQnAIBRFUacJVs6RgTKLjbUOaRo3CPwiksCBM8HjcdORC0BIMgEgHIBwAMIBCAcgHADCAQgHIByAcADCASAcgHAAwgEIByAcAMIBCAcgHIBwAMIBCAeAcADCAQgHIByAcAAIByAcwAfCUVsHCBEOQDiADeGY8wYIEQ5AOADhAIQDEA5AOACEAxAOQDgA4QCEA0A4AOEAhAMQDkA4AIQDEA5AOADhAIQDEA4rAMIBCAcgHIBwAMIB8KdwnNcAngmHcIBwCAcIh3CAcAgHCIdwgHAIh3CAcAgHCIdwgHAIBwiHcIBwCAcgHMIBwiEcIBzCAcIhHCAcwgEIh3CAcAgHCIdwgHAIBwiHcIBwCIdwgHAIBwiHcIBwCAcIh3CAcAiHT4BwCAcIh3CAcAgHCIdwgHAIByAcwgHCIRwgHMIBwiEcIBzCAQiHcIBwCAcIh3CAcAgHCIdwgHAIh3CAcAgHCIdwgHAIBwiHcIBwCAcgHMIBwiEcIBzCAcIhHCAcwgEIh3CAcAgHCIdwgHAIBwiHcADCIRwgHMIBwiEcIBzCAcIhHCAcwiEcIBzCAcIhHCAcwgHCIRwgHMIBCIdwgHAIBwiHcIBwCAcIh3AAwiEcIBzCAcIhHCAcwgHCIRyAcAgHCIdwgHAIBwiHcIBwCAcIh3AIBwiHcIBwCAcIh3CAcAgHCIdwAMIhHCAcwgHCIRwgHMIBwiEcgHAIBwiHcIBwCAcIh3CAcAgHCIdwCAcIh3CAcAgHCIdwgHAIBwiHcAgHCIdwgHAIBwiHcIBwCAcIh3AAwiEcIBzCAcIhHCAcwgHCIRyAcAgHCIdwgHAACAcgHIBwAMIBCAeAcADCAQgHIByAcAAIByAcgHAAwgEIByAcAMIBCAcgHIBwAMIBIByAcADCAQgHIBwAwgEIByAcgHAAwgEgHIBwAMIBCAcgHIBwAAgHIByAcADCAQgHgHAAwgEIByAcgHAACAcgHIBwAMIBCAeAcADCAQgHIByAcADCASAcwCsWE+1fusL0MMsAAAAASUVORK5CYII=";
const FOLD_LIGHT_CANVAS =
	"iVBORw0KGgoAAAANSUhEUgAAAWgAAADwCAIAAACixWkYAAAFhUlEQVR42u3aTW7qQBAAYc6FWHH/ddaRwjabnCALpMjy/Lg9NhmP+aRSpEfAVLpDPRty+fn+AoBVXIwAgHAAEA4AwgFAOAAIBwAIBwDhACAcAIQDgHAAgHAAEA4AwgFAOAAIRwPX2z1745PSLbNvTe8we+AuR05tK8epPDsgHC8MR+nlWn8xV44WP04akeCj/JYAxw1HJCvx5yolIP0qHMCo4fg7HShdmDSEY3ac7HNFLotcpwDnv1RZdfESfPaIAyAc53yPI3umk/5TOICe4Yic9i9+9hF80bZ9hhIJmUsVwN9xABAOAMIBQDgACAcACAcA4QAgHACEA4BwABAOABAOAMIBQDgACAcA4QAA4QAwRDgenx8A+jJkOA5YSlasWAkHK1ashMOCWbESDgtmxUo4jJIVK1bCwYoVK+FgxYqVcLBixUo4LJgVK+EwSlashMMoWbFiJRysWLESDlasWAmHBbNiJRxGyYqVcBglK1ashIMVK1bCwYoVK+GwYFashMOCWbESDqNkxYqVcLBixUo4WLFiJRwWzIqVcFgwK1bCYZSsWLESDlasWAkHK1ashIMVK1bCYcGsWAmHUbJiJRz7SwPoizMOVqxYuVSxYFashMMoWbESDqNkxYqVcLBixUo4WLFiJRwWzIqVcFgwK1bCYZSsWLESDlasWAkHK1ashMOCWbESDgtmxUo4jJIVK+EwSlasWAkHK1ashIMVK1bCYcGsWAmHUbJiJRxGyYoVK+FgxYqVcLBixUo4LJgVK+GwYFashMMoWbFiJRysWLESDlasWAmHBbNiJRwWzIqVcBglK1ashIMVK1ZHDQeAvjjjYMWKlUsVC2bFSjiMkhUr4TBKVqxYCQcrVqyEgxUrVsJhwaxYCYcFs2IlHEbJihUr4WDFipVwsGLFSjgsmBUr4bBgVqyEwyhZsRIOo2TFipVwsGLFSjhYsWIlHBbMipVwGCUrVsJhlKxYsRIOVqxYCQcrVqyEw4JZsRIOC2bFSjiMkhUrVsLBihUr4WDFipVwWDArVsJhwaxYCYdRsmLFSjhYsWJ11HAA6IszDlasWLlUsWBWrITDKFmxEg6jZMWKlXCwYsVKOFixYiUcFsyKlXBYMCtWwmGUrFixEg5WrFgJBytWrITDglmxEg4LZsVKOIySFSvhMEpWrFgJBytWrISDFStWwmHBrFgJh1GyYiUcRsmKFSvhYMWKlXCwYsVKOCyYFSvhsGBWrITDKFmxYiUcrFixEg5WrFgJhwWzYiUcFsyKlXAYJStWrISDFStWRw0HgL4442DFipVLFQtmxUo4jJIVK+EwSlasWAkHK1ashIMVK1bCYcGsWAmHBbNiJRxGyYoVK+FgxYqVcLBixUo4LJgVK+GwYFashMMoWbESDqNkxYqVcLBixUo4WLFiJRwWzIqVcBglK1bCYZSsWLESDlasWAkHK1ashMOCWbESDgtmxUo4jJIVK1bCwYoVK+FgxYqVcFgwK1bCYcGsWAmHUbJixUo4WLFidchwADgrwgFAOAAIBwDhACAcAIQDAIQDgHAAEA4AwpHhers/Kd0y+1b2lvpxpjfGn730qOkdSj7pferHWTWNBsPgVCMTA/qHIxKF9Nc9+Khmhy2Pij/72p9ir58rMlVgmHDUX07p13cLxysMS1MFxgtH6UJg7aVB8Kx7doeGR2Wd41dJlcuQ7M/eZlhKUsORgWHOONbeEv9fuvJOwb+dcWw5B9lu6IwD53yPI/tWaPpP4RAOvOmnKvGzicibf4sn3pWLhe1vPS5+9hE5ZsOnKpFLMJ+qwN9xABAOAMIBQDgAQDgACAcA4QAgHACEAwCEA4BwABAOAMIBQDgAQDgACAcA4QAgHACEA4BwAIBwABAOAMIBYHB+AV0DxL6OCvCsAAAAAElFTkSuQmCC";
const FOLD_SHOT_TALL =
	"iVBORw0KGgoAAAANSUhEUgAAAMgAAAFoCAIAAACdUSOTAAADD0lEQVR42u3SsQ2AIBRFUaYxVszhNIxjYy1DfhpXoPgJkpzkTvDeKcdZpfSKCQSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYGk1rPt5pfTAEljaCFbEkNIDS2AJLIFlBYElsASWBJbAElgSWAJLYElgCSyBJYElsASWBJbAElgSWAJLYElgCSyBJYElsASWBJbAElgSWAJLYElgCSyBJYElsATWVL1d2jewBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwAILLLAElsACCyywBJbAAgsssASWwPINWGAJLIElsMASWAJLYIElsASWwAJLYAksgQWWwBJYAgssgSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAEFlhggSWwBBZYYIElsAQWWGCBJbAElnvAAktgCSyBBZbAElgCCyyBJbAEFlgCS2AJLLAElsASWGCBBZbAElhggQWWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElgSWwBJYElgCS2BJYAksgSWBJbAElsAygcASWAJLAktgCSwJLIElsCSwBJbAksASWAJLAktgCSwJLP20D2a4hLjaytrlAAAAAElFTkSuQmCC";
const FOLD_DARK_CANVAS =
	"iVBORw0KGgoAAAANSUhEUgAAAWgAAADwCAIAAACixWkYAAAFfElEQVR42u3aTU7jQBBA4VyEBTkAG7j/KbKMchYWSMhy/7i6bXB38klPaCYkzqNq8sZOuFzf3wCgiYsRABAOAMIBQDgACAcA4QAA4QAgHACEA4BwABAOABAOAMIBQDgACAcA4ejgcb/9kt5YuU/TwStHXn4re0v9OK1KgHAcE47Nl272xXzUkVcRafUB8LThqD9X+lU4gPnCsboQ6LsuyIYjPfLyW0Gf7MULgBHPODre4Djk7KZ+vqMdwOiXKt1nHE1RqDypcACDfqpy1Hsc3Z+hbP7ZRyqA3+MAIBwAhAOAcAAQDgAQDgDCAUA4AAgHAOEAAOEAIBwAhAOAcAAQDgDCYQoAhAPAvOH4+vwAcC5ThmPAUrJixUo4WLFiJRwWzIqVcFgwK1bCYZSsWLESDlasWAkHK1ashIMVK1bCYcGsWAmHUbJiJRxGyYoVK+FgxYqVcLBixUo4LJgVK+EwSlashMMoWbFiJRysWLESDlasWAmHBbNiJRwWzIqVcBglK1ashIMVK1bCwYoVK+GwYFashMOCWbESDqNkxYqVcLBixUo4WLFiJRysWLESDgtmxUo4jJIVK+E4XhrAuTjjYMWKlUsVC2bFSjiMkhUr4TBKVqxYCQcrVqyEgxUrVsJhwaxYCYcFs2IlHEbJihUr4WDFipVwsGLFSjgsmBUr4bBgVqyEwyhZsRIOo2TFipVwsGLFSjhYsWIlHBbMipVwGCUrVsJhlKxYsRIOVqxYCQcrVqyEw4JZsRIOC2bFSjiMkhUrVsLBihUr4WDFipVwWDArVsJhwaxYCYdRsmLFSjhYsWI1ajgAnIszDlasWLlUsWBWrITDKFmxEg6jZMWKlXCwYsVKOFixYiUcFsyKlXBYMCtWwmGUrFixEg5WrFgJBytWrITDglmxEg4LZsVKOIySFSvhMEpWrFgJBytWrISDFStWwmHBrFgJh1GyYiUcRsmKFSvhYMWKlXCwYsVKOCyYFSvhsGBWrITDKFmxYiUcrFixEg5WrFgJhwWzYiUcFsyKlXAYJStWrISDFStWo4YDwLk442DFipVLFQtmxUo4jJIVK+EwSlasWAkHK1ashIMVK1bCYcGsWAmHBbNiJRxGyYoVK+FgxYqVcLBixUo4LJgVK+GwYFashMMoWbESDqNkxYqVcLBixUo4WLFiJRwWzIqVcBglK1bCYZSsWLESDlasWAkHK1ashMOCWbESDgtmxUo4jJIVK1bCwYoVK+FgxYqVcFgwK1bCYcGsWAmHUbJixUo4WLFiNWo4AJyLMw5WrFi5VLFgVqyEwyhZsRIOo2TFipVwsGLFSjhYsWIlHBbMipVwWDArVsJhlKxYsRIOVqxYCQcrVqyEw4JZsRIOC2bFSjiMkhUr4TBKVqxYCQcrVqyEgxUrVsJhwaxYCYdRsmIlHEbJihUr4WDFipVwsGLFSjgsmBUr4bBgVqyEwyhZsWIlHKxYsRIOVqxYCYcFs2IlHBbMipVwGCUrVqyEgxUrVkOGA8CzIhwAhAOAcAAQDgDCAUA4AEA4AAgHAOEAIBwZHvfbD6VbVt/K3lI/zvLG+LOXHrW8Q8knvU/9OE3T6DAMTjUyMeD8cESikP5zDz6q22HPo+LP3vpTHPVzRaYKTBOO+ssp/fpq4fgLw9JUgfnCUboQaL00CJ51r+7Q8aisc/wqqXIZkv3Z+wxLSeo4MjDNGUfrLfH/pSvvFPzbGceec5D9hs448JzvcWTfCk3/KhzCgRf9VCV+NhF582/zxLtysbD/rcfNzz4ix+z4VCVyCeZTFfg9DgDCAUA4AAgHAAgHAOEAIBwAhAOAcACAcAAQDgDCAUA4AAgHAAgHAOEAIBwAhAOAcAAQDgAQDgDCAUA4AEzON0GadY1EDvHVAAAAAElFTkSuQmCC";

const shot = (name: string, data: string, index: number): TranscriptImage => ({
	id: `media-slot-fill:${index}:${name}`,
	data,
	attachment: null,
	mimeType: "image/png",
});

const IMAGES = [
	shot("one", FOLD_SHOT_ONE, 1),
	shot("lightCanvas", FOLD_LIGHT_CANVAS, 2),
	shot("tall", FOLD_SHOT_TALL, 3),
	shot("darkCanvas", FOLD_DARK_CANVAS, 4),
];

const meta: Meta = {
	title: "Chat/Media slot fill",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

const Sheet = () => (
	<div className="max-w-[760px] p-8">
		<p className="mb-2 text-body-sm text-ink-muted">
			Ran the suite, fixed the two failures, and pushed the branch.
		</p>
		<FoldMedia images={IMAGES} scope={null} onRevealMore={() => {}} />
	</div>
);

/** The strip at rest: the page-toned and letterboxed tiles, beside the control. */
export const Rest: Story = {
	render: () => <Sheet />,
};
