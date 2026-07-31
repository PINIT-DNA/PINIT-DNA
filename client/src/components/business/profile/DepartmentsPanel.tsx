import { useState } from 'react';
import { Layers, Plus, Trash2, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { useOrganizationDepartments } from '../../../hooks/useOrganizationDepartments';
import { EnterpriseCard, EnterpriseField } from './shared';

export function DepartmentsPanel() {
  const { departments, loading, create, update, remove } = useOrganizationDepartments();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await create({ name: name.trim(), description: description.trim() || undefined });
      toast.success('Department created');
      setName('');
      setDescription('');
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.error((err as any)?.response?.data?.error ?? 'Could not create department');
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(id: string) {
    try {
      await update(id, { name: editName.trim(), description: editDesc.trim() || undefined });
      toast.success('Department updated');
      setEditingId(null);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toast.error((err as any)?.response?.data?.error ?? 'Update failed');
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <EnterpriseCard title="Create department" icon={<Plus size={16} />}>
        <form onSubmit={(e) => void handleCreate(e)} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <EnterpriseField label="Department name" value={name} onChange={setName} placeholder="Legal" />
          <EnterpriseField label="Description" value={description} onChange={setDescription} placeholder="Optional" />
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold disabled:opacity-60"
            >
              Add department
            </button>
          </div>
        </form>
      </EnterpriseCard>

      <EnterpriseCard title={`Departments (${departments.length})`} icon={<Layers size={16} />}>
        {departments.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">No departments yet. Create one to organize assets and teams.</p>
        ) : (
          <ul className="divide-y divide-bg-border -mx-1">
            {departments.map((d) => (
              <li key={d.id} className="py-3">
                {editingId === d.id ? (
                  <div className="space-y-3">
                    <EnterpriseField label="Name" value={editName} onChange={setEditName} />
                    <EnterpriseField label="Description" value={editDesc} onChange={setEditDesc} />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleUpdate(d.id)}
                        className="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-3 py-1.5 rounded-lg border border-bg-border text-xs text-gray-400"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">{d.name}</p>
                      {d.description && <p className="text-2xs text-gray-500 mt-0.5">{d.description}</p>}
                      <p className="text-2xs text-gray-600 mt-1">{d.memberCount} members · {d.assetCount} assets</p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(d.id);
                          setEditName(d.name);
                          setEditDesc(d.description ?? '');
                        }}
                        className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-bg-elevated"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(d.id).then(() => toast.success('Department removed'))}
                        className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </EnterpriseCard>
    </div>
  );
}
