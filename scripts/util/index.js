const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function execCmdSync(cmd) {
  try {
    execSync(cmd);
  } catch (err) {
    console.error(`Error executing command '${cmd}': `, err.output.toString());
    process.exit(1);
  }
}

function autodetectPlatformAndArch() {
  // Only support x64 architecture
  const arch = "x64";
  
  // Detect platform
  let platform;
  switch (process.platform) {
    case 'darwin':
      platform = 'darwin';
      break;
    case 'win32':
      platform = 'win32';
      break;
    case 'linux':
    case 'aix':
    case 'android':
    case 'freebsd':
    case 'openbsd':
    case 'sunos':
    default:
      platform = 'linux';
  }
  
  console.log(`[info] Detected platform: ${platform}-${arch}`);
  return [platform, arch];
}

async function downloadRipgrepBinary(targetPath) {
  const os = require("os");
  const fs = require("fs");
  const path = require("path");
  const https = require("https");
  const { promisify } = require("util");
  const pipeline = promisify(require("stream").pipeline);
  const extract = require("tar").extract;
  const zlib = require("zlib");
  const unzipper = require("unzipper");

  const version = "13.0.0";
  let downloadUrl;
  
  if (os.platform() === 'win32') {
    // Direct URL to the Windows .zip file
    downloadUrl = `https://github.com/BurntSushi/ripgrep/releases/download/${version}/ripgrep-${version}-x86_64-pc-windows-msvc.zip`;
  } else {
    const platform = os.platform() === 'darwin' ? 'x86_64-apple-darwin' : 'x86_64-unknown-linux-musl';
    downloadUrl = `https://github.com/BurntSushi/ripgrep/releases/download/${version}/ripgrep-${version}-${platform}.tar.gz`;
  }
  
  const extension = os.platform() === 'win32' ? 'zip' : 'tar.gz';
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ripgrep-"));
  const downloadPath = path.join(tempDir, `ripgrep.${extension}`);

  try {
    console.log(`[info] Downloading ripgrep from ${downloadUrl}`);

    // Set proxy from environment variables
    const proxy = process.env.HTTP_PROXY || process.env.http_proxy || 'http://127.0.0.1:7890';
    console.log(`[info] Using proxy: ${proxy}`);
    
    // Use axios for better proxy and redirect handling
    const axios = require('axios');
    const { HttpsProxyAgent } = require('https-proxy-agent');
    
    const httpsAgent = new HttpsProxyAgent(proxy);
    
    // Download the file with axios which handles redirects automatically
    const response = await axios({
      method: 'GET',
      url: downloadUrl,
      responseType: 'stream',
      httpsAgent: httpsAgent,
      maxRedirects: 5,
      timeout: 60000
    });
    
    if (response.status !== 200) {
      throw new Error(`Failed to download ripgrep: HTTP ${response.status}`);
    }
    
    // Save the file
    const writer = fs.createWriteStream(downloadPath);
    response.data.pipe(writer);
    
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    console.log(`[info] Successfully downloaded ripgrep to ${downloadPath}`);

    // Extract the archive
    console.log(`[info] Extracting ripgrep to ${tempDir}`);
    
    if (os.platform() === "win32") {
      // For Windows .zip files
      await new Promise((resolve, reject) => {
        fs.createReadStream(downloadPath)
          .pipe(unzipper.Extract({ path: tempDir }))
          .on("close", () => {
            // After extraction, the binary is in a subdirectory like 'ripgrep-13.0.0-x86_64-pc-windows-msvc'
            const extractedDirs = fs.readdirSync(tempDir).filter(f => 
              fs.statSync(path.join(tempDir, f)).isDirectory()
            );
            
            if (extractedDirs.length > 0) {
              // Move all files from the subdirectory to tempDir
              const sourceDir = path.join(tempDir, extractedDirs[0]);
              const files = fs.readdirSync(sourceDir);
              files.forEach(file => {
                const srcPath = path.join(sourceDir, file);
                const destPath = path.join(tempDir, file);
                fs.renameSync(srcPath, destPath);
              });
              // Remove the now-empty directory
              fs.rmdirSync(sourceDir);
            }
            resolve();
          })
          .on("error", reject);
      });
    } else {
      // Use tar for non-Windows .tar.gz files
      await new Promise((resolve, reject) => {
        fs.createReadStream(downloadPath)
          .pipe(zlib.createGunzip())
          .pipe(
            extract({
              cwd: tempDir,
              strip: 1,
            })
          )
          .on("error", reject)
          .on("finish", resolve);
      });
    }
    
    // The binary is in the extracted directory
    const binaryName = os.platform() === "win32" ? "rg.exe" : "rg";
    let sourcePath = path.join(tempDir, binaryName);

    // If binary not found in root, search in subdirectories
    if (!fs.existsSync(sourcePath)) {
      const findBinary = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        // First check files in current directory
        for (const entry of entries) {
          if (!entry.isDirectory() && entry.name.toLowerCase() === binaryName.toLowerCase()) {
            return path.join(dir, entry.name);
          }
        }
        
        // Then check subdirectories
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const found = findBinary(path.join(dir, entry.name));
            if (found) return found;
          }
        }
        return null;
      };
      
      const foundPath = findBinary(tempDir);
      if (foundPath) {
        sourcePath = foundPath;
      } else {
        throw new Error(`Could not find ${binaryName} in extracted files`);
      }
    }
    
    // Ensure target directory exists
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Copy the binary to the target location
    fs.copyFileSync(sourcePath, targetPath);
    
    // Make executable on Unix-like systems
    if (os.platform() !== "win32") {
      fs.chmodSync(targetPath, 0o755);
    }
    
    console.log(`[info] Successfully installed ripgrep to ${targetPath}`);
    return true;
    
  } catch (error) {
    console.error('[error] Failed to download or extract ripgrep:', error.message);
    return false;
  } finally {
    // Clean up temporary directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`[warn] Failed to clean up temp directory: ${e.message}`);
    }
  }
}

