# Contributing

## Before contributing

- See [README.md](README.md) for setup and [docs/files.md](docs/files.md) for the repository layout.
- Discuss substantial features or architectural changes in an issue first.
- Keep each pull request focused and explain the problem and the chosen approach.

## Commit messages

Use this format:

```text
<type>(<module>): <description>
```

| Type    | Purpose                                    | Example                                       |
| ------- | ------------------------------------------ | --------------------------------------------- |
| `feat`  | Add functionality                          | `feat(agent): support parallel tool calls`    |
| `fix`   | Fix incorrect behavior                     | `fix(storage): preserve interrupted messages` |
| `chore` | Refactoring, maintenance, or configuration | `chore(agent): simplify turn handling`        |
| `doc`   | Documentation changes                      | `doc(roadmap): update milestones`             |
| `test`  | Test changes                               | `test(tools): cover malformed arguments`      |

- Use `feat`, `fix`, or `chore` for changes to application code, `doc` for documentation-only changes, and `test` for test-only changes.
- Use a concrete lowercase module name, such as `agent`, `tools`, `storage`, `ui`, or `roadmap`.
- Write a short, specific description in English, starting with an imperative verb.
- Keep each commit focused on one purpose. Tests accompanying a feature or fix can belong to the same commit; choose the type according to its primary purpose.

## Branches

Use `main` as the main branch. For larger changes, use a short-lived branch:

```text
<type>/<short-description>
```

Use the same types as commit messages and a lowercase, hyphen-separated description:

```text
feat/memory-search
fix/chat-cancellation
chore/simplify-tests
doc/contributing-guide
test/tool-errors
```

- Maintainers may commit small changes directly to `main`.
- External contributors should submit a pull request targeting `main`.

There is no separate long-lived `develop` or release branch workflow.
