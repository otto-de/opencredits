# 5. License policy check

- Status: accepted
- Date: 2026-10-08

## Context

Publishing notices and deciding whether a dependency may be used are different
questions, but they need the same data. Once the tool knows every dependency's
license, checking it against a policy costs almost nothing and catches problems
that a notice page alone would silently publish, such as an AGPL library in a
public web service.

## Decision

Classify each license into a category (permissive, weak copyleft, strong
copyleft, network copyleft, not open source, case by case, undetermined) and turn
that into a verdict using the project type:

- Permissive and weak copyleft are allowed everywhere.
- Strong copyleft is allowed for internal software and forbidden for distributed
  software.
- Network copyleft and non-free licenses are forbidden everywhere.
- Case-by-case licenses and undetermined licenses need review.

SPDX expressions are evaluated by operator: `OR` takes the least restrictive
operand, because it is a choice; `AND` takes the most restrictive, because all
obligations apply.

Two rulesets ship. `standard` treats the Lesser GPL as weak copyleft, which is
the common reading. `conservative` treats it as strong copyleft, which matches
policies that forbid any GPL family license in distributed software. Per-license
`overrides` cover anything else.

Findings never block the page: `run` and `merge` write the page and then exit
with code 4 if `failOn` is triggered. Exceptions require a written reason and
stay visible in the report as accepted risks.

## Consequences

- The default is `failOn: "none"`, so adopting the tool does not suddenly break
  builds. Teams opt into enforcement.
- The categories are a starting point, not legal advice, and the documentation
  says so. A license the ruleset does not know becomes `undetermined` and is
  reported for review rather than silently passing.
- The check runs on deduplicated packages, so a library used in twenty
  repositories is reported once, with the list of repositories attached.
