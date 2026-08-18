> **Learning goal**
> Distinguish `/srv/data/photos`, `/srv/data/documents`, and `recovery-points/<date>/data/{photos,documents}` without confusing which one is authoritative.

## 2.1 The triad that causes the most confusion

| Path | Disk | Role |
| --- | --- | --- |
| `/srv/data/photos` | Pi SSD, NFS-mounted on `ubuntu-purva` from `192.168.68.110:/srv/data/photos` | **Live Immich tree.** Not a backup. |
| `/srv/data/documents` | Pi SSD, NFS-mounted from `192.168.68.110:/srv/data/documents` | **Live documents share.** A different NFS export of the same Pi filesystem. |
| `/srv/data/backups/recovery-points/<date>/data/photos` | Seagate HDD backup partition (`sdb2`) | Nightly rsync snapshot of live Immich, as it looked on that date. |
| `/srv/data/backups/recovery-points/<date>/data/documents` | Seagate HDD backup partition (`sdb2`) | Nightly rsync snapshot of the documents share, as it looked on that date. |

`df` on the two live NFS mounts can report the **same** total/used capacity, because both are directories on one Pi filesystem, not two separate disks. `du` on each tree is what actually matters, and it diverges: Immich and documents are different byte counts on the same underlying disk.

> Developer analogy
> Two NFS exports of one filesystem are like two S3 prefixes under one bucket. The bucket-level quota is shared; the objects under each prefix are not.

## 2.2 What is inside the Immich tree

Live and snapshot copies of `photos/` share the same shape, because the backup is a straight rsync, not a transformation:

```text
photos/
  library/          # originals Immich ingested — the bulk of the bytes
  thumbs/            # generated thumbnails
  encoded-video/
  upload/
  profile/
  backups/           # Immich's own internal app backups — still part of the live tree
```

`documents/` is a general-purpose share (Google Takeout exports, personal folders, PDFs, occasional macOS AppleDouble sidecar files). It is not curated by Immich and can legitimately contain photo-shaped files — that is source overlap with the photo library, not a second copy of it. A JPEG that lives in both `library/` and a `Takeout/` folder inside `documents/` is genuinely two different files on disk, even if the pixels are identical.

## 2.3 A snapshot that matches its source exactly

Illustrative sizes from 18 August 2026 (these numbers drift daily; the design does not):

| Tree | Approx size | Approx files |
| --- | --- | --- |
| Live `/srv/data/photos` | 42 GB | 35,653 |
| Matching recovery-point `data/photos` | 42 GB | 35,653 |
| Live `/srv/data/documents` | 62 GB | 29,897 |
| Matching recovery-point `data/documents` | 62 GB | 29,897 |

An exact match on the day the snapshot was taken is expected — Module 3 explains how a *daily-looking* folder for every subsequent day can still exist on disk while adding almost no additional bytes.

## 2.4 `latest` is a pointer, not a place

`/srv/data/backups/recovery-points/latest` is a symlink to the newest completed timestamp directory (for example `2026-08-17T203827Z`). It always represents **the current full tree of still-present live data as of the most recent successful run** — everything that currently exists on the Pi, as of last night.

It is not the union of everything ever backed up. A photo you deleted from Immich last month is not in `latest`; it survives only in the older recovery points that were taken before you deleted it, and only until those points age out of retention (Module 6).

> Developer analogy
> `latest` is like the `HEAD` of a git branch: it points at the newest commit, not at every commit that ever existed. A file removed in a later commit is still recoverable from an earlier one — until history gets rewritten (pruned).

## 2.5 The recovery point as a "commit"

Every recovery point directory (`2026-08-17T203827Z/`, etc.) is a complete, self-contained tree — you can `cd` into any one of them and see photos, documents, databases, configs and manifests exactly as they existed at that moment, without needing any other recovery point present. Module 3 explains the mechanism (hardlinks) that makes storing dozens of these "complete" trees affordable on a 1.9 TB partition that is currently only 6% used.

> **Live-vs-snapshot checkpoint**
> A user asks: "Immich shows 35,000 photos, but `du -sh` on the documents share also shows tens of gigabytes of images from a Takeout export — did we accidentally back up Immich twice?" Answer using only the vocabulary from this module.
