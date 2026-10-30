/**
 * Host half of dsh-my-plugin-updater.
 *
 * Registers the global session command `/refresh-title`, which regenerates the
 * receiving session's title and thereby unpins a manually renamed title. The
 * browser half adds a "Refresh title" item to each session row's menu.
 */
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
    }), 'dsh-my-plugin-updater: /refresh-title command');
}
