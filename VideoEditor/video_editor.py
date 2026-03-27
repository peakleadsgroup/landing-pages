"""
Core video editing logic: clip selection, concatenation, audio replacement, captions.
"""
import os
import random
import re
import subprocess
import tempfile
from pathlib import Path

import ffmpeg


# Supported video extensions
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}
# Supported audio extensions for background music
AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"}
# Background music: audio + video (FFmpeg extracts audio from video files)
BACKGROUND_MUSIC_EXTENSIONS = AUDIO_EXTENSIONS | VIDEO_EXTENSIONS


def get_audio_duration_seconds(audio_path: str) -> float:
    """Get duration of audio file in seconds using ffprobe."""
    try:
        probe = ffmpeg.probe(audio_path)
        duration = float(probe.get("format", {}).get("duration", 0))
        return duration if duration > 0 else 0.0
    except Exception:
        return 0.0


def _null_device() -> str:
    return "NUL" if os.name == "nt" else "/dev/null"


def _detect_max_volume_db(audio_path: str) -> float | None:
    """
    Detect peak max_volume in dB using FFmpeg's volumedetect filter.
    Returns None if detection fails.
    """
    # volumedetect writes results to stderr
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-nostdin",
        "-i",
        audio_path,
        "-af",
        "volumedetect",
        "-f",
        "null",
        _null_device(),
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
        )
    except Exception:
        return None

    stderr = result.stderr or ""
    m = re.search(r"max_volume:\s*([-\w\.]+)\s*dB", stderr)
    if not m:
        return None

    raw = m.group(1).strip()
    if raw.lower() in {"-inf", "inf", "nan"}:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def normalize_audio_peak_to_db(audio_path: str, output_path: str, target_db: float = 0.0) -> str:
    """
    Normalize audio so its detected peak max_volume matches target_db (dB).
    Uses a simple gain adjustment based on volumedetect max_volume.
    """
    max_db = _detect_max_volume_db(audio_path)
    if max_db is None:
        return audio_path

    gain_db = target_db - max_db
    # Avoid unnecessary re-encoding if already close.
    if abs(gain_db) < 0.05:
        return audio_path

    # volume filter supports dB suffix, e.g. volume=3.2dB
    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-nostdin",
        "-i",
        audio_path,
        "-af",
        f"volume={gain_db}dB",
        "-c:a",
        "aac",
        "-b:a",
        "256k",
        "-ar",
        "44100",
        "-vn",
        output_path,
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
        )
    except Exception as e:
        raise RuntimeError(f"FFmpeg normalization failed: {e}") from e

    if result.returncode != 0:
        stderr = result.stderr or ""
        raise RuntimeError(f"FFmpeg normalization error: {stderr}") from None

    return output_path


def get_video_duration_seconds(video_path: str) -> float:
    """Get duration of video file in seconds using ffprobe."""
    try:
        probe = ffmpeg.probe(video_path)
        stream = next(
            (s for s in probe["streams"] if s["codec_type"] == "video"),
            None
        )
        if not stream:
            return 0.0
        duration = float(stream.get("duration", 0))
        if duration <= 0:
            # Fallback: check format duration
            duration = float(probe.get("format", {}).get("duration", 0))
        return duration
    except Exception:
        return 0.0


def get_video_dimensions(video_path: str) -> tuple[int, int] | None:
    """Return (width, height) for the primary video stream, or None."""
    try:
        probe = ffmpeg.probe(video_path)
        stream = next(
            (s for s in probe["streams"] if s.get("codec_type") == "video"),
            None,
        )
        if not stream:
            return None
        w = stream.get("width")
        h = stream.get("height")
        if not w or not h:
            return None
        return int(w), int(h)
    except Exception:
        return None


def get_video_clips_from_folder(folder_path: str) -> list[tuple[str, float]]:
    """Return list of (path, duration) for all video files in folder."""
    folder = Path(folder_path)
    if not folder.is_dir():
        return []

    clips = []
    for f in folder.iterdir():
        if f.suffix.lower() in VIDEO_EXTENSIONS:
            dur = get_video_duration_seconds(str(f))
            if dur > 0:
                clips.append((str(f.resolve()), dur))
    return clips


