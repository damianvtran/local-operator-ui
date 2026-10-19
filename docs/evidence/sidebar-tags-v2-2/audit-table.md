# Independent language audit receipts

All catalogues have 73 keys: 54 baseline values preserved, 19 additions. English SHA256 `2ceb3d8a5e4592916fce55ab7eeee5f4654f2d2394cbdb74be89aff2e73ab1be`.

| Locale | Instance | Actual model | Terminal verdict | Receipt SHA256 |
|---|---|---|---|---|
| es | `a7b8c9d0e1f2` | `anthropic/claude-sonnet-5-5` | clean | `7981bbb2c0d16ba539716a4339ffd70a11289df2abfe09300a4ecb44ad008635` |
| fr | `b8c9d0e1f2a3` | `anthropic/claude-sonnet-5-5` | clean | `e2869fe6b3ec64d013a64d668188a86488976bbdfa26c5102fde8681aeaa8c63` |
| hi | `c9d0e1f2a3b4` | `anthropic/claude-sonnet-5-5` | clean | `9be97acc8d06740f55500f2218d3648b121f1cf4fdc332a5f9e8227ecd3eed5e` |
| ru | `d0e1f2a3b4c5` | `openai/gpt-6.1-sol` | clean | `375e25dce4ade7d9399400136bee1f698acae517b84f1c4233992603db13c924` |
| vi | `e1f2a3b4c5d6` | `anthropic/claude-sonnet-5-5` | clean | `9e8d44ad76976802465a0fef785d959220d9edf842d7568c37eabd9e48c4dd35` |
| zh-CN | `f6a1b2c3d4e5` | `openai/gpt-6.1-sol` | clean-with-3-nits (accepted) | `3833454adfc4b95a511a9bfcdea6cadca35c30ebf1e52ad08b041c6e5ef7b827` |
| ur | `f0a1b2c3d4e5` | `openai/gpt-6.1-sol` | clean (0 findings) | `b71e4560203cb59b7e17964d0ac1e1a9b97b9af73f731d31a0ef4705e1a6dc40` |

Accepted remediation: ES count-neutral selection status and million-count plural; FR million-count plural; HI exact-one status and oblique plural; RU primary-tag phrasing and baseline conversation terminology; VI baseline tag terminology and grouping grammar. ZH three nits accepted unchanged. Prior receipts are retained because terminal re-audits cite them and prove unchanged-message compatibility; they are not duplicate approvals. The ledger keeps historical baseline translator metadata mechanically and explicitly identifies the new delta author in notes.

Urdu was added to main during convergence:19 additional messages preserve54 baseline values. Independent machine audit covers all73 keys/ICU; actual fallback model openai/gpt-6.1-sol after anthropic quota exhaustion. Provenance header corrected by the same auditor before assembly; linguistic verdict/source bytes unchanged. No Urdu fluency or rendered-fit claim. Final ledger-check reports392 rows, updating the existing Urdu row and superseding its older audit, not adding a duplicate393rd row.
