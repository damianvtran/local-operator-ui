/**
 * The `kind` -> control switch, and the slot each control occupies.
 *
 * Two things live here that used to be spread through the row.
 *
 * 1. THE SLOT. Every control was rendered full width, which is the operator's
 *    "most settings taking up full width and being inefficient with space" as a
 *    number: 68 of 99 rows carried a control wider than 800px and 90 of 99
 *    carried one narrower than 40px, all inside a ~77px row. A control is sized
 *    by its KIND here — a switch is a switch, a number is a number, a host list
 *    is a list — and the row's layout, not the caller, decides what happens when
 *    the column is too narrow for it (it stacks). Full width survives only where
 *    the value genuinely is multi-line: `list` and `cascade`.
 *
 * 2. THE HOTKEY KIND. The contract's `kind` union did not name `hotkey`, so the
 *    two `keymap.*` rows fell through to the default text branch and rendered a
 *    plain text input for a field whose own help says "press the key you want".
 *    A hotkey has to LISTEN for a keystroke, which is why it is a kind rather
 *    than a string with a hint (see `settings_io.Kind.HOTKEY`).
 *
 * Nothing saves on blur here either — a control reports its draft upward and the
 * row's Save decides when anything is written.
 */

import type { BackendSetting } from "@shared/api/local-operator/desktop-api";
import {
	Input,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Switch,
	Textarea,
} from "@shared/components/ui";
import type { KeyboardEvent } from "react";
import { CASCADE_SENTINEL, serialize } from "./backend-settings-drafts";

/**
 * The width each kind's control occupies.
 *
 * `min-w-0` on the two full-width kinds is what lets a textarea shrink inside a
 * flex row instead of forcing the row wider than its column.
 */
const SLOT: Record<BackendSetting["kind"], string> = {
	bool: "w-9",
	int: "w-28",
	float: "w-28",
	enum: "w-64",
	text: "w-96",
	hotkey: "w-56",
	list: "w-full min-w-0",
	cascade: "w-full min-w-0",
	readonly: "w-40",
};

/** The slot class for one setting, exported for the row's own layout. */
export function controlSlot(kind: BackendSetting["kind"]): string {
	return SLOT[kind] ?? SLOT.text;
}

/**
 * The keystroke names the runtime binds, for the keys whose `event.key` is not
 * already the name.
 *
 * Short and deliberate: Textual spells these in lower case (`space`, `escape`,
 * `up`), and a plain `event.key.toLowerCase()` would store `" "` and `"arrowup"`,
 * which the runtime cannot bind. Everything else — letters, digits, `f1`.. — is
 * correct after lower-casing.
 */
const KEY_NAMES: Record<string, string> = {
	" ": "space",
	Spacebar: "space",
	Escape: "escape",
	Esc: "escape",
	Enter: "enter",
	Tab: "tab",
	Backspace: "backspace",
	Delete: "delete",
	ArrowUp: "up",
	ArrowDown: "down",
	ArrowLeft: "left",
	ArrowRight: "right",
	Home: "home",
	End: "end",
	PageUp: "pageup",
	PageDown: "pagedown",
};

/** A modifier pressed on its own is not a binding, and neither is IME. */
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph"]);

/**
 * The binding a keystroke spells, in the one order the registry stores.
 *
 * The registry normalizes again at the write boundary (`settings_io.coerce` ->
 * `keymap.normalize_key`), so this is the capture half of the contract rather
 * than a second definition of it: what it guarantees is that the common case
 * (`cmd+shift+n`) is already in the runtime's own spelling and reads back the
 * same in the field.
 */
export function hotkeyFromEvent(
	event: KeyboardEvent<HTMLInputElement>,
): string {
	// `isComposing` lives on the native event: an IME candidate window would
	// otherwise bind whatever half-typed character the reader has so far.
	if (MODIFIER_KEYS.has(event.key) || event.nativeEvent.isComposing) return "";
	const parts: string[] = [];
	if (event.ctrlKey) parts.push("ctrl");
	if (event.altKey) parts.push("alt");
	if (event.shiftKey) parts.push("shift");
	if (event.metaKey) parts.push("meta");
	const name = KEY_NAMES[event.key] ?? event.key.toLowerCase();
	if (!name) return "";
	return [...parts, name].join("+");
}

