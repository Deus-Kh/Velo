# Velo `dev-copilot` Handoff

This document records the work completed on the `dev-copilot` branch so another coding assistant can continue the project without relying on conversation history.

## 1. Repository and branch

- Repository: `Deus-Kh/Velo`
- Local path: `C:\Users\User\Projects\velo_old`
- Working branch: `dev-copilot`
- Baseline: the branch was created from `dev`.
- Client: `chats-client`
- Server: `chats-server`
- Protocol package: `packages/protocol`
- Android package: `com.velo`
- Connected test device previously used: `R58TB25PGQA`
- Current latest commit before this document: `ad77bb5`
- Existing unrelated worktree changes that must not be staged or reverted:
  - `.gitignore`
  - `chats-client/package.json`

Every Copilot-created commit includes:

```text
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## 2. High-level outcome

The original work continued a Claude Code UI roadmap sequence. The following UI polish items were implemented:

- B5–B14: theme contrast, verified chat state, attachment/action separation, compact sheets, Settings subpages, light/dark navigation contrast, density tokens, image viewer core, New Chat cleanup, and delivery-state icons.
- A13: investigated the previously reported React Native native crash. Repeated debug launches were stable; release verification remains blocked by missing local signing properties.
- A14: moved Settings subpage back navigation from the right action area to a left leading slot.
- A15: enabled native multi-photo selection and sequential sending in both 1:1 and group chats.
- A16: added adjacent cached photo context and horizontal photo browsing in the image viewer.
- A17: repaired the first viewer pass by changing thumbnail rendering, adding a modal gesture root, improving gesture composition, and moving the active index into a Reanimated shared value.
- A18: fixed portrait camera JPEG orientation handling by preserving only a minimal EXIF orientation tag and correcting stored dimensions.
- A19: reduced the photo gallery swipe threshold to feel closer to Telegram, including a quick-flick path.

The latest photo-swipe change is implemented, typechecked, linted, built, installed, and launched on the connected device. The final visual eyes-on test of a short swipe between two photos still needs to be performed.

## 3. Commit history, in order

### `464c9fc` — B5: theme settings switch contrast

Changed the Settings switch styling to use resolved application theme tokens instead of hardcoded or inappropriate colors.

Files:

- `chats-client/src/components/settings/primitives.tsx`
- `chats-client/src/theme/theme.ts`
- `chats-client/src/theme/useThemeColors.ts`
- `chats-client/src/theme/__tests__/toggleContrast.test.ts`
- `docs/PROJECT_ROADMAP.md`

Validation included the client checks and the new toggle contrast test.

### `7fc30ca` — Docs: mark B5 done by Copilot

Documentation-only follow-up marking B5 complete in `docs/PROJECT_ROADMAP.md`.

### `71b7739` — B6: show verified state in chat header

Implemented the verified state in the 1:1 chat header:

- Reads local trust/pin state.
- Shows a verified check mark when the peer identity is trusted and healthy.
- Keeps the Verify action available until trust exists.
- Removes Verify from the chat action sheet after verification.
- Preserves existing presence, typing, and last-seen precedence.
- Suppresses the verified mark when identity health reports a change.

Files:

- `chats-client/src/components/chat/ChatHeader.tsx`
- `chats-client/src/components/chat/ChatActionsSheet.tsx`
- `chats-client/src/screens/ChatScreen.tsx`
- `docs/PROJECT_ROADMAP.md`

### `f93beb0` — B7: split attachment and chat actions

Separated attachment actions from chat-level actions:

- The composer `+` button now opens a dedicated attachment sheet.
- The attachment sheet currently exposes Photo from gallery.
- Chat-level actions are opened from the header overflow.
- Verify remains in the header until the contact is trusted.
- Camera, File, and the deeper contact-info screen remain future work.

Files:

- Added `chats-client/src/components/chat/AttachmentSheet.tsx`
- Updated `chats-client/src/screens/ChatScreen.tsx`
- Updated `docs/PROJECT_ROADMAP.md`

### `c328c6f` — B8: compact action sheets

Made action sheets shorter and more usable:

- Replaced paragraph-heavy action rows with icon-and-label rows.
- Bounded sheet height and made longer sheets scrollable.
- Kept outside-tap dismissal.
- Preserved message reaction controls.
- Added concise destructive confirmations for delete actions.
- Preserved local-only versus request-based delete semantics.

Files:

- `chats-client/src/components/BottomSheetPanel.tsx`
- `chats-client/src/components/MessageActionsSheet.tsx`
- `chats-client/src/components/chat/ChatActionsSheet.tsx`
- `chats-client/src/screens/ChatScreen.tsx`
- `docs/PROJECT_ROADMAP.md`

### `ca1e3ac` — B9: split Settings into focused pages

Restructured Settings into a compact landing page and focused in-screen subpages:

- Profile
- Privacy
- Notifications
- Appearance
- Account
- Advanced

Existing editors, diagnostics, sheets, logout, and deletion behavior were preserved. The section components already extracted earlier remain in `chats-client/src/components/settings/`.

File primarily changed:

- `chats-client/src/screens/SettingsScreen.tsx`

### `ba8c654` — B10: balance light and dark navigation themes

Improved navigation contrast using resolved application theme tokens:

- Light theme has a visible tinted active tab surface and accent icon.
- Dark theme has a readable active surface.
- Navigation no longer relies on the system color scheme when the app theme differs.
- Status bar behavior remains tied to the resolved theme in `App.tsx`.

Files:

- `chats-client/src/screens/MainTabsScreen.tsx`
- `chats-client/src/theme/theme.ts`
- `chats-client/src/theme/useThemeColors.ts`
- `chats-client/src/theme/__tests__/tabContrast.test.ts`
- `docs/PROJECT_ROADMAP.md`

### `85bf4ef` — B11: wire interface density tokens

Made compact versus comfortable interface density measurable:

- List-row spacing is token-driven.
- Message-bubble padding changes with density.
- Message typography changes with density.
- Composer text sizing changes with density.
- Added shared density tokens and regression coverage.

Files:

- Added `chats-client/src/theme/density.ts`
- Added `chats-client/src/theme/__tests__/density.test.ts`
- Updated `chats-client/src/components/ListRow.tsx`
- Updated `chats-client/src/components/MessageBubble.tsx`
- Updated `chats-client/src/components/chat/ChatComposer.tsx`
- Updated `docs/PROJECT_ROADMAP.md`

### `4431f4b` — B12: improve image viewer gestures

Implemented the initial viewer core:

- Opaque black backdrop.
- Pinch zoom up to 4x.
- Double-tap zoom and reset.
- Swipe-down dismissal.
- Accessible close control.
- Caption support and multi-image viewer groundwork.

The full media action bar with Save, Forward, and Delete is still not implemented.

Primary file:

- `chats-client/src/components/ImageViewer.tsx`

### `f7a9a79` — B13: polish New Chat contacts

Improved New Chat:

- Removed redundant subtitle content.
- De-duplicated saved, verified, and recent contacts.
- Removed empty Recent section headers.
- Hid the bottom tab bar while the keyboard is visible.

Files:

- `chats-client/src/screens/MainTabsScreen.tsx`
- `chats-client/src/screens/NewChatScreen.tsx`
- `docs/PROJECT_ROADMAP.md`

### `a4d573e` — B14: distinguish message delivery states

Message bubbles now distinguish:

- Queued: clock.
- Sent: single check.
- Delivered: double check.
- Read: accent double check.
- Failed: failure indicator.

Added focused regression tests.

Files:

- `chats-client/src/components/MessageBubble.tsx`
- Added `chats-client/src/components/__tests__/messageStatus.test.ts`
- `docs/PROJECT_ROADMAP.md`

### `c2f1470` — Docs: record A13 build investigation

Recorded the native crash investigation and build state in the roadmap:

- Android debug build succeeded.
- Release build could not proceed because local signing properties were missing.
- Required signing values are local-only and must never be committed.

### `ba0dba4` — Docs: record A13 device launch check

Recorded the device launch check:

- Debug APK installed on the connected Android phone.
- Ten sequential debug launches completed.
- No `FATAL EXCEPTION`, `SIGSEGV`, or fatal-signal markers were observed.
- The app remained running.
- Release verification remains blocked by missing signing properties.

### `7b5dec9` — Fix Settings navigation and photo browsing

This commit addressed the first user-reported Settings/photo issues.

#### Settings navigation

- Added an optional `leading` slot to `ScreenHeader`.
- Moved focused Settings back navigation into the left slot.
- Kept right-side actions separate.

Files:

- `chats-client/src/components/ScreenHeader.tsx`
- `chats-client/src/screens/SettingsScreen.tsx`

#### Multiple photo sending

- Added `pickImages()`.
- Changed native image picker selection to `selectionLimit: 0`.
- Preserved every selected image asset.
- Updated 1:1 and group chat send flows to process selected photos sequentially.
- Applied the composer caption only to the first selected photo.
- Kept each image independently encrypted and uploaded through the existing attachment pipeline.

Files:

- `chats-client/src/shared/media/attachments.ts`
- `chats-client/src/screens/ChatScreen.tsx`
- `chats-client/src/screens/GroupChatScreen.tsx`
- `chats-client/src/shared/media/__tests__/attachments.test.ts`

#### Initial gallery browsing

- Extended `ImageViewer` to receive multiple images and captions.
- Added horizontal navigation.
- Passed adjacent cached images from 1:1 and group chat surfaces.
- Kept pinch, double-tap, and swipe-down behavior.

Files:

- `chats-client/src/components/ImageViewer.tsx`
- `chats-client/src/components/chat/MessageList.tsx`
- `chats-client/src/screens/ChatScreen.tsx`
- `chats-client/src/screens/GroupChatScreen.tsx`

Important limitation from this first pass: adjacent images were included only when their decrypted data URI was already cached. Non-cached adjacent attachments are not automatically downloaded by the viewer.

### `66b1659` — Fix photo orientation and viewer gestures

This was the first repair after device feedback that portrait photos looked horizontal/cropped and gestures were unreliable.

Changes:

- Changed chat photo thumbnails from `resizeMode="cover"` to `resizeMode="contain"` to avoid cropping.
- Added `GestureHandlerRootView` inside the React Native `Modal`.
- Added explicit pan thresholds:
  - `.minDistance(12)`
  - `.activeOffsetX([-18, 18])`
  - `.activeOffsetY([-18, 18])`
- Composed double-tap, pan, and pinch simultaneously.
- Replaced the JS closure-captured viewer index with a Reanimated shared `activeIndex`.
- Kept horizontal browsing, pinch/double-tap zoom, and vertical dismissal.

Files:

- `chats-client/src/components/AttachmentView.tsx`
- `chats-client/src/components/ImageViewer.tsx`
- `docs/PROJECT_ROADMAP.md`

Validation:

- Client TypeScript.
- Client ESLint.
- Focused attachment/message Jest tests.
- Android debug build.
- APK installation and launch.
- Secret scan.

### `06137f7` — Preserve photo orientation metadata

This fixed the actual root cause of the horizontal portrait images.

#### Root cause

Many Android camera JPEGs store the physical encoded pixels in landscape orientation and use an EXIF Orientation tag to tell the decoder how to display them. The previous metadata stripper removed the entire JPEG APP1 segment, including that orientation tag. After encryption/decryption, both the bubble and the viewer saw the unrotated landscape pixels.

#### Changes

- The protocol JPEG metadata stripper now attempts to reduce EXIF to only the Orientation tag.
- All other EXIF fields and XMP data are removed.
- JPEG APP0, APP2, and APP14 handling remains unchanged for decoder/color support.
- Added `jpegOrientation()` to the protocol exports.
- The client reads the original picker bytes before stripping.
- For orientations 5–8, the client swaps the stored width and height.
- Existing already-stripped attachments cannot be repaired because their original orientation metadata is gone; they must be resent.

Files:

- `packages/protocol/src/attachment/metadata.ts`
- `packages/protocol/src/index.ts`
- `packages/protocol/test/attachment.test.ts`
- `chats-client/src/shared/media/attachments.ts`
- `docs/PROJECT_ROADMAP.md`

The first implementation introduced a buffer-size bug, fixed in the next commit.

### `5c765ff` — Fix EXIF orientation buffer overflow

When a real camera JPEG was picked, Android reported:

```text
RangeError: The sum of the length of the given object and the offset cannot be greater than the length of this TypedArray
```

Logcat identified the source:

```text
[ChatScreen] photo send failed: [RangeError: ... TypedArray]
```

Cause: the generated minimal EXIF block was one byte too short for the data written by the reducer.

Fix:

- Increased the generated EXIF buffer to the correct fixed size.
- Added regression coverage for the reduction path.

Files:

- `packages/protocol/src/attachment/metadata.ts`
- `packages/protocol/test/attachment.test.ts`

Validation:

- Protocol attachment tests passed.
- Protocol TypeScript passed.
- Client TypeScript passed.
- Client ESLint passed.
- Android debug build succeeded.
- Corrected APK installed and launched on the device.

### `ad77bb5` — Tune photo gallery swipe threshold

The original horizontal swipe required a fixed translation of more than 100 px, which felt too heavy and unlike Telegram.

New behavior in `ImageViewer.tsx`:

- Deliberate horizontal swipe threshold:
  - `18%` of screen width.
  - Minimum `72` px.
- Quick flick path:
  - Horizontal velocity greater than `650` px/s.
  - At least `36` px of horizontal movement.
- Horizontal direction must dominate vertical movement.
- Only operates at `scale === 1`.
- Vertical swipe-down dismissal remains unchanged.
- Zoomed images continue to pan without switching photos.

Files:

- `chats-client/src/components/ImageViewer.tsx`
- `docs/PROJECT_ROADMAP.md`

Validation:

- Client TypeScript.
- Client ESLint.
- Diff check.
- Secret scan.
- Android debug build.
- APK installation and launch.

## 4. Current photo viewer behavior

The viewer is implemented in:

```text
chats-client/src/components/ImageViewer.tsx
```

Current supported gestures:

| Gesture | Behavior |
|---|---|
| Pinch | Zoom from 1x to 4x |
| Double tap | Zoom to 2x or reset |
| Horizontal swipe at 1x | Move to previous/next image |
| Quick horizontal flick at 1x | Move with shorter movement |
| Vertical swipe at 1x | Close viewer |
| Horizontal drag while zoomed | Pan the current image |

Important implementation details:

- `activeIndex` is a Reanimated shared value so UI-thread gestures do not read a stale React closure.
- The `Modal` contains a local `GestureHandlerRootView`.
- Gestures are composed with `Gesture.Simultaneous`.
- The viewer currently receives already-available image URIs from the chat surface.
- Adjacent non-cached images are still excluded from the browsing list. A future robust implementation should pass attachment metadata and download/decrypt callbacks or preload adjacent images.

## 5. Current photo attachment pipeline

The send flow is:

```text
native picker
  -> base64 decode
  -> read JPEG orientation from original bytes
  -> strip metadata while preserving only orientation
  -> use corrected dimensions
  -> encrypt attachment
  -> reserve blob
  -> upload ciphertext
  -> complete blob
  -> save plaintext sealed locally
  -> send encrypted content message
