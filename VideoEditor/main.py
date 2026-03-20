"""
Automated Video Editor - Desktop GUI
Takes an MP3, randomly assembles video clips from a folder to match length, adds captions.
"""
import os
import subprocess
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from video_editor import run_full_pipeline, transcribe_to_srt_and_words


def show_caption_review_dialog(parent, mp3_path: str, srt_content: str) -> str | None:
    """
    Show modal dialog to play MP3 and edit captions.
    Returns edited SRT content on OK, None on Cancel.
    """
    result = {"srt": None}

    dialog = tk.Toplevel(parent)
    dialog.title("Review & Edit Captions")
    dialog.geometry("700x500")
    dialog.transient(parent)
    dialog.grab_set()

    play_process = [None]  # Use list to allow mutation in nested func

    def play_mp3():
        if play_process[0] and play_process[0].poll() is None:
            return  # Already playing
        try:
            play_process[0] = subprocess.Popen(
                ["ffplay", "-nodisp", "-autoexit", mp3_path],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except FileNotFoundError:
            messagebox.showwarning("Playback", "ffplay not found. Install FFmpeg with ffplay.")

    def stop_mp3():
        if play_process[0] and play_process[0].poll() is None:
            play_process[0].terminate()
            play_process[0] = None

    def on_ok():
        result["srt"] = caption_text.get(1.0, tk.END)
        stop_mp3()
        dialog.destroy()

    def on_cancel():
        result["srt"] = None
        stop_mp3()
        dialog.destroy()

    dialog.protocol("WM_DELETE_WINDOW", on_cancel)

    ttk.Label(dialog, text="Play the MP3 and fix any caption errors below:", font=("", 10, "bold")).pack(anchor=tk.W, padx=10, pady=(10, 5))
    btn_frame = ttk.Frame(dialog)
    btn_frame.pack(anchor=tk.W, padx=10, pady=5)
    ttk.Button(btn_frame, text="Play MP3", command=play_mp3).pack(side=tk.LEFT, padx=(0, 5))
    ttk.Button(btn_frame, text="Stop", command=stop_mp3).pack(side=tk.LEFT)

    ttk.Label(dialog, text="Captions (SRT format - edit as needed):", font=("", 10, "bold")).pack(anchor=tk.W, padx=10, pady=(15, 5))
    caption_text = tk.Text(dialog, wrap=tk.WORD, font=("Consolas", 10), height=18)
    caption_scroll = ttk.Scrollbar(dialog, command=caption_text.yview)
    caption_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(10, 0), pady=(0, 10))
    caption_scroll.pack(side=tk.RIGHT, fill=tk.Y, pady=(0, 10))
    caption_text.config(yscrollcommand=caption_scroll.set)
    caption_text.insert(1.0, srt_content)

    ttk.Label(dialog, text="Click OK when ready to generate the video.", font=("", 9)).pack(anchor=tk.W, padx=10, pady=(0, 5))
    ok_cancel = ttk.Frame(dialog)
    ok_cancel.pack(pady=(0, 10))
    ttk.Button(ok_cancel, text="OK - Generate Video", command=on_ok).pack(side=tk.LEFT, padx=5)
    ttk.Button(ok_cancel, text="Cancel", command=on_cancel).pack(side=tk.LEFT)

    dialog.wait_window()
    return result["srt"]


