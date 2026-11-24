/**
 * Host half of dsh-plugin-updater.
 *
 * Two Host capabilities:
 *  - the global session command `/refresh-title`, which regenerates the
 *    receiving session's title and thereby unpins a manually renamed title
 *    (the browser half adds the session-row menu item);
 *  - the HTTP route `/dsh-plugin-updater/official-addresses`, which answers the
 *    browser half with the `homepage` / `repository` fields of every
 *    profile-installed bundle's own `package.json`. DSH's `listBundles` does not
 *    expose those fields, so this route is how locally developed (non-npm)
 *    plugins can still show an official address.
 */
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve as resolvePath, sep } from 'node:path';
export const OFFICIAL_ADDRESSES_PATH = '/dsh-plugin-updater/official-addresses';
function readJsonFile(path) {
    try {
        const value = JSON.parse(readFileSync(path, 'utf8'));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    }
    catch {
        return null;
    }
}
function readGitConfig(gitPath) {
    try {
        const stat = statSync(gitPath);
        if (stat.isDirectory())
            return readFileSync(join(gitPath, 'config'), 'utf8');
        if (stat.isFile()) {
            // A worktree or submodule: `.git` is a file pointing at the real git dir.
            const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitPath, 'utf8'));
            if (pointer)
                return readFileSync(resolvePath(dirname(gitPath), pointer[1].trim(), 'config'), 'utf8');
        }
    }
    catch {
        /* not a readable git directory */
    }
    return null;
}
function gitOriginUrl(config) {
    const section = /\[remote\s+"origin"\]\s*\n([\s\S]*?)(?=\n\[|$)/.exec(config);
    if (!section)
        return null;
    const line = /^\s*url\s*=\s*(.+?)\s*$/m.exec(section[1]);
    return line ? line[1] : null;
}
/** The repository a locally developed package is checked out from, if any. */
function gitRepositoryOf(packageDir) {
    let dir;
    try {
        dir = realpathSync(packageDir);
    }
    catch {
        return undefined;
    }
    let current = dir;
    for (let depth = 0; depth < 12; depth += 1) {
        const gitPath = join(current, '.git');
        if (existsSync(gitPath)) {
            const url = readGitConfig(gitPath) ? gitOriginUrl(readGitConfig(gitPath)) : null;
            if (!url)
                return undefined;
            const directory = relative(current, dir).split(sep).join('/');
            return directory ? { type: 'git', url, directory } : { type: 'git', url };
        }
        const parent = dirname(current);
        if (parent === current)
            return undefined;
        current = parent;
    }
    return undefined;
}
function officialLinkOf(packageDir) {
    const manifest = readJsonFile(join(packageDir, 'package.json'));
    const link = {};
    if (manifest) {
        if (typeof manifest.homepage === 'string' && manifest.homepage.trim())
            link.homepage = manifest.homepage.trim();
        if (manifest.repository !== undefined)
            link.repository = manifest.repository;
    }
    if (!link.homepage && !link.repository) {
        const repository = gitRepositoryOf(packageDir);
        if (repository)
            link.repository = repository;
    }
    return link.homepage || link.repository ? link : null;
}
/**
 * Read the official link metadata of every profile-installed bundle whose
 * package directory is readable. Only `homepage` / `repository` values leave
 * this function; absolute paths never reach the browser.
 */
export function readOfficialLinks(profileDir) {
    const manifest = readJsonFile(join(profileDir, 'package.json'));
    if (!manifest)
        return {};
    const dependencies = manifest.dependencies;
    const dsh = manifest.dsh;
    const profile = dsh && typeof dsh === 'object' ? dsh.profile : undefined;
    const bundles = profile && typeof profile === 'object' ? profile.bundles : undefined;
    if (!dependencies || typeof dependencies !== 'object' || !Array.isArray(bundles))
        return {};
    const links = {};
    for (const name of bundles) {
        if (typeof name !== 'string' || !name)
            continue;
        if (!Object.prototype.hasOwnProperty.call(dependencies, name))
            continue;
        const link = officialLinkOf(join(profileDir, 'node_modules', name));
        if (link)
            links[name] = link;
    }
    return links;
}
function officialAddressesResponse(ctx) {
    const profile = ctx.profileContext ?? ctx.get('profileContext');
    const links = profile && typeof profile.dir === 'string' ? readOfficialLinks(profile.dir) : {};
    return Promise.resolve(new Response(JSON.stringify({ links }), {
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
        },
    }));
}
function registerOfficialAddressesRoute(ctx) {
    const webServer = ctx.get('webServer');
    if (!webServer || typeof webServer.register !== 'function')
        return;
    ctx.effect(() => webServer.register({
        kind: 'exact',
        path: OFFICIAL_ADDRESSES_PATH,
        resource: () => officialAddressesResponse(ctx),
    }), 'dsh-plugin-updater: official address route');
}
function startOfficialAddressesRoute(ctx) {
    if (typeof ctx.inject === 'function') {
        try {
            ctx.inject(['webServer'], (scope) => registerOfficialAddressesRoute(scope));
            return;
        }
        catch {
            /* fall through to the direct lookup below */
        }
    }
    registerOfficialAddressesRoute(ctx);
}
export const inject = ['commands', 'sessions'];
export function apply(ctx) {
    const handle = async (invocation) => {
        const sessionTitle = ctx.get('sessionTitle');
        if (!sessionTitle || typeof sessionTitle.refresh !== 'function') {
            return { kind: 'error', text: 'Session title service is not available in this app.' };
        }
        const session = ctx.sessions.get(invocation.agent.id);
        if (!session) {
            return { kind: 'error', text: 'Session is not live; open the conversation and try again.' };
        }
        try {
            const snapshot = await sessionTitle.refresh(session, invocation.signal);
            if (!snapshot || !snapshot.title) {
                return { kind: 'success', text: 'No eligible user message to generate a title from yet.' };
            }
            return { kind: 'success', text: 'Title refreshed: ' + snapshot.title };
        }
        catch (error) {
            return { kind: 'error', text: 'Session title refresh failed: ' + String(error?.message || error) };
        }
    };
    ctx.effect(() => ctx.commands.register({
        name: 'refresh-title',
        description: 'Regenerate this session title (also unpins a manually renamed title).',
        handler: handle,
    }), 'dsh-plugin-updater: /refresh-title command');
    startOfficialAddressesRoute(ctx);
}
