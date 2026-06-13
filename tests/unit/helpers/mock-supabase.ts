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
    neq: vi.fn(),
    like: vi.fn(),
    in: vi.fn(),
    limit: vi.fn(),
    order: selectOrder,
    single: selectSingle,
    maybeSingle: selectMaybeSingle,
  }
  selectQuery.eq.mockReturnValue(selectQuery)
  selectQuery.neq.mockReturnValue(selectQuery)
  selectQuery.like.mockReturnValue(selectQuery)
  selectQuery.in.mockReturnValue(selectQuery)
  selectQuery.limit.mockReturnValue(selectQuery)
  const select = vi.fn().mockReturnValue(selectQuery)

  const insertSingle = vi.fn().mockResolvedValue(insertSingleResult)
  const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
  const insert = vi.fn().mockReturnValue({ select: insertSelect })

  const updateSingle = vi.fn().mockResolvedValue(updateSingleResult)
  const updateSelect = vi.fn().mockReturnValue({ single: updateSingle })
  const updateQuery = {
    eq: vi.fn(),
    not: vi.fn(),
    lte: vi.fn().mockResolvedValue(updateManyResult),
    select: updateSelect,
  }
  updateQuery.eq.mockReturnValue(updateQuery)
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
      updateNot: updateQuery.not,
      updateLte: updateQuery.lte,
      deleteFn,
      deleteEq,
    },
  }
}
