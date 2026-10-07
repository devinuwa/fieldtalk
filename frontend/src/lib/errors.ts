/** Thrown when the local model is not reachable: the UI falls back to manual entry. */
export class ModelUnavailableError extends Error {
  constructor(message = "Local model unavailable") {
    super(message);
    this.name = "ModelUnavailableError";
  }
}

/** Thrown when speech-to-text is not usable on this machine. */
export class SttUnavailableError extends Error {
  constructor(message = "Speech-to-text unavailable") {
    super(message);
    this.name = "SttUnavailableError";
  }
}

/** Thrown when the API call itself failed (server down, bad response). */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
