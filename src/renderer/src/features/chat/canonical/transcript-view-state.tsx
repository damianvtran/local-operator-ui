import {
	type SetStateAction,
	createContext,
	useCallback,
	useContext,
	useState,
	useSyncExternalStore,
} from "react";

/** Session-owned view values outlive DOM slots; records, not component mounts, own them. */
export class TranscriptViewState {
	private values = new Map<string, boolean>();
	private listeners = new Map<string, Set<() => void>>();
	read(key: string): boolean {
		return this.values.get(key) ?? false;
	}
	write(key: string, value: boolean): void {
		if (this.read(key) === value) return;
		this.values.set(key, value);
		for (const listener of this.listeners.get(key) ?? []) listener();
	}
	subscribe(key: string, listener: () => void): () => void {
		let bucket = this.listeners.get(key);
		if (!bucket) {
			bucket = new Set();
			this.listeners.set(key, bucket);
		}
		bucket.add(listener);
		return () => {
			bucket.delete(listener);
			if (bucket.size === 0) this.listeners.delete(key);
		};
	}
	prune(ids: ReadonlySet<string>): void {
		for (const key of this.values.keys())
			if (!ids.has(key)) this.values.delete(key);
	}
}
export const TranscriptViewStateContext =
	createContext<TranscriptViewState | null>(null);

export function useTranscriptViewBoolean(
	key: string,
): [boolean, (value: SetStateAction<boolean>) => void] {
	const context = useContext(TranscriptViewStateContext);
	// Standalone story/row callers still have a component-owned store; only the
	// transcript provider promises persistence across virtualization unmounts.
	const [fallback] = useState(() => new TranscriptViewState());
	const store = context ?? fallback;
	const subscribe = useCallback(
		(listener: () => void) => store.subscribe(key, listener),
		[store, key],
	);
	const read = useCallback(() => store.read(key), [store, key]);
	const value = useSyncExternalStore(subscribe, read, read);
	const write = useCallback(
		(next: SetStateAction<boolean>) =>
			store.write(
				key,
				typeof next === "function" ? next(store.read(key)) : next,
			),
		[store, key],
	);
	return [value, write];
}
