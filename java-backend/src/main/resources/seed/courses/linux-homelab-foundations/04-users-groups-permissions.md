> By the end of this module
> You can trace a process's numeric identity, read file and directory modes, calculate octal permissions, change ownership safely, predict umask, explain sudo and passwordless sudo, and diagnose Docker/NFS UID mismatches.

## 4.1 Linux authorizes processes, not usernames floating in the air

A user account is a persistent record used for login and identity lookup. A running process carries numeric credentials: user IDs, group IDs and capabilities. A filesystem object carries numeric owner UID, group GID and permission bits. When the process requests an operation, the kernel compares those credentials with the object's metadata and other security rules.

> The central question
> Do not ask only 'what permissions does this file have?' Ask: which exact process, with which UID and groups, is attempting which operation on which path?

| Concept | Persistent record | Runtime / filesystem use |
| --- | --- | --- |
| User | /etc/passwd or another identity source | A process carries real/effective/saved UIDs |
| Group | /etc/group or another identity source | A process carries primary and supplementary GIDs |
| File owner | Numeric UID in inode metadata | May receive the owner permission triplet |
| File group | Numeric GID in inode metadata | Matching group members may receive group triplet |
| Root | Account whose UID is 0 | Specially privileged; still affected by some kernel/filesystem boundaries |

## 4.2 Where account names come from

The local user database is traditionally /etc/passwd. Despite the name, it does not contain modern password hashes; those are normally protected in /etc/shadow. Group definitions are traditionally in /etc/group. The Name Service Switch can also use directory services or other sources, so prefer getent over directly parsing one file.

### Decode the anikesh348 account

A passwd entry has seven colon-separated fields: login name, password placeholder, UID, primary GID, comment, home directory and login shell.

```bash
getent passwd anikesh348
```

Typical output

```bash
anikesh348:x:1000:1000:Ubuntu:/home/anikesh348:/bin/bash
```

| Field | Value here | Meaning |
| --- | --- | --- |
| Login name | anikesh348 | Human-friendly label entered at login |
| Password field | x | Protected password information is stored elsewhere |
| UID | 1000 | Numeric user identity used by kernel/filesystems |
| Primary GID | 1000 | Default primary group for new processes/files |
| Comment | Ubuntu | Descriptive field; not authorization |
| Home | /home/anikesh348 | Initial personal directory and HOME value |
| Shell | /bin/bash | Program normally started for a shell login |

There can be many accounts and groups. The UID and GID fields are finite integers with a very large practical range, but distributions reserve ranges for system accounts and allocate regular human accounts from a policy range. Limits you encounter first are administrative conventions and file-format/protocol compatibility, not a tiny fixed count.

## 4.3 Why anikesh348 is 1000 and root is 0

During Ubuntu installation or initial provisioning, the first ordinary account is normally assigned UID 1000 and a same-named primary group with GID 1000. That allocation created the local mapping anikesh348 -> 1000 on hp-codex. Root is the historic superuser account and has UID 0.

> Names do not travel automatically
> A file may store owner UID 1000. One server can display that number as anikesh348, another as codexops, and a third as an unknown numeric owner. The inode stores the number, while each host performs its own name lookup.

### Compare names and raw numbers

id -u prints the effective UID, -g the effective primary GID, and -G all group IDs. ls -n suppresses friendly-name lookup and exposes numeric ownership.

```bash
id
id -u
id -g
id -G
ls -ldn /home/anikesh348
ls -ld /home/anikesh348
```

Typical output

```bash
1000
1000
1000 4 24 27 30 105
drwxr-x--- ... 1000 1000 ... /home/anikesh348
drwxr-x--- ... anikesh348 anikesh348 ... /home/anikesh348
```

## 4.4 Read the ten characters from ls -l

For drwxr-x---, the first character is the object type. The remaining nine are three permission triplets: owner, group and other. 'Other' means every process that is neither the file owner nor a member of the file's group.

| d | rwx | r-x | --- |
| --- | --- | --- | --- |
| type | owner | group | other |

