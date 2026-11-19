import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

/** Injecte le jeu d'audit (AUDIT_FILE ou jeu de démonstration) dans la page : la page buildée est l'artefact. */
function auditData(): Plugin {
  const file = process.env.AUDIT_FILE || 'src/data/demo-audit.json';
  return {
    name: 'audit-data',
    transformIndexHtml(html) {
      const json = JSON.stringify(JSON.parse(readFileSync(file, 'utf8'))).replace(/</g, '\\u003c');
      return html.replace('%AUDIT_DATA%', () => json);
    },
  };
}

export default defineConfig({
  plugins: [auditData(), viteSingleFile()],
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 100_000_000 },
});
