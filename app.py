from flask import Flask, render_template, request, jsonify, session
import requests
import xml.etree.ElementTree as ET
from functools import wraps
import subprocess

app = Flask(__name__)
app.secret_key = "change-me-to-a-random-secret"

BGG_API = "https://boardgamegeek.com/xmlapi2"
BGG_BASE = "https://boardgamegeek.com"

# ---------- helpers ----------

def bgg_session():
    """Return a requests.Session with BGG cookies if the user is logged in."""
    s = requests.Session()
    if "bgg_cookies" in session:
        s.cookies.update(session["bgg_cookies"])
    return s


def require_login(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "bgg_username" not in session:
            return jsonify({"error": "Not logged in"}), 401
        return f(*args, **kwargs)
    return decorated


# ---------- routes ----------

@app.route("/")
def index():
    return render_template("index.html", username=session.get("bgg_username"))


@app.route("/api/login", methods=["POST"])
def login():
    data = request.json
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()
    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400

    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://boardgamegeek.com/login",
        "Origin": "https://boardgamegeek.com",
    })

    # Try the newer JSON endpoint first
    resp = s.post(
        f"{BGG_BASE}/login/api/v1",
        json={"credentials": {"username": username, "password": password}},
        headers={"Content-Type": "application/json"},
    )

    # Fall back to form-encoded POST if that didn't work
    if resp.status_code != 200:
        resp = s.post(
            f"{BGG_BASE}/login",
            data={
                "username": username,
                "password": password,
                "redirect-to": "/",
            },
            allow_redirects=True,
        )

    # Deduplicate cookies, keeping the last value for each key
    deduped = {}
    for cookie in s.cookies:
        deduped[cookie.name] = cookie.value

    logged_in = (
            resp.status_code in (200, 204, 302, 403)
            and any(k in deduped for k in ("bggpassword", "bggusername", "SessionID"))
    )

    if logged_in:
        session["bgg_username"] = username
        session["bgg_cookies"] = deduped
        return jsonify({"ok": True, "username": username})

    return jsonify({"error": "Login failed – BGG did not accept these credentials"}), 401


@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/collection")
@require_login
def get_collection():
    username = session["bgg_username"]
    params = {
        "username": username,
        "own": 1,
        "stats": 1,
    }
    # BGG sometimes returns 202 while it builds the list — retry up to 3×
    for _ in range(3):
        s = bgg_session()
        resp = s.get(f"{BGG_API}/collection", params=params)

        if resp.status_code == 200:
            break
        if resp.status_code == 202:
            import time; time.sleep(2)
        else:
            return jsonify({"error": f"BGG API error {resp.status_code}"}), 502

    root = ET.fromstring(resp.text)
    games = []
    for item in root.findall("item"):
        name_el = item.find("name")
        stats = item.find("stats")
        rating_el = item.find(".//rating")
        image_el = item.find("image")
        year_el = item.find("yearpublished")
        status_el = item.find("status")

        games.append({
            "id": item.get("objectid"),
            "name": name_el.text if name_el is not None else "Unknown",
            "year": year_el.text if year_el is not None else "",
            "image": image_el.text if image_el is not None and image_el.text else None,
            "minplayers": stats.get("minplayers") if stats is not None else "",
            "maxplayers": stats.get("maxplayers") if stats is not None else "",
            "minplaytime": stats.get("minplaytime") if stats is not None else "",
            "maxplaytime": stats.get("maxplaytime") if stats is not None else "",
            "user_rating": rating_el.get("value") if rating_el is not None else "N/A",
            "for_trade": status_el.get("fortrade", "0") if status_el is not None else "0",
            "want_to_play": status_el.get("wanttoplay", "0") if status_el is not None else "0",
            "preordered": status_el.get("preordered", "0") if status_el is not None else "0",
        })

    games.sort(key=lambda g: g["name"].lower())
    return jsonify({"games": games, "total": len(games)})


