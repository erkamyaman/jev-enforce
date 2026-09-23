# jev-enforce benchmark

59 cases, 19 rules, 592 rule checks. Run 2026-09-23.

## Catching broken rules

| Threshold | Precision | Recall | Clean texts wrongly flagged |
| --- | --- | --- | --- |
| 0.5 | 77.2% | 97.8% | 7 of 28 |
| 0.6 | 87.8% | 95.6% | 3 of 28 |
| 0.7 | 93.3% | 93.3% | 2 of 28 |
| 0.8 | 95.3% | 91.1% | 2 of 28 |
| 0.9 | 97.4% | 84.4% | 1 of 28 |

## Sorting rules (reply / code / both / none)

18 of 19 sorted as expected.
- "Never use em dashes (—). Use periods, commas, or parentheses instead.": got reply, expected both

## Speed and cost

- Latency per check: p50 348ms, p95 464ms
- Input tokens: 63115, about $0.00265 for the whole run

## Mistakes at threshold 0.8

- r16, rule 0: p=0.97, expected clean
- c07, rule 8: p=0.78, expected broken
- c08, rule 8: p=0.84, expected clean
- c20, rule 8: p=0.69, expected broken
- c29, rule 17: p=0.56, expected broken
- c31, rule 18: p=0.06, expected broken
