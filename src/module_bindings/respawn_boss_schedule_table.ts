// THIS FILE IS AUTOMATICALLY GENERATED BY SPACETIMEDB. EDITS TO THIS FILE
// WILL NOT BE SAVED. MODIFY TABLES IN YOUR MODULE SOURCE CODE INSTEAD.

/* eslint-disable */
/* tslint:disable */
// @ts-nocheck
import {
  AlgebraicType,
  AlgebraicValue,
  BinaryReader,
  BinaryWriter,
  CallReducerFlags,
  ConnectionId,
  DbConnectionBuilder,
  DbConnectionImpl,
  DbContext,
  ErrorContextInterface,
  Event,
  EventContextInterface,
  Identity,
  ProductType,
  ProductTypeElement,
  ReducerEventContextInterface,
  SubscriptionBuilderImpl,
  SubscriptionEventContextInterface,
  SumType,
  SumTypeVariant,
  TableCache,
  TimeDuration,
  Timestamp,
  deepEqual,
} from "@clockworklabs/spacetimedb-sdk";
import { RespawnBossSchedule } from "./respawn_boss_schedule_type";
import { EventContext, Reducer, RemoteReducers, RemoteTables } from ".";

/**
 * Table handle for the table `respawn_boss_schedule`.
 *
 * Obtain a handle from the [`respawnBossSchedule`] property on [`RemoteTables`],
 * like `ctx.db.respawnBossSchedule`.
 *
 * Users are encouraged not to explicitly reference this type,
 * but to directly chain method calls,
 * like `ctx.db.respawnBossSchedule.on_insert(...)`.
 */
export class RespawnBossScheduleTableHandle {
  tableCache: TableCache<RespawnBossSchedule>;

  constructor(tableCache: TableCache<RespawnBossSchedule>) {
    this.tableCache = tableCache;
  }

  count(): number {
    return this.tableCache.count();
  }

  iter(): Iterable<RespawnBossSchedule> {
    return this.tableCache.iter();
  }
  /**
   * Access to the `scheduled_id` unique index on the table `respawn_boss_schedule`,
   * which allows point queries on the field of the same name
   * via the [`RespawnBossScheduleScheduledIdUnique.find`] method.
   *
   * Users are encouraged not to explicitly reference this type,
   * but to directly chain method calls,
   * like `ctx.db.respawnBossSchedule.scheduled_id().find(...)`.
   *
   * Get a handle on the `scheduled_id` unique index on the table `respawn_boss_schedule`.
   */
  scheduled_id = {
    // Find the subscribed row whose `scheduled_id` column value is equal to `col_val`,
    // if such a row is present in the client cache.
    find: (col_val: bigint): RespawnBossSchedule | undefined => {
      for (let row of this.tableCache.iter()) {
        if (deepEqual(row.scheduled_id, col_val)) {
          return row;
        }
      }
    },
  };

  onInsert = (cb: (ctx: EventContext, row: RespawnBossSchedule) => void) => {
    return this.tableCache.onInsert(cb);
  }

  removeOnInsert = (cb: (ctx: EventContext, row: RespawnBossSchedule) => void) => {
    return this.tableCache.removeOnInsert(cb);
  }

  onDelete = (cb: (ctx: EventContext, row: RespawnBossSchedule) => void) => {
    return this.tableCache.onDelete(cb);
  }

  removeOnDelete = (cb: (ctx: EventContext, row: RespawnBossSchedule) => void) => {
    return this.tableCache.removeOnDelete(cb);
  }

  // Updates are only defined for tables with primary keys.
  onUpdate = (cb: (ctx: EventContext, oldRow: RespawnBossSchedule, newRow: RespawnBossSchedule) => void) => {
    return this.tableCache.onUpdate(cb);
  }

  removeOnUpdate = (cb: (ctx: EventContext, onRow: RespawnBossSchedule, newRow: RespawnBossSchedule) => void) => {
    return this.tableCache.removeOnUpdate(cb);
  }}
