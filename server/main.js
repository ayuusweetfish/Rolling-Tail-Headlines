import * as db from './db.js'
import * as llm from './llm.js'

const createIssue = async (language) => {
  const timestamp = Date.now()
  const uuid = crypto.randomUUID()

  const shuffle = (a) => {
    for (let i = a.length - 1; i >= 1; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
  }

  const previousTopics = await db.recentAndPastTopics(2, 6)
  if (previousTopics.length < 12) {
    const seedingTopics = [
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
    shuffle(seedingTopics)
    previousTopics.push(...seedingTopics.slice(0, 12 - previousTopics.length))
  }
  shuffle(previousTopics)
  const topics = await llm.askForTopicSuggestions(previousTopics, 'en')

  await db.newEmptyIssue(uuid, timestamp, language)
  await db.newTopics(uuid, topics)

  const trimmedTopics = topics.map((t) => {
    const nativeText = t[1]
    if (language.startsWith('zh') || language === 'ja') {
      return nativeText.substring(6)
    } else {
      let p = -2
      for (let i = 0; i < 4; i++) {
        p = nativeText.indexOf(' ', p + 1)
        if (p === -1) return nativeText   // Does this really happen?? ^ ^
      }
      return nativeText.substring(0, p)
    }
  })

  return [uuid, trimmedTopics]
}

// Serve requests

class ErrorHttpCoded extends Error {
  constructor(status, message = '') {
    super(message)
    this.status = status
  }
}

const extractParams = (payload, keys) => {
  const params = []
  for (let key of keys) {
    let value =
      (payload instanceof FormData || payload instanceof URLSearchParams) ?
        payload.get(key) : payload[key]
    if (value === null || value === undefined)
      throw new ErrorHttpCoded(400, `${key} is not present`)
    params.push(value)
  }
  return params
}

const serveReq = async (req) => {
  const url = new URL(req.url)
  if (req.method === 'GET' && url.pathname === '/') {
    return new Response('1')
  }
  if (req.method === 'POST' && url.pathname === '/start') {
    const language = 'en'
    const [uuid, trimmedTopics] = await createIssue(language)
    return Response.json({ uuid, topics: trimmedTopics })
  }
  if (req.method === 'POST' && url.pathname === '/flip') {
    const [issueUuid, selStr] = extractParams(await req.formData(), ['uuid', 'sel'])
    const sel = parseInt(selStr)
    if (!(sel >= 0 && sel < 6)) throw new ErrorHttpCoded(400, 'Invalid `sel`')

    const topics = await db.topicsForIssue(issueUuid) // [[id, selected]; 6]
    if (!topics || topics.length < 6) throw new ErrorHttpCoded(404, 'Issue not found')
    if (topics[sel][1]) throw new ErrorHttpCoded(400, 'Topic already selected')
    if (topics[sel ^ 1][1]) throw new ErrorHttpCoded(400, 'Sibling topic already selected')

    const selTopicId = topics[sel][0]
    await db.markTopicAsSelected(selTopicId)

    // Spawn the image generation task to run in background
    const selTopicText = await db.getTopicEnglishText(selTopicId)
    ;(async () => {
      const image = await llm.generateImage(selTopicText)
      await db.setTopicImage(selTopicId, image)
    })()

    if (topics.reduce((a, b) => a + b[1], 0) + 1 === 3) {
      // All topics selected. Make the newspaper!
      const selTopics = await db.selectedTopicsForIssue(issueUuid)
      const issueNum = await db.reserveIssueNumber(issueUuid)
      const newspaper = await llm.askForNewspaper(issueNum, selTopics)
      const chunksCombined = []
      const stream = new ReadableStream({
        async pull(controller) {
          const { value: chunk, done } = await newspaper.next()
          if (done) {
            controller.close()
            await db.publishIssue(issueNum, chunksCombined.join(''))
          }
          chunksCombined.push(chunk)
          controller.enqueue(new TextEncoder().encode(chunk))
        },
        async cancel(reason) {
          await newspaper.return()  // Abort generator
        },
      })
      return new Response(stream)
    } else {
      // Just reply OK
      return new Response('OK')
    }
  }
  return new Response('Void space, please return', { status: 404 })
}

const serveReqWrapped = async (req) => {
  try {
    return await serveReq(req)
  } catch (e) {
    if (e instanceof ErrorHttpCoded) {
      return new Response(e.message, { status: e.status })
    } else {
      console.log(e)
      return new Response('Internal server error: ' +
        (e instanceof Error) ? e.message : e.toString(), { status: 500 })
    }
  }
}

const serverPort = +Deno.env.get('SERVE_PORT') || 25117
const server = Deno.serve({ port: serverPort }, serveReqWrapped)
