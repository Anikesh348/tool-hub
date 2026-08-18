The awkward part of running a media server was never pressing Play. It was the message before that: “Can you add this movie?”

At first, I handled every message manually: search, check, download, then reply when it appeared in [Jellyfin](#term:jellyfin). It worked, but so does keeping passwords in a notebook until the notebook becomes infrastructure.

I had the player and the automation. What I lacked was a safe layer between a person asking and those tools acting.

So I built MovieHub.

## Jellyfin was the player, not the request desk

Jellyfin scanned the SSD, organized the library, remembered progress and served it to browsers, phones and TVs.

But I did not want to give users [Radarr](#term:radarr), [Sonarr](#term:sonarr) or download-client access. Those admin tools can change libraries, quality profiles, queues and files. A Jellyfin account should not quietly become permission to operate the machinery behind it.

MovieHub became the front desk: users browse, request and track media; I keep the approval step and the controls underneath.

Here is the hand-off:

<!-- carousel:start -->

![New user requests MovieHub access](/blogs/article-3/moviehub-new-user-access-dark-v1.png "New user access")

*Separate access approval.*

![User raises a movie request](/blogs/article-3/moviehub-movie-request-dark-v1.png "Movie request")

*Movie and quality.*

![Admin reviews a pending request](/blogs/article-3/moviehub-admin-approval-dark-v1.png "Admin approval")

*Admin approval boundary.*

<!-- carousel:end -->

That extra click is intentional. Automation is convenient; unbounded automation is just somebody else's to-do list running on my hardware.

## CinePilot made the same workflow conversational

MovieHub also gained [CinePilot](#term:cinebot). Users can describe a request, check availability or ask about their queue. It identifies the action, asks for a choice when a title is ambiguous, then calls the same backend. Permissions still apply: users create pending requests and see their own status; admins get more powerful actions. AI changed the input, not the boundary.

You can [try MovieHub and CinePilot here](https://hostingfrompurva.xyz/moviehub). A normal ToolHub login can request MovieHub access if it has not already been approved.

![Dark CinePilot fictional movie request chat](/blogs/article-3/cinepilot-request-dark-v1.png "CinePilot request")

*Conversation to pending request.*

## One request crosses several boundaries

![MovieHub request flow from user search and admin approval through Radarr or Sonarr, the download client, SSD library and Jellyfin](/blogs/article-3/moviehub-request-path-v1.svg)

*MovieHub handles the human workflow; approval is where it hands the job to the media automation stack.*

The path is easier to follow as four stages:

1. A user searches MovieHub. It asks Radarr or Sonarr for results and checks whether the film or selected seasons are already available.
2. MovieHub saves a pending request with the title, seasons and quality choice. I approve or reject it.
3. Approval hands the request to Radarr or Sonarr, which sends a selected result to the download client and imports the completed file into the SSD library.
4. Jellyfin scans the library. MovieHub follows the queue, updates the request and sends the completion email when the file arrives.

The states now explain where to look: **Pending** is waiting for me, **Approved** means the automation has the job, and **Downloaded** means the file reached the managed library. That was much clearer than a chat message and my memory.

Getting media into the managed library solved the request problem. It also exposed the next one: making playback reliable across clients without asking the Pi to convert difficult files in real time.

## I moved the expensive work away from Play

The problem showed up whenever a client tried to play an unsupported video format. Jellyfin started a [live transcode](#term:live-transcoding), CPU usage climbed and the Pi throttled while trying to convert the stream quickly enough for playback.

That made the next decision straightforward: move the conversion away from the moment somebody pressed Play. I built Jellyfin Control to find difficult files, run [background transcoding jobs](#term:scheduled-transcoding) overnight, report progress and refresh the library afterwards.

Getting a file into Jellyfin did not mean every client could decode it. A [codec](#term:codec) is the method used to compress and reconstruct the video; the file [container](#term:media-container)—such as MKV or MP4—packages that video with audio and subtitles.

I treated 8-bit [H.264](#term:h264) as the practical compatibility baseline because it is understood by far more of the browsers, phones and television clients I use. When everything is compatible, [direct play](#term:direct-play) is cheap: Jellyfin sends the original file and the client decodes it. The overnight jobs use [FFmpeg](#term:ffmpeg) to prepare a compatible copy before anyone starts watching.

![Dark-mode Jellyfin Control sample showing a fictional H.265-to-H.264 job at 63 percent inside the nightly schedule](/blogs/article-3/jellyfin-control-transcode-job-dark-v1.png "Scheduled transcoding job")

*The fictional job shows the part that mattered: one conversion, visible progress and a bounded overnight window. The [Jellyfin Control demo repository](https://github.com/Anikesh348/jellyfin-control-demo) contains the scheduler and conversion pipeline.*

The trade-off was extra storage, extra writes and a delay before the prepared copy was ready. The jobs considered more than video: they kept compatible audio streams, converted unsupported audio and extracted supported text subtitles into separate SRT files. In practice, direct play became more common and live transcoding became the fallback.

## The interface hid complexity without denying it

MovieHub became one place to browse, request, follow progress and open the player. For me, it retained approval while reusing the tools already handling downloads, imports and playback. I was building the missing workflow between open-source applications, shaped by how people at home would use it.

This article describes the earlier Pi-hosted setup. Most production containers now run on an Ubuntu VM on an HP ProDesk; that migration belongs in a later article.

Next, I want to give practical walkthroughs of open-source projects I have implemented here, including the decisions and rough edges.

Personal tools do not always replace existing software; sometimes they make several good tools feel like one system.

If you run a media setup, where do requests live: chat, a spreadsheet, an app or something you built?

---

*Next: **Open-source projects from the homelab, one practical walkthrough at a time***
