# Which numbers can Aden see after a release, and where?

Research for #17, part of the Release Assistant v1 map (#14). Researched 2026-11-13.

**Question:** After a single comes out, which numbers can Aden actually see, where, and how soon (Spotify for Artists, DistroKid, SoundCloud, TikTok, Instagram, YouTube)? Which of them best show whether a release is working for an early-stage artist?

**Why it matters:** v1 asks Aden to type numbers in at the 7-day and 28-day check-ins. Nothing is pulled automatically. These findings decide which numbers to ask for, where to tell Aden to find each one, and what delays to warn about.

Sources are primary (platform help centres, official blogs, developer docs) unless marked otherwise. Where a primary page could not be fetched, that is noted.

---

## TL;DR: what to ask for at the check-ins

| # | Number | Where Aden finds it | Ready by day 7? | Why it matters |
|---|---|---|---|---|
| 1 | **Spotify streams** (this release) | Spotify for Artists > Music > the release (web or app) | Yes. Live count for 7 days, then daily | Baseline volume |
| 2 | **Spotify listeners** (this release) | Same page, release details | Yes (daily, UTC) | Needed to work out the ratios below |
| 3 | **Spotify saves** (this release) | Same page, release details (desktop) | Yes (daily, UTC) | Spotify names saving as a taste signal for recommendations |
| 4 | **Spotify playlist adds** | Spotify for Artists > Audience (desktop). Artist-wide, not per song | Yes (daily) | High-intent action. Artist-wide figure, so only a rough guide for one single |
| 5 | **Spotify followers** (artist total) | Spotify for Artists > Audience | Yes | Note it on release day too, so the gain can be worked out |
| 6 | **Release engagement %** | Spotify for Artists > Audience > Release engagement | 28-day check-in only | Spotify's own "did my fans show up" figure, over the first 28 days |
| 7 | **SoundCloud plays, likes, reposts** (track) | SoundCloud > Insights, or the track page | Yes (refreshes about every 24 h) | Main signal for the EDM/SoundCloud scene |
| 8 | **TikTok: views on Aden's own posts, plus number of videos using the sound** | TikTok app > Analytics (Content), and TikTok for Artists > Songs (if certified) | Yes (daily) | Other people's videos using the sound are the real breakout signal |
| 9 | **Instagram Reels: views, shares, saves** | Instagram app > the reel > View insights (professional account needed) | Yes. Data can lag up to 48 h | Shares and saves show intent better than likes |
| 10 | **YouTube views** (video or Short, plus song Shorts usage) | YouTube Studio > Analytics / Content > Songs | Partly. Can lag a few days; songs show only after 5 days | Secondary channel for most early EDM artists |

**Derived numbers the app can work out itself** (Aden does not type these):
- **Save rate** = Spotify saves ÷ Spotify listeners (release).
- **Streams per listener** = Spotify streams ÷ Spotify listeners. Spotify shows this on the release details page anyway.
- **Follower gain** = followers at the check-in − followers on release day.

**Do not ask for DistroKid numbers in v1.** Its Daily Stats are rough estimates, only on higher plans, and cover only Spotify, Apple, iTunes and Amazon. Its earnings reports run about 2 to 3 months behind. Spotify for Artists is fresher and more detailed for the same Spotify data.

---

## 1. Spotify for Artists

### What Aden can see

