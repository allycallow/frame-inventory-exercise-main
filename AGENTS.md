# AGENTS.md

## Commit messages

- Use Conventional Commits for new commits. Write `type: subject` or
  `type(scope): subject`. For example, use `fix(backend): handle missing frames`.
- Use a type that describes the change, such as `feat`, `fix`, `docs`, `test`,
  `refactor`, or `chore`. Write the subject as a short imperative phrase.
- Run `pre-commit install` from the repository root to install the Git hooks.
  Commitlint checks the message when you commit.
