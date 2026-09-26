export type AiRole =
  "user" |
  "assistant";

export interface AiMessage {
  role: AiRole;
  content: string;
}

export interface AiRequest {
  message: string;
  history: AiMessage[];
}

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AiResult {
  text: string;
  provider: string;
  model: string;
  usage: AiUsage;
}

export interface AiStreamMeta {
  provider: string;
  model: string;
}

export interface AiStreamCompleted {
  provider: string;
  model: string;
  usage: AiUsage;
}

export interface AiProvider {
  readonly id: string;
  readonly model: string;

  configured(): boolean;

  generate(
    request: AiRequest,
    signal: AbortSignal
  ): Promise<AiResult>;

  stream(
    request: AiRequest,
    signal: AbortSignal,
    onDelta: (
      delta: string
    ) => void | Promise<void>
  ): Promise<AiStreamCompleted>;
}

export class AiProviderError
  extends Error {

  readonly code: string;
  readonly retryable: boolean;
  readonly httpStatus?: number;

  constructor(
    message: string,
    options: {
      code: string;
      retryable: boolean;
      httpStatus?: number;
    }
  ) {
    super(message);

    this.name =
      "AiProviderError";

    this.code =
      options.code;

    this.retryable =
      options.retryable;

    this.httpStatus =
      options.httpStatus;
  }
}

export interface AiAttempt {
  provider: string;
  model: string;
  status:
    | "success"
    | "error"
    | "aborted";
  latencyMs: number;
  inputChars: number;
  outputChars: number;
  usage: AiUsage;
  errorCode?: string;
  fallbackFrom?: string;
}

export interface AiGatewayResult
  extends AiResult {
  attempts: AiAttempt[];
}
