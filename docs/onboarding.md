# Contributor Onboarding

## Quick start

- [ ] Read the repository [contribution guide](../CONTRIBUTING.md) and
  [Code of Conduct](../CODE_OF_CONDUCT.md).
- [ ] Choose an unassigned issue with clear acceptance criteria. Check its
  `complexity:` label and make sure the work fits that scope.
- [ ] Comment `/attempt #<issue-number>` on the issue and wait for a maintainer
  to assign it before starting.
- [ ] Create a feature branch from `main`, using `feat/<short-description>` or
  `fix/<short-description>` (do not put the issue number in the branch name).
- [ ] Make the smallest change that satisfies the acceptance criteria and run
  the checks for the affected stack.
- [ ] Push your branch and open a pull request against `main`. Complete the
  repository [pull request template](../.github/PULL_REQUEST_TEMPLATE.md) and
  include `Closes #<issue-number>` in the Related Issues section.
- [ ] Keep the PR ready for review: wait for applicable CI gates, respond to
  reviewer feedback, and make any requested follow-up changes.

## From issue to branch

Before claiming work, confirm that the issue is not already assigned, read the
full discussion, and check every acceptance criterion. Issues carrying a
`complexity:` label have an expected scope and effort; ask a maintainer if the
issue is unclear or appears larger than its label suggests.

After you have been assigned the issue, fork this repository and clone your
fork. Keep the upstream repository as a separate remote if you want to update
your local `main` from it:

```bash
git remote add upstream https://github.com/Elite-Work/EliteWork.git
git fetch upstream
git switch -c feat/short-description upstream/main
```

Use `fix/short-description` for a bug fix. Branch names follow the prefixes in
the [contribution guide](../CONTRIBUTING.md); do not add issue numbers.

## Develop and validate

Follow the setup instructions in the root [README](../README.md) for the stack
you are changing. Keep the change focused on the assigned issue. Add or update
tests for behavior changes, and run the narrowest relevant local checks before
opening your PR. The [branch protection policy](./branch-protection-policy.md)
lists required checks; CI runs stack-level gates only when their paths change.

If you are changing admin routes, first follow the
[admin route contribution guide](./admin-route-contribution-guide.md). For
security-sensitive work, use the reporting process in [`SECURITY.md`](../SECURITY.md)
instead of publishing vulnerability details in an issue or PR.

## Open a pull request

Push your branch to your fork, then open a PR from that branch into upstream
`main`. Use the repository's [PR template](../.github/PULL_REQUEST_TEMPLATE.md):
describe the change and its impact, link the issue with `Closes #<issue-number>`,
select the change type, and complete the applicable CI and checklist items.

Keep the PR reviewable and limited to the issue's acceptance criteria. If you
discover unrelated work, open a separate issue rather than silently expanding
the PR. Before requesting review, check that the diff contains no credentials
or unrelated generated files and that the applicable CI checks are green.

## Review and merge

GitHub routes reviewers using [CODEOWNERS](../.github/CODEOWNERS). The
[code ownership policy](./codeowners-policy.md) and
[branch protection policy](./branch-protection-policy.md) describe review
expectations. `main` requires at least one approval, Code Owner review, and
the applicable required status checks. Reply to review comments with what
changed (or why a change is not needed), push updates to the same branch, and
re-request review if GitHub dismisses a stale approval. Maintainers merge the
PR after review and required checks pass.

For questions about claiming an issue or its scope, ask on the issue or in a
project discussion before beginning work.
