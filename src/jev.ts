export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';

export type Question =
  | { type: 'noul'; instructions: string; criteria?: Record<string, string> }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> };

export type Answer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number };

export type Ask = (state: unknown, questions: Record<string, Question>) => Promise<Record<string, Answer>>;

export interface AskOptions {
  apiKey: string;
  model?: string;
  url?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createAsk({
  apiKey,
  model = 'jev-latest',
  url = JEV_URL,
  fetch = globalThis.fetch,
  timeoutMs = 15000,
}: AskOptions): Ask {
  return async (state, questions) => {
    const body = JSON.stringify({ state, model, questions });
    for (let attempt = 0; ; attempt++) {
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
      if (!res.ok) throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = (await res.json()) as { answers?: Record<string, Answer> };
      if (!json || typeof json.answers !== 'object') throw new Error('Jev response has no answers');
      return json.answers;
    }
  };
}

/** Splits questions into batches and runs them concurrently. */
export async function askAll(
  ask: Ask,
  state: unknown,
  questions: Record<string, Question>,
  batchSize = 50,
): Promise<Record<string, Answer>> {
  const entries = Object.entries(questions);
  const batches: Record<string, Question>[] = [];
  for (let i = 0; i < entries.length; i += batchSize) batches.push(Object.fromEntries(entries.slice(i, i + batchSize)));
  const results = await Promise.all(batches.map((b) => ask(state, b)));
  return Object.assign({}, ...results);
}
