# Contributing

Thanks for helping improve the DeepSeek Harness desktop wrapper.

## Scope

- Desktop wrapper changes belong in `desktop/`.
- Documentation and release tooling belong at the repository root.
- Do not modify `upstream/` for wrapper-specific behavior. Submit Harness changes to the official DeepSeek repository instead.

## Development workflow

1. Fork the repository and clone it with submodules.
2. Create a focused branch.
3. Install dependencies with `npm ci` in `desktop/`.
4. Make the smallest relevant change.
5. Run `npm run check` and the smoke tests relevant to your change.
6. Describe the behavior change and verification in your pull request.

## Pull request checklist

- No API keys, logs, sessions, downloaded runtimes, or personal paths are committed.
- `upstream/` remains clean and points to the official repository.
- User-facing changes are reflected in both root README files when applicable.
- Desktop releases use a new version number rather than overwriting an existing artifact.
- Packaged runtime changes pass `npm run smoke:packaged`.

By contributing, you agree that your contribution may be distributed under this repository's MIT License.
