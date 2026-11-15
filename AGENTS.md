# Agent Guidelines

## Repository guidance

- Consult [docs/files.md](docs/files.md) for the repository layout.
- Follow [CONTRIBUTING.md](CONTRIBUTING.md) for commit and branch conventions.

## Documentation and tests

- Ask before creating, modifying, moving, or deleting files under `docs/`.
- Ask before adding, modifying, moving, or deleting tests, test infrastructure, or test execution configuration, regardless of file location. Running existing tests does not require approval.
- An explicit request to change documentation or tests authorizes that specific change. A general feature or bug-fix request does not implicitly authorize documentation or test changes. Ask before expanding the approved scope.

## Project conventions

- Keep UI text in English.
- Do not commit credentials, `.env.local`, or generated test reports.
- Prefer concrete names that describe behavior. Split files or introduce abstractions only when doing so makes the code easier to understand, not merely to organize a small amount of code.

## Avoid defensive overengineering

- Validate untrusted or unknown data once at the boundary that owns it. Pass validated values inward; do not repeat checks already guaranteed by a schema, constructor, or internal type.
- Add guards, retries, fallbacks, and compatibility layers only for concrete failure modes supported by the contract, observed behavior, or tests. Do not broaden the task for hypothetical edge cases or add "just in case" branches.
- Catch errors where recovery, cleanup, or useful context is possible; otherwise let them propagate. Do not hide broken invariants with broad catches, silent failures, empty results, or arbitrary defaults.
- Keep local logic inline unless a helper provides real reuse, isolates a complex boundary, or clearly improves readability. Avoid single-use wrappers and configurable abstractions for one case.
- Preserve required boundary validation and security/correctness checks. Simplify redundant defenses rather than removing safeguards that enforce a real requirement.
