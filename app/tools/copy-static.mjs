// Copia os arquivos estaticos do renderer para dist/ depois do tsc.
import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, "dist", "renderer");
await mkdir(out, { recursive: true });
for (const file of ["index.html", "styles.css"]) {
  await cp(join(root, "src", "renderer", file), join(out, file));
}
await cp(join(root, "src", "renderer", "assets"), join(out, "assets"), { recursive: true });
console.log("static -> dist/renderer");
