---
name: artifact-validator
description: Structural and citation check for Garage Copilot workflow artifacts (stage gate G0), plus the canonical artifact skeleton and per-type templates. Use after any artifact is written and before dependent work starts, and when writing an artifact to match its required structure.
---

# artifact-validator

Reusable rules for what a valid workflow artifact looks like and how to check it. Used by the coordinator
(after every node), by `evidence-validator`, and by agents that want to self-check before returning.

## Artifact skeleton

Every artifact under `workflows/<run-id>/artifacts/` is Markdown in Russian and has:

1. a title `# ...`;
2. a meta block directly after the title:

   ```markdown
   <!-- meta
   artifact: <type>
   owner: <agent name>
   run: <run-id>
   version: <n>
   -->
   ```

   (`requirements.md` additionally has `status` and `workflow_type`);
3. the fixed `##` headings of its type, in the fixed order, exactly as in `templates/<type>.md`.
   Do not add, rename or reorder `##` headings; use `###` for sub-structure inside a section.

The three closing sections are common to every type except `validation.md` (which has its own fixed
sections): `Покрытие требований`, `Допущения и неопределённости`, `Источники`.

| Type | File | Owner | Template |
|---|---|---|---|
| requirements | `requirements.md` | requirements-formalizer | `templates/requirements.md` |
| research | `research.md`, `research-<topic>.md` | diy-researcher | `templates/research.md` |
| products | `products.md`, `products-<category>.md` | product-researcher | `templates/products.md` |
| project-plan | `project-plan.md` | project-planner | `templates/project-plan.md` |
| budget | `budget.md` | cost-planner | `templates/budget.md` |
| validation | `validation.md` | evidence-validator | `templates/validation.md` |

The `final-plan.md` template is added when the synthesizer is implemented.

## Running the check

```bash
node scripts/check-artifact.mjs workflows/<run-id>/artifacts/<file>.md
```

Prints `PASS` (exit 0) or `FAIL` followed by one `- [G0] <finding>` line per problem (exit 1).

What it verifies:

- the meta block exists and `artifact`, `owner`, `run`, `version` are correct;
- the `##` headings match the template exactly, in order;
- `Покрытие требований` lists requirement IDs (`R1`, ...) and every ID exists in `requirements.md`
  (whether the requirements are actually met is judged later by gate G6, not here);
- research and products artifacts have at least one URL in `Источники`;
- every data row of the price table (`Кандидаты` in products, `Список покупок` in budget) has a source URL and
  a date `YYYY-MM-DD` (rows for items marked «уже есть» are exempt);
- for `validation.md`: one table row set covering G1–G7, valid statuses, FAIL rows with finding + fix hint
  and an owner node that exists in the plan, and `meta.result` consistent with the table;
- total size within the per-type character limit from `config/workflow.json` (`artifact_max_chars`);
- no leftover placeholders (`TODO`, `TBD`, `<run-id>`, `YYYY-MM-DD`, lorem ipsum).

## Reporting findings

On `FAIL` the coordinator passes the findings verbatim to the owning agent for a targeted retry. Findings that
come from judgement (gates G1–G7, produced by `evidence-validator`) use the same shape:

```text
- [<gate>] <artifact> | owner: <agent> | <what is wrong> | fix: <what to do>
```

## Rules

- A failed artifact is never an input to downstream work.
- The check is deterministic and structural; it does not replace judgement about correctness.
- Never edit an artifact to make it pass; send it back to its owner.
