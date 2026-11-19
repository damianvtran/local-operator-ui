# PR #1987 round-1 remediation frames (not for merge)

Storybook `Providers/Amazon Bedrock` on feat/bedrock-provider (component code af680626f7, stories edd733e7c6), dark theme, 1280x900, headless Chrome (--use-mock-keychain) over CDP.
Before = round-1 frames at fb47f2a831 in branch `evidence/bedrock-provider-ui`, `docs/pr-evidence/bedrock-provider-ui/` (same stories). `-es` = Spanish locale.
Tab strip measured in every frame below: 563 px in a 672 px column, scrollWidth = clientWidth (no overflow), en and es.

| State | Before | After |
|---|---|---|
| D1 SSO tab: vocabulary, order, method line; D3 Region help "from the profile" | bedrock-provider-ui/03-sso-signed-in.png | 03-sso-signed-in.png, 03-sso-signed-in-es.png |
| D1 AWS profile tab lists non-SSO profiles only, kind badges | bedrock-provider-ui/04-profile-picker.png | 04-profile-picker.png |
| D4 expired SSO: no "Nothing was saved." on first view | bedrock-provider-ui/05-sso-expired.png | 05-sso-expired.png |
| Q2 never-signed-in aws login profile | QA r1 frame 13 (evidence/1987-qa-r1) | 15-sso-never-signed-in.png |
| R2 per-profile SSO: run for acme-dev-sso, acme-prod-sso picked | none | 16-sso-per-profile.png |
| D2 failed Check with inline reason | bedrock-provider-ui/03-sso-signed-in.png (row, no reason) | 17-check-failed.png, 17-check-failed-es.png |
| R4 Check deadline = Not verified, neutral | none | 18-check-unverified.png |
| R3 inline validation, access key ID + Region | bedrock-provider-ui/08-access-key-form.png | 19-invalid-input.png, 19-invalid-input-es.png |
| Retained states, new labels | bedrock-provider-ui/02,06,07,08,09 | 02, 06, 07, 08, 09 |
