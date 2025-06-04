import * as path from "path";
import { spawn, ChildProcessWithoutNullStreams } from "child_process";

import { getContinueRcPath, getTsConfigPath } from "core/util/paths";
import { Telemetry } from "core/util/posthog";
import * as vscode from "vscode";

import { VsCodeExtension } from "../extension/VsCodeExtension";
import registerQuickFixProvider from "../lang-server/codeActions";
import { getExtensionVersion } from "../util/util";

import { VsCodeContinueApi } from "./api";
import setupInlineTips from "./InlineTipManager";

let graphragProcess: ChildProcessWithoutNullStreams | undefined;

export async function activateExtension(context: vscode.ExtensionContext) {
  // Add necessary files
  getTsConfigPath();
  getContinueRcPath();

  // Register commands and providers
  registerQuickFixProvider();
  setupInlineTips(context);

  const vscodeExtension = new VsCodeExtension(context);

  // Load Continue configuration
  if (!context.globalState.get("hasBeenInstalled")) {
    context.globalState.update("hasBeenInstalled", true);
    Telemetry.capture(
      "install",
      {
        extensionVersion: getExtensionVersion(),
      },
      true,
    );
  }

  // Register config.yaml schema by removing old entries and adding new one (uri.fsPath changes with each version)
  const yamlMatcher = ".continue/**/*.yaml";
  const yamlConfig = vscode.workspace.getConfiguration("yaml");

  const existingSchemas = yamlConfig.get("schemas") || {};
  const newSchemas = Object.entries(existingSchemas).filter(
    ([_, value]) => Array.isArray(value) && value.includes(yamlMatcher), // remove old ones
  );

  const newPath = path.join(
    context.extension.extensionUri.fsPath,
    "config-yaml-schema.json",
  );
  newSchemas.push([newPath, [yamlMatcher]]);

  try {
    await yamlConfig.update(
      "schemas",
      Object.fromEntries(newSchemas),
      vscode.ConfigurationTarget.Global,
    );
  } catch (error) {
    console.error(
      "Failed to register Continue config.yaml schema, most likely, YAML extension is not installed",
      error,
    );
  }

  const api = new VsCodeContinueApi(vscodeExtension);
  const continuePublicApi = {
    registerCustomContextProvider: api.registerCustomContextProvider.bind(api),
  };

  // === 自动启动 graphrag 服务 ===
  const pythonExe = "python"; // 或 "python3"，可根据实际环境调整
  const uvicornExe = "uvicorn";
  const scriptPath = path.join(context.extensionPath, "scripts", "graphrag_server.py");
  const uvicornArgs = [
    `${scriptPath.replace(/\\/g, "/")}:app`,
    "--host", "127.0.0.1",
    "--port", "8000"
  ];
  graphragProcess = spawn(uvicornExe, uvicornArgs, {
    cwd: context.extensionPath,
    shell: true,
    env: process.env,
  });
  graphragProcess.stdout.on("data", (data) => {
    console.log(`[graphrag] ${data}`);
  });
  graphragProcess.stderr.on("data", (data) => {
    console.error(`[graphrag] ${data}`);
  });
  context.subscriptions.push({
    dispose: () => {
      if (graphragProcess) {
        graphragProcess.kill();
      }
    }
  });

  // 'export' public api-surface
  // or entire extension for testing
  return process.env.NODE_ENV === "test"
    ? {
        ...continuePublicApi,
        extension: vscodeExtension,
      }
    : continuePublicApi;
}

export function deactivate() {
  if (graphragProcess) {
    graphragProcess.kill();
  }
}
