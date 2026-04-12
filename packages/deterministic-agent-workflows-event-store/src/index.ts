/** @riviere-role event-store */
export interface EventStoreModule {
  readonly name: 'event-store';
}

/** @riviere-role event-store */
export const eventStoreModule: EventStoreModule = {
  name: 'event-store'
};
