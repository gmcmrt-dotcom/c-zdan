#!/usr/bin/env node
/**
 * Wallet production deploy — "+" komutu.
 *
 * Kullanım:
 *   npm run deploy
 *   npm run deploy -- --yes
 *   npm run deploy -- --message "feat: yeni ödeme akışı"
 *   npm run deploy -- --no-push          # yalnızca sunucu deploy, GitHub atlanır
 *   npm run deploy -- --dry-run          # commit/push/deploy önizlemesi
 *   DEPLOY_CONFIRM=1 npm run deploy
 *
 * Akış: ön kontrol → GitHub commit+push (varsayılan) → sunucu deploy
 * Yapılandırma: deploy.config.json (deploy.config.example.json şablonu).
 * Dokümantasyon: docs/DEPLOY_PLUS.md
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CONFIG_PATH = join(ROOT, "deploy.config.json");

const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  bold: "\x1b[1m",
};

function log(msg) {
  console.log(`${colors.dim}[deploy]${colors.reset} ${msg}`);
}

function ok(msg) {
  console.log(`${colors.green}✓${colors.reset}  ${msg}`);
}

function warn(msg) {
  console.warn(`${colors.yellow}⚠${colors.reset}  ${msg}`);
}

function fail(msg) {
  console.error(`${colors.red}✗${colors.reset}  ${msg}`);
  process.exit(1);
}

function expandPath(p) {
  if (!p) return p;
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
    ...opts,
  });
  if (result.status !== 0) {
    fail(`Komut başarısız: ${cmd} ${args.join(" ")}`);
  }
}

function runCapture(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    ...opts,
  });
  return result;
}

/** Hassas dosyalar commit'e asla girmemeli (.gitignore + ek kontrol). */
const DENY_COMMIT_PATHS = [
  /^deploy\.config\.json$/,
  /^\.env$/,
  /^\.env\.[^/]+$/,
  /^apps\/api\/\.env$/,
  /^apps\/web\/\.env\.local$/,
];

function parseCliArgs() {
  const args = process.argv.slice(2);
  let message = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--message" && args[i + 1]) {
      message = args[++i];
    }
  }
  return {
    yes: args.includes("--yes") || process.env.DEPLOY_CONFIRM === "1",
    noPush: args.includes("--no-push"),
    dryRun: args.includes("--dry-run"),
    message,
  };
}

function isGitRepo() {
  return runCapture("git", ["rev-parse", "--is-inside-work-tree"]).status === 0;
}

function resolvePushTarget(config) {
  const head = runCapture("git", ["symbolic-ref", "--short", "HEAD"]);
  if (head.status === 0 && head.stdout?.trim()) {
    return { remote: config.gitRemote, branch: head.stdout.trim() };
  }
  return { remote: config.gitRemote, branch: config.gitBranch };
}

function assertNoSensitiveStaged() {
  const staged = runCapture("git", ["diff", "--cached", "--name-only"]);
  const files = (staged.stdout ?? "").trim().split("\n").filter(Boolean);
  for (const file of files) {
    if (DENY_COMMIT_PATHS.some((re) => re.test(file))) {
      fail(
        `Güvenlik: hassas dosya commit'e eklenemez: ${file}\n` +
          `  .gitignore'da olmalı — izleniyorsa: git rm --cached ${file}`,
      );
    }
  }
}

function failGitPush(remote, branch, result) {
  const out = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (/permission denied|authentication failed|could not read from remote|403|401|invalid credentials|repository not found/i.test(out)) {
    fail(
      `GitHub push başarısız — kimlik doğrulama veya yetki hatası (${remote}/${branch}).\n` +
        `  Kontrol: git remote -v\n` +
        `  SSH: ssh -T git@github.com\n` +
        `  HTTPS: gh auth login`,
    );
  }
  if (result.stderr?.trim()) console.error(result.stderr.trim());
  if (result.stdout?.trim()) console.error(result.stdout.trim());
  fail(`Git push başarısız: ${remote}/${branch}`);
}

