'use client';

import { useState } from 'react';
import { sendJson } from './useDashboard';
import type { RowAction } from './ProjectTable';

interface Props {
  root: string;
  rootExists: boolean;
  groups: Record<string, string[]>;
  selected: string[];
  /** Exécute un appel API ; les erreurs sont affichées par le parent. Renvoie true si l'appel a réussi. */
  request: (call: () => Promise<void>) => Promise<boolean>;
  onSelectGroup: (members: string[]) => void;
  onAction: (names: string[], action: RowAction) => void;
  onSwitchBranch: (names: string[]) => void;
  onOpenLogs: (names: string[]) => void;
}

const BTN =
  'h-8 px-3 text-xs border border-zinc-700 text-zinc-300 transition-colors enabled:hover:border-zinc-400 enabled:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed';
const INPUT = 'h-8 px-2 text-xs bg-black border border-zinc-700 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-400';

export default function Toolbar({ root, rootExists, groups, selected, request, onSelectGroup, onAction, onSwitchBranch, onOpenLogs }: Props) {
  const [rootDraft, setRootDraft] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');
  const none = selected.length === 0;
  const rootValue = rootDraft ?? root;
  const rootDirty = rootDraft !== null && rootDraft.trim() !== '' && rootDraft.trim() !== root;
  const groupEntries = Object.entries(groups);

  const applyRoot = async () => {
    if (await request(() => sendJson('/api/settings', 'PUT', { root: rootValue.trim() }))) setRootDraft(null);
  };

  const saveGroup = async () => {
    const name = groupName.trim();
    if (name === '' || none) return;
    if (name in groups && !window.confirm(`Le groupe « ${name} » existe déjà. Le remplacer ?`)) return;
    if (await request(() => sendJson('/api/groups', 'PUT', { name, members: selected }))) setGroupName('');
  };

  const deleteGroup = (name: string) => {
    if (!window.confirm(`Supprimer le groupe « ${name} » ?`)) return;
    void request(() => sendJson(`/api/groups?name=${encodeURIComponent(name)}`, 'DELETE'));
  };

  return (
    <div className="flex flex-col gap-3 px-3 py-3 border-b border-zinc-800 bg-zinc-950">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-zinc-600 mr-1">
          Sélection <span className="text-zinc-300">{selected.length}</span>
        </span>
        <button className={`${BTN} enabled:hover:!border-green-400 enabled:hover:!text-green-400`} disabled={none} onClick={() => onAction(selected, 'start')}>
          ▶ Démarrer
        </button>
        <button className={`${BTN} enabled:hover:!border-red-400 enabled:hover:!text-red-400`} disabled={none} onClick={() => onAction(selected, 'stop')}>
          ■ Arrêter
        </button>
        <button className={`${BTN} enabled:hover:!border-yellow-400 enabled:hover:!text-yellow-400`} disabled={none} onClick={() => onAction(selected, 'restart')}>
          ↺ Redémarrer
        </button>
        <button className={BTN} disabled={none} onClick={() => onOpenLogs(selected)}>
          Logs
        </button>
        <button className={BTN} disabled={none} onClick={() => onSwitchBranch(selected)}>
          Changer de branche
        </button>

        <form
          className="flex items-center gap-2 ml-auto"
          onSubmit={(e) => {
            e.preventDefault();
            void saveGroup();
          }}
        >
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Nom du groupe"
            aria-label="Nom du groupe"
            className={`${INPUT} w-40`}
          />
          <button type="submit" className={BTN} disabled={none || groupName.trim() === ''}>
            Enregistrer la sélection comme groupe
          </button>
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-2 min-h-7">
        <span className="text-[10px] uppercase tracking-widest text-zinc-600 mr-1">Groupes</span>
        {groupEntries.length === 0 && <span className="text-xs text-zinc-600">Aucun groupe enregistré</span>}
        {groupEntries.map(([name, members]) => (
          <span key={name} className="inline-flex items-stretch border border-zinc-700 text-xs">
            <button
              onClick={() => onSelectGroup(members)}
              title={members.join(', ') || 'Groupe vide'}
              className="px-2 py-1 text-zinc-200 hover:bg-zinc-800"
            >
              {name} <span className="text-zinc-500">({members.length})</span>
            </button>
            <button
              onClick={() => deleteGroup(name)}
              aria-label={`Supprimer le groupe ${name}`}
              title="Supprimer le groupe"
              className="px-1.5 border-l border-zinc-700 text-zinc-500 hover:bg-red-950 hover:text-red-400"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (rootDirty) void applyRoot();
        }}
      >
        <label htmlFor="root-input" className="text-[10px] uppercase tracking-widest text-zinc-600 mr-1">
          Dossier racine
        </label>
        <input
          id="root-input"
          value={rootValue}
          onChange={(e) => setRootDraft(e.target.value)}
          spellCheck={false}
          className={`${INPUT} w-[28rem] max-w-full ${rootExists ? '' : '!border-red-700'}`}
        />
        <button type="submit" className={BTN} disabled={!rootDirty}>
          Appliquer
        </button>
        {rootDraft !== null && (
          <button type="button" className="text-xs text-zinc-500 hover:text-zinc-300" onClick={() => setRootDraft(null)}>
            Annuler
          </button>
        )}
        {!rootExists && (
          <span className="text-xs text-red-400" role="alert">
            ⚠ Ce dossier n’existe pas : aucun projet ne peut être détecté.
          </span>
        )}
      </form>
    </div>
  );
}
