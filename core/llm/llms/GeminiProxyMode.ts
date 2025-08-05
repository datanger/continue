/* eslint-disable max-depth */
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { CompletionOptions } from "../../../packages/config-types/src";
import type { ChatMessage } from "../../index.js";
import { BaseLLM } from "../index.js";

/**
 * GeminiProxyMode: 一个极简的 LLM 模式，将所有输入直接转发到本地 gemini-proxy，
 * 由 gemini-cli 负责多轮上下文和问答，continue 只做 VSCode <-> gemini-cli 的桥梁。
 */
export class GeminiProxyMode extends BaseLLM {
  static providerName = "gemini-proxy";
  static displayName = "Gemini-CLI";

  // 默认本地代理地址，可通过 options 配置覆盖
  proxyUrl: string;
  streamUrl: string;
  private static appProcess: any = null;
  private static isStarting = false;
  private static serviceReady = false; // 新增：服务就绪状态
  private static readonly rootDir: string = GeminiProxyMode.getWorkspaceRoot();

  private static getWorkspaceRoot(): string {
    // Try to detect VS Code workspace root when running inside the extension host.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const vscode = require("vscode");
      if (vscode?.workspace?.workspaceFolders?.length) {
        return vscode.workspace.workspaceFolders[0].uri.fsPath;
      }
    } catch (error) {
      // vscode module not available – fallback to cwd
      console.error("[GeminiProxyMode] Error getting workspace root:", error);
    }

