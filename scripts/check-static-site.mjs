// Checks the assembled static site (dist-static/, built by
// scripts/build-pages-site.mjs) before it is deployed:
//   - every local src/href in every HTML page points at a file that exists;
//   - the entry points the Worker relies on exist (404.html is load-bearing,
//     the React deep links need a concrete index.html each);
//   - no server-only module (quiz answers, game rules, protocol validators)
//     or retired legacy page was published;
//   - every _redirects target exists.
// Usage: node scripts/check-static-site.mjs [dir]   (default: dist-static)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const siteDir = resolve(rootDir, process.argv[2] ?? 'dist-static');

const REQUIRED = ['index.html', '404.html', 'quiz/index.html', 'taboo-online/index.html', 'lingoparty/index.html', '_redirects'];
// Server-only data and retired legacy pages that must not be published.
const RETIRED = ['prompts.json', 'lingoparty-decks.json', 'lingoparty.html', 'lingoparty.js', 'lingoparty.css', 'hub.css'];
const SERVER_ONLY = /(?:-engine\.js|-protocol\.js|(?:^|\/)quiz-decks\.js|(?:^|\/)taboo-decks\.js)$/;
// Anything with a scheme (https:, data:, mailto:, ...), protocol-relative
// URLs and pure fragments are not files in this site.
const NOT_LOCAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
const ATTRIBUTE = /\s(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

if (!existsSync(siteDir) || !statSync(siteDir).isDirectory()) {
    console.error(`check-static-site: ${siteDir} does not exist; run node scripts/build-pages-site.mjs first.`);
    process.exit(1);
}

const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
});
const files = walk(siteDir).map(path => relative(siteDir, path).split(sep).join('/'));

const problems = [];

for (const file of REQUIRED) {
    if (!files.includes(file)) problems.push(`missing required entry point: ${file}`);
}

for (const file of files) {
    if (SERVER_ONLY.test(file)) problems.push(`server-only module published: ${file}`);
}

for (const file of RETIRED) {
    if (files.includes(file)) problems.push(`retired or server-only file published: ${file}`);
}

const targetExists = path => {
    if (!existsSync(path)) return false;
    return statSync(path).isDirectory() ? existsSync(join(path, 'index.html')) : true;
};

for (const page of files.filter(file => file.endsWith('.html'))) {
    const html = readFileSync(join(siteDir, page), 'utf8');
    for (const match of html.matchAll(ATTRIBUTE)) {
        const raw = (match[1] ?? match[2]).trim();
        if (raw === '' || NOT_LOCAL.test(raw)) continue;
        let pathPart = raw.split(/[?#]/, 1)[0];
        if (pathPart === '') continue;
        try {
            pathPart = decodeURI(pathPart);
        } catch {
            problems.push(`${page}: malformed URL ${raw}`);
            continue;
        }
        const target = pathPart.startsWith('/')
            ? join(siteDir, pathPart)
            : join(siteDir, dirname(page), pathPart);
        if (target !== siteDir && !target.startsWith(siteDir + sep)) {
            problems.push(`${page}: ${raw} points outside the site`);
        } else if (!targetExists(target)) {
            problems.push(`${page}: ${raw} does not exist in the build`);
        }
    }
}

// Every _redirects target must be a page of this site.
if (files.includes('_redirects')) {
    const rules = readFileSync(join(siteDir, '_redirects'), 'utf8')
        .split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
    for (const rule of rules) {
        const [from, to] = rule.split(/\s+/);
        if (!from?.startsWith('/') || !to?.startsWith('/')) {
            problems.push(`_redirects: malformed rule "${rule}"`);
        } else if (!targetExists(join(siteDir, to))) {
            problems.push(`_redirects: ${from} points at ${to}, which does not exist in the build`);
        }
    }
}

if (problems.length > 0) {
    console.error(`check-static-site: ${problems.length} problem(s) in ${siteDir}:\n  ${problems.join('\n  ')}`);
    process.exit(1);
}

console.log(`check-static-site: ${files.length} files, all local links resolve, no server-only modules.`);
