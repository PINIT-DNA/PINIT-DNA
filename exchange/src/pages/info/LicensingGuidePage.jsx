import React from 'react';
import InfoPage from '../../components/InfoPage.jsx';

export default function LicensingGuidePage({ onNavigate }) {
  return (
    <InfoPage
      onNavigate={onNavigate}
      crumbs={[{ label: 'Trust', page: 'trust' }, { label: 'Licensing Guide' }]}
      eyebrow="Licensing Guide"
      title="What you are buying — and what creators keep"
      subtitle="A license is permission to use a work under stated terms. Always review the specific license attached to an asset before purchase."
      related={[
        { page: 'marketplace', label: 'Marketplace', desc: 'Browse licensed assets' },
        { page: 'license_agreement', label: 'License Agreement', desc: 'Formal grant and restrictions' },
        { page: 'creator_program', label: 'Creator Program', desc: 'How creators list work' },
      ]}
      primaryCta={{ label: 'Browse licensed assets', onClick: () => onNavigate?.('marketplace') }}
      secondaryCta={{ label: 'Read the license agreement', onClick: () => onNavigate?.('license_agreement') }}
    >
      <h2>What is a license?</h2>
      <p>
        Purchasing on Pinit Exchange grants a license to use the asset as described for that
        listing. It does not automatically transfer copyright ownership unless the listing
        and checkout explicitly say so.
      </p>

      <div className="info-table-wrap" role="region" aria-label="License comparison" tabIndex={0}>
        <table className="info-table">
          <thead>
            <tr>
              <th>License type</th>
              <th>Best for</th>
              <th>Commercial use</th>
              <th>Exclusive</th>
              <th>Transferable</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Personal</td>
              <td>Portfolio, learning, non-monetized use</td>
              <td>No</td>
              <td>No</td>
              <td>No</td>
            </tr>
            <tr>
              <td>Commercial</td>
              <td>Client work, ads, social, product UI</td>
              <td>Yes, as stated</td>
              <td>No</td>
              <td>No</td>
            </tr>
            <tr>
              <td>Exclusive</td>
              <td>One buyer wants unique rights</td>
              <td>Yes, as stated</td>
              <td>Yes, for that listing</td>
              <td>Only if the listing says so</td>
            </tr>
            <tr>
              <td>Enterprise</td>
              <td>Teams and multi-seat use</td>
              <td>Yes, as stated</td>
              <td>Negotiated</td>
              <td>Within the licensed org</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="info-note">This table is a product overview. The listing and checkout terms control the actual grant.</p>

      <h2>Ownership vs licensing</h2>
      <p>
        Creators typically retain copyright. Buyers receive the usage rights they paid for,
        plus licensed delivery from Pinit HUB. Masters remain protected in the vault.
      </p>

      <h2>What buyers receive</h2>
      <ul>
        <li>A sealed license record for that purchase</li>
        <li>Authorized download or delivery of the licensed files</li>
        <li>The usage scope shown at checkout (personal, commercial, exclusive, or enterprise)</li>
      </ul>

      <h2>What creators retain</h2>
      <ul>
        <li>Copyright, unless a listing explicitly sells it</li>
        <li>Vaulted original in Pinit HUB</li>
        <li>The ability to keep selling non-exclusive licenses until an exclusive deal delists the asset</li>
      </ul>

      <h2>Restrictions and delivery</h2>
      <p>
        Do not resell the file as a competing stock asset, claim authorship of the original,
        or exceed seats, territories, or media listed on the license. Client delivery is allowed
        when the commercial or enterprise terms say so.
      </p>
    </InfoPage>
  );
}
