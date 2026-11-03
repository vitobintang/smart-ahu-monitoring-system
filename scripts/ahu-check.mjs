import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Run from this project's root, even when invoked from another directory.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checks = ["typecheck", "test", "build"];

for (const check of checks) {
  console.log(`\n=== npm run ${check} ===`);

  // Static command text only: no user input is passed through a shell.
  const result = spawnSync(`npm run ${check}`, {
    cwd: root,
    shell: true,
    stdio: "inherit",
  });

  if (result.error || result.status !== 0) {
    console.error(`\n${check} failed or could not run. Stopped.`);
    process.exit(1);
  }
}

console.log("\nAll checks passed.");