def select_clips_to_fill_duration(
    clips: list[tuple[str, float]],
    target_duration: float,
    randomize: bool = True
) -> list[tuple[str, float, float]]:
    """
    Select clips (with optional trim on last) to match target duration.
    Returns list of (path, start_time, end_time) - end_time may be trimmed.
    """
    if not clips or target_duration <= 0:
        return []

    pool = clips.copy()
    if randomize:
        random.shuffle(pool)

    selected = []
    accumulated = 0.0

    for path, duration in pool:
        if accumulated >= target_duration:
            break

        needed = target_duration - accumulated
        use_duration = min(duration, needed)
        start = 0.0
        end = use_duration

        # If clip is longer than needed, randomly choose start point for variety
        if duration > needed and randomize:
            max_start = duration - needed
            start = random.uniform(0, max_start) if max_start > 0 else 0
            end = start + needed

        selected.append((path, start, end))
        accumulated += (end - start)

    return selected


def concatenate_clips_with_ffmpeg(
    clip_segments: list[tuple[str, float, float]],
    temp_dir: str
) -> str:
    """
    Concatenate trimmed clips into single video. Returns path to concatenated file.
    """
    output = os.path.join(temp_dir, "concat.mp4")

    def run_ffmpeg(process):
        try:
            process.run(capture_stdout=True, capture_stderr=True)
        except ffmpeg.Error as e:
            stderr = e.stderr.decode() if e.stderr else "No stderr"
            raise RuntimeError(f"FFmpeg error: {stderr}") from e

    if len(clip_segments) == 1:
        path, start, end = clip_segments[0]
        inp = ffmpeg.input(path, ss=start, t=end - start)
        run_ffmpeg(
            ffmpeg.output(
                inp, output,
                vcodec="libx264", pix_fmt="yuv420p", **{"profile:v": "main"},
                acodec="aac", ar=44100
            )
            .overwrite_output()
        )
        return output

    # Trim each clip and concat filter: v1, a1, v2, a2, ...
    streams = []
    for path, start, end in clip_segments:
        inp = ffmpeg.input(path, ss=start, t=end - start)
        streams.extend([inp.video, inp.audio])

    combined = ffmpeg.concat(*streams, v=1, a=1)
    run_ffmpeg(
        ffmpeg.output(
            combined, output,
            vcodec="libx264", pix_fmt="yuv420p", **{"profile:v": "main"},
            acodec="aac", ar=44100
        )
        .overwrite_output()
    )
    return output


def concatenate_with_ending_and_fade(
    clip_segments: list[tuple[str, float, float]],
    ending_clip_path: str,
    ending_duration: float,
    temp_dir: str,
    fade_duration: float = 2.0
) -> str:
    """
    Concatenate clips, then append ending clip with fade transition.
    ending_duration: how long the ending clip plays (will be trimmed if longer).
    Returns path to output file.
    """
    output = os.path.join(temp_dir, "concat_with_ending.mp4")

    def run_ffmpeg(process):
        try:
            process.run(capture_stdout=True, capture_stderr=True)
        except ffmpeg.Error as e:
            stderr = e.stderr.decode() if e.stderr else "No stderr"
            raise RuntimeError(f"FFmpeg error: {stderr}") from e

    clips_duration = sum(end - start for _, start, end in clip_segments)
    xfade_offset = clips_duration - fade_duration

    if xfade_offset < 0:
        raise ValueError("Clips too short for fade transition - need more video content")

    # Concat main clips
    main_output = concatenate_clips_with_ffmpeg(clip_segments, temp_dir)

    # Main clips input and ending clip (trimmed)
    main_inp = ffmpeg.input(main_output)
    end_inp = ffmpeg.input(ending_clip_path, t=ending_duration)

    # xfade requires identical video dimensions. Some ending clips are a few pixels
    # different (e.g. 1080x1916 vs 1080x1920), so scale the ending clip to match.
    main_dims = get_video_dimensions(main_output)
    main_v = main_inp.video
    end_v = end_inp.video
    if main_dims:
        main_w, main_h = main_dims
        end_v = ffmpeg.filter([end_v], "scale", main_w, main_h)
    # Normalize pixel format so filters don't disagree.
    main_v = ffmpeg.filter([main_v], "format", "yuv420p")
    end_v = ffmpeg.filter([end_v], "format", "yuv420p")

    v_out = ffmpeg.filter(
        [main_v, end_v],
        "xfade",
        transition="fade",
        duration=fade_duration,
        offset=xfade_offset,
    )
    a_out = ffmpeg.filter(
        [main_inp.audio, end_inp.audio],
        "acrossfade",
        d=fade_duration,
        c1="tri",
        c2="tri"
    )

    run_ffmpeg(
        ffmpeg.output(
            v_out, a_out, output,
            vcodec="libx264", pix_fmt="yuv420p", **{"profile:v": "main"},
            acodec="aac", ar=44100
        )
        .overwrite_output()
    )
    return output


