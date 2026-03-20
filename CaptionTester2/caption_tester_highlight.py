"""
CaptionTester2 - One word at a time with YELLOW HIGHLIGHT (NCA-style).

Original highlight style: current word in yellow, centered, one word at a time.

Usage:
    python caption_tester_highlight.py <audio_file> [output_video]
    python caption_tester_highlight.py --from-config
    python caption_tester_highlight.py   (opens GUI)
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import ffmpeg

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
    def _log(msg): (log or print)(msg)
    ok = True
    for cmd in ["ffprobe", "ffmpeg"]:
        try:
            r = subprocess.run([cmd, "-version"], capture_output=True, text=True, timeout=5)
            _log(f"{cmd}: OK" if r.returncode == 0 else f"{cmd}: failed")
            if r.returncode != 0:
                ok = False
        except FileNotFoundError:
            _log(f"{cmd}: NOT FOUND")
            ok = False
    return ok


def get_audio_duration_seconds(audio_path: str) -> float:
    try:
        probe = ffmpeg.probe(audio_path)
        duration = float(probe.get("format", {}).get("duration", 0))
        if duration > 0:
            return duration
    except Exception:
        pass
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", audio_path],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0 and result.stdout.strip():
            return float(result.stdout.strip())
    except Exception:
        pass
    return 0.0


def transcribe_with_whisper(audio_path: str, model_size: str = "base"):
    import stable_whisper
    model = stable_whisper.load_model(model_size)
    result = model.transcribe(
        audio_path,
        word_timestamps=True,
        suppress_silence=True,
        vad=False,
        no_speech_threshold=0.0,
        condition_on_previous_text=False,
    )
    all_words = []
    for w in result.all_words():
        word = (w.word or "").strip()
        if word:
            all_words.append({"word": word, "start": w.start, "end": w.end})
    if all_words:
        return {"segments": [{"start": 0, "end": 0, "text": "", "words": all_words}]}
    segments = []
    for seg in result.segments:
        text = (seg.text or "").strip()
        if text:
            segments.append({"start": seg.start, "end": seg.end, "text": text, "words": []})
    return {"segments": segments}


def generate_ass_subtitle(result) -> str:
    """One word at a time, each word uses Highlight style (yellow)."""
    ass_content = ""
    MIN_WORD_DUR = 1.2
    GAP_BEFORE_NEXT = 0.08
    FADE_IN_MS = 120
    FADE_OUT_MS = 180

    def format_time(t):
        h = int(t // 3600)
        m = int((t % 3600) // 60)
        s = int(t % 60)
        cs = int(round((t - int(t)) * 100))
        return f"{h}:{m:02d}:{s:02d}.{cs:02d}"

    for segment in result["segments"]:
        words = segment.get("words", [])
        seg_start, seg_end = segment["start"], segment["end"]
        text = (segment.get("text") or "").strip()

        if not words and text:
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

            end_time = max(end_time, start_time + MIN_WORD_DUR)
            if i + 1 < len(words):
                end_time = min(end_time, words[i + 1]["start"] - GAP_BEFORE_NEXT)

            start = format_time(start_time)
            end = format_time(end_time)
            # Use Highlight style - yellow, bold
            ass_content += f"Dialogue: 0,{start},{end},Highlight,,0,0,0,,{{\\fad({FADE_IN_MS},{FADE_OUT_MS})}}{word_text}\n"

    return ass_content


def build_ass_file(ass_content: str) -> str:
    """ASS with Default (white) and Highlight (yellow) styles. Words use Highlight."""
    header = """[Script Info]
Title: CaptionTester2 - Highlight
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,72,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,0,2,40,40,80,1
Style: Highlight,Arial,72,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,2,40,40,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    return header + ass_content


