// ClearView site build. Netlify runs this on every save from the blog editor.
// It copies the finished site, then rebuilds everything that depends on the blog:
// the blog list, each post page, the home page blog cards, the embedded blog data,
// and the sitemap. No outside packages are needed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const DIST = path.join(ROOT, 'dist');
const POSTS_DIR = path.join(ROOT, 'content', 'blog');
const TPL = path.join(ROOT, 'templates');
const ORIGIN = 'https://www.clearviewas.com';

const CATEGORY_ICONS = {
  'Bookkeeping': 'ledger', 'Accounting Technology': 'laptop', 'Outsourcing': 'link', 'Payroll': 'cash',
  'Virtual CFO': 'trend', 'Human Resources': 'users', 'Sales Tax': 'receipt',
  'Accounts Receivable & Payable': 'swap', 'Growth': 'chart', 'Taxes': 'doc', 'News': 'doc',
};

// ---------- small helpers ----------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const words = (s) => s.split(/\s+/).filter(Boolean).length;
const fmtDate = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' });
};

// ---------- front matter (the small YAML subset Decap writes) ----------
function parseFrontMatter(text) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  const lines = m[1].split('\n');
  const data = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z0-9_]+):\s?(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let val = kv[2].trim();
    const cont = [];
    while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1] === '')) {
      if (lines[i + 1] === '' && !(i + 2 < lines.length && /^\s+\S/.test(lines[i + 2]))) break;
      cont.push(lines[++i]);
    }
    if (/^[>|][-+]?$/.test(val)) {
      const folded = val[0] === '>';
      const ind = Math.min(...cont.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length));
      const body = cont.map((l) => l.slice(ind));
      val = folded ? body.join('\n').replace(/([^\n])\n(?=[^\n])/g, '$1 ') : body.join('\n');
      val = val.replace(/\n+$/, '');
    } else {
      if (cont.length) val = [val, ...cont.map((l) => l.trim())].join(' ');
      if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
        try { val = JSON.parse(val.replace(/\\'/g, "'")); } catch { val = val.slice(1, -1); }
      } else if (val.startsWith("'") && val.endsWith("'") && val.length >= 2) {
        val = val.slice(1, -1).replace(/''/g, "'");
      } else if (val === 'null' || val === '~') {
        val = '';
      }
    }
    data[key] = val;
  }
  return { data, body: m[2] };
}

// ---------- Markdown -> HTML (headings, paragraphs, lists, quotes, links, images, emphasis) ----------
function inline(s) {
  const slots = [];
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  s = s.replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, (_, c) => keep(esc(c)));
  s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${esc(c)}</code>`));
  s = s.replace(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)/g,
    (_, alt, src, t) => keep(`<img src="${esc(src)}" alt="${esc(alt)}"${t ? ` title="${esc(t)}"` : ''} loading="lazy">`));
  s = s.replace(/\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"([^"]*)")?\s*\)/g, (_, txt, href) => {
    const safe = /^(https?:|mailto:|tel:|\/|#)/i.test(href) ? href : '#';
    const ext = /^https?:/i.test(safe) && !safe.includes('clearviewas.com');
    return keep(`<a href="${esc(safe)}"${ext ? ' target="_blank" rel="noopener"' : ''}>`) + txt + keep('</a>');
  });
  s = s.replace(/<br\s*\/?>/gi, () => keep('<br>'));
  s = esc(s);
  s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
  s = s.replace(/(\*|_)(?=\S)([\s\S]*?\S)\1/g, '<em>$2</em>');
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  s = s.replace(/ {2,}\n/g, '<br>').replace(/\\\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, n) => slots[n]);
}

function markdown(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const isBlank = (l) => !l.trim();
  const listRe = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    let h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      const lvl = Math.min(6, Math.max(2, h[1].length + (h[1].length === 1 ? 1 : 0)));
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); i++; continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(line)) {
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${markdown(q.join('\n'))}</blockquote>`); continue;
    }
    if (/^```/.test(line)) {
      const code = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++; out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); continue;
    }
    if (listRe.test(line)) {
      const ordered = /\d/.test(line.match(listRe)[2]);
      const items = [];
      while (i < lines.length) {
        const lm = lines[i].match(listRe);
        if (lm && (/\d/.test(lm[2]) === ordered)) { items.push(lm[3]); i++; continue; }
        if (!isBlank(lines[i]) && /^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1] += '\n' + lines[i].trim(); i++; continue; }
        if (isBlank(lines[i]) && i + 1 < lines.length && listRe.test(lines[i + 1])) { i++; continue; }
        break;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`); continue;
    }
    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && !/^(#{1,6})\s/.test(lines[i]) && !/^\s*>/.test(lines[i]) && !/^```/.test(lines[i]) && !(para.length && listRe.test(lines[i]))) para.push(lines[i++]);
    const p = para.join('\n');
    const onlyImg = /^!\[[^\]]*\]\([^)]+\)$/.test(p.trim());
    out.push(onlyImg ? `<figure>${inline(p.trim())}</figure>` : `<p>${inline(p)}</p>`);
  }
  return out.join('\n');
}

