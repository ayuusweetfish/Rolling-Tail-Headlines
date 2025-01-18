import * as db from './db.js'
import * as llm from './llm.js'

const createIssue = async (language) => {
  const timestamp = Date.now()
  const uuid = crypto.randomUUID()

  const previousTopics = [
    "Rain is just the sky crying because it’s jealous of how much fun the ocean is having.",
    "Trees are secretly telepathic and gossip about humans during photosynthesis.",
    "Clouds are actually sentient beings hosting weekly tea parties with migrating birds",
    "The Ministry of Silly Walks has been disbanded after the flamingo workforce went on strike for better worm benefits.",
    'A new political party, the "Party of Infinite Naps," wins the election by promising mandatory siestas for all citizens.',
    "The moon has been caught hosting late-night karaoke sessions with passing comets.",
    "The sun has started wearing sunglasses to protect itself from the brightness of Earth's cities.",
    "Scientists accidentally create a black hole that only absorbs bad vibes, leaving everyone inexplicably cheerful.",
    "Time has been declared a social construct by clocks, who are now refusing to move forward.",
  ]
  const topics = await llm.askForTopicSuggestions(previousTopics, 'en')

  await db.newEmptyIssue(uuid, timestamp, language)
  await db.newTopics(uuid, topics)

  return [uuid, topics]
}

// Serve requests

const serveReq = async (req) => {
  const url = new URL(req.url)
  if (req.method === 'GET' && url.pathname === '/') {
    return new Response('1')
  }
  if (req.method === 'POST' && url.pathname === '/start') {
    const language = 'en'
    const [uuid, topics] = await createIssue(language)
    return Response.json({ uuid, topics })
  }
  return new Response('Void space, please return', { status: 404 })
}

const serverPort = +Deno.env.get('SERVE_PORT') || 25117
const server = Deno.serve({ port: serverPort }, serveReq)
