#!/bin/bash

set -euo pipefail

echidna-test . --contract FullMathEchidnaTest --config echidna.config.yml --check-asserts
echidna-test . --contract BitMathEchidnaTest --config echidna.config.yml --check-asserts
echidna-test . --contract TickMathEchidnaTest --config echidna.config.yml --check-asserts