    // Fallback to current working directory
    return process.cwd();
  }

  constructor(options: any = {}) {
    super({ ...options, model: options.model || "gemini-proxy" });
    this.proxyUrl = options.proxyUrl || "http://127.0.0.1:5001/ask";
    this.streamUrl = options.streamUrl || "http://127.0.0.1:5001/ask/stream";
    
    // 在构造函数中自动检测和创建文件，然后启动服务
    void this.ensureFilesAndService();
  }

  /**
   * 确保文件存在，如果不存在则创建
   */
  private async ensureFilesAndService(): Promise<void> {
    try {
      await this.ensureRequiredFiles();
      await this.ensureServiceRunning();
    } catch (error) {
      console.error("[GeminiProxyMode] Error ensuring files and service:", error);
    }
  }

  /**
   * 确保必需的文件存在
   */
  private async ensureRequiredFiles(): Promise<void> {
    const workspaceRoot = GeminiProxyMode.rootDir;
    const continueDir = path.join(workspaceRoot, ".continue");
    const geminiCliDir = path.join(continueDir, "gemini_proxy");
    const appPyPath = path.join(geminiCliDir, "app.py");
    const geminiProcessPath = path.join(geminiCliDir, "gemini_process.py");

    // 检查并创建目录
    if (!fs.existsSync(continueDir)) {
      console.log("[GeminiProxyMode] Creating .continue directory...");
      fs.mkdirSync(continueDir, { recursive: true });
    }

    if (!fs.existsSync(geminiCliDir)) {
      console.log("[GeminiProxyMode] Creating .continue/gemini_proxy directory...");
      fs.mkdirSync(geminiCliDir, { recursive: true });
    }

    // 检查并创建 app.py
    if (!fs.existsSync(appPyPath)) {
      console.log("[GeminiProxyMode] Creating app.py...");
      fs.writeFileSync(appPyPath, this.getAppPyContent());
    }

    // 检查并创建 gemini_process.py
    if (!fs.existsSync(geminiProcessPath)) {
      console.log("[GeminiProxyMode] Creating gemini_process.py...");
      fs.writeFileSync(geminiProcessPath, this.getGeminiProcessContent());
    }
  }

  /**
   * 获取 app.py 的内容
   */
  private getAppPyContent(): string {
    return `#!/usr/bin/env python3
"""
Gemini Proxy Server for Continue
提供 gemini-cli 的 HTTP API 接口
"""

import os
import json
import logging
from flask import Flask, request, jsonify, Response, stream_template
from flask_cors import CORS
from gemini_process import GeminiProcess

# 配置日志 - 写入到 console.log 文件
log_dir = os.path.dirname(os.path.abspath(__file__))
log_file = os.path.join(log_dir, 'console.log')

# 创建日志格式
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')

# 配置文件处理器
file_handler = logging.FileHandler(log_file, encoding='utf-8')
file_handler.setLevel(logging.INFO)
file_handler.setFormatter(formatter)

# 配置控制台处理器
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(formatter)

# 配置根日志器
logging.basicConfig(
    level=logging.INFO,
    handlers=[file_handler, console_handler],
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# 默认配置
DEFAULT_PROVIDER = os.environ.get('GEMINI_PROVIDER', 'deepseek')
DEFAULT_MODEL = os.environ.get('GEMINI_MODEL', 'deepseek-chat')
DEFAULT_API_KEY = os.environ.get('GEMINI_API_KEY', None)

# 环境变量默认值
DEFAULT_OLLAMA_BASE_URL = os.environ.get('OLLAMA_BASE_URL', 'http://127.0.0.1:11434')
DEFAULT_LOCAL_BASE_URL = os.environ.get('LOCAL_BASE_URL', 'http://127.0.0.1:8080')
DEFAULT_DEEPSEEK_API_BASE = os.environ.get('DEEPSEEK_API_BASE', 'https://api.deepseek.com')
DEFAULT_OPENAI_API_BASE = os.environ.get('OPENAI_API_BASE', 'https://api.openai.com')

# 初始化 Gemini 进程
gemini = GeminiProcess(
    provider=DEFAULT_PROVIDER,
    model=DEFAULT_MODEL,
    api_key=DEFAULT_API_KEY
)

@app.route('/ask', methods=['POST'])
def ask():
    """处理单次问答请求"""
    try:
        data = request.get_json()
        prompt = data.get('prompt', '')
        
        if not prompt:
            return jsonify({'error': 'No prompt provided'}), 400
        
        logger.info(f"Received prompt: {prompt[:50]}...")
        
        # 发送 prompt 并获取响应
        response = gemini.send_prompt(prompt)
        
        return jsonify({
            'response': response,
            'provider': gemini.provider,
            'model': gemini.model
        })
        
    except Exception as e:
        logger.error(f"Error processing request: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/ask/stream', methods=['POST'])
def ask_stream():
    """处理流式问答请求"""
    try:
        data = request.get_json()
        prompt = data.get('prompt', '')
        
        if not prompt:
            return jsonify({'error': 'No prompt provided'}), 400
        
        logger.info(f"Received streaming prompt: {prompt[:50]}...")
        
        def generate():
            try:
                # 使用流式发送
                for chunk in gemini.send_prompt_stream(prompt):
                    yield f"data: {json.dumps({'chunk': chunk})}\\n\\n"
                
                # 发送完成信号
                yield f"data: {json.dumps({'done': True})}\\n\\n"
                
            except Exception as e:
                logger.error(f"Error in streaming: {e}")
                yield f"data: {json.dumps({'error': str(e)})}\\n\\n"
        
        return Response(generate(), mimetype='text/plain')
        
    except Exception as e:
        logger.error(f"Error processing streaming request: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/config', methods=['GET'])
def get_config():
    """获取当前配置"""
    return jsonify({
        'provider': gemini.provider,
        'model': gemini.model,
        'environment_variables': {
            'GEMINI_PROVIDER': os.environ.get('GEMINI_PROVIDER', DEFAULT_PROVIDER),
            'GEMINI_MODEL': os.environ.get('GEMINI_MODEL', DEFAULT_MODEL),
            'OLLAMA_BASE_URL': os.environ.get('OLLAMA_BASE_URL', DEFAULT_OLLAMA_BASE_URL),
            'LOCAL_BASE_URL': os.environ.get('LOCAL_BASE_URL', DEFAULT_LOCAL_BASE_URL),
            'DEEPSEEK_API_BASE': os.environ.get('DEEPSEEK_API_BASE', DEFAULT_DEEPSEEK_API_BASE),
            'OPENAI_API_BASE': os.environ.get('OPENAI_API_BASE', DEFAULT_OPENAI_API_BASE)
        }
    })

@app.route('/config', methods=['POST'])
def update_config():
    """更新配置"""
    try:
        data = request.get_json()
        provider = data.get('provider')
        model = data.get('model')
        api_key = data.get('api_key')
        
        # 更新环境变量
        if provider:
            os.environ['GEMINI_PROVIDER'] = provider
        if model:
            os.environ['GEMINI_MODEL'] = model
        if api_key:
            os.environ['GEMINI_API_KEY'] = api_key
        
        # 更新 Gemini 进程配置
        gemini.update_config(provider, model, api_key)
        
        return jsonify({
            'message': 'Configuration updated successfully',
            'provider': gemini.provider,
            'model': gemini.model
        })
        
    except Exception as e:
        logger.error(f"Error updating config: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health_check():
    """健康检查端点"""
    is_alive = gemini.is_process_alive()
    status = "healthy" if is_alive else "unhealthy"
    logger.info(f"Health check: {status}, process_alive: {is_alive}")
    return jsonify({
        'status': status, 
        'process_alive': is_alive,
        'provider': gemini.provider,
        'model': gemini.model,
        'environment_variables': {
            'OLLAMA_BASE_URL': os.environ.get('OLLAMA_BASE_URL', DEFAULT_OLLAMA_BASE_URL),
            'LOCAL_BASE_URL': os.environ.get('LOCAL_BASE_URL', DEFAULT_LOCAL_BASE_URL),
            'DEEPSEEK_API_BASE': os.environ.get('DEEPSEEK_API_BASE', DEFAULT_DEEPSEEK_API_BASE),
            'OPENAI_API_BASE': os.environ.get('OPENAI_API_BASE', DEFAULT_OPENAI_API_BASE)
        }
    }), 200 if is_alive else 503

@app.route('/', methods=['GET'])
def root():
    """根端点"""
    return jsonify({
        'service': 'gemini-proxy',
        'version': '1.4.0',
        'status': 'running',
        'endpoints': {
            'health': '/health',
            'ask': '/ask',
            'ask_stream': '/ask/stream',
            'config': '/config'
        }
    })

if __name__ == '__main__':
    logger.info(f"Starting gemini-proxy server v1.4.0 on port 5001")
    logger.info(f"Default config: provider={DEFAULT_PROVIDER}, model={DEFAULT_MODEL}")
    logger.info("Features: multi-turn conversation, agent functionality, tool calls, streaming, configurable provider")
    logger.info("Supported providers: gemini, openai, ollama, local, deepseek")
    logger.info(f"Log file: {log_file}")

    app.run(host='127.0.0.1', port=5001, debug=False)
`;
  }

  /**
   * 获取 gemini_process.py 的内容
   */
  private getGeminiProcessContent(): string {
    return `#!/usr/bin/env python3
"""
Gemini Process Manager
管理 gemini-cli 进程的启动、通信和生命周期
"""

#!/usr/bin/env python3
"""
Gemini Process Manager
管理 gemini-cli 进程的启动、通信和生命周期
"""

import os
import json
import re
import time
import logging
import subprocess
import threading
import queue
from typing import Generator

# 配置日志 - 写入到 console.log 文件
log_dir = os.path.dirname(os.path.abspath(__file__))
log_file = os.path.join(log_dir, 'console.log')

# 创建日志格式
formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')

# 配置文件处理器
file_handler = logging.FileHandler(log_file, encoding='utf-8')
file_handler.setLevel(logging.INFO)
file_handler.setFormatter(formatter)

# 配置控制台处理器
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(formatter)

# 配置根日志器
logging.basicConfig(
    level=logging.INFO,
    handlers=[file_handler, console_handler],
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

class GeminiProcess:
    def __init__(self, provider: str = "deepseek", model: str = "deepseek-chat", api_key: str = None):
        self.provider = provider
        self.model = model
        self.api_key = api_key
        self.process = None
        self.running = False
        self.output_thread = None
        self.output_queue = queue.Queue()
        
        # 启动进程
        self.start_process()

    def start_process(self):
        """启动 gemini 进程"""
        try:
            # 设置环境变量
            env = os.environ.copy()
            if self.api_key:
                env['GEMINI_API_KEY'] = self.api_key
            
            # 设置 provider 环境变量
            env['GEMINI_PROVIDER'] = self.provider
            
            # 构建命令行参数
            cmd = [
                'gemini',
                '--provider=' + self.provider,
                '--model=' + self.model,
                '-y',
                '--plain'
            ]
            
            logger.info(f"Starting gemini process with provider={self.provider}, model={self.model}")
            
            # 在 Windows 环境下使用 shell=True 来确保能找到命令
            import platform
            use_shell = platform.system() == 'Windows'
            
            # 使用 subprocess.Popen 替代 pexpect
            self.process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                universal_newlines=True,
                env=env,
                shell=use_shell,
                encoding='utf-8',
                errors='replace'
            )
            
            # 启动输出监听线程
            self.running = True
            self.output_thread = threading.Thread(target=self._monitor_output)
            self.output_thread.daemon = True
            self.output_thread.start()
            
            # 等待初始化
            time.sleep(3)
            logger.info(f"Started gemini process in interactive JSON mode with provider={self.provider}, model={self.model}")
            
        except Exception as e:
            logger.error(f"Failed to start gemini process: {e}")
            self.process = None
            raise Exception(f"Failed to start gemini process: {e}")

    def _monitor_output(self):
        """监听进程输出的线程"""
        while self.running and self.process:
            try:
                line = self.process.stdout.readline()
                if not line:
                    break
                    
                if line:
                    # 过滤掉初始化和调试信息
                    if not line.startswith('Data collection is disabled'):
                        self.output_queue.put(line)
                        logger.debug(f"Output: {line}")
            except UnicodeDecodeError as e:
                logger.warning(f"Unicode decode error: {e}")
                continue
            except Exception as e:
                logger.error(f"Output monitoring error: {e}")
                break
        
        logger.info("Output monitoring thread stopped")

    def is_process_alive(self):
        return self.process is not None and self.process.poll() is None

    def send_prompt_stream(self, prompt: str) -> Generator[str, None, None]:
        """流式发送 prompt 并返回生成器（模拟流式输出）"""
        if not self.is_process_alive():
            logger.warning("Gemini process is not alive, restarting...")
            self.restart()
            if not self.is_process_alive():
                raise Exception("Gemini process could not be restarted.")
        
        try:
            logger.info(f"Sending prompt to gemini ({self.provider}/{self.model}): {prompt[:50]}...")
            
            # 清理管道信息
            while not self.output_queue.empty():
                self.output_queue.get()

            # 发送 prompt
            self.process.stdin.write(prompt + '\n')
            self.process.stdin.flush()
            
            # 等待完整响应
            response_content = ""
            start_time = time.time()
            timeout = 120  # 2分钟超时
            
            while time.time() - start_time < timeout:
              # 非阻塞方式获取输出
              try:
                  line = self.output_queue.get_nowait()
                  line = re.sub(r'🤖 Output:s?', '', line)
                  if not line.strip():
                      continue
                  elif line.strip() == '👤 Input:':
                      return
                  response_content += line
                  yield line
              except queue.Empty:
                  time.sleep(0.1)
                  continue
            
            # 超时处理
            if not response_content:
                yield "Sorry, the response timed out. Please try again."
                
        except Exception as e:
            logger.error(f"Error in send_prompt_stream: {e}")
            yield f"Error: {str(e)}"

    def send_prompt(self, prompt: str) -> str:
        """发送 prompt 并返回完整响应"""
        response_parts = []
        for chunk in self.send_prompt_stream(prompt):
            response_parts.append(chunk)
        return ''.join(response_parts)

    def restart(self):
        """重启进程"""
        logger.info("Restarting gemini process...")
        self.running = False
        if self.process:
            try:
                self.process.terminate()
                self.process.wait(timeout=5)
            except:
                self.process.kill()
        
        self.process = None
        self.start_process()

    def update_config(self, provider: str = None, model: str = None, api_key: str = None):
        """更新配置并重启进程"""
        if provider:
            self.provider = provider
        if model:
            self.model = model
        if api_key:
            self.api_key = api_key
        
        logger.info(f"Updating config: provider={self.provider}, model={self.model}")
        self.restart()

if __name__ == "__main__":
    gemini = GeminiProcess(provider = "deepseek", model = "deepseek-chat", api_key = "sk-7f73aeb6f5104c748f7b2c25d9483b64")
    print(gemini.send_prompt('你好'))

`;
  }

  /**
   * 检查 app.py 文件是否存在
   */
  private hasAppPyFile(): boolean {
    try {
      // 检查当前工作目录的 .continue/gemini_proxy 文件夹
      const appPyPath = path.join(GeminiProxyMode.rootDir, ".continue", "gemini_proxy", "app.py");
      return fs.existsSync(appPyPath);
    } catch {
      return false;
    }
  }

  /**
   * 检查服务是否正在运行
   */
  private async isServiceRunning(): Promise<boolean> {
    try {
      const response = await fetch("http://127.0.0.1:5001/health", {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      
      // 只要服务能响应就认为在运行，不管进程是否存活
      // 因为 Flask 服务本身在运行，只是 gemini 进程可能有问题
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 启动 app.py 服务
   */
  private async startService(): Promise<boolean> {
    if (GeminiProxyMode.isStarting) {
      // 如果正在启动，等待一下
      await new Promise(resolve => setTimeout(resolve, 2000));
      return await this.isServiceRunning();
    }

    if (!this.hasAppPyFile()) {
      console.log("[GeminiProxyMode] No .continue/gemini_proxy/app.py file found");
      return false;
    }

    if (await this.isServiceRunning()) {
      console.log("[GeminiProxyMode] Service already running");
      return true;
    }

    GeminiProxyMode.isStarting = true;

    try {
      console.log("[GeminiProxyMode] Starting app.py service...");
      
      const appPyPath = path.join(GeminiProxyMode.rootDir, ".continue", "gemini_proxy", "app.py");
      
      // 选择跨平台 Python 命令
      const pythonCmd =
        process.env.CONTINUE_PYTHON ||
        (process.platform === "win32" ? "python" : "python3");

      // 启动 Python 进程
      GeminiProxyMode.appProcess = spawn(pythonCmd, [appPyPath], {
        cwd: GeminiProxyMode.rootDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          PYTHONPATH: GeminiProxyMode.rootDir,
        },
      });

      // 设置进程事件处理
      GeminiProxyMode.appProcess.on("error", (error: any) => {
        console.error("[GeminiProxyMode] Failed to start service:", error);
        GeminiProxyMode.isStarting = false;
        GeminiProxyMode.appProcess = null;
      });

      GeminiProxyMode.appProcess.on("exit", (code: number, signal: string) => {
        console.log(`[GeminiProxyMode] Service exited with code ${code}, signal ${signal}`);
        GeminiProxyMode.isStarting = false;
        GeminiProxyMode.appProcess = null;
      });

      // 等待服务启动
      const success = await this.waitForServiceStart();
      
      if (success) {
        console.log("[GeminiProxyMode] Service started successfully");
        // 设置服务就绪状态
        GeminiProxyMode.serviceReady = true;
      } else {
        console.error("[GeminiProxyMode] Failed to start service");
        GeminiProxyMode.appProcess = null;
        GeminiProxyMode.serviceReady = false;
      }

      return success;
    } catch (error) {
      console.error("[GeminiProxyMode] Error starting service:", error);
      GeminiProxyMode.isStarting = false;
      return false;
    }
  }

  /**
   * 等待服务启动
   */
  private async waitForServiceStart(timeout: number = 30000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const response = await fetch("http://127.0.0.1:5001/health", {
          method: "GET",
          signal: AbortSignal.timeout(2000),
        });
        
        // 只要服务能响应就认为启动成功
        GeminiProxyMode.isStarting = false;
        return true;
      } catch {
        // 服务还未启动，继续等待
      }
      
      // 等待 1 秒后重试
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    GeminiProxyMode.isStarting = false;
    return false;
  }

  /**
   * 确保服务正在运行
   */
  private async ensureServiceRunning(): Promise<void> {
    try {
      // 如果服务已经就绪，直接返回
      if (GeminiProxyMode.serviceReady && await this.isServiceRunning()) {
        return;
      }

      // 如果服务未运行，启动服务
      if (!(await this.isServiceRunning())) {
        console.log("[GeminiProxyMode] Service not running, starting...");
        await this.startService();
      }

      // 等待服务完全就绪（包括 gemini 进程）
      await this.waitForServiceReady();
    } catch (error) {
      console.error("[GeminiProxyMode] Error ensuring service running:", error);
      GeminiProxyMode.serviceReady = false;
    }
  }

  /**
   * 等待服务完全就绪（包括 gemini 进程）
   */
  private async waitForServiceReady(timeout: number = 60000): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const response = await fetch("http://127.0.0.1:5001/health", {
          method: "GET",
          signal: AbortSignal.timeout(2000),
        });
        
        if (response.ok) {
          const data = await response.json();
          // 检查 gemini 进程是否存活
          if (data.process_alive === true) {
            console.log("[GeminiProxyMode] Service fully ready (gemini process alive)");
            GeminiProxyMode.serviceReady = true;
            return;
          } else {
            console.log("[GeminiProxyMode] Flask service running, waiting for gemini process...");
          }
        }
      } catch {
        // 服务还未完全就绪，继续等待
      }
      
      // 等待 2 秒后重试
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    console.error("[GeminiProxyMode] Service ready timeout");
    GeminiProxyMode.serviceReady = false;
    throw new Error("Service ready timeout");
  }

  // 实现 _streamComplete 方法
  protected async *_streamComplete(
    prompt: string,
    signal: AbortSignal,
    options: CompletionOptions,
  ): AsyncGenerator<string> {
    // 确保服务完全就绪后再进行问答
    await this.ensureServiceRunning();

    try {
      const resp = await fetch(this.streamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal,
      });
      
      if (!resp.ok) {
        throw new Error(`代理请求失败: ${resp.status} ${resp.statusText}`);
      }
      
      // 处理 Server-Sent Events 流
      const reader = resp.body?.getReader();
      if (!reader) {
        throw new Error("无法读取响应流");
      }
      
      const decoder = new TextDecoder();
      let buffer = "";
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || "";
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.error) {
                  throw new Error(`代理错误: ${data.error}`);
                }
                if (typeof data.chunk === 'string' && data.chunk) {
                  yield data.chunk;
                }
                if (data.done) {
                  return;
                }
              } catch (e) {
                // 忽略 JSON 解析错误，继续处理
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      
    } catch (e: any) {
      throw new Error(`网络或代理异常: ${e?.message || e}`);
    }
  }

  // 实现 _streamChat 方法
  protected async *_streamChat(
    messages: ChatMessage[],
    signal: AbortSignal,
    options: CompletionOptions,
  ): AsyncGenerator<ChatMessage> {
    // 确保服务完全就绪后再进行问答
    await this.ensureServiceRunning();

    // 只取最后一条用户输入
    const lastUser = messages.filter((m) => m.role === "user").pop();
    if (!lastUser) {
      yield { role: "assistant", content: "[Gemini模式] 请输入内容。" };
      return;
    }
    
    const prompt = typeof lastUser.content === "string" 
      ? lastUser.content 
      : (lastUser.content as any[]).map((p) => p.text).join("\n");
    
    try {
      const resp = await fetch(this.streamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal,
      });
      
      if (!resp.ok) {
        yield { role: "assistant", content: `[Gemini模式] 代理请求失败: ${resp.status} ${resp.statusText}` };
        return;
      }
      
      // 处理 Server-Sent Events 流
      const reader = resp.body?.getReader();
      if (!reader) {
        yield { role: "assistant", content: "[Gemini模式] 无法读取响应流" };
        return;
      }
      
      const decoder = new TextDecoder();
      let buffer = "";
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || "";
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                // eslint-disable-next-line max-depth
                if (data.error) {
                  yield { role: "assistant", content: `[Gemini模式] 代理错误: ${data.error}` };
                  return;
                }
                // eslint-disable-next-line max-depth
                if (typeof data.chunk === 'string' && data.chunk) {
                  yield { role: "assistant", content: data.chunk };
                }
                // eslint-disable-next-line max-depth
                if (data.done) {
                  return;
                }
              } catch (e) {
                // 忽略 JSON 解析错误，继续处理
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      
    } catch (e: any) {
      yield { role: "assistant", content: `[Gemini模式] 网络或代理异常: ${e?.message || e}` };
    }
  }

  /**
   * 清理资源
   */
  static dispose() {
    if (GeminiProxyMode.appProcess) {
      console.log("[GeminiProxyMode] Stopping app.py service...");
      GeminiProxyMode.appProcess.kill();
      GeminiProxyMode.appProcess = null;
    }
    // 重置服务就绪状态
    GeminiProxyMode.serviceReady = false;
    GeminiProxyMode.isStarting = false;
  }
}

export default GeminiProxyMode; 