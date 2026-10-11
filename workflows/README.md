# Demo runs

Each folder is one complete run of the workflow, kept as it was produced: `request.md` (input),
`qa-log.md` (clarifying questions and answers), `plan.json` (the execution graph the coordinator chose),
`artifacts/` (Markdown artifacts), `workflow-state.json` (execution state), `approval.json` (the master's
decision bound to the plan hash), `output/garage-plan.html` (final guide). All runs use the fictional demo
master from `mcp/workshop-memory/seed.demo.sql`.

| Run | Scenario | Graph | Notable |
|---|---|---|---|
| `20261010-1232-garage-tiles` | `project-plan`: tiles on a garage floor | regular, 11 nodes, 3 parallel research nodes | interrupted and resumed, validator retries, reject → approve |
| `20261010-1806-hanging-cabinet-beech` | `project-plan`: hanging beech cabinet with a drawer | small, 7 nodes | master overrides mid-run, 3.5 h pause and resume, reject → approve |
| `20261010-2340-bosch-gas15ps-dust-extraction` | `purchase-decision`: dust extractor for rigid piping | research ∥ products, 7 nodes | composite commands, retry research depth, approved in round 1 |

## Rule versions

The runs were produced while the rules were being tightened, so the older ones do not satisfy every
check of the final checker. Re-running `node scripts/check-artifact.mjs` over them reports exactly these
known findings, which were not violations at the time:

- run 1 cites PDF data sheets without page references in three artifacts (`research-bonding.md`,
  `products-materials.md`, `final-plan.md`); PDF sources were disabled after run 1 and re-enabled on
  2026-10-11 through the `pdf-reader` server, with the page reference as a rule;
- run 2's final plan predates the `master-voice` style rules and the shorthand lint («ор.», one-letter
  notation);
- run 3's final plan contains one pipeline phrase («по правилам поиска»), which is what the phrase lint was
  added for; it passed at the time because of a Cyrillic word-boundary bug in the first version of that lint.

Every other artifact of the three runs passes the current checker. The plans are bound to the master's
approval by hash, so they are kept unchanged.
