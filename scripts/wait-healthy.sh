#!/usr/bin/env bash
# Waits until every named container reports "healthy". Usage: ./scripts/wait-healthy.sh helpdesk-backend helpdesk-frontend
set -euo pipefail
deadline=$((SECONDS + ${TIMEOUT:-240}))
for name in "$@"; do
  while true; do
    status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || echo "missing")
    if [ "$status" = "healthy" ] || { [ "$status" = "running" ] && [ -z "$(docker inspect -f '{{if .State.Health}}x{{end}}' "$name")" ]; }; then
      echo "$name: $status"
      break
    fi
    if [ "$status" = "exited" ] || [ "$status" = "dead" ] || [ $SECONDS -ge $deadline ]; then
      echo "$name did not become healthy (status: $status)" >&2
      docker logs --tail 60 "$name" >&2 || true
      exit 1
    fi
    sleep 3
  done
done
