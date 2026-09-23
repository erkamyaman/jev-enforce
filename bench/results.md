# jev-enforce benchmark

46 cases, 12 rules, 270 rule checks. Run 2026-09-23.

## Catching broken rules

| Threshold | Precision | Recall | Clean texts wrongly flagged |
| --- | --- | --- | --- |
| 0.5 | 71.4% | 100.0% | 7 of 22 |
| 0.6 | 85.7% | 100.0% | 4 of 22 |
| 0.7 | 93.5% | 96.7% | 2 of 22 |
| 0.8 | 93.3% | 93.3% | 2 of 22 |
| 0.9 | 96.4% | 90.0% | 1 of 22 |

## Sorting rules (reply / code / both / none)

10 of 12 sorted as expected.
- "Never use em dashes (—). Use periods, commas, or parentheses instead.": got reply, expected both
- "Never call code or a change "load-bearing".": got reply, expected both

## Speed and cost

- Latency per check: p50 368ms, p95 417ms
- Input tokens: 35202, about $0.00148 for the whole run

## Mistakes at threshold 0.8

- r16, rule 0: p=0.97, expected clean
- c07, rule 8: p=0.75, expected broken
- c08, rule 8: p=0.87, expected clean
- c20, rule 8: p=0.60, expected broken
