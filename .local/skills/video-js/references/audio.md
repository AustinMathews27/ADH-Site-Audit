# Video Audio

This reference is only available when audio generation callbacks are enabled. Use it during the main-agent post-build pass for `video-js` artifacts, after the DESIGN subagent has finished and workflow logs are clean.

## Default behavior

Generate exactly one default audio layer: instrumental background music. Do not generate voiceover, text-to-speech, or sound effects unless the user explicitly requested them.

Skip default music only when the user explicitly asks for no music, no audio, silent playback, or a silent autoplay loop.

## Generate background music

1. Read `SCENE_DURATIONS` from `src/components/video/VideoTemplate.tsx`.
2. Compute `totalRuntimeSeconds = Math.ceil(sum(Object.values(SCENE_DURATIONS)) / 1000)`.
3. Generate music with the `generateMusic` callback and save it under the artifact's public audio directory:

```javascript
const music = await generateMusic({
  prompt: "<style> instrumental background music scoring a <video type>. <instruments>, <BPM>, <mood>. Patient intro, steady build, a clear lift around the <keystone second>-second mark, resolved ending. No vocals, no harsh highs.",
  outputPath: "artifacts/<slug>/public/audio/bg_music.mp3",
  summary: "background music",
  durationSeconds: totalRuntimeSeconds,
  forceInstrumental: true,
  outputFormat: "mp3_44100_128",
  overwrite: true,
});
console.log(music.filePath);
```

Pick the music style intentionally:

| Style | Use for |
| --- | --- |
| Driving electronic / synthwave, 110-128 BPM | Tech product reveals, developer tools, hardware, gaming, future-facing launches |
| Lo-fi hip hop, 80-95 BPM | Creator tools, productivity apps, indie launches, warm human products |
| Cinematic uplifting orchestral, 80-110 BPM | Brand films, mission-driven products, fintech, healthcare, founder stories |
| Corporate motivational, 95-115 BPM | B2B SaaS, enterprise sales pieces, customer testimonials |
| Cinematic minimal piano, 60-90 BPM | Luxury, editorial, premium hardware, fashion |
| Ambient atmospheric, 60-90 BPM | AI/research-heavy content, calm utilities, thoughtful tech |
| Funk / nu-disco, 105-115 BPM | Playful brands, design tools, social apps, confident upbeat launches |

Always include `No vocals`. Sung lyrics fight voiceover and on-screen copy.

## Add audio controls before playback wiring

When applying `scene_selectors.md`, extend the control wrapper before adding the `<audio>` element to `VideoTemplate`.

In `VideoWithControls`:

- Add `const [muted, setMuted] = useState(true);` in the iframe branch.
- Pass `muted={muted}` to `VideoTemplate`.
- Add a `Volume2` / `VolumeX` toggle button next to the scene-lock button.
- Keep the export path as `<VideoTemplate />` with no props, so export audio defaults to unmuted and the control bar stays hidden.

Control bar order should be: scene-lock button, audio mute button, divider, segmented progress bar, scene counter, collapse chevron.

Use declarative JSX for muting:

```tsx
<audio muted={muted} />
```

Do not set `audio.muted = muted` in an effect. That races browser autoplay in iframes and can make the first unmute click appear broken.

## Wire time-synced playback

Update `VideoTemplate` to accept `muted = false` while preserving existing defaults:

```tsx
export default function VideoTemplate({
  durations = SCENE_DURATIONS,
  loop = true,
  muted = false,
  onSceneChange,
}: {
  durations?: Record<string, number>;
  loop?: boolean;
  muted?: boolean;
  onSceneChange?: (sceneKey: string) => void;
} = {}) {
  const { currentScene, currentSceneKey } = useVideoPlayer({ durations, loop });
  // ...
}
```

Derive scene offsets from the canonical durations:

```tsx
const SCENE_START_SEC: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  let cumulativeMs = 0;
  for (const [key, ms] of Object.entries(SCENE_DURATIONS)) {
    out[key] = cumulativeMs / 1000;
    cumulativeMs += ms;
  }
  return out;
})();
```

Then add one music element and seek it on scene changes:

```tsx
const AUDIO_SEEK_EPSILON_SEC = 0.18;
const audioRef = useRef<HTMLAudioElement | null>(null);
const baseSceneKey = currentSceneKey.replace(/_r[12]$/, '');

useEffect(() => {
  const audio = audioRef.current;
  if (!audio) return;
  audio.volume = 0.45;
  const targetTime = SCENE_START_SEC[baseSceneKey] ?? 0;
  if (Math.abs(audio.currentTime - targetTime) > AUDIO_SEEK_EPSILON_SEC) {
    audio.currentTime = targetTime;
  }
  audio.play().catch(() => {});
}, [currentSceneKey, baseSceneKey, muted]);

return (
  <>
    {/* scenes and persistent layers */}
    <audio
      ref={audioRef}
      src={`${import.meta.env.BASE_URL}audio/bg_music.mp3`}
      preload="auto"
      autoPlay
      muted={muted}
    />
  </>
);
```