def get_random_audio_from_folder(folder_path: str) -> str | None:
    """Return path to a random audio or video file from the folder (FFmpeg extracts audio from video)."""
    folder = Path(folder_path)
    if not folder.is_dir():
        return None
    files = [f for f in folder.iterdir() if f.suffix.lower() in BACKGROUND_MUSIC_EXTENSIONS]
    if not files:
        return None
    return str(random.choice(files).resolve())


def mix_audio_with_background(
    main_audio_path: str,
    background_audio_path: str,
    output_path: str,
    duration_seconds: float,
    background_volume: float = 0.5,
    main_volume: float = 1.0,
) -> None:
    """Mix main audio with background music.

    - `background_volume`: multiplier applied to background audio (post-normalization)
    - `main_volume`: multiplier applied to main/voiceover audio (post-normalization)
    """
    main = ffmpeg.input(main_audio_path)
    # Loop background and trim to match main duration
    bg = ffmpeg.input(background_audio_path, stream_loop=-1, t=duration_seconds)
    bg_lowered = bg.audio.filter("volume", background_volume)
    main_lowered = main.audio.filter("volume", main_volume)
    # Use `longest` so background music keeps playing even if the voiceover ends early.
    mixed = ffmpeg.filter([main_lowered, bg_lowered], "amix", inputs=2, duration="longest")
    try:
        (
            ffmpeg
            .output(mixed, output_path, acodec="aac", ar=44100, **{"b:a": "256k"})
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )
    except ffmpeg.Error as e:
        stderr = e.stderr.decode() if e.stderr else "No stderr"
        raise RuntimeError(f"FFmpeg error: {stderr}") from e


def replace_audio_with_mp3(
    video_path: str,
    audio_path: str,
    output_path: str,
    audio_volume: float = 1.0,
) -> None:
    """Replace video's audio track with `audio_path` (voiceover/mix).

    If `audio_path` is already AAC, we try to copy it to avoid quality loss.
    """
    video = ffmpeg.input(video_path)
    audio = ffmpeg.input(audio_path)
    try:
        audio_probe = ffmpeg.probe(audio_path)
        audio_stream = next(
            (s for s in audio_probe.get("streams", []) if s.get("codec_type") == "audio"),
            None,
        )
        codec = audio_stream.get("codec_name") if audio_stream else None
        can_copy_audio = codec == "aac" and abs(audio_volume - 1.0) < 1e-6

        audio_to_use = audio.audio
        if not can_copy_audio:
            # Apply volume in the audio filter chain so we preserve the requested level.
            if abs(audio_volume - 1.0) >= 1e-6:
                audio_to_use = audio.audio.filter("volume", audio_volume)

        (
            ffmpeg
            .output(
                video.video,
                audio_to_use,
                output_path,
                vcodec="copy",
                acodec="copy" if can_copy_audio else "aac",
                **(
                    {"ar": 44100, "b:a": "256k"}
                    if not can_copy_audio
                    else {}
                ),
                shortest=None  # End when shortest stream ends
            )
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )
    except ffmpeg.Error as e:
        stderr = e.stderr.decode() if e.stderr else "No stderr"
        raise RuntimeError(f"FFmpeg error: {stderr}") from e


