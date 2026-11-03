// CI BISECT CONTROL - not a real test. Exists only on the throwaway branch
// ci-control/oom-cat (draft PR "ci(control): cat bisect for #1603"), which must
// never be merged. Two registered placeholder paths shift the sorted-modulo shard
// assignment so scripts/update-robustness.test.mjs lands in Desktop Tests shard
// (3/4) at index 162, exactly where PR #1603 puts it, to learn which slice of
// #1603's i18n content trips the heap abort there.
import test from "node:test";

test("control placeholder", () => {});