| Position | Here | Meaning |
| --- | --- | --- |
| 1 | d | This object is a directory |
| 2-4 owner | rwx | The owner can list names, create/remove entries and traverse |
| 5-7 group | r-x | Matching group members can list names and traverse, but not modify entries |
| 8-10 other | --- | All remaining users receive no ordinary mode permission |

## 4.5 r, w and x mean different things for files and directories

| Bit | On a regular file | On a directory |
| --- | --- | --- |
| r (read) | Read the file's bytes | List the names stored in the directory |
| w (write) | Modify or truncate the file's bytes | Create, delete or rename directory entries, normally also requiring x |
| x (execute) | Request execution as a program/script; content/interpreter must also be valid | Traverse/search: pass through it and access known child names |

> The surprising deletion rule
> Deleting a file usually changes the parent directory entry, not the file bytes. Therefore, someone with write + execute on the parent directory may delete or replace a root-owned mode 644 file even though they cannot edit the file's bytes directly. The sticky bit can add a restriction.

| Directory mode situation | What a process can generally do |
| --- | --- |
| r but no x | See entry names, but cannot stat/open children through that directory normally |
| x but no r | Access a child if its exact name is known and later permissions allow it, but cannot list all names |
| w + x | Create/remove/rename entries, subject to sticky bit and other rules |
| No x on a parent | Cannot traverse to deeper path components even if the final file is world-readable |

## 4.6 Which triplet does the kernel choose?

For traditional mode bits, the kernel chooses one class; it does not combine the best bits from several classes. A simplified decision is:

| Test | Selected permission class |
| --- | --- |
| Does the process's effective UID equal the object's owner UID? | Yes -> use owner bits and stop |
| Otherwise, is the object's GID in the process's effective/supplementary groups? | Yes -> use group bits and stop |
| Otherwise | Use other bits |

Then the kernel checks whether that class permits the requested operation on every relevant path component. Access Control Lists, capabilities, read-only mounts, immutable attributes, NFS server rules, container namespaces and security modules may add further decisions. Mode bits are foundational, not the entire security model.

## 4.7 Octal permissions are three small sums

Each permission bit has a value: read = 4, write = 2, execute = 1. Add the allowed bits inside each triplet. Then write owner, group and other digits in that order. You are converting three independent three-bit values, not memorising mysterious numbers.

| Digit | Bits | Meaning |
| --- | --- | --- |
| 0 | --- | No permissions |
| 1 | --x | Execute/traverse only |
| 2 | -w- | Write only |
| 3 | -wx | Write + execute |
| 4 | r-- | Read only |
| 5 | r-x | Read + execute |
| 6 | rw- | Read + write |
| 7 | rwx | Read + write + execute |

| Mode | Calculation | Common interpretation |
| --- | --- | --- |
| 600 | owner 4+2; group 0; other 0 | Private readable/writable regular file |
| 640 | owner 4+2; group 4; other 0 | Owner edits; group reads; nobody else |
| 644 | owner 4+2; group 4; other 4 | Common non-secret readable configuration/file |
| 700 | owner 4+2+1; group 0; other 0 | Private directory or executable |
| 750 | owner 7; group 4+1; other 0 | Private-ish directory: group can list/traverse |
| 755 | owner 7; group 5; other 5 | Publicly traversable directory or executable program |

> Do not add x to every file
> Directories need execute for traversal. Regular text/config/data files usually do not. An executable bit is a security-relevant declaration that the file may be run; add it only to actual programs/scripts.

## 4.8 chmod changes mode; chown changes owner

The owner (or a sufficiently privileged process) can change mode bits with chmod. Symbolic mode describes an intention; octal describes the complete basic mode. chown changes numeric ownership and normally requires privilege because giving files to another user can bypass quota or security assumptions.

| Command | Translation |
| --- | --- |
| chmod u+x script.sh | Add execute for user/owner; leave all other bits unchanged |
| chmod g-w file | Remove write from group; leave all other bits unchanged |
| chmod o= file | Set other permissions to none |
| chmod 640 file | Set complete basic mode to rw-r----- |
| chgrp media file | Change only group ownership to media |
| sudo chown 1000:1000 file | Change owner UID and group GID to numeric 1000 |
| sudo chown -R user:group dir | Recursively change entire tree; high-impact and must be scoped carefully |

