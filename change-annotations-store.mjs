import { readFile, writeFile, mkdir, copyFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function validateAnnotations(value) {
  const notes = value?.notes ?? {};
  const colors = value?.colors ?? {};
  if (value?.version !== 1 || !Array.isArray(value.hidden) || !Array.isArray(value.boxes)
    || value.hidden.length > 5000 || value.boxes.length > 1000
    || !value.hidden.every(key => typeof key === 'string')
    || !notes || Array.isArray(notes) || typeof notes !== 'object'
    || Object.keys(notes).length > 5000
    || !Object.entries(notes).every(([key, note]) => key.length > 0 && key.length <= 500 && typeof note === 'string' && note.length <= 2000)) {
    throw new Error('改动标识文件格式无效');
  }
  if (!colors || Array.isArray(colors) || typeof colors !== 'object'
    || Object.keys(colors).length > 5000
    || !Object.entries(colors).every(([key, color]) => key.length > 0 && key.length <= 500 && ['blue', 'red'].includes(color))) {
    throw new Error('改动标识颜色格式无效');
  }
  for (const box of value.boxes) {
    if (!box || typeof box.id !== 'string' || typeof box.selector !== 'string'
      || typeof box.cockpit !== 'string' || typeof box.context !== 'string'
      || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(box[key]))
      || box.width <= 0 || box.height <= 0) throw new Error('框选区域格式无效');
  }
  return { version:1, hidden:[...new Set(value.hidden)], boxes:value.boxes, notes:{...notes}, colors:{...colors} };
}
export async function readAnnotations(file) {
  try { return validateAnnotations(JSON.parse(await readFile(file, 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return {version:1, hidden:[], boxes:[], notes:{}, colors:{}}; throw error; }
}
export async function writeAnnotations(file, value) {
  const validated = validateAnnotations(value);
  await mkdir(dirname(file), {recursive:true});
  const backupDir = join(dirname(file), '.visual-editor-backups');
  await mkdir(backupDir, {recursive:true});
  try { await copyFile(file, join(backupDir, `change-annotations-${Date.now()}-${randomUUID()}.json`)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(validated, null, 2) + '\n');
  await rename(temp, file);
  return validated;
}
