import type {Remote} from 'comlink';
import type {FeedService} from '../worker/feed-service.ts';

/** The worker's FeedService as seen from the main thread: every method returns a Promise. */
export type FeedApi = Remote<FeedService>;
