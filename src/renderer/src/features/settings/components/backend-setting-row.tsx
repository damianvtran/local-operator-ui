/**
 * One typed editor for one backend registry setting.
 *
 * Kind drives the control: enums are labelled selects, numbers are numeric
 * inputs with declared bounds, lists are one-line-per-member text, booleans
 * are switches, and the failover cascade edits whole chains as line-separated
 * `provider/model (effort)` hops. No kind ever falls back to a raw JSON blob:
 * the registry knows the shape of every key, and a JSON textarea would let a
 * typed boundary silently accept an invalid one.
 *
 * Nothing saves on blur. A dirty draft survives a failed save with an inline
 * Retry, because an editor that discards the user's edit on a network error
 * teaches the user to copy values into a notes app first.
 */

import type { BackendSetting } from "@shared/api/local-operator/desktop-api";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	Alert,
	Button,
	Input,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Switch,
	Textarea,
} from "@shared/components/ui";
import { RotateCcw, Undo2 } from "lucide-react";
import type { FC, ReactNode } from "react";
import { useState } from "react";
import type { DesktopRequest } from "../../../../../shared/desktop-contract";

const CASCADE_SENTINEL = "__cascade__";

type DraftState = {
	/** Serialized current draft, compared against the server value for dirty. */
	value: string;
	/** Cascade edits keep the base chains so a merge never flattens a
	 * concurrent terminal edit or stored effort metadata. */
	cascadeBase: Record<string, string[]> | null;
	saving: boolean;
	error: string | null;
};

