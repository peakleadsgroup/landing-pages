"""
Automated Video Editor - Desktop GUI
Randomly assembles clips + appends a selected ending clip, overlaid with a voiceover.
Captions are intentionally disabled in this version.
"""
import os
import subprocess
import tempfile
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from video_editor import (
    get_audio_duration_seconds,
    get_random_audio_from_folder,
    mix_audio_with_background,
    run_full_pipeline,
)


VIDEO_CLIPS_DIR = r"C:\Users\dr3wh\OneDrive\Desktop\PeakLeadsGroup\Outsource Editing\QUICK EDITING\032626-BATHROOM TEMPLATE"
ENDING_CLIP_DEFAULT = r"C:\Users\dr3wh\OneDrive\Desktop\PeakLeadsGroup\Outsource Editing\QUICK EDITING\032626-TAP GET QUOTE\032626-TAP GET QUOTE-1.mp4"
OUTPUT_DIR = r"C:\Users\dr3wh\OneDrive\Desktop\PeakLeadsGroup\Outsource Editing\QUICK EDITING\Finished Edits"
MUSIC_DIR = r"C:\Users\dr3wh\OneDrive\Desktop\PeakLeadsGroup\Music"


def main():
    root = tk.Tk()
    root.title("Automated Video Editor (No Captions)")
    root.geometry("680x500")
    root.resizable(True, True)

    # Variables
    voiceover_path = tk.StringVar()
    music_path = tk.StringVar()
    end_file_name = tk.StringVar(value="output")

    # Voiceover slider is relative to the mixer baseline (0 dB at value=100).
    # Range 0..200 => -inf..+6.0 dB approx.
    voice_volume_percent = tk.DoubleVar(value=100.0)

    # Music slider is a straight multiplier (0..100%).
    music_volume_percent = tk.DoubleVar(value=30.0)

    # Log area
    log_text = tk.Text(root, height=10, wrap=tk.WORD, state=tk.DISABLED, font=("Consolas", 9))
    log_scroll = ttk.Scrollbar(root, command=log_text.yview)

    preview_process: list[subprocess.Popen | None] = [None]
    preview_sources_ready = False
    preview_voice_norm_path = None
    preview_bg_norm_path = None
    preview_voice_duration_s: float = 0.0
    preview_bg_song_path = None
    preview_job_id = {"id": 0}
    preview_restart_after_id: list[int | None] = [None]
    preview_mix_in_progress = [False]
    preview_mix_pending = [False]

    preview_tmp_dir = tempfile.TemporaryDirectory(prefix="videoeditor_preview_")

    def log(msg: str):
        log_text.config(state=tk.NORMAL)
        log_text.insert(tk.END, msg + "\n")
        log_text.see(tk.END)
        log_text.config(state=tk.DISABLED)
        root.update_idletasks()

    def stop_preview():
        proc = preview_process[0]
        if proc and proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass
        preview_process[0] = None

    def launch_preview():
        nonlocal preview_sources_ready, preview_voice_norm_path, preview_bg_norm_path, preview_voice_duration_s
        if not preview_sources_ready:
            return
        if not preview_voice_norm_path or not preview_bg_norm_path:
            return

        if preview_mix_in_progress[0]:
            preview_mix_pending[0] = True
            return

        stop_preview()
        voice_mult = float(voice_volume_percent.get()) / 100.0
        music_mult = float(music_volume_percent.get()) / 100.0
        if preview_voice_duration_s <= 0:
            return

        preview_job_id["id"] += 1
        local_job_id = preview_job_id["id"]
        mixed_audio = os.path.join(preview_tmp_dir.name, f"preview_mixed_{local_job_id}.m4a")

        preview_mix_in_progress[0] = True

        def do_mix_and_play():
            try:
                mix_audio_with_background(
                    preview_voice_norm_path,
                    preview_bg_norm_path,
                    mixed_audio,
                    duration_seconds=preview_voice_duration_s,
                    background_volume=music_mult,
                    main_volume=voice_mult,
                )
                if local_job_id != preview_job_id["id"]:
                    return

                def _start_ffplay():
                    try:
                        preview_process[0] = subprocess.Popen(
                            [
                                "ffplay",
                                "-nodisp",
                                "-autoexit",
                                "-hide_banner",
                                "-loglevel",
                                "error",
                                "-i",
                                mixed_audio,
                            ],
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.PIPE,
                        )
                    except FileNotFoundError:
                        messagebox.showerror(
                            "FFmpeg",
                            "ffplay not found. Install FFmpeg with ffplay on your PATH.",
                        )
                        preview_process[0] = None

                    # Update mixing state and, if needed, restart one more time.
                    preview_mix_in_progress[0] = False
                    if preview_mix_pending[0]:
                        preview_mix_pending[0] = False
                        root.after(0, launch_preview)

                root.after(0, _start_ffplay)
            except Exception as e:
                if local_job_id == preview_job_id["id"]:
                    root.after(0, lambda: log(f"Preview mix error: {e}"))
                    preview_mix_in_progress[0] = False
                    if preview_mix_pending[0]:
                        preview_mix_pending[0] = False
                        root.after(0, launch_preview)

        threading.Thread(target=do_mix_and_play, daemon=True).start()

    def schedule_preview_restart():
        if not preview_sources_ready:
            return
        if preview_restart_after_id[0] is not None:
            try:
                root.after_cancel(preview_restart_after_id[0])
            except Exception:
                pass
        preview_restart_after_id[0] = root.after(100, launch_preview)

    def start_preview():
        nonlocal preview_sources_ready, preview_voice_norm_path, preview_bg_norm_path
        nonlocal preview_bg_song_path
        voice_src = voiceover_path.get().strip()
        if not voice_src or not os.path.isfile(voice_src):
            messagebox.showwarning("Preview", "Select a voiceover audio file first.")
            return

        bg_song = music_path.get().strip()
        if not bg_song or not os.path.isfile(bg_song):
            messagebox.showwarning("Preview", "Select or randomize a music track first.")
            return

        preview_job_id["id"] += 1
        local_job_id = preview_job_id["id"]
        preview_sources_ready = False
        stop_preview()
        log("Preparing preview...")

        def do_prepare():
            nonlocal preview_sources_ready, preview_voice_norm_path, preview_bg_norm_path, preview_voice_duration_s
            nonlocal preview_bg_song_path
            try:
                if local_job_id != preview_job_id["id"]:
                    return

                preview_voice_duration_s = get_audio_duration_seconds(voice_src)
                if preview_voice_duration_s <= 0:
                    raise ValueError("Could not read voiceover duration.")

                preview_voice_norm_path = voice_src
                preview_bg_norm_path = bg_song
                preview_bg_song_path = bg_song
                preview_sources_ready = True
            except Exception as e:
                if local_job_id != preview_job_id["id"]:
                    return
                root.after(0, lambda: messagebox.showerror("Preview error", str(e)))
                preview_sources_ready = False
                return

            root.after(0, launch_preview)

        threading.Thread(target=do_prepare, daemon=True).start()

    def browse_voiceover():
        path = filedialog.askopenfilename(
            title="Select voiceover audio file",
            filetypes=[
                ("Audio files", "*.mp3 *.wav *.m4a *.aac *.flac *.ogg *.mp4"),
                ("All files", "*.*"),
            ],
        )
        if path:
            voiceover_path.set(path)
            base = os.path.splitext(os.path.basename(path))[0]
            # Keep it simple: default output name derives from audio name.
            end_file_name.set(base)

    def pick_random_music():
        nonlocal preview_sources_ready
        bg_song = get_random_audio_from_folder(MUSIC_DIR)
        if not bg_song:
            messagebox.showerror("Music", f"No music files found in:\n{MUSIC_DIR}")
            return
        music_path.set(bg_song)
        log(f"Music set to (random): {os.path.basename(bg_song)}")
        preview_sources_ready = False

    def pick_music_file():
        nonlocal preview_sources_ready
        path = filedialog.askopenfilename(
            title="Select music track",
            filetypes=[
                ("Audio/video files", "*.mp3 *.wav *.m4a *.aac *.flac *.ogg *.mp4"),
                ("All files", "*.*"),
            ],
        )
        if path:
            music_path.set(path)
            log(f"Music set to: {os.path.basename(path)}")
            preview_sources_ready = False

    def on_slider_changed(_value=None):
        schedule_preview_restart()

    def on_close():
        stop_preview()
        try:
            preview_tmp_dir.cleanup()
        except Exception:
            pass
        root.destroy()

    def run_editor():
        if not voiceover_path.get():
            messagebox.showerror("Error", "Please select a voiceover audio file.")
            return
        if not os.path.isdir(VIDEO_CLIPS_DIR):
            messagebox.showerror("Error", f"Clips folder not found:\n{VIDEO_CLIPS_DIR}")
            return

        if not music_path.get() or not os.path.isfile(music_path.get()):
            messagebox.showerror("Error", "Please set a Music track (randomize or choose a file).")
            return

        if not os.path.isdir(OUTPUT_DIR):
            try:
                os.makedirs(OUTPUT_DIR, exist_ok=True)
            except Exception as e:
                messagebox.showerror("Error", f"Could not create output folder:\n{OUTPUT_DIR}\n\n{e}")
                return
        if not end_file_name.get().strip():
            messagebox.showerror("Error", "Please enter the end file name.")
            return

        ending_clip_path = ENDING_CLIP_DEFAULT
        if not os.path.isfile(ending_clip_path):
            messagebox.showerror("Error", f"Ending clip not found:\n{ending_clip_path}")
            return

        log_text.config(state=tk.NORMAL)
        log_text.delete(1.0, tk.END)
        log_text.config(state=tk.DISABLED)
        log("Starting...")

        # Output file name is relative; we always export to OUTPUT_DIR.
        name = end_file_name.get().strip()
        if not name.lower().endswith(".mp4"):
            name = name + ".mp4"
        output_path = os.path.join(OUTPUT_DIR, name)

        def do_work():
            try:
                voice_mult = float(voice_volume_percent.get()) / 100.0
                music_mult = float(music_volume_percent.get()) / 100.0
                run_full_pipeline(
                    mp3_path=voiceover_path.get(),
                    clips_folder=VIDEO_CLIPS_DIR,
                    output_path=output_path,
                    generate_captions=False,
                    background_music_folder=None,
                    background_music_path=music_path.get(),
                    background_volume=music_mult,
                    ending_clip_path=ending_clip_path,
                    normalize_voiceover_peak_to_db0=True,
                    normalize_background_music_peak_to_db=None,
                    keep_voiceover_through_ending=False,
                    voice_volume=voice_mult,
                    progress_callback=log,
                )
                root.after(0, lambda: messagebox.showinfo("Done", f"Video saved to:\n{output_path}"))
            except Exception as e:
                root.after(0, lambda: messagebox.showerror("Error", str(e)))
                log(f"ERROR: {e}")

        threading.Thread(target=do_work, daemon=True).start()

    # Layout
    ttk.Label(root, text="Voiceover Audio:", font=("", 10, "bold")).grid(row=0, column=0, sticky=tk.W, padx=10, pady=5)
    ttk.Entry(root, textvariable=voiceover_path, width=55).grid(row=0, column=1, padx=5, pady=5, sticky=tk.EW)
    ttk.Button(root, text="Browse...", command=browse_voiceover).grid(row=0, column=2, padx=5, pady=5)

    # Music selection: either random from set folder or choose a specific file.
    ttk.Label(root, text="Music Track:", font=("", 10, "bold")).grid(row=1, column=0, sticky=tk.W, padx=10, pady=5)
    ttk.Entry(root, textvariable=music_path, width=55).grid(row=1, column=1, padx=5, pady=5, sticky=tk.EW)

    music_btn_frame = ttk.Frame(root)
    music_btn_frame.grid(row=1, column=2, padx=5, pady=5, sticky=tk.E)
    ttk.Button(music_btn_frame, text="Random Music", command=pick_random_music).grid(row=0, column=0, padx=5, pady=2)
    ttk.Button(music_btn_frame, text="Choose Song...", command=pick_music_file).grid(row=0, column=1, padx=5, pady=2)

    ttk.Label(root, text=f"Music folder (for Random):\n{MUSIC_DIR}", font=("", 8), wraplength=560, justify=tk.LEFT).grid(
        row=2, column=0, columnspan=2, sticky=tk.W, padx=10, pady=5
    )

    ttk.Label(root, text="End file name:", font=("", 10, "bold")).grid(row=2, column=2, sticky=tk.W, padx=10, pady=5)
    ttk.Entry(root, textvariable=end_file_name, width=30).grid(row=2, column=3, padx=5, pady=5, sticky=tk.EW)
    ttk.Label(root, text=f"Export:\n{OUTPUT_DIR}", font=("", 8)).grid(row=3, column=2, columnspan=2, sticky=tk.W, padx=5, pady=5)

    ttk.Label(root, text="Clips folder (fixed):", font=("", 10, "bold")).grid(row=3, column=0, sticky=tk.W, padx=10, pady=5)
    ttk.Label(root, text=VIDEO_CLIPS_DIR, font=("", 8), wraplength=560, justify=tk.LEFT).grid(
        row=3, column=1, columnspan=2, sticky=tk.W, padx=5, pady=5
    )

    ttk.Label(root, text="Voice Volume (baseline=100):", font=("", 10, "bold")).grid(row=4, column=0, sticky=tk.W, padx=10, pady=5)
    voice_scale = ttk.Scale(
        root, from_=0, to=200, orient=tk.HORIZONTAL, variable=voice_volume_percent, command=on_slider_changed
    )
    voice_scale.grid(row=4, column=1, columnspan=3, padx=5, pady=5, sticky=tk.EW)

    ttk.Label(root, text="Music Volume (0-100%):", font=("", 10, "bold")).grid(row=5, column=0, sticky=tk.W, padx=10, pady=5)
    music_scale = ttk.Scale(
        root, from_=0, to=100, orient=tk.HORIZONTAL, variable=music_volume_percent, command=on_slider_changed
    )
    music_scale.grid(row=5, column=1, columnspan=3, padx=5, pady=5, sticky=tk.EW)

    preview_frame = ttk.Frame(root)
    preview_frame.grid(row=6, column=1, columnspan=2, pady=8, sticky=tk.W)
    ttk.Button(preview_frame, text="Play Mix Preview", command=start_preview).grid(row=0, column=0, padx=(0, 8))
    ttk.Button(preview_frame, text="Stop Preview", command=stop_preview).grid(row=0, column=1, padx=(0, 8))
    ttk.Button(preview_frame, text="Create Video", command=run_editor).grid(row=0, column=2)

    # Log
    ttk.Label(root, text="Progress:", font=("", 10, "bold")).grid(row=7, column=0, sticky=tk.W, padx=10, pady=(10, 0))
    log_text.grid(row=8, column=0, columnspan=3, padx=10, pady=5, sticky=tk.NSEW)
    log_scroll.grid(row=8, column=3, sticky=tk.NS, pady=5)
    log_text.config(yscrollcommand=log_scroll.set)

    root.columnconfigure(1, weight=1)
    root.columnconfigure(3, weight=0)
    root.rowconfigure(8, weight=1)
    root.protocol("WM_DELETE_WINDOW", on_close)

    root.mainloop()


if __name__ == "__main__":
    main()
