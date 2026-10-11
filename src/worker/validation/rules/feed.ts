import {contrastRatio, normalizeColor} from '../../../gtfs/route-types.ts';
import {toIsoDate} from '../../../gtfs/time.ts';
import {asString} from '../../sql-values.ts';
import {createNames, type Names} from '../names.ts';
import type {CheckContext, ValidationCheck} from '../runner.ts';

/** Text on a route color below this ratio is hard to read. */
const MIN_CONTRAST = 3;

function summaryValue(ctx: CheckContext, key: string): string | null {
  return asString(ctx.db.selectValue('SELECT value FROM feed_summary WHERE key = ?', [key]));
}

function emitServiceWindow(ctx: CheckContext): void {
  const start = summaryValue(ctx, 'service_start');
  const end = summaryValue(ctx, 'service_end');
  if (end !== null && end < ctx.today) {
    ctx.emit('feed_expired', {message: `Service in this feed ended on ${toIsoDate(end)}.`});
  }
  if (start !== null && start > ctx.today) {
    ctx.emit('feed_not_yet_active', {message: `Service in this feed starts on ${toIsoDate(start)}.`});
  }
}

function emitLowContrast(ctx: CheckContext): void {
  const names = createNames(ctx.db);
  try {
    emitLowContrastWith(ctx, names);
  } finally {
    names.finalize();
  }
}

function emitLowContrastWith(ctx: CheckContext, names: Names): void {
  const rows = ctx.db.selectObjects('SELECT route_id, route_color, route_text_color FROM routes ORDER BY route_id');
  for (const row of rows) {
    const rawColor = (asString(row['route_color']) ?? '').trim();
    const rawText = (asString(row['route_text_color']) ?? '').trim();
    if (rawColor === '' && rawText === '') continue;
    const color = rawColor === '' ? '#ffffff' : normalizeColor(rawColor);
    const text = rawText === '' ? '#000000' : normalizeColor(rawText);
    if (color === null || text === null) continue;
    const ratio = contrastRatio(color, text);
    if (ratio >= MIN_CONTRAST) continue;
    const routeId = asString(row['route_id']) ?? '';
    ctx.emit('route_color_contrast', {
      routeId,
      details: {ratio},
      message: `Route ${names.route(routeId)}'s text has a contrast ratio of ${ratio.toFixed(1)}:1 against its color.`,
    });
  }
}

async function scan(ctx: CheckContext): Promise<void> {
  emitServiceWindow(ctx);
  await ctx.checkpoint();
  emitLowContrast(ctx);
  await ctx.checkpoint();
}

/** Whether the feed is in service today, and whether route text is readable. */
export const feedCheck: ValidationCheck = {
  ruleIds: ['feed_expired', 'feed_not_yet_active', 'route_color_contrast'],
  run: scan,
};
