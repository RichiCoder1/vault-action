jest.mock('@actions/core');
jest.mock('@actions/core/lib/command');
const core = require('@actions/core');

const got = require('got');
const { when } = require('jest-when');

const { exportSecrets } = require('../../src/action');

const vaultUrl = `http://${process.env.VAULT_HOST || 'localhost'}:${process.env.VAULT_PORT || '8200'}`;

describe('integration', () => {
    beforeAll(async () => {
        // Verify Connection
        await got(`${vaultUrl}/v1/secret/config`, {
            headers: {
                'X-Vault-Token': 'testtoken',
            },
        });

        await got(`${vaultUrl}/v1/secret/data/test`, {
            method: 'POST',
            headers: {
                'X-Vault-Token': 'testtoken',
            },
            json: {
                data: {
                    secret: 'SUPERSECRET',
                },
            },
        });

        await got(`${vaultUrl}/v1/secret/data/nested/test`, {
            method: 'POST',
            headers: {
                'X-Vault-Token': 'testtoken',
            },
            json: {
                data: {
                    "other-Secret-dash": 'OTHERSUPERSECRET',
                },
            }
        });

        await got(`${vaultUrl}/v1/secret/data/foobar`, {
            method: 'POST',
            headers: {
                'X-Vault-Token': 'testtoken',
            },
            json: {
                data: {
                    fookv2: 'bar',
                },
            }
        });

        // Enable custom secret engine
        try {
            await got(`${vaultUrl}/v1/sys/mounts/secret-kv1`, {
                method: 'POST',
                headers: {
                    'X-Vault-Token': 'testtoken',
                },
                json: {
                    type: 'kv'
                }
            });
        } catch (error) {
            const {response} = error;
            if (response.statusCode === 400 && response.body.includes("path is already in use")) {
                // Engine might already be enabled from previous test runs
            } else {
                throw error;
            }
        }

        await got(`${vaultUrl}/v1/secret-kv1/test`, {
            method: 'POST',
            headers: {
                'X-Vault-Token': 'testtoken',
            },
            json: {
                secret: 'CUSTOMSECRET',
            }
        });

        await got(`${vaultUrl}/v1/secret-kv1/foobar`, {
            method: 'POST',
            headers: {
                'X-Vault-Token': 'testtoken',
            },
            json: {
                fookv1: 'bar',
            }
        });

        await got(`${vaultUrl}/v1/secret-kv1/nested/test`, {
            method: 'POST',
            headers: {
                'X-Vault-Token': 'testtoken',
            },
            json: {
                "other-Secret-dash": 'OTHERCUSTOMSECRET',
            },
        });
    });

    beforeEach(() => {
        jest.resetAllMocks();

        when(core.getInput)
            .calledWith('url')
            .mockReturnValueOnce(`${vaultUrl}`);

        when(core.getInput)
            .calledWith('token')
            .mockReturnValueOnce('testtoken');
    });

    function mockInput(secrets) {
        when(core.getInput)
            .calledWith('secrets')
            .mockReturnValueOnce(secrets);
    }

    it('prints a nice error message when secret not found', async () => {
        mockInput(`secret/data/test secret ;
        secret/data/test secret | NAMED_SECRET ;
        secret/data/notFound kehe | NO_SIR ;`);

        expect(exportSecrets()).rejects.toEqual(Error(`Unable to retrieve result for "secret/data/notFound". Double check your Key.`));
    })

    it('get simple secret', async () => {
        mockInput('secret/data/test secret');

        await exportSecrets();

        expect(core.exportVariable).toBeCalledWith('SECRET', 'SUPERSECRET');
    });

    it('re-map secret', async () => {
        mockInput('secret/data/test secret | TEST_KEY');

        await exportSecrets();

        expect(core.exportVariable).toBeCalledWith('TEST_KEY', 'SUPERSECRET');
    });

    it('get nested secret', async () => {
        mockInput(`secret/data/nested/test "other-Secret-dash"`);

        await exportSecrets();

        expect(core.exportVariable).toBeCalledWith('OTHERSECRETDASH', 'OTHERSUPERSECRET');
    });

    it('get multiple secrets', async () => {
        mockInput(`
        secret/data/test secret ;
        secret/data/test secret | NAMED_SECRET ;
        secret/data/nested/test "other-Secret-dash" ;`);

        await exportSecrets();

        expect(core.exportVariable).toBeCalledTimes(3);

        expect(core.exportVariable).toBeCalledWith('SECRET', 'SUPERSECRET');
        expect(core.exportVariable).toBeCalledWith('NAMED_SECRET', 'SUPERSECRET');
        expect(core.exportVariable).toBeCalledWith('OTHERSECRETDASH', 'OTHERSUPERSECRET');
    });

    it('leading slash kvv2', async () => {
        mockInput('/secret/data/foobar fookv2');

        await exportSecrets();

        expect(core.exportVariable).toBeCalledWith('FOOKV2', 'bar');
    });

    it('get secret from K/V v1', async () => {
        mockInput('secret-kv1/test secret');

        await exportSecrets();

        expect(core.exportVariable).toBeCalledWith('SECRET', 'CUSTOMSECRET');
    });

    it('get nested secret from K/V v1', async () => {
        mockInput('secret-kv1/nested/test "other-Secret-dash"');

        await exportSecrets();

        expect(core.exportVariable).toBeCalledWith('OTHERSECRETDASH', 'OTHERCUSTOMSECRET');
    });

    it('leading slash kvv1', async () => {
        mockInput('/secret-kv1/foobar fookv1');

        await exportSecrets();

        expect(core.exportVariable).toBeCalledWith('FOOKV1', 'bar');
    });

    describe('generic engines', () => {
        beforeAll(async () => {
            await got(`${vaultUrl}/v1/cubbyhole/test`, {
                method: 'POST',
                headers: {
                    'X-Vault-Token': 'testtoken',
                },
                json: {
                    foo: "bar",
                    zip: "zap"
                },
            });
        });

        it('supports cubbyhole', async () => {            
            mockInput('/cubbyhole/test foo');

            await exportSecrets();

            expect(core.exportVariable).toBeCalledWith('FOO', 'bar');
        });

        it('caches responses', async () => {            
            mockInput(`
            /cubbyhole/test foo ;
            /cubbyhole/test zip`);

            await exportSecrets();

            expect(core.debug).toBeCalledWith('ℹ using cached response');

            expect(core.exportVariable).toBeCalledWith('FOO', 'bar');
            expect(core.exportVariable).toBeCalledWith('ZIP', 'zap');
        });
    })
});
