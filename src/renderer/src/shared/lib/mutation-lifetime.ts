import { useLayoutEffect, useRef } from "react";

/** Admission for asynchronous preparation, not cancellation of a dispatched
 * write. A source change/unmount revokes the generation synchronously during
 * commit, so late encode/byte promises cannot start a new cloud mutation. */
type MutationTicket = { generation: number; source: unknown };
export function createMutationLifetime() {
	let generation = 0;
	let active = false;
	let currentSource: unknown;
	return {
		activate(source?: unknown) {
			generation++;
			active = true;
			currentSource = source;
		},
		revoke() {
			generation++;
			active = false;
		},
		capture: (): MutationTicket => ({ generation, source: currentSource }),
		isCurrent: (ticket: MutationTicket) =>
			active &&
			generation === ticket.generation &&
			Object.is(currentSource, ticket.source),
	};
}
export type MutationLifetime = ReturnType<typeof createMutationLifetime>;

export function useMutationLifetime(source: unknown): MutationLifetime {
	const reference = useRef<MutationLifetime | null>(null);
	if (!reference.current) reference.current = createMutationLifetime();
	const lifetime = reference.current;
	useLayoutEffect(() => {
		lifetime.activate(source);
		return () => lifetime.revoke();
	}, [lifetime, source]);
	return lifetime;
}

/** Every awaited preparation must finish before the final lifetime check.
 * The check and invocation are synchronous neighbors: checking only after
 * dispatch would suppress a label while still writing the abandoned photo. */
export async function dispatchWhileCurrent<T>(
	lifetime: MutationLifetime,
	ticket: MutationTicket,
	prepare: () => Promise<T>,
	dispatch: (value: T) => unknown,
): Promise<boolean> {
	if (!lifetime.isCurrent(ticket)) return false;
	const value = await prepare();
	if (!lifetime.isCurrent(ticket)) return false;
	await dispatch(value);
	return true;
}
