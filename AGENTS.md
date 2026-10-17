## Git Commit Attribution

When Codex contributes to code changes in this repository:

- Preserve the repository owner's configured Git identity as the primary commit author.
- Always append the following trailer to commit messages created by Codex:

  Co-authored-by: codex <codex@openai.com>

- Add the trailer after the commit message body, separated by a blank line.
- Do not add duplicate Co-authored-by trailers.
- Preserve other contributors' existing attribution.
- Do not attribute commits to Codex when Codex did not contribute.
- Do not modify global or local Git user.name / user.email settings.
- Do not amend or rewrite existing commits solely to add attribution.
- Follow existing repository commit conventions.
