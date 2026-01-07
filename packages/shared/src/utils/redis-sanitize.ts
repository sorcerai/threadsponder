/**
 * Redis Pattern Sanitization Utility
 *
 * Prevents Redis injection attacks by escaping special pattern characters
 * in user-provided input before using in KEYS, SCAN, or pattern matching.
 *
 * Security Expert: James Kettle (PortSwigger) - Injection Prevention
 */

/**
 * Escapes Redis glob pattern special characters to prevent injection.
 *
 * Redis KEYS patterns support:
 * - * matches any sequence of characters
 * - ? matches any single character
 * - [...] matches any character in the set
 * - \ escapes the next character
 *
 * @param input - User-provided string to sanitize
 * @returns Escaped string safe for Redis patterns
 */
export function sanitizeRedisPattern(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Escape Redis glob pattern special characters
  // Order matters: escape backslash first to avoid double-escaping
  return input
    .replace(/\\/g, '\\\\')  // Escape backslashes
    .replace(/\*/g, '\\*')   // Escape asterisks
    .replace(/\?/g, '\\?')   // Escape question marks
    .replace(/\[/g, '\\[')   // Escape opening brackets
    .replace(/\]/g, '\\]');  // Escape closing brackets
}

/**
 * Validates that a Redis key contains only safe characters.
 * More restrictive than sanitization - rejects suspicious input entirely.
 *
 * @param key - User-provided key to validate
 * @returns true if key is safe, false otherwise
 */
export function isValidRedisKey(key: string): boolean {
  if (!key || typeof key !== 'string') {
    return false;
  }

  // Allow alphanumeric, underscore, hyphen, dot, colon
  // Reject any pattern special characters or unusual chars
  const safeKeyPattern = /^[a-zA-Z0-9_\-.:]+$/;
  return safeKeyPattern.test(key) && key.length <= 256;
}

/**
 * Validates and sanitizes a username for Redis key usage.
 * Usernames have stricter requirements - alphanumeric, underscore, dot.
 *
 * @param username - Username to validate and sanitize
 * @returns Sanitized username or null if invalid
 */
export function sanitizeUsername(username: string): string | null {
  if (!username || typeof username !== 'string') {
    return null;
  }

  // Trim and lowercase
  const normalized = username.trim().toLowerCase();

  // Validate username pattern (Threads usernames: alphanumeric, underscore, dot)
  const usernamePattern = /^[a-zA-Z0-9_.]+$/;
  if (!usernamePattern.test(normalized) || normalized.length > 64) {
    return null;
  }

  return normalized;
}

/**
 * Validates a source name for research ammo storage.
 * Source names should be URL-safe and descriptive.
 *
 * @param sourceName - Source name to validate
 * @returns Sanitized source name or null if invalid
 */
export function sanitizeSourceName(sourceName: string): string | null {
  if (!sourceName || typeof sourceName !== 'string') {
    return null;
  }

  // Trim whitespace
  const normalized = sourceName.trim();

  // Allow alphanumeric, underscore, hyphen, dot (URL-safe)
  const sourcePattern = /^[a-zA-Z0-9_\-.]+$/;
  if (!sourcePattern.test(normalized) || normalized.length > 128) {
    return null;
  }

  return normalized;
}

/**
 * Validates and sanitizes an ID for Redis key usage.
 * IDs must be alphanumeric only.
 *
 * @param id - ID to validate
 * @returns Sanitized ID or null if invalid
 */
export function sanitizeId(id: string): string | null {
  if (!id || typeof id !== 'string') {
    return null;
  }

  const normalized = id.trim();

  // IDs should be alphanumeric, underscores allowed
  const idPattern = /^[a-zA-Z0-9_]+$/;
  if (!idPattern.test(normalized) || normalized.length > 128) {
    return null;
  }

  return normalized;
}

/**
 * Sanitizes an email address for storage/lookup.
 * Returns lowercase, trimmed email if valid format.
 *
 * @param email - Email to sanitize
 * @returns Sanitized email or null if invalid
 */
export function sanitizeEmail(email: string): string | null {
  if (!email || typeof email !== 'string') {
    return null;
  }

  const normalized = email.trim().toLowerCase();

  // Basic email pattern validation
  const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailPattern.test(normalized) || normalized.length > 256) {
    return null;
  }

  return normalized;
}
