export class HttpError extends Error {
  readonly status: 400 | 404 | 409 | 422 | 500 | 502;

  constructor(status: HttpError["status"], message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export class NotFoundError extends HttpError {
  constructor(what: string, id: string) {
    super(404, `${what} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
