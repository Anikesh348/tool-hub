> By the end of this module
> You can explain kernel versus user space, program versus process, terminal versus shell, how a login becomes UID 1000, and where your four homelab machines fit.

## 1.1 Linux is the kernel; Ubuntu is a complete operating system

Strictly speaking, Linux is the kernel: the privileged program that controls hardware and provides common facilities to all other programs. Ubuntu combines that Linux kernel with system libraries, command-line tools, a package manager, system services and configuration defaults. That full combination is called a distribution, or distro.

Your application cannot normally instruct the disk controller or alter another process's memory directly. It asks the kernel through controlled entry points called system calls. The kernel checks identity and permissions, performs the operation, and returns success or an error.

- You and programs
- Terminal -> shell -> commands, applications and services
- System calls
- Linux kernel: processes, memory, filesystems, devices and networking
- CPU | RAM | disks | network cards | other hardware

> Developer analogy
> Think of the kernel as a strongly protected platform API. Programs run as clients of that API. A system call such as open() or connect() crosses the user-space/kernel boundary.

## 1.2 The kernel manages five things you will inspect constantly

| Kernel responsibility | Plain meaning | Commands that expose it |
| --- | --- | --- |
| Processes | Which programs are running, who owns them and how they are scheduled | ps, top, systemctl |
| Memory | Which virtual memory pages belong to each process and what is cached | free, /proc, top |
| Filesystems | How paths map to files, directories, disks and network mounts | ls, stat, findmnt, df |
| Devices | Controlled access to disks, terminals, GPUs and network interfaces | /dev, lsblk, lspci |
| Networking | Interfaces, addresses, routes, sockets and packet movement | ip, ss, ping |

You do not need kernel-development knowledge to run a homelab. You need to recognise which of these resources a symptom involves. An empty Jellyfin library may be a filesystem or NFS problem; a browser timeout may be a route, socket or application problem; a permission error is an identity and filesystem decision.

## 1.3 A program on disk becomes a process in memory

A program is executable instructions stored in a file, for example /usr/bin/ls. When the kernel loads those instructions, gives them memory, an identity, open files and a process ID, you have a process. Starting the same program three times creates three processes with different PIDs.

### See your shell process

ps reports processes. -p $$ selects the current shell: the shell expands $$ to its own PID before running ps. -o chooses the columns.

```bash
ps -p $$ -o user,uid,pid,ppid,tty,stat,comm,args
```

Typical output

```bash
USER       UID   PID  PPID TT       STAT COMMAND  COMMAND
anikesh348 1000  2147  2139 pts/0    Ss   bash     -bash
```

> Why this matters in your homelab
> A service, SSH session and Docker container ultimately appear as host processes. Process identity is one bridge between a Compose user: 1000:1000 declaration and file access.

> PID 1
> The first user-space process started during boot has PID 1. On Ubuntu Server it is normally systemd. It starts and supervises other system services. Inside a container, PID 1 is usually the container's main process because the container has its own PID namespace.

## 1.4 Terminal, shell and command are different

A terminal is the text input/output channel. On a laptop it may be a terminal window; over SSH it is a pseudo-terminal connected across the network. A shell is a program reading that text, parsing a small language and launching commands. Bash is your configured login shell. A command may be a shell builtin, an executable file, a function or an alias.

| Thing | What it does | Example |
| --- | --- | --- |
| Terminal | Carries keyboard input and displayed output | pts/0 in ps output |
| Shell | Parses syntax, expands variables/globs, performs redirection, starts programs | /bin/bash |
| Command | The action requested through the shell | pwd, ls, docker |
| Prompt | Text printed by the shell while it waits for input | anikesh348@hp-codex:~$ |

### Ask Bash how it resolves names

type is a Bash builtin. It tells you whether a word resolves to another builtin, an executable found through PATH, or an alias. This is safer than assuming every command is a file.

```bash
type cd
type ls
type docker
type ll
```

Typical output

