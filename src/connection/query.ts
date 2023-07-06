import { SQLJob } from "./sqlJob";
import { CLCommandResult, JobLogEntry, QueryResult, ServerResponse } from "./types";
export enum QueryState {
  NOT_YET_RUN = 1,
  RUN_MORE_DATA_AVAILABLE = 2,
  RUN_DONE = 3,
  ERROR = 4
}
export class Query<T> {

  private static id_ctr: number = 43;
  private static globalQueryList: Query<any>[] = [];
  private correlationId: string;
  private sql: string;
  private isPrepared: boolean = false;
  private parameters: any[];
  private rowsToFetch: number = 100;
  private isCLCommand: boolean;
  private state: QueryState = QueryState.NOT_YET_RUN;

  constructor(private job: SQLJob, private isCL: boolean, private query: string, private parms: any[] = undefined) {
    this.job = job;
    this.isPrepared = (undefined !== parms);
    this.parameters = parms;
    this.sql = query;
    this.isCLCommand = isCL;
    Query.globalQueryList.push(this);
  }
  public static byId(id: string) {
    return (undefined === id || '' === id) ? undefined : Query.globalQueryList.find(query => query.correlationId === id);
  }
  public async run(rowsToFetch: number = this.rowsToFetch): Promise<QueryResult<T>> {
    switch (this.state) {
    case QueryState.RUN_MORE_DATA_AVAILABLE:
      throw new Error('Statement has already been run');
    case QueryState.RUN_DONE:
      throw new Error('Statement has already been fully run');
    }
    let queryObject;
    if (this.isCLCommand) {
      queryObject = {
        id: `` + (++Query.id_ctr),
        type: `cl`,
        cmd: this.sql
      };
    } else {
      queryObject = {
        id: `` + (++Query.id_ctr),
        type: this.isPrepared ? `prepare_sql_execute` : `sql`,
        sql: this.sql,
        rows: rowsToFetch,
        parameters: this.parameters
      };
    }
    this.rowsToFetch = rowsToFetch;
    let result = await this.job.send(JSON.stringify(queryObject));
    let queryResult: QueryResult<T> = JSON.parse(result);

    this.state = queryResult.is_done? QueryState.RUN_DONE: QueryState.RUN_MORE_DATA_AVAILABLE;

    if (queryResult.success !== true && !this.isCLCommand) {
      this.state = QueryState.ERROR;
      throw new Error(queryResult.error || `Failed to run query (unknown error)`);
    }
    this.correlationId = queryResult.id;
    return queryResult;
  }
  public async fetchMore(rowsToFetch: number = this.rowsToFetch): Promise<QueryResult<T>> {
    switch (this.state) {
    case QueryState.NOT_YET_RUN:
      throw new Error('Statement has not yet been run');
    case QueryState.RUN_DONE:
      throw new Error('Statement has already been fully run');
    }
    let queryObject = {
      id: `` + (++Query.id_ctr),
      cont_id: this.correlationId,
      type: `sqlmore`,
      sql: this.sql,
      rows: rowsToFetch
    };

    this.rowsToFetch = rowsToFetch;
    let result = await this.job.send(JSON.stringify(queryObject));

    let queryResult: QueryResult<T> = JSON.parse(result);
    this.state = queryResult.is_done? QueryState.RUN_DONE: QueryState.RUN_MORE_DATA_AVAILABLE;

    if (queryResult.success !== true) {
      this.state = QueryState.ERROR;
      throw new Error(queryResult.error || `Failed to run query (unknown error)`);
    }
    return queryResult;
  }
  public async close() {
    this.state = QueryState.RUN_DONE;
  }
  public getId(): string {
    return this.correlationId;
  }
  public getState(): QueryState {
    return this.state;
  }
}