const log = (...args) => console.log(new Date().toISOString(), ...args)

const handler = async (req) => {
  const url = new URL(req.url)
  if (req.method === 'POST' && url.pathname === '/paint') {
    const obj = await req.json()
    const text = obj.prompt
    console.log('Spawn task', text)
    const task_id = 1
    return { task_id }
  }
  if (req.method === 'GET' && url.pathname.startsWith('/status/')) {
    const task_id = +url.pathname.substring('/status/'.length)
    console.log('Query status', task_id)
    return { running: true }
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
