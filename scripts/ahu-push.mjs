import { spawnSync } from "node:child_process";
import { readSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const message = process.argv[2];

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
        `Git command failed: git ${args[0]}. Inspect Git status before retrying.`
    );
  }

  return result.stdout ?? "";
}

function confirm(prompt, expected) {
  process.stdout.write(prompt);

  let value = "";
  const byte = Buffer.alloc(1);

  for (;;) {
    const count = readSync(0, byte, 0, 1, null);

    if (!count || byte[0] === 10) break;
    if (byte[0] !== 13) value += byte.toString("utf8");

    if (value.length > 100) {
      stop("Confirmation too long. Stopped.");
    }
  }

  if (value !== expected) {
    stop(
      "Not confirmed. No commit or push was performed; inspect Git status."
    );
  }
}

if (
  process.argv.length !== 3 ||
  typeof message !== "string" ||
  !message.trim() ||
  message.length > 200 ||
  /[\r\n\x00]/.test(message)
) {
  stop('Usage: node scripts/ahu-push.mjs "Your commit message"');
}

if (!process.stdin.isTTY) {
  stop(
    "Run this command in an interactive terminal so you can review and confirm."
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
  stop(
    "Origin is not the expected project repository. Stopped without displaying its URL."
  );
}

const staged = spawnSync("git", ["diff", "--cached", "--quiet"], {
  cwd: root,
  stdio: "ignore",
});

if (staged.error || staged.status !== 0) {
  stop(
    "Staged changes already exist or could not be checked. Inspect Git status first."
  );
}

if (!git(["status", "--porcelain"]).trim()) {
  stop("No uncommitted changes. Nothing was committed or pushed.");
}

console.log("\nChanged files:");
git(["status", "--short"], true);

console.log(
  "\nRunning all checks before staging. Do not edit files while they run."
);

const checked = spawnSync(
  process.execPath,
  [resolve(root, "scripts", "ahu-check.mjs")],
  {
    cwd: root,
    stdio: "inherit",
  }
);

if (checked.error || checked.status !== 0) {
  stop(
    "Checks failed. Nothing was staged, committed or pushed by this command."
  );
}

console.log("\nFiles currently changed after checks:");
git(["status", "--short"], true);

console.log(
  "\nWARNING: this stages ALL non-ignored changes, plus changes to already tracked files."
);
console.log(
  "Review the file list above. Do not stage secrets or unrelated work."
);

confirm(
  "Type STAGE ALL to stage, or anything else to cancel: ",
  "STAGE ALL"
);

git(["add", "-A", "--"], true);

const names = git(["diff", "--cached", "--name-only", "-z"])
  .split("\0")
  .filter(Boolean);

if (!names.length) {
  stop("Nothing was staged. No commit or push was performed.");
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
    "A potentially sensitive filename was staged. No commit or push was performed. Inspect and unstage it; this check does not detect every secret."
  );
}

const reviewedTree = git(["write-tree"]).trim();

console.log("\nStaged files:");
git(["diff", "--cached", "--name-status"], true);
git(["diff", "--cached", "--stat"], true);

console.log(
  "\nReview these staged files and their contents in VS Code Source Control."
);
console.log(
  "Filename checks do NOT guarantee that files contain no secrets."
);

confirm(
  "Type COMMIT AND PUSH to continue, or anything else to cancel: ",
  "COMMIT AND PUSH"
);

if (
  git(["branch", "--show-current"]).trim() !== "main" ||
  git(["remote", "get-url", "origin"]).trim() !== remote ||
  git(["write-tree"]).trim() !== reviewedTree
) {
  stop(
    "Branch, origin or staged changes changed during review. No commit or push was performed."
  );
}

const unstaged = spawnSync("git", ["diff", "--quiet"], {
  cwd: root,
  stdio: "ignore",
});

if (
  unstaged.error ||
  unstaged.status !== 0 ||
  git(["ls-files", "--others", "--exclude-standard"]).trim()
) {
  stop(
    "Files changed after staging. No commit or push was performed; inspect Git status."
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