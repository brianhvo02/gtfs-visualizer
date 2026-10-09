export function isBrowserSupported(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function' &&
    typeof navigator.locks?.request === 'function'
  );
}