// ---------- load posts ----------
function loadPosts() {
  if (!fs.existsSync(POSTS_DIR)) return [];
  const posts = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md')).map((f) => {
    const file = f.replace(/\.md$/, '');
    const { data, body } = parseFrontMatter(fs.readFileSync(path.join(POSTS_DIR, f), 'utf8'));
    const title = (data.title || file.replace(/-/g, ' ')).trim();
    const cat = (data.category || 'News').trim();
    const html = markdown(body);
    const plain = body.replace(/[#>*_`\[\]()!-]/g, ' ');
    return {
      slug: 'post-' + file, path: '/blog/' + file, file,
      title, titleH: esc(title), excerpt: (data.excerpt || '').trim(),
      author: (data.author || 'ClearView Team').trim(), cat, icon: CATEGORY_ICONS[cat] || 'doc',
      date: data.date || '', dateLabel: fmtDate(data.date || ''), image: (data.image || '').trim(),
      mins: Math.max(2, Math.round(words(plain) / 220)), html,
      draft: String(data.draft || '').toLowerCase() === 'true',
    };
  }).filter((p) => !p.draft);
  posts.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0) || a.file.localeCompare(b.file));
  return posts;
}

// "--emit-blog": print the blog data (used to keep the design preview in sync)
if (process.argv.includes('--emit-blog')) {
  process.stdout.write(JSON.stringify(loadPosts().map(({ file, draft, ...p }) => p)));
  process.exit(0);
}

// ---------- build ----------
const t0 = Date.now();
const posts = loadPosts();
const clientPosts = posts.map(({ file, draft, ...p }) => p);
const blogJson = JSON.stringify(clientPosts).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(SITE, DIST, { recursive: true });
if (fs.existsSync(path.join(ROOT, 'admin'))) fs.cpSync(path.join(ROOT, 'admin'), path.join(DIST, 'admin'), { recursive: true });

const shell = fs.readFileSync(path.join(TPL, 'shell.html'), 'utf8');
const cta = fs.readFileSync(path.join(TPL, 'cta.html'), 'utf8');
const ORG = JSON.parse(fs.readFileSync(path.join(TPL, 'organization.json'), 'utf8'));
const staticPages = JSON.parse(fs.readFileSync(path.join(TPL, 'static-pages.json'), 'utf8'));

// icon paths and card patterns, read from the site's own script so they always match
const P = new Function('return ' + shell.match(/const P=(\{[\s\S]*?\});\n/)[1])();
const PATS = JSON.parse(shell.match(/const PATS=(\[[\s\S]*?\]);\n/)[1]);
const ic = (n, c = '') => `<svg class="ic ${c}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`;
const href = (p) => p.path + '/';

const card = (b, i) => `<a href="${href(b)}" class="post in" data-r=""><div class="art">${b.image ? `<img src="${esc(b.image)}" alt="" loading="lazy">` : `<div class="pat" style="background:${PATS[i % 3]}"></div>${ic(b.icon)}`}<span class="chip">${esc(b.cat)}</span></div><div class="meta"><b>${esc(b.cat)}</b><span>${b.mins} min read</span></div><h3>${b.titleH}</h3><span class="rd">Read post ${ic('arrow')}</span></a>`;

function head({ title, desc, url, type = 'website', schemas = [] }) {
  const t = esc(title), d = esc(desc);
  return [
    `<title>${t}</title>`, `<meta name="description" content="${d}">`,
    '<meta name="robots" content="index, follow, max-image-preview:large">',
    `<link rel="canonical" href="${url}">`,
    '<meta name="theme-color" content="#132D66">',
    '<link rel="icon" type="image/png" href="/img/favicon.png">', '<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">',
    '<meta property="og:site_name" content="ClearView Business and Accounting Solutions">',
    `<meta property="og:type" content="${type}">`, `<meta property="og:title" content="${t}">`,
    `<meta property="og:description" content="${d}">`, `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${ORIGIN}/img/og-image.png">`,
    '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">',
    '<meta property="og:locale" content="en_US">', '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${t}">`, `<meta name="twitter:description" content="${d}">`,
    `<meta name="twitter:image" content="${ORIGIN}/img/og-image.png">`,
    ...[ORG, ...schemas].map((s) => `<script type="application/ld+json">${JSON.stringify(s).replace(/</g, '\\u003c')}</script>`),
  ].join('\n');
}
const crumbs = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })) });

function page(file, headHtml, mainHtml) {
  let doc = shell.replace('<!--HEAD-->', () => headHtml).replace('<!--MAIN-->', () => mainHtml);
  const out = path.join(DIST, file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, doc);
}

