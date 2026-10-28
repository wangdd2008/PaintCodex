#!/usr/bin/env node
/**
 * 课程 02 实验室：一次最小的 codex app-server 会话。
 *
 * 它只做四件事：
 *   1. 拉起 `codex app-server`，按行读写 JSON；
 *   2. initialize → thread/start（声明一个工具）→ turn/start；
 *   3. 收到 item/tool/call 时，在本地执行 notes_add，把结果送回去；
 *   4. 等 turn/completed，打印助手最后说了什么。
 *
 * 运行：
 *   node labs/02-minimal-session/session.mjs
 *
 * 环境变量：
 *   CODEX_BIN        codex 可执行文件（默认 codex / codex.cmd）
 *   LAB_TIMEOUT_MS   整轮超时，默认 180000
 *
 * 依赖：Node.js 22+、codex-cli >= 0.164.0，且已经登录。
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const CODEX_BIN = process.env.CODEX_BIN ?? (process.platform === 'win32' ? 'codex.cmd' : 'codex');
const TURN_TIMEOUT_MS = Number(process.env.LAB_TIMEOUT_MS ?? 180_000);
const REQUEST_TIMEOUT_MS = 30_000;

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const dim = (text) => paint('2', text);
const cyan = (text) => paint('36', text);
const magenta = (text) => paint('35', text);
const green = (text) => paint('32', text);
const red = (text) => paint('31', text);

const say = (text = '') => process.stdout.write(`${text}\n`);
const arrowOut = cyan('→');
const arrowIn = magenta('←');

// ---------------------------------------------------------------------------
// 1. 协议传输：一行一个 JSON，用 id 对齐请求与响应
// ---------------------------------------------------------------------------

let child;
let nextId = 1;
const pending = new Map(); // 我们发出的请求：id -> { resolve, reject, timer, method }
let turnDone = null;
let assistantText = '';
let deltaCount = 0;
let toolCallCount = 0;
let exitCode = 0;

function startProcess() {
  const options = {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  };

  if (process.platform !== 'win32') {
    return spawn(CODEX_BIN, ['app-server'], options);
  }

  // Windows 上 codex 是 .cmd，不能直接 spawn，需要经过 cmd.exe。
  const quote = (value) =>
    /[\s"&|<>^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  const command = [CODEX_BIN, 'app-server'].map(quote).join(' ');

  return spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command], options);
}

function send(message) {
  if (!child?.stdin || child.stdin.destroyed) {
    throw new Error('app-server 的 stdin 已关闭');
  }

  say(`${arrowOut} ${JSON.stringify(message)}`);
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
  const id = nextId++;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`请求超时：${method}`));
    }, timeoutMs);

    pending.set(id, { resolve, reject, timer, method });
    send({ id, method, params });
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function handleLine(line) {
  if (line.trim().length === 0) {
    return;
  }

  let message;
  try {
    message = JSON.parse(line);
  } catch {
    say(dim(`[无法解析] ${line.slice(0, 160)}`));
    return;
  }

  const hasMethod = typeof message.method === 'string';
  const hasId = message.id !== undefined;

  if (!hasMethod && hasId) {
    settleResponse(message);
    return;
  }

  if (hasMethod && hasId) {
    handleServerRequest(message).catch((error) => failAndExit(error));
    return;
  }

  if (hasMethod) {
    handleNotification(message);
  }
}

function settleResponse(message) {
  const entry = pending.get(message.id);

  if (!entry) {
    // 可能是我们对某个反向请求的响应被回显；忽略即可。
    return;
  }

  clearTimeout(entry.timer);
  pending.delete(message.id);

  if (message.error) {
    say(`${arrowIn} #${message.id} ${entry.method} ${red('error')} ${message.error.message}`);
    entry.reject(new Error(`${entry.method}: ${message.error.message}`));
    return;
  }

  const preview = JSON.stringify(message.result ?? null);
  say(
    `${arrowIn} #${message.id} ${entry.method} ${green('ok')} ` +
      dim(preview.length > 220 ? `${preview.slice(0, 220)}…` : preview),
  );
  entry.resolve(message.result);
}

function handleNotification(message) {
  const { method, params = {} } = message;

  if (method === 'item/agentMessage/delta') {
    const delta = typeof params.delta === 'string' ? params.delta : '';
    assistantText += delta;
    deltaCount += 1;
    say(`${arrowIn} item/agentMessage/delta ${JSON.stringify(delta)}`);
    return;
  }

  if (method === 'item/started' || method === 'item/completed') {
    const item = params.item;

    if (item?.type === 'dynamicToolCall') {
      const status = method === 'item/started' ? 'running' : item.success === false ? 'failed' : 'ok';
      say(
        `${arrowIn} ${method} ` +
          `tool=${item.tool} callId=${item.id} status=${status}`,
      );
    }
    return;
  }

  if (method === 'turn/completed') {
    const status = params.turn?.status ?? 'unknown';

    if (status === 'inProgress') {
      return;
    }

    if (status === 'failed') {
      const error = params.turn?.error?.message ?? '未知错误';
      say(`${arrowIn} turn/completed ${red('failed')} ${error}`);
      turnDone?.reject(new Error(`turn failed: ${error}`));
      return;
    }

    if (status === 'interrupted') {
      say(`${arrowIn} turn/completed ${red('interrupted')}`);
      turnDone?.reject(new Error('turn interrupted'));
      return;
    }

    say(`${arrowIn} turn/completed ${green(status)}`);
    turnDone?.resolve(status);
  }
}

async function handleServerRequest(message) {
  say(`${arrowIn} ${JSON.stringify(message)}`);

  if (message.method !== 'item/tool/call') {
    send({
      id: message.id,
      error: { code: -32601, message: `不支持的请求：${message.method}` },
    });
    return;
  }

  const params = message.params ?? {};
  const callId = params.callId ?? '(none)';
  const tool = params.tool ?? '(none)';
  const args = params.arguments;

  toolCallCount += 1;
  say('');
  say(green(`  ⚙  app-server 请求执行工具`));
  say(`     callId: ${callId}`);
  say(`     tool:   ${tool}`);
  say(`     args:   ${JSON.stringify(args)}`);
  say('');

  const result = runTool(tool, args);

  say(`  ⚙  本地执行结果：${JSON.stringify(result)}`);
  say('');

  // 服务端请求的 id 由 app-server 分配（这里第一次是 0），原样回传即可；
  // 它和我们自己请求的 1、2、3 是两个命名空间。
  send({
    id: message.id,
    result: {
      success: result.ok,
      contentItems: [{ type: 'inputText', text: JSON.stringify(result) }],
    },
  });
}

// ---------------------------------------------------------------------------
// 2. 领域工具：这是你唯一需要替换成自己业务的部分
// ---------------------------------------------------------------------------

const notes = [];

const NOTES_ADD_TOOL = {
  type: 'function',
  name: 'notes_add',
  description:
    'Add one note to the in-memory notes list and return the full list. ' +
    'Call this before answering any request that asks to add a note.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Note text, 1 to 200 characters.' },
    },
    required: ['text'],
    additionalProperties: false,
  },
};

function runTool(tool, args) {
  if (tool !== 'notes_add') {
    return { ok: false, code: 'unknown_tool', message: `未声明的工具：${tool}` };
  }

  const text = typeof args?.text === 'string' ? args.text.trim() : '';

  if (text.length === 0 || text.length > 200) {
    return {
      ok: false,
      code: 'invalid_arguments',
      message: 'text 必须是 1 到 200 个字符',
    };
  }

  const note = {
    id: `note_${notes.length + 1}`,
    text,
    createdAt: new Date().toISOString(),
  };

  notes.push(note);

  return {
    ok: true,
    note,
    notes,
    revision: notes.length,
  };
}

// ---------------------------------------------------------------------------
// 3. 主流程：握手 → 建线程 → 开始一轮 → 等结束
// ---------------------------------------------------------------------------

const PROMPT =
  '请调用 notes_add，添加一条内容为“来自 app-server 的第一条笔记”的笔记，' +
  '然后告诉我现在一共有几条笔记。';

const DEVELOPER_INSTRUCTIONS =
  'You are a minimal notes lab. For any request to add a note, you MUST call ' +
  'the notes_add tool exactly once and wait for its result before answering. ' +
  'Never claim a note was added without calling the tool.';

function failAndExit(error) {
  exitCode = 1;
  say(red(`\n✖ ${error instanceof Error ? error.message : String(error)}`));
  shutdown();
}

function shutdown() {
  try {
    child?.stdin?.end();
  } catch {
    // ignore
  }

  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    } else {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => process.exit(exitCode), 300);
}

async function main() {
  say(dim('课程 02 实验室 · 最小 app-server 会话'));
  say(dim(`codex: ${CODEX_BIN}   cwd: ${process.cwd()}`));
  say('');

  child = startProcess();

  child.stdout.setEncoding('utf8');
  createInterface({ input: child.stdout }).on('line', handleLine);

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim().length > 0) {
        say(dim(`[codex stderr] ${line}`));
      }
    }
  });

  child.on('error', (error) => failAndExit(error));
  child.on('exit', (code, signal) => {
    const error = new Error(
      `app-server 提前退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）`,
    );

    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(error);
    }

    turnDone?.reject(error);
  });

  say(dim('── 1. initialize ─────────────────────────────────────'));
  await request('initialize', {
    clientInfo: { name: 'codex-lab', version: '0.1.0' },
    capabilities: { experimentalApi: true },
  });

  say('');
  say(dim('── 2. thread/start：声明工具 ─────────────────────────'));
  const threadResult = await request('thread/start', {
    cwd: process.cwd(),
    sandbox: 'read-only',
    approvalPolicy: 'never',
    ephemeral: true,
    developerInstructions: DEVELOPER_INSTRUCTIONS,
    dynamicTools: [NOTES_ADD_TOOL],
  });

  const threadId = threadResult.thread.id;

  say('');
  say(dim('── 3. turn/start：开始一轮 ───────────────────────────'));
  const done = deferred();
  turnDone = done;

  await request('turn/start', {
    threadId,
    input: [{ type: 'text', text: PROMPT }],
  });

  await Promise.race([
    done.promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`整轮超时（${TURN_TIMEOUT_MS}ms）`)), TURN_TIMEOUT_MS),
    ),
  ]);
  turnDone = null;

  say('');
  say(dim('── 4. 结果 ───────────────────────────────────────────'));
  say(`assistant: ${assistantText.trim() || '(没有文本输出)'}`);
  say(`delta:     ${deltaCount} 条`);
  say(`tool call: ${toolCallCount} 次`);
  say(`notes:     ${JSON.stringify(notes, null, 2)}`);

  if (toolCallCount === 0) {
    exitCode = 2;
    say('');
    say(red('注意：这一轮没有触发 item/tool/call。'));
    say(red('模型直接回答了，可能把工具当成了可选项。'));
    say(red('重跑一次；如果仍然不调用，检查 codex 版本与登录状态。'));
  }

  shutdown();
}

process.on('SIGINT', () => {
  exitCode = 130;
  shutdown();
});

main().catch((error) => failAndExit(error));
