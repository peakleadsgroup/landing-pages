# Sales Voicemail Viewer

A simple web app that displays voicemail recordings from a Twilio number.

## Cloudflare (GitHub + Cloudflare deployment)

The app runs on **Cloudflare Pages + Functions**. After pushing to GitHub:

1. **Set environment variables** in Cloudflare:
   - Dashboard → Workers & Pages → your project → Settings → Environment variables
   - Add for **Production** (and Preview if needed):
     - `TWILIO_ACCOUNT_SID` – from [Twilio Console](https://console.twilio.com)
     - `TWILIO_AUTH_TOKEN` – from Twilio Console
     - `TWILIO_VOICEMAIL_NUMBER` (optional) – E.164 format, e.g. `+15551234567`, to show only recordings for calls TO this number

2. **Redeploy** so the new `functions/` directory and `InternalApps/sales-vm.html` are picked up.

3. Open the app at: **`https://your-site.com/InternalApps/sales-vm.html`**

---

## Local development (Python/Flask)

For testing without deploying:

1. **Install dependencies**
   ```bash
   cd InternalApps/sales-vm
   python -m venv venv
   venv\Scripts\activate   # Windows
   pip install -r requirements.txt
   ```

2. **Configure Twilio** – copy `.env.example` to `.env` and add your credentials.

3. **Run**
   ```bash
   python app.py
   ```
   Then open http://localhost:5050

## Usage

- Click **Load Voicemails** to fetch recordings from Twilio
- Use the dropdown to choose how many days back (7–90 days)
- Click play on any recording to listen
