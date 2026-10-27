/**
 * Protocol types for `codex app-server` (codex-cli 0.164.0).
 *
 * This is the curated subset the runtime speaks, transcribed from the output of
 * `codex app-server generate-json-schema --experimental` so field names and
 * shapes stay honest. The full generated bindings are deliberately not
 * committed in this slice: the CLI emits hundreds of per-method files, and the
 * runtime only needs these methods. When a follow-up adds
 * `codex:generate` + a CI drift check, this file becomes that generated module.
 */

export interface ClientInfo {
  name: string;
  version: string;
}

export interface InitializeCapabilities {
  /** Required for `dynamicTools`; the server rejects thread/start without it. */
  experimentalApi?: boolean;
}

export interface InitializeParams {
  clientInfo: ClientInfo;
  capabilities?: InitializeCapabilities;
}

export interface InitializeResponse {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}

export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export type AskForApproval = 'untrusted' | 'on-request' | 'never';

/** A client-declared tool the model may invoke during a turn. */
export interface DynamicToolSpec {
  type: 'function';
  name: string;
  description: string;
  /** JSON Schema object; passed through to the model verbatim. */
  inputSchema: Record<string, unknown>;
}

export interface ThreadStartParams {
  cwd?: string;
  sandbox?: SandboxMode;
  approvalPolicy?: AskForApproval;
  ephemeral?: boolean;
  developerInstructions?: string;
  dynamicTools?: DynamicToolSpec[];
}

export interface Thread {
  id: string;
}

export interface ThreadStartResult {
  thread: Thread;
}

export type UserInput = { type: 'text'; text: string };

export interface TurnStartParams {
  threadId: string;
  input: UserInput[];
  model?: string;
}

export interface Turn {
  id: string;
}

export interface TurnStartResult {
  turn: Turn;
}

export interface TurnInterruptParams {
  threadId: string;
  turnId: string;
}

export type DynamicToolCallStatus = 'inProgress' | 'completed' | 'failed';

/** Server->client request asking the runtime to execute a declared tool. */
export interface DynamicToolCallParams {
  threadId: string;
  turnId: string;
  callId: string;
  namespace: string | null;
  tool: string;
  arguments: unknown;
}

export type DynamicToolCallOutputContentItem =
  | { type: 'inputText'; text: string }
  | { type: 'inputImage'; imageUrl: string }
  | { type: 'inputAudio'; audioUrl: string };

export interface DynamicToolCallResponse {
  success: boolean;
  contentItems: DynamicToolCallOutputContentItem[];
}

export interface AgentMessageDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

/** One `dynamicToolCall` item as carried by `item/started` / `item/completed`. */
export interface DynamicToolCallItem {
  type: 'dynamicToolCall';
  /** Equals the `callId` of the matching `item/tool/call` request. */
  id: string;
  tool: string;
  arguments?: unknown;
  status?: DynamicToolCallStatus;
  contentItems?: DynamicToolCallOutputContentItem[] | null;
  success?: boolean | null;
  durationMs?: number | null;
}

export interface ItemNotification {
  threadId: string;
  turnId?: string;
  item: unknown;
}

export type TurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress';

export interface TurnError {
  message: string;
}

export interface TurnCompletedNotification {
  threadId: string;
  turn: {
    id: string;
    status: TurnStatus;
    error?: TurnError | null;
    items?: unknown[];
  };
}

export type JsonRpcId = number | string;

export interface JsonRpcRequest<TParams = unknown> {
  id: JsonRpcId;
  method: string;
  params?: TParams;
}

export interface JsonRpcError {
  code: number;
  message: string;
}

export interface JsonRpcResponse<TResult = unknown> {
  id: JsonRpcId;
  result?: TResult;
  error?: JsonRpcError;
}

/** Notifications carry no `id`; the server may add fields such as `emittedAtMs`. */
export interface JsonRpcNotification<TParams = unknown> {
  method: string;
  params?: TParams;
  emittedAtMs?: number;
}
