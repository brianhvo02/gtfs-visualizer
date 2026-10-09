import type {ReactElement} from 'react';

export function ErrorMessage({error}: {readonly error: unknown}): ReactElement {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <p role="alert" className="error">
      Something went wrong: {message}
    </p>
  );
}
