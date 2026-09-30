/**
 * The FAST picker's rows, with the CURRENT dial marked — and only this picker's.
 *
 * Its own module for the reason `model-picker-match.ts` and
 * `model-catalogue-listing.ts` are theirs: a small decision worth asserting on
 * its own, which a test can bundle without dragging the whole picker file in.
 *
 * WHY IT EXISTS. The `/fast` row states the dial in its right-edge slot and the
 * model chip marks it with the bolt; the picker the row opens was the one
 * surface that hid it — a user read `currently on`, pressed the row, and then
 * saw an On/Off list with neither option marked as the state they were already
 * in (UX round 1, U2). The mark is `PickerOption.current`, which `PickerHost`
 * renders as the accent check and `data-current`, and which its list also uses
 * as the initial highlight.
 *
 * WHAT THE MARK MEANS. `state` is the same tri-state every surface reads
 * (`fastModeState`, `session-model.ts`), and a model with no fast tier marks
 * NEITHER option: there is no current dial to claim, which is the same reason
 * the row shows no slot and the badge hides.
 */

import type { FastModeState } from "../session-status/session-model";
import type { PickerOption } from "./picker-host";

export function fastPickerOptions(state: FastModeState): PickerOption[] {
	return [
		{
			value: "on",
			label: "On",
			description:
				"Priority processing. Billed at premium rates where the provider offers it.",
			current: state === "on",
		},
		{
			value: "off",
			label: "Off",
			description: "Standard processing.",
			current: state === "off",
		},
	];
}
