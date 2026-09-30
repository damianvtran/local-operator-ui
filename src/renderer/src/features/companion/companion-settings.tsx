import { ToggleSetting } from "@shared/components/common/toggle-setting";
import {
	Alert,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Check, Plus, UserRound } from "lucide-react";
import { useState } from "react";
import type { CompanionSettings } from "../../../../shared/companion-settings";
import { isBuiltinCompanion } from "../../../../shared/companion-skin";
import { CompanionArt } from "../../companion-art";
import { useCompanionSettings } from "./use-companion-settings";

function CharacterChooser({
	settings,
	selected,
	disabled,
	onSelect,
}: {
	settings: CompanionSettings;
	selected: string;
	disabled: boolean;
	onSelect: (id: string) => void;
}) {
	return (
		<fieldset
			className={cn(
				"grid min-w-0 grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2",
			)}
			aria-label="Companion character"
		>
			{settings.characters.map((character) => (
				<Button
					key={character.id}
					variant={selected === character.id ? "outline" : "secondary"}
					className={cn("h-auto min-w-0 flex-col gap-1 p-2")}
					aria-pressed={selected === character.id}
					disabled={disabled}
					onClick={() => onSelect(character.id)}
				>
					<span className={cn("flex size-20 items-center justify-center")}>
						{isBuiltinCompanion(character.id) ? (
							<CompanionArt
								character={character.id}
								mood="idle"
								reaction="rest"
								gaze={{ x: 0, y: 0 }}
							/>
						) : character.frames?.idle ? (
							<img
								src={character.frames?.idle}
								alt=""
								className={cn(
									"max-h-full max-w-full object-contain",
									character.pixelated && "[image-rendering:pixelated]",
								)}
							/>
						) : (
							<UserRound
								size={28}
								aria-hidden="true"
								className={cn("text-ink-muted")}
							/>
						)}
					</span>
					<span
						className={cn("flex max-w-full items-center gap-1 text-body-sm")}
					>
						{selected === character.id && (
							<Check size={12} aria-hidden="true" className={cn("shrink-0")} />
						)}
						<span className={cn("truncate")}>{character.name}</span>
					</span>
				</Button>
			))}
		</fieldset>
	);
}

export function CompanionSettingsPanel() {
	const {
		settings,
		error,
		loading,
		available,
		update,
		retry,
		importCharacter,
	} = useCompanionSettings();
	const [saving, setSaving] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	async function save(action: () => Promise<unknown>) {
		setSaving(true);
		setFailure(null);
		try {
			await action();
			return true;
		} catch {
			setFailure("Companion settings could not be saved. Try again.");
			return false;
		} finally {
			setSaving(false);
		}
	}
	if (!available) return null;
	if (loading)
		return (
			<p className={cn("text-body-sm text-ink-muted")}>Loading companions…</p>
		);
	if (!settings)
		return (
			<Alert variant="warning">
				{error}
				<Button variant="link" onClick={retry}>
					Try again
				</Button>
			</Alert>
		);
	return (
		<section
			className={cn("flex flex-col gap-3")}
			aria-label="Desktop companion"
		>
			<ToggleSetting
				value={settings.enabled}
				label="Desktop companion"
				description="A little companion for quick chats and updates from your agents. You can hide it anytime."
				isSaving={saving}
				onChange={async (enabled) => {
					if (!(await save(() => update({ enabled }))))
						throw new Error("Could not save companion settings.");
				}}
			/>
			<CharacterChooser
				settings={settings}
				selected={settings.character}
				disabled={saving}
				onSelect={(character) => void save(() => update({ character }))}
			/>
			<Button
				className={cn("self-start")}
				variant="ghost"
				disabled={saving}
				onClick={() => void save(importCharacter)}
			>
				<Plus size={16} aria-hidden="true" /> Add your own
			</Button>
			{failure && <Alert variant="warning">{failure}</Alert>}
		</section>
	);
}

export function CompanionWelcomeDialog({
	settings,
	onChoose,
	onCloseAutoFocus,
}: {
	settings: CompanionSettings;
	onChoose: (enabled: boolean, character: string) => Promise<unknown>;
	onCloseAutoFocus: (event: Event) => void;
}) {
	const [character, setCharacter] = useState(settings.character);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	async function choose(enabled: boolean) {
		if (saving) return;
		setSaving(true);
		setError(null);
		try {
			await onChoose(enabled, character);
		} catch {
			setError("Your choice could not be saved. Please try again.");
			setSaving(false);
		}
	}
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) void choose(false);
			}}
		>
			<DialogContent
				className={cn(
					"max-h-[calc(100vh-4rem)] max-w-[min(32rem,calc(100vw-4rem))] overflow-y-auto",
				)}
				closeDisabled={saving}
				onCloseAutoFocus={onCloseAutoFocus}
				onEscapeKeyDown={(event) => {
					if (saving) event.preventDefault();
				}}
				onPointerDownOutside={(event) => event.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle>A little company?</DialogTitle>
					<DialogDescription>
						Keep a companion on your desktop for quick chats and updates from
						your agents.
					</DialogDescription>
				</DialogHeader>
				<CharacterChooser
					settings={settings}
					selected={character}
					disabled={saving}
					onSelect={setCharacter}
				/>
				<p className={cn("text-body-sm text-ink-muted")}>
					You can change your companion or hide it in Settings → Appearance.
				</p>
				{error && <Alert variant="warning">{error}</Alert>}
				<DialogFooter>
					<Button
						variant="ghost"
						disabled={saving}
						onClick={() => void choose(false)}
					>
						Not now
					</Button>
					<Button
						variant="primary"
						disabled={saving}
						onClick={() => void choose(true)}
					>
						Show companion
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