def create_black_video_with_audio_and_captions(
    audio_path: str, output_path: str, ass_path: str, duration: float,
) -> None:
    lavfi_src = f"color=c=black:s=1920x1080:d={duration}:r=30"
    ass_abs = str(Path(ass_path).resolve())
    ass_escaped = ass_abs.replace("\\", "\\\\").replace(":", "\\:")
    cmd = [
        "ffmpeg", "-y", "-f", "lavfi", "-i", lavfi_src,
        "-i", audio_path,
        "-vf", f"subtitles='{ass_escaped}'",
        "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", "44100", output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg error: {result.stderr}") from None


def get_duration_from_whisper(audio_path: str) -> float:
    import whisper
    audio = whisper.load_audio(audio_path)
    return len(audio) / 16000.0


def run(audio_path: str, output_path: str | None = None, model_size: str = "base", log=None) -> str:
    audio_path = os.path.abspath(audio_path)
    if not os.path.isfile(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    if output_path is None:
        base = Path(audio_path).stem
        output_path = str(Path(audio_path).parent / f"{base}_highlight.mp4")

    def _log(msg): (log or print)(msg)

    _log("Checking ffmpeg/ffprobe...")
    check_ffmpeg(log=_log)
    _log(f"Audio: {audio_path}\nOutput: {output_path}\n")

    _log("Getting audio duration...")
    duration = get_audio_duration_seconds(audio_path)
    if duration <= 0:
        duration = get_duration_from_whisper(audio_path)
    if duration <= 0:
        raise ValueError("Could not read audio duration")
    _log(f"Duration: {duration:.1f}s\n")

    _log("Transcribing (Whisper)...")
    result = transcribe_with_whisper(audio_path, model_size)
    _log("Transcription done.\n")

    _log("Generating ASS (one word, yellow highlight)...")
    ass_events = generate_ass_subtitle(result)
    ass_content = build_ass_file(ass_events)

    fd, ass_path_str = tempfile.mkstemp(suffix=".ass", prefix="captiontester2_")
    ass_path = Path(ass_path_str)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(ass_content)
    except Exception:
        ass_path.unlink(missing_ok=True)
        raise
    try:
        _log("Creating black video with captions...")
        create_black_video_with_audio_and_captions(audio_path, output_path, str(ass_path), duration)
    finally:
        try:
            ass_path.unlink(missing_ok=True)
        except OSError:
            pass

    _log(f"Done: {output_path}")
    return output_path


def main():
    CONFIG_PATH = Path(__file__).parent / "caption_tester2_config.json"

    if "--from-config" in sys.argv or "-c" in sys.argv:
        try:
            config_file = CONFIG_PATH
            if not config_file.exists():
                config_file = Path(__file__).parent.parent / "CaptionTester" / "caption_tester_config.json"
            if config_file.exists():
                with open(config_file, encoding="utf-8") as f:
                    cfg = __import__("json").load(f)
                audio = (cfg.get("audio") or "").strip()
                output = (cfg.get("output") or "").strip()
                if output and not output.endswith("_highlight.mp4"):
                    output = str(Path(output).with_suffix("")) + "_highlight.mp4"
                if audio and output and os.path.isfile(audio):
                    run(audio, output)
                    return
            print("No config. Run GUI first, or run CaptionTester GUI to create config.")
        except Exception as e:
            print(f"Error: {e}")
            sys.exit(1)
        sys.exit(1)

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
        root.title("CaptionTester2 - One Word Highlight")
        root.geometry("700x520")

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
                filetypes=[("Audio", "*.mp3 *.wav *.m4a *.aac *.flac *.ogg"), ("All", "*.*")],
            )
            if path:
                audio_var.set(path)
                if not output_var.get():
                    output_var.set(str(Path(path).parent / f"{Path(path).stem}_highlight.mp4"))

        def browse_output():
            path = filedialog.asksaveasfilename(
                title="Save as", defaultextension=".mp4", filetypes=[("MP4", "*.mp4"), ("All", "*.*")],
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
                    err_msg = str(e)
                    root.after(0, lambda m=err_msg: messagebox.showerror("Error", m))
                finally:
                    root.after(0, lambda: run_btn.config(state=tk.NORMAL))

            save_config(audio, output, auto_run_var.get())
            threading.Thread(target=do_work, daemon=True).start()

        f = ttk.Frame(root, padding=10)
        f.pack(fill=tk.BOTH, expand=True)

        ttk.Label(f, text="Audio:", font=("", 10, "bold")).grid(row=0, column=0, sticky=tk.W, pady=2)
        ttk.Entry(f, textvariable=audio_var, width=55).grid(row=0, column=1, padx=5, pady=2, sticky=tk.EW)
        ttk.Button(f, text="Browse...", command=browse_audio).grid(row=0, column=2, pady=2)

        ttk.Label(f, text="Output:", font=("", 10, "bold")).grid(row=1, column=0, sticky=tk.W, pady=2)
        ttk.Entry(f, textvariable=output_var, width=55).grid(row=1, column=1, padx=5, pady=2, sticky=tk.EW)
        ttk.Button(f, text="Browse...", command=browse_output).grid(row=1, column=2, pady=2)

        run_btn = ttk.Button(f, text="Run (one word, yellow highlight)", command=run_task)
        run_btn.grid(row=2, column=1, pady=10)
        ttk.Checkbutton(f, text="Auto-run on startup", variable=auto_run_var).grid(row=2, column=2, padx=5)

        ttk.Label(f, text="Log:", font=("", 10, "bold")).grid(row=3, column=0, sticky=tk.NW, pady=(15, 2))
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

        def maybe_auto_run():
            if auto_run_var.get() and audio_var.get().strip() and output_var.get().strip():
                if os.path.isfile(audio_var.get().strip()):
                    run_task()

        root.after(500, maybe_auto_run)
        root.mainloop()


if __name__ == "__main__":
    main()
