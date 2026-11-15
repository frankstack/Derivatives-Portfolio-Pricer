// The platform write-up. Its text is overview/overview.html, put into the build by scripts/prebuild.mjs.
import { useEffect, useMemo, useState } from 'react';
import { Shell } from './shell';
import type { Ctx } from './shell';

export function Overview(p: { ctx: Ctx }) {
  const [html, setHtml] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch('overview.html')
      .then((r) => {
        if (!r.ok) throw new Error('missing');
        return r.text();
      })
      .then(setHtml)
      .catch(() => setFailed(true));
  }, []);
  // The section headings of the text, listed in the right rail.
  const sections = useMemo(() => {
    const found: { id: string; title: string }[] = [];
    const re = /<section class="ov-sec" id="([^"]+)">\s*<h3>([^<]+)<\/h3>/g;
    let m = re.exec(html);
    while (m !== null) {
      found.push({ id: m[1], title: m[2] });
      m = re.exec(html);
    }
    return found;
  }, [html]);
  const goTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  };
  const rail = (
    <>
      <h3>On this page</h3>
      {sections.length ? (
        <ul className="toc">
          {sections.map((s) => (
            <li key={s.id}>
              <button type="button" className="link" onClick={() => goTo(s.id)}>{s.title}</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">How the platform is put together, layer by layer.</p>
      )}
      <h3>Source code</h3>
      <p className="note">
        <a href="https://github.com/frankstack/Derivatives-Portfolio-Pricer" target="_blank" rel="noreferrer">github.com/frankstack/Derivatives-Portfolio-Pricer</a>
      </p>
    </>
  );
  return (
    <Shell ctx={p.ctx} title="Overview" sub="How the platform is built" railTitle="About" rail={rail}>
      {failed ? <div className="notice">The overview text could not be loaded.</div> : <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />}
    </Shell>
  );
}
