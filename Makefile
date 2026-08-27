SHELL := /bin/bash
NODE ?= node

.PHONY: check test test-domain test-regression serve audit-demo finalize-demo clean-demo

check:
	$(NODE) --check lib/shift-core.mjs
	$(NODE) --check cli/rumi-lab.mjs
	$(NODE) --test tests/*.test.mjs

test:
	$(NODE) --test tests/*.test.mjs

test-domain:
	$(NODE) --test tests/shift-core.test.mjs tests/cli.test.mjs

test-regression:
	$(NODE) --test tests/regression.test.mjs

serve:
	python3 -m http.server 8080 --directory app

audit-demo:
	$(NODE) cli/rumi-lab.mjs audit fixtures/sample-shift-v2.json

finalize-demo: clean-demo
	$(NODE) cli/rumi-lab.mjs simulate-finalize fixtures/sample-shift-v2.json .tmp/finalize-demo

clean-demo:
	rm -rf .tmp/finalize-demo
