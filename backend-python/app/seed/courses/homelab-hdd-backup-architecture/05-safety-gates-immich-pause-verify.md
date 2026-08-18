> **Learning goal**
> Explain why the job refuses to run, and what the monthly verifier checks.

## 5.1 Preflight: fail loud, before writing anything

Before the script creates a single directory, it checks six conditions and aborts (`fail()` logs and `exit 1`) if any of them are false:

```bash
[[ "$(hostname)" == "ubuntu-purva" ]] || fail "must run on ubuntu-purva"
findmnt ... UUID=f30edbde... -t ext4 ... == /srv/data/backups   || fail "backup UUID is not mounted at ..."
findmnt ... 192.168.68.110:/srv/data/photos -t nfs4 ...          || fail "Pi photos NFS export is not mounted correctly"
findmnt ... 192.168.68.110:/srv/data/documents -t nfs4 ...       || fail "Pi documents NFS export is not mounted correctly"
findmnt ... UUID=c893acec... -t ext4 ... == /srv/data/media      || fail "media UUID is not mounted correctly"
use_percent=$(df --output=pcent /srv/data/backups ...)
[[ "${use_percent}" -lt 85 ]] || fail "backup filesystem is at or above 85 percent"
```

Every check identifies its target by **UUID or exact NFS export**, not by mount path alone. A mount path can be satisfied by the wrong filesystem (an empty directory, a different disk mounted after a reboot in the wrong order); a UUID cannot. If the Seagate HDD were to fail and get replaced, or a `fstab` entry got edited wrong, this job stops itself instead of quietly writing a "backup" to whatever happens to be sitting at `/srv/data/backups` that day — including, worst case, the VM's root filesystem.

The 85% usage gate exists for a different reason: `--link-dest` (Module 3) makes disk usage hard to predict from file count alone, and a run that fills the destination partition mid-write is worse than a run that never starts — it can leave a half-written recovery point and a full disk. Refusing to start above 85% leaves headroom for the run itself plus whatever growth happens before the next prune.

## 5.2 The two-pass Immich strategy

Immich is the one live application the job actively coordinates with, because photos keep arriving while the backup runs and the Postgres dump needs a moment where nothing is changing underneath it.

```text
1. rsync_snapshot photos   <-- online, Immich fully running, large transfer
2. rsync_snapshot documents <-- online, unrelated to Immich
3. docker stop immich_server (60s timeout)     <-- app paused, Postgres/Redis stay up
4. pg_dump immich_postgres                      <-- consistent dump taken here
5. rsync_snapshot photos again                  <-- short delta: anything Immich wrote just before the pause
6. docker start immich_server, poll health      <-- up to 24 x 5s = 120s
```

The expensive part (a 42 GB photo tree) happens **before** anything is paused. Only the short reconciliation pass and the database dump happen while `immich_server` is stopped — `immich_postgres` and Redis are never stopped, so the outage visible to a user is "Immich briefly errors," not "the whole stack goes down."

Before pausing anything, the script re-confirms Immich was actually healthy going in:

```bash
immich_was_running="$(docker inspect -f '{{.State.Running}}' immich_server 2>/dev/null || echo false)"
[[ "${immich_was_running}" == true ]] || fail "Immich server was not running before consistency window"
[[ "$(docker inspect -f '{{.State.Health.Status}}' immich_postgres ...)" == healthy ]] \
  || fail "Immich PostgreSQL is not healthy"
```

If Immich was already down before the backup even started, the job refuses to touch it further and fails outright, rather than "backing up" an already-broken state and reporting success.

## 5.3 Crash safety around the pause

```bash
trap restore_immich EXIT
```

`restore_immich()` runs on *any* exit from the script — success, `fail()`, or an uncaught error under `set -Eeuo pipefail` — and restarts `immich_server` if the script's own bookkeeping (`immich_was_running`) shows it stopped Immich but never got to the point of restarting it. If the machine loses power between `docker stop immich_server` and `docker start immich_server`, the next boot's shell does not fix this automatically — but the very next invocation of the script, or a manual check of `docker ps`, is the operator's signal, and the trap guarantees that any *survived* failure inside the script itself doesn't leave Immich down.

## 5.4 What the monthly verifier actually checks

`homelab-hdd-backup-verify.service` runs once a month and reuses the same lock file as the backup job, so the two can never run concurrently:

```bash
latest="$(readlink -f "${snap_root}/latest")"
[[ "${latest}" == "${snap_root}"/20* && -d "${latest}" ]] || fail "latest recovery point is invalid"

sha256sum -c manifests/SHA256SUMS                                    # every database file's checksum
docker exec -i immich_postgres pg_restore --list < *.dump >/dev/null # dump is still structurally readable
for db in databases/sqlite/*.db; do
  sqlite3 "$db" 'PRAGMA integrity_check;'                            # every SQLite copy, re-checked
done
find data/photos -type f -print -quit | grep -q .                     # not empty
find data/documents -type f -print -quit | grep -q .                  # not empty
```

Two things are worth being precise about, because they are easy to overstate. First, `SHA256SUMS` is generated by the backup job from `find databases -type f | sha256sum`, so verify's hash check covers **the database dumps only** — `pg_restore --list` and the SQLite `PRAGMA integrity_check` calls are what re-validate those same files' internal structure a month later, on top of the hash. Second, the photo and document trees are checked for **non-emptiness**, not re-hashed file-by-file — verify confirms the recovery point has real data in it, not that every one of tens of thousands of files is byte-identical to its source. A full content re-verification of the file trees is not part of this design; it is a scope boundary worth naming rather than assuming away.

> **Safety-gate checkpoint**
> The Pi is rebooting for a kernel update at 2:03 AM IST, right when the timer's `RandomizedDelaySec` happens to fire the job. Walk through which preflight check catches this, and what the operator sees in the logs versus what they would see if that check did not exist.
