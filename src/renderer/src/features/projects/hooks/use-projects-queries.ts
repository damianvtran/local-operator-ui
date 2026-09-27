/**
 * The Projects tab's data layer: two queries and one mutation family over the
 * `projects.*` desktop ops.
 *
 * ONE KEY HIERARCHY, deliberately nested: the listing is `["desktop",
 * "projects"]` and a detail is `["desktop", "projects", key]`, so the prefix
 * invalidate every write already does covers BOTH documents with one call.
 * (`profile-hooks.ts` keeps its list and detail keys as siblings and pays two
 * invalidations for it; that split exists there because the two keys' readers
 * are unrelated pages, while a project write changes the row AND the detail of
 * the very thing the user is looking at.)
 *
 * `enabled` is an INPUT rather than a derivation, because the gate is the
 * page's: a read fired before the capability answer arrives would 404 against
 * an older backend and paint an error the user cannot act on, which is the
 * fail-closed rule the whole desktop plane follows.
 *
 * Freshness: writes invalidate, and the reads ride the app's global
 * `refetchOnWindowFocus` — the schedules page's docstring states the same
 * division for its listing. Deliberately NO interval: a project is
 * operator-and-agent metadata whose reads are cheap but not free, and the page
 * has a refresh control for the moment a change is known.
 *
 * THE PARAMETER TYPES ARE THE WIRE CONTRACT, not `string`: every enum
 * (`status`, `estimate_unit`) and bound here is the same type the request
 * schema validates against, so a call site cannot pass a value the op would
 * refuse — the refusal happens in the dialog's own validation, with copy,
 * rather than at request time.
 */

import { retryDesktopQuery } from "@shared/api/local-operator/backend-error";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
	DesktopProject,
	DesktopProjectDetail,
	DesktopProjectStatus,
	DesktopProjectView,
} from "../../../../../shared/desktop-control-contract";

/**
 * The keys, in one place so a writer and a reader cannot disagree about the
 * prefix a write has to drop.
 */
export const projectKeys = {
	list: ["desktop", "projects"] as const,
	detail: (key: string) => ["desktop", "projects", key] as const,
};

/** The listing, as the page's gate hands it `enabled`. */
export function useProjectsList(enabled: boolean) {
	return useQuery({
		queryKey: projectKeys.list,
		enabled,
		queryFn: () =>
			desktopResult<{ projects: DesktopProject[] }>({
				op: "projects.list",
			}).then((result) => result.projects),
		retry: retryDesktopQuery,
		staleTime: 10_000,
	});
}

/**
 * One project and its composed links.
 *
 * `key` is the route param (an id in this app's own links), but the route
 * accepts a name too — the backend resolves an id first, then a name
 * case-insensitively — so a URL hand-edited to a name keeps working rather
 * than becoming a 404 this app invented.
 */
export function useProjectDetail(key: string | undefined, enabled: boolean) {
	return useQuery({
		queryKey: projectKeys.detail(key ?? ""),
		enabled: enabled && Boolean(key),
		queryFn: () =>
			desktopResult<DesktopProjectDetail>({
				op: "projects.get",
				key: key ?? "",
			}),
		retry: retryDesktopQuery,
		staleTime: 10_000,
	});
}

/** One write's common tail: drop the list (and every detail beneath it). */
function useInvalidateProjects() {
	const queryClient = useQueryClient();
	return () => {
		void queryClient.invalidateQueries({ queryKey: projectKeys.list });
	};
}

/** `projects.create`'s body, typed to the request schema's own members. */
export type ProjectCreateFields = {
	name: string;
	description?: string;
	status?: DesktopProjectStatus;
	tags?: string[];
};

export function useCreateProject() {
	const invalidate = useInvalidateProjects();
	return useMutation({
		mutationFn: (input: ProjectCreateFields) =>
			desktopResult<DesktopProject>({
				op: "projects.create",
				name: input.name,
				...(input.description !== undefined
					? { description: input.description }
					: {}),
				...(input.status !== undefined ? { status: input.status } : {}),
				...(input.tags !== undefined ? { tags: input.tags } : {}),
			}),
		onSuccess: () => invalidate(),
	});
}

/**
 * `projects.update`'s editable fields; only the keys a caller INCLUDES travel,
 * which is the tri-state: omit leaves the field alone, `""` clears a date or
 * the progress snippet.
 */
export type ProjectEditFields = {
	name?: string;
	description?: string;
	status?: DesktopProjectStatus;
	progress?: string;
	tags?: string[];
	start_date?: string;
	target_date?: string;
	completed_at?: string;
	estimate?: number;
	estimate_unit?: "points" | "days";
};

export function useUpdateProject() {
	const invalidate = useInvalidateProjects();
	return useMutation({
		mutationFn: (input: { key: string; fields: ProjectEditFields }) =>
			desktopResult<DesktopProject>({
				op: "projects.update",
				key: input.key,
				fields: input.fields,
			}),
		onSuccess: () => invalidate(),
	});
}

/**
 * The delete, with the typed name the route requires.
 *
 * `confirmedName` is what the user typed in the confirm dialog — the route
 * compares it case-insensitively against the row it resolved, so a mismatch is
 * refused with the route's own sentence rather than being silently accepted by
 * a client that echoed the stored name instead of the typed one.
 */
export function useDeleteProject() {
	const invalidate = useInvalidateProjects();
	return useMutation({
		mutationFn: (input: { key: string; confirmedName: string }) =>
			desktopResult<{ deleted: boolean }>({
				op: "projects.delete",
				key: input.key,
				confirmed_name: input.confirmedName,
			}),
		onSuccess: () => invalidate(),
	});
}

export function useLinkProjectSession() {
	const invalidate = useInvalidateProjects();
	return useMutation({
		mutationFn: (input: { key: string; sessionId: string }) =>
			desktopResult<DesktopProject>({
				op: "projects.link",
				key: input.key,
				sessionId: input.sessionId,
			}),
		onSuccess: () => invalidate(),
	});
}

export function useUnlinkProjectSession() {
	const invalidate = useInvalidateProjects();
	return useMutation({
		mutationFn: (input: { key: string; sessionId: string }) =>
			desktopResult<DesktopProject>({
				op: "projects.unlink",
				key: input.key,
				sessionId: input.sessionId,
			}),
		onSuccess: () => invalidate(),
	});
}

/**
 * The milestone op: add-or-update by name, and the completion toggle.
 *
 * `completed: true` stamps today and `completed: false` clears the stamp
 * (omitting it leaves it alone), and `targetDate: ""` clears the date — the
 * backend's rule, mirrored here rather than re-decided.
 */
export function useSetProjectMilestone() {
	const invalidate = useInvalidateProjects();
	return useMutation({
		mutationFn: (input: {
			key: string;
			name: string;
			targetDate?: string;
			completed?: boolean;
		}) =>
			desktopResult<DesktopProjectView>({
				op: "projects.milestone",
				key: input.key,
				name: input.name,
				...(input.targetDate !== undefined
					? { targetDate: input.targetDate }
					: {}),
				...(input.completed !== undefined
					? { completed: input.completed }
					: {}),
			}),
		onSuccess: () => invalidate(),
	});
}

export function useRemoveProjectMilestone() {
	const invalidate = useInvalidateProjects();
	return useMutation({
		mutationFn: (input: { key: string; name: string }) =>
			desktopResult<DesktopProjectView>({
				op: "projects.milestone.remove",
				key: input.key,
				name: input.name,
			}),
		onSuccess: () => invalidate(),
	});
}
