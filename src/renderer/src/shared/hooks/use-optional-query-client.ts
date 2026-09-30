import { QueryClient, QueryClientContext } from "@tanstack/react-query";
import { useContext, useMemo } from "react";

/**
 * A QueryClient for a hook that must be callable in a document which may not
 * have one.
 *
 * WHY THIS EXISTS. The shared composer mounts in the mini view's document,
 * which carries no `QueryClientProvider` (the bootstrap condition of the
 * composer lift: a consumer document without a QueryClient must mount). But
 * `useQuery` cannot be called at all without a client - it throws "No
 * QueryClient set" from `useQueryClient()` before any option is read - and the
 * composer's subtree reaches react-query through hooks it cannot skip
 * (`useSlashCompletion`'s command list, `useAtResolution` and
 * `useRadientSessionIssue` through `useDesktopCapabilities`, the Radient
 * status read). Those hooks therefore need a client OBJECT to hand the call,
 * and this hook supplies one either way: the provider's, or a private inert
 * instance.
 *
 * THE FALLBACK IS DELIBERATELY INERT AND LOCAL. It is an instance no provider
 * knows about, so a query gated off by `provided` can never fetch, cache or
 * broadcast anywhere; and it is per-component rather than a module singleton so
 * it cannot accumulate state across surfaces. Call sites MUST gate with
 * `enabled: provided` (or `provided && <their own gate>`) - the pair is
 * returned together precisely so that gate cannot be forgotten silently: an
 * ungated query on the fallback would run its queryFn against a client nobody
 * reads. `defaultOptions.queries.enabled: false` is the backstop if one is.
 */
export const useOptionalQueryClient = (): {
	client: QueryClient;
	provided: boolean;
} => {
	const provided = useContext(QueryClientContext) ?? null;
	const fallback = useMemo(
		() =>
			new QueryClient({
				defaultOptions: { queries: { enabled: false, retry: false } },
			}),
		[],
	);
	return useMemo(
		() =>
			provided
				? { client: provided, provided: true }
				: { client: fallback, provided: false },
		[provided, fallback],
	);
};
