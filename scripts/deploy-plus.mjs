#!/usr/bin/env node
/**
 * Wallet production deploy — "+" komutu.
 *
 * Kullanım:
 *   npm run deploy
 *   npm run deploy -- --yes
 *   DEPLOY_CONFIRM=1 npm run deploy
 *
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

  const inside = runCapture("git", ["rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0) {
    if (config.deployMethod === "git") {
      fail("Git deposu değil — deployMethod=git için git gerekli.");
    }
    warn("Git deposu değil; rsync modu ile devam ediliyor.");
    return warnings;
  }

  const branch = runCapture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const currentBranch = branch.stdout?.trim() ?? "HEAD";

  const status = runCapture("git", ["status", "--porcelain"]);
  const dirty = (status.stdout ?? "").trim();
  if (dirty) {
    warnings.push(
      `Commit edilmemiş değişiklikler var (${dirty.split("\n").length} dosya). ` +
        (config.deployMethod === "git"
          ? "Git modunda sunucu yalnızca push edilmiş commit'leri alır."
          : "Rsync modunda çalışma ağacındaki dosyalar gönderilir."),
    );
  }

  if (config.deployMethod === "git") {
    const upstream = runCapture("git", [
      "rev-parse",
      "--abbrev-ref",
      `${config.gitBranch}@{upstream}`,
    ]);
    if (upstream.status !== 0) {
      warnings.push(
        `Yerel dal "${config.gitBranch}" için upstream tanımlı değil. ` +
          `git push -u ${config.gitRemote} ${config.gitBranch} ile ayarlayın.`,
      );
    } else {
      const ahead = runCapture("git", [
        "rev-list",
        "--count",
        `${config.gitBranch}@{upstream}..${config.gitBranch}`,
      ]);
      const aheadCount = Number(ahead.stdout?.trim() ?? "0");
      if (aheadCount > 0) {
        log(`${aheadCount} commit henüz push edilmemiş — push yapılacak.`);
      }
    }

    if (currentBranch !== config.gitBranch) {
      warnings.push(
        `Aktif dal "${currentBranch}"; config gitBranch="${config.gitBranch}". ` +
          `Push ${config.gitBranch} dalından yapılacak.`,
      );
    }
  }

  return warnings;
}

function gitPush(config) {
  log(`Git push: ${config.gitRemote}/${config.gitBranch}…`);
  run("git", ["push", config.gitRemote, config.gitBranch]);
  ok("Git push tamam");
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

function printSummary(config) {
  console.log("");
  console.log(`${colors.bold}${colors.green}Deploy başarılı${colors.reset}`);
  console.log(`  Sunucu : ${config.user}@${config.host}:${config.path}`);
  console.log(`  Yöntem : ${config.deployMethod}`);
  console.log(`  Sağlık : curl -fsS http://${config.host}/health (nginx üzerinden)`);
  console.log("");
  console.log(`${colors.dim}Geri alma: docs/DEPLOY_PLUS.md § Geri alma${colors.reset}`);
}

async function main() {
  console.log(`${colors.bold}Wallet deploy (+)${colors.reset}`);
  console.log("");

  const config = loadConfig();
  preflight(config);

  const warnings = checkGitStatus(config);
  await confirmDeploy(warnings);

  if (config.deployMethod === "git") {
    gitPush(config);
  } else {
    rsyncToServer(config);
  }

  remoteDeploy(config);
  printSummary(config);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
