# Team Bridge senders signed "Member" (PR #1296)

Rendered stills for `fix(team-bridge): never render the placeholder "Member"
as a sender name` (8f0edbd647).

## What these frames are

One pair per story, captured in the same session from the same Storybook dev
server (`storybook dev`, not a static build), at the same viewport. `before-`
is the branch head `f1520f143e` source with only the new stories added (the
old view ignores the `selfName`/`directories` props, exactly as production
does); `after-` is the fix.

Every message in the fixture carries the stored label `"Member"`, which is
what agent-server wrote for creators and self-joins before agent-server #166.
The thread has three senders:

- the reader (`acct_self`): absent from the roster, as a self-excluding
  directory returns it, so the name comes from the signed-in identity;
- Ben Tran: in the organization directory;
- a member who left (`acct_departed`): in no directory.

| Story id | What the pair shows |
| --- | --- |
| `team-bridge-page--legacy-member-labels` | single organization: before, every sender reads "Member" with an "M" avatar; after, "Damian Tran", "Ben Tran" and an italic *Unknown person* with a neutral person glyph |
| `team-bridge-page--legacy-member-labels-all-organizations` | the merged "All organizations" view: names now resolve from the conversation's own organization roster |
