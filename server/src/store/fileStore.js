import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Tests point DATA_DIR (via WALLCAL_DATA_DIR) at a scratch dir so they can
// write settings/credentials/caches without touching the real server/data.
const DATA_DIR = process.env.WALLCAL_DATA_DIR
  ? path.resolve(process.env.WALLCAL_DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export function readJson(filename, fallback) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

export function writeJson(filename, data) {
  fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

export function dataFilePath(filename) {
  return path.join(DATA_DIR, filename);
}
