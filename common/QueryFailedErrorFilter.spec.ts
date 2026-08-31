import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { QueryFailedErrorFilter } from './QueryFailedErrorFilter';

function hostWithResponse() {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

function dbError(code: string, message: string, detail?: string) {
  return { driverError: { code, message, detail }, message };
}

describe('QueryFailedErrorFilter', () => {
  const originalEnv = process.env.NODE_ENV;
  let filter: QueryFailedErrorFilter;

  beforeEach(() => {
    filter = new QueryFailedErrorFilter();
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
    jest.spyOn(filter['logger'], 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('hides Postgres driver text in production', () => {
    process.env.NODE_ENV = 'production';
    const { host, status, json } = hostWithResponse();

    filter.catch(
      dbError('23503', 'update on table "whatsapp_messages" violates foreign key'),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    const body = json.mock.calls[0][0];
    expect(body.details).toBeUndefined();
    expect(body.message).toMatch(/referenced by other data/);
  });

  it('keeps driver text outside production for debugging', () => {
    process.env.NODE_ENV = 'development';
    const { host, json } = hostWithResponse();

    filter.catch(dbError('23503', 'fk violation on whatsapp_messages'), host);

    expect(json.mock.calls[0][0].details).toBe('fk violation on whatsapp_messages');
  });

  it('does not name the missing table in production', () => {
    process.env.NODE_ENV = 'production';
    const { host, json } = hostWithResponse();

    filter.catch(
      dbError('42P01', 'relation "whatsapp_conversations" does not exist'),
      host,
    );

    const body = json.mock.calls[0][0];
    expect(body.message).not.toMatch(/whatsapp_conversations/);
    expect(body.details).toBeUndefined();
  });

  it('names the missing table locally so the fix is obvious', () => {
    process.env.NODE_ENV = 'test';
    const { host, json } = hostWithResponse();

    filter.catch(
      dbError('42P01', 'relation "whatsapp_conversations" does not exist'),
      host,
    );

    expect(json.mock.calls[0][0].message).toMatch(/whatsapp_conversations/);
  });

  it('still logs the full driver message when hiding it from the client', () => {
    process.env.NODE_ENV = 'production';
    const { host } = hostWithResponse();
    const logged = jest.spyOn(filter['logger'], 'error');

    filter.catch(dbError('99999', 'deadlock detected on whatsapp_messages'), host);

    expect(logged).toHaveBeenCalledWith('deadlock detected on whatsapp_messages');
  });

  it('maps unique violations to 409', () => {
    process.env.NODE_ENV = 'production';
    const { host, status } = hostWithResponse();

    filter.catch(dbError('23505', 'duplicate key value'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
  });
});
