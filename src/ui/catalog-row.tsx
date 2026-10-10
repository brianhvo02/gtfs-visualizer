import {useState, type ReactElement} from 'react';
import type {CatalogEntry} from '../catalog/catalog-types.ts';
import {forgetKey, getKey, setKey} from '../catalog/key-store.ts';
import type {ImportFailure, ImportSource} from '../shared/types.ts';

export interface CatalogRowProps {
  readonly entry: CatalogEntry;
  readonly busy: boolean;
  readonly onImport: (source: ImportSource) => void;
  /** The last import failure, only when it belongs to this entry. */
  readonly failure: ImportFailure | null;
  /** Bumped by the picker whenever any saved key changes, so every row re-reads its key. */
  readonly keysVersion: number;
  readonly onKeysChanged: () => void;
}

const BADGES = {direct: 'Direct', key: 'Key required', download: 'Download manually'} as const;

function DownloadInstructions({
  entry,
  href,
  busy,
  onImport,
}: {
  readonly entry: CatalogEntry;
  readonly href: string;
  readonly busy: boolean;
  readonly onImport: (source: ImportSource) => void;
}): ReactElement {
  const {access} = entry;
  return (
    <div className="row-expanded">
      {access.kind === 'key' ? (
        <>
          <p className="muted">
            Your browser couldn't download this feed directly. Download it from the provider with your key, then upload
            the file here.
          </p>
          <a href={access.signupUrl} target="_blank" rel="noreferrer">
            Get a key
          </a>
        </>
      ) : (
        <>
          <p className="muted">Download the feed from the provider, then upload it here.</p>
          <a href={href} target="_blank" rel="noreferrer" aria-label={`Download ${entry.name}`}>
            Download
          </a>
        </>
      )}
      <label className="file-label">
        Upload downloaded file
        <input
          type="file"
          accept=".zip,application/zip"
          aria-label={`Upload downloaded file for ${entry.name}`}
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file !== undefined) onImport({kind: 'catalog-file', entry, file});
          }}
        />
      </label>
    </div>
  );
}

export function CatalogRow({entry, busy, onImport, failure, keysVersion, onKeysChanged}: CatalogRowProps): ReactElement {
  const {access} = entry;
  const [keyInput, setKeyInput] = useState('');
  const [blocked, setBlocked] = useState(false);
  if (failure?.code === 'blocked' && !blocked) setBlocked(true);
  // keysVersion is read so a key saved or forgotten on another row is picked up here.
  const savedKey = access.kind === 'key' && keysVersion >= 0 ? getKey(access.provider) : null;

  let actions: ReactElement;
  if (access.kind === 'download') {
    actions = (
      <DownloadInstructions
        entry={entry}
        href={access.pageUrl ?? entry.originalUrl ?? entry.url}
        busy={busy}
        onImport={onImport}
      />
    );
  } else if (blocked) {
    actions = <DownloadInstructions entry={entry} href={entry.originalUrl ?? entry.url} busy={busy} onImport={onImport} />;
  } else if (access.kind === 'key') {
    const rejected = failure?.code === 'key_rejected';
    const forget = (
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          forgetKey(access.provider);
          onKeysChanged();
        }}
      >
        {`Forget key for ${access.provider}`}
      </button>
    );
    if (savedKey !== null && !rejected) {
      actions = (
        <span className="row-actions">
          <button
            type="button"
            disabled={busy}
            aria-label={`Import ${entry.name}`}
            onClick={() => onImport({kind: 'catalog', entry, key: savedKey})}
          >
            Import
          </button>
          {forget}
        </span>
      );
    } else {
      actions = (
        <form
          className="row-expanded key-form"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = keyInput.trim();
            if (trimmed === '') return;
            setKey(access.provider, trimmed);
            setKeyInput('');
            onKeysChanged();
            onImport({kind: 'catalog', entry, key: trimmed});
          }}
        >
          <a href={access.signupUrl} target="_blank" rel="noreferrer">
            Get a key
          </a>
          <input
            type="password"
            autoComplete="off"
            aria-label={`API key for ${access.provider}`}
            value={keyInput}
            onChange={(event) => setKeyInput(event.target.value)}
          />
          <span className="row-actions">
            <button type="submit" disabled={busy} aria-label={`Save key and import ${entry.name}`}>
              Save key and import
            </button>
            {savedKey !== null && forget}
          </span>
        </form>
      );
    }
  } else {
    actions = (
      <button
        type="button"
        disabled={busy}
        aria-label={`Import ${entry.name}`}
        onClick={() => onImport({kind: 'catalog', entry, key: null})}
      >
        Import
      </button>
    );
  }

  return (
    <li className="catalog-row">
      <span>{entry.name}</span>
      <span className="muted">{entry.place}</span>
      <span className="badge badge-neutral">{BADGES[access.kind]}</span>
      {actions}
    </li>
  );
}
