import { describe, it, expect } from 'vitest';
import { createItemUploadFormData, createItemMultiUploadFormData } from './uploadService';

describe('uploadService', () => {
  describe('createItemUploadFormData', () => {
    it('should create FormData with single image', () => {
      const blob = new Blob(['test'], { type: 'image/jpeg' });
      const filename = 'test.jpg';

      const formData = createItemUploadFormData(blob, filename);

      expect(formData).toBeInstanceOf(FormData);
      expect(formData.has('image')).toBe(true);

      // Verify image field contains the blob
      const imageEntry = formData.get('image');
      expect(imageEntry).toBeInstanceOf(File);
      expect((imageEntry as File).name).toBe(filename);
    });

    it('should use default filename when not provided', () => {
      const blob = new Blob(['test'], { type: 'image/png' });

      const formData = createItemUploadFormData(blob);

      expect(formData.has('image')).toBe(true);

      const imageEntry = formData.get('image');
      expect(imageEntry).toBeInstanceOf(File);
      expect((imageEntry as File).name).toBe('upload.jpg');
    });

    it('should handle different blob types', () => {
      const pngBlob = new Blob(['png data'], { type: 'image/png' });
      const webpBlob = new Blob(['webp data'], { type: 'image/webp' });

      const pngFormData = createItemUploadFormData(pngBlob, 'image.png');
      const webpFormData = createItemUploadFormData(webpBlob, 'image.webp');

      expect(pngFormData.get('image')).toBeInstanceOf(File);
      expect(webpFormData.get('image')).toBeInstanceOf(File);
    });
  });

  describe('createItemMultiUploadFormData (PRD 0004)', () => {
    it('should create FormData with multiple images', () => {
      const blobs = [
        new Blob(['image1'], { type: 'image/jpeg' }),
        new Blob(['image2'], { type: 'image/png' }),
        new Blob(['image3'], { type: 'image/webp' })
      ];
      const filenames = ['img1.jpg', 'img2.png', 'img3.webp'];

      const formData = createItemMultiUploadFormData(blobs, filenames);

      expect(formData).toBeInstanceOf(FormData);

      // Verify all images are appended with "images" key
      const allImages = formData.getAll('images');
      expect(allImages).toHaveLength(3);

      // Verify each image is a File with correct name
      allImages.forEach((entry, index) => {
        expect(entry).toBeInstanceOf(File);
        expect((entry as File).name).toBe(filenames[index]);
      });
    });

    it('should use default filenames when not provided', () => {
      const blobs = [
        new Blob(['image1'], { type: 'image/jpeg' }),
        new Blob(['image2'], { type: 'image/png' })
      ];

      const formData = createItemMultiUploadFormData(blobs);

      const allImages = formData.getAll('images');
      expect(allImages).toHaveLength(2);

      expect((allImages[0] as File).name).toBe('upload-0.jpg');
      expect((allImages[1] as File).name).toBe('upload-1.jpg');
    });

    it('should handle single image in array (edge case)', () => {
      const blobs = [new Blob(['single'], { type: 'image/jpeg' })];
      const filenames = ['single.jpg'];

      const formData = createItemMultiUploadFormData(blobs, filenames);

      const allImages = formData.getAll('images');
      expect(allImages).toHaveLength(1);
      expect((allImages[0] as File).name).toBe('single.jpg');
    });

    it('should handle maximum allowed images (10 images)', () => {
      const blobs = Array.from({ length: 10 }, (_, i) =>
        new Blob([`image${i}`], { type: 'image/jpeg' })
      );
      const filenames = Array.from({ length: 10 }, (_, i) => `img${i}.jpg`);

      const formData = createItemMultiUploadFormData(blobs, filenames);

      const allImages = formData.getAll('images');
      expect(allImages).toHaveLength(10);

      allImages.forEach((entry, index) => {
        expect(entry).toBeInstanceOf(File);
        expect((entry as File).name).toBe(filenames[index]);
      });
    });

    it('should handle partial filenames array', () => {
      const blobs = [
        new Blob(['image1'], { type: 'image/jpeg' }),
        new Blob(['image2'], { type: 'image/png' }),
        new Blob(['image3'], { type: 'image/webp' })
      ];
      const filenames = ['custom1.jpg', 'custom2.png']; // Only 2 filenames for 3 blobs

      const formData = createItemMultiUploadFormData(blobs, filenames);

      const allImages = formData.getAll('images');
      expect(allImages).toHaveLength(3);

      expect((allImages[0] as File).name).toBe('custom1.jpg');
      expect((allImages[1] as File).name).toBe('custom2.png');
      expect((allImages[2] as File).name).toBe('upload-2.jpg'); // Fallback to default
    });

    it('should handle empty array', () => {
      const blobs: Blob[] = [];
      const filenames: string[] = [];

      const formData = createItemMultiUploadFormData(blobs, filenames);

      const allImages = formData.getAll('images');
      expect(allImages).toHaveLength(0);
    });

    it('should append to "images" field, not "image" (field name validation)', () => {
      const blobs = [new Blob(['test'], { type: 'image/jpeg' })];
      const formData = createItemMultiUploadFormData(blobs);

      // Multi-image uses "images" (plural)
      expect(formData.has('images')).toBe(true);
      expect(formData.has('image')).toBe(false); // Single-image field should NOT exist
    });
  });

  describe('Backwards compatibility', () => {
    it('should use different field names for single vs multi-image', () => {
      const blob = new Blob(['test'], { type: 'image/jpeg' });

      const singleFormData = createItemUploadFormData(blob, 'test.jpg');
      const multiFormData = createItemMultiUploadFormData([blob], ['test.jpg']);

      // Single-image uses "image" field
      expect(singleFormData.has('image')).toBe(true);
      expect(singleFormData.has('images')).toBe(false);

      // Multi-image uses "images" field
      expect(multiFormData.has('images')).toBe(true);
      expect(multiFormData.has('image')).toBe(false);
    });
  });
});
