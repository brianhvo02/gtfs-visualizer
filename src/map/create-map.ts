import {MapUnavailableError, type MapAdapter} from './adapter.ts';

export async function createMap(container: HTMLElement): Promise<MapAdapter> {
  if (import.meta.env.VITE_MAP_PROVIDER === 'fake') {
    const {createFakeAdapter} = await import('./fake-adapter.ts');
    return await createFakeAdapter(container);
  }
  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  if (token === undefined || token.length === 0) throw new MapUnavailableError('missing_token');
  const {createMapboxAdapter} = await import('./mapbox-adapter.ts');
  return await createMapboxAdapter(container, token);
}
