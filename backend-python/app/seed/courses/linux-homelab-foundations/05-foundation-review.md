You now have enough of the Linux model to make later topics understandable rather than memorised. Processes explain service and container identity. Paths and mounts explain where data lives. Shell parsing explains why quotes, redirection and exit status matter. Permissions explain why the same command succeeds as one identity and fails as another.

## Final explain-it-without-notes test

•  Draw the path from a typed command through Bash, a process, the kernel and hardware.

•  Explain why cd must be a shell builtin and why ls can be an external program.

•  Starting at /, explain the roles of /home, /etc, /var, /usr, /srv, /run, /proc, /dev and /root.

•  Given any path, distinguish absolute versus relative and name every directory component that must be traversed.

•  Translate drwxr-x--- and calculate 750 without a lookup table.

•  Explain why mode bits mean different operations on regular files and directories.

•  Explain root versus anikesh348, including UID 0, UID 1000 and passwordless sudo.

•  Trace UID 1000 from Docker Compose through a bind mount and an NFS request to pi-purva.

•  Diagnose a permission error without using chmod 777.

> Ready for the next course
> When you can do all nine tasks aloud and complete the labs without guessing, the next useful modules are processes/signals, systemd/journal, networking/SSH, storage/NFS administration, Docker/Compose operations and evidence-led incident diagnosis.

## Compact command reference

| Question | Start with |
| --- | --- |
| Where am I and who am I? | pwd; id; hostname |
| How does Bash resolve this command? | type NAME; command -v NAME |
| What is this object? | stat PATH; file PATH; ls -ld PATH |
| Can I traverse the full path? | namei -l PATH |
| Which filesystem supplies this path? | findmnt -T PATH; df -hT PATH |
| What account record maps this name? | getent passwd NAME; getent group NAME |
| What are raw numeric owner/group IDs? | ls -ldn PATH; stat -c '%u:%g %a %n' PATH |
| Does an exact identity have access? | sudo -u USER test -r\|-w\|-x PATH |
| Are extended ACLs involved? | getfacl -p PATH |
| What can I run through sudo? | sudo -n -l |
| What exited successfully? | COMMAND; printf 'exit=%s\n' "$?" |

## Glossary

| Term | Meaning in this book |
| --- | --- |
| Argument | A word/value supplied to a command after shell parsing |
| Distribution | Linux kernel plus user-space tools, libraries, packages, services and policy |
| Effective UID/GID | Credentials normally used by the kernel for authorization decisions |
| Exit status | Integer returned by a process; zero conventionally means success |
| File descriptor | Small process-local integer referring to an open file, socket, pipe or other I/O object |
| Filesystem | Data structure implementing files/directories on a device, network service or memory |
| GID | Numeric group identifier |
| Glob | Shell filename pattern such as *.txt expanded to matching pathnames |
| Inode | Filesystem metadata object behind one or more directory entries |
| Kernel | Privileged core managing processes, memory, filesystems, devices and networking |
| Mount | Attachment of a filesystem at a directory in the visible tree |
| Pathname | Slash-separated sequence used to resolve a filesystem object |
| Process | Running program instance with PID, memory, credentials and open resources |
| Root | Either filesystem top / or, in identity context, privileged UID 0 account; context distinguishes them |
| Shell | Program such as Bash that parses command language and starts programs |
| sudo | Policy-controlled tool that runs a selected command with another identity |
| Terminal | Text input/output channel used to interact with a shell or program |
| UID | Numeric user identifier |
| User space | Normal processes outside the privileged kernel |

## Official references used for accuracy

Ubuntu Desktop: The Linux command line for beginners
https://documentation.ubuntu.com/desktop/en/latest/tutorial/the-linux-command-line-for-beginners/
Shell, paths, files and command-line foundations.

Ubuntu Server: User management
https://ubuntu.com/server/docs/how-to/security/user-management/
Accounts, sudo, groups and administrative practices.

GNU Bash manual
https://www.gnu.org/software/bash/manual/bash.html
Shell parsing, expansion, quoting, redirection and pipelines.

GNU Coreutils manual
https://www.gnu.org/software/coreutils/manual/coreutils.html
pwd, ls, cp, mv, chmod, chown, stat and related tools.

man7: path_resolution(7)
https://man7.org/linux/man-pages/man7/path_resolution.7.html
How Linux resolves path components and applies search permission.

man7: inode(7)
https://man7.org/linux/man-pages/man7/inode.7.html
File type, ownership, modes and inode metadata.

man7: credentials(7)
https://man7.org/linux/man-pages/man7/credentials.7.html
Process user/group credentials.

Filesystem Hierarchy Standard
https://refspecs.linuxfoundation.org/FHS_3.0/fhs/index.html
Standard directory purposes and conventions.

Docker: Bind mounts
https://docs.docker.com/engine/storage/bind-mounts/
Host paths exposed inside containers.

Docker Compose services: user
https://docs.docker.com/reference/compose-file/services/#user
Compose process identity declaration.

Ubuntu Server: NFS
https://ubuntu.com/server/docs/how-to/networking/install-nfs/
NFS server/client setup and export concepts.

> Keep learning from the real system
> For every incident, record the symptom, exact host and time, process identity, path/namespace, evidence, first failing layer, smallest fix and verification. That notebook will become a more valuable operations manual than a generic command cheat sheet.