@app.route("/api/search")
@require_login
def search_games():
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"results": []})

    cookies = session.get("bgg_cookies", {})

    result = subprocess.run([
        "curl", "-s", "-L",
        "--cookie", "; ".join(f"{k}={v}" for k, v in cookies.items()),
        "-H",
        "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "-H", "Accept: application/xml, text/xml, */*",
        "-H", "Referer: https://boardgamegeek.com/",
        "-H", "Origin: https://boardgamegeek.com",
        f"https://boardgamegeek.com/xmlapi2/search?query={requests.utils.quote(query)}&type=boardgame"
    ], capture_output=True, text=True)

    print(f"Curl stdout: {result.stdout[:300]}")
    print(f"Curl stderr: {result.stderr[:300]}")

    try:
        root = ET.fromstring(result.stdout)
    except ET.ParseError:
        return jsonify({"error": "Search unavailable", "results": []}), 502

    results = []
    for item in root.findall("item"):
        name_el = item.find("name")
        year_el = item.find("yearpublished")
        results.append({
            "id": item.get("id"),
            "name": name_el.get("value") if name_el is not None else "Unknown",
            "year": year_el.get("value") if year_el is not None else "",
        })
    return jsonify({"results": results[:20]})

@app.route("/api/lookup")
@require_login
def lookup_game():
    game_id = request.args.get("game_id", "").strip()
    if not game_id:
        return jsonify({"error": "game_id required"}), 400
    s = bgg_session()
    resp = s.get(f"{BGG_API}/thing", params={"id": game_id, "type": "boardgame"})
    print(f"Lookup status: {resp.status_code}")
    print(f"Lookup cookies being sent: {dict(s.cookies)}")

    if resp.status_code != 200:
        return jsonify({"error": f"BGG API error {resp.status_code}"}), 502
    try:
        root = ET.fromstring(resp.text)
        item = root.find("item")
        if item is None:
            return jsonify({"error": "Game not found"}), 404
        name_el = item.find(".//name[@type='primary']")
        year_el = item.find("yearpublished")
        return jsonify({
            "id": game_id,
            "name": name_el.get("value") if name_el is not None else "Unknown",
            "year": year_el.get("value") if year_el is not None else "",
        })

    except ET.ParseError:
        return jsonify({"error": "Unexpected response from BGG"}), 502

@app.route("/api/collection/add", methods=["POST"])
@require_login
def add_game():
    game_id = request.json.get("game_id")
    if not game_id:
        return jsonify({"error": "game_id required"}), 400
    s = bgg_session()
    resp = s.post(
        f"{BGG_BASE}/api/collections",
        data={"objectid": game_id, "objecttype": "thing", "own": 1, "ajax": 1},
    )
    if resp.status_code in (200, 204):
        return jsonify({"ok": True})
    return jsonify({"error": f"Failed to add game (HTTP {resp.status_code})"}), 502


@app.route("/api/collection/remove", methods=["POST"])
@require_login
def remove_game():
    game_id = request.json.get("game_id")
    if not game_id:
        return jsonify({"error": "game_id required"}), 400
    s = bgg_session()
    resp = s.delete(
        f"{BGG_BASE}/api/collections",
        data={"objectid": game_id, "objecttype": "thing", "own": 1, "ajax": 1},
    )
    if resp.status_code in (200, 204):
        return jsonify({"ok": True})
    return jsonify({"error": f"Failed to remove game (HTTP {resp.status_code})"}), 502


@app.route("/api/collection/rate", methods=["POST"])
@require_login
def rate_game():
    data = request.json
    game_id = data.get("game_id")
    rating = data.get("rating")  # 1-10 or "N/A" to clear
    if not game_id:
        return jsonify({"error": "game_id required"}), 400
    s = bgg_session()
    resp = s.post(
        f"{BGG_BASE}/api/collections",
        data={
            "objectid": game_id,
            "objecttype": "thing",
            "rating": rating,
            "ajax": 1,
        },
    )
    if resp.status_code in (200, 204):
        return jsonify({"ok": True})
    return jsonify({"error": f"Failed to rate game (HTTP {resp.status_code})"}), 502


@app.route("/api/login/debug", methods=["POST"])
def login_debug():
    """Temporary debug endpoint — remove before deploying."""
    data = request.json
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Referer": "https://boardgamegeek.com/login",
        "Origin": "https://boardgamegeek.com",
    })
    resp = s.post(
        f"{BGG_BASE}/login/api/v1",
        json={"credentials": {"username": username, "password": password}},
        headers={"Content-Type": "application/json"},
    )
    return jsonify({
        "status_code": resp.status_code,
        "cookies": dict(s.cookies),
        "response_text": resp.text[:500],
    })


if __name__ == "__main__":
    app.run(debug=True)