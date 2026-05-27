# my-bgg-manager

A Flask web app to manage your [BoardGameGeek](https://boardgamegeek.com) collection — add, remove, and rate games from a clean browser UI.

## Features
- 🔐 Log in with your BGG account
- 📦 View your full owned collection with box art, player count & play time
- 🔍 Search BGG's full catalogue and add games in one click
- 🗑️ Remove games from your collection
- ⭐ Rate games 1–10

## Setup

```bash
# 1. Clone the repo
git clone https://github.com/data-engineering-leopard/my-bgg-manager.git
cd my-bgg-manager

# 2. Create and activate a virtual environment
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Run the app
python app.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000) in your browser.

## Notes
- Your BGG credentials are used only to authenticate with BGG's servers — they are stored only in your local Flask session cookie.
- The BGG XML API sometimes takes a moment to build your collection list on the first request; the app retries automatically.

## Tech Stack
- **Backend**: Python / Flask
- **API**: [BGG XML API v2](https://boardgamegeek.com/wiki/page/BGG_XML_API2)
- **Frontend**: Vanilla JS + CSS

## Known Limitations & Design Decisions

### BGG Search API (Application Token Required)
BGG's XML API search endpoint now requires a registered application token 
(see https://boardgamegeek.com/using_the_xml_api). Rather than waiting for 
token approval, the "Add Game" flow uses direct BGG game IDs or URLs instead 
of free-text search.

To add a game:
1. Find the game on boardgamegeek.com
2. Copy the URL (e.g. https://boardgamegeek.com/boardgame/448419/vampire-lords)
3. Paste it into the Add Game field — the app extracts the ID automatically

**Future improvement**: Replace with proper API token search once a token is obtained.