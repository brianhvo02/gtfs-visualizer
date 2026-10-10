import type {FeatureCollection} from 'geojson';
import {
  matchesFilter,
  type Bounds,
  type LayerFilter,
  type LayerSpec,
  type MapAdapter,
  type MapFeature,
} from './adapter.ts';

interface FakeState {
  readonly filters: Record<string, LayerFilter>;
  readonly opacity: Record<string, number>;
  fitBoundsCount: number;
  lastBounds: Bounds | null;
  language: string | null;
}

interface ClickEntry {
  readonly layerIds: readonly string[];
  readonly handler: (feature: MapFeature) => void;
}

/** Renders features as buttons so E2E tests can see and click "map" features without WebGL. */
class FakeMapAdapter implements MapAdapter {
  private readonly root: HTMLElement;
  private readonly sources = new Map<string, FeatureCollection>();
  private readonly layers: LayerSpec[] = [];
  private readonly clickHandlers = new Set<ClickEntry>();
  private readonly state: FakeState = {filters: {}, opacity: {}, fitBoundsCount: 0, lastBounds: null, language: null};

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'fake-map';
    this.root.dataset['testid'] = 'fake-map';
    container.append(this.root);
    this.render();
  }

  setSource(id: string, data: FeatureCollection): void {
    this.sources.set(id, data);
    this.render();
  }

  addLayer(spec: LayerSpec): void {
    this.layers.push(spec);
    this.state.filters[spec.id] = spec.filter ?? {kind: 'all'};
    this.render();
  }

  removeLayer(id: string): void {
    const index = this.layers.findIndex((layer) => layer.id === id);
    if (index >= 0) this.layers.splice(index, 1);
    delete this.state.filters[id];
    this.render();
  }

  setFilter(layerId: string, filter: LayerFilter): void {
    this.state.filters[layerId] = filter;
    this.render();
  }

  setOpacity(layerId: string, opacity: number): void {
    this.state.opacity[layerId] = opacity;
    this.render();
  }

  fitBounds(bounds: Bounds): void {
    this.state.fitBoundsCount++;
    this.state.lastBounds = bounds;
    this.render();
  }

  setLanguage(lang: string | null): void {
    this.state.language = lang;
    this.render();
  }

  onFeatureClick(layerIds: readonly string[], handler: (feature: MapFeature) => void): () => void {
    const entry = {layerIds, handler};
    this.clickHandlers.add(entry);
    return () => {
      this.clickHandlers.delete(entry);
    };
  }

  onFeatureHover(): () => void {
    return () => {};
  }

  destroy(): void {
    this.root.remove();
  }

  private render(): void {
    this.root.dataset['state'] = JSON.stringify(this.state);
    const list = document.createElement('ul');
    for (const layer of this.layers) {
      if (layer.minZoom !== undefined) continue;
      const filter = this.state.filters[layer.id] ?? {kind: 'all'};
      for (const feature of this.sources.get(layer.source)?.features ?? []) {
        const properties: Readonly<Record<string, unknown>> = feature.properties ?? {};
        if (!matchesFilter(filter, properties)) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset['layer'] = layer.id;
        button.textContent = String(properties['name'] ?? '');
        button.addEventListener('click', () => this.click({layerId: layer.id, properties}));
        const item = document.createElement('li');
        item.append(button);
        list.append(item);
      }
    }
    this.root.replaceChildren(list);
  }

  private click(feature: MapFeature): void {
    for (const {layerIds, handler} of this.clickHandlers) {
      if (layerIds.includes(feature.layerId)) handler(feature);
    }
  }
}

export async function createFakeAdapter(container: HTMLElement): Promise<MapAdapter> {
  return new FakeMapAdapter(container);
}
