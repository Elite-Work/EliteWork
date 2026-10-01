# Code Ownership and Review Routing Policy

> Closes #96

This policy defines code ownership and automated review request routing for the Amana monorepo, maintaining review quality and minimizing review-assignment overhead across subprojects.

## 1. Overview & Location

Code ownership is enforced via [`.github/CODEOWNERS`](../.github/CODEOWNERS). GitHub automatically assigns reviewers from this configuration whenever a pull request is opened or updated with changes touching specific file paths.

## 2. Monorepo Subproject Routing

Review routing is segmented by the monorepo's architectural boundaries:

| Subproject | Directory | Primary Stack | Code Owners |
|---|---|---|---|
| **Global Fallback** | `*` | Repository-wide | `@FrankHood1`, `@UFObject247` |
| **Frontend** | `/frontend/` | Next.js, React, Tailwind CSS, Jest, Playwright | `@FrankHood1`, `@UFObject247` |
| **Backend** | `/backend/` | Express, Prisma ORM, PostgreSQL, Redis | `@FrankHood1`, `@UFObject247` |
| **Contracts** | `/contracts/` | Soroban smart contracts, Rust, WASM, cargo-audit | `@UFObject247`, `@FrankHood1` |
| **Mobile** | `/mobile/` | React Native, Expo, Detox | `@FrankHood1`, `@UFObject247` |
| **Infrastructure** | `/infra/`, `docker-compose.yml`, `.env.staging.example` | Docker, Grafana, Prometheus, K8s manifests | `@FrankHood1`, `@UFObject247` |
| **CI/CD & Workflows** | `/.github/`, `/scripts/` | GitHub Actions, shell scripts, audit tooling | `@FrankHood1`, `@UFObject247` |
| **Documentation** | `/docs/`, `/*.md` | Architecture Decision Records, runbooks, policies | `@FrankHood1`, `@UFObject247` |

## 3. Relationship to Branch Protection and Required CI Gates

1. **Review Requirement**: Per [Branch Protection Policy](./branch-protection-policy.md), PRs targeted at protected branches (`main`, `develop`) require at least one approving review before merging.
2. **CI Gates Before Review**: Reviewers expect all applicable [Required PR CI Gates](../README.md#-required-pr-ci-gates) (`Frontend Required Gate`, `Backend Required Gate`, `Contracts Required Gate`, `Mobile Required Gate`) to pass in CI before an approval is issued.
3. **Cross-Stack Changes**: PRs touching multiple subprojects (e.g. backend API and smart contracts) will route review requests to the owners of each affected subproject.

## 4. Maintenance & Updates

Any additions of new subprojects, toolchains, or changes in team ownership must update `.github/CODEOWNERS` and this policy in the same pull request.
