# Sharded-main integration after Desktop OOM

Previous PR head d88f59c0e9. Integrated main 94779f0d24 cleanly, including the
reviewed three-way Desktop CI partition and stable required aggregate. Same
inventory, unchanged memory/lane/concurrency guards. No budget raise, guard
suppression, old-workflow rerun, or local full suite. This adds capacity; it does
NOT establish the cause of the prior 10.2 GB resource spike or prove it fixed.
Fresh CI shard results are required.

Eight bounded one-worker/one-file scopes passed, 148 tests total. Each invoked
`node scripts/run-desktop-tests.mjs --test-concurrency=1 <file>` with a 2 GiB
Node heap and 7991 MiB process-group guard (the prior CI approximately7.8GiB
ceiling). External PID-tree RSS sampling every400ms recorded file/process
attribution; maximum sampled slice RSS536MiB. Very short samples miss true
peaks; see bounded-slices.json for counts/timings and honest limitation.

Optimistic model, message list, all catalogues/ledger bytes are unchanged from
round4-clean d88f59c0e9. No translation union or re-audit needed.

Main #1286 changes route root h-full to flex-1/panel-flush. Browser geometry
caught a STORY-ONLY parent mismatch: the existing decorator had h-dvh but no
flex layout, so the candidate root was551.48px instead of720px high. Added
`flex flex-col` to that decorator, matching the production shell. No application
layout rule altered. Saved browser frames story-wrapper-before/after demonstrate
551.48→720px at1280px width/y0. failed-retry.png confirms failure/Retry after this
change. These are a narrow integration regression check, not a new all-theme,
live-backend or production-container QA claim. Prior feature evidence retained.

One capped Storybook6171; exact owned PIDs17054/17058/17075/17095/17150 reaped
and verified absent; browser closed and log removed. Disk after cleanup9.3GiB.
