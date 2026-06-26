/**
 * GeneratePage — wraps the existing DNA generation flow (App.tsx).
 * The full generation pipeline (upload → 6 layers → encrypt → vault) lives here.
 */
import App from '../App';

export function GeneratePage() {
  return (
    <div className="-m-6">
      <App />
    </div>
  );
}
