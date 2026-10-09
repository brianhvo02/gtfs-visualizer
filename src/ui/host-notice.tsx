import type {ReactElement} from 'react';
import type {FeedApi} from '../db-client/feed-api.ts';
import type {HostState} from '../db-client/worker-host.ts';

export interface HostNoticeProps {
  readonly state: HostState<FeedApi>;
  readonly onTakeOver: () => void;
}

export function HostNotice({state, onTakeOver}: HostNoticeProps): ReactElement {
  let body: ReactElement;
  switch (state.kind) {
    case 'starting':
    case 'ready':
      body = <p className="muted">Starting…</p>;
      break;
    case 'other-tab':
      body = (
        <>
          <p>GTFS Visualizer is already open in another tab.</p>
          <p className="muted">Close it, or use the app here instead.</p>
          <button type="button" onClick={onTakeOver}>
            Take over
          </button>
        </>
      );
      break;
    case 'taken-over':
      body = (
        <>
          <p>This window was disconnected because the app was opened in another tab.</p>
          <button type="button" onClick={onTakeOver}>
            Use it here
          </button>
        </>
      );
      break;
    case 'unsupported':
      body = (
        <>
          <p>This browser can't run GTFS Visualizer: {state.reason}</p>
          <p className="muted">Use a current version of Chrome, Edge, Firefox, or Safari.</p>
        </>
      );
      break;
    case 'crashed':
      body = (
        <>
          <p role="alert">The data worker stopped unexpectedly: {state.message}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </>
      );
      break;
  }
  return (
    <main className="notice-page">
      <h1>GTFS Visualizer</h1>
      {body}
    </main>
  );
}
