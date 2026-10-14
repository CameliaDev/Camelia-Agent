# Cognition Phase 0 backtest

Source: SIMULATED DomainEvent corpus (packages/harness/src/cognition/synthetic-corpus.ts). No user events table was passed. Outcomes are a fixed function of capability and archetype, using the real event names.

The replay builds (signature, prediction, observation) triples with §4.3 hierarchical backoff only. No plan, tool, or model choice is changed. `routing.chosen.estimatedUsd` is not treated as a cost observation. Sensors with no event in this log are listed below and are not scored.

## Gate

| | |
| --- | --- |
| L2+ predictions | 542 |
| L2+ mean residual | 0.0869 |
| L-1 prior mean on the same observations | 0.3717 |
| delta (prior − L2+) | 0.2848 |
| threshold | 0.1 |
| **gate** | **PASS** |

L2+ mean residual is at least 0.1 below the L-1 prior on the same observations. Phase 3 observe-only wiring is allowed: predictions are recorded and the policy is not allowed to change a plan, a model, or a tool call. Phase 4 stays unwired.

Pooled gate aside, these observables do not clear 0.1 on their own: verdict Δ=0.0424.

Prior predictions with `surprise=true`: 0. Total surprises: 87.

## Coverage

| | |
| --- | --- |
| episodes (task ids) | 100 |
| steps with an observation | 104 |
| steps predicted | 104 |
| step coverage | 1.0000 |
| scored predictions | 644 |
| empirical share of scored predictions | 0.9767 |
| sensors with no observation | cost-usd, failure-mode |

Step coverage is "how many observed steps could be signed and predicted". The empirical share is how many of those predictions had left the cold-start prior.

## Mean residual by backoff level

| level | n | mean residual |
| --- | --- | --- |
| L3 | 527 | 0.0855 |
| L2 | 15 | 0.1351 |
| L0 | 60 | 0.5774 |
| L-1 prior | 42 | 0.4342 |

## Mean residual by observable

| kind | n | mean | L2+ n | L2+ mean | prior mean | delta |
| --- | --- | --- | --- | --- | --- | --- |
| duration-ms | 104 | 0.2905 | 83 | 0.1742 | 0.6953 | 0.5210 |
| tool-call-count | 104 | 0.1290 | 83 | 0.0000 | 0.3488 | 0.3488 |
| tool-outcome | 228 | 0.0901 | 210 | 0.0776 | 0.3902 | 0.3126 |
| touched-paths | 104 | 0.1298 | 83 | 0.0000 | 0.1566 | 0.1566 |
| verdict | 104 | 0.2143 | 83 | 0.1967 | 0.2391 | 0.0424 |

## Backoff level distribution (scored predictions)

| level | n |
| --- | --- |
| L3 | 527 |
| L2 | 15 |
| L0 | 60 |
| L-1 prior | 42 |
