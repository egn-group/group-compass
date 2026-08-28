import { Context, HttpRequest } from '@azure/functions'

const httpTrigger = async function (context: Context, _req: HttpRequest): Promise<void> {
  context.res = {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'pong' }),
  }
}

module.exports = httpTrigger
