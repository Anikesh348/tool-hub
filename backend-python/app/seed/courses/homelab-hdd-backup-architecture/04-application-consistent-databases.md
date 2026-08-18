> **Learning goal**
> Contrast rsync of files with SQLite `.backup`, `pg_dump`, and Redis `BGSAVE`, and explain why a live database needs more than a file copy.

## 4.1 Why rsync alone is unsafe for a live database

`rsync -aHAXx` copies bytes from a source path to a destination path. It has no idea that `sonarr.db` is a SQLite file with a write-ahead log, or that `immich_postgres`'s data directory is a running PostgreSQL cluster mid-transaction. If rsync copies those files while a write is in flight, it can capture a torn page: table data reflecting one point in time and an index or WAL file reflecting another. The copy opens without an error and looks fine — until a query touches the inconsistent part.

This is why the backup job's `common_excludes` explicitly strips live database files out of every config-tree copy:

```bash
common_excludes=(--exclude='*.db' --exclude='*.db-wal' --exclude='*.db-shm' --exclude='*.sqlite' \
  --exclude='*.sqlite-wal' --exclude='*.sqlite-shm' --exclude='*.journal' --exclude='logs/' --exclude='log/')
```

Every one of those excluded files is instead captured through its own engine's native, consistency-aware mechanism, and stored separately under `databases/` rather than `configs/`.

## 4.2 PostgreSQL: `pg_dump`, taken during a short write pause

Immich's PostgreSQL database is dumped, not file-copied:

```bash
docker exec immich_postgres sh -ceu \
  'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=6 --no-owner --no-acl' \
  > "${work}/databases/immich-postgres-${stamp}.dump"
```

`--format=custom` produces a `pg_restore`-compatible archive rather than plain SQL, `--compress=6` shrinks it, and `--no-owner --no-acl` make the dump portable to a restore target where the exact same role names might not exist. `pg_dump` takes a transactionally consistent snapshot of the database as of the moment it starts — it does not require stopping PostgreSQL. What the job *does* stop, briefly, is `immich_server` (the application, not the database) — Module 5 explains why the consistency window is scoped to the app container and not the database container.

The dump is validated immediately, not just trusted:

```bash
[[ -s "${db_dump}" ]] || fail "Immich PostgreSQL dump is empty"
docker exec -i immich_postgres pg_restore --list < "${db_dump}" \
  > "${work}/manifests/immich-postgres-restore-list.txt"
```

`pg_restore --list` reads the archive's table of contents without actually restoring anything — a cheap way to prove the dump file is structurally valid the same night it was created, and it leaves behind `manifests/immich-postgres-restore-list.txt` as a permanent record of exactly what that dump contains.

## 4.3 SQLite: the online backup API, plus an integrity check

Every SQLite database in the stack goes through the same two-step helper:

```bash
sqlite_backup() {
  sqlite3 "${source}" ".timeout 30000" ".backup '${destination}'"
  [[ "$(sqlite3 "${destination}" 'PRAGMA integrity_check;')" == ok ]] || fail "SQLite integrity failed for ${name}"
}
```

`.backup` is SQLite's own online backup API, invoked through the `sqlite3` CLI — it copies the database page-by-page under SQLite's own locking, safely, even while the source database is open and being written to by the live application. `.timeout 30000` gives it up to 30 seconds to acquire the lock it needs rather than failing immediately under contention. After the copy, `PRAGMA integrity_check` is run against the **copy**, and the job hard-fails if it does not report `ok` — a corrupt backup is treated as a failed backup, not a partial success.

Databases captured this way:

| Database | Source |
| --- | --- |
| `jellyfin` | Jellyfin main library DB |
| `jellyfin-playback-reporting`, `jellyfin-introskipper`, `jellyfin-introskipper-cache` | Jellyfin plugin data |
| `sonarr`, `radarr`, `lidarr`, `bazarr`, `prowlarr` | arr-stack config/state |
| `beszel-data`, `beszel-auxiliary` | Beszel Hub's PocketBase files, backed up even while the Hub container is stopped, so the backup stays correct if it is later re-enabled |

## 4.4 Redis: `BGSAVE`, then wait for it to actually finish

`tool-hub_buzzwatch-redis` (ToolHub's Redis) is asked to persist a consistent snapshot before its volume is copied:

```bash
docker exec toolhub-redis redis-cli BGSAVE
# poll until rdb_bgsave_in_progress == 0
# then require rdb_last_bgsave_status == ok
rsync_snapshot "${redis_volume}" configs/docker-volumes/tool-hub_buzzwatch-redis
```

`BGSAVE` forks and writes a point-in-time RDB snapshot in the background; the script polls Redis's own `INFO persistence` output rather than sleeping a fixed amount of time, so it waits exactly as long as the save actually takes, then confirms `rdb_last_bgsave_status: ok` before trusting the volume is safe to rsync. Only after that check passes does the ordinary `rsync_snapshot` helper copy the volume's files — at that point they are a completed, static snapshot, so a plain file copy is fine.

## 4.5 What lands in `databases/`

```text
databases/
  immich-postgres-<stamp>.dump      # pg_dump custom format
  sqlite/
    jellyfin.db
    sonarr.db
    radarr.db
    ...                              # every DB from 4.3, each already integrity-checked
```

Everything else — Redis, Docker-volume caches, application config directories — lands under `configs/` instead, using the plain rsync path from Module 3, because by the time it is copied it is either not a live database at all, or has already been made safe to copy (the Redis case above).

> **Consistency checkpoint**
> A teammate suggests simplifying the job by rsyncing PostgreSQL's raw data directory (`/var/lib/postgresql/data`) instead of running `pg_dump`. What specific failure mode from 4.1 does that reintroduce, and what would the SQLite equivalent of that mistake look like?
