> **Learning goal**
> Explain how a full-looking daily folder can add almost no disk, and how the job survives being interrupted mid-run.

## 3.1 The units

| Unit | Role |
| --- | --- |
| `homelab-hdd-backup.timer` | `OnCalendar=*-*-* 02:00:00 Asia/Kolkata`, `RandomizedDelaySec=10m`, `Persistent=true` |
| `homelab-hdd-backup.service` | `Type=oneshot`, `ExecStart=/usr/local/sbin/homelab-hdd-backup`, `Nice=10`, `IOSchedulingClass=best-effort`/`IOSchedulingPriority=6`, `TimeoutStartSec=12h` |
| `homelab-hdd-backup-verify.timer` | `OnCalendar=*-*-01 06:00:00 UTC`, `RandomizedDelaySec=30m`, `Persistent=true` |
| `homelab-hdd-backup-verify.service` | `Type=oneshot`, `ExecStart=/usr/local/sbin/homelab-hdd-backup-verify`, `Nice=10`, `IOSchedulingPriority=7`, `TimeoutStartSec=2h` |

`Persistent=true` on both timers means a missed 02:00 IST or monthly 06:00 UTC start (VM powered off, host rebooting) is not skipped — systemd runs it as soon as the timer unit is next loaded. `Nice=10` and a `best-effort` IO class keep a twelve-hour worst case from starving Docker and ToolHub on the same VM. The timer is normally `active`; the service is normally `inactive` except during a run — that split is intentional, not a symptom of anything broken.

> Developer analogy
> A `.timer` unit is a cron entry with memory: it can catch up on a run it missed, the way a delayed queue message still gets processed instead of silently vanishing.

## 3.2 One lock file, two competing jobs

Both the backup and the verify script open the same file, `/run/lock/homelab-hdd-backup.lock`, and take a non-blocking `flock`:

```bash
exec 9>"${lock_file}"
flock -n 9 || fail "another backup is already running"
```

If the monthly verify timer fires while a backup happens to still be running, the verifier's `flock -n` call fails immediately and it exits with an error rather than reading a half-written recovery point. The reverse is also true. One lock file, shared by both scripts, is what makes that mutual exclusion possible without any other coordination.

## 3.3 rsync with `--link-dest`: the hardlink trick

Every tree copy in the job goes through one helper:

```bash
rsync_snapshot() {
  local args=(-aHAXx --numeric-ids --partial --human-readable --stats)
  [[ -n "${previous_path}" ]] && args+=(--link-dest="${previous_path}")
  rsync "${args[@]}" "$@" "${source%/}/" "${destination}/"
}
```

| Flag | Effect |
| --- | --- |
| `-a` | Archive mode: recursive, preserves permissions, timestamps, symlinks |
| `-H` | Preserve hardlinks that already exist in the source |
| `-A` `-X` | Preserve ACLs and extended attributes |
| `-x` | Do not cross filesystem boundaries |
| `--numeric-ids` | Copy UID/GID numbers, not names — safe across hosts with different `/etc/passwd` |
| `--partial` | Keep partially transferred files instead of deleting them, so a resumed run does not re-send completed bytes |
| `--link-dest=<previous>` | For any file unchanged since the previous recovery point, create a **hardlink** into today's folder instead of copying data |

`--link-dest` is why a snapshot that looks like a full copy of a 42 GB, 35,653-file Immich library can, on a day with no new photos, add close to zero bytes of file data to the backup partition. Every unchanged file becomes one more directory entry pointing at the same inode that the previous recovery point already paid for. Only genuinely new or modified files consume new disk space. This is the mechanism behind the brief's headline number: six recovery points, ~110 GB used out of 1.9 TB — nowhere near six times the size of one day's data.

> Developer analogy
> An inode is a blob with many directory entries, the same way a git blob can be referenced by many commits' trees without being stored twice. A recovery point is the equivalent of a commit: cheap to create when little has changed, because it mostly reuses objects that already exist.

`previous` is resolved once, from the `latest` symlink, before any copying starts:

```bash
if [[ -L "${latest}" ]]; then
  previous="$(readlink -f "${latest}" || true)"
fi
```

Each dated tree therefore chains against the one immediately before it — not against some fixed "base" snapshot — so the hardlink savings compound across the whole retained history, not just one day back.

## 3.4 Surviving an interrupted run

The job never writes directly into a final, publicly-visible directory. It writes into a hidden staging directory first:

```bash
work="${snap_root}/.incomplete-${stamp}"
...
mv "${work}" "${final}"
ln -sfn "${stamp}" "${latest}.new"
mv -Tf "${latest}.new" "${latest}"
```

If the job is killed midway — VM reboot, `TimeoutStartSec=12h` exceeded, power loss — the `.incomplete-<stamp>` directory is left behind with whatever it managed to copy. On the next run, the script looks for the newest `.incomplete-20*` directory and resumes into it rather than starting over:

```bash
work="$(find "${snap_root}" -mindepth 1 -maxdepth 1 -type d -name '.incomplete-20*' \
  -printf '%T@|%p\n' | sort -nr | head -n 1 | cut -d'|' -f2-)"
```

Because `rsync --partial` left completed files intact and in place, resuming an interrupted tree copy re-checks what is already there rather than re-transferring it. Only once every step succeeds — both rsync passes, the database dumps, every config tree — is the staging directory `mv`'d to its final timestamped name, and only then does `latest` get repointed, via a `.new` symlink plus an atomic rename (`mv -Tf`) so `latest` is never observed pointing at a half-written path.

Directories still named `.incomplete-*` and older than two days are treated as abandoned and deleted at the end of a later successful run — not left to accumulate forever.

> **Nightly-job checkpoint**
> Two nights in a row, nothing changes in `/srv/data/photos`. Roughly how much additional disk space should the second night's recovery point consume for the photo tree, and which single rsync flag makes that true?