### Hands-on lab: calculate and verify modes

> Safety
> Run this lab on hp-codex. It writes only inside ~/linux-foundations-lab.

Step 1 - Create test objects

A directory and two regular files are created under your home.

```bash
mkdir -p ~/linux-foundations-lab/module-4/private
printf '#!/usr/bin/env bash\nprintf "hello\n"\n' > ~/linux-foundations-lab/module-4/hello.sh
printf 'secret-ish lab text\n' > ~/linux-foundations-lab/module-4/private/note.txt
```

Step 2 - Set complete modes

The private directory is rwxr-x---; the note is rw-r-----; the script is executable by owner and group.

```bash
chmod 750 ~/linux-foundations-lab/module-4/private
chmod 640 ~/linux-foundations-lab/module-4/private/note.txt
chmod 750 ~/linux-foundations-lab/module-4/hello.sh
```

Step 3 - Verify symbolically and numerically

stat must show the exact modes you predicted, not merely an absence of errors.

```bash
stat -c '%A %a %U:%G %n' \
  ~/linux-foundations-lab/module-4/private \
  ~/linux-foundations-lab/module-4/private/note.txt \
  ~/linux-foundations-lab/module-4/hello.sh
```

Step 4 - Change one bit symbolically

Removing group execute changes 750 to 740; other bits remain untouched.

```bash
chmod g-x ~/linux-foundations-lab/module-4/hello.sh
stat -c '%A %a %n' ~/linux-foundations-lab/module-4/hello.sh
```

> What success looks like
> You can calculate 750, 640 and 740 from r=4, w=2, x=1 and explain the meaning separately for the directory, note and script.

Explain it in your own words

•  Why does mode 640 make sense for note.txt but not for a directory that its group must enter?

•  What exact bit changed between 750 and 740?

## 4.9 Every parent directory participates

To open /home/anikesh348/project/config/app.yml, a process needs traverse permission on /, /home, /home/anikesh348, project and config, plus the appropriate permission on app.yml. A world-readable final file can still be unreachable because one parent denies traverse.

### Inspect every path component with namei

namei -l breaks the path into components and displays type, mode and ownership for each. It is one of the fastest ways to diagnose 'Permission denied' when the final file looks correct.

```bash
namei -l /home/anikesh348/linux-foundations-lab/module-4/private/note.txt
```

> Why this matters in your homelab
> A systemd service running as a non-root account may fail with 203/EXEC because it cannot traverse a parent directory containing its executable.

For a real service, test as the service identity instead of merely reading metadata: sudo -u serviceuser test -x /path/to/program. A zero exit status proves that identity can traverse the path and request execution at that moment.

## 4.10 umask controls default mode bits

Programs request an initial mode when creating an object. The process's umask clears selected bits from that request. Typical programs request 666 for regular files (no execute by default) and 777 for directories. With umask 0022, files commonly become 644 and directories 755. With 0027, they commonly become 640 and 750. Think 'requested bits AND NOT umask', not ordinary decimal subtraction.

| Requested | Umask | Typical result | Reason |
| --- | --- | --- | --- |
| file 666 | 0022 | 644 | Clear group-write and other-write |
| directory 777 | 0022 | 755 | Clear group-write and other-write |
| file 666 | 0027 | 640 | Clear group-write and all other bits |
| directory 777 | 0027 | 750 | Clear group-write and all other bits |
| file 666 | 0077 | 600 | Clear every group and other bit |
| directory 777 | 0077 | 700 | Clear every group and other bit |

### Prove umask in a subshell

Parentheses start a subshell. Changing umask there affects only that child shell, so the final umask displays your original interactive setting.

```bash
cd ~/linux-foundations-lab/module-4
( umask 0027; touch umask-file; mkdir umask-dir; stat -c '%a %n' umask-file umask-dir )
umask
```

