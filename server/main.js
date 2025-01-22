import * as db from './db.js'
import * as llm from './llm.js'

import { serveFile } from 'jsr:@std/http/file-server'

// Serve requests

class ErrorHttpCoded extends Error {
  constructor(status, message = '') {
    super(message)
    this.status = status
  }
}

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
  const topics = await llm.askForTopicSuggestions(previousTopics, language)
  if (topics === null) throw new ErrorHttpCoded(400, 'Unknown language')

  await db.newEmptyIssue(uuid, timestamp, language)
  await db.newTopics(uuid, topics)

  const trimmedTopics = topics.map((t) => {
    const nativeText = t[1]
    if (language.startsWith('zh') || language === 'ja' || language === 'ko') {
      return nativeText.substring(0, 6)
    } else {
      const nWords = (language === 'vi' ? 6 : 4)
      let p = -2
      for (let i = 0; i < nWords; i++) {
        p = nativeText.indexOf(' ', p + 1)
        if (p === -1) return nativeText   // Does this really happen?? ^ ^
      }
      return nativeText.substring(0, p)
    }
  })

  return [uuid, trimmedTopics]
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

// issue number -> { listeners }
const newspaperStreams = {}

const serveReq = async (req) => {
  const url = new URL(req.url)
  if (req.method === 'GET' && url.pathname === '/') {
    return serveFile(req, '../page/index.html')
  }
  if (req.method === 'GET' && url.pathname === '/favicon.ico') {
    return serveFile(req, '../page/img/coin-small-tail.webp')
  }
  const matchIssueDisplay = url.pathname.match(/^\/([0-9]{1,10})$/)
  if (req.method === 'GET' && matchIssueDisplay) {
    const issueNum = parseInt(matchIssueDisplay[1])
    const text = await db.issuePagesContent(issueNum)
    if (text === null) throw new ErrorHttpCoded(404, 'Issue not found')
    return serveFile(req, '../page/index.html')
  }
  if (req.method === 'GET' && url.pathname.match(/\/(img|aud|ext|fonts)\/[a-zA-Z0-9_\-.]+/)) {
    return serveFile(req, '../page' + url.pathname)
  }
  if (req.method === 'POST' && url.pathname === '/start') {
    const [language] = extractParams(await req.formData(), ['lang'])
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
      try {
        const image = await llm.generateImage(selTopicText)
        await db.setTopicImage(selTopicId, image)
      } catch (e) {
        console.log(`Cannot create image for issue ${issueUuid}, topic ${selTopicId}`)
        await db.setTopicImage(selTopicId, '')
      }
    })()

    if (topics.reduce((a, b) => a + b[1], 0) + 1 === 3) {
      // All topics selected. Make the newspaper!
      const selTopics = await db.selectedTopicsForIssue(issueUuid)
      const issueNum = await db.reserveIssueNumber(issueUuid)
      const language = await db.issueLanguage(issueUuid)
      const newspaperGen = await llm.askForNewspaper(language, issueNum, selTopics)
      const chunks = []
      const listeners = []
      newspaperStreams[issueNum] = {
        listeners: listeners,
      }
      ;(async () => {
        for await (const chunk of newspaperGen) {
          chunks.push(chunk)
          for (let i = 0; i < listeners.length; i++) {
            try {
              listeners[i](chunks, false)
            } catch (e) {
              console.log('Removing listener', e)
              const t = listeners.pop()
              if (i < listeners.length - 1) listeners[i] = t
              i--
            }
          }
        }
        for (let i = 0; i < listeners.length; i++) {
          try {
            listeners[i](chunks, true)
          } catch (e) {
          }
        }
        await db.publishIssue(issueNum, chunks.join(''))
        delete newspaperStreams[issueNum]
      })()
      // Return the issue number
      return new Response(issueNum)
    } else {
      // Just reply OK
      return new Response('OK')
    }
  }
  if (req.method === 'GET' && url.pathname.startsWith('/issue/')) {
    const matchRawText = url.pathname.match(/^\/issue\/([0-9]{1,10})\/raw$/)
    if (matchRawText) {
      const issueNum = parseInt(matchRawText[1])
      const text = await db.issuePagesContent(issueNum)
      if (text === null) throw new ErrorHttpCoded(404, 'Issue not found')
      if (text !== '') {
        return new Response(text)
      } else {
        // Streaming!
        const s = newspaperStreams[issueNum]
        if (!s) throw new ErrorHttpCoded(404, 'Issue not found')

        const stream = new ReadableStream({
          start(controller) {
            let lastWrittenChunk = 0
            const fn = (chunks, isFinished) => {
              try {
                const n = chunks.length
                for (let i = lastWrittenChunk; i < n; i++)
                  controller.enqueue((new TextEncoder()).encode(chunks[i]))
                lastWrittenChunk = n
              } catch (e) {
                controller.close()
                return
              }
              if (isFinished) controller.close()
            }
            s.listeners.push(fn)
          },
        })
        return new Response(stream)
      }
    }
    const matchLang = url.pathname.match(/^\/issue\/([0-9]{1,10})\/lang$/)
    if (matchLang) {
      const issueNum = parseInt(matchLang[1])
      const lang = await db.publishedIssueLanguage(issueNum)
      if (!lang) throw new ErrorHttpCoded(404, 'Issue not found')
      return new Response(lang)
    }
    const matchIllust = url.pathname.match(/^\/issue\/([0-9]{1,10})\/illust\/([1-3])$/)
    if (matchIllust) {
      const issueNum = parseInt(matchIllust[1])
      const illustNum = parseInt(matchIllust[2])
      const image = await db.topicImage(issueNum, illustNum - 1)
      return new Response(image, {
        headers: { 'Content-Type': 'image/webp' },
      })
    }
    const matchIllustDone = url.pathname.match(/^\/issue\/([0-9]{1,10})\/illust\/([1-3])\/done$/)
    if (matchIllustDone) {
      const issueNum = parseInt(matchIllustDone[1])
      const illustNum = parseInt(matchIllustDone[2])
      const image = await db.topicImage(issueNum, illustNum - 1)
      return new Response((!image || image === '+') ? '0' : '1')
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
