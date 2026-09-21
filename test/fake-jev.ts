export interface FakeLog {
  calls: { url: string; headers: Record<string, string>; req: any }[];
}

/** A stand-in for the Jev API: classifies rules by keyword and flags em dashes and "Happy to". */
export function fakeJev(log: FakeLog = { calls: [] }): typeof fetch {
  log.calls.length = 0;
  return (async (url: string, init: RequestInit) => {
    const req = JSON.parse(String(init.body));
    log.calls.push({ url, headers: init.headers as Record<string, string>, req });
    const answers: Record<string, unknown> = {};
    for (const [id, q] of Object.entries(req.questions)) {
      const qq = q as any;
      if (qq.type === 'choice') {
        const rule = req.state.rules[id];
        const choice = /em dash|Happy to/i.test(rule) ? 'reply' : /comment/i.test(rule) ? 'code' : 'none';
        answers[id] = { type: 'choice', choice, probabilities: { [choice]: 0.9 }, confidence: 0.9 };
      } else {
        const rule = qq.instructions;
        const text = req.state.text;
        const broken =
          (/em dash/i.test(rule) && text.includes('—')) ||
          (/Happy to/.test(rule) && /^Happy to/.test(text)) ||
          (/comment/i.test(rule) && /\/\/ /.test(text));
        answers[id] = { type: 'noul', noul: broken ? 0.93 : 0.04 };
      }
    }
    return new Response(JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 1, output_tokens: 1 } }));
  }) as typeof fetch;
}