Typical output

```bash
640 umask-file
750 umask-dir
0022
```

## 4.11 Special mode bits: setuid, setgid and sticky

| Bit | On a regular file | On a directory |
| --- | --- | --- |
| setuid (4xxx) | Executable may run with file owner's effective UID | Usually no useful standard meaning |
| setgid (2xxx) | Executable may run with file group's effective GID | New children normally inherit directory group; useful for shared trees |
| sticky (1xxx) | Usually no useful standard meaning | Only file owner, directory owner or privileged user may remove/rename entries |

### Understand /tmp mode 1777

1777 means sticky bit plus rwx for owner, group and other. Everyone can create entries in /tmp, but the sticky bit prevents arbitrary users from deleting one another's entries merely because the directory is writable.

```bash
stat -c '%A %a %U:%G %n' /tmp
```

Typical output

```bash
drwxrwxrwt 1777 root:root /tmp
```

## 4.12 root versus anikesh348 on hp-codex

| Property | anikesh348 | root |
| --- | --- | --- |
| UID | 1000 | 0 |
| Home | /home/anikesh348, currently mode 750 | /root, currently mode 700 |
| Normal power | Limited by ownership, groups, modes and other controls | May bypass many discretionary permission checks and administer the host |
| Files created normally | Usually owned 1000:1000 | Usually owned 0:0 |
| Interactive use | Preferred for normal work | Avoid persistent root shells; elevate one reviewed command |
| Network/NFS | Remote server evaluates presented/mapped numeric identity | NFS root_squash commonly maps client UID 0 to an anonymous identity |

Root is powerful, not magical. Read-only filesystems, missing kernel capabilities, container namespaces, NFS server-side squashing, cryptographic requirements and remote-system authorization can still deny UID 0. Root also does not make an incorrect command correct.

## 4.13 sudo performs controlled identity change

sudo command consults sudo policy, authenticates when required, records an audit trail and runs the selected command with another identity—root by default. Membership of group sudo commonly grants a broad rule through configuration under /etc/sudoers or /etc/sudoers.d. Always edit sudo policy with visudo, which validates syntax.

### Inspect your effective sudo policy

-l lists allowed commands. -n refuses to prompt for a password, making the observation safe for automation. On hp-codex the output currently contains both a broad ordinary sudo rule and NOPASSWD: ALL.

```bash
sudo -n -l
```

Typical output

```bash
User anikesh348 may run the following commands on hp-codex:
    (ALL : ALL) ALL
    (ALL) NOPASSWD: ALL
```

> How passwordless sudo was configured
> A sudoers rule matching anikesh348 says NOPASSWD: ALL. NOPASSWD suppresses sudo's password challenge; ALL allows all commands (and, depending on the rule form, target identities). It does not turn your ordinary shell into root. Each command becomes privileged only when invoked through sudo—or from a root shell started through it.

Passwordless ALL is convenient but broad: any process that obtains control of the account can request root without a second secret. For automation, narrower command-specific rules are safer when practical. Never broaden production or hypervisor sudo access merely to avoid understanding a permission failure.

### Compare ordinary and elevated identity

The first process has effective UID 1000. sudo starts the selected command with another credential set. -u explicitly chooses the target user.

```bash
id -u
sudo id -u
sudo -u root id
sudo -u nobody id
```

Typical output

```bash
1000
0
uid=0(root) gid=0(root) groups=0(root)
uid=65534(nobody) gid=65534(nogroup) groups=65534(nogroup)
```

## 4.14 Why Docker shows 1000:1000

A Compose declaration such as user: "1000:1000" asks Docker to start the container process with UID 1000 and primary GID 1000 inside the container's user namespace. Most standard Docker setups use the same numeric IDs directly on the host. Bind-mounted files keep host filesystem ownership, so the kernel compares the container process's numeric credentials with the host file's numeric metadata.

