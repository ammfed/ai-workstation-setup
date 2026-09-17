// Turns preference answers into a Markdown rules file. Pure: `get(key)` returns
// an answer, so the same text is written for Claude Code and for firstmate.
// Sections follow the question groups in module.mjs and docs/working-preferences.md.

export function renderPreferences(get, { cardsPath } = {}) {
  const sections = [];
  const section = (title, lines) => {
    const kept = lines.filter(Boolean);
    if (kept.length) sections.push(`## ${title}\n\n${kept.map((l) => `- ${l}`).join('\n')}`);
  };

  section('Language and tone', [
    get('PREFS_PLAIN_LANGUAGE') &&
      'Write in plain, natural, friendly words, like a capable colleague talking. Explain a thing before naming it. No internal codes, invented jargon or arrow shorthand in place of sentences.',
    get('PREFS_PLAIN_LANGUAGE') && 'Keep replies short. Go into detail only when asked or when a decision needs it.',
    get('PREFS_NO_NARRATION') &&
      'Give the result, not a commentary on your own steps: no private plans, no lists of what you are about to check, no narration between tool calls. If something failed or is still running, say that as a fact about the work.',
    get('PREFS_NO_EM_DASHES') && 'Do not use em dashes. Use a period, a comma, or a plain conjunction instead.',
    get('PREFS_OUTWARD_AS_USER') &&
      'Anything that goes to other people (documents, emails, pull request text, published pages) is written as the user, in their professional voice. Leave out agent and tooling labels, internal ids, source-type tags and speaker notes.',
  ]);

  const status = get('PREFS_STATUS');
  const days = get('PREFS_STALE_DAYS') || '2';
  section('Reporting and status', [
    status === 'board' &&
      'Open every status reply with a table of the current work in three columns: TODO, DOING, DONE. One short line per item.',
    status === 'brief' && 'Open every status reply with the answer in a sentence or two.',
    status !== 'none' && 'Then give brief action items, grouped by who acts: the user first, then the agent.',
    status !== 'none' && 'Show progress as counts like "3 of 5". A word always carries the state, never colour alone.',
    get('PREFS_LINK_DELIVERABLES') &&
      'Every finished item that produced something carries a link to it: a full https URL for anything online, an absolute path for a local file.',
    get('PREFS_DAILY_CHECK') &&
      `Once a day, at the top of the first status, run a nothing-forgotten check and show anything real: review-page answers not yet collected, anything waiting on the user for more than ${days} days without being brought back, and standing rules with no evidence that they ran. Verify each item before calling it dropped.`,
    get('PREFS_AWAY_MODE') &&
      'When the user says they are away (commuting, asleep, offline for a while), keep going on work that is already approved, hold every new decision and anything irreversible, and send no routine progress messages. When they return, open with a short return brief: what finished (with links), what waits on them, what is next.',
  ]);

  const decisions = get('PREFS_DECISIONS');
  section('Decisions', [
    'Bring the user genuine decisions only, never tool permissions or command mechanics.',
    decisions === 'cards' &&
      'Put decisions on a Lavish decision-card page (lavish-axi): one decision at a time with "1 of N", a visual preview for every option that follows the selected option, a short "why" kept closed, and every answer sent together after a one-screen recap. Keep the text minimal.',
    decisions === 'cards' && cardsPath && `Start each decision page from the template at \`${cardsPath}\`.`,
    decisions === 'cards' && 'Open review pages without launching a browser tab (`--no-open`, or `LAVISH_AXI_NO_OPEN=1`) and share the link in chat.',
    decisions === 'tool' && 'Ask decisions with the question tool, one question at a time, with a preview on every option.',
    decisions === 'chat' && 'Ask decisions in chat, one at a time, with a short named list of options and the recommendation first.',
    decisions !== 'chat' && get('PREFS_YES_NO_IN_CHAT') && 'Ask a simple yes-or-no question in plain chat instead.',
    get('PREFS_PREVIEW_BEFORE_BUILD') &&
      'When the user asks for a change to how something looks or feels, show it on a review page before building it, the same way as a decision.',
    get('PREFS_CHECK_ANSWERS_FIRST') &&
      'Before describing a review page or question as still open, check whether the user already answered it. Never assume a page is unanswered.',
    get('PREFS_ASK_BEFORE_CLOSING') &&
      'When work finishes, ask whether to close the finished or idle agents, sessions and browser tabs. Never close one unasked, and never leave a finished one open silently.',
  ]);

  const routing = get('PREFS_MODEL_ROUTING');
  section('AI and model use', [
    routing === 'economical' && 'Use a balanced model at low effort for routine work and sub-tasks.',
    routing === 'economical' && 'Use medium effort for planning, design, hard reasoning and judgment calls.',
    routing === 'economical' && 'Use the most capable model at high effort for building a product, prototype or demo.',
    routing === 'balanced' && 'Use medium effort by default, and high effort for planning, design, hard reasoning and building.',
    routing !== 'none' && 'Use a premium model outside these rules only when the user names it for a task.',
    get('PREFS_QUOTA') &&
      'Treat subscription limits as scarce. Check them with `quota-axi` before heavy or parallel work, take the cheapest path that still answers, and pause heavy work near a limit and say so.',
  ]);

  const browser = get('PREFS_RESEARCH_BROWSER') === 'separate';
  section('Research', [
    browser &&
      "Do web research in a separate, visible browser that belongs to the agent (for example `research-browser axi <command>`), never in the user's own browser profile or an extension running in it.",
    browser &&
      'Give each research task its own tab, fill specific page elements instead of typing with global keyboard input, and close each tab as soon as that research is done. Report a site that needs the user to sign in; do not wait on it.',
    get('PREFS_SOURCE_QUALITY') &&
      'Name the type of every source next to its link (official documentation, standards body, peer-reviewed or government report, vendor page, forum post). Skip content farms and unsourced blog posts. Look for real, existing software before general write-ups.',
    get('PREFS_FINDINGS_TO_CHANGE') &&
      'Research is not finished as a report. It ends in a change the user can see, or a decision they can make that leads to one. If nothing changes because of it, say so plainly.',
  ]);

  const merge = get('PREFS_MERGE');
  section('Safety', [
    'Never put secrets, tokens, passwords or personal data in files, commits, pull requests, pages or logs. Secrets come from environment variables or the tool\'s own sign-in.',
    merge === 'explicit' &&
      'Merge a pull request only when the user explicitly says to merge that pull request. Approving the work is not a merge instruction.',
    merge === 'green' &&
      'You may merge your own pull requests once every check passes. Still ask before anything destructive, irreversible or security-sensitive.',
    get('PREFS_VERIFY_CAUSE') &&
      'Do not name a cause for a failure unless you checked it against evidence. Otherwise report the failure and say the cause is unknown.',
    'Say plainly when something was reasoned about rather than tested.',
  ]);

  return `# Working preferences

Written by ai-workstation-setup from your answers. Edit freely: re-running the
installer asks before replacing a changed file and keeps a backup.

${sections.join('\n\n')}
`;
}
