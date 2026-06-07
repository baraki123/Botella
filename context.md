{
  "_meta": {
    "doc": "botella/context.md — machine-readable handoff for a fresh agent to take over cold",
    "format": "JSON (replaced the prior long-form prose handoff; pre-2026-06-07 prose is in git history of this file)",
    "last_updated": "2026-06-07",
    "core_value": "We add value to the user. If a feature/prompt/flow doesn't add value in THIS turn, cut it.",
    "also_read": ["CLAUDE.md (project instructions)", "spec.md (product spec)", "UI_UX_GUIDE.md (typography/color/motion)"],
    "current_focus": "Podcast Episodes feature — Layla's reads as narrated, chaptered audio episodes with an Apple-Podcasts-style player. Shipped + verified on web this session; needs native iOS verification."
  },

  "two_repo_system": {
    "botella": {
      "path": "~/Desktop/Coding/botella",
      "github": "baraki123/Botella (public)",
      "contains": ["botella/ (Python transport-neutral chat runtime + adapters + auth + storage protocol)", "layla-app/ (production Expo iOS/web client, Layla branding)", "mobile-template/ (generic fork, kept ~in sync with layla-app)", "tests/ (framework tests)"],
      "deploy": "layla-app WEB auto-deploys to Vercel on push to main → https://layla-star.vercel.app . iOS ships via Expo Go (dev) / EAS Update (OTA) / TestFlight. The botella/ Python package is pip-installed by GombiStar at build time (git+https://github.com/baraki123/Botella.git@main)."
    },
    "GombiStar": {
      "path": "~/Desktop/Coding/GombiStar",
      "github": "baraki123/GombiStar (private)",
      "role": "Layla's Python brain — prompts, flows, services, personality. Imports botella at runtime.",
      "deploy": "auto-deploys to Northflank on push to main → https://http--laylabot--28ttnydqvqwp.code.run . Build does a fresh pip install so it pulls latest botella main. IMPORTANT: each deploy restarts the instance → clears all in-process caches (TTS cache, episode _TRACK_CACHE) AND triggers a ~30s cold start."
    }
  },

  "architecture": {
    "runtime": "Bot brain → BotManifest (flows[], triggers{}, free_chat async generator, storage) → runtime.run() async dispatcher → adapters (Telegram PTB webhook; iOS/web HTTP /v1/messages + WSS /v1/stream).",
    "flows": "Each Flow = dict of state_name → async (msg, session, storage) → (events, transition). Transitions: WaitFor/Goto/Stay/Start/Done.",
    "storage_protocol": "botella/contract.py: load_session, save_session, resolve_identity, link_identity, get_user, update_user, delete_user, merge_users. get_user/update_user read/write layla_user_records.data JSONB (anon iOS/web). update_user does a JSONB `||` merge (wholesale per-key; null nulls the key, list keys are replaced wholesale not appended).",
    "ws_adapter": "botella/adapters/ws.py auto-resume re-runs start_trigger on EVERY fresh connection; injects a typing frame every 8s during slow LLM calls.",
    "outbound_events": ["text", "token", "complete", "typing", "quick_replies", "media", "paginated_read", "turn_end", "error"],
    "anon_users": "iOS/web users are anonymous: NO layla_users row; state lives in layla_user_records.data JSONB. Telegram users have charts in a separate layla_natal_charts table (start_trigger's _has_chart covers both)."
  },

  "feature_podcast_episodes": {
    "summary": "Layla's complex reads become narrated audio EPISODES. An episode plays as ONE continuous stitched mp3 (Apple-Podcasts model): chapters are timestamp markers; tapping a chapter SEEKS to its offset (instant, no per-chapter loading). Episode types: first_map (natal read), compatibility (per Orbit person), saved_readings (year-ahead / solar-return).",
    "decisions_locked": {
      "voice": "OpenAI 'shimmer' tts-1-hd now. Audio language follows the read TEXT (OpenAI auto-detects). ElevenLabs = fast-follow (better Hebrew).",
      "scope": "all read types in v1.",
      "ui": "full-screen episode shelf (like Orbit/Settings overlay) → tap row → full player."
    },
    "key_constraint": "OpenAI TTS hard-caps input at 4000 chars; a full read is ~14k chars → MUST synth per chapter (each <4000), then STITCH server-side into one mp3 + chapter start offsets.",

    "backend_files": {
      "GombiStar/services/episodes.py": {
        "role": "Assembles episodes from already-stored read text (no new generation) + stitches the single-track audio.",
        "key_symbols": [
          "Chapter(title,text,char_count) / Episode(id,type,title,subtitle,chapters,created_at) dataclasses",
          "_lang_of(text): script-detection (Hebrew vs Latin char count) — episode display lang follows CONTENT, not record['lang'] (robust vs stale lang after /newchart)",
          "_chapter_title_from_section / _sub_split_if_over_cap / _chapters_from_text (reuse claude_service.split_reading + tts._strip_markdown_for_speech)",
          "assemble_first_map_episode (title = \"{name}'s Natal Chart\" / \"מפת הלידה של {name}\"; fallback \"Your Natal Chart\"/\"מפת הלידה שלך\")",
          "assemble_compatibility_episodes (one per orbit person w/ compatibility_reading)",
          "assemble_saved_reading_episodes (FILTERS OUT entries whose _lang_of(text) != record lang — hides stale cross-language episodes)",
          "assemble_episodes(record,user_id) = first_map + saved + compat",
          "append_saved_reading(storage,user_id,type,title,text,created_at): de-dupes by type, FIFO cap SAVED_READINGS_CAP=10",
          "_mp3_duration_seconds(bytes): dependency-free MPEG frame parser (ID3v2-aware, CBR+VBR) for accurate per-chapter offsets",
          "build_episode_track(record,user_id,episode_id): asyncio.gather parallel synth of all chapters → concat bytes → offsets via parser → {audio,meta}; cached in _TRACK_CACHE (in-process, keyed by sha256 of chapter texts, cap 24)"
        ]
      },
      "GombiStar/bot_botella.py": {
        "endpoints_added": [
          "GET /v1/episodes → {lang, episodes:[{id,type,title,subtitle,chapters:[{title,text,char_count}],created_at}]} (JWT, metadata+chapter TEXT, cheap)",
          "GET /v1/episode-track-meta?id=<episode_id> → {total, chapters:[{title,start}]} (triggers the cached build)",
          "GET /v1/episode-track?id=<episode_id> → audio/mpeg (the stitched track; served from cache after meta built it)"
        ],
        "notes": "Two endpoints (meta + audio) instead of a custom response header because botella CORS (botella/app.py) doesn't expose custom headers. Client fetches meta first (does the build) then audio (cache hit). TTS rate limit raised 10→40/min (_RATE_MAX_PER_WINDOW) to cover the prefetch/build burst."
      },
      "GombiStar/botella_manifest.py": {
        "newchart_trigger": "wipe_fields now includes saved_readings + last_solar_return_year (so old-language episodes clear on /newchart). Already wiped first_map_read_text, lang, orbit, etc.",
        "start_trigger": "Returning-user-with-chart branch: if record has natal_chart but NO first_map_read_text (interrupted/errored read), RESUME the read — set session.flow='onboarding', hydrate session.data (chart_data/name/lang/gender/astro_depth from record), return Goto('build_first_map') — instead of check-in. Otherwise → checkin. Fixes 'leave mid-read → anchor chips + empty episodes'. _has_chart() kept as outer guard (covers Telegram).",
        "free_chat": "on-demand year-ahead reply (detect_yearly_forecast_intent) is captured post-stream into saved_readings via append_saved_reading (type=year_ahead)."
      },
      "GombiStar/services/daily_runner.py": "birthday solar-return read persisted to saved_readings via append_saved_reading (type=solar_return).",
      "GombiStar/flows/onboarding.py": "build_first_map birth_date/birth_time/geo extraction made NULL-SAFE (.get with defaults) so start_trigger can resume the read from the record (which stores no structured geo; Gate B cached-chart path ignores it). first_map_read_text is saved to the record only at STREAM COMPLETION (line ~518); sections saved to SESSION incrementally.",
      "GombiStar/tests/test_episodes.py": "26 tests (assembler, _mp3 parser, track build/offsets, language filter, title-from-content+name, endpoints via MemoryStorage). Full GombiStar suite: 545 pass."
    },

    "client_files": {
      "layla-app/src/voice/audioCache.ts": "Shared TTS fetch+cache for bubble Listen AND episode track. ONE in-flight promise per (text,voice) (fetch + prefetch share it — no dupe synth). audioCacheKey, fetchAudioUri, prefetchAudioUri, isAudioCached, responseToPlayableUri (blob URL on web / file:// via expo-file-system/legacy on native). LRU cap 96.",
      "layla-app/src/voice/coordinator.ts": "One-voice-at-a-time registry: setStopper(owner,fn)/stopOthers(owner). Avoids playback<->player circular import.",
      "layla-app/src/voice/player.ts": "SINGLE-TRACK episodePlayer singleton (expo-audio). load() fetches the stitched track (api.fetchEpisodeTrack) → one AudioPlayer + chapter offsets + total. State: {episodeId,episodeTitle,chapters:[{title,start}],index(derived from position),status,positionSec(GLOBAL),durationSec,rate,error}. jumpTo/next/prev = seekTo(offset). _applyRate uses setPlaybackRate(rate,'high') + shouldCorrectPitch=true (pitch correction). 250ms poll for smooth web scrubbing. RESTART-AT-END FIX: load() clamps resume position to 0 if >= total-3; play() seeks 0 if at/after end (fixes stale episode_progress after /newchart → 'play does nothing'). NOTE: NOT synced to mobile-template (depends on api/episodes which mobile-template lacks).",
      "layla-app/src/voice/usePlayer.ts": "React hook binding episodePlayer state + methods.",
      "layla-app/src/voice/playback.ts": "Bubble 'Listen' button player; refactored onto audioCache + coordinator (cross-stops with episode player).",
      "layla-app/src/api/episodes.ts": "fetchEpisodes(jwt), fetchEpisodeTrack(jwt,episodeId) [meta then audio, 70s timeout for first build], prewarmBackend() [/healthz ping]. 50s timeout on fetchEpisodes (cold-start tolerant).",
      "layla-app/src/episodes/EpisodeScreen.tsx": "Shelf (FlatList of EpisodeRow, modeled on PeopleScreen) → EpisodePlayerView (modeled on PersonDetailView). Player: title, now-playing chapter + 'Chapter i of n · total', global Scrubber (PanResponder, no slider dep), gold play disc, circular gold-rim prev/next (◀◀/▶▶ monochrome triangles NOT emoji), speed pill (cycleRate 1→1.25→1.5→1.75→2), chapter list with bracketed gold [m:ss] timestamps inline (Apple style), 'Ask Layla about this' CTA. Progress persisted to AsyncStorage layla:episode_progress:<userId> as {episodeId:{positionSec,updatedAt}}. 'Preparing your episode…' caption during first build. APPLE-PODCASTS FONT FLOOR: 16px minimum across the whole screen (see memory feedback_episodes_apple_font_size.md).",
      "layla-app/App.tsx": "route 'episodes' added; EpisodeScreen overlay with jwt+userId+autoOpenEpisodeId+onAskLayla; onOpenEpisodes(episodeId?) wired to ChatScreen.",
      "layla-app/src/chat/ChatScreen.tsx": "♫ header button (testID header-episodes-button) → onOpenEpisodes(). prewarmBackend() on mount. Post-first-map '▶ Listen to your map' chip (value __listen_map) intercepted in pickQuickReply → onOpenEpisodes('first_map:<userId>').",
      "layla-app/mobile-template": "synced: audioCache.ts, coordinator.ts (generic). NOT synced: player.ts (single-track, episodes-coupled), EpisodeScreen.tsx, api/episodes.ts (mobile-template lacks people/atmosphere scaffolding + episodes API)."
    },

    "data_flow": "Open shelf → GET /v1/episodes (metadata). Tap episode → fetchEpisodeTrack: GET /v1/episode-track-meta (server synths all chapters in parallel, stitches, computes offsets, caches) then GET /v1/episode-track (cached mp3). Client plays ONE audio; chapter taps = seekTo(offset).",

    "perf_and_gotchas": [
      "FIRST track build ~45s (OpenAI serializes the ~9 concurrent TTS calls). Cached 24h server-side BUT _TRACK_CACHE is IN-PROCESS → cleared on every Northflank deploy, so the first open after a deploy re-pays ~45s. Subsequent opens ~330ms meta + ~3s audio (14MB / ~12min episode).",
      "Northflank COLD START ~30s when idle (measured: cold 33s, warm 166ms). Client mitigations: prewarmBackend() on mount, friendly loading copy, 50s timeout + 'Try again'. Durable fix is INFRA (min 1 replica / no scale-to-zero) — USER'S decision, not yet done.",
      "episode_progress keyed by episode id (first_map:<userId>) → stale across /newchart (new content, same id). Mitigated by restart-at-end clamp in player.ts.",
      "Concatenated mp3 plays fine on web; chapter offsets accurate (verified: 0:00,0:38,2:07,...,11:51 for a 12:21 episode)."
    ],

    "verification_status": "ALL verified on WEB (layla-star.vercel.app) via Playwright: shelf, player, play/pause (position advances), chapter seek (instant), speed cycle, timestamps, total duration, restart-at-end, rename. NOT verified on native iOS — expo-audio replace()/seekTo/file:// + rate need a device tap. Test user: e906b807-b433-4208-85c6-9b5257e42f15 (anon, Hebrew session, name 'אבי'/Avi). JWT in localStorage 'botella.jwt'; userId in 'botella.userId'."
  },

  "also_fixed_this_session_pre_episodes": [
    "composer: two-row min height; don't auto-dismiss keyboard mid-compose (only when field empty) — fixed keyboard vanishing during reflective Hebrew typing.",
    "bubble RTL: short single-line Hebrew paragraphs were left/centered. Fix: rtl markdown paragraph justifyContent:'flex-end' (markdown-display paragraph is a flex ROW; horizontal axis is justifyContent not alignItems) + textgroup/text _rtl. Verified short lines hug right edge.",
    "hebrew calques: strengthened _system(he) directive in claude_service.py to kill abstract-noun construct-state calques (e.g. 'צעד המשמעות') esp. in closing questions.",
    "orbit: new-person detection runs for iOS/web (not just Telegram) + Hebrew mention detection.",
    "chat: chart-basis override (when user asks 'what in my map makes you say that' → name placements even if depth=less) + stop opening replies with a verdict on the user (system prompt guideline)."
  ],

  "open_items_and_user_decisions": {
    "user_decisions_pending": [
      "First-build 45s wait: pre-build the stitched track at read-generation time (background, instant later but synth cost for non-listeners) vs lazy (current, listener pays ~45s once) vs pre-build on shelf-open. User has NOT chosen.",
      "Northflank warm-keeping (min 1 replica / disable scale-to-zero on laylabot) to kill the ~30s cold start for episodes AND first chat message. INFRA — user's dashboard toggle."
    ],
    "fast_follows": [
      "ElevenLabs voice option (better Hebrew) — slots into services/tts.py synthesize_speech, voice-agnostic route/client.",
      "Native iOS verification of all episode audio/playback.",
      "Sync player.ts/EpisodeScreen/api-episodes to mobile-template (currently only generic audioCache+coordinator synced).",
      "Mid-pagination-of-a-COMPLETED-read on return → check-in still hijacks (only the INTERRUPTED-read case is fixed; server can't see client pagination position of a finished read). Harder, client-side.",
      "Lock-screen / background audio (Now Playing), download-for-offline, unified scrub already done (single track)."
    ],
    "known_open_from_before": [
      "lang propagation is a client regex sniff of recent messages (stopgap; proper fix = session_meta WS frame).",
      "FlatList virtualization once showed first-50-of-60 messages during a rubric run (local-only annoyance)."
    ]
  },

  "conventions_and_gotchas": [
    "Layla messages render WITHOUT a bubble (text on canvas + tiny gold dot); user messages get a charcoal-rose pill. Keep this asymmetry.",
    "Chat scroll/keyboard owned by mobile-template/src/chat/useChatScroll.ts (canonical) copied verbatim to layla-app. Never add ad-hoc scrollToEnd/Keyboard listeners in product ChatScreens.",
    "Bubble.tsx stripHtml converts <b>/<i> → markdown so server HTML copy works on both Telegram + iOS.",
    "iOS expo-file-system 19+ legacy methods throw — use /legacy submodule writeAsStringAsync.",
    "Hermes needs react-native-get-random-values imported at top of index.ts.",
    "websockets is declared in pyproject.toml (not a uvicorn base dep).",
    "save_chat_message(tid,...) is FK'd to layla_users — gate on `if tid is not None` for anon users.",
    "iOS apiUrl defaults to PROD on native dev (ATS blocks plain HTTP); use EXPO_PUBLIC_API_URL or expo --tunnel for LAN backend.",
    "Episodes/podcast UI font floor = 16px (Apple size), overrides UI_UX_GUIDE's 12px control floor for that surface only."
  ],

  "commands": {
    "python_tests": "cd ~/Desktop/Coding/GombiStar && source venv/bin/activate && python -m pytest -q   (545 pass)",
    "episode_tests": "python -m pytest tests/test_episodes.py -q   (26 pass)",
    "client_typecheck": "cd ~/Desktop/Coding/botella/layla-app && npx tsc --noEmit",
    "web_dev": "cd layla-app && npx expo start --port 8081 --web   (web dev hits localhost:8000; set EXPO_PUBLIC_API_URL to point at prod)",
    "local_backend": "cd ~/Desktop/Coding/GombiStar && source venv/bin/activate && LAYLA_DISABLE_SCHEDULER=1 uvicorn bot_botella:app --host 127.0.0.1 --port 8000",
    "verify_episodes_prod_browser": "Playwright: navigate layla-star.vercel.app; jwt=localStorage.getItem('botella.jwt'); fetch <prod>/v1/episodes with Bearer; tap header-episodes-button → episode-row-first_map → player-playpause; observe glyph (▶/❙❙) + mm:ss labels."
  },

  "working_preferences": [
    "End every reply with a `## Summary` block, then a final line that is just the project name: `botella / Layla`.",
    "Deploy, don't delegate: commit + push on completion (Northflank + Vercel auto-deploy). Don't leave git-pull TODOs.",
    "Native iOS APIs can't be verified from the dev box — surface that explicitly; don't claim native 'done'.",
    "'Run the MCP' / drive end-to-end = iOS/web path (FastAPI+WS), not Telegram.",
    "Clear, concise communication; decision points one line each.",
    "Task list should hold only CURRENT work (+ pending), not former asks.",
    "Verify prompt/voice changes against the user-POV rubric (~/Desktop/Coding/GombiStar/mcp/user_pov_test_plan.md) before shipping; save screenshots under botella/screenshots/userpov-*.png."
  ],

  "latest_commits": {
    "botella_main": [
      "535d52e episodes: restart from 0 when resuming at/past the end (fixes 'play does nothing')",
      "4741ec6 episodes: enforce 16px font floor (Apple-Podcasts size)",
      "e81a838 episodes: Apple-Podcasts sizing — bigger type, inline bracketed timestamps",
      "db3c05d episodes: play as one stitched track — chapter skip = instant seek, timestamps",
      "36c819c episodes: dedup in-flight synth + sequential prefetch + on-brand transport glyphs",
      "c4f854b episodes: graceful backend cold-start handling on the shelf",
      "5b8196b episodes: podcast player — narrated chaptered reads (client)"
    ],
    "GombiStar_main": [
      "2a6700a episodes: name the first-map episode \"<Name>'s Natal Chart\"",
      "17fc542 start_trigger: resume an interrupted first-map read instead of check-in",
      "365f0a9 episodes: language-match — derive episode lang from content + hide stale cross-lang",
      "826d119 newchart: wipe saved_readings + last_solar_return_year",
      "d84292f episodes: stitch chapters into one continuous track + offsets",
      "b40a401 episodes: assemble narratable podcast episodes + GET /v1/episodes"
    ]
  },

  "immediate_next_steps_for_new_agent": [
    "Confirm with the user the episodes feature works on the actual iOS build (only web is verified).",
    "Resolve the two pending user decisions: first-build pre-warm strategy, and Northflank warm-keeping.",
    "If asked to reduce the 45s first-build: implement background pre-build of the stitched track right after first_map_read_text saves (onboarding _first_map_and_save) + on /newchart completion.",
    "If continuing episodes polish: ElevenLabs voice; sync player/EpisodeScreen to mobile-template."
  ]
}
