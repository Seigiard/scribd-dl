Create a clickable fake prototype for a Tauri-style terminal UI downloader app.

The app is a small, minimal TUI utility, not a SaaS dashboard and not a full download manager.

Core concept:

- User opens the app.
- User presses Ctrl/Cmd+V to paste one or more links.
- The app extracts supported links from pasted text.
- Supported links are added to a session-only queue.
- Unsupported links are added as Failed items with reason “Unsupported domain”.
- Downloads are fake/simulated. No real network calls or real downloading.

Supported domains for MVP:

- scribd.com
- slideshare.net
- everand.com

Do not add:

- sidebar
- login
- dashboard
- charts
- settings screen
- system notifications
- account system
- persistent download history
- Open File button
- Show in Folder button
- extra actions beyond what is specified

Layout:
Use a compact TUI window.

Example structure:

┌ Tauri Downloader TUI ─────────────────────────────────────────┐
│ Download folder: ~/Downloads [Change] │
│ │
│ Scribd document 123 Queued │
│ https://scribd.com/document/123/example [Remove] │
│ │
│ Everand book 456 Downloading... │
│ https://everand.com/book/456/example │
│ │
│ Press Ctrl/Cmd+V to download links • q to quit • Tab to nav │
└──────────────────────────────────────────────────────────────┘

Main UI:

- Header shows current download folder.
- Default folder is ~/Downloads.
- Header has a clickable [Change] button.
- Main area shows the session queue.
- Bottom status bar shows:
  “Press Ctrl/Cmd+V to download links • q to quit • Tab to navigate”
- If queue is empty, keep the main area empty. Do not show “No downloads yet”.

Queue item format:
Each queue item is two lines, separated by an empty line.

Queued item:

Scribd document 123 Queued
https://scribd.com/document/123/example [Remove]

Downloading item:

Scribd document 123 Downloading
https://scribd.com/document/123/example

Downloaded item:

Scribd document 123 Downloaded
https://scribd.com/document/123/example

Retryable failed download:

Scribd document 123 Failed
https://scribd.com/document/123/example [Retry]
Reason: Download failed

Unsupported link:

Unsupported link Failed
https://example.com/file
Reason: Unsupported domain

Rules:

- Show source URL for every item.
- Generate a fake display title immediately after paste.
- This is a display title, not a real filename. Do not force .pdf or any extension.
- Example titles:
  - Scribd document 123
  - SlideShare presentation 456
  - Everand book 789

- Items are processed strictly in insertion order.
- Only one item downloads at a time.
- No parallel downloads.
- No queue limit.

Paste behavior:

- Support real Ctrl/Cmd+V paste handling.
- Also include a small test textarea or input plus a “Simulate paste” action for manually testing paste content.
- Do not include a dev panel with preset test buttons.
- If pasted text contains multiple links, add all found links to the queue.
- If pasted text contains valid links plus random text, extract links and ignore the random text.
- If clipboard/text contains no links, do not change the queue. Temporarily show:
  “No links found in clipboard”
  in the bottom status bar, then return to the normal status bar.
- Do not show “Added X links” feedback. Just update the queue.

Duplicate behavior:

- If a pasted supported link already exists as Queued, Downloading, or Downloaded, ignore the duplicate.
- If the same link exists as retryable Failed, allow retry by moving it to the end of the queue.
- If a Queued item was removed, and the same link is pasted again later, add it again.

Remove behavior:

- [Remove] is available only for Queued items.
- Removing an item deletes it from the current session queue.
- Downloading, Downloaded, and Failed items cannot be removed.

Retry behavior:

- [Retry] is available only for failed downloads from supported domains.
- [Retry] is not available for Unsupported domain errors.
- When user clicks [Retry], move the item to the end of the queue and set its status to Queued.
- It should then be processed normally.

Fake download behavior:

- Each fake download takes a random 1–3 seconds.
- About 20% of supported downloads should randomly fail.
- On success, status becomes Downloaded.
- On fake failure, status becomes Failed with reason “Download failed” and show [Retry].

Download folder behavior:

- Default folder is ~/Downloads.
- Folder is visible in the header.
- User can click [Change].
- This opens a TUI popup:

┌ Change download folder ─────────────────────┐
│ Current: ~/Downloads │
│ │
│ New path: ~/Downloads │
│ │
│ [Cancel] [Save] │
└─────────────────────────────────────────────┘

- In the fake prototype, the popup can use a simple text input path field.
- Do not implement a real native system folder picker.
- Empty path is invalid.
- If user tries to save an empty path, show:
  “Path cannot be empty”
  inside the popup and keep the popup open.
- For all non-empty paths, assume the path is valid.
- Save updates the header path.
- Persist the chosen folder between fake reloads.
- Do not persist queue/history between reloads or app closes.

Session behavior:

- Queue/history is session-only.
- When the app closes, all queue state is cleared.
- Download folder persists, but queue does not.

Exit behavior:

- q or Esc exits the app.
- If a popup is open, Esc closes the popup first instead of exiting the app.
- If there are Queued or Downloading items when user tries to exit, show a warning popup.
- Warning should explain that closing will cancel active downloads and clear the session queue.
- Warning actions:
  - [Cancel] — keep app open.
  - [Close anyway] — close app, cancel active download, clear queue.

Keyboard and mouse:

- App should support both mouse and keyboard.
- Clickable controls:
  - [Change]
  - [Remove]
  - [Retry]
  - [Cancel]
  - [Save]
  - [Close anyway]

- Keyboard:
  - Tab navigates focus.
  - Enter activates focused control.
  - Esc closes popup or exits app according to exit rules.
  - q exits app according to exit rules.
  - Ctrl/Cmd+V triggers paste handling.

Tab order:

1. [Change]
2. [Remove] buttons for Queued items, top to bottom
3. [Retry] buttons for retryable Failed items, top to bottom
4. back to [Change]

Visual style:

- Small, clean desktop utility TUI.
- English interface.
- Minimal.
- No icons required.
- No empty-state illustration.
- No fancy dashboard elements.
- Use simple spacing and readable alignment.
- Status should be aligned to the right side of the first row of each queue item.
- URL and action button should be on the second row when applicable.

Acceptance criteria:

- User can paste one valid Scribd link and see it go Queued → Downloading → Downloaded or Failed.
- User can paste multiple supported links and see them added in order.
- User can paste mixed text with links and only links are extracted.
- User can paste unsupported links and see Failed with “Unsupported domain” and no Retry button.
- User can paste duplicate links and duplicates are ignored unless the previous queued item was removed.
- User can remove only Queued items.
- User can retry only supported failed downloads.
- Retry moves item to the end of the queue.
- Only one fake download runs at a time.
- Fake downloads take 1–3 seconds.
- Fake downloads randomly fail around 20% of the time.
- User can change download folder through the popup.
- Empty folder path shows validation error.
- Folder persists, queue does not.
- Exiting with active queue/download shows warning.
- Exiting without active queue/download closes immediately.
- No system notifications.
- No real downloading.
