export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
export function createAsk({ apiKey, model = 'jev-latest', url = JEV_URL, fetch = globalThis.fetch, timeoutMs = 15000, }) {
    return async (state, questions) => {
        const body = JSON.stringify({ state, model, questions });
        for (let attempt = 0;; attempt++) {
            const res = await fetch(url, {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body,
                signal: AbortSignal.timeout(timeoutMs),
            });
            if ((res.status === 429 || res.status === 529) && attempt < 2) {
                await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
                continue;
            }
            if (!res.ok)
                throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
            const json = (await res.json());
            if (!json || typeof json.answers !== 'object')
                throw new Error('Jev response has no answers');
            return json.answers;
        }
    };
}
/** Splits questions into batches and runs them concurrently. */
export async function askAll(ask, state, questions, batchSize = 50) {
    const entries = Object.entries(questions);
    const batches = [];
    for (let i = 0; i < entries.length; i += batchSize)
        batches.push(Object.fromEntries(entries.slice(i, i + batchSize)));
    const results = await Promise.all(batches.map((b) => ask(state, b)));
    return Object.assign({}, ...results);
}
