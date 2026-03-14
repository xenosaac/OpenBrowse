import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const MINIMUM_NODE_MAJOR = 22;

function log(line = "") {
  process.stdout.write(`${line}\n`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
}

function getNodeInfo() {
  const version = process.versions.node;
  const major = Number(version.split(".")[0] ?? "0");
  return { version, major };
}

function brewNode22Path() {
  return "/opt/homebrew/opt/node@22/bin";
}

function checkNodeVersion() {
  const node = getNodeInfo();
  const ok = node.major >= MINIMUM_NODE_MAJOR;
  return {
    ok,
    detail: ok
      ? `Node ${node.version} meets the minimum requirement (>=${MINIMUM_NODE_MAJOR}).`
      : `Node ${node.version} is below the minimum required version (>=${MINIMUM_NODE_MAJOR}).`
  };
}

function resolvePackageJson(specifier) {
  try {
    return require.resolve(`${specifier}/package.json`, {
      paths: [path.join(ROOT, "apps", "desktop"), ROOT]
    });
  } catch {
    return null;
  }
}

function pnpmSpecifierPath(specifier) {
  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return path.join(scope, name);
  }
  return specifier;
}

function findPnpmPackageDir(specifier) {
  const storeDir = path.join(ROOT, "node_modules", ".pnpm");
  if (!existsSync(storeDir)) {
    return null;
  }

  const normalizedPrefix = specifier.replace("/", "+");
  const match = readdirSync(storeDir).find((entry) => entry.startsWith(`${normalizedPrefix}@`));
  if (!match) {
    return null;
  }

  return path.join(storeDir, match, "node_modules", pnpmSpecifierPath(specifier));
}

function verifyPackageEntry(specifier, relativeEntry, options = {}) {
  const pkgPath = resolvePackageJson(specifier);
  const packageDir = pkgPath
    ? path.dirname(pkgPath)
    : (options.allowPnpmStoreLookup ? findPnpmPackageDir(specifier) : null);

  if (!packageDir) {
    return { ok: false, detail: `${specifier} is not resolvable from the workspace.` };
  }

  const target = path.join(packageDir, relativeEntry);
  if (!existsSync(target)) {
    return { ok: false, detail: `${specifier} is installed, but required path is missing: ${relativeEntry}` };
  }

  return { ok: true, detail: `${specifier} entry is present.` };
}

// NODE_MODULE_VERSION for each Electron major version (Electron's embedded Node.js ABI).
// Update this table when upgrading Electron.
// Source: https://releases.electronjs.org/releases/stable
const ELECTRON_NMV = {
  35: 137,
  36: 138,
  37: 139,
  38: 140,
  39: 140,
  40: 142
};

