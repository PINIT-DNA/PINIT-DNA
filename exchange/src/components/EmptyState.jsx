import React from 'react';

export default function EmptyState({
  title,
  description,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  icon = null,
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state__icon">{icon}</div>}
      <h3 className="empty-state__title">{title}</h3>
      {description && <p className="empty-state__desc">{description}</p>}
      <div className="empty-state__actions">
        {primaryLabel && onPrimary && (
          <button type="button" className="btn-primary" onClick={onPrimary}>
            {primaryLabel}
          </button>
        )}
        {secondaryLabel && onSecondary && (
          <button type="button" className="btn-secondary" onClick={onSecondary}>
            {secondaryLabel}
          </button>
        )}
      </div>
    </div>
  );
}
