// Modified build script to only build for current platform (linux-x64)
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");
const ncp = require("ncp").ncp;
const { rimrafSync } = require("rimraf");
const {
  validateFilesPresent,
  execCmdSync,
  autodetectPlatformAndArch,
} = require("../scripts/util");
const { downloadRipgrep } = require("./utils/ripgrep");
const { TARGET_TO_LANCEDB } = require("./utils/targets");

const bin = path.join(__dirname, "bin");
const out = path.join(__dirname, "out");
const build = path.join(__dirname, "build");

function cleanSlate() {
  // Clean slate
  rimrafSync(bin);
  rimrafSync(out);
  rimrafSync(build);
  rimrafSync(path.join(__dirname, "tmp"));
  fs.mkdirSync(bin);
  fs.mkdirSync(out);
  fs.mkdirSync(build);
}

const esbuildOutputFile = "out/index.js";
const [currentPlatform, currentArch] = autodetectPlatformAndArch();
const currentTarget = `${currentPlatform}-${currentArch}`;

// Bundles the extension into one file
async function buildWithEsbuild() {
  console.log("[info] Building with esbuild...");
  
  // Create a temporary tsconfig.json to avoid TypeScript errors
  const tsconfigPath = path.join(__dirname, 'tsconfig.temp.json');
  fs.writeFileSync(
    tsconfigPath,
    JSON.stringify({
      extends: "./tsconfig.json",
      compilerOptions: {
        module: "commonjs",
        target: "es2020",
        moduleResolution: "node",
        esModuleInterop: true,
        skipLibCheck: true,
        resolveJsonModule: true,
        outDir: "./out",
        rootDir: "./src"
      },
      include: ["src/**/*"],
      exclude: ["node_modules", "**/*.test.ts"]
    }, null, 2)
  );

  try {
    await esbuild.build({
      entryPoints: ["src/index.ts"],
      bundle: true,
      outfile: esbuildOutputFile,
      platform: "node",
      format: "cjs",
      external: [
        // LanceDB binaries
        "@lancedb/vectordb-linux-x64-gnu",
        "@lancedb/vectordb-darwin-x64",
        "@lancedb/vectordb-darwin-arm64",
        "@lancedb/vectordb-linux-arm64-gnu",
        "@lancedb/vectordb-win32-x64-msvc",
        
        // Other native modules
        "tree-sitter",
        "onnxruntime-node",
        "@xenova/transformers",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
        "onnxruntime-common",
        "onnxruntime-node",
        "onnxruntime-web",
      ],
      minify: false,
      sourcemap: true,
      target: "node16",
      tsconfig: tsconfigPath,
      define: {
        "process.env.NODE_ENV": '"production"',
      },
      loader: {
        '.node': 'copy',
      },
      plugins: [
        {
          name: 'onnxruntime-node',
          setup(build) {
            build.onResolve({ filter: /onnxruntime_binding\.node$/ }, args => ({
              path: args.path,
              external: true,
            }));
          },
        },
      ],
      logLevel: 'info',
    });
  } finally {
    // Clean up temporary tsconfig
    try {
      fs.unlinkSync(tsconfigPath);
    } catch (e) {
      console.warn('Failed to clean up temporary tsconfig:', e);
    }
  }
}

