# PR #1446 design review round 1: frames

Head `1decc306`. Static Storybook built from ONLY `team-bridge-invitations.stories.tsx` plus the review scratch stories
in `harness/` (a scoped `-c` config copy; the full build OOMs). Served on 127.0.0.1 and captured with the harness
browser tool at 2560x1440 @2x. Themes: `localOperatorDark` and `localOperatorLight`; `05` uses `chrome:mac32`.

- 01–05: rail without and with invites, view opened from the rail, light rail, mac32 lane.
- 10–19: view states (empty, loading, error, one, several, accepting, outcomes, declined, long-names-at-420px, read-only), dark and light.
- 20–26: the REAL `TeamBridgePage` container behind a desktop stub (`LiveAccept` in harness/): idle, accept pending (held),
  pending +0.5 s, released, settled, a transport refusal, and a coded `agent_not_permitted` refusal. A rAF recorder logged every
  card's rect and the rail entry's rect on every frame.