function gitPush(remote, branch, { setUpstream = false } = {}) {
  const args = setUpstream ? ["push", "-u", remote, branch] : ["push", remote, branch];
  const result = runCapture("git", args);
  if (result.status !== 0) {
    failGitPush(remote, branch, result);
  }
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`
${colors.red}${colors.bold}deploy.config.json bulunamadı${colors.reset}

Tek seferlik kurulum:
  1. cp deploy.config.example.json deploy.config.json
  2. deploy.config.json içinde host, user, path, sshKey alanlarını doldurun
  3. Sunucuda SSH anahtarınızın yetkili olduğundan emin olun
     (bkz. docs/DEPLOY_PLUS.md § Tek seferlik kurulum)

Örnek:
  "host": "203.0.113.10",
  "user": "wallet",
  "path": "/opt/wallet",
  "sshKey": "~/.ssh/id_ed25519"
`);
    process.exit(1);
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (err) {
    fail(`deploy.config.json geçersiz JSON: ${err.message}`);
  }

  const required = ["host", "user", "path"];
  for (const key of required) {
    if (!raw[key] || String(raw[key]).trim() === "") {
      fail(`deploy.config.json eksik alan: "${key}"`);
    }
  }

  const sshKey = expandPath(raw.sshKey ?? join(homedir(), ".ssh", "id_ed25519"));
  if (!existsSync(sshKey)) {
    fail(
      `SSH anahtarı bulunamadı: ${sshKey}\n` +
        `deploy.config.json içindeki "sshKey" yolunu düzeltin veya anahtarı oluşturun:\n` +
        `  ssh-keygen -t ed25519 -f ${sshKey}`,
    );
  }

  return {
    host: String(raw.host).trim(),
    user: String(raw.user).trim(),
    port: Number(raw.port ?? 22),
    path: String(raw.path).trim(),
    sshKey,
    deployMethod: raw.deployMethod === "rsync" ? "rsync" : "git",
    gitRemote: String(raw.gitRemote ?? "origin"),
    gitBranch: String(raw.gitBranch ?? "main"),
    remoteRunUser: String(raw.remoteRunUser ?? raw.user).trim(),
    webStaticPath: raw.webStaticPath ? String(raw.webStaticPath).trim() : null,
    preflight: {
      typecheck: raw.preflight?.typecheck !== false,
      lint: raw.preflight?.lint !== false,
      seedVerify: raw.preflight?.seedVerify === true,
    },
  };
}

function sshBaseArgs(config) {
  return [
    "-i",
    config.sshKey,
    "-p",
    String(config.port),
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    `${config.user}@${config.host}`,
  ];
}

