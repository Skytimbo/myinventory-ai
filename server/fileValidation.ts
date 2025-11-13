/**
 * File validation utilities for secure file uploads
 *
 * Provides MIME type detection via magic numbers (file signatures)
 * and comprehensive validation for uploaded files.
 */

/**
 * Detects MIME type from file buffer by checking magic numbers (file signatures)
 *
 * @param buffer - File buffer to analyze
 * @returns MIME type string or null if not recognized
 *
 * Supported formats:
 * - JPEG: FF D8 FF
 * - PNG: 89 50 4E 47
 * - WebP: 52 49 46 46 ... 57 45 42 50 (RIFF...WEBP)
 */
export function getMimeTypeFromBuffer(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 12) {
    return null;
  }

  // Check JPEG signature: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }

  // Check PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4E &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }

  // Check WebP signature: RIFF....WEBP
  // Bytes 0-3: RIFF (52 49 46 46)
  // Bytes 8-11: WEBP (57 45 42 50)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Validates an uploaded file for type and authenticity
 *
 * @param file - Multer file object from request
 * @returns Validation result with error message if invalid
 *
 * Validation checks:
 * 1. Declared MIME type matches allowed types
 * 2. Magic number MIME type matches declared MIME type
 * 3. Both checks must pass to prevent spoofed files
 */
export function validateUploadedFile(file: Express.Multer.File): {
  valid: boolean;
  error?: string;
} {
  const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  // Check declared MIME type
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return {
      valid: false,
      error: 'Only JPEG, PNG, and WebP images are supported',
    };
  }

  // Check magic number MIME type
  const detectedMimeType = getMimeTypeFromBuffer(file.buffer);
  if (!detectedMimeType) {
    return {
      valid: false,
      error: 'Unable to verify file type. File may be corrupted or invalid',
    };
  }

  // Verify declared MIME matches detected MIME
  // Normalize jpeg/jpg variants
  const normalizedDeclared = file.mimetype.replace('jpeg', 'jpg');
  const normalizedDetected = detectedMimeType.replace('jpeg', 'jpg');

  if (normalizedDeclared !== normalizedDetected) {
    return {
      valid: false,
      error: `File type mismatch. Declared as ${file.mimetype} but detected as ${detectedMimeType}`,
    };
  }

  return { valid: true };
}
