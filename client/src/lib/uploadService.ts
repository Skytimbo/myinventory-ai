/**
 * Upload Service
 *
 * Provides reusable utilities for constructing FormData for image uploads.
 * Designed to support future multi-image and batch upload flows.
 *
 * FOUNDATION: See FOUNDATION.md Principle 3 (Upload as Pluggable Mechanism)
 */

/**
 * Creates FormData for single item image upload
 *
 * @param imageBlob - Image file as Blob
 * @param filename - Optional filename (defaults to "upload.jpg")
 * @returns FormData ready for POST /api/items
 *
 * @example
 * // Camera capture usage
 * const blob = dataURLToBlob(capturedImage);
 * const formData = createItemUploadFormData(blob, "capture.jpg");
 * createItemMutation.mutate(formData);
 *
 * @example
 * // File input usage
 * const file = event.target.files[0];
 * const formData = createItemUploadFormData(file, file.name);
 * createItemMutation.mutate(formData);
 *
 */
export function createItemUploadFormData(
  imageBlob: Blob,
  filename: string = "upload.jpg"
): FormData {
  const formData = new FormData();
  formData.append("image", imageBlob, filename);
  return formData;
}

/**
 * Creates FormData for multi-image item upload (PRD 0004)
 *
 * @param imageBlobs - Array of image files as Blobs (1-10 images)
 * @param filenames - Optional array of filenames (defaults to "upload-{index}.jpg")
 * @returns FormData ready for POST /api/items with multiple images
 *
 * @example
 * // File input with multiple selection
 * const files = Array.from(event.target.files);
 * const formData = createItemMultiUploadFormData(files, files.map(f => f.name));
 * createItemMutation.mutate(formData);
 *
 * @example
 * // With default filenames
 * const blobs = [blob1, blob2, blob3];
 * const formData = createItemMultiUploadFormData(blobs);
 * // Results in: upload-0.jpg, upload-1.jpg, upload-2.jpg
 */
export function createItemMultiUploadFormData(
  imageBlobs: Blob[],
  filenames?: string[]
): FormData {
  const formData = new FormData();

  imageBlobs.forEach((blob, index) => {
    const filename = filenames?.[index] || `upload-${index}.jpg`;
    formData.append("images", blob, filename);
  });

  return formData;
}
