/**
 * Browser storage needed per byte of downloaded zip. Measured: MBTA ~14x, Tokyo Metro ~19x, Hong Kong Transport
 * Department ~28x (stop_times-heavy feeds compress best); rounded up so the warning errs on the side of caution.
 */
export const STORAGE_HEADROOM = 30;
