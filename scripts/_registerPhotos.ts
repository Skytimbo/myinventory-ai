/* scripts/_registerPhotos.ts
 *
 * Record existing item photos as evidence, using the app's own PhotoService.
 * Idempotent; never moves or changes files. Callers must already have checked
 * that url is a local database.
 */
export async function registerPhotos(url: string, storageDir: string): Promise<void> {
  process.env.DATABASE_URL = url;
  process.env.LOCAL_STORAGE_DIR = storageDir;
  const { DatabaseStorage } = await import('../server/storage');
  const { ObjectStorageService } = await import('../server/objectStorage');
  const { PhotoService } = await import('../server/photoService');
  const storage = await DatabaseStorage.create();
  try {
    const result = await new PhotoService(storage, new ObjectStorageService()).registerExistingItemPhotos();
    console.log(
      `✓ Photo evidence: ${result.registered} registered, ${result.linked} linked, ` +
        `${result.alreadyRegistered} already registered, ${result.missing.length} missing`
    );
  } finally {
    await storage.close();
  }
}
