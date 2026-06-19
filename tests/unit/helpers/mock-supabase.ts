import { vi } from 'vitest'

type QueryResult = {
  data: unknown
  error: null | { message: string; code?: string }
}

type MockSupabaseConfig = {
  selectSingleResult?: QueryResult
  selectMaybeSingleResult?: QueryResult
  selectOrderResult?: QueryResult
  rpcResult?: QueryResult
  insertSingleResult?: QueryResult
  updateSingleResult?: QueryResult
  updateManyResult?: { error: null | { message: string } }
  deleteEqResult?: { error: null | { message: string } }
}

export function mockSupabaseFrom(config: MockSupabaseConfig = {}) {
  const selectSingleResult = config.selectSingleResult ?? { data: null, error: null }
  const selectMaybeSingleResult = config.selectMaybeSingleResult ?? { data: null, error: null }
  const selectOrderResult = config.selectOrderResult ?? { data: null, error: null }
  const rpcResult = config.rpcResult ?? { data: null, error: null }
  const insertSingleResult = config.insertSingleResult ?? { data: null, error: null }
  const updateSingleResult = config.updateSingleResult ?? { data: null, error: null }
  const updateManyResult = config.updateManyResult ?? { error: null }
  const deleteEqResult = config.deleteEqResult ?? { error: null }

  const selectSingle = vi.fn().mockResolvedValue(selectSingleResult)
  const selectMaybeSingle = vi.fn().mockResolvedValue(selectMaybeSingleResult)
  const selectOrder = vi.fn().mockResolvedValue(selectOrderResult)
  const selectQuery = {
    eq: vi.fn(),
    lt: vi.fn(),
    neq: vi.fn(),
    like: vi.fn(),
    in: vi.fn(),
    limit: vi.fn(),
    order: selectOrder,
    single: selectSingle,
    maybeSingle: selectMaybeSingle,
    then: vi.fn(),
  }
  selectQuery.eq.mockReturnValue(selectQuery)
  selectQuery.lt.mockReturnValue(selectQuery)
  selectQuery.neq.mockReturnValue(selectQuery)
  selectQuery.like.mockReturnValue(selectQuery)
  selectQuery.in.mockReturnValue(selectQuery)
  selectQuery.limit.mockReturnValue(selectQuery)
  selectQuery.then.mockImplementation((resolve, reject) => Promise.resolve(selectOrderResult).then(resolve, reject))
  const select = vi.fn().mockReturnValue(selectQuery)

  const insertSingle = vi.fn().mockResolvedValue(insertSingleResult)
  const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
  const insert = vi.fn().mockReturnValue({ select: insertSelect })

  const updateSingle = vi.fn().mockResolvedValue(updateSingleResult)
  const updateSelect = vi.fn().mockReturnValue({ single: updateSingle })
  const updateQuery = {
    eq: vi.fn(),
    in: vi.fn(),
    not: vi.fn(),
    lte: vi.fn().mockResolvedValue(updateManyResult),
    select: updateSelect,
  }
  updateQuery.eq.mockReturnValue(updateQuery)
  updateQuery.in.mockResolvedValue(updateManyResult)
  updateQuery.not.mockReturnValue(updateQuery)
  const update = vi.fn().mockReturnValue(updateQuery)

  const deleteEq = vi.fn().mockResolvedValue(deleteEqResult)
  const deleteFn = vi.fn().mockReturnValue({ eq: deleteEq })

  const fromResult = {
    select,
    insert,
    update,
    delete: deleteFn,
  }

  const mockFrom = vi.fn().mockReturnValue(fromResult)
  const mockRpc = vi.fn().mockResolvedValue(rpcResult)

  return {
    client: {
      from: mockFrom,
      rpc: mockRpc,
      auth: {
        admin: {
          deleteUser: vi.fn().mockResolvedValue({ error: null }),
        },
      },
    },
    spies: {
      mockFrom,
      mockRpc,
      select,
      selectEq: selectQuery.eq,
      selectNeq: selectQuery.neq,
      selectLike: selectQuery.like,
      selectIn: selectQuery.in,
      selectLimit: selectQuery.limit,
      selectOrder,
      selectSingle,
      selectMaybeSingle,
      insert,
      update,
      updateEq: updateQuery.eq,
      updateIn: updateQuery.in,
      updateNot: updateQuery.not,
      updateLte: updateQuery.lte,
      deleteFn,
      deleteEq,
    },
  }
}
