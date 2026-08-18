> **Learning goal**
> Name which disk dying this job can survive, and which disasters it cannot.

## 1.1 Two disks, one worked example, two different jobs

This course is about a single systemd oneshot on `ubuntu-purva`: `homelab-hdd-backup.service`. Its purpose is narrow and specific — copy the two authoritative trees on the Pi's SSD, plus a set of application databases and configs on `ubuntu-purva` itself, into daily versioned recovery points on a Seagate HDD:

```text
Internet -> VPS Caddy -> WireGuard -> ubuntu-purva (production Docker, app DBs)
                                        |
                                        +-- NFS LAN --> pi-purva 1 TB SSD
                                              /srv/data/photos      (Immich)
                                              /srv/data/documents   (general share)
                                              /srv/data/media  <-- NFS-mounted too, NOT backed up by this job

hp-purva (Proxmox)
  VM 100 ubuntu-purva   <-- backup job runs here
  VM 101 homeassistant
  VM 102 hp-codex
  VM 103 hp-claude

Seagate HDD (physically one disk, two ext4 partitions, both live on ubuntu-purva)
  /dev/sdb1  UUID c893acec-...  -> /srv/data/media     (~5.5T, Jellyfin library)
  /dev/sdb2  UUID f30edbde-...  -> /srv/data/backups   (~1.9T, recovery points)
```

Two facts anchor everything that follows: the data being protected (photos, documents) lives on a **different physical machine** (`pi-purva`) from the disk it is copied to (`ubuntu-purva`'s Seagate HDD). And the Seagate HDD itself holds **two partitions that have nothing to do with each other** — `media` and `backups` — because they happen to share one physical spindle.

> Developer analogy
> Think of the Seagate HDD as a single EC2 instance running two unrelated services that happen to share a disk. A backup strategy for one of those services says nothing about the other unless you check explicitly.

## 1.2 What this job actually protects

| Live data | Where it physically lives | Copied by this job? |
| --- | --- | --- |
| `/srv/data/photos` (Immich) | Pi SSD (`pi-purva`) | Yes — `data/photos/` in every recovery point |
| `/srv/data/documents` | Pi SSD (`pi-purva`) | Yes — `data/documents/` in every recovery point |
| Immich PostgreSQL | `ubuntu-purva` Docker (`immich_postgres`) | Yes — a `pg_dump` custom-format file, not a raw file copy |
| Jellyfin, arr-stack, Beszel SQLite databases | `ubuntu-purva` Docker volumes | Yes — via SQLite's online backup API |
| Jellyfin, arr-stack, Jellyfin Control, ToolHub, Beszel-agent configs | `ubuntu-purva` bind mounts | Yes — as `configs/*` (live DB/WAL/journal/log files excluded) |
| ToolHub Redis (BuzzWatch) | `ubuntu-purva` Docker volume | Yes — after a `BGSAVE` |
| `/srv/data/media` (Jellyfin library) | Seagate HDD `sdb1`, `ubuntu-purva` | **No.** Never referenced anywhere in the backup script. |

## 1.3 What this job can and cannot survive

| Failure scenario | Survives? | Why |
| --- | --- | --- |
| Pi SSD dies entirely | **Yes** | Photos and documents are rsynced nightly to a physically separate disk on `ubuntu-purva`. |
| Immich PostgreSQL gets corrupted | **Yes**, to the last nightly dump | A fresh `pg_dump --format=custom` is taken every run, validated with `pg_restore --list`. |
| A Jellyfin/arr SQLite file gets corrupted | **Yes**, to the last nightly copy | Copied through SQLite's online backup API and checked with `PRAGMA integrity_check` before being trusted. |
| A photo or document is accidentally deleted today | **Yes, until it ages out of retention** | The script never runs `rsync --delete` against a source. The deleted file still exists, hardlinked, in every older recovery point until pruning removes that point (Module 6). |
| The Seagate HDD itself fails | **No** | `data/backups` (`sdb2`) is a separate partition from `data/media` (`sdb1`), but it is the same physical spindle. Losing the drive loses every recovery point and the media library together. |
| Fire, theft, or site-wide electrical damage at the physical location | **No** | Source (Pi) and backup (Seagate HDD on `ubuntu-purva`) are in the same building, on the same power. There is no offsite copy. |
| The Jellyfin media library is lost | **No** | `/srv/data/media` is explicitly out of scope — see 1.2. |

This table is the whole point of the module: a backup job's value is defined as much by what it deliberately excludes as by what it copies. The two exclusions to hold onto for the rest of this course are the media library (never touched) and offsite protection (not yet built — the implementation notes call this out explicitly as a known limitation, not an oversight).

> **Failure-domain checkpoint**
> If someone proposes "let's also back up `/srv/data/media` onto the same `backups` partition," what single fact from 1.1 makes that a bad idea on its own, even before considering the extra disk space it would need?
