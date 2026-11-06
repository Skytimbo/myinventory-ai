import { config } from 'dotenv';
import path from 'path';

// Tests use in-memory fakes and never need production settings, so the
// production-pointing .env is never loaded here; only the local development
// file (if present). Database commands refuse non-local targets regardless.
config({ path: path.resolve(__dirname, '../.env.development') });
