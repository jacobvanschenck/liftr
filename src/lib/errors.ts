export class AppError extends Error {
  status: number;

  constructor(message: string, status = 422) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Try again.';
}
