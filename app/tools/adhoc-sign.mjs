// afterPack do electron-builder: assina o .app com assinatura "ad-hoc" (sem conta Apple).
// Sem isso, no Apple Silicon o app baixado/recebido por WhatsApp aparece como
// "danificado e nao pode ser aberto", pois o selo original do Electron fica invalido
// depois que o electron-builder troca Info.plist, icone e recursos.
// Nao substitui assinatura+notarizacao da Apple: o Gatekeeper ainda pede "Abrir mesmo assim".
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export default async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  await run("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", app]);
  await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  console.log(`  • assinatura ad-hoc ok: ${app}`);
}
