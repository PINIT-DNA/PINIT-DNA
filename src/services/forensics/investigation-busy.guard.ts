/** Process-local busy flag so Monitoring crawler does not starve investigation. */
let activeInvestigations = 0;

export function beginInvestigationWork(): void {
  activeInvestigations += 1;
}

export function endInvestigationWork(): void {
  activeInvestigations = Math.max(0, activeInvestigations - 1);
}

export function isInvestigationBusy(): boolean {
  return activeInvestigations > 0;
}
