/**
 * GeneratePage — wraps the existing DNA generation flow (App.tsx).
 * The full generation pipeline (upload → 6 layers → encrypt → vault) lives here.
 */
import App from '../App';
import { IS_NATIVE_APP } from '../native/platform';

export function GeneratePage() {
  return (
    <div className={IS_NATIVE_APP ? '' : '-m-6'}>
      <App />
    </div>
  );
}
