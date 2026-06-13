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
        values(data: Row | Row[]) {
          return {
            returning(selection?: Record<string, unknown>) {
              const items = (Array.isArray(data) ? data : [data]).map((item, index) => {
                const row = { ...item };
                if (row["id"] === undefined) {
                  row["id"] = rows.length + index + 1;
                }
                return row;
              });
              rows = [...rows, ...items];
              return Promise.resolve(items.map((row) => projectRow(row, selection)));
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
                  rows = rows.map((row, index) => (index === 0 ? { ...row, ...data } : row));
                  const updated = rows[0];
                  return Promise.resolve(updated ? [projectRow(updated, selection)] : []);
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
              const deleted = rows;
              rows = [];
              return Promise.resolve(deleted.map((row) => projectRow(row, selection)));
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