/**
 * The hotkey field: it captures a keystroke instead of accepting text.
 *
 * `readOnly`, because a hand-typed `ctrl+N` is exactly the value the runtime
 * cannot bind — the field's only writer is a real key press, and the sentence
 * beside it says so. That is also why there is no `placeholder` here: an example
 * in the field would invite typing into a control that does not accept typing.
 */
const HotkeyInput = ({
	value,
	label,
	disabled,
	onChange,
}: {
	value: string;
	label: string;
	disabled: boolean;
	onChange: (value: string) => void;
}) => (
	<Input
		readOnly
		value={value}
		disabled={disabled}
		aria-label={`${label}: press the key you want`}
		className="font-mono text-body-sm"
		onKeyDown={(event) => {
			const binding = hotkeyFromEvent(event);
			// An unmodified printable key is a keystroke the reader meant to bind;
			// a modifier alone is not, and neither is a key the runtime cannot
			// name — both are left alone rather than bound to something unusable.
			if (!binding) return;
			event.preventDefault();
			onChange(binding);
		}}
	/>
);

export type SettingControlProps = {
	setting: BackendSetting;
	/** The serialized draft, or the cascade sentinel for the cascade kind. */
	value: string;
	/** The cascade chains, when the kind is `cascade`. */
	chains?: Record<string, string[]>;
	/** True while the row is saving, or gated off by another setting. */
	disabled?: boolean;
	onValueChange: (value: string) => void;
	onChainsChange?: (chains: Record<string, string[]>) => void;
};

export const SettingControl = ({
	setting,
	value,
	chains,
	disabled = false,
	onValueChange,
	onChainsChange,
}: SettingControlProps) => {
	switch (setting.kind) {
		case "bool":
			return (
				<Switch
					checked={value === "true"}
					disabled={disabled}
					onCheckedChange={(checked) =>
						onValueChange(checked ? "true" : "false")
					}
					aria-label={setting.label}
				/>
			);
		case "enum":
			return (
				<Select value={value} disabled={disabled} onValueChange={onValueChange}>
					<SelectTrigger aria-label={setting.label} className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{setting.choices.map((choice) => (
							<SelectItem
								key={serialize(choice.value)}
								value={serialize(choice.value)}
							>
								{choice.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			);
		case "int":
		case "float":
			return (
				<Input
					type="number"
					value={value}
					disabled={disabled}
					min={setting.minimum ?? undefined}
					max={setting.maximum ?? undefined}
					step={setting.kind === "int" ? 1 : "any"}
					onChange={(event) => onValueChange(event.target.value)}
					aria-label={setting.label}
				/>
			);
		case "hotkey":
			return (
				<HotkeyInput
					value={value}
					label={setting.label}
					disabled={disabled}
					onChange={onValueChange}
				/>
			);
		case "list":
			return (
				<Textarea
					value={value}
					disabled={disabled}
					rows={Math.min(6, setting.members.length + 2)}
					onChange={(event) => onValueChange(event.target.value)}
					aria-label={setting.label}
					placeholder={setting.placeholder}
					className="font-mono text-body-sm"
				/>
			);
		case "cascade": {
			const live =
				chains ?? (setting.value as Record<string, string[]> | null) ?? {};
			return (
				<div className="flex flex-col gap-3">
					{Object.entries(live).map(([chainName, hops]) => (
						<div key={chainName} className="flex flex-col gap-1">
							<span className="font-mono text-meta text-ink-dim">
								{chainName}
							</span>
							<Textarea
								value={hops.join("\n")}
								disabled={disabled}
								rows={Math.max(2, hops.length + 1)}
								onChange={(event) =>
									onChainsChange?.({
										...live,
										[chainName]: event.target.value
											.split("\n")
											.map((line) => line.trim())
											.filter(Boolean),
									})
								}
								aria-label={`${setting.label}: ${chainName}`}
								className="font-mono text-body-sm"
							/>
						</div>
					))}
					<p className="text-meta text-ink-dim">
						One hop per line, as provider/model (effort). An empty chain moves
						to the next provider.
					</p>
				</div>
			);
		}
		default:
			return (
				<Input
					value={value}
					disabled={disabled}
					onChange={(event) => onValueChange(event.target.value)}
					aria-label={setting.label}
					placeholder={setting.placeholder}
				/>
			);
	}
};

/** Whether a draft is the untouched cascade sentinel. */
export const isCascadeUntouched = (draft: string) => draft === CASCADE_SENTINEL;
