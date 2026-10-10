---
name: research-evidence
description: Rules for external research in Garage Copilot — source quality, local Polish shops, how to capture prices with dates, citation format and how to express uncertainty. Use for any web research on techniques, materials, tools or prices.
---

# research-evidence

Reusable rules for gathering and presenting evidence. Used by `diy-researcher`, `product-researcher` and
checked by `evidence-validator`. Never rely on model memory alone: every decision-driving claim and every
price must come from a source you actually opened or saw in a search result.

## Searching

- Use `WebSearch` to find candidates, `WebFetch` to read the page you cite. Search in Polish first for
  products and local prices, then English and Russian for techniques.
- Prefer several narrow queries over one broad query, e.g. «klej do gresu mrozoodporny Castorama»,
  «system poziomowania płytek klipsy 60x60 opinie».
- Stop when a recommendation has at least two independent sources, or say plainly that it has only one.

## No PDF documents

Do not fetch PDF files (technical data sheets, catalogues, standards texts). PDF reading is not supported in
this project and wastes the research budget. Use HTML pages: manufacturer product and technical pages,
retailer pages with specifications, trade publications. Wherever another file says «data sheet» or
«TDS», read it as the manufacturer's HTML technical page. If a fact seems to exist only in a PDF, write it
down as unknown («не найдено в HTML-источниках») instead of trying; never retry a URL that failed once.

## Research budget

The dispatch prompt names a depth with hard numbers (`quick`: at most 6 searches and 8 page fetches;
`standard`: at most 12 and 15 — the authoritative values are in `config/workflow.json`). Count every
`WebSearch` and `WebFetch` call.

- Plan the questions first (from the task and, if given, the trade playbook), then spend the budget on
  the questions that drive decisions: conditions and limits, safety, compatibility, price.
- One good source per question beats many repeats. Do not open a second page for a fact you already have
  from a manufacturer data sheet unless the sources conflict.
- When the budget is spent, stop. Write what is still unknown into `Допущения и неопределённости`
  ("не исследовано из-за лимита поиска: ...") rather than searching on.
- Prefer one page that answers several questions (a data sheet) to many pages that each answer one.

## Locality of sources

The master's country comes from the profile (`get_profile`).

1. First choice: sources of that country — national domains (for Poland `.pl`), national regulations and
   standards, local manufacturers and retailers, local-language trade publications.
2. Second: European/international manufacturer sites and EN standards that apply in that country.
3. Foreign sources (another country's standards, retailers or guidance, e.g. US, UK, Australia) only as
   supplementary, at most 2 per artifact, only for a fact the first two groups do not give, each tagged
   `[иностранный источник]` in `Источники` with a one-line reason. Never use another country's norm or
   regulation as the authority for a limit that applies to the master; use the national or EN one, or say
   it could not be found.
4. Prices and shops: only local retailers and the master's country domains.

## Trade playbooks

If the dispatch prompt names a playbook (e.g. `trade-tiling`, `trade-carpentry`), read
`.claude/skills/<playbook>/SKILL.md` first. It is a checklist of questions for your topic: answer each
one from sources, or list it as unknown. It contains no facts; never copy a value from it.

## Source quality (highest first)

1. Manufacturer technical data sheets and manuals (TDS, instrukcja), official standards.
2. Professional or trade organisations and publications.
3. Established retailers' product pages (specs and price) — Castorama, Leroy Merlin, OBI, Bricomarché,
   Allegro, Media Expert, manufacturer web shops; OLX for used.
4. Independent test and review sites, long-term reviews.
5. Forums and video comments — only as a pointer, never as the sole source of a fact that drives a decision.

Do not cite pages you could not open. Never invent a URL, a model number or a price.

## Prices

- Capture 2–3 shops per item where possible, from product pages. Currency from the master's profile.
- Every price carries the shop, the URL and the date it was seen (`YYYY-MM-DD`, today's date).
- If only a search-result snippet was available, mark the price «ориентировочно».
- The average is computed only from prices you actually captured; show the arithmetic.
- Do not convert currencies from memory; if a price is in another currency, say so.

## Citations

- In prose cite with numbered markers `[1]`, `[2]` that point to the `Источники` list.
- `Источники` format, one per line:

  ```text
  1. <page title or shop and product> — <URL> (дата обращения: YYYY-MM-DD)
  ```

- A numbered recommendation or a table row without a source is a defect (gate G1).

## Uncertainty

- State what is not known and why in `Допущения и неопределённости`: conflicting sources, only one source,
  stale or snippet-only prices, parameters the master has not confirmed.
- Distinguish a manufacturer requirement («минимум +5 °C по данным производителя [2]») from a practitioner
  opinion («мастера советуют [4]»).
- When sources disagree, give both and say which one you would follow and why.

## Compatibility with what the master owns

Before recommending a purchase, call `check_owned` (MCP `workshop-memory`) for the item and read the
relevant inventory entries. Do not recommend what is already owned unless you explain why it is unsuitable
(for example a router collet size that does not fit the bit). Mention such fit details explicitly; they are
the most valuable part of a personal recommendation.
