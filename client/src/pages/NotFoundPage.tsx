import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="text-6xl mb-4 dna-float">🧬</div>
      <p className="text-6xl font-bold text-dna-500 mono mb-2">404</p>
      <h1 className="text-2xl font-bold text-white mb-2">Page Not Found</h1>
      <p className="text-gray-500 text-sm mb-8 max-w-xs">
        The page you're looking for doesn't exist in the PINIT-DNA system.
      </p>
      <Link to="/" className="btn btn-primary">
        <Home size={16} /> Return to Dashboard
      </Link>
    </div>
  );
}