- **Audience-level stats, kept for 2 years plus year to date:** unique listeners, streams, streams per listener, saves, playlist adds, followers. [How far back your stats go](https://support.spotify.com/us/artists/article/how-far-back-your-stats-go/)
- **Song and release stats:** daily unique listeners and daily streams (2 years plus year to date), and an all-time stream count. [How far back your stats go](https://support.spotify.com/us/artists/article/how-far-back-your-stats-go/)
- **Release details page (desktop):** streams, listeners, streams per listener and saves for a single release over a chosen period, with a market filter. Announced 21 Oct 2021. [Spotify for Artists blog: Release Details Page and Audience Engagement Analytics](https://artists.spotify.com/en/blog/release-details-page-and-audience-engagement-analytics)
- **Audience engagement (Audience tab, desktop):** streams per listener, saves and playlist adds across the whole catalogue. The same post calls saves and playlist adds "high-intent actions". [same blog post](https://artists.spotify.com/en/blog/release-details-page-and-audience-engagement-analytics)
- **Release engagement (Audience > Release engagement):** the share of Aden's monthly active listeners who streamed a new release in its first 28 days. The baseline is monthly active listeners on the day before release. Only releases from the last 3 months are shown. Filters cover audience segments, programmed sources and country. [Understanding release engagement](https://support.spotify.com/us/artists/article/understanding-release-engagement/)
- **Audience segments (Audience > Segments):** monthly active, previously active and programmed listeners. Active listeners split into super (15 or more intentional streams in 28 days), moderate (3 to 14) and light (1 to 2). [Audience segments on Spotify](https://support.spotify.com/us/artists/article/audience-segments-on-spotify/)
- **Source of streams (desktop, launched as a beta):** editorial ("Made by Editors"), algorithmic ("Made for You", e.g. Discover Weekly, Radio and Autoplay) and active ("Made by You", e.g. profile, library, listener playlists). Announced 26 Jan 2022. [Spotify for Artists blog: Made to Be Found / Source of Streams](https://artists.spotify.com/blog/how-fans-discover-music-on-spotify-playlists-made-to-be-found)
- **Definitions:** "listeners" are unique people who streamed in the chosen period; "followers" are people who follow the artist profile. [Listener and follower data](https://support.spotify.com/us/artists/article/listener-and-follower-data/). A save is counted when a listener taps the plus button. [How we count saves](https://support.spotify.com/us/artists/article/how-we-count-saves/)

**Unverified:** whether playlist adds can be broken down per song. The help pages fetched list playlist adds only as an audience-level stat. The app should therefore ask for the artist-wide figure and label it that way. Check this in the live Spotify for Artists UI before the check-in copy is final.

### When numbers update

- **Live stream count:** updates every few seconds, only for the first 7 days of a new release. It appears in song stats on the web and on the mobile Home screen. [Live stream count](https://support.spotify.com/us/artists/article/live-stream-count/)
- **All other stats update once a day.** One help page says "approximately 5 PM ET / 9 PM UTC" ([When stats update](https://support.spotify.com/us/artists/article/when-stats-update/)); another says about 3 PM EST / 8 PM UTC ([Live stream count](https://support.spotify.com/us/artists/article/live-stream-count/)). The app should tell Aden "once a day, in the evening UK/EU time".
- **Days are counted in UTC and this can't be changed.** A release that goes live in the US evening may show no stats for release day. [When stats update](https://support.spotify.com/us/artists/article/when-stats-update/)
- **Effect on the app:** at the 7-day check-in, the most recent day may still be missing. Ask Aden to set the date range to "since release" (or last 7 days) and accept a one-day lag.

### What Spotify says counts

Spotify's public page on recommendations says that "searching, listening, skipping, or saving to Your Library influence our interpretation of your taste". [Understanding recommendations](https://www.spotify.com/us/safetyandprivacy/understanding-recommendations). This is the only primary source found that ties saves to recommendations. **Spotify publishes no threshold** for what counts as a good number.

---

## 2. DistroKid

- **Daily Stats:** "estimated" daily stats from Spotify, Apple Music, iTunes and Amazon. Only on the Musician Plus and Ultimate plans. Updated about every 24 hours, showing the previous day. These come from trend reports, not the earnings feed, so the two often don't match. [Streams and/or Sales in Your Daily Stats Page That Aren't Reflected in Earnings Statements](https://support.distrokid.com/hc/en-us/articles/360013648053-Streams-and-or-Sales-in-Your-Daily-Stats-Page-That-Aren-t-Reflected-in-Earnings-Statements)
- **Earnings and "excruciating detail" (Bank page):** final counts, but stores take "about 2-3 months" to report. [same article](https://support.distrokid.com/hc/en-us/articles/360013648053-Streams-and-or-Sales-in-Your-Daily-Stats-Page-That-Aren-t-Reflected-in-Earnings-Statements). Bank > "SEE EXCRUCIATING DETAIL" > the QUANTITY column, downloadable as CSV. [Checking How Many Times Your Song Has Been Streamed and Downloaded](https://support.distrokid.com/hc/en-us/articles/360013648553-Checking-How-Many-Times-Your-Song-Has-Been-Streamed-and-Downloaded)
- **Effect on the app:** nothing from DistroKid is useful at 7 or 28 days that Spotify for Artists doesn't show better. A possible later "90-day / first earnings" check-in could use it. (The plan comparison page could not be fetched: [Which Features are Available for each Plan?](https://support.distrokid.com/hc/en-us/articles/6184398375571-Which-Features-are-Available-for-each-Plan).)

---

## 3. SoundCloud

- **Basic Insights (all plans, including free):** plays, likes, comments, reposts and downloads by day, week, month or year; top 5 tracks; top fans; first fans; and the websites and apps that drive plays. A summary of plays over the last 24 hours and 7 days sits on the right of the Feed. **Artist / Artist Pro** add more, such as listener cities and countries, top 50 listeners (Pro) and detailed source breakdowns. If Aden distributes through SoundCloud, an "All Platforms" tab also shows Spotify and Apple. [SoundCloud: Insights](https://soundcloud.com/getstarted/insights/)
- **Track page (desktop, owner only):** shows "Recommended plays" (from the algorithm, stations and autoplay) and "Repeat listeners" (people who played the track more than once). **Track insights refresh about every 24 hours.** [Individual Track Insights](https://help.soundcloud.com/hc/en-us/articles/115003451227-Individual-Track-Insights)
- The main help articles ([Insights on SoundCloud](https://help.soundcloud.com/hc/en-us/articles/115003564988-Insights-on-SoundCloud), [Advanced SoundCloud Insights](https://help.soundcloud.com/hc/en-us/articles/45787456969115-Advanced-SoundCloud-Insights)) could not be fetched. The split between tiers above comes from SoundCloud's own marketing page.
- **Effect on the app:** ask for plays, likes and reposts for the track, and repeat listeners if Aden can see them. Reposts matter most in the EDM scene, because reposts spread a track through other people's followings. That is a domain judgement, not a sourced claim.

---

## 4. TikTok

- **In-app Analytics (creator or business account):** an Overview over 7, 28 or 60 days (or a custom range) with video views, profile views, likes, comments and shares. The Content tab gives per-post views, likes, comments, shares, average watch time, % who watched the full video and traffic sources. The Followers tab shows growth and profile views. [TikTok Creator Academy: Analytics intro](https://www.tiktok.com/creator-academy/en/article/tool-analytics-intro)
- **TikTok for Artists (launched globally 3 Jun 2025):** for each song, views, posts (videos made with the sound) and creator engagement; for posts, views, likes, comments, shares and completion rate; follower demographics. Dashboards are "daily-updated". Needs a certified TikTok Artist Account. [TikTok Newsroom: TikTok for Artists](https://newsroom.tiktok.com/en-gb/tiktok-for-artists)
- TikTok's own help pages on analytics ([How to use TikTok Analytics](https://www.tiktok.com/support/faq_detail?id=7639468340976785941&category=web_posts), [Information about TikTok Analytics](https://www.tiktok.com/legal/page/global/information-about-tiktok-analytics/en)) block automated fetching, so exact delays and time zones are **not confirmed**.
- **Effect on the app:** ask for (a) views on Aden's own best post about the release and (b) the number of videos using the sound. Without TikTok for Artists, (b) is the video count shown on the public sound page in the TikTok app. That is an observed UI behaviour, not something TikTok documents.

---

## 5. Instagram

- **Needs a professional (business or creator) account.** [Meta for Developers: Instagram Platform Insights](https://developers.facebook.com/docs/instagram-platform/insights/)
- **Reel metrics Meta exposes:** views, reach (estimated unique accounts), saves, shares, likes, comments, total interactions, average watch time, skip rate and reposts. [Meta for Developers: Instagram Media Insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights). The in-app view is "View insights" on the reel. [Instagram Help: View insights on your Instagram reels](https://help.instagram.com/202865988324236/). That page could not be read in full, so the in-app list is taken from the API reference.
- **Delay:** "data used to calculate metrics can be delayed up to 48 hours". [Instagram Media Insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights)
- Some account-level metrics don't appear on accounts with fewer than 100 followers. [Instagram Platform Insights](https://developers.facebook.com/docs/instagram-platform/insights/)
- **Effect on the app:** ask for views, shares and saves on the main release reel. Tell Aden that the last two days may not be counted yet.

---

## 6. YouTube

- **YouTube Studio > Analytics:** views (counted from the moment a video starts to play, across long-form, Shorts and live), watch time, subscribers and average view duration. A Realtime card compares the last 60 minutes with the last 48 hours. [Get an overview of channel performance](https://support.google.com/youtube/answer/6096647?hl=en)
- **Counting rule change:** "Beginning August 24, 2026, views are counted the moment a video starts to play across all formats, including Shorts". YouTube may "temporarily slow down, freeze, or change your metric count", and verified metrics "can take several days" to settle. [How engagement metrics are counted](https://support.google.com/youtube/answer/2991785?hl=en)
- **Artist analytics:** Content > Songs shows top songs and Shorts insights, but **songs appear only once they are more than 5 days old**. Song Rollup combines official video, Art Track, lyric video and user videos that use the recording. The Official Artist Channel filter requires an OAC. Real-time insights are only in the Studio app. [Understand your performance as an artist on YouTube](https://support.google.com/youtube/answer/9419340?hl=en)
- **Delay:** Google's Content Manager help says analytics data can have "a delay of a few days". [Check your YouTube Analytics data](https://support.google.com/youtube/answer/6085583?Hl=en). That page is written for Content Manager; the creator Studio pages fetched don't give a figure.
- **Effect on the app:** at 7 days ask only for views of the video or Short. At 28 days, also ask for Shorts that use the song (Content > Songs) if Aden can see it.

---

## 7. Which numbers say most about whether a release is working

For an artist this early, the useful questions are whether people who heard the track took a step towards it, and whether it spread beyond Aden's own push. Each signal below is rated by how well it is sourced:

| Signal | What the source supports | Benchmark? |
|---|---|---|
| **Saves / save rate** | Spotify says saving shapes its picture of a listener's taste ([Understanding recommendations](https://www.spotify.com/us/safetyandprivacy/understanding-recommendations)) and calls saves "high-intent" ([S4A blog](https://artists.spotify.com/en/blog/release-details-page-and-audience-engagement-analytics)) | **Folklore.** "20%+ is strong" (electronic about 20%) comes from a promo vendor's own campaign data, with no sample size or method given and no Spotify citation ([Dynamoi](https://dynamoi.com/learn/spotify-promotion/what-is-a-good-spotify-save-rate)). Spotify publishes no threshold |
| **Playlist adds** | Spotify calls them "high-intent" ([S4A blog](https://artists.spotify.com/en/blog/release-details-page-and-audience-engagement-analytics)) | None published. Only artist-wide, not per release (as far as could be checked) |
| **Streams per listener** | Spotify shows it on the release details page | **Folklore** for thresholds (the common "aim for 2+"). Nothing primary |
| **Listener-to-follower conversion** | Both inputs are documented ([Listener and follower data](https://support.spotify.com/us/artists/article/listener-and-follower-data/)) | **Folklore.** No primary benchmark found. Spotify shows no conversion figure |
| **Release engagement %** | Spotify's own first-28-days figure ([Understanding release engagement](https://support.spotify.com/us/artists/article/understanding-release-engagement/)) | No benchmark. Best used to compare Aden's own releases with each other |
| **Algorithmic share of streams** (Source of streams) | Documented ([S4A blog](https://artists.spotify.com/blog/how-fans-discover-music-on-spotify-playlists-made-to-be-found)) | No benchmark. A rising "Made for You" share shows the track is reaching people beyond Aden's own push |
| **SoundCloud repeat listeners / reposts** | Documented ([Individual Track Insights](https://help.soundcloud.com/hc/en-us/articles/115003451227-Individual-Track-Insights)) | No benchmark |
| **TikTok videos using the sound** | Documented as "posts" per song in TikTok for Artists ([Newsroom](https://newsroom.tiktok.com/en-gb/tiktok-for-artists)) | No benchmark |
| **Instagram shares and saves** | Documented metrics ([Media Insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights)) | No benchmark |

**Recommendation for v1:** don't show "good / bad" thresholds. Compare each release with Aden's previous releases at the same check-in (day 7 against day 7). Where a vendor benchmark is mentioned at all, label it as rough, unofficial guidance.

---

## 8. Public APIs (post-v1 only)

| Platform | Release numbers available through a public API? | Source |
|---|---|---|
| Spotify | **No** for streams, saves or listeners. The Web API never exposed them, and the Feb 2026 changes also removed artist `followers` and `popularity` | [Web API changelog, Feb 2026](https://developer.spotify.com/documentation/web-api/references/changes/february-2026) |
| DistroKid | No public API found | (none found) |
| SoundCloud | Yes, public track counts: `playback_count`, `favoritings_count`, `reposts_count`, `comment_count`, `download_count` | [SoundCloud API track object](https://developers.soundcloud.com/blog/soundclouds-new-api-track-object/) |
| TikTok | Partly. Video object has `view_count`, `like_count`, `comment_count`, `share_count` for the user's own videos. No sound-usage count found | [TikTok Video Object](https://developers.tiktok.com/doc/tiktok-api-v2-video-object) |
| Instagram | Yes for professional accounts (Instagram Graph API insights; reel views, reach, saves, shares) | [Media Insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights) |
| YouTube | Yes (YouTube Analytics API; views, likes, subscribers gained, etc.) | [YouTube Analytics metrics](https://developers.google.com/youtube/analytics/metrics) |

So even after v1, the most important numbers (Spotify saves and listeners) will still have to be typed in by hand.

---

## Gaps and things to check by hand

- Per-song playlist adds in Spotify for Artists. Not confirmed from help docs.
- The exact Spotify daily refresh time. Two help pages give different times (5 PM ET and 3 PM EST).
- TikTok analytics delay and time zone. The primary pages block automated fetching.
- SoundCloud's tier split (free vs Artist vs Artist Pro). Taken from the marketing page; the help articles could not be fetched.
- Whether Aden is on a DistroKid plan that includes Daily Stats. Doesn't affect v1.