| Layer | What 1000:1000 means |
| --- | --- |
| Compose YAML | Requested process UID:GID |
| Container process | Effective user/group used for system calls |
| Host bind mount | Files retain host numeric owner/group metadata |
| Name display | Container may call UID 1000 a different name, or have no name entry at all |
| Authorization | Kernel decides from numbers, mode/ACL bits, mount flags and other controls |

> 1000:1000 is not chmod
> It selects who the process is; it does not grant rwx by itself. A UID 1000 process can write a bind-mounted path only if ownership, groups, modes/ACLs, mount read/write state and any server-side rules permit the requested operation.

### Read-only: inspect Jellyfin's configured identity

Inspect reports the requested container identity string. Docker top shows the host-visible runtime processes. If Compose omits user, the image or default container root identity may apply instead.

```bash
ssh ubuntu-purva \
+  'sudo docker inspect jellyfin --format "user={{.Config.User}}"'
ssh ubuntu-purva 'sudo docker top jellyfin -eo user,pid,group,comm'
```

## 4.15 NFS usually trusts numeric identity

With common NFS AUTH_SYS security, the client sends numeric UID and GID credentials with a request. The NFS server applies permissions to the exported filesystem using those numbers. It does not normally ask whether the same friendly username exists on both machines. Consistent IDs across clients and server therefore matter.

| Example | Server interpretation |
| --- | --- |
| Client process UID 1000 writes a mode 755 directory owned 1000 | Owner class selected; owner has write -> potentially allowed |
| Client process UID 1001 writes that directory | Not owner; group/other selected. If neither has write -> denied |
| Client root UID 0 writes with root_squash | Server maps request to anonymous UID/GID, often 65534; root ownership is not retained |
| NFS mounted ro | Write denied regardless of ordinary mode bits |

> root_squash
> NFS exports commonly enable root_squash: client UID 0 is mapped to an anonymous unprivileged identity on the server. This limits a client root account from automatically acting as server root. It is why 'just run the container as root' may still fail and is not a sound permission strategy.

In your media path, Jellyfin's process identity is evaluated on ubuntu-purva for local traversal and bind-mount access, then its NFS operations are evaluated against pi-purva's exported filesystem. Diagnose both sides. Avoid solving a mismatch with mode 777: that discards boundaries while hiding the identity error.

## 4.16 ACLs add named users and groups

Traditional mode bits provide one owner, one group and one other triplet. A POSIX ACL can grant permissions to additional named users or groups. A trailing plus sign in ls -l may indicate an ACL. The ACL mask limits the effective permissions of named users, named groups and the owning group.

### Inspect ACLs without changing them

The output shows owner, group and ACL entries. If no extended ACL exists, it still shows the base user, group and other entries corresponding to mode bits.

```bash
getfacl -p ~/linux-foundations-lab/module-4/private/note.txt
```

Typical output

```bash
# file: /home/anikesh348/linux-foundations-lab/module-4/private/note.txt
# owner: anikesh348
# group: anikesh348
user::rw-
group::r--
other::---
```

> Do not forget the ACL mask
> A named entry may say rwx while its effective rights are r-x because the mask removes write. Use getfacl and read the effective annotation instead of trusting one line in isolation.

## 4.17 A repeatable permission diagnosis

| Step | Question | Useful evidence |
| --- | --- | --- |
| 1. Operation | Read bytes, write bytes, create, delete, traverse or execute? | Exact command and error |
| 2. Process | Which process performs it? | ps, systemctl show, docker top |
| 3. Identity | What UID, primary GID and supplementary groups? | id; /proc/PID/status |
| 4. Namespace | Which host/container sees which path? | pwd, docker inspect, nsenter when appropriate |
| 5. Parents | Can the identity traverse every component? | namei -l; sudo -u USER test -x |
| 6. Object | Owner, group, mode, type, ACL? | stat, ls -ldn, getfacl |
| 7. Filesystem | Read-only mount, NFS export, squash or stale mount? | findmnt, mount options, server export |
| 8. Reproduce | Can the exact identity perform a tiny equivalent test? | sudo -u USER test ...; container exec |
| 9. Fix | What smallest ownership/mode/group/path correction preserves boundaries? | Backed-up, scoped change |
| 10. Verify | Does the real service path work and survive restart? | Service request, logs, state, reboot/restart where justified |

