import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import nock from 'nock'
import { fetchWithTimeout } from '../../src/retry.js'

const url = 'http://example.com'

describe('retry tests', async () => {
  beforeEach(() => nock.cleanAll())

  it('Check that the timeout fails correctly', async () => {
    const scope = nock(url)
      .get('/')
      .delay(100)
      .reply(200, {})
    try {
      const response = await fetchWithTimeout(
        url,
        { timeout: 50 }
      )
      assert.fail('Expected exception not thrown')
    } catch (error) {
      assert.equal(error.message, 'This operation was aborted')
    }
  })

  it('Check that the timeout succeeds correctly', async () => {
    const scope = nock(url)
      .get('/')
      .delay(50)
      .reply(200, {})
    try {
      const response = await fetchWithTimeout(
        url,
        { timeout: 100 }
      )
      assert.equal(response.status, 200)
    } catch (error) {
      assert.fail(error.message)
    }
  })
})
