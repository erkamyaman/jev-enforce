// @ts-check

/**
 * A stand-in for the Jev API: classifies rules by keyword and flags em dashes and "Happy to".
 * @param {{ calls?: any[] }} [log]
 * @returns {typeof fetch}
 */
export function fakeJev(log = {}) {
  log.calls = [];
  return /** @type {any} */ (
    async (/** @type {string} */ url, /** @type {any} */ init) => {
      const req = JSON.parse(init.body);
      log.calls?.push({ url, headers: init.headers, req });
      /** @type {Record<string, any>} */
      const answers = {};
      for (const [id, q] of Object.entries(req.questions)) {
        const qq = /** @type {any} */ (q);
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
    }
  );
}
