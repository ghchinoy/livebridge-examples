# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# livebridge-examples: External consumer validation suite across Lit 3,
# Vanilla TypeScript, React 19, and Zero-Node Go.

.PHONY: help install use-local use-tarball use-npm verify lint test test-go build-fe

SAMPLES_GO := samples/visual-concierge samples/whiteboard-architect \
	samples/bilingual-coach samples/pocket-briefing
SAMPLES_FE := samples/visual-concierge/frontend \
	samples/whiteboard-architect/frontend \
	samples/bilingual-coach/frontend

help:
	@echo "livebridge-examples — Makefile Commands"
	@echo "---------------------------------------"
	@echo "Run Interactively:"
	@echo "  ./run.sh --list             - List all 4 external samples, stacks & ports"
	@echo "  ./run.sh <sample>           - Launch Go backend + Vite frontend together"
	@echo ""
	@echo "TypeScript Package Source Switcher:"
	@echo "  make use-local              - Point frontends at file:../../../../livebridge"
	@echo "  make use-tarball            - Pack ../livebridge into .vendor/*.tgz & install"
	@echo "  make use-npm [VERSION=0.1.0]- Point frontends at npm registry ^0.1.0"
	@echo ""
	@echo "Quality Gates:"
	@echo "  make install                - Install npm dependencies in all Vite frontends"
	@echo "  make lint                   - gofmt -s, go vet, golangci-lint, tsc --noEmit"
	@echo "  make test                   - Go race tests across all 4 samples"
	@echo "  make build-fe               - Production Vite builds across Lit, Vanilla & React"
	@echo "  make verify                 - Full lint + test + Go builds + Vite builds"

install:
	@for fe in $(SAMPLES_FE); do (cd $$fe && npm install --no-audit --no-fund) || exit 1; done

use-local:
	@node scripts/switch-ts-source.mjs local

use-tarball:
	@node scripts/switch-ts-source.mjs tarball

use-npm:
	@node scripts/switch-ts-source.mjs npm $(VERSION) $(ARGS)

lint:
	@unformatted="$$(gofmt -s -l $$(find samples -name '*.go' -not -path '*/node_modules/*'))"; \
		test -z "$$unformatted" || { echo "gofmt -s needed:"; echo "$$unformatted"; exit 1; }
	@for d in $(SAMPLES_GO); do (cd $$d && go vet .) || exit 1; done
	@if command -v golangci-lint >/dev/null; then \
		for d in $(SAMPLES_GO); do (cd $$d && golangci-lint run .) || exit 1; done; \
	fi
	@for fe in $(SAMPLES_FE); do (cd $$fe && npm run typecheck) || exit 1; done

test: test-go

test-go:
	@for d in $(SAMPLES_GO); do (cd $$d && go test -race .) || exit 1; done

build-fe:
	@for fe in $(SAMPLES_FE); do (cd $$fe && npm run build) || exit 1; done

verify: lint test build-fe
	@for d in $(SAMPLES_GO); do (cd $$d && go build -o /dev/null .) || exit 1; done