// Downloads and installs ripgrep binaries for the current platform
async function downloadRipgrepForCurrentPlatform() {
  const targetDir = path.join(bin, currentTarget);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  
  // Check if ripgrep is already downloaded
  const ripgrepBinPath = path.join(targetDir, 'rg');
  if (fs.existsSync(ripgrepBinPath)) {
    console.log(`[info] ripgrep already exists at ${ripgrepBinPath}`);
    return;
  }
  
  console.log(`[info] Downloading ripgrep for ${currentTarget}...`);
  
  // Set proxy environment variables
  const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy || 'http://127.0.0.1:7890';
  const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy || 'http://127.0.0.1:7890';
  
  // Create a copy of the current env and add proxy settings
  const env = {
    ...process.env,
    HTTPS_PROXY: httpsProxy,
    HTTP_PROXY: httpProxy,
    https_proxy: httpsProxy,
    http_proxy: httpProxy,
  };
  
  try {
    // Try to download ripgrep with the updated environment
    const { execFileSync } = require('child_process');
    
    // First try to use wget with proxy
    try {
      console.log('[info] Trying to download ripgrep using wget...');
      const url = 'https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz';
      const tempFile = path.join(targetDir, 'ripgrep.tar.gz');
      
      execFileSync('wget', [
        '--no-check-certificate',
        '-O', tempFile,
        url
      ], { env, stdio: 'inherit' });
      
      // Extract the downloaded file
      execFileSync('tar', [
        'xzf', tempFile,
        '--strip-components=1',
        '-C', targetDir,
        'ripgrep-14.1.1-x86_64-unknown-linux-musl/rg'
      ], { stdio: 'inherit' });
      
      // Make the binary executable
      fs.chmodSync(ripgrepBinPath, 0o755);
      
      // Clean up
      fs.unlinkSync(tempFile);
      
      console.log(`[info] Successfully downloaded and extracted ripgrep to ${ripgrepBinPath}`);
      return;
    } catch (wgetError) {
      console.warn('[warn] Failed to download using wget, trying with node-fetch...', wgetError.message);
    }
    
    // If wget fails, try with node-fetch
    try {
      const fetch = (await import('node-fetch')).default;
      const url = 'https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz';
      const response = await fetch(url, { 
        agent: new (require('https-proxy-agent'))(httpsProxy) 
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const tempFile = path.join(targetDir, 'ripgrep.tar.gz');
      const fileStream = fs.createWriteStream(tempFile);
      
      await new Promise((resolve, reject) => {
        response.body.pipe(fileStream);
        response.body.on('error', reject);
        fileStream.on('finish', resolve);
      });
      
      // Extract the downloaded file
      execFileSync('tar', [
        'xzf', tempFile,
        '--strip-components=1',
        '-C', targetDir,
        'ripgrep-14.1.1-x86_64-unknown-linux-musl/rg'
      ], { stdio: 'inherit' });
      
      // Make the binary executable
      fs.chmodSync(ripgrepBinPath, 0o755);
      
      // Clean up
      fs.unlinkSync(tempFile);
      
      console.log(`[info] Successfully downloaded and extracted ripgrep to ${ripgrepBinPath}`);
    } catch (fetchError) {
      console.error(`[error] Failed to download ripgrep for ${currentTarget}:`, fetchError);
      console.log('[info] You can manually download ripgrep from:');
      console.log('       https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz');
      console.log(`[info] Then extract the 'rg' binary to: ${ripgrepBinPath}`);
      console.log('[info] And make it executable with: chmod +x ' + ripgrepBinPath);
      throw fetchError;
    }
  } catch (error) {
    console.error(`[error] Failed to download ripgrep for ${currentTarget}:`, error);
    throw error;
  }
}

// Main build function
async function main() {
  console.log(`[info] Building for ${currentTarget} only`);
  
  cleanSlate();
  
  // Build with esbuild
  await buildWithEsbuild();
  
  // Copy LanceDB binary for current platform
  const lancedbPackage = TARGET_TO_LANCEDB[currentTarget];
  if (lancedbPackage) {
    console.log(`[info] Copying ${lancedbPackage} to bin`);
    const sourceDir = path.dirname(require.resolve(`${lancedbPackage}/package.json`));
    const targetDir = path.join(bin, currentTarget);
    
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    fs.cpSync(sourceDir, targetDir, { recursive: true });
  }
  
  // Download ripgrep for current platform
  await downloadRipgrepForCurrentPlatform();
  
  console.log("[info] Build completed successfully!");
}

// Run the build
main().catch((error) => {
  console.error("[error] Build failed:", error);
  process.exit(1);
});
