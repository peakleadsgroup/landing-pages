# Automated Video Editor

Desktop app that randomly assembles clips, appends a selected ending disclaimer clip, and overlays the result with your voiceover.

Captions/Whisper are disabled in the current version of the GUI.

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

1. **Voiceover Audio** – Select your voiceover audio file (MP3/WAV/etc).
2. **Financing?** – If checked, appends the finance disclaimer ending and keeps your voiceover audio through it. If unchecked, appends the standard ending and your voiceover stops while the background music continues.
3. **End file name** – Enter the output filename (the app saves it as `<name>.mp4` in the export folder).
4. **Background Music (fixed)** – Always mixes music from the fixed folder, and normalizes the track to `-13 dB` peak before mixing.

Click **Create Video** and wait for the export to complete.


## No Logins Required

- Whisper runs locally (no API keys).
- FFmpeg is free and open source.

## Tips

- The app uses a fixed clips folder (the UI does not let you choose it).
- Total duration of all clips in the fixed folder must be at least as long as your voiceover audio (with room for the ending fade transition).
- Clips are randomly selected and ordered each time.
- The GUI normalizes the voiceover to a peak of `0 dB` so quiet/loud recordings come out more consistent.
- Background music folder is fixed to `C:\Users\dr3wh\OneDrive\Desktop\PeakLeadsGroup\Music`.
