---
name: garage-html-theme
description: Rendering rules and the fixed standalone HTML template for the Garage Copilot final guide. Use when turning an approved final plan into the HTML output.
---

# garage-html-theme

The final guide is rendered **deterministically** from the approved `final-plan.md`: the same plan always
gives the same HTML and the same section order. The model never hand-writes the HTML.

## Pieces

| File | Role |
|---|---|
| `template.html` (this folder) | The page: inline CSS (light and dark, print-friendly), header, table of contents, content slot, footer |
| `scripts/render-html.mjs` | Verifies approval, converts the plan, fills the template, writes `output/garage-plan.html` |
| `scripts/check-artifact.mjs <html>` | Checks the result: standalone, no scripts or external resources, no internal names, same sections as the plan |

## Rendering rules

- Input is the restricted Markdown of the final plan: `#` title, `##` sections, `###` sub-headings,
  paragraphs, `-` and `1.` lists, `- [ ]` checklist items, tables, `**bold**`, `*italic*`, `` `code` ``,
  `[text](https://…)` links and bare http(s) URLs, `>` quotes. The `<!-- meta -->` block is never rendered.
- Every `##` becomes a `<section>` with an `<h2>`; the table of contents lists them in order.
- Tables are wrapped for horizontal scrolling on narrow screens; the shopping list keeps its columns.
- Only `http://` and `https://` links are made clickable; they open in the same tab.
- The page has no scripts, no external fonts, images or stylesheets. It must open from a file or an email.
- Footer: the approval date from the approval record.

## Rules for the author of the plan

Because the renderer is mechanical, write the plan in the subset above: no nested lists, no HTML, no
images. Anything else is escaped and shown as text.
