// Internal names that must never reach text written for the master.
export const LEAK_PATTERNS = [
  /\b(requirements|research(-[a-z0-9-]+)?|products(-[a-z0-9-]+)?|project-plan|budget|validation|final-plan|qa-log|request|plan)\.(md|json)\b/i,
  /\bworkflow-state\b/i,
  /\bapproval\.json\b/i,
  /\bworkflows\//,
  /\.claude\//,
  /\b(requirements-formalizer|diy-researcher|product-researcher|project-planner|cost-planner|evidence-validator|synthesizer|final-output-builder)\b/i,
  /\b[0-9]{8}-[0-9]{4}-[a-z0-9-]+\b/,
];

// Returns the distinct leaked tokens found in text (the meta comment block is ignored).
export function findLeaks(text) {
  const body = String(text).replace(/<!--\s*meta[\s\S]*?-->/g, '');
  const found = [];
  for (const re of LEAK_PATTERNS) {
    const m = body.match(re);
    if (m) found.push(m[0]);
  }
  return [...new Set(found)];
}
