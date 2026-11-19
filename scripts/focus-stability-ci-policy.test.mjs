import assert from "node:assert/strict";
import { test } from "node:test";
import { focusProofWindowMode } from "./focus-stability-ci-policy.mjs";

test("default focus probe remains headless even on CI", () => {
	assert.equal(focusProofWindowMode([], {}), "headless");
});

test("native first-responder probing is confined to explicitly armed macOS CI", () => {
	const env = {
		GITHUB_ACTIONS: "true",
		RUNNER_OS: "macOS",
		CI: "true",
		LOCAL_OPERATOR_FOCUS_PROOF_CI: "1",
	};
	assert.equal(focusProofWindowMode(["--ci-native-owner"], env), "normal");
	for (const key of Object.keys(env)) {
		assert.throws(
			() =>
				focusProofWindowMode(["--ci-native-owner"], {
					...env,
					[key]: undefined,
				}),
			/disposable macOS CI/,
		);
	}
	assert.throws(
		() =>
			focusProofWindowMode(["--ci-native-owner"], {
				...env,
				RUNNER_OS: "Linux",
			}),
		/disposable macOS CI/,
	);
});
