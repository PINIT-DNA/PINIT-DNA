import { hubLoginUrl } from '@/lib/site';

export function Footer({ contact }: { contact: boolean }) {
  return (
    <footer className="band-ink">
      <div className="lp-shell">
        <div className="foot">
          <div>
            <a className="logo" href="#top" aria-label="Back to top">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="logo-img" src="/brand/pinithub-emblem.png" width={34} height={34} alt="" />
              PINIT HUB
            </a>
            <p style={{ marginTop: 12, maxWidth: '34ch' }}>Protect any asset, track it live, and prove it&rsquo;s yours.</p>
          </div>
          <div>
            <h5>Product</h5>
            <ul>
              <li><a href="#product">Product</a></li>
              <li><a href="#tracking">How it works</a></li>
              <li><a href="#business">Business</a></li>
              <li><a href="#exchange">Exchange</a></li>
            </ul>
          </div>
          <div>
            <h5>Trust</h5>
            <ul>
              <li><a href="#security">Security</a></li>
              <li><a href="#verify">Verify ownership</a></li>
              <li><a href="#files">Asset types</a></li>
            </ul>
          </div>
          <div>
            <h5>Get started</h5>
            <ul>
              <li><a href={hubLoginUrl()}>Sign in</a></li>
              {contact ? <li><a href="#demo">Book a demo</a></li> : null}
              <li><a href="https://www.pinitexchange.com" target="_blank" rel="noopener noreferrer">PINIT Exchange</a></li>
            </ul>
          </div>
        </div>
        <p className="copyright">PINITHUB · TheCareerTech Pvt. Ltd., Bangalore</p>
      </div>
    </footer>
  );
}