```bash
cd is a shell builtin
ls is /usr/bin/ls
docker is /usr/bin/docker
ll is aliased to `ls -alF'
```

## 1.5 What happens after you press Enter

For the input ls -la /srv, Bash roughly performs this sequence:

| Stage | What happens |
| --- | --- |
| 1. Read | Bash receives the characters you typed. |
| 2. Parse | It recognises the command word ls and two arguments: -la and /srv. |
| 3. Expand | It expands variables, command substitutions and filename globs if any exist. |
| 4. Resolve | It finds ls using aliases/functions/builtins/PATH; here that is /usr/bin/ls. |
| 5. Redirect | It prepares any requested input/output files or pipes. |
| 6. Start | Bash asks the kernel to create a process and execute /usr/bin/ls. |
| 7. Authorize | The kernel applies UID/GID and directory/file permissions while ls reads /srv. |
| 8. Return | ls exits with a status; Bash stores it and displays the next prompt. |

### See success and failure

Every command returns a small integer exit status. Zero conventionally means success; non-zero means some kind of failure. $? expands to the most recent status, so inspect it immediately.

```bash
true
printf 'true exit=%s\n' "$?"
false
printf 'false exit=%s\n' "$?"
```

Typical output

```bash
true exit=0
false exit=1
```

> Why this matters in your homelab
> Compose, systemd and scripts use exit status to decide whether an operation or healthcheck succeeded.

## 1.6 Login identity: names are labels for numbers

When you log in as anikesh348, the login system looks up the account and starts a process with numeric user ID 1000, primary group ID 1000, supplementary groups, home directory /home/anikesh348 and shell /bin/bash. The kernel uses the numbers; friendly names are looked up for display. Root always has UID 0.

### Inspect the current identity

id shows the numeric and friendly identities of the current process. getent queries the system's configured identity databases.

```bash
id
getent passwd anikesh348
getent group 1000
```

Typical output

```bash
uid=1000(anikesh348) gid=1000(anikesh348) groups=1000(anikesh348),4(adm),27(sudo),105(lxd)
anikesh348:x:1000:1000:Ubuntu:/home/anikesh348:/bin/bash
anikesh348:x:1000:
```

> Why 1000?
> Ubuntu normally allocates the first regular interactive account UID and GID 1000. That is how anikesh348 became mapped to 1000 on hp-codex. It is a local account-database choice, not a universal identity: UID 1000 on another machine can have a different name.

## 1.7 Your homelab is several Linux responsibility boundaries

| Host | Role | What belongs there |
| --- | --- | --- |
| hp-purva | Proxmox VE hypervisor | VM lifecycle and hypervisor storage/networking; not a general automation host |
| hp-codex | Ubuntu management VM 102 | Your shell labs, read-only inspection and low-blast-radius operational tooling |
| ubuntu-purva | Production compute VM 100 | Docker Compose applications including Jellyfin |
| homeassistant | Home Assistant OS VM 101 | Home Assistant appliance and supported HA command surface |
| pi-purva | Raspberry Pi storage/service host | Authoritative bulk data exported over NFS |

A path such as /srv/data/media is meaningful only together with its host and mount state. On pi-purva it refers to authoritative local storage. On ubuntu-purva it is an NFS client mount. Inside Jellyfin, that host path is bind-mounted again as /media. The text of a path alone does not tell you where bytes physically live.

### Hands-on lab: prove the layers on hp-codex

> Safety
> Run this lab on hp-codex. It writes only inside ~/linux-foundations-lab.

Step 1 - Create the isolated workspace

mkdir creates missing directories; cd changes only the shell's current working directory.

```bash
mkdir -p ~/linux-foundations-lab/module-1
cd ~/linux-foundations-lab/module-1
```

Step 2 - Record identity and shell

tee displays output and saves the same bytes in a file.

```bash
id | tee identity.txt
printf 'shell=%s pid=%s home=%s\n' "$SHELL" "$$" "$HOME" | tee shell.txt
```

Step 3 - Inspect kernel and PID 1

uname reports the running kernel; ps shows the first user-space process.

```bash
uname -sr
ps -p 1 -o user,uid,pid,comm,args
```

Step 4 - Identify a command

The shell tells you how it resolves the names; readlink resolves symbolic links.

```bash
type pwd
type ls
command -v ls
readlink -f "$(command -v ls)"
```

> What success looks like
> You can point to a kernel version, show systemd as PID 1, identify Bash as your shell, show UID 1000, and explain why ls is a file while cd is a builtin.

Explain it in your own words

•  Which component parses the dollar sign and quotes: the kernel or Bash?

•  Why does every process need a numeric identity?

•  What extra context must accompany a path before you know where its bytes live?

## Checkpoint: can you explain it?

Try to answer aloud before reading the right column. The goal is understanding, not memorising wording.

| Question | Clear answer |
| --- | --- |
| 1. Is Ubuntu identical to Linux? | No. Linux is the kernel; Ubuntu is a distribution containing Linux plus tools, libraries, services and policy. |
| 2. What is the difference between a program and a process? | A program is executable code stored somewhere. A process is a running instance with a PID, memory, identity and open resources. |
| 3. Are a terminal and a shell the same thing? | No. The terminal carries text I/O; the shell parses a language and starts commands. |
| 4. What does exit status 0 mean by convention? | The command reports success. Any non-zero status reports some failure condition. |
| 5. Who enforces file permissions? | The kernel, using the process's numeric credentials and the filesystem metadata. |
| 6. What is root's UID? | 0. |