function serialize(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

function isDirty(setting: BackendSetting, draft: string): boolean {
	if (setting.kind === "cascade") return draft !== CASCADE_SENTINEL;
	if (setting.kind === "list")
		return draft !== (setting.value as string[] | null)?.join("\n");
	return draft !== serialize(setting.value);
}

export const BackendSettingRow: FC<{
	setting: BackendSetting;
	scope: string;
	/** Called after a successful write so the parent can refetch the
	 * authoritative registry projection. */
	onSaved?: () => unknown;
	/** When true, an expandable wrapper renders the control; the row header
	 * alone shows the value. Used for the cascade editor. */
	children?: (control: ReactNode) => ReactNode;
}> = ({ setting, scope, onSaved, children }) => {
	const [draft, setDraft] = useState<DraftState>({
		value:
			setting.kind === "list"
				? ((setting.value as string[] | null) ?? []).join("\n")
				: setting.kind === "cascade"
					? CASCADE_SENTINEL
					: serialize(setting.value),
		cascadeBase: null,
		saving: false,
		error: null,
	});

	const dirty = isDirty(setting, draft.value) || draft.cascadeBase !== null;

	const submit = async () => {
		// JSON is the wire type. `undefined` is the one value the vocabulary
		// refuses, so every branch below assigns a JSON value.
		let value: unknown = null;
		let base: Record<string, string[]> | undefined;
		const buildRequest = (): DesktopRequest => ({
			op: "settings.edit",
			key: setting.key,
			// The switch resolves every kind to a JSON value; the vocabulary's
			// refined-unknown arm accepts any of them. The cast is at the
			// boundary, not smuggled through the branches.
			value: value as never,
			...(base ? { base } : {}),
		});
		switch (setting.kind) {
			case "bool":
				value = draft.value === "true";
				break;
			case "int":
				value = Number.parseInt(draft.value, 10);
				if (Number.isNaN(value)) {
					setDraft((current) => ({
						...current,
						error: "Enter a whole number.",
					}));
					return;
				}
				break;
			case "float": {
				const parsed = Number.parseFloat(draft.value);
				if (!Number.isFinite(parsed)) {
					setDraft((current) => ({
						...current,
						error: "Enter a finite number.",
					}));
					return;
				}
				value = parsed;
				break;
			}
			case "enum": {
				// Preserve the choice's declared type identity: "1" the string and
				// 1 the integer are different enum values on the backend.
				const choice = setting.choices.find(
					(candidate) => serialize(candidate.value) === draft.value,
				);
				value = choice ? choice.value : draft.value;
				break;
			}
			case "list":
				value = draft.value
					.split("\n")
					.map((line) => line.trim())
					.filter(Boolean);
				break;
			case "cascade": {
				if (!draft.cascadeBase) return;
				const chains: Record<string, string[]> = {};
				for (const [key, entry] of Object.entries(draft.cascadeBase)) {
					chains[key] = entry;
				}
				value = chains;
				base = (setting.value ?? undefined) as
					| Record<string, string[]>
					| undefined;
				break;
			}
			default:
				if (setting.empty_unsets && draft.value.trim() === "") {
					value = null;
				} else {
					value = draft.value;
				}
		}

		setDraft((current) => ({ ...current, saving: true, error: null }));
		try {
			await desktopResult(buildRequest());
			// The refetch below is the authority; a fresh server value replaces
			// this row's draft through the `key` on the row's wrapper, so no local
			// success patch is needed here.
			setDraft((current) => ({
				...current,
				saving: false,
				cascadeBase: null,
			}));
			await onSaved?.();
		} catch (error) {
			// The draft stays: a failed save must not discard the edit.
			setDraft((current) => ({
				...current,
				saving: false,
				error:
					error instanceof Error
						? error.message
						: "The setting could not be saved.",
			}));
		}
	};

	const reset = async () => {
		setDraft((current) => ({ ...current, saving: true, error: null }));
		try {
			await desktopResult({ op: "settings.reset", key: setting.key });
			setDraft((current) => ({ ...current, saving: false }));
			await onSaved?.();
		} catch (error) {
			setDraft((current) => ({
				...current,
				saving: false,
				error:
					error instanceof Error
						? error.message
						: "The setting could not be reset.",
			}));
		}
	};

	if (setting.redacted) {
		return (
			<Alert variant="neutral" className="w-full">
				This value carries inline credentials or query parameters and cannot be
				edited here. Secrets belong in the credential manager.
			</Alert>
		);
	}

	if (setting.kind === "readonly") {
		return (
			<p className="text-body-sm text-ink-muted">
				{serialize(setting.value) || "Not set"}
			</p>
		);
	}

	let control: ReactNode;
	switch (setting.kind) {
		case "bool":
			control = (
				<Switch
					checked={draft.value === "true"}
					onCheckedChange={(checked) =>
						setDraft((current) => ({
							...current,
							value: checked ? "true" : "false",
						}))
					}
					aria-label={setting.label}
				/>
			);
			break;
		case "enum":
			control = (
				<Select
					value={draft.value}
					onValueChange={(value) =>
						setDraft((current) => ({ ...current, value }))
					}
				>
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
			break;
		case "int":
		case "float":
			control = (
				<Input
					type="number"
					value={draft.value}
					min={setting.minimum ?? undefined}
					max={setting.maximum ?? undefined}
					step={setting.kind === "int" ? 1 : "any"}
					onChange={(event) =>
						setDraft((current) => ({ ...current, value: event.target.value }))
					}
					aria-label={setting.label}
				/>
			);
			break;
		case "list":
			control = (
				<Textarea
					value={draft.value}
					rows={Math.min(6, setting.members.length + 2)}
					onChange={(event) =>
						setDraft((current) => ({ ...current, value: event.target.value }))
					}
					aria-label={setting.label}
					className="font-mono text-body-sm"
				/>
			);
			break;
		case "cascade": {
			const chains =
				draft.cascadeBase ??
				(setting.value as Record<string, string[]> | null) ??
				{};
			control = (
				<div className="flex flex-col gap-3">
					{Object.entries(chains).map(([key, hops]) => (
						<div key={key} className="flex flex-col gap-1">
							<span className="font-mono text-meta text-ink-dim">{key}</span>
							<Textarea
								value={hops.join("\n")}
								rows={Math.max(2, hops.length + 1)}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										cascadeBase: {
											...(current.cascadeBase ?? chains),
											[key]: event.target.value
												.split("\n")
												.map((line) => line.trim())
												.filter(Boolean),
										},
									}))
								}
								aria-label={`${setting.label}: ${key}`}
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
			break;
		}
		default:
			control = (
				<Input
					value={draft.value}
					onChange={(event) =>
						setDraft((current) => ({ ...current, value: event.target.value }))
					}
					aria-label={setting.label}
				/>
			);
	}

	const body = (
		<div className="flex flex-col gap-2" data-setting-key={setting.key}>
			<div className="flex items-center justify-between gap-3">
				<div className="flex min-w-0 flex-col gap-0.5">
					<span className="text-body-sm text-ink">{setting.label}</span>
					{setting.help && (
						<span className="text-meta text-ink-dim">{setting.help}</span>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{!setting.is_default && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => void reset()}
							disabled={draft.saving}
						>
							<Undo2 aria-hidden="true" />
							Use default
						</Button>
					)}
					{dirty && (
						<Button
							variant="primary"
							size="sm"
							onClick={() => void submit()}
							disabled={draft.saving}
						>
							{draft.saving ? "Saving" : "Save"}
						</Button>
					)}
				</div>
			</div>
			{control}
			{setting.kind !== "bool" && !setting.is_default && (
				<p className="text-meta text-ink-dim">
					Changed from the default{scope ? `; ${scope}` : ""}
				</p>
			)}
			{draft.error && (
				<Alert variant="danger">
					<div className="flex items-center justify-between gap-3">
						<span>{draft.error}</span>
						{/* Retry re-submits the RETAINED draft; it never re-reads the
						    field, so what you retry is what you typed. */}
						<Button
							variant="secondary"
							size="sm"
							onClick={() => void submit()}
							disabled={draft.saving}
						>
							<RotateCcw aria-hidden="true" />
							Retry
						</Button>
					</div>
				</Alert>
			)}
		</div>
	);

	return children ? children(body) : body;
};
