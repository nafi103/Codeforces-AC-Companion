# CF AC Companion

A Chrome extension for Codeforces that keeps the page lightweight while adding practical solving tools: compact ratings, tag toggles, a per-problem timer, solved-state feedback, problemset ratings, and Gym/Mashup support.

## Features

### Problem Page Tools

1. **Compact Rating Card**
   - Injects a small CF-style card on problem pages
   - Shows the problem rating with Codeforces color coding
   - Keeps the interface native-looking and minimal

2. **Rating Reveal**
   - Reveals the rating on demand from the compact card
   - Works with the current practice flow instead of a separate blind mode toggle

3. **Tag Controls**
   - Hides tags when Codeforces has them hidden
   - Adds a quick button to show or hide tags
   - Falls back to the Codeforces API when tag data is not already visible

4. **Solved Status Card**
   - Detects accepted problems from the visible sidebar and Codeforces API data
   - Shows a solved card above the timer when the problem is already accepted
   - Keeps the solved state in sync across late-rendering Codeforces pages

5. **Per-Problem Timer**
   - Stores timer state per problem
   - Lets you start, pause, reset, or enter a custom target time
   - Supports a suggested target time based on your baseline rating and the problem rating
   - Automatically resets when an accepted submission is detected

6. **Standings Link**
   - Adds a quick link to contest standings from the problem page

### Workspace and Side Views

7. **Problemset Ratings**
   - Preloads ratings on problemset pages
   - Uses the background cache to reduce repeat API calls

8. **Gym and Mashup Integration**
   - Resolves original problem IDs for Gym and Mashup pages
   - Injects ratings and standings links where applicable

9. **Local Caching**
   - Caches problem ratings and other lightweight state locally
   - Survives reloads and reduces dependency on repeated API calls

## Installation

### From Source (Developer Mode)

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the extension folder
5. The extension icon should appear in your browser toolbar

### From Chrome Web Store

*Coming soon*

## Configuration

Click the extension icon in your browser toolbar to access settings:

- **Hide Tags**: Enable/disable automatic tag hiding
- **Problemset Ratings**: Show ratings on problemset pages
- **Gym Integration**: Enable rating display in Gym/Mashup
- **Your Rating**: Set manually or leave blank to auto-detect from your Codeforces profile

## How It Works

### Problem Pages
When you visit a Codeforces problem page, the extension:
1. Identifies the contest and problem index from the URL
2. Loads cached ratings and current settings
3. Injects the compact rating card and timer into the sidebar
4. Checks whether the problem is already accepted
5. Shows the solved card above the timer when appropriate
6. Adds controls for tags, standings, and timer actions

### Rating Colors
The extension uses Codeforces' official rating colors:
- **Newbie** (< 1200): Gray
- **Pupil** (1200-1399): Green
- **Specialist** (1400-1599): Cyan
- **Expert** (1600-1899): Blue
- **Candidate Master** (1900-2099): Purple
- **Master** (2100-2299): Orange
- **International Master** (2300-2399): Orange
- **Grandmaster** (2400-2599): Red
- **International Grandmaster** (2600-2999): Red
- **Legendary Grandmaster** (>= 3000): Dark Red

## Architecture

```
codeforces-enhancer/
|-- manifest.json          # Extension manifest (v3)
|-- background.js          # Service worker for API calls & rating caching
|-- content.js             # Main content script for problem pages
|-- problemset.js          # Content script for problemset pages
|-- gym.js                 # Content script for gym/mashup pages
|-- styles.css             # Adaptive styles with dark mode support
|-- popup.html             # Extension popup UI
|-- popup.js               # Popup functionality
|-- popup.css              # Popup styles
|-- icons/                 # Extension icons
    |-- icon16.png
    |-- icon48.png
    |-- icon128.png
```

## API Usage

The extension uses the public Codeforces API:
- `https://codeforces.com/api/problemset.problems` - Fetches all problems with ratings
- `https://codeforces.com/api/user.info` - Fetches user rating (optional)
- `https://codeforces.com/api/user.status` - Checks accepted submissions for solved-state handling
- `https://codeforces.com/api/contest.standings` - Fetches gym/mashup problem info

Problem ratings are cached in the background worker and shared across the extension to minimize requests.

## Privacy

- No data is sent to any third-party servers
- User ratings are stored locally in browser storage
- API calls are made directly to Codeforces' official API
- No tracking or analytics

## License

MIT License

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.
