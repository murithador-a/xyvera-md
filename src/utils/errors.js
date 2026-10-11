/**
 * Typed application errors. The router maps each to an honest user-facing message.
 * Never include secrets in error messages or details.
 */

export class AppError extends Error {
  constructor(message, { code = 'APP_ERROR', userMessage = null, cause = undefined, details = undefined } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = this.constructor.name;
    this.code = code;
    this.userMessage = userMessage ?? message;
    this.details = details;
    this.expose = true; // safe to show to the user by default
  }
}

export class ValidationError extends AppError {
  constructor(message, opts = {}) {
    super(message, { code: 'VALIDATION', userMessage: message, ...opts });
  }
}

export class PermissionDeniedError extends AppError {
  constructor(message = 'You do not have permission to do that.', opts = {}) {
    super(message, { code: 'PERMISSION_DENIED', userMessage: message, ...opts });
    this.expose = true;
  }
}

export class ConfirmationRequiredError extends AppError {
  /**
   * @param {string} prompt  message to show the user
   * @param {{ action: string, token?: string }} meta
   */
  constructor(prompt, meta = {}) {
    super(prompt, { code: 'CONFIRMATION_REQUIRED', userMessage: prompt });
    this.meta = meta;
  }
}

export class CooldownError extends AppError {
  constructor(retryAfterMs, message = 'Please wait before using this command again.') {
    super(message, { code: 'COOLDOWN', userMessage: message });
    this.retryAfterMs = retryAfterMs;
  }
}

export class NotConfiguredError extends AppError {
  constructor(feature, envVar) {
    const msg = `This feature is not configured yet. Add ${envVar} to your .env (see .env.example).`;
    super(msg, { code: 'NOT_CONFIGURED', userMessage: msg });
    this.feature = feature;
    this.envVar = envVar;
  }
}

export class ExternalServiceError extends AppError {
  constructor(message, opts = {}) {
    super(message, { code: 'EXTERNAL_SERVICE', userMessage: message, ...opts });
  }
}

/** WhatsApp / Baileys refused or failed an action — surface the real outcome. */
export class WhatsAppActionError extends AppError {
  constructor(message, opts = {}) {
    super(message, { code: 'WHATSAPP_ACTION', userMessage: message, ...opts });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found.', opts = {}) {
    super(message, { code: 'NOT_FOUND', userMessage: message, ...opts });
  }
}
