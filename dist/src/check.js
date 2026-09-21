import { askAll } from './jev.js';
export const MAX_TEXT_CHARS = 60000;
function fit(text) {
    if (text.length <= MAX_TEXT_CHARS)
        return text;
    const half = MAX_TEXT_CHARS / 2;
    return `${text.slice(0, half)}\n[... ${text.length - MAX_TEXT_CHARS} chars omitted ...]\n${text.slice(-half)}`;
}
/** Checks one reply or one file edit against every applicable rule in a single parallel Jev pass. */
export async function findViolations({ text, kind, filePath, rules, ask, threshold }) {
    const applicable = rules.filter((r) => r.scope === kind || r.scope === 'both');
    if (!applicable.length || !text.trim())
        return [];
    const state = kind === 'reply'
        ? { kind: 'A chat reply an AI coding assistant wrote to the developer', text: fit(text) }
        : { kind: 'Text an AI coding assistant just wrote into a file', file: filePath ?? '', text: fit(text) };
    const questions = Object.fromEntries(applicable.map((r, i) => [
        `v${i}`,
        {
            type: 'noul',
            instructions: `Rule: "${r.text}"\nDoes the text break this rule?`,
            criteria: {
                true: 'The text clearly breaks the rule.',
                false: 'The text follows the rule, or the rule does not apply to this text.',
            },
        },
    ]));
    const answers = await askAll(ask, state, questions);
    return applicable
        .map((r, i) => {
        const a = answers[`v${i}`];
        return { rule: r.text, source: r.source, p: a?.type === 'noul' ? a.noul : 0 };
    })
        .filter((v) => v.p >= threshold)
        .sort((a, b) => b.p - a.p);
}
export function formatReason(violations, kind) {
    const what = kind === 'reply' ? 'Your last reply breaks' : 'This edit breaks';
    const fix = kind === 'reply'
        ? 'Rewrite the reply so it follows these rules. Do not mention jev-enforce.'
        : 'Fix the file so it follows these rules.';
    const lines = violations.map((v) => `- "${v.rule}" (${v.p.toFixed(2)})`);
    return `jev-enforce: ${what} rules from your CLAUDE.md:\n${lines.join('\n')}\n${fix}`;
}