def transcribe_to_srt(audio_path: str, model_size: str = "base", words_per_caption: int = 1) -> str:
    """
    Transcribe audio with word-level timing. Returns SRT for display/editing.
    For best sync, use model_size='medium' or 'large'.
    """
    words = _transcribe_to_words(audio_path, model_size)
    if not words:
        return ""
    return _words_to_srt(words)


def transcribe_to_srt_and_words(audio_path: str, model_size: str = "base") -> tuple[str, list[dict]]:
    """Transcribe once, return (srt, words) for display and ASS generation."""
    words = _transcribe_to_words(audio_path, model_size)
    if not words:
        return "", []
    return _words_to_srt(words), words


def transcribe_to_words(audio_path: str, model_size: str = "base") -> list[dict]:
    """
    Transcribe audio and return word-level timing for ASS highlight captions.
    Returns list of {"word", "start", "end"}.
    """
    return _transcribe_to_words(audio_path, model_size)


def _transcribe_to_words(audio_path: str, model_size: str) -> list[dict]:
    """Get word-level timing from stable-ts or fallback."""
    words = _transcribe_with_stable_ts(audio_path, model_size)
    if not words:
        words = _transcribe_with_whisper_fallback(audio_path, model_size)
    return words


def _words_to_srt(words: list[dict]) -> str:
    """Convert word list to SRT for display/editing."""
    srt_lines = []
    idx = 1
    MIN_DISPLAY_SEC = 0.2
    for i, w in enumerate(words):
        w_start = w["start"]
        w_end = words[i + 1]["start"] if i + 1 < len(words) else w["end"]
        if w_end - w_start < MIN_DISPLAY_SEC:
            w_end = w_start + MIN_DISPLAY_SEC
        srt_lines.append(str(idx))
        srt_lines.append(f"{_sec_to_srt(w_start)} --> {_sec_to_srt(w_end)}")
        srt_lines.append(w["word"])
        srt_lines.append("")
        idx += 1
    return "\n".join(srt_lines)


