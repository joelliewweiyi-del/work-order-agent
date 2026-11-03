import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createStore } from './store.js';

const read = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url)));
const register = await read('../data/register.json');
const store = createStore(register);
const port = Number(process.env.PORT) || 3000;

// Demo seed: the agent processes the sample inbox at startup.
for (const mail of await read('../data/inbox.json')) await store.receive(mail);

async function json(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

const routes = [
  ['GET', /^\/$/, async () => [200, await readFile(new URL('../public/index.html', import.meta.url)), 'text/html; charset=utf-8']],
  ['GET', /^\/api\/register$/, async () => [200, register]],
  ['GET', /^\/api\/items$/, async () => [200, store.list()]],
  ['POST', /^\/api\/mail$/, async (req) => {
    const { from, subject, body } = await json(req);
    if (!from || !body) throw new Error('from and body are required');
    return [200, await store.receive({ from, subject: subject ?? '', body })];
  }],
  ['POST', /^\/api\/items\/([\w-]+)\/(\w+)$/, async (req, [id, action]) => [200, store.act(id, action, await json(req))]],
];

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  try {
    for (const [method, re, handler] of routes) {
      const m = req.method === method && path.match(re);
      if (!m) continue;
      const [status, body, type = 'application/json'] = await handler(req, m.slice(1));
      res.writeHead(status, { 'content-type': type });
      return res.end(type === 'application/json' ? JSON.stringify(body) : body);
    }
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
  } catch (err) {
    res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: err.message }));
  }
}).listen(port, () => console.log(`work-order-agent running at http://localhost:${port}`));
