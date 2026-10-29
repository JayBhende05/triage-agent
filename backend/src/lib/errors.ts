/** An error that maps to an HTTP status. The API turns it into { error: { code, message } }. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