def _words_to_ass_highlight(words: list[dict], max_chars_per_line: int = 56) -> str:
    """
    Generate ASS with NCA-style highlight: full line visible, current word highlighted.
    White text, yellow highlight on the word being spoken.
    """
    WORD_COLOR = "&HFFFFFF&"    # White (ASS BGR)
    HIGHLIGHT_COLOR = "&H00FFFF&"  # Yellow (ASS BGR)

    def _format_ass_time(sec: float) -> str:
        h = int(sec // 3600)
        m = int((sec % 3600) // 60)
        s = int(sec % 60)
        cs = int(round((sec % 1) * 100))
        return f"{h}:{m:02d}:{s:02d}.{cs:02d}"

    header = """[Script Info]
Title: Highlight Current Word
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,72,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,0,2,40,40,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    line_words = []
    line_chars = 0

    for w in words:
        word = w["word"]
        wlen = len(word) + 1  # +1 for space
        if line_words and line_chars + wlen > max_chars_per_line:
            # Emit line
            _emit_highlight_events(line_words, events, _format_ass_time, WORD_COLOR, HIGHLIGHT_COLOR)
            line_words = []
            line_chars = 0
        line_words.append(w)
        line_chars += wlen

    if line_words:
        _emit_highlight_events(line_words, events, _format_ass_time, WORD_COLOR, HIGHLIGHT_COLOR)

    return header + "\n".join(events) + "\n"


def _emit_highlight_events(
    line_words: list[dict],
    events: list[str],
    format_time,
    line_color: str,
    highlight_color: str,
) -> None:
    """Emit one Dialogue per word: full line with current word highlighted."""
    line_start = line_words[0]["start"]
    line_end = line_words[-1]["end"]
    for i, w_info in enumerate(line_words):
        start = w_info["start"]
        end = line_words[i + 1]["start"] if i + 1 < len(line_words) else w_info["end"]
        parts = []
        for j, w in enumerate(line_words):
            if j == i:
                parts.append(f"{{\\c{highlight_color}}}{w['word']}{{\\c{line_color}}}")
            else:
                parts.append(f"{{\\c{line_color}}}{w['word']}")
        text = " ".join(parts)
        events.append(f"Dialogue: 0,{format_time(start)},{format_time(end)},Default,,0,0,0,,{text}")


def _parse_srt_to_words(srt_content: str) -> list[dict]:
    """
    Parse edited SRT back to words with estimated timing.
    Splits each segment's text into words and distributes time evenly.
    """
    import re
    words = []
    block = re.split(r"\n\s*\n", srt_content.strip())
    time_re = re.compile(r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})")

    for blk in block:
        lines = blk.strip().split("\n")
        if len(lines) < 3:
            continue
        m = time_re.search(lines[1])
        if not m:
            continue
        start = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + int(m.group(4)) / 1000
        end = int(m.group(5)) * 3600 + int(m.group(6)) * 60 + int(m.group(7)) + int(m.group(8)) / 1000
        text = " ".join(lines[2:]).strip()
        if not text:
            continue
        parts = text.split()
        n = max(1, len(parts))
        dur = (end - start) / n
        for i, word in enumerate(parts):
            words.append({
                "word": word,
                "start": start + i * dur,
                "end": start + (i + 1) * dur,
            })
    return words


def srt_or_words_to_ass(srt_content: str, words: list[dict] | None) -> str:
    """
    Generate ASS from either word list (preferred) or edited SRT.
    If words provided, use them. Else parse srt_content to words with estimated timing.
    """
    if words:
        return _words_to_ass_highlight(words)
    return _words_to_ass_highlight(_parse_srt_to_words(srt_content))


def _transcribe_with_stable_ts(audio_path: str, model_size: str) -> list[dict]:
    """Use stable-ts for refined word-level timing (CapCut-style sync)."""
    import stable_whisper
    model = stable_whisper.load_model(model_size)
    result = model.transcribe(
        audio_path,
        word_timestamps=True,
        suppress_silence=True,
        vad=True,
        no_speech_threshold=0.0,
        condition_on_previous_text=False,
    )
    words = []
    for wt in result.all_words():
        word = (wt.word or "").strip()
        if word:
            words.append({"word": word, "start": wt.start, "end": wt.end})
    return words


def _transcribe_with_whisper_fallback(audio_path: str, model_size: str) -> list[dict]:
    """Fallback when stable-ts returns no words (e.g. empty/silent audio)."""
    import stable_whisper
    result = stable_whisper.load_model(model_size).transcribe(
        audio_path,
        word_timestamps=False,
        no_speech_threshold=0.0,
        condition_on_previous_text=False,
    )
    words = []
    for seg in result.segments:
        text = (seg.text or "").strip()
        if not text:
            continue
        start, end = seg.start, seg.end
        parts = text.split()
        n = max(1, len(parts))
        seg_dur = (end - start) / n
        for i, word in enumerate(parts):
            words.append({
                "word": word,
                "start": start + i * seg_dur,
                "end": start + (i + 1) * seg_dur,
            })
    return words


def _sec_to_srt(seconds: float) -> str:
    """Convert seconds to SRT timestamp format."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def burn_subtitles_into_video(
    video_path: str,
    subtitle_path: str,
    output_path: str,
    *,
    use_ass_style: bool = True,
) -> None:
    """
    Burn subtitles into video. Supports SRT and ASS.
    use_ass_style: if True and file is .ass, use ASS styling (no force_style override).
    """
    escaped = subtitle_path.replace("\\", "\\\\").replace("'", "'\\''").replace(":", "\\:")
    is_ass = subtitle_path.lower().endswith(".ass")
    if is_ass and use_ass_style:
        vf = f"subtitles='{escaped}'"
    else:
        vf = f"subtitles='{escaped}':force_style='FontSize=14,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,Outline=1,Alignment=5'"
    try:
        (
            ffmpeg
            .input(video_path)
            .output(
                output_path,
                vf=vf,
                vcodec="libx264",
                pix_fmt="yuv420p",
                **{"profile:v": "main"},
                acodec="copy"
            )
            .overwrite_output()
            .run(capture_stdout=True, capture_stderr=True)
        )
    except ffmpeg.Error as e:
        stderr = e.stderr.decode() if e.stderr else "No stderr"
        raise RuntimeError(f"FFmpeg error: {stderr}") from e


def run_full_pipeline(
    mp3_path: str,
    clips_folder: str,
    output_path: str,
    generate_captions: bool = True,
    srt_content: str | None = None,
    caption_words: list[dict] | None = None,
    whisper_model: str = "base",
    background_music_folder: str | None = None,
    background_music_path: str | None = None,
    background_volume: float = 1.0,
    ending_clip_path: str | None = None,
    progress_callback=None,
    normalize_voiceover_peak_to_db0: bool = False,
    normalize_background_music_peak_to_db: float | None = None,
    keep_voiceover_through_ending: bool = True,
    voice_volume: float = 1.0,
) -> str:
    """
    Full pipeline: select clips, concatenate, replace audio, optionally add captions.
    If generate_captions and srt_content is provided, uses it instead of transcribing.
    caption_words: word-level timing for ASS highlight; if None, parses srt_content.
    Returns path to final output file.
    """
    def log(msg: str):
        if progress_callback:
            progress_callback(msg)

    log("Getting audio duration...")
    audio_duration = get_audio_duration_seconds(mp3_path)
    if audio_duration <= 0:
        raise ValueError("Could not read audio duration from MP3")

    log(f"Loading video clips from folder ({audio_duration:.1f}s target)...")
    clips = get_video_clips_from_folder(clips_folder)
    if not clips:
        raise ValueError(f"No valid video clips found in {clips_folder}")

    total_clip_duration = sum(d for _, d in clips)
    if total_clip_duration < audio_duration:
        raise ValueError(
            f"Total clip duration ({total_clip_duration:.1f}s) is less than audio ({audio_duration:.1f}s). "
            "Add more or longer clips."
        )

    FADE_DURATION = 1.0
    ending_duration = 0.0
    fade_duration = FADE_DURATION
    segments = None

    if ending_clip_path and os.path.isfile(ending_clip_path):
        ending_full_duration = get_video_duration_seconds(ending_clip_path)
        if ending_full_duration <= 0:
            ending_clip_path = None
        else:
            if keep_voiceover_through_ending:
                # Keep the voiceover running through the ending clip:
                # output length stays matched to the voiceover duration.
                ending_duration = min(ending_full_duration, audio_duration - FADE_DURATION)
                if ending_duration <= 0:
                    ending_clip_path = None
                else:
                    clips_target = audio_duration - ending_duration + FADE_DURATION
                    if clips_target <= 0 or total_clip_duration < clips_target:
                        ending_clip_path = None
                    else:
                        fade_duration = FADE_DURATION
                        log(f"Adding ending clip with {fade_duration}s fade transition (voiceover kept)...")
                        segments = select_clips_to_fill_duration(clips, clips_target, randomize=True)
            else:
                # Extend the ending clip *after* the voiceover ends:
                # background music continues, voiceover stops.
                fade_duration = min(FADE_DURATION, ending_full_duration)
                if fade_duration <= 0 or audio_duration < fade_duration:
                    ending_clip_path = None
                else:
                    ending_duration = ending_full_duration
                    log(
                        f"Adding ending clip after voiceover ends (fade={fade_duration}s, voiceover stops)..."
                    )
                    segments = select_clips_to_fill_duration(clips, audio_duration, randomize=True)

    if segments is None:
        log("Selecting and ordering clips...")
        segments = select_clips_to_fill_duration(clips, audio_duration, randomize=True)

    if not segments:
        raise ValueError("Could not select clips")

    main_duration = sum(end - start for _, start, end in segments)
    video_duration = main_duration
    if ending_clip_path:
        # xfade output length = main_duration + ending_duration - fade_duration
        video_duration = main_duration + ending_duration - fade_duration

    with tempfile.TemporaryDirectory() as tmp:
        voiceover_audio = mp3_path
        if normalize_voiceover_peak_to_db0:
            log("Normalizing voiceover peak to 0 dB...")
            normalized_audio = os.path.join(tmp, "voiceover_normalized.m4a")
            voiceover_audio = normalize_audio_peak_to_db(
                mp3_path, normalized_audio, target_db=0.0
            )
            if voiceover_audio == mp3_path:
                log("Voiceover normalization skipped (already near 0 dB or no reliable peak detected).")

        log("Concatenating clips...")
        if ending_clip_path:
            concat_video = concatenate_with_ending_and_fade(
                segments, ending_clip_path, ending_duration, tmp, fade_duration
            )
        else:
            concat_video = concatenate_clips_with_ffmpeg(segments, tmp)

        video_with_audio = os.path.join(tmp, "with_audio.mp4")
        audio_to_use = voiceover_audio
        replace_audio_volume = voice_volume
        bg_song: str | None = None
        if background_music_path:
            bg_song = background_music_path
        elif background_music_folder:
            bg_song = get_random_audio_from_folder(background_music_folder)

        if bg_song:
            bg_audio_for_mix = bg_song
            background_volume_to_use = background_volume
            if normalize_background_music_peak_to_db is not None:
                log(
                    f"Normalizing background music peak to {normalize_background_music_peak_to_db} dB: {os.path.basename(bg_song)}"
                )
                normalized_bg = os.path.join(tmp, "bg_music_normalized.m4a")
                bg_audio_for_mix = normalize_audio_peak_to_db(
                    bg_song,
                    normalized_bg,
                    target_db=normalize_background_music_peak_to_db,
                )

            log(
                f"Mixing with background music (volume={background_volume_to_use}): {os.path.basename(bg_song)}"
            )
            mixed_audio = os.path.join(tmp, "mixed_audio.m4a")
            mix_audio_with_background(
                voiceover_audio,
                bg_audio_for_mix,
                mixed_audio,
                duration_seconds=video_duration,
                background_volume=background_volume_to_use,
                main_volume=voice_volume,
            )
            audio_to_use = mixed_audio
            replace_audio_volume = 1.0
        else:
            log("No background music provided - using voiceover only")
        log("Replacing video audio with your voiceover...")
        replace_audio_with_mp3(
            concat_video,
            audio_to_use,
            video_with_audio,
            audio_volume=replace_audio_volume,
        )

        final_input = video_with_audio

        if generate_captions:
            words_for_ass = caption_words
            if srt_content is None:
                log("Generating captions (this may take a few minutes)...")
                words_for_ass = _transcribe_to_words(voiceover_audio, whisper_model)
                srt_content = _words_to_srt(words_for_ass) if words_for_ass else ""
            if srt_content and srt_content.strip():
                log("Burning captions into video (ASS highlight style)...")
                ass_content = srt_or_words_to_ass(srt_content, words_for_ass)
                ass_path = os.path.join(tmp, "captions.ass")
                with open(ass_path, "w", encoding="utf-8") as f:
                    f.write(ass_content)
                final_output = os.path.join(tmp, "final.mp4")
                burn_subtitles_into_video(video_with_audio, ass_path, final_output)
                final_input = final_output
            else:
                log("No speech detected - skipping captions")

        log("Writing final output...")
        import shutil
        shutil.copy2(final_input, output_path)

    log("Done!")
    return output_path
