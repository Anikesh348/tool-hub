> **Learning goal**
> State what is kept forever versus what ages out, and why a restore always lands in a temp tree first.

## 6.1 The retention shape: daily, weekly, monthly, overlapping

At the end of every successful run, `prune_recovery_points()` decides what survives using three independent, overlapping rules:

| Rule | Keeps |
| --- | --- |
| Daily | The newest 14 recovery points, full stop |
| Weekly | The newest recovery point from each of the last 8 distinct ISO weeks |
| Monthly | The newest recovery point from each of the last 12 distinct calendar months |

```bash
mapfile -t points < <(find "${snap_root}" -mindepth 1 -maxdepth 1 -type d \
  -regex '.*/20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z' -printf '%f\n' | sort -r)
for point in "${points[@]}"; do
  (( i < 14 )) && keep["${point}"]=1
  week="$(date -u -d "@${epoch}" +%G-W%V)"; month="${point:0:7}"
  if [[ -z "${weeks[${week}]:-}" && "${#weeks[@]}" -lt 8 ]]; then weeks["${week}"]="${point}"; keep["${point}"]=1; fi
  if [[ -z "${months[${month}]:-}" && "${#months[@]}" -lt 12 ]]; then months["${month}"]="${point}"; keep["${point}"]=1; fi
done
```

Because the three rules are evaluated together and simply mark the same `keep[]` map, their kept sets **overlap** rather than stack — a point from three days ago is very likely kept by both the daily rule and the weekly rule simultaneously, and it only counts once. This is why the actual retained count is smaller than "14 + 8 + 12 = 34": most of the weekly and monthly picks are the same physical directories the daily rule was already keeping.

The practical effect: fine-grained recovery (any point in roughly the last two weeks) close to the present, coarsening to one snapshot per week for the last two months, coarsening further to one per month for the last year. A photo deleted from Immich today is fully recoverable for at least 14 days without question, and — if it happened to still exist at the moment a weekly or monthly point was taken — potentially much longer.

## 6.2 Two hard-coded safety checks around deletion

Every candidate for deletion passes through one more check before `find ... -delete` actually runs:

```bash
target="${snap_root}/${point}"
[[ "${target}" == "${snap_root}"/20* && "${target}" != "${final}" ]] || fail "unsafe prune target ${target}"
```

The first half of that condition constrains deletion to paths that look like `recovery-points/20*` — a defense against the variable ever accidentally holding something else. The second half is more important operationally: **the recovery point this exact run just created (`final`) can never be pruned in the same run that created it**, even if the retention math would otherwise discard it (which it never would, since it is always the newest daily point — but the check exists regardless, as a hard invariant rather than something inferred from the schedule).

A separate, narrower cleanup runs after pruning: `.incomplete-*` staging directories older than two days are deleted, through the same "does the path look like what I expect" guard seen in Module 3. This is unrelated to the retention policy — it is cleanup of abandoned partial runs, not aging-out of completed ones.

## 6.3 Restore discipline

The implementation notes are explicit about restore order, and it is worth stating as a rule rather than a suggestion: **do not restore over live application data.** The documented sequence is:

1. Restore into a temporary directory first.
2. Validate what you restored (integrity checks, spot-checking file counts against `manifests/files.txt`, or for a database, actually opening it).
3. Stop only the one affected application — not the whole stack.
4. Take a fresh pre-restore backup of the current (about-to-be-overwritten) state, in case the restore itself turns out to be the wrong call.
5. Then, and only then, perform the targeted restore into the live location.

What each artifact restores with:

| Artifact | Restore tool | Why |
| --- | --- | --- |
| `databases/immich-postgres-<stamp>.dump` | `pg_restore` | It is a `pg_dump --format=custom` archive, not plain SQL — `pg_restore --list` (Module 4) already proved it is structurally readable. |
| `databases/sqlite/*.db` | Copy directly | Each file is already a standalone, validated SQLite database — no separate restore tool needed. |
| `data/photos/`, `data/documents/` | `rsync`/`cp` from the recovery point | Ownership, permissions, ACLs, extended attributes and hardlinks are preserved by the same `-aHAXx` flags used to create them. |

`manifests/files.txt` (every file in the recovery point, path and size) and `manifests/backup-metadata.txt` (host, backup UUID, sources, the exact `immich_postgres` image tag at backup time) exist specifically to make step 2 — validating a restore candidate before touching production — possible without guessing.

## 6.4 Tying the course together

Six modules, one thread: a nightly oneshot that knows exactly which two disks it is allowed to touch (5.1), copies two live NFS trees and a set of application state cheaply by reusing unchanged inodes (3.3), makes a short, coordinated pause around the one application that needs transactional consistency (5.2), captures every database through its own engine's safe export mechanism instead of a raw file copy (4.1–4.4), and ages its own history down through three overlapping windows so that recent mistakes are cheaply reversible while old history costs almost nothing to keep (6.1) — all while remaining honest, in its own documentation, about the one class of disaster it was never designed to survive (1.3).

> **Retention checkpoint**
> A recovery point from 40 days ago still exists. Using only the three rules in 6.1, explain the one condition under which that is expected, and what it implies about which calendar day it was taken on.
