# fsp-rewards tests

These tests cover the reward-calculation library (`libs/fsp-rewards/`).
They are isolated from the core-logic test suites because:

- The reward calculator is a batch/offline process, not part of the
  live ftso-scaling client runtime.
- The synthetic test fixtures and `mini-*` simulators in `utils/`
  haven't been actively maintained alongside production audit
  fixes (MEDIUM-05, MEDIUM-06, HIGH-01, etc.). They still pass
  mechanically but may not exercise the latest guard paths.
- When adding new attacks against the live data-provider runtime,
  extend `test/apps/ftso-data-provider/` instead — that's where
  the actively-maintained scenarios live.

The tests in this folder are kept as regression coverage for the
reward calculator but should be considered lower-priority for
ongoing maintenance.
