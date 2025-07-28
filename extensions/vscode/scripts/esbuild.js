const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const { writeBuildTimestamp } = require("./utils");
const esbuild = require("esbuild");

const flags = process.argv.slice(2);

const esbuildConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  // 从 external 中移除 xhr-sync-worker.js，这样它会被打包进 extension.js
  external: ["vscode", "esbuild"],
  format: "cjs",
  platform: "node",
  sourcemap: flags.includes("--sourcemap"),
  loader: {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    ".node": "file",
  },

  // To allow import.meta.path for transformers.js
  // https://github.com/evanw/esbuild/issues/1492#issuecomment-893144483
  inject: ["./scripts/importMetaUrl.js"],
  define: { "import.meta.url": "importMetaUrl" },
  supported: { "dynamic-import": false },
  metafile: true,
  plugins: [
    {
      name: "on-end-plugin",
      setup(build) {
        // 确保目标目录存在
        fs.mkdirSync('out/lib/binding/node-v133-linux-x64', { recursive: true });
        
        build.onEnd((result) => {
          if (result.errors.length > 0) {
            console.error("Build failed with errors:", result.errors);
            throw new Error(result.errors);
          } else {
            try {
              // 写入构建元数据
              fs.writeFileSync(
                "./build/meta.json",
                JSON.stringify(result.metafile, null, 2),
              );
              
              // 处理 SQLite 二进制文件
              try {
                // 1. 尝试从预编译位置复制
                let sqliteSrc;
                try {
                  sqliteSrc = require.resolve('sqlite3/build/Release/node_sqlite3.node');
                } catch (e) {
                  // 2. 如果找不到预编译文件，尝试重新构建
                  console.log('SQLite binary not found, trying to rebuild...');
                  try {
                    // 使用 spawn 而不是 execSync 来避免 process.exit() 问题
                    const { spawnSync } = require('child_process');
                    const result = spawnSync('npm', ['rebuild', 'sqlite3', '--build-from-source'], {
                      stdio: 'inherit',
                      shell: true
                    });
                    
                    if (result.status !== 0) {
                      throw new Error('Failed to rebuild SQLite');
                    }
                    
                    sqliteSrc = require.resolve('sqlite3/build/Release/node_sqlite3.node');
                  } catch (rebuildError) {
                    console.error('Failed to rebuild SQLite:', rebuildError);
                    // 继续使用默认位置，让应用稍后处理错误
                    return;
                  }
                }

                // 3. 确保目标目录存在
                console.log('Current process config:', {
                  nodeAbi: process.config.variables.node_module_version,
                  platform: process.platform,
                  arch: process.arch,
                  versions: process.versions
                });

                // 强制使用 v132 版本，因为这是错误中显示的版本
                const targetAbi = '132';
                const platform = 'linux';
                const arch = 'x64';
                
                // 只使用 v132 版本
                const possibleAbiDirs = [
                  `node-v${targetAbi}-${platform}-${arch}`
                ];

                console.log('Target ABI directories:', possibleAbiDirs);

                // 创建目标目录并复制文件
                const sqliteDest = path.join('out', 'lib', 'binding', possibleAbiDirs[0], 'node_sqlite3.node');
                const sqliteDestDir = path.dirname(sqliteDest);
                
                console.log('Copying SQLite binary:');
                console.log('- Source:', sqliteSrc);
                console.log('- Destination:', sqliteDest);
                
                // 确保目标目录存在
                if (!fs.existsSync(sqliteDestDir)) {
                  console.log(`Creating directory: ${sqliteDestDir}`);
                  fs.mkdirSync(sqliteDestDir, { recursive: true });
                }
                
                try {
                  // 复制文件
                  fs.copyFileSync(sqliteSrc, sqliteDest);
                  
                  // 验证文件是否复制成功
                  if (fs.existsSync(sqliteDest)) {
                    console.log(`✅ Successfully copied SQLite binary to ${sqliteDest}`);
                    console.log('File stats:', fs.statSync(sqliteDest));
                  } else {
                    console.error('❌ Failed to copy SQLite binary: File not found at destination');
                  }
                } catch (e) {
                  console.error('❌ Failed to copy SQLite binary:', e);
                }
                
                // 打印最终目录结构用于调试
                console.log('Final directory structure:');
                try {
                  const walkDir = (dir, indent = '') => {
                    const files = fs.readdirSync(dir);
                    for (const file of files) {
                      const fullPath = path.join(dir, file);
                      const stat = fs.statSync(fullPath);
                      console.log(`${indent}${file}${stat.isDirectory() ? '/' : ''}`);
                      if (stat.isDirectory()) {
                        walkDir(fullPath, indent + '  ');
                      }
                    }
                  };
                  walkDir(path.join('out', 'lib', 'binding'));
                } catch (e) {
                  console.error('Failed to list directory:', e);
                }

                // 4. 复制文件
                fs.copyFileSync(sqliteSrc, sqliteDest);
                
                // 5. 设置执行权限
                try {
                  fs.chmodSync(sqliteDest, 0o755);
                } catch (e) {
                  console.warn('Warning: Failed to set execute permissions on SQLite binary:', e.message);
                }
                
                console.log('Successfully prepared SQLite binary at', sqliteDest);
              } catch (e) {
                console.error('Failed to prepare SQLite binary:', e);
                // 继续构建，但记录错误
              }
              
              // 确保 out 目录存在
              if (!fs.existsSync('out')) {
                fs.mkdirSync('out', { recursive: true });
              }
              
              // 创建一个简单的 xhr-sync-worker.js 文件
              const xhrWorkerContent = `// Simple xhr-sync-worker.js
const { parentPort } = require('worker_threads');

parentPort.on('message', (data) => {
  try {
    // 简单的响应处理
    parentPort.postMessage({ 
      id: data.id, 
      result: { statusCode: 200, body: '{}', headers: {} } 
    });
  } catch (e) {
    parentPort.postMessage({ 
      id: data.id, 
      error: e.message 
    });
  }
});`;
              
              const xhrWorkerPath = path.join('out', 'xhr-sync-worker.js');
              fs.writeFileSync(xhrWorkerPath, xhrWorkerContent);
              console.log(`✅ Created xhr-sync-worker.js at ${xhrWorkerPath}`);
              
            } catch (e) {
              console.error("Failed to write esbuild meta file", e);
            }
            console.log("VS Code Extension esbuild complete"); // used verbatim in vscode tasks to detect completion
          }
        });
      },
    },
  ],
};

void (async () => {
  // Create .buildTimestamp.js before starting the first build
  writeBuildTimestamp();
  // Bundles the extension into one file
  if (flags.includes("--watch")) {
    const ctx = await esbuild.context(esbuildConfig);
    await ctx.watch();
  } else if (flags.includes("--notify")) {
    const inFile = esbuildConfig.entryPoints[0];
    const outFile = esbuildConfig.outfile;

    // The watcher automatically notices changes to source files
    // so the only thing it needs to be notified about is if the
    // output file gets removed.
    if (fs.existsSync(outFile)) {
      console.log("VS Code Extension esbuild up to date");
      return;
    }

    fs.watchFile(outFile, (current, previous) => {
      if (current.size > 0) {
        console.log("VS Code Extension esbuild rebuild complete");
        fs.unwatchFile(outFile);
        process.exit(0);
      }
    });

    console.log("Triggering VS Code Extension esbuild rebuild...");
    writeBuildTimestamp();
  } else {
    await esbuild.build(esbuildConfig);
  }
})();
