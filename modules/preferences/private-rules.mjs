// Reads your private rules file (PREFS_PRIVATE_RULES): plain Markdown kept outside the clone,
// where each heading says which generated file its lines go to. Pure, so tests feed it text.
// docs/working-preferences.md "Your private rules" describes the format.

// Heading (any case) -> where its lines go.
export const PRIVATE_HEADINGS = {
  everywhere: 'Everywhere', // working preferences, worker briefs and the shared second-mate file
  sessions: 'Sessions', // working preferences only
  workers: 'Workers', // Firstmate's config/brief-include.md, appended to every worker brief
  'second mates': 'Second mates', // Firstmate's data/captain-shared.md, read by every second mate
  reviewer: 'Reviewer', // the no-mistakes review rules
};

/**
 * Split the file into its five line lists. A `- ` or numbered item, or a paragraph, is one line;
 * a line that follows without a blank line between continues it. A `# ` title, text before the
 * first heading and HTML comments are not used. Returns `{ rules, unknown }`, where `unknown`
 * lists headings that are none of the five (their lines are not used).
 */
export function parsePrivateRules(text) {
  const rules = Object.fromEntries(Object.keys(PRIVATE_HEADINGS).map((k) => [k, []]));
  const unknown = [];
  let list = null; // where lines go now; null before the first heading or under an unknown one
  let open = false; // the last line can still be continued
  for (const raw of String(text ?? '').replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    const line = raw.trim();
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*$/);
    if (heading) {
      open = false;
      if (heading[1].length === 1) continue;
      const key = heading[2].toLowerCase().replace(/\s+/g, ' ');
      list = rules[key] ?? null;
      if (!list && !unknown.includes(heading[2])) unknown.push(heading[2]);
      continue;
    }
    if (!line) {
      open = false;
      continue;
    }
    if (!list) continue;
    const item = line.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (item) list.push(item[1]);
    else if (open) list[list.length - 1] += ` ${line}`;
    else list.push(line);
    open = true;
  }
  return { rules, unknown };
}
