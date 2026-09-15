import React from 'react';

export default function StudioPage({ title, subtitle, actions, children }) {
  return (
    <div className="studio-mod">
      <header className="studio-mod__head">
        <div>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="studio-mod__actions">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}
