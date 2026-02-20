const log = (...args) => console.log(new Date().toISOString(), ...args)

const callLocalGenServer = async (text) => {
  const req = await fetch(`http://127.0.0.1:26219/v1/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      prompt: text,
      seed: 42,
    },
  })
  const obj = await req.json()
  return Uint8Array.fromBase64(obj['data'][0]['b64_json'])
}

const tasks = new Map()

const handler = async (req) => {
  const url = new URL(req.url)

  if (req.method === 'POST' && url.pathname === '/paint') {
    const obj = await req.json()
    const text = obj.prompt
    const taskId = crypto.randomUUID()
    const startedAt = Date.now()
    console.log('Spawn task', taskId, text)

    tasks.set(taskId, {
      status: 'running',
      startedAt,
    })

    ;(async () => {
      try {
        const image = await callLocalGenServer(text)
        tasks.set(taskId, {
          status: 'finished',
          result: imageBuffer,
          startedAt,
          finishedAt: Date.now(),
        })
      } catch (error) {
        tasks.set(taskId, {
          status: 'error',
          message: error.message,
          startedAt,
          finishedAt: Date.now(),
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

    return new Response(new Uint8Array([48, 49, 50]))
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