async function resolveRipgrepPath(filePath) {
  // If this is a ripgrep binary path
  if (filePath.includes("@vscode/ripgrep/bin/rg")) {
    // First try to find it in the root node_modules
    const rootPath = path.join(
      process.cwd(),
      "node_modules",
      "@vscode",
      "ripgrep",
      "bin",
      path.basename(filePath),
    );
    if (fs.existsSync(rootPath)) {
      console.log(`[info] Using ripgrep from root node_modules: ${rootPath}`);
      // Ensure the target directory exists
      const targetDir = path.dirname(filePath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      // Copy to the target location
      fs.copyFileSync(rootPath, filePath);
      return true;
    }

    // If not found in root node_modules, try to download it
    console.log(
      `[info] Ripgrep not found in root node_modules, attempting to download...`,
    );
    try {
      const success = await downloadRipgrepBinary(filePath);
      if (success) {
        return true;
      }
    } catch (error) {
      console.error("[error] Failed to resolve ripgrep path:", error);
    }
  }
  return false;
}

async function validateFilesPresent(pathsToVerify) {
  // This script verifies after packaging that necessary files are in the correct locations
  // In many cases just taking a sample file from the folder when they are all roughly the same thing

  const missingFiles = [];
  const emptyFiles = [];

  for (const filePath of pathsToVerify) {
    // First try to resolve ripgrep from root node_modules if applicable
    if (filePath.includes("@vscode/ripgrep/bin/rg")) {
      if (await resolveRipgrepPath(filePath)) {
        // If we successfully resolved ripgrep, skip further checks for this file
        continue;
      }
    }

    if (!fs.existsSync(filePath)) {
      const parentFolder = path.dirname(filePath);
      const grandparentFolder = path.dirname(parentFolder);
      const grandGrandparentFolder = path.dirname(grandparentFolder);

      console.error(`File ${filePath} does not exist`);

      // Log directory structure for debugging
      if (!fs.existsSync(parentFolder)) {
        console.error(`Parent folder ${parentFolder} does not exist`);
      } else {
        console.error(
          "Contents of parent folder:",
          fs.readdirSync(parentFolder),
        );
      }

      if (!fs.existsSync(grandparentFolder)) {
        console.error(`Grandparent folder ${grandparentFolder} does not exist`);
        if (!fs.existsSync(grandGrandparentFolder)) {
          console.error(
            `Grandgrandparent folder ${grandGrandparentFolder} does not exist`,
          );
        } else {
          console.error(
            "Contents of grandgrandparent folder:",
            fs.readdirSync(grandGrandparentFolder),
          );
        }
      } else {
        console.error(
          "Contents of grandparent folder:",
          fs.readdirSync(grandparentFolder),
        );
      }

      missingFiles.push(filePath);
      continue;
    }

    // Check if file is empty
    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      console.error(`File ${filePath} is empty`);
      emptyFiles.push(filePath);
    }
  }

  if (missingFiles.length > 0 || emptyFiles.length > 0) {
    throw new Error(
      `The following files were missing:\n- ${missingFiles.join(
        "\n- ",
      )}\n\nThe following files were empty:\n- ${emptyFiles.join("\n- ")}`,
    );
  } else {
    console.log("All paths exist");
  }
}

module.exports = {
  execCmdSync,
  validateFilesPresent,
  autodetectPlatformAndArch,
};