// blog list
const blogMain = `
<section class="phero"><div class="wrap">
 <div class="crumb"><a href="/">Home</a><span>/</span><b>Blog</b></div>
 <h1 style="max-width:14ch">Real talk on <em>running your numbers.</em></h1>
 <p class="lead">Practical accounting and finance tips for small business owners.</p>
</div></section>
<section style="padding-top:0"><div class="wrap"><div class="blog-grid">${posts.map(card).join('')}</div></div></section>
${cta}`;
page('blog/index.html', head({
  title: 'Blog | Accounting & Finance Tips for Small Businesses | ClearView',
  desc: 'Practical accounting, payroll, human resources, and CFO advice for small business owners from the ClearView team.',
  url: ORIGIN + '/blog/',
  schemas: [crumbs([['Home', ORIGIN + '/'], ['Blog', ORIGIN + '/blog/']])],
}), blogMain);

// each post
posts.forEach((b, bi) => {
  const next = posts[(bi + 1) % posts.length];
  const initials = b.author === 'ClearView Team' ? 'CV' : b.author.split(/\s+/).map((x) => x[0]).join('');
  const url = ORIGIN + href(b);
  const main = `
<section class="phero" style="padding-bottom:40px"><div class="wrap" style="max-width:900px">
 <div class="crumb"><a href="/">Home</a><span>/</span><a href="/blog/">Blog</a><span>/</span><b>${esc(b.cat)}</b></div>
 <h1 class="post-h">${b.titleH}</h1>
 <div class="byline"><span class="av">${esc(initials)}</span><div><b>${esc(b.author)}</b><small>${esc(b.cat)}${b.dateLabel ? ' · ' + b.dateLabel : ''} · ${b.mins} min read</small></div></div>
</div></section>
<section style="padding-top:0"><div class="wrap" style="max-width:900px">
 <div class="post-art in" data-r="scale">${b.image ? `<img src="${esc(b.image)}" alt="">` : `<div class="pat" style="background:${PATS[bi % 3]}"></div>${ic(b.icon)}`}</div>
 <article class="prose in" data-r="">${b.html}</article>
 <div class="post-foot in" data-r=""><a href="/blog/" class="btn ghost">${ic('arrow', 'flip')} All posts</a>${posts.length > 1 ? `<a href="${href(next)}" class="next"><small>Next post</small><b>${next.titleH}</b></a>` : ''}</div>
</div></section>
${cta}`;
  const author = b.author === 'ClearView Team'
    ? { '@type': 'Organization', name: 'ClearView Business and Accounting Solutions' }
    : { '@type': 'Person', name: b.author, worksFor: { '@id': ORG['@id'] } };
  const article = { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: b.title, description: b.excerpt,
    author, publisher: { '@id': ORG['@id'] }, mainEntityOfPage: url, articleSection: b.cat,
    image: b.image ? (b.image.startsWith('http') ? b.image : ORIGIN + b.image) : ORIGIN + '/img/og-image.png',
    ...(Date.parse(b.date) ? { datePublished: new Date(b.date).toISOString(), dateModified: new Date(b.date).toISOString() } : {}) };
  page(`blog/${b.file}/index.html`, head({
    title: `${b.title} | ClearView Blog`, desc: b.excerpt || b.title, url, type: 'article',
    schemas: [article, crumbs([['Home', ORIGIN + '/'], ['Blog', ORIGIN + '/blog/'], [b.title, url]])],
  }), main);
});

// home page cards + embedded blog data in every page
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === 'admin' ? [] : walk(path.join(d, e.name))) : e.name.endsWith('.html') ? [path.join(d, e.name)] : []);
for (const f of walk(DIST)) {
  let s = fs.readFileSync(f, 'utf8');
  s = s.replace(/\/\*BLOG\*\/[\s\S]*?\/\*ENDBLOG\*\//, () => `/*BLOG*/${blogJson}/*ENDBLOG*/`);
  if (f === path.join(DIST, 'index.html')) {
    s = s.replace(/<!--BLOGCARDS-->[\s\S]*?<!--\/BLOGCARDS-->/, () => `<!--BLOGCARDS-->${posts.slice(0, 3).map(card).join('')}<!--/BLOGCARDS-->`);
  }
  fs.writeFileSync(f, s);
}

// sitemap
const today = new Date().toISOString().slice(0, 10);
const urls = [
  ...staticPages.map((p) => [ORIGIN + p.path, p.lastmod || today, p.priority]),
  [ORIGIN + '/blog/', today, '0.6'],
  ...posts.map((b) => [ORIGIN + href(b), (Date.parse(b.date) ? new Date(b.date) : new Date()).toISOString().slice(0, 10), '0.5']),
];
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  urls.map(([u, d, p]) => `  <url><loc>${u}</loc><lastmod>${d}</lastmod><priority>${p}</priority></url>`).join('\n') + '\n</urlset>\n');

console.log(`ClearView build: ${posts.length} blog posts, ${urls.length} sitemap URLs, ${Date.now() - t0} ms`);
