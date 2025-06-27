import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert'
import nock from 'nock'
import { fetchWithRetry } from '../../src/retry.js'

const retries = 3
const timeout = 500
const growthFactor = 2
const url = 'http://example.com'

const mockCall = (delay = 0, count = 1) => {
  return nock(url)
    .get('/')
    .delay(delay)
    .times(count)
    .reply(200, {})
}

const options = {
  retries,
  timeout,
  growthFactor
}

describe('retry tests', async () => {
  beforeEach(() => nock.cleanAll())

  it('Check that the retry works on the first attempt', async () => {
    mockCall()
    try {
      const response = await fetchWithRetry(url, options)
      assert.equal(response.status, 200)
    } catch (error) {
      assert.fail(error.message)
    }
  })

  it('Check that the retry works on the first retry', async () => {
    mockCall(600)
    mockCall()
    try {
      const response = await fetchWithRetry(url, options)
      assert.equal(response.status, 200)
    } catch (error) {
      assert.fail(error.message)
    }
  })

  it('Check that the retry works on the second retry', async () => {
    mockCall(600)
    mockCall(1100)
    mockCall()
    try {
      const response = await fetchWithRetry(url, options)
      assert.equal(response.status, 200)
    } catch (error) {
      assert.fail(error.message)
    }
  })

  it('Check that the retry works on the third retry', async () => {
    mockCall(600)
    mockCall(1100)
    mockCall(2100)
    mockCall()
    try {
      const response = await fetchWithRetry(url, options)
      assert.equal(response.status, 200)
    } catch (error) {
      assert.fail(error.message)
    }
  })

  it('Check that the retry fails when out of retries', async () => {
    const scope = mockCall(100, 10)
    try {
      const response = await fetchWithRetry(url,
        {
          retries,
          timeout: 1,
          growthFactor
        }
      )
      assert.fail('Expected exception not thrown')
    } catch (error) {
      assert.equal(error.message, `All retries failed. Url: ${url}`)
    }
  })

  it('Check that the retry succeeds after 408', async () => {
    const scope = nock(url)
      .get('/')
      .reply(408, {})
    mockCall()
    try {
      const response = await fetchWithRetry(url, options)
      assert.equal(response.status, 200)
    } catch (error) {
      assert.fail(error.message)
    }
  })

  it('Check that the retry stops after 401', async () => {
    const scope = nock(url)
      .get('/')
      .reply(401, {})
    mockCall()
    try {
      const response = await fetchWithRetry(url, options)
      assert.equal(response.status, 401)
    } catch (error) {
      assert.fail(error.message)
    }
  })
})
