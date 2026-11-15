// The signed-out pages the device checks open by default. Shared by
// `pnpm check:phone` (layout) and `pnpm check:features` (does each control
// work), so a page added here is checked both ways. Rules: docs/phone-width.md.
export const DEFAULT_PATHS = [
  "/", "/about", "/badges", "/builders", "/contact", "/cookies", "/discover-hire", "/explore",
  "/faq", "/hire/claude-code", "/how-it-works", "/jobs", "/jobs/in/remote", "/leaderboard",
  "/pricing", "/privacy", "/referral-terms", "/talent/united-states", "/terms", "/login", "/signup",
  "/forgot-password", "/reset-password", "/maintenance", "/unsubscribe", "/verify-device",
  "/this-page-does-not-exist",
];
