# Upload specs for the platforms Aden posts to

Research for issue #38, part of map #4. Researched 2026-11-13.

## Question

What are the current upload specs and best practices for the places Aden posts Visualizer videos: YouTube (16:9), YouTube Shorts, Instagram Reels and feed posts (9:16, 1:1), TikTok, and Spotify Canvas? For each one: resolution, aspect ratio, frame rate, maximum and ideal length, codec and container, bitrate, safe zones, and loop rules (Canvas). Also: realistic NVENC encode settings on an RTX 5080 that meet them.

Added by the Release Assistant: Spotify Canvas, plus 15 s and 30 s vertical 1080×1920 clips for Reels, TikTok and Shorts.

## Short answer

- **Two vertical masters cover everything except long-form YouTube.** These are a 1080×1920 H.264 MP4 for Reels, TikTok and Shorts (15 s and 30 s cuts), and a 1080×1920 silent loop of 3–8 s for Canvas. Long-form YouTube gets its own 16:9 master, 4K if the renderer can manage it.
- **The tightest limits all come from Instagram:** 25 Mbps VBR cap, maximum width 1920 px, 23–60 fps, 300 MB maximum file. A file that meets Instagram's limits also meets the TikTok and YouTube ones listed below.
- **Use H.264 High, 4:2:0, BT.709, closed GOP, moov atom at the front (`+faststart`), AAC-LC at 48 kHz.** YouTube and Meta both state this profile almost word for word.
- **Shorts over 1 minute with any copyright claim are blocked worldwide.** Since 2025-12-08 this also applies to Official Artist Channels. The 15 s and 30 s clips stay well under that line.
- **Canvas: 9:16, 720–1080 px tall, 3–8 s, MP4.** Make it a seamless loop, cut to a whole number of bars, with no text near the edges and no rapid flashing.
- **NVENC:** the RTX 5080 (Blackwell) encodes H.264, HEVC and AV1 at up to 8192×8192. For offline quality, NVIDIA recommends `-preset p7` with `-tune hq` (H.264) or `-tune uhq` (HEVC/AV1), VBR with `-cq`, and `-multipass fullres`. FFmpeg commands are in the [NVENC settings](#nvenc-settings-on-the-rtx-5080) section below.

## Spec table

| | YouTube (long-form) | YouTube Shorts | Instagram Reels | TikTok | Spotify Canvas |
|---|---|---|---|---|---|
| Aspect | 16:9 standard; vertical/square accepted | Square or vertical | 0.01:1–10:1 allowed; 9:16 recommended | 9:16 recommended (ads spec) | 9:16 |
| Resolution | Up to 8K. Bitrate table covers 360p–8K | Same encoding settings as YouTube | Max width 1920 px | 360–4096 px per side (API) | 720–1080 px tall |
| Frame rate | Native rate: 24/25/30/48/50/60 common | Same | 23–60 fps | 23–60 fps (API) | Not stated |
| Length | — (not researched here) | Up to 3 min | 3 s – 15 min (API) | API upload up to 10 min | 3–8 s |
| Container / codec | MP4, H.264 High, CABAC, 2 B-frames, closed GOP = fps/2, 4:2:0 | Same | MP4/MOV; H.264 or HEVC; closed GOP; 4:2:0 | MP4 (rec.), MOV, WebM; H.264 (rec.), H.265, VP8, VP9 | MP4 (or JPG) |
| Video bitrate | 1080p: 8 (≤30 fps) / 12 (≥48 fps) Mbps; 4K: 35–45 / 53–68 Mbps; VBR, no cap | Same | VBR, cap 25 Mbps | ≥2.5 Mbps (ads spec) | Not stated |
| Audio | AAC-LC/Opus, 48 kHz, stereo 384 kbps | Same | AAC, ≤48 kHz, mono/stereo, 128 kbps | Sound required for ads | No spec; lyrics won't sync, so pick parts without vocals |
| File size | — | — | 300 MB (API) | 4 GB (API); 500 MB (ads) | Not stated |

Sources: [YouTube recommended upload encoding settings](https://support.google.com/youtube/answer/1722171?hl=en), [Understand three-minute YouTube Shorts](https://support.google.com/youtube/answer/15424877?hl=en), [Meta IG User Media reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md), [TikTok Content Posting API media transfer guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide), [TikTok Reservation In-Feed ad specs](https://ads.tiktok.com/resources/help/article/tiktok-reservation-in-feed-ads-reach-frequency?lang=en), [Spotify for Artists Canvas guidelines](https://support.spotify.com/us/artists/article/canvas-guidelines/). None of these pages shows a "last updated" date. All were read on 2026-11-13.

## Platform by platform

### YouTube (long-form, 16:9)

From [YouTube recommended upload encoding settings](https://support.google.com/youtube/answer/1722171?hl=en):

- **Container:** MP4. No edit lists. Moov atom at the front ("fast start").
- **Video:** H.264, progressive, High Profile, CABAC, 2 consecutive B-frames, closed GOP of half the frame rate, VBR with no bitrate cap required, 4:2:0.
- **Frame rate:** encode at the frame rate the content was made at. 24, 25, 30, 48, 50 and 60 are common.
- **SDR bitrates (Mbps), standard / high frame rate:** 1080p 8 / 12, 1440p 16 / 24, 4K 35–45 / 53–68, 8K 80–160 / 120–240.
- **HDR bitrates:** 1080p 10 / 15, 4K 44–56 / 66–85. SDR is the sensible default. HDR needs its own colour-space workflow, which was not researched here.
- **Colour:** BT.709 primaries, transfer and matrix. YouTube converts BT.2020 to 8-bit BT.709 and full range to limited range. Tag BT.709 limited range explicitly.
- **Audio:** AAC-LC, Opus or Eclipsa, 48 kHz. Stereo at 384 kbps.
- **Aspect:** 16:9 is standard. Vertical and square videos are also accepted, and the player adapts.

Uploading at a higher resolution than the target (for example 4K for a 1080p visual) makes YouTube serve it with its higher-quality ladder. That is common practice and not stated on the page above, so treat it as a rule of thumb.

### YouTube Shorts

From [Understand three-minute YouTube Shorts](https://support.google.com/youtube/answer/15424877?hl=en):

- **Classification:** a square or vertical video of up to 3 minutes counts as a Short. Use a wider aspect such as 16:9 to keep a video out of Shorts.
- **Dates:** standard channels from 2024-10-15. **Official Artist Channels from 2025-12-08.** Videos uploaded before those dates stay long-form.
- **Copyright:** a Short over 1 minute with an active copyright claim of any type is blocked globally. It is not played, not recommended and not monetised. On artist channels linked to a music content owner, the label's (or distributor's) own first-party claim can block it, and only the claimant can release it. Shorts of 1 minute or less are not affected.
- **Encoding:** the page gives no Shorts-specific codec spec, so the YouTube upload settings above apply.

**Implication:** the 15 s and 30 s vertical clips are safe. Any vertical cut longer than 60 s of Aden's own distributed track risks being blocked by his own Content ID claim.

### Instagram Reels and feed

From Meta's [IG User Media API reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media.md), the published Reels spec:

- **Container:** MOV or MP4, no edit lists, moov atom at the front.
- **Video:** HEVC or H.264, progressive, closed GOP, 4:2:0. 23–60 fps. Maximum width 1920 px.
- **Bitrate:** VBR, maximum 25 Mbps.
- **Audio:** AAC, at most 48 kHz, mono or stereo, 128 kbps.
- **Aspect:** 0.01:1 to 10:1 is accepted. 9:16 is recommended "to avoid cropping or blank space".
- **Length and size:** 3 s – 15 min, 300 MB maximum.

These limits are for API publishing. In-app upload limits may be looser. Meta's consumer page ["Reel size & aspect ratios on Instagram"](https://help.instagram.com/1038071743007909/) would not render for the fetcher, so the in-app maximum length and the profile-grid crop (1:1 compared with the newer tall grid) are **not verified here**. Square (1:1) feed video is within the accepted aspect range. Until the grid crop is confirmed, keep the important part of a 9:16 master inside its central 4:5 / 1:1 area.

### TikTok

From the [Content Posting API media transfer guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide):

- **Formats:** MP4 (recommended), WebM, MOV. **Codecs:** H.264 (recommended), H.265, VP8, VP9.
- **Frame rate:** 23–60 fps. **Size:** 360–4096 px on each side. **File:** up to 4 GB. **Duration:** up to 10 min through the API.

From the [Reservation In-Feed ad spec](https://ads.tiktok.com/resources/help/article/tiktok-reservation-in-feed-ads-reach-frequency?lang=en). This is an ads spec, but it is the best first-party guidance on creative:

- 9:16 recommended (at least 540×960). 5–60 s, with **9–15 s recommended**. Bitrate at least 2.5 Mbps. 500 MB maximum. Sound required.
- **Safe zones:** TikTok gives downloadable safe-zone templates rather than pixel figures. The zone depends on aspect ratio, caption length and add-ons. Keep text and logos inside it.

The in-app upload length limit was not verified, because support.tiktok.com blocks automated fetching.

### Spotify Canvas

From [Spotify for Artists: Canvas guidelines](https://support.spotify.com/us/artists/article/canvas-guidelines/):

- **Length:** 3–8 s. The page also calls it an "8-second visual loop".
- **Aspect:** vertical 9:16. **Height:** 720–1080 px. **File:** MP4 (or JPG).
- **File size, frame rate, codec, audio:** not stated on the page.
- **Loop styles:** *Continuous loop* (repeats seamlessly), *Hard cut* (visible edit point, hidden artistically), *Rebound* (plays forward then in reverse).
- **Avoid** rapid cuts and intense flashing.
- **Safe area:** edges may be cropped on some phones, so keep key content away from them. Leave out the song and artist name, since the Now Playing view already shows them.
- Content rules are on a separate "Canvas content policy" page, which was not read here.

**Visualizer recommendation:** render 1080×1920 and make the loop a whole number of bars so that it lines up with the beat when it repeats. For example, at 120 BPM, 4 bars = 8.0 s; at 90 BPM, 2 bars ≈ 5.33 s. Drive the visuals from a phase that wraps exactly, so the first and last frames match. Export without an audio track, since Spotify plays the song itself. This is an inference, because the page gives no audio spec. Use 30 fps H.264 as the safe default, because the page gives no frame rate.

## Safe zones (summary)

None of the pages read give pixel-exact UI overlays for Reels, Shorts or TikTok. TikTok and Meta provide templates instead. Working rule, **not sourced**: on a 1080×1920 frame, keep text and faces out of the top ~250 px, the bottom ~400 px and the right ~150 px. Keep the focal point inside the central 1080×1350 (4:5) area, so it also survives feed and grid crops. Check against the official TikTok template before the Release Assistant hard-codes any numbers.

## NVENC settings on the RTX 5080

From [NVENC Application Note (SDK 13.1)](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/nvenc-application-note/index.html):

- Blackwell supports H.264 (including 10-bit and 4:2:2), HEVC (Main10, 4:2:2, 4:4:4) and AV1 (8- and 10-bit), at up to 8192×8192.
- At 1080p, P7 VBR HQ on an RTX 5070 Ti measured about 227 fps for H.264, 181 fps for HEVC and 401 fps for AV1. Even the slowest preset runs far faster than real time.

The RTX 5080 has two NVENC engines (see `research/rendering-engine.md`).

From [Using FFmpeg with NVIDIA GPU acceleration (SDK 13.1)](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.1/ffmpeg-with-nvidia-gpu/index.html):

- Use `p6` or `p7` for archiving and VOD.
- `-tune hq` is for latency-tolerant work. `-tune uhq` (lookahead plus temporal filter) works on **HEVC and AV1 only**.
- `-rc vbr -cq N` targets constant quality.
- `-multipass fullres` gives the most accurate statistics.
- `-rc-lookahead` can go up to 31 minus the number of B-frames.
- `-spatial-aq 1 -aq-strength N` improves perceptual quality.
- **Do not enable spatial and temporal AQ together.**

Encode is not the bottleneck, so use the slowest, highest-quality settings. The commands below follow the platform rules: H.264 High, 2 B-frames, closed GOP of fps/2, BT.709 tags, `+faststart`, AAC 48 kHz. They assume frames piped or read from the renderer at 60 fps; for 30 fps use `-g 15`.

**YouTube 16:9, 4K60 SDR (target about 60 Mbps, within YouTube's 53–68 range):**

```
ffmpeg -i frames_or_master -i mix.wav \
  -c:v h264_nvenc -preset p7 -tune hq -multipass fullres \
  -profile:v high -pix_fmt yuv420p \
  -rc vbr -cq 18 -b:v 60M -maxrate 90M -bufsize 180M \
  -bf 2 -b_ref_mode middle -g 30 -flags +cgop -rc-lookahead 20 \
  -spatial-aq 1 -aq-strength 8 \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv \
  -c:a aac -b:a 384k -ar 48000 -ac 2 \
  -movflags +faststart yt_4k60.mp4
```

At 1080p60, use `-b:v 12M -maxrate 20M -bufsize 40M`. HEVC (`hevc_nvenc -tune uhq`) gives better quality per bit at 4K. YouTube's page recommends H.264, and whether YouTube treats HEVC as an equal alternative was not verified here.

**Vertical social master, 1080×1920 at 60 or 30 fps, 15 s / 30 s cuts (Reels, TikTok, Shorts; under Instagram's 25 Mbps cap):**

```
ffmpeg -i vertical_master -i mix.wav -ss 0 -t 30 \
  -c:v h264_nvenc -preset p7 -tune hq -multipass fullres \
  -profile:v high -pix_fmt yuv420p \
  -rc vbr -cq 19 -b:v 14M -maxrate 20M -bufsize 40M \
  -bf 2 -b_ref_mode middle -g 30 -flags +cgop -rc-lookahead 20 \
  -spatial-aq 1 \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv \
  -c:a aac -b:a 128k -ar 48000 -ac 2 \
  -movflags +faststart social_30s.mp4
```

- **File size:** 30 s at a 20 Mbps peak is at most 75 MB, well under the 300 MB, 500 MB and 4 GB limits.
- **Audio bitrate:** Meta lists 128 kbps. YouTube recommends 384 kbps for stereo. Either one per-platform export (cheap) or a 256 kbps compromise is reasonable. All platforms re-encode.
- **Cut points:** for clean starts, cut on a bar line, and start the GOP on an I-frame by placing `-ss` before re-encoding, as above.

**Spotify Canvas, 1080×1920, 3–8 s loop, no audio:**

```
ffmpeg -i canvas_loop -an \
  -c:v h264_nvenc -preset p7 -tune hq -profile:v high -pix_fmt yuv420p \
  -rc vbr -cq 19 -maxrate 12M -bufsize 24M -bf 2 -g 15 -flags +cgop -r 30 \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv \
  -movflags +faststart canvas.mp4
```

## Open gaps

- In-app length limits for Instagram and TikTok, and Instagram's current profile-grid crop. The consumer help pages could not be fetched.
- Pixel-exact safe zones. Use TikTok's official templates and Meta's guidance.
- Whether YouTube treats HEVC/AV1 uploads as equal to H.264. Also the HDR workflow.
- Canvas file-size limit and content policy, which are on a separate Spotify page.