> Avoid chmod 777 as diagnosis
> 777 changes three permission classes at once and can make an unsafe path appear to work without revealing which identity or bit was required. First inspect; then change the smallest owner, group, ACL or mode that matches the intended access model.

### Capstone lab: explain a permission failure from first principles

> Safety
> Run this lab on hp-codex. It writes only inside ~/linux-foundations-lab.

Step 1 - Build the protected tree

The outer directory permits owner rwx and group r-x; team permits owner rwx, group x; the file permits owner rw and group read.

```bash
mkdir -p ~/linux-foundations-lab/module-4/capstone/team
printf 'deployment notes\n' > ~/linux-foundations-lab/module-4/capstone/team/notes.txt
chmod 750 ~/linux-foundations-lab/module-4/capstone
chmod 710 ~/linux-foundations-lab/module-4/capstone/team
chmod 640 ~/linux-foundations-lab/module-4/capstone/team/notes.txt
```

Step 2 - Inspect the entire chain

Record every parent mode and both numeric and friendly ownership.

```bash
namei -l ~/linux-foundations-lab/module-4/capstone/team/notes.txt
stat -c '%A %a %u:%g %U:%G %n' ~/linux-foundations-lab/module-4/capstone/team/notes.txt
```

Step 3 - Test as yourself

As owner UID 1000, access succeeds through owner bits.

```bash
test -r ~/linux-foundations-lab/module-4/capstone/team/notes.txt
printf 'readable_exit=%s\n' "$?"
cat ~/linux-foundations-lab/module-4/capstone/team/notes.txt
```

Step 4 - Test as nobody

nobody should fail before or at a path component because other permissions do not allow traversal/read.

```bash
sudo -u nobody test -r ~/linux-foundations-lab/module-4/capstone/team/notes.txt
printf 'nobody_readable_exit=%s\n' "$?"
sudo -u nobody cat ~/linux-foundations-lab/module-4/capstone/team/notes.txt 2>&1 || true
```

Step 5 - Prove the first blocker

Read the path top-down and identify the first directory for which nobody lacks x. Do not change it.

```bash
sudo -u nobody namei -l ~/linux-foundations-lab/module-4/capstone/team/notes.txt
```

> What success looks like
> Your written explanation names the attempting identity, requested operation, first blocking path component, selected permission class and missing bit. It proposes no 777 workaround.

Explain it in your own words

•  Would mode 644 on notes.txt alone make it readable to nobody? Why not?

•  If nobody could traverse every parent, which triplet would apply to the file?

•  What is the smallest change if the actual design requires a service group to read—but not everyone?

## Checkpoint: can you explain it?

Try to answer aloud before reading the right column. The goal is understanding, not memorising wording.

| Question | Clear answer |
| --- | --- |
| 1. What number does the kernel use for root? | UID 0. |
| 2. Why did anikesh348 become UID 1000? | Ubuntu's local account-allocation policy normally assigned the first regular account UID/GID 1000 during provisioning. |
| 3. What does x mean on a directory? | Traverse/search: enter or pass through it and access known child names, subject to later permissions. |
| 4. Can a root-owned 644 file be replaced by a non-root user? | Yes, if the user has write + execute on the parent directory and no sticky/other rule prevents replacing its directory entry. |
| 5. How is 750 calculated? | Owner rwx = 4+2+1 = 7; group r-x = 4+1 = 5; other --- = 0. |
| 6. What does user: 1000:1000 do in Compose? | It requests that the container process run with numeric UID 1000 and primary GID 1000; it does not grant file permissions. |
| 7. Why can an NFS write fail even when the client process is root? | The export may be read-only, server permissions may deny it, or root_squash may map client UID 0 to an anonymous identity. |
| 8. How did hp-codex become passwordless sudo for anikesh348? | A sudoers rule matching the account includes NOPASSWD: ALL, so sudo does not require a password for allowed commands. |
