import React from 'react';

/** In-page sub-nav for one seller area. Not a second global tab bar. */
export default function SellerContextNav({ items, value, onChange, label = 'Section' }) {
  if (!items?.length) return null;
  return (
    <nav className="seller-context-nav" aria-label={label}>
      {items.map(([id, name]) => (
        <button
          key={id}
          type="button"
          className={value === id ? 'is-on' : ''}
          onClick={() => onChange(id)}
        >
          {name}
        </button>
      ))}
    </nav>
  );
}
