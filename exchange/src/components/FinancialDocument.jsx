import React from 'react';

export default function FinancialDocument({ document: doc }) {
  if (!doc) return null;
  return (
    <article className="fin-doc">
      <header className="fin-doc__brand">
        <img src="/pinit-hub-emblem-cut.png" alt="" width="36" height="36" />
        <div>
          <p className="fin-doc__name">PINIT</p>
          <p className="fin-doc__title">{doc.title}</p>
        </div>
        <p className="fin-doc__number">{doc.number}</p>
      </header>
      <dl className="fin-doc__meta">
        <div><dt>Date</dt><dd>{doc.issuedAt ? new Date(doc.issuedAt).toLocaleString() : '—'}</dd></div>
        <div><dt>Status</dt><dd>{doc.status || '—'}</dd></div>
      </dl>
      <div className="fin-doc__parties">
        {(doc.parties || []).map((person) => (
          <div key={person.role}>
            <p className="fin-doc__role">{person.role}</p>
            <p className="fin-doc__who">{person.name}</p>
            {person.pinitId ? <p className="fin-doc__id">{person.pinitId}</p> : null}
          </div>
        ))}
      </div>
      {doc.item?.title ? (
        <p className="fin-doc__item">{doc.item.title}{doc.item.detail ? <span>{doc.item.detail}</span> : null}</p>
      ) : null}
      <table className="fin-doc__lines">
        <tbody>
          {(doc.lines || []).map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.display}</td>
            </tr>
          ))}
          {(doc.totals || []).map((row) => (
            <tr key={row.label} className={row.emphasis ? 'is-total' : ''}>
              <th scope="row">{row.label}</th>
              <td>{row.amount == null ? 'Not applied' : row.display}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(doc.notes || []).map((note) => <p key={note} className="fin-doc__note">{note}</p>)}
    </article>
  );
}
