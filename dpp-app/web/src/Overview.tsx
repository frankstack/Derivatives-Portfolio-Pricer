// The platform write-up. Its text and images are carried over from the previous site at build time.
import { useEffect, useState } from 'react';
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
  const rail = (
    <>
      <h3>On this page</h3>
      <p className="note">
        How the platform is put together: the front door, the application and database layers, the pricing engine, the data pipeline and the monitoring around them.
      </p>
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
