#!/bin/bash

set -euo pipefail

echidna-test . --contract FullMathEchidnaTest --config echidna.config.yml --test-mode assertion
echidna-test . --contract TickMathEchidnaTest --config echidna.config.yml --test-mode assertion
echidna-test . --contract SwapMathEchidnaTest --config echidna.config.yml --test-mode assertion
