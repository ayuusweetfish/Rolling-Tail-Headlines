const log = (...args) => console.log(new Date().toISOString(), ...args)

const ACCESS_KEY = Deno.env.get('ACCESS_KEY')
const LOCAL_ENDPOINT = Deno.env.get('LOCAL_ENDPOINT')
  || `http://127.0.0.1:26219/v1/images/generations`

const callLocalGenServer = async (text, seed) => {
  const req = await fetch(LOCAL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: text,
      seed,
    }),
  })
  const obj = await req.json()
  return Uint8Array.fromBase64(obj['data'][0]['b64_json'])
}

const tasks = new Map()

const hash = (s) => {
  let h = 0
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h, 997) + s.charCodeAt(i)
  return h & 0x7fffffff
}

const handler = async (req) => {
  const url = new URL(req.url)

  if (ACCESS_KEY && req.headers.get('Authorization') !== `Bearer ${ACCESS_KEY}`)
    throw new Error(`[401] Incorrect access key`)

  if (req.method === 'POST' && url.pathname === '/paint') {
    const obj = await req.json()
    const text = obj.prompt
    const taskId = crypto.randomUUID()
    const startedAt = new Date().toISOString()
    const seed = hash(taskId + text)
    log('Task spawn', taskId, seed)

    tasks.set(taskId, {
      status: 'running',
      startedAt,
    })

    ;(async () => {
      try {
        const imageBuffer = await callLocalGenServer(text, seed)
        log('Task finished', taskId)
        tasks.set(taskId, {
          status: 'finished',
          result: imageBuffer,
          startedAt,
          finishedAt: new Date().toISOString(),
        })
      } catch (error) {
        log('Task error', taskId, error)
        tasks.set(taskId, {
          status: 'error',
          message: error.message,
          startedAt,
          finishedAt: new Date().toISOString(),
        })
      }
      setTimeout(() => {
        tasks.delete(taskId)
      }, 60000)
    })()

    return { task_id: taskId }
  }

  if (req.method === 'GET' && url.pathname.startsWith('/status/')) {
    const taskId = url.pathname.substring('/status/'.length)
    const task = tasks.get(taskId)
    if (!task) throw new Error(`[404] Task ${taskId} does not exist`)

    if (task.status === 'running') {
      return {
        status: 'running',
        started_at: task.startedAt,
      }
    } else if (task.status === 'finished') {
      return {
        status: 'finished',
        started_at: task.startedAt,
        finished_at: task.finishedAt,
      }
    } else if (task.status === 'error') {
      return {
        status: 'error',
        message: task.message,
        started_at: task.startedAt,
        finished_at: task.finishedAt,
      }
    } else {
      throw new Error(`[500] Unknown task status?`)
    }
  }

  if (req.method === 'GET' && url.pathname.startsWith('/result/')) {
    const taskId = url.pathname.substring('/result/'.length)
    const task = tasks.get(taskId)
    if (!task) throw new Error(`[404] Task ${taskId} does not exist`)

    if (task.status !== 'finished')
      throw new Error(`[400] Task not finished (status ${task.status})`)

    return new Response(task.result)
  }

  throw new Error('[404] Void space, please return')
}

const serverPort = +Deno.env.get('SERVE_PORT') || 26220
Deno.serve({ port: serverPort }, async (req) => {
  try {
    const obj = await handler(req)
    if (obj instanceof Response) return obj
    else return new Response(JSON.stringify(obj), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (e) {
    let status = 500
    const message = e.message.replace(/^\[([0-9]{3})\] /, (_, n) => ((status = +n), ''))
    if (status === 500) log(e)
    return new Response(JSON.stringify({ message }), { status })
  }
})
log('Starting! ^≥ﻌ-^')
