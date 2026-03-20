"""
CaptionTester - NCA-style caption overlay on black screen.

Works exactly like the No-Code Architects toolkit:
- Transcribes with Whisper (word_timestamps=True)
- Generates ASS with highlight style (current word in yellow)
- Creates black video + audio + captions for testing

Usage:
    python caption_tester.py <audio_file> [output_video]   # CLI, no GUI
    python caption_tester.py --from-config                 # CLI using saved config
    python caption_tester.py --styles                      # Style picker GUI (5 styles)
    python caption_tester.py                               # Opens main GUI

Or use run.bat / run.ps1 (same behavior, uses venv).
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import ffmpeg

# Add common FFmpeg paths if not in PATH (Whisper and ffmpeg-python need it)
def _ensure_ffmpeg_in_path():
    for path in [r"C:\ffmpeg\bin", r"C:\ffmpeg", r"C:\Program Files\ffmpeg\bin"]:
        ffmpeg_exe = os.path.join(path, "ffmpeg.exe")
        if os.path.isfile(ffmpeg_exe):
            path_env = os.environ.get("PATH", "")
            if path not in path_env:
                os.environ["PATH"] = path + os.pathsep + path_env
            break


_ensure_ffmpeg_in_path()


def check_ffmpeg(log=None) -> bool:
    """Check if ffmpeg/ffprobe is available. Log result."""
    def _log(msg): (log or print)(msg)
    ok = True
    for cmd in ["ffprobe", "ffmpeg"]:
        try:
            r = subprocess.run(
                [cmd, "-version"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if r.returncode == 0:
                _log(f"{cmd}: OK")
            else:
                _log(f"{cmd}: failed (code {r.returncode})")
                ok = False
        except FileNotFoundError:
            _log(f"{cmd}: NOT FOUND (add FFmpeg to PATH, e.g. C:\\ffmpeg\\bin)")
            ok = False
        except Exception as e:
            _log(f"{cmd}: {type(e).__name__}: {e}")
            ok = False
    return ok


def get_audio_duration_seconds(audio_path: str) -> float:
    """Get duration of audio file using ffprobe."""
    # Try ffmpeg.probe first
    try:
        probe = ffmpeg.probe(audio_path)
        duration = float(probe.get("format", {}).get("duration", 0))
        if duration > 0:
            return duration
        for stream in probe.get("streams", []):
            if stream.get("codec_type") == "audio":
                d = float(stream.get("duration", 0))
                if d > 0:
                    return d
    except Exception:
        pass

    # Fallback: run ffprobe directly (handles more formats)
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                audio_path,
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0 and result.stdout.strip():
            return float(result.stdout.strip())
    except Exception:
        pass
    return 0.0


def transcribe_with_whisper(audio_path: str, model_size: str = "base"):
    """Transcribe with stable-ts for better word-level timing (fewer skipped words)."""
    import stable_whisper
    model = stable_whisper.load_model(model_size)
    result = model.transcribe(
        audio_path,
        word_timestamps=True,
        suppress_silence=True,
        vad=False,  # VAD requires 'packaging' module; disable to avoid dependency
        no_speech_threshold=0.0,
        condition_on_previous_text=False,
    )
    # Use all_words() for complete word list - avoids missing words from segment boundaries
    all_words = []
    for w in result.all_words():
        word = (w.word or "").strip()
        if word:
            all_words.append({"word": word, "start": w.start, "end": w.end})

    if all_words:
        return {"segments": [{"start": 0, "end": 0, "text": "", "words": all_words}]}
    # Fallback: no word timestamps - use segments with text
    segments = []
    for seg in result.segments:
        text = (seg.text or "").strip()
        if text:
            segments.append({"start": seg.start, "end": seg.end, "text": text, "words": []})
    return {"segments": segments}


def generate_ass_subtitle(result, max_chars: int = 56) -> str:
    """
    Generate ASS subtitle content: one word at a time on screen (no highlight).
    Falls back to segment-level timing when word timestamps are missing.
    """
    ass_content = ""
    MIN_WORD_DUR = 1.2   # Minimum time each word stays on screen
    GAP_BEFORE_NEXT = 0.08  # Brief pause before next word appears
    FADE_IN_MS = 120     # Smooth fade in (ms)
    FADE_OUT_MS = 180    # Smooth fade out (ms)

    def format_time(t):
        hours = int(t // 3600)
        minutes = int((t % 3600) // 60)
        seconds = int(t % 60)
        centiseconds = int(round((t - int(t)) * 100))
        return f"{hours}:{minutes:02d}:{seconds:02d}.{centiseconds:02d}"

    for segment in result["segments"]:
        words = segment.get("words", [])
        seg_start = segment["start"]
        seg_end = segment["end"]
        text = (segment.get("text") or "").strip()

        if not words and text:
            # Fallback: no word timestamps - split segment text and distribute time
            parts = text.split()
            n = max(1, len(parts))
            dur = (seg_end - seg_start) / n
            words = [
                {"word": w, "start": seg_start + i * dur, "end": seg_start + (i + 1) * dur}
                for i, w in enumerate(parts)
            ]

        for i, word_info in enumerate(words):
            start_time = word_info["start"]
            end_time = word_info["end"]
            word_text = word_info.get("word", "").strip()
            if not word_text:
                continue

            # Hold word longer: at least MIN_WORD_DUR, extend to just before next word
            end_time = max(end_time, start_time + MIN_WORD_DUR)
            if i + 1 < len(words):
                end_time = min(end_time, words[i + 1]["start"] - GAP_BEFORE_NEXT)

            start = format_time(start_time)
            end = format_time(end_time)
            ass_content += f"Dialogue: 0,{start},{end},Default,,0,0,0,,{{\\fad({FADE_IN_MS},{FADE_OUT_MS})}}{word_text}\n"

    return ass_content


# 5 caption styles: id -> (display name, ASS style line)
# ASS colours: &H00BBGGRR
CAPTION_STYLES = {
    "classic": (
        "Classic",
        "Style: Default,Arial,72,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,0,2,40,40,80,1",
    ),
    "bold": (
        "Bold Impact",
        "Style: Default,Impact,84,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,2,2,40,40,80,1",
    ),
    "minimal": (
        "Minimal",
        "Style: Default,Georgia,48,&H00E0E0E0,&H40000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,40,40,120,1",
    ),
    "neon": (
        "Neon",
        "Style: Default,Trebuchet MS,78,&H00FFFF00,&H000000FF,&H80000000,-1,0,0,0,100,100,0,0,1,2,3,2,40,40,80,1",
    ),
    "warm": (
        "Warm",
        "Style: Default,Verdana,80,&H000080FF,&H00002040,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,40,40,80,1",
    ),
}


def build_ass_file(ass_content: str, style_id: str = "classic") -> str:
    """Wrap ASS events in full ASS file with header. style_id from CAPTION_STYLES."""
    style_line = CAPTION_STYLES.get(style_id, CAPTION_STYLES["classic"])[1]
    header = f"""[Script Info]
