# Domain docs

This repository uses a single-context domain documentation layout.

## Before exploring the codebase

- Read `GLOSSARY.md` at the repository root.
- Read ADRs in `docs/adr/` that apply to the area being explored.

If these files are absent, proceed silently. The `domain-modeling` skill
creates them when terms or decisions are resolved, including through
`grill-with-docs` and `improve-codebase-architecture`.

## File structure

- `GLOSSARY.md`: shared domain terms for the engine and all clients.
- `docs/adr/NNNN-short-title.md`: numbered architecture decisions.

## Use the glossary's vocabulary

Use defined terms in issue titles, proposals, hypotheses, and test names.
If a required concept has no definition, check whether it is used in the
project. Note real gaps for `domain-modeling`.

## Flag ADR conflicts

If a proposal contradicts an existing ADR, name the ADR and explain why
the decision should be reconsidered.
