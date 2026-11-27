#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

# Use Compose's dotenv parsing and precedence rules. An empty shell variable
# should not hide a token that is already saved in .env.
if [ -z "${INVENTORY_IMPORT_LOCAL_TOKEN:-}" ]; then
    unset INVENTORY_IMPORT_LOCAL_TOKEN
fi
compose_environment=$(docker compose config --environment)
if ! printf '%s\n' "$compose_environment" | grep -q '^INVENTORY_IMPORT_LOCAL_TOKEN=.'; then
    token=$(openssl rand -hex 32)
    env_file=$(mktemp .env.XXXXXXXX)
    trap 'rm -f "$env_file"' EXIT
    if [ -f .env ]; then
        sed '/^INVENTORY_IMPORT_LOCAL_TOKEN=$/d' .env > "$env_file"
    fi
    printf '\nINVENTORY_IMPORT_LOCAL_TOKEN=%s\n' "$token" >> "$env_file"
    mv "$env_file" .env
    trap - EXIT
    printf '%s\n' 'Saved the local import token in .env. Paste it into Imports → Local operator token.'
fi

exec docker compose up --build "$@"
