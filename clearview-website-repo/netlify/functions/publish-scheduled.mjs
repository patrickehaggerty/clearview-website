// Publishes scheduled blog posts on time.
// Every 15 minutes this checks the live site's list of upcoming publish times
// (/blog/schedule.json, written by scripts/build.mjs). When a scheduled post's time
// has passed, it calls the site's Netlify build hook so the site rebuilds and the post goes live.
// Needs one environment variable in Netlify: BUILD_HOOK_URL (the build hook's URL).

export default async () => {
  const hook = process.env.BUILD_HOOK_URL;
  const site = process.env.URL; // the site's main address, provided by Netlify
  if (!hook || !site) {
    console.log('Scheduled publishing is off: set BUILD_HOOK_URL in Netlify environment variables.');
    return new Response('not configured');
  }

  let scheduled = [];
  try {
    const res = await fetch(`${site}/blog/schedule.json?t=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ({ scheduled = [] } = await res.json());
  } catch (err) {
    console.log('Could not read the schedule:', err.message);
    return new Response('schedule unavailable');
  }

  const due = scheduled.filter((iso) => Date.parse(iso) <= Date.now());
  if (!due.length) return new Response(`nothing due (${scheduled.length} scheduled)`);

  const r = await fetch(hook, { method: 'POST' });
  console.log(`Rebuilding to publish ${due.length} scheduled post(s): ${due.join(', ')} (build hook answered ${r.status})`);
  return new Response('rebuild started');
};

export const config = { schedule: '*/15 * * * *' };
