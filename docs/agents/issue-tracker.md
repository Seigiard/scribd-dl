# Issue tracker: GitHub

Issues and specs live in GitHub Issues. Use the `gh` CLI.
Resolve the repository from `git remote -v`; `gh` does this automatically
inside the clone. The current repository is `Seigiard/scribd-dl`.

## Issue operations

- Create: `gh issue create --title "..." --body-file <path>`.
- Read: `gh issue view <number> --comments`. Fetch labels with
  `gh issue view <number> --json labels`.
- List: `gh issue list --state open --json number,title,body,labels,comments`.
  Use label and state filters as needed. Paginate when the task needs all issues.
- Comment: `gh issue comment <number> --body-file <path>`.
- Add or remove labels: `gh issue edit <number> --add-label "..."` or
  `gh issue edit <number> --remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.

When a skill says "publish to the issue tracker", create a GitHub issue.
When it says "fetch the relevant ticket", read the issue and its comments.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Wayfinding operations

The map is one issue labelled `wayfinder:map`. Its body holds Notes,
Decisions-so-far, and Fog. Tickets are child issues.

- Link children through GitHub sub-issues with `gh api`. If unavailable,
  use a task list in the map and a `Part of #<map>` line in each child.
- Label children `wayfinder:<type>`, where type is `research`, `prototype`,
  `grilling`, or `task`.
- Record blockers with native issue dependencies:
  `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`.
  Get the database id with
  `gh api repos/<owner>/<repo>/issues/<number> --jq .id`.
  If dependencies are unavailable, use a `Blocked by: #<number>` line.
- A ticket is unblocked when all blockers are closed. For native dependencies,
  `issue_dependencies_summary.blocked_by` counts open blockers.
- The frontier is the map's open children with no open blockers and no assignee.
  Select the first ticket in map order.
- Claim with `gh issue edit <number> --add-assignee @me` as the session's first write.
- Resolve by commenting with the answer, closing the ticket, and appending
  a context pointer (gist and link) to the map's Decisions-so-far.
