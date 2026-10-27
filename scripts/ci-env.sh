#!/usr/bin/env bash
# Creates a throwaway .env for CI (or a fresh machine) from .env.example, with random secrets.
# Never commit the result. Usage: ./scripts/ci-env.sh   (refuses to overwrite an existing .env unless FORCE=1)
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ] && [ "${FORCE:-0}" != "1" ]; then
  echo ".env already exists; set FORCE=1 to overwrite it" >&2
  exit 1
fi

cp .env.example .env
secret() { openssl rand -hex "${1:-24}"; }
set_value() { sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak; }

set_value POSTGRES_PASSWORD "$(secret)"
set_value APP_DB_PASSWORD "$(secret)"
set_value REDIS_PASSWORD "$(secret)"
set_value JWT_SECRET "$(secret 48)"
echo ".env created with random secrets"
