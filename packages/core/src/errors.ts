/** RFC 7807-style problem details used by the API for consistent errors. */
export interface ProblemDetails {
  status: number;
  title: string;
  detail?: string;
  code?: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
  toProblem(): ProblemDetails {
    return { status: this.status, title: this.message, code: this.code };
  }
}

export const NotFound = (what = 'Resource') => new ApiError(404, `${what} not found`, 'not_found');
export const BadRequest = (detail: string) => new ApiError(400, detail, 'bad_request');
export const Conflict = (detail: string) => new ApiError(409, detail, 'conflict');
export const Forbidden = (detail = 'Forbidden') => new ApiError(403, detail, 'forbidden');
