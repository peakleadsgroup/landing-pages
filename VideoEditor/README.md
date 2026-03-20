# Automated Video Editor

Desktop app that takes an MP3, randomly assembles video clips from a folder to match the audio length, and adds auto-generated captions.

## Requirements

1. **Python 3.10+**
2. **FFmpeg** – Must be installed and on your system PATH
   - Download: https://ffmpeg.org/download.html
   - Windows: Use the "full" build from gyan.dev or add to PATH after installing

## Setup

1. Install FFmpeg (see above) and ensure `ffmpeg` and `ffprobe` work in your terminal.

2. Create a virtual environment (recommended):
   ```powershell
   cd VideoEditor
   python -m venv venv
   .\venv\Scripts\Activate.ps1
   ```

3. Install Python dependencies:
   ```powershell
   pip install -r requirements.txt
   ```

4. Run the app:
   ```powershell
   python main.py
   ```

## Usage

1. **MP3 Audio** – Select your audio file (speech or music).
2. **Video Clips Folder** – Folder containing MP4, MOV, AVI, MKV, WebM, or M4V files.
3. **Output Video** – Where to save the final video.
4. **Generate captions** – Check to auto-transcribe the MP3 and burn captions into the video (uses Whisper).
5. **Whisper model** – `tiny` (fastest) to `large` (best quality, slowest). `base` is a good default.

Click **Create Video** and wait. Caption generation can take a few minutes depending on audio length and model size.

## No Logins Required

- Whisper runs locally (no API keys).
- FFmpeg is free and open source.

## Tips

- Total duration of all clips in the folder must be at least as long as your MP3.
- For faster captions, use `tiny` or `base`. Use `medium` or `large` for better accuracy.
- Clips are randomly selected and ordered each time.