function sshExec(config, remoteCmd) {
  const result = spawnSync("ssh", [...sshBaseArgs(config), remoteCmd], {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    fail("Uzak SSH komutu başarısız.");
  }
}

async function confirmDeploy(warnings) {
  const args = process.argv.slice(2);
  if (args.includes("--yes") || process.env.DEPLOY_CONFIRM === "1") {
    return;
  }

  if (warnings.length > 0) {
    console.log("");
    for (const w of warnings) warn(w);
    console.log("");
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `${colors.yellow}Production'a deploy etmek istiyor musunuz? [y/N]${colors.reset} `,
  );
  rl.close();

  if (!/^y(es)?$/i.test(answer.trim())) {
    log("Deploy iptal edildi.");
    process.exit(0);
  }
}

function preflight(config) {
  log("Ön kontroller çalışıyor…");

  if (config.preflight.typecheck) {
    log("typecheck…");
    run("npm", ["run", "typecheck"]);
    ok("typecheck geçti");
  }

  if (config.preflight.lint) {
    log("lint…");
    run("npm", ["run", "lint"]);
    ok("lint geçti");
  }

  if (config.preflight.seedVerify) {
    log("test:seed:verify…");
    run("npm", ["run", "test:seed:verify"]);
    ok("test:seed:verify geçti");
  }
}

function checkGitStatus(config) {
  const warnings = [];

  if (!isGitRepo()) {
    if (config.deployMethod === "git") {
      fail("Git deposu değil — deployMethod=git için git gerekli.");
    }
    warn("Git deposu değil; rsync modu ile devam ediliyor.");
    return warnings;
  }

  const { branch: pushBranch } = resolvePushTarget(config);

  const status = runCapture("git", ["status", "--porcelain"]);
  const dirty = (status.stdout ?? "").trim();
  if (dirty) {
    const count = dirty.split("\n").length;
    log(`Commit edilmemiş ${count} dosya — deploy öncesi otomatik commit yapılacak.`);
  }

  if (pushBranch !== config.gitBranch && config.deployMethod === "git") {
    warnings.push(
      `Aktif dal "${pushBranch}"; sunucu config gitBranch="${config.gitBranch}" çeker. ` +
        `Production için ${config.gitBranch} dalında deploy önerilir.`,
    );
  }

  const remoteCheck = runCapture("git", ["remote", "get-url", config.gitRemote]);
  if (remoteCheck.status !== 0) {
    warnings.push(
      `Git remote "${config.gitRemote}" tanımlı değil — push başarısız olabilir. ` +
        `git remote add ${config.gitRemote} https://github.com/...`,
    );
  }

  return warnings;
}

function previewGitSync(config, cli) {
  const { remote, branch } = resolvePushTarget(config);
  log(`[dry-run] Hedef: ${remote}/${branch}`);

  const status = runCapture("git", ["status", "--short"]);
  if (status.stdout?.trim()) {
    console.log(status.stdout.trim());
    const msg =
      cli.message ?? `deploy: ${new Date().toISOString().replace("T", " ").slice(0, 19)}`;
    log(`[dry-run] git add . && git commit -m "${msg}"`);
    log(`[dry-run] git push ${remote} ${branch} (yeni commit)`);
    return;
  }

  log("[dry-run] Commit edilecek değişiklik yok.");

  const upstream = `${remote}/${branch}`;
  const upstreamExists = runCapture("git", ["rev-parse", "--verify", upstream]).status === 0;
  if (!upstreamExists) {
    log(`[dry-run] git push -u ${remote} ${branch}`);
    return;
  }

  const ahead = runCapture("git", ["rev-list", "--count", `${upstream}..HEAD`]);
  const aheadCount = Number(ahead.stdout?.trim() ?? "0");
  if (aheadCount > 0) {
    log(`[dry-run] git push ${remote} ${branch} (${aheadCount} commit)`);
  } else {
    log("[dry-run] Remote ile güncel — push gerekmiyor.");
  }
}

function syncGitHub(config, cli) {
  if (!isGitRepo()) {
    fail("GitHub senkronizasyonu için git deposu gerekli.");
  }

  const { remote, branch } = resolvePushTarget(config);

  const remoteCheck = runCapture("git", ["remote", "get-url", remote]);
  if (remoteCheck.status !== 0) {
    fail(
      `Git remote "${remote}" tanımlı değil.\n` +
        `  git remote add ${remote} https://github.com/KULLANICI/REPO.git`,
    );
  }

  log(`GitHub: ${remoteCheck.stdout?.trim()}`);

  const porcelain = runCapture("git", ["status", "--porcelain"]);
  const dirty = (porcelain.stdout ?? "").trim();

  if (dirty) {
    log("Değişiklikler commit ediliyor…");
    run("git", ["add", "."]);
    assertNoSensitiveStaged();

    const msg =
      cli.message ?? `deploy: ${new Date().toISOString().replace("T", " ").slice(0, 19)}`;
    run("git", ["commit", "-m", msg]);
    ok(`Commit: ${msg}`);
  } else {
    log("Commit edilecek değişiklik yok.");
  }

  const upstream = `${remote}/${branch}`;
  const upstreamExists = runCapture("git", ["rev-parse", "--verify", upstream]).status === 0;

  if (!upstreamExists) {
    log(`Upstream yok — ilk push: ${remote}/${branch}`);
    gitPush(remote, branch, { setUpstream: true });
    ok(`Git push tamam (${remote}/${branch})`);
    return;
  }

  const ahead = runCapture("git", ["rev-list", "--count", `${upstream}..HEAD`]);
  const aheadCount = Number(ahead.stdout?.trim() ?? "0");

  if (aheadCount === 0) {
    log(`Yerel dal güncel (${remote}/${branch}) — push atlandı.`);
    return;
  }

  log(`${aheadCount} commit push ediliyor: ${remote}/${branch}…`);
  gitPush(remote, branch);
  ok(`Git push tamam (${remote}/${branch})`);
}

function rsyncToServer(config) {
  log("Rsync ile dosyalar gönderiliyor…");
  const sshCmd = `ssh -i ${config.sshKey} -p ${config.port} -o BatchMode=yes -o StrictHostKeyChecking=accept-new`;
  const excludes = [
    "node_modules",
    ".git",
    "apps/api/dist",
    "apps/web/dist",
    "packages/shared/dist",
    "apps/api/storage",
    "apps/api/logs",
    "installers/linux/logs",
    "e2e/test-results",
    "e2e/playwright-report",
    "deploy.config.json",
    ".env",
    "apps/api/.env",
    "apps/web/.env.local",
  ];

  const args = [
    "-az",
    "--delete",
    ...excludes.flatMap((e) => ["--exclude", e]),
    "-e",
    sshCmd,
    `${ROOT}/`,
    `${config.user}@${config.host}:${config.path}/`,
  ];

  run("rsync", args);
  ok("Rsync tamam");
}

function buildRemoteScript(config) {
  const lines = [
    "set -euo pipefail",
    `cd ${JSON.stringify(config.path)}`,
  ];

  if (config.deployMethod === "git") {
    lines.push(
      `sudo -u ${config.remoteRunUser} git fetch ${config.gitRemote} ${config.gitBranch}`,
      `sudo -u ${config.remoteRunUser} git checkout ${config.gitBranch}`,
      `sudo -u ${config.remoteRunUser} git pull --ff-only ${config.gitRemote} ${config.gitBranch}`,
    );
  }

  lines.push(
    `sudo -u ${config.remoteRunUser} npm install --no-audit --no-fund`,
    `sudo -u ${config.remoteRunUser} npm run db:migrate`,
    `sudo -u ${config.remoteRunUser} npm run build`,
    "sudo systemctl restart wallet-api",
  );

  if (config.webStaticPath) {
    lines.push(
      `sudo rsync -a --delete ${JSON.stringify(config.path)}/apps/web/dist/ ${JSON.stringify(config.webStaticPath)}/`,
    );
  }

  lines.push(
    "sudo nginx -t",
    "sudo systemctl reload nginx",
    "curl -fsS http://127.0.0.1:3000/health >/dev/null",
    'echo "Deploy sunucu tarafı tamam."',
  );

  return lines.join("\n");
}

function remoteDeploy(config) {
  log(`Sunucu deploy: ${config.user}@${config.host}:${config.path}…`);
  const script = buildRemoteScript(config);
  sshExec(config, script);
  ok("Sunucu deploy tamam");
}

function printSummary(config, cli) {
  console.log("");
  console.log(`${colors.bold}${colors.green}Deploy başarılı${colors.reset}`);
  console.log(`  Sunucu : ${config.user}@${config.host}:${config.path}`);
  console.log(`  Yöntem : ${config.deployMethod}`);
  if (!cli.noPush) {
    const { remote, branch } = resolvePushTarget(config);
    console.log(`  GitHub : ${remote}/${branch}`);
  }
  console.log(`  Sağlık : curl -fsS http://${config.host}/health (nginx üzerinden)`);
  console.log("");
  console.log(`${colors.dim}Geri alma: docs/DEPLOY_PLUS.md § Geri alma${colors.reset}`);
}

async function main() {
  const cli = parseCliArgs();

  console.log(`${colors.bold}Wallet deploy (+)${colors.reset}`);
  console.log("");

  const config = loadConfig();
  preflight(config);

  const warnings = checkGitStatus(config);

  if (cli.dryRun) {
    log("Dry-run modu — sunucu deploy yapılmayacak.");
    if (!cli.noPush) {
      previewGitSync(config, cli);
    } else {
      log("[dry-run] GitHub push atlandı (--no-push).");
    }
    return;
  }

  await confirmDeploy(warnings);

  if (!cli.noPush) {
    syncGitHub(config, cli);
  } else {
    log("GitHub push atlandı (--no-push).");
    if (config.deployMethod === "git") {
      warn("git modunda sunucu yalnızca remote'taki commit'leri alır.");
    }
  }

  if (config.deployMethod === "rsync") {
    rsyncToServer(config);
  }

  remoteDeploy(config);
  printSummary(config, cli);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
