#!/bin/sh
set -e

PB="/pb/pocketbase"
FLAGS="--dir=/pb/pb_data --hooksDir=/pb/pb_hooks --migrationsDir=/pb/pb_migrations --publicDir=/pb/pb_public"

# Encrypt stored settings (e.g. the SMTP password) when a 32-char key is provided.
if [ -n "$PB_ENCRYPTION_KEY" ]; then
  FLAGS="$FLAGS --encryptionEnv=PB_ENCRYPTION_KEY"
fi

# Run migrations first so the superuser/collections exist.
$PB migrate up $FLAGS

# Create or update the dashboard superuser from env.
if [ -n "$PB_ADMIN_EMAIL" ] && [ -n "$PB_ADMIN_PASSWORD" ]; then
  $PB superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" $FLAGS || echo "warning: superuser upsert failed"
fi

exec $PB serve --http=0.0.0.0:8090 $FLAGS
