import type { MutateOptions, UseMutationResult } from "@tanstack/react-query";

export type CapturedBridgeMutation<Input, Target> = {
	input: Input;
	target: Target;
};

/** React Query may replace a pending mutation's options when its observer rerenders.
 * A closure over the selected conversation is therefore NOT a retry snapshot.
 * Put author/tenant/conversation and their lifetime fence in variables at the
 * user's invocation, then translate observer callbacks back to the public input.
 * This adapter never recaptures the target on an automatic retry. */
export function bindBridgeMutation<Data, Input, Target>(
	mutation: UseMutationResult<
		Data,
		Error,
		CapturedBridgeMutation<Input, Target>
	>,
	capture: () => Target,
): UseMutationResult<Data, Error, Input> {
	const callbacks = (
		options?: MutateOptions<Data, Error, Input>,
	): MutateOptions<Data, Error, CapturedBridgeMutation<Input, Target>> => ({
		onSuccess: (data, variables, context) =>
			options?.onSuccess?.(data, variables.input, context),
		onError: (error, variables, context) =>
			options?.onError?.(error, variables.input, context),
		onSettled: (data, error, variables, context) =>
			options?.onSettled?.(data, error, variables.input, context),
	});
	// Preserve React Query's discriminated result state, changing only its variable
	// projection and invocation adapters. A success still contains its original input.
	return {
		...mutation,
		variables: mutation.variables?.input,
		mutate: (input, options) =>
			mutation.mutate({ input, target: capture() }, callbacks(options)),
		mutateAsync: (input, options) =>
			mutation.mutateAsync({ input, target: capture() }, callbacks(options)),
	} as UseMutationResult<Data, Error, Input>;
}
