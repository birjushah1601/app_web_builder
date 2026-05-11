export class KeycloakAuthError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "KeycloakAuthError";
  }
}

export class TokenExchangeError extends KeycloakAuthError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TokenExchangeError";
  }
}

export class IdTokenVerificationError extends KeycloakAuthError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "IdTokenVerificationError";
  }
}
