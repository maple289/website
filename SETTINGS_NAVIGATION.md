# Settings navigation

- ESC and the header back arrow use browser history, not a fixed destination.
- Unchanged Settings allows native Back/Forward without prompting or adding entries.
- Profile dirty state compares first/last names against the loaded or saved values.
  Password dirty state is any nonempty password field; successful save clears it.
  Opening sections, focusing controls and password visibility are not edits.
- A shared Settings guard displays Unsaved Changes using the existing confirmation
  provider. Background clicks and ESC cannot dismiss it. Keep Editing preserves
  both Settings values and history. Discard resumes the requested traversal once.
- History entries carry an index alongside existing state. Blocked traversals are
  restored before prompting; no sentinel/duplicate Settings entries are pushed.
  Files folder navigation uses the same index-preserving wrappers.
- Navigation is held while a save is in progress. A failed save retains the draft.
- Photo galleries store only the open photo ID in their history entry. Returning
  from Settings resolves it against the current accessible gallery before opening
  the viewer. No stored metadata or ID bypasses media permissions.
- Reloads and navigation to another document use the browser's native unsaved-change
  warning, since those cannot wait for a custom asynchronous modal. In-application
  Back/Forward uses the custom warning. No previous history entry means Back is a no-op.

## Browser regression suite

Start Vite with fixture-only configuration:

    VITE_SUPABASE_URL=https://settings-test.supabase.co
    VITE_SUPABASE_ANON_KEY=fixture-anon-key
    VITE_BASE_PATH=/
    vite --host 127.0.0.1 --port 5187 --strictPort

Run node tests/settings-navigation.mjs. Install Playwright in the test environment
or set PLAYWRIGHT_MODULE to its module URL. BROWSER_CHANNEL defaults to msedge;
TEST_BASE_URL defaults to http://127.0.0.1:5187.

The harness uses the real Settings/Profile/Photo Viewer components, modal provider,
file-navigation hook and history guard with a fixture Auth context. Network data
and password-save responses are mocked; production data is never changed.

Coverage: Videos/Photos/Files entry points; ESC/Back unchanged and dirty; Keep Editing;
Discard; overlay/ESC protection; repeated Back/Forward; multi-entry traversal;
Back during a warning; dirty Forward; reverting edits; profile/password save;
failed and in-flight saves; photo-viewer restoration; mobile-sized touch context.

Automated runs use headless Edge. They do not establish physical-device or Safari
compatibility. Authentication/backend password processing is outside this UI test.

Validation: all 29 browser checks passed in two consecutive runs after synchronizing
profile dirty/busy reporting before paint. TypeScript and production build passed.