def main():
    root = tk.Tk()
    root.title("Automated Video Editor")
    root.geometry("600x560")
    root.resizable(True, True)

    # Variables
    mp3_path = tk.StringVar()
    clips_folder = tk.StringVar()
    ending_clip_path = tk.StringVar()
    output_path = tk.StringVar()
    background_music_folder = tk.StringVar()
    captions_var = tk.BooleanVar(value=True)
    model_var = tk.StringVar(value="medium")

    # Log area
    log_text = tk.Text(root, height=12, wrap=tk.WORD, state=tk.DISABLED, font=("Consolas", 9))
    log_scroll = ttk.Scrollbar(root, command=log_text.yview)

    def log(msg: str):
        log_text.config(state=tk.NORMAL)
        log_text.insert(tk.END, msg + "\n")
        log_text.see(tk.END)
        log_text.config(state=tk.DISABLED)
        root.update_idletasks()

    def browse_mp3():
        path = filedialog.askopenfilename(
            title="Select MP3 file",
            filetypes=[("MP3 files", "*.mp3"), ("All files", "*.*")]
        )
        if path:
            mp3_path.set(path)
            # Suggest output in same folder
            base = os.path.splitext(path)[0]
            output_path.set(base + "_video.mp4")

    def browse_clips():
        path = filedialog.askdirectory(title="Select folder with video clips")
        if path:
            clips_folder.set(path)

    def browse_ending_clip():
        path = filedialog.askopenfilename(
            title="Select ending clip (plays last with fade-in)",
            filetypes=[("Video files", "*.mp4;*.mov;*.avi;*.mkv;*.webm;*.m4v"), ("All files", "*.*")]
        )
        if path:
            ending_clip_path.set(path)

    def browse_output():
        path = filedialog.asksaveasfilename(
            title="Save output video as",
            defaultextension=".mp4",
            filetypes=[("MP4 video", "*.mp4"), ("All files", "*.*")]
        )
        if path:
            output_path.set(path)

    def browse_background_music():
        path = filedialog.askdirectory(title="Select folder with background music (MP3, MP4, WAV, etc.)")
        if path:
            background_music_folder.set(path)

    def run_editor():
        if not mp3_path.get():
            messagebox.showerror("Error", "Please select an MP3 file.")
            return
        if not clips_folder.get():
            messagebox.showerror("Error", "Please select a folder with video clips.")
            return
        if not output_path.get():
            messagebox.showerror("Error", "Please choose an output path.")
            return

        log_text.config(state=tk.NORMAL)
        log_text.delete(1.0, tk.END)
        log_text.config(state=tk.DISABLED)
        log("Starting...")

        if captions_var.get():
            def transcribe_then_dialog():
                try:
                    log("Generating captions (this may take a few minutes)...")
                    srt, words = transcribe_to_srt_and_words(mp3_path.get(), model_size=model_var.get())
                    if not srt or not srt.strip():
                        root.after(0, lambda: messagebox.showinfo("Captions", "No speech detected in audio. Proceeding without captions."))
                        srt = ""
                        words = []
                    root.after(0, lambda: on_transcribe_done(srt, words))
                except Exception as e:
                    root.after(0, lambda: (messagebox.showerror("Error", str(e)), log(f"ERROR: {e}")))

            def on_transcribe_done(srt: str, words: list):
                if not srt.strip():
                    run_video_assembly(srt_content="", caption_words=None)
                    return
                edited = show_caption_review_dialog(root, mp3_path.get(), srt)
                if edited is not None:
                    caption_words = words if edited.strip() == srt.strip() else None
                    run_video_assembly(srt_content=edited, caption_words=caption_words)
                else:
                    log("Cancelled.")

            def run_video_assembly(srt_content, caption_words=None):
                def do_work():
                    try:
                        run_full_pipeline(
                            mp3_path=mp3_path.get(),
                            clips_folder=clips_folder.get(),
                            output_path=output_path.get(),
                            generate_captions=True,
                            srt_content=srt_content,
                            caption_words=caption_words,
                            whisper_model=model_var.get(),
                            background_music_folder=background_music_folder.get() or None,
                            background_volume=0.5,
                            ending_clip_path=ending_clip_path.get() or None,
                            progress_callback=log
                        )
                        root.after(0, lambda: messagebox.showinfo("Done", f"Video saved to:\n{output_path.get()}"))
                    except Exception as e:
                        root.after(0, lambda: messagebox.showerror("Error", str(e)))
                        log(f"ERROR: {e}")
                threading.Thread(target=do_work, daemon=True).start()

            threading.Thread(target=transcribe_then_dialog, daemon=True).start()
        else:
            def do_work():
                try:
                    run_full_pipeline(
                        mp3_path=mp3_path.get(),
                        clips_folder=clips_folder.get(),
                        output_path=output_path.get(),
                        generate_captions=False,
                        background_music_folder=background_music_folder.get() or None,
                        background_volume=0.5,
                        ending_clip_path=ending_clip_path.get() or None,
                        progress_callback=log
                    )
                    root.after(0, lambda: messagebox.showinfo("Done", f"Video saved to:\n{output_path.get()}"))
                except Exception as e:
                    root.after(0, lambda: messagebox.showerror("Error", str(e)))
                    log(f"ERROR: {e}")
            threading.Thread(target=do_work, daemon=True).start()

    # Layout
    ttk.Label(root, text="MP3 Audio:", font=("", 10, "bold")).grid(row=0, column=0, sticky=tk.W, padx=10, pady=5)
    ttk.Entry(root, textvariable=mp3_path, width=50).grid(row=0, column=1, padx=5, pady=5, sticky=tk.EW)
    ttk.Button(root, text="Browse...", command=browse_mp3).grid(row=0, column=2, padx=5, pady=5)

    ttk.Label(root, text="Video Clips Folder:", font=("", 10, "bold")).grid(row=1, column=0, sticky=tk.W, padx=10, pady=5)
    ttk.Entry(root, textvariable=clips_folder, width=50).grid(row=1, column=1, padx=5, pady=5, sticky=tk.EW)
    ttk.Button(root, text="Browse...", command=browse_clips).grid(row=1, column=2, padx=5, pady=5)

    ttk.Label(root, text="Ending Clip (optional):", font=("", 10, "bold")).grid(row=2, column=0, sticky=tk.W, padx=10, pady=5)
    ttk.Entry(root, textvariable=ending_clip_path, width=50).grid(row=2, column=1, padx=5, pady=5, sticky=tk.EW)
    ttk.Button(root, text="Browse...", command=browse_ending_clip).grid(row=2, column=2, padx=5, pady=5)
    ttk.Label(root, text="Plays last with 2s fade transition", font=("", 8)).grid(row=3, column=1, sticky=tk.W, padx=5, pady=(0, 2))

    ttk.Label(root, text="Output Video:", font=("", 10, "bold")).grid(row=4, column=0, sticky=tk.W, padx=10, pady=5)
    ttk.Entry(root, textvariable=output_path, width=50).grid(row=4, column=1, padx=5, pady=5, sticky=tk.EW)
    ttk.Button(root, text="Browse...", command=browse_output).grid(row=4, column=2, padx=5, pady=5)

    ttk.Label(root, text="Background Music (optional):", font=("", 10, "bold")).grid(row=5, column=0, sticky=tk.W, padx=10, pady=5)
    ttk.Entry(root, textvariable=background_music_folder, width=50).grid(row=5, column=1, padx=5, pady=5, sticky=tk.EW)
    ttk.Button(root, text="Browse...", command=browse_background_music).grid(row=5, column=2, padx=5, pady=5)
    ttk.Label(root, text="Random song at 50% volume", font=("", 8)).grid(row=6, column=1, sticky=tk.W, padx=5, pady=(0, 2))

    # Options frame
    opts = ttk.Frame(root)
    opts.grid(row=7, column=0, columnspan=3, sticky=tk.W, padx=10, pady=10)
    ttk.Checkbutton(opts, text="Generate captions from audio (Whisper)", variable=captions_var).pack(side=tk.LEFT, padx=(0, 20))
    ttk.Label(opts, text="Whisper model:").pack(side=tk.LEFT, padx=(0, 5))
    model_combo = ttk.Combobox(opts, textvariable=model_var, values=["tiny", "base", "small", "medium", "large"], width=8, state="readonly")
    ttk.Label(opts, text="(medium = best word sync)", font=("", 8)).pack(side=tk.LEFT, padx=(5, 0))
    model_combo.pack(side=tk.LEFT)

    # Run button
    ttk.Button(root, text="Create Video", command=run_editor).grid(row=8, column=1, pady=15)

    # Log
    ttk.Label(root, text="Progress:", font=("", 10, "bold")).grid(row=9, column=0, sticky=tk.W, padx=10, pady=(10, 0))
    log_text.grid(row=10, column=0, columnspan=3, padx=10, pady=5, sticky=tk.NSEW)
    log_scroll.grid(row=10, column=3, sticky=tk.NS, pady=5)
    log_text.config(yscrollcommand=log_scroll.set)

    root.columnconfigure(1, weight=1)
    root.rowconfigure(10, weight=1)

    root.mainloop()


if __name__ == "__main__":
    main()
