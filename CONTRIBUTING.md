# Contributing to Amana

First off, thank you for considering a contribution. This project participates in
[Drips Wave](https://docs.drips.network/wave), a recurring bounty cycle where
maintainers tag issues with point values and contributors earn points for
merged pull requests ("Fix, Merge, and Earn").

This guide explains how to find an issue, understand its sizing, pick it up,
and get your work merged.

## How issue sizing works

Every issue opened for a Wave is sized with a `complexity:` label before it is
eligible for contribution. The label maps directly to the Drips Wave points
system (see [Points & Rewards](https://docs.drips.network/wave)):

| Label                 | Points | Typical scope                                                                 |
| --------------------- | ------ | ----------------------------------------------------------------------------- |
| `complexity: trivial` | 100    | Docs fixes, copy tweaks, single-file lint/test changes, config one-liners      |
| `complexity: medium`  | 150    | A self-contained feature or bug fix touching one stack (`frontend/`, `backend/`, or `contracts/`), with tests |
| `complexity: high`    | 200    | Multi-stack work, security-sensitive changes, cross-cutting refactors, or issues requiring design decisions |

The point values are fixed by the Wave program — they are not negotiated per
issue. When maintainers size an issue they weigh estimated effort, blast
radius, and risk: a change to money math or escrow logic is `high` even if it
is only a few lines.

## Before you pick up an issue

1. **Check the labels.** The `complexity:` label tells you the expected scope
   and the points you can earn. If an issue has no `complexity:` label yet, it
   is not yet ready to be claimed — ask a maintainer or wait.
2. **Check for an assignee.** Issues are first-come, first-served. Comment
   "/attempt #<issue-number>" (or simply "I'd like to work on this") to claim
   an unassigned issue, then wait for a maintainer to assign it to you.
3. **Read the acceptance criteria.** An issue is only worth its full point
   value when all acceptance criteria are met, including the tests the issue
   asks for.
4. **Reproduce bugs before writing the fix.** For bug reports, include a
   failing test that reproduces the reported behavior in your PR.

## Workflow

1. Fork the repository and create a feature branch from `main`. Branch names
   follow Conventional Commits prefixes, e.g. `feat/<short-description>` or
   `fix/<short-description>`. Do not include issue numbers in branch names.
2. Implement the change, following the existing code patterns and the stack
   guides under `docs/` (e.g.
   [`docs/admin-route-contribution-guide.md`](docs/admin-route-contribution-guide.md)).
3. Add or update tests for everything you implement. CI runs the stack gates
   described in [`docs/branch-protection-policy.md`](docs/branch-protection-policy.md):
   frontend (`lint`, `build`, tests), backend (`build`, tests), and contracts
   (`cargo test`).
4. Commit with a
   [Conventional Commit](https://www.conventionalcommits.org/) message and
   reference the issue number, e.g.
   `docs: add contributing guide (#92)`.
5. Open a pull request against `main` whose description starts with
   `Closes #<issue-number>` and describes what changed, the files touched, and
   how to test it.

## Getting your PR merged

- Keep PRs scoped to a single issue. If you find unrelated breakage, open a
  separate issue instead of fixing it silently.
- Ensure all required CI checks pass — reviews will wait for green builds.
- Respond to review feedback promptly; approvals are dismissed when new
  commits are pushed, so coordinate with your reviewer before force-pushing.
- Once merged and verified, your points are credited automatically on the
  [Drips Wave leaderboard](https://docs.drips.network/wave).

## Questions

Open a discussion or comment on the relevant issue. For security-sensitive
topics, follow [`SECURITY.md`](SECURITY.md) instead of filing a public issue.
