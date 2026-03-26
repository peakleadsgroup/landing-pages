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
ENDING_CLIP_FINANCING = r"C:\Users\dr3wh\OneDrive\Desktop\PeakLeadsGroup\Outsource Editing\QUICK EDITING\032626-TAP GET QUOTE\032626-FINANCE DISCLAIMER-TAP GET QUOTE.mp4"
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
    background_music_folder = tk.StringVar(value=MUSIC_DIR)
    financing_var = tk.BooleanVar(value=False)
    end_file_name = tk.StringVar(value="output")
    voice_volume_percent = tk.DoubleVar(value=100.0)
    music_volume_percent = tk.DoubleVar(value=100.0)

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

        stop_preview()
        voice_mult = float(voice_volume_percent.get()) / 100.0
        music_mult = float(music_volume_percent.get()) / 100.0
        if preview_voice_duration_s <= 0:
            return

        preview_job_id["id"] += 1
        local_job_id = preview_job_id["id"]
        mixed_audio = os.path.join(preview_tmp_dir.name, f"preview_mixed_{local_job_id}.m4a")

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

                root.after(0, _start_ffplay)
            except Exception as e:
                if local_job_id == preview_job_id["id"]:
                    root.after(0, lambda: log(f"Preview mix error: {e}"))

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

        bg_song = get_random_audio_from_folder(MUSIC_DIR)
        if not bg_song:
            messagebox.showerror("Preview", f"No music files found in:\n{MUSIC_DIR}")
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
                ("Audio files", "*.mp3 *.wav *.m4a *.aac *.flac *.ogg"),
                ("All files", "*.*"),
            ],
        )
        if path:
            voiceover_path.set(path)
            base = os.path.splitext(os.path.basename(path))[0]
            # Keep it simple: default output name derives from audio name.
            end_file_name.set(base)

    # Background music folder is fixed; no browsing in the GUI.

    def run_editor():
        if not voiceover_path.get():
            messagebox.showerror("Error", "Please select a voiceover audio file.")
            return
        if not os.path.isdir(VIDEO_CLIPS_DIR):
            messagebox.showerror("Error", f"Clips folder not found:\n{VIDEO_CLIPS_DIR}")
            return
        if not os.path.isdir(background_music_folder.get()):
            messagebox.showerror("Error", f"Background music folder not found:\n{background_music_folder.get()}")
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

        ending_clip_path = ENDING_CLIP_FINANCING if financing_var.get() else ENDING_CLIP_DEFAULT
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
                run_full_pipeline(
                    mp3_path=voiceover_path.get(),
                    clips_folder=VIDEO_CLIPS_DIR,
                    output_path=output_path,
                    generate_captions=False,
                    background_music_folder=background_music_folder.get() or None,
                    background_volume=music_volume_percent.get() / 100.0,
                    ending_clip_path=ending_clip_path,
                    normalize_voiceover_peak_to_db0=True,
                    normalize_background_music_peak_to_db=-13.0,
                    keep_voiceover_through_ending=financing_var.get(),
                    voice_volume=voice_volume_percent.get() / 100.0,
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

    ttk.Checkbutton(root, text="Financing?", variable=financing_var).grid(row=1, column=0, columnspan=3, sticky=tk.W, padx=10, pady=5)

    ttk.Label(root, text="End file name:", font=("", 10, "bold")).grid(row=2, column=0, sticky=tk.W, padx=10, pady=5)
    ttk.Entry(root, textvariable=end_file_name, width=55).grid(row=2, column=1, padx=5, pady=5, sticky=tk.EW)
    ttk.Label(root, text=f"Export folder:\n{OUTPUT_DIR}", font=("", 8)).grid(row=2, column=2, sticky=tk.W, padx=5, pady=5)

    ttk.Label(root, text="Clips folder (fixed):", font=("", 10, "bold")).grid(row=3, column=0, sticky=tk.W, padx=10, pady=5)
    ttk.Label(root, text=VIDEO_CLIPS_DIR, font=("", 8), wraplength=560, justify=tk.LEFT).grid(row=3, column=1, columnspan=2, sticky=tk.W, padx=5, pady=5)

    ttk.Label(root, text="Background Music Folder (fixed):", font=("", 10, "bold")).grid(row=4, column=0, sticky=tk.W, padx=10, pady=5)
    ttk.Label(root, text=MUSIC_DIR, font=("", 8), wraplength=560, justify=tk.LEFT).grid(row=4, column=1, columnspan=2, sticky=tk.W, padx=5, pady=5)

    ttk.Label(root, text="Voice volume (%), 100% = 0 dB:", font=("", 10)).grid(row=5, column=0, sticky=tk.W, padx=10, pady=(5, 0))
    voice_scale = tk.Scale(
        root,
        from_=0,
        to=200,
        orient=tk.HORIZONTAL,
        resolution=1,
        length=420,
        variable=voice_volume_percent,
        command=lambda _val: schedule_preview_restart(),
    )
    voice_scale.grid(row=5, column=1, columnspan=2, sticky=tk.W, padx=5, pady=(5, 0))

    ttk.Label(root, text="Music volume (%), 100% = -13 dB:", font=("", 10)).grid(row=6, column=0, sticky=tk.W, padx=10, pady=(5, 0))
    music_scale = tk.Scale(
        root,
        from_=0,
        to=200,
        orient=tk.HORIZONTAL,
        resolution=1,
        length=420,
        variable=music_volume_percent,
        command=lambda _val: schedule_preview_restart(),
    )
    music_scale.grid(row=6, column=1, columnspan=2, sticky=tk.W, padx=5, pady=(5, 0))

    # Run button
    ttk.Button(root, text="Preview Audio", command=start_preview).grid(row=7, column=0, pady=15, sticky=tk.W, padx=10)
    ttk.Button(root, text="Stop Preview", command=stop_preview).grid(row=7, column=2, pady=15, sticky=tk.E, padx=10)
    ttk.Button(root, text="Create Video", command=run_editor).grid(row=7, column=1, pady=15)

    # Log
    ttk.Label(root, text="Progress:", font=("", 10, "bold")).grid(row=8, column=0, sticky=tk.W, padx=10, pady=(10, 0))
    log_text.grid(row=9, column=0, columnspan=3, padx=10, pady=5, sticky=tk.NSEW)
    log_scroll.grid(row=9, column=3, sticky=tk.NS, pady=5)
    log_text.config(yscrollcommand=log_scroll.set)

    root.columnconfigure(1, weight=1)
    root.rowconfigure(9, weight=1)

    root.mainloop()


if __name__ == "__main__":
    main()
