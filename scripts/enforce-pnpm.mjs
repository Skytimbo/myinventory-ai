const ua = process.env.npm_config_user_agent || "";
// Allow pnpm, block npm and yarn
if (!ua.includes("pnpm/") && (ua.includes("npm/") || ua.includes("yarn/"))) {
  console.error("\n✖ This repo uses pnpm. Run: pnpm install\n");
  process.exit(1);
}
