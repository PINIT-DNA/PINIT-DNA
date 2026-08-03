import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { TeamPanel } from '../../components/business/profile/TeamPanel';

export function BusinessTeamPage() {
  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6 pb-12">
      <div>
        <div className="inline-flex items-center gap-2 text-purple-400 text-sm font-medium mb-1">
          <Users size={14} />
          Team Management
        </div>
        <h1 className="text-2xl font-bold text-white">Organization Team</h1>
        <p className="text-sm text-gray-400 mt-1">
          Create an invite link, share it, and they join automatically when they open it.
        </p>
      </div>
      <TeamPanel />
      <Link to="/profile?tab=team" className="text-sm text-dna-400 hover:underline">← Back to profile</Link>
    </div>
  );
}
