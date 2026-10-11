export type RouteCategory =
  | 'tram'
  | 'subway'
  | 'rail'
  | 'bus'
  | 'ferry'
  | 'cable'
  | 'aerial'
  | 'funicular'
  | 'trolleybus'
  | 'monorail'
  | 'other';

export const CATEGORY_LABELS: Readonly<Record<RouteCategory, string>> = {
  tram: 'Tram',
  subway: 'Subway',
  rail: 'Rail',
  bus: 'Bus',
  ferry: 'Ferry',
  cable: 'Cable car',
  aerial: 'Aerial lift',
  funicular: 'Funicular',
  trolleybus: 'Trolleybus',
  monorail: 'Monorail',
  other: 'Other',
};

export const CATEGORY_COLORS: Readonly<Record<RouteCategory, string>> = {
  tram: '#d97706',
  subway: '#7c3aed',
  rail: '#1d4ed8',
  bus: '#0f766e',
  ferry: '#0284c7',
  cable: '#b45309',
  aerial: '#be185d',
  funicular: '#a16207',
  trolleybus: '#15803d',
  monorail: '#6d28d9',
  other: '#475569',
};

const BASIC: Readonly<Record<number, RouteCategory>> = {
  0: 'tram',
  1: 'subway',
  2: 'rail',
  3: 'bus',
  4: 'ferry',
  5: 'cable',
  6: 'aerial',
  7: 'funicular',
  11: 'trolleybus',
  12: 'monorail',
};

/** Maps basic and extended (Google) route types to a display category. */
export function routeCategory(routeType: number): RouteCategory {
  const basic = BASIC[routeType];
  if (basic !== undefined) return basic;
  if (routeType >= 100 && routeType < 200) return 'rail';
  if (routeType >= 200 && routeType < 300) return 'bus';
  if (routeType >= 400 && routeType < 500) return 'subway';
  if (routeType >= 700 && routeType < 800) return 'bus';
  if (routeType >= 800 && routeType < 900) return 'trolleybus';
  if (routeType >= 900 && routeType < 1000) return 'tram';
  if (routeType >= 1000 && routeType < 1300) return 'ferry';
  if (routeType >= 1300 && routeType < 1400) return 'aerial';
  if (routeType >= 1400 && routeType < 1500) return 'funicular';
  return 'other';
}

/** GTFS colors are 6 hex digits without '#'; tolerate a leading '#'. */
export function normalizeColor(raw: string | null): string | null {
  if (raw === null) return null;
  const hex = raw.trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(hex) ? `#${hex.toLowerCase()}` : null;
}

export function contrastText(background: string): string {
  const hex = background.replace(/^#/, '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#000000' : '#ffffff';
}

function relativeLuminance(color: string): number {
  const hex = color.replace(/^#/, '');
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG 2 contrast ratio between two `#rrggbb` colors, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function routeLabel(route: {
  readonly routeId: string;
  readonly shortName: string | null;
  readonly longName: string | null;
}): string {
  if (route.shortName !== null && route.longName !== null) {
    return `${route.shortName} · ${route.longName}`;
  }
  return route.shortName ?? route.longName ?? route.routeId;
}
