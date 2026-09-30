import { useCallback, useEffect, useRef, useState } from "react";
import type {
	CompanionSettings,
	CompanionSettingsChange,
} from "../../../../shared/companion-settings";

export function useCompanionSettings() {
	const [settings, setSettings] = useState<CompanionSettings | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const readId = useRef(0);
	const api = window.api?.companionSettings;
	const load = useCallback(async () => {
		const id = ++readId.current;
		setLoading(true);
		setError(null);
		try {
			const next = await api?.get();
			if (id === readId.current && next) setSettings(next);
		} catch {
			if (id === readId.current)
				setError("Companion settings could not be loaded.");
		} finally {
			if (id === readId.current) setLoading(false);
		}
	}, [api]);
	useEffect(() => {
		const unsubscribe = api?.onChanged((next) => {
			readId.current++;
			setSettings(next);
			setLoading(false);
			setError(null);
		});
		void load();
		return () => {
			readId.current++;
			unsubscribe?.();
		};
	}, [api, load]);
	const update = useCallback(
		async (change: CompanionSettingsChange) => {
			if (!api) throw new Error("Companions are available in the desktop app.");
			const next = await api.update(change);
			setSettings(next);
			return next;
		},
		[api],
	);
	return {
		settings,
		error,
		loading,
		update,
		available: !!api,
		retry: () => void load(),
		importCharacter: async () => {
			if (!api) return;
			setSettings(await api.import());
		},
	};
}