```

Relevant files:

- `chats-client/src/shared/media/attachments.ts`
- `packages/protocol/src/attachment/metadata.ts`
- `chats-client/src/shared/media/mediaStore.ts`
- `chats-client/src/components/AttachmentView.tsx`
- `chats-client/src/components/ImageViewer.tsx`

Privacy behavior:

- GPS and other EXIF fields are not preserved.
- XMP and unrelated JPEG metadata are removed.
- Only the display orientation instruction is retained because removing it breaks portrait rendering.
- Existing attachments that were processed by the old stripper must be resent.

## 6. Validation commands used

Client TypeScript:

```powershell
Set-Location chats-client
npx tsc --noEmit
```

Client lint:

```powershell
Set-Location chats-client
npm run lint -- --quiet
```

Focused client tests:

```powershell
Set-Location chats-client
npm test -- --runInBand src/shared/media/__tests__/attachments.test.ts src/components/__tests__/messageStatus.test.ts
```

Protocol attachment tests:

```powershell
Set-Location packages\protocol
npx vitest run test/attachment.test.ts
```

Protocol TypeScript:

```powershell
Set-Location packages\protocol
npx tsc --noEmit -p tsconfig.json
```

Android debug build:

```powershell
Set-Location chats-client\android
.\gradlew.bat assembleDebug --no-daemon --console=plain
```

Install and launch:

```powershell
$apk = 'chats-client\android\app\build\outputs\apk\debug\app-debug.apk'
adb install -r $apk
adb shell am force-stop com.velo
adb shell monkey -p com.velo 1
```

Secret scan:

```powershell
node tools/secret-scan.js --all
```

Diff check:

```powershell
git diff --check
```

Device screenshot:

```powershell
adb exec-out screencap -p > C:\path\to\screenshot.png
```

## 7. Local development networking

The client development environment uses:

```text
API_URL=http://localhost:9999
SOCKET_URL=http://localhost:9999
```

For the USB-connected Android phone, reverse both ports:

```powershell
Set-Location chats-client
npm run dev:reverse
```

This maps:

- `localhost:8081` on the phone to Metro on the computer.
- `localhost:9999` on the phone to the chats server on the computer.

The chats server depends on local MongoDB. If chat loading reports a network or WebSocket error, check:

```powershell
adb reverse --list
Get-NetTCPConnection -LocalPort 9999 -State Listen
curl.exe http://localhost:9999/health
```

The server uses:

```text
mongodb://127.0.0.1:27017/velo-dev
```

If MongoDB is stopped, `chats-server` fails before opening port 9999. Start the existing MongoDB Windows service from an elevated PowerShell, then run:

```powershell
Set-Location chats-server
npm run dev
```

Do not create a new MongoDB data directory without confirming that preserving existing local development data is not required.

## 8. A13 native crash status

The roadmap contains the full A13 investigation in `docs/PROJECT_ROADMAP.md`.

Observed historical issue:

- React Native Fabric `SIGSEGV` in `libreactnative.so`.
- Stack included `MountingCoordinator::pullTransaction`, `FabricUIManagerBinding::schedulerDidFinishTransaction`, and `ShadowTree::commit`.
- It occurred during early screen commits after socket connection.

Current evidence:

- Android debug build succeeds.
- Ten sequential debug launches completed on the connected device without fatal crash markers.
- No `FATAL EXCEPTION`, `SIGSEGV`, or fatal-signal logcat markers were found during that check.
- Release build verification remains pending because local signing properties are missing:
  - `MYAPP_UPLOAD_STORE_FILE`
  - `MYAPP_UPLOAD_STORE_PASSWORD`
  - `MYAPP_UPLOAD_KEY_ALIAS`
  - `MYAPP_UPLOAD_KEY_PASSWORD`

Never commit those values.

## 9. Roadmap status

Completed in this continuation:

- B5
- B6
- B7
- B8
- B9
- B10
- B11
- B12 viewer core
- B13
- B14
- A13 debug/device investigation
- A14
- A15
- A16
- A17
- A18 implementation
- A19 implementation

The roadmap records all of these in:

```text
docs/PROJECT_ROADMAP.md
```

The B12 media action follow-up is still open:

- Save
- Forward
- Delete

The gallery still has a known architectural limitation: browsing currently depends on cached adjacent decrypted image URIs.

## 10. Recommended next steps for Claude Code

### Immediate manual check

On the connected phone:

1. Open a chat containing at least two newly available photos.
2. Tap one photo to open the viewer.
3. Try a short deliberate horizontal swipe, around one fifth of the screen width.
4. Try a quick flick with a short movement.
5. Verify the viewer changes photos.
6. Verify a vertical swipe still dismisses the viewer.
7. Zoom in and drag horizontally; verify it pans instead of changing photos.
8. Verify a new portrait camera photo is upright in both the bubble and viewer.

### If short swipes still do not change photos

Inspect:

- Whether the viewer receives more than one `ViewerImage`.
- Whether adjacent photos are cached.
- Whether the modal's `GestureHandlerRootView` is active on the installed APK.
- Whether a reply/message gesture is intercepting the viewer gesture.
- Whether `event.velocityX` behaves as expected on the device.

Use logcat and a screenshot rather than assuming the issue is visual:

```powershell
adb logcat -d -t 500 | Select-String -Pattern 'ImageViewer|ReactNativeJS|FATAL|RangeError|TypeError'
```

### Improve non-cached gallery browsing

The current `MessageList.openImage` logic builds the viewer list from `cachedMediaDataUri()`. This means a conversation with several remote photos may still open as a single-photo viewer.

A complete solution should:

- Pass attachment metadata for all image messages.
- Pass `myUserId`.
- Download/decrypt the selected image if necessary.
- Preload or lazily load adjacent attachments.
- Keep the viewer responsive while adjacent images load.
- Surface integrity/download failures explicitly.

Avoid silently omitting adjacent photos because that makes the gallery appear broken.

### Finish B12 media actions

Add viewer actions with the correct security and ownership behavior:

- Save: write a user-approved copy to the device gallery; do not silently export plaintext.
- Forward: use the existing forwarding flow and preserve encrypted-message semantics.
- Delete: distinguish delete-for-me and delete-for-everyone according to existing message behavior.

### Complete A13 release verification

Only after local signing properties are supplied outside the repository:

1. Build the release APK.
2. Install it on the device.
3. Launch repeatedly.
4. Capture logcat.
5. Record results in the roadmap.

## 11. Worktree and commit policy

Before continuing:

```powershell
git status --short
git branch --show-current
```

Do not stage or revert:

- `.gitignore`
- `chats-client/package.json`

They contain unrelated pre-existing changes.

Use surgical commits with the Copilot trailer. Do not amend existing commits unless explicitly requested.

## 12. Session-plan note

The session-specific planning file is outside the repository:

```text
C:\Users\User\.copilot\session-state\a29c0046-6651-47b9-a81b-6a179df6f8e4\plan.md
```

It contains the earlier photo-fix plan and the latest progress notes, including:

- The MongoDB/backend outage and resolution.
- The EXIF orientation diagnosis.
- The EXIF buffer-overflow fix.
- The current swipe-threshold refinement.

