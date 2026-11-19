# AiCodeJobs device tests

Three tests that need a real Mac. They run here on GitHub's Mac.

- **iPhone sizes** (`iphone-sim.yml`): opens aicodejobs.com in real iPhone and iPad Safari, in Apple's simulator. It checks each page fits the screen and saves screenshots. Signed-out public pages only.
- **Mac keys** (`mac-keys.yml`): presses our keyboard shortcuts in real Safari on macOS.
- **Mac measure** (`mac-measure.yml`): measures Apple's own Mac buttons, menus and apps (letter sizes, heights, gaps) and saves pictures. It signs in to nothing.

This repo holds only these test files. It has no site code, no passwords and no keys.

Do not edit files here. They are copied from the main repo, and the next copy replaces them.
