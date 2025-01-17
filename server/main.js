const serveReq = async (req) => {
  const url = new URL(req.url)
  if (req.method === 'GET' && url.pathname === '/') {
    return new Response('1')
  }
  return new Response('Void space, please return', { status: 404 })
}

const serverPort = +Deno.env.get('SERVE_PORT') || 25117
const server = Deno.serve({ port: serverPort }, serveReq)
