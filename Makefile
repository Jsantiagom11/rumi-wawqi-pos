SHELL := /bin/bash
NODE ?= node

.PHONY: check test test-domain test-regression build-operations serve audit-demo finalize-demo clean-demo

check:
	$(NODE) --check lib/shift-core.mjs
	$(NODE) --check lib/operations-core.mjs
	$(NODE) --check lib/operations-bootstrap.mjs
	$(NODE) --check lib/operations-browser-ui.mjs
	$(NODE) --check scripts/build-operations-ui.mjs
	$(NODE) --check cli/rumi-lab.mjs
	$(NODE) --test tests/*.test.mjs

test:
	$(NODE) --test tests/*.test.mjs

test-domain:
	$(NODE) --test tests/shift-core.test.mjs tests/two-phase.test.mjs tests/cli.test.mjs tests/recovery-cli.test.mjs tests/operations-core.test.mjs tests/operations-bootstrap.test.mjs

test-regression:
	$(NODE) --test tests/regression.test.mjs tests/operations-ui-build.test.mjs

build-operations:
	$(NODE) scripts/build-operations-ui.mjs

serve:
	python3 -m http.server 8080 --directory app

audit-demo:
	$(NODE) cli/rumi-lab.mjs audit fixtures/sample-shift-v2.json

finalize-demo: clean-demo
	$(NODE) cli/rumi-lab.mjs simulate-finalize fixtures/sample-shift-v2.json .tmp/finalize-demo

clean-demo:
	rm -rf .tmp/finalize-demo
