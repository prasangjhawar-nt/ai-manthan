# secrets/

Files here are git-ignored (only this README is committed).

- `db_password.txt` – created by `scripts/check.ps1` (value `app` for dev). Planned as the Docker secret `db_password`
  once the backend reads `/run/secrets/` via `spring.config.import=optional:configtree:/run/secrets/` (devops.md 6.1).
  Until then the password comes from `POSTGRES_PASSWORD` (default `app`).
