type Row = Record<string, unknown>;

function projectRow(row: Row, selection: Record<string, unknown> | undefined): Row {
  if (!selection) {
    return { ...row };
  }

  return Object.fromEntries(Object.keys(selection).map((key) => [key, row[key]]));
}

function createThenableQuery<T>(
  execute: (state: { where?: unknown; limit?: number; offset?: number; orderBy: unknown[] }) => T | Promise<T>,
  mutator: (state: { where?: unknown; limit?: number; offset?: number; orderBy: unknown[] }) => void = () => undefined,
) {
  const state: { where?: unknown; limit?: number; offset?: number; orderBy: unknown[] } = { orderBy: [] };

  const query: any = {
    where(condition: unknown) {
      state.where = condition;
      mutator(state);
      return query;
    },
    orderBy(...items: unknown[]) {
      state.orderBy = items;
      mutator(state);
      return query;
    },
    limit(value: number) {
      state.limit = value;
      mutator(state);
      return query;
    },
    offset(value: number) {
      state.offset = value;
      mutator(state);
      return query;
    },
    then(onFulfilled?: (value: T) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(execute(state)).then(onFulfilled, onRejected);
    },
  };

  return query;
}

export function createMemoryDb(initialRows: Row[]) {
  let rows = initialRows.map((row) => ({ ...row }));

  return {
    select(selection?: Record<string, unknown>) {
      return {
        from() {
          return createThenableQuery((state) => {
            const start = state.offset ?? 0;
            const limit = state.limit ?? rows.length;
            return rows.slice(start, start + limit).map((row) => projectRow(row, selection));
          });
        },
      };
    },

    insert() {
      return {
        values(data: Row) {
          return {
            returning(selection?: Record<string, unknown>) {
              const row = { ...data };
              if (row["id"] === undefined) {
                row["id"] = rows.length + 1;
              }
              rows = [...rows, row];
              return Promise.resolve([projectRow(row, selection)]);
            },
          };
        },
      };
    },

    update() {
      return {
        set(data: Row) {
          return {
            where() {
              return {
                returning(selection?: Record<string, unknown>) {
                  if (rows.length === 0) {
                    return Promise.resolve([]);
                  }
                  rows[0] = { ...rows[0], ...data };
                  return Promise.resolve([projectRow(rows[0], selection)]);
                },
              };
            },
          };
        },
      };
    },

    delete() {
      return {
        where() {
          return {
            returning(selection?: Record<string, unknown>) {
              const [row] = rows.splice(0, 1);
              return Promise.resolve(row ? [projectRow(row, selection)] : []);
            },
          };
        },
      };
    },

    snapshot() {
      return rows.map((row) => ({ ...row }));
    },
  };
}
