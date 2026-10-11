import type {ValidationCheck} from '../runner.ts';
import {coverageCheck} from './coverage.ts';
import {feedCheck} from './feed.ts';
import {patternsCheck} from './patterns.ts';
import {referencesCheck} from './references.ts';
import {stopTimesCheck} from './stop-times.ts';
import {stopsCheck} from './stops.ts';

/** Every check, in run order. Each rule id belongs to exactly one. */
export const ALL_CHECKS: readonly ValidationCheck[] = [
  referencesCheck,
  stopTimesCheck,
  coverageCheck,
  patternsCheck,
  stopsCheck,
  feedCheck,
];
