/*
 * PROBE preview for the remediation round of PR #484: the repository's own
 * preview, unchanged.
 *
 * The design round's harness added a Toaster of its own "before the story tree"
 * because an unpositioned toast is drawn by the container at index 0. The repo's
 * preview already mounts `ThemedToastContainer` in its own decorator and reads
 * `parameters.toastDuration` (which the story sets to Infinity), so this round
 * uses it as it is: with two containers competing for index 0 the announcement
 * reached the lane exactly once and painted nothing, which is what the live probe
 * on the page reports.
 */
import repoPreview from "../.storybook/preview";

export default repoPreview;