Title: CaptionTester
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
{style_line}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    return header + ass_content


def create_black_video_with_audio_and_captions(
    audio_path: str,
    output_path: str,
    ass_path: str,
    duration: float,
) -> None:
    """Create black video, add audio, burn ASS captions."""
    lavfi_src = f"color=c=black:s=1920x1080:d={duration}:r=30"
    # FFmpeg subtitles filter on Windows: escape backslashes and colons
    ass_abs = str(Path(ass_path).resolve())
    ass_escaped = ass_abs.replace("\\", "\\\\").replace(":", "\\:")
    cmd = [
        "ffmpeg",
        "-y",
        "-f", "lavfi",
        "-i", lavfi_src,
        "-i", audio_path,
        "-vf", f"subtitles='{ass_escaped}'",
        "-shortest",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-ar", "44100",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg error: {result.stderr}") from None


def get_duration_from_whisper(audio_path: str) -> float:
    """Get duration by loading audio with Whisper (works when ffprobe fails)."""
    import whisper
    audio = whisper.load_audio(audio_path)
    return len(audio) / 16000.0  # Whisper uses 16kHz


def run(
    audio_path: str,
    output_path: str | None = None,
    model_size: str = "base",
    style_id: str = "classic",
    log=None,
) -> str:
    """Full pipeline: transcribe, generate ASS, create black video with captions."""
    audio_path = os.path.abspath(audio_path)
    if not os.path.isfile(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    if output_path is None:
        base = Path(audio_path).stem
        output_path = str(Path(audio_path).parent / f"{base}_captioned.mp4")

    def _log(msg: str):
        (log or print)(msg)

    _log("Checking ffmpeg/ffprobe...")
    check_ffmpeg(log=_log)
    _log("")
    _log(f"Audio: {audio_path}")
    _log(f"Output: {output_path}")
    _log("")

    _log("Getting audio duration...")
    duration = get_audio_duration_seconds(audio_path)
    if duration <= 0:
        _log("ffprobe failed, trying Whisper to get duration...")
        duration = get_duration_from_whisper(audio_path)
    if duration <= 0:
        raise ValueError("Could not read audio duration")
    _log(f"Duration: {duration:.1f}s")
    _log("")

    _log("Transcribing (Whisper with word_timestamps)...")
    result = transcribe_with_whisper(audio_path, model_size)
    _log("Transcription done.")
    _log("")

    _log(f"Generating ASS captions (style: {style_id})...")
    ass_events = generate_ass_subtitle(result, max_chars=56)
    ass_content = build_ass_file(ass_events, style_id)

    # Write ASS to system temp dir (avoids OneDrive sync / permission issues)
    fd, ass_path_str = tempfile.mkstemp(suffix=".ass", prefix="captiontester_")
    ass_path = Path(ass_path_str)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(ass_content)
    except Exception:
        ass_path.unlink(missing_ok=True)
        raise
    try:
        _log("Creating black video with audio and captions...")
        create_black_video_with_audio_and_captions(
            audio_path, output_path, str(ass_path), duration
        )
    finally:
        try:
            ass_path.unlink(missing_ok=True)
        except OSError:
            pass

    _log(f"Done: {output_path}")
    return output_path


def _run_style_picker_gui(config_path: Path):
    """GUI with 5 caption styles; click to export that style."""
    import json
    import threading
    import traceback
    import tkinter as tk
    from tkinter import messagebox, ttk

    def load_config():
        try:
            if config_path.exists():
                with open(config_path, encoding="utf-8") as f:
                    return json.load(f)
        except Exception:
            pass
        return {}

    cfg = load_config()
    audio = (cfg.get("audio") or "").strip()
    output = (cfg.get("output") or "").strip()
    if not audio or not output or not os.path.isfile(audio):
        print("Config missing valid audio/output. Run main GUI first, set paths, save.")
        return

    root = tk.Tk()
    root.title("CaptionTester - Pick a Style")
    root.geometry("520x420")
    root.resizable(False, False)

    # Output to CaptionTester/output/ to avoid OneDrive Downloads permission issues
    output_stem = Path(output).stem
    output_dir = config_path.parent / "output"
    output_dir.mkdir(exist_ok=True)

    status_var = tk.StringVar(value=f"Audio: {Path(audio).name} → {output_dir.name}/")

    def export_style(style_id: str):
        out_path = str(output_dir / f"{output_stem}_{style_id}.mp4")
        btn = style_buttons.get(style_id)
        if btn:
            btn.config(state=tk.DISABLED, text="Exporting...")

        def do_work():
            err_msg = None
            try:
                run(audio, out_path, style_id=style_id)
                root.after(0, lambda: messagebox.showinfo("Done", f"Saved:\n{out_path}"))
            except Exception as e:
                err_msg = str(e)
                root.after(0, lambda m=err_msg: messagebox.showerror("Error", m))
            finally:
                if btn:
                    root.after(0, lambda: btn.config(state=tk.NORMAL, text=CAPTION_STYLES[style_id][0]))

        threading.Thread(target=do_work, daemon=True).start()

    style_buttons = {}
    styles_frame = ttk.LabelFrame(root, text="Choose a caption style (click to export)", padding=15)
    styles_frame.pack(fill=tk.BOTH, expand=True, padx=20, pady=15)

    style_descriptions = {
        "classic": "Clean white, Arial, large — timeless and readable",
        "bold": "Impact font, yellow highlight, thick outline — high energy",
        "minimal": "Georgia, soft gray, thin — elegant and subtle",
        "neon": "Trebuchet, cyan text, magenta outline — modern pop",
        "warm": "Verdana, amber/orange, bold — cozy and inviting",
    }

    for i, (style_id, (name, _)) in enumerate(CAPTION_STYLES.items()):
        row = ttk.Frame(styles_frame)
        row.pack(fill=tk.X, pady=4)
        desc = style_descriptions.get(style_id, "")
        ttk.Label(row, text=name + ":", font=("", 10, "bold"), width=14, anchor=tk.W).pack(side=tk.LEFT, padx=(0, 8))
        ttk.Label(row, text=desc, font=("", 9)).pack(side=tk.LEFT, fill=tk.X, expand=True)
        btn = ttk.Button(row, text="Export", command=lambda s=style_id: export_style(s))
        btn.pack(side=tk.RIGHT, padx=(8, 0))
        style_buttons[style_id] = btn

    ttk.Label(root, textvariable=status_var, font=("", 9)).pack(pady=(0, 10))
    root.mainloop()


def main():
    CONFIG_PATH = Path(__file__).parent / "caption_tester_config.json"

    # --from-config: run headless using saved config (no GUI)
    if "--from-config" in sys.argv or "-c" in sys.argv:
        try:
            if CONFIG_PATH.exists():
                with open(CONFIG_PATH, encoding="utf-8") as f:
                    cfg = __import__("json").load(f)
                audio = (cfg.get("audio") or "").strip()
                output = (cfg.get("output") or "").strip()
                if audio and output and os.path.isfile(audio):
                    run(audio, output)
                    return
                print("Config missing valid audio/output or audio file not found.")
            else:
                print("No config file. Run GUI once, set paths, and save.")
        except Exception as e:
            print(f"Error: {e}")
            sys.exit(1)
        sys.exit(1)

    # --styles: style picker GUI
    if "--styles" in sys.argv or "-s" in sys.argv:
        _run_style_picker_gui(CONFIG_PATH)
        return

    if len(sys.argv) >= 2 and not sys.argv[1].startswith("-"):
        audio = sys.argv[1]
        output = sys.argv[2] if len(sys.argv) >= 3 else None
        run(audio, output)
    else:
        import json
        import threading
        import traceback
        import tkinter as tk
        from tkinter import filedialog, messagebox, ttk

        CONFIG_PATH = Path(__file__).parent / "caption_tester_config.json"

        def load_config():
            try:
                if CONFIG_PATH.exists():
                    with open(CONFIG_PATH, encoding="utf-8") as f:
                        return json.load(f)
            except Exception:
                pass
            return {}

        def save_config(audio: str, output: str, auto_run: bool):
            try:
                with open(CONFIG_PATH, "w", encoding="utf-8") as f:
                    json.dump({"audio": audio, "output": output, "auto_run": auto_run}, f, indent=2)
            except Exception:
                pass

        root = tk.Tk()
        root.title("CaptionTester - NCA Style")
        root.geometry("700x520")
        root.minsize(500, 400)

        cfg = load_config()
        audio_var = tk.StringVar(value=cfg.get("audio", ""))
        output_var = tk.StringVar(value=cfg.get("output", ""))
        auto_run_var = tk.BooleanVar(value=cfg.get("auto_run", False))

        def log(msg: str):
            log_text.config(state=tk.NORMAL)
            log_text.insert(tk.END, msg + "\n")
            log_text.see(tk.END)
            log_text.config(state=tk.DISABLED)
            root.update_idletasks()

        def browse_audio():
            path = filedialog.askopenfilename(
                title="Select audio file",
                filetypes=[
                    ("Audio", "*.mp3 *.wav *.m4a *.aac *.flac *.ogg"),
                    ("All", "*.*"),
                ],
            )
            if path:
                audio_var.set(path)
                if not output_var.get():
                    base = Path(path).stem
                    output_var.set(str(Path(path).parent / f"{base}_captioned.mp4"))

        def browse_output():
            path = filedialog.asksaveasfilename(
                title="Save captioned video as",
                defaultextension=".mp4",
                filetypes=[("MP4", "*.mp4"), ("All", "*.*")],
            )
            if path:
                output_var.set(path)

        def run_task():
            audio = audio_var.get().strip()
            output = output_var.get().strip()
            if not audio:
                messagebox.showwarning("Input", "Select an audio file.")
                return
            if not output:
                messagebox.showwarning("Output", "Select an output path.")
                return

            run_btn.config(state=tk.DISABLED)
            log_text.config(state=tk.NORMAL)
            log_text.delete(1.0, tk.END)
            log_text.config(state=tk.DISABLED)

            def do_work():
                try:
                    run(audio, output, log=log)
                    root.after(0, lambda: messagebox.showinfo("Done", f"Saved to:\n{output}"))
                except Exception as e:
                    tb = traceback.format_exc()
                    err_msg = str(e)
                    root.after(0, lambda t=tb: log(f"\n--- ERROR ---\n{t}"))
                    root.after(0, lambda m=err_msg: messagebox.showerror("Error", m))
                finally:
                    root.after(0, lambda: run_btn.config(state=tk.NORMAL))

            save_config(audio, output, auto_run_var.get())
            threading.Thread(target=do_work, daemon=True).start()

        # Layout
        f = ttk.Frame(root, padding=10)
        f.pack(fill=tk.BOTH, expand=True)

        ttk.Label(f, text="Audio file:", font=("", 10, "bold")).grid(row=0, column=0, sticky=tk.W, pady=2)
        ttk.Entry(f, textvariable=audio_var, width=55).grid(row=0, column=1, padx=5, pady=2, sticky=tk.EW)
        ttk.Button(f, text="Browse...", command=browse_audio).grid(row=0, column=2, pady=2)

        ttk.Label(f, text="Output video:", font=("", 10, "bold")).grid(row=1, column=0, sticky=tk.W, pady=2)
        ttk.Entry(f, textvariable=output_var, width=55).grid(row=1, column=1, padx=5, pady=2, sticky=tk.EW)
        ttk.Button(f, text="Browse...", command=browse_output).grid(row=1, column=2, pady=2)

        run_btn = ttk.Button(f, text="Run", command=run_task)
        run_btn.grid(row=2, column=1, pady=10)
        ttk.Checkbutton(f, text="Auto-run on startup", variable=auto_run_var).grid(row=2, column=2, padx=5)

        ttk.Label(f, text="Log:", font=("", 10, "bold")).grid(row=3, column=0, sticky=tk.NW, pady=(15, 2))

        def maybe_auto_run():
            if auto_run_var.get() and audio_var.get().strip() and output_var.get().strip():
                if os.path.isfile(audio_var.get().strip()):
                    run_task()

        root.after(500, maybe_auto_run)
        log_frame = ttk.Frame(f)
        log_frame.grid(row=4, column=0, columnspan=3, sticky=tk.NSEW, pady=2)
        f.columnconfigure(1, weight=1)
        f.rowconfigure(4, weight=1)

        log_text = tk.Text(log_frame, wrap=tk.WORD, font=("Consolas", 9), height=18, state=tk.DISABLED)
        log_scroll = ttk.Scrollbar(log_frame)
        log_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        log_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        log_text.config(yscrollcommand=log_scroll.set)
        log_scroll.config(command=log_text.yview)

        root.mainloop()


if __name__ == "__main__":
    main()