function getInstalledElectronVersion() {
  const electronPkg = path.join(ROOT, "apps", "desktop", "node_modules", "electron", "package.json");
  if (!existsSync(electronPkg)) return null;
  try {
    const pkg = JSON.parse(readFileSync(electronPkg, "utf8"));
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function checkSqliteAbi() {
  const electronVersion = getInstalledElectronVersion();
  if (!electronVersion) {
    return { ok: false, detail: "better-sqlite3 ABI: Electron not installed yet — run pnpm install first." };
  }

  const electronMajor = Number(electronVersion.split(".")[0] ?? "0");
  const electronNMV = ELECTRON_NMV[electronMajor];
  const nodeNMV = Number(process.versions.modules);

  if (electronNMV == null) {
    return {
      ok: false,
      detail: `better-sqlite3 ABI: Electron ${electronVersion} NMV unknown — update ELECTRON_NMV table in openbrowse-env.mjs.`
    };
  }

  // Check that the native binary exists in the pnpm store.
  const nativeBinDir = findPnpmPackageDir("better-sqlite3");
  const nativeBinPath = nativeBinDir ? path.join(nativeBinDir, "build", "Release", "better_sqlite3.node") : null;
  if (!nativeBinPath || !existsSync(nativeBinPath)) {
    return { ok: false, detail: "better-sqlite3 ABI: native binary not found — run pnpm install." };
  }

  // electron-rebuild writes a .forge-meta file with the compiled arch--NMV.
  // If present, use it to confirm the binary was built for the correct Electron NMV.
  const forgeMetaPath = path.join(path.dirname(nativeBinPath), ".forge-meta");
  if (existsSync(forgeMetaPath)) {
    const forgeMeta = readFileSync(forgeMetaPath, "utf8").trim();
    // Format: "<arch>--<NMV>"
    const parts = forgeMeta.split("--");
    const compiledNMV = parts.length === 2 ? Number(parts[1]) : NaN;
    if (!isNaN(compiledNMV)) {
      if (compiledNMV === electronNMV) {
        return {
          ok: true,
          detail: `better-sqlite3 ABI OK: rebuilt for Electron ${electronVersion} NMV ${electronNMV} (${forgeMeta}).`
        };
      }
      return {
        ok: false,
        detail: `better-sqlite3 ABI mismatch: built for NMV ${compiledNMV} but Electron ${electronVersion} needs NMV ${electronNMV}. Run: pnpm run native:rebuild`
      };
    }
  }

  // No forge-meta: pnpm compiled the binary for system Node.js. Warn if NMVs differ.
  if (nodeNMV !== electronNMV) {
    return {
      ok: false,
      detail: `better-sqlite3 not rebuilt for Electron: Node.js NMV ${nodeNMV} ≠ Electron ${electronVersion} NMV ${electronNMV}. Run: pnpm run native:rebuild`
    };
  }

  return {
    ok: true,
    detail: `better-sqlite3 ABI: Node.js NMV ${nodeNMV} matches Electron ${electronVersion} NMV ${electronNMV}.`
  };
}

function checkInstallTree() {
  const checks = [
    { label: "electron", ...verifyPackageEntry("electron", "install.js") },
    { label: "@electron/get", ...verifyPackageEntry("@electron/get", "dist/cjs/index.js", { allowPnpmStoreLookup: true }) },
    { label: "got", ...verifyPackageEntry("got", "dist/source/index.js", { allowPnpmStoreLookup: true }) },
    { label: "semver", ...verifyPackageEntry("semver", "package.json", { allowPnpmStoreLookup: true }) },
    { label: "rollup", ...verifyPackageEntry("rollup", "dist/bin/rollup", { allowPnpmStoreLookup: true }) }
  ];

  const ok = checks.every((check) => check.ok);
  return { ok, checks };
}

function workspaceNodeModuleDirs() {
  const dirs = [
    path.join(ROOT, "node_modules"),
    path.join(ROOT, "apps", "desktop", "node_modules")
  ];

  for (const scope of ["packages", "apps"]) {
    const scopeDir = path.join(ROOT, scope);
    if (!existsSync(scopeDir)) {
      continue;
    }
    for (const entry of readdirSync(scopeDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      dirs.push(path.join(scopeDir, entry.name, "node_modules"));
    }
  }

  return [...new Set(dirs)];
}

function removeNodeModules() {
  for (const dir of workspaceNodeModuleDirs()) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      PATH: `${brewNode22Path()}:${process.env.PATH ?? ""}`,
      ...extraEnv
    }
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function printDoctor({ strict = false } = {}) {
  const node = checkNodeVersion();
  const installTree = checkInstallTree();
  const sqliteAbi = checkSqliteAbi();

  log("OpenBrowse Environment Doctor");
  log(`- Node: ${node.detail}`);
  for (const check of installTree.checks) {
    log(`- ${check.label}: ${check.detail}`);
  }
  log(`- SQLite ABI: ${sqliteAbi.detail}`);

  const ok = node.ok && installTree.ok && sqliteAbi.ok;
  if (!ok) {
    log("");
    log("Recommended fix:");
    if (!sqliteAbi.ok && (node.ok && installTree.ok)) {
      log("  pnpm run native:rebuild");
    } else {
      log("  pnpm run repair:env");
    }
  }

  if (strict && !ok) {
    process.exit(1);
  }
}

function repairEnvironment() {
  const node = checkNodeVersion();
  if (!node.ok) {
    fail(node.detail);
    fail(`OpenBrowse requires Node >=${MINIMUM_NODE_MAJOR}. Install Node 22 or later.`);
    process.exit(1);
  }

  log("Cleaning workspace node_modules...");
  removeNodeModules();

  log("Reinstalling dependencies...");
  run("pnpm", ["install", "--force"]);

  log("Rebuilding native Electron modules...");
  run("pnpm", ["run", "native:rebuild"]);

  log("");
  log("Environment repair complete.");
}

const args = new Set(process.argv.slice(2));

if (args.has("--warn-node")) {
  const node = checkNodeVersion();
  if (!node.ok) {
    fail(`[openbrowse] Warning: ${node.detail}`);
    fail(`[openbrowse] OpenBrowse requires Node >=${MINIMUM_NODE_MAJOR}. Install a supported Node version.`);
  }
  process.exit(0);
}

if (args.has("--check-node")) {
  const node = checkNodeVersion();
  if (!node.ok) {
    fail(node.detail);
    fail(`OpenBrowse requires Node >=${MINIMUM_NODE_MAJOR}. Install a supported Node version.`);
    process.exit(1);
  }
  process.exit(0);
}

if (args.has("--doctor")) {
  printDoctor({ strict: args.has("--strict") });
  process.exit(0);
}

if (args.has("--repair")) {
  repairEnvironment();
  process.exit(0);
}

log("Usage:");
log("  node scripts/openbrowse-env.mjs --warn-node      (warn if Node < 22, always exits 0)");
log("  node scripts/openbrowse-env.mjs --check-node     (exit 1 if Node < 22)");
log("  node scripts/openbrowse-env.mjs --doctor [--strict]  (checks Node, install tree, and SQLite ABI)");
log("  node scripts/openbrowse-env.mjs --repair         (clean install + native:rebuild)");
