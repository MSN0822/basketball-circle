import { vi } from 'vitest'

type QueryResult = {
  data: unknown
  error: null | { message: string; code?: string }
}

type MockSupabaseConfig = {
  selectSingleResult?: QueryResult
  rpcResult?: QueryResult
  insertSingleResult?: QueryResult
  updateSingleResult?: QueryResult
  deleteEqResult?: { error: null | { message: string } }
}

export function mockSupabaseFrom(config: MockSupabaseConfig = {}) {
  const selectSingleResult = config.selectSingleResult ?? { data: null, error: null }
  const rpcResult = config.rpcResult ?? { data: null, error: null }
  const insertSingleResult = config.insertSingleResult ?? { data: null, error: null }
  const updateSingleResult = config.updateSingleResult ?? { data: null, error: null }
  const deleteEqResult = config.deleteEqResult ?? { error: null }

  const selectSingle = vi.fn().mockResolvedValue(selectSingleResult)
  const selectEq = vi.fn().mockReturnValue({ single: selectSingle })
  const select = vi.fn().mockReturnValue({ eq: selectEq })

  const insertSingle = vi.fn().mockResolvedValue(insertSingleResult)
  const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
  const insert = vi.fn().mockReturnValue({ select: insertSelect })

  const updateSingle = vi.fn().mockResolvedValue(updateSingleResult)
  const updateSelect = vi.fn().mockReturnValue({ single: updateSingle })
  const updateEq = vi.fn().mockReturnValue({ select: updateSelect })
  const update = vi.fn().mockReturnValue({ eq: updateEq })

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
      selectEq,
      selectSingle,
      insert,
      update,
      updateEq,
      deleteFn,
      deleteEq,
    },
  }
}

