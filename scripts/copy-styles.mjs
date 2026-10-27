import { copyFile, mkdir, writeFile } from 'node:fs/promises';

await copyFile(
  new URL('../src/styles.css', import.meta.url),
  new URL('../dist/styles.css', import.meta.url),
);
await writeFile(
  new URL('../dist/styles.css.d.ts', import.meta.url),
  'export {};\n',
);

await mkdir(new URL('../dist/logos/', import.meta.url), { recursive: true });
for (const name of [
  'intel.svg',
  'nvidia.svg',
  'nearai.svg',
  'nearai-white.svg',
  'model.svg',
]) {
  await copyFile(
    new URL(`../src/logos/${name}`, import.meta.url),
    new URL(`../dist/logos/${name}`, import.meta.url),
  );
}
