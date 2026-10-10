const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const apiKeyAuth = require('../../src/middleware/apiKeyAuth');

describe('apiKeyAuth Middleware', () => {
    let originalEnvApiKey;

    beforeEach(() => {
        originalEnvApiKey = process.env.API_KEY;
    });

    afterEach(() => {
        if (originalEnvApiKey === undefined) {
            delete process.env.API_KEY;
        } else {
            process.env.API_KEY = originalEnvApiKey;
        }
    });

    const createMockReqRes = (headers = {}) => {
        const req = {
            headers: { ...headers }
        };

        const res = {
            statusCode: null,
            body: null,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(data) {
                this.body = data;
                return this;
            }
        };

        let nextCalled = false;
        const next = () => {
            nextCalled = true;
        };

        return { req, res, next, isNextCalled: () => nextCalled };
    };

    describe('Open access when API_KEY is empty / default / unset', () => {
        it('should call next() when process.env.API_KEY is undefined', () => {
            delete process.env.API_KEY;

            const { req, res, next, isNextCalled } = createMockReqRes();
            apiKeyAuth(req, res, next);

            assert.equal(isNextCalled(), true);
            assert.equal(res.statusCode, null);
        });

        it('should call next() when process.env.API_KEY is an empty string', () => {
            process.env.API_KEY = '';

            const { req, res, next, isNextCalled } = createMockReqRes();
            apiKeyAuth(req, res, next);

            assert.equal(isNextCalled(), true);
            assert.equal(res.statusCode, null);
        });

        it('should call next() when process.env.API_KEY is default placeholder "your_api_key_here"', () => {
            process.env.API_KEY = 'your_api_key_here';

            const { req, res, next, isNextCalled } = createMockReqRes();
            apiKeyAuth(req, res, next);

            assert.equal(isNextCalled(), true);
            assert.equal(res.statusCode, null);
        });
    });

    describe('Enforced access when API_KEY is set', () => {
        beforeEach(() => {
            process.env.API_KEY = 'super-secret-token-123';
        });

        it('should return 401 when X-Api-Key header is missing', () => {
            const { req, res, next, isNextCalled } = createMockReqRes();
            apiKeyAuth(req, res, next);

            assert.equal(isNextCalled(), false);
            assert.equal(res.statusCode, 401);
            assert.deepEqual(res.body, {
                success: false,
                message: 'Missing X-Api-Key header'
            });
        });

        it('should return 403 when X-Api-Key header is invalid', () => {
            const { req, res, next, isNextCalled } = createMockReqRes({
                'x-api-key': 'wrong-token'
            });
            apiKeyAuth(req, res, next);

            assert.equal(isNextCalled(), false);
            assert.equal(res.statusCode, 403);
            assert.deepEqual(res.body, {
                success: false,
                message: 'Invalid API key'
            });
        });

        it('should call next() when X-Api-Key header is valid', () => {
            const { req, res, next, isNextCalled } = createMockReqRes({
                'x-api-key': 'super-secret-token-123'
            });
            apiKeyAuth(req, res, next);

            assert.equal(isNextCalled(), true);
            assert.equal(res.statusCode, null);
            assert.equal(res.body, null);
        });
    });
});