This keeps playback aligned for normal looping, scene jumps, and scene-lock `_r1` / `_r2` replays. Do not use `currentScene === 0` as the reset condition: scene jumps rotate the durations object, so the clicked scene remounts at index 0 even though its audio should start at that scene's canonical `SCENE_START_SEC` offset. The small seek epsilon avoids an audible pause on normal scene transitions when the audio is already close to the correct timestamp.

Do not add a `loop` attribute to the audio element; `useVideoPlayer` owns loop timing and the effect resets audio at the visual loop boundary because the first canonical scene's offset is `0`.

## Requested voiceover or SFX

Only add these layers when the user asked for them.

### Voiceover

Use `searchVoices` first unless the user provided a voice ID, then generate TTS with `textToSpeech`.

```javascript
const voices = await searchVoices({ search: "warm narrator", pageSize: 5 });
const voiceId = voices.voices[0].voice_id;
const vo = await textToSpeech({
  text: "Meet Nova. Redesigned from the ground up.",
  voiceId,
  outputPath: "artifacts/<slug>/public/audio/vo_intro.mp3",
  summary: "intro voiceover",
  modelId: "eleven_multilingual_v2",
  voiceSettings: {
    stability: 0.55,
    similarity_boost: 0.75,
    style: 0.35,
    use_speaker_boost: true,
  },
  overwrite: true,
});
console.log(vo.filePath);
```

Voiceover should complement on-screen text, not read every word. Keep each line short enough to fit its scene with at least 400ms of tail buffer.

### Sound effects

Use `generateSoundEffect` sparingly. SFX should punctuate a specific beat, such as a logo reveal or hard scene cut. When in doubt, leave SFX out.

```javascript
const sfx = await generateSoundEffect({
  prompt: "Soft futuristic logo reveal chime, clean, short, no reverb tail clutter",
  outputPath: "artifacts/<slug>/public/audio/sfx_logo_reveal.mp3",
  summary: "logo reveal chime",
  durationSeconds: 1.2,
  loop: false,
  promptInfluence: 0.4,
  overwrite: true,
});
console.log(sfx.filePath);
```

## Multi-layer export parity

If the mix includes voiceover or SFX, pre-mix all layers into one `public/audio/composite_audio.mp3` with `ffmpeg` before wiring playback. Per-scene `<audio src>` swaps can drift in recorded exports.

Build the composite with cumulative scene-start offsets:

```javascript
const inputs = ['public/audio/bg_music.mp3'];
const filters = ['[0:a]volume=0.24[m]'];
const mixLabels = ['[m]'];
let inputIdx = 1;
let cumulativeMs = 0;

for (const scene of SCENES) {
  if (scene.voiceoverFile) {
    const delay = cumulativeMs + (scene.voiceoverDelayMs ?? 250);
    inputs.push(`public/audio/${scene.voiceoverFile}`);
    filters.push(`[${inputIdx}:a]volume=1.0,adelay=${delay}|${delay}[vo${scene.key}]`);
    mixLabels.push(`[vo${scene.key}]`);
    inputIdx++;
  }
  if (scene.sfxFile) {
    inputs.push(`public/audio/${scene.sfxFile}`);
    filters.push(`[${inputIdx}:a]volume=0.45,adelay=${cumulativeMs}|${cumulativeMs}[sfx${scene.key}]`);
    mixLabels.push(`[sfx${scene.key}]`);
    inputIdx++;
  }
  cumulativeMs += scene.ms;
}

const filterComplex =
  filters.join(';') +
  `;${mixLabels.join('')}amix=inputs=${mixLabels.length}:duration=longest:dropout_transition=0:normalize=0[out]`;
```

Critical details:

- Use `adelay=N|N` so both stereo channels are delayed.
- Use `normalize=0` so the volume filters are respected.
- Clamp output to the total video runtime with `-t <totalSeconds>`.
- Use `composite_audio.mp3` in `VideoTemplate` instead of `bg_music.mp3` when a composite exists.
- With voiceover, duck background music to `0.18-0.28`; without voiceover, keep music around `0.40-0.55`.

## Checklist

- [ ] Default audio is exactly one instrumental background music file unless the user requested more.
- [ ] Music duration matches `SCENE_DURATIONS` total runtime.
- [ ] Audio files live in `public/audio/`.
- [ ] Public audio paths use `${import.meta.env.BASE_URL}audio/...`.
- [ ] Iframe preview defaults to muted and exposes a `Volume2` / `VolumeX` control.
- [ ] Export path renders `<VideoTemplate />` with no props, so audio is unmuted and controls are hidden.
- [ ] The `<audio>` element uses declarative `muted={muted}`.
- [ ] `audio.play()` is wrapped in `.catch(() => {})`.
- [ ] Scene jumps, scene-lock loops, and full-video loops keep audio aligned with the visible scene.
- [ ] Requested VO/SFX layers are pre-mixed into `composite_audio.mp3` for export parity.
