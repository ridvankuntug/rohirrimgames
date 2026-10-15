import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rootFiles, sharedFiles, iconFiles, redirects, headers } from './static-site-manifest.mjs';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(rootDir, 'dist-static');
const frontendDir = join(rootDir, 'frontend');
const frontendDist = join(frontendDir, 'dist');

// The React application is the canonical hub. Build it here instead of relying
// on a stale checked-in frontend/dist directory; Wrangler invokes this script
// for both Git builds and manual deploys.
const npmCommand = process.platform === 'win32' ? 'cmd.exe' : 'npm';
const npmArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm run build']
    : ['run', 'build'];
execFileSync(npmCommand, npmArgs, {
    cwd: frontendDir,
    stdio: 'inherit'
});

// A whitelisted file that does not exist is a broken build, not something to
// skip silently: fail before anything is assembled.
const copies = [
    ...rootFiles.map(file => [join(rootDir, file), join(outDir, file)]),
    ...sharedFiles.map(file => [join(rootDir, file), join(outDir, file)]),
    ...iconFiles.map(file => [join(rootDir, 'frontend', 'public', file), join(outDir, file)])
];
const missing = copies.filter(([src]) => !existsSync(src)).map(([src]) => src);
if (missing.length > 0) {
    throw new Error(`Static build whitelist lists missing files:\n  ${missing.join('\n  ')}`);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const [src, dest] of copies) {
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest);
}

// Copy the Vite output last, so its index.html is the deployed root while all
// legacy standalone games above remain available alongside it.
cpSync(frontendDist, outDir, { recursive: true, force: true });

// Workers Static Assets does not provide SPA history fallback when configured
// with a real 404 page. Give each React deep-link a concrete entry point
// instead, without making /api/* look successful to backend probes.
for (const route of ['lingoparty', 'quiz', 'taboo-online']) {
    mkdirSync(join(outDir, route), { recursive: true });
    cpSync(join(frontendDist, 'index.html'), join(outDir, route, 'index.html'));
}

// Without a real 404, every
// backend-availability probe in the games (fetch('/api/...').ok) thinks the
// backend is reachable and never falls back to static content.
cpSync(join(frontendDist, 'index.html'), join(outDir, '404.html'));

// Workers Static Assets reads _redirects from the assets directory (and does
// not publish the file itself): send old bookmarks of retired legacy pages to
// their replacements.
writeFileSync(
    join(outDir, '_redirects'),
    redirects.map(([from, to, status]) => `${from} ${to} ${status}`).join('\n') + '\n'
);

// Workers Static Assets also reads (and does not publish) _headers: cache and
// security headers for every asset response.
writeFileSync(
    join(outDir, '_headers'),
    headers.map(([pattern, entries]) => [pattern, ...entries.map(([name, value]) => `  ${name}: ${value}`)].join('\n')).join('\n\n') + '\n'
);

console.log(`Static site assembled in ${outDir}`);
