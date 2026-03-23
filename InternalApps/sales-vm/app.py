"""
Sales Voicemail Viewer - Displays Twilio voicemail recordings on a webpage.

Requires environment variables:
  TWILIO_ACCOUNT_SID  - Twilio Account SID
  TWILIO_AUTH_TOKEN   - Twilio Auth Token
  TWILIO_VOICEMAIL_NUMBER - (optional) Filter recordings to calls TO this number only

Run: python app.py
Then open http://localhost:5050
"""

import os

# Load .env if python-dotenv is installed (optional)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass
from datetime import datetime, timedelta, timezone
from flask import Flask, jsonify, render_template, request, Response
from twilio.rest import Client

app = Flask(__name__)


def get_twilio_client():
    sid = os.environ.get("TWILIO_ACCOUNT_SID")
    token = os.environ.get("TWILIO_AUTH_TOKEN")
    if not sid or not token:
        raise ValueError("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set")
    return Client(sid, token)


def fetch_recordings(days_back=30, to_number=None):
    """Fetch recordings from Twilio, optionally filtered by destination number."""
    client = get_twilio_client()
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=days_back)
    date_after = start.strftime("%Y-%m-%d")
    date_before = end.strftime("%Y-%m-%d")

    recordings = []
    for rec in client.recordings.list(
        date_created_after=date_after,
        date_created_before=date_before,
        status="completed",
        limit=100,
    ):
        # Skip in-progress or absent recordings
        if rec.status != "completed" or rec.duration is None or int(rec.duration) == 0:
            continue

        call_from = None
        call_to = None
        if rec.call_sid:
            try:
                call = client.calls(rec.call_sid).fetch()
                call_from = call.from_
                call_to = call.to
                # Optional filter: only recordings where call was TO our voicemail number
                if to_number and call_to != to_number:
                    continue
            except Exception:
                pass

        recordings.append(
            {
                "sid": rec.sid,
                "call_sid": rec.call_sid,
                "duration": int(rec.duration),
                "date_created": rec.date_created.isoformat() if rec.date_created else None,
                "from": call_from,
                "to": call_to,
                "source": rec.source,
            }
        )

    # Sort newest first
    recordings.sort(key=lambda r: r["date_created"] or "", reverse=True)
    return recordings


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/recordings")
def api_recordings():
    days = request.args.get("days", 30, type=int)
    days = min(max(days, 1), 90)
    to_number = os.environ.get("TWILIO_VOICEMAIL_NUMBER")
    if to_number:
        to_number = to_number.strip()
    try:
        recordings = fetch_recordings(days_back=days, to_number=to_number)
        return jsonify({"recordings": recordings})
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/recordings/<sid>/audio")
def api_recording_audio(sid):
    """Proxy Twilio recording media so we don't expose credentials to the client."""
    try:
        client = get_twilio_client()
        # Twilio SDK: fetch recording and get URI, then request with auth
        base_url = f"https://api.twilio.com/2010-04-01/Accounts/{client.account_sid}/Recordings/{sid}"
        # Prefer MP3 for smaller size
        media_url = base_url + ".mp3"
        auth = (client.account_sid, client.auth_token)
        import urllib.request
        req = urllib.request.Request(media_url)
        req.add_header(
            "Authorization",
            "Basic "
            + __import__("base64").b64encode(
                f"{auth[0]}:{auth[1]}".encode()
            ).decode(),
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
            content_type = resp.headers.get("Content-Type", "audio/mpeg")
        return Response(data, mimetype=content_type)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    app.run(host="0.0.0.0", port=port, debug=True)
