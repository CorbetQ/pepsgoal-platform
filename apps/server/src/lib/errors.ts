export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'invalid') => new HttpError(400, code, message);
export const unauthorized = (message = 'Connexion requise.') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Action non autorisée.', code = 'forbidden') => new HttpError(403, code, message);
export const notFound = (message = 'Introuvable.') => new HttpError(404, 'not_found', message);
export const conflict = (message: string, code = 'conflict') => new HttpError(409, code, message);
