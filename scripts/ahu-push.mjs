import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [, , message, ...paths] = process.argv;

function stop(text) {
  console.error(`\n${text}`);
  process.exit(1);
}

function git(args, inherit = false, failureMessage) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
  });

  if (result.error || result.status !== 0) {
    stop(
      failureMessage ??
        `Git command failed: git ${args[0]}. Check git status before retrying.`
    );
  }

  return result.stdout ?? "";
}

if (
  !message ||
  !message.trim() ||
  message.length > 200 ||
  /[\r\n\x00]/.test(message) ||
  paths.length === 0 ||
  paths.some((path) => !path || path.includes("\0"))
) {
  stop(
    'Usage: node scripts/ahu-push.mjs "Commit message" path1 [path2 ...]'
  );
}

const top = git(["rev-parse", "--show-toplevel"]).trim();

const normalized = (path) =>
  process.platform === "win32"
    ? resolve(path).toLowerCase()
    : resolve(path);

if (normalized(top) !== normalized(root)) {
  stop("Wrong repository root. Stopped.");
}

if (git(["branch", "--show-current"]).trim() !== "main") {
  stop(
    "This command only pushes the independent project main branch. Stopped."
  );
}

const remote = git(["remote", "get-url", "origin"]).trim();

if (
  !/^(https:\/\/github\.com\/vitobintang\/smart-ahu-monitoring-system(?:\.git)?|git@github\.com:vitobintang\/smart-ahu-monitoring-system(?:\.git)?)$/.test(
    remote
  )
) {
  stop("Origin is not the expected project repository. Stopped.");
}

const staged = spawnSync("git", ["diff", "--cached", "--quiet"], {
  cwd: root,
  stdio: "ignore",
});

if (staged.error || staged.status !== 0) {
  stop(
    "Changes are already staged or could not be checked. Inspect git status first."
  );
}

console.log("\nStaging the supplied paths...");
git(["add", "-A", "--", ...paths], true);

const names = git(["diff", "--cached", "--name-only", "-z"])
  .split("\0")
  .filter(Boolean);

if (!names.length) {
  stop("No changes in the supplied paths. Nothing was committed or pushed.");
}

const sensitive = names.some((name) => {
  const base = name.replace(/\\/g, "/").split("/").pop().toLowerCase();

  return (
    (base.startsWith(".env") && base !== ".env.example") ||
    /\.(pem|key|p12|pfx)$/.test(base) ||
    /^(credentials|service-account)\.json$/.test(base)
  );
});

if (sensitive) {
  stop(
    "A potentially sensitive filename was staged. No commit or push was performed. Inspect and unstage it. This check cannot detect every secret."
  );
}

git(["commit", "-m", message], true);

console.log("\nCommit created. Pushing to origin/main...");

git(
  ["push", "origin", "main"],
  true,
  "Push failed. The commit was created locally; inspect Git status before retrying the push."
);

git(["status", "--short"], true);

console.log("\nPush completed.");