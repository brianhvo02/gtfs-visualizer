import {MapUnavailableError, type LightSetting, type MapAdapter} from './adapter.ts';

/** `lightSetting` is applied before the first frame so the map doesn't flash the wrong preset. */
export async function createMap(container: HTMLElement, lightSetting: LightSetting): Promise<MapAdapter> {
  if (import.meta.env.VITE_MAP_PROVIDER === 'fake') {
    const {createFakeAdapter} = await import('./fake-adapter.ts');
    return await createFakeAdapter(container);
  }
  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  if (token === undefined || token.length === 0) throw new MapUnavailableError('missing_token');
  const {createMapboxAdapter} = await import('./mapbox-adapter.ts');
  return await createMapboxAdapter(container, token, lightSetting);
}
