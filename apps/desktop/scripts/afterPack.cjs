// afterPack hook for electron-builder
// Strips macOS extended attributes that prevent codesigning.
// The build output is directed to /tmp to avoid iCloud File Provider
// re-adding xattrs in ~/Desktop or ~/Documents trees.

const { execSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(context) {
  if (process.platform !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  console.log(`  • stripping extended attributes  appPath=${appPath}`);
  execSync(`xattr -cr "${appPath}"`, { stdio: "inherit" });
};
