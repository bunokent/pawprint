#!/bin/sh
# PawPrint container entrypoint: wait for PostgreSQL, migrate, then run the
# service command passed by docker-compose (runserver / celery worker).
set -eu

cd /app/backend

python - <<'PY'
import os
import socket
import sys
import time

host = os.environ.get("POSTGRES_HOST", "postgres")
port = int(os.environ.get("POSTGRES_PORT", "5432"))
for attempt in range(60):
    try:
        socket.create_connection((host, port), timeout=2).close()
        print(f"[entrypoint] postgres reachable at {host}:{port}", flush=True)
        sys.exit(0)
    except OSError:
        if attempt % 10 == 0:
            print(f"[entrypoint] waiting for postgres at {host}:{port} ...", flush=True)
        time.sleep(1)
sys.exit(f"[entrypoint] postgres at {host}:{port} never became reachable")
PY

python manage.py migrate --noinput

exec "$@"
